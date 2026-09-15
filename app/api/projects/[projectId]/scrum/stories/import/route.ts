import { Buffer } from "node:buffer";
import type { NextRequest } from "next/server";
import { aiError, aiJson, getAiRequestId, sha256Hex } from "@/lib/ai/api";
import {
  STORY_IMPORT_JSON_SCHEMA,
  buildStoryImportInstructions,
  buildStoryImportSubmoduleContext,
  getResponsesOutputText,
  getStoryImportWarnings,
  normalizeStoryImport,
  type StoryImportSubmodule,
} from "@/lib/ai/story-import";
import { ensureProjectAccess, listDocuments, readDocument, writeDocument } from "@/lib/github/server";
import {
  DEFAULT_ROLE_PERMISSIONS,
  normalizeRolePermissions,
  resolveRolePermissions,
} from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_FILE_SIZE = 4 * 1024 * 1024;
const MAX_REQUEST_SIZE = MAX_FILE_SIZE + 256 * 1024;
const MAX_DOCX_UNCOMPRESSED_SIZE = 60 * 1024 * 1024;
const MAX_DOCX_ENTRIES = 2_000;
const OPENAI_TIMEOUT_MS = 55_000;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1_000;
const RATE_LIMIT_ATTEMPTS = 8;
const MODEL = process.env.OPENAI_STORY_IMPORT_MODEL || process.env.OPENAI_RECEIPT_MODEL || "gpt-4.1-mini";
const PDF_MIME = "application/pdf";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

type AcceptedDocument = {
  mimeType: typeof PDF_MIME | typeof DOCX_MIME;
  extension: ".pdf" | ".docx";
};

class ImportRequestError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const getSafeFileName = (value: string) => {
  const name = value.split(/[\\/]/).at(-1) || "historia-usuario";
  return name
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/[^\p{L}\p{N}._()\- ]/gu, "_")
    .trim()
    .slice(0, 180) || "historia-usuario";
};

const getExtension = (fileName: string) => {
  const match = fileName.toLocaleLowerCase("en").match(/\.(pdf|docx)$/);
  return match ? `.${match[1]}` : "";
};

const verifyDocxContainer = (buffer: Buffer) => {
  const hasZipSignature = buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50;
  if (!hasZipSignature) return false;

  const centralDirectorySignature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  let offset = 0;
  let entries = 0;
  let totalUncompressedSize = 0;
  let hasContentTypes = false;
  let hasWordDocument = false;

  while (offset < buffer.length) {
    const entryOffset = buffer.indexOf(centralDirectorySignature, offset);
    if (entryOffset < 0) break;
    if (entryOffset + 46 > buffer.length) return false;

    const uncompressedSize = buffer.readUInt32LE(entryOffset + 24);
    const flags = buffer.readUInt16LE(entryOffset + 8);
    const compressionMethod = buffer.readUInt16LE(entryOffset + 10);
    const fileNameLength = buffer.readUInt16LE(entryOffset + 28);
    const extraLength = buffer.readUInt16LE(entryOffset + 30);
    const commentLength = buffer.readUInt16LE(entryOffset + 32);
    const nextOffset = entryOffset + 46 + fileNameLength + extraLength + commentLength;
    if (nextOffset > buffer.length || nextOffset <= entryOffset) return false;
    if ((flags & 0x1) !== 0 || ![0, 8].includes(compressionMethod)) return false;

    const entryName = buffer.subarray(entryOffset + 46, entryOffset + 46 + fileNameLength).toString("utf8");
    hasContentTypes ||= entryName === "[Content_Types].xml";
    hasWordDocument ||= entryName === "word/document.xml";
    entries += 1;
    totalUncompressedSize += uncompressedSize;
    if (entries > MAX_DOCX_ENTRIES || totalUncompressedSize > MAX_DOCX_UNCOMPRESSED_SIZE) {
      throw new ImportRequestError(
        413,
        "DOCX_EXPANSION_LIMIT",
        "El DOCX contiene demasiados elementos o se expande por encima del límite seguro.",
      );
    }
    offset = nextOffset;
  }

  return entries > 0 && hasContentTypes && hasWordDocument;
};

const inspectDocument = (file: File, buffer: Buffer): AcceptedDocument => {
  const extension = getExtension(file.name);
  const declaredMime = String(file.type || "").trim().toLocaleLowerCase("en");
  const genericMime = !declaredMime || declaredMime === "application/octet-stream";

  if (extension === ".pdf") {
    if (!genericMime && declaredMime !== PDF_MIME) {
      throw new ImportRequestError(415, "FILE_TYPE_MISMATCH", "La extensión y el tipo declarado del PDF no coinciden.");
    }
    if (buffer.length < 5 || buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw new ImportRequestError(415, "INVALID_PDF", "El archivo no contiene una firma PDF válida.");
    }
    return { mimeType: PDF_MIME, extension: ".pdf" };
  }

  if (extension === ".docx") {
    if (!genericMime && declaredMime !== DOCX_MIME) {
      throw new ImportRequestError(415, "FILE_TYPE_MISMATCH", "La extensión y el tipo declarado del DOCX no coinciden.");
    }
    if (!verifyDocxContainer(buffer)) {
      throw new ImportRequestError(415, "INVALID_DOCX", "El archivo no contiene una estructura DOCX válida.");
    }
    return { mimeType: DOCX_MIME, extension: ".docx" };
  }

  throw new ImportRequestError(415, "UNSUPPORTED_FILE_TYPE", "Solo puedes importar archivos PDF o DOCX.");
};

const parseOpenAiJson = (payload: unknown) => {
  const text = getResponsesOutputText(payload);
  if (!text) {
    throw new ImportRequestError(502, "EMPTY_AI_RESPONSE", "La IA no devolvió un expediente legible.");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ImportRequestError(502, "INVALID_AI_RESPONSE", "La IA devolvió una respuesta que no cumple el formato esperado.");
  }
};

const getSubmodules = async (
  supabase: any,
  projectId: string,
  epicId: string,
): Promise<StoryImportSubmodule[]> => {
  const groups = await listDocuments(supabase, `projects/${projectId}/scrumGroups`, 1_000);
  return groups
    .filter((group: any) => !group.deletedAt && (!epicId || String(group.scrumEpicId || "") === epicId))
    .map((group: any) => ({
      id: String(group.id || ""),
      code: String(group.submoduleCode || group.groupCode || "").slice(0, 80),
      name: String(group.name || "").slice(0, 200),
      description: String(group.description || "").slice(0, 500),
      epicId: String(group.scrumEpicId || "").slice(0, 180),
      releaseId: String(group.scrumReleaseId || "").slice(0, 180),
    }))
    .filter((group: StoryImportSubmodule) => group.id);
};

const registerImportAttempt = async (access: any, projectId: string) => {
  const collectionPath = `projects/${projectId}/storyAiImportUsage`;
  const usageId = String(access.actor.id || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 180);
  if (!usageId) throw new ImportRequestError(401, "INVALID_ACTOR", "No se pudo identificar al usuario de la importación.");
  const usage = await readDocument(access.supabase, collectionPath, usageId);
  const now = Date.now();
  const recentAttempts = (Array.isArray(usage?.attempts) ? usage.attempts : [])
    .map((entry: unknown) => new Date(String(entry || "")).getTime())
    .filter((timestamp: number) => Number.isFinite(timestamp) && now - timestamp < RATE_LIMIT_WINDOW_MS);
  if (recentAttempts.length >= RATE_LIMIT_ATTEMPTS) {
    throw new ImportRequestError(
      429,
      "IMPORT_RATE_LIMIT",
      "Alcanzaste el límite temporal de análisis. Espera unos minutos antes de volver a intentarlo.",
    );
  }
  const attemptedAt = new Date(now).toISOString();
  await writeDocument(access.supabase, collectionPath, usageId, {
    projectId,
    userId: access.actor.id,
    attempts: [...recentAttempts.map((timestamp: number) => new Date(timestamp).toISOString()), attemptedAt],
    lastAttemptAt: attemptedAt,
  }, false);
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) {
  const requestId = getAiRequestId(request);
  try {
    const { projectId } = await context.params;
    const access = await ensureProjectAccess(request, projectId);
    if (access.error) return access.error;
    const permissionDocument = await readDocument(access.supabase, "settings", "rolePermissions");
    const permissionSettings = normalizeRolePermissions(permissionDocument || DEFAULT_ROLE_PERMISSIONS);
    const actorPermissions = resolveRolePermissions(permissionSettings, access.actor.role);
    if (!actorPermissions.taskEditDetails) {
      return aiError(
        requestId,
        403,
        "STORY_IMPORT_FORBIDDEN",
        "No tienes permiso para editar historias de usuario en este proyecto.",
      );
    }

    const contentType = request.headers.get("content-type")?.toLocaleLowerCase("en") || "";
    if (!contentType.startsWith("multipart/form-data;")) {
      return aiError(requestId, 415, "MULTIPART_REQUIRED", "Envía el documento mediante multipart/form-data.");
    }

    const contentLength = Number(request.headers.get("content-length") || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_SIZE) {
      return aiError(requestId, 413, "REQUEST_TOO_LARGE", "La solicitud supera el límite permitido de 4 MB por documento.");
    }

    const formData = await request.formData();
    const attachedFiles = Array.from(formData.entries())
      .filter((entry): entry is [string, File] => typeof entry[1] !== "string");
    const fileEntries = formData.getAll("file");
    if (
      attachedFiles.length !== 1
      || attachedFiles[0][0] !== "file"
      || fileEntries.length !== 1
      || typeof fileEntries[0] === "string"
    ) {
      return aiError(requestId, 400, "ONE_FILE_REQUIRED", "Adjunta exactamente un archivo PDF o DOCX en el campo file.");
    }
    const file = fileEntries[0];
    if (file.size === 0) {
      return aiError(requestId, 400, "EMPTY_FILE", "El documento está vacío.");
    }
    if (file.size > MAX_FILE_SIZE) {
      return aiError(requestId, 413, "FILE_TOO_LARGE", "El documento supera el límite de 4 MB.");
    }

    const epicId = String(formData.get("epicId") || "").trim();
    if (epicId && !/^[A-Za-z0-9_-]{1,160}$/.test(epicId)) {
      return aiError(requestId, 400, "INVALID_EPIC_ID", "La épica indicada no es válida.");
    }
    if (epicId) {
      const epic = await readDocument(access.supabase, `projects/${projectId}/tasks`, epicId);
      if (!epic || epic.deletedAt || epic.scrumKind !== "epic") {
        return aiError(requestId, 400, "EPIC_NOT_FOUND", "La épica indicada no pertenece al proyecto o ya no está disponible.");
      }
    }

    const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
    if (!apiKey) {
      return aiError(
        requestId,
        503,
        "AI_NOT_CONFIGURED",
        "La importación inteligente no está configurada en este entorno.",
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const document = inspectDocument(file, buffer);
    await registerImportAttempt(access, projectId);
    const submodules = await getSubmodules(access.supabase, projectId, epicId);
    const sanitizedOriginalName = getSafeFileName(file.name);
    const safeBaseName = sanitizedOriginalName.replace(/\.(pdf|docx)$/i, "").slice(0, 170) || "historia-usuario";
    const safeFileName = `${safeBaseName}${document.extension}`;
    const fileData = `data:${document.mimeType};base64,${buffer.toString("base64")}`;
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), OPENAI_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        signal: abortController.signal,
        body: JSON.stringify({
          model: MODEL,
          store: false,
          safety_identifier: sha256Hex(`${access.actor.id}:${projectId}`),
          instructions: buildStoryImportInstructions(),
          input: [{
            role: "user",
            content: [
              {
                type: "input_text",
                text: [
                  "Extrae únicamente la historia de usuario contenida en el documento adjunto y crea un borrador normalizado para revisión humana en Pixel.",
                  buildStoryImportSubmoduleContext(submodules),
                ].join("\n\n"),
              },
              {
                type: "input_file",
                filename: safeFileName,
                file_data: fileData,
              },
            ],
          }],
          text: {
            format: {
              type: "json_schema",
              name: "pixel_user_story_import",
              strict: true,
              schema: STORY_IMPORT_JSON_SCHEMA,
            },
          },
          max_output_tokens: 12_000,
        }),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new ImportRequestError(504, "AI_TIMEOUT", "La lectura del documento tardó demasiado. Intenta nuevamente.");
      }
      throw new ImportRequestError(502, "AI_UNAVAILABLE", "No fue posible conectar con el lector inteligente.");
    } finally {
      clearTimeout(timeout);
    }

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      console.error("User story import upstream error", { requestId, status: response.status });
      throw new ImportRequestError(502, "AI_REJECTED_REQUEST", "El lector inteligente no pudo procesar este documento.");
    }

    const imported = normalizeStoryImport(parseOpenAiJson(payload), submodules.map((group) => group.id));
    return aiJson(
      requestId,
      {
        suggestedTitle: imported.suggestedTitle,
        draft: imported.draft,
        warnings: getStoryImportWarnings(imported, submodules.length),
        source: {
          fileName: safeFileName,
          fileType: document.mimeType,
          fileSize: file.size,
        },
        model: MODEL,
      },
      200,
      { "Cache-Control": "no-store" },
    );
  } catch (error) {
    if (error instanceof ImportRequestError) {
      return aiError(requestId, error.status, error.code, error.message, { "Cache-Control": "no-store" });
    }
    console.error("User story import error", {
      requestId,
      message: error instanceof Error ? error.message : "unknown",
    });
    return aiError(
      requestId,
      500,
      "STORY_IMPORT_FAILED",
      "No se pudo importar la historia de usuario.",
      { "Cache-Control": "no-store" },
    );
  }
}

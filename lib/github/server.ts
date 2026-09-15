import crypto from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getBearerToken, getServerSupabase } from "@/lib/license-server";

export { getServerSupabase };

export const GITHUB_DOCUMENTS_TABLE = "app_documents";
export const GITHUB_API_URL = "https://api.github.com";
export const GITHUB_API_VERSION = process.env.GITHUB_API_VERSION || "2022-11-28";

type JsonRecord = Record<string, any>;

export type PixelActor = {
  id: string;
  email: string;
  profile: JsonRecord;
  role: string;
};

export type GithubStatePurpose = "installation" | "identity";

export type GithubStatePayload = {
  purpose: GithubStatePurpose;
  nonce: string;
  userId: string;
  email: string;
  projectId?: string;
  organizationId?: string | null;
  returnTo: string;
  expiresAt: string;
};

const json = (body: JsonRecord, status = 200) => NextResponse.json(body, { status });

const normalizeEmail = (value: unknown) => String(value || "").trim().toLowerCase();

const getArray = (value: unknown) =>
  Array.isArray(value) ? value.map((entry) => String(entry || "")).filter(Boolean) : [];

const getProfile = async (supabase: any, userId: string, email: string) => {
  const { data: byId, error: byIdError } = await supabase
    .from(GITHUB_DOCUMENTS_TABLE)
    .select("doc_id,data")
    .eq("collection_path", "users")
    .eq("doc_id", userId)
    .maybeSingle();
  if (byIdError) throw byIdError;
  if (byId) return { ...(byId.data || {}), id: byId.doc_id };

  const { data: byEmail, error: byEmailError } = await supabase
    .from(GITHUB_DOCUMENTS_TABLE)
    .select("doc_id,data")
    .eq("collection_path", "users")
    .eq("data->>email", email)
    .limit(1);
  if (byEmailError) throw byEmailError;
  const row = (byEmail || [])[0];
  return row ? { ...(row.data || {}), id: row.doc_id } : null;
};

export const ensurePixelUser = async (request: NextRequest, supabase = getServerSupabase()) => {
  const token = getBearerToken(request);
  if (!token) return { error: json({ error: "Sesión no encontrada." }, 401) };

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user?.email) {
    return { error: json({ error: "La sesión de Pixel no es válida." }, 401) };
  }

  const email = normalizeEmail(data.user.email);
  const profile = (await getProfile(supabase, data.user.id, email)) || {};
  const role = String(profile.role || profile.systemRole || "user");
  return {
    actor: {
      id: data.user.id,
      email,
      profile,
      role,
    } as PixelActor,
  };
};

export const readDocument = async (supabase: any, collectionPath: string, docId: string) => {
  const { data, error } = await supabase
    .from(GITHUB_DOCUMENTS_TABLE)
    .select("doc_id,data,created_at,updated_at")
    .eq("collection_path", collectionPath)
    .eq("doc_id", docId)
    .maybeSingle();
  if (error) throw error;
  return data ? { ...(data.data || {}), id: data.doc_id, _createdAt: data.created_at, _updatedAt: data.updated_at } : null;
};

export const listDocuments = async (supabase: any, collectionPath: string, limit = 1000) => {
  const { data, error } = await supabase
    .from(GITHUB_DOCUMENTS_TABLE)
    .select("doc_id,data,created_at,updated_at")
    .eq("collection_path", collectionPath)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).map((row: any) => ({
    ...(row.data || {}),
    id: row.doc_id,
    _createdAt: row.created_at,
    _updatedAt: row.updated_at,
  }));
};

export const writeDocument = async (
  supabase: any,
  collectionPath: string,
  docId: string,
  data: JsonRecord,
  merge = true,
) => {
  const current = merge ? await readDocument(supabase, collectionPath, docId) : null;
  const now = new Date().toISOString();
  const nextData = {
    ...(merge && current ? Object.fromEntries(Object.entries(current).filter(([key]) => key !== "id" && !key.startsWith("_"))) : {}),
    ...data,
    updatedAt: now,
  };
  const { data: row, error } = await supabase
    .from(GITHUB_DOCUMENTS_TABLE)
    .upsert(
      {
        collection_path: collectionPath,
        doc_id: docId,
        data: nextData,
        updated_at: now,
      },
      { onConflict: "collection_path,doc_id" },
    )
    .select("doc_id,data,created_at,updated_at")
    .single();
  if (error) throw error;
  return { ...(row.data || {}), id: row.doc_id, _createdAt: row.created_at, _updatedAt: row.updated_at };
};

export const deleteDocument = async (supabase: any, collectionPath: string, docId: string) => {
  const { error } = await supabase
    .from(GITHUB_DOCUMENTS_TABLE)
    .delete()
    .eq("collection_path", collectionPath)
    .eq("doc_id", docId);
  if (error) throw error;
};

const actorIdentityValues = (actor: PixelActor) =>
  new Set(
    [actor.id, actor.email, actor.profile?.id, actor.profile?.uid, actor.profile?.authUserId]
      .map((entry) => String(entry || "").trim().toLowerCase())
      .filter(Boolean),
  );

const actorOrganizationIds = (actor: PixelActor) =>
  new Set(
    [actor.profile?.organizationId, ...getArray(actor.profile?.organizationIds)]
      .map((entry) => String(entry || "").trim())
      .filter(Boolean),
  );

const projectOrganizationIds = (project: JsonRecord) =>
  [project.organizationId, ...getArray(project.organizationIds)]
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);

export const canAccessProject = (actor: PixelActor, project: JsonRecord) => {
  if (actor.role === "admin") return true;
  const identities = actorIdentityValues(actor);
  if (identities.has(String(project.ownerId || "").toLowerCase())) return true;
  const assigned = [...getArray(project.assignedUsers), ...getArray(project.assignedTeamMembers)];
  if (assigned.some((entry) => identities.has(entry.toLowerCase()))) return true;

  const elevated = ["org_admin", "manager", "gerente", "project_manager", "coordinador", "coordinator"];
  if (!elevated.includes(actor.role)) return false;
  const organizations = actorOrganizationIds(actor);
  return projectOrganizationIds(project).some((organizationId) => organizations.has(organizationId));
};

export const canManageProjectGithub = (actor: PixelActor, project: JsonRecord) => {
  if (actor.role === "admin") return true;
  const identities = actorIdentityValues(actor);
  if (identities.has(String(project.ownerId || "").toLowerCase())) return true;
  if (!["org_admin", "manager", "project_manager", "coordinador", "coordinator"].includes(actor.role)) {
    return false;
  }
  const organizations = actorOrganizationIds(actor);
  return projectOrganizationIds(project).some((organizationId) => organizations.has(organizationId));
};

export const ensureProjectAccess = async (
  request: NextRequest,
  projectId: string,
  options: { manage?: boolean } = {},
) => {
  const supabase = getServerSupabase();
  const auth = await ensurePixelUser(request, supabase);
  if (auth.error) return { error: auth.error };
  const project = await readDocument(supabase, "projects", projectId);
  if (!project) return { error: json({ error: "El proyecto no existe." }, 404) };
  const allowed = options.manage
    ? canManageProjectGithub(auth.actor, project)
    : canAccessProject(auth.actor, project);
  if (!allowed) return { error: json({ error: "No tienes permiso para acceder a la integración GitHub de este proyecto." }, 403) };
  return { supabase, actor: auth.actor, project };
};

export const getAppBaseUrl = (request?: NextRequest) => {
  const explicit = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || process.env.APP_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  if (request) return new URL(request.url).origin;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
};

const requireEnvironmentValue = (name: string) => {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Falta configurar ${name} en Vercel.`);
  return value;
};

export const getGithubPublicConfiguration = () => ({
  appId: Boolean(process.env.GITHUB_APP_ID),
  appSlug: process.env.GITHUB_APP_SLUG || "",
  clientId: Boolean(process.env.GITHUB_CLIENT_ID),
  clientSecret: Boolean(process.env.GITHUB_CLIENT_SECRET),
  privateKey: Boolean(process.env.GITHUB_APP_PRIVATE_KEY),
  webhookSecret: Boolean(process.env.GITHUB_WEBHOOK_SECRET),
  stateSecret: Boolean(process.env.GITHUB_STATE_SECRET),
});

const getGithubPrivateKey = () => {
  let value = requireEnvironmentValue("GITHUB_APP_PRIVATE_KEY");
  if (value.startsWith("base64:")) value = Buffer.from(value.slice(7), "base64").toString("utf8");
  return value.replace(/\\n/g, "\n");
};

const toBase64Url = (value: string | Buffer) => Buffer.from(value).toString("base64url");

export const createGithubAppJwt = () => {
  const appId = requireEnvironmentValue("GITHUB_APP_ID");
  const now = Math.floor(Date.now() / 1000);
  const header = toBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = toBase64Url(JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: appId }));
  const unsigned = `${header}.${payload}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(getGithubPrivateKey(), "base64url")}`;
};

export const githubFetch = async <T = any>(
  path: string,
  options: RequestInit & { token?: string } = {},
): Promise<T> => {
  const { token, ...requestOptions } = options;
  const response = await fetch(path.startsWith("http") ? path : `${GITHUB_API_URL}${path}`, {
    ...requestOptions,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      "User-Agent": "Pixel-Project-GitHub-App",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(requestOptions.headers || {}),
    },
    cache: "no-store",
  });
  const raw = await response.text();
  const body = raw ? JSON.parse(raw) : {};
  if (!response.ok) {
    throw new Error(body?.message || `GitHub respondió ${response.status}.`);
  }
  return body as T;
};

export const getInstallationToken = async (installationId: string | number) => {
  const result = await githubFetch<{ token: string; expires_at: string }>(
    `/app/installations/${installationId}/access_tokens`,
    { method: "POST", token: createGithubAppJwt() },
  );
  return result.token;
};

export const listInstallationRepositories = async (installationId: string | number) => {
  const token = await getInstallationToken(installationId);
  const repositories: any[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const result = await githubFetch<{ repositories: any[] }>(
      `/installation/repositories?per_page=100&page=${page}`,
      { token },
    );
    repositories.push(...(result.repositories || []));
    if ((result.repositories || []).length < 100) break;
  }
  return repositories;
};

const encodeState = (payload: GithubStatePayload) => {
  const encoded = toBase64Url(JSON.stringify(payload));
  const signature = crypto
    .createHmac("sha256", requireEnvironmentValue("GITHUB_STATE_SECRET"))
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
};

export const createGithubState = async (
  supabase: any,
  payload: Omit<GithubStatePayload, "nonce" | "expiresAt">,
) => {
  const nonce = crypto.randomUUID();
  const complete: GithubStatePayload = {
    ...payload,
    nonce,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  };
  await writeDocument(supabase, "github_oauth_states", nonce, complete, false);
  return encodeState(complete);
};

export const consumeGithubState = async (supabase: any, state: string, purpose: GithubStatePurpose) => {
  const [encoded, signature] = String(state || "").split(".");
  if (!encoded || !signature) throw new Error("El estado de GitHub no es válido.");
  const expected = crypto
    .createHmac("sha256", requireEnvironmentValue("GITHUB_STATE_SECRET"))
    .update(encoded)
    .digest("base64url");
  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
    throw new Error("No fue posible validar el estado de GitHub.");
  }
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as GithubStatePayload;
  if (payload.purpose !== purpose || new Date(payload.expiresAt).getTime() < Date.now()) {
    throw new Error("La autorización de GitHub expiró. Iníciala nuevamente.");
  }
  const stored = await readDocument(supabase, "github_oauth_states", payload.nonce);
  if (!stored || stored.purpose !== purpose || stored.userId !== payload.userId) {
    throw new Error("La autorización de GitHub ya fue utilizada o no existe.");
  }
  await deleteDocument(supabase, "github_oauth_states", payload.nonce);
  return payload;
};

export const verifyGithubWebhook = (rawBody: string, signatureHeader: string) => {
  const provided = String(signatureHeader || "");
  const expected = `sha256=${crypto
    .createHmac("sha256", requireEnvironmentValue("GITHUB_WEBHOOK_SECRET"))
    .update(rawBody)
    .digest("hex")}`;
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(providedBuffer, expectedBuffer);
};

export const safeReturnTo = (value: unknown, fallback = "/projects") => {
  const normalized = String(value || "").trim();
  return normalized.startsWith("/") && !normalized.startsWith("//") ? normalized : fallback;
};

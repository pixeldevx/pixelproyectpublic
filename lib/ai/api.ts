import { createHash, randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

export const AI_API_VERSION = '2026-08-07';

const REQUEST_ID_PATTERN = /^[a-zA-Z0-9._:-]{8,96}$/;

export class AiHttpError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const getAiRequestId = (request: NextRequest) => {
  const incoming = request.headers.get('x-request-id')?.trim() || '';
  return REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
};

export const aiJson = (
  requestId: string,
  body: Record<string, any>,
  status = 200,
  headers?: HeadersInit,
) => {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('X-Request-Id', requestId);
  responseHeaders.set('X-Pixel-AI-API-Version', AI_API_VERSION);
  return NextResponse.json(body, { status, headers: responseHeaders });
};

export const aiError = (
  requestId: string,
  status: number,
  code: string,
  message: string,
  headers?: HeadersInit,
) =>
  aiJson(
    requestId,
    {
      error: {
        code,
        message,
        request_id: requestId,
      },
    },
    status,
    headers,
  );

export const sha256Hex = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex');

export const stableStringify = (value: unknown): string => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;

  const valueType = typeof value;
  if (valueType === 'number') {
    if (!Number.isFinite(value)) throw new AiHttpError(400, 'INVALID_JSON_NUMBER', 'El JSON contiene un número inválido.');
    return JSON.stringify(value);
  }
  if (valueType === 'string' || valueType === 'boolean') return JSON.stringify(value);
  if (valueType !== 'object') return JSON.stringify(value);

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
};

const findDuplicateJsonKey = (input: string): string | null => {
  let index = 0;

  const skipWhitespace = () => {
    while (/\s/.test(input[index] || '')) index += 1;
  };

  const parseString = () => {
    if (input[index] !== '"') throw new Error('Expected string.');
    index += 1;
    let output = '';
    while (index < input.length) {
      const char = input[index];
      if (char === '"') {
        index += 1;
        return output;
      }
      if (char === '\\') {
        const escaped = input[index + 1];
        if (!escaped) throw new Error('Invalid escape.');
        if (escaped === 'u') {
          output += input.slice(index, index + 6);
          index += 6;
        } else {
          output += escaped;
          index += 2;
        }
        continue;
      }
      output += char;
      index += 1;
    }
    throw new Error('Unclosed string.');
  };

  const skipPrimitive = () => {
    while (index < input.length && !/[\s,\]}]/.test(input[index])) index += 1;
  };

  const parseValue = (path: string): string | null => {
    skipWhitespace();
    const char = input[index];
    if (char === '{') return parseObject(path);
    if (char === '[') return parseArray(path);
    if (char === '"') {
      parseString();
      return null;
    }
    skipPrimitive();
    return null;
  };

  const parseArray = (path: string): string | null => {
    index += 1;
    skipWhitespace();
    if (input[index] === ']') {
      index += 1;
      return null;
    }

    let itemIndex = 0;
    while (index < input.length) {
      const duplicate = parseValue(`${path}[${itemIndex}]`);
      if (duplicate) return duplicate;
      skipWhitespace();
      if (input[index] === ',') {
        index += 1;
        itemIndex += 1;
        continue;
      }
      if (input[index] === ']') {
        index += 1;
        return null;
      }
      return null;
    }
    return null;
  };

  const parseObject = (path: string): string | null => {
    index += 1;
    const keys = new Set<string>();
    skipWhitespace();
    if (input[index] === '}') {
      index += 1;
      return null;
    }

    while (index < input.length) {
      skipWhitespace();
      if (input[index] !== '"') return null;
      const key = parseString();
      const keyPath = path ? `${path}.${key}` : key;
      if (keys.has(key)) return keyPath;
      keys.add(key);

      skipWhitespace();
      if (input[index] !== ':') return null;
      index += 1;

      const duplicate = parseValue(keyPath);
      if (duplicate) return duplicate;
      skipWhitespace();

      if (input[index] === ',') {
        index += 1;
        continue;
      }
      if (input[index] === '}') {
        index += 1;
        return null;
      }
      return null;
    }
    return null;
  };

  try {
    skipWhitespace();
    return parseValue('');
  } catch {
    return null;
  }
};

export const parseAiJsonBody = async <T = any>(
  request: NextRequest,
  maxBytes: number,
): Promise<{ raw: string; parsed: T; canonicalSha256: string }> => {
  const contentType = request.headers.get('content-type') || '';
  if (!/^application\/json(?:\s*;\s*charset=utf-?8)?$/i.test(contentType.trim())) {
    throw new AiHttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'El cuerpo debe enviarse como application/json.');
  }

  if ((request.headers.get('content-encoding') || '').trim()) {
    throw new AiHttpError(415, 'COMPRESSED_BODY_NOT_ALLOWED', 'No se aceptan cuerpos comprimidos para esta API.');
  }

  const raw = await request.text();
  const byteLength = Buffer.byteLength(raw, 'utf8');
  if (byteLength > maxBytes) {
    throw new AiHttpError(413, 'PAYLOAD_TOO_LARGE', 'El lote supera el tamaño máximo permitido.');
  }

  const duplicateKey = findDuplicateJsonKey(raw);
  if (duplicateKey) {
    throw new AiHttpError(400, 'DUPLICATE_JSON_KEY', `El JSON contiene una propiedad duplicada: ${duplicateKey}.`);
  }

  let parsed: T;
  try {
    parsed = JSON.parse(raw) as T;
  } catch {
    throw new AiHttpError(400, 'MALFORMED_JSON', 'El cuerpo no es un JSON válido.');
  }

  const canonicalSha256 = sha256Hex(stableStringify(parsed));
  return { raw, parsed, canonicalSha256 };
};

export const assertNoUnknownKeys = (
  value: unknown,
  allowedKeys: readonly string[],
  location: string,
) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AiHttpError(400, 'INVALID_JSON_OBJECT', `${location} debe ser un objeto JSON.`);
  }
  const allowed = new Set(allowedKeys);
  const unknown = Object.keys(value as Record<string, unknown>).find((key) => !allowed.has(key));
  if (unknown) {
    throw new AiHttpError(422, 'UNKNOWN_FIELD', `El campo ${location}.${unknown} no hace parte del contrato público.`);
  }
};

export const sanitizeText = (value: unknown, maxLength: number) =>
  typeof value === 'string' ? value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, maxLength) : '';

export const isUuid = (value: unknown) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export const isLowerSha256 = (value: unknown) =>
  typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);


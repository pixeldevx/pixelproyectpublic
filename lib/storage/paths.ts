export type DocumentStorageProvider = 'supabase' | 's3';

export type ParsedS3StoragePath = {
  provider: 's3';
  bucket: string;
  key: string;
};

const S3_PATH_PREFIX = 's3://';

export const normalizeStorageKey = (path: string) =>
  String(path || '')
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/');

export const formatS3StoragePath = (bucket: string, key: string) =>
  `${S3_PATH_PREFIX}${bucket}/${normalizeStorageKey(key)}`;

export const parseS3StoragePath = (path: string): ParsedS3StoragePath | null => {
  const cleanPath = String(path || '').trim();
  if (!cleanPath.startsWith(S3_PATH_PREFIX)) return null;

  const withoutPrefix = cleanPath.slice(S3_PATH_PREFIX.length);
  const slashIndex = withoutPrefix.indexOf('/');
  if (slashIndex <= 0) return null;

  const bucket = withoutPrefix.slice(0, slashIndex).trim();
  const key = normalizeStorageKey(withoutPrefix.slice(slashIndex + 1));

  if (!bucket || !key) return null;
  return { provider: 's3', bucket, key };
};

export const isS3StoragePath = (path: string) => Boolean(parseS3StoragePath(path));

import crypto from 'crypto';

type PresignOptions = {
  method: 'GET' | 'PUT' | 'DELETE';
  bucket: string;
  key: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  expiresInSeconds?: number;
};

const SERVICE = 's3';
const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';

const hmac = (key: Buffer | string, value: string) =>
  crypto.createHmac('sha256', key).update(value, 'utf8').digest();

const hash = (value: string) => crypto.createHash('sha256').update(value, 'utf8').digest('hex');

const toHex = (value: Buffer) => value.toString('hex');

const awsEncode = (value: string) =>
  encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );

const encodeKeyPath = (key: string) =>
  key
    .split('/')
    .filter(Boolean)
    .map(awsEncode)
    .join('/');

const amzDateParts = (date = new Date()) => {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return {
    amzDate: iso,
    dateStamp: iso.slice(0, 8),
  };
};

const signingKey = (secretAccessKey: string, dateStamp: string, region: string) => {
  const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, SERVICE);
  return hmac(serviceKey, 'aws4_request');
};

const canonicalQueryString = (params: Record<string, string>) =>
  Object.entries(params)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${awsEncode(key)}=${awsEncode(value)}`)
    .join('&');

const s3Host = (bucket: string, region: string) =>
  region === 'us-east-1'
    ? `${bucket}.s3.amazonaws.com`
    : `${bucket}.s3.${region}.amazonaws.com`;

export const createS3PresignedUrl = ({
  method,
  bucket,
  key,
  region,
  accessKeyId,
  secretAccessKey,
  sessionToken,
  expiresInSeconds = 900,
}: PresignOptions) => {
  const { amzDate, dateStamp } = amzDateParts();
  const credentialScope = `${dateStamp}/${region}/${SERVICE}/aws4_request`;
  const credential = `${accessKeyId}/${credentialScope}`;
  const host = s3Host(bucket, region);
  const canonicalUri = `/${encodeKeyPath(key)}`;

  const params: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': credential,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(Math.min(Math.max(expiresInSeconds, 60), 604800)),
    'X-Amz-SignedHeaders': 'host',
  };

  if (sessionToken) {
    params['X-Amz-Security-Token'] = sessionToken;
  }

  const canonicalQuery = canonicalQueryString(params);
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    `host:${host}\n`,
    'host',
    UNSIGNED_PAYLOAD,
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    hash(canonicalRequest),
  ].join('\n');

  const signature = toHex(hmac(signingKey(secretAccessKey, dateStamp, region), stringToSign));
  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
};

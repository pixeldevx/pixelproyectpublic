import crypto from 'node:crypto';

const ATTESTATION_VERSION = 'v1';
const ATTESTATION_DOMAIN = 'pixel.push-subscription';

type PushSubscriptionAttestationInput = {
  subscriptionId: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

const normalizeSecret = (value: unknown) => {
  const secret = String(value || '').trim();
  return secret.length >= 32 ? secret : '';
};

const getCurrentAttestationSecret = () =>
  normalizeSecret(
    process.env.PUSH_SUBSCRIPTION_ATTESTATION_SECRET
      || process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

const getVerificationSecrets = () => Array.from(new Set([
  getCurrentAttestationSecret(),
  normalizeSecret(process.env.PUSH_SUBSCRIPTION_ATTESTATION_PREVIOUS_SECRET),
].filter(Boolean)));

const getKeyId = (secret: string) =>
  crypto.createHash('sha256').update(`${ATTESTATION_DOMAIN}:${secret}`).digest('hex').slice(0, 12);

const attestationPayload = (input: PushSubscriptionAttestationInput) =>
  [
    ATTESTATION_DOMAIN,
    ATTESTATION_VERSION,
    input.subscriptionId.trim(),
    input.userId.trim(),
    input.endpoint.trim(),
    input.p256dh.trim(),
    input.auth.trim(),
  ].join('\n');

const createMac = (input: PushSubscriptionAttestationInput, secret: string) =>
  crypto
    .createHmac('sha256', secret)
    .update(attestationPayload(input))
    .digest('hex');

export const createPushSubscriptionAttestation = (
  input: PushSubscriptionAttestationInput,
) => {
  const secret = getCurrentAttestationSecret();
  if (
    !secret
    || !input.subscriptionId
    || !input.userId
    || !input.endpoint
    || !input.p256dh
    || !input.auth
  ) return '';
  return `${ATTESTATION_VERSION}.${getKeyId(secret)}.${createMac(input, secret)}`;
};

export const verifyPushSubscriptionAttestation = (
  attestation: unknown,
  input: PushSubscriptionAttestationInput,
) => {
  const provided = String(attestation || '').trim();
  const [version, keyId, providedMac, ...extra] = provided.split('.');
  if (extra.length > 0 || version !== ATTESTATION_VERSION || !keyId || !/^[a-f0-9]{64}$/.test(providedMac || '')) {
    return false;
  }

  return getVerificationSecrets().some((secret) => {
    if (getKeyId(secret) !== keyId) return false;
    const expectedMac = createMac(input, secret);
    const providedBuffer = Buffer.from(providedMac, 'hex');
    const expectedBuffer = Buffer.from(expectedMac, 'hex');
    return providedBuffer.length === expectedBuffer.length
      && crypto.timingSafeEqual(providedBuffer, expectedBuffer);
  });
};

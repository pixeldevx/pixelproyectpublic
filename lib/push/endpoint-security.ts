import { isIP } from 'node:net';

export type WebPushProvider = 'google' | 'mozilla' | 'apple' | 'windows';

export type WebPushEndpointValidation =
  | {
      ok: true;
      endpoint: string;
      hostname: string;
      provider: WebPushProvider;
    }
  | {
      ok: false;
      reason:
        | 'missing_endpoint'
        | 'endpoint_too_long'
        | 'invalid_url'
        | 'https_required'
        | 'credentials_not_allowed'
        | 'invalid_port'
        | 'local_or_ip_hostname'
        | 'unsupported_provider';
    };

const MAX_ENDPOINT_LENGTH = 4_096;

const EXACT_PROVIDER_HOSTS = new Map<string, WebPushProvider>([
  ['fcm.googleapis.com', 'google'],
  ['android.googleapis.com', 'google'],
  ['push.services.mozilla.com', 'mozilla'],
  ['updates.push.services.mozilla.com', 'mozilla'],
  ['updates-push.services.mozaws.net', 'mozilla'],
  ['push.apple.com', 'apple'],
  ['notify.windows.com', 'windows'],
  ['wns.windows.com', 'windows'],
]);

const TRUSTED_PROVIDER_SUFFIXES: Array<[suffix: string, provider: WebPushProvider]> = [
  ['.push.apple.com', 'apple'],
  ['.notify.windows.com', 'windows'],
  ['.wns.windows.com', 'windows'],
];

const isLocalHostname = (hostname: string) =>
  hostname === 'localhost'
  || hostname.endsWith('.localhost')
  || hostname.endsWith('.local')
  || hostname.endsWith('.internal')
  || hostname.endsWith('.lan')
  || hostname.endsWith('.home.arpa');

const resolveProvider = (hostname: string) => {
  const exactProvider = EXACT_PROVIDER_HOSTS.get(hostname);
  if (exactProvider) return exactProvider;

  return TRUSTED_PROVIDER_SUFFIXES.find(([suffix]) => (
    hostname.length > suffix.length && hostname.endsWith(suffix)
  ))?.[1] || null;
};

export const validateWebPushEndpoint = (value: unknown): WebPushEndpointValidation => {
  const endpoint = typeof value === 'string' ? value.trim() : '';
  if (!endpoint) return { ok: false, reason: 'missing_endpoint' };
  if (endpoint.length > MAX_ENDPOINT_LENGTH) return { ok: false, reason: 'endpoint_too_long' };

  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }

  if (parsed.protocol !== 'https:') return { ok: false, reason: 'https_required' };
  if (parsed.username || parsed.password) return { ok: false, reason: 'credentials_not_allowed' };
  if (parsed.port && parsed.port !== '443') return { ok: false, reason: 'invalid_port' };

  const hostname = parsed.hostname.toLowerCase();
  const unwrappedHostname = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  if (isIP(unwrappedHostname) !== 0 || isLocalHostname(unwrappedHostname)) {
    return { ok: false, reason: 'local_or_ip_hostname' };
  }

  const provider = resolveProvider(unwrappedHostname);
  if (!provider) return { ok: false, reason: 'unsupported_provider' };

  return {
    ok: true,
    endpoint,
    hostname: unwrappedHostname,
    provider,
  };
};

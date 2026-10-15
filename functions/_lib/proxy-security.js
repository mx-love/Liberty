const CAPABILITY_VERSION = 'liberty-proxy-v1';
const SESSION_VERSION = 'liberty-session-v1';
const DEFAULT_CAPABILITY_TTL_MS = 60_000;
const MAX_CAPABILITY_TTL_MS = 2 * 60_000;
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

const DEFAULT_ALLOWED_ORIGINS = [
  'https://caiji.dyttzyapi.com',
  'https://cj.rycjapi.com',
  'https://caiji.maotaizy.cc',
  'https://bfzyapi.com',
  'https://tyyszy.com',
  'https://api.guangsuapi.com',
  'https://cj.ffzyapi.com',
  'https://360zy.com',
  'https://wolongzyw.com',
  'https://jszyapi.com',
  'https://dbzy.tv',
  'https://caiji.dbzy5.com',
  'https://www.mdzyapi.com',
  'https://api.zuidapi.com',
  'https://iqiyizyapi.com',
  'https://yhzy.cc',
  'https://api.wujinapi.me',
  'https://ikunzyapi.com',
  'https://api.maoyanapi.top',
  'https://subocaiji.com',
  'https://api.ukuapi88.com',
  'https://movie.douban.com',
  'https://www.example.com',
];

const MEDIA_EXTENSION_PATTERN = /\.(?:m3u8|mpd|ts|m4s|mp4|m4v|m4a|aac|webm|mkv|avi|mov)(?:$|[?#])/iu;

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/gu, '');
}

function parseConfiguredOrigins(value) {
  return String(value || '')
    .split(/[\s,]+/u)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      try {
        const url = new URL(entry);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return [];
        return [url.origin];
      } catch {
        return [];
      }
    });
}

function isPrivateAddress(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/gu, '');
  if (!host) return true;
  if (
    host === 'localhost'
    || host.endsWith('.localhost')
    || host === '::'
    || host === '::1'
    || host.startsWith('::ffff:')
  ) return true;
  if (/^127\./u.test(host) || /^10\./u.test(host) || /^169\.254\./u.test(host)) return true;
  if (/^192\.168\./u.test(host)) return true;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u);
  if (ipv4) {
    const octets = ipv4.slice(1).map(Number);
    if (octets.some((value) => value > 255)) return true;
    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
    if (octets[0] === 0 || octets[0] >= 224) return true;
  }
  return host.startsWith('fc') || host.startsWith('fd') || /^fe[89ab]/u.test(host);
}

export function normalizeProxyTarget(value) {
  let target;
  try {
    target = new URL(String(value || ''));
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(target.protocol)) return null;
  if (target.username || target.password || target.hash || isPrivateAddress(target.hostname)) return null;
  return target;
}

export function getAllowedProxyOrigins(env = {}) {
  return new Set([
    ...DEFAULT_ALLOWED_ORIGINS,
    ...parseConfiguredOrigins(env.PROXY_ALLOWED_ORIGINS),
  ]);
}

export function validateProxyTarget(value, env = {}) {
  const target = normalizeProxyTarget(value);
  if (!target) return { ok: false, reason: 'invalid_target' };
  if (!getAllowedProxyOrigins(env).has(target.origin)) {
    return { ok: false, reason: 'target_not_allowed' };
  }
  if (MEDIA_EXTENSION_PATTERN.test(target.pathname)) {
    return { ok: false, reason: 'media_proxy_disabled', target };
  }
  return { ok: true, target };
}

function capabilitySecret(env = {}) {
  return String(env.PROXY_SIGNING_SECRET || env.PASSWORD || '');
}

function sessionSecret(env = {}) {
  return String(env.SESSION_SIGNING_SECRET || env.PROXY_SIGNING_SECRET || env.PASSWORD || '');
}

async function hmac(secret, value) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return base64Url(new Uint8Array(signature));
}

function capabilityPayload({ method, target, expiresAt, nonce }) {
  return [
    CAPABILITY_VERSION,
    String(method || '').toUpperCase(),
    target.toString(),
    String(expiresAt),
    String(nonce || ''),
  ].join('\n');
}

function safeEqual(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  if (!a || a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

export function createProxyNonce() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

export async function issueProxyCapability({ env, method = 'GET', target, now = Date.now() }) {
  const secret = capabilitySecret(env);
  if (!secret) return { ok: false, reason: 'proxy_signing_not_configured' };
  const validation = validateProxyTarget(target, env);
  if (!validation.ok) return validation;
  const normalizedMethod = String(method || '').toUpperCase();
  if (!['GET', 'HEAD'].includes(normalizedMethod)) return { ok: false, reason: 'method_not_allowed' };
  const expiresAt = now + DEFAULT_CAPABILITY_TTL_MS;
  const nonce = createProxyNonce();
  const signature = await hmac(secret, capabilityPayload({
    method: normalizedMethod,
    target: validation.target,
    expiresAt,
    nonce,
  }));
  return { ok: true, expiresAt, nonce, signature, target: validation.target };
}

export async function verifyProxyCapability({
  env,
  method,
  target,
  expiresAt,
  nonce,
  signature,
  now = Date.now(),
}) {
  const secret = capabilitySecret(env);
  if (!secret) return { ok: false, reason: 'proxy_signing_not_configured' };
  const validation = validateProxyTarget(target, env);
  if (!validation.ok) return validation;
  const normalizedMethod = String(method || '').toUpperCase();
  const expiry = Number(expiresAt);
  if (!['GET', 'HEAD'].includes(normalizedMethod)) return { ok: false, reason: 'method_not_allowed' };
  if (!Number.isSafeInteger(expiry) || expiry < now || expiry > now + MAX_CAPABILITY_TTL_MS) {
    return { ok: false, reason: 'capability_expired' };
  }
  if (!/^[A-Za-z0-9_-]{16,128}$/u.test(String(nonce || ''))) {
    return { ok: false, reason: 'invalid_nonce' };
  }
  const expected = await hmac(secret, capabilityPayload({
    method: normalizedMethod,
    target: validation.target,
    expiresAt: expiry,
    nonce,
  }));
  if (!safeEqual(expected, signature)) return { ok: false, reason: 'invalid_capability' };
  return { ok: true, target: validation.target };
}

export async function passwordMatches(value, env = {}) {
  const expected = String(env.PASSWORD || '');
  const supplied = String(value || '');
  if (!expected || !supplied) return false;
  const encoder = new TextEncoder();
  const [expectedDigest, suppliedDigest] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
    crypto.subtle.digest('SHA-256', encoder.encode(supplied)),
  ]);
  return safeEqual(base64Url(new Uint8Array(expectedDigest)), base64Url(new Uint8Array(suppliedDigest)));
}

export async function issueBrowserSession(env = {}, now = Date.now()) {
  const secret = sessionSecret(env);
  if (!secret) return null;
  const expiresAt = now + SESSION_TTL_MS;
  const nonce = createProxyNonce();
  const signature = await hmac(secret, `${SESSION_VERSION}\n${expiresAt}\n${nonce}`);
  return { token: `${expiresAt}.${nonce}.${signature}`, expiresAt };
}

export async function verifyBrowserSession(token, env = {}, now = Date.now()) {
  const secret = sessionSecret(env);
  const [expiresValue, nonce, signature, ...extra] = String(token || '').split('.');
  const expiresAt = Number(expiresValue);
  if (
    !secret
    || extra.length
    || !Number.isSafeInteger(expiresAt)
    || expiresAt < now
    || expiresAt > now + SESSION_TTL_MS
    || !/^[A-Za-z0-9_-]{16,128}$/u.test(String(nonce || ''))
  ) {
    return false;
  }
  const expected = await hmac(secret, `${SESSION_VERSION}\n${expiresAt}\n${nonce}`);
  return safeEqual(expected, signature);
}

export function readCookie(header, name) {
  const prefix = `${name}=`;
  return String(header || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length) || '';
}

export function proxyNoStoreHeaders(headers = new Headers()) {
  const next = new Headers(headers);
  next.set('Cache-Control', 'no-store');
  next.set('Access-Control-Allow-Origin', '*');
  next.set('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
  next.set('Access-Control-Allow-Headers', 'Content-Type,Accept');
  return next;
}

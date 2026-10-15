import {
  proxyNoStoreHeaders,
  validateProxyTarget,
  verifyProxyCapability,
} from '../_lib/proxy-security.js';

const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const SAFE_CONTENT_TYPE = /^(?:application\/(?:json|[^;]+\+json|xml)|text\/(?:plain|html|xml|csv))(?:;|$)/iu;

function response(body, status, contentType = 'application/json; charset=utf-8') {
  return new Response(body, {
    status,
    headers: proxyNoStoreHeaders(new Headers({ 'Content-Type': contentType })),
  });
}

function error(code, status) {
  return response(JSON.stringify({ success: false, error: code }), status);
}

function targetFromPath(pathname) {
  const encoded = String(pathname || '').replace(/^\/proxy\//u, '');
  if (!encoded) return '';
  try {
    return decodeURIComponent(encoded);
  } catch {
    return '';
  }
}

async function readBoundedBody(upstream) {
  const declared = Number(upstream.headers.get('Content-Length') || 0);
  if (declared > MAX_RESPONSE_BYTES) throw new Error('response_too_large');
  if (!upstream.body) return new Uint8Array();
  const reader = upstream.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES) throw new Error('response_too_large');
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function fetchAllowedTarget(target, request, env, fetchImpl, signal) {
  let current = target;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const upstream = await fetchImpl(current.toString(), {
      method: request.method,
      headers: {
        Accept: request.headers.get('Accept') || 'application/json,text/plain,text/html,*/*',
        'User-Agent': request.headers.get('User-Agent') || 'Liberty-Metadata-Proxy/1.0',
      },
      redirect: 'manual',
      signal,
    });
    if (![301, 302, 303, 307, 308].includes(upstream.status)) return upstream;
    if (redirectCount === MAX_REDIRECTS) throw new Error('redirect_limit');
    const location = upstream.headers.get('Location');
    const redirected = location ? new URL(location, current) : null;
    const validation = validateProxyTarget(redirected?.toString(), env);
    if (!validation.ok) throw new Error('redirect_not_allowed');
    current = validation.target;
  }
  throw new Error('redirect_limit');
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: proxyNoStoreHeaders() });
  }
  if (!['GET', 'HEAD'].includes(request.method)) return error('method_not_allowed', 405);

  const requestUrl = new URL(request.url);
  const rawTarget = targetFromPath(requestUrl.pathname);
  const targetValidation = validateProxyTarget(rawTarget, env);
  if (!targetValidation.ok) return error(targetValidation.reason, 403);

  const authorization = await verifyProxyCapability({
    env,
    method: request.method,
    target: targetValidation.target,
    expiresAt: requestUrl.searchParams.get('pxe'),
    nonce: requestUrl.searchParams.get('pxn'),
    signature: requestUrl.searchParams.get('pxs'),
  });
  if (!authorization.ok) return error(authorization.reason, 401);

  const controller = new AbortController();
  const timeoutMs = Math.min(60_000, Math.max(100, Number(env?.PROXY_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS));
  let timedOut = false;
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new Error('proxy_timeout'));
    }, timeoutMs);
  });
  const abortFromRequest = () => controller.abort(request.signal?.reason);
  if (request.signal?.aborted) abortFromRequest();
  else request.signal?.addEventListener('abort', abortFromRequest, { once: true });

  try {
    const fetchImpl = context.fetchImpl || globalThis.fetch;
    const upstream = await Promise.race([
      fetchAllowedTarget(
        authorization.target,
        request,
        env,
        fetchImpl,
        controller.signal,
      ),
      timeout,
    ]);
    if (!upstream.ok) return error('proxy_upstream_error', upstream.status);
    const contentType = upstream.headers.get('Content-Type') || 'application/octet-stream';
    if (!SAFE_CONTENT_TYPE.test(contentType)) return error('unsafe_response_type', 415);
    const body = request.method === 'HEAD' ? null : await readBoundedBody(upstream);
    const headers = proxyNoStoreHeaders(new Headers({ 'Content-Type': contentType }));
    return new Response(body, { status: upstream.status, headers });
  } catch (caught) {
    if (timedOut || caught?.message === 'proxy_timeout') return error('proxy_timeout', 504);
    if (caught?.message === 'response_too_large') return error('response_too_large', 502);
    if (caught?.message === 'redirect_not_allowed') return error('redirect_not_allowed', 403);
    return error('proxy_upstream_unavailable', 502);
  } finally {
    clearTimeout(timeoutId);
    request.signal?.removeEventListener('abort', abortFromRequest);
  }
}

export const onOptions = onRequest;

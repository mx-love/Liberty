const DEFAULT_TIMEOUT_MS = 12_000;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 60_000;
const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const SAFE_RESPONSE_CONTENT_TYPE = /^(?:application\/(?:json|[^;]+\+json)|text\/plain)(?:;|$)/iu;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
};

class DanmuUpstreamConfigError extends Error {}
class DanmuUpstreamPathError extends Error {}
class DanmuUpstreamTimeoutError extends Error {}
class DanmuBodyTooLargeError extends Error {}
class DanmuUnsafeContentTypeError extends Error {}

function withCors(headers = new Headers()) {
  const nextHeaders = new Headers(headers);
  Object.entries(CORS_HEADERS).forEach(([key, value]) => {
    nextHeaders.set(key, value);
  });
  return nextHeaders;
}

function errorResponse(error, status, extraHeaders = undefined) {
  return new Response(JSON.stringify({ success: false, error }), {
    status,
    headers: withCors(new Headers({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(extraHeaders || {}),
    })),
  });
}

function normalizedTimeout(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.trunc(parsed)));
}

function normalizeEndpointPath(path) {
  const cleanPath = String(path || '').replace(/^\/+|\/+$/g, '');
  if (!cleanPath) return '';
  const unsafe = cleanPath.split('/').some((segment) => {
    let decoded = segment;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new DanmuUpstreamPathError();
    }
    return decoded === '.' || decoded === '..' || decoded.includes('\\');
  });
  if (unsafe) throw new DanmuUpstreamPathError();
  return cleanPath;
}

export function buildDanmuUpstreamUrl(baseValue, endpointPath, search = '') {
  const rawBase = String(baseValue || '').trim();
  if (!rawBase) throw new DanmuUpstreamConfigError();

  let base;
  try {
    base = new URL(rawBase);
  } catch {
    throw new DanmuUpstreamConfigError();
  }
  if (
    !['http:', 'https:'].includes(base.protocol)
    || base.username
    || base.password
    || base.search
    || base.hash
  ) {
    throw new DanmuUpstreamConfigError();
  }

  const endpoint = normalizeEndpointPath(endpointPath);
  const basePath = base.pathname.replace(/\/+$/g, '');
  base.pathname = endpoint ? `${basePath}/${endpoint}` : (basePath || '/');
  base.search = search ? String(search) : '';
  base.hash = '';
  return base.toString();
}

function upstreamResponseHeaders(response, method) {
  const headers = new Headers();
  ['content-type', 'cache-control', 'etag', 'last-modified', 'retry-after'].forEach((name) => {
    const value = response.headers.get(name);
    if (value) headers.set(name, value);
  });
  headers.set('Cache-Control', 'no-store');
  return withCors(headers);
}

async function readBoundedBody(stream, declaredLength, maximum) {
  if (Number(declaredLength || 0) > maximum) throw new DanmuBodyTooLargeError();
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximum) throw new DanmuBodyTooLargeError();
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

function upstreamErrorResponse(response) {
  const retryAfter = response.headers.get('retry-after');
  const headers = retryAfter ? { 'Retry-After': retryAfter } : undefined;
  return errorResponse(
    response.status === 429 ? 'danmu_upstream_rate_limited' : 'danmu_upstream_error',
    response.status,
    headers,
  );
}

export async function proxyDanmuUpstream({
  request,
  env,
  path,
  fetchImpl = globalThis.fetch,
  allowedMethods = ['GET', 'POST'],
}) {
  const method = request.method.toUpperCase();
  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: withCors() });
  }
  if (!allowedMethods.includes(method)) {
    return errorResponse('method_not_allowed', 405);
  }

  const baseValue = env?.DANMU_API_BASE;
  if (!String(baseValue || '').trim()) {
    return errorResponse('danmu_upstream_not_configured', 503);
  }

  let upstreamUrl;
  try {
    const requestUrl = new URL(request.url);
    upstreamUrl = buildDanmuUpstreamUrl(baseValue, path, requestUrl.search);
  } catch (error) {
    if (error instanceof DanmuUpstreamPathError) {
      return errorResponse('danmu_upstream_invalid_path', 400);
    }
    return errorResponse('danmu_upstream_invalid_config', 500);
  }

  if (typeof fetchImpl !== 'function') {
    return errorResponse('danmu_upstream_unavailable', 502);
  }

  const controller = new AbortController();
  let timedOut = false;
  const abortFromRequest = () => controller.abort(request.signal?.reason);
  if (request.signal?.aborted) abortFromRequest();
  else request.signal?.addEventListener('abort', abortFromRequest, { once: true });

  let timeoutId;
  const timeoutMs = normalizedTimeout(env?.DANMU_PROXY_TIMEOUT_MS);
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new DanmuUpstreamTimeoutError());
    }, timeoutMs);
  });

  const headers = new Headers();
  const contentType = request.headers.get('Content-Type');
  if (contentType) headers.set('Content-Type', contentType);
  headers.set('Accept', request.headers.get('Accept') || 'application/json,text/plain,*/*');

  try {
    const upstreamResult = (async () => {
      const requestBody = ['GET', 'HEAD'].includes(method)
        ? undefined
        : await readBoundedBody(
          request.body,
          request.headers.get('Content-Length'),
          MAX_REQUEST_BYTES,
        );
      const upstream = await fetchImpl(upstreamUrl, {
        method,
        headers,
        body: requestBody,
        redirect: 'follow',
        signal: controller.signal,
      });
      if (!upstream.ok) return { upstream, body: null };
      const responseContentType = upstream.headers.get('Content-Type') || '';
      if (!SAFE_RESPONSE_CONTENT_TYPE.test(responseContentType)) {
        throw new DanmuUnsafeContentTypeError();
      }
      const body = method === 'HEAD'
        ? null
        : await readBoundedBody(
          upstream.body,
          upstream.headers.get('Content-Length'),
          MAX_RESPONSE_BYTES,
        );
      return { upstream, body };
    })();
    const { upstream, body } = await Promise.race([
      upstreamResult,
      timeout,
    ]);

    if (!upstream.ok) return upstreamErrorResponse(upstream);
    return new Response(body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: upstreamResponseHeaders(upstream, method),
    });
  } catch (error) {
    if (error instanceof DanmuBodyTooLargeError) {
      return errorResponse('danmu_upstream_body_too_large', 413);
    }
    if (error instanceof DanmuUnsafeContentTypeError) {
      return errorResponse('danmu_upstream_unsafe_content_type', 502);
    }
    if (timedOut || error instanceof DanmuUpstreamTimeoutError) {
      return errorResponse('danmu_upstream_timeout', 504);
    }
    return errorResponse('danmu_upstream_unavailable', 502);
  } finally {
    clearTimeout(timeoutId);
    request.signal?.removeEventListener('abort', abortFromRequest);
  }
}

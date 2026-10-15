import {
  issueProxyCapability,
  proxyNoStoreHeaders,
  readCookie,
  verifyBrowserSession,
} from '../_lib/proxy-security.js';

const MAX_TOKEN_REQUEST_BYTES = 8 * 1024;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: proxyNoStoreHeaders(new Headers({ 'Content-Type': 'application/json; charset=utf-8' })),
  });
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: proxyNoStoreHeaders() });
  if (request.method !== 'POST') return json({ success: false, error: 'method_not_allowed' }, 405);
  const contentLength = Number(request.headers.get('Content-Length') || 0);
  if (contentLength > MAX_TOKEN_REQUEST_BYTES) {
    return json({ success: false, error: 'request_too_large' }, 413);
  }
  const sessionToken = readCookie(request.headers.get('Cookie'), 'liberty_session');
  if (!await verifyBrowserSession(sessionToken, env)) {
    return json({ success: false, error: 'proxy_auth_required' }, 401);
  }

  let body;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_TOKEN_REQUEST_BYTES) {
      return json({ success: false, error: 'request_too_large' }, 413);
    }
    body = JSON.parse(text);
  } catch {
    return json({ success: false, error: 'invalid_request' }, 400);
  }

  const capability = await issueProxyCapability({
    env,
    method: body?.method,
    target: body?.target,
  });
  if (!capability.ok) {
    const status = capability.reason === 'proxy_signing_not_configured' ? 503 : 403;
    return json({ success: false, error: capability.reason }, status);
  }
  return json({
    success: true,
    expiresAt: capability.expiresAt,
    nonce: capability.nonce,
    signature: capability.signature,
  });
}

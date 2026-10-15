import {
  issueBrowserSession,
  passwordMatches,
  proxyNoStoreHeaders,
  readCookie,
  verifyBrowserSession,
} from '../_lib/proxy-security.js';

const COOKIE_NAME = 'liberty_session';
const MAX_REQUEST_BYTES = 1024;

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: proxyNoStoreHeaders(new Headers({
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders,
    })),
  });
}

function cookieHeader(request, token, maxAge) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: proxyNoStoreHeaders() });
  if (request.method === 'DELETE') {
    return json({ success: true }, 200, {
      'Set-Cookie': cookieHeader(request, '', 0),
    });
  }
  if (request.method === 'GET') {
    const token = readCookie(request.headers.get('Cookie'), COOKIE_NAME);
    return json({ success: true, authenticated: await verifyBrowserSession(token, env) });
  }
  if (request.method !== 'POST') return json({ success: false, error: 'method_not_allowed' }, 405);

  const contentLength = Number(request.headers.get('Content-Length') || 0);
  if (contentLength > MAX_REQUEST_BYTES) return json({ success: false, error: 'request_too_large' }, 413);
  let body;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) {
      return json({ success: false, error: 'request_too_large' }, 413);
    }
    body = JSON.parse(text);
  } catch {
    return json({ success: false, error: 'invalid_request' }, 400);
  }
  if (!await passwordMatches(body?.password, env)) {
    return json({ success: false, error: 'invalid_password' }, 401);
  }
  const session = await issueBrowserSession(env);
  if (!session) return json({ success: false, error: 'session_not_configured' }, 503);
  const maxAge = Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000));
  return json({ success: true, expiresAt: session.expiresAt }, 200, {
    'Set-Cookie': cookieHeader(request, session.token, maxAge),
  });
}

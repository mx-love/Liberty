import {
  issueBrowserSession,
  passwordMatches,
  readCookie,
  verifyBrowserSession,
} from '../../functions/_lib/proxy-security.js';

const MAX_REQUEST_BYTES = 1024;

function env() {
  return {
    PASSWORD: process.env.PASSWORD || '',
    PROXY_SIGNING_SECRET: process.env.PROXY_SIGNING_SECRET || '',
    SESSION_SIGNING_SECRET: process.env.SESSION_SIGNING_SECRET || '',
  };
}

function response(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extraHeaders },
    body: JSON.stringify(body),
  };
}

function cookie(token, maxAge) {
  return `liberty_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}; Secure`;
}

export const handler = async (event) => {
  if (event.httpMethod === 'GET') {
    const token = readCookie(event.headers?.cookie, 'liberty_session');
    return response(200, { success: true, authenticated: await verifyBrowserSession(token, env()) });
  }
  if (event.httpMethod === 'DELETE') {
    return response(200, { success: true }, { 'Set-Cookie': cookie('', 0) });
  }
  if (event.httpMethod !== 'POST') return response(405, { success: false, error: 'method_not_allowed' });
  if (Buffer.byteLength(event.body || '') > MAX_REQUEST_BYTES) {
    return response(413, { success: false, error: 'request_too_large' });
  }
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return response(400, { success: false, error: 'invalid_request' });
  }
  if (!await passwordMatches(body?.password, env())) {
    return response(401, { success: false, error: 'invalid_password' });
  }
  const session = await issueBrowserSession(env());
  if (!session) return response(503, { success: false, error: 'session_not_configured' });
  return response(200, { success: true, expiresAt: session.expiresAt }, {
    'Set-Cookie': cookie(session.token, Math.floor((session.expiresAt - Date.now()) / 1000)),
  });
};

import {
  issueProxyCapability,
  readCookie,
  verifyBrowserSession,
} from '../../functions/_lib/proxy-security.js';

const MAX_REQUEST_BYTES = 8 * 1024;

function env() {
  return {
    PASSWORD: process.env.PASSWORD || '',
    PROXY_SIGNING_SECRET: process.env.PROXY_SIGNING_SECRET || '',
    SESSION_SIGNING_SECRET: process.env.SESSION_SIGNING_SECRET || '',
    PROXY_ALLOWED_ORIGINS: process.env.PROXY_ALLOWED_ORIGINS || '',
  };
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return response(405, { success: false, error: 'method_not_allowed' });
  if (Buffer.byteLength(event.body || '') > MAX_REQUEST_BYTES) {
    return response(413, { success: false, error: 'request_too_large' });
  }
  const session = readCookie(event.headers?.cookie, 'liberty_session');
  if (!await verifyBrowserSession(session, env())) {
    return response(401, { success: false, error: 'proxy_auth_required' });
  }
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return response(400, { success: false, error: 'invalid_request' });
  }
  const capability = await issueProxyCapability({ env: env(), target: body?.target, method: body?.method });
  if (!capability.ok) {
    return response(capability.reason === 'proxy_signing_not_configured' ? 503 : 403, {
      success: false,
      error: capability.reason,
    });
  }
  return response(200, {
    success: true,
    expiresAt: capability.expiresAt,
    nonce: capability.nonce,
    signature: capability.signature,
  });
};

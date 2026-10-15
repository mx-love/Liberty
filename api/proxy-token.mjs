import {
  issueProxyCapability,
  readCookie,
  verifyBrowserSession,
} from '../functions/_lib/proxy-security.js';

const MAX_REQUEST_BYTES = 8 * 1024;

function env() {
  return {
    PASSWORD: process.env.PASSWORD || '',
    PROXY_SIGNING_SECRET: process.env.PROXY_SIGNING_SECRET || '',
    SESSION_SIGNING_SECRET: process.env.SESSION_SIGNING_SECRET || '',
    PROXY_ALLOWED_ORIGINS: process.env.PROXY_ALLOWED_ORIGINS || '',
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'method_not_allowed' });
  const serialized = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
  if (Buffer.byteLength(serialized) > MAX_REQUEST_BYTES) {
    return res.status(413).json({ success: false, error: 'request_too_large' });
  }
  const session = readCookie(req.headers.cookie, 'liberty_session');
  if (!await verifyBrowserSession(session, env())) {
    return res.status(401).json({ success: false, error: 'proxy_auth_required' });
  }
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
  } catch {
    return res.status(400).json({ success: false, error: 'invalid_request' });
  }
  const capability = await issueProxyCapability({
    env: env(),
    method: body?.method,
    target: body?.target,
  });
  if (!capability.ok) {
    return res.status(capability.reason === 'proxy_signing_not_configured' ? 503 : 403).json({
      success: false,
      error: capability.reason,
    });
  }
  return res.status(200).json({
    success: true,
    expiresAt: capability.expiresAt,
    nonce: capability.nonce,
    signature: capability.signature,
  });
}

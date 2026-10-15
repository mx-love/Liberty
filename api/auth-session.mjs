import {
  issueBrowserSession,
  passwordMatches,
  readCookie,
  verifyBrowserSession,
} from '../functions/_lib/proxy-security.js';

const MAX_REQUEST_BYTES = 1024;

function env() {
  return {
    PASSWORD: process.env.PASSWORD || '',
    PROXY_SIGNING_SECRET: process.env.PROXY_SIGNING_SECRET || '',
    SESSION_SIGNING_SECRET: process.env.SESSION_SIGNING_SECRET || '',
  };
}

function bodySize(body) {
  return Buffer.byteLength(typeof body === 'string' ? body : JSON.stringify(body || {}));
}

function cookie(token, maxAge) {
  return `liberty_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}; Secure`;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') {
    const token = readCookie(req.headers.cookie, 'liberty_session');
    return res.status(200).json({ success: true, authenticated: await verifyBrowserSession(token, env()) });
  }
  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', cookie('', 0));
    return res.status(200).json({ success: true });
  }
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'method_not_allowed' });
  if (bodySize(req.body) > MAX_REQUEST_BYTES) {
    return res.status(413).json({ success: false, error: 'request_too_large' });
  }
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
  } catch {
    return res.status(400).json({ success: false, error: 'invalid_request' });
  }
  if (!await passwordMatches(body?.password, env())) {
    return res.status(401).json({ success: false, error: 'invalid_password' });
  }
  const session = await issueBrowserSession(env());
  if (!session) return res.status(503).json({ success: false, error: 'session_not_configured' });
  res.setHeader('Set-Cookie', cookie(session.token, Math.floor((session.expiresAt - Date.now()) / 1000)));
  return res.status(200).json({ success: true, expiresAt: session.expiresAt });
}

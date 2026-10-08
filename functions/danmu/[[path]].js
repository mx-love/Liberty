import { proxyDanmuUpstream } from '../_lib/danmu-proxy.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, User-Agent, Accept',
};

function corsHeaders(extra = {}) {
  return new Headers({ ...CORS_HEADERS, ...extra });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders({ 'Content-Type': 'application/json; charset=utf-8' }),
  });
}

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function validateAuth(request, env) {
  const url = new URL(request.url);
  const auth = url.searchParams.get('auth');
  const t = url.searchParams.get('t');

  if (!env.PASSWORD) return false;
  if (!auth) return false;

  const serverHash = await sha256(env.PASSWORD);
  if (auth !== serverHash) return false;

  if (t) {
    const diff = Math.abs(Date.now() - Number(t));
    if (!Number.isFinite(diff) || diff > 10 * 60 * 1000) return false;
  }

  return true;
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (!(await validateAuth(request, env))) {
    return json({ success: false, error: 'danmu unauthorized' }, 401);
  }

  const url = new URL(request.url);
  const apiPath = url.pathname.replace(/^\/danmu\/?/, '');

  url.searchParams.delete('auth');
  url.searchParams.delete('t');
  return proxyDanmuUpstream({
    request: new Request(url, request),
    env,
    path: apiPath,
    allowedMethods: ['GET', 'HEAD', 'POST'],
  });
}

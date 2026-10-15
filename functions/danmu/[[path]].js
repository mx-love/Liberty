import { proxyDanmuUpstream } from '../_lib/danmu-proxy.js';
import { readCookie, verifyBrowserSession } from '../_lib/proxy-security.js';

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

async function validateAuth(request, env) {
  const token = readCookie(request.headers.get('Cookie'), 'liberty_session');
  return verifyBrowserSession(token, env);
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

  return proxyDanmuUpstream({
    request: new Request(url, request),
    env,
    path: apiPath,
    allowedMethods: ['GET', 'HEAD', 'POST'],
  });
}

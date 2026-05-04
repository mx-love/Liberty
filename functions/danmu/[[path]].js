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

function buildUpstreamHeaders(request, base) {
  const headers = new Headers();

  headers.set('User-Agent', request.headers.get('User-Agent') || 'Mozilla/5.0');
  headers.set('Accept', request.headers.get('Accept') || 'application/json,text/plain,*/*');
  headers.set('Referer', new URL(base).origin);

  const contentType = request.headers.get('Content-Type');
  if (contentType) {
    headers.set('Content-Type', contentType);
  }

  return headers;
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (!(await validateAuth(request, env))) {
    return json({ success: false, error: 'danmu unauthorized' }, 401);
  }

  const base = (env.DANMU_API_BASE || '').replace(/\/+$/, '');
  if (!base) {
    return json({ success: false, error: 'DANMU_API_BASE is not set' }, 500);
  }

  const url = new URL(request.url);
  const apiPath = url.pathname.replace(/^\/danmu\/?/, '');

  url.searchParams.delete('auth');
  url.searchParams.delete('t');

  const targetUrl = `${base}/${apiPath}${url.search}`;

  try {
    const method = request.method.toUpperCase();
    const hasBody = !['GET', 'HEAD'].includes(method);

    const upstream = await fetch(targetUrl, {
      method,
      headers: buildUpstreamHeaders(request, base),
      body: hasBody ? request.body : undefined,
      redirect: 'follow',
    });

    const contentType = upstream.headers.get('Content-Type') || 'application/json; charset=utf-8';

    return new Response(upstream.body, {
      status: upstream.status,
      headers: corsHeaders({
        'Content-Type': contentType,
        'Cache-Control': method === 'GET' ? 'public, max-age=300' : 'no-store',
      }),
    });
  } catch (err) {
    return json({ success: false, error: err.message || 'danmu proxy failed' }, 502);
  }
}

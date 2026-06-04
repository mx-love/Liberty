const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

function withCors(headers = new Headers()) {
  const nextHeaders = new Headers(headers);
  Object.entries(CORS_HEADERS).forEach(([key, value]) => {
    nextHeaders.set(key, value);
  });
  return nextHeaders;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: withCors(new Headers({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    })),
  });
}

function joinDanmuUrl(baseUrl, path, search) {
  const cleanBase = String(baseUrl || '').trim().replace(/\/+$/, '');
  const cleanPath = String(path || '').replace(/^\/+/, '');
  const query = search || '';
  return cleanPath ? `${cleanBase}/${cleanPath}${query}` : `${cleanBase}${query}`;
}

function getRequestPath(params) {
  const path = params?.path;
  if (Array.isArray(path)) return path.join('/');
  return path || '';
}

function buildUpstreamHeaders(request) {
  const headers = new Headers();
  const contentType = request.headers.get('Content-Type');
  const accept = request.headers.get('Accept');

  if (contentType) headers.set('Content-Type', contentType);
  headers.set('Accept', accept || 'application/json,text/plain,*/*');

  return headers;
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const method = request.method.toUpperCase();

  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: withCors(),
    });
  }

  if (!['GET', 'POST'].includes(method)) {
    return jsonResponse(
      { success: false, message: 'Method not allowed' },
      405
    );
  }

  const baseUrl = env?.DANMU_API_BASE;
  if (!baseUrl) {
    return jsonResponse(
      { success: false, message: 'DANMU_API_BASE is not configured' },
      503
    );
  }

  const url = new URL(request.url);
  const upstreamUrl = joinDanmuUrl(baseUrl, getRequestPath(params), url.search);

  const init = {
    method,
    headers: buildUpstreamHeaders(request),
    redirect: 'follow',
  };

  if (method !== 'GET') {
    init.body = request.body;
  }

  try {
    const upstream = await fetch(upstreamUrl, init);
    const responseHeaders = withCors(upstream.headers);

    if (method === 'POST') {
      responseHeaders.set('Cache-Control', 'no-store');
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    return jsonResponse(
      {
        success: false,
        message: 'Failed to proxy danmu request',
        error: error?.message || String(error),
      },
      502
    );
  }
}

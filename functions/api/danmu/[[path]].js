import { proxyDanmuUpstream } from '../../_lib/danmu-proxy.js';

function getRequestPath(params) {
  const path = params?.path;
  if (Array.isArray(path)) return path.join('/');
  return path || '';
}

export async function onRequest(context) {
  return proxyDanmuUpstream({
    request: context.request,
    env: context.env,
    path: getRequestPath(context.params),
    allowedMethods: ['GET', 'POST'],
  });
}

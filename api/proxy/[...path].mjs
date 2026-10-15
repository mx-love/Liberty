import { onRequest as proxyRequest } from '../../functions/proxy/[[path]].js';

function proxyEnv() {
  return {
    PASSWORD: process.env.PASSWORD || '',
    PROXY_SIGNING_SECRET: process.env.PROXY_SIGNING_SECRET || '',
    SESSION_SIGNING_SECRET: process.env.SESSION_SIGNING_SECRET || '',
    PROXY_ALLOWED_ORIGINS: process.env.PROXY_ALLOWED_ORIGINS || '',
    PROXY_TIMEOUT_MS: process.env.PROXY_TIMEOUT_MS || '',
  };
}

function targetFromRequest(req) {
  const value = Array.isArray(req.query?.path) ? req.query.path.join('/') : req.query?.path;
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
}

export default async function handler(req, res) {
  const target = targetFromRequest(req);
  const url = new URL(`/proxy/${encodeURIComponent(target)}`, 'https://liberty.local');
  for (const key of ['pxe', 'pxn', 'pxs']) {
    if (typeof req.query?.[key] === 'string') url.searchParams.set(key, req.query[key]);
  }
  const request = new Request(url, {
    method: req.method,
    headers: {
      Accept: req.headers.accept || '',
      'User-Agent': req.headers['user-agent'] || '',
    },
  });
  const response = await proxyRequest({ request, env: proxyEnv(), fetchImpl: fetch });
  res.status(response.status);
  response.headers.forEach((value, key) => res.setHeader(key, value));
  if (req.method === 'HEAD' || response.body === null) return res.end();
  return res.send(Buffer.from(await response.arrayBuffer()));
}

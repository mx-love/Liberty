import { onRequest as proxyRequest } from '../../functions/proxy/[[path]].js';

function env() {
  return {
    PASSWORD: process.env.PASSWORD || '',
    PROXY_SIGNING_SECRET: process.env.PROXY_SIGNING_SECRET || '',
    SESSION_SIGNING_SECRET: process.env.SESSION_SIGNING_SECRET || '',
    PROXY_ALLOWED_ORIGINS: process.env.PROXY_ALLOWED_ORIGINS || '',
    PROXY_TIMEOUT_MS: process.env.PROXY_TIMEOUT_MS || '',
  };
}

function targetFromEvent(event) {
  const path = String(event.path || '');
  const prefixes = ['/proxy/', '/.netlify/functions/proxy/'];
  const prefix = prefixes.find((entry) => path.startsWith(entry));
  const encoded = prefix ? path.slice(prefix.length) : '';
  try {
    return decodeURIComponent(encoded);
  } catch {
    return '';
  }
}

export const handler = async (event) => {
  const target = targetFromEvent(event);
  const url = new URL(`/proxy/${encodeURIComponent(target)}`, 'https://liberty.local');
  for (const key of ['pxe', 'pxn', 'pxs']) {
    const value = event.queryStringParameters?.[key];
    if (value) url.searchParams.set(key, value);
  }
  const request = new Request(url, {
    method: event.httpMethod,
    headers: {
      Accept: event.headers?.accept || '',
      'User-Agent': event.headers?.['user-agent'] || '',
    },
  });
  const response = await proxyRequest({ request, env: env(), fetchImpl: fetch });
  const headers = Object.fromEntries(response.headers.entries());
  const body = event.httpMethod === 'HEAD' || response.body === null
    ? ''
    : Buffer.from(await response.arrayBuffer()).toString('base64');
  return {
    statusCode: response.status,
    headers,
    body,
    isBase64Encoded: Boolean(body),
  };
};

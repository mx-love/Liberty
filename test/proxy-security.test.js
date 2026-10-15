import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { onRequest as authSession } from '../functions/api/auth-session.js';
import { onRequest as issueToken } from '../functions/api/proxy-token.js';
import {
  issueProxyCapability,
  verifyProxyCapability,
} from '../functions/_lib/proxy-security.js';
import { onRequest as proxyRequest } from '../functions/proxy/[[path]].js';

const PASSWORD = 'example-password';
const PASSWORD_HASH = createHash('sha256').update(PASSWORD).digest('hex');
const SIGNING_SECRET = 'example-proxy-signing-secret-with-sufficient-entropy';
const ALLOWED_ORIGIN = 'https://metadata.example.test';
const ENV = {
  PASSWORD,
  PROXY_SIGNING_SECRET: SIGNING_SECRET,
  SESSION_SIGNING_SECRET: 'example-session-signing-secret-with-sufficient-entropy',
  PROXY_ALLOWED_ORIGINS: ALLOWED_ORIGIN,
};

async function login(env = ENV) {
  const response = await authSession({
    env,
    request: new Request('https://liberty.example.test/api/auth-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: env.PASSWORD }),
    }),
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/u);
  assert.match(cookie, /SameSite=Strict/u);
  return cookie.split(';', 1)[0];
}

async function capability(target, method = 'GET', env = ENV) {
  const cookie = await login(env);
  const response = await issueToken({
    env,
    request: new Request('https://liberty.example.test/api/proxy-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      body: JSON.stringify({ target, method }),
    }),
  });
  assert.equal(response.status, 200);
  return response.json();
}

function proxyUrl(target, token) {
  const url = new URL(`https://liberty.example.test/proxy/${encodeURIComponent(target)}`);
  url.searchParams.set('pxe', String(token.expiresAt));
  url.searchParams.set('pxn', token.nonce);
  url.searchParams.set('pxs', token.signature);
  return url.toString();
}

async function callProxy({
  target = `${ALLOWED_ORIGIN}/api.php/provide/vod?ac=videolist`,
  method = 'GET',
  token,
  env = ENV,
  fetchImpl = async () => Response.json({ list: [] }),
} = {}) {
  const issued = token || await capability(target, method, env);
  return proxyRequest({
    env,
    fetchImpl,
    request: new Request(proxyUrl(target, issued), { method }),
  });
}

test('generic proxy rejects an arbitrary target before fetching', async () => {
  let fetched = false;
  const response = await proxyRequest({
    env: ENV,
    fetchImpl: async () => {
      fetched = true;
      return Response.json({});
    },
    request: new Request(`https://liberty.example.test/proxy/${encodeURIComponent('https://attacker.example/private')}`),
  });
  assert.equal(response.status, 403);
  assert.equal(fetched, false);
  assert.match(await response.text(), /target_not_allowed/u);
});

test('configured metadata target is allowed with a target-bound capability', async () => {
  let fetchedUrl = '';
  const response = await callProxy({
    fetchImpl: async (url) => {
      fetchedUrl = String(url);
      return Response.json({ list: [{ vod_id: 1 }] });
    },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(fetchedUrl, `${ALLOWED_ORIGIN}/api.php/provide/vod?ac=videolist`);
  assert.deepEqual(await response.json(), { list: [{ vod_id: 1 }] });
});

test('legacy permanent password-hash bearer is no longer accepted', async () => {
  const response = await issueToken({
    env: ENV,
    request: new Request('https://liberty.example.test/api/proxy-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Liberty-Auth': PASSWORD_HASH },
      body: JSON.stringify({ target: `${ALLOWED_ORIGIN}/api`, method: 'GET' }),
    }),
  });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('expired proxy capability is rejected', async () => {
  const target = `${ALLOWED_ORIGIN}/api`;
  const issued = await issueProxyCapability({ env: ENV, target, method: 'GET', now: Date.now() - 180_000 });
  const result = await verifyProxyCapability({
    env: ENV,
    target,
    method: 'GET',
    expiresAt: issued.expiresAt,
    nonce: issued.nonce,
    signature: issued.signature,
  });
  assert.deepEqual({ ok: result.ok, reason: result.reason }, { ok: false, reason: 'capability_expired' });
});

test('method mismatch invalidates a proxy capability', async () => {
  const target = `${ALLOWED_ORIGIN}/api`;
  const issued = await capability(target, 'GET');
  const response = await callProxy({ target, token: issued, method: 'HEAD' });
  assert.equal(response.status, 401);
  assert.match(await response.text(), /invalid_capability/u);
});

test('target mismatch invalidates a proxy capability', async () => {
  const first = `${ALLOWED_ORIGIN}/first`;
  const second = `${ALLOWED_ORIGIN}/second`;
  const issued = await capability(first);
  const response = await callProxy({ target: second, token: issued });
  assert.equal(response.status, 401);
  assert.match(await response.text(), /invalid_capability/u);
});

test('proxy timeout is bounded and redacted', async () => {
  const response = await callProxy({
    env: { ...ENV, PROXY_TIMEOUT_MS: 100 },
    fetchImpl: async () => new Promise(() => {}),
  });
  assert.equal(response.status, 504);
  assert.deepEqual(await response.json(), { success: false, error: 'proxy_timeout' });
});

test('oversized token request is rejected', async () => {
  const cookie = await login();
  const response = await issueToken({
    env: ENV,
    request: new Request('https://liberty.example.test/api/proxy-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ target: `${ALLOWED_ORIGIN}/${'x'.repeat(9000)}`, method: 'GET' }),
    }),
  });
  assert.equal(response.status, 413);
});

test('oversized upstream response is rejected without buffering it', async () => {
  const response = await callProxy({
    fetchImpl: async () => new Response('small', {
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(6 * 1024 * 1024),
      },
    }),
  });
  assert.equal(response.status, 502);
  assert.match(await response.text(), /response_too_large/u);
});

test('unsafe upstream content type is rejected', async () => {
  const response = await callProxy({
    fetchImpl: async () => new Response(new Uint8Array([0, 1, 2]), {
      headers: { 'Content-Type': 'application/octet-stream' },
    }),
  });
  assert.equal(response.status, 415);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('target secrets are absent from proxy errors', async () => {
  const target = `${ALLOWED_ORIGIN}/api?token=top-secret-value`;
  const response = await callProxy({
    target,
    fetchImpl: async () => {
      throw new Error(`failed ${target}`);
    },
  });
  const body = await response.text();
  assert.equal(response.status, 502);
  assert.doesNotMatch(body, /top-secret-value|metadata\.example\.test/u);
});

test('redirect to a non-allowlisted origin is rejected', async () => {
  const response = await callProxy({
    fetchImpl: async () => new Response(null, {
      status: 302,
      headers: { Location: 'http://127.0.0.1/private' },
    }),
  });
  assert.equal(response.status, 403);
  assert.match(await response.text(), /redirect_not_allowed/u);
});

test('signed manifests and media segments are refused with no-store', async () => {
  for (const target of [
    `${ALLOWED_ORIGIN}/video/master.m3u8?signature=secret`,
    `${ALLOWED_ORIGIN}/video/segment.ts?token=secret`,
    `${ALLOWED_ORIGIN}/video/segment.m4s?token=secret`,
  ]) {
    const response = await proxyRequest({
      env: ENV,
      request: new Request(`https://liberty.example.test/proxy/${encodeURIComponent(target)}`),
    });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(await response.text(), /media_proxy_disabled/u);
  }
});

test('browser proxy auth uses capability parameters rather than password hash query auth', () => {
  const source = readFileSync(new URL('../js/proxy-auth.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /[?&]auth=|searchParams\.set\(['"]auth/u);
  assert.doesNotMatch(source, /X-Liberty-Auth|passwordHash/u);
  assert.match(source, /\/api\/proxy-token/u);
  assert.match(source, /searchParams\.set\('pxs'/u);
});

test('DANMU_API_BASE and real tokens are absent from browser proxy code', () => {
  const source = readFileSync(new URL('../js/proxy-auth.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /DANMU_API_BASE|example-token|Authorization:\s*Bearer/u);

  const deploymentAdapters = [
    readFileSync(new URL('../api/proxy/[...path].mjs', import.meta.url), 'utf8'),
    readFileSync(new URL('../netlify/functions/proxy.mjs', import.meta.url), 'utf8'),
  ].join('\n');
  assert.match(deploymentAdapters, /functions\/proxy/u);
  assert.doesNotMatch(deploymentAdapters, /authHash|serverPasswordHash|processM3u8|CACHE_TTL/u);
});

async function assertRejectedTarget(target, env = ENV) {
  let fetched = false;
  const response = await proxyRequest({
    env,
    fetchImpl: async () => {
      fetched = true;
      return Response.json({});
    },
    request: new Request(`https://liberty.example.test/proxy/${encodeURIComponent(target)}`),
  });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(fetched, false);
}

test('built-in AppleCMS metadata origin is authorized server-side', async () => {
  const target = 'https://caiji.dyttzyapi.com/api.php/provide/vod?ac=videolist';
  const response = await callProxy({ target, fetchImpl: async () => Response.json({ list: [] }) });
  assert.equal(response.status, 200);
});

test('Douban metadata origin is authorized server-side', async () => {
  const target = 'https://movie.douban.com/j/search_subjects?type=movie';
  const response = await callProxy({ target, fetchImpl: async () => Response.json({ subjects: [] }) });
  assert.equal(response.status, 200);
});

test('authenticated browser session is HttpOnly and SameSite strict', async () => {
  const cookie = await login();
  assert.match(cookie, /^liberty_session=/u);
});

test('localhost proxy target is rejected', async () => {
  await assertRejectedTarget('http://localhost/api', { ...ENV, PROXY_ALLOWED_ORIGINS: 'http://localhost' });
});

test('IPv4 loopback proxy target is rejected', async () => {
  await assertRejectedTarget('http://127.0.0.1/api', { ...ENV, PROXY_ALLOWED_ORIGINS: 'http://127.0.0.1' });
});

test('IPv6 loopback proxy target is rejected', async () => {
  await assertRejectedTarget('http://[::1]/api', { ...ENV, PROXY_ALLOWED_ORIGINS: 'http://[::1]' });
});

test('192.168 private proxy target is rejected', async () => {
  await assertRejectedTarget('http://192.168.1.2/api', { ...ENV, PROXY_ALLOWED_ORIGINS: 'http://192.168.1.2' });
});

test('10/8 private proxy target is rejected', async () => {
  await assertRejectedTarget('http://10.2.3.4/api', { ...ENV, PROXY_ALLOWED_ORIGINS: 'http://10.2.3.4' });
});

test('172.16-31 private proxy target is rejected', async () => {
  await assertRejectedTarget('http://172.31.2.3/api', { ...ENV, PROXY_ALLOWED_ORIGINS: 'http://172.31.2.3' });
});

test('link-local metadata proxy target is rejected', async () => {
  await assertRejectedTarget('http://169.254.169.254/latest/meta-data', {
    ...ENV,
    PROXY_ALLOWED_ORIGINS: 'http://169.254.169.254',
  });
});

test('non-http proxy target is rejected', async () => {
  await assertRejectedTarget('file:///etc/passwd');
});

test('tampered capability is rejected', async () => {
  const target = `${ALLOWED_ORIGIN}/api`;
  const issued = await capability(target);
  issued.signature = `${issued.signature.slice(0, -1)}${issued.signature.endsWith('A') ? 'B' : 'A'}`;
  const response = await callProxy({ target, token: issued });
  assert.equal(response.status, 401);
  assert.match(await response.text(), /invalid_capability/u);
});

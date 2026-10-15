import assert from 'node:assert/strict';
import test from 'node:test';

import { issueBrowserSession } from '../functions/_lib/proxy-security.js';
import {
  buildDanmuUpstreamUrl,
  proxyDanmuUpstream,
} from '../functions/_lib/danmu-proxy.js';
import { onRequest as onApiDanmuRequest } from '../functions/api/danmu/[[path]].js';
import { onRequest as onLegacyDanmuRequest } from '../functions/danmu/[[path]].js';

const EXAMPLE_BASE = 'https://example.test/example-token';

function request(path = '/api/danmu/api/v2/search/anime?keyword=test', init = {}) {
  return new Request(`https://liberty.example.test${path}`, init);
}

function context(overrides = {}) {
  return {
    request: request(),
    env: { DANMU_API_BASE: EXAMPLE_BASE },
    params: { path: ['api', 'v2', 'search', 'anime'] },
    ...overrides,
  };
}

async function bodyJson(response) {
  return JSON.parse(await response.text());
}

test('TOKEN route is preserved for every slash combination', () => {
  for (const base of [EXAMPLE_BASE, `${EXAMPLE_BASE}/`]) {
    for (const endpoint of ['api/v2/search/anime', '/api/v2/search/anime']) {
      assert.equal(
        buildDanmuUpstreamUrl(base, endpoint),
        'https://example.test/example-token/api/v2/search/anime',
      );
    }
  }
});

test('production /api/danmu proxy preserves TOKEN route and query', async () => {
  let calledUrl = '';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
      calledUrl = String(url);
      return Response.json({ animes: [] });
  };
  try {
    const response = await onApiDanmuRequest(context());
    assert.equal(response.status, 200);
    assert.equal(
      calledUrl,
      'https://example.test/example-token/api/v2/search/anime?keyword=test',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('legacy /danmu route uses an HttpOnly session and preserves the upstream TOKEN route', async () => {
  const password = 'test-password';
  const session = await issueBrowserSession({ PASSWORD: password });
  let calledUrl = '';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calledUrl = String(url);
    return Response.json({ animes: [] });
  };
  try {
    const response = await onLegacyDanmuRequest({
      request: request('/danmu/api/v2/search/anime?keyword=test', {
        headers: { Cookie: `liberty_session=${session.token}` },
      }),
      env: { DANMU_API_BASE: EXAMPLE_BASE, PASSWORD: password },
    });
    assert.equal(response.status, 200);
    assert.equal(
      calledUrl,
      'https://example.test/example-token/api/v2/search/anime?keyword=test',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('legacy /danmu route rejects the removed password-hash query bearer', async () => {
  const response = await onLegacyDanmuRequest({
    request: request(`/danmu/api/v2/search/anime?auth=${'0'.repeat(64)}&t=${Date.now()}`),
    env: { DANMU_API_BASE: EXAMPLE_BASE, PASSWORD: 'test-password' },
  });
  assert.equal(response.status, 401);
  assert.match(await response.text(), /danmu unauthorized/u);
});

test('missing DANMU_API_BASE returns a precise 503', async () => {
  const response = await onApiDanmuRequest(context({ env: {} }));
  assert.equal(response.status, 503);
  assert.deepEqual(await bodyJson(response), {
    success: false,
    error: 'danmu_upstream_not_configured',
  });
});

test('invalid upstream config returns a redacted 500', async () => {
  const response = await proxyDanmuUpstream({
    request: request(),
    env: { DANMU_API_BASE: 'not-a-url/example-token' },
    path: '/api/v2/search/anime',
  });
  assert.equal(response.status, 500);
  const body = await response.text();
  assert.match(body, /danmu_upstream_invalid_config/u);
  assert.doesNotMatch(body, /example-token|not-a-url/u);
});

test('unreachable upstream returns a redacted 502', async () => {
  const response = await proxyDanmuUpstream({
    request: request(),
    env: { DANMU_API_BASE: EXAMPLE_BASE },
    path: '/api/v2/search/anime',
    fetchImpl: async () => {
      throw new Error(`connection failed for ${EXAMPLE_BASE}/api/v2/search/anime`);
    },
  });
  assert.equal(response.status, 502);
  const body = await response.text();
  assert.match(body, /danmu_upstream_unavailable/u);
  assert.doesNotMatch(body, /example-token|https:\/\/example\.test/u);
});

test('upstream timeout returns a precise redacted 504', async () => {
  const response = await proxyDanmuUpstream({
    request: request(),
    env: {
      DANMU_API_BASE: EXAMPLE_BASE,
      DANMU_PROXY_TIMEOUT_MS: 5,
    },
    path: '/api/v2/search/anime',
    fetchImpl: async () => new Promise(() => {}),
  });
  assert.equal(response.status, 504);
  assert.deepEqual(await bodyJson(response), {
    success: false,
    error: 'danmu_upstream_timeout',
  });
});

test('upstream 429 status is preserved without echoing its body', async () => {
  const response = await proxyDanmuUpstream({
    request: request(),
    env: { DANMU_API_BASE: EXAMPLE_BASE },
    path: '/api/v2/comment/example-episode',
    fetchImpl: async () => new Response(
      `rate limited at ${EXAMPLE_BASE}/api/v2/comment/example-episode`,
      { status: 429, headers: { 'Retry-After': '9' } },
    ),
  });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '9');
  const body = await response.text();
  assert.match(body, /danmu_upstream_rate_limited/u);
  assert.doesNotMatch(body, /example-token|https:\/\/example\.test/u);
});

test('unsafe endpoint traversal cannot escape the TOKEN route', async () => {
  const response = await proxyDanmuUpstream({
    request: request(),
    env: { DANMU_API_BASE: EXAMPLE_BASE },
    path: '/api/v2/../../logs',
    fetchImpl: async () => {
      assert.fail('unsafe path must not reach fetch');
    },
  });
  assert.equal(response.status, 400);
  assert.match(await response.text(), /danmu_upstream_invalid_path/u);
});

test('oversized danmu request body is rejected before upstream fetch', async () => {
  let fetched = false;
  const response = await proxyDanmuUpstream({
    request: request('/api/danmu/api/v2/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: 'x'.repeat(300 * 1024) }),
    }),
    env: { DANMU_API_BASE: EXAMPLE_BASE },
    path: '/api/v2/match',
    fetchImpl: async () => {
      fetched = true;
      return Response.json({});
    },
  });
  assert.equal(response.status, 413);
  assert.equal(fetched, false);
  assert.match(await response.text(), /danmu_upstream_body_too_large/u);
});

test('oversized danmu upstream response is rejected', async () => {
  const response = await proxyDanmuUpstream({
    request: request(),
    env: { DANMU_API_BASE: EXAMPLE_BASE },
    path: '/api/v2/search/anime',
    fetchImpl: async () => new Response('{}', {
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(9 * 1024 * 1024),
      },
    }),
  });
  assert.equal(response.status, 413);
  assert.match(await response.text(), /danmu_upstream_body_too_large/u);
});

test('danmu proxy rejects unsafe response types and never caches successful metadata', async () => {
  const unsafe = await proxyDanmuUpstream({
    request: request(),
    env: { DANMU_API_BASE: EXAMPLE_BASE },
    path: '/api/v2/search/anime',
    fetchImpl: async () => new Response(new Uint8Array([0, 1]), {
      headers: { 'Content-Type': 'application/octet-stream' },
    }),
  });
  assert.equal(unsafe.status, 502);
  assert.match(await unsafe.text(), /danmu_upstream_unsafe_content_type/u);

  const safe = await proxyDanmuUpstream({
    request: request(),
    env: { DANMU_API_BASE: EXAMPLE_BASE },
    path: '/api/v2/search/anime',
    fetchImpl: async () => Response.json({ animes: [] }),
  });
  assert.equal(safe.status, 200);
  assert.equal(safe.headers.get('cache-control'), 'no-store');
});

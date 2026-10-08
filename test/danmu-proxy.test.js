import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

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

test('legacy /danmu route uses the shared TOKEN-preserving proxy without forwarding auth', async () => {
  const password = 'test-password';
  const auth = createHash('sha256').update(password).digest('hex');
  let calledUrl = '';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calledUrl = String(url);
    return Response.json({ animes: [] });
  };
  try {
    const response = await onLegacyDanmuRequest({
      request: request(`/danmu/api/v2/search/anime?keyword=test&auth=${auth}&t=${Date.now()}`),
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

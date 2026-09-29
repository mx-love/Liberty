import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

function harness() {
    const handlers = {}; const stores = new Map(); const requests = [];
    const response = (body, ok = true, type = 'basic') => ({ body, ok, type, clone() { return this; } });
    const state = { response: response('new') };
    const key = value => typeof value === 'string' ? value : value.url;
    const caches = {
        async keys() { return [...stores.keys()]; }, async delete(name) { return stores.delete(name); },
        async open(name) {
            if (!stores.has(name)) stores.set(name, new Map());
            const store = stores.get(name);
            return { match: async r => store.get(key(r)), put: async (r, value) => store.set(key(r), value),
                keys: async () => [...store.keys()], delete: async r => store.delete(key(r)) };
        },
    };
    const context = vm.createContext({ URL, Set, caches,
        fetch: async (request, options) => { requests.push({ request, options }); if (state.response instanceof Error) throw state.response; return state.response; },
        self: { location: { origin: 'https://liberty.test' }, addEventListener: (name, fn) => { handlers[name] = fn; }, skipWaiting: async () => {}, clients: { claim: async () => {} } },
    });
    vm.runInContext(readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8'), context);
    return { handlers, stores, requests, caches, state, response,
        async request(path, destination = 'script', method = 'GET') {
            let result; const waits = [];
            handlers.fetch({ request: { url: new URL(path, 'https://liberty.test').href, method, destination },
                respondWith(p) { result = p; }, waitUntil(p) { waits.push(p); } });
            const value = await result; await Promise.all(waits); return value;
        },
    };
}

test('SW bypasses navigation, API, proxy, signed URLs and all same/cross-origin media', async () => {
    const h = harness();
    for (const path of ['/index.html', '/api/data.js', '/proxy/segment.js', '/x.js?token=secret', '/x.js?signature=x', '/x.js?expires=1',
        '/a.m3u8', '/a.ts', '/a.m4s', '/a.mp4', '/a.webm', '/a.mkv', 'https://cdn.test/a.js']) {
        assert.equal(await h.request(path), undefined, path);
    }
    assert.equal(await h.request('/js/player.js', 'document'), undefined);
    assert.equal(h.requests.length, 0);
});

test('SW stale-while-revalidate serves old once, revalidates HTTP cache, then serves new JS', async () => {
    const h = harness();
    const cache = await h.caches.open('libretv-static-player-stability-v1');
    await cache.put('https://liberty.test/js/player.js', h.response('old'));
    assert.equal((await h.request('/js/player.js')).body, 'old');
    assert.equal(h.requests[0].options.cache, 'no-cache');
    assert.equal((await h.request('/js/player.js')).body, 'new');
});

test('SW never caches failed or opaque responses and preserves known good cache offline', async () => {
    const h = harness();
    for (const response of [h.response('error', false), h.response('opaque', true, 'opaque')]) {
        h.state.response = response;
        await h.request('/js/player.js');
        assert.equal([...(h.stores.values())][0].size, 0);
    }
    h.state.response = h.response('good'); await h.request('/js/player.js');
    h.state.response = new Error('offline');
    assert.equal((await h.request('/js/player.js')).body, 'good');
});

test('SW activation removes old Liberty caches without deleting unrelated caches', async () => {
    const h = harness();
    await h.caches.open('libretv-static-old'); await h.caches.open('other-app');
    await h.caches.open('libretv-static-player-stability-v1');
    let completed;
    h.handlers.activate({ waitUntil(p) { completed = p; } }); await completed;
    assert.equal(h.stores.has('libretv-static-old'), false);
    assert.equal(h.stores.has('other-app'), true);
});

test('SW static cache stays bounded at 160 entries', async () => {
    const h = harness();
    for (let i = 0; i < 163; i += 1) await h.request(`/icon${i}.png`, 'image');
    assert.equal([...(h.stores.values())][0].size, 160);
});

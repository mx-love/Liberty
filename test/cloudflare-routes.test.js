import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const routes = JSON.parse(readFileSync(new URL('../_routes.json', import.meta.url), 'utf8'));

function matches(pattern, path) {
    if (pattern.endsWith('*')) return path.startsWith(pattern.slice(0, -1));
    return path === pattern;
}

function invokesFunctions(path) {
    const included = routes.include.some((pattern) => matches(pattern, path));
    const excluded = routes.exclude.some((pattern) => matches(pattern, path));
    return included && !excluded;
}

test('_routes.json uses the Cloudflare Pages version 1 structure', () => {
    assert.equal(routes.version, 1);
    assert.ok(Array.isArray(routes.include));
    assert.ok(Array.isArray(routes.exclude));
    assert.ok(routes.include.length > 0);
    assert.ok(routes.include.length + routes.exclude.length <= 100);
    assert.deepEqual(routes.include, ['/*']);
});

test('Functions API, proxy, danmu, and watch paths remain routed through Functions', () => {
    for (const path of [
        '/api/auth-session',
        '/api/proxy-token',
        '/api/danmu/match',
        '/api/watch/room',
        '/proxy/example',
        '/danmu/api/v2/comment/1',
    ]) {
        assert.equal(invokesFunctions(path), true, `${path} must invoke Functions`);
    }
});

test('HTML navigation remains behind root middleware', () => {
    for (const path of ['/', '/index.html', '/player.html', '/about.html', '/watch.html']) {
        assert.equal(invokesFunctions(path), true, `${path} must retain middleware`);
    }
});

test('versioned static assets bypass Functions', () => {
    for (const path of [
        '/js/player.js',
        '/js/liberty-core.js',
        '/js/liberty-core.js.map',
        '/css/style.css',
        '/libs/hls.min.js',
        '/image/logo.png',
        '/manifest.json',
        '/robots.txt',
        '/service-worker.js',
        '/version.json',
        '/VERSION.txt',
    ]) {
        assert.equal(invokesFunctions(path), false, `${path} should bypass Functions`);
    }
});

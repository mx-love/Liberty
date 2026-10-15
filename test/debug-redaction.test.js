import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const configSource = readFileSync(new URL('../js/config.js', import.meta.url), 'utf8');

function createDebugHarness({ enabled = false, search = '' } = {}) {
    const entries = [];
    const storage = new Map(enabled ? [['LIBRETV_DEBUG', '1']] : []);
    const context = vm.createContext({
        URL,
        URLSearchParams,
        console: {
            log: (...args) => entries.push(['log', ...args]),
            warn: (...args) => entries.push(['warn', ...args]),
            trace: (...args) => entries.push(['trace', ...args]),
        },
        localStorage: {
            getItem: (key) => storage.get(key) ?? null,
        },
        window: {
            location: { search },
        },
    });
    vm.runInContext(configSource, context, { filename: 'js/config.js' });
    return { debug: context.window.LibertyDebug, entries };
}

test('debug diagnostics are disabled by default', () => {
    const harness = createDebugHarness();
    harness.debug.log('hidden', { password: 'must-not-appear' });
    harness.debug.warn('hidden-warning');
    assert.deepEqual(harness.entries, []);
});

test('debug diagnostics redact sensitive fields and complete URL queries', () => {
    const harness = createDebugHarness({ enabled: true });
    harness.debug.log('request', {
        authorization: 'Bearer header-secret',
        nested: {
            viewerCredential: 'viewer-secret',
            proxyCapabilityToken: 'capability-secret',
        },
        target: 'https://media.example.test/video/master.m3u8?token=query-secret&sign=signature-secret#fragment',
        safe: 'episode-12',
    });

    assert.equal(harness.entries.length, 1);
    const serialized = JSON.stringify(harness.entries[0]);
    assert.doesNotMatch(serialized, /header-secret|viewer-secret|capability-secret|query-secret|signature-secret|fragment/u);
    assert.match(serialized, /https:\/\/media\.example\.test\/video\/master\.m3u8\?\[redacted\]/u);
    assert.match(serialized, /episode-12/u);
});

test('free-form authorization and cookie strings are redacted in debug mode', () => {
    const harness = createDebugHarness({ search: '?debug=1' });
    harness.debug.warn(
        'Authorization: Bearer direct-secret',
        'Cookie=session=browser-secret',
    );

    const serialized = JSON.stringify(harness.entries);
    assert.doesNotMatch(serialized, /direct-secret|browser-secret/u);
    assert.match(serialized, /\[redacted\]/u);
});

test('player diagnostics sanitize the current video URL instead of returning its signed query', () => {
    const playerSource = readFileSync(new URL('../js/player.js', import.meta.url), 'utf8');
    const debugStart = playerSource.indexOf('window.debugDanmuState = function () {');
    const debugEnd = playerSource.indexOf('\n};', debugStart);
    assert.notEqual(debugStart, -1);
    assert.notEqual(debugEnd, -1);
    const debugSource = playerSource.slice(debugStart, debugEnd);

    assert.match(debugSource, /currentVideoUrl:\s*window\.LibertyDebug\?\.sanitize\?\.\(currentVideoUrl\)/u);
    assert.doesNotMatch(debugSource, /currentVideoUrl,\s*\n/u);
});

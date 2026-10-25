import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(
    new URL('../js/utils/playback-telemetry.js', import.meta.url),
    'utf8',
);

function load({ debugEnabled = false } = {}) {
    const logs = [];
    let fetchCalls = 0;
    const window = {
        LibertyUtils: {},
        LibertyDebug: {
            enabled: () => debugEnabled,
            log: (...args) => logs.push(args),
        },
        location: { href: 'https://liberty.example.test/player.html' },
    };
    vm.runInNewContext(source, {
        Date,
        Math,
        URL,
        window,
        fetch: () => { fetchCalls += 1; },
    }, { filename: 'playback-telemetry.js' });
    return {
        api: window.LibertyUtils.playbackTelemetry,
        logs,
        fetchCalls: () => fetchCalls,
    };
}

test('debug OFF stores and logs no playback telemetry', () => {
    const { api, logs, fetchCalls } = load();
    const telemetry = api.create({
        generation: 1,
        mediaUrl: 'https://cdn.example.test/path/video.m3u8?token=secret',
    });
    assert.equal(telemetry.enabled, false);
    assert.equal(telemetry.record('manifest-loaded', { durationMs: 100 }), false);
    assert.equal(telemetry.getEvents().length, 0);
    assert.equal(logs.length, 0);
    assert.equal(fetchCalls(), 0);
});

test('debug ON records manifest, fragment, and buffer metrics locally', () => {
    const { api, logs, fetchCalls } = load({ debugEnabled: true });
    const telemetry = api.create({
        generation: 4,
        mediaType: 'hls.js',
        mediaUrl: 'https://cdn.example.test/path/video.m3u8?token=secret',
        now: () => 1234,
    });
    const metrics = api.fragmentMetrics({
        stats: { loading: { start: 100, end: 600 }, loaded: 500_000, retry: 1 },
        frag: { duration: 4, sn: 12, level: 2 },
    });
    telemetry.record('manifest-loaded', { durationMs: 240 });
    telemetry.record('fragment-loaded', metrics);
    const video = {
        currentTime: 11,
        buffered: { length: 1, start: () => 10, end: () => 25 },
    };
    telemetry.record('playing', {
        bufferSeconds: api.bufferSeconds(video),
        readyState: 4,
        networkState: 1,
    });

    const events = telemetry.getEvents();
    assert.equal(events.length, 3);
    assert.equal(events[0].durationMs, 240);
    assert.equal(events[1].bytes, 500_000);
    assert.equal(events[1].throughputBps, 8_000_000);
    assert.equal(events[1].downloadRatio, 0.125);
    assert.equal(events[2].bufferSeconds, 14);
    assert.equal(logs.length, 3);
    assert.equal(fetchCalls(), 0);
});

test('signed URLs and sensitive fields never enter stored events', () => {
    const { api } = load({ debugEnabled: true });
    const telemetry = api.create({
        generation: 2,
        mediaUrl: 'https://signed.example.test/private/movie.m3u8?token=supersecret&expires=999#frag',
    });
    telemetry.record('hls-error', {
        errorType: 'networkError',
        errorDetails: 'https://signed.example.test/private/movie.m3u8?signature=supersecret',
        token: 'supersecret',
        cookie: 'session=supersecret',
        authorization: 'Bearer supersecret',
    });
    const json = JSON.stringify(telemetry.getEvents());
    assert.match(json, /signed\.example\.test/u);
    assert.doesNotMatch(json, /movie\.m3u8|token|signature|expires|supersecret|session=|Bearer/iu);
    assert.match(json, /\[redacted(?:-location)?\]/u);
});

test('storage is bounded and an old generation is ignored', () => {
    const { api } = load({ debugEnabled: true });
    let current = true;
    const telemetry = api.create({
        generation: 9,
        mediaUrl: 'https://cdn.example.test/live/index.m3u8',
        maxEvents: 3,
        isCurrent: () => current,
    });
    for (let index = 0; index < 5; index += 1) {
        telemetry.record('progress', { retryCount: index });
    }
    assert.deepEqual(Array.from(telemetry.getEvents(), (event) => event.retryCount), [2, 3, 4]);
    current = false;
    assert.equal(telemetry.record('stale', { retryCount: 5 }), false);
    assert.equal(telemetry.getEvents().length, 3);
});

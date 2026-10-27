import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const telemetrySource = readFileSync(new URL('../js/utils/playback-telemetry.js', import.meta.url), 'utf8');
const controllerSource = readFileSync(new URL('../js/utils/startup-buffer-controller.js', import.meta.url), 'utf8');
const playerSource = readFileSync(new URL('../js/player.js', import.meta.url), 'utf8');
const handoffSource = readFileSync(new URL('../js/utils/source-switch-position-handoff.js', import.meta.url), 'utf8');

function clock() {
    let time = 0;
    let next = 0;
    const timers = new Map();
    return {
        now: () => time,
        setTimeout(callback, delay) { const id = ++next; timers.set(id, { callback, at: time + delay }); return id; },
        clearTimeout(id) { timers.delete(id); },
        advance(ms) {
            const end = time + ms;
            while (true) {
                const first = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
                if (!first) break;
                timers.delete(first[0]); time = first[1].at; first[1].callback();
            }
            time = end;
        },
        pending: () => timers.size,
    };
}

class Video {
    constructor() {
        this.currentTime = 0;
        this.duration = 1200;
        this.readyState = 2;
        this.paused = true;
        this.ended = false;
        this.seeking = false;
        this.ranges = [];
        this.playCalls = 0;
        this.pauseCalls = 0;
        this.listeners = new Map();
        const video = this;
        this.buffered = {
            get length() { return video.ranges.length; },
            start: (index) => video.ranges[index][0],
            end: (index) => video.ranges[index][1],
        };
    }
    addEventListener(type, handler) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type).add(handler);
    }
    removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
    emit(type) { for (const handler of [...(this.listeners.get(type) || [])]) handler({ type }); }
    play() {
        this.playCalls += 1;
        this.paused = false;
        this.emit('play');
        this.emit('playing');
        return Promise.resolve();
    }
    pause() { this.pauseCalls += 1; this.paused = true; this.emit('pause'); }
}

function harness({ mode = 'hls.js', duration = 1200, currentTime = 0, debug = false, rejectPlay = false,
    deferPlay = false } = {}) {
    const timer = clock();
    const logs = [];
    const window = { LibertyUtils: {}, location: { href: 'https://liberty.example.test/' },
        LibertyDebug: { enabled: () => debug, log: (...args) => logs.push(args) } };
    vm.runInNewContext(telemetrySource + controllerSource, { window, URL, Date, setTimeout, clearTimeout });
    const video = new Video();
    video.duration = duration;
    video.currentTime = currentTime;
    const playResolvers = [];
    if (rejectPlay) video.play = () => {
        video.playCalls += 1;
        const error = new Error('Browser requires another user gesture');
        error.name = 'NotAllowedError';
        return Promise.reject(error);
    };
    if (deferPlay) video.play = () => {
        video.playCalls += 1;
        return new Promise((resolve) => playResolvers.push(resolve));
    };
    let current = true;
    let noData = 0;
    let stateChanges = 0;
    const telemetry = window.LibertyUtils.playbackTelemetry.create({ generation: 1,
        mediaUrl: 'https://cdn.example.test/video.m3u8?token=private', now: timer.now,
        isCurrent: () => current });
    const api = window.LibertyUtils.startupBuffer.create({ video, generation: 1, mode,
        now: timer.now, setTimeout: timer.setTimeout, clearTimeout: timer.clearTimeout,
        isCurrent: () => current, telemetry, onNoData: () => { noData += 1; },
        onState: () => { stateChanges += 1; } });
    return { api, video, timer, telemetry, logs, constants: window.LibertyUtils.startupBuffer.constants,
        bufferAhead: window.LibertyUtils.playbackTelemetry.bufferSeconds,
        stale: () => { current = false; }, noData: () => noData, stateChanges: () => stateChanges,
        playResolvers, supported: window.LibertyUtils.startupBuffer.supported };
}

test('A: bufferAhead uses only the continuous range containing the current position', () => {
    const h = harness();
    h.video.currentTime = 10;
    for (const [ranges, expected] of [
        [[[0, 20]], 10],
        [[[0, 5], [8, 18]], 8],
        [[[0, 5], [12, 18]], 0],
        [[[0, 11], [12, 100]], 1],
    ]) {
        h.video.ranges = ranges;
        assert.equal(h.bufferAhead(h.video), expected);
    }
});

test('B: healthy fragment ratio lowers target to 4s and plays without waiting for timeout', async () => {
    const h = harness();
    h.api.metadataRestored();
    const play = h.video.play();
    h.api.observeFragment({ downloadRatio: 0.2 });
    h.video.ranges = [[0, 4]];
    h.video.emit('progress');
    await play;
    assert.equal(h.api.snapshot().targetSeconds, 4);
    assert.equal(h.video.playCalls, 1);
    assert.equal(h.api.snapshot().completionReason, 'target-reached');
    assert.equal(h.timer.pending(), 0);
});

test('C: normal buffer growth 2 to 5 to 8 to 10 only starts at its target', async () => {
    const h = harness();
    h.api.metadataRestored();
    const play = h.video.play();
    for (const end of [2, 5]) {
        h.video.ranges = [[0, end]]; h.video.emit('progress');
        assert.equal(h.video.playCalls, 0);
    }
    h.video.ranges = [[0, 8]]; h.video.emit('progress');
    await play;
    h.video.ranges = [[0, 10]]; h.video.emit('progress');
    assert.equal(h.video.playCalls, 1);
    assert.equal(h.api.snapshot().state, 'completed');
});

test('D: marginal source raises target but cannot exceed 12s', async () => {
    const h = harness();
    h.api.metadataRestored();
    const play = h.video.play();
    h.api.observeFragment({ downloadRatio: 0.95 });
    assert.equal(h.api.snapshot().targetSeconds, 12);
    h.video.ranges = [[0, 11]]; h.video.emit('progress');
    assert.equal(h.video.playCalls, 0);
    h.video.ranges = [[0, 12]]; h.video.emit('progress');
    await play;
    assert.equal(h.video.playCalls, 1);
});

test('E: ratio above realtime cannot extend the 15s deadline; playable data uses fallback', async () => {
    const h = harness({ debug: true });
    h.api.metadataRestored();
    const play = h.video.play();
    h.api.observeFragment({ downloadRatio: 2 });
    h.video.ranges = [[0, 2]];
    h.timer.advance(14999);
    assert.equal(h.video.playCalls, 0);
    h.timer.advance(1);
    await play;
    assert.equal(h.video.playCalls, 1);
    assert.equal(h.api.snapshot().completionReason, 'timeout-fallback');
    assert.ok(h.telemetry.getEvents().some((event) => event.type === 'startup-buffer-timeout'
        && event.downloadRatio === 2 && event.state === 'source-marginal'));
});

test('F: no playable data at deadline does not pretend playback succeeded', async () => {
    const h = harness();
    h.api.metadataRestored();
    const play = h.video.play();
    h.timer.advance(15000);
    await play;
    assert.equal(h.video.playCalls, 0);
    assert.equal(h.api.snapshot().state, 'cancelled');
    assert.equal(h.api.snapshot().completionReason, 'timeout-no-playable-data');
    assert.equal(h.noData(), 1);
    assert.equal(h.timer.pending(), 0);
});

test('G: user pause cancels pending intent and later automatic requests cannot override it', async () => {
    const h = harness();
    h.api.metadataRestored();
    const play = h.video.play();
    assert.equal(h.video.playing, true); // ArtPlayer toggle sees the pending intent.
    h.video.pause();
    h.video.ranges = [[0, 20]]; h.video.emit('progress');
    h.api.requestAutomaticPlay();
    await play;
    assert.equal(h.video.playCalls, 0);
    assert.equal(h.video.playing, false);
    await h.video.play();
    assert.equal(h.video.playCalls, 1);
});

test('H: seeking during startup measures only the new currentTime buffer', async () => {
    const h = harness();
    h.api.metadataRestored();
    const play = h.video.play();
    h.video.ranges = [[0, 7]];
    h.video.currentTime = 600; h.video.seeking = true; h.video.emit('seeking');
    assert.equal(h.api.snapshot().bufferSeconds, 0);
    h.video.ranges = [[0, 20], [600, 604]];
    h.video.seeking = false; h.video.emit('seeked');
    assert.equal(h.video.playCalls, 0);
    h.video.ranges = [[0, 20], [600, 608]]; h.video.emit('progress');
    await play;
    assert.equal(h.video.currentTime, 600);
    assert.equal(h.video.playCalls, 1);
});

test('I: history or source-switch restore precedes gate decisions at 600s', async () => {
    const h = harness();
    const play = h.api.requestAutomaticPlay();
    h.video.ranges = [[0, 20]]; h.video.emit('canplay');
    assert.equal(h.video.playCalls, 0);
    h.video.currentTime = 600;
    h.api.metadataRestored();
    assert.equal(h.video.playCalls, 0);
    h.video.ranges = [[0, 20], [600, 608]]; h.video.emit('progress');
    await play;
    assert.equal(h.video.playCalls, 1);
    assert.equal(h.video.currentTime, 600);
});

test('J: stale generation timeout and media callbacks cannot play, pause, or mutate UI', () => {
    const h = harness({ debug: true });
    h.video.play();
    const before = h.stateChanges();
    h.stale();
    h.video.ranges = [[0, 30]];
    h.api.metadataRestored(); h.video.emit('progress'); h.video.emit('seeking');
    h.timer.advance(15000);
    assert.equal(h.video.playCalls, 0);
    assert.equal(h.video.pauseCalls, 0);
    assert.equal(h.stateChanges(), before);
    h.api.dispose();
    assert.equal(h.timer.pending(), 0);
});

test('K/L: completed startup is never reapplied for pause/resume or a later stall', async () => {
    const h = harness();
    h.video.ranges = [[0, 8]]; h.api.metadataRestored();
    await h.video.play();
    h.video.currentTime = 600; h.video.pause(); h.video.ranges = [];
    h.video.emit('waiting'); h.video.emit('stalled');
    await h.video.play();
    assert.equal(h.video.playCalls, 2);
    assert.equal(h.api.snapshot().state, 'completed');
    assert.equal(h.timer.pending(), 0);
});

test('M/N: short content and near-end resume use a target below remaining duration', async () => {
    for (const [duration, currentTime, expected] of [[5, 0, 4], [10, 0, 8], [20, 0, 8], [1200, 1196, 3.2]]) {
        const h = harness({ duration, currentTime });
        h.api.metadataRestored();
        const play = h.video.play();
        assert.equal(h.api.snapshot().targetSeconds, expected);
        h.video.ranges = [[currentTime, currentTime + expected]]; h.video.emit('progress');
        await play;
        assert.equal(h.video.playCalls, 1);
    }
});

test('O: live and unknown-duration media bypass the VOD cushion', async () => {
    for (const duration of [Infinity, Number.NaN]) {
        const h = harness({ duration });
        h.api.metadataRestored();
        await h.video.play();
        assert.equal(h.video.playCalls, 1);
        assert.equal(h.api.snapshot().completionReason, 'disabled');
    }
    const h = harness();
    h.api.setLive(true); h.api.metadataRestored(); await h.video.play();
    assert.equal(h.api.snapshot().completionReason, 'disabled');
});

test('P: native fallback waits for metadata restore but never forces paused buffering', async () => {
    const h = harness({ mode: 'native' });
    const play = h.video.play();
    assert.equal(h.video.playCalls, 0);
    h.api.metadataRestored();
    await play;
    assert.equal(h.video.playCalls, 1);
    assert.equal(h.video.pauseCalls, 0);
    assert.equal(h.api.snapshot().completionReason, 'native-fallback');
    assert.equal(h.timer.pending(), 0);
});

test('startup telemetry stays debug-only, redacted, bounded, and progress is throttled', () => {
    const off = harness();
    off.video.play(); off.video.emit('progress');
    assert.equal(off.logs.length, 0);
    off.api.dispose();
    const on = harness({ debug: true });
    on.video.play();
    for (let index = 0; index < 200; index += 1) on.video.emit('progress');
    assert.equal(on.telemetry.getEvents().filter((event) => event.type === 'startup-buffer-progress').length, 1);
    assert.doesNotMatch(JSON.stringify(on.telemetry.getEvents()), /video\.m3u8|token|private|https:\/\//iu);
    on.api.dispose();
});

test('dispose restores exact video method descriptors and removes listeners idempotently', () => {
    const h = harness();
    h.video.play();
    h.api.dispose(); h.api.dispose();
    assert.equal(Object.hasOwn(h.video, 'play'), false);
    assert.equal(Object.hasOwn(h.video, 'pause'), false);
    assert.equal(Object.hasOwn(h.video, 'playing'), false);
    assert.equal([...h.video.listeners.values()].reduce((sum, items) => sum + items.size, 0), 0);
    assert.equal(h.timer.pending(), 0);
});

test('pending intent supports pause/toggle even before metadata, and deadline logs only once', async () => {
    const h = harness({ debug: true });
    const play = h.video.play();
    assert.equal(h.video.playing, true);
    h.video.pause();
    await play;
    h.api.metadataRestored();
    h.video.ranges = [[0, 2]];
    h.timer.advance(15000);
    for (let index = 0; index < 200; index += 1) h.video.emit('progress');
    assert.equal(h.video.playCalls, 0);
    assert.equal(h.telemetry.getEvents().filter((event) => event.type === 'startup-buffer-timeout').length, 1);
    await h.video.play();
    assert.equal(h.video.playCalls, 1);
    assert.equal(h.api.snapshot().completionReason, 'timeout-fallback');
});

test('browser autoplay rejection settles the request without retry or an active startup timer', async () => {
    const h = harness({ rejectPlay: true });
    h.api.metadataRestored(); h.video.ranges = [[0, 8]];
    await assert.rejects(h.video.play(), { name: 'NotAllowedError' });
    assert.equal(h.api.snapshot().state, 'cancelled');
    assert.equal(h.api.snapshot().completionReason, 'play-rejected');
    h.timer.advance(60000);
    h.api.requestAutomaticPlay();
    assert.equal(h.video.playCalls, 1);
    assert.equal(h.timer.pending(), 0);
});

test('seek after release invalidates the old play promise and retains the original deadline', async () => {
    const h = harness({ deferPlay: true });
    h.api.metadataRestored(); h.video.ranges = [[0, 8]];
    const play = h.video.play();
    assert.equal(h.api.snapshot().state, 'ready');
    h.timer.advance(10000);
    h.video.currentTime = 600; h.video.seeking = true; h.video.emit('seeking');
    h.playResolvers[0](); await Promise.resolve();
    assert.equal(h.api.snapshot().state, 'waiting');
    h.video.seeking = false; h.video.ranges = [[600, 601]]; h.video.emit('seeked');
    h.timer.advance(5000);
    assert.equal(h.video.playCalls, 2);
    assert.equal(h.api.snapshot().completionReason, 'timeout-fallback');
    h.playResolvers[1](); await play;
    assert.equal(h.api.snapshot().state, 'completed');
});

test('pause after release then resume with less buffer cannot lose the deadline', async () => {
    const h = harness({ deferPlay: true });
    h.api.metadataRestored(); h.video.ranges = [[0, 8]];
    const first = h.video.play();
    h.video.pause(); await first;
    h.timer.advance(10000);
    h.video.ranges = [[0, 2]];
    const second = h.video.play();
    h.timer.advance(5000);
    assert.equal(h.video.playCalls, 2);
    assert.equal(h.api.snapshot().completionReason, 'timeout-fallback');
    h.playResolvers[1](); await second;
    assert.equal(h.api.snapshot().state, 'completed');
});

test('non-configurable video proxy properties safely disable installation', () => {
    const h = harness();
    const video = new Video();
    Object.defineProperty(video, 'playing', { configurable: false, value: false });
    assert.equal(h.supported(video), false);
    assert.equal(h.supported(null), null);
    h.api.dispose();
});

function productionHarness({ enabled = true, watchRoom = false, historyPosition = 0, trusted = false } = {}) {
    const timer = clock();
    const video = new Video();
    video.duration = 3600;
    const storage = new Map();
    const session = new Map();
    const storageApi = (values) => ({ getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) });
    if (enabled) storage.set('libertyStartupBufferEnabled', 'true');
    const loading = { style: { display: 'none' } };
    const callbacks = {};
    let positionWrites = 0;
    const art = { video, plugins: {}, get duration() { return video.duration; },
        get currentTime() { return video.currentTime; },
        set currentTime(value) { positionWrites += 1; video.currentTime = value; },
        set switch(value) { video.pause(); video.currentTime = 0; } };
    const window = { LibertyUtils: {}, location: {
        href: `https://liberty.example.test/player.html?position=${historyPosition}`,
        search: `?position=${historyPosition}` },
        history: { replaceState() {} }, performance: { now: timer.now },
        sessionStorage: storageApi(session), LibertyDebug: { enabled: () => false, log() {}, warn() {} } };
    const side = { sourceKey: 'b', vodId: 'vod-b', canonicalMediaId: 'work-b', canonicalEpisodeId: 'work-b:e12',
        episode: { rawIndex: 1, playGroup: 'b', playGroupIndex: 0 } };
    const context = vm.createContext({ window, URL, URLSearchParams, queueMicrotask, Date,
        setTimeout: timer.setTimeout, clearTimeout: timer.clearTimeout,
        localStorage: storageApi(storage), sessionStorage: window.sessionStorage,
        document: { getElementById: () => loading }, Hls: { isSupported: () => true },
        __video: video, __art: art, __side: side, __callbacks: callbacks });
    const begin = playerSource.indexOf('const playerLifecycle = {');
    const end = playerSource.indexOf('\nclass VideoPlayer {', begin);
    vm.runInContext(telemetrySource + controllerSource + handoffSource + `
        let currentVideoUrl = 'a'; let currentVideoTitle = 'Example Show';
        let currentEpisodeIndex = 1; let videoHasEnded = false;
        let art = globalThis.__art;
        let videoPlayer = {
            art, addEventListener(target, type, handler) { target.addEventListener(type, handler); },
            addArtEventListener(target, type, handler) { globalThis.__callbacks[type] = handler; }
        };
        function isWatchRoomLaunch() { return ${watchRoom}; }
        function isDanmuServiceEnabled() { return false; }
        function startProgressSaveInterval() {}
        function showPositionRestoreHint() {}
        function getVideoId() { return 'fixture'; }
        function createProductionDanmakuContext() { return {}; }
        function getSourceSwitchHandoffSide() { return globalThis.__side; }
        function removeSourceSwitchHandoffParams() { window.location.search = ''; }
        ${playerSource.slice(begin, end)}
        globalThis.production = {
            begin(url = 'a') {
                currentVideoUrl = url;
                const owner = beginPlayerLifecycle(url);
                attachPlayerLifecycleOwnership(url, owner);
                return owner;
            },
            gate: () => videoPlayer.startupBuffer,
            bind(owner) { bindPlayerRecoverySignals(art.video, owner); },
            switch(url, owner) { switchPlayerSource(url, owner); },
            recovery: () => playerLifecycle.recovery,
            finished: () => playerLifecycle.startupFinished,
            rebuild(owner) {
                videoPlayer.startupBuffer?.dispose('player-destroy');
                videoPlayer = { art };
                attachPlayerLifecycleOwnership(currentVideoUrl, owner);
            }
        };
    `, context);
    if (trusted) {
        const api = window.LibertyUtils.sourceSwitchPositionHandoff;
        const record = api.create({ generation: 7, currentTime: 600, oldDuration: 3600,
            source: { ...side, sourceKey: 'a', vodId: 'vod-a' }, target: side });
        window.location.search = `?switch_handoff=${record.nonce}&switch_generation=7`;
    }
    const restoreBegin = playerSource.indexOf('let sourceSwitchHandoffHandled = false;');
    const restoreEnd = playerSource.indexOf('\n    // 错误处理', restoreBegin);
    assert.ok(restoreBegin >= 0 && restoreEnd > restoreBegin);
    vm.runInContext(playerSource.slice(restoreBegin, restoreEnd), context);
    return { api: context.production, video, timer, loading, callbacks,
        positionWrites: () => positionWrites };
}

test('production adapter is default-off and watch rooms bypass the opt-in gate', () => {
    for (const options of [{ enabled: false }, { enabled: true, watchRoom: true }]) {
        const h = productionHarness(options);
        h.api.begin();
        assert.equal(h.api.gate(), null);
        assert.equal(Object.hasOwn(h.video, 'play'), false);
    }
});

test('production loadedmetadata handoff/history handlers seek before the startup gate can play', async () => {
    for (const options of [{ trusted: true }, { historyPosition: 600 }]) {
        const h = productionHarness(options);
        h.api.begin();
        const play = h.api.gate().requestAutomaticPlay();
        h.video.ranges = [[0, 20]]; h.video.emit('canplay');
        assert.equal(h.video.playCalls, 0);
        h.callbacks['video:loadedmetadata']();
        await Promise.resolve();
        assert.equal(h.video.currentTime, 600);
        assert.equal(h.video.playCalls, 0);
        h.video.ranges = [[0, 20], [600, 608]]; h.video.emit('progress');
        await play;
        assert.equal(h.video.playCalls, 1);
        assert.equal(h.video.currentTime, 600);
        assert.equal(h.positionWrites(), 1);
        assert.equal(h.loading.style.display, 'none');
    }
});

test('production generation change invalidates the old gate and new gate respects user pause', async () => {
    const h = productionHarness();
    h.api.begin('a');
    const old = h.api.gate();
    old.requestAutomaticPlay();
    const owner = h.api.begin('b');
    const current = h.api.gate();
    h.api.switch('b', owner);
    assert.equal(current.snapshot().userPaused, false); // framework switch pause is internal
    const play = current.requestAutomaticPlay();
    h.video.pause();
    h.callbacks['video:loadedmetadata']();
    await Promise.resolve();
    h.video.ranges = [[0, 20]]; h.video.emit('progress');
    old.metadataRestored(); old.progress(); old.requestAutomaticPlay();
    h.timer.advance(15000);
    await play;
    assert.equal(h.video.playCalls, 0);
    assert.equal(current.snapshot().userPaused, true);
});

test('startup internal pause does not suspend recovery; zero-data timeout reuses existing watchdog', () => {
    const h = productionHarness();
    const owner = h.api.begin();
    h.api.bind(owner);
    h.api.switch('a', owner);
    h.api.gate().requestAutomaticPlay();
    assert.equal(h.api.recovery().intentionallyPaused, false);
    h.timer.advance(15000);
    assert.equal(h.video.playCalls, 0);
    assert.equal(h.api.recovery().armed, true);
    assert.equal(h.api.recovery().reason, 'startup-no-playable-data');
});

test('same-generation player rebuild cannot reapply an already completed startup gate', async () => {
    const h = productionHarness();
    const owner = h.api.begin();
    h.api.gate().metadataRestored();
    h.video.ranges = [[0, 8]];
    await h.video.play();
    assert.equal(h.api.finished(), true);
    h.api.rebuild(owner);
    assert.equal(h.api.gate(), null);
});

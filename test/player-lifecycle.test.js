import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const playerSource = readFileSync(new URL('../js/player.js', import.meta.url), 'utf8');

function sourceBetween(startMarker, endMarker) {
    const start = playerSource.indexOf(startMarker);
    const end = playerSource.indexOf(endMarker, start);
    assert.notEqual(start, -1, `Missing source marker: ${startMarker}`);
    assert.notEqual(end, -1, `Missing source marker: ${endMarker}`);
    return playerSource.slice(start, end);
}

function createFakeClock() {
    let now = 0;
    let nextId = 1;
    const timers = new Map();

    return {
        setTimeout(callback, delay = 0) {
            const id = nextId;
            nextId += 1;
            timers.set(id, { callback, due: now + Number(delay) });
            return id;
        },
        clearTimeout(id) {
            timers.delete(id);
        },
        advance(milliseconds) {
            const target = now + milliseconds;
            while (true) {
                const next = [...timers.entries()]
                    .filter(([, timer]) => timer.due <= target)
                    .sort((left, right) => left[1].due - right[1].due || left[0] - right[0])[0];
                if (!next) break;
                const [id, timer] = next;
                timers.delete(id);
                now = timer.due;
                timer.callback();
            }
            now = target;
        },
        pending() {
            return timers.size;
        },
    };
}

function createLifecycleHarness() {
    const clock = createFakeClock();
    const loadingElement = { style: { display: 'flex' } };
    const counters = {
        initUrls: [],
        destroyCalls: 0,
        videoSrcWrites: 0,
        videoLoadCalls: 0,
        currentTimeWrites: 0,
        artRecreates: 0,
        hlsRecreates: 0,
    };
    const context = vm.createContext({
        console: { log() {}, warn() {}, error() {} },
        document: {
            getElementById(id) {
                return id === 'player-loading' ? loadingElement : null;
            },
        },
        setTimeout: clock.setTimeout,
        clearTimeout: clock.clearTimeout,
        window: { LibertyDebug: { log() {} } },
    });

    vm.runInContext(`
        let currentVideoUrl = '';
        let videoPlayer = null;
        globalThis.__counters = null;
        function initPlayerInternal(videoUrl, ownership) {
            if (!isCurrentPlayerLifecycle(ownership)) return;
            initPlayer.lastInitializedGeneration = ownership.generation;
            globalThis.__counters.initUrls.push(videoUrl);
            globalThis.__counters.artRecreates += 1;
            globalThis.__counters.hlsRecreates += 1;
            videoPlayer = {
                generation: ownership.generation,
                getStatus() { return {}; },
                destroy() { globalThis.__counters.destroyCalls += 1; }
            };
        }
    `, context);
    context.__counters = counters;

    vm.runInContext(sourceBetween('const playerLifecycle = {', '\nclass VideoPlayer {'), context);
    vm.runInContext(sourceBetween('function initPlayer(videoUrl', '\n// \u5185\u90e8\u521d\u59cb\u5316\u51fd\u6570'), context);
    vm.runInContext(`
        globalThis.__lifecycle = {
            begin(url, reason = 'test') {
                currentVideoUrl = url;
                return beginPlayerLifecycle(url, reason);
            },
            scheduleRecovery(url, ownership) {
                return scheduleCurrentPlayerRecovery(url, ownership);
            },
            invalidate(reason = 'test-destroy') {
                invalidatePlayerLifecycle(reason);
                videoPlayer = null;
            },
            init(url) {
                currentVideoUrl = url;
                return initPlayer(url);
            },
            installExistingPlayer() {
                videoPlayer = {
                    getStatus() { return {}; },
                    destroy() { globalThis.__counters.destroyCalls += 1; }
                };
            },
            state() {
                return {
                    generation: playerLifecycle.generation,
                    active: playerLifecycle.active,
                    url: playerLifecycle.url,
                    pendingInit: playerLifecycle.timers.init !== null,
                    pendingRecovery: playerLifecycle.timers.recovery !== null,
                    currentVideoUrl,
                };
            }
        };
    `, context);

    return {
        api: context.__lifecycle,
        clock,
        counters,
        loadingElement,
    };
}

function assertNoStalePlayerMutation(counters) {
    assert.equal(counters.videoSrcWrites, 0);
    assert.equal(counters.videoLoadCalls, 0);
    assert.equal(counters.currentTimeWrites, 0);
    assert.equal(counters.artRecreates, 0);
    assert.equal(counters.hlsRecreates, 0);
    assert.equal(counters.destroyCalls, 0);
}

function createListenerOwnershipHarness() {
    const classStart = playerSource.indexOf('class VideoPlayer {');
    const classEnd = playerSource.indexOf('\nlet videoPlayer = null;', classStart);
    assert.notEqual(classStart, -1, 'Missing VideoPlayer class');
    assert.notEqual(classEnd, -1, 'Missing VideoPlayer class end');
    const context = vm.createContext({
        console: { log() {}, warn() {}, error() {} },
        setTimeout() { return 1; },
        clearTimeout() {},
        setInterval() { return 1; },
        clearInterval() {},
    });
    vm.runInContext(
        playerSource.slice(classStart, classEnd) + '\nglobalThis.VideoPlayerHarness = VideoPlayer;',
        context,
    );

    class FakeEventTarget {
        constructor(name) {
            this.name = name;
            this.listeners = new Map();
        }

        addEventListener(type, handler) {
            if (!this.listeners.has(type)) this.listeners.set(type, new Set());
            this.listeners.get(type).add(handler);
        }

        removeEventListener(type, handler) {
            this.listeners.get(type)?.delete(handler);
        }

        dispatch(type) {
            for (const handler of this.listeners.get(type) || []) handler({ type });
        }

        count(type = null) {
            if (type) return this.listeners.get(type)?.size || 0;
            return [...this.listeners.values()].reduce((sum, handlers) => sum + handlers.size, 0);
        }
    }

    class FakeEmitter {
        constructor() {
            this.listeners = new Map();
        }

        on(type, handler) {
            if (!this.listeners.has(type)) this.listeners.set(type, new Set());
            this.listeners.get(type).add(handler);
        }

        off(type, handler) {
            this.listeners.get(type)?.delete(handler);
        }

        emit(type) {
            for (const handler of this.listeners.get(type) || []) handler();
        }

        count() {
            return [...this.listeners.values()].reduce((sum, handlers) => sum + handlers.size, 0);
        }
    }

    return {
        createPlayer: () => new context.VideoPlayerHarness('player'),
        FakeEventTarget,
        FakeEmitter,
    };
}

test('old 10s episode recovery cannot reload E01 after E02 becomes authoritative', () => {
    const harness = createLifecycleHarness();
    const e01 = harness.api.begin('https://media.example.test/e01.m3u8', 'episode:E01');
    harness.api.scheduleRecovery(e01.url, e01);
    harness.api.begin('https://media.example.test/e02.m3u8', 'episode:E02');

    harness.clock.advance(10100);

    assert.equal(harness.api.state().currentVideoUrl, 'https://media.example.test/e02.m3u8');
    assertNoStalePlayerMutation(harness.counters);
    assert.equal(harness.clock.pending(), 0);
});

test('destroy invalidates a pending 10s recovery callback', () => {
    const harness = createLifecycleHarness();
    const ownership = harness.api.begin('https://media.example.test/e01.m3u8');
    harness.api.scheduleRecovery(ownership.url, ownership);
    harness.api.invalidate();

    harness.clock.advance(10100);

    assertNoStalePlayerMutation(harness.counters);
    assert.equal(harness.api.state().active, false);
});

test('rapid init A then B allows only B to initialize', () => {
    const harness = createLifecycleHarness();
    harness.api.installExistingPlayer();

    harness.api.init('https://media.example.test/a.m3u8');
    harness.api.init('https://media.example.test/b.m3u8');
    harness.clock.advance(200);

    assert.deepEqual(harness.counters.initUrls, ['https://media.example.test/b.m3u8']);
    assert.equal(harness.counters.artRecreates, 1);
    assert.equal(harness.counters.hlsRecreates, 1);
    assert.equal(harness.api.state().url, 'https://media.example.test/b.m3u8');
});

test('destroy before the delayed 100ms init prevents player creation', () => {
    const harness = createLifecycleHarness();
    harness.api.installExistingPlayer();
    harness.api.init('https://media.example.test/a.m3u8');
    harness.api.invalidate();

    harness.clock.advance(200);

    assert.deepEqual(harness.counters.initUrls, []);
    assert.equal(harness.counters.artRecreates, 0);
    assert.equal(harness.counters.hlsRecreates, 0);
});

test('an old source recovery cannot replace the newer source', () => {
    const harness = createLifecycleHarness();
    const sourceA = harness.api.begin('https://source-a.example.test/main.m3u8', 'source:A');
    harness.api.scheduleRecovery(sourceA.url, sourceA);
    harness.api.begin('https://source-b.example.test/main.m3u8', 'source:B');

    harness.clock.advance(10100);

    assert.equal(harness.api.state().currentVideoUrl, 'https://source-b.example.test/main.m3u8');
    assertNoStalePlayerMutation(harness.counters);
});

test('the current still-loading context retains its recovery behavior', () => {
    const harness = createLifecycleHarness();
    harness.api.installExistingPlayer();
    const current = harness.api.begin('https://media.example.test/current.m3u8', 'episode:current');
    harness.api.scheduleRecovery(current.url, current);

    harness.clock.advance(10000);
    assert.deepEqual(harness.counters.initUrls, []);
    harness.clock.advance(100);

    assert.deepEqual(harness.counters.initUrls, ['https://media.example.test/current.m3u8']);
    assert.equal(harness.counters.artRecreates, 1);
    assert.equal(harness.counters.hlsRecreates, 1);
    assert.equal(harness.api.state().active, true);
});

test('production episode switching wires both delayed paths to the lifecycle owner', () => {
    const playEpisodeStart = playerSource.indexOf('function playEpisode(');
    const playEpisodeEnd = playerSource.indexOf('\n// \u64ad\u653e\u4e0a\u4e00\u96c6', playEpisodeStart);
    const playEpisodeSource = playerSource.slice(playEpisodeStart, playEpisodeEnd);
    const initSource = sourceBetween('function initPlayer(videoUrl', '\n// \u5185\u90e8\u521d\u59cb\u5316\u51fd\u6570');

    assert.match(playEpisodeSource, /beginPlayerLifecycle\(url,/u);
    assert.match(playEpisodeSource, /scheduleCurrentPlayerRecovery\(url, lifecycleOwnership\)/u);
    assert.doesNotMatch(playEpisodeSource, /art\s*=\s*null;[\s\S]*currentHls\s*=\s*null;[\s\S]*initPlayer\(url\)/u);
    assert.match(initSource, /setPlayerLifecycleTimer\([\s\S]*'init'/u);
    assert.doesNotMatch(initSource, /setTimeout\([^)]*initPlayerInternal/u);
});

test('player-owned DOM listeners return to baseline across ten lifecycle rounds', () => {
    const { createPlayer, FakeEventTarget } = createListenerOwnershipHarness();
    const windowTarget = new FakeEventTarget('window');
    const documentTarget = new FakeEventTarget('document');
    const videoTarget = new FakeEventTarget('video-a');
    const eventPlan = [
        [windowTarget, 'beforeunload'],
        [windowTarget, 'orientationchange'],
        [documentTarget, 'visibilitychange'],
        [documentTarget, 'mouseout'],
        [videoTarget, 'playing'],
        [videoTarget, 'timeupdate'],
        [videoTarget, 'pause'],
        [videoTarget, 'play'],
        [videoTarget, 'waiting'],
        [videoTarget, 'stalled'],
        [videoTarget, 'error'],
        [videoTarget, 'ended'],
        [videoTarget, 'touchstart'],
        [videoTarget, 'touchmove'],
        [videoTarget, 'touchend'],
        [videoTarget, 'touchcancel'],
    ];

    for (let round = 0; round < 10; round += 1) {
        const player = createPlayer();
        let mutations = 0;
        for (const [target, type] of eventPlan) {
            player.addEventListener(target, type, () => { mutations += 1; });
        }
        assert.equal(windowTarget.count() + documentTarget.count() + videoTarget.count(), eventPlan.length);
        player.removeAllEventListeners();
        player.removeAllEventListeners();
        videoTarget.dispatch('timeupdate');
        assert.equal(mutations, 0);
        assert.equal(windowTarget.count(), 0);
        assert.equal(documentTarget.count(), 0);
        assert.equal(videoTarget.count(), 0);
    }
});

test('listener registries detach the exact old video, HLS, and ArtPlayer targets', () => {
    const { createPlayer, FakeEventTarget, FakeEmitter } = createListenerOwnershipHarness();
    const oldVideo = new FakeEventTarget('video-a');
    const newVideo = new FakeEventTarget('video-b');
    const hls = new FakeEmitter();
    const art = new FakeEmitter();
    const player = createPlayer();
    let oldMutations = 0;
    let newMutations = 0;
    const videoEvents = ['pause', 'ended', 'touchstart', 'touchmove', 'touchend', 'touchcancel'];

    for (const type of videoEvents) {
        player.addEventListener(oldVideo, type, () => { oldMutations += 1; });
    }
    newVideo.addEventListener('pause', () => { newMutations += 1; });
    player.addHlsEventListener(hls, 'manifest', () => { oldMutations += 1; });
    player.addArtEventListener(art, 'ready', () => { oldMutations += 1; });

    player.removeAllEventListeners();
    player.removeHlsEventListeners();
    player.removeArtEventListeners();
    player.removeHlsEventListeners();
    player.removeArtEventListeners();

    for (const type of videoEvents) oldVideo.dispatch(type);
    hls.emit('manifest');
    art.emit('ready');
    newVideo.dispatch('pause');

    assert.equal(oldMutations, 0);
    assert.equal(newMutations, 1);
    assert.equal(oldVideo.count(), 0);
    assert.equal(newVideo.count('pause'), 1);
    assert.equal(hls.count(), 0);
    assert.equal(art.count(), 0);
    assert.doesNotMatch(playerSource, /\bart\.on\(/u);
    assert.doesNotMatch(playerSource, /\bhls\.on\(/u);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../js/player.js', import.meta.url), 'utf8');
const playerClass = source.slice(source.indexOf('class VideoPlayer {'), source.indexOf('// 全局 VideoPlayer 实例'));
class Target {
    handlers = new Map();
    addEventListener(type, fn, options) { this.handlers.set(fn, { type, options }); }
    removeEventListener(type, fn, options) {
        const entry = this.handlers.get(fn);
        if (entry?.type === type && entry.options === options) this.handlers.delete(fn);
    }
}
function harness() {
    let nextId = 0;
    const timers = new Map(); const callbacks = []; const order = [];
    const document = new Target(); document.getElementById = () => null;
    const window = new Target(); window.LibertyDebug = { log() {} };
    const context = vm.createContext({ window, document, console, navigator: {}, Artplayer: { version: '5.3.0', DBCLICK_TIME: 300 }, isMobileDevice: true,
        setTimeout(fn, delay) { const id = ++nextId; timers.set(id, { fn, delay }); callbacks.push(fn); return id; },
        setInterval(fn, delay) { const id = ++nextId; timers.set(id, { fn, delay }); return id; },
        clearTimeout(id) { timers.delete(id); }, clearInterval(id) { timers.delete(id); },
        cleanupPlayerShortcuts() {}, danmuDebugLog() {},
        danmuReloadToken: 0, _danmuFetchController: { cancelled: false },
        hlsPlaybackGeneration: 0, currentHls: null,
    });
    window.setTimeout = context.setTimeout;
    vm.runInContext(`let videoPlayer = null; ${playerClass}
        globalThis.create = () => videoPlayer = new VideoPlayer('player');
        globalThis.clearPlayer = () => { videoPlayer = null; };
        globalThis.scheduleLog = playerSession => { ${source.match(/playerSession\.setTimer\('logStatus'.*;/)[0]} };`, context);
    const create = () => {
        const player = context.create();
        player.releaseWakeLock = () => order.push('wake-release');
        const destroyHls = player.destroyHls.bind(player);
        player.destroyHls = () => { order.push('hls-destroy'); destroyHls(); };
        return player;
    };
    return { context, create, window, document, timers, callbacks, order,
        advance(ms) { for (const [id, timer] of [...timers]) if (timer.delay <= ms) { timers.delete(id); timer.fn(); } } };
}
function artMock(order) {
    const events = new Map();
    return {
        isDestroy: false, video: { pause() {}, removeAttribute() {}, load() {} },
        on(type, fn) { if (!events.has(type)) events.set(type, new Set()); events.get(type).add(fn); },
        off(type, fn) { assert.ok(fn, 'do not blanket-remove plugin destroy hooks'); events.get(type)?.delete(fn); },
        emit(type) { for (const fn of [...(events.get(type) || [])]) fn(); },
        destroy() { this.isDestroy = true; order.push('art-destroy'); this.emit('destroy'); },
    };
}

for (const replacement of ['null', 'B']) {
    test(`logStatus timer is cancelled on A destroy and queued callback cannot touch ${replacement}`, () => {
        const h = harness(); const a = h.create(); let aCalls = 0; let bCalls = 0;
        a.logStatus = () => aCalls++;
        h.context.scheduleLog(a);
        const queued = h.callbacks.at(-1);
        a.destroy(); h.context.clearPlayer();
        if (replacement === 'B') h.create().logStatus = () => bCalls++;
        assert.equal(h.timers.size, 0);
        h.advance(1100); queued();
        assert.equal(aCalls, 0); assert.equal(bCalls, 0);
    });
}

test('current logStatus still runs once; completed timer relinquishes ownership', () => {
    const h = harness(); const player = h.create(); let calls = 0;
    player.logStatus = () => calls++;
    h.context.scheduleLog(player); h.advance(1100); h.advance(1100);
    assert.equal(calls, 1); assert.equal(player.timers.logStatus, null);
});

test('five player sessions release history/window/document/video listeners and intervals', () => {
    const h = harness(); const video = new Target(); let calls = 0;
    for (let i = 0; i < 5; i++) {
        const player = h.create(); player.art = artMock(h.order);
        for (const [target, type] of [[h.window, 'beforeunload'], [h.document, 'visibilitychange'], [video, 'timeupdate']]) {
            player.addEventListener(target, type, () => calls++, true);
        }
        player.addArtEventListener('video:pause', () => calls++);
        player.addArtEventListener('video:ended', () => calls++);
        player.setTimer('autoSaveHistory', () => calls++, 180000, true);
        const queued = [...h.window.handlers.keys(), ...h.document.handlers.keys(), ...video.handlers.keys()];
        player.destroy(); player.destroy();
        assert.equal(h.window.handlers.size + h.document.handlers.size + video.handlers.size, 0);
        assert.equal(h.timers.size, 0);
        queued.forEach(fn => fn());
    }
    assert.equal(calls, 0);
});

test('explicit cleanup precedes HLS/Art destroy, stays idempotent and preserves plugin destroy', () => {
    const h = harness(); const player = h.create(); player.art = artMock(h.order);
    let pluginCleanups = 0;
    player.art.on('destroy', () => pluginCleanups++);
    player.addLifecycleCleanup(() => h.order.push('owned-cleanup'));
    player.destroy(); player.destroy(); player.cleanupLifecycle();
    assert.equal(pluginCleanups, 1);
    assert.ok(h.order.indexOf('owned-cleanup') < h.order.indexOf('hls-destroy'));
    assert.ok(h.order.indexOf('hls-destroy') < h.order.indexOf('art-destroy'));
    assert.equal(h.context._danmuFetchController.cancelled, true);
});

test('late A ready/video events cannot modify B or register new resources', () => {
    const h = harness(); const a = h.create(); a.art = artMock(h.order); let updates = 0;
    const ready = a.addArtEventListener('ready', () => { updates++; a.setTimer('late', () => updates++, 1000); });
    const pause = a.addArtEventListener('video:pause', () => updates++);
    a.destroy(); const b = h.create();
    ready(); pause(); h.advance(2000);
    assert.equal(updates, 0); assert.equal(h.timers.size, 0); assert.equal(b.destroyed, false);
});

test('cleanup also works for partially initialized player with no ArtPlayer', () => {
    const h = harness(); const player = h.create();
    player.addEventListener(h.document, 'visibilitychange', () => {});
    h.context.scheduleLog(player);
    player.destroy();
    assert.equal(h.document.handlers.size, 0); assert.equal(h.timers.size, 0);
    assert.equal(player.destroyed, true);
});

test('ten fullscreen scopes preserve callback identity/capture and release only after vendor destroy', () => {
    const h = harness(); const unrelated = () => {};
    h.document.addEventListener('fullscreenchange', unrelated, true);
    const originalAdd = h.document.addEventListener;
    for (let i = 0; i < 10; i++) {
        const player = h.create(); const instance = player.art = artMock(h.order);
        const originalEmit = instance.emit;
        const change = () => {}; const error = () => {}; const capture = { capture: true };
        instance.on('video:loadedmetadata', () => {
            h.document.addEventListener('fullscreenchange', change, capture);
            h.document.addEventListener('fullscreenerror', error, false);
        });
        let vendorCleanup = 0;
        instance.on('destroy', () => {
            assert.equal(h.document.handlers.size, 3, 'vendor destroy hooks must run intact');
            vendorCleanup++;
        });
        player.trackArtFullscreenListeners(); instance.emit('video:loadedmetadata');
        assert.equal(instance.emit, originalEmit);
        assert.equal(h.document.addEventListener, originalAdd);
        assert.equal(h.document.handlers.get(change).options, capture);
        player.destroy(); player.destroy();
        assert.equal(vendorCleanup, 1);
        assert.equal(h.document.handlers.size, 1);
        assert.ok(h.document.handlers.has(unrelated));
    }
});

test('fullscreen scope restores document registration on metadata error and destroy before metadata', () => {
    const h = harness(); const originalAdd = h.document.addEventListener;
    const player = h.create(); const instance = player.art = artMock(h.order);
    const originalEmit = instance.emit;
    instance.on('video:loadedmetadata', () => {
        h.document.addEventListener('webkitfullscreenchange', () => {}, true);
        throw new Error('metadata probe');
    });
    player.trackArtFullscreenListeners();
    assert.throws(() => instance.emit('video:loadedmetadata'), /metadata probe/);
    assert.equal(h.document.addEventListener, originalAdd);
    assert.equal(instance.emit, originalEmit);
    player.destroy(); assert.equal(h.document.handlers.size, 0);
    const b = h.create(); b.art = artMock(h.order); const bArt = b.art; const bEmit = bArt.emit;
    b.trackArtFullscreenListeners(); b.destroy();
    assert.equal(bArt.emit, bEmit); assert.equal(h.document.handlers.size, 0);
});

test('fullscreen shim does not wrap other ArtPlayer versions', () => {
    const h = harness(); h.context.Artplayer.version = 'future';
    const player = h.create(); player.art = artMock(h.order); const emit = player.art.emit;
    player.trackArtFullscreenListeners(); assert.equal(player.art.emit, emit); player.destroy();
});

test('ten coexisting fullscreen scopes remove only their own callback identities', () => {
    const h = harness(); const unrelatedChange = () => {}; const unrelatedError = () => {};
    h.document.addEventListener('fullscreenchange', unrelatedChange, false);
    h.document.addEventListener('fullscreenerror', unrelatedError, false);
    const players = [];
    for (let i = 0; i < 10; i++) {
        const player = h.create(); const instance = player.art = artMock(h.order);
        const change = () => {}; const error = () => {};
        instance.on('video:loadedmetadata', () => {
            h.document.addEventListener('fullscreenchange', change, false);
            h.document.addEventListener('fullscreenerror', error, false);
        });
        player.trackArtFullscreenListeners(); instance.emit('video:loadedmetadata');
        players.push({ player, change, error });
    }
    assert.equal(h.document.handlers.size, 22);
    players.forEach(({ player, change, error }, i) => {
        player.destroy(); player.destroy();
        assert.equal(h.document.handlers.has(change), false); assert.equal(h.document.handlers.has(error), false);
        assert.equal(h.document.handlers.size, 2 + (9 - i) * 2);
        assert.ok(h.document.handlers.has(unrelatedChange) && h.document.handlers.has(unrelatedError));
        for (const remaining of players.slice(i + 1)) {
            assert.ok(h.document.handlers.has(remaining.change) && h.document.handlers.has(remaining.error));
        }
    });
});

function gestureHarness() {
    const h = harness();
    const container = { oncontextmenu: null, appendChild() {}, querySelectorAll: () => [] };
    h.document.getElementById = () => container;
    h.document.createElement = () => ({ style: {}, remove() {} });
    const gestures = source.slice(source.indexOf('function setupMobileTouchSchemeA()'), source.indexOf('// 清除视频进度记录'));
    vm.runInContext(`let art = null; let _longPressHandlers = null; let _mobileTouchInputHandlers = null; let _mobileLongPressTriggered = false;
        ${gestures}
        globalThis.bindGestures = player => { art = player.art; setupMobileTouchSchemeA(); setupLongPressSpeedControl(); };
        globalThis.gestureReferencesCleared = () => !_longPressHandlers && !_mobileTouchInputHandlers;`, h.context);
    h.createGesturePlayer = () => {
        const player = h.create(); player.art = artMock(h.order);
        player.art.video = Object.assign(new Target(), { paused: false, playbackRate: 1, closest: () => null, pause() {}, removeAttribute() {}, load() {} });
        return player;
    };
    return h;
}

test('ten gesture sessions explicitly release all touch/pause/ended listeners on captured old videos', () => {
    const h = gestureHarness();
    for (let i = 0; i < 10; i++) {
        const player = h.createGesturePlayer(); const video = player.art.video;
        h.context.bindGestures(player); assert.equal(video.handlers.size, 10);
        h.context.bindGestures(player); assert.equal(video.handlers.size, 10, 'rebind is not additive');
        player.destroy(); player.destroy();
        assert.equal(video.handlers.size, 0); assert.equal(player.eventListeners.size, 0);
        assert.equal(player.lifecycleCleanups.size, 0); assert.equal(h.timers.size, 0);
        assert.equal(h.context.gestureReferencesCleared(), true);
    }
});

test('gesture replacement cleans A target, preserves B and ignores queued A handlers', () => {
    const h = gestureHarness(); const a = h.createGesturePlayer(); const aVideo = a.art.video;
    h.context.bindGestures(a); const queued = [...aVideo.handlers.keys()];
    const b = h.createGesturePlayer(); const bVideo = b.art.video;
    h.context.bindGestures(b);
    assert.equal(aVideo.handlers.size, 0); assert.equal(bVideo.handlers.size, 10);
    a.destroy(); queued.forEach(fn => fn({}));
    assert.equal(bVideo.handlers.size, 10); assert.equal(bVideo.playbackRate, 1);
    assert.equal(h.timers.size, 0); b.destroy(); assert.equal(bVideo.handlers.size, 0);
});

test('gesture destroy cancels pending tap/long-press timers and restores a held playback rate', () => {
    const h = gestureHarness(); const player = h.createGesturePlayer(); const video = player.art.video;
    h.context.bindGestures(player);
    const event = { target: video, touches: [{ clientX: 0, clientY: 0 }], preventDefault() {}, stopPropagation() {} };
    for (const [fn, entry] of video.handlers) if (entry.type === 'touchstart') fn(event);
    h.advance(500); assert.equal(video.playbackRate, 3);
    player.destroy(); assert.equal(video.playbackRate, 1); assert.equal(h.timers.size, 0);
    const b = h.createGesturePlayer(); h.context.bindGestures(b);
    for (const [fn, entry] of b.art.video.handlers) if (entry.type === 'touchend') fn(event);
    assert.ok(h.timers.size > 0, 'single tap timer scheduled');
    b.destroy(); assert.equal(h.timers.size, 0);
});

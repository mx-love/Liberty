import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

function harness(withController = true) {
    let id = 0;
    const timers = new Map();
    const storage = new Map();
    const listeners = new Map();
    const video = {
        currentTime: 0, duration: 300, playbackRate: 1, paused: true, readyState: 4,
        play() { this.paused = false; return Promise.resolve(); }, pause() { this.paused = true; },
        addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
        removeEventListener(name, fn) { listeners.get(name)?.delete(fn); }, closest() { return true; },
    };
    class Socket {
        static OPEN = 1; static CONNECTING = 0;
        static instances = [];
        constructor(url, protocols) { this.url = url; this.protocols = protocols; this.readyState = 0; this.handlers = {}; this.sent = []; Socket.instances.push(this); }
        addEventListener(name, handler) { this.handlers[name] = handler; }
        emit(name, event = {}) { if (name === 'open') this.readyState = 1; return this.handlers[name]?.(event); }
        send(data) { this.sent.push(JSON.parse(data)); }
        close() { this.readyState = 3; }
    }
    const context = vm.createContext({
        console, URL, URLSearchParams, performance, WebSocket: Socket,
        LibertyDebug: { enabled: () => false, log() {}, warn() {} },
        location: { pathname: '/player.html', protocol: 'http:', host: 'localhost', search: '' },
        setTimeout(fn, ms) { const key = ++id; timers.set(key, { fn, ms, interval: false }); return key; },
        setInterval(fn, ms) { const key = ++id; timers.set(key, { fn, ms, interval: true }); return key; },
        clearTimeout(key) { timers.delete(key); }, clearInterval(key) { timers.delete(key); },
        addEventListener() {}, removeEventListener() {}, showToast() {},
        document: {
            hidden: false, addEventListener() {}, removeEventListener() {},
            querySelector: () => video, querySelectorAll: () => [video],
            getElementById: name => name === 'watchRoomModal' ? { classList: { contains: () => true, add() {} } } : null,
        },
        sessionStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
        localStorage: { getItem: () => null },
        LibertyPlayer: { art: { video } },
    });
    context.window = context;
    for (const file of ['sync-clock', 'player-adapter', ...(withController ? ['controller'] : [])]) {
        vm.runInContext(readFileSync(new URL(`../js/watch-room/${file}.js`, import.meta.url), 'utf8'), context);
    }
    // Test-only visibility into the existing IIFE; no production debugging exports.
    const ui = readFileSync(new URL('../js/watch-room/ui.js', import.meta.url), 'utf8');
    vm.runInContext(ui.replace(/\}\)\(\);\s*$/, `
        window.audit = { setActiveRoom, connectRoomSocket, retrySocketNow, handlePageExit, clearRoomState,
            setupPlayerSyncForRoom, enterHostWaitingMode, areAllViewersReady,
            state: () => ({ activeRoom, reconnectTimer, reconnectAttempt, hostSyncTimer, boundGateVideo, watchRoomController }) };
    })();`), context);
    return { context, video, timers, listeners, Socket, audit: context.audit,
        tick() { for (const [key, timer] of [...timers]) { if (!timer.interval) { timers.delete(key); timer.fn(); } } } };
}

test('host UI quorum excludes disconnected viewers without marking them ready', () => {
    const h = harness();
    const participants = [{ id: 'a', role: 'viewer', connected: true, ready: false },
        { id: 'b', role: 'viewer', connected: false, ready: false }];
    h.audit.setActiveRoom({ roomId: '12345678', role: 'host', participants });
    assert.equal(h.audit.areAllViewersReady(), false);
    participants[0].ready = true;
    assert.equal(h.audit.areAllViewersReady(), true);
    assert.equal(participants[1].ready, false);
});

test('Controller owns the only host interval and legacy fallback is isolated; cleanup removes both', () => {
    for (const enabled of [true, false]) {
        const h = harness(enabled);
        h.audit.setActiveRoom({ roomId: '12345678', clientId: 'host-1', role: 'host', status: 'playing', connectionState: 'connected' });
        h.audit.setupPlayerSyncForRoom(); h.audit.setupPlayerSyncForRoom();
        assert.equal([...h.timers.values()].filter(x => x.interval).length, 1);
        assert.equal(Boolean(h.audit.state().hostSyncTimer), !enabled);
        if (enabled) assert.equal(h.audit.state().boundGateVideo, null);
        h.audit.clearRoomState();
        assert.equal([...h.timers.values()].filter(x => x.interval).length, 0);
        assert.equal([...h.listeners.values()].reduce((sum, set) => sum + set.size, 0), 0);
    }
});

test('reconnect is single-flight, online cancels timer, and permanent auth failure stops retries', () => {
    const h = harness();
    h.audit.setActiveRoom({ roomId: '12345678', clientId: 'host-1', role: 'host', status: 'waiting' });
    h.audit.connectRoomSocket('12345678', 'host', 'host-1', 'a'.repeat(64));
    const a = h.Socket.instances[0]; a.emit('open');
    assert.equal(a.protocols, undefined);
    assert.equal(a.sent[0].type, 'client:resume');
    assert.ok(!a.url.includes('aaaa'));
    a.emit('close', { code: 1006 });
    const timer = h.audit.state().reconnectTimer;
    assert.ok(timer);
    h.audit.retrySocketNow(); h.audit.retrySocketNow();
    assert.equal(h.Socket.instances.length, 2);
    assert.equal(h.timers.has(timer), false);
    const b = h.Socket.instances[1]; b.emit('close', { code: 4003 });
    h.audit.retrySocketNow(); h.tick();
    assert.equal(h.Socket.instances.length, 2);
    assert.equal(h.audit.state().activeRoom, null);
});

test('leave, pagehide, room switch and stale close cannot revive an old room', () => {
    for (const action of ['leave', 'pagehide', 'switch']) {
        const h = harness();
        h.audit.setActiveRoom({ roomId: '12345678', clientId: 'v', role: 'viewer', status: 'waiting' });
        h.audit.connectRoomSocket('12345678', 'viewer', 'v');
        const socket = h.Socket.instances[0]; socket.emit('close', { code: 1006 });
        if (action === 'leave') h.audit.clearRoomState();
        if (action === 'pagehide') h.audit.handlePageExit();
        if (action === 'switch') h.audit.setActiveRoom({ roomId: '87654321', role: 'viewer', status: 'waiting' });
        socket.emit('close', { code: 1006 });
        h.tick();
        assert.equal(h.Socket.instances.length, 1, action);
        h.audit.clearRoomState();
    }
});

test('late join loads episode 3 before exactly one paused/playing alignment; superseded room is ignored', async () => {
    for (const paused of [true, false]) {
        const h = harness();
        let ready;
        const calls = [];
        const player = new h.context.LibertyWatchRoom.PlayerAdapter();
        player.ensureMediaSnapshot = snapshot => { calls.push(`load:${snapshot.episodeIndex}`); return new Promise(resolve => { ready = resolve; }); };
        player.applyPlayback = async (playback, options) => { calls.push(`apply:${playback.currentTime}:${options.shouldPlay}`); return { success: true }; };
        const controller = new h.context.LibertyWatchRoom.Controller({ player });
        controller.setContext({ roomId: '12345678', role: 'viewer', connected: true });
        const playback = { currentTime: 120, paused, playbackRate: 1, serverTimestamp: 1000 };
        const load = controller.dispatch({ type: 'room:state', payload: { status: 'playing', media: { episodeIndex: 2 }, playback } });
        const start = controller.dispatch({ type: 'sync:start', payload: playback });
        assert.deepEqual(calls, ['load:2']);
        ready({ success: true });
        await load; await start;
        assert.deepEqual(calls, ['load:2', `apply:120:${!paused}`]);
        controller.cleanupLocalState();
        assert.equal(h.timers.size, 0);
    }
});

test('adapter waits for media ready, computes target late and cancels pending work on cleanup', async () => {
    const h = harness();
    const adapter = new h.context.LibertyWatchRoom.PlayerAdapter();
    h.video.readyState = 0;
    const apply = adapter.applyPlayback({ currentTime: 120, paused: true }, { forceSeek: true });
    assert.equal(h.video.currentTime, 0);
    h.video.readyState = 4; h.tick();
    assert.equal((await apply).success, true);
    assert.equal(h.video.currentTime, 120);
    h.video.readyState = 0;
    const stale = adapter.applyPlayback({ currentTime: 200 }, { forceSeek: true });
    adapter.cancelPending();
    assert.equal((await stale).superseded, true);
    assert.equal(h.timers.size, 0);
    assert.equal(h.video.currentTime, 120);
});

test('old episode ready cannot acknowledge a newer episode or a room already left', async () => {
    const h = harness();
    const pending = [];
    const sent = [];
    const player = new h.context.LibertyWatchRoom.PlayerAdapter();
    player.loadEpisodeSnapshot = () => new Promise(resolve => pending.push(resolve));
    const controller = new h.context.LibertyWatchRoom.Controller({ player, socketSend: x => sent.push(x) });
    controller.setContext({ roomId: '12345678', role: 'viewer', connected: true });
    const old = controller.handleSyncEpisodePrepare({ changeId: 'old', episodeIndex: 1 });
    await Promise.resolve();
    const newer = controller.handleSyncEpisodePrepare({ changeId: 'new', episodeIndex: 2 });
    await Promise.resolve();
    pending[0]({ success: true }); await old;
    assert.equal(sent.length, 0);
    controller.cleanupLocalState();
    pending[1]({ success: true }); await newer;
    assert.equal(sent.length, 0);
    assert.equal(h.timers.size, 0);
});

test('duplicate and reordered room state/start messages align once after latest media readiness', async () => {
    for (const reversed of [true, false]) {
        const h = harness();
        const calls = []; let finish;
        const player = new h.context.LibertyWatchRoom.PlayerAdapter();
        player.ensureMediaSnapshot = () => { calls.push('load:3'); return new Promise(resolve => { finish = resolve; }); };
        player.applyPlayback = async (_p, options) => { calls.push(`align:${options.shouldPlay}`); return { success: true }; };
        const controller = new h.context.LibertyWatchRoom.Controller({ player });
        controller.setContext({ roomId: '12345678', role: 'viewer', connected: true });
        const playback = { currentTime: 120, paused: true, serverTimestamp: 1000, playbackRate: 1 };
        const state = { type: 'room:state', payload: { status: 'playing', media: { episodeIndex: 2 }, playback } };
        const sync = { type: 'sync:start', payload: playback };
        if (reversed) controller.dispatch(sync);
        const loading = controller.dispatch(state);
        controller.dispatch(state); controller.dispatch(sync); controller.dispatch(sync);
        assert.deepEqual(calls, ['load:3']);
        // Late old episode events cannot resolve the authoritative loader's generation.
        for (const name of ['canplay', 'loadedmetadata']) {
            for (const fn of h.listeners.get(name) || []) fn();
        }
        assert.deepEqual(calls, ['load:3']);
        finish({ success: true }); await loading;
        await controller.dispatch(sync); await controller.dispatch(state);
        assert.deepEqual(calls, ['load:3', 'align:false']);
        controller.cleanupLocalState();
    }
});

test('already-correct episode does not reload; unready current episode is awaited', async () => {
    const h = harness();
    const player = new h.context.LibertyWatchRoom.PlayerAdapter();
    h.context.LibertyPlayer.buildWatchRoomEpisodeSnapshot = () => ({ episodeIndex: 2, episodeUrl: '/3.m3u8' });
    let loads = 0;
    player.loadEpisodeSnapshot = async () => { loads += 1; return { success: true }; };
    const snapshot = { episodeIndex: 2, episodeUrl: '/3.m3u8' };
    assert.equal((await player.ensureMediaSnapshot(snapshot)).success, true);
    h.video.readyState = 0;
    const pending = player.ensureMediaSnapshot(snapshot);
    assert.equal(h.timers.size, 1);
    h.video.readyState = 4; h.tick();
    assert.equal((await pending).success, true);
    assert.equal(loads, 0);
});

test('new episode generation invalidates old loader readiness before aligning current episode', async () => {
    const h = harness(); const loaders = []; const applied = [];
    const player = new h.context.LibertyWatchRoom.PlayerAdapter();
    h.context.LibertyPlayer.loadEpisodeFromWatchRoomSnapshot = (snapshot, options) => new Promise(resolve => loaders.push({ snapshot, options, resolve }));
    player.applyPlayback = async playback => { applied.push(playback.currentTime); return { success: true }; };
    const controller = new h.context.LibertyWatchRoom.Controller({ player });
    controller.setContext({ roomId: '12345678', role: 'viewer', connected: true });
    const state = index => ({ type: 'room:state', payload: { status: 'playing', media: { episodeIndex: index, episodeUrl: `/${index}.m3u8` }, playback: { currentTime: index * 60, paused: false, serverTimestamp: index * 1000 } } });
    const old = controller.dispatch(state(1));
    const current = controller.dispatch(state(2));
    assert.equal(loaders[0].options.isCurrent(), false);
    loaders[0].resolve(); await old;
    assert.equal(applied.length, 0);
    assert.equal(loaders[1].options.isCurrent(), true);
    loaders[1].resolve(); await current;
    assert.deepEqual(applied, [120]);
    controller.cleanupLocalState();
});

test('failed Controller construction releases partial adapter resources before legacy fallback', () => {
    const h = harness();
    h.context.LibertyWatchRoom.Controller = class {
        constructor({ player }) { player.observeBuffering(() => {}); throw new Error('injected constructor failure'); }
    };
    h.audit.setActiveRoom({ roomId: '12345678', clientId: 'host-1', role: 'host', status: 'playing', connectionState: 'connected' });
    assert.equal(h.audit.state().watchRoomController, null);
    assert.ok(h.audit.state().hostSyncTimer);
    assert.equal([...h.timers.values()].filter(x => x.interval).length, 1);
    h.audit.clearRoomState();
    assert.equal([...h.listeners.values()].reduce((sum, set) => sum + set.size, 0), 0);
});

test('duplicate episode-prepare keeps the original media-ready barrier', async () => {
    const h = harness(); let ready; let applies = 0;
    const player = new h.context.LibertyWatchRoom.PlayerAdapter();
    player.loadEpisodeSnapshot = () => new Promise(resolve => { ready = resolve; });
    player.applyPlayback = async () => { applies++; return { success: true }; };
    const controller = new h.context.LibertyWatchRoom.Controller({ player });
    controller.setContext({ roomId: '12345678', role: 'viewer', connected: true });
    const message = { type: 'sync:episode-prepare', payload: { changeId: '3', episodeIndex: 2 } };
    const load = controller.dispatch(message); await Promise.resolve();
    controller.dispatch(message);
    controller.dispatch({ type: 'sync:episode-start', payload: { changeId: '3', playback: { currentTime: 0, paused: true } } });
    assert.equal(applies, 0);
    ready({ success: true }); await load;
    assert.equal(applies, 1);
    controller.cleanupLocalState();
});

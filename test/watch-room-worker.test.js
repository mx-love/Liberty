import test from 'node:test';
import assert from 'node:assert/strict';

await import('../js/watch-room/sync-clock.js');
import {
    WatchRoomDurableObject,
    ensureRoomDeadlines,
    getNextRoomDeadline,
    hashResumeToken,
    normalizePlaybackPayload,
    verifyHostResumeToken,
} from '../workers/watch-room/index.js';

const { computeTargetPlaybackTime } = globalThis.LibertyWatchRoomClock;

function createMockSocket() {
    const listeners = new Map();
    return {
        messages: [],
        closed: false,
        addEventListener(type, handler) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(handler); },
        removeEventListener(type, handler) { listeners.get(type)?.delete(handler); },
        async emit(type, event = {}) { for (const handler of [...(listeners.get(type) || [])]) await handler(event); },
        send(message) { this.messages.push(JSON.parse(message)); },
        close(code) { this.closed = true; this.closeCode = code; },
    };
}

function createMockState(room) {
    const storage = {
        room,
        alarm: null,
        alarmHistory: [],
        async get(key) { return key === 'room' ? this.room : undefined; },
        async put(key, value) { if (key === 'room') this.room = value; },
        async setAlarm(value) { this.alarm = value; this.alarmHistory.push(value); },
        async deleteAlarm() { this.alarm = null; },
    };
    return { storage };
}

function playingRoom() {
    const timestamp = Date.now();
    return {
        roomId: '12345678',
        status: 'playing',
        hostId: 'host-1',
        maxMembers: 10,
        participants: {
            'host-1': { id: 'host-1', role: 'host', ready: true, connected: true, joinedAt: timestamp, lastSeenAt: timestamp, connectionId: 'host-connection-1' },
            'viewer-1': { id: 'viewer-1', role: 'viewer', ready: true, connected: true, joinedAt: timestamp, lastSeenAt: timestamp, connectionId: 'viewer-connection-1' },
        },
        playback: { paused: false, currentTime: 10, duration: 100, playbackRate: 1, updatedAt: timestamp, serverTimestamp: timestamp },
        media: { episodeIndex: 1, episodeName: '第12集' },
        deadlines: {
            startDeadlineAt: null,
            episodeDeadlineAt: null,
            hostReconnectDeadlineAt: null,
            roomExpireAt: null,
        },
        createdAt: timestamp,
        updatedAt: timestamp,
    };
}

function attachSession(object, socket, clientId, role, connectionId) {
    object.sessions.set(socket, { clientId, role, connectionId });
}

test('disconnected viewer identity reservations do not block online ready barriers', () => {
    const room = playingRoom();
    room.participants['host-1'].startingReady = true;
    room.participants['viewer-1'].connected = false;
    room.participants['viewer-1'].ready = false;
    room.participants['viewer-1'].startingReady = false;
    const object = new WatchRoomDurableObject(createMockState(room), {});
    assert.equal(object.areViewersReady(room), true);
    assert.equal(object.areStartingClientsReady(room), true);
    room.participants['viewer-1'].connected = true;
    assert.equal(object.areViewersReady(room), false);
    assert.equal(object.areStartingClientsReady(room), false);
});

test('online not-ready viewer blocks; ready or disconnected permits starting without losing resume identity', async () => {
    const room = playingRoom(); room.status = 'waiting';
    const object = new WatchRoomDurableObject(createMockState(room), {});
    const viewer = createMockSocket();
    const identity = room.participants['viewer-1'];
    identity.ready = false;
    identity.resumeTokenHash = await hashResumeToken('a'.repeat(64));
    attachSession(object, viewer, identity.id, 'viewer', identity.connectionId);
    assert.equal(object.areViewersReady(room), false);
    identity.ready = true;
    assert.equal(object.areViewersReady(room), true);
    identity.ready = false;
    await object.handleSocketClose(viewer);
    assert.equal(object.areViewersReady(room), true);
    assert.equal(identity.ready, false);
    assert.equal(identity.connected, false);
    assert.equal(room.participants[identity.id].resumeTokenHash, await hashResumeToken('a'.repeat(64)));
});

test('last unready viewer disconnect advances an existing starting barrier', async () => {
    const room = playingRoom(); room.status = 'starting';
    room.participants['host-1'].startingReady = true;
    room.participants['viewer-1'].resumeTokenHash = await hashResumeToken('a'.repeat(64));
    const object = new WatchRoomDurableObject(createMockState(room), {});
    const viewer = createMockSocket();
    attachSession(object, viewer, 'viewer-1', 'viewer', 'viewer-connection-1');
    await object.handleSocketClose(viewer);
    assert.equal(room.status, 'playing');
    assert.equal(room.participants['viewer-1'].startingReady, false);
});

for (const status of ['waiting', 'starting', 'playing']) {
    test(`credentialed viewer reconnect resumes ${status} through authoritative state and proper handshake`, async () => {
        const room = playingRoom(); room.status = status;
        const token = 'a'.repeat(64);
        room.participants['viewer-1'].resumeTokenHash = await hashResumeToken(token);
        room.participants['viewer-1'].ready = false;
        room.participants['viewer-1'].connected = false;
        room.participants['viewer-1'].disconnectedAt = Date.now();
        const object = new WatchRoomDurableObject(createMockState(room), {});
        const socket = createMockSocket();
        object.awaitParticipantAuthentication(socket, room.roomId, 'viewer-1', 'viewer');
        await socket.emit('message', { data: JSON.stringify({ type: 'client:resume', roomId: room.roomId, clientId: 'viewer-1', resumeToken: token }) });
        assert.equal(room.participants['viewer-1'].connected, true);
        assert.equal(room.participants['viewer-1'].ready, false);
        assert.equal(room.participants['viewer-1'].disconnectedAt, undefined);
        assert.ok(socket.messages.some(message => message.type === 'room:state'));
        assert.ok(socket.messages.some(message => message.type === (status === 'playing' ? 'sync:start' : 'sync:prepare')));
    });
}

test('shared durable alarm expires disconnected viewer after 60s, preserves reconnects and frees capacity', async () => {
    const room = playingRoom();
    const state = createMockState(room);
    const object = new WatchRoomDurableObject(state, {});
    room.participants['viewer-1'].resumeTokenHash = await hashResumeToken('a'.repeat(64));
    const socket = createMockSocket();
    attachSession(object, socket, 'viewer-1', 'viewer', 'viewer-connection-1');
    await object.handleSocketClose(socket);
    assert.ok(state.storage.alarm >= Date.now() + 59000);
    await object.alarm(); // Early alarm must not evict the short-lived reservation.
    assert.ok(room.participants['viewer-1']);
    room.participants['viewer-1'].disconnectedAt = Date.now() - 61000;
    await object.scheduleNextAlarm(room);
    await object.alarm();
    assert.equal(room.participants['viewer-1'], undefined);
    assert.equal(state.storage.alarm, null);
    assert.equal(Object.keys(room.participants).length, 1);
    await object.alarm();
    assert.equal(room.status, 'playing');
});

test('viewer cleanup survives cold restart and reschedules remaining reservations', async () => {
    const room = playingRoom();
    Object.assign(room.participants['viewer-1'], { connected: false, disconnectedAt: Date.now() - 61000 });
    room.participants['viewer-2'] = { id: 'viewer-2', role: 'viewer', connected: false, disconnectedAt: Date.now() - 1000 };
    room.deadlines.viewerCleanupDeadlineAt = null; // Snapshot predating the latest alarm calculation.
    const state = createMockState(structuredClone(room));
    const restarted = new WatchRoomDurableObject(state, {});
    await restarted.alarm();
    assert.equal(state.storage.room.participants['viewer-1'], undefined);
    assert.ok(state.storage.room.participants['viewer-2']);
    assert.ok(state.storage.alarm > Date.now());
    state.storage.room.participants['viewer-2'].disconnectedAt = Date.now() - 61000;
    await new WatchRoomDurableObject(state, {}).alarm();
    assert.equal(state.storage.room.participants['viewer-2'], undefined);
    assert.equal(state.storage.alarm, null);
});

test('watch-room playback uses authoritative server time instead of host wall clock', () => {
    const playback = normalizePlaybackPayload('host:play', { currentTime: 12, playbackRate: 1, updatedAt: 1 }, {}, 123456);
    assert.equal(playback.currentTime, 12);
    assert.equal(playback.updatedAt, 123456);
    assert.equal(playback.serverTimestamp, 123456);
    assert.equal(playback.clientUpdatedAt, 1);
});

test('watch-room playback clamps unsafe numeric ranges', () => {
    const playback = normalizePlaybackPayload('host:sync', {
        currentTime: Number.POSITIVE_INFINITY,
        duration: -10,
        playbackRate: 100,
    }, { currentTime: 8, duration: 100, playbackRate: 1, paused: false }, 2000);
    assert.equal(playback.currentTime, 8);
    assert.equal(playback.duration, 0);
    assert.equal(playback.playbackRate, 4);
    assert.equal(playback.paused, false);
});

test('negative seek and zero playback rate are clamped', () => {
    const playback = normalizePlaybackPayload('host:seek', {
        currentTime: -999,
        playbackRate: 0,
        paused: false,
    }, { currentTime: 20, playbackRate: 1, paused: true }, 3000);
    assert.equal(playback.currentTime, 0);
    assert.equal(playback.playbackRate, 0.25);
    assert.equal(playback.paused, false);
});

test('target media time advances only while playing and uses server time', () => {
    assert.equal(computeTargetPlaybackTime({
        hostCurrentTime: 10, hostPlaybackRate: 1.5, serverTimestamp: 1000, estimatedServerNow: 3000, paused: false,
    }), 13);
    assert.equal(computeTargetPlaybackTime({
        hostCurrentTime: 10, hostPlaybackRate: 1.5, serverTimestamp: 1000, estimatedServerNow: 9000, paused: true,
    }), 10);
    assert.equal(computeTargetPlaybackTime({
        hostCurrentTime: 99, hostPlaybackRate: 1, serverTimestamp: 1000, estimatedServerNow: 5000, paused: false, duration: 100,
    }), 99);
});

test('host resume token is verified and wrong tokens fail', async () => {
    const token = 'a'.repeat(64);
    const room = { hostResumeTokenHash: await hashResumeToken(token) };
    assert.equal(await verifyHostResumeToken(room, token), true);
    assert.equal(await verifyHostResumeToken(room, 'b'.repeat(64)), false);
    assert.equal(await verifyHostResumeToken(room, ''), false);
});

test('unified alarm scheduler selects the earliest non-null deadline', async () => {
    const room = playingRoom();
    const timestamp = Date.now();
    room.deadlines = {
        startDeadlineAt: timestamp + 4000,
        episodeDeadlineAt: timestamp + 2000,
        hostReconnectDeadlineAt: timestamp + 8000,
        roomExpireAt: timestamp + 12000,
    };
    const state = createMockState(room);
    const object = new WatchRoomDurableObject(state, {});
    assert.equal(getNextRoomDeadline(room), timestamp + 2000);
    await object.scheduleNextAlarm(room);
    assert.equal(state.storage.alarm, timestamp + 2000);
});

test('legacy deadline fields migrate once into the unified deadline object', () => {
    const room = { startTransitionDeadlineAt: 100, hostReconnectDeadlineAt: 200 };
    const deadlines = ensureRoomDeadlines(room);
    assert.equal(deadlines.startDeadlineAt, 100);
    assert.equal(deadlines.hostReconnectDeadlineAt, 200);
    assert.equal('startTransitionDeadlineAt' in room, false);
    assert.equal('hostReconnectDeadlineAt' in room, false);
});

test('host disconnect enters a durable grace period instead of ending the room', async () => {
    const state = createMockState(playingRoom());
    const object = new WatchRoomDurableObject(state, {});
    const hostSocket = createMockSocket();
    const viewerSocket = createMockSocket();
    attachSession(object, hostSocket, 'host-1', 'host', 'host-connection-1');
    attachSession(object, viewerSocket, 'viewer-1', 'viewer', 'viewer-connection-1');

    await object.removeParticipant(hostSocket, true);

    const deadline = state.storage.room.deadlines.hostReconnectDeadlineAt;
    assert.equal(state.storage.room.status, 'playing');
    assert.equal(state.storage.room.participants['host-1'].connected, false);
    assert.ok(deadline > Date.now());
    assert.equal(state.storage.alarm, deadline);
    assert.ok(viewerSocket.messages.some(message => message.type === 'room:host-reconnecting'));
});

test('host reconnect clears grace and a late old-socket close cannot disconnect it', async () => {
    const state = createMockState(playingRoom());
    const object = new WatchRoomDurableObject(state, {});
    const oldSocket = createMockSocket();
    const viewerSocket = createMockSocket();
    attachSession(object, oldSocket, 'host-1', 'host', 'host-connection-1');
    attachSession(object, viewerSocket, 'viewer-1', 'viewer', 'viewer-connection-1');
    await object.removeParticipant(oldSocket, true);

    const replacement = createMockSocket();
    await object.addParticipant(replacement, state.storage.room, 'host-1', 'host');
    await object.handleSocketClose(oldSocket);

    assert.equal(state.storage.room.status, 'playing');
    assert.equal(state.storage.room.hostDisconnectedAt, null);
    assert.equal(state.storage.room.deadlines.hostReconnectDeadlineAt, null);
    assert.equal(state.storage.room.participants['host-1'].connected, true);
    assert.equal(object.hasLiveClient('host-1'), true);
});

test('host grace alarm ends the room after the durable deadline', async () => {
    const state = createMockState(playingRoom());
    const object = new WatchRoomDurableObject(state, {});
    const hostSocket = createMockSocket();
    const viewerSocket = createMockSocket();
    attachSession(object, hostSocket, 'host-1', 'host', 'host-connection-1');
    attachSession(object, viewerSocket, 'viewer-1', 'viewer', 'viewer-connection-1');
    await object.removeParticipant(hostSocket, true);
    state.storage.room.deadlines.hostReconnectDeadlineAt = Date.now() - 1;

    await object.alarm();

    assert.equal(state.storage.room.status, 'ended');
    assert.equal(state.storage.room.endReason, 'host_reconnect_timeout');
    assert.equal(state.storage.alarm, null);
});

test('alarm completion is idempotent and reschedules the remaining deadline', async () => {
    const room = playingRoom();
    room.status = 'starting';
    room.startPayload = { currentTime: 20, playbackRate: 1 };
    room.deadlines.startDeadlineAt = Date.now() - 1;
    room.deadlines.hostReconnectDeadlineAt = Date.now() + 30000;
    const state = createMockState(room);
    const object = new WatchRoomDurableObject(state, {});
    const viewerSocket = createMockSocket();
    attachSession(object, viewerSocket, 'viewer-1', 'viewer', 'viewer-connection-1');

    await object.alarm();
    const firstSyncCount = viewerSocket.messages.filter(message => message.type === 'sync:start').length;
    await object.alarm();
    const secondSyncCount = viewerSocket.messages.filter(message => message.type === 'sync:start').length;

    assert.equal(state.storage.room.status, 'playing');
    assert.equal(firstSyncCount, 1);
    assert.equal(secondSyncCount, 1);
    assert.equal(state.storage.alarm, room.deadlines.hostReconnectDeadlineAt);
});

test('viewer can late-join playing room and receives state then sync start', async () => {
    const state = createMockState(playingRoom());
    const object = new WatchRoomDurableObject(state, {});
    const viewerSocket = createMockSocket();
    await object.addParticipant(viewerSocket, state.storage.room, 'viewer-late', 'viewer');

    assert.equal(state.storage.room.participants['viewer-late'].connected, true);
    assert.equal(viewerSocket.messages[0].type, 'room:state');
    const sync = viewerSocket.messages.find(message => message.type === 'sync:start');
    assert.ok(sync);
    assert.equal(sync.payload.currentTime, 10);
    assert.equal(sync.payload.serverTimestamp, state.storage.room.playback.serverTimestamp);
});

test('viewer cannot forge host playback control', async () => {
    const state = createMockState(playingRoom());
    const object = new WatchRoomDurableObject(state, {});
    const viewerSocket = createMockSocket();
    attachSession(object, viewerSocket, 'viewer-1', 'viewer', 'viewer-connection-1');

    await object.handleSocketMessage(viewerSocket, JSON.stringify({
        type: 'host:seek',
        payload: { currentTime: 80 },
    }));

    assert.equal(state.storage.room.playback.currentTime, 10);
    assert.ok(viewerSocket.messages.some(message => message.payload?.code === 'UNAUTHORIZED_ACTION'));
});

for (const key of ['startDeadlineAt', 'episodeDeadlineAt', 'hostReconnectDeadlineAt']) {
    test(`scheduler handles only ${key} and consumes stale due deadlines`, async () => {
        const room = playingRoom();
        room.deadlines[key] = Date.now() + 5000;
        const state = createMockState(room);
        const object = new WatchRoomDurableObject(state, {});
        await object.scheduleNextAlarm(room);
        assert.equal(state.storage.alarm, room.deadlines[key]);
        room.deadlines[key] = Date.now() - 1;
        await object.alarm();
        assert.equal(room.deadlines[key], null);
        assert.equal(state.storage.alarm, null);
    });
}

test('one alarm consumes all due deadlines, persists and schedules only the future deadline', async () => {
    const room = playingRoom();
    room.status = 'starting';
    room.startPayload = { currentTime: 20 };
    room.deadlines.startDeadlineAt = Date.now() - 100;
    room.deadlines.episodeDeadlineAt = Date.now() - 50; // stale task
    room.deadlines.roomExpireAt = Date.now() + 60000;
    const state = createMockState(room);
    const object = new WatchRoomDurableObject(state, {});
    await object.alarm();
    assert.equal(room.status, 'playing');
    assert.equal(room.deadlines.startDeadlineAt, null);
    assert.equal(room.deadlines.episodeDeadlineAt, null);
    assert.equal(state.storage.alarm, room.deadlines.roomExpireAt);
    await object.alarm();
    assert.equal(room.status, 'playing');
});

test('null deadlines do not prematurely complete starting or episode transitions', async () => {
    for (const pending of ['', 'change-1']) {
        const room = playingRoom();
        room.status = 'starting';
        room.pendingEpisodeChangeId = pending;
        const object = new WatchRoomDurableObject(createMockState(room), {});
        await object.alarm();
        assert.equal(room.status, 'starting');
    }
});

test('terminal deadline supersedes transitions and duplicate alarms have no side effects', async () => {
    const room = playingRoom();
    room.status = 'starting';
    for (const key of Object.keys(room.deadlines)) room.deadlines[key] = Date.now() - 1;
    const state = createMockState(room);
    const object = new WatchRoomDurableObject(state, {});
    const viewer = createMockSocket();
    attachSession(object, viewer, 'viewer-1', 'viewer', 'viewer-connection-1');
    await object.alarm();
    await object.alarm();
    assert.equal(viewer.messages.filter(x => x.type === 'room:ended').length, 1);
    assert.equal(viewer.messages.filter(x => x.type === 'sync:start').length, 0);
    assert.ok(Object.values(room.deadlines).every(x => x === null));
    assert.equal(state.storage.alarm, null);
});

for (const role of ['host', 'viewer']) {
    test(`${role}: live socket B replaces A before delayed A close; only B close disconnects`, async () => {
        const room = playingRoom();
        room.hostResumeTokenHash = await hashResumeToken('a'.repeat(64));
        const state = createMockState(room);
        const object = new WatchRoomDurableObject(state, {});
        const a = createMockSocket();
        const b = createMockSocket();
        const id = `${role}-1`;
        await object.addParticipant(a, room, id, role);
        if (role === 'host') {
            object.awaitParticipantAuthentication(b, room.roomId, id);
            assert.equal(object.sessions.has(b), false);
            await b.emit('message', { data: JSON.stringify({ type: 'client:resume', roomId: room.roomId, clientId: id, resumeToken: 'a'.repeat(64) }) });
        } else await object.addParticipant(b, room, id, role);
        const connectionId = object.sessions.get(b).connectionId;
        await object.handleSocketClose(a);
        assert.equal(room.participants[id].connectionId, connectionId);
        assert.equal(room.participants[id].connected, true);
        assert.equal(room.hostDisconnectedAt || null, null);
        assert.equal(room.deadlines.hostReconnectDeadlineAt, null);
        await object.handleSocketClose(b);
        if (role === 'host') assert.ok(room.deadlines.hostReconnectDeadlineAt > Date.now());
        else assert.equal(room.participants[id], undefined);
    });
}

test('unauthenticated host control or wrong credentials close socket without changing state', async () => {
    const room = playingRoom();
    room.hostResumeTokenHash = await hashResumeToken('a'.repeat(64));
    const object = new WatchRoomDurableObject(createMockState(room), {});
    for (const message of [{ type: 'host:seek', payload: { currentTime: 99 } },
        { type: 'client:resume', roomId: room.roomId, clientId: room.hostId, resumeToken: 'b'.repeat(64) }]) {
        const socket = createMockSocket();
        object.awaitParticipantAuthentication(socket, room.roomId, room.hostId);
        await socket.emit('message', { data: JSON.stringify(message) });
        assert.equal(socket.closeCode, 4003);
        assert.equal(object.sessions.size, 0);
        assert.equal(object.pendingHosts.size, 0);
        assert.equal(room.playback.currentTime, 10);
    }
});

test('viewer cannot reuse host clientId to replace the host', async () => {
    const room = playingRoom();
    const object = new WatchRoomDurableObject(createMockState(room), {});
    const socket = createMockSocket();
    await object.addParticipant(socket, room, room.hostId, 'viewer');
    assert.equal(socket.closeCode, 4003);
    assert.equal(room.participants[room.hostId].role, 'host');
});

test('clock samples handle positive/negative offsets, bounded smoothing and high RTT rejection', () => {
    const { updateClockEstimate } = globalThis.LibertyWatchRoomClock;
    for (const offset of [-5000, 5000]) {
        const sample = updateClockEstimate({}, { rttMs: 100, serverSentAt: 10000 + offset - 50, localNow: 10000, monotonicNow: 0 });
        assert.equal(sample.offsetMs, offset);
        const next = updateClockEstimate(sample, { rttMs: 120, serverSentAt: 11000 + offset, localNow: 11000, monotonicNow: 1000 });
        assert.equal(next.offsetMs, offset + 12);
        const bad = updateClockEstimate(next, { rttMs: 5000, serverSentAt: 999999, localNow: 12000, monotonicNow: 2000 });
        assert.equal(bad.accepted, false);
        assert.equal(bad.serverNow, next.serverNow);
        const spike = updateClockEstimate(next, { rttMs: 100, serverSentAt: 999999, localNow: 12000, monotonicNow: 2000 });
        assert.ok(Math.abs(spike.serverNow - next.serverNow - 1000) <= 50);
    }
});

test('viewer resume requires its own token; cross-viewer tokens and public clientId alone fail', async () => {
    const room = playingRoom();
    delete room.participants['viewer-1'];
    const object = new WatchRoomDurableObject(createMockState(room), {});
    const authenticate = async (clientId, token = '', role = 'viewer') => {
        const socket = createMockSocket();
        object.awaitParticipantAuthentication(socket, room.roomId, clientId, role);
        await socket.emit('message', { data: JSON.stringify({ type: 'client:resume', roomId: room.roomId, clientId, resumeToken: token }) });
        return socket;
    };
    const a = await authenticate('viewer-A');
    const b = await authenticate('viewer-B');
    const tokenA = a.messages.find(x => x.type === 'client:authenticated').payload.resumeToken;
    const tokenB = b.messages.find(x => x.type === 'client:authenticated').payload.resumeToken;
    assert.equal(tokenA.length, 64); assert.notEqual(tokenA, tokenB);
    assert.equal(room.participants['viewer-A'].resumeTokenHash, await hashResumeToken(tokenA));
    assert.ok(!JSON.stringify(object.getPublicRoomState(room)).includes(tokenA));
    assert.ok(!JSON.stringify(object.getPublicRoomState(room)).includes('resumeTokenHash'));
    const originalId = room.participants['viewer-A'].connectionId;
    for (const wrong of ['', 'b'.repeat(64), tokenB]) {
        const rejected = await authenticate('viewer-A', wrong);
        assert.equal(rejected.closeCode, 4003);
        assert.equal(room.participants['viewer-A'].connectionId, originalId);
        assert.equal(object.sessions.has(a), true);
    }
    const resumed = await authenticate('viewer-A', tokenA);
    const latestId = room.participants['viewer-A'].connectionId;
    await object.handleSocketClose(a);
    assert.equal(room.participants['viewer-A'].connectionId, latestId);
    assert.equal(room.participants['viewer-A'].connected, true);
    await object.handleSocketClose(resumed);
    assert.equal(room.participants['viewer-A'].connected, false);
    const afterDisconnect = await authenticate('viewer-A', tokenA);
    assert.equal(object.sessions.has(afterDisconnect), true);
    const impersonateHost = await authenticate(room.hostId, tokenA);
    assert.equal(impersonateHost.closeCode, 4003);
});

test('host credential cannot bind a random new clientId; pre-auth events never mutate state', async () => {
    const room = playingRoom(); const token = 'a'.repeat(64);
    room.hostResumeTokenHash = await hashResumeToken(token);
    const object = new WatchRoomDurableObject(createMockState(room), {});
    for (const type of ['host:play', 'host:pause', 'host:seek', 'host:sync', 'host:episode-change', 'client:ready', 'client:buffering', 'client:heartbeat']) {
        const socket = createMockSocket();
        object.awaitParticipantAuthentication(socket, room.roomId, room.hostId, 'host');
        await socket.emit('message', { data: JSON.stringify({ type, payload: { currentTime: 99 } }) });
        assert.equal(socket.closeCode, 4003, type);
        assert.equal(room.playback.currentTime, 10);
    }
    const socket = createMockSocket();
    object.awaitParticipantAuthentication(socket, room.roomId, 'random-id', 'host');
    await socket.emit('message', { data: JSON.stringify({ type: 'client:resume', roomId: room.roomId, clientId: 'random-id', resumeToken: token }) });
    assert.equal(socket.closeCode, 4003);
});

test('invalid deadline types cannot cause a past-alarm loop', () => {
    for (const invalid of [null, undefined, NaN, Infinity, '', '123', false, {}, -1]) {
        const room = { deadlines: { startDeadlineAt: invalid } };
        assert.equal(getNextRoomDeadline(room), null);
        assert.equal(room.deadlines.startDeadlineAt, null);
    }
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

import { WatchRoomDurableObject } from '../workers/watch-room/index.js';

class FakeStorage {
    constructor() {
        this.values = new Map();
        this.putCount = 0;
        this.alarm = null;
    }

    async get(key) {
        return this.values.get(key);
    }

    async put(key, value) {
        this.putCount += 1;
        this.values.set(key, structuredClone(value));
    }

    async setAlarm(timestamp) {
        this.alarm = Number(timestamp);
    }

    async deleteAlarm() {
        this.alarm = null;
    }
}

class FakeSocket {
    constructor(name = '') {
        this.name = name;
        this.sent = [];
        this.listeners = new Map();
        this.closed = false;
    }

    addEventListener(type, callback) {
        const callbacks = this.listeners.get(type) || [];
        callbacks.push(callback);
        this.listeners.set(type, callbacks);
    }

    send(message) {
        this.sent.push(JSON.parse(message));
    }

    close(code = 1000, reason = '') {
        this.closed = true;
        this.closeCode = code;
        this.closeReason = reason;
    }
}

const validPlayback = {
    currentTime: 12,
    duration: 1200,
    playbackRate: 1,
    paused: false,
};

async function createFixture(roomId = '12345678') {
    const storage = new FakeStorage();
    const state = { storage };
    const object = new WatchRoomDurableObject(state, {});
    const response = await object.handleCreate(new Request('https://watch-room.local/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            roomId,
            media: { title: 'Example Show' },
            playback: validPlayback,
        }),
    }));
    const created = await response.json();
    return { object, state, storage, created, room: await object.readRoom() };
}

async function connectHost(fixture, socket = new FakeSocket('host')) {
    const authorization = await fixture.object.authorizeConnection(fixture.room, {
        role: 'host',
        clientId: fixture.created.clientId,
        credential: fixture.created.hostCredential,
        protocolVersion: fixture.created.protocolVersion,
    });
    assert.equal(authorization.ok, true);
    await fixture.object.addParticipant(
        socket,
        fixture.room,
        authorization.clientId,
        'host',
        authorization,
    );
    return { socket, authorization };
}

async function connectViewer(fixture, socket = new FakeSocket('viewer'), resume = {}) {
    const authorization = await fixture.object.authorizeConnection(fixture.room, {
        role: 'viewer',
        clientId: resume.clientId || '',
        credential: resume.credential || '',
        protocolVersion: fixture.created.protocolVersion,
    });
    assert.equal(authorization.ok, true);
    await fixture.object.addParticipant(
        socket,
        fixture.room,
        authorization.clientId,
        'viewer',
        authorization,
    );
    return {
        socket,
        authorization,
        clientId: authorization.clientId,
        credential: resume.credential || authorization.issuedCredential,
    };
}

function messagesOf(socket, type) {
    return socket.sent.filter((message) => message.type === type);
}

async function send(object, socket, message) {
    await object.handleSocketMessage(socket, JSON.stringify(message));
}

test('watch TEST 01 create returns an unpredictable host credential', async () => {
    const { created } = await createFixture();
    assert.match(created.hostCredential, /^[0-9a-f-]{70,}$/i);
    assert.notEqual(created.hostCredential, created.clientId);
    assert.equal(created.protocolVersion, 2);
});

test('watch TEST 02 public room state never exposes credential material', async () => {
    const fixture = await createFixture();
    const publicState = fixture.object.getPublicRoomState(fixture.room);
    const serialized = JSON.stringify(publicState);
    assert.equal(serialized.includes(fixture.created.hostCredential), false);
    assert.equal(serialized.includes('credentialHash'), false);
    assert.equal(serialized.includes('Credential'), false);
});

test('watch TEST 03 a known host id without its credential is rejected', async () => {
    const fixture = await createFixture();
    const result = await fixture.object.authorizeConnection(fixture.room, {
        role: 'host',
        clientId: fixture.created.clientId,
        credential: '',
        protocolVersion: 2,
    });
    assert.deepEqual({ ok: result.ok, status: result.status }, { ok: false, status: 403 });
});

test('watch TEST 04 a viewer credential cannot authenticate as host', async () => {
    const fixture = await createFixture();
    const viewer = await connectViewer(fixture);
    const result = await fixture.object.authorizeConnection(fixture.room, {
        role: 'host',
        clientId: viewer.clientId,
        credential: viewer.credential,
        protocolVersion: 2,
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
});

test('watch TEST 05 a credential issued by room A is rejected by room B', async () => {
    const roomA = await createFixture('12345678');
    const roomB = await createFixture('87654321');
    const result = await roomB.object.authorizeConnection(roomB.room, {
        role: 'host',
        clientId: roomA.created.clientId,
        credential: roomA.created.hostCredential,
        protocolVersion: 2,
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
});

test('watch TEST 06 one viewer credential cannot resume another viewer identity', async () => {
    const fixture = await createFixture();
    const viewerA = await connectViewer(fixture);
    const viewerB = await connectViewer(fixture);
    const result = await fixture.object.authorizeConnection(fixture.room, {
        role: 'viewer',
        clientId: viewerB.clientId,
        credential: viewerA.credential,
        protocolVersion: 2,
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
});

test('watch TEST 07 authenticated reconnect takes authority from the old socket', async () => {
    const fixture = await createFixture();
    const first = await connectHost(fixture, new FakeSocket('host-old'));
    fixture.room.status = 'playing';
    await fixture.object.writeRoom(fixture.room);
    const second = await connectHost(fixture, new FakeSocket('host-new'));
    assert.equal(first.socket.closed, true);
    const before = fixture.room.playback.currentTime;
    await send(fixture.object, first.socket, {
        type: 'host:seek',
        payload: { ...validPlayback, currentTime: 99 },
    });
    assert.equal(fixture.room.playback.currentTime, before);
    await send(fixture.object, second.socket, {
        type: 'host:seek',
        payload: { ...validPlayback, currentTime: 33 },
    });
    assert.equal(fixture.room.playback.currentTime, 33);
});

test('watch TEST 08 a host disconnect enters grace instead of ending the room', async () => {
    const fixture = await createFixture();
    const host = await connectHost(fixture);
    await fixture.object.removeParticipant(host.socket, true);
    assert.equal(fixture.room.status, 'host_disconnected');
    assert.ok(fixture.room.hostGraceExpiresAt > Date.now());
    assert.equal(fixture.storage.alarm, fixture.room.hostGraceExpiresAt);
});

test('watch TEST 09 the same host credential restores the room inside grace', async () => {
    const fixture = await createFixture();
    const host = await connectHost(fixture);
    fixture.room.status = 'playing';
    await fixture.object.writeRoom(fixture.room);
    await fixture.object.removeParticipant(host.socket, true);
    const resumed = await connectHost(fixture, new FakeSocket('host-resumed'));
    assert.equal(fixture.room.status, 'playing');
    assert.equal(fixture.room.hostGraceExpiresAt, undefined);
    assert.equal(fixture.room.participants[fixture.created.clientId].online, true);
    assert.equal(resumed.authorization.reconnect, true);
});

test('watch TEST 10 an expired host grace ends the room via the alarm', async () => {
    const fixture = await createFixture();
    const host = await connectHost(fixture);
    await fixture.object.removeParticipant(host.socket, true);
    fixture.room.hostGraceExpiresAt = Date.now() - 1;
    await fixture.object.writeRoom(fixture.room);
    await fixture.object.alarm();
    assert.equal(fixture.room.status, 'ended');
    assert.equal(fixture.room.endReason, 'host_reconnect_timeout');
});

test('watch TEST 11 a disconnected viewer resumes the same identity', async () => {
    const fixture = await createFixture();
    const viewer = await connectViewer(fixture);
    await fixture.object.removeParticipant(viewer.socket, true);
    assert.equal(fixture.room.participants[viewer.clientId].online, false);
    const resumed = await connectViewer(fixture, new FakeSocket('viewer-resumed'), viewer);
    assert.equal(resumed.clientId, viewer.clientId);
    assert.equal(fixture.room.participants[viewer.clientId].online, true);
    assert.equal(Object.keys(fixture.room.participants).filter((id) => id.startsWith('viewer_')).length, 1);
});

test('watch TEST 12 the viewer alarm cleanup releases a ghost participant', async () => {
    const fixture = await createFixture();
    const viewer = await connectViewer(fixture);
    await fixture.object.removeParticipant(viewer.socket, true);
    fixture.room.participants[viewer.clientId].disconnectedAt = Date.now() - 60_001;
    await fixture.object.writeRoom(fixture.room);
    await fixture.object.alarm();
    assert.equal(fixture.room.participants[viewer.clientId], undefined);
});

test('watch TEST 13 a late viewer receives the authoritative playing snapshot', async () => {
    const fixture = await createFixture();
    await connectHost(fixture);
    fixture.room.status = 'playing';
    fixture.room.playback = { ...validPlayback, currentTime: 44, updatedAt: Date.now() };
    await fixture.object.writeRoom(fixture.room);
    const viewer = await connectViewer(fixture);
    assert.equal(fixture.room.status, 'playing');
    assert.equal(fixture.room.playback.currentTime, 44);
    assert.equal(messagesOf(viewer.socket, 'sync:start').length, 1);
});

test('watch TEST 14 only online viewers participate in the ready quorum', async () => {
    const fixture = await createFixture();
    const viewer = await connectViewer(fixture);
    assert.equal(fixture.object.areViewersReady(fixture.room), false);
    fixture.room.participants[viewer.clientId].ready = true;
    assert.equal(fixture.object.areViewersReady(fixture.room), true);
    fixture.room.participants[viewer.clientId].ready = false;
    await fixture.object.removeParticipant(viewer.socket, true);
    assert.equal(fixture.object.areViewersReady(fixture.room), true);
    assert.equal(fixture.room.participants[viewer.clientId].ready, false);
});

test('watch TEST 15 invalid currentTime values cannot mutate playback', async () => {
    const fixture = await createFixture();
    const host = await connectHost(fixture);
    fixture.room.status = 'playing';
    await fixture.object.writeRoom(fixture.room);
    const before = fixture.room.playback.currentTime;
    for (const currentTime of [-1, '10', null]) {
        await send(fixture.object, host.socket, {
            type: 'host:seek',
            payload: { ...validPlayback, currentTime },
        });
    }
    assert.equal(fixture.room.playback.currentTime, before);
    assert.equal(messagesOf(host.socket, 'room:error').at(-1)?.payload.code, 'INVALID_PLAYBACK');
});

test('watch TEST 16 invalid playback rates are rejected safely', async () => {
    const fixture = await createFixture();
    const host = await connectHost(fixture);
    fixture.room.status = 'playing';
    await fixture.object.writeRoom(fixture.room);
    for (const playbackRate of [0, 100, '1']) {
        await send(fixture.object, host.socket, {
            type: 'host:sync',
            payload: { ...validPlayback, playbackRate },
        });
    }
    assert.equal(fixture.room.playback.playbackRate, 1);
    assert.equal(messagesOf(host.socket, 'room:error').length, 3);
});

test('watch TEST 17 malformed JSON is rejected without changing room state', async () => {
    const fixture = await createFixture();
    const host = await connectHost(fixture);
    const status = fixture.room.status;
    await fixture.object.handleSocketMessage(host.socket, '{not-json');
    assert.equal(fixture.room.status, status);
    assert.equal(messagesOf(host.socket, 'room:error').at(-1)?.payload.code, 'INVALID_MESSAGE');
});

test('watch TEST 18 unknown message types are rejected', async () => {
    const fixture = await createFixture();
    const host = await connectHost(fixture);
    await send(fixture.object, host.socket, { type: 'host:delete-everything', payload: {} });
    assert.equal(messagesOf(host.socket, 'room:error').at(-1)?.payload.code, 'UNKNOWN_EVENT');
});

test('watch TEST 19 oversized messages are rejected and the room stays healthy', async () => {
    const fixture = await createFixture();
    const host = await connectHost(fixture);
    await fixture.object.handleSocketMessage(host.socket, JSON.stringify({
        type: 'client:ping',
        payload: { padding: 'x'.repeat(33 * 1024) },
    }));
    assert.equal(messagesOf(host.socket, 'room:error').at(-1)?.payload.code, 'MESSAGE_TOO_LARGE');
    assert.equal(fixture.room.status, 'waiting');
});

test('watch TEST 20 frequent pings do not cause a durable write per event', async () => {
    const fixture = await createFixture();
    const host = await connectHost(fixture);
    fixture.storage.putCount = 0;
    for (let index = 0; index < 10; index += 1) {
        await send(fixture.object, host.socket, {
            type: 'client:ping',
            payload: { clientSentAt: Date.now() },
        });
    }
    assert.ok(fixture.storage.putCount <= 1, `unexpected writes: ${fixture.storage.putCount}`);
    assert.equal(messagesOf(host.socket, 'server:pong').length, 10);
});

test('watch TEST 21 frequent host sync broadcasts but checkpoints storage', async () => {
    const fixture = await createFixture();
    const host = await connectHost(fixture);
    const viewer = await connectViewer(fixture);
    fixture.room.status = 'playing';
    await fixture.object.writeRoom(fixture.room);
    fixture.storage.putCount = 0;
    for (let index = 0; index < 10; index += 1) {
        await send(fixture.object, host.socket, {
            type: 'host:sync',
            payload: { ...validPlayback, currentTime: 20 + index },
        });
    }
    assert.ok(fixture.storage.putCount <= 1, `unexpected writes: ${fixture.storage.putCount}`);
    assert.equal(messagesOf(viewer.socket, 'sync:state').length, 10);
});

const watchUiSource = readFileSync(new URL('../js/watch-room/ui.js', import.meta.url), 'utf8');
const watchWorkerSource = readFileSync(new URL('../workers/watch-room/index.js', import.meta.url), 'utf8');

test('watch TEST 22 explicit leave is the only viewer path that sends room:leave', () => {
    const pageExitBody = watchUiSource.slice(
        watchUiSource.indexOf('function handlePageExit('),
        watchUiSource.indexOf('async function endRoom('),
    );
    assert.equal(pageExitBody.includes("type: 'room:leave'"), false);
    assert.match(watchUiSource, /function leaveRoom\([\s\S]*closeSocket\(true\)/);
});

test('watch TEST 23 room end and explicit cleanup disable reconnect', () => {
    assert.match(watchUiSource, /function clearRoomState\([\s\S]*closeSocket\(false\)/);
    assert.match(watchUiSource, /function closeSocket\([\s\S]*socketCloseIntentional = true/);
    assert.match(watchUiSource, /room:ended[\s\S]*clearRoomState\(\)/);
});

test('watch TEST 24 reconnect is bounded and protocol failures are terminal UI errors', () => {
    assert.match(watchUiSource, /RECONNECT_DELAYS = \[1000, 2000, 4000, 8000, 12000, 12000\]/);
    assert.match(watchUiSource, /reconnectAttempt >= RECONNECT_DELAYS\.length/);
    assert.match(watchUiSource, /PROTOCOL_MISMATCH/);
    assert.match(watchUiSource, /INVALID_CREDENTIAL/);
});

test('watch TEST 25 credentials are session scoped and never put in URLs', () => {
    const urlBuilder = watchUiSource.slice(
        watchUiSource.indexOf('function buildWebSocketUrl('),
        watchUiSource.indexOf('function clearReconnectTimer('),
    );
    assert.equal(urlBuilder.includes('credential'), false);
    assert.match(watchUiSource, /SESSION_ROOM_CREDENTIAL_KEY = 'watchRoomCredential'/);
    assert.match(watchUiSource, /\[WATCH_PROTOCOL, credential\]/);
    assert.doesNotMatch(
        watchWorkerSource,
        /console\.(?:log|warn|error)\([^)]*(?:credential|hostCredential|viewerCredential)/is,
    );
});

test('watch clock offset is estimated from pong RTT and passed to playback calculations', () => {
    const controllerSource = readFileSync(new URL('../js/watch-room/controller.js', import.meta.url), 'utf8');
    const calls = [];
    const context = {
        console,
        sessionStorage: { removeItem() {} },
        URLSearchParams,
        window: {
            location: { search: '' },
            setTimeout,
            clearTimeout,
            setInterval,
            clearInterval,
            LibertyWatchRoom: {},
        },
    };
    vm.runInNewContext(controllerSource, context, { filename: 'js/watch-room/controller.js' });
    const controller = new context.window.LibertyWatchRoom.Controller({
        player: {
            isReady: () => true,
            calculateTargetTime(playback) {
                calls.push(playback);
                return playback.currentTime || 0;
            },
            getCurrentTime: () => 0,
        },
    });
    controller.setContext({ roomId: '12345678', role: 'viewer', connected: true, status: 'playing' });
    const clientSentAt = Date.now() - 100;
    controller.dispatch({
        type: 'server:pong',
        serverTime: clientSentAt + 550,
        payload: { clientSentAt, serverTime: clientSentAt + 550 },
    });
    assert.ok(controller.state.rttMs >= 90);
    assert.ok(controller.state.clockOffsetMs >= 450 && controller.state.clockOffsetMs <= 550);
    controller.getPlaybackDrift({ currentTime: 5, playbackRate: 1, updatedAt: Date.now() });
    assert.ok(calls.at(-1).clockOffsetMs >= 450);
});

test('watch player target time uses server clock offset without changing media identity', () => {
    const adapterSource = readFileSync(new URL('../js/watch-room/player-adapter.js', import.meta.url), 'utf8');
    const context = {
        console,
        Date,
        window: { LibertyWatchRoom: {} },
    };
    vm.runInNewContext(adapterSource, context, { filename: 'js/watch-room/player-adapter.js' });
    const adapter = new context.window.LibertyWatchRoom.PlayerAdapter();
    const serverNow = Date.now() + 20_000;
    const target = adapter.calculateTargetTime({
        currentTime: 10,
        duration: 100,
        paused: false,
        playbackRate: 1,
        updatedAt: serverNow - 1000,
        clockOffsetMs: 20_000,
    });
    assert.ok(target >= 10.9 && target <= 11.2, `unexpected target ${target}`);
});

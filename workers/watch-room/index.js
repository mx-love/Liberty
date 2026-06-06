const MAX_MEMBERS = 10;
const ROOM_STATUS = {
    WAITING: 'waiting',
    STARTING: 'starting',
    PLAYING: 'playing',
    ENDED: 'ended',
    HOST_DISCONNECTED: 'host_disconnected',
};

const ERROR_CODE = {
    ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
    ROOM_ENDED: 'ROOM_ENDED',
    ROOM_FULL: 'ROOM_FULL',
    INVALID_ROOM_ID: 'INVALID_ROOM_ID',
    HOST_DISCONNECTED: 'HOST_DISCONNECTED',
    UNAUTHORIZED_ACTION: 'UNAUTHORIZED_ACTION',
    ROOM_ALREADY_STARTED: 'ROOM_ALREADY_STARTED',
    VIEWERS_NOT_READY: 'VIEWERS_NOT_READY',
};

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
        },
    });
}

function isValidRoomId(roomId) {
    return /^\d{8}$/.test(String(roomId || '')) && roomId !== '00000000';
}

function now() {
    return Date.now();
}

function buildMessage(type, roomId, clientId, payload = {}) {
    return JSON.stringify({
        type,
        roomId,
        clientId,
        payload,
        sentAt: now(),
    });
}

function getParticipantList(participants = {}) {
    return Object.values(participants).map((participant) => ({
        id: participant.id,
        role: participant.role,
        name: participant.name,
        ready: Boolean(participant.ready),
        startingReady: Boolean(participant.startingReady),
        joinedAt: participant.joinedAt,
        lastSeenAt: participant.lastSeenAt,
    }));
}

function getStartingReadyState(room = {}) {
    const participants = Object.values(room.participants || {});
    return {
        readyCount: participants.filter((participant) => participant.startingReady).length,
        expectedCount: participants.length,
    };
}

function isHostControlEvent(type) {
    return ['host:play', 'host:pause', 'host:seek', 'host:sync'].includes(type);
}

function getSyncEventType(hostEventType) {
    const eventMap = {
        'host:play': 'sync:play',
        'host:pause': 'sync:pause',
        'host:seek': 'sync:seek',
        'host:sync': 'sync:state',
    };
    return eventMap[hostEventType] || 'sync:state';
}

function normalizeNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function normalizePlaybackPayload(type, payload = {}, previousPlayback = {}) {
    const updatedAt = normalizeNumber(payload.updatedAt, now());
    const previousPaused = previousPlayback.paused !== undefined
        ? Boolean(previousPlayback.paused)
        : true;

    let paused = previousPaused;
    if (type === 'host:play') paused = false;
    if (type === 'host:pause') paused = true;
    if (type === 'host:sync' && payload.paused !== undefined) {
        paused = Boolean(payload.paused);
    }
    if (type === 'host:seek' && payload.paused !== undefined) {
        paused = Boolean(payload.paused);
    }

    return {
        paused,
        currentTime: Math.max(0, normalizeNumber(payload.currentTime, previousPlayback.currentTime || 0)),
        duration: Math.max(0, normalizeNumber(payload.duration, previousPlayback.duration || 0)),
        playbackRate: normalizeNumber(payload.playbackRate, previousPlayback.playbackRate || 1) || 1,
        updatedAt,
    };
}

function normalizeInitialPlayback(playback = {}) {
    return {
        paused: true,
        currentTime: Math.max(0, normalizeNumber(playback.currentTime, 0)),
        duration: Math.max(0, normalizeNumber(playback.duration, 0)),
        playbackRate: normalizeNumber(playback.playbackRate, 1) || 1,
        updatedAt: now(),
    };
}

function normalizeStartPlayback(payload = {}, previousPlayback = {}) {
    return {
        paused: false,
        currentTime: Math.max(0, normalizeNumber(payload.currentTime, previousPlayback.currentTime || 0)),
        duration: Math.max(0, normalizeNumber(payload.duration, previousPlayback.duration || 0)),
        playbackRate: normalizeNumber(payload.playbackRate, previousPlayback.playbackRate || 1) || 1,
        updatedAt: normalizeNumber(payload.updatedAt, now()),
    };
}

function normalizePreparePayload(payload = {}, previousPlayback = {}) {
    return {
        paused: true,
        currentTime: Math.max(0, normalizeNumber(payload.currentTime, previousPlayback.currentTime || 0)),
        duration: Math.max(0, normalizeNumber(payload.duration, previousPlayback.duration || 0)),
        playbackRate: normalizeNumber(payload.playbackRate, previousPlayback.playbackRate || 1) || 1,
        updatedAt: normalizeNumber(payload.updatedAt, now()),
    };
}

export class WatchRoomDurableObject {
    constructor(state, env) {
        this.state = state;
        this.env = env;
        this.sessions = new Map();
    }

    async fetch(request) {
        const url = new URL(request.url);

        if (request.method === 'POST' && url.pathname === '/create') {
            return this.handleCreate(request);
        }

        if (request.method === 'POST' && url.pathname === '/end') {
            return this.handleHttpEnd(request);
        }

        if (request.method === 'GET' && url.pathname === '/state') {
            return this.handleState(url);
        }

        if (request.method === 'GET' && url.pathname === '/ws') {
            return this.handleWebSocket(request, url);
        }

        return jsonResponse({ success: false, error: 'Not found' }, 404);
    }

    async alarm() {
        console.log('[WatchRoomDO] starting timeout reached');
        await this.maybeEnterPlaying('', true);
    }

    async readRoom() {
        const room = await this.state.storage.get('room');
        if (room) {
            console.log('[WatchRoomDO] load room from storage', room.roomId);
        }
        return room;
    }

    async writeRoom(room) {
        room.updatedAt = now();
        await this.state.storage.put('room', room);
        return room;
    }

    async handleCreate(request) {
        let body = {};
        try {
            body = await request.json();
        } catch (error) {
            body = {};
        }

        const roomId = String(body.roomId || '');
        if (!isValidRoomId(roomId)) {
            return jsonResponse({ success: false, error: ERROR_CODE.INVALID_ROOM_ID }, 400);
        }

        const existing = await this.readRoom();
        if (existing && existing.status !== ROOM_STATUS.ENDED) {
            return jsonResponse({ success: false, error: 'ROOM_ID_CONFLICT' }, 409);
        }

        const createdAt = now();
        const hostId = body.hostId || `host_${crypto.randomUUID()}`;
        const room = {
            roomId,
            status: ROOM_STATUS.WAITING,
            hostId,
            maxMembers: MAX_MEMBERS,
            participants: {
                [hostId]: {
                    id: hostId,
                    role: 'host',
                    name: '房主',
                    ready: true,
                    startingReady: false,
                    joinedAt: createdAt,
                    lastSeenAt: createdAt,
                },
            },
            media: body.media || {},
            playback: normalizeInitialPlayback(body.playback || {}),
            createdAt,
            updatedAt: createdAt,
            hostDisconnectedAt: null,
        };

        await this.writeRoom(room);
        console.log('[WatchRoomDO] create room', roomId);

        return jsonResponse({
            success: true,
            roomId,
            status: room.status,
            role: 'host',
            clientId: room.hostId,
            hostId: room.hostId,
            maxMembers: MAX_MEMBERS,
        });
    }

    async handleState(url) {
        const roomId = String(url.searchParams.get('room') || '');
        console.log('[WatchRoomDO] state request', roomId);

        if (!isValidRoomId(roomId)) {
            return jsonResponse({ success: false, error: ERROR_CODE.INVALID_ROOM_ID }, 400);
        }

        const room = await this.readRoom();
        if (!room || room.roomId !== roomId) {
            console.log('[WatchRoomDO] room not found', roomId);
            return jsonResponse({ success: false, error: ERROR_CODE.ROOM_NOT_FOUND }, 404);
        }

        if (room.status === ROOM_STATUS.ENDED) {
            console.log('[WatchRoomDO] room ended', roomId);
            return jsonResponse({ success: false, error: ERROR_CODE.ROOM_ENDED }, 410);
        }

        if (![ROOM_STATUS.WAITING, ROOM_STATUS.STARTING, ROOM_STATUS.PLAYING].includes(room.status)) {
            return jsonResponse({ success: false, error: ERROR_CODE.HOST_DISCONNECTED }, 409);
        }

        return jsonResponse({
            success: true,
            roomId: room.roomId,
            status: room.status,
            maxMembers: room.maxMembers,
            participantsCount: Object.keys(room.participants || {}).length,
            participantCount: Object.keys(room.participants || {}).length,
            participants: getParticipantList(room.participants),
            media: room.media || {},
            playback: room.playback || {},
        });
    }

    async handleHttpEnd(request) {
        let body = {};
        try {
            body = await request.json();
        } catch (error) {
            body = {};
        }

        const clientId = String(body.clientId || '');
        const room = await this.readRoom();

        if (!room) {
            return jsonResponse({ success: false, error: ERROR_CODE.ROOM_NOT_FOUND }, 404);
        }

        if (room.status === ROOM_STATUS.ENDED) {
            return jsonResponse({ success: false, error: ERROR_CODE.ROOM_ENDED }, 410);
        }

        if (clientId !== room.hostId) {
            return jsonResponse({ success: false, error: ERROR_CODE.UNAUTHORIZED_ACTION }, 403);
        }

        await this.endRoom(room, clientId);
        return jsonResponse({ success: true, roomId: room.roomId, status: ROOM_STATUS.ENDED });
    }

    async handleWebSocket(request, url) {
        if (request.headers.get('Upgrade') !== 'websocket') {
            return jsonResponse({ success: false, error: 'Expected websocket upgrade' }, 426);
        }

        const roomId = String(url.searchParams.get('room') || '');
        const clientId = String(url.searchParams.get('clientId') || `client_${crypto.randomUUID()}`);
        const role = url.searchParams.get('role') === 'host' ? 'host' : 'viewer';

        if (!isValidRoomId(roomId)) {
            return jsonResponse({ success: false, error: ERROR_CODE.INVALID_ROOM_ID }, 400);
        }

        const room = await this.readRoom();
        if (!room || room.roomId !== roomId) {
            return jsonResponse({ success: false, error: ERROR_CODE.ROOM_NOT_FOUND }, 404);
        }

        if (room.status === ROOM_STATUS.ENDED) {
            return jsonResponse({ success: false, error: ERROR_CODE.ROOM_ENDED }, 410);
        }

        const existingParticipant = room.participants?.[clientId];

        if (room.status === ROOM_STATUS.HOST_DISCONNECTED && role !== 'host') {
            return jsonResponse({ success: false, error: ERROR_CODE.HOST_DISCONNECTED }, 409);
        }

        if (
            role === 'viewer'
            && room.status !== ROOM_STATUS.WAITING
            && !existingParticipant
        ) {
            return jsonResponse({ success: false, error: ERROR_CODE.ROOM_ALREADY_STARTED }, 409);
        }

        const participantIds = Object.keys(room.participants || {});
        if (!existingParticipant && participantIds.length >= room.maxMembers) {
            return jsonResponse({ success: false, error: ERROR_CODE.ROOM_FULL }, 409);
        }

        if (role === 'host' && clientId !== room.hostId) {
            return jsonResponse({ success: false, error: ERROR_CODE.UNAUTHORIZED_ACTION }, 403);
        }

        const pair = new WebSocketPair();
        const client = pair[0];
        const server = pair[1];
        server.accept();

        await this.addParticipant(server, room, clientId, role);

        return new Response(null, {
            status: 101,
            webSocket: client,
        });
    }

    async addParticipant(socket, room, clientId, role) {
        const joinedAt = now();
        this.closeExistingSession(clientId, socket);
        room.participants = room.participants || {};
        room.participants[clientId] = {
            id: clientId,
            role,
            name: role === 'host' ? '房主' : '观众',
            ready: role === 'host' ? true : Boolean(room.participants[clientId]?.ready),
            startingReady: false,
            joinedAt: room.participants[clientId]?.joinedAt || joinedAt,
            lastSeenAt: joinedAt,
        };

        if (role === 'host') {
            if (room.status === ROOM_STATUS.HOST_DISCONNECTED) {
                room.status = ROOM_STATUS.WAITING;
            }
            room.hostDisconnectedAt = null;
        }

        await this.writeRoom(room);

        this.sessions.set(socket, { clientId, role });

        socket.addEventListener('message', (event) => {
            this.handleSocketMessage(socket, event.data).catch((error) => {
                this.sendError(socket, 'INTERNAL_ERROR', error?.message || 'Internal error');
            });
        });

        socket.addEventListener('close', () => {
            this.handleSocketClose(socket).catch(() => {});
        });

        socket.addEventListener('error', () => {
            this.handleSocketClose(socket).catch(() => {});
        });

        socket.send(buildMessage('room:state', room.roomId, clientId, this.getPublicRoomState(room)));
        await this.broadcastParticipants(room);

        if (role === 'viewer' && room.status === ROOM_STATUS.WAITING) {
            socket.send(buildMessage('sync:prepare', room.roomId, clientId, {
                viewerId: clientId,
                status: room.status,
                media: room.media || {},
                playback: room.playback || {},
            }));
        } else if (role === 'viewer' && room.status === ROOM_STATUS.STARTING) {
            socket.send(buildMessage('sync:prepare', room.roomId, clientId, {
                ...(room.startPayload || room.playback || {}),
                status: ROOM_STATUS.STARTING,
            }));
        } else if (role === 'viewer' && room.status === ROOM_STATUS.PLAYING) {
            socket.send(buildMessage('sync:start', room.roomId, clientId, {
                ...(room.playback || {}),
                status: ROOM_STATUS.PLAYING,
            }));
        }
    }

    closeExistingSession(clientId, replacementSocket) {
        for (const [socket, session] of this.sessions.entries()) {
            if (socket === replacementSocket || session.clientId !== clientId) continue;

            this.sessions.delete(socket);
            try {
                socket.close(1000, 'replaced');
            } catch (error) {}
        }
    }

    async handleSocketMessage(socket, rawData) {
        const session = this.sessions.get(socket);
        if (!session) return;

        let message = {};
        try {
            message = JSON.parse(rawData);
        } catch (error) {
            this.sendError(socket, 'INVALID_MESSAGE', 'Invalid JSON message');
            return;
        }

        const room = await this.readRoom();
        if (!room || room.status === ROOM_STATUS.ENDED) {
            this.sendError(socket, ERROR_CODE.ROOM_ENDED, 'Room has ended');
            return;
        }

        if (message.type === 'client:heartbeat') {
            await this.touchParticipant(room, session.clientId);
            socket.send(buildMessage('room:state', room.roomId, session.clientId, this.getPublicRoomState(room)));
            return;
        }

        if (message.type === 'room:leave') {
            await this.removeParticipant(socket, false);
            try {
                socket.close(1000, 'left');
            } catch (error) {}
            return;
        }

        if (message.type === 'room:end') {
            if (session.role !== 'host' || session.clientId !== room.hostId) {
                this.sendError(socket, ERROR_CODE.UNAUTHORIZED_ACTION, 'Only host can end room');
                return;
            }

            await this.endRoom(room, session.clientId);
            return;
        }

        if (message.type === 'viewer:ready') {
            await this.handleViewerReady(room, session, message);
            return;
        }

        if (message.type === 'client:ready') {
            await this.handleClientReady(room, session, message);
            return;
        }

        if (message.type === 'host:start') {
            await this.handleHostStart(socket, room, session, message);
            return;
        }

        if (isHostControlEvent(message.type)) {
            await this.handleHostControl(socket, room, session, message);
            return;
        }

        this.sendError(socket, 'UNKNOWN_EVENT', 'Unknown event');
    }

    async handleHostControl(socket, room, session, message) {
        if (message.type === 'host:sync') {
            console.log('[WatchRoomDO] host sync received', {
                type: message.type,
                clientId: session.clientId,
            });
        }

        if (message.type !== 'host:sync') {
            console.log('[WatchRoomDO] host event received', {
                type: message.type,
                roomId: room.roomId,
                clientId: session.clientId,
                role: session.role,
                status: room.status,
            });
        }

        if (session.role !== 'host' || session.clientId !== room.hostId) {
            console.warn('[WatchRoomDO] host event rejected', {
                type: message.type,
                reason: 'unauthorized_host',
                clientId: session.clientId,
                hostId: room.hostId,
                role: session.role,
            });
            this.sendError(socket, ERROR_CODE.UNAUTHORIZED_ACTION, 'Only host can control playback');
            return;
        }

        if (room.status !== ROOM_STATUS.PLAYING) {
            if (message.type !== 'host:sync') {
                if (room.status === ROOM_STATUS.WAITING) {
                    console.log('[WatchRoomDO] host event rejected in waiting', {
                        type: message.type,
                    });
                }
                console.warn('[WatchRoomDO] host event rejected', {
                    type: message.type,
                    reason: 'room_not_playing',
                    clientId: session.clientId,
                    hostId: room.hostId,
                    role: session.role,
                    status: room.status,
                });
            }
            this.sendError(socket, ERROR_CODE.UNAUTHORIZED_ACTION, 'Room has not started');
            return;
        }

        const playback = normalizePlaybackPayload(
            message.type,
            message.payload || {},
            room.playback || {}
        );

        room.playback = playback;
        await this.writeRoom(room);
        await this.broadcastPlaybackSync(room, session.clientId, getSyncEventType(message.type), playback);
    }

    async handleHostStart(socket, room, session, message) {
        console.log('[WatchRoomDO] host:start received', {
            roomId: room.roomId,
            clientId: session.clientId,
            role: session.role,
            payload: message.payload || {},
        });

        if (session.role !== 'host' || session.clientId !== room.hostId) {
            console.warn('[WatchRoomDO] host event rejected', {
                type: message.type,
                reason: 'unauthorized_host',
                clientId: session.clientId,
                hostId: room.hostId,
                role: session.role,
            });
            this.sendError(socket, ERROR_CODE.UNAUTHORIZED_ACTION, 'Only host can start room');
            return;
        }

        if (room.status !== ROOM_STATUS.WAITING) {
            this.sendError(socket, ERROR_CODE.UNAUTHORIZED_ACTION, 'Room is not waiting');
            return;
        }

        if (!this.areViewersReady(room)) {
            console.log('[WatchRoomDO] host:start rejected: viewers not ready', {
                roomId: room.roomId,
            });
            this.sendError(socket, ERROR_CODE.VIEWERS_NOT_READY, 'Viewers are not ready');
            return;
        }

        const preparePayload = normalizePreparePayload(message.payload || {}, room.playback || {});
        room.status = ROOM_STATUS.STARTING;
        room.startPayload = preparePayload;
        room.startingStartedAt = now();
        Object.values(room.participants || {}).forEach((participant) => {
            participant.startingReady = false;
        });
        await this.writeRoom(room);
        console.log('[WatchRoomDO] room status changed to starting', {
            roomId: room.roomId,
        });
        console.log('[WatchRoomDO] broadcast sync:prepare', {
            roomId: room.roomId,
            payload: preparePayload,
        });
        this.broadcastToAll(buildMessage('sync:prepare', room.roomId, session.clientId, {
            ...preparePayload,
            status: ROOM_STATUS.STARTING,
            sourceClientId: session.clientId,
        }));
        await this.broadcastParticipants(room);
        await this.state.storage.setAlarm(now() + 3000);

        setTimeout(() => {
            console.log('[WatchRoomDO] starting timeout reached');
            this.maybeEnterPlaying(room.hostId, true).catch((error) => {
                console.warn('[WatchRoomDO] start timeout failed', error?.message || String(error));
            });
        }, 3000);
    }

    async handleViewerReady(room, session, message) {
        if (session.role !== 'viewer') {
            this.sendErrorByClientId(session.clientId, ERROR_CODE.UNAUTHORIZED_ACTION, 'Only viewer can become ready');
            return;
        }

        if (room.status !== ROOM_STATUS.WAITING) return;

        if (room.participants?.[session.clientId]) {
            room.participants[session.clientId].ready = true;
            room.participants[session.clientId].lastSeenAt = now();
            await this.writeRoom(room);
        }

        console.log('[WatchRoomDO] viewer ready received', {
            roomId: room.roomId,
            clientId: session.clientId,
        });
        await this.broadcastParticipants(room);
    }

    async handleClientReady(room, session, message) {
        if (room.status !== ROOM_STATUS.STARTING) return;

        if (room.participants?.[session.clientId]) {
            room.participants[session.clientId].startingReady = true;
            room.participants[session.clientId].lastSeenAt = now();
            await this.writeRoom(room);
        }

        console.log('[WatchRoomDO] client:ready received', {
            roomId: room.roomId,
            clientId: session.clientId,
            role: session.role,
        });
        console.log('[WatchRoomDO] starting ready state', getStartingReadyState(room));
        await this.broadcastParticipants(room);
        await this.maybeEnterPlaying(room.hostId, false);
    }

    areViewersReady(room) {
        return Object.values(room.participants || {})
            .filter((participant) => participant.role === 'viewer')
            .every((participant) => participant.ready);
    }

    areStartingClientsReady(room) {
        return Object.values(room.participants || {})
            .every((participant) => participant.startingReady);
    }

    async maybeEnterPlaying(sourceClientId, force = false) {
        const room = await this.readRoom();
        if (!room || room.status !== ROOM_STATUS.STARTING) return;
        const readyState = getStartingReadyState(room);
        console.log('[WatchRoomDO] starting ready state', readyState);
        if (!force && !this.areStartingClientsReady(room)) return;

        const playback = normalizeStartPlayback({
            ...(room.startPayload || room.playback || {}),
            updatedAt: now(),
        }, room.playback || {});
        room.status = ROOM_STATUS.PLAYING;
        room.playback = playback;
        delete room.startPayload;
        delete room.startingStartedAt;
        await this.writeRoom(room);
        try {
            await this.state.storage.deleteAlarm();
        } catch (error) {}
        console.log('[WatchRoomDO] room status changed to playing', {
            roomId: room.roomId,
            playback,
        });
        console.log('[WatchRoomDO] broadcast sync:start', {
            roomId: room.roomId,
            payload: playback,
        });
        this.broadcastToAll(buildMessage('sync:start', room.roomId, sourceClientId || room.hostId, {
            ...playback,
            status: ROOM_STATUS.PLAYING,
            sourceClientId: sourceClientId || room.hostId,
        }));
        await this.broadcastParticipants(room);
    }

    async touchParticipant(room, clientId) {
        if (room.participants?.[clientId]) {
            room.participants[clientId].lastSeenAt = now();
            await this.writeRoom(room);
        }
    }

    async handleSocketClose(socket) {
        await this.removeParticipant(socket, true);
    }

    async removeParticipant(socket, disconnected) {
        const session = this.sessions.get(socket);
        if (!session) return;
        this.sessions.delete(socket);

        const room = await this.readRoom();
        if (!room || room.status === ROOM_STATUS.ENDED) return;

        if (session.role === 'host' && session.clientId === room.hostId && disconnected) {
            room.status = ROOM_STATUS.HOST_DISCONNECTED;
            room.hostDisconnectedAt = now();
            // TODO: 后续阶段通过 alarm 或外部请求补齐 60 秒宽限后的自动结束逻辑。
        } else {
            delete room.participants[session.clientId];
        }

        await this.writeRoom(room);
        await this.broadcastParticipants(room);
    }

    async endRoom(room, clientId) {
        room.status = ROOM_STATUS.ENDED;
        await this.writeRoom(room);

        const message = buildMessage('room:ended', room.roomId, clientId, {
            reason: 'host_ended',
        });

        for (const socket of this.sessions.keys()) {
            try {
                socket.send(message);
                socket.close(1000, 'room ended');
            } catch (error) {}
        }

        this.sessions.clear();
    }

    async broadcastParticipants(room) {
        const payload = {
            participants: getParticipantList(room.participants),
            count: Object.keys(room.participants || {}).length,
            maxMembers: room.maxMembers,
        };

        const message = buildMessage('room:participants', room.roomId, '', payload);

        for (const socket of this.sessions.keys()) {
            try {
                socket.send(message);
            } catch (error) {}
        }
    }

    async broadcastPlaybackSync(room, sourceClientId, type, playback) {
        if (type !== 'sync:state') {
            console.log('[WatchRoomDO] broadcast sync event', {
                type,
                roomId: room.roomId,
            });
        } else {
            console.log('[WatchRoomDO] broadcast viewer sync', { type });
        }

        const message = buildMessage(type, room.roomId, sourceClientId, {
            ...playback,
            sourceClientId,
        });

        for (const [socket, session] of this.sessions.entries()) {
            if (session.role !== 'viewer') continue;

            try {
                socket.send(message);
            } catch (error) {}
        }
    }

    broadcastToRole(role, message) {
        for (const [socket, session] of this.sessions.entries()) {
            if (session.role !== role) continue;

            try {
                socket.send(message);
            } catch (error) {}
        }
    }

    broadcastToAll(message) {
        for (const socket of this.sessions.keys()) {
            try {
                socket.send(message);
            } catch (error) {}
        }
    }

    sendError(socket, code, message) {
        const session = this.sessions.get(socket) || {};
        try {
            socket.send(buildMessage('room:error', '', session.clientId || '', {
                code,
                message,
            }));
        } catch (error) {}
    }

    sendErrorByClientId(clientId, code, message) {
        for (const [socket, session] of this.sessions.entries()) {
            if (session.clientId !== clientId) continue;
            this.sendError(socket, code, message);
        }
    }

    getPublicRoomState(room) {
        return {
            roomId: room.roomId,
            status: room.status,
            role: undefined,
            maxMembers: room.maxMembers,
            media: room.media || {},
            playback: room.playback || {},
            participants: getParticipantList(room.participants),
            participantCount: Object.keys(room.participants || {}).length,
            createdAt: room.createdAt,
            updatedAt: room.updatedAt,
            hostDisconnectedAt: room.hostDisconnectedAt,
        };
    }
}

export default {
    async fetch() {
        return new Response('Watch room worker is running', {
            headers: {
                'Content-Type': 'text/plain; charset=utf-8',
            },
        });
    },
};

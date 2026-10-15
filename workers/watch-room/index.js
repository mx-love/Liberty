const MAX_MEMBERS = 10;
const HOST_RECONNECT_GRACE_MS = 45_000;
const VIEWER_RECONNECT_GRACE_MS = 60_000;
const PLAYBACK_CHECKPOINT_MS = 15_000;
const PARTICIPANT_CHECKPOINT_MS = 60_000;
const MAX_MESSAGE_BYTES = 32 * 1024;
const MIN_PLAYBACK_RATE = 0.25;
const MAX_PLAYBACK_RATE = 4;
const MAX_MEDIA_SECONDS = 7 * 24 * 60 * 60;
const WATCH_PROTOCOL = 'liberty-watch-v1';
const ALLOWED_MESSAGE_TYPES = new Set([
    'client:ping',
    'client:heartbeat',
    'room:leave',
    'room:end',
    'viewer:ready',
    'client:ready',
    'client:episode-ready',
    'host:start',
    'host:episode-change',
    'host:play',
    'host:pause',
    'host:seek',
    'host:sync',
]);
const ROOM_STATUS = {
    WAITING: 'waiting',
    STARTING: 'starting',
    PLAYING: 'playing',
    ENDED: 'ended',
    CLOSED: 'closed',
    EXPIRED: 'expired',
    HOST_DISCONNECTED: 'host_disconnected',
};

const ERROR_CODE = {
    ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
    ROOM_ENDED: 'ROOM_ENDED',
    ROOM_CLOSED: 'ROOM_CLOSED',
    ROOM_EXPIRED: 'ROOM_EXPIRED',
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

function isTerminalRoomStatus(status) {
    return [
        ROOM_STATUS.ENDED,
        ROOM_STATUS.CLOSED,
        ROOM_STATUS.EXPIRED,
    ].includes(status);
}

function getTerminalRoomError(status) {
    if (status === ROOM_STATUS.CLOSED) return ERROR_CODE.ROOM_CLOSED;
    if (status === ROOM_STATUS.EXPIRED) return ERROR_CODE.ROOM_EXPIRED;
    return ERROR_CODE.ROOM_ENDED;
}

function getTerminalRoomHttpStatus(status) {
    return 410;
}

function now() {
    return Date.now();
}

function buildMessage(type, roomId, clientId, payload = {}) {
    const serverTime = now();
    return JSON.stringify({
        type,
        roomId,
        clientId,
        payload,
        sentAt: serverTime,
        serverTime,
    });
}

function getParticipantList(participants = {}) {
    return Object.values(participants).map((participant) => ({
        id: participant.id,
        role: participant.role,
        name: participant.name,
        ready: Boolean(participant.ready),
        startingReady: Boolean(participant.startingReady),
        online: Boolean(participant.online),
        disconnectedAt: participant.disconnectedAt || null,
        joinedAt: participant.joinedAt,
        lastSeenAt: participant.lastSeenAt,
    }));
}

function getStartingReadyState(room = {}) {
    const participants = Object.values(room.participants || {}).filter((participant) => participant.online);
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
        updatedAt: now(),
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
        updatedAt: now(),
    };
}

function normalizePreparePayload(payload = {}, previousPlayback = {}) {
    return {
        paused: true,
        currentTime: Math.max(0, normalizeNumber(payload.currentTime, previousPlayback.currentTime || 0)),
        duration: Math.max(0, normalizeNumber(payload.duration, previousPlayback.duration || 0)),
        playbackRate: normalizeNumber(payload.playbackRate, previousPlayback.playbackRate || 1) || 1,
        updatedAt: now(),
    };
}

function generateCredential() {
    return `${crypto.randomUUID()}-${crypto.randomUUID()}`;
}

async function hashCredential(credential) {
    const bytes = new TextEncoder().encode(String(credential || ''));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

async function credentialMatches(participant, credential) {
    if (!participant?.credentialHash || !credential) return false;
    return participant.credentialHash === await hashCredential(credential);
}

function readSocketCredential(request) {
    const protocols = String(request.headers.get('Sec-WebSocket-Protocol') || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    const protocolIndex = protocols.indexOf(WATCH_PROTOCOL);
    return protocolIndex >= 0 ? String(protocols[protocolIndex + 1] || '') : '';
}

function validatePlaybackPayload(payload = {}) {
    for (const field of ['currentTime', 'duration']) {
        if (payload[field] === undefined) continue;
        const value = payload[field];
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_MEDIA_SECONDS) {
            return `${field} must be a finite non-negative media time`;
        }
    }
    if (payload.playbackRate !== undefined) {
        const rate = payload.playbackRate;
        if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < MIN_PLAYBACK_RATE || rate > MAX_PLAYBACK_RATE) {
            return `playbackRate must be between ${MIN_PLAYBACK_RATE} and ${MAX_PLAYBACK_RATE}`;
        }
    }
    if (payload.paused !== undefined && typeof payload.paused !== 'boolean') {
        return 'paused must be a boolean';
    }
    return '';
}

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeEpisodeEntry(entry, index) {
    const source = entry && typeof entry === 'object'
        ? entry
        : { url: entry };
    return {
        index,
        name: String(source.name || source.title || source.episodeName || `第 ${index + 1} 集`),
        url: String(source.url || ''),
    };
}

function normalizeEpisodeSnapshot(payload = {}) {
    const episodeIndex = Number(payload.episodeIndex);
    const episodes = Array.isArray(payload.episodes)
        ? payload.episodes.map(normalizeEpisodeEntry)
        : [];
    const episode = Number.isInteger(episodeIndex) ? episodes[episodeIndex] : null;
    const episodeUrl = String(payload.episodeUrl || episode?.url || '');
    const changeId = String(payload.changeId || '');

    if (episodes.length > 500) {
        return { success: false, error: 'TOO_MANY_EPISODES' };
    }
    if (
        String(payload.title || '').length > 300
        || String(payload.year || '').length > 20
        || String(payload.sourceCode || '').length > 100
        || String(payload.vodId || '').length > 200
        || String(payload.episodeName || '').length > 300
        || episodeUrl.length > 4096
        || changeId.length > 200
        || episodes.some((item) => item.name.length > 300 || item.url.length > 4096)
    ) {
        return { success: false, error: 'INVALID_EPISODE_PAYLOAD' };
    }
    if (!Number.isInteger(episodeIndex) || episodeIndex < 0 || episodeIndex >= episodes.length) {
        return { success: false, error: 'INVALID_EPISODE_INDEX' };
    }
    if (!episodeUrl) {
        return { success: false, error: 'MISSING_EPISODE_URL' };
    }
    if (!episodes.length) {
        return { success: false, error: 'MISSING_EPISODES' };
    }
    if (!changeId) {
        return { success: false, error: 'MISSING_CHANGE_ID' };
    }

    return {
        success: true,
        snapshot: {
            kind: 'episode',
            title: String(payload.title || ''),
            year: String(payload.year || ''),
            sourceCode: String(payload.sourceCode || ''),
            vodId: String(payload.vodId || ''),
            episodeIndex,
            episodeName: String(payload.episodeName || episode?.name || `第 ${episodeIndex + 1} 集`),
            episodeUrl,
            episodes,
            currentTime: 0,
            playbackRate: normalizeNumber(payload.playbackRate, 1) || 1,
            updatedAt: normalizeNumber(payload.updatedAt, now()),
            changeId,
        },
    };
}

function buildEpisodePlayback(snapshot = {}, previousPlayback = {}, paused = true) {
    return {
        paused,
        currentTime: 0,
        duration: 0,
        playbackRate: normalizeNumber(snapshot.playbackRate, previousPlayback.playbackRate || 1) || 1,
        updatedAt: now(),
    };
}

export class WatchRoomDurableObject {
    constructor(state, env) {
        this.state = state;
        this.env = env;
        this.sessions = new Map();
        this.roomCache = null;
        this.lastPlaybackCheckpointAt = 0;
        this.lastParticipantCheckpointAt = new Map();
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
        const room = await this.readRoom();
        if (!room || isTerminalRoomStatus(room.status)) return;
        const timestamp = now();

        if (
            room.status === ROOM_STATUS.HOST_DISCONNECTED
            && room.hostGraceExpiresAt
            && room.hostGraceExpiresAt <= timestamp
        ) {
            await this.endRoom(room, room.hostId, 'host_reconnect_timeout');
            return;
        }

        let participantChanged = false;
        for (const [clientId, participant] of Object.entries(room.participants || {})) {
            if (
                participant.role === 'viewer'
                && !participant.online
                && participant.disconnectedAt
                && participant.disconnectedAt + VIEWER_RECONNECT_GRACE_MS <= timestamp
            ) {
                delete room.participants[clientId];
                participantChanged = true;
            }
        }
        if (participantChanged) {
            await this.writeRoom(room);
            await this.broadcastParticipants(room);
        }

        if (
            room.pendingEpisodeChangeId
            && room.episodeDeadlineAt
            && room.episodeDeadlineAt <= timestamp
        ) {
            const changeId = room.pendingEpisodeChangeId;
            delete room.episodeDeadlineAt;
            await this.maybeStartEpisodeChange(changeId, room.hostId, true);
            return;
        }
        if (
            room.status === ROOM_STATUS.STARTING
            && !room.pendingEpisodeChangeId
            && room.startDeadlineAt
            && room.startDeadlineAt <= timestamp
        ) {
            delete room.startDeadlineAt;
            await this.maybeEnterPlaying(room.hostId, true);
            return;
        }
        await this.scheduleNextAlarm(room);
    }

    async readRoom() {
        if (this.roomCache) return this.roomCache;
        const room = await this.state.storage.get('room');
        if (room) {
            console.log('[WatchRoomDO] load room from storage', room.roomId);
            this.roomCache = room;
        }
        return room;
    }

    async writeRoom(room) {
        room.updatedAt = now();
        this.roomCache = room;
        await this.state.storage.put('room', room);
        return room;
    }

    updateRoomEphemeral(room) {
        room.updatedAt = now();
        this.roomCache = room;
        return room;
    }

    async scheduleNextAlarm(room) {
        if (!room || isTerminalRoomStatus(room.status)) {
            await this.state.storage.deleteAlarm().catch(() => {});
            return;
        }
        const deadlines = [
            room.hostGraceExpiresAt,
            room.status === ROOM_STATUS.STARTING ? room.startDeadlineAt : null,
            room.status === ROOM_STATUS.STARTING ? room.episodeDeadlineAt : null,
            ...Object.values(room.participants || {}).flatMap((participant) => (
                participant.role === 'viewer' && !participant.online && participant.disconnectedAt
                    ? [participant.disconnectedAt + VIEWER_RECONNECT_GRACE_MS]
                    : []
            )),
        ].filter((value) => Number.isFinite(Number(value)) && Number(value) > 0);
        if (deadlines.length === 0) {
            await this.state.storage.deleteAlarm().catch(() => {});
            return;
        }
        await this.state.storage.setAlarm(Math.min(...deadlines));
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
        if (existing && !isTerminalRoomStatus(existing.status)) {
            return jsonResponse({ success: false, error: 'ROOM_ID_CONFLICT' }, 409);
        }

        const createdAt = now();
        const hostId = `host_${crypto.randomUUID()}`;
        const hostCredential = generateCredential();
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
                    online: false,
                    disconnectedAt: null,
                    credentialHash: await hashCredential(hostCredential),
                    joinedAt: createdAt,
                    lastSeenAt: createdAt,
                },
            },
            media: body.media || {},
            playback: normalizeInitialPlayback(body.playback || {}),
            createdAt,
            updatedAt: createdAt,
            hostDisconnectedAt: null,
            protocolVersion: 2,
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
            hostCredential,
            protocolVersion: room.protocolVersion,
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

        if (isTerminalRoomStatus(room.status)) {
            console.log('[WatchRoomDO] room unavailable', {
                roomId,
                status: room.status,
            });
            return jsonResponse(
                { success: false, error: getTerminalRoomError(room.status), status: room.status },
                getTerminalRoomHttpStatus(room.status)
            );
        }

        if (![ROOM_STATUS.WAITING, ROOM_STATUS.STARTING, ROOM_STATUS.PLAYING, ROOM_STATUS.HOST_DISCONNECTED].includes(room.status)) {
            return jsonResponse({ success: false, error: ERROR_CODE.HOST_DISCONNECTED }, 409);
        }

        return jsonResponse({
            success: true,
            roomId: room.roomId,
            status: room.status,
            maxMembers: room.maxMembers,
            participantsCount: Object.values(room.participants || {}).filter((participant) => participant.online).length,
            participantCount: Object.values(room.participants || {}).filter((participant) => participant.online).length,
            participants: getParticipantList(room.participants),
            media: room.media || {},
            playback: room.playback || {},
            protocolVersion: room.protocolVersion || 2,
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
        const credential = String(body.credential || '');
        const room = await this.readRoom();

        if (!room) {
            return jsonResponse({ success: false, error: ERROR_CODE.ROOM_NOT_FOUND }, 404);
        }

        if (isTerminalRoomStatus(room.status)) {
            return jsonResponse(
                { success: false, error: getTerminalRoomError(room.status), status: room.status },
                getTerminalRoomHttpStatus(room.status)
            );
        }

        if (
            clientId !== room.hostId
            || !await credentialMatches(room.participants?.[room.hostId], credential)
        ) {
            return jsonResponse({ success: false, error: ERROR_CODE.UNAUTHORIZED_ACTION }, 403);
        }

        await this.endRoom(room, clientId, 'host_ended');
        return jsonResponse({ success: true, roomId: room.roomId, status: ROOM_STATUS.ENDED });
    }

    async authorizeConnection(room, { role, clientId, credential, protocolVersion }) {
        if (String(protocolVersion || '') !== String(room.protocolVersion || 2)) {
            return { ok: false, status: 426, error: 'PROTOCOL_MISMATCH' };
        }

        if (role === 'host') {
            const host = room.participants?.[room.hostId];
            if (
                clientId !== room.hostId
                || !host
                || !await credentialMatches(host, credential)
            ) {
                return { ok: false, status: 403, error: ERROR_CODE.UNAUTHORIZED_ACTION };
            }
            return {
                ok: true,
                clientId: room.hostId,
                credentialHash: host.credentialHash,
                issuedCredential: '',
                reconnect: true,
            };
        }

        const existingParticipant = clientId ? room.participants?.[clientId] : null;
        if (existingParticipant) {
            if (
                existingParticipant.role !== 'viewer'
                || !await credentialMatches(existingParticipant, credential)
            ) {
                return { ok: false, status: 403, error: ERROR_CODE.UNAUTHORIZED_ACTION };
            }
            return {
                ok: true,
                clientId,
                credentialHash: existingParticipant.credentialHash,
                issuedCredential: '',
                reconnect: true,
            };
        }

        // A supplied secret may only resume its exact participant. Never turn
        // an invalid/cross-room credential into a fresh anonymous viewer.
        if (credential) {
            return { ok: false, status: 403, error: ERROR_CODE.UNAUTHORIZED_ACTION };
        }
        if (room.status === ROOM_STATUS.HOST_DISCONNECTED) {
            return { ok: false, status: 409, error: ERROR_CODE.HOST_DISCONNECTED };
        }
        if (Object.keys(room.participants || {}).length >= room.maxMembers) {
            return { ok: false, status: 409, error: ERROR_CODE.ROOM_FULL };
        }

        const issuedCredential = generateCredential();
        return {
            ok: true,
            clientId: `viewer_${crypto.randomUUID()}`,
            credentialHash: await hashCredential(issuedCredential),
            issuedCredential,
            reconnect: false,
        };
    }

    async handleWebSocket(request, url) {
        if (request.headers.get('Upgrade') !== 'websocket') {
            return jsonResponse({ success: false, error: 'Expected websocket upgrade' }, 426);
        }

        const roomId = String(url.searchParams.get('room') || '');
        const clientId = String(url.searchParams.get('clientId') || '');
        const role = url.searchParams.get('role') === 'host' ? 'host' : 'viewer';
        const protocolVersion = String(url.searchParams.get('protocolVersion') || '');
        const credential = readSocketCredential(request);

        if (!isValidRoomId(roomId)) {
            return jsonResponse({ success: false, error: ERROR_CODE.INVALID_ROOM_ID }, 400);
        }

        const room = await this.readRoom();
        if (!room || room.roomId !== roomId) {
            return jsonResponse({ success: false, error: ERROR_CODE.ROOM_NOT_FOUND }, 404);
        }

        if (isTerminalRoomStatus(room.status)) {
            return jsonResponse(
                { success: false, error: getTerminalRoomError(room.status), status: room.status },
                getTerminalRoomHttpStatus(room.status)
            );
        }

        const authorization = await this.authorizeConnection(room, {
            role,
            clientId,
            credential,
            protocolVersion,
        });
        if (!authorization.ok) {
            return jsonResponse({ success: false, error: authorization.error }, authorization.status);
        }

        const pair = new WebSocketPair();
        const client = pair[0];
        const server = pair[1];
        server.accept();

        await this.addParticipant(server, room, authorization.clientId, role, authorization);

        return new Response(null, {
            status: 101,
            headers: {
                'Sec-WebSocket-Protocol': WATCH_PROTOCOL,
            },
            webSocket: client,
        });
    }

    async addParticipant(socket, room, clientId, role, authorization = {}) {
        const joinedAt = now();
        this.closeExistingSession(clientId, socket);
        room.participants = room.participants || {};
        const existingParticipant = room.participants[clientId] || null;
        room.participants[clientId] = {
            id: clientId,
            role,
            name: role === 'host' ? '房主' : '观众',
            ready: role === 'host' ? true : Boolean(existingParticipant?.ready),
            startingReady: false,
            online: true,
            disconnectedAt: null,
            credentialHash: authorization.credentialHash || existingParticipant?.credentialHash || '',
            joinedAt: existingParticipant?.joinedAt || joinedAt,
            lastSeenAt: joinedAt,
        };

        if (role === 'host') {
            if (room.status === ROOM_STATUS.HOST_DISCONNECTED) {
                room.status = room.hostResumeStatus || ROOM_STATUS.WAITING;
                if (room.status === ROOM_STATUS.STARTING) {
                    if (room.pendingEpisodeChangeId) room.episodeDeadlineAt = now() + 3000;
                    else room.startDeadlineAt = now() + 3000;
                }
            }
            room.hostDisconnectedAt = null;
            delete room.hostGraceExpiresAt;
            delete room.hostResumeStatus;
        }

        await this.writeRoom(room);
        await this.scheduleNextAlarm(room);

        const generation = crypto.randomUUID();
        this.sessions.set(socket, { clientId, role, generation });

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

        if (authorization.issuedCredential) {
            socket.send(buildMessage('session:credentials', room.roomId, clientId, {
                clientId,
                role,
                credential: authorization.issuedCredential,
                protocolVersion: room.protocolVersion || 2,
            }));
        }
        socket.send(buildMessage('room:state', room.roomId, clientId, this.getPublicRoomState(room)));
        await this.broadcastParticipants(room);
        if (role === 'host' && authorization.reconnect) {
            this.broadcastToAll(buildMessage('room:host-reconnected', room.roomId, clientId, {
                status: room.status,
            }));
        }

        if (role === 'viewer' && room.status === ROOM_STATUS.WAITING) {
            socket.send(buildMessage('sync:prepare', room.roomId, clientId, {
                viewerId: clientId,
                status: room.status,
                media: room.media || {},
                playback: room.playback || {},
            }));
        } else if (role === 'viewer' && room.status === ROOM_STATUS.STARTING && room.pendingEpisodeChangeId) {
            socket.send(buildMessage('sync:episode-prepare', room.roomId, clientId, {
                ...(room.media || {}),
                playback: room.playback || {},
                status: ROOM_STATUS.STARTING,
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

        if (typeof rawData !== 'string') {
            this.sendError(socket, 'INVALID_MESSAGE', 'Only text JSON messages are accepted');
            return;
        }
        if (new TextEncoder().encode(rawData).byteLength > MAX_MESSAGE_BYTES) {
            this.sendError(socket, 'MESSAGE_TOO_LARGE', 'WebSocket message exceeds the size limit');
            return;
        }

        let message = {};
        try {
            message = JSON.parse(rawData);
        } catch (error) {
            this.sendError(socket, 'INVALID_MESSAGE', 'Invalid JSON message');
            return;
        }
        if (
            !isPlainObject(message)
            || typeof message.type !== 'string'
            || message.type.length === 0
            || message.type.length > 64
            || !ALLOWED_MESSAGE_TYPES.has(message.type)
            || (message.payload !== undefined && !isPlainObject(message.payload))
            || (message.roomId !== undefined && String(message.roomId) !== String((await this.readRoom())?.roomId || ''))
            || (message.clientId !== undefined && String(message.clientId) !== session.clientId)
        ) {
            this.sendError(
                socket,
                ALLOWED_MESSAGE_TYPES.has(message?.type) ? 'INVALID_MESSAGE' : 'UNKNOWN_EVENT',
                'Invalid WebSocket message shape',
            );
            return;
        }

        const room = await this.readRoom();
        if (!room || isTerminalRoomStatus(room.status)) {
            this.sendError(socket, ERROR_CODE.ROOM_ENDED, 'Room has ended');
            return;
        }

        if (message.type === 'client:ping' || message.type === 'client:heartbeat') {
            await this.touchParticipant(room, session.clientId);
            if (message.type === 'client:ping') {
                socket.send(buildMessage('server:pong', room.roomId, session.clientId, {
                    clientSentAt: Number(message.payload?.clientSentAt) || 0,
                    serverTime: now(),
                }));
            } else {
                socket.send(buildMessage('room:state', room.roomId, session.clientId, this.getPublicRoomState(room)));
            }
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

            await this.endRoom(room, session.clientId, 'host_ended');
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

        if (message.type === 'client:episode-ready') {
            await this.handleClientEpisodeReady(room, session, message);
            return;
        }

        if (message.type === 'host:start') {
            await this.handleHostStart(socket, room, session, message);
            return;
        }

        if (message.type === 'host:episode-change') {
            await this.handleHostEpisodeChange(socket, room, session, message);
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

        const playbackError = validatePlaybackPayload(message.payload || {});
        if (playbackError) {
            this.sendError(socket, 'INVALID_PLAYBACK', playbackError);
            return;
        }

        const playback = normalizePlaybackPayload(
            message.type,
            message.payload || {},
            room.playback || {}
        );

        room.playback = playback;
        const timestamp = now();
        if (
            message.type !== 'host:sync'
            || timestamp - this.lastPlaybackCheckpointAt >= PLAYBACK_CHECKPOINT_MS
        ) {
            await this.writeRoom(room);
            this.lastPlaybackCheckpointAt = timestamp;
        } else {
            this.updateRoomEphemeral(room);
        }
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

        const playbackError = validatePlaybackPayload(message.payload || {});
        if (playbackError) {
            this.sendError(socket, 'INVALID_PLAYBACK', playbackError);
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
        room.startDeadlineAt = now() + 3000;
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
        await this.scheduleNextAlarm(room);
    }

    getOnlineClientIds() {
        return [...this.sessions.values()]
            .map((session) => session.clientId)
            .filter(Boolean);
    }

    async handleHostEpisodeChange(socket, room, session, message) {
        console.log('[WatchRoomDO] host:episode-change received', {
            roomId: room.roomId,
            clientId: session.clientId,
            role: session.role,
            status: room.status,
        });

        if (session.role !== 'host' || session.clientId !== room.hostId) {
            this.sendError(socket, ERROR_CODE.UNAUTHORIZED_ACTION, 'Only host can change episode');
            return;
        }

        if (room.status !== ROOM_STATUS.PLAYING) {
            this.sendError(socket, ERROR_CODE.UNAUTHORIZED_ACTION, 'Room is not playing');
            return;
        }

        const playbackError = validatePlaybackPayload(message.payload || {});
        if (playbackError) {
            this.sendError(socket, 'INVALID_PLAYBACK', playbackError);
            return;
        }

        const normalized = normalizeEpisodeSnapshot(message.payload || {});
        if (!normalized.success) {
            this.sendError(socket, normalized.error, 'Invalid episode snapshot');
            return;
        }

        const snapshot = {
            ...normalized.snapshot,
            updatedAt: now(),
        };
        const playback = buildEpisodePlayback(snapshot, room.playback || {}, true);

        room.status = ROOM_STATUS.STARTING;
        room.media = snapshot;
        room.playback = playback;
        room.pendingEpisodeChangeId = snapshot.changeId;
        room.episodeReady = {};
        room.episodeStartedAt = now();
        room.episodeDeadlineAt = now() + 3000;

        Object.values(room.participants || {}).forEach((participant) => {
            participant.startingReady = false;
        });

        await this.writeRoom(room);
        this.broadcastToAll(buildMessage('sync:episode-prepare', room.roomId, session.clientId, {
            ...snapshot,
            playback,
            status: ROOM_STATUS.STARTING,
            sourceClientId: session.clientId,
        }));
        await this.broadcastParticipants(room);
        await this.scheduleNextAlarm(room);
    }

    async handleClientEpisodeReady(room, session, message) {
        const changeId = String(message.payload?.changeId || '');
        if (
            room.status !== ROOM_STATUS.STARTING
            || !room.pendingEpisodeChangeId
            || changeId !== room.pendingEpisodeChangeId
        ) {
            return;
        }

        room.episodeReady = room.episodeReady || {};
        room.episodeReady[session.clientId] = now();
        if (room.participants?.[session.clientId]) {
            room.participants[session.clientId].startingReady = true;
            room.participants[session.clientId].lastSeenAt = now();
        }
        await this.writeRoom(room);
        await this.broadcastParticipants(room);
        await this.maybeStartEpisodeChange(changeId, room.hostId, false);
    }

    async maybeStartEpisodeChange(changeId, sourceClientId, force = false) {
        const room = await this.readRoom();
        if (
            !room
            || room.status !== ROOM_STATUS.STARTING
            || room.pendingEpisodeChangeId !== changeId
        ) {
            return;
        }

        const ready = room.episodeReady || {};
        const onlineClientIds = this.getOnlineClientIds();
        const allReady = onlineClientIds.length === 0
            || onlineClientIds.every((clientId) => ready[clientId]);
        if (!force && !allReady) return;

        const playback = buildEpisodePlayback(room.media || {}, room.playback || {}, false);
        room.status = ROOM_STATUS.PLAYING;
        room.playback = playback;
        delete room.pendingEpisodeChangeId;
        delete room.episodeReady;
        delete room.episodeStartedAt;
        delete room.episodeDeadlineAt;
        await this.writeRoom(room);
        await this.scheduleNextAlarm(room);

        this.broadcastToAll(buildMessage('sync:episode-start', room.roomId, sourceClientId || room.hostId, {
            ...(room.media || {}),
            playback,
            paused: false,
            shouldPlay: true,
            status: ROOM_STATUS.PLAYING,
            sourceClientId: sourceClientId || room.hostId,
        }));
        await this.broadcastParticipants(room);
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
        if (room.pendingEpisodeChangeId) return;

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
            .filter((participant) => participant.role === 'viewer' && participant.online)
            .every((participant) => participant.ready);
    }

    areStartingClientsReady(room) {
        return Object.values(room.participants || {})
            .filter((participant) => participant.online)
            .every((participant) => participant.startingReady);
    }

    async maybeEnterPlaying(sourceClientId, force = false) {
        const room = await this.readRoom();
        if (!room || room.status !== ROOM_STATUS.STARTING) return;
        if (room.pendingEpisodeChangeId) return;
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
        delete room.startDeadlineAt;
        await this.writeRoom(room);
        await this.scheduleNextAlarm(room);
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
            this.updateRoomEphemeral(room);
            const lastCheckpoint = this.lastParticipantCheckpointAt.get(clientId) || 0;
            if (now() - lastCheckpoint >= PARTICIPANT_CHECKPOINT_MS) {
                await this.writeRoom(room);
                this.lastParticipantCheckpointAt.set(clientId, now());
            }
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
        if (!room || isTerminalRoomStatus(room.status)) return;

        if (session.role === 'host' && session.clientId === room.hostId) {
            if (!disconnected) {
                await this.endRoom(room, session.clientId, 'host_left');
                return;
            }
            const timestamp = now();
            const host = room.participants?.[session.clientId];
            if (host) {
                host.online = false;
                host.ready = true;
                host.startingReady = false;
                host.disconnectedAt = timestamp;
                host.lastSeenAt = timestamp;
            }
            room.hostResumeStatus = room.status;
            room.status = ROOM_STATUS.HOST_DISCONNECTED;
            room.hostDisconnectedAt = timestamp;
            room.hostGraceExpiresAt = timestamp + HOST_RECONNECT_GRACE_MS;
            delete room.startDeadlineAt;
            delete room.episodeDeadlineAt;
            await this.writeRoom(room);
            await this.scheduleNextAlarm(room);
            this.broadcastToAll(buildMessage('room:host-disconnected', room.roomId, session.clientId, {
                reconnectDeadline: room.hostGraceExpiresAt,
            }));
            await this.broadcastParticipants(room);
            return;
        }

        if (disconnected && room.participants?.[session.clientId]) {
            const timestamp = now();
            const participant = room.participants[session.clientId];
            participant.online = false;
            participant.ready = false;
            participant.startingReady = false;
            participant.disconnectedAt = timestamp;
            participant.lastSeenAt = timestamp;
            await this.writeRoom(room);
            await this.scheduleNextAlarm(room);
            await this.broadcastParticipants(room);
            return;
        }

        delete room.participants[session.clientId];

        if (Object.keys(room.participants || {}).length === 0) {
            room.status = ROOM_STATUS.EXPIRED;
            room.expiredAt = now();
            await this.writeRoom(room);
            return;
        }

        await this.writeRoom(room);
        await this.scheduleNextAlarm(room);
        await this.broadcastParticipants(room);
    }

    async endRoom(room, clientId, reason = 'host_ended') {
        room.status = ROOM_STATUS.ENDED;
        room.endedAt = now();
        room.endReason = reason;
        delete room.hostGraceExpiresAt;
        delete room.startDeadlineAt;
        delete room.episodeDeadlineAt;
        await this.writeRoom(room);
        await this.state.storage.deleteAlarm().catch(() => {});

        const message = buildMessage('room:ended', room.roomId, clientId, {
            reason,
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
        const onlineCount = Object.values(room.participants || {}).filter((participant) => participant.online).length;
        const payload = {
            participants: getParticipantList(room.participants),
            count: onlineCount,
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
        const participantCount = Object.values(room.participants || {}).filter(
            (participant) => participant.online,
        ).length;
        return {
            roomId: room.roomId,
            status: room.status,
            role: undefined,
            maxMembers: room.maxMembers,
            media: room.media || {},
            playback: room.playback || {},
            participants: getParticipantList(room.participants),
            participantCount,
            protocolVersion: room.protocolVersion || 2,
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

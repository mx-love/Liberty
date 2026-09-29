const MAX_MEMBERS = 10;
const MAX_MESSAGE_BYTES = 64 * 1024;
const HOST_RECONNECT_GRACE_MS = 45 * 1000;
const VIEWER_RECONNECT_GRACE_MS = 60 * 1000; // Bound retained identities/capacity using the same durable alarm.
const PLAYBACK_CHECKPOINT_INTERVAL_MS = 15 * 1000;
const HEARTBEAT_CHECKPOINT_INTERVAL_MS = 60 * 1000;
const START_TRANSITION_TIMEOUT_MS = 3000;
const HOST_AUTH_TIMEOUT_MS = 10000;
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
        ROOM_STATUS.HOST_DISCONNECTED,
    ].includes(status);
}

function getTerminalRoomError(status) {
    if (status === ROOM_STATUS.CLOSED) return ERROR_CODE.ROOM_CLOSED;
    if (status === ROOM_STATUS.EXPIRED) return ERROR_CODE.ROOM_EXPIRED;
    if (status === ROOM_STATUS.HOST_DISCONNECTED) return ERROR_CODE.HOST_DISCONNECTED;
    return ERROR_CODE.ROOM_ENDED;
}

function getTerminalRoomHttpStatus(status) {
    return status === ROOM_STATUS.HOST_DISCONNECTED ? 409 : 410;
}

function now() {
    return Date.now();
}

function generateResumeToken() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function hashResumeToken(token) {
    const value = new TextEncoder().encode(String(token || ''));
    const digest = await crypto.subtle.digest('SHA-256', value);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifyHostResumeToken(room, token) {
    if (!room?.hostResumeTokenHash || !token) return false;
    const candidateHash = await hashResumeToken(token);
    if (candidateHash.length !== room.hostResumeTokenHash.length) return false;
    let mismatch = 0;
    for (let index = 0; index < candidateHash.length; index += 1) {
        mismatch |= candidateHash.charCodeAt(index) ^ room.hostResumeTokenHash.charCodeAt(index);
    }
    return mismatch === 0;
}

export function ensureRoomDeadlines(room = {}) {
    room.deadlines = room.deadlines || {};
    const legacyFields = {
        startDeadlineAt: 'startTransitionDeadlineAt',
        episodeDeadlineAt: 'episodeTransitionDeadlineAt',
        hostReconnectDeadlineAt: 'hostReconnectDeadlineAt',
        viewerCleanupDeadlineAt: 'viewerCleanupDeadlineAt',
        roomExpireAt: 'roomExpireAt',
    };
    Object.entries(legacyFields).forEach(([key, legacyKey]) => {
        if (room.deadlines[key] == null && room[legacyKey] != null) {
            room.deadlines[key] = room[legacyKey];
        }
        delete room[legacyKey];
        const value = room.deadlines[key];
        room.deadlines[key] = typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
    });
    // Derive this from durable participant timestamps on every wake, including a cold restart.
    const viewerDeadlines = Object.values(room.participants || {})
        .filter(participant => participant.role === 'viewer' && participant.connected === false
            && Number.isFinite(participant.disconnectedAt))
        .map(participant => participant.disconnectedAt + VIEWER_RECONNECT_GRACE_MS);
    room.deadlines.viewerCleanupDeadlineAt = !isTerminalRoomStatus(room.status) && viewerDeadlines.length
        ? Math.min(...viewerDeadlines) : null;
    return room.deadlines;
}

export function getNextRoomDeadline(room = {}) {
    const deadlines = ensureRoomDeadlines(room);
    const values = Object.values(deadlines)
        .map(Number)
        .filter(deadline => Number.isFinite(deadline) && deadline > 0);
    return values.length ? Math.min(...values) : null;
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
        buffering: Boolean(participant.buffering),
        connected: participant.connected !== false,
        joinedAt: participant.joinedAt,
        lastSeenAt: participant.lastSeenAt,
    }));
}

function getStartingReadyState(room = {}) {
    const participants = Object.values(room.participants || {}).filter(participant => participant.connected !== false);
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

function clampNumber(value, min, max, fallback) {
    const number = normalizeNumber(value, fallback);
    return Math.min(max, Math.max(min, number));
}

export function normalizePlaybackPayload(type, payload = {}, previousPlayback = {}, serverNow = now()) {
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
        currentTime: clampNumber(payload.currentTime, 0, 7 * 24 * 60 * 60, previousPlayback.currentTime || 0),
        duration: clampNumber(payload.duration, 0, 30 * 24 * 60 * 60, previousPlayback.duration || 0),
        playbackRate: clampNumber(payload.playbackRate, 0.25, 4, previousPlayback.playbackRate || 1),
        clientUpdatedAt: normalizeNumber(payload.updatedAt, 0),
        updatedAt: serverNow,
        serverTimestamp: serverNow,
    };
}

function normalizeInitialPlayback(playback = {}) {
    const serverTimestamp = now();
    return {
        paused: true,
        currentTime: clampNumber(playback.currentTime, 0, 7 * 24 * 60 * 60, 0),
        duration: clampNumber(playback.duration, 0, 30 * 24 * 60 * 60, 0),
        playbackRate: clampNumber(playback.playbackRate, 0.25, 4, 1),
        updatedAt: serverTimestamp,
        serverTimestamp,
    };
}

function normalizeStartPlayback(payload = {}, previousPlayback = {}) {
    const serverTimestamp = now();
    return {
        paused: false,
        currentTime: clampNumber(payload.currentTime, 0, 7 * 24 * 60 * 60, previousPlayback.currentTime || 0),
        duration: clampNumber(payload.duration, 0, 30 * 24 * 60 * 60, previousPlayback.duration || 0),
        playbackRate: clampNumber(payload.playbackRate, 0.25, 4, previousPlayback.playbackRate || 1),
        updatedAt: serverTimestamp,
        serverTimestamp,
    };
}

function normalizePreparePayload(payload = {}, previousPlayback = {}) {
    const serverTimestamp = now();
    return {
        paused: true,
        currentTime: clampNumber(payload.currentTime, 0, 7 * 24 * 60 * 60, previousPlayback.currentTime || 0),
        duration: clampNumber(payload.duration, 0, 30 * 24 * 60 * 60, previousPlayback.duration || 0),
        playbackRate: clampNumber(payload.playbackRate, 0.25, 4, previousPlayback.playbackRate || 1),
        updatedAt: serverTimestamp,
        serverTimestamp,
    };
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
    const episodeIndex = payload.episodeIndex == null ? NaN : Number(payload.episodeIndex);
    const episodes = Array.isArray(payload.episodes)
        ? payload.episodes.map(normalizeEpisodeEntry)
        : [];
    const episode = Number.isInteger(episodeIndex) ? episodes[episodeIndex] : null;
    const episodeUrl = String(payload.episodeUrl || episode?.url || '');
    const changeId = String(payload.changeId || '');

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
            playbackRate: clampNumber(payload.playbackRate, 0.25, 4, 1),
            updatedAt: now(),
            changeId,
        },
    };
}

function buildEpisodePlayback(snapshot = {}, previousPlayback = {}, paused = true) {
    const serverTimestamp = now();
    return {
        paused,
        currentTime: 0,
        duration: 0,
        playbackRate: clampNumber(snapshot.playbackRate, 0.25, 4, previousPlayback.playbackRate || 1),
        updatedAt: serverTimestamp,
        serverTimestamp,
    };
}

export class WatchRoomDurableObject {
    constructor(state, env) {
        this.state = state;
        this.env = env;
        this.sessions = new Map();
        this.pendingHosts = new Set();
        this.authenticatingClients = new Set();
        this.roomCache = null;
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
        let room = await this.readRoom();
        if (!room) return;
        if (isTerminalRoomStatus(room.status)) {
            await this.state.storage.deleteAlarm();
            return;
        }
        const timestamp = now();
        const deadlines = ensureRoomDeadlines(room);
        const due = new Set(Object.keys(deadlines).filter(key =>
            Number.isFinite(deadlines[key]) && deadlines[key] > 0 && deadlines[key] <= timestamp));
        // Consume the entire due batch first. Terminal outcomes supersede playback transitions.
        due.forEach(key => { deadlines[key] = null; });
        const hostExpired = due.has('hostReconnectDeadlineAt') && !this.hasLiveClient(room.hostId);
        if (hostExpired || due.has('roomExpireAt')) {
            await this.endRoom(room, room.hostId, hostExpired ? 'host_reconnect_timeout' : 'room_expired',
                hostExpired ? ROOM_STATUS.ENDED : ROOM_STATUS.EXPIRED);
        } else if (room.pendingEpisodeChangeId && due.has('episodeDeadlineAt')) {
            await this.maybeStartEpisodeChange(room.pendingEpisodeChangeId, room.hostId, true);
            room = await this.readRoom();
        }

        if (!isTerminalRoomStatus(room.status) && room.status === ROOM_STATUS.STARTING
            && !room.pendingEpisodeChangeId
            && due.has('startDeadlineAt')) {
            await this.maybeEnterPlaying(room.hostId, true);
            room = await this.readRoom();
        }
        if (!isTerminalRoomStatus(room.status) && due.has('viewerCleanupDeadlineAt')) {
            for (const [clientId, participant] of Object.entries(room.participants || {})) {
                if (participant.role === 'viewer' && participant.connected === false
                    && participant.disconnectedAt + VIEWER_RECONNECT_GRACE_MS <= timestamp
                    && !this.hasLiveClient(clientId)) {
                    delete room.participants[clientId];
                }
            }
            await this.broadcastParticipants(room);
        }
        if (due.size) await this.writeRoom(room);
        await this.scheduleNextAlarm(room);
    }

    async readRoom() {
        if (this.roomCache) return this.roomCache;
        const room = await this.state.storage.get('room');
        this.roomCache = room || null;
        if (room) {
            console.log('[WatchRoomDO] load room from storage', room.roomId);
        }
        return room;
    }

    async writeRoom(room) {
        room.updatedAt = now();
        room.lastPersistedAt = room.updatedAt;
        this.roomCache = room;
        await this.state.storage.put('room', room);
        return room;
    }

    async checkpointRoom(room, intervalMs) {
        this.roomCache = room;
        const timestamp = now();
        if (timestamp - Number(room.lastPersistedAt || 0) < intervalMs) return room;
        return this.writeRoom(room);
    }

    hasLiveClient(clientId) {
        return [...this.sessions.values()].some(session => session.clientId === clientId);
    }

    async scheduleNextAlarm(room) {
        const nextDeadline = isTerminalRoomStatus(room.status) ? null : getNextRoomDeadline(room);
        if (!nextDeadline) {
            try { await this.state.storage.deleteAlarm(); } catch (error) {}
            return;
        }
        await this.state.storage.setAlarm(nextDeadline);
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
        const hostId = body.hostId || `host_${crypto.randomUUID()}`;
        const hostResumeToken = generateResumeToken();
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
                    buffering: false,
                    connected: true,
                    joinedAt: createdAt,
                    lastSeenAt: createdAt,
                },
            },
            media: body.media || {},
            playback: normalizeInitialPlayback(body.playback || {}),
            createdAt,
            updatedAt: createdAt,
            hostDisconnectedAt: null,
            hostResumeTokenHash: await hashResumeToken(hostResumeToken),
            deadlines: {
                startDeadlineAt: null,
                episodeDeadlineAt: null,
                hostReconnectDeadlineAt: null,
                roomExpireAt: null,
            },
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
            resumeToken: hostResumeToken,
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
        const resumeToken = String(body.resumeToken || '');
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

        if (clientId !== room.hostId || !await verifyHostResumeToken(room, resumeToken)) {
            return jsonResponse({ success: false, error: ERROR_CODE.UNAUTHORIZED_ACTION }, 403);
        }

        await this.endRoom(room, clientId, 'host_ended');
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

        if (isTerminalRoomStatus(room.status)) {
            return jsonResponse(
                { success: false, error: getTerminalRoomError(room.status), status: room.status },
                getTerminalRoomHttpStatus(room.status)
            );
        }

        const existingParticipant = room.participants?.[clientId];

        const participantIds = Object.keys(room.participants || {});
        if (!existingParticipant && participantIds.length >= room.maxMembers) {
            return jsonResponse({ success: false, error: ERROR_CODE.ROOM_FULL }, 409);
        }

        if (clientId.length > 128 || (role === 'host') !== (clientId === room.hostId)) {
            return jsonResponse({ success: false, error: ERROR_CODE.UNAUTHORIZED_ACTION }, 403);
        }
        if (this.pendingHosts.size >= MAX_MEMBERS * 2) {
            return jsonResponse({ success: false, error: 'AUTH_BUSY' }, 429);
        }

        const pair = new WebSocketPair();
        const client = pair[0];
        const server = pair[1];
        server.accept();

        this.awaitParticipantAuthentication(server, room.roomId, clientId, role);
        return new Response(null, {
            status: 101,
            webSocket: client,
        });
    }

    awaitParticipantAuthentication(socket, roomId, clientId, role = 'host') {
        this.pendingHosts.add(socket);
        let authenticating = false;
        let reserved = false;
        const cleanup = () => {
            clearTimeout(timer);
            this.pendingHosts.delete(socket);
            if (reserved) this.authenticatingClients.delete(clientId);
            reserved = false;
            socket.removeEventListener('message', authenticate);
            socket.removeEventListener('close', cleanup);
            socket.removeEventListener('error', cleanup);
        };
        const reject = () => {
            cleanup();
            try { socket.close(4003, 'authentication failed'); } catch (error) {}
        };
        const authenticate = async (event) => {
            if (authenticating) return;
            authenticating = true;
            try {
                if (typeof event.data !== 'string' || event.data.length > 2048) return reject();
                const message = JSON.parse(event.data);
                if (this.authenticatingClients.has(clientId)) return reject();
                this.authenticatingClients.add(clientId);
                reserved = true;
                const room = await this.readRoom();
                if (message.type !== 'client:resume' || message.roomId !== roomId
                    || message.clientId !== clientId || !room || isTerminalRoomStatus(room.status)
                    || (role === 'host') !== (clientId === room.hostId)) return reject();
                const participant = room.participants?.[clientId];
                let issuedToken = '';
                let resumeTokenHash = participant?.resumeTokenHash;
                if (role === 'host' || participant) {
                    if (typeof message.resumeToken !== 'string' || !/^[a-f0-9]{64}$/.test(message.resumeToken)
                        || !await verifyHostResumeToken(role === 'host' ? room : { hostResumeTokenHash: resumeTokenHash }, message.resumeToken)) return reject();
                } else {
                    if (message.resumeToken || Object.keys(room.participants || {}).length >= room.maxMembers) return reject();
                    issuedToken = generateResumeToken();
                    resumeTokenHash = await hashResumeToken(issuedToken);
                }
                if (!this.pendingHosts.has(socket)) return;
                await this.addParticipant(socket, room, clientId, role, { resumeTokenHash, issuedToken });
                cleanup();
            } catch (error) { reject(); }
        };
        // Only an unauthenticated transport timeout; room deadlines remain durable alarms.
        const timer = setTimeout(reject, HOST_AUTH_TIMEOUT_MS);
        socket.addEventListener('message', authenticate);
        socket.addEventListener('close', cleanup);
        socket.addEventListener('error', cleanup);
    }

    async addParticipant(socket, room, clientId, role, credential = {}) {
        if (isTerminalRoomStatus(room.status) || (role === 'host') !== (clientId === room.hostId)) {
            socket.close(4003, 'unauthorized participant');
            return;
        }
        const joinedAt = now();
        const connectionId = crypto.randomUUID();
        this.closeExistingSession(clientId, socket);
        room.participants = room.participants || {};
        room.participants[clientId] = {
            id: clientId,
            role,
            name: role === 'host' ? '房主' : '观众',
            ready: role === 'host' ? true : Boolean(room.participants[clientId]?.ready),
            startingReady: false,
            buffering: false,
            connected: true,
            joinedAt: room.participants[clientId]?.joinedAt || joinedAt,
            lastSeenAt: joinedAt,
            connectionId,
            resumeTokenHash: credential.resumeTokenHash || room.participants[clientId]?.resumeTokenHash,
        };

        if (role === 'host') {
            const wasDisconnected = Boolean(room.hostDisconnectedAt);
            room.hostDisconnectedAt = null;
            ensureRoomDeadlines(room).hostReconnectDeadlineAt = null;
            if (wasDisconnected) {
                this.broadcastToRole('viewer', buildMessage('room:host-reconnected', room.roomId, clientId, {}));
            }
        }

        this.sessions.set(socket, { clientId, role, connectionId });

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

        await this.writeRoom(room);
        await this.scheduleNextAlarm(room);
        if (this.sessions.get(socket)?.connectionId !== connectionId) return;

        // Private credential delivery to this socket only; never part of public room state.
        if (credential.issuedToken) socket.send(buildMessage('client:authenticated', room.roomId, clientId, {
            resumeToken: credential.issuedToken,
        }));

        socket.send(buildMessage('room:state', room.roomId, clientId, this.getPublicRoomState(room)));
        await this.broadcastParticipants(room);

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

        if (typeof rawData !== 'string' || new TextEncoder().encode(rawData).byteLength > MAX_MESSAGE_BYTES) {
            this.sendError(socket, 'MESSAGE_TOO_LARGE', 'Message must be JSON below 64 KiB');
            try { socket.close(1009, 'message too large'); } catch (error) {}
            return;
        }

        let message = {};
        try {
            message = JSON.parse(rawData);
        } catch (error) {
            this.sendError(socket, 'INVALID_MESSAGE', 'Invalid JSON message');
            return;
        }
        if (!message || typeof message.type !== 'string' || message.type.length > 64) {
            this.sendError(socket, 'INVALID_MESSAGE', 'Invalid message type');
            return;
        }
        if (message.payload !== undefined && (typeof message.payload !== 'object' || Array.isArray(message.payload))) {
            this.sendError(socket, 'INVALID_MESSAGE', 'Payload must be an object');
            return;
        }

        const room = await this.readRoom();
        if (this.sessions.get(socket) !== session) return;
        if (!room || isTerminalRoomStatus(room.status)) {
            this.sendError(socket, ERROR_CODE.ROOM_ENDED, 'Room has ended');
            return;
        }

        if (message.type === 'client:heartbeat') {
            await this.touchParticipant(room, session.clientId);
            const serverReceivedAt = now();
            socket.send(buildMessage('server:pong', room.roomId, session.clientId, {
                clientSentAt: normalizeNumber(message.sentAt, 0),
                serverReceivedAt,
                serverSentAt: now(),
            }));
            return;
        }

        if (message.type === 'client:buffering' || message.type === 'client:buffering-end') {
            const participant = room.participants?.[session.clientId];
            if (participant) {
                participant.buffering = message.type === 'client:buffering';
                participant.lastSeenAt = now();
                await this.checkpointRoom(room, PLAYBACK_CHECKPOINT_INTERVAL_MS);
                await this.broadcastParticipants(room);
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

        const playback = normalizePlaybackPayload(
            message.type,
            message.payload || {},
            room.playback || {}
        );

        room.playback = playback;
        if (message.type === 'host:sync') {
            await this.checkpointRoom(room, PLAYBACK_CHECKPOINT_INTERVAL_MS);
        } else {
            await this.writeRoom(room);
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
        ensureRoomDeadlines(room).startDeadlineAt = room.startingStartedAt + START_TRANSITION_TIMEOUT_MS;
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
        ensureRoomDeadlines(room).episodeDeadlineAt = room.episodeStartedAt + START_TRANSITION_TIMEOUT_MS;

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
        ensureRoomDeadlines(room).episodeDeadlineAt = null;
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
            .filter((participant) => participant.role === 'viewer' && participant.connected !== false)
            .every((participant) => participant.ready);
    }

    areStartingClientsReady(room) {
        return Object.values(room.participants || {})
            .filter((participant) => participant.connected !== false)
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
        ensureRoomDeadlines(room).startDeadlineAt = null;
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
            room.participants[clientId].connected = true;
            await this.checkpointRoom(room, HEARTBEAT_CHECKPOINT_INTERVAL_MS);
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
        if (room.participants?.[session.clientId]?.connectionId !== session.connectionId) return;

        if (session.role === 'host' && session.clientId === room.hostId) {
            if (!disconnected) {
                await this.endRoom(room, session.clientId, 'host_left');
                return;
            }
            if (this.hasLiveClient(room.hostId)) return;
            const disconnectedAt = now();
            room.hostDisconnectedAt = disconnectedAt;
            ensureRoomDeadlines(room).hostReconnectDeadlineAt = disconnectedAt + HOST_RECONNECT_GRACE_MS;
            if (room.participants?.[room.hostId]) {
                room.participants[room.hostId].connected = false;
                room.participants[room.hostId].buffering = false;
            }
            await this.writeRoom(room);
            await this.scheduleNextAlarm(room);
            await this.broadcastParticipants(room);
            this.broadcastToRole('viewer', buildMessage('room:host-reconnecting', room.roomId, room.hostId, {
                hostDisconnectedAt: disconnectedAt,
                reconnectDeadlineAt: room.deadlines.hostReconnectDeadlineAt,
                graceMs: HOST_RECONNECT_GRACE_MS,
            }));
            return;
        }

        if (disconnected && room.participants?.[session.clientId]?.resumeTokenHash) {
            room.participants[session.clientId].connected = false;
            room.participants[session.clientId].buffering = false;
            room.participants[session.clientId].ready = false;
            room.participants[session.clientId].startingReady = false;
            room.participants[session.clientId].disconnectedAt = now();
        } else {
            delete room.participants[session.clientId];
        }

        if (Object.keys(room.participants || {}).length === 0) {
            room.status = ROOM_STATUS.EXPIRED;
            room.expiredAt = now();
            await this.writeRoom(room);
            return;
        }

        await this.scheduleNextAlarm(room);
        await this.writeRoom(room);
        await this.broadcastParticipants(room);
        if (room.pendingEpisodeChangeId) {
            await this.maybeStartEpisodeChange(room.pendingEpisodeChangeId, room.hostId);
        } else if (room.status === ROOM_STATUS.STARTING) {
            await this.maybeEnterPlaying(room.hostId);
        }
    }

    async endRoom(room, clientId, reason = 'host_ended', status = ROOM_STATUS.ENDED) {
        if (!room || isTerminalRoomStatus(room.status)) return;
        room.status = status;
        room.endedAt = now();
        room.endReason = reason;
        Object.keys(ensureRoomDeadlines(room)).forEach(key => { room.deadlines[key] = null; });
        await this.writeRoom(room);
        try { await this.state.storage.deleteAlarm(); } catch (error) {}

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

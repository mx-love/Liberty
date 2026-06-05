(function () {
    window.LibertyWatchRoom = window.LibertyWatchRoom || {};

    const SESSION_ROOM_ID_KEY = 'watchRoomId';
    const SESSION_ROOM_ROLE_KEY = 'watchRoomRole';
    const SESSION_ROOM_CLIENT_ID_KEY = 'watchRoomClientId';
    const SESSION_REDIRECTING_KEY = 'watchRoomRedirecting';

    let activeRoom = null;
    let socket = null;
    let heartbeatTimer = null;
    let hostSyncTimer = null;
    let hostSeekDebounceTimer = null;
    let playerSyncSetupTimer = null;
    let playerSyncVideo = null;
    let playerSyncRole = '';
    let playerSyncCleanupCallbacks = [];
    let isApplyingRemoteSync = false;
    let isRedirectingToPlayer = false;
    let viewerInitialSyncComplete = false;
    let viewerInitialSyncTimer = null;
    let viewerReadySent = false;
    let pendingInitialPlayback = null;
    let pendingInitialMedia = null;
    let pendingInitialStatus = 'waiting';
    let lastSeekSyncToastAt = 0;
    let isStartingWatchRoom = false;

    const HOST_SYNC_INTERVAL = 5000;
    const HOST_SEEK_DEBOUNCE = 300;
    const REMOTE_SYNC_LOCK_MS = 500;
    const VIEWER_INITIAL_SYNC_DELAY = 900;

    function showMessage(message, type = 'info') {
        if (typeof window.showToast === 'function') {
            window.showToast(message, type);
            return;
        }

        console[type === 'error' ? 'error' : 'log'](`[WatchRoom] ${message}`);
    }

    function cleanRoomId(value = '') {
        return String(value || '').replace(/\s+/g, '');
    }

    function isValidRoomId(value = '') {
        return /^\d{8}$/.test(cleanRoomId(value));
    }

    function formatTime(seconds) {
        const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
        const minutes = Math.floor(safeSeconds / 60);
        const rest = safeSeconds % 60;
        return `${minutes}:${String(rest).padStart(2, '0')}`;
    }

    function toSafeIndex(value) {
        const index = Number(value);
        return Number.isFinite(index) && index >= 0 ? Math.floor(index) : 0;
    }

    function getPlaybackState() {
        return window.LibertyUtils?.playbackState || null;
    }

    function normalizeEpisodeUrls(episodes) {
        const playbackState = getPlaybackState();
        if (playbackState?.normalizeEpisodesToUrls) {
            return playbackState.normalizeEpisodesToUrls(Array.isArray(episodes) ? episodes : []);
        }

        const getEpisodeUrl = window.LibertyUtils?.media?.getEpisodeUrl || ((episode) => {
            if (!episode) return '';
            if (typeof episode === 'string') return episode;
            return episode.url || '';
        });

        return (Array.isArray(episodes) ? episodes : []).map(getEpisodeUrl).filter(Boolean);
    }

    function getPlayerVideoElement() {
        return document.querySelector('#player video') || document.querySelector('video');
    }

    function getCurrentArtInstance() {
        return window.LibertyPlayer?.art || window.art || window.artPlayer || null;
    }

    function getWatchRoomVideoElement() {
        const art = getCurrentArtInstance();
        return art?.video || art?.template?.$video || getPlayerVideoElement();
    }

    function normalizePlaybackNumber(value, fallback = 0) {
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
    }

    function getCurrentPlaybackSnapshot() {
        const art = getCurrentArtInstance();
        const video = getWatchRoomVideoElement();
        const currentTime = normalizePlaybackNumber(
            video?.currentTime ?? art?.currentTime,
            0
        );
        const duration = normalizePlaybackNumber(
            video?.duration ?? art?.duration,
            0
        );
        const playbackRate = normalizePlaybackNumber(
            video?.playbackRate ?? art?.playbackRate,
            1
        ) || 1;
        const paused = video
            ? video.paused
            : art?.paused !== undefined
                ? Boolean(art.paused)
                : true;

        const snapshot = {
            paused,
            currentTime,
            duration: duration > 0 ? duration : 0,
            playbackRate,
            updatedAt: Date.now()
        };
        console.log('[WatchRoom] playback snapshot', snapshot);
        return snapshot;
    }

    function isPlayerPage() {
        const path = window.location.pathname.toLowerCase();
        return path.endsWith('/player.html') || path.endsWith('player.html');
    }

    function readSessionValue(key) {
        try {
            return sessionStorage.getItem(key) || '';
        } catch (error) {
            return '';
        }
    }

    function writeSessionValue(key, value) {
        try {
            sessionStorage.setItem(key, String(value || ''));
        } catch (error) {}
    }

    function removeSessionValue(key) {
        try {
            sessionStorage.removeItem(key);
        } catch (error) {}
    }

    function persistRoomSession(room) {
        if (!room?.roomId || !room?.role) return;

        writeSessionValue(SESSION_ROOM_ID_KEY, room.roomId);
        writeSessionValue(SESSION_ROOM_ROLE_KEY, room.role);
        if (room.clientId !== undefined) {
            writeSessionValue(SESSION_ROOM_CLIENT_ID_KEY, room.clientId);
        }
    }

    function clearStoredRoomSession() {
        removeSessionValue(SESSION_ROOM_ID_KEY);
        removeSessionValue(SESSION_ROOM_ROLE_KEY);
        removeSessionValue(SESSION_ROOM_CLIENT_ID_KEY);
    }

    function getCurrentPlaybackInfo() {
        const urlParams = new URLSearchParams(window.location.search);
        const snapshot = getCurrentPlaybackSnapshot();
        const titleElement = document.getElementById('videoTitle');
        const episodeElement = document.getElementById('episodeInfo');
        const playbackState = getPlaybackState();
        const session = playbackState?.readPlaybackSession ? playbackState.readPlaybackSession() : {};

        return {
            title: (titleElement?.textContent || urlParams.get('title') || session.title || localStorage.getItem('currentVideoTitle') || '未知视频').trim(),
            episode: (episodeElement?.textContent || `第 ${(Number(urlParams.get('index')) || 0) + 1} 集`).trim(),
            currentTime: snapshot.currentTime,
            duration: snapshot.duration,
            paused: snapshot.paused,
            playbackRate: snapshot.playbackRate,
            session
        };
    }

    function getPlaybackSyncPayload() {
        return getCurrentPlaybackSnapshot();
    }

    function calculateTargetTime(playback) {
        const currentTime = Number(playback?.currentTime || 0);
        const duration = Number(playback?.duration || 0);
        const updatedAt = Number(playback?.updatedAt || 0);
        const paused = Boolean(playback?.paused);

        let targetTime = currentTime;

        if (!paused && updatedAt > 0) {
            targetTime += Math.max(0, Date.now() - updatedAt) / 1000;
        }

        if (duration > 0) {
            targetTime = Math.min(targetTime, Math.max(0, duration - 1));
        }

        return Math.max(0, targetTime);
    }

    function isVideoReady(video) {
        return Boolean(video && video.readyState >= 1);
    }

    function waitForVideoReady(callback) {
        const video = getWatchRoomVideoElement();
        if (isVideoReady(video)) {
            callback(video);
            return;
        }

        if (!video) {
            window.setTimeout(() => waitForVideoReady(callback), 300);
            return;
        }

        let done = false;
        const cleanup = () => {
            video.removeEventListener('loadedmetadata', handleReady);
            video.removeEventListener('canplay', handleReady);
        };
        const handleReady = () => {
            if (done) return;
            done = true;
            cleanup();
            callback(video);
        };

        video.addEventListener('loadedmetadata', handleReady);
        video.addEventListener('canplay', handleReady);
        window.setTimeout(handleReady, 3000);
    }

    function tryPlayVideo(video, warning = '请点击一次播放以加入同步') {
        if (!video) return;

        try {
            Promise.resolve(video.play()).catch(() => {
                showMessage(warning, 'warning');
            });
        } catch (error) {
            showMessage(warning, 'warning');
        }
    }

    function getCurrentEpisodeUrl(episodes, episodeIndex) {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('url') || episodes[episodeIndex] || '';
    }

    function buildCreatePayload() {
        const playbackInfo = getCurrentPlaybackInfo();
        const session = playbackInfo.session || {};
        let episodes = normalizeEpisodeUrls(session.episodes);
        let episodeIndex = toSafeIndex(session.episodeIndex ?? new URLSearchParams(window.location.search).get('index'));
        let episodeUrl = getCurrentEpisodeUrl(episodes, episodeIndex);

        if (episodeUrl && !episodes.length) {
            episodes = [episodeUrl];
            episodeIndex = 0;
        }

        if (episodeUrl && episodes.length && !episodes[episodeIndex]) {
            const matchedIndex = episodes.indexOf(episodeUrl);
            if (matchedIndex >= 0) {
                episodeIndex = matchedIndex;
            }
        }

        return {
            media: {
                title: playbackInfo.title,
                year: session.year || localStorage.getItem('currentVideoYear') || '',
                sourceCode: session.sourceCode || localStorage.getItem('currentSourceCode') || '',
                sourceName: session.sourceName || localStorage.getItem('currentSourceName') || '',
                vodId: session.vodId || localStorage.getItem('currentVodId') || '',
                episodeIndex,
                episodeName: playbackInfo.episode,
                episodeUrl,
                episodes
            },
            playback: {
                paused: true,
                currentTime: playbackInfo.currentTime,
                duration: playbackInfo.duration,
                playbackRate: playbackInfo.playbackRate,
                updatedAt: Date.now()
            }
        };
    }

    function buildPlaybackSessionFromRoomState(payload = {}) {
        const media = payload.media || {};
        let episodes = normalizeEpisodeUrls(media.episodes);
        let episodeIndex = toSafeIndex(media.episodeIndex);
        let episodeUrl = media.episodeUrl || episodes[episodeIndex] || '';

        if (!episodeUrl && episodes.length) {
            episodeIndex = Math.min(episodeIndex, episodes.length - 1);
            episodeUrl = episodes[episodeIndex] || '';
        }

        if (episodeUrl && episodes.length && episodes[episodeIndex] !== episodeUrl) {
            const matchedIndex = episodes.indexOf(episodeUrl);
            if (matchedIndex >= 0) {
                episodeIndex = matchedIndex;
            }
        }

        if (episodeUrl && !episodes.length) {
            episodes = [episodeUrl];
            episodeIndex = 0;
        }

        if (!episodeUrl || !episodes.length) {
            const reason = !episodeUrl
                ? 'missing episodeUrl and no playable episode at episodeIndex'
                : 'missing playable episodes';
            console.warn('[WatchRoom] cannot redirect, reason:', reason, {
                media,
                episodeIndex,
                episodeUrl,
                episodes
            });
            return null;
        }

        return {
            title: media.title || '未知视频',
            year: media.year || '',
            sourceCode: media.sourceCode || '',
            sourceName: media.sourceName || '',
            vodId: media.vodId || '',
            episodeIndex,
            episodeName: media.episodeName || `第${episodeIndex + 1}集`,
            episodeUrl,
            episodes
        };
    }

    function writePlaybackSessionForViewer(session) {
        const playbackState = getPlaybackState();
        if (playbackState?.writePlaybackSession) {
            playbackState.writePlaybackSession(session);
        } else {
            localStorage.setItem('currentVideoTitle', session.title || '未知视频');
            localStorage.setItem('currentVideoYear', session.year || '');
            localStorage.setItem('currentSourceCode', session.sourceCode || '');
            localStorage.setItem('currentSourceName', session.sourceName || '');
            localStorage.setItem('currentVodId', session.vodId || '');
            localStorage.setItem('currentEpisodeIndex', String(session.episodeIndex || 0));
            localStorage.setItem('currentEpisodes', JSON.stringify(session.episodes || []));
        }

        localStorage.setItem('lastPlayTime', String(Date.now()));
    }

    function buildPlayerUrl(session, playback = {}) {
        const params = new URLSearchParams();

        if (session.vodId) params.set('id', session.vodId);
        if (session.sourceCode) params.set('source', session.sourceCode);
        params.set('url', session.episodeUrl);
        params.set('index', String(session.episodeIndex || 0));
        params.set('title', session.title || '未知视频');
        if (session.year) params.set('year', session.year);

        const position = Math.floor(Number(playback.currentTime) || 0);
        if (position > 0) {
            params.set('position', String(position));
        }

        return `player.html?${params.toString()}`;
    }

    function isCurrentPlayerUrl(playerUrl) {
        try {
            const currentUrl = new URL(window.location.href);
            const targetUrl = new URL(playerUrl, window.location.origin);
            return currentUrl.pathname === targetUrl.pathname && currentUrl.search === targetUrl.search;
        } catch (error) {
            return false;
        }
    }

    function enterHostPlayback(payload = {}, message = {}) {
        console.log('[WatchRoom] isPlayerPage', isPlayerPage());
        if (isPlayerPage()) {
            console.log('[WatchRoom] skip redirect on player page');
            return false;
        }

        if (isRedirectingToPlayer) {
            console.warn('[WatchRoom] duplicate redirect skipped');
            return false;
        }

        const media = payload.media || {};
        const playback = payload.playback || {};
        console.log('[WatchRoom] viewer redirect check', { media, playback });

        const session = buildPlaybackSessionFromRoomState(payload);
        if (!session) {
            showMessage('房主当前播放信息不完整，无法进入播放页', 'error');
            return false;
        }

        const room = {
            ...(activeRoom || {}),
            roomId: message.roomId || payload.roomId || activeRoom?.roomId,
            role: 'viewer',
            clientId: message.clientId || activeRoom?.clientId || '',
            participantCount: payload.participantCount || activeRoom?.participantCount || 1,
            maxMembers: payload.maxMembers || activeRoom?.maxMembers || 10,
            status: payload.status || activeRoom?.status || 'waiting'
        };

        persistRoomSession(room);
        console.log('[WatchRoom] writing playback session');
        writePlaybackSessionForViewer(session);
        const playerUrl = buildPlayerUrl(session, playback);
        if (isCurrentPlayerUrl(playerUrl)) {
            console.log('[WatchRoom] already at target player url, skip reload');
            return false;
        }

        isRedirectingToPlayer = true;
        writeSessionValue(SESSION_REDIRECTING_KEY, '1');
        closeSocket(false);
        showMessage('已加入一起看，正在进入播放页', 'success');
        console.log('[WatchRoom] redirecting to player', playerUrl);
        window.location.href = playerUrl;
        return true;
    }

    function ensureWatchRoomModal() {
        let modal = document.getElementById('watchRoomModal');
        if (modal) return modal;

        modal = document.createElement('div');
        modal.id = 'watchRoomModal';
        modal.className = 'watch-room-modal hidden';
        modal.innerHTML = `
            <div class="watch-room-modal-backdrop" data-watch-room-close="true"></div>
            <div class="watch-room-dialog" role="dialog" aria-modal="true" aria-labelledby="watchRoomModalTitle">
                <div class="watch-room-dialog-header">
                    <div>
                        <h3 id="watchRoomModalTitle" class="watch-room-title">一起看中</h3>
                        <p class="watch-room-subtitle">已连接房间服务，可等待房主开播并同步播放状态。</p>
                    </div>
                    <button type="button" class="watch-room-close" data-watch-room-close="true" aria-label="关闭一起看弹窗">&times;</button>
                </div>
                <div id="watchRoomModalContent" class="watch-room-dialog-body"></div>
            </div>
        `;
        document.body.appendChild(modal);

        modal.addEventListener('click', (event) => {
            if (event.target?.dataset?.watchRoomClose === 'true') {
                closeWatchRoomPanel();
            }
        });

        return modal;
    }

    function getParticipantCount() {
        return activeRoom?.participantCount || activeRoom?.members || 1;
    }

    function getMaxMembers() {
        return activeRoom?.maxMembers || 10;
    }

    function getRoomStatusText() {
        if (activeRoom?.status === 'waiting') return '等待开播';
        if (activeRoom?.status === 'playing') return '一起看中';
        return '已连接';
    }

    function renderWatchRoomPanel() {
        const modal = ensureWatchRoomModal();
        const content = modal.querySelector('#watchRoomModalContent');
        if (!content || !activeRoom) return;

        const playbackInfo = getCurrentPlaybackInfo();
        const isHost = activeRoom.role === 'host';
        const isWaitingHost = isHost && activeRoom.status === 'waiting';
        content.innerHTML = `
            <div class="watch-room-room-id" aria-label="房间号">${activeRoom.roomId}</div>
            <div class="watch-room-meta-grid">
                <div>
                    <span class="watch-room-meta-label">在线</span>
                    <strong>${getParticipantCount()}/${getMaxMembers()}</strong>
                </div>
                <div>
                    <span class="watch-room-meta-label">身份</span>
                    <strong>${isHost ? '你是房主' : '你是观众'}</strong>
                </div>
                <div>
                    <span class="watch-room-meta-label">状态</span>
                    <strong>${getRoomStatusText()}</strong>
                </div>
            </div>
            <div class="watch-room-current">
                <div class="watch-room-current-row">
                    <span>当前视频</span>
                    <strong title="${escapeHtml(playbackInfo.title)}">${escapeHtml(playbackInfo.title)}</strong>
                </div>
                <div class="watch-room-current-row">
                    <span>当前集数</span>
                    <strong>${escapeHtml(playbackInfo.episode)}</strong>
                </div>
                <div class="watch-room-current-row">
                    <span>当前进度</span>
                    <strong>${formatTime(playbackInfo.currentTime)}</strong>
                </div>
            </div>
            <p class="watch-room-help">${isHost
                ? '把房间号发给好友，好友打开网站后在设置里输入房间号即可加入。'
                : activeRoom.status === 'waiting'
                    ? '正在等待房主开始播放。'
                    : '已加入一起看，正在跟随房主播放。'}</p>
            <div class="watch-room-actions">
                ${isHost ? '<button type="button" class="watch-room-primary" id="copyWatchRoomIdBtn">复制房间号</button>' : ''}
                ${isWaitingHost ? '<button type="button" class="watch-room-primary" id="startWatchRoomBtn">开始一起看</button>' : ''}
                <button type="button" class="${isHost ? 'watch-room-danger' : 'watch-room-primary'}" id="${isHost ? 'endWatchRoomBtn' : 'leaveWatchRoomBtn'}">
                    ${isHost ? '结束房间' : '退出房间'}
                </button>
            </div>
        `;

        content.querySelector('#copyWatchRoomIdBtn')?.addEventListener('click', copyRoomId);
        content.querySelector('#startWatchRoomBtn')?.addEventListener('click', startWatchRoom);
        content.querySelector('#endWatchRoomBtn')?.addEventListener('click', endRoom);
        content.querySelector('#leaveWatchRoomBtn')?.addEventListener('click', leaveRoom);
    }

    function openWatchRoomPanel() {
        if (!activeRoom) {
            createRoom();
            return;
        }

        renderWatchRoomPanel();
        ensureWatchRoomModal().classList.remove('hidden');
    }

    function closeWatchRoomPanel() {
        document.getElementById('watchRoomModal')?.classList.add('hidden');
    }

    function updatePlayerWatchRoomButton() {
        const button = document.getElementById('watchRoomButton');
        if (!button) return;

        const label = button.querySelector('.watch-room-button-label');
        const text = activeRoom
            ? `${activeRoom.status === 'waiting' ? '等待开播' : '一起看中'} · ${getParticipantCount()}/${getMaxMembers()}`
            : '一起看';

        if (label) {
            label.textContent = text;
        } else {
            button.textContent = text;
        }
        button.setAttribute('aria-pressed', activeRoom ? 'true' : 'false');
    }

    function setActiveRoom(room) {
        const previousStatus = activeRoom?.status;
        activeRoom = room;
        if (previousStatus !== activeRoom?.status) {
            console.log('[WatchRoom] room status updated', activeRoom?.status);
        }
        updatePlayerWatchRoomButton();
        setupPlayerSyncForRoom();
        if (!document.getElementById('watchRoomModal')?.classList.contains('hidden')) {
            renderWatchRoomPanel();
        }
    }

    function setupPlayerSyncForRoom() {
        if (!isPlayerPage() || !activeRoom) {
            cleanupPlayerSync();
            return;
        }

        const video = getWatchRoomVideoElement();
        if (!video) {
            if (!playerSyncSetupTimer) {
                playerSyncSetupTimer = window.setTimeout(() => {
                    playerSyncSetupTimer = null;
                    setupPlayerSyncForRoom();
                }, 500);
            }
            return;
        }

        if (playerSyncVideo === video && playerSyncRole === activeRoom.role) return;

        cleanupPlayerSync();
        playerSyncVideo = video;
        playerSyncRole = activeRoom.role;

        if (activeRoom.role === 'host') {
            setupHostPlaybackSync(video);
        } else if (activeRoom.role === 'viewer') {
            setupViewerWaitingGuard(video);
        }
    }

    function cleanupPlayerSync() {
        if (playerSyncSetupTimer) {
            window.clearTimeout(playerSyncSetupTimer);
            playerSyncSetupTimer = null;
        }
        if (viewerInitialSyncTimer) {
            window.clearTimeout(viewerInitialSyncTimer);
            viewerInitialSyncTimer = null;
        }
        if (hostSyncTimer) {
            window.clearInterval(hostSyncTimer);
            hostSyncTimer = null;
        }
        if (hostSeekDebounceTimer) {
            window.clearTimeout(hostSeekDebounceTimer);
            hostSeekDebounceTimer = null;
        }
        playerSyncCleanupCallbacks.forEach((cleanup) => {
            try {
                cleanup();
            } catch (error) {}
        });
        playerSyncCleanupCallbacks = [];
        playerSyncVideo = null;
        playerSyncRole = '';
    }

    function resetViewerInitialSync() {
        if (viewerInitialSyncTimer) {
            window.clearTimeout(viewerInitialSyncTimer);
            viewerInitialSyncTimer = null;
        }
        viewerInitialSyncComplete = false;
        viewerReadySent = false;
        pendingInitialPlayback = null;
        pendingInitialMedia = null;
        pendingInitialStatus = 'waiting';
    }

    function addVideoSyncListener(video, eventName, handler) {
        video.addEventListener(eventName, handler);
        playerSyncCleanupCallbacks.push(() => video.removeEventListener(eventName, handler));
    }

    function canBroadcastHostSync() {
        return isPlayerPage()
            && activeRoom?.role === 'host'
            && activeRoom?.status === 'playing'
            && !isApplyingRemoteSync
            && socket?.readyState === WebSocket.OPEN;
    }

    function getHostSyncBlockReason() {
        if (!isPlayerPage()) return 'not_player_page';
        if (activeRoom?.role !== 'host') return 'not_host';
        if (activeRoom?.status !== 'playing') return 'room_not_playing';
        if (isApplyingRemoteSync) return 'applying_remote_sync';
        if (socket?.readyState !== WebSocket.OPEN) return 'socket_not_open';
        return '';
    }

    function sendHostPlaybackEvent(type) {
        if (!canBroadcastHostSync()) {
            if (type !== 'host:sync') {
                console.warn('[WatchRoom] host event blocked', {
                    reason: getHostSyncBlockReason(),
                    role: activeRoom?.role,
                    socketReady: socket?.readyState === WebSocket.OPEN,
                    roomStatus: activeRoom?.status,
                    isApplyingRemoteSync
                });
            }
            return false;
        }

        const payload = getPlaybackSyncPayload();
        if (type !== 'host:sync') {
            console.log('[WatchRoom] send host event', {
                type,
                currentTime: payload.currentTime,
                roomStatus: activeRoom?.status
            });
        }

        return sendSocketMessage({
            type,
            payload
        });
    }

    function debounceHostSeekSync() {
        if (hostSeekDebounceTimer) {
            window.clearTimeout(hostSeekDebounceTimer);
        }

        hostSeekDebounceTimer = window.setTimeout(() => {
            hostSeekDebounceTimer = null;
            sendHostPlaybackEvent('host:seek');
        }, HOST_SEEK_DEBOUNCE);
    }

    function setupHostPlaybackSync(video) {
        addVideoSyncListener(video, 'play', () => {
            if (activeRoom?.role === 'host' && activeRoom?.status === 'waiting') {
                console.log('[WatchRoom] host play in waiting, start together');
                pauseLocalForWaiting();
                sendHostStartFromCurrentPlayback('play');
                return;
            }
            sendHostPlaybackEvent('host:play');
        });
        addVideoSyncListener(video, 'pause', () => {
            if (!video.seeking) {
                sendHostPlaybackEvent('host:pause');
            }
        });
        addVideoSyncListener(video, 'seeked', () => {
            debounceHostSeekSync();
        });

        hostSyncTimer = window.setInterval(() => {
            if (document.hidden) return;
            sendHostPlaybackEvent('host:sync');
        }, HOST_SYNC_INTERVAL);
    }

    function setupViewerWaitingGuard(video) {
        addVideoSyncListener(video, 'play', () => {
            if (activeRoom?.role !== 'viewer' || activeRoom?.status !== 'waiting' || isApplyingRemoteSync) return;

            console.log('[WatchRoom] viewer play blocked in waiting');
            isApplyingRemoteSync = true;
            try {
                video.pause();
            } catch (error) {}
            showMessage('正在等待房主开始播放', 'info');
            window.setTimeout(() => {
                isApplyingRemoteSync = false;
            }, REMOTE_SYNC_LOCK_MS);
        });
    }

    function handleViewerReady(payload = {}) {
        if (activeRoom?.role === 'host') {
            showMessage('观众已准备，等待房主开始。', 'info');
        }
    }

    function scheduleViewerInitialSync(playback = {}, media = {}, status = '') {
        if (!isPlayerPage() || activeRoom?.role !== 'viewer' || viewerInitialSyncComplete) return;

        pendingInitialPlayback = playback || {};
        pendingInitialMedia = media || pendingInitialMedia || {};
        pendingInitialStatus = status || activeRoom?.status || pendingInitialStatus || 'waiting';

        if (viewerInitialSyncTimer) {
            window.clearTimeout(viewerInitialSyncTimer);
        }

        viewerInitialSyncTimer = window.setTimeout(() => {
            viewerInitialSyncTimer = null;
            applyViewerInitialSync();
        }, pendingInitialStatus === 'playing' ? 100 : VIEWER_INITIAL_SYNC_DELAY);
    }

    function applyViewerInitialSync() {
        if (!isPlayerPage() || activeRoom?.role !== 'viewer' || viewerInitialSyncComplete) return;

        waitForVideoReady((video) => {
            if (viewerInitialSyncComplete || !video) return;

            const playback = pendingInitialPlayback || {};
            const status = pendingInitialStatus || activeRoom?.status || 'waiting';
            const targetTime = calculateTargetTime(playback);

            isApplyingRemoteSync = true;
            try {
                if (status === 'waiting') {
                    video.pause();
                }
                video.currentTime = targetTime;
                if (playback.playbackRate && Number.isFinite(Number(playback.playbackRate))) {
                    video.playbackRate = Number(playback.playbackRate);
                }
            } catch (error) {}

            const finishReady = () => {
                sendViewerReady(targetTime);
                if (status === 'playing') {
                    tryPlayVideo(video);
                } else {
                    showMessage('正在等待房主开始播放', 'info');
                }
                window.setTimeout(() => {
                    isApplyingRemoteSync = false;
                }, REMOTE_SYNC_LOCK_MS);
            };

            if (Math.abs((Number(video.currentTime) || 0) - targetTime) > 0.5) {
                const onSeeked = () => {
                    video.removeEventListener('seeked', onSeeked);
                    finishReady();
                };
                video.addEventListener('seeked', onSeeked);
                window.setTimeout(() => {
                    video.removeEventListener('seeked', onSeeked);
                    finishReady();
                }, 1500);
            } else {
                finishReady();
            }
        });
    }

    function sendViewerReady(currentTime) {
        if (viewerReadySent) return;

        viewerReadySent = true;
        viewerInitialSyncComplete = true;
        sendSocketMessage({
            type: 'viewer:ready',
            payload: {
                currentTime,
                playbackRate: getWatchRoomVideoElement()?.playbackRate || 1,
                readyAt: Date.now()
            }
        });
    }

    function handleSyncStart(payload = {}) {
        if (!isPlayerPage() || !activeRoom) return;

        setActiveRoom({
            ...(activeRoom || {}),
            status: 'playing'
        });
        viewerInitialSyncComplete = true;

        waitForVideoReady((video) => {
            if (!video) return;

            const targetTime = calculateTargetTime({
                ...payload,
                paused: false
            });

            isApplyingRemoteSync = true;
            try {
                if (Math.abs((Number(video.currentTime) || 0) - targetTime) > 1) {
                    video.currentTime = targetTime;
                }
                if (payload.playbackRate && Number.isFinite(Number(payload.playbackRate))) {
                    video.playbackRate = Number(payload.playbackRate);
                }
            } catch (error) {}

            tryPlayVideo(video);
            window.setTimeout(() => {
                isApplyingRemoteSync = false;
            }, REMOTE_SYNC_LOCK_MS);
        });
    }

    function handleRemoteSyncMessage(type, payload = {}, sourceClientId = '') {
        if (!isPlayerPage() || activeRoom?.role !== 'viewer') {
            console.warn('[WatchRoom] cannot apply sync', {
                reason: !isPlayerPage() ? 'not_player_page' : 'not_viewer',
                type,
                role: activeRoom?.role
            });
            return;
        }
        if (sourceClientId && sourceClientId === activeRoom?.clientId) {
            console.warn('[WatchRoom] cannot apply sync', {
                reason: 'self_event',
                type,
                sourceClientId
            });
            return;
        }

        if (!viewerInitialSyncComplete) {
            scheduleViewerInitialSync(payload, pendingInitialMedia || {}, activeRoom?.status || pendingInitialStatus);
            return;
        }

        const video = getWatchRoomVideoElement();
        if (!video) {
            console.warn('[WatchRoom] cannot apply sync', {
                reason: 'video_not_ready',
                type
            });
            window.setTimeout(() => handleRemoteSyncMessage(type, payload, sourceClientId), 500);
            return;
        }

        applyRemotePlaybackSync(video, type, payload);
    }

    function applyRemotePlaybackSync(video, type, payload = {}) {
        const targetTime = Math.max(0, Number(payload.currentTime) || 0);
        const currentTime = Number(video.currentTime) || 0;
        const diff = Math.abs(currentTime - targetTime);
        const isSeekEvent = type === 'sync:seek';
        const shouldSeek = isSeekEvent || diff > 3;

        isApplyingRemoteSync = true;
        console.log('[WatchRoom] applying remote sync', {
            type,
            currentTime: targetTime,
            paused: payload.paused
        });

        try {
            if (payload.playbackRate && Number.isFinite(Number(payload.playbackRate))) {
                video.playbackRate = Number(payload.playbackRate);
            }

            if (shouldSeek) {
                video.currentTime = targetTime;
                showRemoteSeekHint();
            }

            const shouldPause = type === 'sync:pause'
                || (type === 'sync:state' && payload.paused === true)
                || (type === 'sync:seek' && payload.paused === true);
            const shouldPlay = type === 'sync:play'
                || (type === 'sync:state' && payload.paused === false)
                || (type === 'sync:seek' && payload.paused === false);

            if (shouldPause && !video.paused) {
                video.pause();
            } else if (shouldPlay && video.paused) {
                video.play().catch(() => {});
            }
        } finally {
            window.setTimeout(() => {
                isApplyingRemoteSync = false;
            }, REMOTE_SYNC_LOCK_MS);
        }
    }

    function showRemoteSeekHint() {
        const now = Date.now();
        if (now - lastSeekSyncToastAt < 5000) return;
        lastSeekSyncToastAt = now;
        showMessage('正在同步房主进度', 'info');
    }

    async function createRoom() {
        showMessage('正在创建房间...', 'info');

        try {
            const response = await fetch('/api/watch/create', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(buildCreatePayload())
            });
            const data = await response.json().catch(() => ({}));

            if (!response.ok || !data.success) {
                handleCreateError(response.status, data);
                return;
            }

            const room = {
                roomId: data.roomId,
                role: 'host',
                clientId: data.clientId,
                participantCount: 1,
                maxMembers: data.maxMembers || 10,
                status: data.status || 'waiting'
            };
            pauseLocalForWaiting();
            setActiveRoom(room);
            persistRoomSession(room);
            connectRoomSocket(data.roomId, 'host', data.clientId);
            renderWatchRoomPanel();
            ensureWatchRoomModal().classList.remove('hidden');
        } catch (error) {
            showMessage('一起看房间创建失败，请稍后重试', 'error');
        }
    }

    function handleCreateError(status, data = {}) {
        if (status === 503) {
            showMessage('一起看后端尚未配置', 'warning');
            return;
        }

        showMessage(data.error || '创建房间失败', 'error');
    }

    function pauseLocalForWaiting() {
        const video = getWatchRoomVideoElement();
        if (!video || video.paused) return;

        isApplyingRemoteSync = true;
        try {
            video.pause();
        } catch (error) {}
        window.setTimeout(() => {
            isApplyingRemoteSync = false;
        }, REMOTE_SYNC_LOCK_MS);
    }

    function startWatchRoom() {
        if (activeRoom?.role !== 'host') return;

        console.log('[WatchRoom] host start clicked', {
            roomId: activeRoom?.roomId,
            role: activeRoom?.role,
            clientId: activeRoom?.clientId,
            roomStatus: activeRoom?.status
        });

        sendHostStartFromCurrentPlayback('button');
    }

    function sendHostStartFromCurrentPlayback(trigger = 'button') {
        if (activeRoom?.role !== 'host') return false;
        if (isStartingWatchRoom) return false;

        isStartingWatchRoom = true;
        const payload = getPlaybackSyncPayload();
        console.log('[WatchRoom] send host:start', payload);

        const sent = sendSocketMessage({
            type: 'host:start',
            payload
        });

        if (!sent) {
            isStartingWatchRoom = false;
            showMessage('一起看尚未连接，请稍后重试', 'warning');
            return false;
        }

        setActiveRoom({
            ...(activeRoom || {}),
            status: 'playing'
        });
        tryPlayVideo(getWatchRoomVideoElement());
        window.setTimeout(() => {
            isStartingWatchRoom = false;
        }, 1000);
        return true;
    }

    function buildWebSocketUrl(roomId, role, clientId = '') {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = new URL(`${protocol}//${window.location.host}/api/watch/ws`);
        url.searchParams.set('room', roomId);
        url.searchParams.set('role', role);
        if (clientId) url.searchParams.set('clientId', clientId);
        return url.toString();
    }

    async function fetchRoomState(roomId) {
        const url = new URL('/api/watch/state', window.location.origin);
        url.searchParams.set('room', roomId);
        console.log('[WatchRoom] fetching room state', roomId);

        try {
            const response = await fetch(url.toString(), {
                method: 'GET',
                cache: 'no-store'
            });
            const data = await response.json().catch(() => ({}));

            if (response.status === 503) {
                showMessage('一起看后端尚未配置', 'warning');
                console.warn('[WatchRoom] cannot redirect, reason:', 'WATCH_ROOM_DO is not configured');
                return null;
            }

            if (!response.ok || !data.success) {
                const error = data.error || '';
                if (response.status === 404 || error === 'ROOM_NOT_FOUND') {
                    showMessage('房间不存在或已结束', 'error');
                } else if (response.status === 410 || error === 'ROOM_ENDED') {
                    showMessage('房间不存在或已结束', 'error');
                } else if (error === 'HOST_DISCONNECTED') {
                    showMessage('房主暂时离线', 'error');
                } else {
                    showMessage('一起看连接失败', 'error');
                }
                console.warn('[WatchRoom] cannot redirect, reason:', error || `HTTP ${response.status}`, data);
                return null;
            }

            console.log('[WatchRoom] room state received', data);
            return data;
        } catch (error) {
            showMessage('一起看连接失败', 'error');
            console.warn('[WatchRoom] cannot redirect, reason:', error?.message || String(error));
            return null;
        }
    }

    function connectRoomSocket(roomId, role, clientId = '') {
        closeSocket(false);

        socket = new WebSocket(buildWebSocketUrl(roomId, role, clientId));

        socket.addEventListener('open', () => {
            startHeartbeat();
            if (role === 'viewer') {
                console.log('[WatchRoom] viewer socket connected', {
                    roomId,
                    role,
                    clientId: clientId || '(server-generated)'
                });
                console.log('[WatchRoom] join room success', roomId);
                showMessage('已连接一起看房间', 'success');
            }
        });

        socket.addEventListener('message', (event) => {
            handleSocketMessage(event.data);
        });

        socket.addEventListener('close', () => {
            stopHeartbeat();
        });

        socket.addEventListener('error', () => {
            if (role === 'viewer') {
                showMessage('房间不存在或已结束', 'error');
                clearRoomState();
                return;
            }
            showMessage('一起看连接失败', 'error');
        });
    }

    function handleSocketMessage(rawData) {
        let message = {};
        try {
            message = JSON.parse(rawData);
        } catch (error) {
            return;
        }

        if (message.type === 'room:state') {
            const payload = message.payload || {};
            console.log('[WatchRoom] room:state received', payload);
            const room = {
                ...(activeRoom || {}),
                roomId: message.roomId || payload.roomId || activeRoom?.roomId,
                clientId: message.clientId || activeRoom?.clientId || '',
                participantCount: payload.participantCount || payload.participants?.length || activeRoom?.participantCount || 1,
                maxMembers: payload.maxMembers || activeRoom?.maxMembers || 10,
                status: payload.status || activeRoom?.status || 'waiting'
            };
            setActiveRoom(room);
            persistRoomSession(room);

            if (room.role === 'viewer' && isPlayerPage()) {
                console.log('[WatchRoom] skip redirect on player page');
                scheduleViewerInitialSync(payload.playback || {}, payload.media || {}, room.status);
                handleRemoteSyncMessage('sync:state', payload.playback || {}, message.clientId);
            } else if (room.role === 'viewer' && room.pendingPlayerRedirect) {
                enterHostPlayback(payload, message);
            }
            return;
        }

        if (message.type === 'sync:prepare') {
            const payload = message.payload || {};
            scheduleViewerInitialSync(payload.playback || {}, payload.media || {}, payload.status || activeRoom?.status || 'waiting');
            return;
        }

        if (message.type === 'viewer:ready') {
            handleViewerReady(message.payload || {});
            return;
        }

        if (message.type === 'sync:start') {
            console.log('[WatchRoom] received sync event', {
                type: message.type,
                payload: message.payload || {}
            });
            handleSyncStart(message.payload || {});
            return;
        }

        if (['sync:play', 'sync:pause', 'sync:seek', 'sync:state'].includes(message.type)) {
            console.log('[WatchRoom] received sync event', {
                type: message.type,
                payload: message.payload || {}
            });
            handleRemoteSyncMessage(
                message.type,
                message.payload || {},
                message.payload?.sourceClientId || message.clientId
            );
            return;
        }

        if (message.type === 'room:participants') {
            const payload = message.payload || {};
            const room = {
                ...(activeRoom || {}),
                participantCount: payload.count || payload.participants?.length || 1,
                maxMembers: payload.maxMembers || activeRoom?.maxMembers || 10
            };
            setActiveRoom(room);
            persistRoomSession(room);
            return;
        }

        if (message.type === 'room:ended') {
            showMessage('房主已结束一起看', 'info');
            clearRoomState();
            return;
        }

        if (message.type === 'room:error') {
            showMessage(getErrorMessage(message.payload?.code) || message.payload?.message || '一起看发生错误', 'error');
            if (activeRoom?.role === 'viewer') {
                clearRoomState();
            }
        }
    }

    function startHeartbeat() {
        stopHeartbeat();
        heartbeatTimer = window.setInterval(() => {
            sendSocketMessage({ type: 'client:heartbeat' });
        }, 30000);
    }

    function stopHeartbeat() {
        if (heartbeatTimer) {
            window.clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }
    }

    function sendSocketMessage(message) {
        if (!socket || socket.readyState !== WebSocket.OPEN) return false;
        socket.send(JSON.stringify({
            ...message,
            roomId: activeRoom?.roomId,
            clientId: activeRoom?.clientId,
            sentAt: Date.now()
        }));
        return true;
    }

    function closeSocket(sendLeave = true) {
        if (socket) {
            if (sendLeave && socket.readyState === WebSocket.OPEN) {
                sendSocketMessage({ type: 'room:leave' });
            }
            socket.close();
            socket = null;
        }
        stopHeartbeat();
    }

    async function endRoom() {
        if (!activeRoom) return;

        if (sendSocketMessage({ type: 'room:end' })) {
            return;
        }

        try {
            await fetch('/api/watch/end', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    roomId: activeRoom.roomId,
                    clientId: activeRoom.clientId
                })
            });
        } catch (error) {}

        clearRoomState();
    }

    function leaveRoom() {
        closeSocket(true);
        clearRoomState();
        showMessage('已退出一起看', 'info');
    }

    function clearRoomState() {
        closeSocket(false);
        cleanupPlayerSync();
        resetViewerInitialSync();
        clearStoredRoomSession();
        activeRoom = null;
        updatePlayerWatchRoomButton();
        closeWatchRoomPanel();
    }

    async function joinRoomById(roomId) {
        const cleaned = cleanRoomId(roomId);
        if (!isValidRoomId(cleaned)) {
            showMessage('请输入 8 位房间号', 'warning');
            return false;
        }

        const roomState = await fetchRoomState(cleaned);
        if (!roomState) return false;

        setActiveRoom({
            roomId: cleaned,
            role: 'viewer',
            clientId: '',
            participantCount: roomState.participantCount || roomState.participantsCount || 1,
            maxMembers: roomState.maxMembers || 10,
            status: roomState.status || 'waiting',
            pendingPlayerRedirect: false
        });
        return enterHostPlayback(roomState, {
            roomId: cleaned,
            clientId: ''
        });
    }

    function restoreActiveRoomFromSession() {
        if (isPlayerPage()) {
            removeSessionValue(SESSION_REDIRECTING_KEY);
            isRedirectingToPlayer = false;
        }

        if (activeRoom) return;

        const roomId = readSessionValue(SESSION_ROOM_ID_KEY);
        const role = readSessionValue(SESSION_ROOM_ROLE_KEY);
        const clientId = readSessionValue(SESSION_ROOM_CLIENT_ID_KEY);

        if (!isValidRoomId(roomId) || !['host', 'viewer'].includes(role)) {
            clearStoredRoomSession();
            return;
        }

        if (role === 'viewer') {
            resetViewerInitialSync();
        }

        setActiveRoom({
            roomId,
            role,
            clientId,
            participantCount: 1,
            maxMembers: 10,
            status: 'waiting',
            pendingPlayerRedirect: false
        });
        connectRoomSocket(roomId, role, clientId);
    }

    async function copyRoomId() {
        if (!activeRoom?.roomId) return;

        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(activeRoom.roomId);
            } else {
                const input = document.createElement('input');
                input.value = activeRoom.roomId;
                document.body.appendChild(input);
                input.select();
                document.execCommand('copy');
                input.remove();
            }
            showMessage('房间号已复制', 'success');
        } catch (error) {
            showMessage('复制失败，请检查浏览器权限', 'error');
        }
    }

    function getErrorMessage(code) {
        const messages = {
            ROOM_NOT_FOUND: '房间不存在或已结束',
            ROOM_ENDED: '房间不存在或已结束',
            ROOM_FULL: '房间人数已满',
            INVALID_ROOM_ID: '请输入 8 位房间号',
            HOST_DISCONNECTED: '房主暂时离线',
            UNAUTHORIZED_ACTION: '无权执行该操作'
        };
        return messages[code] || '';
    }

    function escapeHtml(value) {
        return (value || '')
            .toString()
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function initIndexWatchRoomUI() {
        const input = document.getElementById('watchRoomIdInput');
        const button = document.getElementById('joinWatchRoomBtn');
        if (!input || !button) return;

        input.addEventListener('input', () => {
            input.value = cleanRoomId(input.value).replace(/[^\d]/g, '').slice(0, 8);
        });

        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                joinRoomById(input.value);
            }
        });

        button.addEventListener('click', () => {
            joinRoomById(input.value);
        });
    }

    function initPlayerWatchRoomUI() {
        const button = document.getElementById('watchRoomButton');
        if (!button) return;

        button.addEventListener('click', openWatchRoomPanel);
        restoreActiveRoomFromSession();
        updatePlayerWatchRoomButton();
    }

    function initWatchRoomUI() {
        initIndexWatchRoomUI();
        initPlayerWatchRoomUI();
    }

    document.addEventListener('liberty:player-ready', setupPlayerSyncForRoom);
    document.addEventListener('DOMContentLoaded', initWatchRoomUI);

    window.LibertyWatchRoom.ui = {
        initWatchRoomUI,
        initIndexWatchRoomUI,
        initPlayerWatchRoomUI,
        openWatchRoomPanel,
        closeWatchRoomPanel,
        createRoom,
        createMockRoom: createRoom,
        startWatchRoom,
        endRoom,
        endMockRoom: endRoom,
        leaveRoom,
        joinRoomById,
        joinMockRoomById: joinRoomById,
        copyRoomId
    };
})();

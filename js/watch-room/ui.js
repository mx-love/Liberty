(function () {
    window.LibertyWatchRoom = window.LibertyWatchRoom || {};

    let activeRoom = null;
    let socket = null;
    let heartbeatTimer = null;

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

    function getPlayerVideoElement() {
        return document.querySelector('video');
    }

    function getCurrentPlaybackInfo() {
        const urlParams = new URLSearchParams(window.location.search);
        const video = getPlayerVideoElement();
        const titleElement = document.getElementById('videoTitle');
        const episodeElement = document.getElementById('episodeInfo');
        const playbackState = window.LibertyUtils?.playbackState;
        const session = playbackState?.readPlaybackSession ? playbackState.readPlaybackSession() : {};

        return {
            title: (titleElement?.textContent || urlParams.get('title') || session.title || localStorage.getItem('currentVideoTitle') || '未知视频').trim(),
            episode: (episodeElement?.textContent || `第 ${(Number(urlParams.get('index')) || 0) + 1} 集`).trim(),
            currentTime: video ? video.currentTime : 0,
            duration: video ? video.duration || 0 : 0,
            paused: video ? video.paused : true,
            playbackRate: video ? video.playbackRate || 1 : 1,
            session
        };
    }

    function buildCreatePayload() {
        const playbackInfo = getCurrentPlaybackInfo();
        const session = playbackInfo.session || {};

        return {
            media: {
                title: playbackInfo.title,
                year: session.year || localStorage.getItem('currentVideoYear') || '',
                sourceCode: session.sourceCode || localStorage.getItem('currentSourceCode') || '',
                sourceName: session.sourceName || localStorage.getItem('currentSourceName') || '',
                vodId: session.vodId || localStorage.getItem('currentVodId') || '',
                episodeIndex: session.episodeIndex || Number(new URLSearchParams(window.location.search).get('index')) || 0,
                episodeName: playbackInfo.episode,
                episodeUrl: new URLSearchParams(window.location.search).get('url') || '',
                episodes: Array.isArray(session.episodes) ? session.episodes : []
            },
            playback: {
                paused: playbackInfo.paused,
                currentTime: playbackInfo.currentTime,
                duration: playbackInfo.duration,
                playbackRate: playbackInfo.playbackRate,
                updatedAt: Date.now()
            }
        };
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
                        <p class="watch-room-subtitle">已连接房间服务，本阶段仅同步房间与在线人数。</p>
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

    function renderWatchRoomPanel() {
        const modal = ensureWatchRoomModal();
        const content = modal.querySelector('#watchRoomModalContent');
        if (!content || !activeRoom) return;

        const playbackInfo = getCurrentPlaybackInfo();
        const isHost = activeRoom.role === 'host';
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
                : '已加入一起看。本阶段暂不做播放同步，只显示房间与在线人数。'}</p>
            <div class="watch-room-actions">
                ${isHost ? '<button type="button" class="watch-room-primary" id="copyWatchRoomIdBtn">复制房间号</button>' : ''}
                <button type="button" class="${isHost ? 'watch-room-danger' : 'watch-room-primary'}" id="${isHost ? 'endWatchRoomBtn' : 'leaveWatchRoomBtn'}">
                    ${isHost ? '结束房间' : '退出房间'}
                </button>
            </div>
        `;

        content.querySelector('#copyWatchRoomIdBtn')?.addEventListener('click', copyRoomId);
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
            ? `一起看中 · ${getParticipantCount()}/${getMaxMembers()}`
            : '一起看';

        if (label) {
            label.textContent = text;
        } else {
            button.textContent = text;
        }
        button.setAttribute('aria-pressed', activeRoom ? 'true' : 'false');
    }

    function setActiveRoom(room) {
        activeRoom = room;
        updatePlayerWatchRoomButton();
        if (!document.getElementById('watchRoomModal')?.classList.contains('hidden')) {
            renderWatchRoomPanel();
        }
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

            setActiveRoom({
                roomId: data.roomId,
                role: 'host',
                clientId: data.clientId,
                participantCount: 1,
                maxMembers: data.maxMembers || 10
            });
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

    function buildWebSocketUrl(roomId, role, clientId = '') {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = new URL(`${protocol}//${window.location.host}/api/watch/ws`);
        url.searchParams.set('room', roomId);
        url.searchParams.set('role', role);
        if (clientId) url.searchParams.set('clientId', clientId);
        return url.toString();
    }

    function connectRoomSocket(roomId, role, clientId = '') {
        closeSocket(false);

        socket = new WebSocket(buildWebSocketUrl(roomId, role, clientId));

        socket.addEventListener('open', () => {
            startHeartbeat();
            if (role === 'viewer') {
                showMessage('已加入一起看', 'success');
            }
        });

        socket.addEventListener('message', (event) => {
            handleSocketMessage(event.data);
        });

        socket.addEventListener('close', () => {
            stopHeartbeat();
        });

        socket.addEventListener('error', () => {
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
            setActiveRoom({
                ...(activeRoom || {}),
                roomId: message.roomId || payload.roomId || activeRoom?.roomId,
                participantCount: payload.participantCount || payload.participants?.length || activeRoom?.participantCount || 1,
                maxMembers: payload.maxMembers || activeRoom?.maxMembers || 10
            });
            return;
        }

        if (message.type === 'room:participants') {
            const payload = message.payload || {};
            setActiveRoom({
                ...(activeRoom || {}),
                participantCount: payload.count || payload.participants?.length || 1,
                maxMembers: payload.maxMembers || activeRoom?.maxMembers || 10
            });
            return;
        }

        if (message.type === 'room:ended') {
            showMessage('房主已结束一起看', 'info');
            clearRoomState();
            return;
        }

        if (message.type === 'room:error') {
            showMessage(getErrorMessage(message.payload?.code) || message.payload?.message || '一起看发生错误', 'error');
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
        activeRoom = null;
        updatePlayerWatchRoomButton();
        closeWatchRoomPanel();
    }

    function joinRoomById(roomId) {
        const cleaned = cleanRoomId(roomId);
        if (!isValidRoomId(cleaned)) {
            showMessage('请输入 8 位房间号', 'warning');
            return false;
        }

        setActiveRoom({
            roomId: cleaned,
            role: 'viewer',
            clientId: '',
            participantCount: 1,
            maxMembers: 10
        });
        connectRoomSocket(cleaned, 'viewer');
        return true;
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
            ROOM_NOT_FOUND: '房间不存在',
            ROOM_ENDED: '房间已结束',
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
        updatePlayerWatchRoomButton();
    }

    function initWatchRoomUI() {
        initIndexWatchRoomUI();
        initPlayerWatchRoomUI();
    }

    document.addEventListener('DOMContentLoaded', initWatchRoomUI);

    window.LibertyWatchRoom.ui = {
        initWatchRoomUI,
        initIndexWatchRoomUI,
        initPlayerWatchRoomUI,
        openWatchRoomPanel,
        closeWatchRoomPanel,
        createRoom,
        endRoom,
        leaveRoom,
        joinRoomById,
        copyRoomId
    };
})();

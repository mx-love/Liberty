(function () {
    window.LibertyWatchRoom = window.LibertyWatchRoom || {};

    const HOST_SYNC_INTERVAL = 5000;
    const HOST_SEEK_DEBOUNCE = 300;
    const REMOTE_SYNC_LOCK_MS = 500;

    const DEFAULT_STATE = {
        roomId: '',
        clientId: '',
        role: '',
        status: 'idle',
        connected: false,
        media: null,
        playback: null,
        participants: [],
        participantCount: 0,
        maxMembers: 10,
        userReady: false,
        playerReady: false,
        startingReady: false,
        lastSyncStartAt: 0,
        lastRoomStateAt: 0,
    };

    class WatchRoomController {
        constructor({ player, socketSend, render, toast, onEnded, onError } = {}) {
            this.player = player || null;
            this.socketSend = typeof socketSend === 'function' ? socketSend : () => false;
            this.render = typeof render === 'function' ? render : () => {};
            this.toast = typeof toast === 'function' ? toast : () => {};
            this.onEnded = typeof onEnded === 'function' ? onEnded : null;
            this.onError = typeof onError === 'function' ? onError : null;
            this.state = { ...DEFAULT_STATE };
            this.isApplyingRemoteSync = false;
            this.hostControlsAttached = false;
            this.hostSyncTimer = null;
            this.hostSeekTimer = null;
            this.hostControlRetryTimer = null;
        }

        setContext(context = {}) {
            this.state = {
                ...this.state,
                ...context,
                status: context.status || this.state.status || 'idle',
            };
            this.updatePlayerReady();
            this.render(this.getViewModel());
            this.reconcileHostPlaybackControls();
        }

        dispatch(message = {}) {
            const type = message.type || '';
            const payload = message.payload || {};
            if (type) {
                console.log('[WatchRoomController] dispatch', type);
            }

            if (type === 'room:state') return this.handleRoomState(payload, message);
            if (type === 'room:participants') return this.handleParticipants(payload);
            if (type === 'sync:prepare') return this.handleSyncPrepare(payload);
            if (type === 'sync:start') return this.handleSyncStart(payload);
            if (type === 'sync:play') return this.handleSyncPlay(payload);
            if (type === 'sync:pause') return this.handleSyncPause(payload);
            if (type === 'sync:seek') return this.handleSyncSeek(payload);
            if (type === 'sync:state') return this.handleSyncState(payload);
            if (type === 'room:ended') return this.handleRoomEnded(payload);
            if (type === 'room:error') return this.handleRoomError(payload);
            return null;
        }

        handleRoomState(payload = {}, message = {}) {
            const participants = Array.isArray(payload.participants) ? payload.participants : this.state.participants;
            const clientId = message.clientId || this.state.clientId || '';
            const localParticipant = participants.find((participant) => participant.id === clientId);

            this.state = {
                ...this.state,
                roomId: message.roomId || payload.roomId || this.state.roomId,
                clientId,
                status: payload.status || this.state.status || 'waiting',
                maxMembers: payload.maxMembers || this.state.maxMembers || 10,
                participantCount: payload.participantCount || payload.participantsCount || participants.length || this.state.participantCount,
                media: payload.media || this.state.media,
                playback: payload.playback || this.state.playback,
                participants,
                userReady: this.state.role === 'viewer'
                    ? Boolean(this.state.userReady || localParticipant?.ready)
                    : this.state.userReady,
                connected: true,
                lastRoomStateAt: Date.now(),
            };
            console.log('[WatchRoomController] state changed', this.state.status);
            this.updatePlayerReady();
            this.render(this.getViewModel());
            this.reconcileHostPlaybackControls();

            if (this.state.status === 'waiting') {
                this.player?.pause?.();
                return null;
            }

            if (this.state.status === 'starting') {
                this.player?.pause?.();
                return null;
            }

            if (this.state.status === 'playing') {
                return this.applyPlayingRecovery(payload.playback || {});
            }

            return null;
        }

        handleParticipants(payload = {}) {
            const participants = Array.isArray(payload.participants) ? payload.participants : this.state.participants;
            const localParticipant = participants.find((participant) => participant.id === this.state.clientId);

            this.state = {
                ...this.state,
                participants,
                participantCount: payload.count || participants.length || this.state.participantCount,
                maxMembers: payload.maxMembers || this.state.maxMembers || 10,
                userReady: this.state.role === 'viewer'
                    ? Boolean(this.state.userReady || localParticipant?.ready)
                    : this.state.userReady,
            };
            this.render(this.getViewModel());
            this.reconcileHostPlaybackControls();
        }

        handleSyncPrepare(payload = {}) {
            if (payload.status && payload.status !== 'starting') {
                this.state = {
                    ...this.state,
                    status: payload.status || this.state.status || 'waiting',
                    media: payload.media || this.state.media,
                    playback: payload.playback || this.state.playback,
                };
                console.log('[WatchRoomController] state changed', this.state.status);
                this.render(this.getViewModel());
                this.reconcileHostPlaybackControls();
                this.player?.applyPlayback?.(payload.playback || {}, { shouldPlay: false, seekThreshold: 0.5 })
                    ?.catch?.(() => {});
                return null;
            }

            console.log('[WatchRoomController] sync prepare', payload);
            this.state = {
                ...this.state,
                status: 'starting',
                playback: payload,
                startingReady: false,
            };
            this.render(this.getViewModel());
            this.reconcileHostPlaybackControls();

            this.player?.pause?.();
            const targetTime = this.player?.calculateTargetTime
                ? this.player.calculateTargetTime({ ...payload, paused: true })
                : Math.max(0, Number(payload.currentTime) || 0);
            Promise.resolve(this.player?.seek?.(targetTime))
                .finally(() => {
                    console.log('[WatchRoomController] send client ready');
                    const sent = this.socketSend({
                        type: 'client:ready',
                        payload: {
                            currentTime: targetTime,
                            readyAt: Date.now(),
                        },
                    });
                    this.state = {
                        ...this.state,
                        startingReady: Boolean(sent),
                    };
                    this.render(this.getViewModel());
                });
        }

        handleSyncStart(payload = {}) {
            console.log('[WatchRoomController] sync start', payload);
            this.state = {
                ...this.state,
                status: 'playing',
                playback: payload,
                playerReady: true,
                lastSyncStartAt: Date.now(),
            };
            this.render(this.getViewModel());
            this.reconcileHostPlaybackControls();
            return this.applyPlaybackWithLock(payload, { shouldPlay: true, seekThreshold: 1 }, true);
        }

        handleSyncPlay(payload = {}) {
            if (this.state.status !== 'playing' || this.state.role !== 'viewer') return null;
            console.log('[WatchRoomController] apply host sync', 'sync:play');
            return this.applyPlaybackWithLock({ ...payload, paused: false }, { shouldPlay: true, seekThreshold: 3 }, true);
        }

        handleSyncPause(payload = {}) {
            if (this.state.status !== 'playing' || this.state.role !== 'viewer') return null;
            console.log('[WatchRoomController] apply host sync', 'sync:pause');
            return this.applyPlaybackWithLock({ ...payload, paused: true }, { shouldPlay: false, seekThreshold: 3 }, false);
        }

        handleSyncSeek(payload = {}) {
            if (this.state.status !== 'playing' || this.state.role !== 'viewer') return null;
            const shouldPlay = payload.paused === false;
            console.log('[WatchRoomController] apply host sync', 'sync:seek');
            return this.applyPlaybackWithLock(payload, { shouldPlay, seekThreshold: 0.5 }, shouldPlay);
        }

        handleSyncState(payload = {}) {
            if (this.state.status !== 'playing' || this.state.role !== 'viewer') return null;
            const shouldPlay = payload.paused === false;
            console.log('[WatchRoomController] apply host sync', 'sync:state');
            return this.applyPlaybackWithLock(payload, { shouldPlay, seekThreshold: 3 }, shouldPlay);
        }

        handleRoomEnded(payload = {}) {
            this.state = {
                ...this.state,
                status: 'ended',
                connected: false,
            };
            this.player?.pause?.();
            this.render(this.getViewModel());
            this.detachHostPlaybackControls();
            if (this.onEnded) {
                this.onEnded(payload);
            }
        }

        handleRoomError(payload = {}) {
            if (this.onError) {
                this.onError(payload);
            } else if (payload?.message) {
                this.toast(payload.message, 'error');
            }
        }

        markReady() {
            if (this.state.role !== 'viewer' || this.state.status !== 'waiting') return false;
            console.log('[WatchRoomController] mark ready');
            const sent = this.socketSend({
                type: 'viewer:ready',
                payload: {
                    readyAt: Date.now(),
                },
            });
            if (sent) {
                this.state = {
                    ...this.state,
                    userReady: true,
                };
                this.render(this.getViewModel());
            }
            return sent;
        }

        startTogether() {
            if (this.state.role !== 'host' || this.state.status !== 'waiting') return false;
            const payload = this.player?.getSnapshot?.() || {};
            console.log('[WatchRoomController] start together', payload);
            return this.socketSend({
                type: 'host:start',
                payload,
            });
        }

        endRoom() {
            return this.socketSend({ type: 'room:end' });
        }

        applyPlayingRecovery(playback = {}) {
            const shouldPlay = playback.paused !== true;
            console.log('[WatchRoomController] room state playing recovery', playback);
            return this.applyPlaybackWithLock(playback, { shouldPlay, seekThreshold: 3 }, shouldPlay);
        }

        async applyPlaybackWithLock(playback = {}, options = {}, shouldWarn = false) {
            this.isApplyingRemoteSync = true;
            try {
                const result = await this.player?.applyPlayback?.(playback, options);
                return this.handlePlaybackResult(result, shouldWarn);
            } catch (error) {
                this.handlePlayError(error);
                return { success: false, error };
            } finally {
                window.setTimeout(() => {
                    this.isApplyingRemoteSync = false;
                }, REMOTE_SYNC_LOCK_MS);
            }
        }

        handlePlaybackResult(result, shouldWarn = false) {
            if (result?.success === false && shouldWarn) {
                this.handlePlayError(result.error);
            }
            return result;
        }

        handlePlayError(error) {
            console.warn('[WatchRoomController] play failed', error);
            this.toast('请点击一次播放以加入同步', 'warning');
        }

        canSendHostPlaybackEvent(type) {
            if (this.state.role !== 'host') return 'not_host';
            if (this.state.status !== 'playing') return 'room_not_playing';
            if (!this.state.connected) return 'not_connected';
            if (this.isApplyingRemoteSync) return 'applying_remote_sync';
            if (!this.player?.getSnapshot) return 'player_not_ready';
            return '';
        }

        sendHostPlaybackEvent(type) {
            const blockReason = this.canSendHostPlaybackEvent(type);
            if (blockReason) {
                if (type !== 'host:sync') {
                    console.warn('[WatchRoomController] host event ignored', { reason: blockReason, type });
                }
                return false;
            }

            const payload = this.player.getSnapshot();
            console.log('[WatchRoomController] send host event', { type, payload });
            return this.socketSend({ type, payload });
        }

        attachHostPlaybackControls() {
            if (this.hostControlsAttached) return;
            if (this.state.role !== 'host' || this.state.status !== 'playing') return;
            if (!this.player?.isReady?.()) {
                if (!this.hostControlRetryTimer) {
                    this.hostControlRetryTimer = window.setTimeout(() => {
                        this.hostControlRetryTimer = null;
                        this.attachHostPlaybackControls();
                    }, 500);
                }
                return;
            }

            const listeners = [
                this.player.onLocalPlay?.(() => {
                    console.log('[WatchRoomController] host local play');
                    this.sendHostPlaybackEvent('host:play');
                }),
                this.player.onLocalPause?.(() => {
                    console.log('[WatchRoomController] host local pause');
                    this.sendHostPlaybackEvent('host:pause');
                }),
                this.player.onLocalSeek?.(() => {
                    console.log('[WatchRoomController] host local seek');
                    this.debounceHostSeek();
                }),
                this.player.onLocalRateChange?.(() => {
                    console.log('[WatchRoomController] host local ratechange');
                    this.sendHostPlaybackEvent('host:sync');
                }),
            ].filter(Boolean);

            if (!listeners.length) {
                return;
            }

            this.hostControlsAttached = true;
            this.startHostSyncTimer();
        }

        detachHostPlaybackControls() {
            if (this.hostControlRetryTimer) {
                window.clearTimeout(this.hostControlRetryTimer);
                this.hostControlRetryTimer = null;
            }
            if (this.hostSeekTimer) {
                window.clearTimeout(this.hostSeekTimer);
                this.hostSeekTimer = null;
            }
            this.stopHostSyncTimer();
            this.player?.offLocalListeners?.();
            this.hostControlsAttached = false;
        }

        reconcileHostPlaybackControls() {
            if (this.state.role === 'host' && this.state.status === 'playing') {
                this.attachHostPlaybackControls();
            } else {
                this.detachHostPlaybackControls();
            }
        }

        debounceHostSeek() {
            if (this.hostSeekTimer) {
                window.clearTimeout(this.hostSeekTimer);
            }
            this.hostSeekTimer = window.setTimeout(() => {
                this.hostSeekTimer = null;
                this.sendHostPlaybackEvent('host:seek');
            }, HOST_SEEK_DEBOUNCE);
        }

        startHostSyncTimer() {
            this.stopHostSyncTimer();
            this.hostSyncTimer = window.setInterval(() => {
                if (document.hidden) return;
                this.sendHostPlaybackEvent('host:sync');
            }, HOST_SYNC_INTERVAL);
        }

        stopHostSyncTimer() {
            if (this.hostSyncTimer) {
                window.clearInterval(this.hostSyncTimer);
                this.hostSyncTimer = null;
            }
        }

        updatePlayerReady() {
            this.state.playerReady = Boolean(this.player?.isReady?.());
        }

        getViewModel() {
            const participants = Array.isArray(this.state.participants) ? this.state.participants : [];
            const viewers = participants.filter((participant) => participant.role === 'viewer');
            const allViewersReady = viewers.length === 0 || viewers.every((participant) => participant.ready);
            const localParticipant = participants.find((participant) => participant.id === this.state.clientId);
            const userReady = this.state.role === 'viewer'
                ? Boolean(this.state.userReady || localParticipant?.ready)
                : true;

            return {
                ...this.state,
                participants,
                participantCount: this.state.participantCount || participants.length,
                maxMembers: this.state.maxMembers || 10,
                viewers,
                allViewersReady,
                userReady,
                statusText: this.getStatusText(),
                viewerStatusText: this.getViewerStatusText(userReady),
                viewerReadyButtonText: userReady ? '已准备' : '我已准备',
                canViewerReady: this.state.role === 'viewer' && this.state.status === 'waiting' && !userReady,
                canHostStart: this.state.role === 'host' && this.state.status === 'waiting' && allViewersReady,
            };
        }

        getStatusText() {
            if (this.state.status === 'waiting') return '等待开播';
            if (this.state.status === 'starting') return '准备开播';
            if (this.state.status === 'playing') return '一起看中';
            if (this.state.status === 'ended') return '已结束';
            return '未连接';
        }

        getViewerStatusText(userReady) {
            if (this.state.status === 'playing') return '一起看中';
            if (this.state.status === 'starting') return '准备开播中';
            if (this.state.status === 'waiting') return userReady ? '已准备' : '未准备';
            return '未连接';
        }
    }

    window.LibertyWatchRoom.Controller = WatchRoomController;
})();

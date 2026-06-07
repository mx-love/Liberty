(function () {
    window.LibertyWatchRoom = window.LibertyWatchRoom || {};
    window.LibertyDebug = window.LibertyDebug || {
        enabled() {
            try {
                return localStorage.getItem('LIBRETV_DEBUG') === '1'
                    || new URLSearchParams(window.location.search).get('debug') === '1';
            } catch (error) {
                return window.location.search.includes('debug=1');
            }
        },
        log(...args) {
            if (this.enabled()) console.log(...args);
        },
        warn(...args) {
            if (this.enabled()) console.warn(...args);
        },
        trace(...args) {
            if (this.enabled()) console.trace(...args);
        },
    };

    const HOST_SYNC_INTERVAL = 5000;
    const HOST_SEEK_THROTTLE = 100;
    const REMOTE_SYNC_LOCK_MS = 500;
    const VIEWER_READONLY_TOAST_INTERVAL = 4000;

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
        constructor({ player, socketSend, socketClose, render, toast, onEnded, onError } = {}) {
            this.player = player || null;
            this.socketSend = typeof socketSend === 'function' ? socketSend : () => false;
            this.socketClose = typeof socketClose === 'function' ? socketClose : null;
            this.render = typeof render === 'function' ? render : () => {};
            this.toast = typeof toast === 'function' ? toast : () => {};
            this.onEnded = typeof onEnded === 'function' ? onEnded : null;
            this.onError = typeof onError === 'function' ? onError : null;
            this.state = { ...DEFAULT_STATE };
            this.isApplyingRemoteSync = false;
            this.hostControlsAttached = false;
            this.viewerReadonlyAttached = false;
            this.hostSyncTimer = null;
            this.hostSeekTimer = null;
            this.hostSeekingThrottleTimer = null;
            this.hostControlRetryTimer = null;
            this.viewerReadonlyRetryTimer = null;
            this.hostBoundVideo = null;
            this.viewerBoundVideo = null;
            this.lastViewerReadonlyToastAt = 0;
            this.lastHostPlayback = null;
        }

        setContext(context = {}) {
            this.state = {
                ...this.state,
                ...context,
                status: context.status || this.state.status || 'idle',
            };
            this.updatePlayerReady();
            this.render(this.getViewModel());
            this.reconcilePlaybackControls();
        }

        dispatch(message = {}) {
            if (!this.isActive() && message.type !== 'room:state') {
                return null;
            }
            if (this.state.status === 'ended' && message.type !== 'room:state') {
                return null;
            }

            const type = message.type || '';
            const payload = message.payload || {};
            if (type) {
                window.LibertyDebug.log('[WatchRoomController] dispatch', type);
            }

            if (type === 'room:state') return this.handleRoomState(payload, message);
            if (type === 'room:participants') return this.handleParticipants(payload);
            if (type === 'sync:prepare') return this.handleSyncPrepare(payload);
            if (type === 'sync:media') return this.handleSyncMedia(payload);
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
            window.LibertyDebug.log('[WatchRoomController] state changed', this.state.status);
            this.updatePlayerReady();
            this.render(this.getViewModel());
            this.reconcilePlaybackControls();

            if (this.state.status === 'waiting') {
                this.player?.pause?.();
                return null;
            }

            if (this.state.status === 'starting') {
                this.player?.pause?.();
                return null;
            }

            if (this.state.status === 'playing') {
                return this.applyPlayingRecovery(payload.playback || {}, payload.media || this.state.media);
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
            this.reconcilePlaybackControls();
        }

        handleSyncPrepare(payload = {}) {
            if (payload.status && payload.status !== 'starting') {
                this.state = {
                    ...this.state,
                    status: payload.status || this.state.status || 'waiting',
                    media: payload.media || this.state.media,
                    playback: payload.playback || this.state.playback,
                };
                window.LibertyDebug.log('[WatchRoomController] state changed', this.state.status);
                this.render(this.getViewModel());
                this.reconcilePlaybackControls();
                this.player?.applyPlayback?.(payload.playback || {}, { shouldPlay: false, seekThreshold: 0.5 })
                    ?.catch?.(() => {});
                return null;
            }

            window.LibertyDebug.log('[WatchRoomController] sync prepare', payload);
            this.state = {
                ...this.state,
                status: 'starting',
                playback: payload,
                startingReady: false,
            };
            this.render(this.getViewModel());
            this.reconcilePlaybackControls();

            this.player?.pause?.();
            const targetTime = this.player?.calculateTargetTime
                ? this.player.calculateTargetTime({ ...payload, paused: true })
                : Math.max(0, Number(payload.currentTime) || 0);
            Promise.resolve(this.player?.seek?.(targetTime))
                .finally(() => {
                    window.LibertyDebug.log('[WatchRoomController] send client ready');
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
            window.LibertyDebug.log('[WatchRoomController] sync start', payload);
            this.state = {
                ...this.state,
                status: 'playing',
                media: payload.media || this.state.media,
                playback: payload,
                playerReady: true,
                lastSyncStartAt: Date.now(),
            };
            this.setLastHostPlayback(payload);
            this.render(this.getViewModel());
            this.reconcilePlaybackControls();
            return this.applyPlaybackWithLock(payload, { shouldPlay: true, forceSeek: true }, true);
        }

        handleSyncMedia(payload = {}) {
            window.LibertyDebug.log('[WatchRoomController] sync media received', payload);
            const media = payload.media || {};
            const playback = payload.playback || { paused: true, currentTime: 0, updatedAt: Date.now() };
            this.state = {
                ...this.state,
                status: 'starting',
                media,
                playback,
                startingReady: false,
            };
            this.detachHostPlaybackControls();
            this.detachViewerReadonlyControls();
            this.render(this.getViewModel());

            this.isApplyingRemoteSync = true;
            Promise.resolve()
                .then(() => this.player?.load?.(media, { fromWatchRoom: true }))
                .then(() => this.player?.pause?.())
                .then(() => this.player?.seek?.(0))
                .finally(() => {
                    window.LibertyDebug.log('[WatchRoomController] media load ready');
                    window.LibertyDebug.log('[WatchRoomController] send client ready after media change');
                    const sent = this.socketSend({
                        type: 'client:ready',
                        payload: {
                            media,
                            currentTime: 0,
                            readyAt: Date.now(),
                        },
                    });
                    this.state = {
                        ...this.state,
                        startingReady: Boolean(sent),
                    };
                    this.render(this.getViewModel());
                    window.setTimeout(() => {
                        this.isApplyingRemoteSync = false;
                    }, REMOTE_SYNC_LOCK_MS);
                });
        }

        handleSyncPlay(payload = {}) {
            if (this.state.status !== 'playing' || this.state.role !== 'viewer') return null;
            this.setLastHostPlayback(payload);
            window.LibertyDebug.log('[WatchRoomController] apply host sync', 'sync:play');
            return this.applyPlaybackWithLock({ ...payload, paused: false }, { shouldPlay: true, seekThreshold: 1 }, true);
        }

        handleSyncPause(payload = {}) {
            if (this.state.status !== 'playing' || this.state.role !== 'viewer') return null;
            this.setLastHostPlayback(payload);
            window.LibertyDebug.log('[WatchRoomController] apply host sync', 'sync:pause');
            return this.applyPlaybackWithLock({ ...payload, paused: true }, { shouldPlay: false, seekThreshold: 1 }, false);
        }

        handleSyncSeek(payload = {}) {
            if (this.state.status !== 'playing' || this.state.role !== 'viewer') return null;
            const shouldPlay = payload.paused === false;
            this.setLastHostPlayback(payload);
            window.LibertyDebug.log('[WatchRoomController] apply host sync', 'sync:seek');
            return this.applyPlaybackWithLock(payload, { shouldPlay, forceSeek: true }, shouldPlay);
        }

        handleSyncState(payload = {}) {
            if (this.state.status !== 'playing' || this.state.role !== 'viewer') return null;
            const shouldPlay = payload.paused === false;
            this.setLastHostPlayback(payload);
            window.LibertyDebug.log('[WatchRoomController] apply host sync', 'sync:state');
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
            this.detachViewerReadonlyControls();
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
            window.LibertyDebug.log('[WatchRoomController] mark ready');
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
            window.LibertyDebug.log('[WatchRoomController] start together', payload);
            return this.socketSend({
                type: 'host:start',
                payload,
            });
        }

        requestMediaChange(media = {}, reason = 'media-change') {
            if (this.state.role !== 'host' || this.state.status !== 'playing') return false;
            const playback = {
                ...(this.player?.getSnapshot?.() || {}),
                currentTime: 0,
                paused: false,
                updatedAt: Date.now(),
            };
            window.LibertyDebug.log('[WatchRoomController] host media change request', {
                media,
                playback,
                reason,
            });
            this.detachHostPlaybackControls();
            this.player?.pause?.();
            this.state = {
                ...this.state,
                status: 'starting',
                media,
                playback,
                startingReady: false,
            };
            this.render(this.getViewModel());
            const sent = this.socketSend({
                type: 'host:media-change',
                payload: {
                    media,
                    playback,
                    episodeIndex: media.episodeIndex,
                    reason,
                },
            });
            if (!sent) {
                this.state = {
                    ...this.state,
                    status: 'playing',
                };
                this.render(this.getViewModel());
                this.reconcilePlaybackControls();
            }
            return sent;
        }

        endRoom() {
            return this.socketSend({ type: 'room:end' });
        }

        leaveRoom(reason = 'user_leave') {
            window.LibertyDebug.log('[WatchRoomController] leave room', { reason });
            this.cleanupLocalState(reason);
            if (this.socketClose) {
                this.socketClose(true);
            }
            this.render(this.getViewModel());
        }

        cleanupLocalState(reason = 'cleanup') {
            this.detachHostPlaybackControls();
            this.detachViewerReadonlyControls();
            this.stopHostSyncTimer();
            this.player?.offLocalListeners?.();
            this.isApplyingRemoteSync = false;
            this.lastHostPlayback = null;
            this.lastViewerReadonlyToastAt = 0;
            this.state = {
                ...DEFAULT_STATE,
                status: 'ended',
                connected: false,
            };
            this.clearSessionStorage();
            window.LibertyDebug.log('[WatchRoomController] local state cleaned', { reason });
        }

        clearSessionStorage() {
            try {
                [
                    'watchRoomId',
                    'watchRoomRole',
                    'watchRoomClientId',
                    'watchRoomRedirecting',
                    'watchRoomMediaSnapshot',
                    'watchRoomPlaybackSnapshot',
                ].forEach((key) => sessionStorage.removeItem(key));
            } catch (error) {}
        }

        isActive() {
            return Boolean(this.state.roomId && this.state.connected);
        }

        async applyPlayingRecovery(playback = {}, media = null) {
            const shouldPlay = playback.paused !== true;
            this.setLastHostPlayback(playback);
            window.LibertyDebug.log('[WatchRoomController] room state playing recovery', playback);
            if (media && this.player?.isMediaDifferent?.(media)) {
                this.isApplyingRemoteSync = true;
                try {
                    await this.player.load(media, { fromWatchRoom: true });
                } finally {
                    window.setTimeout(() => {
                        this.isApplyingRemoteSync = false;
                    }, REMOTE_SYNC_LOCK_MS);
                }
            }
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

        setLastHostPlayback(playback = {}) {
            this.lastHostPlayback = {
                ...playback,
                updatedAt: Number(playback.updatedAt) || Date.now(),
            };
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
                    window.LibertyDebug.warn('[WatchRoomController] host event ignored', { reason: blockReason, type });
                }
                return false;
            }

            const payload = this.player.getSnapshot();
            window.LibertyDebug.log('[WatchRoomController] send host event', { type, payload });
            return this.socketSend({ type, payload });
        }

        attachHostPlaybackControls() {
            if (this.state.role !== 'host' || this.state.status !== 'playing') return;
            const currentVideo = this.player?.getVideo?.();
            if (this.hostControlsAttached && currentVideo && currentVideo === this.hostBoundVideo) return;
            if (this.hostControlsAttached && currentVideo && currentVideo !== this.hostBoundVideo) {
                this.detachHostPlaybackControls();
            }
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
                    window.LibertyDebug.log('[WatchRoomController] host local play');
                    this.sendHostPlaybackEvent('host:play');
                }),
                this.player.onLocalPause?.(() => {
                    window.LibertyDebug.log('[WatchRoomController] host local pause');
                    this.sendHostPlaybackEvent('host:pause');
                }),
                this.player.onLocalSeeking?.(() => {
                    window.LibertyDebug.log('[WatchRoomController] host local seeking');
                    this.throttleHostSeeking();
                }),
                this.player.onLocalSeek?.(() => {
                    window.LibertyDebug.log('[WatchRoomController] host local seeked');
                    this.sendFinalHostSeek();
                }),
                this.player.onLocalRateChange?.(() => {
                    window.LibertyDebug.log('[WatchRoomController] host local ratechange');
                    this.sendHostPlaybackEvent('host:sync');
                }),
            ].filter(Boolean);

            if (!listeners.length) {
                return;
            }

            this.hostControlsAttached = true;
            this.hostBoundVideo = this.player?.getVideo?.() || null;
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
            if (this.hostSeekingThrottleTimer) {
                window.clearTimeout(this.hostSeekingThrottleTimer);
                this.hostSeekingThrottleTimer = null;
            }
            this.stopHostSyncTimer();
            if (this.hostControlsAttached) {
                this.player?.offLocalListeners?.();
            }
            this.hostControlsAttached = false;
            this.hostBoundVideo = null;
        }

        reconcilePlaybackControls() {
            if (this.state.role === 'host' && this.state.status === 'playing') {
                this.detachViewerReadonlyControls();
                this.attachHostPlaybackControls();
                return;
            }
            if (this.state.role === 'viewer' && this.state.status === 'playing') {
                this.detachHostPlaybackControls();
                this.attachViewerReadonlyControls();
                return;
            }
            this.detachHostPlaybackControls();
            this.detachViewerReadonlyControls();
        }

        throttleHostSeeking() {
            if (this.hostSeekingThrottleTimer) return;
            this.sendHostPlaybackEvent('host:seek');
            this.hostSeekingThrottleTimer = window.setTimeout(() => {
                this.hostSeekingThrottleTimer = null;
            }, HOST_SEEK_THROTTLE);
        }

        sendFinalHostSeek() {
            if (this.hostSeekTimer) {
                window.clearTimeout(this.hostSeekTimer);
                this.hostSeekTimer = null;
            }
            this.sendHostPlaybackEvent('host:seek');
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

        attachViewerReadonlyControls() {
            if (this.state.role !== 'viewer' || this.state.status !== 'playing') return;
            const currentVideo = this.player?.getVideo?.();
            if (this.viewerReadonlyAttached && currentVideo && currentVideo === this.viewerBoundVideo) return;
            if (this.viewerReadonlyAttached && currentVideo && currentVideo !== this.viewerBoundVideo) {
                this.detachViewerReadonlyControls();
            }
            if (!this.player?.isReady?.()) {
                if (!this.viewerReadonlyRetryTimer) {
                    this.viewerReadonlyRetryTimer = window.setTimeout(() => {
                        this.viewerReadonlyRetryTimer = null;
                        this.attachViewerReadonlyControls();
                    }, 500);
                }
                return;
            }

            const listeners = [
                this.player.onLocalPlay?.(() => this.handleViewerReadonlyControl('play')),
                this.player.onLocalPause?.(() => this.handleViewerReadonlyControl('pause')),
                this.player.onLocalSeeking?.(() => this.handleViewerReadonlyControl('seeking')),
                this.player.onLocalSeek?.(() => this.handleViewerReadonlyControl('seeked')),
                this.player.onLocalRateChange?.(() => this.handleViewerReadonlyControl('ratechange')),
            ].filter(Boolean);

            if (!listeners.length) return;
            this.viewerReadonlyAttached = true;
            this.viewerBoundVideo = this.player?.getVideo?.() || null;
        }

        detachViewerReadonlyControls() {
            if (this.viewerReadonlyRetryTimer) {
                window.clearTimeout(this.viewerReadonlyRetryTimer);
                this.viewerReadonlyRetryTimer = null;
            }
            if (this.viewerReadonlyAttached) {
                this.player?.offLocalListeners?.();
            }
            this.viewerReadonlyAttached = false;
            this.viewerBoundVideo = null;
        }

        handleViewerReadonlyControl(reason) {
            if (this.state.role !== 'viewer' || this.state.status !== 'playing') return;
            if (this.isApplyingRemoteSync) return;
            this.notifyViewerReadonlyControl(reason);
            this.restoreViewerToHostState(reason);
        }

        notifyViewerReadonlyControl(reason) {
            const now = Date.now();
            if (now - this.lastViewerReadonlyToastAt < VIEWER_READONLY_TOAST_INTERVAL) return;
            this.lastViewerReadonlyToastAt = now;
            this.toast('播放控制已由房主托管', 'info');
            window.LibertyDebug.log('[WatchRoomController] viewer readonly control blocked', { reason });
        }

        restoreViewerToHostState(reason) {
            if (!this.lastHostPlayback) return null;
            const shouldPlay = this.lastHostPlayback.paused !== true;
            window.LibertyDebug.log('[WatchRoomController] restore viewer to host state', { reason });
            return this.applyPlaybackWithLock(
                this.lastHostPlayback,
                { shouldPlay, forceSeek: true },
                shouldPlay
            );
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

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

    const HOST_SYNC_INTERVAL = 3000;
    const HOST_SEEK_THROTTLE = 100;
    const REMOTE_SYNC_LOCK_MS = 500;
    const VIEWER_READONLY_TOAST_INTERVAL = 4000;
    const SYNC_DRIFT_IGNORE_THRESHOLD = 0.35;
    const SYNC_DRIFT_HARD_SEEK_THRESHOLD = 1.2;
    const SOFT_DRIFT_RATE_MIN_DELTA = 0.03;
    const SOFT_DRIFT_RATE_MAX_DELTA = 0.06;
    const SOFT_DRIFT_RATE_MIN = 0.85;
    const SOFT_DRIFT_RATE_MAX = 1.25;
    const SOFT_DRIFT_CHECK_INTERVAL = 1000;
    const SOFT_DRIFT_RESTORE_THRESHOLD = 0.2;
    const SOFT_DRIFT_MAX_MS = 15000;

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
            this.driftCorrectionTimer = null;
            this.driftCorrectionHostRate = 1;
            this.isSoftDriftCorrecting = false;
            this.activeDriftCorrection = null;
            this.remoteSyncUnlockTimer = null;
            this.pendingEpisodeChangeId = '';
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
            if (type === 'sync:start') return this.handleSyncStart(payload);
            if (type === 'sync:play') return this.handleSyncPlay(payload);
            if (type === 'sync:pause') return this.handleSyncPause(payload);
            if (type === 'sync:seek') return this.handleSyncSeek(payload);
            if (type === 'sync:state') return this.handleSyncState(payload);
            if (type === 'sync:episode-prepare') return this.handleSyncEpisodePrepare(payload);
            if (type === 'sync:episode-start') return this.handleSyncEpisodeStart(payload);
            if (type === 'sync:episode-error') return this.handleSyncEpisodeError(payload);
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
            this.pendingEpisodeChangeId = '';
            this.clearDriftCorrection(false);
            this.state = {
                ...this.state,
                status: 'playing',
                playback: payload,
                playerReady: true,
                lastSyncStartAt: Date.now(),
            };
            this.setLastHostPlayback(payload);
            this.render(this.getViewModel());
            this.reconcilePlaybackControls();
            return this.applyPlaybackWithLock(payload, { shouldPlay: true, forceSeek: true }, true);
        }

        handleSyncPlay(payload = {}) {
            if (this.state.status !== 'playing' || this.state.role !== 'viewer') return null;
            this.setLastHostPlayback(payload);
            this.clearDriftCorrection(false);
            window.LibertyDebug.log('[WatchRoomController] apply host sync', 'sync:play');
            return this.applyPlaybackWithLock({ ...payload, paused: false }, { shouldPlay: true, forceSeek: true }, true);
        }

        handleSyncPause(payload = {}) {
            if (this.state.status !== 'playing' || this.state.role !== 'viewer') return null;
            this.setLastHostPlayback(payload);
            this.clearDriftCorrection(false);
            window.LibertyDebug.log('[WatchRoomController] apply host sync', 'sync:pause');
            return this.applyPlaybackWithLock({ ...payload, paused: true }, { shouldPlay: false, forceSeek: true }, false);
        }

        handleSyncSeek(payload = {}) {
            if (this.state.status !== 'playing' || this.state.role !== 'viewer') return null;
            const shouldPlay = payload.paused === false;
            this.setLastHostPlayback(payload);
            this.clearDriftCorrection(false);
            window.LibertyDebug.log('[WatchRoomController] apply host sync', 'sync:seek');
            return this.applyPlaybackWithLock(payload, { shouldPlay, forceSeek: true }, shouldPlay);
        }

        handleSyncState(payload = {}) {
            if (this.state.status !== 'playing' || this.state.role !== 'viewer') return null;
            const shouldPlay = payload.paused === false;
            this.setLastHostPlayback(payload);
            window.LibertyDebug.log('[WatchRoomController] apply host sync', 'sync:state');
            if (!shouldPlay) {
                this.clearDriftCorrection(false);
                return this.applyPlaybackWithLock({ ...payload, paused: true }, { shouldPlay: false, forceSeek: true }, false);
            }
            return this.applySyncStateDrift({ ...payload, paused: false });
        }

        requestEpisodeChange(snapshot = {}) {
            if (this.state.role !== 'host') return false;
            if (this.state.status !== 'playing') return false;
            if (!this.state.connected) return false;
            if (!snapshot?.changeId || !snapshot?.episodeUrl) return false;

            window.LibertyDebug.log('[WatchRoomController] request episode change', {
                changeId: snapshot.changeId,
                episodeIndex: snapshot.episodeIndex,
            });
            return this.socketSend({
                type: 'host:episode-change',
                payload: snapshot,
            });
        }

        async handleSyncEpisodePrepare(payload = {}) {
            if (!['host', 'viewer'].includes(this.state.role)) return null;
            const changeId = String(payload.changeId || '');
            if (!changeId) return null;
            if (this.pendingEpisodeChangeId && this.pendingEpisodeChangeId === changeId) return null;

            this.pendingEpisodeChangeId = changeId;
            this.clearDriftCorrection(true, 'episode_prepare');
            this.beginRemoteSyncLock();
            this.state = {
                ...this.state,
                status: 'starting',
                media: payload,
                playback: payload.playback || this.state.playback,
            };
            this.render(this.getViewModel());
            this.reconcilePlaybackControls();

            try {
                await this.player?.pause?.();
                const result = await this.player?.loadEpisodeSnapshot?.(payload, {
                    changeId,
                    role: this.state.role,
                });
                if (result?.success === false) {
                    throw result.error || new Error('Episode load failed');
                }
                if (this.pendingEpisodeChangeId !== changeId) return result;
                this.socketSend({
                    type: 'client:episode-ready',
                    payload: {
                        changeId,
                        readyAt: Date.now(),
                    },
                });
                return result || { success: true };
            } catch (error) {
                console.warn('[WatchRoomController] episode prepare failed', error);
                this.toast('切集加载失败，等待房间同步恢复', 'warning');
                return { success: false, error };
            } finally {
                this.scheduleRemoteSyncUnlock();
            }
        }

        handleSyncEpisodeStart(payload = {}) {
            const changeId = String(payload.changeId || '');
            if (this.pendingEpisodeChangeId && changeId && this.pendingEpisodeChangeId !== changeId) {
                return null;
            }

            const playback = {
                ...(payload.playback || {}),
                currentTime: Number(payload.playback?.currentTime) || 0,
                playbackRate: Number(payload.playback?.playbackRate || payload.playbackRate) || 1,
                paused: payload.shouldPlay === true ? false : payload.playback?.paused === true,
                updatedAt: Number(payload.playback?.updatedAt) || Date.now(),
            };
            const shouldPlay = payload.shouldPlay === true || playback.paused !== true;

            this.pendingEpisodeChangeId = '';
            this.clearDriftCorrection(true, 'episode_start');
            this.state = {
                ...this.state,
                status: 'playing',
                media: payload,
                playback,
                playerReady: true,
            };
            this.setLastHostPlayback(playback);
            this.render(this.getViewModel());
            this.reconcilePlaybackControls();
            return this.applyPlaybackWithLock(playback, { shouldPlay, forceSeek: true }, shouldPlay);
        }

        handleSyncEpisodeError(payload = {}) {
            if (payload?.message) {
                this.toast(payload.message, 'warning');
            }
            return null;
        }

        handleRoomEnded(payload = {}) {
            this.clearDriftCorrection(true, 'room_ended');
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
            this.clearDriftCorrection(true, reason);
            this.detachHostPlaybackControls();
            this.detachViewerReadonlyControls();
            this.stopHostSyncTimer();
            this.player?.offLocalListeners?.();
            this.isApplyingRemoteSync = false;
            if (this.remoteSyncUnlockTimer) {
                window.clearTimeout(this.remoteSyncUnlockTimer);
                this.remoteSyncUnlockTimer = null;
            }
            this.lastHostPlayback = null;
            this.lastViewerReadonlyToastAt = 0;
            this.pendingEpisodeChangeId = '';
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

        applyPlayingRecovery(playback = {}) {
            const shouldPlay = playback.paused !== true;
            this.setLastHostPlayback(playback);
            window.LibertyDebug.log('[WatchRoomController] room state playing recovery', playback);
            if (this.state.role === 'viewer') {
                return this.handleSyncState(playback);
            }
            return this.applyPlaybackWithLock(playback, {
                shouldPlay,
                seekThreshold: SYNC_DRIFT_HARD_SEEK_THRESHOLD,
            }, shouldPlay);
        }

        async applyPlaybackWithLock(playback = {}, options = {}, shouldWarn = false) {
            this.beginRemoteSyncLock();
            try {
                const result = await this.player?.applyPlayback?.(playback, options);
                return this.handlePlaybackResult(result, shouldWarn);
            } catch (error) {
                this.handlePlayError(error);
                return { success: false, error };
            } finally {
                this.scheduleRemoteSyncUnlock();
            }
        }

        beginRemoteSyncLock() {
            if (this.remoteSyncUnlockTimer) {
                window.clearTimeout(this.remoteSyncUnlockTimer);
                this.remoteSyncUnlockTimer = null;
            }
            this.isApplyingRemoteSync = true;
        }

        scheduleRemoteSyncUnlock() {
            if (this.remoteSyncUnlockTimer) {
                window.clearTimeout(this.remoteSyncUnlockTimer);
            }
            this.remoteSyncUnlockTimer = window.setTimeout(() => {
                this.isApplyingRemoteSync = false;
                this.remoteSyncUnlockTimer = null;
            }, REMOTE_SYNC_LOCK_MS);
        }

        async setRemotePlaybackRate(rate) {
            this.beginRemoteSyncLock();
            try {
                return await this.player?.setPlaybackRate?.(rate);
            } finally {
                this.scheduleRemoteSyncUnlock();
            }
        }

        applySyncStateDrift(playback = {}) {
            const drift = this.getPlaybackDrift(playback);
            if (!drift) {
                this.clearDriftCorrection(false);
                return this.applyPlaybackWithLock(playback, {
                    shouldPlay: true,
                    seekThreshold: SYNC_DRIFT_HARD_SEEK_THRESHOLD,
                }, true);
            }

            this.logDrift('[WatchRoomController] sync drift', {
                ...drift,
                appliedRate: drift.hostRate,
                threshold: SYNC_DRIFT_HARD_SEEK_THRESHOLD,
                action: 'observe',
            });

            if (drift.absDrift > SYNC_DRIFT_HARD_SEEK_THRESHOLD) {
                this.clearDriftCorrection(false);
                this.logDrift('[WatchRoomController] hard drift correction', {
                    ...drift,
                    appliedRate: drift.hostRate,
                    threshold: SYNC_DRIFT_HARD_SEEK_THRESHOLD,
                    action: 'seek',
                });
                return this.applyPlaybackWithLock(playback, { shouldPlay: true, forceSeek: true }, true);
            }

            if (drift.absDrift >= SYNC_DRIFT_IGNORE_THRESHOLD) {
                return this.applySoftDriftCorrection(playback, drift);
            }

            this.restorePlaybackRate(drift.hostRate, drift, 'drift_within_threshold');
            this.clearDriftCorrection(false);
            return this.applyPlaybackWithLock(playback, {
                shouldPlay: true,
                seekThreshold: SYNC_DRIFT_HARD_SEEK_THRESHOLD,
            }, true);
        }

        getPlaybackDrift(playback = {}) {
            if (!this.player) return null;
            const expectedTime = this.player.calculateTargetTime
                ? this.player.calculateTargetTime(playback)
                : Math.max(0, Number(playback.currentTime) || 0);
            const currentTime = this.player.getCurrentTime
                ? this.player.getCurrentTime()
                : Math.max(0, Number(this.player.getSnapshot?.().currentTime) || 0);
            if (!Number.isFinite(expectedTime) || !Number.isFinite(currentTime)) return null;

            const hostRate = this.normalizePlaybackRate(playback.playbackRate);
            const drift = expectedTime - currentTime;
            return {
                drift,
                absDrift: Math.abs(drift),
                expectedTime,
                currentTime,
                hostRate,
            };
        }

        normalizePlaybackRate(rate) {
            const playbackRate = Number(rate);
            return Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
        }

        clamp(number, min, max) {
            return Math.min(max, Math.max(min, number));
        }

        getSoftCorrectionRate(drift, hostRate) {
            const absDrift = Math.abs(Number(drift) || 0);
            const range = SYNC_DRIFT_HARD_SEEK_THRESHOLD - SYNC_DRIFT_IGNORE_THRESHOLD;
            const progress = range > 0
                ? this.clamp((absDrift - SYNC_DRIFT_IGNORE_THRESHOLD) / range, 0, 1)
                : 0;
            const delta = SOFT_DRIFT_RATE_MIN_DELTA
                + ((SOFT_DRIFT_RATE_MAX_DELTA - SOFT_DRIFT_RATE_MIN_DELTA) * progress);
            const direction = drift > 0 ? 1 : -1;
            const lowerBound = Math.min(SOFT_DRIFT_RATE_MIN, hostRate - SOFT_DRIFT_RATE_MAX_DELTA);
            const upperBound = Math.max(SOFT_DRIFT_RATE_MAX, hostRate + SOFT_DRIFT_RATE_MAX_DELTA);
            return this.clamp(hostRate + (direction * delta), lowerBound, upperBound);
        }

        applySoftDriftCorrection(playback = {}, drift = {}) {
            const appliedRate = this.getSoftCorrectionRate(drift.drift, drift.hostRate);
            this.logDrift('[WatchRoomController] soft drift correction', {
                ...drift,
                appliedRate,
                threshold: SYNC_DRIFT_IGNORE_THRESHOLD,
                action: drift.drift > 0 ? 'speed_up' : 'slow_down',
            });

            this.activeDriftCorrection = {
                playback: {
                    ...playback,
                    paused: false,
                    updatedAt: Number(playback.updatedAt) || Date.now(),
                },
                hostRate: drift.hostRate,
                appliedRate,
                direction: drift.drift > 0 ? 1 : -1,
                startedAt: Date.now(),
            };
            this.driftCorrectionHostRate = drift.hostRate;
            this.isSoftDriftCorrecting = true;
            this.scheduleDriftCorrectionCheck();

            return this.applyPlaybackWithLock(playback, {
                shouldPlay: true,
                disableSeek: true,
                playbackRateOverride: appliedRate,
            }, true);
        }

        scheduleDriftCorrectionCheck() {
            if (this.driftCorrectionTimer) {
                window.clearTimeout(this.driftCorrectionTimer);
            }
            this.driftCorrectionTimer = window.setTimeout(() => {
                this.driftCorrectionTimer = null;
                this.checkDriftCorrection();
            }, SOFT_DRIFT_CHECK_INTERVAL);
        }

        checkDriftCorrection() {
            const correction = this.activeDriftCorrection;
            if (!correction) return;
            if (this.state.role !== 'viewer' || this.state.status !== 'playing') {
                this.clearDriftCorrection(true, 'inactive');
                return;
            }

            const drift = this.getPlaybackDrift(correction.playback);
            if (!drift) {
                this.scheduleDriftCorrectionCheck();
                return;
            }

            const crossedTarget = drift.drift === 0 || Math.sign(drift.drift) !== correction.direction;
            const timedOut = Date.now() - correction.startedAt >= SOFT_DRIFT_MAX_MS;
            if (drift.absDrift <= SOFT_DRIFT_RESTORE_THRESHOLD || crossedTarget || timedOut) {
                this.clearDriftCorrection(true, timedOut ? 'timeout' : 'caught_up', drift);
                return;
            }

            this.scheduleDriftCorrectionCheck();
        }

        clearDriftCorrection(restore = false, reason = 'clear', drift = null) {
            if (this.driftCorrectionTimer) {
                window.clearTimeout(this.driftCorrectionTimer);
                this.driftCorrectionTimer = null;
            }

            const correction = this.activeDriftCorrection;
            this.activeDriftCorrection = null;
            this.isSoftDriftCorrecting = false;

            if (restore && correction) {
                this.restorePlaybackRate(correction.hostRate, drift, reason);
            }
        }

        restorePlaybackRate(hostRate, drift = null, reason = 'restore') {
            if (!Number.isFinite(Number(hostRate)) || Number(hostRate) <= 0) return null;

            const currentRate = Number(this.player?.getPlaybackRate?.()) || 1;
            if (Math.abs(currentRate - hostRate) < 0.001) return null;

            this.logDrift('[WatchRoomController] restore playback rate', {
                ...(drift || {}),
                drift: Number.isFinite(Number(drift?.drift)) ? drift.drift : 0,
                expectedTime: Number.isFinite(Number(drift?.expectedTime)) ? drift.expectedTime : 0,
                currentTime: Number.isFinite(Number(drift?.currentTime)) ? drift.currentTime : this.player?.getCurrentTime?.() || 0,
                hostRate,
                appliedRate: hostRate,
                threshold: SOFT_DRIFT_RESTORE_THRESHOLD,
                action: reason,
            });

            return this.setRemotePlaybackRate(hostRate)?.catch?.(() => {});
        }

        logDrift(label, details = {}) {
            window.LibertyDebug.log(label, {
                drift: Number(details.drift || 0),
                expectedTime: Number(details.expectedTime || 0),
                currentTime: Number(details.currentTime || 0),
                hostRate: Number(details.hostRate || 1),
                appliedRate: Number(details.appliedRate || details.hostRate || 1),
                threshold: details.threshold,
                action: details.action || '',
            });
        }

        handlePlaybackResult(result, shouldWarn = false) {
            if (result?.success === false && shouldWarn) {
                this.handlePlayError(result.error);
            }
            return result;
        }

        handlePlayError(error) {
            console.warn('[WatchRoomController] play failed', error);
            this.toast('浏览器阻止自动播放，请点击播放继续', 'warning');
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
            this.clearDriftCorrection(true, 'detach_viewer_readonly');
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
            this.clearDriftCorrection(false);
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

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

    class WatchRoomPlayerAdapter {
        constructor() {
            this.localListeners = [];
            this.bufferListeners = [];
            this.clockSync = {
                offsetMs: 0,
                rttMs: 0,
                serverTimeAtSample: 0,
                monotonicAtSample: 0,
            };
            this.episodeGeneration = 0;
            this.playbackGeneration = 0;
            this.pendingWaits = new Set();
        }

        getArt() {
            return window.LibertyPlayer?.art || window.art || window.artPlayer || null;
        }

        getVideo() {
            const art = this.getArt();
            return art?.video
                || art?.template?.$video
                || document.querySelector('#player video')
                || document.querySelector('video')
                || null;
        }

        isReady() {
            return Boolean(this.getVideo());
        }

        addLocalListener(eventName, callback) {
            const video = this.getVideo();
            if (!video || typeof callback !== 'function') return null;

            const handler = () => callback(this.getSnapshot());
            video.addEventListener(eventName, handler);

            const cleanup = () => {
                video.removeEventListener(eventName, handler);
            };
            this.localListeners.push(cleanup);
            return cleanup;
        }

        onLocalPlay(callback) {
            return this.addLocalListener('play', callback);
        }

        onLocalPause(callback) {
            return this.addLocalListener('pause', callback);
        }

        onLocalSeeking(callback) {
            return this.addLocalListener('seeking', callback);
        }

        onLocalSeek(callback) {
            return this.addLocalListener('seeked', callback);
        }

        onLocalRateChange(callback) {
            return this.addLocalListener('ratechange', callback);
        }

        offLocalListeners() {
            this.localListeners.forEach((cleanup) => {
                try {
                    cleanup();
                } catch (error) {}
            });
            this.localListeners = [];
        }

        observeBuffering(callback) {
            this.stopBufferingObserver();
            const video = this.getVideo();
            if (!video || typeof callback !== 'function') return null;
            const bindings = [
                ['waiting', true],
                ['stalled', true],
                ['canplay', false],
                ['playing', false],
                ['error', true],
            ];
            bindings.forEach(([eventName, buffering]) => {
                const handler = () => callback({
                    event: eventName,
                    buffering,
                    currentTime: this.getCurrentTime(),
                    readyState: Number(video.readyState || 0),
                });
                video.addEventListener(eventName, handler);
                this.bufferListeners.push(() => video.removeEventListener(eventName, handler));
            });
            return () => this.stopBufferingObserver();
        }

        stopBufferingObserver() {
            this.bufferListeners.forEach((cleanup) => {
                try { cleanup(); } catch (error) {}
            });
            this.bufferListeners = [];
        }

        updateClockSync(sample = {}) {
            const offsetMs = Number(sample.offsetMs);
            const rttMs = Number(sample.rttMs);
            const serverNow = Number(sample.serverNow);
            if (!Number.isFinite(offsetMs) || !Number.isFinite(serverNow)) return;
            this.clockSync = {
                offsetMs,
                rttMs: Number.isFinite(rttMs) ? Math.max(0, rttMs) : 0,
                serverTimeAtSample: serverNow,
                monotonicAtSample: performance.now(),
            };
        }

        getEstimatedServerNow() {
            if (this.clockSync.serverTimeAtSample > 0) {
                return this.clockSync.serverTimeAtSample
                    + Math.max(0, performance.now() - this.clockSync.monotonicAtSample);
            }
            return undefined; // No cross-device wall-clock subtraction before the first pong.
        }

        waitForVideo(timeoutMs = 5000, mediaReady = false) {
            return new Promise((resolve) => {
                const startedAt = performance.now();
                let timer;
                const finish = (video = null) => {
                    window.clearTimeout(timer);
                    this.pendingWaits.delete(finish);
                    resolve(video);
                };
                this.pendingWaits.add(finish);
                const tick = () => {
                    const video = this.getVideo();
                    if (video && (!mediaReady || video.readyState >= 2)) {
                        finish(video);
                        return;
                    }
                    if (performance.now() - startedAt >= timeoutMs) {
                        finish();
                        return;
                    }
                    timer = window.setTimeout(tick, 100);
                };
                tick();
            });
        }

        cancelPending() {
            this.episodeGeneration += 1;
            this.playbackGeneration += 1;
            [...this.pendingWaits].forEach(finish => finish());
        }

        async ensureMediaSnapshot(snapshot = {}, options = {}) {
            const current = window.LibertyPlayer?.buildWatchRoomEpisodeSnapshot?.();
            const video = this.getVideo();
            const same = current && current.episodeIndex === snapshot.episodeIndex
                && current.episodeUrl === (snapshot.episodeUrl || snapshot.episodes?.[snapshot.episodeIndex]?.url);
            if (same && video?.readyState < 2) return { success: Boolean(await this.waitForVideo(10000, true)) };
            if (same) return { success: true };
            return this.loadEpisodeSnapshot({ ...snapshot, changeId: snapshot.changeId || options.changeId }, options);
        }

        getSnapshot() {
            const art = this.getArt();
            const video = this.getVideo();
            const currentTime = Number(video?.currentTime ?? art?.currentTime) || 0;
            const duration = Number(video?.duration ?? art?.duration) || 0;
            const playbackRate = Number(video?.playbackRate ?? art?.playbackRate) || 1;
            const paused = video
                ? video.paused
                : art?.paused !== undefined
                    ? Boolean(art.paused)
                    : true;

            return {
                paused,
                currentTime: Math.max(0, currentTime),
                duration: duration > 0 ? duration : 0,
                playbackRate,
                updatedAt: Date.now(),
            };
        }

        getCurrentTime() {
            const art = this.getArt();
            const video = this.getVideo();
            return Math.max(0, Number(video?.currentTime ?? art?.currentTime) || 0);
        }

        getPlaybackRate() {
            const art = this.getArt();
            const video = this.getVideo();
            return Number(video?.playbackRate ?? art?.playbackRate) || 1;
        }

        async setPlaybackRate(rate) {
            const video = this.getVideo() || await this.waitForVideo();
            const playbackRate = Number(rate);
            if (!video) {
                return { success: false, error: new Error('Video element is not ready') };
            }
            if (!Number.isFinite(playbackRate) || playbackRate <= 0) {
                return { success: false, error: new Error('Invalid playbackRate') };
            }

            try {
                video.playbackRate = playbackRate;
                return { success: true };
            } catch (error) {
                return { success: false, error };
            }
        }

        async loadEpisodeSnapshot(snapshot = {}, options = {}) {
            const loader = window.LibertyPlayer?.loadEpisodeFromWatchRoomSnapshot;
            if (typeof loader !== 'function') {
                return { success: false, error: new Error('Episode snapshot loader is not ready') };
            }

            this.cancelPending();
            const generation = this.episodeGeneration;
            try {
                await loader(snapshot, { ...options, isCurrent: () => generation === this.episodeGeneration });
                if (generation !== this.episodeGeneration) {
                    return { success: false, superseded: true };
                }
                return { success: true };
            } catch (error) {
                return { success: false, error };
            }
        }

        async pause() {
            const art = this.getArt();
            const video = this.getVideo();

            try {
                if (video && !video.paused) video.pause();
            } catch (error) {}

            try {
                if (art && typeof art.pause === 'function') art.pause();
            } catch (error) {}

            return { success: true };
        }

        async seek(time) {
            const video = this.getVideo();
            if (!video) return { success: false, error: new Error('Video element is not ready') };

            const targetTime = Math.max(0, Number(time) || 0);
            try {
                video.currentTime = targetTime;
                return { success: true };
            } catch (error) {
                return { success: false, error };
            }
        }

        async play() {
            const video = this.getVideo();
            if (!video) {
                return { success: false, error: new Error('Video element is not ready') };
            }

            try {
                await Promise.resolve(video.play());
                return { success: true };
            } catch (error) {
                console.warn('[WatchRoom] player play failed', error);
                return { success: false, error };
            }
        }

        calculateTargetTime(playback = {}) {
            const compute = window.LibertyWatchRoomClock?.computeTargetPlaybackTime;
            if (typeof compute !== 'function') return Math.max(0, Number(playback.currentTime) || 0);
            return compute({
                hostCurrentTime: playback.currentTime,
                hostPlaybackRate: playback.playbackRate,
                serverTimestamp: playback.serverTimestamp || playback.updatedAt,
                estimatedServerNow: this.getEstimatedServerNow(),
                paused: playback.paused,
                duration: playback.duration,
            });
        }

        async applyPlayback(playback = {}, options = {}) {
            const generation = ++this.playbackGeneration;
            const video = await this.waitForVideo(10000, true);
            if (generation !== this.playbackGeneration) return { success: false, superseded: true };
            if (!video) {
                return { success: false, error: new Error('Video element is not ready') };
            }
            if (generation !== this.playbackGeneration) return { success: false, superseded: true };

            const targetTime = this.calculateTargetTime(playback);
            const currentTime = Number(video.currentTime) || 0;
            const diff = Math.abs(currentTime - targetTime);

            const seekThreshold = Number.isFinite(Number(options.seekThreshold))
                ? Number(options.seekThreshold)
                : 1;
            if (!options.disableSeek && (options.forceSeek || diff > seekThreshold)) {
                const seekResult = await this.seek(targetTime);
                if (seekResult?.success === false) return seekResult;
                if (generation !== this.playbackGeneration || video !== this.getVideo()) return { success: false, superseded: true };
            }

            const playbackRate = Number.isFinite(Number(options.playbackRateOverride))
                ? Number(options.playbackRateOverride)
                : Number(playback.playbackRate);
            if (Number.isFinite(playbackRate) && playbackRate > 0) {
                try {
                    video.playbackRate = playbackRate;
                } catch (error) {}
            }

            if (options.shouldPlay) {
                try {
                    await Promise.resolve(video.play());
                    return generation === this.playbackGeneration
                        ? { success: true }
                        : { success: false, superseded: true };
                } catch (error) {
                    return { success: false, error };
                }
            }
            try {
                if (!video.paused) video.pause();
                return { success: true };
            } catch (error) {
                return { success: false, error };
            }
        }
    }

    window.LibertyWatchRoom.PlayerAdapter = WatchRoomPlayerAdapter;
})();

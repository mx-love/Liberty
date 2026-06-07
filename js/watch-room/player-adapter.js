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

        waitForVideo(timeoutMs = 5000) {
            const existing = this.getVideo();
            if (existing) return Promise.resolve(existing);

            return new Promise((resolve) => {
                const startedAt = Date.now();
                const tick = () => {
                    const video = this.getVideo();
                    if (video) {
                        resolve(video);
                        return;
                    }
                    if (Date.now() - startedAt >= timeoutMs) {
                        resolve(null);
                        return;
                    }
                    window.setTimeout(tick, 200);
                };
                tick();
            });
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

        getCurrentMedia() {
            const params = new URLSearchParams(window.location.search);
            return {
                episodeIndex: Number(window.currentEpisodeIndex ?? params.get('index') ?? 0) || 0,
                url: window.currentVideoUrl || params.get('url') || '',
            };
        }

        isMediaDifferent(media = {}) {
            const current = this.getCurrentMedia();
            const targetIndex = Number(media.episodeIndex);
            const targetUrl = String(media.url || media.episodeUrl || '');
            if (Number.isFinite(targetIndex) && targetIndex !== current.episodeIndex) return true;
            if (targetUrl && current.url && targetUrl !== current.url) return true;
            return false;
        }

        async load(media = {}, options = {}) {
            const episodeIndex = Number(media.episodeIndex);
            if (!Number.isFinite(episodeIndex)) {
                return { success: false, error: new Error('Invalid episode index') };
            }

            this.offLocalListeners();

            try {
                if (typeof window.playEpisode === 'function') {
                    window.playEpisode(episodeIndex, options.reason || 'watch-room-media', {
                        fromWatchRoom: true,
                    });
                } else {
                    const art = this.getArt();
                    const url = media.url || media.episodeUrl || '';
                    if (art && url) art.switch = url;
                }
                const video = await this.waitForVideo(8000);
                return video
                    ? { success: true }
                    : { success: false, error: new Error('Video element is not ready after media load') };
            } catch (error) {
                return { success: false, error };
            }
        }

        calculateTargetTime(playback = {}) {
            const currentTime = Number(playback.currentTime) || 0;
            const duration = Number(playback.duration) || 0;
            const updatedAt = Number(playback.updatedAt) || 0;
            const paused = Boolean(playback.paused);
            let targetTime = Math.max(0, currentTime);

            if (!paused && updatedAt > 0) {
                targetTime += Math.max(0, Date.now() - updatedAt) / 1000;
            }

            if (duration > 0) {
                targetTime = Math.min(targetTime, Math.max(0, duration - 1));
            }

            return Math.max(0, targetTime);
        }

        async applyPlayback(playback = {}, options = {}) {
            const video = this.getVideo() || await this.waitForVideo();
            if (!video) {
                return { success: false, error: new Error('Video element is not ready') };
            }

            const targetTime = this.calculateTargetTime(playback);
            const currentTime = Number(video.currentTime) || 0;
            const diff = Math.abs(currentTime - targetTime);

            const seekThreshold = Number.isFinite(Number(options.seekThreshold))
                ? Number(options.seekThreshold)
                : 1;
            if (options.forceSeek || diff > seekThreshold) {
                const seekResult = await this.seek(targetTime);
                if (seekResult?.success === false) return seekResult;
            }

            if (Number.isFinite(Number(playback.playbackRate))) {
                try {
                    video.playbackRate = Number(playback.playbackRate);
                } catch (error) {}
            }

            if (options.shouldPlay) {
                return this.play();
            }

            return this.pause();
        }
    }

    window.LibertyWatchRoom.PlayerAdapter = WatchRoomPlayerAdapter;
})();

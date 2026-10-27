(function () {
    window.LibertyUtils = window.LibertyUtils || {};

    // Below the existing mobile 20s forward buffer. The deadline is shorter
    // than the recovery watchdog and never changes HLS loading or ABR policy.
    const LIMITS = Object.freeze({ MIN: 4, DEFAULT: 8, MAX: 12, MAX_WAIT_MS: 15000, FALLBACK: 0.5 });

    function supported(video) {
        return video && Object.isExtensible(video)
            && typeof video.play === 'function' && typeof video.pause === 'function'
            && ['play', 'pause', 'playing'].every((key) => (
                Object.getOwnPropertyDescriptor(video, key)?.configurable !== false
            ));
    }

    function create(options) {
        const video = options.video;
        const isCurrent = options.isCurrent || (() => true);
        const now = options.now || (() => window.performance?.now?.() ?? Date.now());
        const schedule = options.setTimeout || setTimeout;
        const unschedule = options.clearTimeout || clearTimeout;
        const bufferAhead = () => window.LibertyUtils.playbackTelemetry?.bufferSeconds(video) || 0;
        const descriptors = new Map(['play', 'pause', 'playing'].map((key) => (
            [key, Object.getOwnPropertyDescriptor(video, key)]
        )));
        const originalPlay = video.play;
        const originalPause = video.pause;
        const listeners = [];
        let state = 'idle';
        let metadataReady = false;
        let intent = false;
        let userPaused = false;
        let switching = false;
        let disposed = false;
        let live = Boolean(options.isLive);
        let ratio = null;
        let target = LIMITS.DEFAULT;
        let startedAt = null;
        let timer = null;
        let playAttempt = 0;
        let completionReason = '';
        let deadlineReported = false;
        let lastProgressAt = -Infinity;
        let lastProgressBuffer = -1;
        let pending = [];

        function current() { return !disposed && isCurrent(); }
        function snapshot() {
            return { state, intent, userPaused, targetSeconds: target, bufferSeconds: bufferAhead(),
                waitMs: startedAt === null ? 0 : Math.max(0, now() - startedAt), completionReason };
        }
        function record(type, extra = {}) {
            if (current()) options.telemetry?.record?.(type, { ...snapshot(), downloadRatio: ratio, ...extra });
        }
        function notify() { if (current()) options.onState?.(snapshot()); }
        function clearTimer() {
            if (timer !== null) unschedule(timer);
            timer = null;
        }
        function settle(error = null) {
            const callbacks = pending;
            pending = [];
            for (const callback of callbacks) error ? callback.reject(error) : callback.resolve();
        }
        function cancel(reason = 'cancelled') {
            if (state === 'completed' || state === 'cancelled') return;
            clearTimer();
            state = 'cancelled';
            completionReason = reason;
            playAttempt += 1;
            record('startup-buffer-cancel');
            settle();
            notify();
        }
        function complete() {
            if (!current() || state === 'completed' || state === 'cancelled') return;
            clearTimer();
            state = 'completed';
            record('startup-buffer-duration');
            settle();
            notify();
        }
        function release(reason) {
            if (!current() || !intent || state === 'ready' || state === 'cancelled') return;
            state = 'ready';
            completionReason = reason;
            clearTimer();
            const attempt = ++playAttempt;
            record('startup-buffer-ready');
            notify();
            try {
                Promise.resolve(originalPlay.call(video)).then(() => {
                    if (current() && attempt === playAttempt && intent) complete();
                }, (error) => {
                    if (current() && attempt === playAttempt) {
                        state = 'cancelled';
                        completionReason = 'play-rejected';
                        settle(error);
                        notify();
                    }
                });
            } catch (error) {
                state = 'cancelled';
                completionReason = 'play-rejected';
                settle(error);
                notify();
            }
        }
        function updateTarget() {
            const base = ratio === null ? LIMITS.DEFAULT : ratio <= 0.35 ? LIMITS.MIN
                : ratio >= 0.8 ? LIMITS.MAX : LIMITS.DEFAULT;
            const remaining = Number(video.duration) - Number(video.currentTime);
            const next = Number.isFinite(remaining) && remaining > 0
                ? Math.min(base, Math.max(0.1, remaining * 0.8)) : base;
            if (next !== target) {
                target = next;
                record('startup-buffer-target');
            }
        }
        function progress() {
            if (!current() || state !== 'waiting') return;
            updateTarget();
            const buffered = bufferAhead();
            if (now() - lastProgressAt >= 2000 && Math.abs(buffered - lastProgressBuffer) >= 0.5) {
                lastProgressAt = now();
                lastProgressBuffer = buffered;
                record('startup-buffer-progress');
            }
            notify();
            if (!metadataReady || !intent || video.seeking) return;
            if (options.mode === 'native') return release('native-fallback');
            if (live || !Number.isFinite(video.duration) || video.duration <= 0) return release('disabled');
            if (buffered >= target && video.readyState >= 2) release('target-reached');
            else if (startedAt !== null && now() - startedAt >= LIMITS.MAX_WAIT_MS) timeout();
        }
        function timeout() {
            timer = null;
            if (!current() || state !== 'waiting') return;
            if (!deadlineReported) {
                deadlineReported = true;
                record('startup-buffer-timeout', { state: ratio !== null && ratio >= 0.8 ? 'source-marginal' : state });
            }
            if (metadataReady && !video.seeking && bufferAhead() >= LIMITS.FALLBACK && video.readyState >= 2) {
                if (intent) release('timeout-fallback');
                // A paused user remains paused; their next explicit play is
                // evaluated at the current position with the expired deadline.
                return;
            }
            cancel('timeout-no-playable-data');
            options.onNoData?.();
        }
        function requestPlay(automatic = false) {
            if (!current()) return Promise.resolve();
            if (automatic && (userPaused || state === 'cancelled' || state === 'completed')) return Promise.resolve();
            if (state === 'completed' || state === 'cancelled') return originalPlay.call(video);
            intent = true;
            userPaused = false;
            if (state === 'idle') {
                state = 'waiting';
                startedAt = now();
                timer = schedule(timeout, LIMITS.MAX_WAIT_MS);
                record('startup-buffer-start');
            }
            if (state === 'waiting' && timer === null && !deadlineReported) {
                timer = schedule(timeout, Math.max(0, LIMITS.MAX_WAIT_MS - (now() - startedAt)));
            }
            const promise = new Promise((resolve, reject) => pending.push({ resolve, reject }));
            progress();
            return promise;
        }
        function pause() {
            if (!current()) return;
            if (!switching && state !== 'completed' && state !== 'cancelled') {
                intent = false;
                userPaused = true;
                playAttempt += 1;
                if (state === 'ready') state = 'waiting';
                settle();
                notify();
            }
            return originalPause.call(video);
        }
        function listen(type, callback) {
            const guarded = () => { if (current()) callback(); };
            video.addEventListener(type, guarded);
            listeners.push([type, guarded]);
        }
        const play = () => requestPlay(false);
        Object.defineProperty(video, 'play', { configurable: true, writable: true, value: play });
        Object.defineProperty(video, 'pause', { configurable: true, writable: true, value: pause });
        // ArtPlayer explicitly supports a video.playing proxy. Pending intent
        // makes toggle/keyboard pause work, without fabricating media events.
        const playing = () => ['idle', 'waiting', 'ready'].includes(state)
            ? !switching && intent
            : video.currentTime > 0 && !video.paused && !video.ended && video.readyState > 2;
        Object.defineProperty(video, 'playing', { configurable: true, get: playing });
        for (const type of ['progress', 'canplay', 'loadeddata', 'seeked', 'durationchange']) listen(type, progress);
        listen('seeking', () => {
            if (state === 'ready') {
                playAttempt += 1;
                state = 'waiting';
                originalPause.call(video);
                timer = schedule(timeout, Math.max(0, LIMITS.MAX_WAIT_MS - (now() - startedAt)));
            }
            progress();
        });
        listen('playing', () => {
            if (state === 'ready' && intent) complete();
        });

        return Object.freeze({
            generation: options.generation,
            requestAutomaticPlay: () => requestPlay(true),
            metadataRestored() { if (current()) { metadataReady = true; progress(); } },
            observeFragment(metrics) {
                if (!current() || state === 'completed' || state === 'cancelled') return;
                const sample = metrics?.downloadRatio;
                if (typeof sample === 'number' && Number.isFinite(sample) && sample >= 0) {
                    ratio = ratio === null ? sample : ratio * 0.5 + sample * 0.5;
                    progress();
                }
            },
            setLive(value) { if (current()) { live = Boolean(value); progress(); } },
            progress,
            snapshot,
            duringSwitch(callback) {
                switching = true;
                try { return callback(); } finally { switching = false; }
            },
            dispose(reason = 'generation-change') {
                if (disposed) return;
                cancel(reason);
                clearTimer();
                disposed = true;
                for (const [type, handler] of listeners) video.removeEventListener(type, handler);
                for (const [key, installed] of [['play', play], ['pause', pause], ['playing', playing]]) {
                    const descriptor = Object.getOwnPropertyDescriptor(video, key);
                    if ((descriptor?.value || descriptor?.get) !== installed) continue;
                    const original = descriptors.get(key);
                    if (original) Object.defineProperty(video, key, original);
                    else delete video[key];
                }
            },
        });
    }

    window.LibertyUtils.startupBuffer = Object.freeze({ create, supported, constants: LIMITS });
})();

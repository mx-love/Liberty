(function initLibertyHlsTelemetry(root) {
    'use strict';

    const QUALITY = Object.freeze({
        EXCELLENT: 'excellent',
        GOOD: 'good',
        POOR: 'poor',
        RECOVERING: 'recovering',
    });
    const POLICY_CHANGE_COOLDOWN_MS = 15000;
    const RECOVERY_STABLE_MS = 45000;

    function monotonicNow() {
        return typeof performance !== 'undefined' ? performance.now() : Date.now();
    }

    function bufferAhead(video) {
        if (!video?.buffered?.length) return 0;
        const currentTime = Number(video.currentTime) || 0;
        for (let index = 0; index < video.buffered.length; index += 1) {
            const start = video.buffered.start(index);
            const end = video.buffered.end(index);
            if (currentTime >= start - 0.1 && currentTime <= end + 0.1) {
                return Math.max(0, end - currentTime);
            }
        }
        return 0;
    }

    class HlsNetworkTelemetry {
        constructor({ hls, video, source, isMobile = false, recoverNetwork } = {}) {
            this.hls = hls;
            this.video = video;
            this.source = String(source || '');
            this.isMobile = Boolean(isMobile);
            this.hlsListeners = [];
            this.domListeners = [];
            this.timer = null;
            this.rebufferStartedAt = 0;
            this.lastPoorAt = 0;
            this.lastPolicyChangeAt = 0;
            this.poorSampleCount = 0;
            this.lastQualitySampleAt = -Infinity;
            this.stableSince = 0;
            this.destroyed = false;
            this.basePolicy = {
                maxBufferLength: this.isMobile ? 20 : 30,
                maxMaxBufferLength: this.isMobile ? 40 : 60,
            };
            this.metrics = {
                hlsVersion: root.Hls?.version || 'unknown',
                source: this.source,
                networkQuality: QUALITY.GOOD,
                currentLevel: -1,
                autoLevel: true,
                estimatedBandwidth: 0,
                lastFragmentBandwidth: 0,
                bufferAhead: 0,
                startupTime: null,
                rebufferCount: 0,
                rebufferDuration: 0,
                fragmentRetry: 0,
                manifestRetry: 0,
                fatalError: '',
                recoverMediaErrorCount: 0,
                levelSwitchCount: 0,
                lifecycle: 'initializing',
                timeline: {
                    created: monotonicNow(),
                    manifestRequest: null,
                    manifestLoaded: null,
                    manifestParsed: null,
                    firstFragmentRequest: null,
                    firstFragmentLoaded: null,
                    canplay: null,
                    playing: null,
                },
            };
            this.bind();
            this.publish('created');
        }

        onHls(event, handler) {
            if (!event || !this.hls?.on) return;
            const guarded = (...args) => { if (!this.destroyed) handler(...args); };
            this.hls.on(event, guarded);
            this.hlsListeners.push([event, guarded]);
        }

        onDom(target, event, handler) {
            if (!target?.addEventListener) return;
            target.addEventListener(event, handler);
            this.domListeners.push([target, event, handler]);
        }

        stamp(name) {
            if (this.metrics.timeline[name] === null) this.metrics.timeline[name] = monotonicNow();
        }

        bind() {
            const events = root.Hls?.Events || {};
            this.onHls(events.MANIFEST_LOADING, () => this.stamp('manifestRequest'));
            this.onHls(events.MANIFEST_LOADED, () => this.stamp('manifestLoaded'));
            this.onHls(events.MANIFEST_PARSED, () => {
                this.stamp('manifestParsed');
                this.publish('manifest_parsed');
            });
            this.onHls(events.FRAG_LOADING, () => this.stamp('firstFragmentRequest'));
            this.onHls(events.FRAG_LOADED, (_event, data = {}) => {
                this.stamp('firstFragmentLoaded');
                const stats = data.stats || {};
                const started = Number(stats.loading?.start || stats.trequest || 0);
                const ended = Number(stats.loading?.end || stats.tload || 0);
                const bytes = Number(stats.loaded || stats.total || 0);
                const durationMs = ended > started ? ended - started : 0;
                if (bytes > 0 && durationMs > 0) {
                    this.metrics.lastFragmentBandwidth = Math.round((bytes * 8 * 1000) / durationMs);
                }
                const retry = Number(stats.retry || stats.retryCount || 0);
                if (retry > 0) this.metrics.fragmentRetry += retry;
                this.sample('fragment_loaded');
            });
            this.onHls(events.LEVEL_SWITCHED, (_event, data = {}) => {
                this.metrics.currentLevel = Number.isInteger(data.level) ? data.level : this.hls?.currentLevel ?? -1;
                this.metrics.autoLevel = Number(this.hls?.manualLevel) < 0;
                this.metrics.levelSwitchCount += 1;
                this.publish('level_switched');
            });
            this.onHls(events.ERROR, (_event, data = {}) => {
                const details = String(data.details || data.type || 'unknown');
                if (/manifest/i.test(details)) this.metrics.manifestRetry += 1;
                if (/frag|level|network/i.test(details)) this.metrics.fragmentRetry += 1;
                if (data.fatal) this.metrics.fatalError = details;
                this.sample(data.fatal ? 'fatal_error' : 'hls_error');
            });

            this.onDom(this.video, 'canplay', () => {
                this.stamp('canplay');
                this.sample('canplay');
            });
            this.onDom(this.video, 'playing', () => {
                this.stamp('playing');
                if (this.metrics.startupTime === null) {
                    this.metrics.startupTime = Math.round(
                        this.metrics.timeline.playing - this.metrics.timeline.created
                    );
                }
                this.endRebuffer('playing');
                this.metrics.lifecycle = 'playing';
                this.sample('playing');
            });
            this.onDom(this.video, 'waiting', () => this.beginRebuffer('waiting'));
            this.onDom(this.video, 'stalled', () => this.beginRebuffer('stalled'));
            this.onDom(this.video, 'error', () => {
                this.metrics.fatalError = this.video?.error?.message || `media_error_${this.video?.error?.code || 'unknown'}`;
                this.publish('media_error');
            });
            this.onDom(root, 'online', () => {
                this.metrics.networkQuality = QUALITY.RECOVERING;
                this.metrics.lifecycle = 'online';
                this.sample('online');
                if (!this.destroyed) recoverNetwork?.();
            });
            this.onDom(root, 'offline', () => {
                this.metrics.networkQuality = QUALITY.POOR;
                this.metrics.lifecycle = 'offline';
                this.lastPoorAt = Date.now();
                this.publish('offline');
            });
            this.onDom(document, 'visibilitychange', () => {
                this.metrics.lifecycle = document.hidden ? 'background' : 'foreground';
                if (!document.hidden) this.sample('foreground');
            });

            this.timer = root.setInterval(() => this.sample('interval'), 5000);
        }

        beginRebuffer(reason) {
            if (this.metrics.timeline.playing === null || this.rebufferStartedAt) return;
            this.rebufferStartedAt = monotonicNow();
            this.metrics.rebufferCount += 1;
            this.metrics.networkQuality = QUALITY.POOR;
            this.lastPoorAt = Date.now();
            this.publish(reason);
        }

        endRebuffer(reason) {
            if (!this.rebufferStartedAt) return;
            this.metrics.rebufferDuration += Math.max(0, monotonicNow() - this.rebufferStartedAt);
            this.rebufferStartedAt = 0;
            this.metrics.networkQuality = QUALITY.RECOVERING;
            this.publish(`rebuffer_end:${reason}`);
        }

        markMediaRecovery(reason = 'recoverMediaError') {
            this.metrics.recoverMediaErrorCount += 1;
            this.metrics.lifecycle = reason;
            this.publish(reason);
        }

        classifyQuality() {
            const bandwidth = this.metrics.estimatedBandwidth || this.metrics.lastFragmentBandwidth;
            const ahead = this.metrics.bufferAhead;
            const poorSignal = (bandwidth > 0 && bandwidth < 800000)
                || (this.metrics.timeline.playing && ahead < 1.5);

            if (this.rebufferStartedAt || this.metrics.lifecycle === 'offline') {
                this.poorSampleCount = 3;
                this.stableSince = 0;
                return QUALITY.POOR;
            }

            if (poorSignal && monotonicNow() - this.lastQualitySampleAt >= 1000) {
                this.poorSampleCount += 1;
                this.lastQualitySampleAt = monotonicNow();
                this.stableSince = 0;
            } else if (!poorSignal) {
                this.poorSampleCount = 0;
                if (!this.stableSince) this.stableSince = Date.now();
            }

            if (this.poorSampleCount >= 3) return QUALITY.POOR;
            if (this.lastPoorAt && (!this.stableSince || Date.now() - this.stableSince < RECOVERY_STABLE_MS)) {
                return QUALITY.RECOVERING;
            }
            if (bandwidth >= 5000000 && ahead >= 12) return QUALITY.EXCELLENT;
            return QUALITY.GOOD;
        }

        applyAdaptiveBufferPolicy() {
            if (!this.hls?.config || Date.now() - this.lastPolicyChangeAt < POLICY_CHANGE_COOLDOWN_MS) return;
            const quality = this.metrics.networkQuality;
            const expanded = quality === QUALITY.POOR || quality === QUALITY.RECOVERING;
            const nextLength = expanded ? (this.isMobile ? 30 : 45) : this.basePolicy.maxBufferLength;
            const nextMax = expanded ? (this.isMobile ? 60 : 75) : this.basePolicy.maxMaxBufferLength;
            if (this.hls.config.maxBufferLength === nextLength && this.hls.config.maxMaxBufferLength === nextMax) return;
            this.hls.config.maxBufferLength = nextLength;
            this.hls.config.maxMaxBufferLength = nextMax;
            this.lastPolicyChangeAt = Date.now();
            this.publish(expanded ? 'buffer_policy_recovery' : 'buffer_policy_normal');
        }

        sample(reason) {
            if (this.destroyed) return;
            this.metrics.estimatedBandwidth = Math.max(0, Number(this.hls?.bandwidthEstimate) || 0);
            this.metrics.bufferAhead = Number(bufferAhead(this.video).toFixed(2));
            this.metrics.currentLevel = Number.isInteger(this.hls?.currentLevel) ? this.hls.currentLevel : -1;
            this.metrics.autoLevel = Number(this.hls?.manualLevel) < 0;
            const nextQuality = this.classifyQuality();
            if (nextQuality === QUALITY.POOR && this.metrics.networkQuality !== QUALITY.POOR) {
                this.lastPoorAt = Date.now();
            }
            this.metrics.networkQuality = nextQuality;
            this.applyAdaptiveBufferPolicy();
            if (reason !== 'interval' || root.LibertyDebug?.enabled?.()) this.publish(reason);
        }

        getSnapshot() {
            return JSON.parse(JSON.stringify({
                ...this.metrics,
                rebufferDuration: Math.round(this.metrics.rebufferDuration),
                currentRebufferDuration: this.rebufferStartedAt
                    ? Math.round(monotonicNow() - this.rebufferStartedAt)
                    : 0,
                maxBufferLength: this.hls?.config?.maxBufferLength,
                maxMaxBufferLength: this.hls?.config?.maxMaxBufferLength,
            }));
        }

        publish(reason) {
            root.LibertyPlayerTelemetry = this.getSnapshot();
            root.LibertyDebug?.log?.('[PlayerTelemetry]', reason, root.LibertyPlayerTelemetry);
        }

        destroy() {
            if (this.destroyed) return;
            this.destroyed = true;
            if (this.timer) root.clearInterval(this.timer);
            this.timer = null;
            this.hlsListeners.forEach(([event, handler]) => {
                try { this.hls?.off?.(event, handler); } catch (error) {}
            });
            this.domListeners.forEach(([target, event, handler]) => {
                try { target.removeEventListener(event, handler); } catch (error) {}
            });
            this.hlsListeners = [];
            this.domListeners = [];
            this.publish('destroyed');
            this.hls = null;
            this.video = null;
        }
    }

    root.LibertyHlsTelemetry = Object.freeze({
        QUALITY,
        create(options) {
            return new HlsNetworkTelemetry(options);
        },
    });
})(typeof globalThis !== 'undefined' ? globalThis : window);

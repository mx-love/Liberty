(function () {
    window.LibertyUtils = window.LibertyUtils || {};

    const DEFAULT_MAX_EVENTS = 100;
    const SAFE_FIELDS = new Set([
        'state',
        'signal',
        'durationMs',
        'bytes',
        'mediaDuration',
        'throughputBps',
        'downloadRatio',
        'bufferSeconds',
        'readyState',
        'networkState',
        'stallCount',
        'stallDurationMs',
        'retryCount',
        'errorType',
        'errorDetails',
        'fatal',
        'level',
        'fragmentSequence',
        'recoveryAttempt',
        'recoveryReason',
        'recoveryOutcome',
    ]);
    const SENSITIVE_TEXT = /(?:authorization|cookie|password|secret|token|signature|proxy[-_ ]?capability|credential)/iu;

    function stableHash(value) {
        let hash = 0x811c9dc5;
        for (let index = 0; index < value.length; index += 1) {
            hash ^= value.charCodeAt(index);
            hash = Math.imul(hash, 0x01000193);
        }
        return (hash >>> 0).toString(16).padStart(8, '0');
    }

    function mediaLocator(value) {
        try {
            const url = new URL(String(value || ''), window.location?.href || 'https://localhost/');
            return {
                hostname: url.hostname,
                pathHash: stableHash(url.pathname || '/'),
            };
        } catch (error) {
            return { hostname: '', pathHash: '' };
        }
    }

    function safeScalar(value) {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') return Number.isFinite(value) ? value : null;
        const text = String(value ?? '').trim();
        if (!text) return '';
        if (SENSITIVE_TEXT.test(text)) return '[redacted]';
        if (/^[a-z][a-z\d+.-]*:\/\//iu.test(text) || text.includes('?') || text.includes('#')) {
            return '[redacted-location]';
        }
        return text.slice(0, 160);
    }

    function safeFields(fields = {}) {
        const output = {};
        for (const [key, value] of Object.entries(fields)) {
            if (!SAFE_FIELDS.has(key)) continue;
            output[key] = safeScalar(value);
        }
        return output;
    }

    function finiteNumber(value) {
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    function loadingDuration(stats, fallback = null) {
        const start = finiteNumber(stats?.loading?.start ?? stats?.trequest);
        const end = finiteNumber(stats?.loading?.end ?? stats?.tload);
        if (start !== null && end !== null && end >= start) return end - start;
        return finiteNumber(fallback);
    }

    function fragmentMetrics(data = {}) {
        const durationMs = loadingDuration(data.stats);
        const bytes = finiteNumber(data.stats?.loaded ?? data.stats?.total);
        const mediaDuration = finiteNumber(data.frag?.duration);
        const throughputBps = durationMs !== null && durationMs > 0 && bytes !== null
            ? (bytes * 8) / (durationMs / 1000)
            : null;
        const downloadRatio = durationMs !== null && mediaDuration !== null && mediaDuration > 0
            ? (durationMs / 1000) / mediaDuration
            : null;
        return {
            durationMs,
            bytes,
            mediaDuration,
            throughputBps,
            downloadRatio,
            fragmentSequence: data.frag?.sn ?? '',
            level: data.frag?.level ?? null,
            retryCount: data.stats?.retry ?? null,
        };
    }

    function bufferSeconds(video) {
        const currentTime = finiteNumber(video?.currentTime);
        const buffered = video?.buffered;
        if (currentTime === null || !buffered || !Number.isInteger(buffered.length)) return 0;
        try {
            for (let index = 0; index < buffered.length; index += 1) {
                const start = buffered.start(index);
                const end = buffered.end(index);
                if (currentTime >= start && currentTime <= end) {
                    return Math.max(0, end - currentTime);
                }
            }
        } catch (error) {
            return 0;
        }
        return 0;
    }

    function create(options = {}) {
        const debug = options.debug || window.LibertyDebug;
        const enabled = options.enabled === undefined
            ? Boolean(debug?.enabled?.())
            : Boolean(options.enabled);
        const maxEvents = Math.max(1, Math.min(500, Number(options.maxEvents) || DEFAULT_MAX_EVENTS));
        const generation = Number.isInteger(options.generation) ? options.generation : 0;
        const locator = mediaLocator(options.mediaUrl);
        const mediaType = String(options.mediaType || 'unknown');
        const isCurrent = typeof options.isCurrent === 'function' ? options.isCurrent : () => true;
        const now = typeof options.now === 'function' ? options.now : () => Date.now();
        const events = [];

        function record(type, fields = {}) {
            if (!enabled || !isCurrent()) return false;
            const event = {
                type: String(type || 'unknown'),
                at: now(),
                generation,
                mediaType,
                hostname: locator.hostname,
                pathHash: locator.pathHash,
                ...safeFields(fields),
            };
            events.push(event);
            if (events.length > maxEvents) events.splice(0, events.length - maxEvents);
            debug?.log?.('[PlaybackTelemetry]', event);
            return true;
        }

        return Object.freeze({
            enabled,
            generation,
            locator: Object.freeze({ ...locator }),
            maxEvents,
            record,
            getEvents: () => events.map((event) => ({ ...event })),
        });
    }

    window.LibertyUtils.playbackTelemetry = Object.freeze({
        create,
        mediaLocator,
        fragmentMetrics,
        loadingDuration,
        bufferSeconds,
        constants: Object.freeze({ DEFAULT_MAX_EVENTS }),
    });
})();

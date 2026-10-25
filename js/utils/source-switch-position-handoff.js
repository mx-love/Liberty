(function () {
    window.LibertyUtils = window.LibertyUtils || {};

    const STORAGE_KEY = 'liberty:source-switch-position-handoff:v1';
    const VERSION = 1;
    const TTL_MS = 60_000;
    const DURATION_ABSOLUTE_TOLERANCE_SECONDS = 30;
    const DURATION_RELATIVE_TOLERANCE = 0.02;
    const MIN_RESTORE_POSITION_SECONDS = 10;
    const END_GUARD_SECONDS = 30;
    const END_GUARD_RATIO = 0.02;

    function finiteNumber(value) {
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    function cleanString(value) {
        return String(value ?? '').trim();
    }

    function createNonce() {
        try {
            if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
            if (typeof globalThis.crypto?.getRandomValues === 'function') {
                const bytes = new Uint32Array(4);
                globalThis.crypto.getRandomValues(bytes);
                return [...bytes].map((value) => value.toString(16).padStart(8, '0')).join('');
            }
        } catch (error) {
            // A nonce is a navigation correlation value, not a credential.
        }
        return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    }

    function storageOrDefault(storage) {
        if (storage) return storage;
        try {
            return window.sessionStorage;
        } catch (error) {
            return null;
        }
    }

    function normalizeEpisodeLocator(locator = {}) {
        locator = locator && typeof locator === 'object' ? locator : {};
        return {
            rawIndex: Number.isInteger(locator.rawIndex) ? locator.rawIndex : null,
            playGroup: cleanString(locator.playGroup),
            playGroupIndex: Number.isInteger(locator.playGroupIndex) ? locator.playGroupIndex : null,
        };
    }

    function normalizeSide(side = {}) {
        side = side && typeof side === 'object' ? side : {};
        return {
            sourceKey: cleanString(side.sourceKey),
            vodId: cleanString(side.vodId),
            canonicalMediaId: cleanString(side.canonicalMediaId),
            canonicalEpisodeId: cleanString(side.canonicalEpisodeId),
            episode: normalizeEpisodeLocator(side.episode),
        };
    }

    function hasRequiredIdentity(side) {
        return Boolean(
            side.sourceKey
            && side.vodId
            && side.canonicalMediaId
            && side.canonicalEpisodeId
        );
    }

    function sameTarget(left, right) {
        return left.sourceKey === right.sourceKey
            && left.vodId === right.vodId
            && left.canonicalMediaId === right.canonicalMediaId
            && left.canonicalEpisodeId === right.canonicalEpisodeId
            && left.episode.rawIndex === right.episode.rawIndex
            && left.episode.playGroup === right.episode.playGroup
            && left.episode.playGroupIndex === right.episode.playGroupIndex;
    }

    function create(input = {}, options = {}) {
        const storage = storageOrDefault(options.storage);
        const now = finiteNumber(options.now) ?? Date.now();
        const currentTime = finiteNumber(input.currentTime);
        const oldDuration = finiteNumber(input.oldDuration);
        const source = normalizeSide(input.source);
        const target = normalizeSide(input.target);

        if (!storage || currentTime === null || currentTime < 0) return null;
        if (!Number.isInteger(input.generation)) return null;
        if (oldDuration === null || oldDuration <= 0 || input.isLive || input.ended) return null;
        if (!hasRequiredIdentity(source) || !hasRequiredIdentity(target)) return null;

        const record = {
            version: VERSION,
            nonce: cleanString(input.nonce) || createNonce(),
            createdAt: now,
            generation: input.generation,
            currentTime,
            oldDuration,
            source,
            target,
        };

        try {
            storage.setItem(STORAGE_KEY, JSON.stringify(record));
            return record;
        } catch (error) {
            return null;
        }
    }

    function reject(reason, record = null) {
        return { accepted: false, position: null, reason, record };
    }

    function evaluate(record, input = {}, options = {}) {
        const now = finiteNumber(options.now) ?? Date.now();
        if (!record || record.version !== VERSION) return reject('invalid-version');
        if (cleanString(input.nonce) !== cleanString(record.nonce)) return reject('nonce-mismatch', record);
        if (!Number.isInteger(input.generation) || input.generation !== record.generation) {
            return reject('generation-mismatch', record);
        }
        if (!Number.isFinite(record.createdAt) || now - record.createdAt < 0 || now - record.createdAt > TTL_MS) {
            return reject('expired', record);
        }

        const target = normalizeSide(input.target);
        if (!hasRequiredIdentity(target) || !sameTarget(normalizeSide(record.target), target)) {
            return reject('target-identity-mismatch', record);
        }
        if (input.isLive) return reject('live-media', record);

        const oldDuration = finiteNumber(record.oldDuration);
        const newDuration = finiteNumber(input.newDuration);
        const position = finiteNumber(record.currentTime);
        if (oldDuration === null || oldDuration <= 0 || newDuration === null || newDuration <= 0) {
            return reject('invalid-duration', record);
        }
        if (position === null || position <= MIN_RESTORE_POSITION_SECONDS) {
            return reject('near-start', record);
        }

        const oldRemaining = oldDuration - position;
        if (oldRemaining <= END_GUARD_SECONDS || position / oldDuration >= 1 - END_GUARD_RATIO) {
            return reject('near-end', record);
        }
        if (position >= newDuration - 2) return reject('position-outside-target', record);

        const durationDifference = Math.abs(newDuration - oldDuration);
        const relativeDifference = durationDifference / oldDuration;
        // This is a temporary conservative timeline compatibility heuristic.
        // Equal episode identity alone does not prove equal edition timelines.
        if (
            durationDifference > DURATION_ABSOLUTE_TOLERANCE_SECONDS
            || relativeDifference > DURATION_RELATIVE_TOLERANCE
        ) {
            return reject('duration-incompatible', record);
        }

        return {
            accepted: true,
            position,
            reason: 'compatible-one-shot-handoff',
            record,
            durationDifference,
            relativeDifference,
        };
    }

    function consume(input = {}, options = {}) {
        const storage = storageOrDefault(options.storage);
        if (!storage) return reject('storage-unavailable');

        let raw = null;
        try {
            raw = storage.getItem(STORAGE_KEY);
            // Consume before parsing or validation so every outcome is one-shot.
            storage.removeItem(STORAGE_KEY);
        } catch (error) {
            return reject('storage-error');
        }
        if (!raw) return reject('missing');

        try {
            return evaluate(JSON.parse(raw), input, options);
        } catch (error) {
            return reject('invalid-json');
        }
    }

    function clear(options = {}) {
        try {
            storageOrDefault(options.storage)?.removeItem(STORAGE_KEY);
        } catch (error) {
            // Best-effort cleanup only.
        }
    }

    window.LibertyUtils.sourceSwitchPositionHandoff = Object.freeze({
        create,
        consume,
        evaluate,
        clear,
        constants: Object.freeze({
            STORAGE_KEY,
            VERSION,
            TTL_MS,
            DURATION_ABSOLUTE_TOLERANCE_SECONDS,
            DURATION_RELATIVE_TOLERANCE,
            MIN_RESTORE_POSITION_SECONDS,
            END_GUARD_SECONDS,
            END_GUARD_RATIO,
        }),
    });
})();

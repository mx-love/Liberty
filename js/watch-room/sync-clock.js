(function initWatchRoomSyncClock(root) {
    'use strict';

    function finiteNumber(value, fallback = 0) {
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
    }

    function computeTargetPlaybackTime(input = {}) {
        const hostCurrentTime = Math.max(0, finiteNumber(input.hostCurrentTime, 0));
        const hostPlaybackRate = Math.max(0, finiteNumber(input.hostPlaybackRate, 1));
        const serverTimestamp = finiteNumber(input.serverTimestamp, 0);
        const estimatedServerNow = finiteNumber(input.estimatedServerNow, serverTimestamp);
        const duration = Math.max(0, finiteNumber(input.duration, 0));
        let targetTime = hostCurrentTime;

        if (!input.paused && serverTimestamp > 0) {
            const elapsedSeconds = Math.max(0, estimatedServerNow - serverTimestamp) / 1000;
            targetTime += elapsedSeconds * hostPlaybackRate;
        }

        if (duration > 0) targetTime = Math.min(targetTime, Math.max(0, duration - 1));
        return Math.max(0, targetTime);
    }

    function updateClockEstimate(previous = {}, sample = {}) {
        const { rttMs, serverSentAt, localNow, monotonicNow } = sample;
        const count = previous.count || 0;
        const limit = count >= 3 ? Math.min(2000, Math.max(250, previous.rttMs * 3)) : 2000;
        if (![rttMs, serverSentAt, localNow, monotonicNow].every(Number.isFinite)
            || rttMs < 0 || rttMs > limit || serverSentAt <= 0) return { ...previous, accepted: false };
        const measured = serverSentAt + rttMs / 2;
        const predicted = count ? previous.serverNow + Math.max(0, monotonicNow - previous.monotonicNow) : measured;
        // Smooth bounded innovation in the monotonic domain, even if the OS wall clock jumps.
        const serverNow = count ? predicted + Math.max(-250, Math.min(250, measured - predicted)) * 0.2 : measured;
        return {
            accepted: true, count: count + 1, serverNow, monotonicNow,
            offsetMs: serverNow - localNow,
            rttMs: count ? previous.rttMs * 0.8 + rttMs * 0.2 : rttMs,
        };
    }

    root.LibertyWatchRoomClock = Object.freeze({ computeTargetPlaybackTime, updateClockEstimate });
})(typeof globalThis !== 'undefined' ? globalThis : window);

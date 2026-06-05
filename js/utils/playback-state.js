(function () {
    window.LibertyUtils = window.LibertyUtils || {};

    const media = window.LibertyUtils.media || {};
    const storage = window.LibertyUtils.storage || {};

    function fallbackGetEpisodeUrl(episode) {
        if (!episode) return '';
        if (typeof episode === 'string') return episode;
        return episode.url || '';
    }

    function normalizeEpisodesToUrls(episodes) {
        if (!Array.isArray(episodes)) return [];
        const getEpisodeUrl = media.getEpisodeUrl || fallbackGetEpisodeUrl;
        return episodes.map(getEpisodeUrl).filter(Boolean);
    }

    function readCurrentEpisodes() {
        let raw = [];

        if (storage.readStorage) {
            raw = storage.readStorage('currentEpisodes', []);
        } else {
            try {
                raw = JSON.parse(localStorage.getItem('currentEpisodes') || '[]');
            } catch (error) {
                raw = [];
            }
        }

        return normalizeEpisodesToUrls(Array.isArray(raw) ? raw : []);
    }

    function writeCurrentEpisodes(episodes) {
        const urls = normalizeEpisodesToUrls(episodes);

        if (storage.writeStorage) {
            storage.writeStorage('currentEpisodes', urls);
        } else {
            localStorage.setItem('currentEpisodes', JSON.stringify(urls));
        }

        return urls;
    }

    function readCurrentEpisodeIndex() {
        const value = localStorage.getItem('currentEpisodeIndex');
        const index = parseInt(value || '0', 10);
        return Number.isFinite(index) && index >= 0 ? index : 0;
    }

    function writeCurrentEpisodeIndex(index) {
        const safeIndex = Number.isFinite(Number(index)) ? Number(index) : 0;
        localStorage.setItem('currentEpisodeIndex', String(Math.max(0, safeIndex)));
    }

    function readPlaybackSession() {
        return {
            title: localStorage.getItem('currentVideoTitle') || '',
            year: localStorage.getItem('currentVideoYear') || '',
            sourceCode: localStorage.getItem('currentSourceCode') || '',
            sourceName: localStorage.getItem('currentSourceName') || '',
            vodId: localStorage.getItem('currentVodId') || '',
            episodeIndex: readCurrentEpisodeIndex(),
            episodes: readCurrentEpisodes(),
            updatedAt: Date.now()
        };
    }

    function writePlaybackSession(session = {}) {
        if (session.title !== undefined) {
            localStorage.setItem('currentVideoTitle', String(session.title || ''));
        }
        if (session.year !== undefined) {
            localStorage.setItem('currentVideoYear', String(session.year || ''));
        }
        if (session.sourceCode !== undefined) {
            localStorage.setItem('currentSourceCode', String(session.sourceCode || ''));
        }
        if (session.sourceName !== undefined) {
            localStorage.setItem('currentSourceName', String(session.sourceName || ''));
        }
        if (session.vodId !== undefined) {
            localStorage.setItem('currentVodId', String(session.vodId || ''));
        }
        if (session.episodeIndex !== undefined) {
            writeCurrentEpisodeIndex(session.episodeIndex);
        }
        if (session.episodes !== undefined) {
            writeCurrentEpisodes(session.episodes);
        }

        return readPlaybackSession();
    }

    window.LibertyUtils.playbackState = {
        normalizeEpisodesToUrls,
        readCurrentEpisodes,
        writeCurrentEpisodes,
        readCurrentEpisodeIndex,
        writeCurrentEpisodeIndex,
        readPlaybackSession,
        writePlaybackSession
    };
})();

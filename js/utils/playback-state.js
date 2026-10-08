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

    function normalizeEpisodeEntries(episodes) {
        if (!Array.isArray(episodes)) return [];
        const getEpisodeUrl = media.getEpisodeUrl || fallbackGetEpisodeUrl;

        return episodes.map((episode) => {
            const url = getEpisodeUrl(episode);
            if (!url) return null;

            if (episode && typeof episode === 'object' && !Array.isArray(episode)) {
                return { ...episode, url };
            }

            // URL-only legacy data has no reliable title or source index. Do not
            // manufacture either value from its array position.
            return { url };
        }).filter(Boolean);
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
        const entries = normalizeEpisodeEntries(episodes);

        if (storage.writeStorage) {
            storage.writeStorage('currentEpisodes', urls);
            storage.writeStorage('currentEpisodeEntries', entries);
        } else {
            localStorage.setItem('currentEpisodes', JSON.stringify(urls));
            localStorage.setItem('currentEpisodeEntries', JSON.stringify(entries));
        }

        return urls;
    }

    function readCurrentEpisodeEntries() {
        let raw = null;

        if (storage.readStorage) {
            raw = storage.readStorage('currentEpisodeEntries', null);
        } else {
            try {
                raw = JSON.parse(localStorage.getItem('currentEpisodeEntries') || 'null');
            } catch (error) {
                raw = null;
            }
        }

        const currentUrls = readCurrentEpisodes();
        const entries = normalizeEpisodeEntries(Array.isArray(raw) ? raw : currentUrls);
        const entryUrls = normalizeEpisodesToUrls(entries);
        const entriesMatchCurrentUrls = entryUrls.length === currentUrls.length &&
            entryUrls.every((url, index) => url === currentUrls[index]);

        // A legacy writer may update currentEpisodes without knowing about the
        // structured companion key. Never expose stale names for another list.
        return entriesMatchCurrentUrls ? entries : normalizeEpisodeEntries(currentUrls);
    }

    function writeCurrentEpisodeEntries(episodes) {
        const entries = normalizeEpisodeEntries(episodes);
        writeCurrentEpisodes(entries);
        return entries;
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
            category: localStorage.getItem('currentVideoCategory') || '',
            type: localStorage.getItem('currentVideoType') || '',
            remarks: localStorage.getItem('currentVideoRemarks') || '',
            director: localStorage.getItem('currentVideoDirector') || '',
            actors: localStorage.getItem('currentVideoActors') || '',
            area: localStorage.getItem('currentVideoArea') || '',
            language: localStorage.getItem('currentVideoLanguage') || '',
            sourceCode: localStorage.getItem('currentSourceCode') || '',
            sourceName: localStorage.getItem('currentSourceName') || '',
            vodId: localStorage.getItem('currentVodId') || '',
            episodeIndex: readCurrentEpisodeIndex(),
            episodes: readCurrentEpisodes(),
            episodeEntries: readCurrentEpisodeEntries(),
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
        if (session.category !== undefined) {
            localStorage.setItem('currentVideoCategory', String(session.category || ''));
        }
        if (session.type !== undefined) {
            localStorage.setItem('currentVideoType', String(session.type || ''));
        }
        if (session.remarks !== undefined) {
            localStorage.setItem('currentVideoRemarks', String(session.remarks || ''));
        }
        if (session.director !== undefined) {
            localStorage.setItem('currentVideoDirector', String(session.director || ''));
        }
        if (session.actors !== undefined) {
            localStorage.setItem('currentVideoActors', String(session.actors || ''));
        }
        if (session.area !== undefined) {
            localStorage.setItem('currentVideoArea', String(session.area || ''));
        }
        if (session.language !== undefined) {
            localStorage.setItem('currentVideoLanguage', String(session.language || ''));
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
        if (session.episodeEntries !== undefined) {
            writeCurrentEpisodeEntries(session.episodeEntries);
        } else if (session.episodes !== undefined) {
            writeCurrentEpisodes(session.episodes);
        }

        return readPlaybackSession();
    }

    window.LibertyUtils.playbackState = {
        normalizeEpisodesToUrls,
        normalizeEpisodeEntries,
        readCurrentEpisodes,
        writeCurrentEpisodes,
        readCurrentEpisodeEntries,
        writeCurrentEpisodeEntries,
        readCurrentEpisodeIndex,
        writeCurrentEpisodeIndex,
        readPlaybackSession,
        writePlaybackSession
    };
})();

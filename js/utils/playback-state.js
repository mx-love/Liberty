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

    const PLAYBACK_METADATA_FIELDS = [
        'title',
        'year',
        'category',
        'type',
        'remarks',
        'director',
        'actors',
        'area',
        'language',
        'sourceCode',
        'sourceName',
        'vodId',
        'mediaUrl'
    ];

    function normalizeIdentityValue(value) {
        return String(value || '').trim();
    }

    function isSamePlaybackContext(session = {}, request = {}) {
        const requestSourceCode = normalizeIdentityValue(request.sourceCode);
        const requestVodId = normalizeIdentityValue(request.vodId);
        const sessionSourceCode = normalizeIdentityValue(session.sourceCode);
        const sessionVodId = normalizeIdentityValue(session.vodId);
        const requestTitle = normalizeIdentityValue(request.title);
        const sessionTitle = normalizeIdentityValue(session.title);
        const requestUrl = normalizeIdentityValue(request.mediaUrl);
        const sessionUrl = normalizeIdentityValue(session.mediaUrl);

        if (requestSourceCode && sessionSourceCode && requestSourceCode !== sessionSourceCode) {
            return false;
        }
        if (requestVodId && sessionVodId && requestVodId !== sessionVodId) {
            return false;
        }
        if (requestTitle && sessionTitle && requestTitle !== sessionTitle) {
            return false;
        }

        // A complete source locator is the strongest playback-session identity.
        if (
            requestSourceCode && requestVodId &&
            requestSourceCode === sessionSourceCode &&
            requestVodId === sessionVodId
        ) {
            return true;
        }

        if (!requestUrl) return false;
        const sessionEpisodeUrls = normalizeEpisodesToUrls(session.episodeEntries || session.episodes);
        const urlBelongsToSession = requestUrl === sessionUrl || sessionEpisodeUrls.includes(requestUrl);

        // URL membership can preserve the same session, but never override an
        // explicit title conflict checked above.
        return urlBelongsToSession && Boolean(requestTitle || sessionTitle || sessionUrl);
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
            mediaUrl: localStorage.getItem('currentMediaUrl') || '',
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
        if (session.mediaUrl !== undefined) {
            localStorage.setItem('currentMediaUrl', String(session.mediaUrl || ''));
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

    function replacePlaybackSession(session = {}) {
        const completeSession = {};
        PLAYBACK_METADATA_FIELDS.forEach((field) => {
            completeSession[field] = session[field] === undefined ? '' : session[field];
        });
        completeSession.episodeIndex = session.episodeIndex === undefined ? 0 : session.episodeIndex;
        completeSession.episodeEntries = session.episodeEntries !== undefined
            ? session.episodeEntries
            : (session.episodes !== undefined ? session.episodes : []);
        return writePlaybackSession(completeSession);
    }

    function beginPlaybackSession(request = {}) {
        const previous = readPlaybackSession();
        const canReuse = isSamePlaybackContext(previous, request);
        const next = canReuse ? { ...previous } : {};

        PLAYBACK_METADATA_FIELDS.forEach((field) => {
            if (request[field] !== undefined) next[field] = request[field];
        });
        if (request.episodeIndex !== undefined) next.episodeIndex = request.episodeIndex;
        if (request.episodeEntries !== undefined) {
            next.episodeEntries = request.episodeEntries;
        } else if (request.episodes !== undefined) {
            next.episodeEntries = request.episodes;
        } else if (!canReuse) {
            // A direct URL is a playable item, but carries no episode identity.
            // Preserve only the locator and never manufacture a label/index.
            next.episodeEntries = request.mediaUrl ? [{ url: String(request.mediaUrl) }] : [];
        }

        return {
            session: replacePlaybackSession(next),
            reused: canReuse
        };
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
        writePlaybackSession,
        replacePlaybackSession,
        beginPlaybackSession,
        isSamePlaybackContext
    };
})();

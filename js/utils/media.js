(function () {
    window.LibertyUtils = window.LibertyUtils || {};

    function getEpisodeUrl(episode) {
        if (!episode) return '';
        if (typeof episode === 'string') return episode;
        return episode.url || '';
    }

    function getEpisodeName(episode, index = 0) {
        if (episode && typeof episode === 'object' && episode.name) {
            return episode.name;
        }
        return `第${index + 1}集`;
    }

    function hasPlayableEpisodes(episodes) {
        return Array.isArray(episodes) && episodes.some((episode) => getEpisodeUrl(episode));
    }

    function normalizeEpisodeUrls(episodes) {
        if (!Array.isArray(episodes)) return [];
        return episodes.map(getEpisodeUrl).filter(Boolean);
    }

    function isHlsUrl(url = '') {
        return String(url || '').toLowerCase().split('?')[0].endsWith('.m3u8');
    }

    function isDirectMediaUrl(url = '') {
        const value = String(url || '').toLowerCase().split('?')[0];
        return value.endsWith('.m3u8') ||
            value.endsWith('.mp4') ||
            value.endsWith('.webm') ||
            value.endsWith('.flv');
    }

    function isLikelyWebPageUrl(url = '') {
        const value = String(url || '').toLowerCase();
        return value.includes('/share/') ||
            value.includes('/play/') ||
            value.includes('/vodplay/') ||
            value.includes('.html');
    }

    function getPlaySourcePriority(source = {}) {
        const name = String(source.name || '').toLowerCase();
        const episodes = Array.isArray(source.episodes) ? source.episodes : [];
        const urls = episodes.map(getEpisodeUrl).filter(Boolean);

        if (!urls.length) return -10000;

        const hasHlsName = name.includes('m3u8') || name.includes('hls');
        const hasHlsUrl = urls.some(isHlsUrl);
        const hasDirectMedia = urls.some(isDirectMediaUrl);
        const hasWebPage = urls.some(isLikelyWebPageUrl);

        let score = 0;
        if (hasHlsUrl) score += 1000;
        if (hasHlsName) score += 500;
        if (hasDirectMedia) score += 100;
        if (hasWebPage) score -= 300;
        score += Math.min(urls.length, 100);

        return score;
    }

    function getPreferredPlaySourceIndex(playSources = []) {
        if (!Array.isArray(playSources) || playSources.length === 0) return 0;

        let bestIndex = -1;
        let bestScore = -Infinity;

        playSources.forEach((source, index) => {
            const score = getPlaySourcePriority(source);
            if (score > bestScore) {
                bestScore = score;
                bestIndex = index;
            }
        });

        if (bestIndex >= 0 && bestScore > -10000) return bestIndex;

        const fallbackIndex = playSources.findIndex((source) =>
            Array.isArray(source.episodes) &&
            source.episodes.some((episode) => getEpisodeUrl(episode))
        );

        return fallbackIndex >= 0 ? fallbackIndex : 0;
    }

    window.LibertyUtils.media = {
        getEpisodeUrl,
        getEpisodeName,
        hasPlayableEpisodes,
        normalizeEpisodeUrls,
        isHlsUrl,
        isDirectMediaUrl,
        isLikelyWebPageUrl,
        getPlaySourcePriority,
        getPreferredPlaySourceIndex
    };
})();

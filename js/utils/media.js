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

    function normalizeShortDramaText(value = '') {
        return String(value || '').toLowerCase().replace(/\s+/g, '');
    }

    function getShortDramaReasons(resource = {}) {
        const title = resource.title || resource.name || resource.vod_name || '';
        const type = resource.type || resource.class || resource.category || resource.type_name || '';
        const remarks = resource.remarks || resource.note || resource.vod_remarks || resource.vod_blurb || '';
        const sourceName = resource.sourceName || resource.source_name || '';
        const episodeCount = Number(resource.episodeCount || resource.episodesCount || resource.totalEpisodes || (
            Array.isArray(resource.episodes) ? resource.episodes.length : 0
        ));
        const duration = Number(resource.duration || resource.vod_duration || 0);

        const fields = [
            ['title', title],
            ['type', type],
            ['remarks', remarks],
            ['sourceName', sourceName],
        ];
        const strongKeywords = [
            '短剧',
            '微短剧',
            '微剧',
            '竖屏',
            '竖版',
            '短视频剧',
            '小剧场',
            '爽文剧',
            'minidrama',
            'shortdrama',
            'verticaldrama',
        ];
        const reasons = [];

        fields.forEach(([field, value]) => {
            const text = normalizeShortDramaText(value);
            if (!text) return;
            strongKeywords.forEach((keyword) => {
                if (text.includes(keyword)) {
                    reasons.push(`${field}:keyword:${keyword}`);
                }
            });
        });

        if (Number.isFinite(episodeCount) && episodeCount >= 60 && reasons.length > 0) {
            reasons.push(`episodeCount:${episodeCount}`);
        }

        if (Number.isFinite(duration) && duration > 0 && duration <= 600 && reasons.length > 0) {
            reasons.push(`duration:${duration}`);
        }

        return [...new Set(reasons)];
    }

    function isShortDramaResource(resource = {}) {
        const reasons = getShortDramaReasons(resource);
        return {
            isShortDrama: reasons.length > 0,
            reasons
        };
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
        getShortDramaReasons,
        isShortDramaResource,
        isHlsUrl,
        isDirectMediaUrl,
        isLikelyWebPageUrl,
        getPlaySourcePriority,
        getPreferredPlaySourceIndex
    };
})();

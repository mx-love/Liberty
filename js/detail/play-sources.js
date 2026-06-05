(function () {
    window.LibertyDetail = window.LibertyDetail || {};

    const mediaUtils = () => window.LibertyUtils?.media || {};

    function defaultEscapeHtml(value) {
        return (value || '')
            .toString()
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function defaultEscapeJsString(value) {
        return (value || '')
            .toString()
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'")
            .replace(/\r?\n/g, ' ');
    }

    function isWebPagePlaySource(source = {}) {
        const getEpisodeUrl = mediaUtils().getEpisodeUrl || ((episode) =>
            typeof episode === 'string' ? episode : (episode && episode.url) || ''
        );
        const isLikelyWebPageUrl = mediaUtils().isLikelyWebPageUrl || ((url = '') => {
            const value = String(url || '').toLowerCase();
            return value.includes('/share/') ||
                value.includes('/play/') ||
                value.includes('/vodplay/') ||
                value.includes('.html');
        });
        const episodes = Array.isArray(source.episodes) ? source.episodes : [];
        return episodes.map(getEpisodeUrl).filter(Boolean).some(isLikelyWebPageUrl);
    }

    function renderPlaySourceButtons(options = {}) {
        const {
            playSources = [],
            currentPlaySourceIndex = 0,
            sourceCode = '',
            vodId = '',
            escapeHtml = defaultEscapeHtml,
            escapeJsString = defaultEscapeJsString
        } = options;

        if (!Array.isArray(playSources) || playSources.length <= 1) return '';

        const getPreferredPlaySourceIndex = mediaUtils().getPreferredPlaySourceIndex || (() => 0);
        const recommendedIndex = getPreferredPlaySourceIndex(playSources);

        return `
        <div class="mb-4">
            <div class="text-sm text-gray-400 mb-2">播放源</div>
            <div class="flex flex-wrap gap-2" id="playSourceButtons">
                ${playSources.map((source, index) => {
                    const active = index === currentPlaySourceIndex;
                    const recommended = index === recommendedIndex;
                    const webPageSource = isWebPagePlaySource(source);
                    const title = webPageSource
                        ? `${source.name} - 网页线路，可能无法直接播放`
                        : source.name;
                    return `
                        <button onclick="switchPlaySource(${index}, '${escapeJsString(sourceCode)}', '${escapeJsString(vodId)}')"
                                class="px-3 py-1.5 rounded text-sm border transition-colors ${active ? 'bg-blue-600 border-blue-500 text-white' : 'bg-[#222] hover:bg-[#333] border-[#333] text-gray-300'}"
                                title="${escapeHtml(title)}">
                            ${escapeHtml(source.name)}
                            ${recommended ? '<span class="ml-1 text-[10px] opacity-80">推荐</span>' : ''}
                            ${webPageSource ? '<span class="ml-1 text-[10px] opacity-70">备用</span>' : ''}
                        </button>
                    `;
                }).join('')}
            </div>
        </div>
    `;
    }

    function getEpisodeSummary(episodes = [], sourceName = '') {
        const count = Array.isArray(episodes) ? episodes.length : 0;
        return sourceName
            ? `当前源共 ${count} 集 · 当前源：${sourceName}`
            : `当前源共 ${count} 集`;
    }

    function updateEpisodeStats(options = {}) {
        const {
            episodes = [],
            sourceName = '',
            statsElementId = 'episodeStats'
        } = options;

        const stats = document.getElementById(statsElementId);
        if (!stats) return;

        stats.textContent = getEpisodeSummary(episodes, sourceName);
    }

    window.LibertyDetail.playSources = {
        isWebPagePlaySource,
        renderPlaySourceButtons,
        getEpisodeSummary,
        updateEpisodeStats
    };
})();

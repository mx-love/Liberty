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
            .replace(/"/g, '\\"')
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/</g, '\\x3C')
            .replace(/>/g, '\\x3E');
    }

    function getOrderedEpisodes(episodes = [], reversed = false) {
        if (!Array.isArray(episodes)) return [];
        return reversed ? [...episodes].reverse() : episodes;
    }

    function getRealEpisodeIndex(index, total, reversed = false) {
        return reversed ? total - 1 - index : index;
    }

    function renderEpisodeButtons(options = {}) {
        const {
            episodes = [],
            episodesReversed = false,
            sourceCode = '',
            vodId = '',
            escapeHtml = defaultEscapeHtml,
            escapeJsString = defaultEscapeJsString
        } = options;

        const getEpisodeName = mediaUtils().getEpisodeName || ((episode, index) => {
            if (episode && typeof episode === 'object' && episode.name) return episode.name;
            return `第${index + 1}集`;
        });

        const orderedEpisodes = getOrderedEpisodes(episodes, episodesReversed);
        return orderedEpisodes.map((episode, index) => {
            const realIndex = getRealEpisodeIndex(index, episodes.length, episodesReversed);
            const episodeName = getEpisodeName(episode, realIndex);
            return `
            <button id="episode-${realIndex}" onclick="playEpisode(${realIndex}, '${escapeJsString(sourceCode)}', '${escapeJsString(vodId)}')"
                    class="px-3 py-2 bg-[#222] hover:bg-[#333] border border-[#333] rounded-lg transition-colors text-center episode-btn truncate"
                    title="${escapeHtml(episodeName)}">
                ${escapeHtml(episodeName)}
            </button>
        `;
        }).join('');
    }

    function getCopyLinkText(episodes = [], reversed = false) {
        const getEpisodeUrl = mediaUtils().getEpisodeUrl || ((episode) =>
            typeof episode === 'string' ? episode : (episode && episode.url) || ''
        );
        return getOrderedEpisodes(episodes, reversed)
            .map(getEpisodeUrl)
            .filter(Boolean)
            .join('\r\n');
    }

    function updateOrderToggleButton(sourceCode, vodId, reversed = false) {
        const toggleBtn = document.querySelector(`button[onclick="toggleEpisodeOrder('${defaultEscapeJsString(sourceCode)}', '${defaultEscapeJsString(vodId)}')"]`);
        if (!toggleBtn) return;

        const label = toggleBtn.querySelector('span');
        if (label) {
            label.textContent = reversed ? '正序排列' : '倒序排列';
        }

        const arrowIcon = toggleBtn.querySelector('svg');
        if (arrowIcon) {
            arrowIcon.style.transform = reversed ? 'rotate(180deg)' : 'rotate(0deg)';
        }
    }

    window.LibertyDetail.episodes = {
        getOrderedEpisodes,
        getRealEpisodeIndex,
        renderEpisodeButtons,
        getCopyLinkText,
        updateOrderToggleButton
    };
})();

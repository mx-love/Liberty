(function () {
    window.LibertyDetail = window.LibertyDetail || {};

    function defaultEscapeHtml(value) {
        return (value || '')
            .toString()
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function renderEpisodeActions(options = {}) {
        const {
            sourceCode = '',
            vodId = '',
            episodes = [],
            episodesReversed = false,
            sourceName = '',
            escapeHtml = defaultEscapeHtml
        } = options;

        const summary = window.LibertyDetail?.playSources?.getEpisodeSummary
            ? window.LibertyDetail.playSources.getEpisodeSummary(episodes, sourceName)
            : `当前源共 ${Array.isArray(episodes) ? episodes.length : 0} 集${sourceName ? ` · 当前源：${sourceName}` : ''}`;

        return `
                <div class="detail-episode-actions flex flex-wrap items-center justify-between mb-4 gap-2">
                    <div class="episode-toolbar flex items-center gap-2">
                        <button onclick="toggleEpisodeOrder('${sourceCode}', '${vodId}')" 
                                class="px-3 py-1.5 bg-[#333] hover:bg-[#444] border border-[#444] rounded text-sm transition-colors flex items-center gap-1">
                            <svg class="w-4 h-4 transform ${episodesReversed ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3"></path>
                            </svg>
                            <span>${episodesReversed ? '正序排列' : '倒序排列'}</span>
                        </button>
                        <span id="episodeStats" class="episode-summary text-gray-400 text-sm">${escapeHtml(summary)}</span>
                    </div>
                    <button onclick="copyLinks()" class="detail-copy-links px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm transition-colors">
                        复制链接
                    </button>
                </div>
    `;
    }

    window.LibertyDetail.modal = {
        renderEpisodeActions
    };
})();

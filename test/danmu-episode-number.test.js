import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

// Execute the production functions, not a separate copy of the matching rules.
const source = readFileSync(new URL('../js/player.js', import.meta.url), 'utf8');
function productionFunction(name) {
    const match = new RegExp(`^(?:async )?function ${name}\\(`, 'm').exec(source);
    assert.ok(match, `production function ${name} exists`);
    return source.slice(match.index, source.indexOf('\n}', match.index) + 2);
}
const functions = [
    'advancedCleanTitle', 'romanToInt', 'normalizeDanmuTitle', 'getDanmuSearchKeyword',
    'getCurrentEpisodeName', 'guessEpisodeNumber', 'guessSeasonNumber', 'inferDanmuPlatform',
    'buildDanmuKeyword', 'buildDanmuMatchQueries', 'buildDanmuVideoKey', 'getDanmuPlaybackContext',
    'normalizeDanmuTitleNumberText', 'chineseEpisodeNumberToInt', 'isBadEpisodeNumber',
    'extractEpisodeNumberFromDanmuTitle', 'pickValidDanmuApiMatch', 'matchDanmuByApi',
    'getDanmuTypeCategory', 'rankDanmuSourceCandidates',
    'findBestEpisodeMatch', 'pickMatchedDanmuEpisode', 'loadDanmakuFromAnimeCandidate',
    'autoFallbackDanmakuBySearchCandidate', 'getDanmukuForVideo', 'switchDanmuSource',
];
function harness(labels = ['第11集', '第12集', '第13集'], index = 1) {
    const requests = []; const comments = []; const applied = []; const logs = [];
    const episodes = [11, 12, 13].map(n => ({ episodeId: n, episodeTitle: `第${n}集` }));
    const noop = () => {};
    const context = vm.createContext({
        URLSearchParams, Date, console: { log: noop, warn: noop, error: (...args) => logs.push(args) },
        window: { location: { search: '' } }, localStorage: { getItem: () => null },
        document: { getElementById: () => ({ classList: { add: noop } }) },
        currentVideoTitle: '集数验证', currentVideoUrl: 'https://example.test/video.m3u8',
        currentEpisodes: labels.map(name => ({ name })), currentEpisodeIndex: index,
        currentDanmuCache: { episodeIndex: -1 }, currentDanmuAnimeId: null,
        currentDanmuSourceName: '', currentSessionDanmuSource: null, _danmuFetchController: null,
        lastDanmuFetchStats: null, lastDanmuAutoFallbackStats: null, videoPlayer: null,
        DANMU_CONFIG: { adaptive: { enableMatchApi: true }, cacheExpiration: { danmuCache: 60000 } },
        DANMU_AUTO_FALLBACK_MAX_COMMENT_REQUESTS: 2,
        art: { video: { paused: true, ended: false, currentTime: 0 }, plugins: { artplayerPluginDanmuku: {} } },
        getCurrentVideoDuration: () => 1200, getCurrentVideoYearValue: () => '',
        getVideoIdentity: title => ({ title }),
        isDanmuServiceEnabled: () => true, getDanmuBaseUrl: () => '/danmu', addDanmuAuth: async url => url,
        danmuDebugLog: noop, danmuDebugWarn: noop, updateLastDanmuMatchInfo: noop,
        logDanmuEpisodeSummary: noop, logDanmuVisibilityState: noop, showToast: noop,
        clearCurrentDanmukuPlugin: async () => {}, limitDanmakuList: x => x,
        applyDanmakuRuntimeState: async state => applied.push(state),
        parseDanmuCandidateTitle: title => ({ normalizedCoreTitle: title }),
        normalizeDanmuCoreTitle: title => title,
        normalizeDanmuYear: year => year || '', getDanmuTitleCloseness: () => ({ close: true, mode: 'exact', similarity: 1, titleScore: 60 }),
        getAnimeEpisodesWithCache: async () => episodes,
        fetchDanmaku: async episodeId => { comments.push(episodeId); return [{ text: `episode ${episodeId}` }]; },
        searchDanmuAnimeCandidatesWithCache: async () => [],
        rankDanmuSourceCandidates: candidates => candidates,
        getDanmuCandidateRejectReason: (_context, _candidate, list, matched) => list && !matched ? 'episode_missing' : '',
        calculateDanmuVerifiedScore: () => 100,
        reportError: (...args) => logs.push(args),
    });
    context.fetchWithRetry = async (_url, options) => {
        const body = JSON.parse(options.body); requests.push(body);
        const episode = context.responseEpisode ?? body.episode;
        return { json: async () => ({ isMatched: true, matches: [{ animeId: 100, animeTitle: '集数验证', episodeId: episode, episodeTitle: `第${episode}集` }] }) };
    };
    vm.runInContext(functions.map(productionFunction).join('\n'), context);
    return { context, requests, comments, applied, logs, episodes };
}

for (const [index, label, expected] of [[0, '第1集', 1], [1, '第2集', 2], [1, '第12集', 12]]) {
    test(`automatic production chain: index ${index}, ${label} -> comment ${expected}`, async () => {
        const h = harness(['第11集', label, '第13集'], index);
        h.context.currentEpisodes[index].name = label;
        const context = h.context.getDanmuPlaybackContext('集数验证', index);
        assert.equal(context.episodeIndex, index); assert.equal(context.episodeName, label); assert.equal(context.episode, expected);
        const result = await h.context.getDanmukuForVideo('集数验证', index);
        assert.equal(result.length, 1); assert.deepEqual(h.comments, [expected]);
        assert.equal(h.requests[0].fileName, `集数验证 第${expected}集`);
        assert.equal(h.requests[0].episode, expected); assert.deepEqual(h.logs, []);
    });
}

test('index 1 / 第12集 accepts API E12 but rejects API E02 through production match caller', async () => {
    const h = harness(); h.context.responseEpisode = 12;
    assert.equal((await h.context.matchDanmuByApi('集数验证', 1)).episodeId, 12);
    h.context.responseEpisode = 2;
    assert.equal(await h.context.matchDanmuByApi('集数验证', 1), null);
    await h.context.getDanmukuForVideo('集数验证', 1);
    assert.deepEqual(h.comments, []);
    assert.ok(h.requests.every(body => body.episode === 12 && !body.fileName.includes('E02')));
});

test('manual production chain selects 第12集 among episodes 11/12/13', async () => {
    const h = harness(); await h.context.switchDanmuSource(100, encodeURIComponent('集数验证'));
    assert.deepEqual(h.comments, [12]); assert.equal(h.requests.length, 0);
    assert.equal(h.applied.length, 1); assert.equal(h.context.currentSessionDanmuSource.selectedBy, 'manual');
    assert.deepEqual(h.logs, []);
});

test('manual session maps index 2 to E13 and index 1 back to E12', async () => {
    const h = harness(); await h.context.switchDanmuSource(100, encodeURIComponent('集数验证'));
    await h.context.getDanmukuForVideo('集数验证', 2);
    await h.context.getDanmukuForVideo('集数验证', 1);
    assert.deepEqual(h.comments, [12, 13, 12]); assert.equal(h.requests.length, 0);
    assert.deepEqual(h.logs, []);
});

test('automatic search fallback uses the same real episode mapping without changing probing', async () => {
    const h = harness(); h.context.responseEpisode = 2;
    h.context.searchDanmuAnimeCandidatesWithCache = async () => [{ animeId: 100, animeTitle: '集数验证', score: 100 }];
    const result = await h.context.getDanmukuForVideo('集数验证', 1);
    assert.equal(result.length, 1); assert.deepEqual(h.comments, [12]);
    assert.equal(h.context.currentSessionDanmuSource.selectedBy, 'auto-fallback');
    assert.equal(h.context.lastDanmuAutoFallbackStats.triedCommentCount, 1); assert.deepEqual(h.logs, []);
});

test('candidate ranking checks coverage against episode 12 rather than playlist position 2', () => {
    const h = harness();
    const ranked = h.context.rankDanmuSourceCandidates([
        { animeId: 2, animeTitle: '集数验证', episodeCount: 2, typeDescription: 'TV' },
        { animeId: 13, animeTitle: '集数验证', episodeCount: 13, typeDescription: 'TV' },
    ], '集数验证', { title: '集数验证', normalizedTitle: '集数验证', episodeCount: 3 });
    assert.equal(ranked[0].animeId, 13);
    assert.ok(ranked[0].score > ranked[1].score);
});

test('unknown season never invents S01; explicit season retains season and year candidates', () => {
    const h = harness(); const context = h.context.getDanmuPlaybackContext('集数验证 年番', 1);
    assert.equal(context.season, null);
    assert.equal(h.context.buildDanmuKeyword(context), '集数验证 年番 第12集');
    assert.ok(h.context.buildDanmuMatchQueries(context).every(query => !query.includes('S01')));
    const explicit = { ...context, title: '集数验证', year: '2025', season: 2 };
    assert.equal(h.context.buildDanmuMatchQueries(explicit)[0], '集数验证 2025 S02E12');
    assert.ok(h.context.buildDanmuMatchQueries(explicit).includes('集数验证 第12集'));
});

test('unrecognized label falls back to index + 1 in context and all matching uses that episode', async () => {
    const h = harness(['待更新', '待更新'], 1);
    assert.equal(h.context.getDanmuPlaybackContext('集数验证', 1).episode, 2);
    await h.context.getDanmukuForVideo('集数验证', 1);
    assert.deepEqual(h.comments, [2]);
});

test('unnumbered API episode fallback uses real episode order, not the playback array index', () => {
    const h = harness(); const unnamed = Array.from({ length: 13 }, (_, i) => ({ episodeId: i + 1, episodeTitle: '未标集数' }));
    assert.equal(h.context.pickMatchedDanmuEpisode(unnamed, 1, '集数验证').episodeId, 12);
    assert.equal(h.context.pickMatchedDanmuEpisode(unnamed.slice(0, 3), 1, '集数验证'), null);
});

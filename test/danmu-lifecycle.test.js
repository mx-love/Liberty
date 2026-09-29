import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../js/player.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function extract(name) {
    const start = source.indexOf(`async function ${name}(`);
    assert.ok(start >= 0);
    return source.slice(start, source.indexOf('\n}', start) + 2);
}
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }

test('danmu diagnostics preserve episodeIndex 1 separately from episodeNumber 12', () => {
    const context = vm.createContext({
        currentVideoTitle: 'Test', currentVideoUrl: '/video', currentEpisodeIndex: 1,
        currentEpisodes: ['第1集', '第12集'], lastDanmuMatchInfo: null,
        getCurrentVideoYearValue: () => '2026', getCurrentEpisodeName: () => '第12集',
        getVideoIdentity: () => ({}),
        getDanmuPlaybackContext: () => ({ episodeNumber: 12, episodeSource: 'explicit_episode_label', episodeConfidence: 'high' }),
    });
    const start = source.indexOf('function updateLastDanmuMatchInfo(');
    vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), context);
    const result = context.updateLastDanmuMatchInfo();
    assert.equal(result.episodeIndex, 1);
    assert.equal(result.episodeNumber, 12);
    assert.equal(result.currentEpisodeName, '第12集');
    assert.equal('displayEpisode' in result, false);
    assert.doesNotMatch(source, /(?:displayEpisode|targetEpisode|matchedEpisode):\s*\w+\s*\+\s*1/);
});

for (const stage of ['match', 'comments', 'episodes']) {
    test(`late automatic ${stage} response cannot overwrite new episode source`, async () => {
        const pending = deferred(); const entered = deferred();
        const result = ep => ({ animeId: ep + 100, animeTitle: 'Test', episodeId: ep + 1, confidence: 'high' });
        const context = vm.createContext({
            console, Date, window: {},
            currentVideoTitle: 'Test', currentVideoUrl: '/video', currentEpisodeIndex: 0,
            currentDanmuCache: { episodeIndex: -1 }, danmuReloadToken: 0, _danmuFetchController: null,
            currentSessionDanmuSource: null, currentDanmuAnimeId: null, currentDanmuSourceName: '',
            DANMU_CONFIG: { cacheExpiration: { danmuCache: 10000 } },
            isDanmuServiceEnabled: () => true, danmuDebugLog() {}, danmuDebugWarn() {},
            updateLastDanmuMatchInfo() {}, getDanmuSearchKeyword: x => x,
            buildDanmuKeyword: () => '', buildDanmuMatchQueries: () => [],
            getDanmuPlaybackContext: (title, episodeIndex) => ({ videoKey: `${title}:${episodeIndex}`, episodeNumber: episodeIndex + 1 }),
            validateCurrentDanmuSessionSource: () => ({ compatible: false }),
            createDanmuSessionSource: x => x,
            matchDanmuByApi: async (_title, ep) => {
                if (ep === 0 && stage === 'match') { entered.resolve(); await pending.promise; } return result(ep);
            },
            fetchDanmaku: async (_id, ep) => {
                if (ep === 0 && stage === 'comments') { entered.resolve(); await pending.promise; } return [{ text: `episode${ep}` }];
            },
            getAnimeEpisodesWithCache: async id => {
                if (id === 100 && stage === 'episodes') { entered.resolve(); await pending.promise; } return [{ episodeId: id }];
            },
        });
        vm.runInContext(extract('getDanmukuForVideo'), context);
        const old = context.getDanmukuForVideo('Test', 0); await entered.promise;
        context.currentEpisodeIndex = 1;
        const latest = await context.getDanmukuForVideo('Test', 1);
        assert.equal(latest[0].text, 'episode1');
        pending.resolve();
        assert.equal((await old).length, 0);
        assert.equal(context.currentDanmuAnimeId, 101);
        assert.equal(context.currentSessionDanmuSource.animeId, 101);
    });
}

test('late manual source metadata cannot change source, seek or resume a new episode', async () => {
    const pending = deferred(); const entered = deferred(); const actions = [];
    const context = vm.createContext({
        console, Date, decodeURIComponent, setTimeout: fn => { actions.push('timer'); fn(); },
        art: { plugins: { artplayerPluginDanmuku: {} }, video: { paused: false, ended: false, currentTime: 120 } },
        currentVideoTitle: 'Test', currentEpisodeIndex: 0, danmuReloadToken: 0, _danmuFetchController: null,
        currentDanmuAnimeId: null, currentDanmuSourceName: '', currentSessionDanmuSource: null, currentDanmuCache: {}, videoPlayer: null,
        document: { getElementById: () => ({ classList: { add() {} } }) },
        showToast() {}, danmuDebugLog() {}, danmuDebugWarn() {}, clearCurrentDanmukuPlugin: async () => {},
        getDanmuSearchKeyword: x => x, buildDanmuKeyword: () => '',
        getDanmuPlaybackContext: (title, ep) => ({ videoKey: `${title}:${ep}`, episodeNumber: ep + 1 }),
        parseDanmuCandidateTitle: () => ({}), normalizeDanmuYear: () => '', getCurrentVideoYearValue: () => '',
        getDanmuTitleCloseness: () => ({ close: true }),
        getAnimeEpisodesWithCache: async () => { entered.resolve(); return pending.promise; },
    });
    vm.runInContext(extract('switchDanmuSource'), context);
    const old = context.switchDanmuSource(100, 'Test'); await entered.promise;
    context.currentEpisodeIndex = 1; context.currentDanmuAnimeId = 200;
    context.currentSessionDanmuSource = { animeId: 200 };
    context.art.video.currentTime = 0;
    pending.resolve([{ episodeId: 1 }]); await old;
    assert.equal(context.currentDanmuAnimeId, 200);
    assert.equal(context.currentSessionDanmuSource.animeId, 200);
    assert.equal(context.art.video.currentTime, 0);
    assert.equal(actions.length, 0);
});

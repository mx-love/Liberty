import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

import { build } from 'esbuild';

const apiSource = readFileSync(new URL('../js/api.js', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const playerSource = readFileSync(new URL('../js/player.js', import.meta.url), 'utf8');
const uiSource = readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');
const playbackStateSource = readFileSync(
    new URL('../js/utils/playback-state.js', import.meta.url),
    'utf8'
);
const sourceMetadataFixture = JSON.parse(readFileSync(
    new URL('./fixtures/integration/source-provided-episode-metadata.json', import.meta.url),
    'utf8'
));

const adapterEntry = fileURLToPath(new URL(
    '../src/core/danmaku/danmu-playback-adapter.ts',
    import.meta.url
));
const buildResult = await build({
    entryPoints: [adapterEntry],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    write: false
});
const adapterModule = await import(
    `data:text/javascript;base64,${Buffer.from(buildResult.outputFiles[0].contents).toString('base64')}`
);
const { createDanmakuPlaybackContext } = adapterModule;

function sourceBetween(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
    assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
    return source.slice(start, end);
}

function loadApiMetadataBoundary() {
    const source = sourceBetween(
        apiSource,
        'function isPlayableUrl(',
        '\nfunction joinUrlPath('
    );
    const context = {
        M3U8_PATTERN: /\$https?:\/\/[^"'\s]+?\.m3u8/g,
        API_SITES: {
            fixture: { name: 'Fixture Source' }
        },
        window: { LibertyUtils: {} }
    };
    vm.runInNewContext(`${source}\n;globalThis.boundary = {\n` +
        'parseEpisodeEntry, parseVodPlaySources, buildSinglePlaySourceFromUrls, parseHtmlPlaySources, buildDetailPayload\n' +
        '};', context, { filename: 'js/api.js#metadata-boundary' });
    return context.boundary;
}

function loadAppEpisodeBoundary() {
    const source = sourceBetween(
        appSource,
        'function normalizeEpisodeList(',
        '\nfunction hasPlayableEpisodes('
    );
    const context = {};
    vm.runInNewContext(`${source}\n;globalThis.boundary = { normalizeEpisodeList, normalizePlaySources };`, context, {
        filename: 'js/app.js#episode-metadata-boundary'
    });
    return context.boundary;
}

function loadPlayerProductionBoundary(localStorage, playbackState) {
    const urlHelper = sourceBetween(
        playerSource,
        'function getPlayerEpisodeUrlValue(',
        '// 弹幕缓存'
    );
    const observer = sourceBetween(
        playerSource,
        'function getObservedDanmuEpisodes(',
        '\nfunction createProductionDanmakuContext('
    );
    const contextBuilder = sourceBetween(
        playerSource,
        'function createProductionDanmakuContext(',
        '\nfunction getDanmuCoreCacheKey('
    );
    const context = {
        localStorage,
        URLSearchParams,
        __createDanmakuPlaybackContext: createDanmakuPlaybackContext,
        window: {
            LibertyUtils: { playbackState },
            location: { search: '?source=subo&id=8199' }
        }
    };
    vm.runInNewContext(`
        let currentEpisodes = [];
        let currentEpisodeEntries = [];
        let currentVideoTitle = '';
        function getDanmuCoreRuntime() {
            return {
                core: {
                    createDanmakuPlaybackContext: globalThis.__createDanmakuPlaybackContext
                }
            };
        }
        function getDanmuPlaybackSession() {
            return window.LibertyUtils.playbackState.readPlaybackSession();
        }
        ${urlHelper}
        ${observer}
        ${contextBuilder}
        globalThis.run = (title, episodeIndex) => {
            const session = getDanmuPlaybackSession();
            currentEpisodes = Array.from(session.episodes || []);
            currentEpisodeEntries = Array.from(session.episodeEntries || []);
            currentVideoTitle = title;
            return {
                observed: getObservedDanmuEpisodes(),
                context: createProductionDanmakuContext(title, episodeIndex)
            };
        };
    `, context, { filename: 'js/player.js#production-danmaku-context' });
    return context.run;
}

function createStorage(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
        getItem(key) {
            return values.has(key) ? values.get(key) : null;
        },
        setItem(key, value) {
            values.set(key, String(value));
        },
        removeItem(key) {
            values.delete(key);
        }
    };
}

function runAppPlayback({
    localStorage,
    playbackState,
    episodes,
    title,
    year,
    sourceKey,
    vodId,
    episodeIndex,
    metadata = {}
}) {
    const source = sourceBetween(
        appSource,
        'function playVideo(',
        '\nfunction showVideoPlayer('
    );
    const context = {
        localStorage,
        window: {
            LibertyUtils: { playbackState },
            location: { href: 'https://liberty.example/' }
        },
        __episodes: episodes,
        __title: title,
        __year: year,
        __sourceKey: sourceKey,
        __vodId: vodId,
        __episodeIndex: episodeIndex,
        __metadata: metadata
    };
    vm.runInNewContext(`
        let currentVideoYear = globalThis.__year;
        let currentVideoMetadata = {
            category: globalThis.__metadata.category || '电视剧',
            type: globalThis.__metadata.type || '电视剧',
            remarks: globalThis.__metadata.remarks || '',
            director: globalThis.__metadata.director || '',
            actors: globalThis.__metadata.actors || '',
            area: globalThis.__metadata.area || '',
            language: globalThis.__metadata.language || '',
            sourceName: globalThis.__metadata.sourceName || globalThis.__sourceKey
        };
        let currentEpisodes = globalThis.__episodes;
        function getEpisodeUrl(episode) {
            return typeof episode === 'string' ? episode : episode?.url || '';
        }
        function getCurrentEpisodeUrls() {
            return currentEpisodes.map(getEpisodeUrl).filter(Boolean);
        }
        ${source}
        globalThis.run = () => playVideo(
            currentEpisodes[globalThis.__episodeIndex],
            globalThis.__title,
            globalThis.__sourceKey,
            globalThis.__episodeIndex,
            globalThis.__vodId
        );
    `, context, { filename: 'js/app.js#playVideo' });
    context.run();
    return context.window.location.href;
}

function loadPlaybackState(localStorage = createStorage()) {
    const context = {
        localStorage,
        window: {
            LibertyUtils: {
                media: {
                    getEpisodeUrl(episode) {
                        if (!episode) return '';
                        return typeof episode === 'string' ? episode : episode.url || '';
                    }
                }
            }
        }
    };
    vm.runInNewContext(playbackStateSource, context, {
        filename: 'js/utils/playback-state.js'
    });
    return context.window.LibertyUtils.playbackState;
}

function jsonValue(value) {
    return JSON.parse(JSON.stringify(value));
}

function runProductionMetadataPipeline(entries, currentEpisodeIndex, options = {}) {
    const localStorage = createStorage();
    const playbackState = loadPlaybackState(localStorage);
    const title = options.title || '边界测试剧';
    const year = options.year || '';
    const sourceKey = options.sourceKey || 'metadata-fixture';
    const vodId = options.vodId || 'metadata-vod';
    const navigationUrl = runAppPlayback({
        localStorage,
        playbackState,
        episodes: entries,
        title,
        year,
        sourceKey,
        vodId,
        episodeIndex: currentEpisodeIndex,
        metadata: options.metadata || {}
    });
    const session = playbackState.readPlaybackSession();
    const playerResult = loadPlayerProductionBoundary(localStorage, playbackState)(
        title,
        currentEpisodeIndex
    );
    return {
        localStorage,
        navigationUrl,
        session,
        observed: jsonValue(playerResult.observed),
        context: playerResult.context
    };
}

function runProductionHistorySave(entries, episodeIndex = 0, metadata = {}) {
    const playbackSession = {
        title: metadata.title || 'Example Series 4',
        year: metadata.year || '',
        category: metadata.category || '',
        type: metadata.type || '',
        remarks: metadata.remarks || '',
        director: metadata.director || '',
        actors: metadata.actors || '',
        area: metadata.area || '',
        language: metadata.language || '',
        sourceName: metadata.sourceName || 'fixture-source',
        sourceCode: metadata.sourceCode || 'fixture-source',
        vodId: metadata.vodId || 'fixture-vod'
    };
    const localStorage = createStorage({
        currentVideoYear: playbackSession.year,
        currentVideoCategory: playbackSession.category,
        currentVideoType: playbackSession.type,
        currentVideoRemarks: playbackSession.remarks,
        currentVideoDirector: playbackSession.director,
        currentVideoActors: playbackSession.actors,
        currentVideoArea: playbackSession.area,
        currentVideoLanguage: playbackSession.language
    });
    const urlHelper = sourceBetween(
        playerSource,
        'function getPlayerEpisodeUrlValue(',
        '// 弹幕缓存'
    );
    const historySource = sourceBetween(
        playerSource,
        'function saveToHistory(',
        '\n// ===== 【结束】优化历史记录保存 ====='
    );
    const context = {
        localStorage,
        URLSearchParams,
        Storage: function Storage() {},
        clearTimeout,
        setTimeout,
        console,
        __entries: entries,
        __episodeIndex: episodeIndex,
        __playbackSession: playbackSession,
        window: {
            location: {
                search: `?source=${encodeURIComponent(playbackSession.sourceCode)}&id=${encodeURIComponent(playbackSession.vodId)}${metadata.urlYear ? `&year=${encodeURIComponent(metadata.urlYear)}` : ''}`
            },
            LibertyUtils: {
                playbackState: {
                    readPlaybackSession: () => playbackSession
                }
            },
            LibertyDebug: { log() {} }
        }
    };
    vm.runInNewContext(`
        let saveHistoryTimer = null;
        let lastHistorySaveTime = 0;
        let lastSavedPosition = 0;
        let currentEpisodeEntries = globalThis.__entries;
        let currentEpisodes = currentEpisodeEntries.map(entry => entry.url);
        let currentEpisodeIndex = globalThis.__episodeIndex;
        let currentVideoTitle = globalThis.__playbackSession.title;
        let currentVideoUrl = currentEpisodes[currentEpisodeIndex];
        let art = { video: { currentTime: 120, duration: 2700 } };
        ${urlHelper}
        ${historySource}
        globalThis.run = () => saveToHistory(true);
    `, context, { filename: 'js/player.js#saveToHistory' });
    assert.equal(context.run(), true);
    return {
        localStorage,
        history: JSON.parse(localStorage.getItem('viewingHistory') || '[]')
    };
}

async function runProductionHistoryReplay({
    historyItem,
    detailPayload,
    detailStatus = 200,
    initialStorage = {}
}) {
    const localStorage = createStorage({
        ...initialStorage,
        viewingHistory: JSON.stringify([historyItem])
    });
    const playbackState = loadPlaybackState(localStorage);
    const source = sourceBetween(
        uiSource,
        'async function playFromHistory(',
        '\n// 添加观看历史'
    );
    const fetchUrls = [];
    const context = {
        AbortController,
        URL,
        URLSearchParams,
        clearTimeout,
        console,
        encodeURIComponent,
        fetch: async (requestUrl) => {
            fetchUrls.push(String(requestUrl));
            return {
                ok: detailStatus >= 200 && detailStatus < 300,
                status: detailStatus,
                async json() {
                    return detailPayload;
                }
            };
        },
        localStorage,
        setTimeout,
        window: {
            LibertyUtils: {
                playbackState,
                media: {
                    normalizeEpisodeUrls(episodes) {
                        return episodes.map(entry => (
                            typeof entry === 'string' ? entry : entry?.url || ''
                        )).filter(Boolean);
                    }
                }
            },
            location: {
                href: 'https://liberty.example/',
                origin: 'https://liberty.example',
                pathname: '/',
                search: ''
            }
        }
    };
    vm.runInNewContext(`
        let openedPlayerUrl = '';
        function showToast() {}
        function showVideoPlayer(url) { openedPlayerUrl = url; }
        ${source}
        globalThis.run = (...args) => playFromHistory(...args);
        globalThis.openedUrl = () => openedPlayerUrl;
    `, context, { filename: 'js/ui.js#playFromHistory' });
    await context.run(
        historyItem.url,
        historyItem.title,
        historyItem.episodeIndex,
        historyItem.playbackPosition || 0
    );
    return {
        localStorage,
        playbackState,
        fetchUrls,
        openedUrl: context.openedUrl(),
        history: JSON.parse(localStorage.getItem('viewingHistory') || '[]')
    };
}

const api = loadApiMetadataBoundary();
const { normalizeEpisodeList, normalizePlaySources } = loadAppEpisodeBoundary();

test('AppleCMS explicit source episode names survive every metadata boundary', () => {
    const url = 'https://media.example.test/episode-12.m3u8';
    const groups = api.parseVodPlaySources('m3u8', `第12集$${url}`);
    const apiEpisode = jsonValue(groups[0].episodes[0]);

    assert.deepEqual(apiEpisode, {
        rawIndex: 0,
        rawEpisodeName: '第12集',
        displayEpisodeName: '第12集',
        episodeNameSource: 'source',
        name: '第12集',
        url,
        rawEntry: `第12集$${url}`,
        playGroup: 'm3u8',
        playGroupIndex: 0
    });

    const normalized = jsonValue(normalizeEpisodeList([apiEpisode]));
    assert.deepEqual(normalized[0], apiEpisode);

    const { session, observed, context } = runProductionMetadataPipeline(normalized, 0);
    assert.equal(session.episodeEntries[0].rawEpisodeName, '第12集');
    assert.equal(session.episodeEntries[0].rawEntry, `第12集$${url}`);
    assert.equal(observed[0].name, '第12集');
    assert.equal(observed[0].episodeNameSource, 'source');
    assert.equal(observed[0].playGroup, 'm3u8');
    assert.equal(observed[0].rawEntry, `第12集$${url}`);
    assert.equal(context.state, 'ready');
    assert.equal(context.episode?.episodeNumber, 12);
    assert.equal(context.sourceEpisode?.mappingState, 'mapped');
});

test('real-shaped dual AppleCMS groups keep source episode evidence at raw indexes 0, 1 and 9', () => {
    const apiGroups = jsonValue(api.parseVodPlaySources(
        sourceMetadataFixture.vod_play_from,
        sourceMetadataFixture.vod_play_url
    ));
    const appGroups = jsonValue(normalizePlaySources(apiGroups, []));
    const expected = [
        [0, '第01集', 1],
        [1, '第02集', 2],
        [9, '第10集完结', 10]
    ];

    assert.equal(appGroups.length, 2);
    assert.deepEqual(appGroups.map(group => group.name), ['subm3u8', 'subyun']);

    for (const [groupIndex, group] of appGroups.entries()) {
        assert.equal(group.rawIndex, groupIndex);
        assert.equal(group.episodes.length, 10);

        for (const [rawIndex, rawEpisodeName, episodeNumber] of expected) {
            const episode = group.episodes[rawIndex];
            assert.equal(episode.rawIndex, rawIndex);
            assert.equal(episode.rawEpisodeName, rawEpisodeName);
            assert.equal(episode.episodeNameSource, 'source');
            assert.equal(episode.playGroup, group.name);
            assert.equal(episode.playGroupIndex, groupIndex);

            const { navigationUrl, session, observed, context } = runProductionMetadataPipeline(
                group.episodes,
                rawIndex,
                {
                    title: sourceMetadataFixture.title,
                    year: sourceMetadataFixture.year,
                    sourceKey: sourceMetadataFixture.sourceKey,
                    vodId: sourceMetadataFixture.vodId
                }
            );
            assert.match(navigationUrl, new RegExp(`index=${rawIndex}(?:&|$)`, 'u'));
            assert.equal(session.episodeEntries[rawIndex].rawEpisodeName, rawEpisodeName);
            assert.equal(session.episodeEntries[rawIndex].episodeNameSource, 'source');
            assert.equal(session.episodeEntries[rawIndex].playGroup, group.name);
            assert.equal(observed[rawIndex].name, rawEpisodeName);
            assert.equal(observed[rawIndex].episodeNameSource, 'source');
            assert.equal(context.state, 'ready');
            assert.equal(context.sourceEpisode?.rawIndex, rawIndex);
            assert.equal(context.sourceEpisode?.rawEpisodeName, rawEpisodeName);
            assert.equal(context.sourceEpisode?.playGroup, group.name);
            assert.equal(context.sourceEpisode?.parsedEpisodeInfo.episodeNumber, episodeNumber);
            assert.equal(context.episode?.episodeNumber, episodeNumber);
            assert.equal(context.episode?.identityState, 'supported');
        }
    }
});

test('history save and replay retain the selected play group and source-provided episode names', async () => {
    const apiGroups = jsonValue(api.parseVodPlaySources(
        sourceMetadataFixture.vod_play_from,
        sourceMetadataFixture.vod_play_url
    ));
    const appGroups = jsonValue(normalizePlaySources(apiGroups, []));
    const selectedEpisodes = appGroups[1].episodes;
    const saved = runProductionHistorySave(selectedEpisodes, 0);
    const historyItem = saved.history[0];

    assert.equal(historyItem.episodes[0], selectedEpisodes[0].url);
    assert.equal(historyItem.episodeEntries[0].rawEpisodeName, '第01集');
    assert.equal(historyItem.episodeEntries[0].episodeNameSource, 'source');
    assert.equal(historyItem.episodeEntries[0].playGroup, 'subyun');
    assert.equal(historyItem.episodeEntries[0].playGroupIndex, 1);

    const replayed = await runProductionHistoryReplay({
        historyItem,
        detailPayload: {
            // The API-preferred group is deliberately different from the saved
            // group. History replay must keep the saved group binding.
            episodes: apiGroups[0].episodes,
            playSources: apiGroups
        }
    });
    const session = replayed.playbackState.readPlaybackSession();
    const replayedHistoryItem = replayed.history[0];
    const playerResult = loadPlayerProductionBoundary(
        replayed.localStorage,
        replayed.playbackState
    )(sourceMetadataFixture.title, 0);

    assert.equal(session.episodes[0], selectedEpisodes[0].url);
    assert.equal(session.episodeEntries[0].rawEpisodeName, '第01集');
    assert.equal(session.episodeEntries[0].episodeNameSource, 'source');
    assert.equal(session.episodeEntries[0].playGroup, 'subyun');
    assert.equal(session.episodeEntries[0].playGroupIndex, 1);
    assert.equal(replayedHistoryItem.episodes[0], selectedEpisodes[0].url);
    assert.equal(replayedHistoryItem.episodeEntries[0].rawEpisodeName, '第01集');
    assert.equal(replayedHistoryItem.episodeEntries[0].playGroup, 'subyun');
    assert.equal(playerResult.context.sourceEpisode?.rawEpisodeName, '第01集');
    assert.equal(playerResult.context.sourceEpisode?.parsedEpisodeInfo.episodeNumber, 1);
    assert.equal(playerResult.context.episode?.episodeNumber, 1);
});

test('source media metadata reaches first-play CanonicalMedia and history storage', () => {
    const detail = jsonValue(api.buildDetailPayload({
        vod_id: 'example-series-4',
        vod_name: 'Example Series 4',
        vod_year: '2014',
        type_name: '电视剧',
        vod_class: '大陆剧',
        vod_director: 'Director One',
        vod_actor: 'Actor One,Actor Two',
        vod_area: 'Mainland',
        vod_lang: 'Mandarin',
        vod_remarks: 'Complete',
        vod_pic: 'https://images.example.test/cover.jpg',
        vod_content: '',
        vod_play_from: 'fixture-line',
        vod_play_url: 'E1$https://media.example.test/e1.m3u8'
    }, 'https://api.example.test/detail', 'fixture'));
    assert.equal(detail.videoInfo.type, '电视剧');
    assert.equal(detail.videoInfo.category, '大陆剧');
    assert.equal(detail.videoInfo.language, 'Mandarin');

    const entries = jsonValue(normalizeEpisodeList(detail.episodes));
    const firstPlay = runProductionMetadataPipeline(entries, 0, {
        title: detail.videoInfo.title,
        year: detail.videoInfo.year,
        sourceKey: 'fixture-code',
        vodId: 'example-series-4',
        metadata: {
            category: detail.videoInfo.category,
            type: detail.videoInfo.type,
            director: detail.videoInfo.director,
            actors: detail.videoInfo.actor,
            area: detail.videoInfo.area,
            language: detail.videoInfo.language,
            sourceName: 'Fixture Display Name'
        }
    });

    assert.equal(firstPlay.session.year, '2014');
    assert.equal(firstPlay.session.category, '大陆剧');
    assert.equal(firstPlay.session.type, '电视剧');
    assert.equal(firstPlay.session.sourceCode, 'fixture-code');
    assert.equal(firstPlay.session.sourceName, 'Fixture Display Name');
    assert.equal(firstPlay.session.vodId, 'example-series-4');
    assert.equal(firstPlay.context.media.releaseYear, 2014);
    assert.equal(firstPlay.context.media.mediaType, 'series');
    assert.deepEqual(Array.from(firstPlay.context.media.directors), ['Director One']);
    assert.deepEqual(Array.from(firstPlay.context.media.actors), ['Actor One', 'Actor Two']);
    assert.equal(firstPlay.context.sourceRecord.rawData.vod_area, 'Mainland');
    assert.equal(firstPlay.context.sourceRecord.rawData.vod_lang, 'Mandarin');

    const movieFirstPlay = runProductionMetadataPipeline(entries, 0, {
        title: 'Example Feature',
        year: '2025',
        sourceKey: 'fixture-code',
        vodId: 'example-feature',
        metadata: {
            category: 'Action Adventure',
            type: 'movie',
            sourceName: 'Fixture Display Name'
        }
    });
    assert.equal(movieFirstPlay.context.media.mediaType, 'movie');
    assert.equal(movieFirstPlay.context.episode?.episodeNumber, null);

    const saved = runProductionHistorySave(entries, 0, {
        title: detail.videoInfo.title,
        year: detail.videoInfo.year,
        category: detail.videoInfo.category,
        type: detail.videoInfo.type,
        director: detail.videoInfo.director,
        actors: detail.videoInfo.actor,
        area: detail.videoInfo.area,
        language: detail.videoInfo.language,
        sourceName: 'Fixture Display Name',
        sourceCode: 'fixture-code',
        vodId: 'example-series-4'
    });
    const historyItem = saved.history[0];
    assert.equal(historyItem.year, '2014');
    assert.equal(historyItem.category, '大陆剧');
    assert.equal(historyItem.type, '电视剧');
    assert.equal(historyItem.sourceName, 'Fixture Display Name');
    assert.equal(historyItem.sourceCode, 'fixture-code');
    assert.equal(historyItem.vod_id, 'example-series-4');
    assert.match(historyItem.url, /[?&]year=2014(?:&|$)/u);
    assert.match(historyItem.url, /[?&]source=fixture-code(?:&|$)/u);
    assert.doesNotMatch(historyItem.url, /source=Fixture(?:%20| )Display/u);
});

test('history save prefers the current URL year over stale playback session metadata', () => {
    const saved = runProductionHistorySave([{
        rawIndex: 0,
        rawEpisodeName: 'E1',
        displayEpisodeName: 'E1',
        episodeNameSource: 'source',
        url: 'https://media.example.test/current-e1.m3u8'
    }], 0, {
        year: '1999',
        urlYear: '2014'
    });

    assert.equal(saved.history[0].year, '2014');
    assert.match(saved.history[0].url, /[?&]year=2014(?:&|$)/u);
});

test('old history uses its real locator to hydrate metadata without treating sourceName as sourceCode', async () => {
    const episode = {
        rawIndex: 0,
        rawEpisodeName: 'E1',
        displayEpisodeName: 'E1',
        episodeNameSource: 'source',
        name: 'E1',
        url: 'https://media.example.test/legacy-e1.m3u8',
        rawEntry: 'E1$https://media.example.test/legacy-e1.m3u8'
    };
    const oldHistoryItem = {
        title: 'Example Series 4',
        sourceName: 'Fixture Display Name',
        url: 'player.html?url=https%3A%2F%2Fmedia.example.test%2Flegacy-e1.m3u8&source=fixture-code&source_code=fixture-code&id=legacy-vod&index=0',
        episodeIndex: 0,
        episodes: [episode.url],
        episodeEntries: [episode]
    };
    const replayed = await runProductionHistoryReplay({
        historyItem: oldHistoryItem,
        detailPayload: {
            videoInfo: {
                title: 'Example Series 4',
                year: '2014',
                type: '电视剧',
                category: '大陆剧',
                director: 'Director One',
                actor: 'Actor One',
                area: 'Mainland',
                language: 'Mandarin'
            },
            episodes: [episode],
            playSources: [{ name: 'fixture-line', rawIndex: 0, episodes: [episode] }]
        }
    });
    const session = replayed.playbackState.readPlaybackSession();
    const playerResult = loadPlayerProductionBoundary(
        replayed.localStorage,
        replayed.playbackState
    )('Example Series 4', 0);

    assert.match(replayed.fetchUrls[0], /[?&]source=fixture-code(?:&|$)/u);
    assert.doesNotMatch(replayed.fetchUrls[0], /Fixture(?:%20| )Display/u);
    assert.equal(session.sourceCode, 'fixture-code');
    assert.equal(session.sourceName, 'Fixture Display Name');
    assert.equal(session.vodId, 'legacy-vod');
    assert.equal(session.year, '2014');
    assert.equal(session.category, '大陆剧');
    assert.equal(session.type, '电视剧');
    assert.equal(playerResult.context.media.releaseYear, 2014);
    assert.equal(playerResult.context.media.mediaType, 'series');
    assert.match(replayed.openedUrl, /[?&]source=fixture-code(?:&|$)/u);
    assert.match(replayed.openedUrl, /[?&]id=legacy-vod(?:&|$)/u);
});

test('failed old-history hydration clears stale media and episode state from another work', async () => {
    const oldHistoryItem = {
        title: 'Media B',
        url: 'player.html?url=https%3A%2F%2Fmedia.example.test%2Fmedia-b.m3u8&source=source-b&source_code=source-b&id=vod-b&index=0',
        episodeIndex: 0,
        episodes: [],
        episodeEntries: []
    };
    const replayed = await runProductionHistoryReplay({
        historyItem: oldHistoryItem,
        detailPayload: {},
        detailStatus: 503,
        initialStorage: {
            currentVideoTitle: 'Media A',
            currentVideoYear: '1999',
            currentVideoCategory: '电视剧',
            currentVideoType: 'series',
            currentVideoDirector: 'Media A Director',
            currentEpisodes: JSON.stringify([
                'https://media.example.test/a1.m3u8',
                'https://media.example.test/a2.m3u8'
            ]),
            currentEpisodeEntries: JSON.stringify([
                { rawEpisodeName: 'E1', url: 'https://media.example.test/a1.m3u8' },
                { rawEpisodeName: 'E2', url: 'https://media.example.test/a2.m3u8' }
            ])
        }
    });
    const session = replayed.playbackState.readPlaybackSession();
    const playerResult = loadPlayerProductionBoundary(
        replayed.localStorage,
        replayed.playbackState
    )('Media B', 0);

    assert.match(replayed.fetchUrls[0], /[?&]source=source-b(?:&|$)/u);
    assert.equal(session.title, 'Media B');
    assert.equal(session.sourceCode, 'source-b');
    assert.equal(session.vodId, 'vod-b');
    assert.equal(session.year, '');
    assert.equal(session.category, '');
    assert.equal(session.type, '');
    assert.equal(session.director, '');
    assert.deepEqual(Array.from(session.episodes), []);
    assert.deepEqual(Array.from(session.episodeEntries), []);
    assert.equal(playerResult.observed.length, 0);
    assert.equal(playerResult.context.state, 'invalid');
    assert.equal(playerResult.context.episode, null);
    assert.equal(playerResult.context.sourceEpisode, null);
});

test('a legacy display source name is not guessed to be an API source code', async () => {
    const historyItem = {
        title: 'Legacy Display Only',
        sourceName: 'Human Readable Source',
        url: 'player.html?url=https%3A%2F%2Fmedia.example.test%2Flegacy.m3u8&index=0',
        episodeIndex: 0,
        episodes: ['https://media.example.test/legacy.m3u8'],
        episodeEntries: [{ url: 'https://media.example.test/legacy.m3u8' }]
    };
    const replayed = await runProductionHistoryReplay({
        historyItem,
        detailPayload: {
            videoInfo: { year: '2020' }
        }
    });
    const session = replayed.playbackState.readPlaybackSession();

    assert.deepEqual(replayed.fetchUrls, []);
    assert.equal(session.sourceName, 'Human Readable Source');
    assert.equal(session.sourceCode, '');
    assert.equal(session.vodId, '');
    assert.equal(session.year, '');
});

test('API URL-only and $URL entries keep a UI label without inventing a raw episode name', () => {
    const url = 'https://media.example.test/opaque.m3u8';
    const cases = [
        {
            label: 'plain URL',
            episode: jsonValue(api.parseEpisodeEntry(url, 1)),
            rawEntry: url,
            uiName: '第2集'
        },
        {
            label: '$URL',
            episode: jsonValue(api.parseEpisodeEntry(`$${url}`, 1)),
            rawEntry: `$${url}`,
            uiName: '第2集'
        },
        {
            label: 'HTML URL fallback',
            episode: jsonValue(api.parseHtmlPlaySources(`<div>$${url}</div>`)[0].episodes[0]),
            rawEntry: `$${url}`,
            uiName: '第1集'
        }
    ];

    for (const fixture of cases) {
        assert.equal(fixture.episode.rawEpisodeName, '', fixture.label);
        assert.equal(fixture.episode.episodeNameSource, 'generated', fixture.label);
        assert.equal(fixture.episode.displayEpisodeName, fixture.uiName, fixture.label);
        assert.equal(fixture.episode.name, fixture.uiName, fixture.label);
        assert.equal(fixture.episode.url, url, fixture.label);
        assert.equal(fixture.episode.rawEntry, fixture.rawEntry, fixture.label);
    }
});

test('app normalization preserves rawEntry and never promotes a synthetic UI label to identity', () => {
    const firstUrl = 'https://media.example.test/a.m3u8';
    const secondUrl = 'https://media.example.test/b.m3u8';
    const normalized = jsonValue(normalizeEpisodeList([
        firstUrl,
        {
            rawEpisodeName: '',
            name: '第2集',
            url: secondUrl,
            rawEntry: `$${secondUrl}`
        }
    ]));

    assert.deepEqual(normalized, [
        {
            rawIndex: 0,
            rawEpisodeName: '',
            displayEpisodeName: '第1集',
            episodeNameSource: 'generated',
            name: '第1集',
            url: firstUrl,
            rawEntry: firstUrl
        },
        {
            rawEpisodeName: '',
            name: '第2集',
            url: secondUrl,
            rawEntry: `$${secondUrl}`,
            rawIndex: 1,
            displayEpisodeName: '第2集',
            episodeNameSource: 'generated'
        }
    ]);
});

test('URL-only playback remains uncertain instead of inferring episode identity from index + 1', () => {
    const url = 'https://media.example.test/opaque.m3u8';
    const fallbackEpisodes = [
        jsonValue(api.parseEpisodeEntry('https://media.example.test/other.m3u8', 0)),
        jsonValue(api.parseEpisodeEntry(`$${url}`, 1))
    ];
    const normalized = jsonValue(normalizeEpisodeList(fallbackEpisodes));
    const { session, observed, context } = runProductionMetadataPipeline(normalized, 1);

    assert.equal(session.episodeEntries[1].name, '第2集');
    assert.equal(session.episodeEntries[1].rawEpisodeName, '');
    assert.equal(session.episodeEntries[1].episodeNameSource, 'generated');
    assert.equal(session.episodeEntries[1].rawEntry, `$${url}`);
    assert.equal(observed[1].rawIndex, 1);
    assert.equal(observed[1].name, '');
    assert.equal(observed[1].episodeNameSource, 'generated');
    assert.equal(observed[1].rawEntry, `$${url}`);
    assert.equal(context.state, 'uncertain');
    assert.equal(context.episode?.episodeNumber, null);
    assert.equal(context.sourceEpisode?.rawIndex, 1);
    assert.equal(context.sourceEpisode?.rawEpisodeName, '');
    assert.equal(context.sourceEpisode?.canonicalEpisodeId, null);
    assert.equal(context.sourceEpisode?.mappingState, 'unmapped');
    assert.match(context.reason, /rawIndex was not used as a fallback/u);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

import { LibertyCore } from '../js/liberty-core.js';

const playerSource = readFileSync(new URL('../js/player.js', import.meta.url), 'utf8');
const playbackStateSource = readFileSync(
    new URL('../js/utils/playback-state.js', import.meta.url),
    'utf8',
);
const positionHandoffSource = readFileSync(
    new URL('../js/utils/source-switch-position-handoff.js', import.meta.url),
    'utf8',
);

function sourceBetween(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + startMarker.length);
    assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
    assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
    return source.slice(start, end);
}

const adapterSource = sourceBetween(
    playerSource,
    'function getSourceSwitchRawRecord(',
    '\nfunction logSwitchResourceCandidateQuality('
);
const switchToResourceSource = sourceBetween(
    playerSource,
    'async function switchToResource(',
    '\n// 关闭弹幕源弹窗'
);
const handoffSideSource = sourceBetween(
    playerSource,
    'function getSourceSwitchHandoffSide(',
    '\nfunction removeSourceSwitchHandoffParams('
);

function playbackContext({
    sourceKey = 'source-a',
    vodId = 'media-a',
    title = 'Example Show',
    year = '2020',
    season = '',
    category = '电视剧',
    labels = ['第1集', '第2集', '第3集', '第4集'],
    currentRawIndex = 0,
} = {}) {
    return LibertyCore.createDanmakuPlaybackContext({
        sourceKey,
        sourceName: sourceKey,
        vodId,
        rawTitle: season ? `${title} ${season}` : title,
        rawYear: year,
        rawCategory: category,
        episodes: labels.map((name, rawIndex) => ({
            rawIndex,
            name,
            url: `https://media.example.test/${sourceKey}/${rawIndex}.m3u8`,
            rawEntry: `${name}$https://media.example.test/${sourceKey}/${rawIndex}.m3u8`,
        })),
        currentEpisodeIndex: currentRawIndex,
    });
}

function loadAdapter(currentContext) {
    const context = {
        LibertyCore,
        __currentContext: currentContext,
        URLSearchParams,
        console,
        window: {
            LibertyCore,
        },
    };
    vm.runInNewContext(`
        let currentVideoTitle = ${JSON.stringify(currentContext.media.canonicalTitle)};
        let currentEpisodeIndex = ${currentContext.currentEpisodeIndex};
        function getDanmuCoreRuntime() { return { core: LibertyCore }; }
        function createProductionDanmakuContext() { return globalThis.__currentContext; }
        function getPlayerEpisodeUrlValue(episode) {
            if (!episode) return '';
            return typeof episode === 'string' ? episode : episode.url || '';
        }
        ${adapterSource}
        globalThis.adapter = {
            evaluateSourceSwitchCandidate,
            resolveSourceSwitchEpisode,
        };
    `, context, { filename: 'source-switch-production-adapter.js' });
    return context.adapter;
}

function detail(title, year, labels, extras = {}) {
    return {
        videoInfo: {
            title,
            year,
            type: extras.type || '电视剧',
            category: extras.category || '电视剧',
            director: extras.director || '',
            actor: extras.actor || '',
        },
        episodes: labels.map((rawEpisodeName, rawIndex) => ({
            rawIndex,
            rawEpisodeName,
            episodeNameSource: 'source',
            name: rawEpisodeName,
            url: `https://media.example.test/source-b/${rawIndex}.m3u8`,
            rawEntry: `${rawEpisodeName}$https://media.example.test/source-b/${rawIndex}.m3u8`,
            playGroup: 'group-b',
            playGroupIndex: 0,
        })),
    };
}

function createMemoryStorage() {
    const values = new Map();
    return {
        getItem: (key) => values.has(key) ? values.get(key) : null,
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: (key) => values.delete(key),
        clear: () => values.clear(),
    };
}

async function runSourceSwitchHandoff({
    currentTitle,
    targetTitle,
    data,
    targetIndex,
    sourceKey = 'source-b',
    vodId = 'media-b',
    manualMediaConfirmation = false,
    manualTargetIndex = null,
    positionHandoff = null,
}) {
    const localStorage = createMemoryStorage();
    const sessionStorage = createMemoryStorage();
    const window = {
        LibertyCore,
        LibertyUtils: {
            media: {
                getEpisodeUrl: (episode) => typeof episode === 'string'
                    ? episode
                    : episode?.url || '',
            },
            storage: {},
        },
        location: {
            href: 'https://liberty.example.test/player.html?source=source-a&id=media-a',
        },
        sessionStorage,
    };
    const context = vm.createContext({
        Date,
        JSON,
        LibertyCore,
        URL,
        URLSearchParams,
        console,
        document: {
            getElementById: () => ({ classList: { add() {} } }),
        },
        encodeURIComponent,
        localStorage,
        window,
    });
    vm.runInContext(playbackStateSource, context, {
        filename: 'js/utils/playback-state.js',
    });
    if (positionHandoff) {
        vm.runInContext(positionHandoffSource, context, {
            filename: 'js/utils/source-switch-position-handoff.js',
        });
    }
    context.__switchData = structuredClone(data);
    context.__targetTitle = targetTitle;
    context.__targetIndex = targetIndex;
    context.__currentSwitchContext = positionHandoff?.currentContext || null;
    context.__targetSwitchContext = positionHandoff?.targetContext || null;
    context.__artVideo = positionHandoff?.video || null;
    vm.runInContext(`
        let currentVideoTitle = ${JSON.stringify(currentTitle)};
        let currentEpisodeIndex = 0;
        let art = globalThis.__artVideo ? { video: globalThis.__artVideo } : null;
        const playerLifecycle = { generation: 11 };
        const API_SITES = { ${JSON.stringify(sourceKey)}: { name: 'Source B' } };
        function getCustomApiInfo() { return null; }
        function getPlayerEpisodeUrlValue(episode) {
            if (!episode) return '';
            return typeof episode === 'string' ? episode : episode.url || '';
        }
        function evaluateSourceSwitchCandidate() {
            return {
                decision: 'supported',
                sourceRecord: { rawTitle: globalThis.__targetTitle },
            };
        }
        function resolveSourceSwitchEpisode() {
            return {
                state: 'supported',
                targetIndex: globalThis.__targetIndex,
                currentContext: globalThis.__currentSwitchContext,
                targetContext: globalThis.__targetSwitchContext,
            };
        }
        function isWatchRoomLaunch() { return false; }
        ${handoffSideSource}
        async function fetchWithRetry() {
            return { json: async () => globalThis.__switchData };
        }
        function showSourceSwitchEpisodeFallback() {}
        function showLoading() {}
        function hideLoading() {}
        function showToast() {}
        ${switchToResourceSource}
        globalThis.runSourceSwitch = switchToResource;
    `, context, { filename: 'source-switch-title-handoff.js' });

    await context.runSourceSwitch(
        sourceKey,
        vodId,
        manualMediaConfirmation,
        manualTargetIndex,
    );

    const navigationUrl = new URL(
        String(window.location.href),
        'https://liberty.example.test/',
    );
    const playbackState = window.LibertyUtils.playbackState;
    const navigationIndex = Number(navigationUrl.searchParams.get('index'));
    const begun = playbackState.beginPlaybackSession({
        title: navigationUrl.searchParams.get('title') || '',
        sourceCode: navigationUrl.searchParams.get('source') || '',
        vodId: navigationUrl.searchParams.get('id') || '',
        mediaUrl: navigationUrl.searchParams.get('url') || '',
        episodeIndex: navigationIndex,
    });
    const selectedEntry = begun.session.episodeEntries[navigationIndex] || null;
    const danmuContext = LibertyCore.createDanmakuPlaybackContext({
        sourceKey: begun.session.sourceCode,
        sourceName: begun.session.sourceName,
        vodId: begun.session.vodId,
        rawTitle: begun.session.title,
        rawYear: begun.session.year,
        rawCategory: [begun.session.category, begun.session.type].filter(Boolean).join(' '),
        episodes: begun.session.episodeEntries.map((episode, index) => ({
            rawIndex: Number.isInteger(episode.rawIndex) ? episode.rawIndex : index,
            name: episode.rawEpisodeName || '',
            url: episode.url || '',
            rawEntry: episode.rawEntry || '',
        })),
        currentEpisodeIndex: Number.isInteger(selectedEntry?.rawIndex)
            ? selectedEntry.rawIndex
            : navigationIndex,
    });

    return {
        begun,
        danmuContext,
        navigationUrl,
        localStorage,
        sessionStorage,
        positionHandoffApi: window.LibertyUtils.sourceSwitchPositionHandoff || null,
    };
}

test('source-switch media identity uses Core evidence instead of raw-title/first-result fallback', () => {
    const adapter = loadAdapter(playbackContext());
    const supported = adapter.evaluateSourceSwitchCandidate({
        vod_id: 'right',
        vod_name: 'Example Show',
        vod_year: '2020',
        type_name: '电视剧',
    }, 'source-b', 'Source B');
    const rejected = adapter.evaluateSourceSwitchCandidate({
        vod_id: 'remake',
        vod_name: 'Example Show',
        vod_year: '2010',
        type_name: '电视剧',
    }, 'source-b', 'Source B');
    const uncertain = adapter.evaluateSourceSwitchCandidate({
        vod_id: 'title-only',
        vod_name: 'Example Show',
    }, 'source-b', 'Source B');

    assert.equal(supported.decision, 'supported');
    assert.equal(rejected.decision, 'rejected');
    assert.equal(uncertain.decision, 'uncertain');
});

test('a missing target episode does not shift E3 to the same array index', () => {
    const current = playbackContext({ currentRawIndex: 2 });
    const adapter = loadAdapter(current);
    const data = detail('Example Show', '2020', ['第1集', '第3集', '第4集']);
    const result = adapter.resolveSourceSwitchEpisode(
        data,
        'source-b',
        'Source B',
        'media-b',
        data.episodes
    );

    assert.equal(result.state, 'supported');
    assert.equal(result.targetIndex, 1);
    assert.equal(data.episodes[result.targetIndex].rawEpisodeName, '第3集');
});

test('an inserted special does not shift the selected regular episode', () => {
    const current = playbackContext({ currentRawIndex: 2 });
    const adapter = loadAdapter(current);
    const data = detail('Example Show', '2020', ['第1集', 'SP1', '第2集', '第3集', '第4集']);
    const result = adapter.resolveSourceSwitchEpisode(
        data,
        'source-b',
        'Source B',
        'media-b',
        data.episodes
    );

    assert.equal(result.state, 'supported');
    assert.equal(result.targetIndex, 3);
    assert.equal(data.episodes[result.targetIndex].rawEpisodeName, '第3集');
});

test('duplicate target episode identities stay uncertain instead of selecting the first', () => {
    const current = playbackContext({ currentRawIndex: 2 });
    const adapter = loadAdapter(current);
    const data = detail('Example Show', '2020', ['第1集', '第3集', '第3集', '第4集']);
    const result = adapter.resolveSourceSwitchEpisode(
        data,
        'source-b',
        'Source B',
        'media-b',
        data.episodes
    );

    assert.equal(result.targetIndex, -1);
    assert.notEqual(result.state, 'supported');
    assert.notEqual(result.state, 'verified');
});

test('URL-only target playback remains uncertain and never uses the current index', () => {
    const current = playbackContext({ currentRawIndex: 2 });
    const adapter = loadAdapter(current);
    const data = detail('Example Show', '2020', ['', '', '', '']);
    data.episodes = data.episodes.map((episode) => ({
        ...episode,
        rawEpisodeName: '',
        episodeNameSource: 'generated',
        name: `播放项 ${episode.rawIndex + 1}`,
        rawEntry: `$${episode.url}`,
    }));
    const result = adapter.resolveSourceSwitchEpisode(
        data,
        'source-b',
        'Source B',
        'media-b',
        data.episodes
    );

    assert.ok(
        result.state === 'uncertain' || result.state === 'not_found',
        `expected a non-automatic safe state, got ${result.state}`
    );
    assert.equal(result.targetIndex, -1);
});

test('source switch uses one target title for URL and session and retains structured E3 across an inserted SP', async () => {
    const result = await runSourceSwitchHandoff({
        currentTitle: 'Example Show',
        targetTitle: 'Example Show 2024',
        data: {
            vod_name: 'Example Show 2024',
            vod_year: '2024',
            type_name: '电视剧',
            videoInfo: { year: '2024', category: '电视剧', type: '电视剧' },
            episodes: detail('Example Show 2024', '2024', ['第1集', 'SP1', '第3集']).episodes,
        },
        targetIndex: 2,
    });

    assert.equal(result.navigationUrl.searchParams.get('title'), 'Example Show 2024');
    assert.equal(result.begun.reused, true);
    assert.equal(result.begun.session.title, 'Example Show 2024');
    assert.equal(result.begun.session.year, '2024');
    assert.equal(result.begun.session.category, '电视剧');
    assert.equal(result.begun.session.episodeEntries[2].rawEpisodeName, '第3集');
    assert.equal(result.danmuContext.state, 'ready');
    assert.equal(result.danmuContext.episode?.episodeNumber, 3);
    assert.equal(result.danmuContext.sourceEpisode?.rawEpisodeName, '第3集');
});

test('season aliases use the target source title without clearing the accepted playback session', async () => {
    const result = await runSourceSwitchHandoff({
        currentTitle: 'Example Show Season 2',
        targetTitle: 'Example Show 第二季',
        data: {
            vod_name: 'Example Show 第二季',
            vod_year: '2024',
            type_name: '电视剧',
            videoInfo: { year: '2024', category: '电视剧', type: '电视剧' },
            episodes: detail('Example Show 第二季', '2024', ['第1集', '第2集']).episodes,
        },
        targetIndex: 1,
    });

    assert.equal(result.navigationUrl.searchParams.get('title'), 'Example Show 第二季');
    assert.equal(result.begun.reused, true);
    assert.equal(result.begun.session.episodeEntries[1].rawEpisodeName, '第2集');
    assert.equal(result.danmuContext.state, 'ready');
    assert.equal(result.danmuContext.media.season, 2);
    assert.equal(result.danmuContext.episode?.episodeNumber, 2);
});

test('same-title source switches preserve existing behavior', async () => {
    const result = await runSourceSwitchHandoff({
        currentTitle: 'Example Show',
        targetTitle: 'Example Show',
        data: {
            vod_name: 'Example Show',
            vod_year: '2024',
            type_name: '电视剧',
            videoInfo: { year: '2024', category: '电视剧', type: '电视剧' },
            episodes: detail('Example Show', '2024', ['第1集']).episodes,
        },
        targetIndex: 0,
    });

    assert.equal(result.navigationUrl.searchParams.get('title'), 'Example Show');
    assert.equal(result.begun.reused, true);
    assert.equal(result.danmuContext.state, 'ready');
});

test('movie alias handoff preserves movie metadata and a ready whole-media context without E01', async () => {
    const movieEntry = {
        rawIndex: 0,
        rawEpisodeName: '正片',
        episodeNameSource: 'source',
        name: '正片',
        url: 'https://media.example.test/source-b/movie.m3u8',
        rawEntry: '正片$https://media.example.test/source-b/movie.m3u8',
        playGroup: 'group-b',
        playGroupIndex: 0,
    };
    const result = await runSourceSwitchHandoff({
        currentTitle: 'Example Movie',
        targetTitle: 'Example Movie 2025',
        data: {
            vod_name: 'Example Movie 2025',
            vod_year: '2025',
            type_name: '动作片',
            videoInfo: { year: '2025', category: '动作片', type: '动作片' },
            episodes: [movieEntry],
        },
        targetIndex: 0,
    });

    assert.equal(result.begun.reused, true);
    assert.equal(result.begun.session.category, '动作片');
    assert.equal(result.danmuContext.state, 'ready');
    assert.equal(result.danmuContext.media.mediaType, 'movie');
    assert.equal(result.danmuContext.episode?.contentType, 'movie');
    assert.equal(result.danmuContext.episode?.episodeNumber, null);
});

test('missing target vod_name safely falls back to the current title for both handoffs', async () => {
    const result = await runSourceSwitchHandoff({
        currentTitle: 'Example Show',
        targetTitle: '',
        data: {
            vod_year: '2024',
            type_name: '电视剧',
            videoInfo: { year: '2024', category: '电视剧', type: '电视剧' },
            episodes: detail('', '2024', ['第1集']).episodes,
        },
        targetIndex: 0,
        manualMediaConfirmation: true,
    });

    assert.equal(result.navigationUrl.searchParams.get('title'), 'Example Show');
    assert.equal(result.begun.session.title, 'Example Show');
    assert.equal(result.begun.reused, true);
});

test('production source switch captures paused currentTime in a trusted one-shot handoff', async () => {
    const data = detail('Example Show', '2020', ['第1集', '第2集']);
    const currentContext = playbackContext({
        title: 'Example Show',
        year: '2020',
        labels: ['第1集', '第2集'],
        currentRawIndex: 1,
    });
    const targetContext = LibertyCore.createDanmakuPlaybackContext({
        sourceKey: 'source-b',
        sourceName: 'Source B',
        vodId: 'media-b',
        rawTitle: 'Example Show',
        rawYear: '2020',
        rawCategory: '电视剧',
        episodes: data.episodes.map((episode) => ({
            rawIndex: episode.rawIndex,
            name: episode.rawEpisodeName,
            url: episode.url,
            rawEntry: episode.rawEntry,
        })),
        currentEpisodeIndex: 1,
    });
    const result = await runSourceSwitchHandoff({
        currentTitle: 'Example Show',
        targetTitle: 'Example Show',
        data,
        targetIndex: 1,
        positionHandoff: {
            currentContext,
            targetContext,
            video: {
                paused: true,
                ended: false,
                currentTime: 600,
                duration: 3600,
            },
        },
    });

    const nonce = result.navigationUrl.searchParams.get('switch_handoff');
    const generation = Number(result.navigationUrl.searchParams.get('switch_generation'));
    assert.ok(nonce);
    assert.equal(generation, 11);
    assert.equal(result.navigationUrl.searchParams.has('position'), false);
    const targetEpisode = targetContext.sourceEpisode;
    const consumed = result.positionHandoffApi.consume({
        nonce,
        generation,
        target: {
            sourceKey: targetEpisode.sourceKey,
            vodId: targetEpisode.vodId,
            canonicalMediaId: targetContext.media.mediaId,
            canonicalEpisodeId: targetContext.episode.canonicalEpisodeId,
            episode: {
                rawIndex: targetEpisode.rawIndex,
                playGroup: targetEpisode.playGroup,
                playGroupIndex: targetEpisode.playGroupIndex,
            },
        },
        newDuration: 3610,
    }, { storage: result.sessionStorage });
    assert.equal(consumed.accepted, true);
    assert.equal(consumed.position, 600);
});

test('manual episode selection does not mint a trusted automatic position handoff', async () => {
    const data = detail('Example Show', '2020', ['第1集', '第2集']);
    const context = playbackContext({ labels: ['第1集', '第2集'], currentRawIndex: 1 });
    const result = await runSourceSwitchHandoff({
        currentTitle: 'Example Show',
        targetTitle: 'Example Show',
        data,
        targetIndex: 1,
        manualMediaConfirmation: true,
        manualTargetIndex: 1,
        positionHandoff: {
            currentContext: context,
            targetContext: context,
            video: { paused: false, ended: false, currentTime: 600, duration: 3600 },
        },
    });
    assert.equal(result.navigationUrl.searchParams.has('switch_handoff'), false);
});

test('unrelated direct navigation still clears the previous media metadata and episode identities', () => {
    const localStorage = createMemoryStorage();
    const window = {
        LibertyUtils: {
            media: {
                getEpisodeUrl: (episode) => typeof episode === 'string'
                    ? episode
                    : episode?.url || '',
            },
            storage: {},
        },
    };
    const context = vm.createContext({ console, localStorage, window });
    vm.runInContext(playbackStateSource, context, {
        filename: 'js/utils/playback-state.js',
    });
    const playbackState = window.LibertyUtils.playbackState;
    playbackState.writePlaybackSession({
        title: 'Example Show A',
        year: '2020',
        category: '电视剧',
        actors: 'Actor A',
        sourceCode: 'source-a',
        vodId: 'media-a',
        episodes: [{
            rawIndex: 2,
            rawEpisodeName: '第3集',
            url: 'https://media.example.test/source-a/e3.m3u8',
        }],
    });

    const begun = playbackState.beginPlaybackSession({
        title: 'Completely Different Show B',
        sourceCode: 'source-b',
        vodId: 'media-b',
        mediaUrl: 'https://media.example.test/source-b/main.m3u8',
        episodeIndex: 0,
    });

    assert.equal(begun.reused, false);
    assert.equal(begun.session.title, 'Completely Different Show B');
    assert.equal(begun.session.year, '');
    assert.equal(begun.session.category, '');
    assert.equal(begun.session.actors, '');
    assert.equal(begun.session.episodeEntries.length, 1);
    assert.equal(
        begun.session.episodeEntries[0].url,
        'https://media.example.test/source-b/main.m3u8',
    );
    assert.equal(begun.session.episodeEntries[0].rawEpisodeName, undefined);
});

test('production source-switch path contains no legacy first-result or same-index decision', () => {
    const modalSource = sourceBetween(
        playerSource,
        'async function showSwitchResourceModal()',
        '\nfunction showSourceSwitchEpisodeFallback('
    );
    const switchSource = sourceBetween(
        playerSource,
        'async function switchToResource(',
        '\n// 关闭弹幕源弹窗'
    );

    assert.doesNotMatch(modalSource, /queryResult\s*\[\s*0\s*\]/);
    assert.doesNotMatch(modalSource, /vod_name\s*==\s*currentVideoTitle/);
    assert.match(modalSource, /evaluateSourceSwitchCandidate/);
    assert.doesNotMatch(switchSource, /targetIndex\s*=\s*currentIndex/);
    assert.doesNotMatch(switchSource, /currentIndex\s*<\s*playableEpisodes\.length/);
    assert.match(switchSource, /resolveSourceSwitchEpisode/);
    assert.match(switchSource, /const targetVideoTitle =/);
    assert.match(switchSource, /searchParams\.set\('title', targetVideoTitle\)/);
    assert.match(switchSource, /title:\s*targetVideoTitle/);
});

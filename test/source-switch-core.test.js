import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

import { LibertyCore } from '../js/liberty-core.js';

const playerSource = readFileSync(new URL('../js/player.js', import.meta.url), 'utf8');

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
});

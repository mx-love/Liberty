import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { build } from 'esbuild';

const adapterEntry = fileURLToPath(new URL(
    '../../src/core/danmaku/danmu-playback-adapter.ts',
    import.meta.url,
));
const buildResult = await build({
    entryPoints: [adapterEntry],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    write: false,
});
const adapterModule = await import(
    `data:text/javascript;base64,${Buffer.from(buildResult.outputFiles[0].contents).toString('base64')}`
);
const { createDanmakuPlaybackContext } = adapterModule;

function episode(rawIndex, name, suffix = rawIndex) {
    return {
        rawIndex,
        name,
        url: `https://media.example.test/${suffix}.m3u8`,
    };
}

function playback(overrides = {}) {
    return {
        sourceKey: 'fixture-source',
        sourceName: 'Fixture Source',
        vodId: 'fixture-vod',
        rawTitle: '远航 第二季',
        rawYear: '2026',
        rawRemarks: '更新至第13集',
        rawCategory: '电视剧',
        episodes: [episode(0, '第11集'), episode(1, '第12集'), episode(2, '第13集')],
        currentEpisodeIndex: 1,
        fetchedAt: 123,
        ...overrides,
    };
}

test('rawIndex=1 can map to explicit episode 12 without positional inference', () => {
    const context = createDanmakuPlaybackContext(playback());

    assert.equal(context.state, 'ready');
    assert.equal(context.currentEpisodeIndex, 1);
    assert.equal(context.sourceEpisode?.rawIndex, 1);
    assert.equal(context.sourceEpisode?.rawEpisodeName, '第12集');
    assert.equal(context.sourceEpisode?.playUrl, 'https://media.example.test/1.m3u8');
    assert.equal(context.sourceEpisode?.parsedEpisodeInfo.episodeNumber, 12);
    assert.equal(context.episode?.episodeNumber, 12);
    assert.equal(context.episode?.seasonNumber, 2);
    assert.equal(context.sourceEpisode?.canonicalEpisodeId, context.episode?.canonicalEpisodeId);
    assert.equal(context.sourceEpisode?.mappingState, 'mapped');
    assert.equal(context.media.canonicalTitle, '远航');
    assert.equal(context.media.releaseYear, 2026);
    assert.equal(context.media.season, 2);
    assert.equal(context.sourceRecord.rawData.vod_name, '远航 第二季');
});

test('missing regular episodes and an inserted numbered special retain independent identities', () => {
    const context = createDanmakuPlaybackContext(playback({
        episodes: [
            episode(7, '第11集', 'e11'),
            episode(9, 'SP1', 'sp1'),
            episode(12, '第13集', 'e13'),
        ],
        currentEpisodeIndex: 12,
    }));

    assert.equal(context.state, 'ready');
    assert.deepEqual(
        context.mediaEpisodes.map((item) => ({
            contentType: item.contentType,
            episodeNumber: item.episodeNumber,
            title: item.episodeTitle,
        })),
        [
            { contentType: 'regular', episodeNumber: 11, title: '第11集' },
            { contentType: 'special', episodeNumber: null, title: 'SP1' },
            { contentType: 'regular', episodeNumber: 13, title: '第13集' },
        ],
    );
    assert.deepEqual(context.sourceEpisodes.map((item) => item.rawIndex), [7, 9, 12]);
    assert.equal(context.episode?.episodeNumber, 13);
    assert.equal(context.sourceEpisodes[1].mappingState, 'mapped');
    assert.equal(context.sourceEpisodes[1].parsedEpisodeInfo.specialNumber, 1);
});

test('technical and ambiguous numeric labels remain uncertain and never fall back to rawIndex + 1', () => {
    for (const rawName of ['线路2', '1080P', '12']) {
        const context = createDanmakuPlaybackContext(playback({
            rawTitle: '不规则片单',
            rawYear: '',
            rawRemarks: '',
            episodes: [episode(1, rawName)],
            currentEpisodeIndex: 1,
        }));

        assert.equal(context.state, 'uncertain', rawName);
        assert.equal(context.sourceEpisode?.rawIndex, 1, rawName);
        assert.equal(context.sourceEpisode?.mappingState, 'unmapped', rawName);
        assert.equal(context.sourceEpisode?.canonicalEpisodeId, null, rawName);
        if (rawName !== '12') {
            assert.equal(context.episode?.episodeNumber, null, rawName);
        }
        assert.match(context.reason, /rawIndex was not used as a fallback/u, rawName);
    }
});

test('duplicate explicit E12 entries are conflicting instead of selecting the first row', () => {
    const context = createDanmakuPlaybackContext(playback({
        episodes: [episode(4, 'E12', 'a'), episode(8, '第12集', 'b')],
        currentEpisodeIndex: 8,
    }));

    assert.equal(context.state, 'uncertain');
    assert.equal(context.episode?.episodeNumber, 12);
    assert.equal(context.sourceEpisode?.mappingState, 'conflicting');
    assert.equal(context.sourceEpisode?.canonicalEpisodeId, null);
    assert.equal(context.mediaEpisodes[0].canonicalEpisodeId, context.mediaEpisodes[1].canonicalEpisodeId);
    assert.ok(context.sourceEpisodes.every((item) => item.mappingState === 'conflicting'));
    assert.match(context.reason, /occurs more than once/u);
});

test('an explicit episode season conflict cannot be rescued by an equal episode number', () => {
    const context = createDanmakuPlaybackContext(playback({
        episodes: [episode(1, 'S01E12')],
    }));

    assert.equal(context.media.season, 2);
    assert.equal(context.episode?.seasonNumber, 1);
    assert.equal(context.episode?.episodeNumber, 12);
    assert.equal(context.episode?.identityState, 'uncertain');
    assert.equal(context.sourceEpisode?.mappingState, 'conflicting');
    assert.equal(context.sourceEpisode?.canonicalEpisodeId, null);
    assert.match(context.reason, /conflicts with media season 2/u);
});

test('known canonical episode identity is independent of playback URL and raw array coordinate', () => {
    const first = createDanmakuPlaybackContext(playback({
        episodes: [episode(1, 'E12', 'origin-a')],
        currentEpisodeIndex: 1,
    }));
    const moved = createDanmakuPlaybackContext(playback({
        episodes: [episode(99, '第12集', 'origin-b')],
        currentEpisodeIndex: 99,
    }));

    assert.equal(first.state, 'ready');
    assert.equal(moved.state, 'ready');
    assert.equal(first.episode?.canonicalEpisodeId, moved.episode?.canonicalEpisodeId);
    assert.notEqual(first.sourceEpisode?.playUrl, moved.sourceEpisode?.playUrl);
    assert.notEqual(first.sourceEpisode?.rawIndex, moved.sourceEpisode?.rawIndex);
    assert.deepEqual(first.media.externalIds, {});
    assert.ok(first.sourceEpisode?.mappingEvidence.every((item) => !item.includes('rawIndex')));
});

test('a valid variety broadcast date is mapped as a date, not a huge episode number', () => {
    const context = createDanmakuPlaybackContext(playback({
        rawTitle: '周末舞台',
        rawCategory: '综艺',
        rawYear: '2026',
        rawRemarks: '',
        episodes: [episode(0, '第20260926期')],
        currentEpisodeIndex: 0,
    }));

    assert.equal(context.state, 'ready');
    assert.equal(context.media.mediaType, 'variety');
    assert.equal(context.episode?.airDate, '2026-09-26');
    assert.equal(context.episode?.episodeNumber, null);
    assert.equal(context.sourceEpisode?.parsedEpisodeInfo.numberKind, 'date');
});

test('an absent or duplicated current raw coordinate is invalid rather than positionally selected', () => {
    const absent = createDanmakuPlaybackContext(playback({ currentEpisodeIndex: 20 }));
    assert.equal(absent.state, 'invalid');
    assert.equal(absent.episode, null);
    assert.equal(absent.sourceEpisode, null);

    const duplicated = createDanmakuPlaybackContext(playback({
        episodes: [episode(1, 'E11', 'a'), episode(1, 'E12', 'b')],
        currentEpisodeIndex: 1,
    }));
    assert.equal(duplicated.state, 'invalid');
    assert.equal(duplicated.episode, null);
    assert.equal(duplicated.sourceEpisode, null);
});

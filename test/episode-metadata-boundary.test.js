import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

import { build } from 'esbuild';

const apiSource = readFileSync(new URL('../js/api.js', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const playerSource = readFileSync(new URL('../js/player.js', import.meta.url), 'utf8');
const playbackStateSource = readFileSync(
    new URL('../js/utils/playback-state.js', import.meta.url),
    'utf8'
);

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
        '\nfunction buildDetailPayload('
    );
    const context = {
        M3U8_PATTERN: /\$https?:\/\/[^"'\s]+?\.m3u8/g
    };
    vm.runInNewContext(`${source}\n;globalThis.boundary = {\n` +
        'parseEpisodeEntry, parseVodPlaySources, buildSinglePlaySourceFromUrls, parseHtmlPlaySources\n' +
        '};', context, { filename: 'js/api.js#metadata-boundary' });
    return context.boundary;
}

function loadAppEpisodeNormalizer() {
    const source = sourceBetween(
        appSource,
        'function normalizeEpisodeList(',
        '\nfunction normalizePlaySources('
    );
    const context = {};
    vm.runInNewContext(`${source}\n;globalThis.normalizeEpisodeList = normalizeEpisodeList;`, context, {
        filename: 'js/app.js#normalizeEpisodeList'
    });
    return context.normalizeEpisodeList;
}

function loadPlayerEpisodeObserver() {
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
    const context = {
        window: { LibertyUtils: {} }
    };
    vm.runInNewContext(`
        let currentEpisodes = [];
        let currentEpisodeEntries = [];
        ${urlHelper}
        ${observer}
        globalThis.observe = (episodes, entries) => {
            currentEpisodes = episodes;
            currentEpisodeEntries = entries;
            return getObservedDanmuEpisodes();
        };
    `, context, { filename: 'js/player.js#getObservedDanmuEpisodes' });
    return context.observe;
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

function loadPlaybackState() {
    const localStorage = createStorage();
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

function runProductionMetadataPipeline(entries, currentEpisodeIndex) {
    const playbackState = loadPlaybackState();
    playbackState.writePlaybackSession({
        title: '边界测试剧',
        episodeIndex: currentEpisodeIndex,
        episodes: entries
    });
    const session = playbackState.readPlaybackSession();
    const observed = jsonValue(loadPlayerEpisodeObserver()(
        Array.from(session.episodes),
        jsonValue(session.episodeEntries)
    ));
    const context = createDanmakuPlaybackContext({
        sourceKey: 'metadata-fixture',
        sourceName: 'Metadata Fixture',
        vodId: 'metadata-vod',
        rawTitle: session.title,
        rawYear: '',
        rawRemarks: '',
        rawCategory: '电视剧',
        episodes: observed,
        currentEpisodeIndex
    });
    return { session, observed, context };
}

const api = loadApiMetadataBoundary();
const normalizeEpisodeList = loadAppEpisodeNormalizer();

test('AppleCMS explicit source episode names survive every metadata boundary', () => {
    const url = 'https://media.example.test/episode-12.m3u8';
    const groups = api.parseVodPlaySources('m3u8', `第12集$${url}`);
    const apiEpisode = jsonValue(groups[0].episodes[0]);

    assert.deepEqual(apiEpisode, {
        rawEpisodeName: '第12集',
        name: '第12集',
        url,
        rawEntry: `第12集$${url}`
    });

    const normalized = jsonValue(normalizeEpisodeList([apiEpisode]));
    assert.deepEqual(normalized[0], apiEpisode);

    const { session, observed, context } = runProductionMetadataPipeline(normalized, 0);
    assert.equal(session.episodeEntries[0].rawEpisodeName, '第12集');
    assert.equal(session.episodeEntries[0].rawEntry, `第12集$${url}`);
    assert.equal(observed[0].name, '第12集');
    assert.equal(observed[0].rawEntry, `第12集$${url}`);
    assert.equal(context.state, 'ready');
    assert.equal(context.episode?.episodeNumber, 12);
    assert.equal(context.sourceEpisode?.mappingState, 'mapped');
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
            rawEpisodeName: '',
            name: '第1集',
            url: firstUrl,
            rawEntry: firstUrl
        },
        {
            rawEpisodeName: '',
            name: '第2集',
            url: secondUrl,
            rawEntry: `$${secondUrl}`
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
    assert.equal(session.episodeEntries[1].rawEntry, `$${url}`);
    assert.equal(observed[1].rawIndex, 1);
    assert.equal(observed[1].name, '');
    assert.equal(observed[1].rawEntry, `$${url}`);
    assert.equal(context.state, 'uncertain');
    assert.equal(context.episode?.episodeNumber, null);
    assert.equal(context.sourceEpisode?.rawIndex, 1);
    assert.equal(context.sourceEpisode?.rawEpisodeName, '');
    assert.equal(context.sourceEpisode?.canonicalEpisodeId, null);
    assert.equal(context.sourceEpisode?.mappingState, 'unmapped');
    assert.match(context.reason, /rawIndex was not used as a fallback/u);
});

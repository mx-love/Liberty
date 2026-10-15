import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const playbackStateSource = readFileSync(
    new URL('../js/utils/playback-state.js', import.meta.url),
    'utf8'
);

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

function loadPlaybackState(initial = {}) {
    const localStorage = createStorage(initial);
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

    return {
        api: context.window.LibertyUtils.playbackState,
        localStorage
    };
}

test('playback session preserves structured episode evidence beside legacy URL list', () => {
    const { api, localStorage } = loadPlaybackState();
    const episodes = [
        {
            name: '第11集',
            url: 'https://media.example/11.m3u8',
            rawIndex: 20,
            sourceEpisodeId: 'source-e11'
        },
        {
            name: '第12集',
            url: 'https://media.example/12.m3u8',
            rawIndex: 24,
            remarks: '加更后恢复正片'
        }
    ];

    const session = api.writePlaybackSession({
        title: '测试剧',
        episodeIndex: 1,
        episodes
    });

    assert.deepEqual(Array.from(session.episodes), [
        'https://media.example/11.m3u8',
        'https://media.example/12.m3u8'
    ]);
    assert.deepEqual(JSON.parse(JSON.stringify(session.episodeEntries)), episodes);
    assert.deepEqual(JSON.parse(localStorage.getItem('currentEpisodes')), Array.from(session.episodes));
    assert.deepEqual(JSON.parse(localStorage.getItem('currentEpisodeEntries')), episodes);
});

test('legacy URL-only playback session remains readable without invented identity fields', () => {
    const urls = [
        'https://media.example/a.m3u8',
        'https://media.example/b.m3u8'
    ];
    const { api } = loadPlaybackState({
        currentEpisodes: JSON.stringify(urls),
        currentEpisodeIndex: '1'
    });

    const session = api.readPlaybackSession();

    assert.deepEqual(Array.from(session.episodes), urls);
    assert.deepEqual(JSON.parse(JSON.stringify(session.episodeEntries)), [
        { url: urls[0] },
        { url: urls[1] }
    ]);
    assert.equal('name' in session.episodeEntries[0], false);
    assert.equal('rawIndex' in session.episodeEntries[0], false);
});

test('stale structured entries are ignored after a legacy writer changes URL list', () => {
    const { api } = loadPlaybackState({
        currentEpisodes: JSON.stringify(['https://media.example/new.m3u8']),
        currentEpisodeEntries: JSON.stringify([
            { name: '旧第12集', url: 'https://media.example/old.m3u8', rawIndex: 1 }
        ])
    });

    const entries = api.readCurrentEpisodeEntries();

    assert.deepEqual(JSON.parse(JSON.stringify(entries)), [
        { url: 'https://media.example/new.m3u8' }
    ]);
});

test('app playVideo passes raw episode entries to playback session storage', () => {
    const appSource = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
    const playVideoStart = appSource.indexOf('function playVideo(');
    const playVideoEnd = appSource.indexOf('\nfunction showVideoPlayer(', playVideoStart);
    const playVideoSource = appSource.slice(playVideoStart, playVideoEnd);

    assert.match(playVideoSource, /episodeIndex,\s*episodes:\s*currentEpisodes/);
    assert.doesNotMatch(playVideoSource, /episodes:\s*getCurrentEpisodeUrls\(\)/);
    assert.match(playVideoSource, /currentEpisodeEntries/);
});

test('direct media B atomically replaces media A metadata and episode state', () => {
    const mediaAUrl = 'https://media.example/a-01.m3u8';
    const mediaBUrl = 'https://media.example/b.m3u8';
    const { api } = loadPlaybackState();

    api.replacePlaybackSession({
        title: 'Media A',
        year: '2024',
        category: 'series',
        type: 'TV',
        actors: 'Actor A',
        sourceCode: 'source-a',
        vodId: 'vod-a',
        mediaUrl: mediaAUrl,
        episodeEntries: Array.from({ length: 24 }, (_, rawIndex) => ({
            url: `https://media.example/a-${rawIndex + 1}.m3u8`,
            rawEpisodeName: `E${rawIndex + 1}`,
            rawIndex
        }))
    });

    const result = api.beginPlaybackSession({
        title: 'Media B',
        mediaUrl: mediaBUrl,
        episodeIndex: 0
    });

    assert.equal(result.reused, false);
    assert.equal(result.session.title, 'Media B');
    assert.equal(result.session.year, '');
    assert.equal(result.session.type, '');
    assert.equal(result.session.actors, '');
    assert.equal(result.session.sourceCode, '');
    assert.equal(result.session.vodId, '');
    assert.deepEqual(JSON.parse(JSON.stringify(result.session.episodeEntries)), [
        { url: mediaBUrl }
    ]);
    assert.equal('rawIndex' in result.session.episodeEntries[0], false);
    assert.equal('rawEpisodeName' in result.session.episodeEntries[0], false);
});

test('matching source locator reuses metadata while an explicit locator conflict replaces it', () => {
    const { api } = loadPlaybackState();
    api.replacePlaybackSession({
        title: 'Example Series',
        year: '2020',
        sourceCode: 'source-a',
        vodId: 'vod-a',
        episodeEntries: [
            { url: 'https://media.example/e1.m3u8', rawEpisodeName: '第1集', rawIndex: 0 },
            { url: 'https://media.example/e2.m3u8', rawEpisodeName: '第2集', rawIndex: 1 }
        ]
    });

    const same = api.beginPlaybackSession({
        title: 'Example Series',
        sourceCode: 'source-a',
        vodId: 'vod-a',
        mediaUrl: 'https://media.example/e2.m3u8',
        episodeIndex: 1
    });
    assert.equal(same.reused, true);
    assert.equal(same.session.year, '2020');
    assert.equal(same.session.episodeEntries.length, 2);

    const different = api.beginPlaybackSession({
        title: 'Other Series',
        sourceCode: 'source-a',
        vodId: 'vod-b',
        mediaUrl: 'https://media.example/other.m3u8',
        episodeIndex: 0
    });
    assert.equal(different.reused, false);
    assert.equal(different.session.year, '');
    assert.deepEqual(JSON.parse(JSON.stringify(different.session.episodeEntries)), [
        { url: 'https://media.example/other.m3u8' }
    ]);
});

test('URL membership can restore the same session but equal title alone cannot', () => {
    const { api } = loadPlaybackState();
    api.replacePlaybackSession({
        title: 'Same Title',
        year: '2019',
        episodeEntries: [
            { url: 'https://media.example/known.m3u8', rawEpisodeName: '第12集', rawIndex: 1 }
        ]
    });

    const known = api.beginPlaybackSession({
        title: 'Same Title',
        mediaUrl: 'https://media.example/known.m3u8'
    });
    assert.equal(known.reused, true);
    assert.equal(known.session.year, '2019');

    const unknown = api.beginPlaybackSession({
        title: 'Same Title',
        mediaUrl: 'https://media.example/unrelated.m3u8'
    });
    assert.equal(unknown.reused, false);
    assert.equal(unknown.session.year, '');
    assert.deepEqual(JSON.parse(JSON.stringify(unknown.session.episodeEntries)), [
        { url: 'https://media.example/unrelated.m3u8' }
    ]);
});

test('production player begins an atomic session and history restore never borrows global episodes', () => {
    const playerSource = readFileSync(new URL('../js/player.js', import.meta.url), 'utf8');
    const initializeStart = playerSource.indexOf('function initializePageContent()');
    const initializeEnd = playerSource.indexOf('\nfunction initPlayer(', initializeStart);
    const initializeSource = playerSource.slice(initializeStart, initializeEnd);
    const uiSource = readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');
    const historyStart = uiSource.indexOf('async function playFromHistory(');
    const historyEnd = uiSource.indexOf('\nfunction addToViewingHistory(', historyStart);
    const historySource = uiSource.slice(historyStart, historyEnd);

    assert.match(initializeSource, /beginPlaybackSession\(sessionRequest\)/);
    assert.match(initializeSource, /activePlaybackSession\.episodeEntries/);
    assert.doesNotMatch(initializeSource, /playbackState\.readCurrentEpisodes\(\)/);
    assert.doesNotMatch(
        historySource,
        /localStorage\.getItem\(['"]currentEpisodes['"]\)/
    );
});

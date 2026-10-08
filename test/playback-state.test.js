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

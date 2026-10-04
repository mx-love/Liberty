import assert from 'node:assert/strict';
import test from 'node:test';

import { DanmuClient } from '../../js/liberty-core.js';

function jsonResponse(value, status = 200, headers = {}) {
    return new Response(JSON.stringify(value), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
    });
}

function createRecordingClient(responses, options = {}) {
    const calls = [];
    const queue = [...responses];
    const client = new DanmuClient({
        baseUrl: 'https://danmu.example.test/token/',
        timeoutMs: 100,
        headers: { 'x-liberty-test': 'client-contract' },
        ...options,
        async fetch(url, init) {
            calls.push({ url: String(url), init });
            const next = queue.shift();
            if (typeof next === 'function') return next(url, init);
            if (!next) throw new Error('Unexpected danmu client request');
            return next;
        },
    });
    return { client, calls };
}

function assertFailure(result, kind, status) {
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.kind, kind);
    assert.equal(result.status, status);
}

test('DanmuClient uses the deployed v2 method, path, query and body contracts', async () => {
    const { client, calls } = createRecordingClient([
        jsonResponse({
            errorCode: 0,
            success: true,
            errorMessage: '',
            isMatched: true,
            matches: [{
                animeId: 101,
                animeTitle: 'Example Show',
                episodeId: 1201,
                episodeTitle: '第12集',
                type: 'tvseries',
                typeDescription: '电视剧',
                shift: 0,
                imageUrl: 'https://image.example.test/101.jpg',
                url: 'https://video.example.test/12',
            }],
        }),
        jsonResponse({
            errorCode: 0,
            success: true,
            errorMessage: '',
            animes: [{
                animeId: 101,
                bangumiId: 202,
                animeTitle: 'Example Show',
                type: 'tvseries',
                typeDescription: '电视剧',
                imageUrl: '',
                startDate: '2025-01-02T00:00:00Z',
                episodeCount: 12,
                source: 'fixture',
            }],
        }),
        jsonResponse({
            errorCode: 0,
            success: true,
            errorMessage: '',
            bangumi: {
                animeId: 101,
                bangumiId: 202,
                animeTitle: 'Example Show',
                type: 'tvseries',
                typeDescription: '电视剧',
                episodes: [{
                    seasonId: 'season-101',
                    episodeId: 1201,
                    episodeTitle: '第12集',
                    episodeNumber: '1',
                    airDate: '2025-01-02',
                    url: 'https://video.example.test/12',
                }],
            },
        }),
        jsonResponse({
            count: 1,
            videoDuration: 1420.5,
            comments: [{ p: '1.25,1,16777215,user', m: 'hello' }],
        }),
    ]);

    const match = await client.match('Example Show S02E12');
    const search = await client.searchAnime('Example Show 第二季');
    const bangumi = await client.getBangumi('101/source');
    const comments = await client.getComments('1201/item');

    assert.equal(match.ok, true);
    assert.equal(search.ok, true);
    assert.equal(bangumi.ok, true);
    assert.equal(comments.ok, true);
    if (match.ok) {
        assert.equal(match.data.matches[0]?.animeId, '101');
        assert.equal(match.data.matches[0]?.episodeId, '1201');
    }
    if (search.ok) {
        assert.equal(search.data.animes[0]?.bangumiId, '202');
        assert.equal(search.data.animes[0]?.episodeCount, 12);
    }
    if (bangumi.ok) {
        assert.equal(bangumi.data.episodes[0]?.rawIndex, 0);
        assert.equal(bangumi.data.episodes[0]?.episodeId, '1201');
        assert.equal(
            bangumi.data.episodes[0]?.apiEpisodeNumber,
            '1',
            'the upstream list-order number is retained only as explicitly named API metadata',
        );
    }
    if (comments.ok) {
        assert.deepEqual(comments.data.comments.map(({ p, m }) => ({ p, m })), [
            { p: '1.25,1,16777215,user', m: 'hello' },
        ]);
        assert.equal(comments.data.videoDuration, 1420.5);
    }

    assert.equal(calls.length, 4);
    assert.equal(calls[0].url, 'https://danmu.example.test/token/api/v2/match');
    assert.equal(calls[0].init.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].init.body), { fileName: 'Example Show S02E12' });
    assert.deepEqual(Object.keys(JSON.parse(calls[0].init.body)), ['fileName']);
    assert.equal(new Headers(calls[0].init.headers).get('content-type'), 'application/json');
    assert.equal(new Headers(calls[0].init.headers).get('x-liberty-test'), 'client-contract');

    assert.equal(
        calls[1].url,
        `https://danmu.example.test/token/api/v2/search/anime?keyword=${encodeURIComponent('Example Show 第二季')}`,
    );
    assert.equal(calls[1].init.method, 'GET');
    assert.equal(calls[1].init.body, undefined);

    assert.equal(calls[2].url, 'https://danmu.example.test/token/api/v2/bangumi/101%2Fsource');
    assert.equal(calls[2].init.method, 'GET');
    assert.equal(calls[2].init.body, undefined);

    assert.equal(
        calls[3].url,
        'https://danmu.example.test/token/api/v2/comment/1201%2Fitem?format=json&duration=true',
    );
    assert.equal(calls[3].init.method, 'GET');
    assert.equal(calls[3].init.body, undefined);
});

test('DanmuClient treats an empty comments array as a valid successful response', async () => {
    const { client } = createRecordingClient([
        jsonResponse({ count: 0, comments: [], videoDuration: 0 }),
    ]);

    const result = await client.getComments('empty-episode');

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.count, 0);
    assert.deepEqual(result.data.comments, []);
    assert.equal(result.data.videoDuration, 0);
});

test('DanmuClient preserves absent numeric metadata as unknown instead of zero', async () => {
    const { client } = createRecordingClient([
        jsonResponse({
            success: true,
            animes: [{
                animeId: 101,
                bangumiId: 202,
                animeTitle: 'Example Show',
                type: '',
                typeDescription: '',
                imageUrl: '',
                startDate: '',
                episodeCount: null,
                source: 'fixture',
            }],
        }),
        jsonResponse({ count: null, comments: [{ p: '1,1,1,user', m: 'one' }], videoDuration: null }),
    ]);

    const search = await client.searchAnime('Example');
    const comments = await client.getComments('episode');

    assert.equal(search.ok, true);
    if (search.ok) assert.equal(search.data.animes[0]?.episodeCount, null);
    assert.equal(comments.ok, true);
    if (comments.ok) {
        assert.equal(comments.data.count, 1);
        assert.equal(comments.data.videoDuration, null);
    }
});

test('DanmuClient validates required arguments before issuing HTTP requests', async () => {
    const { client, calls } = createRecordingClient([]);

    assertFailure(await client.match('   '), 'client-error', 400);
    assertFailure(await client.searchAnime(''), 'client-error', 400);
    assertFailure(await client.getBangumi('\t'), 'client-error', 400);
    assertFailure(await client.getComments('\n'), 'client-error', 400);
    assert.equal(calls.length, 0);
});

test('DanmuClient classifies HTTP and API envelope failures', async (t) => {
    await t.test('HTTP 429 and Retry-After', async () => {
        const { client } = createRecordingClient([
            jsonResponse({ error: 'limited' }, 429, { 'retry-after': '3' }),
        ]);
        const result = await client.match('Example S01E01');
        assertFailure(result, 'rate-limited', 429);
        if (!result.ok) assert.equal(result.error.retryAfterMs, 3000);
    });

    await t.test('ordinary HTTP 4xx', async () => {
        const { client } = createRecordingClient([jsonResponse({}, 404)]);
        assertFailure(await client.getBangumi('missing'), 'client-error', 404);
    });

    await t.test('HTTP 5xx', async () => {
        const { client } = createRecordingClient([jsonResponse({}, 503)]);
        assertFailure(await client.searchAnime('Example'), 'server-error', 503);
    });

    await t.test('HTTP 200 failure envelope', async () => {
        const { client } = createRecordingClient([
            jsonResponse({ success: false, errorCode: 429, errorMessage: 'Too many requests' }),
        ]);
        const result = await client.match('Example S01E01');
        assertFailure(result, 'rate-limited', 429);
        if (!result.ok) assert.equal(result.error.message, 'Too many requests');
    });

    await t.test('comment failure envelope keeps its rate-limit meaning', async () => {
        const { client } = createRecordingClient([
            jsonResponse({
                success: false,
                errorCode: 429,
                errorMessage: 'Comment quota exceeded',
                comments: [],
            }),
        ]);
        const result = await client.getComments('episode');
        assertFailure(result, 'rate-limited', 429);
    });
});

test('DanmuClient distinguishes network errors, caller aborts and timeouts', async (t) => {
    await t.test('network failure', async () => {
        const { client } = createRecordingClient([
            async () => {
                throw new TypeError('fixture offline');
            },
        ]);
        const result = await client.searchAnime('Example');
        assertFailure(result, 'network-error', null);
        if (!result.ok) assert.match(result.error.message, /fixture offline/);
    });

    await t.test('caller abort even when fetch ignores AbortSignal', async () => {
        const { client } = createRecordingClient([
            async () => new Promise(() => undefined),
        ], { timeoutMs: 1_000 });
        const controller = new AbortController();
        const pending = client.getBangumi('101', { signal: controller.signal });
        controller.abort('test abort');
        assertFailure(await pending, 'aborted', null);
    });

    await t.test('already-aborted caller signal', async () => {
        const { client } = createRecordingClient([
            async () => new Promise(() => undefined),
        ], { timeoutMs: 1_000 });
        const controller = new AbortController();
        controller.abort('already aborted');
        assertFailure(await client.getComments('1201', { signal: controller.signal }), 'aborted', null);
    });

    await t.test('timeout even when fetch ignores AbortSignal', async () => {
        const { client } = createRecordingClient([
            async () => new Promise(() => undefined),
        ], { timeoutMs: 10 });
        assertFailure(await client.match('Example S01E01'), 'timeout', null);
    });

    await t.test('timeout also covers a response body that never finishes', async () => {
        const { client } = createRecordingClient([
            async () => ({
                ok: true,
                status: 200,
                headers: new Headers(),
                text: async () => new Promise(() => undefined),
            }),
        ], { timeoutMs: 10 });
        assertFailure(await client.getComments('episode'), 'timeout', null);
    });
});

test('DanmuClient reports invalid JSON, empty bodies and invalid endpoint schemas', async (t) => {
    await t.test('invalid JSON', async () => {
        const { client } = createRecordingClient([
            new Response('{not-json', { status: 200, headers: { 'content-type': 'application/json' } }),
        ]);
        assertFailure(await client.match('Example S01E01'), 'invalid-response', 200);
    });

    await t.test('empty response body', async () => {
        const { client } = createRecordingClient([new Response('', { status: 200 })]);
        assertFailure(await client.searchAnime('Example'), 'invalid-response', 200);
    });

    const invalidCases = [
        ['match schema', 'match', { success: true, isMatched: 'yes', matches: [] }],
        ['matched response without a candidate', 'match', { success: true, isMatched: true, matches: [] }],
        ['search candidate schema', 'searchAnime', {
            success: true,
            animes: [{ animeId: '', animeTitle: 'Missing ID' }],
        }],
        ['bangumi episode schema', 'getBangumi', {
            success: true,
            bangumi: {
                animeId: '101',
                animeTitle: 'Example',
                episodes: [{ episodeId: '', episodeTitle: '第1集' }],
            },
        }],
        ['comment item schema', 'getComments', {
            count: 1,
            comments: [{ p: 1.25, m: 'wrong p type' }],
        }],
        ['comment numeric metadata schema', 'getComments', {
            count: true,
            videoDuration: [],
            comments: [],
        }],
        ['whitespace-only search identity', 'searchAnime', {
            success: true,
            animes: [{ animeId: '   ', animeTitle: 'Example' }],
        }],
    ];

    for (const [name, method, payload] of invalidCases) {
        await t.test(name, async () => {
            const { client } = createRecordingClient([jsonResponse(payload)]);
            const result = method === 'match'
                ? await client.match('Example S01E01')
                : method === 'searchAnime'
                    ? await client.searchAnime('Example')
                    : method === 'getBangumi'
                        ? await client.getBangumi('101')
                        : await client.getComments('1201');
            assertFailure(result, 'invalid-response', 200);
        });
    }
});

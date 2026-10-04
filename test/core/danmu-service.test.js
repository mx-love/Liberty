import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
    DanmuClient,
    DanmuService,
    parseEpisode,
} from '../../js/liberty-core.js';

const fixture = JSON.parse(await readFile(
    new URL('../fixtures/danmaku/danmu-core-cases.json', import.meta.url),
    'utf8',
));

function jsonResponse(value, status = 200, headers = {}) {
    return new Response(JSON.stringify(value), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
    });
}

function recordingService(responses) {
    const queue = [...responses];
    const calls = [];
    const client = new DanmuClient({
        baseUrl: 'https://danmu.example.test/private-prefix',
        timeoutMs: 100,
        async fetch(url, init) {
            calls.push({ url: String(url), init });
            const next = queue.shift();
            if (typeof next === 'function') return next(url, init);
            if (!next) throw new Error(`Unexpected request: ${url}`);
            return next;
        },
    });
    return { service: new DanmuService({ client }), calls };
}

function canonicalEpisode(mediaId, label, index, overrides = {}) {
    const parsed = parseEpisode(label);
    return {
        canonicalEpisodeId: `${mediaId}:episode:${index}:${label}`,
        mediaId,
        contentType: parsed.contentType,
        seasonNumber: parsed.seasonNumber,
        episodeNumber: parsed.episodeNumber,
        absoluteNumber: parsed.absoluteNumber,
        airDate: parsed.airDate,
        episodeTitle: label,
        part: parsed.part,
        identityState: 'supported',
        evidence: [],
        ...overrides,
    };
}

function canonicalMedia(options = {}) {
    return {
        mediaId: 'media:orbital-patrol',
        mediaType: 'series',
        canonicalTitle: 'Orbital Patrol',
        aliases: [],
        releaseYear: 2025,
        season: 1,
        directors: [],
        actors: [],
        externalIds: {},
        evidence: [],
        identityState: 'supported',
        ...options,
    };
}

function sourceEpisode(target, rawIndex, rawEpisodeName = target.episodeTitle) {
    return {
        sourceKey: 'fixture-source',
        vodId: 'fixture-vod',
        playGroup: 'fixture-line',
        playGroupIndex: 0,
        rawIndex,
        rawEpisodeName,
        displayName: rawEpisodeName,
        rawEntry: `${rawEpisodeName}$https://media.example.test/${rawIndex}.m3u8`,
        playUrl: `https://media.example.test/${rawIndex}.m3u8`,
        parsedEpisodeInfo: parseEpisode(rawEpisodeName),
        canonicalEpisodeId: target.canonicalEpisodeId,
        mappingState: 'mapped',
        mappingEvidence: ['fixture canonical mapping'],
    };
}

function resolveInput(options = {}) {
    const media = options.media ?? canonicalMedia();
    const labels = options.labels ?? ['E11', 'E12', 'E13'];
    const episodes = options.episodes ?? labels.map((label, index) => canonicalEpisode(
        media.mediaId,
        label,
        index,
        { seasonNumber: media.season },
    ));
    const targetIndex = options.targetIndex ?? 1;
    const episode = options.episode ?? episodes[targetIndex];
    return {
        media: { ...media, episodes },
        episode,
        mediaEpisodes: episodes,
        sourceEpisode: options.source ?? sourceEpisode(
            episode,
            options.rawIndex ?? targetIndex,
            options.rawEpisodeName ?? episode.episodeTitle,
        ),
        ...(options.manualCandidate ? { manualCandidate: options.manualCandidate } : {}),
    };
}

function matchResponse({
    animeId = 'anime-orbital-s1',
    animeTitle = 'Orbital Patrol S01',
    episodeId = 'match-episode',
    episodeTitle = 'E12',
    matches = undefined,
    isMatched = true,
} = {}) {
    return jsonResponse({
        success: true,
        isMatched,
        matches: matches ?? (isMatched ? [{
            animeId,
            animeTitle,
            episodeId,
            episodeTitle,
            type: 'drama',
            typeDescription: 'series',
            shift: 0,
            imageUrl: '',
            url: '',
        }] : []),
    });
}

function searchResponse(animes) {
    return jsonResponse({ success: true, animes });
}

function searchAnime({
    animeId = 'anime-search',
    animeTitle = 'Long Runner',
    startDate = '2025-01-01',
    type = 'anime',
    typeDescription = 'anime',
} = {}) {
    return {
        animeId,
        bangumiId: animeId,
        animeTitle,
        type,
        typeDescription,
        imageUrl: '',
        startDate,
        episodeCount: 0,
        source: 'fixture',
    };
}

function bangumiResponse(animeId, animeTitle, episodes) {
    return jsonResponse({
        success: true,
        bangumi: {
            animeId,
            bangumiId: animeId,
            animeTitle,
            type: 'drama',
            typeDescription: 'series',
            episodes: episodes.map((episode, index) => ({
                seasonId: `season-${animeId}`,
                episodeId: episode.episodeId,
                episodeTitle: episode.episodeTitle,
                episodeNumber: episode.apiEpisodeNumber ?? String(index + 1),
                airDate: episode.airDate ?? '',
                url: '',
            })),
        },
    });
}

function commentsResponse(comments = [{ p: '1,1,16777215,user', m: 'fixture comment' }]) {
    return jsonResponse({ count: comments.length, comments, videoDuration: 1200 });
}

test('the formal Stage D fixture enumerates regression cases A through R', () => {
    assert.deepEqual(Object.keys(fixture.cases), [...'ABCDEFGHIJKLMNOPQR']);
});

test('known season E12 uses one reliable match query and ignores rawIndex/API list numbers', async () => {
    const caseB = fixture.cases.B;
    const { service, calls } = recordingService([
        matchResponse(),
        bangumiResponse('anime-orbital-s1', 'Orbital Patrol S01', caseB.danmuEpisodes),
        commentsResponse(),
    ]);

    const result = await service.resolve(resolveInput({
        rawIndex: caseB.source.rawIndex,
        rawEpisodeName: caseB.source.rawEpisodeName,
    }));

    assert.equal(result.state, 'success');
    assert.equal(result.binding?.danmuEpisodeId, caseB.expectedEpisodeId);
    assert.equal(result.binding?.canonicalEpisodeId, result.episodeResolution === null
        ? null
        : resolveInput().episode.canonicalEpisodeId);
    assert.equal(calls.length, 3);
    assert.equal(calls[0].url, 'https://danmu.example.test/private-prefix/api/v2/match');
    assert.deepEqual(JSON.parse(calls[0].init.body), {
        fileName: 'Orbital Patrol S01E12',
    });
    assert.match(calls[2].url, /\/api\/v2\/comment\/dm-e12\?/u);
});

test('unknown season searches by the preserved title and never manufactures S01', async () => {
    const media = canonicalMedia({
        mediaId: 'media:long-runner',
        mediaType: 'anime',
        canonicalTitle: 'Long Runner Year Arc',
        season: null,
    });
    const episodes = [canonicalEpisode(media.mediaId, 'E125', 0)];
    const { service, calls } = recordingService([
        searchResponse([searchAnime({ animeTitle: 'Long Runner Year Arc' })]),
        bangumiResponse('anime-search', 'Long Runner Year Arc', [
            { episodeId: 'dm-e125', episodeTitle: 'E125', apiEpisodeNumber: '1' },
        ]),
        commentsResponse(),
    ]);

    const result = await service.resolve(resolveInput({
        media,
        episodes,
        episode: episodes[0],
        targetIndex: 0,
        rawIndex: 7,
        rawEpisodeName: 'E125',
    }));

    assert.equal(result.state, 'success');
    assert.equal(result.binding?.danmuEpisodeId, 'dm-e125');
    assert.match(calls[0].url, /\/api\/v2\/search\/anime\?keyword=Long%20Runner%20Year%20Arc$/u);
    assert.ok(calls.every(({ url, init }) => !url.includes('S01') && !String(init.body ?? '').includes('S01')));
});

test('candidate conflict, candidate ambiguity and no candidates stop before bangumi/comments', async (t) => {
    await t.test('explicit season conflict', async () => {
        const media = canonicalMedia({ season: 2 });
        const episodes = ['S02E12'].map((label, index) => canonicalEpisode(media.mediaId, label, index));
        const { service, calls } = recordingService([
            matchResponse({ animeTitle: 'Orbital Patrol S01' }),
        ]);
        const result = await service.resolve(resolveInput({ media, episodes, targetIndex: 0 }));
        assert.equal(result.state, 'candidate-conflict');
        assert.equal(calls.length, 1);
    });

    await t.test('two viable works', async () => {
        const media = canonicalMedia({ season: null });
        const { service, calls } = recordingService([
            searchResponse([
                searchAnime({
                    animeId: 'ambiguous-a',
                    animeTitle: 'Orbital Patrol',
                    type: 'drama',
                    typeDescription: 'series',
                }),
                searchAnime({
                    animeId: 'ambiguous-b',
                    animeTitle: 'Orbital Patrol',
                    type: 'drama',
                    typeDescription: 'series',
                }),
            ]),
        ]);
        const result = await service.resolve(resolveInput({ media }));
        assert.equal(result.state, 'candidate-uncertain');
        assert.equal(calls.length, 1);
    });

    await t.test('empty match set', async () => {
        const { service, calls } = recordingService([matchResponse({ isMatched: false })]);
        const result = await service.resolve(resolveInput());
        assert.equal(result.state, 'candidate-not-found');
        assert.equal(calls.length, 1);
    });
});

test('episode ambiguity and movie main-feature identity never fall back to list position', async (t) => {
    await t.test('duplicate E12', async () => {
        const { service, calls } = recordingService([
            matchResponse(),
            bangumiResponse('anime-orbital-s1', 'Orbital Patrol S01', fixture.cases.Q.danmuEpisodes),
        ]);
        const result = await service.resolve(resolveInput());
        assert.equal(result.state, 'episode-uncertain');
        assert.equal(result.binding, null);
        assert.equal(calls.length, 2);
    });

    await t.test('movie 正片', async () => {
        const media = canonicalMedia({
            mediaId: 'media:one-film',
            mediaType: 'movie',
            canonicalTitle: 'One Film',
            season: null,
        });
        const episodes = [canonicalEpisode(media.mediaId, '正片', 0)];
        const { service, calls } = recordingService([
            searchResponse([searchAnime({
                animeId: 'one-film',
                animeTitle: 'One Film',
                type: 'movie',
                typeDescription: 'movie',
            })]),
            bangumiResponse('one-film', 'One Film', [{ episodeId: 'film-main', episodeTitle: '正片' }]),
        ]);
        const result = await service.resolve(resolveInput({
            media,
            episodes,
            targetIndex: 0,
            rawIndex: 0,
            rawEpisodeName: '正片',
        }));
        assert.equal(result.state, 'episode-uncertain');
        assert.ok(calls.every(({ url, init }) => !url.includes('S01E01') && !String(init.body ?? '').includes('S01E01')));
        assert.equal(calls.length, 2);
    });
});

test('an unknown episode returns episode-uncertain without issuing any HTTP request', async () => {
    const media = canonicalMedia({ season: null });
    const episodes = [canonicalEpisode(media.mediaId, '播放1', 0, {
        contentType: 'unknown',
        episodeNumber: null,
        absoluteNumber: null,
        airDate: null,
        episodeTitle: null,
    })];
    const target = episodes[0];
    const { service, calls } = recordingService([]);
    const result = await service.resolve(resolveInput({
        media,
        episodes,
        episode: target,
        targetIndex: 0,
        source: sourceEpisode(target, 0, '播放1'),
    }));

    assert.equal(result.state, 'episode-uncertain');
    assert.equal(calls.length, 0);
});

test('an unmapped source episode cannot bypass canonical episode resolution', async () => {
    const input = resolveInput();
    const { service, calls } = recordingService([]);
    const result = await service.resolve({
        ...input,
        sourceEpisode: {
            ...input.sourceEpisode,
            canonicalEpisodeId: null,
            mappingState: 'unmapped',
        },
    });

    assert.equal(result.state, 'episode-uncertain');
    assert.equal(result.binding, null);
    assert.equal(calls.length, 0);
});

test('the canonical sequence member, not a duplicate caller object, supplies query identity', async () => {
    const input = resolveInput();
    const { service, calls } = recordingService([
        matchResponse(),
        bangumiResponse('anime-orbital-s1', 'Orbital Patrol S01', [
            { episodeId: 'dm-e12', episodeTitle: 'E12' },
        ]),
        commentsResponse(),
    ]);
    const result = await service.resolve({
        ...input,
        episode: {
            ...input.episode,
            episodeNumber: 2,
            absoluteNumber: 2,
            episodeTitle: 'E2',
        },
    });

    assert.equal(result.state, 'success');
    assert.equal(result.binding?.danmuEpisodeId, 'dm-e12');
    assert.deepEqual(JSON.parse(calls[0].init.body), { fileName: 'Orbital Patrol S01E12' });
});

test('a variety issue with a known season still uses work search, not a fabricated SxxExx', async () => {
    const media = canonicalMedia({
        mediaId: 'media:seasonal-variety',
        mediaType: 'variety',
        canonicalTitle: 'Seasonal Variety',
        season: 1,
    });
    const episodes = [canonicalEpisode(media.mediaId, '第12期', 0, { seasonNumber: 1 })];
    const { service, calls } = recordingService([
        searchResponse([searchAnime({
            animeId: 'seasonal-variety',
            animeTitle: 'Seasonal Variety',
            type: 'variety',
            typeDescription: 'variety',
        })]),
        bangumiResponse('seasonal-variety', 'Seasonal Variety', [
            { episodeId: 'variety-issue-12', episodeTitle: '第12期' },
        ]),
        commentsResponse(),
    ]);
    const result = await service.resolve(resolveInput({
        media,
        episodes,
        episode: episodes[0],
        targetIndex: 0,
        rawIndex: 0,
    }));

    assert.equal(result.state, 'success');
    assert.match(calls[0].url, /\/api\/v2\/search\/anime\?/u);
    assert.ok(calls.every(({ url, init }) => !url.includes('S01E12') && !String(init.body ?? '').includes('S01E12')));
});

test('manual work selection remains a canonical-episode-scoped binding', async () => {
    const manualCandidate = {
        animeId: fixture.cases.R.animeId,
        animeTitle: 'Orbital Patrol',
    };
    const { service, calls } = recordingService([
        bangumiResponse(manualCandidate.animeId, manualCandidate.animeTitle, [
            { episodeId: fixture.cases.R.episodeId, episodeTitle: 'E12' },
        ]),
        commentsResponse(),
    ]);

    const result = await service.resolve(resolveInput({ manualCandidate }));

    assert.equal(result.state, 'success');
    assert.equal(result.binding?.selectedBy, fixture.cases.R.selectedBy);
    assert.equal(result.binding?.scope, fixture.cases.R.scope);
    assert.equal(result.binding?.danmuEpisodeId, fixture.cases.R.episodeId);
    assert.equal(calls.length, 2, 'manual selection bypasses automatic match/search but still resolves the episode');
    assert.match(calls[0].url, /\/api\/v2\/bangumi\/manual-anime$/u);
});

test('binding resolution is observable before comments and does not probe comments for correctness', async () => {
    const { service, calls } = recordingService([
        matchResponse(),
        bangumiResponse('anime-orbital-s1', 'Orbital Patrol S01', [
            { episodeId: 'dm-e12', episodeTitle: 'E12' },
        ]),
    ]);

    const result = await service.resolveBinding(resolveInput());

    assert.equal(result.state, 'binding-supported');
    assert.equal(result.binding?.danmuEpisodeId, 'dm-e12');
    assert.deepEqual(result.comments, []);
    assert.equal(calls.length, 2);
});

test('empty comments preserve the binding and return comments-empty', async () => {
    const { service } = recordingService([
        matchResponse(),
        bangumiResponse('anime-orbital-s1', 'Orbital Patrol S01', [
            { episodeId: 'dm-e12', episodeTitle: 'E12' },
        ]),
        commentsResponse([]),
    ]);

    const result = await service.resolve(resolveInput());

    assert.equal(result.state, fixture.cases.K.expectedState);
    assert.equal(result.binding?.danmuEpisodeId, 'dm-e12');
    assert.deepEqual(result.comments, []);
    assert.equal(result.error, null);
});

test('comment transport failures preserve a valid binding and retain precise error states', async (t) => {
    const failures = [
        ['rate limit', jsonResponse({}, 429), fixture.cases.L.expectedState],
        ['network', async () => { throw new TypeError('fixture offline'); }, fixture.cases.M.expectedState],
        ['server', jsonResponse({}, 500), fixture.cases.N.expectedState],
        ['invalid schema', jsonResponse({ count: 0 }), fixture.cases.O.expectedState],
        ['timeout', async () => new Promise(() => undefined), 'timeout'],
    ];

    for (const [name, failure, expectedState] of failures) {
        await t.test(name, async () => {
            const { service } = recordingService([
                matchResponse(),
                bangumiResponse('anime-orbital-s1', 'Orbital Patrol S01', [
                    { episodeId: 'dm-e12', episodeTitle: 'E12' },
                ]),
                failure,
            ]);
            const result = await service.resolve(resolveInput());
            assert.equal(result.state, expectedState);
            assert.equal(result.binding?.danmuEpisodeId, 'dm-e12');
            assert.equal(result.comments.length, 0);
            assert.notEqual(result.error, null);
        });
    }
});

test('source/canonical conflicts are rejected before network access', async () => {
    const input = resolveInput();
    const { service, calls } = recordingService([]);
    const result = await service.resolve({
        ...input,
        sourceEpisode: {
            ...input.sourceEpisode,
            canonicalEpisodeId: input.mediaEpisodes[0].canonicalEpisodeId,
        },
    });

    assert.equal(result.state, 'episode-rejected');
    assert.equal(calls.length, 0);
});

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
        ...(Object.hasOwn(options, 'manualEpisodeId')
            ? { manualEpisodeId: options.manualEpisodeId }
            : {}),
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

function commentsResponse(
    comments = [{ p: '1,1,16777215,user', m: 'fixture comment' }],
    videoDuration = 1200,
) {
    return jsonResponse({ count: comments.length, comments, videoDuration });
}

function matchCandidate({
    animeId,
    animeTitle = 'Orbital Patrol S01',
    episodeId = `${animeId}-match`,
    episodeTitle = 'E12',
    type = 'drama',
    typeDescription = 'series',
} = {}) {
    return {
        animeId,
        animeTitle,
        episodeId,
        episodeTitle,
        type,
        typeDescription,
        shift: 0,
        imageUrl: '',
        url: '',
    };
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
    assert.equal(result.videoDuration, 1200);
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

test('manual episode confirmation can only narrow identity-compatible candidates', async (t) => {
    const manualCandidate = {
        animeId: 'manual-duplicate-work',
        animeTitle: 'Orbital Patrol S01',
    };

    await t.test('duplicate E12 remains uncertain until one concrete episode is confirmed', async () => {
        const { service, calls } = recordingService([
            bangumiResponse(manualCandidate.animeId, manualCandidate.animeTitle, [
                { episodeId: 'duplicate-e12-a', episodeTitle: 'E12' },
                { episodeId: 'duplicate-e12-b', episodeTitle: '第12集' },
            ]),
        ]);

        const result = await service.resolve(resolveInput({ manualCandidate }));

        assert.equal(result.state, 'episode-uncertain');
        assert.equal(result.binding, null);
        assert.deepEqual(
            result.episodeResolution?.candidates.map(({ episodeId }) => episodeId),
            ['duplicate-e12-a', 'duplicate-e12-b'],
        );
        assert.equal(calls.length, 1, 'uncertain episode resolution must not probe comments');
    });

    await t.test('an explicit compatible episode selects exactly that opaque ID', async () => {
        const { service, calls } = recordingService([
            bangumiResponse(manualCandidate.animeId, manualCandidate.animeTitle, [
                { episodeId: 'duplicate-e12-a', episodeTitle: 'E12' },
                { episodeId: 'duplicate-e12-b', episodeTitle: '第12集' },
            ]),
            commentsResponse(),
        ]);

        const result = await service.resolve(resolveInput({
            manualCandidate,
            manualEpisodeId: 'duplicate-e12-b',
        }));

        assert.equal(result.state, 'success');
        assert.equal(result.binding?.danmuEpisodeId, 'duplicate-e12-b');
        assert.equal(result.binding?.selectedBy, 'manual');
        assert.equal(result.episodeResolution?.state, 'supported');
        assert.equal(result.episodeResolution?.selected?.episodeId, 'duplicate-e12-b');
        assert.match(calls[1].url, /\/api\/v2\/comment\/duplicate-e12-b\?/u);
        assert.ok(calls.every(({ url }) => !url.includes('duplicate-e12-a?')));
    });

    await t.test('manual episode without a manual work is rejected before HTTP', async () => {
        const { service, calls } = recordingService([]);

        const result = await service.resolve(resolveInput({
            manualEpisodeId: 'duplicate-e12-a',
        }));

        assert.equal(result.state, 'episode-rejected');
        assert.equal(result.binding, null);
        assert.match(result.reason, /requires an explicitly selected danmu work/iu);
        assert.equal(calls.length, 0);
    });

    await t.test('an episode ID absent from the selected work is rejected before comments', async () => {
        const { service, calls } = recordingService([
            bangumiResponse(manualCandidate.animeId, manualCandidate.animeTitle, [
                { episodeId: 'real-e12', episodeTitle: 'E12' },
            ]),
        ]);

        const result = await service.resolve(resolveInput({
            manualCandidate,
            manualEpisodeId: 'not-in-bangumi',
        }));

        assert.equal(result.state, 'episode-rejected');
        assert.equal(result.binding, null);
        assert.match(result.reason, /not present in the selected work/iu);
        assert.equal(calls.length, 1);
    });

    await t.test('a present but identity-incompatible episode cannot be forced', async () => {
        const { service, calls } = recordingService([
            bangumiResponse(manualCandidate.animeId, manualCandidate.animeTitle, [
                { episodeId: 'wrong-e11', episodeTitle: 'E11' },
                { episodeId: 'right-e12', episodeTitle: 'E12' },
            ]),
        ]);

        const result = await service.resolve(resolveInput({
            manualCandidate,
            manualEpisodeId: 'wrong-e11',
        }));

        assert.equal(result.state, 'episode-rejected');
        assert.equal(result.binding, null);
        assert.match(result.reason, /not an identity-compatible candidate/iu);
        assert.equal(calls.length, 1);
    });

    await t.test('manual confirmation cannot override an explicit season conflict', async () => {
        const media = canonicalMedia({ season: 2 });
        const episodes = [canonicalEpisode(media.mediaId, 'S02E12', 0)];
        const seasonTwoCandidate = {
            animeId: 'manual-season-two',
            animeTitle: 'Orbital Patrol S02',
        };
        const { service, calls } = recordingService([
            bangumiResponse(seasonTwoCandidate.animeId, seasonTwoCandidate.animeTitle, [
                { episodeId: 'wrong-season-e12', episodeTitle: 'S01E12' },
            ]),
        ]);

        const result = await service.resolve(resolveInput({
            media,
            episodes,
            episode: episodes[0],
            targetIndex: 0,
            manualCandidate: seasonTwoCandidate,
            manualEpisodeId: 'wrong-season-e12',
        }));

        assert.equal(result.state, 'episode-rejected');
        assert.equal(result.binding, null);
        assert.match(result.reason, /cannot override an identity conflict/iu);
        assert.equal(result.episodeResolution?.state, 'rejected');
        assert.equal(calls.length, 1);
    });
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
    assert.equal(result.videoDuration, 1200);
    assert.equal(result.error, null);
});

test('provider resolution validates each independently supported work before selecting comments', async () => {
    const candidates = [
        matchCandidate({ animeId: 'provider-empty' }),
        matchCandidate({ animeId: 'provider-comments' }),
    ];
    const { service, calls } = recordingService([
        matchResponse({ matches: candidates }),
        bangumiResponse('provider-empty', 'Orbital Patrol S01', [
            { episodeId: 'empty-e12', episodeTitle: 'E12' },
        ]),
        commentsResponse([]),
        bangumiResponse('provider-comments', 'Orbital Patrol S01', [
            { episodeId: 'comments-e12', episodeTitle: 'E12' },
        ]),
        commentsResponse([{ p: '1,1,16777215,user', m: 'provider B comment' }]),
    ]);

    const result = await service.resolveProviders(resolveInput());

    assert.equal(result.state, 'success');
    assert.equal(result.binding?.danmuAnimeId, 'provider-comments');
    assert.equal(result.binding?.danmuEpisodeId, 'comments-e12');
    assert.equal(result.comments.length, 1);
    assert.deepEqual(
        calls.filter(({ url }) => url.includes('/api/v2/bangumi/')).map(({ url }) => url.split('/').at(-1)),
        ['provider-empty', 'provider-comments'],
    );
    assert.deepEqual(
        calls.filter(({ url }) => url.includes('/api/v2/comment/')).map(({ url }) => /comment\/([^?]+)/u.exec(url)?.[1]),
        ['empty-e12', 'comments-e12'],
    );
});

test('provider resolution returns the stable first binding when every supported provider is empty', async () => {
    const candidates = [
        matchCandidate({ animeId: 'provider-first-empty' }),
        matchCandidate({ animeId: 'provider-second-empty' }),
    ];
    const { service, calls } = recordingService([
        matchResponse({ matches: candidates }),
        bangumiResponse('provider-first-empty', 'Orbital Patrol S01', [
            { episodeId: 'first-empty-e12', episodeTitle: 'E12' },
        ]),
        commentsResponse([]),
        bangumiResponse('provider-second-empty', 'Orbital Patrol S01', [
            { episodeId: 'second-empty-e12', episodeTitle: 'E12' },
        ]),
        commentsResponse([]),
    ]);

    const result = await service.resolveProviders(resolveInput());

    assert.equal(result.state, 'comments-empty');
    assert.equal(result.binding?.danmuAnimeId, 'provider-first-empty');
    assert.equal(result.binding?.danmuEpisodeId, 'first-empty-e12');
    assert.deepEqual(result.comments, []);
    assert.equal(calls.filter(({ url }) => url.includes('/api/v2/comment/')).length, 2);
});

test('provider resolution never probes episodes or comments for uncertain or rejected identities', async (t) => {
    await t.test('title-only identity remains uncertain', async () => {
        const { service, calls } = recordingService([
            matchResponse({
                matches: [matchCandidate({
                    animeId: 'title-only',
                    animeTitle: 'Orbital Patrol',
                    type: '',
                    typeDescription: '',
                })],
            }),
        ]);

        const result = await service.resolveProviders(resolveInput());

        assert.equal(result.state, 'candidate-uncertain');
        assert.equal(calls.length, 1);
        assert.ok(calls.every(({ url }) => !url.includes('/bangumi/') && !url.includes('/comment/')));
    });

    await t.test('explicit season conflict remains rejected', async () => {
        const { service, calls } = recordingService([
            matchResponse({
                matches: [matchCandidate({
                    animeId: 'wrong-season',
                    animeTitle: 'Orbital Patrol S02',
                })],
            }),
        ]);

        const result = await service.resolveProviders(resolveInput());

        assert.equal(result.state, 'candidate-conflict');
        assert.equal(calls.length, 1);
        assert.ok(calls.every(({ url }) => !url.includes('/bangumi/') && !url.includes('/comment/')));
    });
});

test('provider resolution de-duplicates animeId and tries at most five candidates once per transaction', async () => {
    const uniqueIds = Array.from({ length: 7 }, (_, index) => `bounded-provider-${index}`);
    const matches = [
        matchCandidate({ animeId: uniqueIds[0] }),
        matchCandidate({ animeId: uniqueIds[0] }),
        ...uniqueIds.slice(1).map((animeId) => matchCandidate({ animeId })),
    ];
    const bangumiResponses = uniqueIds.slice(0, 5).map((animeId) => bangumiResponse(
        animeId,
        'Orbital Patrol S01',
        [{ episodeId: `${animeId}-e11`, episodeTitle: 'E11' }],
    ));
    const { service, calls } = recordingService([
        matchResponse({ matches }),
        ...bangumiResponses,
    ]);

    const result = await service.resolveProviders(resolveInput());
    const attemptedAnimeIds = calls
        .filter(({ url }) => url.includes('/api/v2/bangumi/'))
        .map(({ url }) => url.split('/').at(-1));

    assert.equal(result.state, 'episode-not-found');
    assert.deepEqual(attemptedAnimeIds, uniqueIds.slice(0, 5));
    assert.equal(new Set(attemptedAnimeIds).size, attemptedAnimeIds.length);
    assert.equal(calls.filter(({ url }) => url.includes('/api/v2/comment/')).length, 0);
});

test('preferredAnimeId is tried first without bypassing identity and episode validation', async () => {
    const candidates = [
        matchCandidate({ animeId: 'provider-default' }),
        matchCandidate({ animeId: 'provider-preferred' }),
    ];
    const { service, calls } = recordingService([
        matchResponse({ matches: candidates }),
        bangumiResponse('provider-preferred', 'Orbital Patrol S01', [
            { episodeId: 'preferred-e12', episodeTitle: 'E12' },
        ]),
        commentsResponse([{ p: '1,1,16777215,user', m: 'preferred provider comment' }]),
    ]);

    const result = await service.resolveProviders(resolveInput(), {
        preferredAnimeId: 'provider-preferred',
    });

    assert.equal(result.state, 'success');
    assert.equal(result.binding?.danmuAnimeId, 'provider-preferred');
    assert.equal(result.binding?.danmuEpisodeId, 'preferred-e12');
    assert.deepEqual(
        calls.filter(({ url }) => url.includes('/api/v2/bangumi/')).map(({ url }) => url.split('/').at(-1)),
        ['provider-preferred'],
    );
    assert.ok(calls.every(({ url }) => !url.includes('/bangumi/provider-default')));
});

test('comment duration remains optional while valid values cross the Service boundary', async (t) => {
    const resolveWithCommentPayload = async (payload) => {
        const { service } = recordingService([
            matchResponse(),
            bangumiResponse('anime-orbital-s1', 'Orbital Patrol S01', [
                { episodeId: 'dm-e12', episodeTitle: 'E12' },
            ]),
            payload,
        ]);
        return service.resolve(resolveInput());
    };

    await t.test('missing duration stays unknown', async () => {
        const result = await resolveWithCommentPayload(jsonResponse({
            count: 1,
            comments: [{ p: '1,1,16777215,user', m: 'fixture comment' }],
        }));
        assert.equal(result.state, 'success');
        assert.equal(result.videoDuration, null);
    });

    await t.test('invalid duration is rejected by the Client boundary', async () => {
        const result = await resolveWithCommentPayload(jsonResponse({
            count: 1,
            videoDuration: [],
            comments: [{ p: '1,1,16777215,user', m: 'fixture comment' }],
        }));
        assert.equal(result.state, 'invalid-response');
        assert.equal(result.videoDuration, null);
        assert.equal(result.binding?.danmuEpisodeId, 'dm-e12');
    });
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

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

function jsonResponse(value, status = 200) {
    return new Response(JSON.stringify(value), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

function serviceWithResponses(responses, options = {}) {
    const queue = [...responses];
    const calls = [];
    const client = new DanmuClient({
        baseUrl: 'https://danmu.example.test/private-prefix',
        timeoutMs: options.timeoutMs ?? 200,
        async fetch(url, init) {
            calls.push({ url: String(url), init });
            const response = queue.shift();
            if (typeof response === 'function') return response(url, init);
            if (response === undefined) throw new Error(`Unexpected request: ${url}`);
            return response;
        },
    });

    return { service: new DanmuService({ client }), calls };
}

function canonicalMedia(overrides = {}) {
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
        ...overrides,
    };
}

function canonicalEpisode(media, label, index, overrides = {}) {
    const parsed = parseEpisode(label, { mediaType: media.mediaType });
    return {
        canonicalEpisodeId: `${media.mediaId}:episode:${index}:${label}`,
        mediaId: media.mediaId,
        contentType: parsed.contentType,
        seasonNumber: parsed.seasonNumber ?? media.season,
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

function resolveInput({
    media: mediaOverrides = {},
    labels = ['E11', 'E12', 'E13'],
    targetIndex = 1,
    rawIndex = targetIndex,
    rawEpisodeName,
} = {}) {
    const media = canonicalMedia(mediaOverrides);
    const episodes = labels.map((label, index) => canonicalEpisode(media, label, index));
    const episode = episodes[targetIndex];
    assert.ok(episode, `Missing fixture target at index ${targetIndex}`);
    const sourceName = rawEpisodeName ?? episode.episodeTitle;

    return {
        media: { ...media, episodes },
        episode,
        mediaEpisodes: episodes,
        sourceEpisode: {
            sourceKey: 'fixture-source',
            vodId: 'fixture-vod',
            playGroup: 'fixture-line',
            playGroupIndex: 0,
            rawIndex,
            rawEpisodeName: sourceName,
            displayName: sourceName,
            rawEntry: `${sourceName}$https://media.example.test/${rawIndex}.m3u8`,
            playUrl: `https://media.example.test/${rawIndex}.m3u8`,
            parsedEpisodeInfo: parseEpisode(sourceName, { mediaType: media.mediaType }),
            canonicalEpisodeId: episode.canonicalEpisodeId,
            mappingState: 'mapped',
            mappingEvidence: ['scenario fixture mapping'],
        },
    };
}

function matchCandidate({
    animeId = 'anime-orbital-s1',
    animeTitle = 'Orbital Patrol S01',
    episodeId = 'match-e12',
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

function matchResponse(matches = [matchCandidate()]) {
    return jsonResponse({
        success: true,
        isMatched: matches.length > 0,
        matches,
    });
}

function searchAnime({
    animeId = 'anime-search',
    animeTitle,
    startDate = '2025-01-01',
    type = 'drama',
    typeDescription = 'series',
} = {}) {
    return {
        animeId,
        bangumiId: animeId,
        animeTitle,
        type,
        typeDescription,
        imageUrl: '',
        startDate,
        episodeCount: null,
        source: 'scenario-fixture',
    };
}

function searchResponse(animes) {
    return jsonResponse({ success: true, animes });
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
                // Deliberately defaults to list order. The service must not use
                // this transport field as the real episode identity.
                episodeNumber: episode.apiEpisodeNumber ?? String(index + 1),
                airDate: episode.airDate ?? '',
                url: '',
            })),
        },
    });
}

function commentsResponse(comments = [{ p: '1,1,16777215,user', m: 'scenario comment' }]) {
    return jsonResponse({ count: comments.length, comments, videoDuration: 1200 });
}

function requestPath(call) {
    return new URL(call.url).pathname;
}

test('the formal Service matrix enumerates scenarios A through V', () => {
    assert.deepEqual(Object.keys(fixture.serviceMatrix), [...'ABCDEFGHIJKLMNOPQRSTUV']);
});

test('C: reordered danmu episodes still bind E12 by identity, not list order', async () => {
    const caseB = fixture.cases.B;
    const input = resolveInput({
        labels: ['E11', 'E12', 'E13'],
        targetIndex: 1,
        rawIndex: caseB.source.rawIndex,
        rawEpisodeName: caseB.source.rawEpisodeName,
    });
    const { service, calls } = serviceWithResponses([
        matchResponse(),
        bangumiResponse('anime-orbital-s1', 'Orbital Patrol S01', [
            { episodeId: 'dm-e13', episodeTitle: 'E13', apiEpisodeNumber: '1' },
            { episodeId: caseB.expectedEpisodeId, episodeTitle: 'E12', apiEpisodeNumber: '2' },
            { episodeId: 'dm-e11', episodeTitle: 'E11', apiEpisodeNumber: '3' },
        ]),
        commentsResponse(),
    ]);

    const result = await service.resolve(input);

    assert.equal(result.state, 'success');
    assert.equal(result.binding?.danmuEpisodeId, caseB.expectedEpisodeId);
    assert.equal(result.binding?.danmuEpisodeTitle, 'E12');
    assert.match(calls[2].url, /\/api\/v2\/comment\/dm-e12\?/u);
});

test('E: same title with an explicit conflicting year is rejected before bangumi', async () => {
    const caseD = fixture.cases.D;
    const input = resolveInput({
        media: {
            mediaId: 'media:the-return:2011',
            canonicalTitle: caseD.media.title,
            releaseYear: caseD.media.year,
            season: null,
        },
    });
    const { service, calls } = serviceWithResponses([
        searchResponse([searchAnime({
            animeId: caseD.candidate.animeId,
            animeTitle: caseD.candidate.animeTitle,
            startDate: `${caseD.candidate.year}-01-01`,
        })]),
    ]);

    const result = await service.resolve(input);

    assert.equal(result.state, 'candidate-conflict');
    assert.equal(result.candidateResolution?.state, caseD.expectedState);
    assert.equal(result.binding, null);
    assert.equal(calls.length, 1);
    assert.match(requestPath(calls[0]), /\/api\/v2\/search\/anime$/u);
});

test('F: a source sequence without SP still maps the following regular episode', async () => {
    const caseE = fixture.cases.E;
    const input = resolveInput({
        labels: caseE.sourceEpisodes,
        targetIndex: caseE.sourceEpisodes.indexOf(caseE.target),
    });
    const run = serviceWithResponses([
        matchResponse(),
        bangumiResponse('anime-orbital-s1', 'Orbital Patrol S01', caseE.danmuEpisodes.map((title) => ({
            episodeId: `dm-${title.toLowerCase()}`,
            episodeTitle: title,
        }))),
        commentsResponse(),
    ]);
    const result = await run.service.resolve(input);

    assert.equal(result.state, 'success');
    assert.equal(result.binding?.danmuEpisodeTitle, caseE.expectedEpisodeTitle);
    assert.equal(result.binding?.danmuEpisodeId, 'dm-e3');
    assert.equal(run.calls.length, 3);
});

test('G: a source-only interview neither shifts E2 nor maps to a regular danmu episode', async (t) => {
    const labels = ['E1', '采访', 'E2'];

    await t.test('the later regular episode keeps its explicit E2 identity', async () => {
        const { service } = serviceWithResponses([
            matchResponse([matchCandidate({ episodeId: 'match-e2', episodeTitle: 'E2' })]),
            bangumiResponse('anime-orbital-s1', 'Orbital Patrol S01', [
                { episodeId: 'dm-e1', episodeTitle: 'E1' },
                { episodeId: 'dm-e2', episodeTitle: 'E2' },
            ]),
            commentsResponse(),
        ]);

        const result = await service.resolve(resolveInput({ labels, targetIndex: 2 }));

        assert.equal(result.state, 'success');
        assert.equal(result.binding?.danmuEpisodeId, 'dm-e2');
    });

    await t.test('the interview is uncertain without issuing a comment request', async () => {
        const { service, calls } = serviceWithResponses([]);

        const result = await service.resolve(resolveInput({ labels, targetIndex: 1 }));

        assert.equal(result.state, 'episode-uncertain');
        assert.equal(result.binding, null);
        assert.equal(calls.length, 0);
    });
});

test('H: a sequence beginning at E11 resolves E12 without a positional offset', async () => {
    const caseG = fixture.cases.G;
    const input = resolveInput({
        labels: caseG.sourceEpisodes,
        targetIndex: caseG.sourceEpisodes.indexOf(caseG.target),
        rawIndex: 1,
    });
    const { service, calls } = serviceWithResponses([
        matchResponse(),
        bangumiResponse('anime-orbital-s1', 'Orbital Patrol S01', caseG.danmuEpisodes.map((title) => ({
            episodeId: `dm-${title.toLowerCase()}`,
            episodeTitle: title,
        }))),
        commentsResponse(),
    ]);

    const result = await service.resolve(input);

    assert.equal(result.state, 'success');
    assert.equal(result.binding?.danmuEpisodeTitle, caseG.expectedEpisodeTitle);
    assert.equal(result.binding?.danmuEpisodeId, 'dm-e12');
    assert.match(calls[2].url, /\/comment\/dm-e12\?/u);
});

test('I: E125 is resolved from its title even when the API position says one', async () => {
    const caseH = fixture.cases.H;
    const input = resolveInput({
        media: {
            mediaId: 'media:long-runner',
            mediaType: 'anime',
            canonicalTitle: 'Long Runner',
            season: null,
        },
        labels: ['E124', 'E125', 'E126'],
        targetIndex: 1,
        rawIndex: caseH.source.rawIndex,
        rawEpisodeName: caseH.source.rawEpisodeName,
    });
    const { service } = serviceWithResponses([
        searchResponse([searchAnime({
            animeId: 'anime-long-runner',
            animeTitle: 'Long Runner',
            type: 'anime',
            typeDescription: 'anime',
        })]),
        bangumiResponse('anime-long-runner', 'Long Runner', caseH.danmuEpisodes),
        commentsResponse(),
    ]);

    const result = await service.resolve(input);

    assert.equal(result.state, 'success');
    assert.equal(result.binding?.danmuEpisodeId, caseH.expectedEpisodeId);
    assert.equal(result.binding?.danmuEpisodeTitle, 'E125');
});

test('J: a variety broadcast date resolves as a date, not a huge episode number', async () => {
    const caseI = fixture.cases.I;
    const input = resolveInput({
        media: {
            mediaId: 'media:weekly-variety',
            mediaType: 'variety',
            canonicalTitle: 'Weekly Variety',
            season: null,
        },
        labels: ['2025-09-24', '2025-10-01'],
        targetIndex: 1,
        rawIndex: caseI.source.rawIndex,
        rawEpisodeName: caseI.source.rawEpisodeName,
    });
    const { service, calls } = serviceWithResponses([
        searchResponse([searchAnime({
            animeId: 'anime-weekly-variety',
            animeTitle: 'Weekly Variety',
            type: 'variety',
            typeDescription: 'variety',
        })]),
        bangumiResponse('anime-weekly-variety', 'Weekly Variety', [
            { episodeId: caseI.expectedEpisodeId, episodeTitle: '第20251001期', apiEpisodeNumber: '1' },
        ]),
        commentsResponse(),
    ]);

    const result = await service.resolve(input);

    assert.equal(result.state, 'success');
    assert.equal(result.binding?.danmuEpisodeId, caseI.expectedEpisodeId);
    assert.equal(result.episodeResolution?.selected?.apiEpisodeNumber, '1');
    assert.match(calls[2].url, /\/comment\/dm-date\?/u);
});

test('L: title-only work evidence cannot be promoted to a verified binding', async () => {
    const input = resolveInput({
        media: {
            mediaId: 'media:title-only',
            canonicalTitle: 'Title Only',
            season: null,
        },
    });
    const { service, calls } = serviceWithResponses([
        searchResponse([searchAnime({
            animeId: 'anime-title-only',
            animeTitle: 'Title Only',
            startDate: '',
            type: '',
            typeDescription: '',
        })]),
    ]);

    const result = await service.resolve(input);

    assert.equal(result.state, 'candidate-uncertain');
    assert.equal(result.candidateResolution?.state, 'uncertain');
    assert.equal(result.candidateResolution?.selected, null);
    assert.notEqual(result.candidateResolution?.state, 'verified');
    assert.equal(result.binding, null);
    assert.equal(calls.length, 1);
});

test('T: caller cancellation propagates through DanmuService as aborted', async () => {
    let notifyStarted;
    let requestSignal;
    const started = new Promise((resolve) => {
        notifyStarted = resolve;
    });
    const { service, calls } = serviceWithResponses([
        async (_url, init) => {
            requestSignal = init.signal;
            notifyStarted();
            return new Promise(() => undefined);
        },
    ], { timeoutMs: 1_000 });
    const controller = new AbortController();
    const pending = service.resolve({ ...resolveInput(), signal: controller.signal });
    await started;
    controller.abort('scenario cancellation');

    const result = await pending;

    assert.equal(result.state, 'aborted');
    assert.equal(result.error?.kind, 'aborted');
    assert.equal(result.binding, null);
    assert.equal(calls.length, 1);
    assert.equal(requestSignal?.aborted, true);
});

test('U: HTTP stages remain match/search -> bangumi -> comments', async (t) => {
    await t.test('success requests comments only after media and episode resolution', async () => {
        const { service, calls } = serviceWithResponses([
            matchResponse(),
            bangumiResponse('anime-orbital-s1', 'Orbital Patrol S01', [
                { episodeId: 'dm-e12', episodeTitle: 'E12' },
            ]),
            commentsResponse(),
        ]);

        const result = await service.resolve(resolveInput());

        assert.equal(result.state, 'success');
        assert.deepEqual(calls.map(requestPath), [
            '/private-prefix/api/v2/match',
            '/private-prefix/api/v2/bangumi/anime-orbital-s1',
            '/private-prefix/api/v2/comment/dm-e12',
        ]);
    });

    await t.test('unconfirmed media stops before bangumi or comments', async () => {
        const { service, calls } = serviceWithResponses([
            searchResponse([searchAnime({
                animeId: 'title-only',
                animeTitle: 'Title Only',
                startDate: '',
                type: '',
                typeDescription: '',
            })]),
        ]);
        const result = await service.resolve(resolveInput({
            media: { canonicalTitle: 'Title Only', season: null },
        }));

        assert.equal(result.state, 'candidate-uncertain');
        assert.equal(calls.length, 1);
        assert.ok(calls.every((call) => !requestPath(call).includes('/bangumi/') && !requestPath(call).includes('/comment/')));
    });

    await t.test('unconfirmed episode stops before comments', async () => {
        const { service, calls } = serviceWithResponses([
            matchResponse(),
            bangumiResponse('anime-orbital-s1', 'Orbital Patrol S01', [
                { episodeId: 'wrong-e2', episodeTitle: 'E2' },
            ]),
        ]);

        const result = await service.resolve(resolveInput());

        assert.equal(result.state, 'episode-not-found');
        assert.deepEqual(calls.map(requestPath), [
            '/private-prefix/api/v2/match',
            '/private-prefix/api/v2/bangumi/anime-orbital-s1',
        ]);
        assert.ok(calls.every((call) => !requestPath(call).includes('/comment/')));
    });
});

test('V: empty comments preserve the correct binding and never probe a wrong candidate', async () => {
    const wrong = matchCandidate({
        animeId: 'anime-orbital-s2',
        animeTitle: 'Orbital Patrol S02',
        episodeId: 'wrong-season-e12',
    });
    const correct = matchCandidate({
        animeId: 'anime-orbital-s1',
        animeTitle: 'Orbital Patrol S01',
        episodeId: 'correct-e12',
    });
    const { service, calls } = serviceWithResponses([
        matchResponse([wrong, correct]),
        bangumiResponse('anime-orbital-s1', 'Orbital Patrol S01', [
            { episodeId: 'correct-e12', episodeTitle: 'E12' },
        ]),
        commentsResponse(fixture.cases.K.comments),
    ]);

    const result = await service.resolve(resolveInput());

    assert.equal(result.state, fixture.cases.K.expectedState);
    assert.equal(result.binding?.danmuAnimeId, 'anime-orbital-s1');
    assert.equal(result.binding?.danmuEpisodeId, 'correct-e12');
    assert.deepEqual(result.comments, []);
    assert.equal(calls.length, 3);
    assert.deepEqual(calls.map(requestPath), [
        '/private-prefix/api/v2/match',
        '/private-prefix/api/v2/bangumi/anime-orbital-s1',
        '/private-prefix/api/v2/comment/correct-e12',
    ]);
    assert.ok(calls.every((call) => !call.url.includes('anime-orbital-s2') && !call.url.includes('wrong-season-e12')));
});

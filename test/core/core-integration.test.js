import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
    AppleCMSAdapter,
    parseTitle,
    resolveEntityIdentity,
    resolveEpisode,
} from '../../js/liberty-core.js';

const fixture = JSON.parse(await readFile(
    new URL('../fixtures/integration/apple-cms-resolution.json', import.meta.url),
    'utf8',
));

async function normalizeThroughAdapter(raw, sourceKey) {
    const adapter = new AppleCMSAdapter({
        sourceKey,
        sourceName: sourceKey,
        baseUrl: 'https://fixture.example/api.php/provide/vod',
    }, {
        now: () => 1,
        fetch: async () => new Response(JSON.stringify({
            page: 1,
            pagecount: 1,
            total: 1,
            list: [raw],
        }), {
            headers: { 'content-type': 'application/json' },
        }),
    });
    return adapter.detail(String(raw.vod_id));
}

function identityInput(record) {
    const parsedTitle = parseTitle(record.rawTitle);
    return {
        recordId: `${record.sourceKey}:${record.vodId}`,
        rawTitle: record.rawTitle,
        parsedTitle,
        aliases: parsedTitle.aliases,
        year: record.parsedYear,
        season: record.parsedSeason ?? undefined,
        mediaType: record.mediaType,
        directors: record.normalizedDirector,
        actors: record.normalizedActors,
        areas: record.rawArea ? [record.rawArea] : [],
        languages: record.rawLanguage ? [record.rawLanguage] : [],
    };
}

function canonicalEpisode(mediaId, sourceEpisode) {
    const parsed = sourceEpisode.parsedEpisodeInfo;
    return {
        canonicalEpisodeId: `${mediaId}:${sourceEpisode.rawEpisodeName}`,
        mediaId,
        contentType: parsed.contentType,
        seasonNumber: parsed.contentType === 'regular' ? 2 : parsed.seasonNumber,
        episodeNumber: parsed.episodeNumber,
        absoluteNumber: parsed.absoluteNumber,
        airDate: parsed.airDate,
        episodeTitle: sourceEpisode.rawEpisodeName,
        part: parsed.part,
        identityState: 'supported',
        evidence: [],
    };
}

test('AppleCMS raw data flows through Source, Identity and Episode resolution without index identity', async () => {
    const [source, matching, conflicting] = await Promise.all([
        normalizeThroughAdapter(fixture.source, 'source-a'),
        normalizeThroughAdapter(fixture.matchingCandidate, 'source-b'),
        normalizeThroughAdapter(fixture.conflictingCandidate, 'source-c'),
    ]);

    assert.deepEqual(
        [source.parsedSeason, matching.parsedSeason, conflicting.parsedSeason],
        [2, 2, 1],
        'Source normalization must reuse the shared Chinese/English season parser',
    );
    assert.deepEqual(
        [source.mediaType, matching.mediaType, conflicting.mediaType],
        ['anime', 'anime', 'anime'],
    );
    assert.equal(source.rawData.vod_name, fixture.source.vod_name);
    assert.equal(source.rawPlaySources.vodPlayUrl, fixture.source.vod_play_url);

    const sourceEpisodes = source.playGroups[0].episodes;
    assert.deepEqual(
        sourceEpisodes.map((episode) => ({
            rawIndex: episode.rawIndex,
            rawName: episode.rawEpisodeName,
            episodeNumber: episode.parsedEpisodeInfo.episodeNumber,
            specialNumber: episode.parsedEpisodeInfo.specialNumber,
        })),
        [
            { rawIndex: 0, rawName: '第11集', episodeNumber: 11, specialNumber: null },
            { rawIndex: 1, rawName: 'OVA1', episodeNumber: null, specialNumber: 1 },
            { rawIndex: 2, rawName: '第12集', episodeNumber: 12, specialNumber: null },
            { rawIndex: 3, rawName: '第13集', episodeNumber: 13, specialNumber: null },
            { rawIndex: 4, rawName: '第14集', episodeNumber: 14, specialNumber: null },
        ],
    );
    assert.equal(sourceEpisodes[0].rawIndex, 0);
    assert.equal(sourceEpisodes[0].parsedEpisodeInfo.episodeNumber, 11);

    const matchingIdentity = resolveEntityIdentity(identityInput(source), identityInput(matching));
    assert.equal(matchingIdentity.decision, 'supported');
    for (const field of [
        'alias',
        'year',
        'season',
        'mediaType',
        'director',
        'actors',
        'area',
        'language',
    ]) {
        assert.ok(matchingIdentity.matchedFields.includes(field), `expected ${field} evidence`);
    }
    assert.deepEqual(matchingIdentity.blockers, []);

    const insufficientIdentity = resolveEntityIdentity(
        { rawTitle: 'Evidence-starved fixture' },
        { rawTitle: 'Evidence-starved fixture' },
    );
    assert.equal(
        insufficientIdentity.decision,
        'uncertain',
        'an equal title without independent metadata must remain uncertain',
    );

    const conflictingIdentity = resolveEntityIdentity(identityInput(source), identityInput(conflicting));
    assert.equal(conflictingIdentity.decision, 'rejected');
    assert.ok(conflictingIdentity.blockers.some((blocker) => blocker.code === 'season_conflict'));

    const mediaId = 'media:galaxy-odyssey:s2';
    const canonicalMedia = {
        mediaId,
        mediaType: 'anime',
        canonicalTitle: '银河远征',
        aliases: ['Galaxy Odyssey'],
        releaseYear: 2025,
        season: 2,
        directors: ['导演甲'],
        actors: ['演员甲', '演员乙'],
        externalIds: {},
        evidence: matchingIdentity.evidence,
        identityState: matchingIdentity.decision,
    };
    const matchingEpisodes = matching.playGroups[0].episodes;
    const canonicalEpisodes = matchingEpisodes.map((episode) => canonicalEpisode(mediaId, episode));

    const expectations = [
        { sourceIndex: 0, state: 'supported', targetIndex: 1, title: '第11集' },
        { sourceIndex: 1, state: 'supported', targetIndex: 4, title: 'OVA1' },
        { sourceIndex: 2, state: 'supported', targetIndex: 2, title: '第12集' },
        { sourceIndex: 3, state: 'not_found', targetIndex: null, title: null },
        { sourceIndex: 4, state: 'supported', targetIndex: 3, title: '第14集' },
    ];

    for (const expected of expectations) {
        const resolution = resolveEpisode({
            sourceEpisode: sourceEpisodes[expected.sourceIndex],
            sourceSequence: sourceEpisodes,
            canonicalMedia,
            candidateEpisodes: canonicalEpisodes,
        });
        assert.equal(resolution.state, expected.state);
        assert.equal(resolution.selectedEpisode?.episodeTitle ?? null, expected.title);
        if (expected.targetIndex === null) {
            assert.equal(resolution.selectedEpisode, null);
        } else {
            assert.equal(
                canonicalEpisodes.indexOf(resolution.selectedEpisode),
                expected.targetIndex,
                `source rawIndex ${expected.sourceIndex} must map by episode evidence`,
            );
        }
    }
});

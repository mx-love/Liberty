import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
    CandidateEvidenceCollector,
    EntityResolver,
    EpisodeAligner,
    EpisodeParser,
    EpisodeResolver,
    TitleParser,
    alignEpisodeSequences,
    collectCandidateEvidence,
    parseEpisode,
    parseTitle,
    resolveEntityIdentity,
    resolveEpisode,
} from '../../js/liberty-core.js';

const identityFixture = JSON.parse(await readFile(
    new URL('../fixtures/identity/identity-cases.json', import.meta.url),
    'utf8',
));
const episodeFixture = JSON.parse(await readFile(
    new URL('../fixtures/episode/sequence-cases.json', import.meta.url),
    'utf8',
));

function sourceEpisode(rawEpisodeName, rawIndex, overrides = {}) {
    return {
        sourceKey: 'fixture-source',
        vodId: 'fixture-vod',
        playGroup: 'main',
        playGroupIndex: 0,
        rawIndex,
        rawEpisodeName,
        displayName: rawEpisodeName,
        rawEntry: `${rawEpisodeName}$https://example.test/${rawIndex}.m3u8`,
        playUrl: `https://example.test/${rawIndex}.m3u8`,
        parsedEpisodeInfo: parseEpisode(rawEpisodeName),
        canonicalEpisodeId: null,
        mappingState: 'unmapped',
        mappingEvidence: [],
        ...overrides,
    };
}

function canonicalEpisode(rawEpisodeName, index, overrides = {}) {
    const parsed = parseEpisode(rawEpisodeName);
    return {
        canonicalEpisodeId: `canonical-episode-${index}`,
        mediaId: 'canonical-media',
        contentType: parsed.contentType,
        seasonNumber: parsed.seasonNumber,
        episodeNumber: parsed.episodeNumber,
        absoluteNumber: parsed.absoluteNumber,
        airDate: parsed.airDate,
        episodeTitle: parsed.episodeTitle,
        part: parsed.part,
        identityState: 'supported',
        evidence: [],
        ...overrides,
    };
}

function resolverContext(sourceNames, candidateNames, sourceIndex = 0) {
    const sourceSequence = sourceNames.map((name, index) => sourceEpisode(name, index));
    const candidateEpisodes = candidateNames.map((name, index) => canonicalEpisode(name, index));
    return {
        sourceEpisode: sourceSequence[sourceIndex],
        sourceSequence,
        canonicalMedia: {
            mediaId: 'canonical-media',
            mediaType: 'series',
            canonicalTitle: 'Fixture series',
            aliases: [],
            releaseYear: null,
            season: null,
            directors: [],
            actors: [],
            externalIds: {},
            evidence: [],
            identityState: 'supported',
            episodes: candidateEpisodes,
        },
        candidateEpisodes,
    };
}

test('TitleParser preserves a numbered title and exposes season as a low-confidence interpretation', () => {
    const parsed = parseTitle('庆余年2');

    assert.equal(parsed.baseTitle, '庆余年2');
    assert.equal(parsed.season, null, 'a trailing number must not overwrite the literal title');
    assert.deepEqual(parsed.interpretations.map(({ baseTitle, season, confidence }) => ({
        baseTitle, season, confidence,
    })), [
        { baseTitle: '庆余年2', season: null, confidence: 'medium' },
        { baseTitle: '庆余年', season: 2, confidence: 'low' },
    ]);
    assert.deepEqual(new TitleParser().parse('示例 第二季').season, 2);
});

test('EntityResolver accepts declared aliases only with independent compatible metadata', () => {
    const { left, right } = identityFixture.aliasWithIndependentMetadata;
    const resolution = resolveEntityIdentity(left, right);

    assert.equal(resolution.decision, 'supported');
    assert.ok(resolution.matchedFields.includes('alias'));
    assert.ok(resolution.matchedFields.includes('year'));
    assert.ok(resolution.matchedFields.includes('season'));
    assert.ok(resolution.matchedFields.includes('mediaType'));
    assert.equal(new EntityResolver().resolve(left, right).decision, 'supported');
});

test('a low-confidence trailing-number interpretation is not promoted to a declared alias', () => {
    const resolution = resolveEntityIdentity(
        { rawTitle: '庆余年2', year: 2025, mediaType: 'series' },
        { rawTitle: '庆余年 第二季', year: 2025, season: 2, mediaType: 'series' },
    );

    assert.equal(resolution.decision, 'uncertain');
    assert.equal(resolution.matchedFields.includes('alias'), false);
    assert.equal(resolution.evidence.find((item) => item.field === 'title')?.state, 'conflicting');
});

test('missing identity fields stay unknown and neither add support nor create conflicts', () => {
    const { left, right } = identityFixture.missingMetadata;
    const evidence = collectCandidateEvidence(left, right);
    const resolution = resolveEntityIdentity(left, right);

    assert.equal(resolution.decision, 'uncertain', 'one equal title is insufficient by itself');
    assert.equal(evidence.find((item) => item.field === 'year')?.state, 'unknown');
    assert.equal(evidence.find((item) => item.field === 'season')?.state, 'unknown');
    assert.equal(evidence.find((item) => item.field === 'director')?.state, 'unknown');
    assert.equal(evidence.some((item) => item.state === 'conflicting'), false);
    assert.deepEqual(
        new CandidateEvidenceCollector().collect(left, right),
        evidence,
    );
});

test('explicit season conflicts block an otherwise matching title and year', () => {
    const { left, right } = identityFixture.explicitSeasonConflict;
    const resolution = resolveEntityIdentity(left, right);

    assert.equal(resolution.decision, 'rejected');
    assert.ok(resolution.blockers.some((blocker) => blocker.code === 'season_conflict'));
});

test('explicit release-year conflicts block same-name remakes', () => {
    const { left, right } = identityFixture.explicitYearConflict;
    const resolution = resolveEntityIdentity(left, right);

    assert.equal(resolution.decision, 'rejected');
    assert.ok(resolution.blockers.some((blocker) => blocker.code === 'release_year_conflict'));
});

test('a one-year metadata difference remains unknown rather than becoming a false conflict', () => {
    const left = { rawTitle: '跨年播出作品', year: 2025, mediaType: 'series' };
    const right = { rawTitle: '跨年播出作品', year: 2026, mediaType: 'series' };
    const resolution = resolveEntityIdentity(left, right);

    assert.equal(resolution.decision, 'supported');
    assert.equal(resolution.evidence.find((item) => item.field === 'year')?.state, 'unknown');
    assert.equal(resolution.blockers.length, 0);
});

test('equal verified external IDs can confirm different translations without title similarity', () => {
    const { left, right } = identityFixture.confirmedExternalIdentity;
    const resolution = resolveEntityIdentity(left, right);

    assert.equal(resolution.decision, 'confirmed');
    assert.ok(resolution.matchedFields.includes('externalId'));
});

test('a confirmed-title conflict is blocking even when descriptive metadata overlaps', () => {
    const resolution = resolveEntityIdentity(
        {
            rawTitle: '作品甲',
            titleAuthority: 'confirmed',
            year: 2025,
            actors: ['演员A'],
        },
        {
            rawTitle: '作品乙',
            titleAuthority: 'confirmed',
            year: 2025,
            actors: ['演员A'],
        },
    );

    assert.equal(resolution.decision, 'rejected');
    assert.ok(resolution.blockers.some((blocker) => blocker.code === 'confirmed_title_conflict'));
});

test('EpisodeParser distinguishes episodes, dates, specials, and technical labels', () => {
    const parser = new EpisodeParser();

    assert.deepEqual(
        (({ seasonNumber, episodeNumber, confidence }) => ({ seasonNumber, episodeNumber, confidence }))(
            parser.parse('S02E12'),
        ),
        { seasonNumber: 2, episodeNumber: 12, confidence: 'high' },
    );
    assert.equal(parseEpisode('第1集').episodeNumber, 1);
    assert.equal(parseEpisode('第一集').episodeNumber, 1);
    assert.equal(parseEpisode('第十二集').episodeNumber, 12);
    assert.equal(parseEpisode('12').episodeNumber, 12);
    assert.equal(parseEpisode('EP12').episodeNumber, 12);
    assert.equal(parseEpisode('E12').episodeNumber, 12);
    assert.equal(parseEpisode('第12期').numberKind, 'issue');
    assert.equal(parseEpisode('第12期').episodeNumber, 12);
    assert.equal(parseEpisode('20251001').airDate, '2025-10-01');
    assert.equal(parseEpisode('20251001').episodeNumber, null);
    assert.equal(parseEpisode('20251001').numberKind, 'date');
    assert.equal(parseEpisode('上集').part, 'upper');
    assert.equal(parseEpisode('下集').part, 'lower');
    assert.equal(parseEpisode('特别篇').contentType, 'special');
    assert.equal(parseEpisode('SP').specialKind, 'sp');
    assert.equal(parseEpisode('OVA').specialKind, 'ova');
    assert.equal(parseEpisode('SP2').specialNumber, 2);
    assert.equal(parseEpisode('SP2').contentType, 'special');
    assert.equal(parseEpisode('预告').contentType, 'preview');
    assert.equal(parseEpisode('采访').contentType, 'interview');
    assert.equal(parseEpisode('正片').contentType, 'movie');
    assert.equal(parseEpisode('第125话').absoluteNumber, 125, 'long-running anime numbering stays explicit');
    assert.equal(parseEpisode('1080P').episodeNumber, null);
    assert.equal(parseEpisode('线路1').episodeNumber, null);
    const empty = parseEpisode('');
    assert.equal(empty.episodeNumber, null);
    assert.equal(empty.confidence, 'none');
    assert.equal(empty.evidence[0].code, 'unrecognized');
});

test('A-H acceptance sequences preserve episode identity without positional guessing', () => {
    const regular = (number) => `\u7b2c${number}\u96c6`;
    const issue = (number) => `\u7b2c${number}\u671f`;

    const targetWithSpecial = [regular(1), regular(2), 'SP1', regular(3), regular(4)];
    const withoutSpecial = alignEpisodeSequences(
        [regular(1), regular(2), regular(3), regular(4)],
        targetWithSpecial,
    );
    assert.deepEqual(
        withoutSpecial.mappings.map((mapping) => mapping.targetIndices[0]),
        [0, 1, 3, 4],
        'a canonical special must not shift later regular episodes',
    );

    const withSpecial = alignEpisodeSequences(targetWithSpecial, targetWithSpecial);
    assert.deepEqual(
        withSpecial.mappings.map((mapping) => mapping.targetIndices[0]),
        [0, 1, 2, 3, 4],
    );

    const missingRegular = alignEpisodeSequences(
        [regular(1), regular(2), regular(4), regular(5)],
        [regular(1), regular(2), regular(3), regular(4), regular(5)],
    );
    assert.deepEqual(
        missingRegular.mappings.map((mapping) => mapping.targetIndices[0]),
        [0, 1, 3, 4],
        'a missing regular episode must not create a fixed positional offset',
    );

    const differentStart = alignEpisodeSequences(
        [regular(11), regular(12), regular(13)],
        [regular(9), regular(10), regular(11), regular(12), regular(13)],
    );
    assert.deepEqual(
        differentStart.mappings.map((mapping) => mapping.targetIndices[0]),
        [2, 3, 4],
    );

    const positionOnly = alignEpisodeSequences(
        ['\u64ad\u653e1', '\u64ad\u653e2', '\u64ad\u653e3'],
        [regular(1), regular(2), regular(3)],
    );
    assert.equal(positionOnly.state, 'uncertain');
    assert.deepEqual(positionOnly.mappings.map((mapping) => mapping.targetIndices), [[], [], []]);

    const insertedInterview = alignEpisodeSequences(
        [issue(1), issue(2), issue(3), issue(4)],
        [issue(1), issue(2), '\u91c7\u8bbf', issue(3), issue(4)],
    );
    assert.deepEqual(
        insertedInterview.mappings.map((mapping) => mapping.targetIndices[0]),
        [0, 1, 3, 4],
        'a variety interview must not shift later issue identities',
    );

    const broadcastDate = parseEpisode('20251001');
    assert.equal(broadcastDate.numberKind, 'date');
    assert.equal(broadcastDate.episodeNumber, null);

    const movie = parseEpisode('\u6b63\u7247');
    assert.equal(movie.contentType, 'movie');
    assert.equal(movie.seasonNumber, null);
    assert.equal(movie.episodeNumber, null);
});

test('non-continuous sequences align by explicit numbers, never by array position', () => {
    const { source, target, expected } = episodeFixture.nonContinuous;
    const alignment = alignEpisodeSequences(source, target);

    assert.equal(alignment.state, 'aligned');
    assert.deepEqual(
        alignment.mappings.map((mapping) => mapping.targetIndices[0]),
        expected,
    );
    assert.equal(new EpisodeAligner().align(source, target).state, 'aligned');
});

test('a missing target episode is reported as not_found without shifting later mappings', () => {
    const { source, target } = episodeFixture.missingEpisode;
    const alignment = alignEpisodeSequences(source, target);
    const missing = resolveEpisode(resolverContext(source, target, 1));

    assert.equal(alignment.state, 'partial');
    assert.equal(alignment.mappings[1].state, 'unmatched');
    assert.equal(missing.state, 'not_found');
    assert.equal(missing.selectedEpisode, null);
    assert.deepEqual(missing.candidates, []);
    assert.equal(alignment.mappings[2].targetIndices[0], 1, 'episode 13 must not shift to source index 1');
});

test('an inserted numbered special maps independently without shifting regular episodes', () => {
    const { source, target } = episodeFixture.insertedSpecial;
    const alignment = alignEpisodeSequences(source, target);

    assert.equal(alignment.state, 'aligned');
    assert.deepEqual(
        alignment.mappings.map((mapping) => mapping.targetIndices[0]),
        [0, 2, 1],
    );
    assert.equal(alignment.mappings[1].evidence[0].code, 'exact_special_identity');
});

test('missing regular items, stale tails, interviews, and multiple specials do not shift identities', () => {
    const middleMissing = alignEpisodeSequences(
        ['第1集', '第3集'],
        ['第1集', '第2集', '第3集'],
    );
    assert.deepEqual(middleMissing.mappings.map((mapping) => mapping.targetIndices[0]), [0, 2]);

    const staleTail = alignEpisodeSequences(
        ['第1集', '第2集', '第3集'],
        ['第1集', '第2集'],
    );
    assert.equal(staleTail.state, 'partial');
    assert.equal(staleTail.mappings[2].state, 'unmatched');

    const insertedInterview = alignEpisodeSequences(
        ['第1集', '第2集'],
        ['第1集', '主创采访', '第2集'],
    );
    assert.deepEqual(insertedInterview.mappings.map((mapping) => mapping.targetIndices[0]), [0, 2]);

    const multipleSpecials = alignEpisodeSequences(
        ['第1集', 'SP1', 'OVA1', '第2集'],
        ['SP1', '第1集', 'OVA1', '第2集', '第3集'],
    );
    assert.deepEqual(
        multipleSpecials.mappings.map((mapping) => mapping.targetIndices[0]),
        [1, 0, 2, 3],
    );

    const differentTotals = alignEpisodeSequences(
        ['第2集', '第4集'],
        ['第1集', '第2集', '第3集', '第4集', '第5集'],
    );
    assert.deepEqual(differentTotals.mappings.map((mapping) => mapping.targetIndices[0]), [1, 3]);
});

test('different sequence starting points still resolve the same explicit episode identities', () => {
    const { source, target, expected } = episodeFixture.differentStart;
    const alignment = alignEpisodeSequences(source, target);
    const context = resolverContext(source, target);
    const resolution = resolveEpisode(context);

    assert.deepEqual(alignment.mappings.map((mapping) => mapping.targetIndices[0]), expected);
    assert.equal(resolution.state, 'supported');
    assert.equal(
        resolution.selectedEpisode?.canonicalEpisodeId,
        context.candidateEpisodes[2].canonicalEpisodeId,
    );
});

test('two reliable anchors may support an otherwise unknown item between them', () => {
    const { source, target } = episodeFixture.boundedUnknown;
    const alignment = alignEpisodeSequences(source, target);
    const context = resolverContext(source, target, 1);
    const resolution = new EpisodeResolver().resolve(context);

    assert.equal(alignment.reliableAnchorCount, 2);
    assert.equal(alignment.mappings[1].state, 'supported');
    assert.equal(alignment.mappings[1].evidence[0].code, 'bounded_by_two_anchors');
    assert.equal(resolution.state, 'supported');
    assert.equal(
        resolution.selectedEpisode?.canonicalEpisodeId,
        context.candidateEpisodes[1].canonicalEpisodeId,
    );
});

test('one anchor and equal list lengths do not infer an unknown episode', () => {
    const { source, target } = episodeFixture.singleAnchorInsufficient;
    const alignment = alignEpisodeSequences(source, target);
    const resolution = resolveEpisode(resolverContext(source, target, 1));

    assert.equal(alignment.reliableAnchorCount, 1);
    assert.equal(alignment.mappings[1].state, 'uncertain');
    assert.equal(resolution.state, 'uncertain');
    assert.equal(resolution.selectedEpisode, null);
});

test('equal-length unknown sequences remain uncertain without any anchors', () => {
    const alignment = alignEpisodeSequences(
        ['来源甲', '来源乙'],
        ['目标甲', '目标乙'],
    );

    assert.equal(alignment.state, 'uncertain');
    assert.deepEqual(alignment.mappings.map((mapping) => mapping.targetIndices), [[], []]);
});

test('an equal episode content title alone is only a candidate, not an automatic match', () => {
    const context = resolverContext(['共同标题'], ['共同标题']);
    const resolution = resolveEpisode(context);

    assert.equal(resolution.state, 'uncertain');
    assert.deepEqual(
        resolution.candidates.map((candidate) => candidate.episode.canonicalEpisodeId),
        [context.candidateEpisodes[0].canonicalEpisodeId],
    );
    assert.equal(resolution.selectedEpisode, null);
});

test('duplicate explicit target identities remain ambiguous', () => {
    const context = resolverContext(['第12集'], ['第12集', '第12集']);
    const resolution = resolveEpisode(context);

    assert.equal(resolution.state, 'uncertain');
    assert.deepEqual(
        resolution.candidates.map((candidate) => candidate.episode.canonicalEpisodeId),
        context.candidateEpisodes.map((episode) => episode.canonicalEpisodeId),
    );
});

test('explicit season mismatch cannot be rescued by an equal episode number', () => {
    const resolution = resolveEpisode(resolverContext(['S02E12'], ['S01E12']));

    assert.equal(resolution.state, 'rejected');
    assert.equal(resolution.selectedEpisode, null);
    assert.ok(resolution.evidence.some((item) => item.code === 'explicit_season_conflict'));
    assert.ok(resolution.rejectionReasons.some((reason) => reason.includes('seasons 2 and 1 conflict')));
});

test('reversed regular episode anchors are conflicting rather than positionally realigned', () => {
    const alignment = alignEpisodeSequences(
        ['第11集', '第12集'],
        ['第12集', '第11集'],
    );

    assert.equal(alignment.state, 'conflicting');
    assert.deepEqual(alignment.mappings.map((mapping) => mapping.state), ['conflicting', 'conflicting']);
});

test('verified mappings support split or merged targets, while contradictory anchors are blocked', () => {
    const context = resolverContext(['未标集数的合并版'], ['第1集', '第2集']);
    const resolution = resolveEpisode({
        ...context,
        verifiedMappings: [{
            sourceEpisode: context.sourceEpisode,
            canonicalEpisodeIds: context.candidateEpisodes.map((episode) => episode.canonicalEpisodeId),
            evidence: 'operator verified merge',
        }],
    });
    assert.equal(resolution.state, 'verified');
    assert.deepEqual(
        resolution.candidates.map((candidate) => candidate.episode.canonicalEpisodeId),
        context.candidateEpisodes.map((episode) => episode.canonicalEpisodeId),
    );
    assert.equal(resolution.selectedEpisode, null);
    assert.ok(resolution.evidence.some((item) => item.code === 'verified_mapping'));

    const conflict = alignEpisodeSequences(
        ['未知'],
        ['第1集', '第2集'],
        [
            { sourceIndex: 0, targetIndices: [0] },
            { sourceIndex: 0, targetIndices: [1] },
        ],
    );
    assert.equal(conflict.state, 'conflicting');
    assert.equal(conflict.mappings[0].state, 'conflicting');
});

test('a verified mapping selects the canonical episode by ID, not by matching array position', () => {
    const context = resolverContext(['来源未命名项'], ['第1集', '第2集']);
    const selected = context.candidateEpisodes[1];
    const resolution = resolveEpisode({
        ...context,
        verifiedMappings: [{
            sourceEpisode: context.sourceEpisode,
            canonicalEpisodeIds: [selected.canonicalEpisodeId],
            evidence: 'operator checked source playback',
        }],
    });

    assert.equal(resolution.state, 'verified');
    assert.equal(resolution.selectedEpisode, selected);
    assert.equal(resolution.candidates[0].state, 'verified');
});

test('canonical SP and OVA labels reuse EpisodeParser and align across different positions', () => {
    const context = resolverContext(
        ['第1集', 'OVA1', '第2集'],
        ['OVA1', '第1集', '第2集'],
        1,
    );
    const candidateEpisodes = context.candidateEpisodes.map((episode, index) =>
        index === 0 ? { ...episode, episodeTitle: 'OVA1' } : episode);
    const resolution = resolveEpisode({
        ...context,
        canonicalMedia: { ...context.canonicalMedia, episodes: candidateEpisodes },
        candidateEpisodes,
    });

    assert.equal(resolution.state, 'supported');
    assert.equal(resolution.selectedEpisode, candidateEpisodes[0]);
    assert.ok(resolution.evidence.some((item) => item.code === 'exact_special_identity'));
});

test('a verified mapping is rejected when the same source position now has a different episode name', () => {
    const context = resolverContext(['第2集'], ['第1集', '第2集']);
    const staleSourceEpisode = {
        ...context.sourceEpisode,
        rawEpisodeName: '第1集',
        displayName: '第1集',
        rawEntry: '第1集$https://example.test/0.m3u8',
        parsedEpisodeInfo: parseEpisode('第1集'),
    };
    const resolution = resolveEpisode({
        ...context,
        verifiedMappings: [{
            sourceEpisode: staleSourceEpisode,
            canonicalEpisodeIds: [context.candidateEpisodes[0].canonicalEpisodeId],
            evidence: 'stale operator mapping',
        }],
    });

    assert.equal(staleSourceEpisode.rawIndex, context.sourceEpisode.rawIndex);
    assert.equal(resolution.state, 'rejected');
    assert.equal(resolution.selectedEpisode, null);
    assert.ok(resolution.rejectionReasons.some((reason) => reason.includes('outside')));
});

test('candidate episodes from another canonical media are rejected before alignment can select them', () => {
    const context = resolverContext(['第1集'], ['第1集']);
    const resolution = resolveEpisode({
        ...context,
        candidateEpisodes: [{
            ...context.candidateEpisodes[0],
            mediaId: 'different-media',
        }],
    });

    assert.equal(resolution.state, 'rejected');
    assert.equal(resolution.selectedEpisode, null);
    assert.equal(resolution.candidates[0].state, 'rejected');
    assert.ok(resolution.evidence.some((item) => item.code === 'canonical_media_conflict'));
});

test('a matching rawIndex alone cannot place the current source episode in another source sequence', () => {
    const context = resolverContext(['第1集'], ['第1集']);
    const resolution = resolveEpisode({
        ...context,
        sourceEpisode: {
            ...context.sourceEpisode,
            sourceKey: 'different-source',
        },
    });

    assert.equal(resolution.state, 'rejected');
    assert.equal(resolution.selectedEpisode, null);
    assert.ok(resolution.rejectionReasons.some((reason) => reason.includes('absent')));
});

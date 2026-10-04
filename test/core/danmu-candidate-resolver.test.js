import assert from 'node:assert/strict';
import test from 'node:test';

import {
    DanmuCandidateResolver,
    adaptDanmakuCandidate,
    resolveDanmakuCandidate,
} from '../../js/liberty-core.js';

function canonicalMedia(overrides = {}) {
    return {
        mediaId: 'canonical:candidate-show:s2',
        mediaType: 'series',
        canonicalTitle: 'Candidate Show',
        aliases: [],
        releaseYear: 2025,
        season: 2,
        directors: [],
        actors: [],
        externalIds: {},
        evidence: [],
        identityState: 'supported',
        ...overrides,
    };
}

function candidate(animeId, overrides = {}) {
    return {
        animeId,
        animeTitle: 'Candidate Show',
        ...overrides,
    };
}

test('candidate adapter reuses parseTitle and preserves missing fields as unknown', () => {
    const adapted = adaptDanmakuCandidate(candidate('candidate-s2', {
        animeTitle: 'Candidate Show Season 2',
    }));

    assert.equal(adapted.parsedTitle.baseTitle, 'Candidate Show');
    assert.equal(adapted.season, 2);
    assert.equal(adapted.year, null);
    assert.equal(adapted.mediaType, undefined);
    assert.equal(adapted.externalIds.danmu, 'candidate-s2');
});

test('candidate adapter carries only explicit identity metadata into the shared model', () => {
    const rawCandidate = {
        animeId: 'candidate-1',
        animeTitle: 'Candidate Show Season 2',
        aliases: ['候选剧'],
        year: 2025,
        mediaType: 'series',
        source: 'fixture',
        rawData: { transportOnly: true },
    };

    const adapted = adaptDanmakuCandidate(rawCandidate);

    assert.equal(adapted.recordId, 'danmu:candidate-1');
    assert.equal(adapted.year, 2025);
    assert.equal(adapted.season, 2);
    assert.equal(adapted.mediaType, 'series');
    assert.deepEqual(adapted.aliases, ['候选剧']);
});

test('an explicit season conflict rejects a same-base-title candidate', () => {
    const result = resolveDanmakuCandidate(canonicalMedia(), [candidate('season-1', {
        animeTitle: 'Candidate Show Season 1',
        year: 2025,
        mediaType: 'series',
    })]);

    assert.equal(result.state, 'conflicting');
    assert.equal(result.selected, null);
    assert.equal(result.evaluations[0].identity.decision, 'rejected');
    assert.ok(result.evaluations[0].identity.blockers.some(({ code }) => code === 'season_conflict'));
});

test('an explicit release-year conflict rejects a same-title remake', () => {
    const result = new DanmuCandidateResolver().resolve(canonicalMedia(), [candidate('old-remake', {
        year: 2020,
        season: 2,
        mediaType: 'series',
    })]);

    assert.equal(result.state, 'conflicting');
    assert.equal(result.selected, null);
    assert.ok(result.evaluations[0].identity.blockers.some(({ code }) => code === 'release_year_conflict'));
});

test('title equality alone remains uncertain and cannot become verified', () => {
    const result = resolveDanmakuCandidate(canonicalMedia(), [candidate('title-only')]);

    assert.equal(result.state, 'uncertain');
    assert.equal(result.selected, null);
    assert.equal(result.selectedBy, null);
    assert.equal(result.evaluations[0].identity.decision, 'uncertain');
    assert.deepEqual(result.evaluations[0].identity.matchedFields, ['title']);
});

test('missing candidate fields stay unknown rather than becoming conflicts', () => {
    const result = resolveDanmakuCandidate(canonicalMedia(), [candidate('sparse')]);
    const evidence = result.evaluations[0].identity.evidence;

    for (const field of ['year', 'season', 'mediaType']) {
        assert.equal(evidence.find((item) => item.field === field)?.state, 'unknown');
    }
    assert.equal(result.evaluations[0].identity.blockers.length, 0);
    assert.equal(result.state, 'uncertain');
});

test('one independently supported candidate is selected when every alternative is rejected', () => {
    const supported = candidate('supported', { year: 2025 });
    const wrongSeason = candidate('wrong-season', {
        animeTitle: 'Candidate Show Season 1',
        year: 2025,
    });
    const result = resolveDanmakuCandidate(canonicalMedia(), [wrongSeason, supported]);

    assert.equal(result.state, 'supported');
    assert.equal(result.selected, supported);
    assert.equal(result.selectedBy, 'automatic');
});

test('multiple non-rejected candidates remain ambiguous instead of selecting the first', () => {
    const result = resolveDanmakuCandidate(canonicalMedia(), [
        candidate('ambiguous-a'),
        candidate('ambiguous-b'),
    ]);

    assert.equal(result.state, 'uncertain');
    assert.equal(result.selected, null);
    assert.equal(result.evaluations.length, 2);
});

test('a verified danmu external identity can select exactly one candidate', () => {
    const result = resolveDanmakuCandidate(
        canonicalMedia({ externalIds: { danmu: 'known-anime' } }),
        [candidate('known-anime')],
    );

    assert.equal(result.state, 'verified');
    assert.equal(result.selected?.animeId, 'known-anime');
    assert.equal(result.selectedBy, 'automatic');
});

test('one verified external identity wins over an otherwise unresolved candidate', () => {
    const result = resolveDanmakuCandidate(
        canonicalMedia({ externalIds: { danmu: 'known-anime' } }),
        [candidate('unknown-anime'), candidate('known-anime')],
    );

    assert.equal(result.state, 'verified');
    assert.equal(result.selected?.animeId, 'known-anime');
    assert.equal(result.selectedBy, 'automatic');
});

test('manual animeId chooses that work without claiming its episode is verified', () => {
    const result = resolveDanmakuCandidate(
        canonicalMedia(),
        [candidate('manual-a'), candidate('manual-b')],
        { manualAnimeId: 'manual-b' },
    );

    assert.equal(result.state, 'supported');
    assert.equal(result.selected?.animeId, 'manual-b');
    assert.equal(result.selectedBy, 'manual');
    assert.match(result.reason, /episode still requires independent resolution/i);
});

test('manual animeId must exist and cannot override an explicit identity conflict', () => {
    const missing = resolveDanmakuCandidate(
        canonicalMedia(),
        [candidate('present')],
        { manualAnimeId: 'missing' },
    );
    const conflicting = resolveDanmakuCandidate(
        canonicalMedia(),
        [candidate('wrong-season', { animeTitle: 'Candidate Show Season 1' })],
        { manualAnimeId: 'wrong-season' },
    );

    assert.equal(missing.state, 'not_found');
    assert.equal(missing.selected, null);
    assert.equal(conflicting.state, 'conflicting');
    assert.equal(conflicting.selected, null);
    assert.equal(conflicting.selectedBy, null);
});

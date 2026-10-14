import assert from 'node:assert/strict';
import test from 'node:test';

import {
    DanmuCandidateResolver,
    adaptDanmakuCandidate,
    adaptDanmuSearchAnime,
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

function searchAnime(overrides = {}) {
    return {
        animeId: 'composite-candidate',
        bangumiId: 'composite-bangumi',
        animeTitle: 'Example Show 4(2014)【国产剧】from alpha',
        type: '国产剧',
        typeDescription: '国产剧',
        imageUrl: '',
        startDate: '2014-01-01T00:00:00Z',
        episodeCount: 24,
        source: 'alpha',
        rawData: {},
        ...overrides,
    };
}

test('candidate adapter separates a bounded composite display title from identity metadata', () => {
    const rawTitle = 'Example Show 4(2014)【国产剧】from alpha';
    const adapted = adaptDanmakuCandidate(candidate('composite-series', { animeTitle: rawTitle }));

    assert.equal(adapted.rawTitle, rawTitle);
    assert.equal(adapted.displayTitle, rawTitle);
    assert.equal(adapted.identityTitle, 'Example Show 4');
    assert.equal(adapted.parsedTitle.baseTitle, 'Example Show 4');
    assert.equal(adapted.year, 2014);
    assert.equal(adapted.mediaType, 'series');
    assert.equal(adapted.provider, 'alpha');
    assert.equal(adapted.provenance.identityTitle, 'parsed_composite_display_field');
    assert.equal(adapted.provenance.year.source, 'parsed_composite_display_field');
    assert.equal(adapted.provenance.mediaType.source, 'parsed_composite_display_field');
    assert.equal(adapted.provenance.provider.source, 'parsed_composite_display_field');
});

test('candidate adapter classifies only bounded composite type metadata', () => {
    const movie = adaptDanmakuCandidate(candidate('composite-movie', {
        animeTitle: 'Example Movie(2025)【动画电影】from beta',
    }));
    const seriesWithoutYear = adaptDanmakuCandidate(candidate('composite-series-no-year', {
        animeTitle: 'Example Show【电视剧】from gamma',
    }));

    assert.equal(movie.identityTitle, 'Example Movie');
    assert.equal(movie.year, 2025);
    assert.equal(movie.mediaType, 'movie');
    assert.equal(movie.provider, 'beta');
    assert.equal(seriesWithoutYear.identityTitle, 'Example Show');
    assert.equal(seriesWithoutYear.year, null);
    assert.equal(seriesWithoutYear.mediaType, 'series');
    assert.equal(seriesWithoutYear.provider, 'gamma');
});

test('candidate adapter accepts only the observed bounded year/provider suffix variants', () => {
    const yearOnly = adaptDanmakuCandidate(candidate('composite-year-only', {
        animeTitle: 'Example Show(2014)',
    }));
    const providerOnly = adaptDanmakuCandidate(candidate('composite-provider-only', {
        animeTitle: 'Example Show from alpha',
    }));

    assert.equal(yearOnly.identityTitle, 'Example Show');
    assert.equal(yearOnly.year, 2014);
    assert.equal(providerOnly.identityTitle, 'Example Show');
    assert.equal(providerOnly.provider, 'alpha');
});

test('candidate adapter leaves legitimate and internal parentheses untouched', () => {
    for (const animeTitle of [
        "Example Show (Director's Cut)",
        'Example (Part 2) Show',
        'Example Show 4',
        'Example Show【电视剧】',
    ]) {
        const adapted = adaptDanmakuCandidate(candidate(animeTitle, { animeTitle }));
        assert.equal(adapted.rawTitle, animeTitle);
        assert.equal(adapted.identityTitle, animeTitle);
        assert.equal(adapted.provenance.identityTitle, 'raw_display_title');
    }
});

test('candidate adapter preserves the existing TitleParser year fallback outside composite syntax', () => {
    const adapted = adaptDanmakuCandidate(candidate('literal-year', {
        animeTitle: 'Example Show 2024',
    }));

    assert.equal(adapted.identityTitle, 'Example Show 2024');
    assert.equal(adapted.parsedTitle.baseTitle, 'Example Show');
    assert.equal(adapted.year, 2024);
    assert.equal(adapted.provenance.year.source, 'parsed_identity_title');
    assert.equal(adapted.provenance.year.identityValue, 2024);
});

test('candidate composite parsing delegates season semantics to the shared TitleParser', () => {
    const adapted = adaptDanmakuCandidate(candidate('composite-season', {
        animeTitle: 'Example Show 第三季(2024)【综艺】from alpha',
    }));

    assert.equal(adapted.identityTitle, 'Example Show 第三季');
    assert.equal(adapted.parsedTitle.baseTitle, 'Example Show');
    assert.equal(adapted.season, 3);
    assert.equal(adapted.provenance.season.source, 'parsed_identity_title');
    assert.equal(adapted.year, 2024);
    assert.equal(adapted.mediaType, 'variety');
});

test('structured candidate metadata wins while composite disagreements remain observable', () => {
    const adapted = adaptDanmakuCandidate(candidate('structured-priority', {
        animeTitle: 'Example Show(2017)【电影】from composite-provider',
        year: 2014,
        mediaType: 'series',
        provider: 'structured-provider',
    }));

    assert.equal(adapted.year, 2014);
    assert.equal(adapted.mediaType, 'series');
    assert.equal(adapted.provider, 'structured-provider');
    assert.equal(adapted.provenance.year.compositeValue, 2017);
    assert.equal(adapted.provenance.year.conflict, true);
    assert.equal(adapted.provenance.mediaType.compositeValue, 'movie');
    assert.equal(adapted.provenance.mediaType.conflict, true);
    assert.equal(adapted.provenance.provider.compositeValue, 'composite-provider');
    assert.equal(adapted.provenance.provider.conflict, true);
});

test('declared aliases remain explicit and the decorated display title is not invented as an alias', () => {
    const rawTitle = 'Example Show(2014)【电视剧】from alpha';
    const adapted = adaptDanmakuCandidate(candidate('declared-alias', {
        animeTitle: rawTitle,
        aliases: ['Declared Alternate Title'],
    }));

    assert.deepEqual(adapted.aliases, ['Declared Alternate Title']);
    assert.ok(!adapted.aliases.includes(rawTitle));
    assert.deepEqual(adapted.provenance.aliases, [{
        value: 'Declared Alternate Title',
        source: 'declared_alias',
    }]);
});

test('raw search candidate flows through adapter and resolver with supporting title/year/type evidence', () => {
    const rawCandidate = searchAnime();
    const adaptedCandidate = adaptDanmuSearchAnime(rawCandidate);
    const result = resolveDanmakuCandidate(canonicalMedia({
        canonicalTitle: 'Example Show 4',
        releaseYear: 2014,
        season: null,
        mediaType: 'series',
    }), [adaptedCandidate]);
    const evaluation = result.evaluations[0];

    assert.equal(evaluation.identityInput.rawTitle, rawCandidate.animeTitle);
    assert.equal(evaluation.identityInput.identityTitle, 'Example Show 4');
    assert.equal(evaluation.identityInput.year, 2014);
    assert.equal(evaluation.identityInput.mediaType, 'series');
    assert.equal(evaluation.identityInput.provider, 'alpha');
    assert.equal(evaluation.identity.decision, 'supported');
    assert.equal(result.state, 'supported');
    assert.equal(result.selected?.animeId, 'composite-candidate');
    assert.equal(
        evaluation.identity.evidence.find((item) => item.field === 'title')?.state,
        'supporting',
    );
    assert.equal(
        evaluation.identity.evidence.find((item) => item.field === 'year')?.state,
        'supporting',
    );
    assert.equal(
        evaluation.identity.evidence.find((item) => item.field === 'mediaType')?.state,
        'supporting',
    );
    assert.equal(evaluation.identity.evidence.filter((item) => item.state === 'conflicting').length, 0);
});

test('composite year and media type conflicts remain blocking resolver evidence', () => {
    const media = canonicalMedia({
        canonicalTitle: 'Example Show 4',
        releaseYear: 2014,
        season: null,
        mediaType: 'series',
    });
    const yearConflict = resolveDanmakuCandidate(media, [candidate('year-conflict', {
        animeTitle: 'Example Show 4(2017)【国产剧】from alpha',
    })]);
    const typeConflict = resolveDanmakuCandidate(media, [candidate('type-conflict', {
        animeTitle: 'Example Show 4(2014)【电影】from alpha',
    })]);

    assert.equal(yearConflict.state, 'conflicting');
    assert.ok(yearConflict.evaluations[0].identity.blockers.some(({ code }) => (
        code === 'release_year_conflict'
    )));
    assert.equal(typeConflict.state, 'conflicting');
    assert.ok(typeConflict.evaluations[0].identity.blockers.some(({ code }) => (
        code === 'media_type_conflict'
    )));
});

test('missing composite year follows the existing identity threshold without policy changes', () => {
    const adaptedCandidate = adaptDanmuSearchAnime(searchAnime({
        animeTitle: 'Example Show 4【国产剧】from alpha',
        startDate: '',
    }));
    const result = resolveDanmakuCandidate(canonicalMedia({
        canonicalTitle: 'Example Show 4',
        releaseYear: 2014,
        season: null,
        mediaType: 'series',
    }), [adaptedCandidate]);

    assert.equal(result.state, 'supported');
    assert.equal(
        result.evaluations[0].identity.evidence.find((item) => item.field === 'year')?.state,
        'unknown',
    );
});

test('composite parsing preserves numbered-title discrimination', () => {
    const result = resolveDanmakuCandidate(canonicalMedia({
        canonicalTitle: 'Example Show 3',
        releaseYear: 2014,
        season: null,
        mediaType: 'series',
    }), [candidate('different-numbered-title', {
        animeTitle: 'Example Show 4(2014)【国产剧】from alpha',
    })]);

    assert.notEqual(result.state, 'supported');
    assert.equal(
        result.evaluations[0].identity.evidence.find((item) => item.field === 'title')?.state,
        'conflicting',
    );
});

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

test('candidate adapter applies one shared explicit-season grammar without promoting numbered titles', () => {
    const explicitSeasonTitles = [
        'Example Show 第三季',
        'Example Show 第3季',
        'Example Show 第03季',
        'Example Show Season 3',
        'Example Show Season3',
        'Example Show S3',
        'Example Show S03',
    ];

    for (const animeTitle of explicitSeasonTitles) {
        const adapted = adaptDanmakuCandidate(candidate(animeTitle, { animeTitle }));
        assert.equal(adapted.parsedTitle.baseTitle, 'Example Show', animeTitle);
        assert.equal(adapted.parsedTitle.interpretations[0]?.confidence, 'high', animeTitle);
        assert.equal(adapted.season, 3, animeTitle);
    }

    const numberedTitle = adaptDanmakuCandidate(candidate('numbered-title', {
        animeTitle: 'Example Show 4',
    }));
    assert.equal(numberedTitle.parsedTitle.baseTitle, 'Example Show 4');
    assert.equal(numberedTitle.season, null);
});

test('equal explicit seasons support media identity without a year while conflicts remain blocking', () => {
    const media = canonicalMedia({
        canonicalTitle: 'Example Show',
        releaseYear: null,
        season: 3,
        mediaType: 'unknown',
    });
    const matching = resolveDanmakuCandidate(media, [candidate('season-3', {
        animeTitle: 'Example Show 第3季',
    })]);
    const conflicting = resolveDanmakuCandidate(media, [candidate('season-4', {
        animeTitle: 'Example Show 第4季',
    })]);
    const unknown = resolveDanmakuCandidate(media, [candidate('season-unknown', {
        animeTitle: 'Example Show',
    })]);

    assert.equal(matching.state, 'supported');
    assert.equal(
        matching.evaluations[0].identity.evidence.find((item) => item.field === 'season')?.state,
        'supporting',
    );
    assert.equal(conflicting.state, 'conflicting');
    assert.ok(conflicting.evaluations[0].identity.blockers.some(({ code }) => code === 'season_conflict'));
    assert.equal(unknown.state, 'uncertain');
    assert.equal(
        unknown.evaluations[0].identity.evidence.find((item) => item.field === 'season')?.state,
        'unknown',
    );
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

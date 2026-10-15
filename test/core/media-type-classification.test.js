import assert from 'node:assert/strict';
import test from 'node:test';

import {
    SourceNormalizer,
    adaptDanmuSearchAnime,
} from '../../js/liberty-core.js';

function normalizeSource(category) {
    return SourceNormalizer.normalize({
        vod_id: `source-${category}`,
        vod_name: 'Classification Fixture',
        type_name: category,
    }, {
        sourceKey: 'fixture',
        fetchedAt: 1,
    });
}

function searchCandidate(type, typeDescription = '') {
    return adaptDanmuSearchAnime({
        animeId: `search-${type}-${typeDescription}`,
        bangumiId: 'bangumi',
        animeTitle: 'Classification Fixture',
        type,
        typeDescription,
        imageUrl: '',
        startDate: '',
        episodeCount: null,
        source: 'fixture',
        rawData: { type, typeDescription, genre: '动画' },
    });
}

const classificationCases = [
    ['动漫电影', 'movie'],
    ['动画电影', 'movie'],
    ['华语电影', 'movie'],
    ['Animated Movie', 'movie'],
    ['动漫', 'anime'],
    ['动画剧集', 'anime'],
    ['电视剧', 'series'],
    ['大陆剧', 'series'],
    ['大陸劇', 'series'],
    ['欧美剧', 'series'],
    ['日韩剧', 'series'],
    ['电影', 'movie'],
];

test('SourceNormalizer classifies animation movies as movies before the broader anime family', () => {
    for (const [category, expected] of classificationCases) {
        const record = normalizeSource(category);
        assert.equal(record.mediaType, expected, category);
        assert.equal(record.rawCategory, category, `${category} raw category remains available as genre evidence`);
    }
});

test('the danmu candidate adapter uses the same animation-movie classification precedence', () => {
    for (const [label, expected] of classificationCases) {
        const search = searchCandidate(label);
        assert.equal(search.mediaType, expected, `search: ${label}`);
        assert.equal(search.rawData?.genre, '动画');
    }

    assert.equal(searchCandidate('animation', 'film').mediaType, 'movie');
    assert.equal(
        searchCandidate('动画', '电影').mediaType,
        'movie',
        'animation and movie evidence may arrive in separate transport fields',
    );
});

test('ambiguous bare danmu TV labels remain unknown while source TV metadata keeps legacy series behavior', () => {
    assert.equal(searchCandidate('tvseries').mediaType, undefined);
    assert.equal(normalizeSource('TV').mediaType, 'series');
    assert.equal(normalizeSource('tvseries').mediaType, 'series');
    assert.equal(normalizeSource('tvshow').mediaType, 'series');
});

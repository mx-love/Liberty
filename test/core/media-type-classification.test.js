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
    ['电影', 'movie'],
    ['动漫电影', 'movie'],
    ['动画电影', 'movie'],
    ['华语电影', 'movie'],
    ['剧场版', 'movie'],
    ['Animated Movie', 'movie'],
    ['动作片', 'movie'],
    ['剧情片', 'movie'],
    ['喜剧片', 'movie'],
    ['爱情片', 'movie'],
    ['科幻片', 'movie'],
    ['恐怖片', 'movie'],
    ['犯罪片', 'movie'],
    ['悬疑片', 'movie'],
    ['惊悚片', 'movie'],
    ['战争片', 'movie'],
    ['奇幻片', 'movie'],
    ['冒险片', 'movie'],
    ['灾难片', 'movie'],
    ['武侠片', 'movie'],
    ['古装片', 'movie'],
    ['动漫', 'anime'],
    ['动画剧集', 'anime'],
    ['电视剧', 'series'],
    ['国产剧', 'series'],
    ['日剧', 'series'],
    ['大陆剧', 'series'],
    ['大陸劇', 'series'],
    ['欧美剧', 'series'],
    ['日韩剧', 'series'],
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

test('bounded movie categories do not turn generic genres or incidental 片 text into movies', () => {
    for (const category of [
        '',
        '未知',
        'N/A',
        '剧情',
        '喜剧',
        '动作',
        '剧情喜剧',
        '动作喜剧',
        '犯罪剧情',
        '短片段',
        '片花',
        '预告片',
    ]) {
        assert.equal(normalizeSource(category).mediaType, 'unknown', category || 'empty');
    }

    assert.equal(normalizeSource('纪录').mediaType, 'documentary');
    assert.equal(normalizeSource('动画').mediaType, 'anime');
});

test('explicit series and anime evidence outranks bounded movie genre categories', () => {
    const normalizeMetadata = (typeName, vodClass) => SourceNormalizer.normalize({
        vod_id: `source-${typeName}-${vodClass}`,
        vod_name: 'Classification Precedence Fixture',
        type_name: typeName,
        vod_class: vodClass,
    }, {
        sourceKey: 'fixture',
        fetchedAt: 1,
    });

    assert.equal(normalizeMetadata('电视剧', '动作片').mediaType, 'series');
    assert.equal(normalizeMetadata('国产剧', '爱情片').mediaType, 'series');
    assert.equal(normalizeMetadata('动漫', '动作片').mediaType, 'anime');
    assert.equal(normalizeMetadata('动画剧集', '科幻片').mediaType, 'anime');
    assert.equal(normalizeMetadata('动作片', '剧情 喜剧').mediaType, 'movie');
});

import test from 'node:test';
import assert from 'node:assert/strict';

await import('../js/danmu/match-core.js');

const core = globalThis.LibertyDanmuMatchCore;

test('final dirty-source labels remain conservative without index guesses for noise and extras', () => {
    for (const name of ['第01集', '第1集']) assert.equal(context({ rawEpisodeName: name }).episodeNumber, 1);
    for (const name of ['第12集', '12', '12集', 'EP12', 'E12', 'HD第12集', '1080P第12集', '第12集1080P', '第12集国语']) {
        assert.equal(context({ rawEpisodeName: name, episodeIndex: 1 }).episodeNumber, 12, name);
    }
    for (const name of ['线路1', '线路2', '备用', '备用2', '正片', '正片国语', '4K', '1080P',
        '20260926', '2026-09-26', '第20260926期', '20260926加更版', '花絮', '预告', '特别篇', '番外', 'SP', 'SP1', 'OVA', 'OVA2', 'OAD']) {
        const result = context({ rawEpisodeName: name, episodeIndex: 1 });
        assert.equal(result.episodeNumber, null, name);
        assert.equal(Number.isNaN(result.episodeIdentity.specialNumber), false, name);
    }
});

test('unnumbered extra types and upper/lower parts cannot silently map to each other', () => {
    for (const [target, other] of [['花絮', '预告'], ['上篇', '下篇'], ['SP', 'SP1']]) {
        assert.equal(core.resolveEpisodeFromList([{ episodeTitle: other }], context({ rawEpisodeName: target })).episode, null);
    }
});

test('session confidence accepts numeric scoring but rejects unknown or low confidence', () => {
    assert.equal(core.createSessionSource({ confidence: 80, animeId: 1 }, context()).confidence, 'high');
    assert.equal(core.createSessionSource({ confidence: 'invalid', animeId: 1 }, context()), null);
    assert.equal(core.createSessionSource({ confidence: 20, animeId: 1 }, context()), null);
});

function context(overrides = {}) {
    return core.createPlaybackContext({
        rawTitle: '测试剧',
        rawEpisodeName: '第1集',
        episodeIndex: 0,
        episodeCount: 12,
        allowIndexFallback: true,
        ...overrides,
    });
}

test('parses normal episode labels without coupling to playlist index', () => {
    assert.equal(context().episodeNumber, 1);
    assert.equal(context({ rawEpisodeName: '第2集', episodeIndex: 1 }).episodeNumber, 2);

    const twelfth = context({ rawEpisodeName: '第12集', episodeIndex: 1 });
    assert.equal(twelfth.episodeIndex, 1);
    assert.equal(twelfth.episodeNumber, 12);
    assert.equal(twelfth.episodeSource, 'explicit_episode_label');
    assert.equal(twelfth.episodeConfidence, 'high');
});

test('parses explicit season and never invents S01 for unknown season', () => {
    const known = context({ rawTitle: '测试剧 第二季', rawEpisodeName: '第5集', episodeIndex: 4 });
    assert.equal(known.season, 2);
    assert.equal(known.episodeNumber, 5);
    assert.ok(core.buildMatchQueries(known).some(query => query.includes('S02E05')));

    const unknown = context({ rawTitle: '测试剧', rawEpisodeName: '第5集', episodeIndex: 4 });
    assert.equal(unknown.season, null);
    assert.ok(core.buildMatchQueries(unknown).some(query => query.includes('第5集')));
    assert.ok(core.buildMatchQueries(unknown).every(query => !query.includes('S01E05')));
});

test('keeps a trailing title digit as a candidate instead of asserting a season', () => {
    const parsed = context({ rawTitle: '庆余年2', rawEpisodeName: '第5集' });
    assert.equal(parsed.normalizedTitle, '庆余年2');
    assert.equal(parsed.season, null);
    assert.equal(parsed.seasonConfidence, 'unknown');
    assert.deepEqual(parsed.seasonCandidates[0], {
        season: 2,
        baseTitle: '庆余年',
        confidence: 'low',
        source: 'title_trailing_digit_candidate',
    });
});

test('does not parse years or quality/route/codec tokens as episodes', () => {
    const rejected = [
        '1080P', '720P', '4K', '2026', '线路1', '线路2', 'CD1', 'BD2',
        'AV1', 'H264', 'H265', '10bit', '1920x1080',
    ];
    rejected.forEach(label => {
        const parsed = core.parseEpisodeIdentity(label, { episodeIndex: 1, allowIndexFallback: true });
        assert.equal(parsed.episodeNumber, null, label);
    });
    assert.equal(context({ rawTitle: '测试剧 2026', rawEpisodeName: '第2集' }).episodeNumber, 2);
});

test('parses explicit, numeric and Chinese episode forms by confidence', () => {
    const cases = [
        ['1080P 第02集', 2, 'high'],
        ['12', 12, 'medium'],
        ['E12', 12, 'high'],
        ['EP12', 12, 'high'],
        ['第十二集', 12, 'high'],
        ['12集', 12, 'high'],
    ];
    cases.forEach(([label, number, confidence]) => {
        const parsed = core.parseEpisodeIdentity(label);
        assert.equal(parsed.episodeNumber, number, label);
        assert.equal(parsed.confidence, confidence, label);
    });
});

test('keeps special episodes and movie labels out of numeric episode fallback', () => {
    ['SP', 'OVA', 'OAD', '特别篇', '番外', '上篇', '下篇'].forEach(label => {
        const parsed = core.parseEpisodeIdentity(label, { episodeIndex: 1, allowIndexFallback: true });
        assert.equal(parsed.episodeNumber, null, label);
        assert.ok(parsed.specialType, label);
    });

    ['正片', 'HD', '高清', '国语', '粤语', '1080P'].forEach(label => {
        const parsed = core.createPlaybackContext({ rawTitle: '测试电影', rawEpisodeName: label, episodeIndex: 0 });
        assert.equal(parsed.contentType, 'movie', label);
        assert.equal(parsed.episodeNumber, null, label);
        assert.ok(core.buildMatchQueries(parsed).every(query => !/E0?1|第1集/.test(query)), label);
    });
});

test('supports variety issue numbers and date identities without treating dates as episodes', () => {
    const issue = context({ rawTitle: '测试综艺', rawEpisodeName: '第12期' });
    assert.equal(issue.contentType, 'variety');
    assert.equal(issue.episodeNumber, 12);

    ['20260926', '2026-09-26', '第20260926期', '20260926加更版'].forEach(label => {
        const parsed = context({ rawTitle: '测试综艺', rawEpisodeName: label });
        assert.equal(parsed.contentType, 'variety', label);
        assert.equal(parsed.episodeNumber, null, label);
        assert.equal(parsed.episodeIdentity.dateIdentity, '20260926', label);
    });
});

test('validates API episode results against the real target episode number', () => {
    const target = context({ rawEpisodeName: '第12集', episodeIndex: 1 });
    const correct = core.validateApiMatches([{
        animeId: 'a', animeTitle: '测试剧', episodeId: 'ep12', episodeTitle: '测试剧 第12集',
    }], target);
    assert.equal(correct.match?.episodeId, 'ep12');
    assert.equal(correct.confidence, 'high');

    const wrong = core.validateApiMatches([{
        animeId: 'a', animeTitle: '测试剧', episodeId: 'ep2', episodeTitle: '测试剧 第2集',
    }], target);
    assert.equal(wrong.match, null);
    assert.match(wrong.reason, /episode_mismatch/);
});

test('does not auto-accept an API result whose episode cannot be verified', () => {
    const target = context({ rawEpisodeName: '第12集', episodeIndex: 1 });
    const result = core.validateApiMatches([{
        animeId: 'a', animeTitle: '测试剧', episodeId: 'ambiguous', episodeTitle: '正片',
    }], target);
    assert.equal(result.match, null);
    assert.equal(result.analyzed[0].confidence, 'low');
});

test('maps anime episodes by episode number and rejects index-based mismatch', () => {
    const target = context({ rawEpisodeName: '第12集', episodeIndex: 1 });
    const episodes = [
        { episodeId: 'ep1', episodeTitle: '第1集' },
        { episodeId: 'ep12', episodeTitle: '第12集' },
    ];
    assert.equal(core.resolveEpisodeFromList(episodes, target).episode?.episodeId, 'ep12');

    const wrong = [{ episodeId: 'ep1', episodeTitle: '第1集' }, { episodeId: 'ep2', episodeTitle: '第2集' }];
    assert.equal(core.resolveEpisodeFromList(wrong, target).episode, null);
});

test('an incorrect first match cannot contaminate the following session', () => {
    const next = context({ rawTitle: '正确作品', rawEpisodeName: '第2集', episodeIndex: 1, year: 2026 });
    const wrongSession = {
        animeId: 'wrong',
        animeTitle: '错误作品',
        normalizedTitle: '错误作品',
        year: 2025,
        selectedBy: 'auto',
        confidence: 'high',
        episodes: [{ episodeId: 'wrong2', episodeTitle: '第2集' }],
    };
    const validation = core.isSessionSourceCompatible(wrongSession, next);
    assert.equal(validation.compatible, false);
    assert.ok(['title_changed', 'year_conflict'].includes(validation.reason));
});

test('trusted platform is only a preferred candidate and keeps an unhinted fallback', () => {
    const parsed = context({
        rawEpisodeName: '第2集',
        platformHint: 'qiyi',
        platformConfidence: 'high',
    });
    const queries = core.buildMatchQueries(parsed);
    assert.ok(queries.some(query => query.endsWith('@qiyi')));
    assert.ok(queries.some(query => !query.includes('@qiyi')));
});

test('parses dirty acquisition labels but rejects numeric noise tokens', () => {
    const explicit = ['HD第2集', '1080P第2集', '第2集1080P'];
    explicit.forEach(label => assert.equal(core.parseEpisodeIdentity(label).episodeNumber, 2, label));

    const noise = ['线路1', '备用2', 'CD1', '正片', '高清', '国语', '4K'];
    noise.forEach(label => {
        const parsed = core.parseEpisodeIdentity(label, { episodeIndex: 11, allowIndexFallback: true });
        assert.equal(parsed.episodeNumber, null, label);
        assert.equal(parsed.usedIndexFallback, false, label);
    });
});

test('keeps numbered specials separate from regular episodes', () => {
    const cases = [
        ['SP1', 'sp', 1],
        ['OVA2', 'ova', 2],
        ['OAD', 'oad', null],
        ['花絮', 'extra', null],
        ['预告', 'extra', null],
    ];
    cases.forEach(([label, specialType, specialNumber]) => {
        const parsed = core.parseEpisodeIdentity(label, { episodeIndex: 10, allowIndexFallback: true });
        assert.equal(parsed.episodeNumber, null, label);
        assert.equal(parsed.specialType, specialType, label);
        assert.equal(parsed.specialNumber, specialNumber, label);
    });
});

test('preserves raw acquisition values alongside parsed identity', () => {
    const parsed = core.createPlaybackContext({
        rawTitle: '庆余年2',
        rawEpisodeName: '第12集',
        rawRemarks: '更新至12集',
        rawSourceName: '采集线路A',
        episodeIndex: 1,
    });
    assert.equal(parsed.rawTitle, '庆余年2');
    assert.equal(parsed.rawEpisodeName, '第12集');
    assert.equal(parsed.rawRemarks, '更新至12集');
    assert.equal(parsed.rawSourceName, '采集线路A');
    assert.equal(parsed.rawEpisodeIndex, 1);
    assert.equal(parsed.episodeNumber, 12);
});

test('playlist index 10 can still resolve real episode 12', () => {
    const target = context({ rawEpisodeName: '第12集', episodeIndex: 10 });
    assert.equal(target.episodeIndex, 10);
    assert.equal(target.episodeNumber, 12);
    assert.equal(core.resolveEpisodeFromList([
        { episodeId: 'ep11', episodeTitle: '第11集' },
        { episodeId: 'ep12', episodeTitle: '第12集' },
    ], target).episode?.episodeId, 'ep12');
});

test('playlist starting at episode 11 never maps by array position', () => {
    const episodes = [
        { episodeId: 'ep11', episodeTitle: '第11集' },
        { episodeId: 'ep12', episodeTitle: '第12集' },
        { episodeId: 'ep15', episodeTitle: '第15集' },
    ];
    const target = context({ rawEpisodeName: '第15集', episodeIndex: 2 });
    assert.equal(core.resolveEpisodeFromList(episodes, target).episode?.episodeId, 'ep15');
});

test('inserted extras and previews do not shift regular episode mapping', () => {
    const episodes = [
        { episodeId: 'ep11', episodeTitle: '第11集' },
        { episodeId: 'extra', episodeTitle: '花絮' },
        { episodeId: 'preview', episodeTitle: '预告' },
        { episodeId: 'ep12', episodeTitle: '第12集' },
    ];
    const regular = context({ rawEpisodeName: '第12集', episodeIndex: 3 });
    const extra = context({ rawEpisodeName: '花絮', episodeIndex: 1 });
    assert.equal(core.resolveEpisodeFromList(episodes, regular).episode?.episodeId, 'ep12');
    assert.equal(core.resolveEpisodeFromList(episodes, extra).episode?.episodeId, 'extra');
});

test('title variants remain conservative about inferred seasons', () => {
    assert.equal(core.parseSeasonIdentity('庆余年2').season, null);
    assert.equal(core.parseSeasonIdentity('斗破苍穹5').season, null);
    assert.equal(core.parseSeasonIdentity('斗破苍穹年番').season, null);
    assert.equal(core.parseSeasonIdentity('凡人修仙传年番').season, null);
    assert.equal(core.parseSeasonIdentity('庆余年第二季').season, 2);
    assert.equal(core.parseSeasonIdentity('庆余年 S2').season, 2);
});

test('API validation rejects right episode with wrong title', () => {
    const target = context({ rawTitle: '正确作品', rawEpisodeName: '第12集', episodeIndex: 1 });
    const result = core.validateApiMatches([{
        animeId: 'wrong', animeTitle: '完全不同作品', episodeId: 'ep12', episodeTitle: '第12集',
    }], target);
    assert.equal(result.match, null);
    assert.match(result.reason, /title_mismatch/);
});

test('API validation rejects same title with conflicting year or season', () => {
    const byYear = core.validateApiMatches([{
        animeId: 'old', animeTitle: '同名作品 2025', episodeId: 'ep1', episodeTitle: '第1集',
    }], context({ rawTitle: '同名作品 2026', rawEpisodeName: '第1集', year: 2026 }));
    assert.equal(byYear.match, null);
    assert.match(byYear.reason, /year_mismatch/);

    const bySeason = core.validateApiMatches([{
        animeId: 's1', animeTitle: '同名作品 第一季', episodeId: 'ep5', episodeTitle: '第5集',
    }], context({ rawTitle: '同名作品 第二季', rawEpisodeName: '第5集' }));
    assert.equal(bySeason.match, null);
    assert.match(bySeason.reason, /season_mismatch/);
});

test('low confidence auto source is not persisted while manual source is', () => {
    const target = context({ rawEpisodeName: '第12集', episodeIndex: 1 });
    const info = {
        animeId: 'anime',
        animeTitle: '测试剧',
        episodes: [{ episodeId: 'ep12', episodeTitle: '第12集' }],
    };
    assert.equal(core.createSessionSource({ ...info, selectedBy: 'auto', confidence: 'low' }, target), null);
    const manual = core.createSessionSource({ ...info, selectedBy: 'manual', confidence: 'low' }, target);
    assert.equal(manual?.selectedBy, 'manual');
    assert.equal(manual?.confidence, 'exact');
});

test('session survives a line change for the same work but not a work or season change', () => {
    const original = context({ rawTitle: '同一作品 第二季', rawEpisodeName: '第5集', sourceCode: 'line-a' });
    const source = core.createSessionSource({
        animeId: 'anime-s2',
        animeTitle: '同一作品 第二季',
        selectedBy: 'auto',
        confidence: 'high',
        episodes: [{ episodeId: 'ep5', episodeTitle: '第5集' }],
    }, original);
    assert.equal(core.isSessionSourceCompatible(source, context({
        rawTitle: '同一作品 第二季', rawEpisodeName: '第5集', sourceCode: 'line-b',
    })).compatible, true);
    assert.equal(core.isSessionSourceCompatible(source, context({
        rawTitle: '另一作品 第二季', rawEpisodeName: '第5集', sourceCode: 'line-b',
    })).compatible, false);
    assert.equal(core.isSessionSourceCompatible(source, context({
        rawTitle: '同一作品 第一季', rawEpisodeName: '第5集', sourceCode: 'line-b',
    })).compatible, false);
});

test('session missing the current real episode must fall back to rematching', () => {
    const target = context({ rawTitle: '测试剧', rawEpisodeName: '第12集', episodeIndex: 1 });
    const source = core.createSessionSource({
        animeId: 'incomplete',
        animeTitle: '测试剧',
        selectedBy: 'auto',
        confidence: 'high',
        episodes: [{ episodeId: 'ep1', episodeTitle: '第1集' }, { episodeId: 'ep2', episodeTitle: '第2集' }],
    }, target);
    const result = core.isSessionSourceCompatible(source, target);
    assert.equal(result.compatible, false);
    assert.match(result.reason, /episode_mapping/);
});

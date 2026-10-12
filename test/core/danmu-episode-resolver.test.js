import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DanmuEpisodeResolver,
  parseEpisode,
  resolveDanmakuEpisode,
} from '../../js/liberty-core.js';

const MEDIA_ID = 'canonical-media';

function canonicalEpisode(label, index, overrides = {}) {
  const parsed = parseEpisode(label);
  return {
    canonicalEpisodeId: `canonical-${index}`,
    mediaId: MEDIA_ID,
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

function canonicalSequence(labels) {
  return labels.map((label, index) => canonicalEpisode(label, index));
}

function canonicalMedia(episodes, overrides = {}) {
  return {
    mediaId: MEDIA_ID,
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
    episodes,
    ...overrides,
  };
}

function danmuEpisode(label, index, overrides = {}) {
  return {
    animeId: 'anime-opaque',
    rawIndex: index,
    seasonId: 'season-opaque',
    episodeId: `episode-opaque-${index}`,
    episodeTitle: label,
    apiEpisodeNumber: String(index + 1),
    airDate: null,
    url: '',
    rawData: {},
    ...overrides,
  };
}

function resolveFixture(canonicalLabels, targetIndex, danmuLabels, options = {}) {
  const canonicalEpisodes = canonicalSequence(canonicalLabels);
  const danmuEpisodes = danmuLabels.map((label, index) => danmuEpisode(label, index));
  return resolveDanmakuEpisode({
    media: canonicalMedia(canonicalEpisodes, options.media),
    targetEpisode: canonicalEpisodes[targetIndex],
    canonicalEpisodes,
    danmuEpisodes,
  });
}

test('rawIndex 1 / E12 resolves by the title identity, not index or API episodeNumber', () => {
  const canonicalEpisodes = canonicalSequence(['第11集', '第12集', '第13集']);
  const candidate = danmuEpisode('第12集', 37, {
    episodeId: 'opaque-id-not-12',
    apiEpisodeNumber: '2',
  });
  const resolution = new DanmuEpisodeResolver().resolve({
    media: canonicalMedia(canonicalEpisodes),
    targetEpisode: canonicalEpisodes[1],
    canonicalEpisodes,
    danmuEpisodes: [candidate],
  });

  assert.equal(resolution.state, 'supported');
  assert.equal(resolution.selected, candidate);
  assert.equal(resolution.selected?.episodeTitle, '第12集');
  assert.equal(resolution.selected?.episodeId, 'opaque-id-not-12');
  assert.ok(resolution.evidence.some(({ code }) => /^exact_(?:episode|absolute)_number$/u.test(code)));
  assert.deepEqual(resolution.rejectionReasons, []);
});

test('an E2 title is rejected for E12 even when the API number falsely says 12', () => {
  const canonicalEpisodes = canonicalSequence(['第11集', '第12集', '第13集']);
  const wrong = danmuEpisode('第2集', 0, { apiEpisodeNumber: '12' });
  const resolution = resolveDanmakuEpisode({
    media: canonicalMedia(canonicalEpisodes),
    targetEpisode: canonicalEpisodes[1],
    canonicalEpisodes,
    danmuEpisodes: [wrong],
  });

  assert.equal(resolution.state, 'not_found');
  assert.equal(resolution.selected, null);
  assert.deepEqual(resolution.candidates, []);
});

test('inserted or missing specials do not shift later regular episodes', () => {
  const canonicalWithoutSpecial = canonicalSequence(['第1集', '第2集']);
  const inserted = [
    danmuEpisode('第1集', 0),
    danmuEpisode('SP1', 1),
    danmuEpisode('第2集', 2),
  ];
  const insertedResolution = resolveDanmakuEpisode({
    media: canonicalMedia(canonicalWithoutSpecial),
    targetEpisode: canonicalWithoutSpecial[1],
    canonicalEpisodes: canonicalWithoutSpecial,
    danmuEpisodes: inserted,
  });
  assert.equal(insertedResolution.state, 'supported');
  assert.equal(insertedResolution.selected, inserted[2]);

  const canonicalWithSpecial = canonicalSequence(['第1集', 'SP1', '第2集']);
  const missing = [danmuEpisode('第1集', 0), danmuEpisode('第2集', 1)];
  const missingSpecialResolution = resolveDanmakuEpisode({
    media: canonicalMedia(canonicalWithSpecial),
    targetEpisode: canonicalWithSpecial[1],
    canonicalEpisodes: canonicalWithSpecial,
    danmuEpisodes: missing,
  });
  assert.equal(missingSpecialResolution.state, 'not_found');
  assert.equal(missingSpecialResolution.selected, null);

  const missingResolution = resolveDanmakuEpisode({
    media: canonicalMedia(canonicalWithSpecial),
    targetEpisode: canonicalWithSpecial[2],
    canonicalEpisodes: canonicalWithSpecial,
    danmuEpisodes: missing,
  });
  assert.equal(missingResolution.state, 'supported');
  assert.equal(missingResolution.selected, missing[1]);
});

test('a sequence beginning at episode 11 resolves E12 without positional offset', () => {
  const resolution = resolveFixture(
    ['第11集', '第12集', '第13集'],
    1,
    ['第9集', '第10集', '第11集', '第12集', '第13集'],
  );

  assert.equal(resolution.state, 'supported');
  assert.equal(resolution.selected?.episodeTitle, '第12集');
  assert.equal(resolution.selected?.rawIndex, 3);
});

test('long-running episode E125 remains an explicit identity', () => {
  const resolution = resolveFixture(
    ['第124话', '第125话', '第126话'],
    1,
    ['E125'],
  );

  assert.equal(resolution.state, 'supported');
  assert.equal(resolution.selected?.episodeTitle, 'E125');
});

test('variety dates resolve as dates and never as array-derived episode numbers', () => {
  const canonicalEpisodes = canonicalSequence(['2026-09-19', '2026-09-26']);
  const candidate = danmuEpisode('第20260926期', 0, { apiEpisodeNumber: '1' });
  const resolution = resolveDanmakuEpisode({
    media: canonicalMedia(canonicalEpisodes, { mediaType: 'variety' }),
    targetEpisode: canonicalEpisodes[1],
    canonicalEpisodes,
    danmuEpisodes: [candidate],
  });

  assert.equal(resolution.state, 'supported');
  assert.equal(resolution.selected, candidate);
});

test('a semantic upstream airDate can identify a variety item when its title is weak', () => {
  const canonicalEpisodes = canonicalSequence(['2026-09-26']);
  const candidate = danmuEpisode('当期节目', 0, {
    apiEpisodeNumber: '1',
    airDate: '2026-09-26',
  });
  const resolution = resolveDanmakuEpisode({
    media: canonicalMedia(canonicalEpisodes, { mediaType: 'variety' }),
    targetEpisode: canonicalEpisodes[0],
    canonicalEpisodes,
    danmuEpisodes: [candidate],
  });

  assert.equal(resolution.state, 'supported');
  assert.equal(resolution.selected, candidate);
  assert.ok(resolution.evidence.some(({ code }) => code === 'exact_air_date'));
});

test('a unique explicit movie main feature resolves with whole-media scope without inventing E01', () => {
  const canonicalEpisodes = canonicalSequence(['正片']);
  const candidate = danmuEpisode('完整版', 0, {
    episodeId: 'opaque-main-feature',
    apiEpisodeNumber: '1',
  });
  const resolution = resolveDanmakuEpisode({
    media: canonicalMedia(canonicalEpisodes, { mediaType: 'movie' }),
    targetEpisode: canonicalEpisodes[0],
    canonicalEpisodes,
    danmuEpisodes: [candidate],
  });

  assert.equal(canonicalEpisodes[0].episodeNumber, null);
  assert.equal(resolution.state, 'supported');
  assert.equal(resolution.selected, candidate);
  assert.equal(resolution.bindingScope, 'whole_media');
  assert.ok(resolution.evidence.some(({ code }) => code === 'source_sequence_membership'));
});

test('whole-media resolution uses unique structure when labels are absent or non-semantic', async (t) => {
  for (const [name, sourceLabel, danmuLabel] of [
    ['empty labels', '', ''],
    ['numeric source and work-title danmu label', '1', 'Fixture Movie'],
    ['quality source and empty danmu label', 'HD', ''],
  ]) {
    await t.test(name, () => {
      const canonicalEpisodes = [canonicalEpisode(sourceLabel, 0, {
        contentType: 'movie',
        seasonNumber: null,
        episodeNumber: null,
        absoluteNumber: null,
        airDate: null,
        identityState: 'supported',
      })];
      const media = canonicalMedia(canonicalEpisodes, {
        mediaType: 'movie',
        canonicalTitle: 'Fixture Movie',
      });
      const resolution = resolveDanmakuEpisode({
        media,
        targetEpisode: canonicalEpisodes[0],
        canonicalEpisodes,
        danmuEpisodes: [danmuEpisode(danmuLabel, 0)],
      });

      assert.equal(canonicalEpisodes[0].episodeNumber, null);
      assert.equal(resolution.state, 'supported');
      assert.equal(resolution.bindingScope, 'whole_media');
      assert.equal(resolution.selected?.episodeTitle, danmuLabel);
    });
  }
});

test('a unique danmu label equal to the movie title is not special-content evidence', () => {
  const canonicalEpisodes = [canonicalEpisode('Midnight Special', 0, {
    contentType: 'movie',
    seasonNumber: null,
    episodeNumber: null,
    absoluteNumber: null,
    airDate: null,
  })];
  const media = canonicalMedia(canonicalEpisodes, {
    mediaType: 'movie',
    canonicalTitle: 'Midnight Special',
  });
  const resolution = resolveDanmakuEpisode({
    media,
    targetEpisode: canonicalEpisodes[0],
    canonicalEpisodes,
    danmuEpisodes: [danmuEpisode('Midnight Special', 0)],
  });

  assert.equal(resolution.state, 'supported');
  assert.equal(resolution.bindingScope, 'whole_media');
});

test('a numbered canonical movie episode is not reinterpreted as whole-media scope', () => {
  const canonicalEpisodes = [canonicalEpisode('E1', 0)];
  const resolution = resolveDanmakuEpisode({
    media: canonicalMedia(canonicalEpisodes, {
      mediaType: 'movie',
      canonicalTitle: 'Fixture Movie',
    }),
    targetEpisode: canonicalEpisodes[0],
    canonicalEpisodes,
    danmuEpisodes: [danmuEpisode('', 0)],
  });

  assert.equal(canonicalEpisodes[0].episodeNumber, 1);
  assert.equal(resolution.selected, null);
  assert.equal(resolution.bindingScope, null);
});

test('whole-media resolution requires one unambiguous item on both sides', async (t) => {
  await t.test('one source item and two danmu main-feature items remain uncertain', () => {
    const canonicalEpisodes = canonicalSequence(['正片']);
    const resolution = resolveDanmakuEpisode({
      media: canonicalMedia(canonicalEpisodes, { mediaType: 'movie' }),
      targetEpisode: canonicalEpisodes[0],
      canonicalEpisodes,
      danmuEpisodes: [danmuEpisode('正片', 0), danmuEpisode('完整版', 1)],
    });

    assert.equal(resolution.state, 'uncertain');
    assert.equal(resolution.selected, null);
    assert.equal(resolution.bindingScope, null);
  });

  await t.test('two source items and one danmu main-feature item remain uncertain', () => {
    const canonicalEpisodes = canonicalSequence(['正片', '完整版']);
    const resolution = resolveDanmakuEpisode({
      media: canonicalMedia(canonicalEpisodes, { mediaType: 'movie' }),
      targetEpisode: canonicalEpisodes[0],
      canonicalEpisodes,
      danmuEpisodes: [danmuEpisode('正片', 0)],
    });

    assert.equal(resolution.state, 'uncertain');
    assert.equal(resolution.selected, null);
    assert.equal(resolution.bindingScope, null);
  });

  await t.test('trailers, PVs and special extras cannot be promoted to the movie main feature', () => {
    const canonicalEpisodes = canonicalSequence(['正片']);
    for (const label of [
      '预告片', 'PV', 'trailer', 'Teaser', 'SP', '花絮', '幕后', '特典',
      'Special', 'Extra', 'Bonus', 'Clip', '片段', '采访', '制作特辑',
    ]) {
      const resolution = resolveDanmakuEpisode({
        media: canonicalMedia(canonicalEpisodes, { mediaType: 'movie' }),
        targetEpisode: canonicalEpisodes[0],
        canonicalEpisodes,
        danmuEpisodes: [danmuEpisode(label, 0)],
      });

      assert.ok(
        resolution.state === 'not_found'
          || resolution.state === 'uncertain'
          || resolution.state === 'rejected',
        label,
      );
      assert.equal(resolution.selected, null, label);
      assert.equal(resolution.bindingScope, null, label);
    }
  });

  await t.test('an unresolved canonical media cannot establish whole-media scope', () => {
    const canonicalEpisodes = canonicalSequence(['正片']);
    const resolution = resolveDanmakuEpisode({
      media: canonicalMedia(canonicalEpisodes, { mediaType: 'movie', identityState: 'uncertain' }),
      targetEpisode: canonicalEpisodes[0],
      canonicalEpisodes,
      danmuEpisodes: [danmuEpisode('正片', 0)],
    });

    assert.equal(resolution.selected, null);
    assert.equal(resolution.bindingScope, null);
  });
});

test('TV resolution retains canonical-episode semantics and never uses singleton structure', async (t) => {
  await t.test('an explicit single TV episode remains canonical-episode scoped', () => {
    const resolution = resolveFixture(['第01集'], 0, ['E01']);

    assert.equal(resolution.state, 'supported');
    assert.equal(resolution.selected?.episodeTitle, 'E01');
    assert.equal(resolution.bindingScope, 'canonical_episode');
  });

  await t.test('a TV item named 正片 is not treated as a whole-media movie', () => {
    const canonicalEpisodes = canonicalSequence(['正片']);
    const resolution = resolveDanmakuEpisode({
      media: canonicalMedia(canonicalEpisodes, { mediaType: 'series' }),
      targetEpisode: canonicalEpisodes[0],
      canonicalEpisodes,
      danmuEpisodes: [danmuEpisode('正片', 0)],
    });

    assert.equal(resolution.selected, null);
    assert.equal(resolution.bindingScope, null);
  });

  await t.test('URL-only metadata stays unresolved even when both positions are zero', () => {
    const canonicalEpisodes = [canonicalEpisode('https://media.example.test/main.m3u8', 0, {
      contentType: 'unknown',
      episodeNumber: null,
      absoluteNumber: null,
      episodeTitle: null,
      identityState: 'uncertain',
    })];
    const resolution = resolveDanmakuEpisode({
      media: canonicalMedia(canonicalEpisodes),
      targetEpisode: canonicalEpisodes[0],
      canonicalEpisodes,
      danmuEpisodes: [danmuEpisode('第1集', 0, { apiEpisodeNumber: '1' })],
    });

    assert.equal(resolution.selected, null);
    assert.equal(resolution.bindingScope, null);
  });

  await t.test('existing pure-numeric 1/01 episode identity remains canonical-episode scoped', () => {
    const resolution = resolveFixture(['1'], 0, ['01']);

    assert.equal(resolution.state, 'supported');
    assert.equal(resolution.selected?.episodeTitle, '01');
    assert.equal(resolution.bindingScope, 'canonical_episode');
  });
});

test('duplicate E12 candidates remain ambiguous', () => {
  const canonicalEpisodes = canonicalSequence(['第12集']);
  const candidates = [
    danmuEpisode('第12集', 0, { episodeId: 'first-E12' }),
    danmuEpisode('E12', 1, { episodeId: 'second-E12' }),
  ];
  const resolution = resolveDanmakuEpisode({
    media: canonicalMedia(canonicalEpisodes),
    targetEpisode: canonicalEpisodes[0],
    canonicalEpisodes,
    danmuEpisodes: candidates,
  });

  assert.equal(resolution.state, 'uncertain');
  assert.equal(resolution.selected, null);
  assert.deepEqual(resolution.candidates, candidates);
});

test('an explicit season conflict maps through as rejected', () => {
  const canonicalEpisodes = canonicalSequence(['S02E12']);
  const wrongSeason = danmuEpisode('S01E12', 0);
  const resolution = resolveDanmakuEpisode({
    media: canonicalMedia(canonicalEpisodes, { season: 2 }),
    targetEpisode: canonicalEpisodes[0],
    canonicalEpisodes,
    danmuEpisodes: [wrongSeason],
  });

  assert.equal(resolution.state, 'rejected');
  assert.equal(resolution.selected, null);
  assert.deepEqual(resolution.candidates, [wrongSeason]);
});

test('a target without an independent identity still honors genuine sequence conflicts', () => {
  const resolution = resolveFixture(
    ['E11', 'Unidentified middle', 'E13'],
    1,
    ['E13', 'Unidentified middle', 'E11'],
  );

  assert.equal(resolution.state, 'rejected');
  assert.equal(resolution.selected, null);
  assert.ok(resolution.rejectionReasons.some((reason) => /reverse|conflict/iu.test(reason)));
});

test('matching array coordinates alone never create an episode binding', () => {
  const resolution = resolveFixture(
    ['Source alpha', 'Source beta', 'Source gamma'],
    1,
    ['Danmu alpha', 'Danmu beta', 'Danmu gamma'],
  );

  assert.ok(resolution.state === 'not_found' || resolution.state === 'uncertain');
  assert.equal(resolution.selected, null);
});

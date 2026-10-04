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

test('movie 正片 remains uncertain instead of being invented as E01', () => {
  const canonicalEpisodes = canonicalSequence(['正片']);
  const candidate = danmuEpisode('正片', 0, { apiEpisodeNumber: '1' });
  const resolution = resolveDanmakuEpisode({
    media: canonicalMedia(canonicalEpisodes, { mediaType: 'movie' }),
    targetEpisode: canonicalEpisodes[0],
    canonicalEpisodes,
    danmuEpisodes: [candidate],
  });

  assert.equal(resolution.state, 'uncertain');
  assert.equal(resolution.selected, null);
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

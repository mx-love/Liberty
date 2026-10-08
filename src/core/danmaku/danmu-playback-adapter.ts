import { parseEpisode } from '../episode/episode-parser.js';
import { parseTitle } from '../identity/title-parser.js';
import { SourceNormalizer } from '../source/source-normalizer.js';
import type { CanonicalEpisode, ParsedEpisodeInfo } from '../types/episode.js';
import type { CandidateEvidence } from '../types/identity.js';
import type { CanonicalMedia } from '../types/media.js';
import type { SourceEpisode, SourcePlayGroup, SourceRecord } from '../types/source.js';

export interface DanmakuPlaybackEpisodeInput {
  /** The coordinate supplied by the active playback list. It is never episode identity. */
  readonly rawIndex: number;
  readonly name: string;
  readonly url: string;
  readonly rawEntry?: string;
}

export interface DanmakuPlaybackInput {
  readonly sourceKey: string;
  readonly sourceName?: string;
  readonly vodId: string;
  readonly rawTitle: string;
  readonly rawYear?: string | number | null;
  readonly rawRemarks?: string | null;
  readonly rawCategory?: string | null;
  readonly rawDirector?: string | null;
  readonly rawActors?: string | null;
  readonly rawArea?: string | null;
  readonly rawLanguage?: string | null;
  readonly rawDescription?: string | null;
  readonly rawCover?: string | null;
  readonly rawData?: Readonly<Record<string, unknown>>;
  readonly playGroup?: string;
  readonly playGroupIndex?: number;
  readonly episodes: readonly DanmakuPlaybackEpisodeInput[];
  /** Selects a raw playback coordinate; it is not converted to an episode number. */
  readonly currentEpisodeIndex: number;
  readonly fetchedAt?: number;
}

export type DanmakuPlaybackContextState = 'ready' | 'uncertain' | 'invalid';

/**
 * Input accepted by DanmuService plus the normalized source sequence used to
 * construct it. Nullable targets make malformed or ambiguous playback state
 * explicit instead of inventing identity from an array position.
 */
export interface DanmakuPlaybackContext {
  readonly state: DanmakuPlaybackContextState;
  readonly reason: string;
  readonly sourceRecord: SourceRecord;
  readonly media: CanonicalMedia;
  readonly mediaEpisodes: readonly CanonicalEpisode[];
  readonly sourceEpisodes: readonly SourceEpisode[];
  readonly episode: CanonicalEpisode | null;
  readonly sourceEpisode: SourceEpisode | null;
  readonly currentEpisodeIndex: number;
}

interface EpisodeDraft {
  readonly input: DanmakuPlaybackEpisodeInput;
  readonly parsed: ParsedEpisodeInfo;
  readonly semanticKey: string | null;
  readonly seasonConflict: boolean;
}

function stringValue(value: string | number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function mediaScopeId(input: DanmakuPlaybackInput): string {
  // This opaque ID only scopes objects created in this context. It is not
  // exposed as matching evidence or copied to externalIds.
  return `playback-media:${stableHash(`${input.sourceKey}\u0000${input.vodId}\u0000${input.rawTitle}`)}`;
}

function partKey(value: ParsedEpisodeInfo['part']): string {
  return value === null ? '-' : String(value);
}

function reliableSemanticKey(
  parsed: ParsedEpisodeInfo,
  mediaSeason: number | null,
): string | null {
  if (parsed.confidence !== 'high' || parsed.ambiguous) return null;

  if (parsed.airDate !== null) {
    return `date:${parsed.airDate}:part:${partKey(parsed.part)}`;
  }

  if (parsed.contentType === 'regular' && parsed.episodeNumber !== null) {
    const season = parsed.seasonNumber ?? mediaSeason;
    return [
      parsed.numberKind,
      `season:${season ?? '-'}`,
      `episode:${parsed.episodeNumber}`,
      `absolute:${parsed.absoluteNumber ?? '-'}`,
      `part:${partKey(parsed.part)}`,
    ].join(':');
  }

  if (
    parsed.contentType === 'special'
    && parsed.specialKind !== null
    && parsed.specialNumber !== null
  ) {
    return `special:${parsed.specialKind}:${parsed.specialNumber}:part:${partKey(parsed.part)}`;
  }

  if (parsed.contentType === 'movie') return 'movie:main-feature';

  return null;
}

function mediaEvidence(
  rawTitle: string,
  canonicalTitle: string,
  releaseYear: number | null,
  season: number | null,
): readonly CandidateEvidence[] {
  const evidence: CandidateEvidence[] = [{
    field: 'title',
    state: canonicalTitle ? 'supporting' : 'unknown',
    reason: canonicalTitle
      ? 'The current playback title defines the local canonical media scope'
      : 'The current playback item has no usable title',
    leftValue: rawTitle,
    rightValue: canonicalTitle || null,
    source: 'danmaku-playback-adapter',
  }];

  if (releaseYear !== null) {
    evidence.push({
      field: 'year',
      state: 'supporting',
      reason: 'The source supplied an explicit release year',
      leftValue: releaseYear,
      rightValue: releaseYear,
      source: 'danmaku-playback-adapter',
    });
  }
  if (season !== null) {
    evidence.push({
      field: 'season',
      state: 'supporting',
      reason: 'The shared title parser found an explicit season marker',
      leftValue: season,
      rightValue: season,
      source: 'danmaku-playback-adapter',
    });
  }
  return evidence;
}

function rawRecord(input: DanmakuPlaybackInput): Readonly<Record<string, unknown>> {
  const rawPlayFrom = input.playGroup ?? input.sourceName ?? input.sourceKey;
  const rawPlayUrl = input.episodes
    .map((episode) => episode.rawEntry ?? `${episode.name}$${episode.url}`)
    .join('#');

  return {
    ...(input.rawData ?? {}),
    vod_id: input.vodId,
    vod_name: input.rawTitle,
    vod_year: stringValue(input.rawYear),
    vod_remarks: stringValue(input.rawRemarks),
    type_name: stringValue(input.rawCategory),
    vod_director: stringValue(input.rawDirector),
    vod_actor: stringValue(input.rawActors),
    vod_area: stringValue(input.rawArea),
    vod_lang: stringValue(input.rawLanguage),
    vod_content: stringValue(input.rawDescription),
    vod_pic: stringValue(input.rawCover),
    vod_play_from: rawPlayFrom,
    vod_play_url: rawPlayUrl,
  };
}

function unresolvedEpisodeId(mediaId: string, rawName: string, occurrence: number): string {
  // The suffix keeps two unresolved rows addressable inside this one context.
  // Such rows remain `unmapped` and the suffix is never identity evidence.
  return `${mediaId}:unresolved:${stableHash(rawName)}:${occurrence}`;
}

/**
 * Converts the production player's observed source data to Core V2 models.
 * It preserves every raw playback coordinate while deriving identity only
 * from the shared title and episode parsers.
 */
export function createDanmakuPlaybackContext(
  input: DanmakuPlaybackInput,
): DanmakuPlaybackContext {
  const normalized = SourceNormalizer.normalize(rawRecord(input), {
    sourceKey: input.sourceKey,
    sourceName: input.sourceName,
    fetchedAt: input.fetchedAt,
  });
  const parsedTitle = parseTitle(normalized.rawTitle);
  const canonicalTitle = parsedTitle.baseTitle.trim();
  const releaseYear = normalized.parsedYear ?? parsedTitle.year;
  const mediaSeason = normalized.parsedSeason;
  const mediaId = mediaScopeId(input);
  const playGroupIndex = input.playGroupIndex ?? 0;
  const playGroup = input.playGroup ?? input.sourceName ?? input.sourceKey;

  const drafts: readonly EpisodeDraft[] = input.episodes.map((episode) => {
    const parsed = parseEpisode(episode.name, { mediaType: normalized.mediaType });
    return {
      input: episode,
      parsed,
      semanticKey: reliableSemanticKey(parsed, mediaSeason),
      seasonConflict:
        mediaSeason !== null
        && parsed.seasonNumber !== null
        && mediaSeason !== parsed.seasonNumber,
    };
  });
  const semanticCounts = new Map<string, number>();
  for (const draft of drafts) {
    if (draft.semanticKey !== null) {
      semanticCounts.set(draft.semanticKey, (semanticCounts.get(draft.semanticKey) ?? 0) + 1);
    }
  }

  const unresolvedOccurrences = new Map<string, number>();
  const canonicalEpisodes: CanonicalEpisode[] = [];
  const sourceEpisodes: SourceEpisode[] = [];

  for (const draft of drafts) {
    const duplicateIdentity = draft.semanticKey !== null
      && (semanticCounts.get(draft.semanticKey) ?? 0) > 1;
    const mapped = draft.semanticKey !== null && !draft.seasonConflict && !duplicateIdentity;
    const rawName = String(draft.input.name ?? '');
    const occurrence = unresolvedOccurrences.get(rawName) ?? 0;
    unresolvedOccurrences.set(rawName, occurrence + 1);
    const canonicalEpisodeId = draft.semanticKey === null
      ? unresolvedEpisodeId(mediaId, rawName, occurrence)
      : `${mediaId}:episode:${encodeURIComponent(draft.semanticKey)}`;
    const canonicalSeason = draft.parsed.seasonNumber
      ?? (draft.parsed.contentType === 'regular' ? mediaSeason : null);
    const rawEntry = draft.input.rawEntry ?? `${rawName}$${draft.input.url}`;

    canonicalEpisodes.push({
      canonicalEpisodeId,
      mediaId,
      contentType: draft.parsed.contentType,
      seasonNumber: canonicalSeason,
      episodeNumber: draft.parsed.episodeNumber,
      absoluteNumber: draft.parsed.absoluteNumber,
      airDate: draft.parsed.airDate,
      episodeTitle: rawName.trim() || null,
      part: draft.parsed.part,
      identityState: mapped ? 'supported' : 'uncertain',
      evidence: [],
    });

    let mappingState: SourceEpisode['mappingState'] = 'unmapped';
    let mappingEvidence: readonly string[] = [
      'No reliable semantic episode identity was parsed; rawIndex was not used as a fallback',
    ];
    if (draft.seasonConflict) {
      mappingState = 'conflicting';
      mappingEvidence = [
        `Explicit episode season ${draft.parsed.seasonNumber} conflicts with media season ${mediaSeason}`,
      ];
    } else if (duplicateIdentity) {
      mappingState = 'conflicting';
      mappingEvidence = [
        'The same semantic episode identity occurs more than once in this playback list',
      ];
    } else if (mapped) {
      mappingState = 'mapped';
      mappingEvidence = [
        `Mapped from reliable parsed episode identity ${draft.semanticKey}`,
      ];
    }

    sourceEpisodes.push({
      sourceKey: input.sourceKey,
      vodId: input.vodId,
      playGroup,
      playGroupIndex,
      rawIndex: draft.input.rawIndex,
      rawEpisodeName: rawName,
      displayName: rawName.trim() || '未命名播放项',
      rawEntry,
      playUrl: draft.input.url,
      parsedEpisodeInfo: draft.parsed,
      canonicalEpisodeId: mapped ? canonicalEpisodeId : null,
      mappingState,
      mappingEvidence,
    });
  }

  const sourcePlayGroup: SourcePlayGroup = {
    sourceKey: input.sourceKey,
    vodId: input.vodId,
    rawIndex: playGroupIndex,
    rawName: playGroup,
    displayName: playGroup,
    rawValue: input.episodes
      .map((episode) => episode.rawEntry ?? `${episode.name}$${episode.url}`)
      .join('#'),
    episodes: sourceEpisodes,
  };
  const sourceRecord: SourceRecord = {
    ...normalized,
    playGroups: sourceEpisodes.length > 0 ? [sourcePlayGroup] : [],
  };
  const media: CanonicalMedia = {
    mediaId,
    mediaType: normalized.mediaType,
    canonicalTitle,
    aliases: parsedTitle.aliases,
    releaseYear,
    season: mediaSeason,
    directors: normalized.normalizedDirector,
    actors: normalized.normalizedActors,
    externalIds: {},
    evidence: mediaEvidence(normalized.rawTitle, canonicalTitle, releaseYear, mediaSeason),
    identityState: canonicalTitle ? 'supported' : 'uncertain',
    episodes: canonicalEpisodes,
  };

  const currentMatches: number[] = [];
  sourceEpisodes.forEach((episode, index) => {
    if (episode.rawIndex === input.currentEpisodeIndex) currentMatches.push(index);
  });
  if (currentMatches.length !== 1) {
    return {
      state: 'invalid',
      reason: currentMatches.length === 0
        ? 'The current raw playback coordinate is absent from the source sequence'
        : 'The current raw playback coordinate occurs more than once in the source sequence',
      sourceRecord,
      media,
      mediaEpisodes: canonicalEpisodes,
      sourceEpisodes,
      episode: null,
      sourceEpisode: null,
      currentEpisodeIndex: input.currentEpisodeIndex,
    };
  }

  const currentPosition = currentMatches[0];
  if (currentPosition === undefined) {
    return {
      state: 'invalid',
      reason: 'The current raw playback coordinate could not be selected',
      sourceRecord,
      media,
      mediaEpisodes: canonicalEpisodes,
      sourceEpisodes,
      episode: null,
      sourceEpisode: null,
      currentEpisodeIndex: input.currentEpisodeIndex,
    };
  }
  const sourceEpisode = sourceEpisodes[currentPosition] ?? null;
  const episode = canonicalEpisodes[currentPosition] ?? null;
  if (sourceEpisode === null || episode === null) {
    return {
      state: 'invalid',
      reason: 'The selected source and canonical episode sequences are inconsistent',
      sourceRecord,
      media,
      mediaEpisodes: canonicalEpisodes,
      sourceEpisodes,
      episode: null,
      sourceEpisode: null,
      currentEpisodeIndex: input.currentEpisodeIndex,
    };
  }

  const ready = media.identityState === 'supported'
    && sourceEpisode.mappingState === 'mapped'
    && episode.identityState === 'supported';
  return {
    state: ready ? 'ready' : 'uncertain',
    reason: ready
      ? 'The playback work and current episode have reliable Core V2 identities'
      : sourceEpisode.mappingEvidence.join('; '),
    sourceRecord,
    media,
    mediaEpisodes: canonicalEpisodes,
    sourceEpisodes,
    episode,
    sourceEpisode,
    currentEpisodeIndex: input.currentEpisodeIndex,
  };
}

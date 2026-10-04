import type { CanonicalEpisode, ParsedEpisodeInfo } from '../types/episode.js';
import type { CanonicalMedia } from '../types/media.js';
import type { SourceEpisode } from '../types/source.js';
import { parseEpisode } from '../episode/episode-parser.js';
import { resolveEpisode } from '../episode/episode-resolver.js';
import type {
  DanmakuEpisodeResolution,
  DanmuEpisode,
} from './danmu-types.js';

export interface DanmakuEpisodeResolutionInput {
  readonly media: CanonicalMedia;
  readonly targetEpisode: CanonicalEpisode;
  readonly canonicalEpisodes: readonly CanonicalEpisode[];
  readonly danmuEpisodes: readonly DanmuEpisode[];
}

function parsedCanonicalEpisode(
  episode: CanonicalEpisode,
  media: CanonicalMedia,
): ParsedEpisodeInfo {
  const parsedTitle = parseEpisode(episode.episodeTitle ?? '', { mediaType: media.mediaType });
  const contentType = episode.contentType === 'unknown'
    ? parsedTitle.contentType
    : episode.contentType;
  const seasonNumber = episode.seasonNumber ?? parsedTitle.seasonNumber;
  const episodeNumber = episode.episodeNumber ?? parsedTitle.episodeNumber;
  const absoluteNumber = episode.absoluteNumber ?? parsedTitle.absoluteNumber;
  const airDate = episode.airDate ?? parsedTitle.airDate;
  const part = episode.part ?? parsedTitle.part;
  const hasNumber = episodeNumber !== null || absoluteNumber !== null;
  const isSpecial = contentType === 'special';

  return {
    ...parsedTitle,
    rawName: episode.episodeTitle ?? episode.canonicalEpisodeId,
    contentType,
    seasonNumber,
    episodeNumber,
    absoluteNumber,
    specialNumber: isSpecial
      ? parsedTitle.specialNumber ?? episodeNumber ?? absoluteNumber
      : null,
    specialKind: isSpecial ? parsedTitle.specialKind ?? 'special' : null,
    airDate,
    episodeTitle: episode.episodeTitle ?? parsedTitle.episodeTitle,
    part,
    numberKind: airDate !== null
      ? 'date'
      : isSpecial
        ? 'special'
        : parsedTitle.numberKind !== 'none'
          ? parsedTitle.numberKind
          : hasNumber
            ? 'episode'
            : 'none',
    confidence: parsedTitle.confidence !== 'none' || hasNumber || isSpecial
      ? 'high'
      : 'none',
  };
}

function canonicalSourceEpisode(
  episode: CanonicalEpisode,
  media: CanonicalMedia,
  coordinate: number,
): SourceEpisode {
  const rawEpisodeName = episode.episodeTitle ?? episode.canonicalEpisodeId;

  return {
    sourceKey: `canonical:${media.mediaId}`,
    vodId: media.mediaId,
    playGroup: 'canonical',
    playGroupIndex: 0,
    // This is only a coordinate used to prove sequence membership. It is never
    // copied into ParsedEpisodeInfo or treated as an episode number.
    rawIndex: coordinate,
    rawEpisodeName,
    displayName: rawEpisodeName,
    rawEntry: episode.canonicalEpisodeId,
    playUrl: '',
    parsedEpisodeInfo: parsedCanonicalEpisode(episode, media),
    canonicalEpisodeId: episode.canonicalEpisodeId,
    mappingState: 'mapped',
    mappingEvidence: ['Canonical episode supplied by Danmaku Core'],
  };
}

interface AdaptedDanmuEpisode {
  readonly source: DanmuEpisode;
  readonly canonical: CanonicalEpisode;
}

function adaptDanmuEpisode(
  episode: DanmuEpisode,
  media: CanonicalMedia,
  coordinate: number,
): AdaptedDanmuEpisode {
  // episodeTitle is the only episode-identity input from the upstream list.
  // episodeId is opaque, rawIndex is positional, and apiEpisodeNumber may have
  // been generated from list order; none of them may become a real number.
  const parsed = parseEpisode(episode.episodeTitle, { mediaType: media.mediaType });
  const parsedAirDate = episode.airDate === null
    ? null
    : parseEpisode(episode.airDate, { mediaType: media.mediaType });
  const semanticAirDate = parsed.airDate ?? (
    parsedAirDate?.numberKind === 'date' ? parsedAirDate.airDate : null
  );
  const rawTitle = episode.episodeTitle.trim();
  const canonical: CanonicalEpisode = {
    canonicalEpisodeId: `danmu:${episode.animeId}:${episode.episodeId}:${coordinate}`,
    mediaId: media.mediaId,
    contentType: parsed.contentType,
    seasonNumber: parsed.seasonNumber,
    episodeNumber: parsed.episodeNumber,
    absoluteNumber: parsed.absoluteNumber,
    airDate: semanticAirDate,
    // Preserve the raw upstream title so the shared resolver can parse special
    // identities such as SP/OVA, whose number has no dedicated canonical field.
    episodeTitle: rawTitle || null,
    part: parsed.part,
    identityState: parsed.confidence === 'none' && semanticAirDate === null
      ? 'uncertain'
      : 'supported',
    evidence: [],
  };

  return { source: episode, canonical };
}

function rejected(reason: string): DanmakuEpisodeResolution {
  return {
    state: 'rejected',
    selected: null,
    candidates: [],
    evidence: [],
    rejectionReasons: [reason],
    reason,
  };
}

/**
 * Resolve one canonical episode to an upstream danmu episode without using
 * either sequence's array position as identity evidence.
 */
export function resolveDanmakuEpisode(
  input: DanmakuEpisodeResolutionInput,
): DanmakuEpisodeResolution {
  if (input.targetEpisode.mediaId !== input.media.mediaId) {
    return rejected(
      `Target episode belongs to media ${input.targetEpisode.mediaId}, not ${input.media.mediaId}`,
    );
  }

  const foreignCanonicalEpisode = input.canonicalEpisodes.find(
    (episode) => episode.mediaId !== input.media.mediaId,
  );
  if (foreignCanonicalEpisode) {
    return rejected(
      `Canonical episode ${foreignCanonicalEpisode.canonicalEpisodeId} belongs to another media`,
    );
  }

  const targetCoordinates = input.canonicalEpisodes.flatMap((episode, index) =>
    episode.canonicalEpisodeId === input.targetEpisode.canonicalEpisodeId ? [index] : []);
  if (targetCoordinates.length !== 1) {
    return rejected('The target episode must occur exactly once in the canonical sequence');
  }
  const targetCoordinate = targetCoordinates[0] ?? -1;
  const sourceSequence = input.canonicalEpisodes.map((episode, index) =>
    canonicalSourceEpisode(episode, input.media, index));
  const sourceEpisode = canonicalSourceEpisode(
    input.targetEpisode,
    input.media,
    targetCoordinate ?? -1,
  );
  const adaptedDanmuEpisodes = input.danmuEpisodes.map((episode, index) =>
    adaptDanmuEpisode(episode, input.media, index));
  const episodeByCanonicalId = new Map(
    adaptedDanmuEpisodes.map(({ source, canonical }) => [canonical.canonicalEpisodeId, source]),
  );

  const isolatedSourceEpisode = canonicalSourceEpisode(input.targetEpisode, input.media, 0);
  const isolatedResolution = resolveEpisode({
    sourceEpisode: isolatedSourceEpisode,
    sourceSequence: [isolatedSourceEpisode],
    canonicalMedia: input.media,
    candidateEpisodes: adaptedDanmuEpisodes.map(({ canonical }) => canonical),
  });
  const isolatedIsDecisive = (
    isolatedResolution.state === 'verified' ||
    isolatedResolution.state === 'supported' ||
    isolatedResolution.state === 'rejected' ||
    (
      isolatedResolution.candidates.length > 1 &&
      isolatedResolution.evidence.some(({ code }) => code === 'ambiguous_candidates')
    )
  );
  // A unique exact content identity is stronger than the upstream list order.
  // If the single-item resolution is not decisive, retain the full sequence so
  // the shared aligner can still handle missing/interleaved specials by anchors.
  const resolution = isolatedIsDecisive ? isolatedResolution : resolveEpisode({
    sourceEpisode,
    sourceSequence,
    canonicalMedia: input.media,
    candidateEpisodes: adaptedDanmuEpisodes.map(({ canonical }) => canonical),
  });
  const candidates = resolution.candidates.flatMap(({ episode }) => {
    const original = episodeByCanonicalId.get(episode.canonicalEpisodeId);
    return original ? [original] : [];
  });
  const selected = resolution.selectedEpisode === null
    ? null
    : episodeByCanonicalId.get(resolution.selectedEpisode.canonicalEpisodeId) ?? null;

  return {
    state: resolution.state,
    selected,
    candidates,
    evidence: resolution.evidence,
    rejectionReasons: resolution.rejectionReasons,
    reason: resolution.reason,
  };
}

export class DanmuEpisodeResolver {
  resolve(input: DanmakuEpisodeResolutionInput): DanmakuEpisodeResolution {
    return resolveDanmakuEpisode(input);
  }
}

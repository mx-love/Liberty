import type { CanonicalEpisode, ParsedEpisodeInfo } from '../types/episode.js';
import type { CanonicalMedia } from '../types/media.js';
import type { SourceEpisode } from '../types/source.js';
import { parseEpisode } from '../episode/episode-parser.js';
import { resolveEpisode } from '../episode/episode-resolver.js';
import { parseTitle } from '../identity/title-parser.js';
import type {
  DanmakuEpisodeResolution,
  DanmuEpisode,
} from './danmu-types.js';

export interface DanmakuEpisodeResolutionInput {
  readonly media: CanonicalMedia;
  readonly targetEpisode: CanonicalEpisode;
  readonly canonicalEpisodes: readonly CanonicalEpisode[];
  readonly danmuEpisodes: readonly DanmuEpisode[];
  /** Identity title and aliases from the already validated danmu work. */
  readonly candidateIdentityTitles?: readonly string[];
}

const LEADING_DISPLAY_DECORATION = /^(?:\s*【[^】\r\n]{1,64}】\s*)+/u;
const SEASON_EPISODE_SUFFIX = /^_S0*(\d{1,3})E0*(\d{1,5})$/iu;
const LABELED_EPISODE_SUFFIX = /^_(EP|E)0*(\d{1,5})$/iu;
const NUMERIC_EPISODE_SUFFIX = /^_0*(\d{1,5})$/u;

function positiveEpisodeNumber(value: string): number | null {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 && number <= 100_000
    ? number
    : null;
}

function uniqueIdentityTitles(
  media: CanonicalMedia,
  candidateIdentityTitles: readonly string[],
): readonly string[] {
  const seen = new Set<string>();
  return [media.canonicalTitle, ...media.aliases, ...candidateIdentityTitles]
    .map((title) => title.normalize('NFKC').trim())
    .filter((title) => {
      const key = title.toLocaleLowerCase('en-US');
      if (!title || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => right.length - left.length);
}

/**
 * Adapt a provider-composed display title into a token already understood by
 * EpisodeParser. This is deliberately context-bound: a suffix is considered
 * only after an exact canonical/candidate title or declared alias prefix.
 */
function contextualEpisodeIdentityToken(
  rawEpisodeTitle: string,
  media: CanonicalMedia,
  candidateIdentityTitles: readonly string[],
): string | null {
  // Movies keep their explicit whole-media path; `_01` must never invent E01.
  if (media.mediaType === 'movie') return null;

  const normalizedRawTitle = rawEpisodeTitle.normalize('NFKC').trim();
  const leadingDecoration = LEADING_DISPLAY_DECORATION.exec(normalizedRawTitle)?.[0] ?? '';
  if (leadingDecoration) {
    const parsedDecoration = parseEpisode(leadingDecoration, { mediaType: media.mediaType });
    if (
      hasExplicitWholeMediaContradiction(parsedDecoration) ||
      parsedDecoration.numberKind !== 'none' ||
      parsedDecoration.part !== null
    ) {
      return null;
    }
  }

  const identityView = normalizedRawTitle.replace(LEADING_DISPLAY_DECORATION, '').trim();
  const foldedIdentityView = identityView.toLocaleLowerCase('en-US');

  for (const title of uniqueIdentityTitles(media, candidateIdentityTitles)) {
    const foldedTitle = title.toLocaleLowerCase('en-US');
    if (!foldedIdentityView.startsWith(foldedTitle)) continue;

    // Requiring the complete remaining string to match one bounded suffix is
    // what prevents `Example Show` from matching `Example Showcase_01`.
    const suffix = identityView.slice(title.length);
    const seasonEpisode = SEASON_EPISODE_SUFFIX.exec(suffix);
    if (seasonEpisode) {
      const season = positiveEpisodeNumber(seasonEpisode[1] ?? '');
      const episode = positiveEpisodeNumber(seasonEpisode[2] ?? '');
      if (season !== null && episode !== null) return `S${season}E${episode}`;
      return null;
    }

    const labeledEpisode = LABELED_EPISODE_SUFFIX.exec(suffix);
    if (labeledEpisode) {
      const episode = positiveEpisodeNumber(labeledEpisode[2] ?? '');
      return episode === null ? null : `E${episode}`;
    }

    const numericEpisode = NUMERIC_EPISODE_SUFFIX.exec(suffix);
    if (numericEpisode) {
      const episode = positiveEpisodeNumber(numericEpisode[1] ?? '');
      if (episode === null || (episode >= 1900 && episode <= 2099)) return null;
      return `E${episode}`;
    }
  }

  return null;
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
  candidateIdentityTitles: readonly string[],
): AdaptedDanmuEpisode {
  // episodeTitle is the only episode-identity input from the upstream list.
  // episodeId is opaque, rawIndex is positional, and apiEpisodeNumber may have
  // been generated from list order; none of them may become a real number.
  const contextualIdentity = contextualEpisodeIdentityToken(
    episode.episodeTitle,
    media,
    candidateIdentityTitles,
  );
  const parsed = parseEpisode(contextualIdentity ?? episode.episodeTitle, {
    mediaType: media.mediaType,
  });
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
    bindingScope: null,
    reason,
  };
}

function hasExplicitWholeMediaContradiction(parsed: ParsedEpisodeInfo): boolean {
  return (
    parsed.contentType === 'preview' ||
    parsed.contentType === 'special' ||
    parsed.contentType === 'recap' ||
    parsed.contentType === 'interview'
  );
}

function isCanonicalMediaTitle(label: string, media: CanonicalMedia): boolean {
  const normalizedLabel = parseTitle(label).normalizedBaseTitle.trim().toLocaleLowerCase('en-US');
  if (!normalizedLabel) return false;
  return [media.canonicalTitle, ...media.aliases].some((title) => (
    parseTitle(title).normalizedBaseTitle.trim().toLocaleLowerCase('en-US') === normalizedLabel
  ));
}

function isWholeMediaCompatibleEpisode(
  episode: CanonicalEpisode,
  media: CanonicalMedia,
): boolean {
  const parsed = parsedCanonicalEpisode(episode, media);
  return (
    (episode.identityState === 'confirmed' || episode.identityState === 'supported') &&
    episode.contentType === 'movie' &&
    episode.seasonNumber === null &&
    episode.episodeNumber === null &&
    episode.absoluteNumber === null &&
    episode.airDate === null &&
    !hasExplicitWholeMediaContradiction(parsed)
  );
}

function resolveUniqueWholeMedia(
  input: DanmakuEpisodeResolutionInput,
): DanmakuEpisodeResolution | null {
  if (
    input.media.mediaType !== 'movie' ||
    (input.media.identityState !== 'confirmed' && input.media.identityState !== 'supported') ||
    input.canonicalEpisodes.length !== 1 ||
    input.danmuEpisodes.length !== 1 ||
    !isWholeMediaCompatibleEpisode(input.targetEpisode, input.media)
  ) {
    return null;
  }

  const selected = input.danmuEpisodes[0];
  if (selected === undefined) return null;
  const parsed = parseEpisode(selected.episodeTitle, { mediaType: input.media.mediaType });
  if (
    hasExplicitWholeMediaContradiction(parsed) &&
    !isCanonicalMediaTitle(selected.episodeTitle, input.media)
  ) {
    return null;
  }

  return {
    state: 'supported',
    selected,
    candidates: [selected],
    evidence: [
      {
        code: 'canonical_media_match',
        reason: `The source and danmu items both belong to canonical movie ${input.media.mediaId}`,
      },
      {
        code: 'source_sequence_membership',
        reason: 'Each side has exactly one content unit and neither has explicit special-content evidence',
      },
    ],
    rejectionReasons: [],
    bindingScope: 'whole_media',
    reason: 'Strict movie identity and unique non-special content structure support a whole-media binding',
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
  const wholeMediaResolution = resolveUniqueWholeMedia(input);
  if (wholeMediaResolution !== null) return wholeMediaResolution;

  const sourceSequence = input.canonicalEpisodes.map((episode, index) =>
    canonicalSourceEpisode(episode, input.media, index));
  const sourceEpisode = canonicalSourceEpisode(
    input.targetEpisode,
    input.media,
    targetCoordinate ?? -1,
  );
  const adaptedDanmuEpisodes = input.danmuEpisodes.map((episode, index) =>
    adaptDanmuEpisode(episode, input.media, index, input.candidateIdentityTitles ?? []));
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
    bindingScope: selected === null ? null : 'canonical_episode',
    reason: resolution.reason,
  };
}

export class DanmuEpisodeResolver {
  resolve(input: DanmakuEpisodeResolutionInput): DanmakuEpisodeResolution {
    return resolveDanmakuEpisode(input);
  }
}

import { EntityResolver } from '../identity/entity-resolver.js';
import { parseTitle } from '../identity/title-parser.js';
import type { MediaIdentityInput } from '../types/identity.js';
import type { CanonicalMedia, MediaType } from '../types/media.js';
import type {
  DanmakuCandidateResolution,
  DanmakuMediaCandidate,
  DanmuMatchCandidate,
  DanmuSearchAnime,
} from './danmu-types.js';

export interface DanmuCandidateResolutionOptions {
  /** An explicit work choice. Episode selection remains a separate decision. */
  readonly manualAnimeId?: string;
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function aliasesFromRawData(rawData: Readonly<Record<string, unknown>>): readonly string[] {
  const values: string[] = [];
  for (const field of ['aliases', 'titles']) {
    const rawAliases = rawData[field];
    if (Array.isArray(rawAliases)) {
      values.push(...rawAliases.filter((value): value is string => typeof value === 'string'));
    }
  }
  return uniqueStrings(values);
}

function yearFromDate(value: string): number | null {
  const match = /(?:^|[^\d])((?:19|20)\d{2})(?:[^\d]|$)/u.exec(value);
  return match?.[1] ? Number(match[1]) : null;
}

/**
 * Transport type labels are optional evidence. Ambiguous labels such as
 * `tvseries`/`TV` remain unknown because danmu_api also uses them for TV anime.
 */
function mediaTypeFromDanmu(type: string, typeDescription: string): MediaType | undefined {
  const value = `${type} ${typeDescription}`.normalize('NFKC').toLocaleLowerCase('zh-CN');
  const types = new Set<MediaType>();

  if (/(?:日番|番剧|动漫|动画|\banime\b|\banimation\b)/iu.test(value)) types.add('anime');
  if (/(?:电影|剧场版|\bmovie\b|\bfilm\b)/iu.test(value)) types.add('movie');
  if (/(?:电视剧|连续剧|韩剧|日剧|美剧|国产剧|\bseries\b|\bdrama\b)/iu.test(value)) {
    types.add('series');
  }
  if (/(?:综艺|\bvariety\b)/iu.test(value)) types.add('variety');
  if (/(?:纪录片|记录片|\bdocumentary\b)/iu.test(value)) types.add('documentary');

  return types.size === 1 ? [...types][0] : undefined;
}

export function adaptDanmuMatchCandidate(candidate: DanmuMatchCandidate): DanmakuMediaCandidate {
  return {
    animeId: candidate.animeId,
    animeTitle: candidate.animeTitle,
    aliases: aliasesFromRawData(candidate.rawData),
    mediaType: mediaTypeFromDanmu(candidate.type, candidate.typeDescription),
    source: 'match',
    rawData: candidate.rawData,
  };
}

export function adaptDanmuSearchAnime(candidate: DanmuSearchAnime): DanmakuMediaCandidate {
  return {
    animeId: candidate.animeId,
    animeTitle: candidate.animeTitle,
    aliases: aliasesFromRawData(candidate.rawData),
    year: yearFromDate(candidate.startDate),
    mediaType: mediaTypeFromDanmu(candidate.type, candidate.typeDescription),
    source: candidate.source || 'search',
    rawData: candidate.rawData,
  };
}

/** Convert danmu_api work metadata into the shared Core V2 identity input. */
export function adaptDanmakuCandidate(candidate: DanmakuMediaCandidate): MediaIdentityInput {
  const parsedTitle = parseTitle(candidate.animeTitle);
  return {
    recordId: `danmu:${candidate.animeId}`,
    rawTitle: candidate.animeTitle,
    parsedTitle,
    aliases: uniqueStrings([...parsedTitle.aliases, ...(candidate.aliases ?? [])]),
    year: candidate.year ?? parsedTitle.year,
    season: candidate.season ?? parsedTitle.season,
    mediaType: candidate.mediaType,
    directors: candidate.directors,
    actors: candidate.actors,
    areas: candidate.areas,
    languages: candidate.languages,
    externalIds: {
      ...candidate.externalIds,
      danmu: candidate.animeId,
    },
  };
}

function adaptCanonicalMedia(media: CanonicalMedia): MediaIdentityInput {
  return {
    recordId: media.mediaId,
    rawTitle: media.canonicalTitle,
    parsedTitle: parseTitle(media.canonicalTitle),
    aliases: media.aliases,
    year: media.releaseYear,
    season: media.season,
    mediaType: media.mediaType,
    directors: media.directors,
    actors: media.actors,
    externalIds: media.externalIds,
    titleAuthority: 'confirmed',
  };
}

function uniqueCandidates(candidates: readonly DanmakuMediaCandidate[]): readonly DanmakuMediaCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = candidate.animeId.trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export class DanmuCandidateResolver {
  constructor(private readonly entityResolver: EntityResolver = new EntityResolver()) {}

  resolve(
    media: CanonicalMedia,
    candidates: readonly DanmakuMediaCandidate[],
    options: DanmuCandidateResolutionOptions = {},
  ): DanmakuCandidateResolution {
    const canonicalIdentity = adaptCanonicalMedia(media);
    const unique = uniqueCandidates(candidates);
    const evaluations = unique.map((candidate) => ({
      candidate,
      identity: this.entityResolver.resolve(canonicalIdentity, adaptDanmakuCandidate(candidate)),
    }));

    if (options.manualAnimeId !== undefined) {
      const manualAnimeId = options.manualAnimeId.trim();
      const manual = evaluations.find(({ candidate }) => candidate.animeId === manualAnimeId);
      if (!manual) {
        return {
          state: 'not_found',
          selected: null,
          selectedBy: null,
          evaluations,
          reason: `The manually selected animeId ${manualAnimeId || '(empty)'} is not present`,
        };
      }
      if (manual.identity.decision === 'rejected') {
        return {
          state: 'conflicting',
          selected: null,
          selectedBy: null,
          evaluations,
          reason: `The manually selected work conflicts with canonical identity: ${manual.identity.reason}`,
        };
      }
      return {
        state: manual.identity.decision === 'confirmed' ? 'verified' : 'supported',
        selected: manual.candidate,
        selectedBy: 'manual',
        evaluations,
        reason: manual.identity.decision === 'confirmed'
          ? 'The manual choice also has a verified external identity'
          : 'The user selected this work; its episode still requires independent resolution',
      };
    }

    if (evaluations.length === 0) {
      return {
        state: 'not_found',
        selected: null,
        selectedBy: null,
        evaluations,
        reason: 'danmu_api returned no work candidates',
      };
    }

    const viable = evaluations.filter(({ identity }) => identity.decision !== 'rejected');
    if (viable.length === 0) {
      return {
        state: 'conflicting',
        selected: null,
        selectedBy: null,
        evaluations,
        reason: 'Every danmu candidate has explicit identity conflicts',
      };
    }

    const confirmed = viable.filter(({ identity }) => identity.decision === 'confirmed');
    if (confirmed.length === 1) {
      return {
        state: 'verified',
        selected: confirmed[0]?.candidate ?? null,
        selectedBy: 'automatic',
        evaluations,
        reason: confirmed[0]?.identity.reason ?? 'A verified external identity selected the work',
      };
    }

    if (viable.length > 1) {
      return {
        state: 'uncertain',
        selected: null,
        selectedBy: null,
        evaluations,
        reason: 'Multiple non-rejected danmu candidates remain distinguishable only by missing evidence',
      };
    }

    const only = viable[0];
    if (!only || only.identity.decision === 'uncertain') {
      return {
        state: 'uncertain',
        selected: null,
        selectedBy: null,
        evaluations,
        reason: only?.identity.reason ?? 'No candidate has enough evidence for automatic selection',
      };
    }

    return {
      state: only.identity.decision === 'confirmed' ? 'verified' : 'supported',
      selected: only.candidate,
      selectedBy: 'automatic',
      evaluations,
      reason: only.identity.reason,
    };
  }
}

export function resolveDanmakuCandidate(
  media: CanonicalMedia,
  candidates: readonly DanmakuMediaCandidate[],
  options: DanmuCandidateResolutionOptions = {},
): DanmakuCandidateResolution {
  return new DanmuCandidateResolver().resolve(media, candidates, options);
}

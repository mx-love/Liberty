import { EntityResolver } from '../identity/entity-resolver.js';
import { classifyMediaTypeLabels } from '../identity/media-type-classifier.js';
import { parseTitle } from '../identity/title-parser.js';
import type { MediaIdentityInput } from '../types/identity.js';
import type { CanonicalMedia, MediaType } from '../types/media.js';
import type {
  DanmakuCandidateAliasProvenance,
  DanmakuCandidateFieldProvenance,
  DanmakuCandidateIdentity,
  DanmakuCandidateResolution,
  DanmakuMediaCandidate,
  DanmuMatchCandidate,
  DanmuSearchAnime,
} from './danmu-types.js';

export interface DanmuCandidateResolutionOptions {
  /** An explicit work choice. Episode selection remains a separate decision. */
  readonly manualAnimeId?: string;
}

interface ParsedCompositeTitle {
  readonly identityTitle: string;
  readonly year: number | null;
  readonly typeLabel: string | null;
  readonly mediaType: MediaType | null;
  readonly provider: string | null;
  readonly parsed: boolean;
}

/*
 * danmu_api composes display titles at the end of the string. Keep the grammar
 * deliberately narrow: a provider slug after `from`, or a trailing 19xx/20xx
 * year, optionally accompanied by one 【type】 label. This does not treat an
 * arbitrary parenthesized title fragment as metadata.
 */
const COMPOSITE_WITH_TYPE_AND_PROVIDER =
  /^(?<title>.+?)(?:\s*[（(]\s*(?<year>(?:19|20)\d{2})\s*[)）])?\s*【(?<type>[^【】\r\n]{1,48})】\s*from\s+(?<provider>[a-z0-9][a-z0-9._-]{0,63})\s*$/u;
const COMPOSITE_WITH_PROVIDER =
  /^(?<title>.+?)(?:\s*[（(]\s*(?<year>(?:19|20)\d{2})\s*[)）])?\s+from\s+(?<provider>[a-z0-9][a-z0-9._-]{0,63})\s*$/u;
const COMPOSITE_WITH_YEAR =
  /^(?<title>.+?)\s*[（(]\s*(?<year>(?:19|20)\d{2})\s*[)）](?:\s*【(?<type>[^【】\r\n]{1,48})】)?\s*$/u;

function parseCompositeDisplayTitle(rawTitle: string): ParsedCompositeTitle {
  const displayTitle = rawTitle.trim();
  const match = COMPOSITE_WITH_TYPE_AND_PROVIDER.exec(displayTitle)
    ?? COMPOSITE_WITH_PROVIDER.exec(displayTitle)
    ?? COMPOSITE_WITH_YEAR.exec(displayTitle);
  const identityTitle = match?.groups?.title?.trim() ?? '';
  if (!match || !identityTitle) {
    return {
      identityTitle: displayTitle,
      year: null,
      typeLabel: null,
      mediaType: null,
      provider: null,
      parsed: false,
    };
  }

  const typeLabel = match.groups?.type?.trim() || null;
  const classifiedType = typeLabel === null ? 'unknown' : classifyMediaTypeLabels([typeLabel]);
  return {
    identityTitle,
    year: match.groups?.year ? Number(match.groups.year) : null,
    typeLabel,
    mediaType: classifiedType === 'unknown' ? null : classifiedType,
    provider: match.groups?.provider?.trim() || null,
    parsed: true,
  };
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

function stringField(
  rawData: Readonly<Record<string, unknown>>,
  fields: readonly string[],
): string | null {
  for (const field of fields) {
    const value = rawData[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function providerFromRawData(rawData: Readonly<Record<string, unknown>>): string | null {
  return stringField(rawData, ['provider', 'source']);
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
  const classified = classifyMediaTypeLabels([type, typeDescription]);
  return classified === 'unknown' ? undefined : classified;
}

export function adaptDanmuMatchCandidate(candidate: DanmuMatchCandidate): DanmakuMediaCandidate {
  return {
    animeId: candidate.animeId,
    animeTitle: candidate.animeTitle,
    aliases: aliasesFromRawData(candidate.rawData),
    mediaType: mediaTypeFromDanmu(candidate.type, candidate.typeDescription),
    provider: providerFromRawData(candidate.rawData) ?? undefined,
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
    provider: candidate.source || providerFromRawData(candidate.rawData) || undefined,
    source: candidate.source || 'search',
    rawData: candidate.rawData,
  };
}

function provenance<T>(
  structuredValue: T | null,
  compositeValue: T | null,
  identityValue: T | null,
  source: DanmakuCandidateFieldProvenance<T>['source'],
  equals: (left: T, right: T) => boolean = Object.is,
): DanmakuCandidateFieldProvenance<T> {
  const knownValues = [structuredValue, compositeValue, identityValue]
    .filter((value): value is T => value !== null);
  return {
    effectiveValue: structuredValue ?? compositeValue ?? identityValue,
    structuredValue,
    compositeValue,
    identityValue,
    source,
    conflict: knownValues.some((value, index) => (
      knownValues.slice(index + 1).some((other) => !equals(value, other))
    )),
  };
}

function aliasProvenance(
  parsedAliases: readonly string[],
  declaredAliases: readonly string[],
): readonly DanmakuCandidateAliasProvenance[] {
  const result: DanmakuCandidateAliasProvenance[] = [];
  const seen = new Set<string>();
  for (const [values, source] of [
    [parsedAliases, 'parsed_identity_title'],
    [declaredAliases, 'declared_alias'],
  ] as const) {
    for (const value of values) {
      const normalized = value.trim();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      result.push({ value: normalized, source });
    }
  }
  return result;
}

/** Convert danmu_api work metadata into the shared Core V2 identity input. */
export function adaptDanmakuCandidate(candidate: DanmakuMediaCandidate): DanmakuCandidateIdentity {
  const rawTitle = candidate.animeTitle;
  const displayTitle = rawTitle.trim();
  const composite = parseCompositeDisplayTitle(displayTitle);
  const identityTitle = composite.identityTitle;
  const parsedTitle = parseTitle(identityTitle);
  const structuredYear = candidate.year ?? null;
  const structuredType = candidate.mediaType && candidate.mediaType !== 'unknown'
    ? candidate.mediaType
    : null;
  const structuredSeason = candidate.season ?? null;
  const structuredProvider = candidate.provider?.trim() || null;
  const yearProvenance = provenance(
    structuredYear,
    composite.year,
    parsedTitle.year,
    structuredYear !== null
      ? 'structured_field'
      : composite.year !== null
        ? 'parsed_composite_display_field'
        : parsedTitle.year !== null
          ? 'parsed_identity_title'
          : 'unknown',
  );
  const typeProvenance = provenance(
    structuredType,
    composite.mediaType,
    null,
    structuredType !== null
      ? 'structured_field'
      : composite.mediaType !== null
        ? 'parsed_composite_display_field'
        : 'unknown',
  );
  const seasonProvenance = provenance(
    structuredSeason,
    null,
    parsedTitle.season,
    structuredSeason !== null
      ? 'structured_field'
      : parsedTitle.season !== null
        ? 'parsed_identity_title'
        : 'unknown',
  );
  const providerProvenance = provenance(
    structuredProvider,
    composite.provider,
    null,
    structuredProvider !== null
      ? 'structured_field'
      : composite.provider !== null
        ? 'parsed_composite_display_field'
        : 'unknown',
    (left, right) => left.toLocaleLowerCase('en-US') === right.toLocaleLowerCase('en-US'),
  );
  const aliases = aliasProvenance(parsedTitle.aliases, candidate.aliases ?? []);

  return {
    recordId: `danmu:${candidate.animeId}`,
    rawTitle,
    displayTitle,
    identityTitle,
    parsedTitle,
    aliases: aliases.map(({ value }) => value),
    year: yearProvenance.effectiveValue,
    season: seasonProvenance.effectiveValue,
    mediaType: typeProvenance.effectiveValue ?? undefined,
    provider: providerProvenance.effectiveValue,
    directors: candidate.directors,
    actors: candidate.actors,
    areas: candidate.areas,
    languages: candidate.languages,
    externalIds: {
      ...candidate.externalIds,
      danmu: candidate.animeId,
    },
    provenance: {
      rawTitle: 'raw_display_title',
      displayTitle: 'raw_display_title',
      identityTitle: composite.parsed
        ? 'parsed_composite_display_field'
        : 'raw_display_title',
      aliases,
      compositeTypeLabel: composite.typeLabel,
      year: yearProvenance,
      mediaType: typeProvenance,
      season: seasonProvenance,
      provider: providerProvenance,
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
    const evaluations = unique.map((candidate) => {
      const identityInput = adaptDanmakuCandidate(candidate);
      return {
        candidate,
        identityInput,
        identity: this.entityResolver.resolve(canonicalIdentity, identityInput),
      };
    });

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

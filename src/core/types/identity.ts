import type { MediaType } from './media.js';

export type EvidenceState = 'confirmed' | 'supporting' | 'unknown' | 'conflicting';

export type EvidenceField =
  | 'title'
  | 'alias'
  | 'year'
  | 'season'
  | 'mediaType'
  | 'director'
  | 'actors'
  | 'area'
  | 'language'
  | 'externalId'
  | 'knownRelation';

export interface CandidateEvidence {
  readonly field: EvidenceField;
  readonly state: EvidenceState;
  readonly reason: string;
  readonly leftValue: unknown;
  readonly rightValue: unknown;
  readonly source?: string;
}

export type IdentityBlockerCode =
  | 'known_different_media'
  | 'external_id_conflict'
  | 'release_year_conflict'
  | 'season_conflict'
  | 'media_type_conflict'
  | 'confirmed_title_conflict';

export interface IdentityBlocker {
  readonly code: IdentityBlockerCode;
  readonly field: EvidenceField;
  readonly reason: string;
  readonly evidenceIndex: number;
}

export type IdentityDecision = 'confirmed' | 'supported' | 'uncertain' | 'rejected';
export type IdentityState = IdentityDecision | 'stale';
export type FieldAuthority = 'confirmed' | 'supporting';

export type TitleTokenSource =
  | 'explicit_chinese_season'
  | 'explicit_english_season'
  | 'explicit_s_code'
  | 'explicit_year'
  | 'trailing_number'
  | 'part_marker';

export interface TitleInterpretation {
  readonly baseTitle: string;
  readonly season: number | null;
  readonly confidence: 'high' | 'medium' | 'low';
  readonly source: 'literal_title' | TitleTokenSource;
}

export interface ParsedTitle {
  readonly rawTitle: string;
  readonly baseTitle: string;
  readonly normalizedBaseTitle: string;
  readonly aliases: readonly string[];
  readonly season: number | null;
  readonly seasonSource: TitleTokenSource | null;
  readonly year: number | null;
  readonly yearSource: TitleTokenSource | null;
  readonly editionMarkers: readonly string[];
  readonly uncertainTokens: readonly string[];
  readonly interpretations: readonly TitleInterpretation[];
}

export interface MediaIdentityInput {
  readonly recordId?: string;
  readonly rawTitle: string;
  readonly parsedTitle?: ParsedTitle;
  readonly aliases?: readonly string[];
  readonly year?: number | null;
  readonly season?: number | null;
  readonly mediaType?: MediaType;
  readonly directors?: readonly string[];
  readonly actors?: readonly string[];
  readonly areas?: readonly string[];
  readonly languages?: readonly string[];
  readonly externalIds?: Readonly<Record<string, string>>;
  readonly knownDifferentFrom?: readonly string[];
  readonly titleAuthority?: FieldAuthority;
}

export interface IdentityResolution {
  readonly decision: IdentityDecision;
  readonly evidence: readonly CandidateEvidence[];
  readonly blockers: readonly IdentityBlocker[];
  readonly matchedFields: readonly EvidenceField[];
  readonly reason: string;
}

export interface IdentityPolicy {
  readonly minimumSupportingFields: number;
  readonly rejectConfirmedTitleConflict: boolean;
  readonly strictYear: boolean;
  readonly strictMediaType: boolean;
  readonly strictSeason: boolean;
}

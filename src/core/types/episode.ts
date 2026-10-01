import type { CandidateEvidence, IdentityState } from './identity.js';
import type { CanonicalMedia } from './media.js';
import type { SourceEpisode } from './source.js';

export type EpisodeContentType =
  | 'regular'
  | 'special'
  | 'interview'
  | 'preview'
  | 'recap'
  | 'movie'
  | 'unknown';

export type EpisodeNumberKind =
  | 'episode'
  | 'issue'
  | 'date'
  | 'special'
  | 'none';

export type EpisodeConfidence = 'high' | 'medium' | 'low' | 'none';
export type EpisodePart = 'upper' | 'lower' | number | null;
export type EpisodeSpecialKind =
  | 'sp'
  | 'ova'
  | 'oad'
  | 'extra'
  | 'special'
  | null;

export type EpisodeEvidenceCode =
  | 'explicit_season_episode'
  | 'explicit_episode_label'
  | 'explicit_issue_label'
  | 'short_episode_label'
  | 'pure_numeric_label'
  | 'broadcast_date'
  | 'special_marker'
  | 'preview_marker'
  | 'recap_marker'
  | 'interview_marker'
  | 'movie_marker'
  | 'part_marker'
  | 'ignored_technical_token'
  | 'unrecognized';

export interface EpisodeParseEvidence {
  readonly code: EpisodeEvidenceCode;
  readonly token: string;
  readonly reason: string;
}

export interface ParsedEpisodeInfo {
  readonly rawName: string;
  readonly contentType: EpisodeContentType;
  readonly seasonNumber: number | null;
  readonly episodeNumber: number | null;
  readonly absoluteNumber: number | null;
  readonly specialNumber: number | null;
  readonly specialKind: EpisodeSpecialKind;
  readonly airDate: string | null;
  readonly episodeTitle: string | null;
  readonly part: EpisodePart;
  readonly numberKind: EpisodeNumberKind;
  readonly confidence: EpisodeConfidence;
  readonly ambiguous: boolean;
  readonly evidence: readonly EpisodeParseEvidence[];
  readonly uncertainTokens: readonly string[];
}

export interface CanonicalEpisode {
  readonly canonicalEpisodeId: string;
  readonly mediaId: string;
  readonly contentType: EpisodeContentType;
  readonly seasonNumber: number | null;
  readonly episodeNumber: number | null;
  readonly absoluteNumber: number | null;
  readonly airDate: string | null;
  readonly episodeTitle: string | null;
  readonly part: EpisodePart;
  readonly identityState: IdentityState;
  readonly evidence: readonly CandidateEvidence[];
}

export type EpisodeMappingState =
  | 'confirmed'
  | 'supported'
  | 'uncertain'
  | 'unmatched'
  | 'conflicting';

export interface EpisodeAlignmentEvidence {
  readonly code:
    | 'manual_anchor'
    | 'exact_episode_number'
    | 'exact_absolute_number'
    | 'exact_issue_number'
    | 'exact_air_date'
    | 'exact_special_identity'
    | 'exact_content_title'
    | 'bounded_by_two_anchors'
    | 'ambiguous_candidates'
    | 'no_reliable_identity'
    | 'anchor_conflict';
  readonly reason: string;
  readonly sourceIndex?: number;
  readonly targetIndex?: number;
}

export interface EpisodeAlignmentMapping {
  readonly sourceIndex: number;
  readonly targetIndices: readonly number[];
  readonly state: EpisodeMappingState;
  readonly evidence: readonly EpisodeAlignmentEvidence[];
  readonly alternatives: readonly number[];
}

export interface EpisodeManualAnchor {
  readonly sourceIndex: number;
  readonly targetIndices: readonly number[];
  readonly evidence?: string;
}

export type EpisodeAlignmentState = 'aligned' | 'partial' | 'uncertain' | 'conflicting';

export interface EpisodeAlignmentResult {
  readonly state: EpisodeAlignmentState;
  readonly mappings: readonly EpisodeAlignmentMapping[];
  readonly reliableAnchorCount: number;
  readonly evidence: readonly EpisodeAlignmentEvidence[];
}

export type EpisodeSequenceEntry = string | ParsedEpisodeInfo;

export interface EpisodeVerifiedMapping {
  /** The complete source identity is required; rawIndex alone is never authoritative. */
  readonly sourceEpisode: SourceEpisode;
  readonly canonicalEpisodeIds: readonly string[];
  readonly evidence?: string;
}

export interface EpisodeResolutionInput {
  readonly sourceEpisode: SourceEpisode;
  readonly sourceSequence: readonly SourceEpisode[];
  readonly canonicalMedia: CanonicalMedia;
  readonly candidateEpisodes: readonly CanonicalEpisode[];
  readonly verifiedMappings?: readonly EpisodeVerifiedMapping[];
}

export type EpisodeResolutionState =
  | 'verified'
  | 'supported'
  | 'uncertain'
  | 'rejected'
  | 'not_found';

export type EpisodeResolutionEvidenceCode =
  | EpisodeAlignmentEvidence['code']
  | 'source_sequence_membership'
  | 'canonical_media_match'
  | 'canonical_media_conflict'
  | 'explicit_season_conflict'
  | 'verified_mapping'
  | 'verified_mapping_conflict';

export interface EpisodeResolutionEvidence {
  readonly code: EpisodeResolutionEvidenceCode;
  readonly reason: string;
  readonly canonicalEpisodeId?: string;
  readonly sourceIndex?: number;
  readonly targetIndex?: number;
}

export interface EpisodeResolutionCandidate {
  readonly episode: CanonicalEpisode;
  readonly state: Exclude<EpisodeResolutionState, 'not_found'>;
  readonly evidence: readonly EpisodeResolutionEvidence[];
  readonly rejectionReasons: readonly string[];
}

export interface EpisodeResolution {
  readonly state: EpisodeResolutionState;
  readonly sourceEpisode: SourceEpisode;
  readonly selectedEpisode: CanonicalEpisode | null;
  readonly candidates: readonly EpisodeResolutionCandidate[];
  readonly evidence: readonly EpisodeResolutionEvidence[];
  readonly rejectionReasons: readonly string[];
  readonly alignment: EpisodeAlignmentResult;
  readonly reason: string;
}

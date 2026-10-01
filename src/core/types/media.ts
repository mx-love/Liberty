import type { CanonicalEpisode } from './episode.js';
import type { CandidateEvidence, IdentityState } from './identity.js';

export type MediaType =
  | 'movie'
  | 'series'
  | 'anime'
  | 'variety'
  | 'documentary'
  | 'unknown';

export interface CanonicalMedia {
  readonly mediaId: string;
  readonly mediaType: MediaType;
  readonly canonicalTitle: string;
  readonly aliases: readonly string[];
  readonly releaseYear: number | null;
  readonly season: number | null;
  readonly directors: readonly string[];
  readonly actors: readonly string[];
  readonly externalIds: Readonly<Record<string, string>>;
  readonly evidence: readonly CandidateEvidence[];
  readonly identityState: IdentityState;
  readonly episodes?: readonly CanonicalEpisode[];
}

export type EditionState = 'compatible' | 'incompatible' | 'unknown';

export interface TimelineMappingPoint {
  readonly canonicalTime: number;
  readonly editionTime: number;
}

export interface VideoEdition {
  readonly editionId: string;
  readonly canonicalEpisodeId: string;
  readonly editionState: EditionState;
  readonly duration: number | null;
  readonly timelineMapping: readonly TimelineMappingPoint[] | null;
  readonly evidence: readonly CandidateEvidence[];
}

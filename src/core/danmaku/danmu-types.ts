import type { CanonicalEpisode, EpisodeResolutionEvidence } from '../types/episode.js';
import type {
  CandidateEvidence,
  IdentityResolution,
  MediaIdentityInput,
} from '../types/identity.js';
import type { CanonicalMedia, MediaType } from '../types/media.js';
import type { SourceEpisode } from '../types/source.js';

export type DanmuClientErrorKind =
  | 'rate-limited'
  | 'client-error'
  | 'server-error'
  | 'network-error'
  | 'timeout'
  | 'aborted'
  | 'invalid-response';

export interface DanmuClientError {
  readonly kind: DanmuClientErrorKind;
  readonly status: number | null;
  readonly message: string;
  readonly retryAfterMs?: number;
}

export type DanmuClientResult<T> =
  | {
      readonly ok: true;
      readonly status: number;
      readonly data: T;
    }
  | {
      readonly ok: false;
      readonly status: number | null;
      readonly error: DanmuClientError;
    };

export interface DanmuMatchCandidate {
  readonly animeId: string;
  readonly animeTitle: string;
  readonly episodeId: string;
  readonly episodeTitle: string;
  readonly type: string;
  readonly typeDescription: string;
  readonly shift: number;
  readonly imageUrl: string;
  readonly url: string;
  readonly rawData: Readonly<Record<string, unknown>>;
}

export interface DanmuMatchResponse {
  readonly isMatched: boolean;
  readonly matches: readonly DanmuMatchCandidate[];
}

export interface DanmuSearchAnime {
  readonly animeId: string;
  readonly bangumiId: string;
  readonly animeTitle: string;
  readonly type: string;
  readonly typeDescription: string;
  readonly imageUrl: string;
  readonly startDate: string;
  readonly episodeCount: number | null;
  readonly source: string;
  readonly rawData: Readonly<Record<string, unknown>>;
}

export interface DanmuSearchResponse {
  readonly animes: readonly DanmuSearchAnime[];
}

export interface DanmuEpisode {
  readonly animeId: string;
  readonly rawIndex: number;
  readonly seasonId: string;
  readonly episodeId: string;
  readonly episodeTitle: string;
  /** Upstream may derive this from array position; it is never canonical evidence. */
  readonly apiEpisodeNumber: string | null;
  readonly airDate: string | null;
  readonly url: string;
  readonly rawData: Readonly<Record<string, unknown>>;
}

export interface DanmuBangumi {
  readonly animeId: string;
  readonly bangumiId: string;
  readonly animeTitle: string;
  readonly type: string;
  readonly typeDescription: string;
  readonly episodes: readonly DanmuEpisode[];
  readonly rawData: Readonly<Record<string, unknown>>;
}

export interface DanmuComment {
  readonly p: string;
  readonly m: string;
  readonly rawData: Readonly<Record<string, unknown>>;
}

export interface DanmuCommentResponse {
  readonly count: number;
  readonly comments: readonly DanmuComment[];
  readonly videoDuration: number | null;
}

export interface DanmakuMediaCandidate {
  readonly animeId: string;
  readonly animeTitle: string;
  readonly aliases?: readonly string[];
  readonly year?: number | null;
  readonly season?: number | null;
  readonly mediaType?: MediaType;
  readonly directors?: readonly string[];
  readonly actors?: readonly string[];
  readonly areas?: readonly string[];
  readonly languages?: readonly string[];
  readonly externalIds?: Readonly<Record<string, string>>;
  /** Structured provider/source metadata, when danmu_api supplies it. */
  readonly provider?: string;
  readonly source?: string;
  readonly rawData?: Readonly<Record<string, unknown>>;
}

export type DanmakuCandidateMetadataSource =
  | 'structured_field'
  | 'parsed_composite_display_field'
  | 'parsed_identity_title'
  | 'declared_alias'
  | 'raw_display_title'
  | 'unknown';

export interface DanmakuCandidateFieldProvenance<T> {
  readonly effectiveValue: T | null;
  readonly structuredValue: T | null;
  readonly compositeValue: T | null;
  readonly identityValue: T | null;
  readonly source: DanmakuCandidateMetadataSource;
  /** Structured metadata remains authoritative, but disagreement is observable. */
  readonly conflict: boolean;
}

export interface DanmakuCandidateAliasProvenance {
  readonly value: string;
  readonly source: 'parsed_identity_title' | 'declared_alias';
}

export interface DanmakuCandidateIdentityProvenance {
  readonly rawTitle: 'raw_display_title';
  readonly displayTitle: 'raw_display_title';
  readonly identityTitle: 'raw_display_title' | 'parsed_composite_display_field';
  readonly aliases: readonly DanmakuCandidateAliasProvenance[];
  readonly compositeTypeLabel: string | null;
  readonly year: DanmakuCandidateFieldProvenance<number>;
  readonly mediaType: DanmakuCandidateFieldProvenance<MediaType>;
  readonly season: DanmakuCandidateFieldProvenance<number>;
  readonly provider: DanmakuCandidateFieldProvenance<string>;
}

/**
 * Identity input produced at the danmu_api boundary.
 *
 * The raw/display title remains available for UI and diagnostics, while only
 * identityTitle (after a bounded composite suffix is recognized) is parsed by
 * the shared TitleParser and sent to EntityResolver.
 */
export interface DanmakuCandidateIdentity extends MediaIdentityInput {
  readonly rawTitle: string;
  readonly displayTitle: string;
  readonly identityTitle: string;
  readonly provider: string | null;
  readonly provenance: DanmakuCandidateIdentityProvenance;
}

export type DanmakuCandidateResolutionState =
  | 'not_found'
  | 'conflicting'
  | 'uncertain'
  | 'supported'
  | 'verified';

export interface DanmakuCandidateEvaluation {
  readonly candidate: DanmakuMediaCandidate;
  readonly identityInput: DanmakuCandidateIdentity;
  readonly identity: IdentityResolution;
}

export interface DanmakuCandidateResolution {
  readonly state: DanmakuCandidateResolutionState;
  readonly selected: DanmakuMediaCandidate | null;
  readonly selectedBy: 'automatic' | 'manual' | null;
  readonly evaluations: readonly DanmakuCandidateEvaluation[];
  readonly reason: string;
}

export type DanmakuEpisodeResolutionState =
  | 'not_found'
  | 'rejected'
  | 'uncertain'
  | 'supported'
  | 'verified';

export interface DanmakuEpisodeResolution {
  readonly state: DanmakuEpisodeResolutionState;
  readonly selected: DanmuEpisode | null;
  readonly candidates: readonly DanmuEpisode[];
  readonly evidence: readonly EpisodeResolutionEvidence[];
  readonly rejectionReasons: readonly string[];
  /** The identity scope established by episode resolution, when decisive. */
  readonly bindingScope: DanmakuBindingScope | null;
  readonly reason: string;
}

export type DanmakuBindingScope = 'canonical_episode' | 'whole_media';

export interface DanmakuBindingEvidence {
  readonly stage: 'media' | 'episode' | 'manual';
  readonly reason: string;
  readonly identityEvidence?: readonly CandidateEvidence[];
  readonly episodeEvidence?: readonly EpisodeResolutionEvidence[];
}

export interface DanmakuBinding {
  readonly canonicalMediaId: string;
  readonly canonicalEpisodeId: string;
  readonly danmuAnimeId: string;
  readonly danmuAnimeTitle: string;
  readonly danmuEpisodeId: string;
  readonly danmuEpisodeTitle: string;
  readonly mappingState: 'supported' | 'verified';
  readonly selectedBy: 'automatic' | 'manual';
  readonly scope: DanmakuBindingScope;
  readonly evidence: readonly DanmakuBindingEvidence[];
}

export type DanmakuServiceState =
  | 'media-unresolved'
  | 'candidate-not-found'
  | 'candidate-uncertain'
  | 'candidate-conflict'
  | 'episode-not-found'
  | 'episode-uncertain'
  | 'episode-rejected'
  | 'binding-supported'
  | 'binding-verified'
  | 'comments-empty'
  | 'rate-limited'
  | 'network-error'
  | 'timeout'
  | 'aborted'
  | 'server-error'
  | 'client-error'
  | 'invalid-response'
  | 'success';

interface DanmakuResolveInputBase {
  readonly media: CanonicalMedia;
  readonly episode: CanonicalEpisode;
  readonly mediaEpisodes: readonly CanonicalEpisode[];
  readonly sourceEpisode: SourceEpisode;
  readonly signal?: AbortSignal;
}

export type DanmakuResolveInput = DanmakuResolveInputBase & (
  | {
      readonly manualCandidate?: undefined;
      readonly manualEpisodeId?: never;
    }
  | {
      /** An explicit work choice. It never confirms an episode by itself. */
      readonly manualCandidate: DanmakuMediaCandidate;
      /**
       * An explicit episode choice made after selecting a work. The service
       * accepts it only when the resolver has already identified this episode
       * as an identity-compatible candidate.
       */
      readonly manualEpisodeId?: string;
    }
);

export interface DanmakuServiceResult {
  readonly state: DanmakuServiceState;
  readonly binding: DanmakuBinding | null;
  readonly comments: readonly DanmuComment[];
  /** Duration reported by the resolved danmu episode, when the API supplies it. */
  readonly videoDuration: number | null;
  readonly candidateResolution: DanmakuCandidateResolution | null;
  readonly episodeResolution: DanmakuEpisodeResolution | null;
  readonly error: DanmuClientError | null;
  readonly reason: string;
}

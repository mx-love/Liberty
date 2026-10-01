export type {
    CanonicalMedia,
    EditionState,
    MediaType,
    TimelineMappingPoint,
    VideoEdition,
} from './types/media.js';
export type {
    CandidateEvidence,
    EvidenceField,
    EvidenceState,
    FieldAuthority,
    IdentityBlocker,
    IdentityBlockerCode,
    IdentityDecision,
    IdentityPolicy,
    IdentityResolution,
    IdentityState,
    MediaIdentityInput,
    ParsedTitle,
    TitleInterpretation,
    TitleTokenSource,
} from './types/identity.js';
export type {
    CanonicalEpisode,
    EpisodeAlignmentEvidence,
    EpisodeAlignmentMapping,
    EpisodeAlignmentResult,
    EpisodeAlignmentState,
    EpisodeConfidence,
    EpisodeContentType,
    EpisodeEvidenceCode,
    EpisodeManualAnchor,
    EpisodeMappingState,
    EpisodeNumberKind,
    EpisodeParseEvidence,
    EpisodePart,
    EpisodeResolution,
    EpisodeResolutionCandidate,
    EpisodeResolutionEvidence,
    EpisodeResolutionEvidenceCode,
    EpisodeResolutionInput,
    EpisodeResolutionState,
    EpisodeSequenceEntry,
    EpisodeSpecialKind,
    EpisodeVerifiedMapping,
    ParsedEpisodeInfo,
} from './types/episode.js';
export type {
    RawPlaySources,
    SourceAdapter,
    SourceEpisode,
    SourceErrorCode,
    SourceMappingState,
    SourcePlayGroup,
    SourceRecord,
    SourceRequestOptions,
    SourceSearchOptions,
    SourceSearchPage,
} from './types/source.js';
export type { EpisodeParserOptions } from './episode/episode-parser.js';
export type { SourceNormalizerContext } from './source/source-normalizer.js';
export type {
    AppleCmsAction,
    AppleCmsAdapterDependencies,
    AppleCmsSourceConfig,
} from './source/apple-cms-adapter.js';
export type {
    ManagedSourceSearchOptions,
    ManagedSourceSearchResult,
    SourceManagerOptions,
    SourceSearchFailure,
    SourceSearchProgress,
} from './source/source-manager.js';

export { SourceError } from './types/source.js';
export { TitleParser, parseTitle } from './identity/title-parser.js';
export {
    CandidateEvidenceCollector,
    collectCandidateEvidence,
} from './identity/candidate-evidence.js';
export { DEFAULT_IDENTITY_POLICY } from './identity/identity-policy.js';
export { EntityResolver, resolveEntityIdentity } from './identity/entity-resolver.js';
export { EpisodeParser, parseEpisode } from './episode/episode-parser.js';
export { EpisodeAligner, alignEpisodeSequences } from './episode/episode-aligner.js';
export { EpisodeResolver, resolveEpisode } from './episode/episode-resolver.js';
export { SourceNormalizer, parseAppleCmsPlaySources } from './source/source-normalizer.js';
export { AppleCMSAdapter } from './source/apple-cms-adapter.js';
export { SourceManager } from './source/source-manager.js';

import { SourceError } from './types/source.js';
import { TitleParser, parseTitle } from './identity/title-parser.js';
import {
    CandidateEvidenceCollector,
    collectCandidateEvidence,
} from './identity/candidate-evidence.js';
import { DEFAULT_IDENTITY_POLICY } from './identity/identity-policy.js';
import { EntityResolver, resolveEntityIdentity } from './identity/entity-resolver.js';
import { EpisodeParser, parseEpisode } from './episode/episode-parser.js';
import { EpisodeAligner, alignEpisodeSequences } from './episode/episode-aligner.js';
import { EpisodeResolver, resolveEpisode } from './episode/episode-resolver.js';
import { SourceNormalizer, parseAppleCmsPlaySources } from './source/source-normalizer.js';
import { AppleCMSAdapter } from './source/apple-cms-adapter.js';
import { SourceManager } from './source/source-manager.js';

/**
 * Transitional browser boundary for Core V2.
 *
 * Existing pages do not depend on this global yet. The core itself never reads
 * this object; it only lets legacy pages migrate through an explicit API.
 */
export const LibertyCore = Object.freeze({
    SourceError,
    TitleParser,
    parseTitle,
    CandidateEvidenceCollector,
    collectCandidateEvidence,
    DEFAULT_IDENTITY_POLICY,
    EntityResolver,
    resolveEntityIdentity,
    EpisodeParser,
    parseEpisode,
    EpisodeAligner,
    alignEpisodeSequences,
    EpisodeResolver,
    resolveEpisode,
    SourceNormalizer,
    parseAppleCmsPlaySources,
    AppleCMSAdapter,
    SourceManager,
});

declare global {
    interface Window {
        LibertyCore?: typeof LibertyCore;
    }
}

if (typeof window !== 'undefined') {
    window.LibertyCore = LibertyCore;
}

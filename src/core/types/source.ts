import type { MediaType } from './media.js';
import type { ParsedEpisodeInfo } from './episode.js';

export type SourceMappingState = 'unmapped' | 'candidate' | 'mapped' | 'conflicting';

export interface SourceEpisode {
    readonly sourceKey: string;
    readonly vodId: string;
    /** Stable within a single source response; it is not a media identity. */
    readonly playGroup: string;
    readonly playGroupIndex: number;
    /** Original array position. It must never be treated as an episode number. */
    readonly rawIndex: number;
    readonly rawEpisodeName: string;
    readonly displayName: string;
    readonly rawEntry: string;
    readonly playUrl: string;
    /** Shared Core V2 episode parse result; generated display names are never parsed as evidence. */
    readonly parsedEpisodeInfo: ParsedEpisodeInfo;
    readonly canonicalEpisodeId: string | null;
    readonly mappingState: SourceMappingState;
    readonly mappingEvidence: readonly string[];
}

export interface SourcePlayGroup {
    readonly sourceKey: string;
    readonly vodId: string;
    readonly rawIndex: number;
    readonly rawName: string;
    readonly displayName: string;
    readonly rawValue: string;
    readonly episodes: readonly SourceEpisode[];
}

export interface RawPlaySources {
    readonly vodPlayFrom: string;
    readonly vodPlayUrl: string;
}

export interface SourceRecord {
    readonly sourceKey: string;
    readonly sourceName: string;
    readonly vodId: string;

    readonly rawTitle: string;
    readonly rawYear: string;
    readonly rawDirector: string;
    readonly rawActors: string;
    readonly rawArea: string;
    readonly rawLanguage: string;
    readonly rawCategory: string;
    readonly rawRemarks: string;
    readonly rawDescription: string;
    readonly rawCover: string;
    readonly rawPlaySources: RawPlaySources;
    /** Complete upstream object, retained separately from normalized fields. */
    readonly rawData: Readonly<Record<string, unknown>>;

    readonly normalizedTitle: string;
    readonly normalizedActors: readonly string[];
    readonly normalizedDirector: readonly string[];
    readonly parsedYear: number | null;
    readonly parsedSeason: number | null;
    readonly mediaType: MediaType;
    readonly playGroups: readonly SourcePlayGroup[];
    readonly fetchedAt: number;
}

export interface SourceSearchPage {
    readonly sourceKey: string;
    readonly page: number;
    readonly pageCount: number | null;
    readonly total: number | null;
    readonly records: readonly SourceRecord[];
}

export interface SourceRequestOptions {
    readonly signal?: AbortSignal;
}

export interface SourceSearchOptions extends SourceRequestOptions {
    readonly page?: number;
}

export interface SourceAdapter {
    readonly sourceKey: string;
    readonly sourceName: string;
    search(query: string, options?: SourceSearchOptions): Promise<SourceSearchPage>;
    detail(vodId: string, options?: SourceRequestOptions): Promise<SourceRecord>;
}

export type SourceErrorCode =
    | 'invalid_argument'
    | 'unknown_source'
    | 'timeout'
    | 'aborted'
    | 'network_error'
    | 'http_error'
    | 'invalid_response'
    | 'record_not_found';

export class SourceError extends Error {
    readonly code: SourceErrorCode;
    readonly sourceKey: string | null;
    readonly status: number | null;
    readonly retryable: boolean;
    override readonly cause?: unknown;

    constructor(
        code: SourceErrorCode,
        message: string,
        options: {
            sourceKey?: string;
            status?: number;
            retryable?: boolean;
            cause?: unknown;
        } = {},
    ) {
        super(message);
        this.name = 'SourceError';
        this.code = code;
        this.sourceKey = options.sourceKey ?? null;
        this.status = options.status ?? null;
        this.retryable = options.retryable ?? false;
        this.cause = options.cause;
    }
}

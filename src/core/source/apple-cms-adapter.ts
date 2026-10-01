import {
    SourceError,
    type SourceAdapter,
    type SourceRecord,
    type SourceRequestOptions,
    type SourceSearchOptions,
    type SourceSearchPage,
} from '../types/source.js';
import { SourceNormalizer } from './source-normalizer.js';

export type AppleCmsAction = 'videolist' | 'detail';

export interface AppleCmsSourceConfig {
    readonly sourceKey: string;
    readonly sourceName: string;
    readonly baseUrl: string;
    /** Optional separate origin/path used by sources whose detail API differs from search. */
    readonly detailBaseUrl?: string;
    readonly endpointPath?: string;
    readonly detailEndpointPath?: string;
    readonly searchAction?: AppleCmsAction;
    /** Defaults to videolist to retain Liberty's existing ids lookup compatibility. */
    readonly detailAction?: AppleCmsAction;
    readonly timeoutMs?: number;
    readonly headers?: HeadersInit;
    readonly query?: Readonly<Record<string, string>>;
}

export interface AppleCmsAdapterDependencies {
    readonly fetch?: typeof fetch;
    readonly now?: () => number;
    readonly transformRequestUrl?: (upstreamUrl: string) => string | Promise<string>;
}

interface AppleCmsResponse {
    readonly list: readonly Readonly<Record<string, unknown>>[];
    readonly page: number;
    readonly pageCount: number | null;
    readonly total: number | null;
}

const DEFAULT_ENDPOINT_PATH = '/api.php/provide/vod/';
const DEFAULT_TIMEOUT_MS = 10_000;

function nonNegativeInteger(value: unknown): number | null {
    const text = typeof value === 'number' ? String(value) : String(value ?? '').trim();
    if (!text) return null;
    const parsed = Number(text);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function positiveInteger(value: unknown): number | null {
    const parsed = nonNegativeInteger(value);
    return parsed !== null && parsed > 0 ? parsed : null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function buildEndpointUrl(config: AppleCmsSourceConfig, requestKind: 'search' | 'detail'): URL {
    const configuredBaseUrl = requestKind === 'detail'
        ? config.detailBaseUrl ?? config.baseUrl
        : config.baseUrl;
    let base: URL;
    try {
        base = new URL(configuredBaseUrl.trim());
    } catch (error) {
        throw new SourceError('invalid_argument', `采集源 ${config.sourceKey} 的 URL 无效`, {
            sourceKey: config.sourceKey,
            cause: error,
        });
    }

    if (!/^https?:$/.test(base.protocol)) {
        throw new SourceError('invalid_argument', `采集源 ${config.sourceKey} 仅支持 HTTP(S) URL`, {
            sourceKey: config.sourceKey,
        });
    }

    const alreadyProviderEndpoint = /\/api\.php\/provide\/vod\/?$/i.test(base.pathname);
    if (!alreadyProviderEndpoint) {
        const basePath = base.pathname.replace(/\/+$/, '');
        const configuredEndpointPath = requestKind === 'detail'
            ? config.detailEndpointPath ?? config.endpointPath
            : config.endpointPath;
        const endpointPath = (configuredEndpointPath ?? DEFAULT_ENDPOINT_PATH)
            .trim()
            .replace(/^\/+/, '')
            .replace(/\/+$/, '');
        base.pathname = `${basePath}/${endpointPath}/`.replace(/\/{2,}/g, '/');
    }

    base.hash = '';
    for (const [key, value] of Object.entries(config.query ?? {})) {
        base.searchParams.set(key, value);
    }
    return base;
}

function normalizeResponse(raw: unknown, sourceKey: string, requestedPage: number): AppleCmsResponse {
    if (!isRecord(raw) || !Array.isArray(raw.list)) {
        throw new SourceError('invalid_response', `采集源 ${sourceKey} 返回的数据格式无效`, { sourceKey });
    }
    if (!raw.list.every(isRecord)) {
        throw new SourceError('invalid_response', `采集源 ${sourceKey} 返回了无效的影视记录`, { sourceKey });
    }
    if (raw.list.some((item) => {
        const vodId = item.vod_id;
        return !(
            (typeof vodId === 'string' && vodId.trim().length > 0) ||
            (typeof vodId === 'number' && Number.isFinite(vodId))
        );
    })) {
        throw new SourceError('invalid_response', `采集源 ${sourceKey} 返回了缺少 vod_id 的影视记录`, { sourceKey });
    }

    return {
        list: raw.list,
        page: positiveInteger(raw.page) ?? requestedPage,
        pageCount: nonNegativeInteger(raw.pagecount ?? raw.page_count),
        total: nonNegativeInteger(raw.total),
    };
}

export class AppleCMSAdapter implements SourceAdapter {
    readonly sourceKey: string;
    readonly sourceName: string;

    private readonly config: AppleCmsSourceConfig;
    private readonly fetchFn: typeof fetch;
    private readonly now: () => number;
    private readonly transformRequestUrl: (upstreamUrl: string) => string | Promise<string>;

    constructor(config: AppleCmsSourceConfig, dependencies: AppleCmsAdapterDependencies = {}) {
        if (!config.sourceKey.trim() || !config.sourceName.trim()) {
            throw new SourceError('invalid_argument', '采集源必须提供 sourceKey 和 sourceName');
        }
        if (!Number.isFinite(config.timeoutMs ?? DEFAULT_TIMEOUT_MS) || (config.timeoutMs ?? DEFAULT_TIMEOUT_MS) <= 0) {
            throw new SourceError('invalid_argument', `采集源 ${config.sourceKey} 的 timeoutMs 无效`, {
                sourceKey: config.sourceKey,
            });
        }

        const fetchFn = dependencies.fetch ?? globalThis.fetch;
        if (typeof fetchFn !== 'function') {
            throw new SourceError('invalid_argument', '当前环境没有可用的 fetch，请显式注入');
        }

        // Validate eagerly so a broken source definition fails before the first request.
        buildEndpointUrl(config, 'search');
        buildEndpointUrl(config, 'detail');
        this.config = config;
        this.sourceKey = config.sourceKey;
        this.sourceName = config.sourceName;
        this.fetchFn = fetchFn.bind(globalThis);
        this.now = dependencies.now ?? Date.now;
        this.transformRequestUrl = dependencies.transformRequestUrl ?? ((url) => url);
    }

    async search(query: string, options: SourceSearchOptions = {}): Promise<SourceSearchPage> {
        const cleanQuery = query.trim();
        if (!cleanQuery) {
            throw new SourceError('invalid_argument', '搜索关键词不能为空', { sourceKey: this.sourceKey });
        }

        const page = options.page ?? 1;
        if (!Number.isSafeInteger(page) || page < 1) {
            throw new SourceError('invalid_argument', '搜索页码必须是正整数', { sourceKey: this.sourceKey });
        }

        const url = this.createRequestUrl('search', {
            ac: this.config.searchAction ?? 'videolist',
            wd: cleanQuery,
            pg: String(page),
        });
        const response = normalizeResponse(await this.requestJson(url, options), this.sourceKey, page);
        const fetchedAt = this.now();

        return {
            sourceKey: this.sourceKey,
            page: response.page,
            pageCount: response.pageCount,
            total: response.total,
            records: response.list.map((record) => SourceNormalizer.normalize(record, {
                sourceKey: this.sourceKey,
                sourceName: this.sourceName,
                fetchedAt,
            })),
        };
    }

    async detail(vodId: string, options: SourceRequestOptions = {}): Promise<SourceRecord> {
        const cleanVodId = vodId.trim();
        if (!cleanVodId) {
            throw new SourceError('invalid_argument', 'vodId 不能为空', { sourceKey: this.sourceKey });
        }

        const url = this.createRequestUrl('detail', {
            ac: this.config.detailAction ?? 'videolist',
            ids: cleanVodId,
        });
        const response = normalizeResponse(await this.requestJson(url, options), this.sourceKey, 1);
        const record = response.list.find((item) => String(item.vod_id ?? '').trim() === cleanVodId);
        if (!record) {
            throw new SourceError('record_not_found', `采集源 ${this.sourceKey} 未返回 vodId=${cleanVodId}`, {
                sourceKey: this.sourceKey,
            });
        }

        return SourceNormalizer.normalize(record, {
            sourceKey: this.sourceKey,
            sourceName: this.sourceName,
            fetchedAt: this.now(),
        });
    }

    private createRequestUrl(
        requestKind: 'search' | 'detail',
        params: Readonly<Record<string, string>>,
    ): string {
        const url = buildEndpointUrl(this.config, requestKind);
        for (const [key, value] of Object.entries(params)) {
            url.searchParams.set(key, value);
        }
        return url.toString();
    }

    private async requestJson(upstreamUrl: string, options: SourceRequestOptions): Promise<unknown> {
        if (options.signal?.aborted) {
            throw new SourceError('aborted', `采集源 ${this.sourceKey} 请求已取消`, {
                sourceKey: this.sourceKey,
                cause: options.signal.reason,
            });
        }

        const controller = new AbortController();
        const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        let timedOut = false;
        let rejectOnAbort = (): void => undefined;
        const abortPromise = new Promise<never>((_resolve, reject) => {
            rejectOnAbort = (): void => {
                if (timedOut) {
                    reject(new SourceError('timeout', `采集源 ${this.sourceKey} 请求超时`, {
                        sourceKey: this.sourceKey,
                        retryable: true,
                    }));
                    return;
                }
                reject(new SourceError('aborted', `采集源 ${this.sourceKey} 请求已取消`, {
                    sourceKey: this.sourceKey,
                    cause: options.signal?.reason,
                }));
            };
            controller.signal.addEventListener('abort', rejectOnAbort, { once: true });
        });
        const timeoutId = setTimeout(() => {
            timedOut = true;
            controller.abort('timeout');
        }, timeoutMs);
        const abortFromCaller = (): void => controller.abort(options.signal?.reason);
        options.signal?.addEventListener('abort', abortFromCaller, { once: true });
        if (options.signal?.aborted) abortFromCaller();

        try {
            const requestPromise = (async (): Promise<unknown> => {
                const requestUrl = await this.transformRequestUrl(upstreamUrl);
                const response = await this.fetchFn(requestUrl, {
                    headers: {
                        Accept: 'application/json',
                        ...this.config.headers,
                    },
                    signal: controller.signal,
                });
                if (!response.ok) {
                    throw new SourceError('http_error', `采集源 ${this.sourceKey} 请求失败: HTTP ${response.status}`, {
                        sourceKey: this.sourceKey,
                        status: response.status,
                        retryable: response.status === 408 || response.status === 429 || response.status >= 500,
                    });
                }

                try {
                    return await response.json();
                } catch (error) {
                    throw new SourceError('invalid_response', `采集源 ${this.sourceKey} 返回的内容不是有效 JSON`, {
                        sourceKey: this.sourceKey,
                        cause: error,
                    });
                }
            })();
            return await Promise.race([requestPromise, abortPromise]);
        } catch (error) {
            if (error instanceof SourceError) throw error;
            if (options.signal?.aborted) {
                throw new SourceError('aborted', `采集源 ${this.sourceKey} 请求已取消`, {
                    sourceKey: this.sourceKey,
                    cause: error,
                });
            }
            if (controller.signal.aborted) {
                throw new SourceError('timeout', `采集源 ${this.sourceKey} 请求超时`, {
                    sourceKey: this.sourceKey,
                    retryable: true,
                    cause: error,
                });
            }
            throw new SourceError('network_error', `采集源 ${this.sourceKey} 网络请求失败`, {
                sourceKey: this.sourceKey,
                retryable: true,
                cause: error,
            });
        } finally {
            clearTimeout(timeoutId);
            options.signal?.removeEventListener('abort', abortFromCaller);
            controller.signal.removeEventListener('abort', rejectOnAbort);
        }
    }
}

export const AppleCmsAdapter = AppleCMSAdapter;

import {
    SourceError,
    type SourceAdapter,
    type SourceRecord,
    type SourceSearchPage,
} from '../types/source.js';

export interface SourceManagerOptions {
    readonly concurrency?: number;
    /** Upper bound for any adapter call, including adapters that do not implement their own timeout. */
    readonly timeoutMs?: number;
    readonly cacheTtlMs?: number;
    readonly cacheMaxEntries?: number;
    readonly now?: () => number;
}

export interface SourceSearchFailure {
    readonly sourceKey: string;
    readonly error: SourceError;
}

export interface SourceSearchProgress {
    readonly sourceKey: string;
    readonly page?: SourceSearchPage;
    readonly error?: SourceError;
}

export interface ManagedSourceSearchOptions {
    readonly sourceKeys?: readonly string[];
    readonly page?: number;
    readonly signal?: AbortSignal;
    /** Called as each source completes, so fast sources can render before slow ones. */
    readonly onSourceResult?: (progress: SourceSearchProgress) => void;
}

export interface ManagedSourceSearchResult {
    /** Records are grouped in source completion order; identity dedupe is deliberately deferred. */
    readonly records: readonly SourceRecord[];
    readonly pages: readonly SourceSearchPage[];
    readonly failures: readonly SourceSearchFailure[];
}

interface CacheEntry<T> {
    readonly value: T;
    readonly expiresAt: number;
}

const DEFAULT_CONCURRENCY = 5;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_CACHE_TTL_MS = 30_000;
const DEFAULT_CACHE_MAX_ENTRIES = 100;

function asSourceError(error: unknown, sourceKey: string): SourceError {
    if (error instanceof SourceError) return error;
    return new SourceError('network_error', `采集源 ${sourceKey} 请求失败`, {
        sourceKey,
        retryable: true,
        cause: error,
    });
}

export class SourceManager {
    private readonly adapters = new Map<string, SourceAdapter>();
    private readonly concurrency: number;
    private readonly timeoutMs: number;
    private readonly cacheTtlMs: number;
    private readonly cacheMaxEntries: number;
    private readonly now: () => number;
    private readonly cache = new Map<string, CacheEntry<unknown>>();

    constructor(adapters: Iterable<SourceAdapter>, options: SourceManagerOptions = {}) {
        this.concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
        this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
        this.cacheMaxEntries = options.cacheMaxEntries ?? DEFAULT_CACHE_MAX_ENTRIES;
        this.now = options.now ?? Date.now;

        if (!Number.isSafeInteger(this.concurrency) || this.concurrency < 1) {
            throw new SourceError('invalid_argument', 'SourceManager concurrency 必须是正整数');
        }
        if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
            throw new SourceError('invalid_argument', 'SourceManager timeoutMs 必须是正数');
        }
        if (!Number.isFinite(this.cacheTtlMs) || this.cacheTtlMs < 0) {
            throw new SourceError('invalid_argument', 'SourceManager cacheTtlMs 不能为负数');
        }
        if (!Number.isSafeInteger(this.cacheMaxEntries) || this.cacheMaxEntries < 0) {
            throw new SourceError('invalid_argument', 'SourceManager cacheMaxEntries 不能为负数');
        }

        for (const adapter of adapters) {
            if (this.adapters.has(adapter.sourceKey)) {
                throw new SourceError('invalid_argument', `重复的采集源 sourceKey: ${adapter.sourceKey}`);
            }
            this.adapters.set(adapter.sourceKey, adapter);
        }
    }

    get sourceKeys(): readonly string[] {
        return [...this.adapters.keys()];
    }

    async search(query: string, options: ManagedSourceSearchOptions = {}): Promise<ManagedSourceSearchResult> {
        const cleanQuery = query.trim();
        if (!cleanQuery) throw new SourceError('invalid_argument', '搜索关键词不能为空');
        const page = options.page ?? 1;
        if (!Number.isSafeInteger(page) || page < 1) {
            throw new SourceError('invalid_argument', '搜索页码必须是正整数');
        }

        const sourceKeys = options.sourceKeys ? [...new Set(options.sourceKeys)] : this.sourceKeys;
        for (const sourceKey of sourceKeys) this.requireAdapter(sourceKey);

        const pages: SourceSearchPage[] = [];
        const failures: SourceSearchFailure[] = [];
        let cursor = 0;
        const workerCount = Math.min(this.concurrency, sourceKeys.length);

        const worker = async (): Promise<void> => {
            while (cursor < sourceKeys.length) {
                if (options.signal?.aborted) {
                    throw new SourceError('aborted', '多源搜索已取消', { cause: options.signal.reason });
                }
                const sourceKey = sourceKeys[cursor];
                cursor += 1;
                if (sourceKey === undefined) break;
                const adapter = this.requireAdapter(sourceKey);
                try {
                    const result = await this.getOrLoad(
                        `search:${sourceKey}:${page}:${cleanQuery}`,
                        () => this.runAdapterRequest(
                            sourceKey,
                            options.signal,
                            (signal) => adapter.search(cleanQuery, { page, signal }),
                        ),
                    );
                    pages.push(result);
                    options.onSourceResult?.({ sourceKey, page: result });
                } catch (error) {
                    const sourceError = asSourceError(error, sourceKey);
                    if (sourceError.code === 'aborted' && options.signal?.aborted) throw sourceError;
                    failures.push({ sourceKey, error: sourceError });
                    options.onSourceResult?.({ sourceKey, error: sourceError });
                }
            }
        };

        await Promise.all(Array.from({ length: workerCount }, worker));
        return {
            records: pages.flatMap((result) => result.records),
            pages,
            failures,
        };
    }

    async detail(sourceKey: string, vodId: string, signal?: AbortSignal): Promise<SourceRecord> {
        const adapter = this.requireAdapter(sourceKey);
        const cleanVodId = vodId.trim();
        if (!cleanVodId) {
            throw new SourceError('invalid_argument', 'vodId 不能为空', { sourceKey });
        }
        return this.getOrLoad(
            `detail:${sourceKey}:${cleanVodId}`,
            () => this.runAdapterRequest(
                sourceKey,
                signal,
                (requestSignal) => adapter.detail(cleanVodId, { signal: requestSignal }),
            ),
        );
    }

    clearCache(sourceKey?: string): void {
        if (!sourceKey) {
            this.cache.clear();
            return;
        }
        for (const key of this.cache.keys()) {
            if (key.startsWith(`search:${sourceKey}:`) || key.startsWith(`detail:${sourceKey}:`)) {
                this.cache.delete(key);
            }
        }
    }

    private requireAdapter(sourceKey: string): SourceAdapter {
        const adapter = this.adapters.get(sourceKey);
        if (!adapter) {
            throw new SourceError('unknown_source', `未知采集源: ${sourceKey}`, { sourceKey });
        }
        return adapter;
    }

    private async getOrLoad<T>(key: string, load: () => Promise<T>): Promise<T> {
        const cached = this.cache.get(key) as CacheEntry<T> | undefined;
        const now = this.now();
        if (cached && cached.expiresAt > now) {
            // Refresh insertion order so the size cap behaves like a small LRU cache.
            this.cache.delete(key);
            this.cache.set(key, cached);
            return cached.value;
        }
        if (cached) this.cache.delete(key);

        const value = await load();
        if (this.cacheTtlMs > 0 && this.cacheMaxEntries > 0) {
            this.cache.set(key, { value, expiresAt: this.now() + this.cacheTtlMs });
            this.pruneCache();
        }
        return value;
    }

    private async runAdapterRequest<T>(
        sourceKey: string,
        parentSignal: AbortSignal | undefined,
        operation: (signal: AbortSignal) => Promise<T>,
    ): Promise<T> {
        if (parentSignal?.aborted) {
            throw new SourceError('aborted', `采集源 ${sourceKey} 请求已取消`, {
                sourceKey,
                cause: parentSignal.reason,
            });
        }

        const controller = new AbortController();
        let timedOut = false;
        let rejectOnAbort = (): void => undefined;
        const abortPromise = new Promise<never>((_resolve, reject) => {
            rejectOnAbort = (): void => {
                if (timedOut) {
                    reject(new SourceError('timeout', `采集源 ${sourceKey} 请求超时`, {
                        sourceKey,
                        retryable: true,
                    }));
                    return;
                }
                reject(new SourceError('aborted', `采集源 ${sourceKey} 请求已取消`, {
                    sourceKey,
                    cause: parentSignal?.reason,
                }));
            };
            controller.signal.addEventListener('abort', rejectOnAbort, { once: true });
        });
        const abortFromParent = (): void => controller.abort(parentSignal?.reason);
        parentSignal?.addEventListener('abort', abortFromParent, { once: true });
        const timeoutId = setTimeout(() => {
            timedOut = true;
            controller.abort('timeout');
        }, this.timeoutMs);

        try {
            const operationPromise = Promise.resolve().then(() => operation(controller.signal));
            return await Promise.race([operationPromise, abortPromise]);
        } catch (error) {
            if (error instanceof SourceError) throw error;
            if (timedOut) {
                throw new SourceError('timeout', `采集源 ${sourceKey} 请求超时`, {
                    sourceKey,
                    retryable: true,
                    cause: error,
                });
            }
            if (parentSignal?.aborted) {
                throw new SourceError('aborted', `采集源 ${sourceKey} 请求已取消`, {
                    sourceKey,
                    cause: error,
                });
            }
            throw asSourceError(error, sourceKey);
        } finally {
            clearTimeout(timeoutId);
            parentSignal?.removeEventListener('abort', abortFromParent);
            controller.signal.removeEventListener('abort', rejectOnAbort);
        }
    }

    private pruneCache(): void {
        const now = this.now();
        for (const [key, entry] of this.cache) {
            if (entry.expiresAt <= now) this.cache.delete(key);
        }
        while (this.cache.size > this.cacheMaxEntries) {
            const oldestKey = this.cache.keys().next().value as string | undefined;
            if (oldestKey === undefined) break;
            this.cache.delete(oldestKey);
        }
    }
}

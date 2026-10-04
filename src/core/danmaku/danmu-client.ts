import type {
  DanmuBangumi,
  DanmuClientError,
  DanmuClientErrorKind,
  DanmuClientResult,
  DanmuComment,
  DanmuCommentResponse,
  DanmuEpisode,
  DanmuMatchCandidate,
  DanmuMatchResponse,
  DanmuSearchAnime,
  DanmuSearchResponse,
} from './danmu-types.js';

export interface DanmuClientOptions {
  readonly baseUrl: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  readonly headers?: HeadersInit;
}

export interface DanmuRequestOptions {
  readonly signal?: AbortSignal;
}

interface JsonResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly value: unknown;
}

class DanmuTimeoutError extends Error {}

class DanmuAbortError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  if (typeof value === 'string') return value;
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

function nullableString(value: unknown): string | null {
  const result = stringValue(value).trim();
  return result || null;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  if (
    typeof value === 'string' &&
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu.test(value.trim())
  ) {
    return null;
  }
  const result = typeof value === 'number' ? value : Number(value.trim());
  return Number.isFinite(result) ? result : null;
}

function validOptionalNumber(
  value: unknown,
  options: { readonly integer?: boolean; readonly nonNegative?: boolean } = {},
): boolean {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
    return true;
  }
  const parsed = nullableNumber(value);
  return parsed !== null &&
    (!options.integer || Number.isInteger(parsed)) &&
    (!options.nonNegative || parsed >= 0);
}

function retryAfterMs(headers: Headers): number | undefined {
  const value = headers.get('retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function errorResult<T>(
  kind: DanmuClientErrorKind,
  status: number | null,
  message: string,
  retryAfter?: number,
): DanmuClientResult<T> {
  const error: DanmuClientError = {
    kind,
    status,
    message,
    ...(retryAfter === undefined ? {} : { retryAfterMs: retryAfter }),
  };
  return { ok: false, status, error };
}

function envelopeError<T>(value: unknown, status: number): DanmuClientResult<T> | null {
  if (!isRecord(value) || value.success !== false) return null;
  const code = Number(value.errorCode);
  const effectiveStatus = Number.isFinite(code) && code >= 400 ? code : status;
  const kind: DanmuClientErrorKind = effectiveStatus === 429
    ? 'rate-limited'
    : effectiveStatus >= 500
      ? 'server-error'
      : effectiveStatus >= 400
        ? 'client-error'
        : 'invalid-response';
  return errorResult(kind, effectiveStatus, stringValue(value.errorMessage) || 'danmu_api rejected the request');
}

function mediaFields(raw: Record<string, unknown>): Omit<DanmuSearchAnime, 'rawData'> {
  return {
    animeId: nullableString(raw.animeId) ?? '',
    bangumiId: nullableString(raw.bangumiId) ?? '',
    animeTitle: nullableString(raw.animeTitle) ?? '',
    type: nullableString(raw.type) ?? '',
    typeDescription: nullableString(raw.typeDescription) ?? '',
    imageUrl: nullableString(raw.imageUrl) ?? '',
    startDate: nullableString(raw.startDate) ?? '',
    episodeCount: nullableNumber(raw.episodeCount),
    source: nullableString(raw.source) ?? '',
  };
}

function parseSearchAnime(value: unknown): DanmuSearchAnime | null {
  if (!isRecord(value)) return null;
  if (!validOptionalNumber(value.episodeCount, { integer: true, nonNegative: true })) return null;
  const fields = mediaFields(value);
  if (!fields.animeId || !fields.animeTitle) return null;
  return { ...fields, rawData: { ...value } };
}

function parseMatchCandidate(value: unknown): DanmuMatchCandidate | null {
  if (!isRecord(value)) return null;
  const animeId = nullableString(value.animeId) ?? '';
  const episodeId = nullableString(value.episodeId) ?? '';
  const animeTitle = nullableString(value.animeTitle) ?? '';
  if (!animeId || !episodeId || !animeTitle || !validOptionalNumber(value.shift)) return null;
  return {
    animeId,
    animeTitle,
    episodeId,
    episodeTitle: nullableString(value.episodeTitle) ?? '',
    type: nullableString(value.type) ?? '',
    typeDescription: nullableString(value.typeDescription) ?? '',
    shift: nullableNumber(value.shift) ?? 0,
    imageUrl: nullableString(value.imageUrl) ?? '',
    url: nullableString(value.url) ?? '',
    rawData: { ...value },
  };
}

function parseEpisode(value: unknown, animeId: string, rawIndex: number): DanmuEpisode | null {
  if (!isRecord(value)) return null;
  const episodeId = nullableString(value.episodeId) ?? '';
  if (!episodeId) return null;
  return {
    animeId,
    rawIndex,
    seasonId: nullableString(value.seasonId) ?? '',
    episodeId,
    episodeTitle: nullableString(value.episodeTitle) ?? '',
    apiEpisodeNumber: nullableString(value.episodeNumber),
    airDate: nullableString(value.airDate),
    url: nullableString(value.url) ?? '',
    rawData: { ...value },
  };
}

function parseComment(value: unknown): DanmuComment | null {
  if (!isRecord(value) || typeof value.p !== 'string' || typeof value.m !== 'string') return null;
  return { p: value.p, m: value.m, rawData: { ...value } };
}

export class DanmuClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly headers: Headers;

  constructor(options: DanmuClientOptions) {
    this.baseUrl = options.baseUrl.trim().replace(/\/+$/, '');
    if (!this.baseUrl) throw new TypeError('DanmuClient baseUrl is required');
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') throw new TypeError('DanmuClient fetch implementation is required');
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.headers = new Headers(options.headers);
  }

  async match(fileName: string, options: DanmuRequestOptions = {}): Promise<DanmuClientResult<DanmuMatchResponse>> {
    const query = fileName.trim();
    if (!query) return errorResult('client-error', 400, 'fileName is required');
    const response = await this.requestJson('/api/v2/match', {
      method: 'POST',
      body: JSON.stringify({ fileName: query }),
      headers: { 'content-type': 'application/json' },
    }, options.signal);
    if (!response.ok) return response;
    const envelope = envelopeError<DanmuMatchResponse>(response.data.value, response.data.status);
    if (envelope) return envelope;
    const value = response.data.value;
    if (!isRecord(value) || typeof value.isMatched !== 'boolean' || !Array.isArray(value.matches)) {
      return errorResult('invalid-response', response.data.status, 'Invalid match response');
    }
    const matches = value.matches.map(parseMatchCandidate).filter((item): item is DanmuMatchCandidate => item !== null);
    if (matches.length !== value.matches.length || (value.isMatched && matches.length === 0)) {
      return errorResult('invalid-response', response.data.status, 'Match response contains invalid candidates');
    }
    return { ok: true, status: response.data.status, data: { isMatched: value.isMatched, matches } };
  }

  async searchAnime(keyword: string, options: DanmuRequestOptions = {}): Promise<DanmuClientResult<DanmuSearchResponse>> {
    const query = keyword.trim();
    if (!query) return errorResult('client-error', 400, 'keyword is required');
    const path = `/api/v2/search/anime?keyword=${encodeURIComponent(query)}`;
    const response = await this.requestJson(path, { method: 'GET' }, options.signal);
    if (!response.ok) return response;
    const envelope = envelopeError<DanmuSearchResponse>(response.data.value, response.data.status);
    if (envelope) return envelope;
    const value = response.data.value;
    if (!isRecord(value) || !Array.isArray(value.animes)) {
      return errorResult('invalid-response', response.data.status, 'Invalid anime search response');
    }
    const animes = value.animes.map(parseSearchAnime).filter((item): item is DanmuSearchAnime => item !== null);
    if (animes.length !== value.animes.length) {
      return errorResult('invalid-response', response.data.status, 'Anime search response contains invalid candidates');
    }
    return { ok: true, status: response.data.status, data: { animes } };
  }

  async getBangumi(animeId: string, options: DanmuRequestOptions = {}): Promise<DanmuClientResult<DanmuBangumi>> {
    const id = animeId.trim();
    if (!id) return errorResult('client-error', 400, 'animeId is required');
    const response = await this.requestJson(`/api/v2/bangumi/${encodeURIComponent(id)}`, { method: 'GET' }, options.signal);
    if (!response.ok) return response;
    const envelope = envelopeError<DanmuBangumi>(response.data.value, response.data.status);
    if (envelope) return envelope;
    const value = response.data.value;
    if (!isRecord(value) || !isRecord(value.bangumi) || !Array.isArray(value.bangumi.episodes)) {
      return errorResult('invalid-response', response.data.status, 'Invalid bangumi response');
    }
    const raw = value.bangumi;
    const rawEpisodes = raw.episodes;
    if (!Array.isArray(rawEpisodes)) {
      return errorResult('invalid-response', response.data.status, 'Bangumi episodes are invalid');
    }
    const normalizedAnimeId = nullableString(raw.animeId) ?? '';
    const normalizedAnimeTitle = nullableString(raw.animeTitle) ?? '';
    if (!normalizedAnimeId || !normalizedAnimeTitle) {
      return errorResult('invalid-response', response.data.status, 'Bangumi identity is missing');
    }
    const episodes = rawEpisodes
      .map((episode, index) => parseEpisode(episode, normalizedAnimeId, index))
      .filter((episode): episode is DanmuEpisode => episode !== null);
    if (episodes.length !== rawEpisodes.length) {
      return errorResult('invalid-response', response.data.status, 'Bangumi response contains invalid episodes');
    }
    return {
      ok: true,
      status: response.data.status,
      data: {
        animeId: normalizedAnimeId,
        bangumiId: nullableString(raw.bangumiId) ?? '',
        animeTitle: normalizedAnimeTitle,
        type: nullableString(raw.type) ?? '',
        typeDescription: nullableString(raw.typeDescription) ?? '',
        episodes,
        rawData: { ...raw },
      },
    };
  }

  async getComments(episodeId: string, options: DanmuRequestOptions = {}): Promise<DanmuClientResult<DanmuCommentResponse>> {
    const id = episodeId.trim();
    if (!id) return errorResult('client-error', 400, 'episodeId is required');
    const path = `/api/v2/comment/${encodeURIComponent(id)}?format=json&duration=true`;
    const response = await this.requestJson(path, { method: 'GET' }, options.signal);
    if (!response.ok) return response;
    const envelope = envelopeError<DanmuCommentResponse>(response.data.value, response.data.status);
    if (envelope) return envelope;
    const value = response.data.value;
    if (!isRecord(value) || !Array.isArray(value.comments)) {
      return errorResult('invalid-response', response.data.status, 'Invalid comment response');
    }
    if (
      !validOptionalNumber(value.count, { integer: true, nonNegative: true }) ||
      !validOptionalNumber(value.videoDuration, { nonNegative: true })
    ) {
      return errorResult('invalid-response', response.data.status, 'Comment response contains invalid numeric metadata');
    }
    const comments = value.comments.map(parseComment).filter((item): item is DanmuComment => item !== null);
    if (comments.length !== value.comments.length) {
      return errorResult('invalid-response', response.data.status, 'Comment response contains invalid items');
    }
    const count = nullableNumber(value.count) ?? comments.length;
    const videoDuration = nullableNumber(value.videoDuration);
    return { ok: true, status: response.data.status, data: { count, comments, videoDuration } };
  }

  private async requestJson(
    path: string,
    init: RequestInit,
    externalSignal?: AbortSignal,
  ): Promise<DanmuClientResult<JsonResponse>> {
    const controller = new AbortController();
    let didTimeout = false;
    let rejectExternalAbort: ((reason: DanmuAbortError) => void) | undefined;
    const externalAbort = new Promise<never>((_resolve, reject) => {
      rejectExternalAbort = reject;
    });
    const abortFromExternal = () => {
      controller.abort(externalSignal?.reason);
      rejectExternalAbort?.(new DanmuAbortError('danmu_api request was aborted'));
    };
    if (externalSignal?.aborted) abortFromExternal();
    else externalSignal?.addEventListener('abort', abortFromExternal, { once: true });

    const headers = new Headers(this.headers);
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
          didTimeout = true;
          controller.abort();
          reject(new DanmuTimeoutError(`danmu_api request timed out after ${this.timeoutMs}ms`));
        }, this.timeoutMs);
      });
      const response = await Promise.race([
        this.fetchImpl(`${this.baseUrl}${path}`, { ...init, headers, signal: controller.signal }),
        timeout,
        externalAbort,
      ]);
      if (!response.ok) {
        const kind: DanmuClientErrorKind = response.status === 429
          ? 'rate-limited'
          : response.status >= 500
            ? 'server-error'
            : 'client-error';
        return errorResult(kind, response.status, `danmu_api returned HTTP ${response.status}`, retryAfterMs(response.headers));
      }
      const text = await Promise.race([response.text(), timeout, externalAbort]);
      if (!text.trim()) return errorResult('invalid-response', response.status, 'danmu_api returned an empty response');
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        return errorResult('invalid-response', response.status, 'danmu_api returned invalid JSON');
      }
      return { ok: true, status: response.status, data: { status: response.status, headers: response.headers, value } };
    } catch (error) {
      if (didTimeout || error instanceof DanmuTimeoutError) {
        return errorResult('timeout', null, error instanceof Error ? error.message : 'danmu_api request timed out');
      }
      if (externalSignal?.aborted || error instanceof DanmuAbortError) {
        return errorResult('aborted', null, 'danmu_api request was aborted');
      }
      return errorResult('network-error', null, error instanceof Error ? error.message : 'danmu_api network request failed');
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      externalSignal?.removeEventListener('abort', abortFromExternal);
    }
  }
}

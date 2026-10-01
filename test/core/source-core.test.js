import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
    AppleCMSAdapter,
    SourceError,
    SourceManager,
    SourceNormalizer,
    parseAppleCmsPlaySources,
} from '../../js/liberty-core.js';

const fixtureUrl = new URL('../fixtures/sources/apple-cms-multi-group.json', import.meta.url);
const fixture = JSON.parse(await readFile(fixtureUrl, 'utf8'));

function jsonResponse(value, status = 200) {
    return new Response(JSON.stringify(value), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

test('SourceNormalizer preserves raw fields and derives normalized metadata separately', () => {
    const raw = fixture.list[0];
    const record = SourceNormalizer.normalize(raw, {
        sourceKey: 'fixture',
        sourceName: 'Fixture Source',
        fetchedAt: 1234,
    });

    assert.equal(record.sourceKey, 'fixture');
    assert.equal(record.sourceName, 'Fixture Source');
    assert.equal(record.vodId, '101');
    assert.equal(record.rawTitle, '示例剧 第二季');
    assert.equal(record.rawDescription, '<p>保留的原始简介</p>');
    assert.deepEqual(record.rawPlaySources, {
        vodPlayFrom: raw.vod_play_from,
        vodPlayUrl: raw.vod_play_url,
    });
    assert.deepEqual(record.rawData.upstream_extension, { kept: true });
    assert.equal(record.normalizedTitle, '示例剧 第二季');
    assert.deepEqual(record.normalizedDirector, ['甲', '乙']);
    assert.deepEqual(record.normalizedActors, ['演员A', '演员B']);
    assert.equal(record.parsedYear, 2025);
    assert.equal(record.mediaType, 'series');
    assert.equal(record.fetchedAt, 1234);
});

test('SourceNormalizer reuses TitleParser season evidence without promoting a trailing title number', () => {
    const cases = [
        ['示例 第一季', 1],
        ['示例 第二季', 2],
        ['示例 第三季', 3],
        ['Example Season 2', 2],
        ['Example S02', 2],
        ['未标注季度', null],
        ['某某2', null],
    ];

    for (const [rawTitle, expectedSeason] of cases) {
        const record = SourceNormalizer.normalize({
            vod_id: rawTitle,
            vod_name: rawTitle,
        }, { sourceKey: 'fixture', fetchedAt: 1 });
        assert.equal(record.rawTitle, rawTitle);
        assert.equal(record.parsedSeason, expectedSeason, rawTitle);
    }
});

test('AppleCMS playlist parser retains groups, entries, raw indexes and URLs', () => {
    const raw = fixture.list[0];
    const groups = parseAppleCmsPlaySources('fixture', '101', raw.vod_play_from, raw.vod_play_url);

    assert.equal(groups.length, 2);
    assert.equal(groups[0].rawIndex, 0);
    assert.equal(groups[0].rawName, 'm3u8');
    assert.equal(groups[0].rawValue, raw.vod_play_url.split('$$$')[0]);
    assert.equal(groups[0].episodes.length, 3);
    assert.deepEqual(
        groups[0].episodes.map((episode) => [episode.rawIndex, episode.rawEpisodeName, episode.playUrl]),
        [
            [0, '第11集', 'https://media.example/11.m3u8'],
            [1, '第12集', 'https://media.example/12.m3u8'],
            [2, '', 'https://media.example/unnamed.m3u8'],
        ],
    );
    assert.equal(groups[1].episodes.length, 1, 'invalid non-HTTP entries retain no playable episode');
});

test('rawIndex and generated display names never become episode-number evidence', () => {
    const groups = parseAppleCmsPlaySources(
        'fixture',
        '101',
        '',
        'https://media.example/a.m3u8#1080P$https://media.example/b.m3u8#12$https://media.example/12.m3u8',
    );
    const [unnamed, quality, numeric] = groups[0].episodes;

    assert.equal(unnamed.rawIndex, 0);
    assert.equal(unnamed.displayName, '播放项 1');
    assert.equal(unnamed.rawEpisodeName, '');
    assert.equal(unnamed.parsedEpisodeInfo.episodeNumber, null);
    assert.equal(unnamed.parsedEpisodeInfo.numberKind, 'none');
    assert.equal(
        unnamed.parsedEpisodeInfo.evidence.some((item) => /episode|issue|date|special/.test(item.code)),
        false,
    );
    assert.equal(quality.rawIndex, 1);
    assert.equal(quality.parsedEpisodeInfo.episodeNumber, null);
    assert.equal(quality.parsedEpisodeInfo.evidence[0].code, 'ignored_technical_token');
    assert.equal(numeric.rawIndex, 2);
    assert.equal(numeric.parsedEpisodeInfo.episodeNumber, 12);
    assert.equal(numeric.parsedEpisodeInfo.evidence[0].code, 'pure_numeric_label');
});

test('explicit episode labels are parsed without using source order', () => {
    const [group] = parseAppleCmsPlaySources(
        'fixture',
        '101',
        'line',
        'S02E12$https://media.example/a.m3u8#EP13$https://media.example/b.m3u8#第14话$https://media.example/c.m3u8',
    );

    assert.deepEqual(
        group.episodes.map((episode) => ({
            seasonNumber: episode.parsedEpisodeInfo.seasonNumber,
            episodeNumber: episode.parsedEpisodeInfo.episodeNumber,
            confidence: episode.parsedEpisodeInfo.confidence,
            evidenceCode: episode.parsedEpisodeInfo.evidence[0].code,
        })),
        [
            { seasonNumber: 2, episodeNumber: 12, confidence: 'high', evidenceCode: 'explicit_season_episode' },
            { seasonNumber: null, episodeNumber: 13, confidence: 'high', evidenceCode: 'short_episode_label' },
            { seasonNumber: null, episodeNumber: 14, confidence: 'high', evidenceCode: 'explicit_episode_label' },
        ],
    );
});

test('AppleCMS delimiter parsing preserves raw labels and URL dollars without inventing evidence', () => {
    const groups = parseAppleCmsPlaySources(
        'fixture',
        '101',
        ' 主线路 $$$备用',
        ' 第1集 $https://media.example/a.m3u8?sig=x$y#https://media.example/unnamed.m3u8$$$OVA$https://media.example/ova.m3u8',
        'anime',
    );

    assert.equal(groups.length, 2);
    assert.equal(groups[0].rawName, ' 主线路 ');
    assert.equal(groups[0].episodes[0].rawEpisodeName, ' 第1集 ');
    assert.equal(groups[0].episodes[0].playUrl, 'https://media.example/a.m3u8?sig=x$y');
    assert.equal(groups[0].episodes[1].parsedEpisodeInfo.episodeNumber, null);
    assert.equal(groups[1].episodes[0].parsedEpisodeInfo.contentType, 'special');
    assert.equal(groups[1].episodes[0].parsedEpisodeInfo.specialKind, 'ova');
    assert.equal(groups[1].episodes[0].parsedEpisodeInfo.episodeNumber, null);
});

test('AppleCMSAdapter supports root endpoints, paging, injected fetch and URL transforms', async () => {
    const upstreamUrls = [];
    const fetchedUrls = [];
    const adapter = new AppleCMSAdapter({
        sourceKey: 'fixture',
        sourceName: 'Fixture Source',
        baseUrl: 'https://source.example/base?token=abc',
        query: { format: 'json' },
    }, {
        now: () => 777,
        transformRequestUrl(url) {
            upstreamUrls.push(url);
            return `https://proxy.example/?url=${encodeURIComponent(url)}`;
        },
        async fetch(url) {
            fetchedUrls.push(String(url));
            return jsonResponse(fixture);
        },
    });

    const page = await adapter.search('测试 作品', { page: 2 });
    const upstream = new URL(upstreamUrls[0]);
    assert.equal(upstream.pathname, '/base/api.php/provide/vod/');
    assert.equal(upstream.searchParams.get('token'), 'abc');
    assert.equal(upstream.searchParams.get('format'), 'json');
    assert.equal(upstream.searchParams.get('ac'), 'videolist');
    assert.equal(upstream.searchParams.get('wd'), '测试 作品');
    assert.equal(upstream.searchParams.get('pg'), '2');
    assert.match(fetchedUrls[0], /^https:\/\/proxy\.example\//);
    assert.equal(page.page, 2);
    assert.equal(page.pageCount, 4);
    assert.equal(page.total, 7);
    assert.equal(page.records[0].fetchedAt, 777);

    const detail = await adapter.detail('101');
    const detailUpstream = new URL(upstreamUrls[1]);
    assert.equal(detailUpstream.searchParams.get('ac'), 'videolist');
    assert.equal(detailUpstream.searchParams.get('ids'), '101');
    assert.equal(detail.vodId, '101');
});

test('AppleCMSAdapter supports a separate detail base URL and ac=detail', async () => {
    let requestedUrl = '';
    const adapter = new AppleCMSAdapter({
        sourceKey: 'detail',
        sourceName: 'Detail Source',
        baseUrl: 'https://search.example/api.php/provide/vod?token=abc',
        detailBaseUrl: 'https://detail.example/root?detailToken=xyz',
        detailAction: 'detail',
    }, {
        async fetch(url) {
            requestedUrl = String(url);
            return jsonResponse(fixture);
        },
    });

    const record = await adapter.detail('101');
    const url = new URL(requestedUrl);
    assert.equal(url.hostname, 'detail.example');
    assert.equal(url.pathname, '/root/api.php/provide/vod/');
    assert.equal(url.searchParams.get('detailToken'), 'xyz');
    assert.equal(url.searchParams.get('ac'), 'detail');
    assert.equal(url.searchParams.get('ids'), '101');
    assert.equal(record.vodId, '101');
    assert.equal(record.playGroups.length, 2);
});

test('AppleCMSAdapter reports HTTP, malformed-response and empty-detail errors explicitly', async (t) => {
    await t.test('HTTP status', async () => {
        const adapter = new AppleCMSAdapter({
            sourceKey: 'broken', sourceName: 'Broken', baseUrl: 'https://source.example',
        }, { fetch: async () => jsonResponse({}, 503) });
        await assert.rejects(adapter.search('query'), (error) => {
            assert.ok(error instanceof SourceError);
            assert.equal(error.code, 'http_error');
            assert.equal(error.status, 503);
            assert.equal(error.retryable, true);
            return true;
        });
    });

    await t.test('malformed JSON shape', async () => {
        const adapter = new AppleCMSAdapter({
            sourceKey: 'broken', sourceName: 'Broken', baseUrl: 'https://source.example',
        }, { fetch: async () => jsonResponse({ items: [] }) });
        await assert.rejects(adapter.search('query'), (error) => error.code === 'invalid_response');
    });

    await t.test('record without vod_id', async () => {
        const adapter = new AppleCMSAdapter({
            sourceKey: 'broken', sourceName: 'Broken', baseUrl: 'https://source.example',
        }, { fetch: async () => jsonResponse({ list: [{ vod_name: 'missing id' }] }) });
        await assert.rejects(adapter.search('query'), (error) => error.code === 'invalid_response');
    });

    await t.test('empty detail', async () => {
        const adapter = new AppleCMSAdapter({
            sourceKey: 'empty', sourceName: 'Empty', baseUrl: 'https://source.example',
        }, { fetch: async () => jsonResponse({ list: [] }) });
        await assert.rejects(adapter.detail('101'), (error) => error.code === 'record_not_found');
    });

    await t.test('detail response for a different vod id', async () => {
        const adapter = new AppleCMSAdapter({
            sourceKey: 'wrong', sourceName: 'Wrong', baseUrl: 'https://source.example',
        }, { fetch: async () => jsonResponse({ list: [{ vod_id: 999, vod_name: 'other' }] }) });
        await assert.rejects(adapter.detail('101'), (error) => error.code === 'record_not_found');
    });
});

test('AppleCMSAdapter enforces timeout even when an injected fetch ignores AbortSignal', async () => {
    const adapter = new AppleCMSAdapter({
        sourceKey: 'slow',
        sourceName: 'Slow',
        baseUrl: 'https://source.example',
        timeoutMs: 10,
    }, {
        fetch: async () => new Promise(() => undefined),
    });

    await assert.rejects(adapter.search('query'), (error) => error.code === 'timeout');
});

test('AppleCMSAdapter distinguishes caller cancellation from timeout', async () => {
    const controller = new AbortController();
    const adapter = new AppleCMSAdapter({
        sourceKey: 'cancelled',
        sourceName: 'Cancelled',
        baseUrl: 'https://source.example',
        timeoutMs: 1_000,
    }, {
        fetch: async () => new Promise(() => undefined),
    });

    const result = adapter.search('query', { signal: controller.signal });
    controller.abort('test cancellation');
    await assert.rejects(result, (error) => error.code === 'aborted');
});

test('SourceManager limits concurrency and isolates individual source failures', async () => {
    let active = 0;
    let maxActive = 0;
    const completions = [];
    const delays = [30, 5, 20, 1, 10];
    const adapters = delays.map((delay, index) => ({
        sourceKey: `source-${index}`,
        sourceName: `Source ${index}`,
        async search() {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await new Promise((resolve) => setTimeout(resolve, delay));
            active -= 1;
            if (index === 2) throw new SourceError('network_error', 'failed', { sourceKey: this.sourceKey });
            return {
                sourceKey: this.sourceKey,
                page: 1,
                pageCount: 1,
                total: 1,
                records: [{ sourceKey: this.sourceKey, vodId: String(index) }],
            };
        },
        async detail() {
            throw new Error('not used');
        },
    }));
    const manager = new SourceManager(adapters, { concurrency: 2, cacheTtlMs: 0 });

    const result = await manager.search('query', {
        onSourceResult(progress) {
            completions.push(progress.sourceKey);
        },
    });

    assert.equal(maxActive, 2);
    assert.equal(result.records.length, 4);
    assert.deepEqual(result.failures.map((failure) => failure.sourceKey), ['source-2']);
    assert.equal(completions[0], 'source-1', 'fast sources report without waiting for every source');
});

test('SourceManager times out an uncooperative adapter without blocking healthy sources', async () => {
    const adapters = [
        {
            sourceKey: 'healthy',
            sourceName: 'Healthy',
            async search() {
                return { sourceKey: 'healthy', page: 1, pageCount: 1, total: 1, records: [{ sourceKey: 'healthy' }] };
            },
            async detail() { throw new Error('not used'); },
        },
        {
            sourceKey: 'hanging',
            sourceName: 'Hanging',
            async search() { return new Promise(() => undefined); },
            async detail() { return new Promise(() => undefined); },
        },
    ];
    const manager = new SourceManager(adapters, { concurrency: 2, timeoutMs: 10, cacheTtlMs: 0 });

    const result = await manager.search('query');
    assert.equal(result.records.length, 1);
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].sourceKey, 'hanging');
    assert.equal(result.failures[0].error.code, 'timeout');
    assert.equal(result.failures[0].error.retryable, true);
    await assert.rejects(manager.detail('hanging', '1'), (error) => error.code === 'timeout');
});

test('SourceManager detail cache has TTL and a hard size bound', async () => {
    let now = 100;
    let calls = 0;
    const adapter = {
        sourceKey: 'fixture',
        sourceName: 'Fixture',
        async search() {
            throw new Error('not used');
        },
        async detail(vodId) {
            calls += 1;
            return { sourceKey: 'fixture', vodId, fetchedAt: now };
        },
    };
    const manager = new SourceManager([adapter], {
        cacheTtlMs: 50,
        cacheMaxEntries: 2,
        now: () => now,
    });

    await manager.detail('fixture', '1');
    await manager.detail('fixture', '1');
    assert.equal(calls, 1, 'fresh cache entry is reused');

    await manager.detail('fixture', '2');
    await manager.detail('fixture', '3');
    await manager.detail('fixture', '1');
    assert.equal(calls, 4, 'oldest entry is evicted when the size limit is reached');

    now = 200;
    await manager.detail('fixture', '3');
    assert.equal(calls, 5, 'expired entries are not reused');
});

test('SourceManager starts TTL after a request completes and never caches failures', async () => {
    let now = 100;
    let calls = 0;
    let failNext = true;
    const adapter = {
        sourceKey: 'fixture',
        sourceName: 'Fixture',
        async search() { throw new Error('not used'); },
        async detail(vodId) {
            calls += 1;
            if (failNext) {
                failNext = false;
                throw new SourceError('network_error', 'temporary', { sourceKey: 'fixture' });
            }
            now += 40;
            return { sourceKey: 'fixture', vodId, fetchedAt: now };
        },
    };
    const manager = new SourceManager([adapter], {
        cacheTtlMs: 50,
        cacheMaxEntries: 2,
        now: () => now,
    });

    await assert.rejects(manager.detail('fixture', '1'), (error) => error.code === 'network_error');
    await manager.detail('fixture', '1');
    now = 180;
    await manager.detail('fixture', '1');
    assert.equal(calls, 2, 'failed loads are retried and successful TTL starts after completion');

    now = 191;
    await manager.detail('fixture', '1');
    assert.equal(calls, 3, 'entry expires relative to completion time');
});

test('SourceManager rejects unknown sources without touching adapters', async () => {
    const manager = new SourceManager([]);
    await assert.rejects(manager.detail('missing', '1'), (error) => {
        assert.ok(error instanceof SourceError);
        assert.equal(error.code, 'unknown_source');
        return true;
    });
});

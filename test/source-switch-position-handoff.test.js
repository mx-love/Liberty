import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(
    new URL('../js/utils/source-switch-position-handoff.js', import.meta.url),
    'utf8',
);
const playerSource = readFileSync(new URL('../js/player.js', import.meta.url), 'utf8');

function createStorage() {
    const values = new Map();
    return {
        getItem: (key) => values.has(key) ? values.get(key) : null,
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: (key) => values.delete(key),
        raw: () => [...values.values()].join('\n'),
    };
}

function load() {
    const storage = createStorage();
    const window = { LibertyUtils: {}, sessionStorage: storage };
    vm.runInNewContext(source, {
        Date,
        Math,
        URL,
        Uint32Array,
        window,
    }, { filename: 'source-switch-position-handoff.js' });
    return { api: window.LibertyUtils.sourceSwitchPositionHandoff, storage };
}

function side(sourceKey, vodId, mediaId, episodeId, rawIndex = 1) {
    return {
        sourceKey,
        vodId,
        canonicalMediaId: mediaId,
        canonicalEpisodeId: episodeId,
        episode: { rawIndex, playGroup: sourceKey, playGroupIndex: 0 },
    };
}

const sourceA = side('source-a', 'vod-a', 'media-a', 'media-a:e12');
const targetB = side('source-b', 'vod-b', 'media-b', 'media-b:e12');

function createRecord(api, storage, overrides = {}, now = 1_000) {
    return api.create({
        generation: 7,
        currentTime: 600,
        oldDuration: 3600,
        source: sourceA,
        target: targetB,
        ...overrides,
    }, { storage, now });
}

test('playing and paused switches both preserve the real 600s position', () => {
    for (const paused of [false, true]) {
        const { api, storage } = load();
        const record = createRecord(api, storage, { paused });
        const result = api.consume({
            nonce: record.nonce,
            generation: record.generation,
            target: targetB,
            newDuration: 3610,
        }, { storage, now: 2_000 });
        assert.equal(result.accepted, true);
        assert.equal(result.position, 600);
        assert.equal(record.generation, 7);
    }
});

test('target media, episode, source, and vod identity are all binding', () => {
    for (const target of [
        { ...targetB, canonicalMediaId: 'media-other' },
        { ...targetB, canonicalEpisodeId: 'media-b:e13' },
        { ...targetB, sourceKey: 'source-c' },
        { ...targetB, vodId: 'vod-other' },
    ]) {
        const { api, storage } = load();
        const record = createRecord(api, storage);
        const result = api.consume({ nonce: record.nonce, generation: record.generation, target, newDuration: 3600 }, { storage, now: 2_000 });
        assert.equal(result.accepted, false);
        assert.equal(result.reason, 'target-identity-mismatch');
    }
});

test('the navigation generation is bound beside the nonce', () => {
    const { api, storage } = load();
    const record = createRecord(api, storage);
    const result = api.consume({
        nonce: record.nonce,
        generation: record.generation + 1,
        target: targetB,
        newDuration: 3600,
    }, { storage, now: 2_000 });
    assert.equal(result.accepted, false);
    assert.equal(result.reason, 'generation-mismatch');
});

test('duration compatibility requires both absolute and relative tolerance', () => {
    const accepted = load();
    const acceptedRecord = createRecord(accepted.api, accepted.storage);
    assert.equal(accepted.api.consume({
        nonce: acceptedRecord.nonce,
        generation: acceptedRecord.generation,
        target: targetB,
        newDuration: 3629,
    }, { storage: accepted.storage, now: 2_000 }).accepted, true);

    const rejected = load();
    const rejectedRecord = createRecord(rejected.api, rejected.storage);
    const result = rejected.api.consume({
        nonce: rejectedRecord.nonce,
        generation: rejectedRecord.generation,
        target: targetB,
        newDuration: 3000,
    }, { storage: rejected.storage, now: 2_000 });
    assert.equal(result.accepted, false);
    assert.equal(result.reason, 'duration-incompatible');
});

test('expired handoffs are rejected and consumed', () => {
    const { api, storage } = load();
    const record = createRecord(api, storage);
    const expired = api.consume({
        nonce: record.nonce,
        generation: record.generation,
        target: targetB,
        newDuration: 3600,
    }, { storage, now: 61_001 });
    assert.equal(expired.reason, 'expired');
    assert.equal(api.consume({ nonce: record.nonce, generation: record.generation, target: targetB, newDuration: 3600 }, { storage, now: 61_002 }).reason, 'missing');
});

test('a successful handoff is consume-on-read and refresh cannot reuse it', () => {
    const { api, storage } = load();
    const record = createRecord(api, storage);
    assert.equal(api.consume({ nonce: record.nonce, generation: record.generation, target: targetB, newDuration: 3600 }, { storage, now: 2_000 }).accepted, true);
    assert.equal(api.consume({ nonce: record.nonce, generation: record.generation, target: targetB, newDuration: 3600 }, { storage, now: 2_001 }).reason, 'missing');
});

test('A to B to C retains only the latest handoff', () => {
    const { api, storage } = load();
    const first = createRecord(api, storage);
    const targetC = side('source-c', 'vod-c', 'media-c', 'media-c:e12');
    const second = createRecord(api, storage, { source: targetB, target: targetC }, 2_000);
    assert.notEqual(first.nonce, second.nonce);
    assert.equal(api.consume({ nonce: second.nonce, generation: second.generation, target: targetC, newDuration: 3600 }, { storage, now: 3_000 }).accepted, true);
    assert.equal(api.consume({ nonce: first.nonce, generation: first.generation, target: targetB, newDuration: 3600 }, { storage, now: 3_001 }).reason, 'missing');
});

test('direct navigation and bookmarked legacy position cannot create trusted state', () => {
    const { api, storage } = load();
    assert.equal(api.consume({ nonce: '', target: targetB, newDuration: 3600 }, { storage, now: 2_000 }).reason, 'missing');
    assert.doesNotMatch(playerSource, /videoProgress_temp_/u);
    const switchStart = playerSource.indexOf('async function switchToResource(');
    const switchEnd = playerSource.indexOf('\n// 关闭弹幕源弹窗', switchStart);
    const switchSource = playerSource.slice(switchStart, switchEnd);
    assert.doesNotMatch(switchSource, /searchParams\.set\(['"]position/u);
    assert.match(switchSource, /switch_handoff/u);
});

test('production restore consumes the trusted marker and blocks legacy fallback on failure', () => {
    const restoreStart = playerSource.indexOf('let sourceSwitchHandoffHandled = false;');
    const restoreEnd = playerSource.indexOf('\n        // 加载弹幕', restoreStart);
    assert.notEqual(restoreStart, -1);
    assert.notEqual(restoreEnd, -1);
    const restoreSource = playerSource.slice(restoreStart, restoreEnd);
    assert.match(restoreSource, /sourceSwitchPositionHandoff\?\.consume/u);
    assert.match(restoreSource, /removeSourceSwitchHandoffParams\(\)/u);
    assert.match(restoreSource, /!watchRoomLaunch && !trustedHandoffNavigation/u);
    assert.doesNotMatch(restoreSource, /videoProgress_temp_/u);
});

test('invalid, live, near-start, and near-end positions are rejected safely', () => {
    const cases = [
        [{ oldDuration: Number.NaN }, 'invalid-create'],
        [{ isLive: true }, 'invalid-create'],
        [{ currentTime: 5 }, 'near-start'],
        [{ currentTime: 10 }, 'near-start'],
        [{ currentTime: 3580 }, 'near-end'],
    ];
    for (const [overrides, expected] of cases) {
        const { api, storage } = load();
        const record = createRecord(api, storage, overrides);
        if (expected === 'invalid-create') {
            assert.equal(record, null);
            continue;
        }
        const result = api.consume({ nonce: record.nonce, generation: record.generation, target: targetB, newDuration: 3600 }, { storage, now: 2_000 });
        assert.equal(result.reason, expected);
    }
});

test('stored handoff contains no media URL, token, or signed query', () => {
    const { api, storage } = load();
    createRecord(api, storage, {
        videoUrl: 'https://cdn.example.test/video.m3u8?token=secret&expires=999',
        authorization: 'Bearer secret',
    });
    const raw = storage.raw();
    assert.doesNotMatch(raw, /https?:\/\//u);
    assert.doesNotMatch(raw, /token|secret|expires|authorization/iu);
});

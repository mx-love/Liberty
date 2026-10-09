// Stage E production integration tests execute the complete production player
// against the actual built Liberty Core browser API.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

import * as CoreBundle from '../js/liberty-core.js';

const playerSource = readFileSync(new URL('../js/player.js', import.meta.url), 'utf8');

function jsonResponse(value, status = 200, headers = {}) {
    return new Response(JSON.stringify(value), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
    });
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((onResolve, onReject) => {
        resolve = onResolve;
        reject = onReject;
    });
    return { promise, resolve, reject };
}

async function until(predicate, message = 'condition was not reached') {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    assert.fail(message);
}

function regularEpisodes(numbers = [11, 12, 13], prefix = 'dm-e') {
    return numbers.map((number, rawIndex) => ({
        episodeId: prefix + number,
        episodeTitle: 'E' + number,
        // Deliberately list-position metadata. Core must use episodeTitle.
        episodeNumber: String(rawIndex + 1),
        airDate: '',
    }));
}

function createWork(overrides = {}) {
    return {
        title: 'Orbital Patrol',
        animeId: 'orbital-s1',
        animeTitle: 'Orbital Patrol S01',
        year: 2025,
        episodes: regularEpisodes(),
        comments: new Map(),
        videoDuration: 1200,
        ...overrides,
    };
}

function inferRequestedEpisode(fileName) {
    const seasonEpisode = /S\d{1,2}E(\d{1,4})/iu.exec(fileName);
    if (seasonEpisode) return Number(seasonEpisode[1]);
    const englishEpisode = /(?:^|\s)(?:EP?|Episode)\s*0*(\d{1,4})(?:\s|$)/iu.exec(fileName);
    if (englishEpisode) return Number(englishEpisode[1]);
    const chineseEpisode = /第\s*0*(\d{1,4})\s*[集话期]/u.exec(fileName);
    return chineseEpisode ? Number(chineseEpisode[1]) : null;
}

function createNetwork(works = [createWork()]) {
    const state = {
        works,
        calls: [],
        intercept: null,
        forceNoMatch: false,
        searchCandidates: null,
    };
    const workForText = (text) => (
        state.works.find((work) => String(text).includes(work.title)) || state.works[0]
    );

    async function fetchFixture(url, init = {}) {
        const parsedUrl = new URL(String(url));
        const path = parsedUrl.pathname;
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
        const call = {
            url: String(url),
            path,
            method: init.method || 'GET',
            body,
            signal: init.signal,
        };
        state.calls.push(call);

        if (state.intercept) {
            const intercepted = await state.intercept(call, state);
            if (intercepted !== undefined) return intercepted;
        }

        if (path.endsWith('/api/v2/match')) {
            const fileName = String(body?.fileName || '');
            const work = workForText(fileName);
            const number = inferRequestedEpisode(fileName);
            const episode = work?.episodes.find((item) => item.episodeTitle === 'E' + number)
                || work?.episodes[0];
            const matches = state.forceNoMatch || !work || !episode ? [] : [{
                animeId: work.animeId,
                animeTitle: work.animeTitle,
                episodeId: episode.episodeId,
                episodeTitle: episode.episodeTitle,
                type: 'drama',
                typeDescription: 'series',
                shift: 0,
                imageUrl: '',
                url: '',
            }];
            return jsonResponse({ success: true, isMatched: matches.length > 0, matches });
        }

        if (path.endsWith('/api/v2/search/anime')) {
            const keyword = parsedUrl.searchParams.get('keyword') || '';
            const candidates = state.searchCandidates || state.works
                .filter((work) => keyword.includes(work.title) || work.title.includes(keyword))
                .map((work) => ({
                    animeId: work.animeId,
                    bangumiId: work.animeId,
                    animeTitle: work.animeTitle,
                    type: 'drama',
                    typeDescription: 'series',
                    imageUrl: '',
                    startDate: work.year ? String(work.year) + '-01-01' : '',
                    episodeCount: work.episodes.length,
                    source: 'production-integration-fixture',
                }));
            return jsonResponse({ success: true, animes: candidates });
        }

        const bangumiMatch = /\/api\/v2\/bangumi\/([^/]+)$/u.exec(path);
        if (bangumiMatch) {
            const animeId = decodeURIComponent(bangumiMatch[1]);
            const work = state.works.find((item) => String(item.animeId) === animeId);
            if (!work) return jsonResponse({}, 404);
            return jsonResponse({
                success: true,
                bangumi: {
                    animeId: work.animeId,
                    bangumiId: work.animeId,
                    animeTitle: work.animeTitle,
                    type: 'drama',
                    typeDescription: 'series',
                    episodes: work.episodes.map((episode) => ({
                        seasonId: 'season-' + work.animeId,
                        episodeId: episode.episodeId,
                        episodeTitle: episode.episodeTitle,
                        episodeNumber: episode.episodeNumber,
                        airDate: episode.airDate || '',
                        url: '',
                    })),
                },
            });
        }

        const commentMatch = /\/api\/v2\/comment\/([^/]+)$/u.exec(path);
        if (commentMatch) {
            const episodeId = decodeURIComponent(commentMatch[1]);
            const work = state.works.find((item) => (
                item.episodes.some((episode) => episode.episodeId === episodeId)
            ));
            const comments = work?.comments.get(episodeId) || [{
                p: '10,1,16777215,user',
                m: episodeId + ' comment',
            }];
            return jsonResponse({
                count: comments.length,
                comments,
                videoDuration: work?.videoDuration ?? null,
            });
        }

        throw new Error('Unexpected production request: ' + call.method + ' ' + path);
    }

    return { state, fetch: fetchFixture };
}

function createClassList() {
    const values = new Set(['hidden']);
    return {
        add: (...names) => names.forEach((name) => values.add(name)),
        remove: (...names) => names.forEach((name) => values.delete(name)),
        contains: (name) => values.has(name),
        toggle(name, force) {
            const next = force === undefined ? !values.has(name) : Boolean(force);
            if (next) values.add(name);
            else values.delete(name);
            return next;
        },
    };
}

function createElement(id = '') {
    const listeners = new Map();
    return {
        id,
        classList: createClassList(),
        style: { setProperty() {}, removeProperty() {} },
        dataset: {},
        innerHTML: '',
        textContent: '',
        value: '',
        checked: false,
        disabled: false,
        offsetWidth: 100,
        clientWidth: 1280,
        clientHeight: 720,
        parentNode: null,
        addEventListener(type, listener) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type).add(listener);
        },
        removeEventListener(type, listener) {
            listeners.get(type)?.delete(listener);
        },
        dispatchEvent(event) {
            for (const listener of listeners.get(event.type) || []) listener.call(this, event);
            return true;
        },
        querySelector: () => null,
        querySelectorAll: () => [],
        appendChild(child) {
            child.parentNode = this;
            return child;
        },
        remove() {},
        setAttribute() {},
        removeAttribute() {},
        focus() {},
        click() {},
        pause() {},
        play: async () => undefined,
        load() {},
        getBoundingClientRect: () => ({ top: 0, left: 0, width: 100, height: 40 }),
    };
}

function createStorage() {
    const values = new Map();
    return {
        getItem: (key) => values.has(key) ? values.get(key) : null,
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: (key) => values.delete(key),
        clear: () => values.clear(),
    };
}

function createHarness(options = {}) {
    const network = options.network || createNetwork(options.works);
    const elements = new Map();
    const documentListeners = new Map();
    const windowListeners = new Map();
    const errors = [];
    const warnings = [];
    const toasts = [];
    const pluginApplications = [];
    const session = {
        sourceCode: 'fixture-source',
        sourceName: 'Fixture Source',
        vodId: 'fixture-vod',
        year: '2025',
        category: '电视剧',
        remarks: '',
    };
    const localStorage = createStorage();
    const sessionStorage = createStorage();
    const element = (id) => {
        if (!elements.has(id)) elements.set(id, createElement(id));
        return elements.get(id);
    };

    const plugin = {
        option: { visible: true },
        config(nextConfig) {
            this.lastConfig = nextConfig;
            if (typeof nextConfig?.visible === 'boolean') this.option.visible = nextConfig.visible;
        },
        async load() {
            pluginApplications.push(structuredClone(this.lastConfig?.danmuku || []));
        },
        reset() {},
        show() { this.option.visible = true; },
        hide() { this.option.visible = false; },
    };
    const video = {
        paused: true,
        ended: false,
        currentTime: 0,
        duration: options.playerDuration ?? 1200,
        readyState: 4,
        currentSrc: 'https://media.example.test/current.m3u8',
        seeking: false,
        addEventListener() {},
        removeEventListener() {},
        pause() { this.paused = true; },
        async play() { this.paused = false; },
        load() {},
        removeAttribute() {},
    };
    const art = {
        video,
        duration: video.duration,
        currentTime: 0,
        playing: false,
        plugins: { artplayerPluginDanmuku: plugin },
        template: { $player: element('player') },
        on() {},
        off() {},
        async play() { video.paused = false; },
        destroy() {},
    };
    const location = {
        href: 'https://liberty.example.test/player.html?source=fixture-source&id=fixture-vod',
        origin: 'https://liberty.example.test',
        search: '?source=fixture-source&id=fixture-vod',
        pathname: '/player.html',
    };
    const document = {
        hidden: false,
        visibilityState: 'visible',
        referrer: '',
        title: '',
        documentElement: element('documentElement'),
        body: element('body'),
        fullscreenElement: null,
        webkitFullscreenElement: null,
        getElementById: element,
        createElement: (tagName) => createElement(tagName),
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener(type, listener) {
            if (!documentListeners.has(type)) documentListeners.set(type, new Set());
            documentListeners.get(type).add(listener);
        },
        removeEventListener(type, listener) {
            documentListeners.get(type)?.delete(listener);
        },
        dispatchEvent(event) {
            for (const listener of documentListeners.get(event.type) || []) {
                listener.call(document, event);
            }
            return true;
        },
    };
    const windowObject = {
        LibertyCore: CoreBundle.LibertyCore,
        LibertyUtils: { playbackState: { readPlaybackSession: () => ({ ...session }) } },
        DANMU_CONFIG: {
            baseUrl: 'https://danmu.example.test/private-prefix',
            enabled: true,
        },
        __ENV__: {},
        location,
        innerWidth: 1280,
        innerHeight: 720,
        devicePixelRatio: 1,
        fetch: network.fetch,
        addEventListener(type, listener) {
            if (!windowListeners.has(type)) windowListeners.set(type, new Set());
            windowListeners.get(type).add(listener);
        },
        removeEventListener(type, listener) {
            windowListeners.get(type)?.delete(listener);
        },
        dispatchEvent(event) {
            for (const listener of windowListeners.get(event.type) || []) {
                listener.call(windowObject, event);
            }
            return true;
        },
        history: { back() {}, replaceState() {} },
        parent: {},
        screen: {
            orientation: {
                addEventListener() {},
                removeEventListener() {},
                lock: async () => undefined,
            },
        },
        matchMedia: () => ({
            matches: false,
            addEventListener() {},
            removeEventListener() {},
        }),
        requestAnimationFrame: (callback) => setTimeout(callback, 0),
        cancelAnimationFrame: clearTimeout,
    };
    windowObject.window = windowObject;
    windowObject.self = windowObject;
    windowObject.top = windowObject;

    const quietConsole = {
        log() {},
        debug() {},
        trace() {},
        table() {},
        info() {},
        warn: (...args) => warnings.push(args),
        error: (...args) => errors.push(args),
    };
    const context = vm.createContext({
        AbortController,
        AbortSignal,
        Blob,
        CustomEvent: class CustomEvent {
            constructor(type, init = {}) {
                this.type = type;
                this.detail = init.detail;
            }
        },
        Date,
        Event: class Event {
            constructor(type) { this.type = type; }
        },
        Headers,
        Hls: class Hls {
            static DefaultConfig = {
                loader: class Loader {
                    load() {}
                },
            };
        },
        Map,
        Math,
        Promise,
        Request,
        Response,
        Set,
        TextDecoder,
        TextEncoder,
        URL,
        URLSearchParams,
        clearInterval,
        clearTimeout,
        console: quietConsole,
        crypto,
        decodeURIComponent,
        document,
        encodeURIComponent,
        fetch: network.fetch,
        localStorage,
        location,
        navigator: {
            userAgent: 'Stage E production integration test',
            platform: 'Win32',
            maxTouchPoints: 0,
            connection: null,
            wakeLock: null,
        },
        performance,
        queueMicrotask,
        requestAnimationFrame: windowObject.requestAnimationFrame,
        cancelAnimationFrame: windowObject.cancelAnimationFrame,
        screen: windowObject.screen,
        sessionStorage,
        setInterval,
        setTimeout,
        structuredClone,
        window: windowObject,
    });
    vm.runInContext(playerSource, context, { filename: 'js/player.js' });
    context.__artHarness = art;
    context.__sessionHarness = session;
    context.__toasts = toasts;

    const bridgeSource = `
        waitForCurrentVideoReady = async () => ({
            ready: true,
            waitedToNewSource: true,
            currentSrc: currentVideoUrl,
            readyState: 4,
            duration: art?.video?.duration || 0,
            indexMatched: true,
            sourceMatched: true,
        });
        showToast = (message, type) => globalThis.__toasts.push({ message, type });
        art = globalThis.__artHarness;
        window.LibertyPlayer.art = art;
        globalThis.__stageE = {
            setPlayback(input) {
                currentVideoTitle = input.title;
                currentEpisodeIndex = input.index;
                currentEpisodeEntries = input.episodes.map((entry, index) => ({
                    rawIndex: entry.rawIndex ?? index,
                    rawEpisodeName: Object.prototype.hasOwnProperty.call(entry, 'rawEpisodeName')
                        ? entry.rawEpisodeName
                        : entry.name,
                    displayEpisodeName: entry.displayEpisodeName || entry.name || '',
                    name: entry.name || entry.displayEpisodeName || '',
                    episodeNameSource: entry.episodeNameSource || 'source',
                    rawEntry: entry.rawEntry || '',
                    url: entry.url || 'https://media.example.test/' + index + '.m3u8',
                }));
                currentEpisodes = currentEpisodeEntries.map((entry) => entry.url);
                currentVideoUrl = currentEpisodes[input.index] || '';
                if (input.resetSession !== false) currentSessionDanmuSource = null;
                currentDanmuCache = {
                    key: '',
                    episodeIndex: -1,
                    danmuList: null,
                    timestamp: 0,
                };
            },
            createContext(title = currentVideoTitle, index = currentEpisodeIndex) {
                return createProductionDanmakuContext(title, index);
            },
            getDanmuku(title = currentVideoTitle, index = currentEpisodeIndex) {
                return getDanmukuForVideo(title, index);
            },
            load(reason = 'test-load') {
                return loadDanmakuForCurrentEpisode(reason);
            },
            injectManualCandidate(raw) {
                const candidate = getDanmuCoreRuntime().core.adaptDanmuSearchAnime(raw);
                manualDanmuCandidates.set(String(candidate.animeId), candidate);
                return candidate;
            },
            switchManual(animeId) { return switchDanmuSource(String(animeId)); },
            confirmManualEpisode(animeId, episodeId) {
                return confirmDanmuEpisodeChoice(String(animeId), String(episodeId));
            },
            toggleDanmaku() { return toggleDanmakuByShortcut(); },
            beginRequest(reason = 'test-request') {
                const context = createProductionDanmakuContext(currentVideoTitle, currentEpisodeIndex);
                return beginDanmakuRequest(reason, context);
            },
            isCurrentRequest(request, index = currentEpisodeIndex) {
                return isCurrentDanmakuRequest(request, index);
            },
            cancelRequest(reason = 'test-cancel') { cancelDanmakuRequest(reason); },
            destroyPlayer() {
                const instance = new VideoPlayer('player');
                instance.art = art;
                videoPlayer = instance;
                instance.destroy();
                videoPlayer = null;
                art = null;
                window.LibertyPlayer.art = null;
            },
            debug() { return window.debugDanmuState(); },
            sessionSource() { return currentSessionDanmuSource; },
        };
    `;
    vm.runInContext(bridgeSource, context, { filename: 'test/stage-e-player-bridge.js' });

    return {
        api: context.__stageE,
        art,
        context,
        document,
        elements,
        errors,
        network,
        pluginApplications,
        session,
        toasts,
        warnings,
    };
}

function playbackEpisodes(labels, options = {}) {
    return labels.map((name, index) => ({
        rawIndex: index,
        name,
        rawEpisodeName: name,
        url: 'https://media.example.test/' + (options.prefix || 'episode') + '-' + index + '.m3u8',
    }));
}

function setStandardPlayback(harness, overrides = {}) {
    Object.assign(harness.session, {
        sourceCode: overrides.sourceCode || 'fixture-source',
        sourceName: overrides.sourceName || 'Fixture Source',
        vodId: overrides.vodId || 'fixture-vod',
        year: overrides.year === undefined ? '2025' : String(overrides.year || ''),
        category: overrides.category || '电视剧',
        remarks: overrides.remarks || '',
    });
    harness.api.setPlayback({
        title: overrides.title || 'Orbital Patrol S01',
        episodes: overrides.episodes || playbackEpisodes(['E11', 'E12', 'E13']),
        index: overrides.index ?? 1,
        resetSession: overrides.resetSession,
    });
}

function requestPaths(harness) {
    return harness.network.state.calls.map((call) => call.path);
}

function commentRequests(harness) {
    return harness.network.state.calls.filter((call) => call.path.includes('/api/v2/comment/'));
}

function nonEmptyApplications(harness) {
    return harness.pluginApplications.filter((items) => items.length > 0);
}

function manualCandidate(work) {
    return {
        animeId: work.animeId,
        bangumiId: work.animeId,
        animeTitle: work.animeTitle,
        type: 'drama',
        typeDescription: 'series',
        imageUrl: '',
        startDate: String(work.year) + '-01-01',
        episodeCount: work.episodes.length,
        source: 'manual-production-test',
        rawData: {},
    };
}

test('1. ordinary TV episode one resolves through player -> Core V2 -> comments', async () => {
    const work = createWork({ episodes: regularEpisodes([1, 2, 3]) });
    const harness = createHarness({ works: [work] });
    setStandardPlayback(harness, {
        episodes: playbackEpisodes(['E1', 'E2', 'E3']),
        index: 0,
    });

    const result = await harness.api.getDanmuku();

    assert.equal(harness.api.createContext().episode?.episodeNumber, 1);
    assert.equal(result[0]?.text, 'dm-e1 comment');
    assert.match(commentRequests(harness)[0].path, /\/dm-e1$/u);
    assert.deepEqual(harness.errors, []);
});

test('2. rawIndex=1 with real E12 resolves E12 rather than array position two', async () => {
    const harness = createHarness();
    setStandardPlayback(harness);

    const context = harness.api.createContext();
    const result = await harness.api.getDanmuku();

    assert.equal(context.currentEpisodeIndex, 1);
    assert.equal(context.sourceEpisode?.rawIndex, 1);
    assert.equal(context.episode?.episodeNumber, 12);
    assert.equal(result[0]?.text, 'dm-e12 comment');
    assert.match(commentRequests(harness)[0].path, /\/dm-e12$/u);
});

test('3. a reordered danmu episode list still maps the unique E12 identity', async () => {
    const work = createWork({
        episodes: [
            { episodeId: 'dm-e13', episodeTitle: 'E13', episodeNumber: '1' },
            { episodeId: 'dm-e12', episodeTitle: 'E12', episodeNumber: '2' },
            { episodeId: 'dm-e11', episodeTitle: 'E11', episodeNumber: '3' },
        ],
    });
    const harness = createHarness({ works: [work] });
    setStandardPlayback(harness);

    const result = await harness.api.getDanmuku();

    assert.equal(result[0]?.text, 'dm-e12 comment');
    assert.match(commentRequests(harness)[0].path, /\/dm-e12$/u);
});

test('4. duplicate indistinguishable E12 entries remain uncertain and fetch no comments', async () => {
    const work = createWork({
        episodes: [
            { episodeId: 'duplicate-a', episodeTitle: 'E12', episodeNumber: '1' },
            { episodeId: 'duplicate-b', episodeTitle: '第12集', episodeNumber: '2' },
        ],
    });
    const harness = createHarness({ works: [work] });
    setStandardPlayback(harness);

    const result = await harness.api.getDanmuku();

    assert.equal(result.length, 0);
    assert.equal(harness.api.debug().lastDanmuMatchInfo.coreState, 'episode-uncertain');
    assert.equal(commentRequests(harness).length, 0);
});

test('5. explicit S01/S02 conflict is rejected before bangumi/comments', async () => {
    const work = createWork({
        animeId: 'orbital-s2',
        animeTitle: 'Orbital Patrol S02',
    });
    const harness = createHarness({ works: [work] });
    setStandardPlayback(harness, { title: 'Orbital Patrol S01' });

    const result = await harness.api.getDanmuku();

    assert.equal(result.length, 0);
    assert.equal(harness.api.debug().lastDanmuMatchInfo.coreState, 'candidate-conflict');
    assert.equal(
        requestPaths(harness).filter((path) => (
            path.includes('/bangumi/') || path.includes('/comment/')
        )).length,
        0,
    );
});

test('6. same title with a conflicting explicit year is rejected', async () => {
    const harness = createHarness();
    harness.network.state.forceNoMatch = true;
    harness.network.state.searchCandidates = [{
        animeId: 'orbital-2020',
        bangumiId: 'orbital-2020',
        animeTitle: 'Orbital Patrol S01',
        type: 'drama',
        typeDescription: 'series',
        imageUrl: '',
        startDate: '2020-01-01',
        episodeCount: 13,
        source: 'year-conflict-fixture',
    }];
    setStandardPlayback(harness, { title: 'Orbital Patrol', year: 2025 });

    const result = await harness.api.getDanmuku();

    assert.equal(result.length, 0);
    assert.equal(harness.api.debug().lastDanmuMatchInfo.coreState, 'candidate-conflict');
    assert.equal(commentRequests(harness).length, 0);
});

test('7. a source sequence missing SP does not shift the following regular episode', async () => {
    const work = createWork({
        episodes: [
            { episodeId: 'dm-e1', episodeTitle: 'E1', episodeNumber: '1' },
            { episodeId: 'dm-sp1', episodeTitle: 'SP1', episodeNumber: '2' },
            { episodeId: 'dm-e2', episodeTitle: 'E2', episodeNumber: '3' },
            { episodeId: 'dm-e3', episodeTitle: 'E3', episodeNumber: '4' },
        ],
    });
    const harness = createHarness({ works: [work] });
    setStandardPlayback(harness, {
        episodes: playbackEpisodes(['E1', 'E2', 'E3']),
        index: 2,
    });

    const result = await harness.api.getDanmuku();

    assert.equal(harness.api.createContext().episode?.episodeNumber, 3);
    assert.equal(result[0]?.text, 'dm-e3 comment');
});

test('8. a danmu sequence missing source SP still maps the later explicit episode', async () => {
    const work = createWork({ episodes: regularEpisodes([1, 2, 3]) });
    const harness = createHarness({ works: [work] });
    setStandardPlayback(harness, {
        episodes: playbackEpisodes(['E1', 'SP1', 'E2', 'E3']),
        index: 3,
    });

    const result = await harness.api.getDanmuku();

    assert.equal(harness.api.createContext().episode?.episodeNumber, 3);
    assert.equal(result[0]?.text, 'dm-e3 comment');
});

test('9. URL-only generated display labels never become episode identity evidence', async () => {
    const harness = createHarness();
    setStandardPlayback(harness, {
        title: 'Opaque Movie Collection',
        year: '',
        episodes: [{
            rawIndex: 1,
            rawEpisodeName: null,
            displayEpisodeName: '第2集',
            name: '第2集',
            episodeNameSource: 'generated',
            url: 'https://media.example.test/opaque.m3u8',
        }],
        index: 0,
    });

    const context = harness.api.createContext();
    const result = await harness.api.getDanmuku();

    assert.equal(context.state, 'uncertain');
    assert.equal(context.sourceEpisode?.rawEpisodeName, '');
    assert.equal(context.sourceEpisode?.canonicalEpisodeId, null);
    assert.equal(result.length, 0);
    assert.equal(harness.network.state.calls.length, 0);
});

test('10. API videoDuration reaches the existing production time scaler', async () => {
    const work = createWork({
        videoDuration: 1000,
        comments: new Map([[
            'dm-e12',
            [{ p: '10,1,16777215,user', m: 'scaled' }],
        ]]),
    });
    const harness = createHarness({ works: [work], playerDuration: 1050 });
    setStandardPlayback(harness);

    const result = await harness.api.getDanmuku();

    assert.equal(result.length, 1);
    assert.equal(result[0].time, 10.5);
    assert.equal(result[0].text, 'scaled');
});

function delayFirstComment(harness) {
    const gate = deferred();
    let delayed = false;
    harness.network.state.intercept = (call) => {
        if (!delayed && call.path.includes('/api/v2/comment/')) {
            delayed = true;
            return gate.promise;
        }
        return undefined;
    };
    return gate;
}

test('11. E12 -> E13 applies the new episode only after the production switch', async () => {
    const harness = createHarness();
    setStandardPlayback(harness);
    await harness.api.load('matrix-e12');
    harness.api.setPlayback({
        title: 'Orbital Patrol S01',
        episodes: playbackEpisodes(['E11', 'E12', 'E13']),
        index: 2,
    });
    await harness.api.load('matrix-e13');

    assert.deepEqual(
        nonEmptyApplications(harness).map((items) => items[0]?.text),
        ['dm-e12 comment', 'dm-e13 comment'],
    );
});

test('12. E12 -> E13 -> E12 keeps the final generation authoritative', async () => {
    const harness = createHarness();
    setStandardPlayback(harness);
    await harness.api.load('matrix-first-e12');
    harness.api.setPlayback({
        title: 'Orbital Patrol S01',
        episodes: playbackEpisodes(['E11', 'E12', 'E13']),
        index: 2,
    });
    await harness.api.load('matrix-e13');
    harness.api.setPlayback({
        title: 'Orbital Patrol S01',
        episodes: playbackEpisodes(['E11', 'E12', 'E13']),
        index: 1,
    });
    await harness.api.load('matrix-final-e12');

    assert.deepEqual(
        nonEmptyApplications(harness).map((items) => items[0]?.text),
        ['dm-e12 comment', 'dm-e13 comment', 'dm-e12 comment'],
    );
    assert.equal(harness.api.debug().lastDanmuMatchInfo.episodeNumber, 12);
});

test('13. media A E12 cannot write into media B E12 with the same index and number', async () => {
    const workA = createWork({
        title: 'Alpha Patrol',
        animeId: 'alpha-s1',
        animeTitle: 'Alpha Patrol S01',
        episodes: regularEpisodes([11, 12, 13], 'alpha-e'),
    });
    const workB = createWork({
        title: 'Beta Patrol',
        animeId: 'beta-s1',
        animeTitle: 'Beta Patrol S01',
        episodes: regularEpisodes([11, 12, 13], 'beta-e'),
    });
    const harness = createHarness({ works: [workA, workB] });
    setStandardPlayback(harness, {
        title: 'Alpha Patrol S01',
        sourceCode: 'source-alpha',
        vodId: 'alpha-vod',
    });

    const identitySnapshot = harness.api.beginRequest('identity-alpha');
    Object.assign(harness.session, { sourceCode: 'source-beta', vodId: 'beta-vod' });
    harness.api.setPlayback({
        title: 'Beta Patrol S01',
        episodes: playbackEpisodes(['E11', 'E12', 'E13'], { prefix: 'beta' }),
        index: 1,
    });
    assert.equal(harness.api.isCurrentRequest(identitySnapshot, 1), false);
    harness.api.cancelRequest('identity-check-complete');

    Object.assign(harness.session, { sourceCode: 'source-alpha', vodId: 'alpha-vod' });
    harness.api.setPlayback({
        title: 'Alpha Patrol S01',
        episodes: playbackEpisodes(['E11', 'E12', 'E13'], { prefix: 'alpha' }),
        index: 1,
    });
    const gate = delayFirstComment(harness);
    const oldLoad = harness.api.load('alpha-old');
    await until(() => commentRequests(harness).length === 1, 'Alpha comment request did not start');

    Object.assign(harness.session, { sourceCode: 'source-beta', vodId: 'beta-vod' });
    harness.api.setPlayback({
        title: 'Beta Patrol S01',
        episodes: playbackEpisodes(['E11', 'E12', 'E13'], { prefix: 'beta' }),
        index: 1,
    });
    await harness.api.load('beta-current');
    gate.resolve(jsonResponse({
        count: 1,
        comments: [{ p: '10,1,16777215,user', m: 'stale alpha' }],
        videoDuration: 1200,
    }));
    await oldLoad;

    assert.deepEqual(
        nonEmptyApplications(harness).map((items) => items[0]?.text),
        ['beta-e12 comment'],
    );
    assert.equal(harness.api.debug().lastDanmuMatchInfo.animeId, 'beta-s1');
});

test('14. source A E12 cannot write into source B E12 after source identity changes', async () => {
    const harness = createHarness();
    setStandardPlayback(harness, { sourceCode: 'source-a', vodId: 'vod-a' });

    const identitySnapshot = harness.api.beginRequest('identity-source-a');
    Object.assign(harness.session, { sourceCode: 'source-b', vodId: 'vod-b' });
    harness.api.setPlayback({
        title: 'Orbital Patrol S01',
        episodes: playbackEpisodes(['E11', 'E12', 'E13'], { prefix: 'source-b' }),
        index: 1,
    });
    assert.equal(harness.api.isCurrentRequest(identitySnapshot, 1), false);
    harness.api.cancelRequest('identity-check-complete');

    Object.assign(harness.session, { sourceCode: 'source-a', vodId: 'vod-a' });
    harness.api.setPlayback({
        title: 'Orbital Patrol S01',
        episodes: playbackEpisodes(['E11', 'E12', 'E13'], { prefix: 'source-a' }),
        index: 1,
    });
    const gate = delayFirstComment(harness);
    const oldLoad = harness.api.load('source-a-old');
    await until(() => commentRequests(harness).length === 1, 'Source A comment request did not start');

    Object.assign(harness.session, { sourceCode: 'source-b', vodId: 'vod-b' });
    harness.api.setPlayback({
        title: 'Orbital Patrol S01',
        episodes: playbackEpisodes(['E11', 'E12', 'E13'], { prefix: 'source-b' }),
        index: 1,
    });
    await harness.api.load('source-b-current');
    gate.resolve(jsonResponse({
        count: 1,
        comments: [{ p: '10,1,16777215,user', m: 'stale source A' }],
        videoDuration: 1200,
    }));
    await oldLoad;

    assert.deepEqual(
        nonEmptyApplications(harness).map((items) => items[0]?.text),
        ['dm-e12 comment'],
    );
    assert.equal(harness.api.createContext().media.mediaId.includes('playback-media:'), true);
});

test('15. a manual work selection supersedes an in-flight automatic request', async () => {
    const work = createWork();
    const harness = createHarness({ works: [work] });
    setStandardPlayback(harness);
    const gate = delayFirstComment(harness);
    const automaticLoad = harness.api.load('automatic-old');
    await until(() => commentRequests(harness).length === 1, 'Automatic comment request did not start');

    harness.api.injectManualCandidate(manualCandidate(work));
    await harness.api.switchManual(work.animeId);
    gate.resolve(jsonResponse({
        count: 1,
        comments: [{ p: '10,1,16777215,user', m: 'stale automatic' }],
        videoDuration: 1200,
    }));
    await automaticLoad;

    assert.equal(harness.api.sessionSource()?.selectedBy, 'manual');
    assert.equal(harness.api.debug().lastDanmuMatchInfo.selectedBy, 'manual');
    assert.deepEqual(
        nonEmptyApplications(harness).map((items) => items[0]?.text),
        ['dm-e12 comment'],
    );
});

test('16. disabling danmaku prevents an old request from rendering after it returns', async () => {
    const harness = createHarness();
    setStandardPlayback(harness);
    const gate = delayFirstComment(harness);
    const pendingLoad = harness.api.load('disable-old');
    await until(() => commentRequests(harness).length === 1, 'Comment request did not start');

    assert.equal(harness.api.toggleDanmaku(), false);
    gate.resolve(jsonResponse({
        count: 1,
        comments: [{ p: '10,1,16777215,user', m: 'must not render' }],
        videoDuration: 1200,
    }));
    await pendingLoad;

    assert.equal(nonEmptyApplications(harness).length, 0);
    assert.equal(harness.art.plugins.artplayerPluginDanmuku.option.visible, false);
});

test('17. destroying the player prevents an old request from touching ArtPlayer', async () => {
    const harness = createHarness();
    setStandardPlayback(harness);
    const gate = delayFirstComment(harness);
    const pendingLoad = harness.api.load('destroy-old');
    await until(() => commentRequests(harness).length === 1, 'Comment request did not start');

    harness.api.destroyPlayer();
    gate.resolve(jsonResponse({
        count: 1,
        comments: [{ p: '10,1,16777215,user', m: 'must not render' }],
        videoDuration: 1200,
    }));
    await pendingLoad;

    assert.equal(nonEmptyApplications(harness).length, 0);
    assert.equal(harness.context.window.LibertyPlayer.art, null);
    assert.deepEqual(harness.errors, []);
});

test('18. comments=[] preserves the correct binding and does not probe another candidate', async () => {
    const work = createWork({ comments: new Map([['dm-e12', []]]) });
    const harness = createHarness({ works: [work] });
    setStandardPlayback(harness);

    const result = await harness.api.getDanmuku();

    assert.equal(result.length, 0);
    assert.equal(harness.api.debug().lastDanmuMatchInfo.coreState, 'comments-empty');
    assert.equal(harness.api.debug().lastDanmuMatchInfo.episodeId, 'dm-e12');
    assert.equal(commentRequests(harness).length, 1);
});

for (const failure of [
    {
        number: 19,
        label: 'HTTP 429',
        state: 'rate-limited',
        response: () => jsonResponse({ error: 'rate limited' }, 429, { 'retry-after': '1' }),
    },
    {
        number: 20,
        label: 'network failure',
        state: 'network-error',
        response: () => { throw new Error('fixture network failure'); },
    },
    {
        number: 21,
        label: 'HTTP 500',
        state: 'server-error',
        response: () => jsonResponse({ error: 'server failure' }, 500),
    },
    {
        number: 22,
        label: 'invalid comment response',
        state: 'invalid-response',
        response: () => jsonResponse({ comments: 'not-an-array' }),
    },
]) {
    test(`${failure.number}. ${failure.label} remains a precise Core V2 state`, async () => {
        const harness = createHarness();
        setStandardPlayback(harness);
        harness.network.state.intercept = (call) => (
            call.path.includes('/api/v2/comment/') ? failure.response() : undefined
        );

        const result = await harness.api.getDanmuku();

        assert.equal(result.length, 0);
        assert.equal(harness.api.debug().lastDanmuMatchInfo.coreState, failure.state);
        assert.equal(commentRequests(harness).length, 1);
    });
}

test('23. Core uncertain issues no request and production has no legacy matcher fallback', async () => {
    const harness = createHarness();
    setStandardPlayback(harness, {
        title: 'Opaque Collection',
        year: '',
        episodes: [{
            rawIndex: 0,
            rawEpisodeName: '',
            displayEpisodeName: '第1集',
            name: '第1集',
            episodeNameSource: 'generated',
            url: 'https://media.example.test/opaque.m3u8',
        }],
        index: 0,
    });

    const result = await harness.api.getDanmuku();

    assert.equal(result.length, 0);
    assert.equal(harness.network.state.calls.length, 0);
    for (const legacyName of [
        'advancedCleanTitle',
        'guessEpisodeNumber',
        'buildDanmuMatchQueries',
        'pickValidDanmuApiMatch',
        'findBestEpisodeMatch',
        'matchDanmuByApi',
        'autoFallbackDanmakuBySearchCandidate',
        'loadDanmakuFromAnimeCandidate',
    ]) {
        assert.doesNotMatch(playerSource, new RegExp(`\\b${legacyName}\\b`, 'u'));
    }
});

test('24. manual episode confirmation is scoped to one canonical episode', async () => {
    const work = createWork({
        episodes: [
            { episodeId: 'duplicate-e12-a', episodeTitle: 'E12', episodeNumber: '1' },
            { episodeId: 'duplicate-e12-b', episodeTitle: '第12集', episodeNumber: '2' },
            { episodeId: 'dm-e13', episodeTitle: 'E13', episodeNumber: '3' },
        ],
    });
    const harness = createHarness({ works: [work] });
    setStandardPlayback(harness);
    harness.api.injectManualCandidate(manualCandidate(work));

    await harness.api.switchManual(work.animeId);
    assert.equal(commentRequests(harness).length, 0);
    assert.equal(harness.api.debug().lastDanmuMatchInfo.coreState, 'episode-uncertain');

    await harness.api.confirmManualEpisode(work.animeId, 'duplicate-e12-b');
    const manualSession = harness.api.sessionSource();
    assert.equal(harness.api.debug().lastDanmuMatchInfo.selectedBy, 'manual');
    assert.equal(harness.api.debug().lastDanmuMatchInfo.episodeId, 'duplicate-e12-b');
    assert.equal(Object.keys(manualSession.episodeChoices).length, 1);
    assert.equal(commentRequests(harness).at(-1).path.endsWith('/duplicate-e12-b'), true);

    harness.api.setPlayback({
        title: 'Orbital Patrol S01',
        episodes: playbackEpisodes(['E11', 'E12', 'E13']),
        index: 2,
        resetSession: false,
    });
    await harness.api.getDanmuku();
    assert.equal(harness.api.debug().lastDanmuMatchInfo.episodeId, 'dm-e13');
    assert.equal(Object.keys(harness.api.sessionSource().episodeChoices).length, 1);
});

test('25. a manual work choice is invalidated when canonical media identity changes', async () => {
    const orbital = createWork();
    const beta = createWork({
        title: 'Beta Patrol',
        animeId: 'beta-s1',
        animeTitle: 'Beta Patrol S01',
        episodes: regularEpisodes([11, 12, 13], 'beta-e'),
    });
    const harness = createHarness({ works: [orbital, beta] });
    setStandardPlayback(harness);
    harness.api.injectManualCandidate(manualCandidate(orbital));
    await harness.api.switchManual(orbital.animeId);
    assert.equal(harness.api.sessionSource()?.selectedBy, 'manual');

    Object.assign(harness.session, { vodId: 'beta-vod' });
    harness.api.setPlayback({
        title: 'Beta Patrol S01',
        episodes: playbackEpisodes(['E11', 'E12', 'E13'], { prefix: 'beta' }),
        index: 1,
        resetSession: false,
    });
    const result = await harness.api.getDanmuku();

    assert.equal(result[0]?.text, 'beta-e12 comment');
    assert.equal(harness.api.debug().lastDanmuMatchInfo.selectedBy, 'automatic');
    assert.equal(harness.api.sessionSource(), null);
});

test('26. source-provided 第01集 reaches Core identity and the production comment request', async () => {
    const episodeNumbers = Array.from({ length: 10 }, (_, index) => index + 1);
    const work = createWork({
        title: '非自然死亡',
        animeId: 'unnatural-2018',
        animeTitle: '非自然死亡',
        year: 2018,
        episodes: regularEpisodes(episodeNumbers, 'unnatural-e'),
    });
    const harness = createHarness({ works: [work] });
    setStandardPlayback(harness, {
        title: '非自然死亡',
        year: 2018,
        sourceCode: 'subo',
        sourceName: 'subo',
        vodId: '8199',
        episodes: playbackEpisodes([
            '第01集', '第02集', '第03集', '第04集', '第05集',
            '第06集', '第07集', '第08集', '第09集', '第10集完结',
        ], { prefix: 'unnatural' }),
        index: 0,
    });

    const context = harness.api.createContext();
    const result = await harness.api.getDanmuku();

    assert.equal(context.state, 'ready');
    assert.equal(context.sourceEpisode?.rawEpisodeName, '第01集');
    assert.equal(context.sourceEpisode?.parsedEpisodeInfo.episodeNumber, 1);
    assert.equal(context.episode?.episodeNumber, 1);
    assert.equal(result[0]?.text, 'unnatural-e1 comment');
    assert.match(commentRequests(harness)[0].path, /\/unnatural-e1$/u);
});

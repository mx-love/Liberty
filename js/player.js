function safeLocalStorageGet(key, fallback = '[]') {
    try {
        const storageUtils = window.LibertyUtils?.storage;
        if (storageUtils) {
            return storageUtils.readStorage(key, storageUtils.safeJsonParse(fallback, []));
        }
        return JSON.parse(localStorage.getItem(key) || fallback);
    } catch (e) {
        console.warn(`读取 localStorage[${key}] 失败:`, e);
        return JSON.parse(fallback);
    }
}
const selectedAPIs = safeLocalStorageGet('selectedAPIs');
const customAPIs = safeLocalStorageGet('customAPIs');

function getWatchRoomLaunchRole() {
    try {
        return sessionStorage.getItem('watchRoomId')
            ? (sessionStorage.getItem('watchRoomRole') || '')
            : '';
    } catch (error) {
        return '';
    }
}

function isWatchRoomLaunch() {
    return ['host', 'viewer'].includes(getWatchRoomLaunchRole());
}

function isWatchRoomViewerLaunch() {
    try {
        return Boolean(
            sessionStorage.getItem('watchRoomId') &&
            sessionStorage.getItem('watchRoomRole') === 'viewer'
        );
    } catch (error) {
        return false;
    }
}

// 配置常量
const MATCH_CONFIG = {
    minSimilarity: 0.5,
    titleCleanPatterns: [
        /\([^)]*\)/g,
        /（[^）]*）/g,
        /【[^】]*】/g,
        /\[[^\]]*\]/g,
        /\s*from\s+\w+/gi,
        /\s*-\s*\d+\s*$/,
        /^\d+\.\s*/,
        /\s{2,}/g,
    ],
    seasonPatterns: [
        /第([一二三四五六七八九十\d]+)季/,
        /Season\s*(\d+)/i,
        /S(\d+)/i,
        /\s(\d{4})\s/,
        /Season\s*([IVX]+)/i,
    ],
    episodePatterns: [
        /第\s*(\d+)\s*[集话話]/,
        /[Ee][Pp]\.?\s*(\d+)/,
        /#第(\d+)[话話]#/,
        /\[第(\d+)[集话話]\]/,
        /【第(\d+)[集话話]】/,
        /^\s*0*(\d+)\s*$/,
        /\b0*(\d+)\b/,
    ]
};

// 保留旧函数兼容性
function sanitizeTitle(title) {
    const result = advancedCleanTitle(title);
    return result.clean;
}

// 新的增强版标题清理
function advancedCleanTitle(title) {
    if (!title) return { clean: '', season: null, year: null, allYears: [], original: title, features: {}, variants: [] };

    let cleaned = title;
    let season = null;
    let year = null;
    let allYears = []; // 【新增】保存所有年份

    // 【新增】扩展的季度匹配模式
    const seasonPatterns = [
        /第([一二三四五六七八九十\d]+)季/,
        /Season\s*(\d+)/i,
        /S(\d+)(?:\s|$|E)/i,
        /\s(\d{4})\s/,
        /Season\s*([IVX]+)/i,
    ];

    // 提取季度信息
	for (const pattern of seasonPatterns) {
		const match = title.match(pattern);
		if (match) {
			const seasonNum = match[1];
			if (/^\d+$/.test(seasonNum)) {
				season = parseInt(seasonNum);
			} else if (/^[IVX]+$/.test(seasonNum)) {
				season = romanToInt(seasonNum);
			} else {
				const cnMap = {'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10};
				season = cnMap[seasonNum] || null;
			}
			break; 
		}
	}  

	if (!season) {
		const titleNumPattern = /^(.+?)(\d)(?:\s*[\(（]|$)/;
		const numMatch = title.match(titleNumPattern);

		if (numMatch) {
			const num = parseInt(numMatch[2]);
			const mainTitle = numMatch[1].trim();

			if (num >= 2 && num <= 9 && mainTitle.length >= 2) {
				season = num;
			}
		}
	}

    // 【修改】提取所有年份
    const yearMatches = title.match(/\b(19|20)\d{2}\b/g);
    if (yearMatches && yearMatches.length > 0) {
        allYears = yearMatches.map(y => parseInt(y));
        year = allYears[0]; // 第一个年份作为主要年份
    }

    // 【新增】保存原始特征
    const features = {
        hasParentheses: /[（\(]/.test(title),
        hasBrackets: /[【\[]/.test(title),
        hasEnglish: /[a-zA-Z]{3,}/.test(title),
        hasSpecialMarker: /(剧场版|OVA|OAD|SP|特别篇)/.test(title),
        isDrama: /(日剧|韩剧|美剧|电视剧)/.test(title),
        isVariety: /(综艺|晚会|真人秀|盛典)/.test(title),
        isMovie: /(电影|剧场版|Movie)/i.test(title), // 【新增】识别电影
    };

    // 清理标题（更温和的策略）
    cleaned = title
        .replace(/\s*[（(]完[）)]\s*/g, ' ')
        .replace(/\s*[（(].*?僅限.*?[）)]\s*/g, ' ')
        .replace(/\s+from\s+\w+/gi, ' ')
        .replace(/【.*?】/g, ' ')
        .replace(/\[.*?\]/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim()
        .toLowerCase();

    // 【新增】生成多个匹配候选
    const variants = [
        cleaned,
        cleaned.replace(/\s+/g, ''),
        cleaned.replace(/[^\w\u4e00-\u9fa5]/g, ''),
    ];

    return { 
        clean: cleaned, 
        season, 
        year,
        allYears, // 【新增】
        original: title,
        features,
        variants: [...new Set(variants)]
    };
}

// 罗马数字转换
function romanToInt(s) {
    const map = { I: 1, V: 5, X: 10, L: 50, C: 100 };
    let result = 0;
    for (let i = 0; i < s.length; i++) {
        if (i > 0 && map[s[i]] > map[s[i - 1]]) {
            result += map[s[i]] - 2 * map[s[i - 1]];
        } else {
            result += map[s[i]];
        }
    }
    return result;
}

// 统一的缓存清理函数
function cleanCacheByType(type, maxAge, maxCount = null) {
    const CACHE_CONFIGS = {
        'animeDetail': { prefix: 'anime_', storage: localStorage },
        'animeTitle': { prefix: 'title_', storage: localStorage },
        'danmuSource': { prefix: 'danmuSource_', storage: localStorage }
    };

    const config = CACHE_CONFIGS[type];
    if (!config) return;

    const now = Date.now();
    const items = [];

    try {
        // 先收集所有key，再统一删除，避免遍历中删除导致索引错乱
        const allKeys = [];
        for (let i = 0; i < config.storage.length; i++) {
            const key = config.storage.key(i);
            if (key?.startsWith(config.prefix)) {
                allKeys.push(key);
            }
        }

        for (const key of allKeys) {
            try {
                const data = JSON.parse(config.storage.getItem(key));
                if (data.timestamp) {
                    if (now - data.timestamp < maxAge) {
                        items.push({ key, timestamp: data.timestamp });
                    } else {
                        config.storage.removeItem(key);
                    }
                }
            } catch (e) {
                config.storage.removeItem(key);
            }
        }

        if (maxCount && items.length > maxCount) {
            items.sort((a, b) => a.timestamp - b.timestamp);
            const toDelete = items.slice(0, items.length - maxCount);
            toDelete.forEach(item => config.storage.removeItem(item.key));
        }

        console.log(`✅ 已清理 ${type} 缓存`);
    } catch (e) {
        console.warn(`清理 ${type} 缓存失败:`, e);
    }
}

// 网络请求重试机制
async function fetchWithRetry(url, options = {}, maxRetries = 3, timeout = 15000) {
    const baseDelay = 1000;

    for (let i = 0; i < maxRetries; i++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);

            const response = await fetch(url, {
                ...options,
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (response.ok) {
				return response;
			}

			// 4xx 客户端错误，不重试
			if (response.status >= 400 && response.status < 500) {
				throw new Error(`HTTP ${response.status}`);
			}

			if (i < maxRetries - 1) {
				const delay = baseDelay * Math.pow(2, i);
				console.warn(`⚠️ HTTP ${response.status}, ${delay}ms后重试...`);
				await new Promise(r => setTimeout(r, delay));
			}
        } catch (error) {
            const isTimeout = error.name === 'AbortError';
			console.debug(`${isTimeout ? '超时' : '网络错误'} (尝试 ${i + 1}/${maxRetries})`);

            if (i < maxRetries - 1) {
                const delay = baseDelay * Math.pow(2, i);
                await new Promise(r => setTimeout(r, delay));
            } else {
                throw error;
            }
        }
    }
    throw new Error('请求失败：超出重试次数');
}

// 错误上报函数
function reportError(category, message, details = {}) {
    const errorLog = {
        timestamp: Date.now(),
        category,
        message,
        details,
        userAgent: navigator.userAgent,
        url: window.location.href
    };

    console.error(`[${category}] ${message}`, details);
}

// 改进返回功能
function goBack(event) {
    // 防止默认链接行为
    if (event) event.preventDefault();

    // 1. 优先检查URL参数中的returnUrl
    const urlParams = new URLSearchParams(window.location.search);
    const returnUrl = urlParams.get('returnUrl');

    if (returnUrl) {
        // 如果URL中有returnUrl参数，优先使用
        window.location.href = decodeURIComponent(returnUrl);
        return;
    }

    // 2. 检查localStorage中保存的lastPageUrl
    const lastPageUrl = localStorage.getItem('lastPageUrl');
    if (lastPageUrl && lastPageUrl !== window.location.href) {
        window.location.href = lastPageUrl;
        return;
    }

    // 3. 检查是否是从搜索页面进入的播放器
    const referrer = document.referrer;

    // 检查 referrer 是否包含搜索参数
    if (referrer && (referrer.includes('/s=') || referrer.includes('?s='))) {
        // 如果是从搜索页面来的，返回到搜索页面
        window.location.href = referrer;
        return;
    }

    // 4. 如果是在iframe中打开的，尝试关闭iframe
    if (window.self !== window.top) {
        try {
            // 尝试调用父窗口的关闭播放器函数
            window.parent.closeVideoPlayer && window.parent.closeVideoPlayer();
            return;
        } catch (e) {
            console.error('调用父窗口closeVideoPlayer失败:', e);
        }
    }

    // 5. 无法确定上一页，则返回首页
    if (!referrer || referrer === '') {
        window.location.href = '/';
        return;
    }

    // 6. 以上都不满足，使用默认行为：返回上一页
    window.history.back();
}

// ===== 【增强】页面卸载时的完整清理 =====
function cleanupResources() {
    console.log('🧹 开始彻底清理资源...');

    // 🔥 修复：清理 saveHistoryTimer，防止切集后 5 秒写入错误集数记录
    if (typeof saveHistoryTimer !== 'undefined' && saveHistoryTimer) {
        clearTimeout(saveHistoryTimer);
        saveHistoryTimer = null;
    }

    // 使用 VideoPlayer 的统一销毁方法
    if (videoPlayer) {
        videoPlayer.destroy();
        videoPlayer = null;
    }

    // 清理旧的全局定时器（向后兼容）
    clearAllTimers();
    if (progressSaveInterval) {
        clearInterval(progressSaveInterval);
        progressSaveInterval = null;
    }
    if (restoreDanmuTimer) {
        clearTimeout(restoreDanmuTimer);
        restoreDanmuTimer = null;
    }

    // 清理全局变量
    art = null;
    if (window.LibertyPlayer) {
        window.LibertyPlayer.art = null;
    }
    currentHls = null;

    // 清理弹幕缓存
    currentDanmuCache = {
        episodeIndex: -1,
        danmuList: null,
        timestamp: 0
    };

    if (typeof tempDetailCache !== 'undefined') {
        tempDetailCache.clear();
    }

    currentDanmuAnimeId = null;
    currentDanmuSourceName = '';

    if (window.globalDanmuSyncTimer) {
        clearInterval(window.globalDanmuSyncTimer);
        window.globalDanmuSyncTimer = null;
    }

    console.log('✅ 资源清理完成');
}

// 页面卸载时清理
window.addEventListener('beforeunload', cleanupResources);
window.addEventListener('pagehide', cleanupResources);

// 页面卸载时同时移除 visibilitychange 监听器，防止残留
window.addEventListener('beforeunload', () => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
});

// ===== 【修改】页面可见性管理 - 后台继续播放 =====
let pageWasHidden = false;
let restoreDanmuTimer = null; // 🔥 新增：防止定时器冲突

function onVisibilityChange() {
    if (document.hidden) {
        pageWasHidden = true;
        console.debug('页面已隐藏');

        saveCurrentProgress();

        // ✅ 只隐藏弹幕，不清空数据
        if (art && art.plugins.artplayerPluginDanmuku) {
            const danmukuPlugin = art.plugins.artplayerPluginDanmuku;
            if (typeof danmukuPlugin.hide === 'function') {
                danmukuPlugin.hide();
            }
            // 🔥 不再 config({ danmuku: [] })，保留数据避免恢复时重新加载
        }

    } else if (pageWasHidden) {
        console.debug('页面恢复可见');

        // 🔥 立即重置标志，防止重复执行
        pageWasHidden = false;

        // 🔥 修复：更安全的幽灵视频检测
        const allVideos = document.querySelectorAll('video');
        if (allVideos.length > 1) {
            console.warn('⚠️ 检测到多个视频元素，开始安全清理...');

            // 找到 ArtPlayer 正在使用的视频元素
            const activeVideo = art?.video;

            if (!activeVideo) {
                console.warn('⚠️ 无法获取当前视频元素，跳过清理');
            } else {
                allVideos.forEach((video) => {
                    // 🔥 关键修复：检查 video 是否真的不同，且确实有父节点
                    if (video !== activeVideo && video.parentNode) {
                        try {
                            console.log('🧹 清理幽灵视频元素');
                            video.pause();
                            video.removeAttribute('src');
                            video.load();

                            // 🔥 延迟移除，避免同步移除导致问题
                            setTimeout(() => {
                                if (video.parentNode) {
                                    video.remove();
                                }
                            }, 100);
                        } catch (e) {
                            console.error('清理视频失败:', e);
                        }
                    }
                });
            }
        }

        // 🔥 恢复弹幕（使用缓存优先策略）
        if (videoPlayer) {
            videoPlayer.setTimer('restoreDanmu', () => {

            if (!art || !art.plugins.artplayerPluginDanmuku || !art.video) {
                return;
            }

            try {
                // 优先使用缓存的弹幕
                const cachedDanmu = currentDanmuCache.danmuList;
                const danmukuPlugin = art.plugins.artplayerPluginDanmuku;

                if (cachedDanmu && cachedDanmu.length > 0 && 
                    currentDanmuCache.episodeIndex === currentEpisodeIndex) {
                    // ✅ 使用缓存，不重新 config 避免闪烁，直接 show + seek
                    // 只有弹幕真的被隐藏了才需要 show，不需要重新 config/load
                    if (typeof danmukuPlugin.show === 'function') {
                        danmukuPlugin.show();
                    }

                    // 同步到当前播放位置（防止弹幕时间轴偏移）
                    if (typeof danmukuPlugin.seek === 'function') {
                        danmukuPlugin.seek(art.video.currentTime);
                    }

                    console.debug('弹幕已恢复');
                } else {
                    // 缓存失效，重新获取
                    getDanmukuForVideo(currentVideoTitle, currentEpisodeIndex)
                        .then(danmuku => {
                            if (danmuku && danmuku.length > 0) {
                                danmukuPlugin.config({ 
                                    danmuku: danmuku,
                                    synchronousPlayback: true 
                                });
                                danmukuPlugin.load();

                                if (typeof danmukuPlugin.seek === 'function') {
                                    danmukuPlugin.seek(art.video.currentTime);
                                }

                                if (typeof danmukuPlugin.show === 'function') {
                                    danmukuPlugin.show();
                                }

                                console.debug('弹幕已恢复（重新加载）');
                            }
                        })
                        .catch(err => {
                            console.warn('恢复弹幕失败:', err);
                        });
                }
            } catch (e) {
                console.error('恢复弹幕失败:', e);
            }
        }, 500); // setTimeout
        }
    }
}
document.addEventListener('visibilitychange', onVisibilityChange);

// 页面加载时保存当前URL到localStorage，作为返回目标
window.addEventListener('load', function () {
    // 保存前一页面URL
    if (document.referrer && document.referrer !== window.location.href) {
        localStorage.setItem('lastPageUrl', document.referrer);
    }

    // 提取当前URL中的重要参数，以便在需要时能够恢复当前页面
    const urlParams = new URLSearchParams(window.location.search);
    const videoId = urlParams.get('id');
    const sourceCode = urlParams.get('source');

    if (videoId && sourceCode) {
        // 保存当前播放状态，以便其他页面可以返回
        localStorage.setItem('currentPlayingId', videoId);
        localStorage.setItem('currentPlayingSource', sourceCode);
    }
});


// =================================
// ============== PLAYER ==========
// =================================
// 全局变量
let currentVideoTitle = '';
let currentEpisodeIndex = 0;
let art = null; // 用于 ArtPlayer 实例
let _longPressHandlers = null;
let currentHls = null; // 跟踪当前HLS实例
let currentEpisodes = [];
let episodesReversed = false;
let autoplayEnabled = true; // 默认开启自动连播
let videoHasEnded = false; // 跟踪视频是否已经自然结束
let shortcutHintTimeout = null; // 用于控制快捷键提示显示时间
let adFilteringEnabled = true; // 默认开启广告过滤
let progressSaveInterval = null; // 定期保存进度的计时器
let currentVideoUrl = ''; // 记录当前实际的视频URL
const isWebkit = (typeof window.webkitConvertPointFromNodeToPage === 'function')
Artplayer.FULLSCREEN_WEB_IN_BODY = true;
// ===== 【新增】移动端设备检测 =====
const isMobileDevice = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
const isIOSDevice = /iPhone|iPad|iPod/i.test(navigator.userAgent);
const isAndroidDevice = /Android/i.test(navigator.userAgent);
// ===== 【结束】移动端设备检测 =====

let playerViewportRefreshBound = false;
let playerViewportRefreshTimer = null;

function applyInlineVideoAttributes(video) {
    if (!video) return;

    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.setAttribute('x5-playsinline', '');
    video.setAttribute('x5-video-player-type', 'h5');
    video.playsInline = true;
}

function refreshPlayerViewport(reason = 'resize') {
    clearTimeout(playerViewportRefreshTimer);
    playerViewportRefreshTimer = setTimeout(() => {
        requestAnimationFrame(() => {
            try {
                applyInlineVideoAttributes(art?.video);
                if (art && typeof art.resize === 'function') {
                    art.resize();
                }
            } catch (error) {
                console.warn('播放器尺寸刷新失败:', reason, error);
            }
        });
    }, 120);
}

function bindPlayerViewportRefresh() {
    if (playerViewportRefreshBound) return;
    playerViewportRefreshBound = true;

    window.addEventListener('resize', () => refreshPlayerViewport('resize'));
    window.addEventListener('orientationchange', () => refreshPlayerViewport('orientationchange'));
    document.addEventListener('fullscreenchange', () => refreshPlayerViewport('fullscreenchange'));
    document.addEventListener('webkitfullscreenchange', () => refreshPlayerViewport('webkitfullscreenchange'));
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            refreshPlayerViewport('visibilitychange');
        }
    });
}

let saveProgressTimer = null; // 用于防抖保存进度

// ===== 【新增】统一的定时器管理 =====
const timers = {
    progressSave: null,
    shortcutHint: null,
    saveProgress: null,
    autoCleanup: null
};

function clearAllTimers() {
    Object.keys(timers).forEach(key => {
        if (timers[key]) {
            clearTimeout(timers[key]);
            clearInterval(timers[key]);
            timers[key] = null;
        }
    });
}
// ===== 【结束】统一的定时器管理 =====

// 弹幕配置
const DEFAULT_DANMU_CONFIG = {
    baseUrl: '/danmu',
    enabled: true,
    strictAutoLoad: true,
    maxDurationDiffRatio: 0.08,

    // 为空则使用 danmu_api 里的 PLATFORM_ORDER
    // 只想强制优先某平台时可填：qiyi / qq / youku / imgo / bilibili1 / dandan
    matchPlatformHint: '',

    cacheExpiration: {
        danmuCache: 20 * 60 * 1000,
        detailCache: 120 * 60 * 1000,
        sourceCache: 7 * 24 * 60 * 60 * 1000
    },
    tempDetailCacheTTL: 30 * 60 * 1000,

    adaptive: {
        enableMatchApi: true,
        enableDurationScale: true,
        offsetSeconds: 0,
        mobileMaxDanmu: 2500,
        desktopMaxDanmu: 4500,
        mobileMaxPerSecond: 1,
        desktopMaxPerSecond: 2,
        segmentDuration: 360,
        mobileMaxPerSegment: 420,
        desktopMaxPerSegment: 720,
        maxTextLength: 50,
        minTextLength: 2
    }
};

const DANMU_CONFIG = {
    ...DEFAULT_DANMU_CONFIG,
    ...(window.DANMU_CONFIG || {}),
    cacheExpiration: {
        ...DEFAULT_DANMU_CONFIG.cacheExpiration,
        ...((window.DANMU_CONFIG || {}).cacheExpiration || {})
    },
    adaptive: {
        ...DEFAULT_DANMU_CONFIG.adaptive,
        ...((window.DANMU_CONFIG || {}).adaptive || {})
    }
};

function getDanmuBaseUrl() {
    return (DANMU_CONFIG.baseUrl || '').replace(/\/+$/, '');
}

function isDanmuServiceEnabled() {
    return !!(DANMU_CONFIG.enabled && getDanmuBaseUrl());
}

async function addDanmuAuth(url) {
    try {
        const fullUrl = new URL(url, window.location.origin);

        if (fullUrl.pathname.startsWith('/danmu/')) {
            const passwordHash = window.__ENV__?.PASSWORD;

            if (!passwordHash || passwordHash.length !== 64) {
                console.warn('弹幕鉴权失败：window.__ENV__.PASSWORD 未正确注入');
                return fullUrl.toString();
            }

            fullUrl.searchParams.set('auth', passwordHash);
            fullUrl.searchParams.set('t', Date.now().toString());

            return fullUrl.toString();
        }

        if (
            fullUrl.origin === window.location.origin &&
            fullUrl.pathname.startsWith('/proxy/') &&
            window.ProxyAuth &&
            typeof window.ProxyAuth.addAuthToProxyUrl === 'function'
        ) {
            return await window.ProxyAuth.addAuthToProxyUrl(url);
        }

        return fullUrl.toString();
    } catch (e) {
        console.warn('添加弹幕鉴权失败:', e);
        return url;
    }
}

function getCurrentVideoDuration() {
    const duration = art?.video?.duration || art?.duration || 0;
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

function normalizeTitleForDanmuMatch(title) {
    return (title || '')
        .replace(/[【\[].*?[】\]]/g, '')
        .replace(/[（(](?:更新至|第?\d+集|完结|全集|高清|蓝光|国语|粤语).*?[）)]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function buildDanmuMatchFileName(title, episodeIndex) {
    const cleanTitle = normalizeTitleForDanmuMatch(title);
    const ep = String((episodeIndex || 0) + 1).padStart(2, '0');

    let fileName = currentEpisodes && currentEpisodes.length > 1
        ? `${cleanTitle}.S01E${ep}`
        : cleanTitle;

    if (DANMU_CONFIG.matchPlatformHint) {
        fileName += ` @${DANMU_CONFIG.matchPlatformHint}`;
    }

    return fileName;
}

function normalizeDanmuTitle(title) {
    return (title || '')
        .replace(/\s+/g, ' ')
        .replace(/[（(]\d{4}[）)]/g, '')
        .replace(/第[一二三四五六七八九十百\d]+季/g, '')
        .replace(/S\d{1,2}/gi, '')
        .replace(/(高清|蓝光|1080P|720P|4K|HD|BD|正片|全集|完结)/gi, '')
        .trim();
}

function getCurrentEpisodeName(index) {
    const raw = Array.isArray(currentEpisodes) ? currentEpisodes[index] : '';
    if (!raw) return '';
    if (typeof raw === 'object') return raw.name || '';
    const text = String(raw);
    if (text.includes('$')) return text.split('$')[0];
    return text;
}

function getPlayerEpisodeUrlValue(episode) {
    const helper = window.LibertyUtils?.media?.getEpisodeUrl;
    if (helper) return helper(episode);
    if (!episode) return '';
    if (typeof episode === 'string') return episode;
    return episode.url || '';
}

function guessEpisodeNumber(index, episodeName) {
    const name = episodeName || '';
    const patterns = [
        /第\s*(\d+)\s*集/,
        /E\s*(\d+)/i,
        /EP\s*(\d+)/i,
        /(?:^|[^\d])(\d{1,4})(?:$|[^\d])/,
    ];

    for (const pattern of patterns) {
        const match = name.match(pattern);
        if (match) return parseInt(match[1], 10);
    }

    return Number.isInteger(index) ? index + 1 : null;
}

function guessSeasonNumber(title) {
    const text = title || '';
    const sMatch = text.match(/S(\d{1,2})/i);
    if (sMatch) return parseInt(sMatch[1], 10);

    const zhMap = {
        一: 1,
        二: 2,
        三: 3,
        四: 4,
        五: 5,
        六: 6,
        七: 7,
        八: 8,
        九: 9,
        十: 10,
    };

    const zhMatch = text.match(/第([一二三四五六七八九十\d]+)季/);
    if (zhMatch) {
        const raw = zhMatch[1];
        return /^\d+$/.test(raw) ? parseInt(raw, 10) : zhMap[raw] || null;
    }

    const info = advancedCleanTitle(text);
    return info.season || null;
}

function inferDanmuPlatform(playUrl, apiSourceCode) {
    const url = playUrl || '';

    if (/qq\.com|v\.qq\.com/.test(url)) return 'qq';
    if (/iqiyi\.com/.test(url)) return 'qiyi';
    if (/youku\.com/.test(url)) return 'youku';
    if (/mgtv\.com/.test(url)) return 'imgo';
    if (/bilibili\.com/.test(url)) return 'bilibili1';
    if (/miguvideo\.com/.test(url)) return 'migu';
    if (/sohu\.com/.test(url)) return 'sohu';
    if (/le\.com/.test(url)) return 'leshi';

    const sourcePlatformMap = {
        tencent: 'qq',
        youku: 'youku',
        iqiyi: 'qiyi',
        imgo: 'imgo',
        bilibili: 'bilibili1',
    };

    return sourcePlatformMap[apiSourceCode] || '';
}

function buildDanmuKeyword({ title, year, season, episode, platform }) {
    const cleanTitle = normalizeDanmuTitle(title);
    const parts = [cleanTitle];

    if (season) parts.push(`S${String(season).padStart(2, '0')}`);
    if (episode) parts.push(`E${String(episode).padStart(2, '0')}`);
    if (year) parts.push(String(year));
    if (platform) parts.push(`@${platform}`);

    return parts.filter(Boolean).join(' ');
}

function buildDanmuVideoKey(title, year, season, episode) {
    return [
        normalizeDanmuTitle(title),
        year || '',
        season ? `S${season}` : '',
        episode ? `E${episode}` : '',
    ].join('|');
}

function saveDanmuManualMapping(videoKey, mapping) {
    try {
        const store = JSON.parse(localStorage.getItem('danmuManualMap') || '{}');
        store[videoKey] = {
            ...mapping,
            savedAt: Date.now(),
        };
        localStorage.setItem('danmuManualMap', JSON.stringify(store));
    } catch (e) {
        console.warn('保存弹幕手动映射失败:', e);
    }
}

function getDanmuManualMapping(videoKey) {
    try {
        const store = JSON.parse(localStorage.getItem('danmuManualMap') || '{}');
        return store[videoKey] || null;
    } catch (e) {
        console.warn('读取弹幕手动映射失败:', e);
        return null;
    }
}

function getDanmuPlaybackContext(title, episodeIndex) {
    const params = new URLSearchParams(window.location.search);
    const year =
        params.get('year') ||
        localStorage.getItem('currentVideoYear') ||
        advancedCleanTitle(title).year ||
        '';
    const sourceCode =
        params.get('source') ||
        params.get('source_code') ||
        localStorage.getItem('currentSourceCode') ||
        localStorage.getItem('currentPlayingSource') ||
        '';
    const episodeName = getCurrentEpisodeName(episodeIndex);
    const season = guessSeasonNumber(title);
    const episode = guessEpisodeNumber(episodeIndex, episodeName);
    const platform = inferDanmuPlatform(currentVideoUrl, sourceCode);
    const duration = getCurrentVideoDuration();

    return {
        title,
        year,
        season,
        episode,
        episodeName,
        playUrl: currentVideoUrl,
        sourceCode,
        platform,
        duration,
        videoKey: buildDanmuVideoKey(title, year, season, episode),
    };
}

function normalizeDanmuTitleNumberText(value) {
    return String(value || '')
        .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
        .replace(/[①②③④⑤⑥⑦⑧⑨⑩]/g, ch => {
            const map = {
                '①': '1', '②': '2', '③': '3', '④': '4', '⑤': '5',
                '⑥': '6', '⑦': '7', '⑧': '8', '⑨': '9', '⑩': '10'
            };
            return map[ch] || ch;
        })
        .trim();
}

function chineseEpisodeNumberToInt(raw) {
    const s = String(raw || '').trim();

    if (/^\d+$/.test(s)) {
        return parseInt(s, 10);
    }

    const map = {
        '零': 0, '〇': 0,
        '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5,
        '六': 6, '七': 7, '八': 8, '九': 9
    };

    if (s === '十') return 10;

    const tenMatch = s.match(/^([一二两三四五六七八九])?十([一二两三四五六七八九])?$/);
    if (tenMatch) {
        const tens = tenMatch[1] ? map[tenMatch[1]] : 1;
        const ones = tenMatch[2] ? map[tenMatch[2]] : 0;
        return tens * 10 + ones;
    }

    if (s.length === 1 && map[s] !== undefined) {
        return map[s];
    }

    return null;
}

function isBadEpisodeNumber(n) {
    if (!Number.isFinite(n)) return true;
    if (n <= 0 || n > 999) return true;

    // 避免把年份当集数
    if (n >= 1900 && n <= 2099) return true;

    return false;
}

function extractEpisodeNumberFromDanmuTitle(title) {
    const s = normalizeDanmuTitleNumberText(title);

    const patterns = [
        // S01E02 / s1e2
        /[Ss]\d{1,2}[Ee]\s*0*(\d{1,4})/,

        // 第2集 / 第2话 / 第2期 / 第十二集
        /第\s*([一二两三四五六七八九十\d]+)\s*[集话話期回]/,

        // EP02 / E02
        /(?:^|[\s._-])[Ee][Pp]?\.?\s*0*(\d{1,4})(?=$|[\s._-])/,

        // #第2话# / #2
        /[#＃]\s*第?\s*([一二两三四五六七八九十\d]+)\s*[集话話期回]?/,

        // 综艺常见：xxx（下）4 / xxx(上)3
        /[（(](?:上|中|下|前篇|后篇|後篇|part\s*\d+|第[上下中]部分)[）)]\s*0*(\d{1,4})\s*$/i,

        // 标题末尾数字：哥伦比亚亚马逊河（下）4
        /(?:^|[^\d])0*(\d{1,4})\s*(?:集|话|話|期|回)?\s*$/
    ];

    for (const pattern of patterns) {
        const match = s.match(pattern);
        if (!match) continue;

        const n = chineseEpisodeNumberToInt(match[1]);
        if (!isBadEpisodeNumber(n)) {
            return n;
        }
    }

    return null;
}

function pickValidDanmuApiMatch(matches, episodeIndex, options = {}) {
    const targetNumber = episodeIndex + 1;
    const list = Array.isArray(matches)
        ? matches.filter(m => m && m.episodeId)
        : [];

    if (list.length === 0) return null;

    const analyzed = list.map(m => ({
        match: m,
        episodeNumber: extractEpisodeNumberFromDanmuTitle(m.episodeTitle),
        title: m.episodeTitle || ''
    }));

    const exact = analyzed.find(item => item.episodeNumber === targetNumber);
    if (exact) {
        return exact.match;
    }

    const hasExplicitEpisodeNumber = analyzed.some(item => item.episodeNumber !== null);

    if (hasExplicitEpisodeNumber) {
        console.warn(
            `⚠️ match 接口返回的集数与当前播放集不一致：当前第${targetNumber}集，拒绝错配结果`,
            analyzed.map(item => ({
                title: item.title,
                parsedEpisode: item.episodeNumber,
                episodeId: item.match.episodeId
            }))
        );
        return null;
    }

    if (options.strict && currentEpisodes.length > 1) {
        console.warn('⚠️ match 候选没有明确集数，严格模式下拒绝自动加载，等待手动选择');
        return null;
    }

    // 所有候选都解析不出集数时，才相信 match 接口的第一个结果
    console.warn(`⚠️ match 候选没有明确集数，暂按接口结果使用：`, list[0]);
    return list[0];
}

async function matchDanmuByApi(title, episodeIndex) {
    if (!DANMU_CONFIG.adaptive?.enableMatchApi || !isDanmuServiceEnabled()) return null;

    const context = getDanmuPlaybackContext(title, episodeIndex);
    const fileName = buildDanmuKeyword(context);
    const matchUrl = await addDanmuAuth(`${getDanmuBaseUrl()}/api/v2/match`);

    try {
        console.log(`🎯 使用 danmu_api match 自动匹配: ${fileName}`);

        const response = await fetchWithRetry(matchUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                fileName,
                title: normalizeDanmuTitle(title),
                year: context.year || undefined,
                season: context.season || undefined,
                episode: context.episode || undefined,
                episodeTitle: context.episodeName || undefined,
                sourceCode: context.sourceCode || undefined,
                platform: context.platform || undefined,
                url: context.playUrl || undefined,
                duration: context.duration || undefined
            })
        }, 2, 15000);

        const data = await response.json();
		const match = pickValidDanmuApiMatch(data?.matches, episodeIndex, {
            strict: DANMU_CONFIG.strictAutoLoad !== false
        });
		
		if (data?.isMatched && match?.episodeId) {
            currentDanmuAnimeId = match.animeId || null;
            currentDanmuSourceName = match.animeTitle || '';

            console.log('✅ match 自动匹配成功:', {
                animeTitle: match.animeTitle,
                episodeTitle: match.episodeTitle,
                episodeId: match.episodeId
            });

            return match;
        }

        console.warn('⚠️ match 未匹配到结果，准备降级旧搜索逻辑');
        return null;
    } catch (e) {
        console.warn('⚠️ match 接口失败，准备降级旧搜索逻辑:', e.message);
        return null;
    }
}

// 弹幕缓存 - 只缓存当前集
let currentDanmuCache = {
    episodeIndex: -1,
    danmuList: null,
    timestamp: 0
};

// ✅ 恢复弹幕源追踪
let currentDanmuAnimeId = null;
let currentDanmuSourceName = '';

// ✅ 弹幕显示配置（跨集持久化，不随切集重置）
let danmuDisplayConfig = {
    speed: 5,
    opacity: 1,
    fontSize: null, // null = 使用默认值
    color: '#FFFFFF',
    mode: 0,
};

// 从 localStorage 恢复弹幕配置
(function restoreDanmuConfig() {
    try {
        const saved = localStorage.getItem('danmuDisplayConfig');
        if (saved) {
            const parsed = JSON.parse(saved);
            danmuDisplayConfig = { ...danmuDisplayConfig, ...parsed };
        }
    } catch (e) {}
})();

// 保存弹幕配置到 localStorage
function saveDanmuConfig(config) {
    try {
        const hasChange = Object.keys(config).some(
            key => danmuDisplayConfig[key] !== config[key]
        );
        danmuDisplayConfig = { ...danmuDisplayConfig, ...config };
        localStorage.setItem('danmuDisplayConfig', JSON.stringify(danmuDisplayConfig));
    } catch (e) {}
}

// ✅ 新增：临时详情缓存（Map自动管理大小）
const tempDetailCache = new Map();

// 简单的字符串哈希函数，用于生成短标识
function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
}

// ===== 获取弹幕数据 =====
// ✅ 智能匹配最佳动漫结果（重新设计评分系统）
function findBestAnimeMatch(animes, targetTitle, currentEpisodeCount = 0) {
    if (!animes || animes.length === 0) return null;

    const targetInfo = advancedCleanTitle(targetTitle);

    // 短标题判断：只有纯中文且长度≤2才算短标题，避免误判"进击的巨人"等
    const isShortTitle = /^[\u4e00-\u9fa5]{1,2}$/.test(targetInfo.clean);

    // 【新增】提取核心标题（去掉季度、年份等修饰）
    const extractCoreTitle = (cleanedTitle) => {
        return cleanedTitle
            .replace(/第[一二三四五六七八九十\d]+季/g, '')
            .replace(/Season\s*\d+/gi, '')
            .replace(/[SＳ]\d+/gi, '')
            .replace(/\d+$/g, '')  // 去掉末尾数字
            .replace(/[（(]\d{4}[）)]/g, '') // 去掉年份
            .replace(/\s+/g, ' ')
            .trim();
    };

    const targetCore = extractCoreTitle(targetInfo.clean);

    // 预过滤（短标题时排除综艺等）
    let filteredAnimes = animes;
    if (isShortTitle) {
        console.log('⚠️ 检测到短标题，启用严格匹配模式');

        filteredAnimes = animes.filter(anime => {
            const animeTitle = (anime.animeTitle || '').toLowerCase();
            const typeDesc = (anime.typeDescription || '').toLowerCase();

            const excludeKeywords = [
                '春晚', '晚会', '盛典', '颁奖', '演唱会', '音乐会',
                '综艺', '访谈', '真人秀', '乒乓球', '体育',
                '新闻', '纪录片', '直播', '发布会'
            ];

            const shouldExclude = excludeKeywords.some(keyword => 
                animeTitle.includes(keyword) || typeDesc.includes(keyword)
            );

            if (shouldExclude) {
                console.log(`❌ 过滤掉: ${anime.animeTitle} (包含排除关键词)`);
                return false;
            }

            return true;
        });

        console.log(`📊 过滤后剩余 ${filteredAnimes.length}/${animes.length} 个候选`);

        if (filteredAnimes.length === 0) {
            console.warn('⚠️ 过滤后无剩余结果，使用原始列表');
            filteredAnimes = animes;
        }
    }

    // 评分计算
    const scored = filteredAnimes.map(anime => {
        const animeInfo = advancedCleanTitle(anime.animeTitle);
        const animeCore = extractCoreTitle(animeInfo.clean);

        let score = 0;
        let breakdown = {}; // 用于调试的评分明细

        // ============================================
        // 🎯 核心标题匹配 (0-100分)
        // ============================================
        const coreSimilarity = enhancedSimilarity(
            targetCore, 
            animeCore,
            { variants: [targetCore] },
            { variants: [animeCore] }
        );

        if (targetCore === animeCore) {
            breakdown.coreMatch = 100;
            score += 100;
        } else if (coreSimilarity > 0.8) {
            breakdown.coreMatch = 80;
            score += 80;
        } else if (coreSimilarity > 0.6) {
            breakdown.coreMatch = 60;
            score += 60;
        } else {
            breakdown.coreMatch = Math.round(coreSimilarity * 50);
            score += breakdown.coreMatch;
        }

        // ============================================
        // 📝 完整标题相似度 (0-50分)
        // ============================================
        const fullSimilarity = enhancedSimilarity(
            targetInfo.clean, 
            animeInfo.clean,
            targetInfo,
            animeInfo
        );

        breakdown.fullSimilarity = Math.round(fullSimilarity * 50);
        score += breakdown.fullSimilarity;

        // ============================================
        // 📺 类型与集数匹配 (0-80分)
        // ============================================
        const isMovieCandidate = anime.episodeCount === 1 || 
                                 /电影|剧场版|Movie/i.test(anime.typeDescription || '');
        const isSeriesCandidate = anime.episodeCount > 1 || 
                                  /TV|连载|番剧|电视剧/i.test(anime.typeDescription || '');

        if (currentEpisodeCount > 0) {
            if (currentEpisodeCount === 1) {
                // 用户在看第1集
                if (isMovieCandidate) {
                    breakdown.typeMatch = 60; // 电影优先
                    score += 60;
                } else if (isSeriesCandidate) {
                    breakdown.typeMatch = 40; // 连续剧第1集也可能
                    score += 40;
                }
            } else {
                // 用户在看第2集及以上
                if (isSeriesCandidate) {
                    breakdown.typeMatch = 80; // 连续剧强匹配
                    score += 80;
                } else if (isMovieCandidate) {
                    breakdown.typeMatch = -50; // 电影不可能有多集
                    score -= 50;
                }
            }
        } else {
            // 无集数信息时，不加分也不减分
            breakdown.typeMatch = 0;
        }

        // ============================================
        // 🎬 季度匹配 (0-60分)
        // ============================================
        if (targetInfo.season && animeInfo.season) {
            // 双方都有季度
            if (targetInfo.season === animeInfo.season) {
                breakdown.seasonMatch = 50;
                score += 50;
            } else if (Math.abs(targetInfo.season - animeInfo.season) === 1) {
                breakdown.seasonMatch = 15; // 相邻季度
                score += 15;
            } else {
                breakdown.seasonMatch = -20; // 不同季度
                score -= 20;
            }
        } else if (!targetInfo.season && animeInfo.season) {
            // 目标无季度，但候选有季度
            if (targetCore === animeCore) {
                // 核心标题匹配，优先第一季
                if (animeInfo.season === 1) {
                    breakdown.seasonMatch = 40;
                    score += 40;
                } else if (animeInfo.season === 2) {
                    breakdown.seasonMatch = 20;
                    score += 20;
                } else {
                    breakdown.seasonMatch = 5;
                    score += 5;
                }
            } else {
                breakdown.seasonMatch = 0;
            }
        } else if (targetInfo.season && !animeInfo.season) {
            // 目标有季度，候选没有
            breakdown.seasonMatch = -10;
            score -= 10;
        } else {
            // 双方都没有季度
            breakdown.seasonMatch = 10;
            score += 10;
        }

        // ============================================
        // 📅 年份匹配 (0-30分)
        // ============================================
        if (targetInfo.year && animeInfo.year) {
            const yearDiff = Math.abs(targetInfo.year - animeInfo.year);
            if (yearDiff === 0) {
                breakdown.yearMatch = 30;
                score += 30;
            } else if (yearDiff <= 1) {
                breakdown.yearMatch = 20;
                score += 20;
            } else if (yearDiff <= 2) {
                breakdown.yearMatch = 10;
                score += 10;
            } else if (yearDiff <= 5) {
                breakdown.yearMatch = 5;
                score += 5;
            } else {
                breakdown.yearMatch = -5;
                score -= 5;
            }
        } else if (!targetInfo.year && animeInfo.year) {
            // 无年份时，优先较新的内容
            const currentYear = new Date().getFullYear();
            const age = currentYear - animeInfo.year;

            if (currentEpisodeCount === 1 && isMovieCandidate) {
                // 电影优先新的
                if (age <= 3) {
                    breakdown.yearMatch = 15;
                    score += 15;
                } else if (age <= 7) {
                    breakdown.yearMatch = 10;
                    score += 10;
                } else {
                    breakdown.yearMatch = 5;
                    score += 5;
                }
            } else {
                // 连续剧年份次要
                breakdown.yearMatch = 5;
                score += 5;
            }
        } else {
            breakdown.yearMatch = 0;
        }

        // ============================================
        // 🎞️ 集数合理性 (0-40分)
        // ============================================
        if (currentEpisodeCount > 0 && anime.episodeCount) {
            const epDiff = Math.abs(anime.episodeCount - currentEpisodeCount);
            if (epDiff === 0) {
                breakdown.episodeMatch = 40;
                score += 40;
            } else if (epDiff <= 3) {
                breakdown.episodeMatch = 30;
                score += 30;
            } else if (anime.episodeCount >= currentEpisodeCount) {
                breakdown.episodeMatch = 20;
                score += 20;
            } else {
                breakdown.episodeMatch = -10; // 集数不足
                score -= 10;
            }
        } else {
            breakdown.episodeMatch = 0;
        }

        // ============================================
        // 📌 特殊标记匹配 (0-20分)
        // ============================================
        if (targetInfo.features && animeInfo.features) {
            if (targetInfo.features.hasSpecialMarker && animeInfo.features.hasSpecialMarker) {
                breakdown.specialMarker = 20;
                score += 20;
            }

            // 剧集类型冲突检测
            if (targetInfo.features.isDrama && animeInfo.features.isVariety) {
                breakdown.typeConflict = -80;
                score -= 80;
            }
            if (targetInfo.features.isVariety && animeInfo.features.isDrama) {
                breakdown.typeConflict = -80;
                score -= 80;
            }
        }

        // ============================================
        // 📏 标题长度惩罚 (0 to -30分)
        // ============================================
        const lenDiff = Math.abs(animeInfo.clean.length - targetInfo.clean.length);
        if (isShortTitle && lenDiff > 5) {
            breakdown.lengthPenalty = -Math.min(30, lenDiff * 3);
            score += breakdown.lengthPenalty;
        } else if (lenDiff > 15) {
            breakdown.lengthPenalty = -Math.min(20, Math.floor(lenDiff / 2));
            score += breakdown.lengthPenalty;
        } else {
            breakdown.lengthPenalty = 0;
        }

        return {
            anime,
            score,
            similarity: fullSimilarity,
            coreSimilarity,
            coreTitle: animeCore,
            breakdown,
            debug: {
                targetCore,
                animeCore,
                targetClean: targetInfo.clean,
                animeClean: animeInfo.clean,
                isShortTitle
            }
        };
    });

    scored.sort((a, b) => b.score - a.score);

    // 详细日志
    console.log('🎯 弹幕匹配评分 (前5):', scored.slice(0, 5).map(s => ({
        title: s.anime.animeTitle,
        总分: s.score,
        明细: s.breakdown,
        核心标题: s.coreTitle,
        核心相似度: s.coreSimilarity.toFixed(3),
        完整相似度: s.similarity.toFixed(3),
        集数: s.anime.episodeCount
    })));

    // 匹配阈值判断
    const topMatch = scored[0];
    const minScore = isShortTitle ? 120 : 80; // 降低阈值

    if (topMatch.score < minScore) {
        console.error(`❌ 最高分过低: ${topMatch.score} (要求: ${minScore})`);
        return null;
    }

    // 【新增】检测歧义情况 - 优先处理无季度的情况
	if (!targetInfo.season && scored.length > 1) {
		console.log('🎯 目标无季度，优先查找第一季或无季度版本');

		const maxScore = scored[0].score;
		// 只在高质量候选（最高分70%以上）中查找，避免误选低分条目
		const candidates = scored.slice(0, 5).filter(s => s.score >= maxScore * 0.7);

		// 优先查找第一季
		let firstSeasonMatch = candidates.find(s => {
			const animeInfo = advancedCleanTitle(s.anime.animeTitle);
			return animeInfo.season === 1;
		});

		// 如果没有第一季，才找无季度标识的
		if (!firstSeasonMatch) {
			firstSeasonMatch = candidates.find(s => {
				const animeInfo = advancedCleanTitle(s.anime.animeTitle);
				return !animeInfo.season;
			});
		}

		if (firstSeasonMatch) {
			const animeInfo = advancedCleanTitle(firstSeasonMatch.anime.animeTitle);
			console.log(`✅ 自动选择: ${firstSeasonMatch.anime.animeTitle} (季度: ${animeInfo.season || '无'})`);
			return firstSeasonMatch.anime;
		}
	}

	// 处理分数接近的歧义情况
	if (scored.length > 1) {
		const scoreDiff = scored[0].score - scored[1].score;
		if (scoreDiff < 20) {
			console.warn('⚠️ 前两名分数接近，可能存在歧义:', {
				first: scored[0].anime.animeTitle,
				second: scored[1].anime.animeTitle,
				diff: scoreDiff
			});

			// 根据集数自动选择
			if (currentEpisodeCount === 1) {
				const movieMatch = scored.slice(0, 3).find(s => 
					s.anime.episodeCount === 1 || /电影|剧场版/.test(s.anime.typeDescription || '')
				);
				if (movieMatch) {
					console.log('🎬 根据集数判断，自动选择电影版');
					return movieMatch.anime;
				}
			} else if (currentEpisodeCount > 1) {
				const seriesMatch = scored.slice(0, 3).find(s => s.anime.episodeCount > 1);
				if (seriesMatch) {
					console.log('📺 根据集数判断，自动选择连续剧版');
					return seriesMatch.anime;
				}
			}
		}
	}

	// ✅ 【关键】返回最高分匹配结果
	return topMatch.anime;
}

// ✅ 【新增】计算字符串相似度
function calculateSimilarity(str1, str2) {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) return 1.0;

    const editDistance = levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
}

// 增强版相似度计算
function enhancedSimilarity(str1, str2, info1 = {}, info2 = {}) {
    const s1 = str1.toLowerCase();
    const s2 = str2.toLowerCase();

    if (s1 === s2) return 1.0;

    // 【新增】尝试所有变体的匹配
    let maxSimilarity = 0;
    const variants1 = info1.variants || [s1];
    const variants2 = info2.variants || [s2];

    for (const v1 of variants1) {
        for (const v2 of variants2) {
            if (!v1 || !v2) continue;

            // Jaccard 相似度
            const tokens1 = new Set(v1.split(/\s+/).filter(t => t.length > 0));
            const tokens2 = new Set(v2.split(/\s+/).filter(t => t.length > 0));
            const intersection = new Set([...tokens1].filter(x => tokens2.has(x)));
            const union = new Set([...tokens1, ...tokens2]);
            const jaccardScore = union.size > 0 ? intersection.size / union.size : 0;

            // Levenshtein 相似度
            const levDistance = levenshteinDistance(v1, v2);
            const maxLen = Math.max(v1.length, v2.length);
            const levScore = maxLen > 0 ? (maxLen - levDistance) / maxLen : 0;

            // 最长公共子序列
            const lcsLen = longestCommonSubsequence(v1, v2);
            const lcsScore = lcsLen / Math.max(v1.length, v2.length);

            // 【新增】最长公共子串（连续）
            const lcsSubstring = longestCommonSubstring(v1, v2);
            const substringScore = lcsSubstring / Math.max(v1.length, v2.length);

            // 综合评分（调整权重）
            const similarity = jaccardScore * 0.25 + levScore * 0.3 + lcsScore * 0.25 + substringScore * 0.2;
            maxSimilarity = Math.max(maxSimilarity, similarity);
        }
    }

    return maxSimilarity;
}

// 最长公共子序列
function longestCommonSubsequence(str1, str2) {
    const m = str1.length;
    const n = str2.length;
    const dp = Array(m + 1).fill(0).map(() => Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (str1[i - 1] === str2[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }

    return dp[m][n];
}

// ✅ 【新增】编辑距离算法
function levenshteinDistance(str1, str2) {
    const matrix = [];

    for (let i = 0; i <= str2.length; i++) {
        matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
        for (let j = 1; j <= str1.length; j++) {
            if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }

    return matrix[str2.length][str1.length];
}

// 【新增】最长公共子串
function longestCommonSubstring(str1, str2) {
    const m = str1.length;
    const n = str2.length;
    let maxLen = 0;
    const dp = Array(m + 1).fill(0).map(() => Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (str1[i - 1] === str2[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
                maxLen = Math.max(maxLen, dp[i][j]);
            }
        }
    }

    return maxLen;
}

// ✅ 【新增】判断是否电影内容
function isMovieContent(animeInfo) {
    if (!animeInfo) return false;

    return (
        animeInfo.type?.includes('电影') ||
        animeInfo.typeDescription?.includes('电影') ||
        animeInfo.typeDescription?.includes('剧场版') ||
        animeInfo.animeTitle?.includes('剧场版') ||
        animeInfo.episodeCount === 1
    );
}

// 搜索 animeId（3次重试，无缓存）
async function findOrSearchAnimeId(cleanTitle) {
    // 🔥 3次重试机制，逐步放宽搜索条件
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            let searchTitle = cleanTitle;

            // 第2次：简化标题
            if (attempt === 2) {
                searchTitle = cleanTitle
                    .replace(/[（(].*?[）)]/g, '')
                    .replace(/【.*?】/g, '')
                    .replace(/\[.*?\]/g, '')
                    .trim();
                console.log(`🔍 第2次尝试简化标题: ${searchTitle}`);
            }

            // 第3次：只保留核心词
            if (attempt === 3) {
                searchTitle = cleanTitle
                    .replace(/[（(].*?[）)]/g, '')
                    .replace(/【.*?】/g, '')
                    .replace(/\[.*?\]/g, '')
                    .replace(/第[一二三四五六七八九十\d]+季/g, '')
                    .replace(/Season\s*\d+/gi, '')
                    .replace(/\d{4}/g, '')
                    .trim();
                console.log(`🔍 第3次尝试核心标题: ${searchTitle}`);
            }

            const searchUrl = `${getDanmuBaseUrl()}/api/v2/search/anime?keyword=${encodeURIComponent(searchTitle)}`;
            console.log(`🔍 弹幕搜索尝试 ${attempt}/3`);

            const authedSearchUrl = await addDanmuAuth(searchUrl);
			const response = await fetchWithRetry(authedSearchUrl, {}, 3, 12000);
            const data = await response.json();

            if (!data.animes || data.animes.length === 0) {
                console.warn(`⚠️ 第${attempt}次搜索未找到结果`);
                if (attempt < 3) {
                    await new Promise(r => setTimeout(r, 2000));
                    continue;
                }
                return null;
            }

            const bestMatch = findBestAnimeMatch(data.animes, cleanTitle, currentEpisodes.length);
            if (!bestMatch) {
                console.warn(`⚠️ 第${attempt}次未找到最佳匹配`);
                if (attempt < 3) {
                    await new Promise(r => setTimeout(r, 2000));
                    continue;
                }
                return null;
            }

            console.log(`✅ 第${attempt}次搜索成功: ${bestMatch.animeTitle} (ID: ${bestMatch.animeId})`);

            // 🔥 保存到全局变量（用于界面显示）
            currentDanmuAnimeId = bestMatch.animeId;
            currentDanmuSourceName = bestMatch.animeTitle;

            return bestMatch.animeId;

        } catch (error) {
            console.error(`❌ 第${attempt}次搜索失败:`, error.message);

            if (attempt < 3) {
                console.log(`🔄 2秒后重试...`);
                await new Promise(r => setTimeout(r, 2000));
            } else {
                reportError('弹幕搜索', '搜索失败', { cleanTitle, error: error.message });
                return null;
            }
        }
    }
}

// ===== 【B站方案】弹幕分片管理 =====
const DANMU_SEGMENT_SIZE = 6000; // 每段最多6000条（B站标准）
const DANMU_TIME_WINDOW = 360; // 6分钟窗口（秒）

// ✅ 智能匹配集数（增强版）
function findBestEpisodeMatch(episodes, targetIndex, showTitle) {
    if (!episodes || episodes.length === 0) return null;

    const targetNumber = targetIndex + 1;

    function normalizeEpisodeTitle(title) {
        return String(title || '')
            .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
            .replace(/[①②③④⑤⑥⑦⑧⑨⑩]/g, ch => {
                const map = {
                    '①': '1', '②': '2', '③': '3', '④': '4', '⑤': '5',
                    '⑥': '6', '⑦': '7', '⑧': '8', '⑨': '9', '⑩': '10'
                };
                return map[ch] || ch;
            })
            .trim();
    }

    function chineseNumberToInt(raw) {
        const s = String(raw || '').trim();

        if (/^\d+$/.test(s)) {
            return parseInt(s, 10);
        }

        const map = {
            '零': 0, '〇': 0,
            '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5,
            '六': 6, '七': 7, '八': 8, '九': 9
        };

        if (s === '十') return 10;

        const tenMatch = s.match(/^([一二两三四五六七八九])?十([一二两三四五六七八九])?$/);
        if (tenMatch) {
            const tens = tenMatch[1] ? map[tenMatch[1]] : 1;
            const ones = tenMatch[2] ? map[tenMatch[2]] : 0;
            return tens * 10 + ones;
        }

        if (s.length === 1 && map[s] !== undefined) {
            return map[s];
        }

        return null;
    }

    function isValidEpisodeNumber(n) {
        if (!Number.isFinite(n)) return false;
        if (n <= 0 || n > 999) return false;

        // 避免把年份当成集数
        if (n >= 1900 && n <= 2099) return false;

        return true;
    }

    function extractEpisodeNumber(title) {
        const s = normalizeEpisodeTitle(title);

        const patterns = [
            // S01E02 / s1e2
            /[Ss]\d{1,2}[Ee]\s*0*(\d{1,4})/,

            // 第2集 / 第2话 / 第2期 / 第十二集
            /第\s*([一二两三四五六七八九十\d]+)\s*[集话話期回]/,

            // EP02 / E02
            /(?:^|[\s._-])[Ee][Pp]?\.?\s*0*(\d{1,4})(?=$|[\s._-])/,

            // #2 / #第2期
            /[#＃]\s*第?\s*([一二两三四五六七八九十\d]+)\s*[集话話期回]?/,

            // 综艺常见：xxx（下）4 / xxx(上)3
            /[（(](?:上|中|下|前篇|后篇|後篇|part\s*\d+|第[上下中]部分)[）)]\s*0*(\d{1,4})\s*$/i,

            // 标题末尾数字：哥伦比亚亚马逊河（下）4
            /(?:^|[^\d])0*(\d{1,4})\s*(?:集|话|話|期|回)?\s*$/
        ];

        for (const pattern of patterns) {
            const match = s.match(pattern);
            if (!match) continue;

            const n = chineseNumberToInt(match[1]);
            if (isValidEpisodeNumber(n)) {
                return n;
            }
        }

        // 特殊处理：纯数字标题
        if (/^\d+$/.test(s)) {
            const n = parseInt(s, 10);
            if (isValidEpisodeNumber(n)) {
                return n;
            }
        }

        return null;
    }

    const episodesWithInfo = episodes.map((ep, idx) => {
        const title = ep.episodeTitle || '';
        const episodeNumber = extractEpisodeNumber(title);

        return {
            episode: ep,
            number: episodeNumber,
            title,
            index: idx,
            confidence: episodeNumber !== null ? 'high' : 'low'
        };
    });

    // 策略1：标题里能解析出明确集数，并且集数刚好等于当前播放集
    const exactMatch = episodesWithInfo.find(ep =>
        ep.number === targetNumber && ep.confidence === 'high'
    );

    if (exactMatch) {
        console.log(`✅ [弹幕] 精确匹配 第${targetNumber}集: ${exactMatch.title}`);
        return exactMatch.episode;
    }

    // 策略2：只要弹幕标题里存在明确集数，但没有命中当前集，就直接拒绝
    // 例如当前第2集，候选是“xxx（下）4”，不能继续按索引兜底
    const explicitEpisodes = episodesWithInfo.filter(ep => ep.confidence === 'high');

    if (explicitEpisodes.length > 0) {
        console.warn(
            `⚠️ [弹幕] 未找到明确的第${targetNumber}集，拒绝索引/模糊兜底，避免错配。可用集数：`,
            explicitEpisodes.map(ep => ({
                index: ep.index,
                number: ep.number,
                title: ep.title,
                episodeId: ep.episode?.episodeId
            }))
        );
        return null;
    }

    // 策略3：所有弹幕标题都解析不出明确集数，才允许按索引匹配
    if (targetIndex >= 0 && targetIndex < episodes.length) {
        const indexMatch = episodesWithInfo[targetIndex];

        console.warn(
            `⚠️ [弹幕] 弹幕标题没有明确集数，暂按索引匹配：当前第${targetNumber}集 → 候选索引${targetIndex}`,
            {
                title: indexMatch.title,
                episodeId: indexMatch.episode?.episodeId
            }
        );

        return indexMatch.episode;
    }

    console.error(`❌ [弹幕] 无法匹配第${targetNumber}集，共${episodes.length}集`);
    console.log('可用弹幕:', episodesWithInfo.map(e => ({
        index: e.index,
        number: e.number,
        confidence: e.confidence,
        title: e.title
    })));

    return null;
}

function pickMatchedDanmuEpisode(episodes, episodeIndex, title) {
    if (!episodes || episodes.length === 0) return null;

    const playerEpisodeCount = Array.isArray(currentEpisodes)
        ? currentEpisodes.length
        : 0;

    // 弹幕源只有 1 集，通常是电影 / 单集内容
    // 但如果当前视频本身是多集剧/动漫/综艺，就不要把单集弹幕源套到每一集上
    if (episodes.length === 1) {
        if (playerEpisodeCount <= 1) {
            console.log('✅ [弹幕] 单集内容，直接使用唯一弹幕剧集');
            return episodes[0];
        }

        console.warn(
            `⚠️ [弹幕] 弹幕源只有1集，但当前视频有${playerEpisodeCount}集，拒绝单集源兜底，避免错配`
        );
        return null;
    }

    return findBestEpisodeMatch(episodes, episodeIndex, title);
}

// ✅ 优化后的弹幕获取函数 - 解决主线程阻塞
async function fetchDanmaku(episodeId, episodeIndex) {
    if (!isDanmuServiceEnabled()) return null;

    const commentUrl = `${getDanmuBaseUrl()}/api/v2/comment/${episodeId}?format=json&duration=true&withRelated=true&chConvert=1`;

    let commentResponse;
    try {
        const authedCommentUrl = await addDanmuAuth(commentUrl);
        commentResponse = await fetchWithRetry(authedCommentUrl, {}, 3, 12000);
    } catch (e) {
        console.warn(`⚠️ 获取弹幕失败:`, e.message);
        return null;
    }

    if (!commentResponse.ok) {
        console.warn(`⚠️ 获取弹幕失败: HTTP ${commentResponse.status}`);
        return null;
    }

    const commentData = await commentResponse.json();

    if (!commentData.comments || !Array.isArray(commentData.comments)) {
        return [];
    }

    const rawComments = commentData.comments;
    const totalComments = rawComments.length;

    console.log(`📊 原始弹幕数量: ${totalComments}`);

    const apiDuration = Number(commentData.videoDuration || 0);
    const playerDuration = getCurrentVideoDuration();

    let durationScale = 1;

    if (
        DANMU_CONFIG.adaptive.enableDurationScale &&
        apiDuration > 0 &&
        playerDuration > 0
    ) {
        const ratio = playerDuration / apiDuration;
        const diff = Math.abs(playerDuration - apiDuration);

        // 只在差异明显但比例合理时缩放，避免错误时长把弹幕拉坏
        const maxDiffRatio = Number(DANMU_CONFIG.maxDurationDiffRatio || 0.08);
        if (diff > 20 && Math.abs(1 - ratio) <= maxDiffRatio) {
            durationScale = ratio;
            console.log(`🎯 弹幕时长自适应: API=${apiDuration.toFixed(1)}s, 视频=${playerDuration.toFixed(1)}s, scale=${durationScale.toFixed(4)}`);
        }
    }

    const offsetSeconds = Number(DANMU_CONFIG.adaptive.offsetSeconds || 0);
    const parsedComments = rawComments.map(c => {
        const params = c.p ? c.p.split(',') : [];
        const rawTime = parseFloat(params[0] || 0);
        const time = Math.max(0, rawTime * durationScale + offsetSeconds);

        return {
            original: c,
            time,
            text: (c.m || '').trim(),
            params
        };
    }).filter(item => {
        if (!item.text) return false;
        return true;
    });

    parsedComments.sort((a, b) => a.time - b.time);

    const lastTime = parsedComments[parsedComments.length - 1]?.time || 0;
    console.log(`📐 弹幕时长: ${Math.floor(lastTime / 60)}分${Math.floor(lastTime % 60)}秒`);

    const finalDanmaku = [];
    parsedComments.forEach(item => processDanmakuOptimized(item, finalDanmaku));

    console.log(`✅ 弹幕解析完成: ${totalComments} → ${finalDanmaku.length}条（未做数量裁剪）`);

    const cacheData = {
        episodeIndex,
        danmuList: finalDanmaku,
        timestamp: Date.now()
    };

    if (videoPlayer) {
        videoPlayer.updateDanmuCache(episodeIndex, finalDanmaku);
    }

    currentDanmuCache = cacheData;

    return finalDanmaku;
}

// 🔥 新增：段内密度控制处理
function processSegmentWithDensityControl(items, maxPerSecond) {
    if (!items || items.length === 0) return [];

    // 按秒分组
    const bySecond = new Map();
    items.forEach(item => {
        const second = Math.floor(item.time);

        if (!bySecond.has(second)) {
            bySecond.set(second, []);
        }
        bySecond.get(second).push(item);
    });

    // 对每秒的弹幕进行密度控制
    const result = [];
    for (const [second, danmus] of bySecond.entries()) {
        if (danmus.length <= maxPerSecond) {
            result.push(...danmus);
        } else {
            // 超过上限，均匀采样
            const step = danmus.length / maxPerSecond;
            for (let i = 0; i < maxPerSecond; i++) {
                const idx = Math.floor(i * step);
                result.push(danmus[idx]);
            }
        }
    }

    return result;
}

// 🔥 新增：均匀密度采样算法
function uniformDensitySampling(items, targetCount, segStart, segEnd) {
    if (!items || items.length <= targetCount) return items;

    const segDuration = segEnd - segStart;
    const timeSlots = Math.ceil(segDuration);
    const slotsMap = new Map();

    // 初始化时间片
    for (let i = 0; i < timeSlots; i++) {
        slotsMap.set(i, []);
    }

    // 将弹幕分配到各时间片
    items.forEach(item => {
        const slotIndex = Math.floor(item.time - segStart);
        if (slotIndex >= 0 && slotIndex < timeSlots) {
            if (!slotsMap.has(slotIndex)) {
                slotsMap.set(slotIndex, []);
            }
            slotsMap.get(slotIndex).push(item);
        }
    });

    // 从每个时间片均匀采样
    const result = [];
    const perSlotQuota = Math.ceil(targetCount / timeSlots);

    for (const [slot, danmus] of slotsMap.entries()) {
        if (danmus.length === 0) continue;

        if (danmus.length <= perSlotQuota) {
            result.push(...danmus);
        } else {
            // 均匀采样
            const step = danmus.length / perSlotQuota;
            for (let i = 0; i < perSlotQuota && result.length < targetCount; i++) {
                const idx = Math.floor(i * step);
                result.push(danmus[idx]);
            }
        }
    }

    return result;
}

// 🔥 弹幕对象处理（优化版）
function processDanmakuOptimized(item, pool) {
    const params = item.params;
    let mode = parseInt(params[1] || 0);
    if (mode >= 4 && mode <= 5) mode = mode === 4 ? 2 : 1;
    else mode = 0;

    const text = item.text.slice(0, 100);
    if (!text) return;

    pool.push({
        text: text,
        time: item.time,
        mode: mode,
        color: '#' + parseInt(params[2] || 16777215).toString(16).padStart(6, '0').toUpperCase()
    });
}
// ✅ 带临时缓存、重试机制、过期兜底的剧集获取函数
async function getAnimeEpisodesWithCache(animeId, cleanTitle) {
    const cacheKey = `anime_${animeId}`;
    const TTL = DANMU_CONFIG.tempDetailCacheTTL || (90 * 60 * 1000); // 90 分钟
    const cached = tempDetailCache.get(cacheKey);

    // 缓存有效直接返回
    if (cached && Date.now() - cached.timestamp < TTL) {
        console.log('✅ 使用临时详情缓存（有效期内）');
        return cached.episodes;
    }

    // 重试机制：最多 3 次，递增等待
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const detailUrl = `${getDanmuBaseUrl()}/api/v2/bangumi/${animeId}`;
			const authedDetailUrl = await addDanmuAuth(detailUrl);
			const response = await fetchWithRetry(authedDetailUrl, {}, 2, 10000);
            const data = await response.json();

            if (!data.bangumi || !data.bangumi.episodes) {
                console.warn(`⚠️ 第${attempt}次：返回数据无剧集`);
                break; // 数据本身没有，不用重试
            }

            // 过滤特典等
            const episodes = data.bangumi.episodes.filter(ep => {
                const epTitle = ep.episodeTitle || '';
                return !/(特典|花絮|番外|PV|预告|OP|ED|映像特典)/i.test(epTitle);
            });

            // 更新缓存：超过 8 个时清理最旧的（留 2 个余量）
			while (tempDetailCache.size >= 8) {
				const firstKey = tempDetailCache.keys().next().value;
				tempDetailCache.delete(firstKey);
				console.log('🧹 清理过期剧集缓存');
			}
			tempDetailCache.set(cacheKey, {
				timestamp: Date.now(),
				animeId,
				episodes: episodes.slice(0, 500), // 单部剧最多缓存 500 集（防止超长番剧爆内存）
				isMovie: isMovieContent(data.bangumi)
			});

            console.log(`✅ 第${attempt}次成功获取剧集: ${episodes.length} 集`);
            return episodes;

        } catch (error) {
            console.warn(`⚠️ 第${attempt}次获取剧集失败:`, error.message);
            if (attempt < 3) {
                await new Promise(r => setTimeout(r, 1000 * attempt)); // 1s, 2s 递增等待
            }
        }
    }

    // 3次都失败：返回过期缓存作为兜底（比返回 null 好）
    if (cached && cached.episodes) {
        console.warn(`⚠️ 网络失败，使用过期缓存兜底（animeId: ${animeId}）`);
        return cached.episodes;
    }

    reportError('弹幕详情', '获取动漫详情彻底失败', { animeId });
    return null;
}

// ✅ 主弹幕获取函数 —— 自动搜索 + 用户手选双路径，健壮版
let _danmuFetchController = null; // 在函数外部，文件顶部全局变量区添加此行

async function getDanmukuForVideo(title, episodeIndex) {
    if (!isDanmuServiceEnabled()) return [];

    // 取消上一次未完成的弹幕搜索
    if (_danmuFetchController) {
        _danmuFetchController.cancelled = true;
    }
    const controller = { cancelled: false };
    _danmuFetchController = controller;

    try {
        // ① 命中弹幕缓存，直接返回
        if (currentDanmuCache.episodeIndex === episodeIndex &&
            currentDanmuCache.danmuList &&
            Date.now() - currentDanmuCache.timestamp < DANMU_CONFIG.cacheExpiration.danmuCache) {
            console.log('✅ 使用弹幕缓存（当前集）');
            return currentDanmuCache.danmuList;
        }

        const cleanTitle = sanitizeTitle(title);
        const context = getDanmuPlaybackContext(title, episodeIndex);
        const manualMapping = getDanmuManualMapping(context.videoKey);
        let animeId = null;

        if (manualMapping) {
            console.log('🎯 使用本地保存的弹幕手动映射:', manualMapping);

            if (manualMapping.animeId) {
                currentDanmuAnimeId = manualMapping.animeId;
                currentDanmuSourceName = manualMapping.sourceName || manualMapping.animeTitle || '';
            }

            if (manualMapping.episodeId) {
                const result = await fetchDanmaku(manualMapping.episodeId, episodeIndex);
                if (controller.cancelled) return [];
                if (result && result.length > 0) {
                    return result;
                }
                console.warn('⚠️ 本地弹幕映射没有可用弹幕，降级到手动源剧集匹配');
            }
        }

        // ② 路径 A：用户手动选择了弹幕源（优先级最高）
        if (currentDanmuAnimeId) {
            console.log(`🎯 使用用户选定的弹幕源: ${currentDanmuAnimeId}`);

            // 先用带兜底的缓存函数获取剧集（即使缓存过期也会重试）
            const episodes = await getAnimeEpisodesWithCache(currentDanmuAnimeId, cleanTitle);

            if (episodes && episodes.length > 0) {
                // 用户选定的源有效，走这条路径
                animeId = currentDanmuAnimeId;

                const matchedEpisode = pickMatchedDanmuEpisode(episodes, episodeIndex, title);

                if (!matchedEpisode) {
                    console.warn(`⚠️ 用户选定源无法匹配第${episodeIndex + 1}集，降级自动搜索`);
                    animeId = null; // 降级到路径 B
                } else {
                    const result = await fetchDanmaku(matchedEpisode.episodeId, episodeIndex);
					if (controller.cancelled) return [];
					if (result && result.length > 0) {
						console.log(`✅ 用户选定源加载成功: ${result.length} 条`);
						return result;
					}
                    console.warn('⚠️ 用户选定源弹幕为空，降级自动搜索');
					currentDanmuAnimeId = null;
					currentDanmuSourceName = '';
					animeId = null;
                }
            } else {
                // 用户选定的源剧集获取失败（网络彻底断了也会有过期兜底，走到这说明真失效了）
                console.warn(`⚠️ 用户选定源 ${currentDanmuAnimeId} 失效，降级自动搜索`);
				// 直接清空，避免反复尝试失效的源
				currentDanmuAnimeId = null;
				currentDanmuSourceName = '';
				animeId = null;
            }
        }

        // ③ 路径 B：优先使用 danmu_api 的 match 自动匹配
		if (!animeId) {
		    const matchedByApi = await matchDanmuByApi(title, episodeIndex);
		    if (controller.cancelled) return [];

		    if (matchedByApi && matchedByApi.episodeId) {
		        const result = await fetchDanmaku(matchedByApi.episodeId, episodeIndex);
		        if (controller.cancelled) return [];

		        if (result && result.length > 0) {
		            console.log(`✅ match 接口成功加载第${episodeIndex + 1}集弹幕: ${result.length} 条`);
		            return result;
		        }

		        console.warn('⚠️ match 匹配到了剧集，但弹幕为空，降级旧搜索逻辑');
                if (DANMU_CONFIG.strictAutoLoad !== false) {
                    return [];
                }
		    }

            if (DANMU_CONFIG.strictAutoLoad !== false) {
                console.warn('❌ 严格自动匹配未命中，等待用户手动选择弹幕源');
                return [];
            }

		    console.log(`🔍 降级旧搜索弹幕源: ${cleanTitle}`);
		    animeId = await findOrSearchAnimeId(cleanTitle);
		    if (controller.cancelled) return [];

		    if (!animeId) {
		        console.warn('❌ 自动搜索失败，无弹幕:', title);
		        return [];
		    }
		}

        // ④ 获取剧集列表（路径 B 的后续）
        const episodes = await getAnimeEpisodesWithCache(animeId, cleanTitle);
        if (!episodes || episodes.length === 0) {
			if (controller.cancelled) return [];
            console.warn(`⚠️ 未找到剧集信息 (animeId: ${animeId})`);
            return [];
        }

        // ⑤ 匹配集数并获取弹幕
        const matchedEpisode = pickMatchedDanmuEpisode(episodes, episodeIndex, title);

        if (!matchedEpisode) {
            console.warn(`⚠️ 无法匹配第${episodeIndex + 1}集`);
            return [];
        }

        const result = await fetchDanmaku(matchedEpisode.episodeId, episodeIndex);
		if (controller.cancelled) return [];
		if (result && result.length > 0) {
			console.log(`✅ 自动搜索成功加载第${episodeIndex + 1}集弹幕: ${result.length} 条`);
			return result;
		}

        console.warn(`⚠️ episodeId ${matchedEpisode.episodeId} 弹幕为空`);
        return [];

    } catch (error) {
        reportError('弹幕加载', '获取弹幕失败', { title, episodeIndex, error: error.message });
        return [];
    }
}

// 兼容旧的函数名
function getDanmukuUrl() {
    return getDanmukuForVideo(currentVideoTitle, currentEpisodeIndex);
}

// 页面加载
document.addEventListener('DOMContentLoaded', function () {
    // 先检查用户是否已通过密码验证
    if (!isPasswordVerified()) {
        // 隐藏加载提示
        document.getElementById('player-loading').style.display = 'none';
        return;
    }

    initializePageContent();
});

// 监听密码验证成功事件
document.addEventListener('passwordVerified', () => {
    document.getElementById('player-loading').style.display = 'block';

    initializePageContent();
});

// 初始化页面内容
function initializePageContent() {

    // 解析URL参数
    const urlParams = new URLSearchParams(window.location.search);
    let videoUrl = urlParams.get('url');
    const title = urlParams.get('title');
    const sourceCode = urlParams.get('source');
    let index = parseInt(urlParams.get('index') || '0');
    const episodesList = urlParams.get('episodes'); // 从URL获取集数信息
    const savedPosition = parseInt(urlParams.get('position') || '0'); // 获取保存的播放位置
    // 解决历史记录问题：检查URL是否是player.html开头的链接
    // 如果是，说明这是历史记录重定向，需要解析真实的视频URL
    if (videoUrl && videoUrl.includes('player.html')) {
        try {
            // 尝试从嵌套URL中提取真实的视频链接
            const nestedUrlParams = new URLSearchParams(videoUrl.split('?')[1]);
            // 从嵌套参数中获取真实视频URL
            const nestedVideoUrl = nestedUrlParams.get('url');
            // 检查嵌套URL是否包含播放位置信息
            const nestedPosition = nestedUrlParams.get('position');
            const nestedIndex = nestedUrlParams.get('index');
            const nestedTitle = nestedUrlParams.get('title');

            if (nestedVideoUrl) {
                videoUrl = nestedVideoUrl;

                // 更新当前URL参数
                const url = new URL(window.location.href);
                if (!urlParams.has('position') && nestedPosition) {
                    url.searchParams.set('position', nestedPosition);
                }
                if (!urlParams.has('index') && nestedIndex) {
                    url.searchParams.set('index', nestedIndex);
                }
                if (!urlParams.has('title') && nestedTitle) {
                    url.searchParams.set('title', nestedTitle);
                }
                // 替换当前URL
                window.history.replaceState({}, '', url);
            } else {
                showError('历史记录链接无效，请返回首页重新访问');
            }
        } catch (e) {
        }
    }

    // 保存当前视频URL
    currentVideoUrl = videoUrl || '';

    const playbackState = window.LibertyUtils?.playbackState;

    // 从localStorage获取数据
    currentVideoTitle = title || localStorage.getItem('currentVideoTitle') || '未知视频';
    currentEpisodeIndex = index;

    // 设置自动连播开关状态
    autoplayEnabled = localStorage.getItem('autoplayEnabled') !== 'false'; // 默认为true
    document.getElementById('autoplayToggle').checked = autoplayEnabled;

    // 获取广告过滤设置
    adFilteringEnabled = localStorage.getItem('adFilteringEnabled') !== 'false'; // 默认为true

    // 监听自动连播开关变化
    document.getElementById('autoplayToggle').addEventListener('change', function (e) {
        autoplayEnabled = e.target.checked;
        localStorage.setItem('autoplayEnabled', autoplayEnabled);
    });

    // 优先使用URL传递的集数信息，否则从localStorage获取
    try {
        const storageUtils = window.LibertyUtils?.storage;
        if (episodesList) {
            // 如果URL中有集数数据，优先使用它
            const decodedEpisodes = decodeURIComponent(episodesList);
            const parsedEpisodes = storageUtils
                ? storageUtils.safeJsonParse(decodedEpisodes, [])
                : JSON.parse(decodedEpisodes);
            currentEpisodes = playbackState
                ? playbackState.normalizeEpisodesToUrls(parsedEpisodes)
                : parsedEpisodes;

        } else {
            // 否则从localStorage获取
            currentEpisodes = playbackState
                ? playbackState.readCurrentEpisodes()
                : storageUtils
                    ? storageUtils.readStorage('currentEpisodes', [])
                    : JSON.parse(localStorage.getItem('currentEpisodes') || '[]');

        }

        // 检查集数索引是否有效，如果无效则调整为0
        if (index < 0 || (currentEpisodes.length > 0 && index >= currentEpisodes.length)) {
            // 如果索引太大，则使用最大有效索引
            if (index >= currentEpisodes.length && currentEpisodes.length > 0) {
                index = currentEpisodes.length - 1;
            } else {
                index = 0;
            }

            // 更新URL以反映修正后的索引
            const newUrl = new URL(window.location.href);
            newUrl.searchParams.set('index', index);
            window.history.replaceState({}, '', newUrl);
        }

        // 更新当前索引为验证过的值
        currentEpisodeIndex = index;

        episodesReversed = localStorage.getItem('episodesReversed') === 'true';
        if (isWatchRoomLaunch()) {
            console.log('[WatchRoomAudit] player init source', {
                url: videoUrl,
                episodes: currentEpisodes,
                episodeIndex: currentEpisodeIndex
            });
        }
    } catch (e) {
        currentEpisodes = [];
        currentEpisodeIndex = 0;
        episodesReversed = false;
    }

    // 设置页面标题
    document.title = currentVideoTitle + ' - LibreTV播放器';
    document.getElementById('videoTitle').textContent = currentVideoTitle;


    // 初始化播放器
    if (videoUrl) {
        initPlayer(videoUrl);
    } else {
        showError('无效的视频链接');
    }

    // 渲染源信息
    renderResourceInfoBar();

    // 更新集数信息
    updateEpisodeInfo();

    // 渲染集数列表
    renderEpisodes();

    // 更新按钮状态
    updateButtonStates();

    // 更新排序按钮状态
    updateOrderButton();

    // 添加键盘快捷键事件监听
    document.addEventListener('keydown', handleKeyboardShortcuts);

    // 页面加载完成后，延迟保存一次历史记录
    setTimeout(() => {
        console.log('[历史记录] 尝试保存初始历史记录');
        saveToHistory();
    }, 2000);
}

// 处理键盘快捷键
function handleKeyboardShortcuts(e) {
    // 忽略输入框中的按键事件
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    // Alt + 左箭头 = 上一集
    if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        if (currentEpisodeIndex > 0) {
            playPreviousEpisode();
            showShortcutHint('上一集', 'left');
        }
    }

    // Alt + 右箭头 = 下一集
    if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        if (currentEpisodeIndex < currentEpisodes.length - 1) {
            playNextEpisode();
            showShortcutHint('下一集', 'right');
        }
    }

    // 左箭头 = 快退
    if (!e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        if (art) {
            art.currentTime = Math.max(0, art.currentTime - 5);
            showShortcutHint('快退', 'left');
        }
    }

    // 右箭头 = 快进
    if (!e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        if (art) {
            art.currentTime = Math.min(art.duration, art.currentTime + 5);
            showShortcutHint('快进', 'right');
        }
    }

    // 上箭头 = 音量+
    if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (art) {
            art.volume = Math.min(1, art.volume + 0.1);
            showShortcutHint('音量+', 'up');
        }
    }

    // 下箭头 = 音量-
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (art) {
            art.volume = Math.max(0, art.volume - 0.1);
            showShortcutHint('音量-', 'down');
        }
    }

    // 空格 = 播放/暂停
    if (e.key === ' ') {
        e.preventDefault();
        if (art) {
            art.toggle();
            showShortcutHint('播放/暂停', 'play');
        }
    }

    // f 键 = 切换全屏
    if (e.key === 'f' || e.key === 'F') {
        if (art) {
            art.fullscreen = !art.fullscreen;
            showShortcutHint('切换全屏', 'fullscreen');
            e.preventDefault();
        }
    }
}

// 显示快捷键提示
function showShortcutHint(text, direction) {
    const hintElement = document.getElementById('shortcutHint');
    if (!hintElement) return;

    const textElement = document.getElementById('shortcutText');
    const iconElement = document.getElementById('shortcutIcon');

    // 🔥 使用 VideoPlayer 管理定时器
    if (videoPlayer) {
        videoPlayer.clearTimer('shortcutHint');
    } else if (shortcutHintTimeout) {
        clearTimeout(shortcutHintTimeout);
    }

    // 设置内容
    textElement.textContent = text;

    const icons = {
        left: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path>',
        right: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>',
        up: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"></path>',
        down: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>',
        fullscreen: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5"></path>',
        play: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3l14 9-14 9V3z"></path>'
    };
    iconElement.innerHTML = icons[direction] || '';

    // 🔥 强制重排，确保动画触发
    hintElement.classList.remove('show');
    void hintElement.offsetWidth;
    hintElement.classList.add('show');

    // 800ms后隐藏
    if (videoPlayer) {
        videoPlayer.setTimer('shortcutHint', () => {
            hintElement.classList.remove('show');
        }, 800);
    } else {
        shortcutHintTimeout = setTimeout(() => {
            hintElement.classList.remove('show');
        }, 800);
    }
}

// ============================================
// 🎬 VideoPlayer 类 - 统一资源管理
// ============================================
class VideoPlayer {
    constructor(containerId, config = {}) {
        // 核心实例
        this.art = null;
        this.hls = null;

        // 定时器管理
        this.timers = {
            progressSave: null,
            saveProgress: null,
            autoCleanup: null,
            danmuSync: null,
            hlsBufferCheck: null,
            seekDebounce: null,
            autoSaveHistory: null,
            restoreDanmu: null,
            shortcutHint: null,
            longPress: null
        };

        // 事件监听器管理
        this.eventListeners = new Map();
        this.artEventListeners = [];
        this.hlsEventListeners = [];

        // 防息屏管理
        this.wakeLock = {
            instance: null,
            noSleepVideo: null
        };

        // HLS 缓冲管理变量
        this.hlsBufferState = {
            lastBufferCheck: 0,
            lastCleanupTime: 0,
            pauseStartTime: 0
        };

        // 状态管理
        this.state = {
            currentUrl: '',
            episodeIndex: 0,
            isPlaying: false,
            hasEnded: false,
            isInitializing: false
        };

        // 弹幕管理
        this.danmu = {
            cache: {
                episodeIndex: -1,
                danmuList: null,
                timestamp: 0
            },
            currentAnimeId: null,
            currentSourceName: ''
        };

        // 配置
        this.config = {
            containerId,
            autoplay: true,
            volume: 0.8,
            ...config
        };
    }

    // ============================================
    // 定时器管理方法
    // ============================================
    setTimer(name, callback, delay, isInterval = false) {
        this.clearTimer(name);
        this.timers[name] = isInterval 
            ? setInterval(callback, delay)
            : setTimeout(callback, delay);
        return this.timers[name];
    }

    clearTimer(name) {
        if (this.timers[name]) {
            clearTimeout(this.timers[name]);
            clearInterval(this.timers[name]);
            this.timers[name] = null;
        }
    }

    clearAllTimers() {
        Object.keys(this.timers).forEach(key => this.clearTimer(key));
    }

    // ============================================
    // 事件监听器管理方法
    // ============================================
    addEventListener(target, event, handler, options) {
        target.addEventListener(event, handler, options);

        const key = `${target.constructor.name}_${event}`;
        if (!this.eventListeners.has(key)) {
            this.eventListeners.set(key, []);
        }
        this.eventListeners.get(key).push({ target, event, handler });
    }

    removeAllEventListeners() {
        for (const listeners of this.eventListeners.values()) {
            listeners.forEach(({ target, event, handler }) => {
                try {
                    target.removeEventListener(event, handler);
                } catch (e) {
                    console.warn('移除监听器失败:', e);
                }
            });
        }
        this.eventListeners.clear();
    }

    // ============================================
    // 防息屏管理方法
    // ============================================
    async requestWakeLock() {
        if (!('wakeLock' in navigator)) {
            console.log('ℹ️ 浏览器不支持 Wake Lock，启用备用方案');
            this.enableNoSleepFallback();
            return;
        }

        if (this.wakeLock.instance !== null) return;

        try {
            this.wakeLock.instance = await navigator.wakeLock.request('screen');
            console.debug('防息屏已激活');

            this.wakeLock.instance.addEventListener('release', () => {
                this.wakeLock.instance = null;
                if (this.art?.playing) {
                    this.enableNoSleepFallback();
                }
            });
        } catch (err) {
            console.warn(`⚠️ Wake Lock 失败 (${err.name})，启用备用方案`);
            this.enableNoSleepFallback();
        }
    }

    releaseWakeLock() {
        if (this.wakeLock.instance !== null) {
            this.wakeLock.instance.release().catch(() => {});
            this.wakeLock.instance = null;
        }
        this.disableNoSleepFallback();
    }

    enableNoSleepFallback() {
        if (this.wakeLock.noSleepVideo) {
            if (this.wakeLock.noSleepVideo.paused) {
                this.wakeLock.noSleepVideo.play().catch(() => {});
            }
            return;
        }

        if (!this.art?.video) return;

        const hasAudio = this.art.video.mozHasAudio || 
                         Boolean(this.art.video.webkitAudioDecodedByteCount) ||
                         (this.art.video.audioTracks && this.art.video.audioTracks.length > 0);

        if (hasAudio) return;

        this.wakeLock.noSleepVideo = document.createElement('video');
        this.wakeLock.noSleepVideo.setAttribute('playsinline', '');
        this.wakeLock.noSleepVideo.setAttribute('loop', '');
        this.wakeLock.noSleepVideo.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-1;';
        this.wakeLock.noSleepVideo.src = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAu1tZGF0AAACrgYF//+q3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE0OCByMjY0MyA1YzY1NzA0IC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAxNSAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTEgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MzoweDExMyBtZT1oZXggc3VibWU9NyBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MSBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTEgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0zIGJfcHlyYW1pZD0yIGJfYWRhcHQ9MSBiX2JpYXM9MCBkaXJlY3Q9MSB3ZWlnaHRiPTEgb3Blbl9nb3A9MCB3ZWlnaHRwPTIga2V5aW50PTI1MCBrZXlpbnRfbWluPTI1IHNjZW5lY3V0PTQwIGludHJhX3JlZnJlc2g9MCByY19sb29rYWhlYWQ9NDAgcmM9Y3JmIG1idHJlZT0xIGNyZj0yMy4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTE6MS4wMACAAAAAD2WIhAA3//728P4FNjuZQQAAAu5tb292AAAAbG12aGQAAAAAAAAAAAAAAAAAAAPoAAAAZAABAAABAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAACGHRyYWsAAABcdGtoZAAAAAMAAAAAAAAAAAAAAAEAAAAAAAAAZAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAgAAAAIAAAAAACRlZHRzAAAAHGVsc3QAAAAAAAAAAQAAAGQAAAAAAAEAAAAAAZBtZGlhAAAAIG1kaGQAAAAAAAAAAAAAAAAAACgAAAAEAFXEAAAAAAAtaGRscgAAAAAAAAAAdmlkZQAAAAAAAAAAAAAAAFZpZGVvSGFuZGxlcgAAAAE7bWluZgAAABR2bWhkAAAAAQAAAAAAAAAAAAAAJGRpbmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAABAAAA+3N0YmwAAACXc3RzZAAAAAAAAAABAAAAh2F2YzEAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAgACAEgAAABIAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY//8AAAAxYXZjQwFkAAr/4QAYZ2QACqzZQbCWhAAAAwAEAAADAFA8SJZYAQAGaOvjyyLAAAAAGHN0dHMAAAAAAAAAAQAAAAEAAAQAAAAAHHN0c2MAAAAAAAAAAQAAAAEAAAABAAAAAQAAABRzdHN6AAAAAAAAAAAAAAABAAAAaAAAABRzdGNvAAAAAAAAAAEAAAAsAAAAYXVkdGEAAABZbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAtaWxzdAAAACWpdG9vAAAAHWRhdGEAAAABAAAAAExhdmY1Ni40MC4xMDE=';
        this.wakeLock.noSleepVideo.volume = 0.01;

        this.wakeLock.noSleepVideo.addEventListener('error', () => {
            console.warn('NoSleep video 加载失败');
            if (this.wakeLock.noSleepVideo?.parentNode) {
                this.wakeLock.noSleepVideo.remove();
            }
            this.wakeLock.noSleepVideo = null;
        });

        document.body.appendChild(this.wakeLock.noSleepVideo);
        this.wakeLock.noSleepVideo.play().catch((e) => {
            console.warn('NoSleep video 播放失败:', e);
            if (this.wakeLock.noSleepVideo?.parentNode) {
                this.wakeLock.noSleepVideo.remove();
            }
            this.wakeLock.noSleepVideo = null;
        });
    }

    disableNoSleepFallback() {
        if (this.wakeLock.noSleepVideo) {
            try {
                this.wakeLock.noSleepVideo.pause();
                this.wakeLock.noSleepVideo.removeAttribute('src');
                this.wakeLock.noSleepVideo.load();
                if (this.wakeLock.noSleepVideo.parentNode) {
                    this.wakeLock.noSleepVideo.remove();
                }
            } catch (e) {
                console.warn('清理 NoSleep video 失败:', e);
            } finally {
                this.wakeLock.noSleepVideo = null;
            }
        }
    }

    // ============================================
    // HLS 销毁方法
    // ============================================
    destroyHls() {
        if (this.hls) {
            try {
                const hlsEvents = [
                    Hls.Events.ERROR,
                    Hls.Events.MANIFEST_PARSED,
                    Hls.Events.FRAG_LOADED,
                    Hls.Events.LEVEL_LOADED,
                    Hls.Events.FRAG_BUFFERED
                ];

                hlsEvents.forEach(event => {
                    try {
                        this.hls.off(event);
                    } catch (e) {}
                });

                this.hls.stopLoad();
                this.hls.detachMedia();
                this.hls.destroy();
                console.log('✅ HLS 实例已完全销毁');
            } catch (e) {
                console.error('HLS 销毁失败:', e);
            } finally {
                this.hls = null;
            }
        }

        // 重置 HLS 缓冲管理变量
        this.hlsBufferState = {
            lastBufferCheck: 0,
            lastCleanupTime: 0,
            pauseStartTime: 0
        };
    }

    // ============================================
    // ArtPlayer 销毁方法
    // ============================================
    destroyArtPlayer() {
        if (this.art) {
            try {
                const events = [
                    'ready', 'seek', 'video:loadedmetadata', 
                    'video:error', 'video:ended', 'video:playing',
                    'video:pause', 'fullscreenWeb', 'fullscreen',
                    'video:play', 'destroy'
                ];

                events.forEach(event => {
                    try {
                        this.art.off(event);
                    } catch (e) {}
                });

                if (this.art.video) {
                    this.art.video.pause();
                    this.art.video.removeAttribute('src');
                    this.art.video.load();
                }

                this.art.destroy();
                console.log('✅ 播放器已完全销毁');
            } catch (e) {
                console.error('播放器销毁失败:', e);
            } finally {
                this.art = null;
            }
        }
    }

    // ============================================
    // 弹幕管理方法
    // ============================================
    clearDanmuCache() {
        this.danmu.cache = {
            episodeIndex: -1,
            danmuList: null,
            timestamp: 0
        };
        console.log('✅ 弹幕缓存已清理');
    }

    updateDanmuCache(episodeIndex, danmuList) {
        this.danmu.cache = {
            episodeIndex,
            danmuList,
            timestamp: Date.now()
        };
    }

    getDanmuCache() {
        return this.danmu.cache;
    }

    // ============================================
    // 调试辅助方法
    // ============================================
    getStatus() {
        return {
            hasArt: !!this.art,
            hasHls: !!this.hls,
            timers: Object.keys(this.timers).filter(key => this.timers[key] !== null),
            eventListenersCount: this.eventListeners.size,
            wakeLockActive: !!this.wakeLock.instance,
            noSleepActive: !!this.wakeLock.noSleepVideo,
            danmuCached: !!this.danmu.cache.danmuList,
            danmuCacheEpisode: this.danmu.cache.episodeIndex
        };
    }

    logStatus() {
        console.table(this.getStatus());
    }

    // ============================================
    // 统一销毁方法
    // ============================================
    destroy() {
        console.log('🧹 VideoPlayer 开始销毁...');

        this.clearAllTimers();
        this.removeAllEventListeners();
        this.releaseWakeLock();
        this.destroyHls();
        this.destroyArtPlayer();
        this.clearDanmuCache();

        // 只清理挂在 #player 容器下的残留 video，不动全局
		const playerContainer = document.getElementById('player');
		if (playerContainer) {
			const orphanVideos = playerContainer.querySelectorAll('video');
			orphanVideos.forEach((video) => {
				try {
					video.pause();
					video.removeAttribute('src');
					video.load();
					setTimeout(() => {
						if (video.parentNode) video.remove();
					}, 50);
				} catch (e) {
					console.error('清理视频元素失败:', e);
				}
			});
		}

        console.log('✅ VideoPlayer 销毁完成');
    }
}

// 全局 VideoPlayer 实例
let videoPlayer = null;

// 初始化播放器
function initPlayer(videoUrl) {
    // 🔥 使用 VideoPlayer 类管理实例
    if (videoPlayer) {
        console.log('🔄 销毁旧播放器实例');
        const status = videoPlayer.getStatus();
        console.log('旧实例状态:', status);
        videoPlayer.destroy();
        videoPlayer = null;

        // 🔥 销毁后等待 100ms，确保资源完全释放
        setTimeout(() => initPlayerInternal(videoUrl), 100);
        return;
    }

    initPlayerInternal(videoUrl);
}

// 内部初始化函数
function initPlayerInternal(videoUrl) {
    // 防止短时间内重复初始化
    const now = Date.now();
    if (typeof initPlayer.lastInitTime === 'undefined') {
        initPlayer.lastInitTime = 0;
    }
    if (now - initPlayer.lastInitTime < 200) {
        console.warn('⚠️ 播放器正在初始化或刚初始化过，跳过');
        return;
    }
    initPlayer.lastInitTime = now;

    console.log('🎬 开始初始化播放器...');

	// 使用新的统一缓存清理函数
    if (!window.danmuCacheCleanedThisSession) {
        cleanCacheByType('animeDetail', 24 * 60 * 60 * 1000, 100);
        cleanCacheByType('animeTitle', 24 * 60 * 60 * 1000, 100);
        window.danmuCacheCleanedThisSession = true;
    }

    if (!videoUrl) {
        return
    }

    const shouldDisableAutoplayForWatchRoom = isWatchRoomLaunch();
    if (shouldDisableAutoplayForWatchRoom) {
        console.log('[WatchRoom] watch room launch detected, disable initial autoplay', {
            role: getWatchRoomLaunchRole()
        });
    }

    // ===== 🔥 创建新的 VideoPlayer 实例 =====
    videoPlayer = new VideoPlayer('player', {
        autoplay: !shouldDisableAutoplayForWatchRoom,
        volume: 0.8
    });

    // ✅ 在这里添加移动端检测
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

    // 🎬 Netflix 风格的 HLS 配置（激进清理 + 快速切换）
	const hlsConfig = {
		debug: false,
		loader: adFilteringEnabled ? CustomHlsJsLoader : Hls.DefaultConfig.loader,
		enableWorker: true,
		lowLatencyMode: false,

		// 🔥 Netflix 策略：只保留必要缓冲
		backBufferLength: isMobileDevice ? 30 : 60,   // 移动端只保留 30 秒回看缓冲
		maxBufferLength: isMobileDevice ? 20 : 30,    // 移动端前向缓冲 20 秒
		maxMaxBufferLength: isMobileDevice ? 40 : 60,
		maxBufferSize: isMobileDevice
			? 30 * 1000 * 1000   // 移动端 30MB
			: 50 * 1000 * 1000,  // 桌面端 50MB
		maxBufferHole: 0.3,              // 更小的容错空间

		// 🚀 快速重试（提升切换速度）
		fragLoadingMaxRetry: 4,          // 减少重试次数
		fragLoadingMaxRetryTimeout: 32000,
		fragLoadingRetryDelay: 500,      // 更快的重试
		manifestLoadingMaxRetry: 2,
		manifestLoadingRetryDelay: 500,
		levelLoadingMaxRetry: 3,
		levelLoadingRetryDelay: 500,

		startLevel: -1,
		abrEwmaDefaultEstimate: 500000,
		abrBandWidthFactor: 0.95,
		abrBandWidthUpFactor: 0.7,
		abrMaxWithRealBitrate: true,
		stretchShortVideoTrack: true,
		appendErrorMaxRetry: 3,
		liveSyncDurationCount: 3,
		liveDurationInfinity: false
	};

    // Create new ArtPlayer instance
    art = new Artplayer({
        container: '#player',
        url: videoUrl,
        type: 'm3u8',
        title: currentVideoTitle,
        volume: 0.8,
        isLive: false,
        muted: false,
        autoplay: !shouldDisableAutoplayForWatchRoom,
        pip: true,
        autoSize: false,
        autoMini: true,
        screenshot: true,
        setting: true,
        loop: false,
        flip: false,
        playbackRate: true,
        aspectRatio: false,
        fullscreen: true,
        fullscreenWeb: !isMobileDevice, // ✅ 移动端禁用网页全屏，桌面端启用
        subtitleOffset: false,
        miniProgressBar: true,
        mutex: true,
        backdrop: true,
        playsInline: true,
        autoPlayback: false,
        airplay: true,
        hotkey: false,
        theme: '#23ade5',
        lang: navigator.language.toLowerCase(),
        moreVideoAttr: {
            crossOrigin: 'anonymous',
            playsInline: true,
            'webkit-playsinline': 'true',
            'x5-playsinline': 'true',
            'x5-video-player-type': 'h5',
        },
        plugins: [
			// 修改后
			artplayerPluginDanmuku({
				danmuku: [],
				speed: danmuDisplayConfig.speed,
				opacity: danmuDisplayConfig.opacity,
				fontSize: danmuDisplayConfig.fontSize || (isMobileDevice ? (window.innerWidth < 375 ? 18 : 20) : 25),
				color: danmuDisplayConfig.color,
				mode: danmuDisplayConfig.mode,
				modes: [0, 1, 2],
				margin: isMobileDevice ? [5, '80%'] : [10, '75%'],
				antiOverlap: true,
				useWorker: true,
				synchronousPlayback: true,
				filter: () => true,
				lockTime: 5,
				maxLength: 100,
				theme: 'light',
			}),
		],
        customType: {
			m3u8: function (video, url) {
				applyInlineVideoAttributes(video);
				// ===== 🔥 增强 HLS 销毁 =====
				if (currentHls) {
					try {
						// 1. 移除所有事件监听器（关键！）
						const hlsEvents = [
							Hls.Events.ERROR,
							Hls.Events.MANIFEST_PARSED,
							Hls.Events.FRAG_LOADED,
							Hls.Events.LEVEL_LOADED,
							Hls.Events.FRAG_BUFFERED  // ⚠️ 新增：必须清理缓冲监听器
						];

						hlsEvents.forEach(event => {
							try {
								currentHls.off(event);
							} catch (e) {
								// 忽略
							}
						});

						currentHls.stopLoad();
						currentHls.detachMedia();
						currentHls.destroy();
						console.log('✅ HLS 实例已完全销毁');
					} catch (e) {
						console.error('HLS销毁失败:', e);
					} finally {
						currentHls = null;
					}
				}

                // 创建新的HLS实例
                const hls = new Hls(hlsConfig);
                currentHls = hls;
                videoPlayer.hls = hls; // 🔥 绑定到 VideoPlayer 实例

                // 跟踪是否已经显示错误
                let errorDisplayed = false;
                // 跟踪是否有错误发生
                let errorCount = 0;
                // 跟踪视频是否开始播放
                let playbackStarted = false;
                // 跟踪视频是否出现bufferAppendError
                let bufferAppendErrorCount = 0;

                // 监听视频播放事件
                video.addEventListener('playing', function () {
                    playbackStarted = true;
                    document.getElementById('player-loading').style.display = 'none';
                    document.getElementById('error').style.display = 'none';
                });

                // 监听视频进度事件
                video.addEventListener('timeupdate', function () {
                    if (video.currentTime > 1) {
                        // 视频进度超过1秒，隐藏错误（如果存在）
                        document.getElementById('error').style.display = 'none';
                    }
                });

                hls.loadSource(url);
                hls.attachMedia(video);

                // ============================================
				// 🎬 YouTube 风格的智能缓冲管理
				// 策略：只清理用户不会再看的内容
				// ============================================
				// 🔥 使用 videoPlayer 实例的缓冲管理状态
				const bufferState = videoPlayer.hlsBufferState;

				// 监听暂停事件
				const pauseHandler = () => {
					bufferState.pauseStartTime = Date.now();
				};
				video.addEventListener('pause', pauseHandler);

				// 监听播放事件
				const playHandler = () => {
					bufferState.pauseStartTime = 0;
				};
				video.addEventListener('play', playHandler);

				hls.on(Hls.Events.FRAG_BUFFERED, () => {
					const now = Date.now();

					// 每 5 分钟检查一次（降低检查频率）
					if (now - bufferState.lastBufferCheck < 300000) return;
					bufferState.lastBufferCheck = now;

					if (!hls.media || hls.media.buffered.length === 0) return;

					const buffered = hls.media.buffered.end(hls.media.buffered.length - 1);
					const current = hls.media.currentTime;
					const bufferAhead = buffered - current;

					try {
						// ============================================
						// 🎯 策略 1：暂停超过 5 分钟，清理 10 分钟前的内容
						// ============================================
						if (hls.media.paused && bufferState.pauseStartTime > 0) {
							const pauseDuration = now - bufferState.pauseStartTime;

							if (pauseDuration > 5 * 60 * 1000 && bufferAhead > 600) {
								const cleanEnd = Math.max(0, current - 600);

								if (cleanEnd > 0 && now - bufferState.lastCleanupTime > 5 * 60 * 1000) {
									// ✅ 静默清理
									hls.trigger(Hls.Events.BUFFER_FLUSHING, {
										startOffset: 0,
										endOffset: cleanEnd,
										type: 'video'
									});

									bufferState.lastCleanupTime = now;
								}
							}
						}

						// ============================================
						// 🎯 策略 2：内存严重不足时（85%+）才清理
						// ============================================
						if (performance.memory) {
							const memoryUsage = performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit;

							if (memoryUsage > 0.85 && bufferAhead > 300) {
								const cleanEnd = Math.max(0, current - 180);

								if (cleanEnd > 0) {
									// ✅ 静默清理
									hls.trigger(Hls.Events.BUFFER_FLUSHING, {
										startOffset: 0,
										endOffset: cleanEnd,
										type: 'video'
									});

									bufferState.lastCleanupTime = now;
								}
							}
						}

					} catch (e) {
						// 静默失败
					}
				});

                // enable airplay, from https://github.com/video-dev/hls.js/issues/5989
                // 检查是否已存在source元素，如果存在则更新，不存在则创建
                let sourceElement = video.querySelector('source');
                if (sourceElement) {
                    // 更新现有source元素的URL
                    sourceElement.src = videoUrl;
                } else {
                    // 创建新的source元素
                    sourceElement = document.createElement('source');
                    sourceElement.src = videoUrl;
                    video.appendChild(sourceElement);
                }
                video.disableRemotePlayback = false;

                hls.on(Hls.Events.MANIFEST_PARSED, function () {
                    if (isWatchRoomLaunch()) {
                        console.log('[WatchRoomAudit] skip hls manifest autoplay for watch room mode', {
                            role: getWatchRoomLaunchRole()
                        });
                        return;
                    }

                    video.play().catch(e => {
                    });
                });

                hls.on(Hls.Events.ERROR, function (event, data) {
                    // 增加错误计数
                    errorCount++;

                    // 处理bufferAppendError
                    if (data.details === 'bufferAppendError') {
                        bufferAppendErrorCount++;
                        // 如果视频已经开始播放，则忽略这个错误
                        if (playbackStarted) {
                            return;
                        }

                        // 如果出现多次bufferAppendError但视频未播放，尝试恢复
                        if (bufferAppendErrorCount >= 3) {
                            hls.recoverMediaError();
                        }
                    }

                    // 如果是致命错误，且视频未播放
                    if (data.fatal && !playbackStarted) {
                        // 尝试恢复错误
                        switch (data.type) {
                            case Hls.ErrorTypes.NETWORK_ERROR:
                                hls.startLoad();
                                break;
                            case Hls.ErrorTypes.MEDIA_ERROR:
                                hls.recoverMediaError();
                                break;
                            default:
                                // 仅在多次恢复尝试后显示错误
                                if (errorCount > 3 && !errorDisplayed) {
                                    errorDisplayed = true;
                                    showError('视频加载失败，可能是格式不兼容或源不可用');
                                }
                                break;
                        }
                    }
                });

                // 监听分段加载事件
                hls.on(Hls.Events.FRAG_LOADED, function () {
                    document.getElementById('player-loading').style.display = 'none';
                });

                // 监听级别加载事件
                hls.on(Hls.Events.LEVEL_LOADED, function () {
                    document.getElementById('player-loading').style.display = 'none';
                });
            }
        }
    });

    window.LibertyPlayer = window.LibertyPlayer || {};
    window.LibertyPlayer.art = art;
    applyInlineVideoAttributes(art.video);
    bindPlayerViewportRefresh();
    document.dispatchEvent(new CustomEvent('liberty:player-ready', {
        detail: { art }
    }));

    // 🔥 绑定到 VideoPlayer 实例
    videoPlayer.art = art;

    // artplayer 没有 'fullscreenWeb:enter', 'fullscreenWeb:exit' 等事件
    // 所以原控制栏隐藏代码并没有起作用
    // 实际起作用的是 artplayer 默认行为，它支持自动隐藏工具栏
    // 但有一个 bug： 在副屏全屏时，鼠标移出副屏后不会自动隐藏工具栏
    // 下面进一并重构和修复：
    let hideTimer;

    // 隐藏控制栏
    function hideControls() {
        if (art && art.controls) {
            art.controls.show = false;
        }
    }

    // 重置计时器，计时器超时时间与 artplayer 保持一致
    function resetHideTimer() {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
            hideControls();
        }, Artplayer.CONTROL_HIDE_TIME);
    }

    // 处理鼠标离开浏览器窗口
    function handleMouseOut(e) {
        if (e && !e.relatedTarget) {
            resetHideTimer();
        }
    }

    // 全屏状态切换时注册/移除 mouseout 事件，监听鼠标移出屏幕事件
    // 从而对播放器状态栏进行隐藏倒计时
    function handleFullScreen(isFullScreen, isWeb) {
        if (isFullScreen) {
            document.addEventListener('mouseout', handleMouseOut);

            // ✅ 移动端横屏锁定（只在原生全屏时）
            if (isMobileDevice && !isWeb && window.screen?.orientation) {
                window.screen.orientation.lock('landscape')
                    .then(() => console.log('✅ 已锁定横屏'))
                    .catch((error) => console.warn('⚠️ 横屏锁定失败:', error));
            }
        } else {
            document.removeEventListener('mouseout', handleMouseOut);
            clearTimeout(hideTimer);

            // ✅ 退出全屏时解锁方向
            if (isMobileDevice && window.screen?.orientation) {
                try {
                    window.screen.orientation.unlock();
                    console.log('✅ 已解锁屏幕方向');
                } catch (e) {
                    console.warn('⚠️ 解锁屏幕方向失败:', e);
                }
            }
        }
    }

	art.on('ready', () => {
		hideControls();
		applyInlineVideoAttributes(art.video);
		refreshPlayerViewport('art-ready');

		// ✅ 监听弹幕插件配置变更，持久化用户设置
		// ArtPlayer 弹幕插件会在用户通过设置面板修改时触发 artplayerPluginDanmuku:config
		art.on('artplayerPluginDanmuku:config', (config) => {
		    const toSave = {};
		    if (config.speed !== undefined) toSave.speed = config.speed;
		    if (config.opacity !== undefined) toSave.opacity = config.opacity;
		    if (config.fontSize !== undefined) toSave.fontSize = config.fontSize;
		    if (config.color !== undefined) toSave.color = config.color;
		    if (config.mode !== undefined) toSave.mode = config.mode;
		    if (Object.keys(toSave).length > 0) {
		        saveDanmuConfig(toSave);
		        console.debug('✅ 弹幕显示设置已保存:', toSave);;
		    }
		});

		// ============================================
		// 📱 移动端双击全屏（只绑定一次）
		// ============================================
		if (isMobileDevice && art.video) {
			art.video.addEventListener('dblclick', () => {
				art.fullscreen = !art.fullscreen;
				art.play();
			});
		}

		// ============================================
		// 🎯 Netflix 风格：用户跳转时激进清理 + 弹幕同步
		// ============================================
		let lastSeekTime = 0;

		art.on('seek', (currentTime) => {
			const now = Date.now();

			// 1️⃣ Netflix 风格：激进清理旧缓冲
			if (currentHls && currentHls.media) {
				const cleanEnd = Math.max(0, currentTime - 180); // 清理 3 分钟前

				if (cleanEnd > 5) {
					try {
						currentHls.trigger(Hls.Events.BUFFER_FLUSHING, {
							startOffset: 0,
							endOffset: cleanEnd,
							type: 'video'
						});
					} catch (e) {
						// 静默失败
					}
				}
			}

			// 2️⃣ 弹幕智能防抖同步
			const timeSinceLastSeek = now - lastSeekTime;
			const debounceDelay = timeSinceLastSeek < 500 ? 300 : 100;

			lastSeekTime = now;

			videoPlayer.setTimer('seekDebounce', () => {
				const danmukuPlugin = art.plugins.artplayerPluginDanmuku;
				if (danmukuPlugin && typeof danmukuPlugin.seek === 'function') {
					danmukuPlugin.seek(currentTime);
				}
			}, debounceDelay);
		});

		// ===== 🔥 使用 VideoPlayer 管理定时器 =====
		let lastSyncTime = 0;

		// ✅ 定期校准弹幕（只在偏差超过 120 秒时才强制 seek，避免频繁重绘导致闪烁）
		videoPlayer.setTimer('danmuSync', () => {
			if (!art || !art.video || art.video.paused) {
				return; // 暂停时不校准，避免不必要的重绘
			}

			const currentTime = art.video.currentTime;
			const timeDiff = Math.abs(currentTime - lastSyncTime);

			// ✅ 提高阈值到 120 秒，减少不必要的 seek 重绘
			if (timeDiff > 120) {
				const danmukuPlugin = art.plugins.artplayerPluginDanmuku;
				if (danmukuPlugin && typeof danmukuPlugin.seek === 'function') {
					danmukuPlugin.seek(currentTime);
					lastSyncTime = currentTime;
					console.log(`🎯 弹幕定期校准: ${currentTime.toFixed(0)}s`);
				}
			} else {
				// 正常播放中，只更新记录，不触发 seek
				lastSyncTime = currentTime;
			}
		}, 60000, true);

		// 播放器销毁时清理
		art.on('destroy', () => {
			videoPlayer.clearTimer('danmuSync');
			// HLS 缓冲管理变量会在 destroyHls() 中自动重置
		});

		// ===== 【优化】自动保存播放历史（Netflix 风格）=====
		(function setupAutoSaveHistory() {
			// 1️⃣ 每 180 秒自动保存（3 分钟）
			videoPlayer.setTimer('autoSaveHistory', () => {
				if (art && art.video && !art.video.paused) {
					saveToHistory(); // 静默保存
				}
			}, 180000, true); // 3 分钟，使用 setInterval

			// 2️⃣ 暂停时立即保存
			art.on('video:pause', () => {
				if (art.video && !art.video.seeking) {
					saveToHistory(true);
				}
			});

			// 3️⃣ 结束时立即保存
			art.on('video:ended', () => {
				saveToHistory(true);
			});

			// 4️⃣ 页面隐藏时立即保存
			const visibilityHandler = () => {
				if (document.hidden) {
					saveToHistory(true);
				}
			};
			document.addEventListener('visibilitychange', visibilityHandler);

			// 5️⃣ 页面卸载时立即保存
			const beforeUnloadHandler = () => {
				saveToHistory(true);
			};
			window.addEventListener('beforeunload', beforeUnloadHandler);

			// 清理
			art.on('destroy', () => {
				videoPlayer.clearTimer('autoSaveHistory');
				document.removeEventListener('visibilitychange', visibilityHandler);
				window.removeEventListener('beforeunload', beforeUnloadHandler);
			});
		})();

		// ===== 【双重保障 Pro版】防息屏方案 =====
		// 🔥 使用 VideoPlayer 实例的防息屏方法

		// 事件绑定
		art.on('video:play', () => videoPlayer.requestWakeLock());
		art.on('video:pause', () => {
			if (!art.video.seeking) videoPlayer.releaseWakeLock();
		});
		art.on('video:ended', () => videoPlayer.releaseWakeLock());

		// 页面可见性处理
		const handleVisibilityChange = () => {
			if (document.visibilityState === 'visible') {
				if (art.video && !art.video.paused) {
					videoPlayer.requestWakeLock();
				}
			} else {
				videoPlayer.releaseWakeLock();
			}
		};
		document.addEventListener('visibilitychange', handleVisibilityChange);

		// 清理
		art.on('destroy', () => {
			if (videoPlayer) {
				videoPlayer.releaseWakeLock();
			}
			document.removeEventListener('visibilitychange', handleVisibilityChange);
		});

		// ============================================
		// 📱 移动端横屏自动全屏
		// ============================================
		if (isMobileDevice) {
			const handleOrientationChange = () => {
				if (window.matchMedia("(orientation: landscape)").matches) {
					if (art.playing && !art.fullscreen) {
						setTimeout(() => {
							art.fullscreen = true;
						}, 300);
					}
				}
			};

			if (window.screen?.orientation) {
				window.screen.orientation.addEventListener('change', handleOrientationChange);
			} else {
				window.addEventListener('orientationchange', handleOrientationChange);
			}
		}
	});

    // 全屏 Web 模式处理
    art.on('fullscreenWeb', function (isFullScreen) {
        handleFullScreen(isFullScreen, true);

        // 进入网页全屏时，确保焦点在播放器上，使快捷键生效
        if (isFullScreen) {
            const playerContainer = document.getElementById('player');
            if (playerContainer) {
                playerContainer.setAttribute('tabindex', '0');
                playerContainer.focus();
            }
        }
    });

    // 全屏模式处理
    art.on('fullscreen', function (isFullScreen) {
        handleFullScreen(isFullScreen, false);
    });

    // ⭐⭐⭐ 在这里添加 video:loadedmetadata 事件处理 ⭐⭐⭐
    art.on('video:loadedmetadata', function() {
        document.getElementById('player-loading').style.display = 'none';
        videoHasEnded = false;
        const urlParams = new URLSearchParams(window.location.search);
        const savedPosition = parseInt(urlParams.get('position') || '0');
        const watchRoomLaunch = isWatchRoomLaunch();

        // ✅ 优先尝试从临时保存的进度恢复（切换源时使用）
        // 一起看观众必须以房间 playback 为准，不能被本机历史进度覆盖。
        let restoredPosition = savedPosition;
        const tempProgressKey = `videoProgress_temp_${currentVideoTitle}_${currentEpisodeIndex}`;
        if (!watchRoomLaunch) {
            try {
                const tempProgress = localStorage.getItem(tempProgressKey);
                if (tempProgress) {
                    const progress = JSON.parse(tempProgress);
                    if (progress.position > 10 && Date.now() - progress.timestamp < 60000) {
                        restoredPosition = Math.max(restoredPosition, progress.position);
                    }
                    localStorage.removeItem(tempProgressKey);
                }
            } catch (e) {
                console.error('读取临时进度失败:', e);
            }
        } else {
            console.log('[WatchRoomAudit] watch room mode', {
                roomId: sessionStorage.getItem('watchRoomId') || '',
                role: sessionStorage.getItem('watchRoomRole') || '',
            });
        }

        if (restoredPosition > 10 && restoredPosition < art.duration - 2) {
            art.currentTime = restoredPosition;
            showPositionRestoreHint(restoredPosition);
        } else if (!watchRoomLaunch) {
            try {
                const progressKey = 'videoProgress_' + getVideoId();
                const progressStr = localStorage.getItem(progressKey);
                if (progressStr && art.duration > 0) {
                    const progress = JSON.parse(progressStr);
                    if (
                        progress &&
                        typeof progress.position === 'number' &&
                        progress.position > 10 &&
                        progress.position < art.duration - 2
                    ) {
                        art.currentTime = progress.position;
                        restoredPosition = progress.position;
                        showPositionRestoreHint(progress.position);
                    }
                }
            } catch (e) {
                console.error('恢复播放进度失败:', e);
            }
        } else {
            console.log('[WatchRoomAudit] skip local progress restore for watch room viewer', {
                savedPosition,
                restoredPosition
            });
        }

        // 加载弹幕
        if (isDanmuServiceEnabled() && art.plugins.artplayerPluginDanmuku) {
            const loadDanmaku = async () => {
                try {
                    console.log('🎬 开始加载弹幕...');

                    const danmuku = await getDanmukuForVideo(
                        currentVideoTitle, 
                        currentEpisodeIndex,
                    );

                    if (!danmuku || danmuku.length === 0) {
                        console.warn('⚠ 未找到弹幕，继续播放视频');
                        return;
                    }

                    console.log(`📦 获取到 ${danmuku.length} 条弹幕，全量加载`);

                    const waitForVideoReady = (maxWait = 10000) => {
						return new Promise((resolve) => {
							const start = Date.now();
							let cancelled = false;

							// 播放器销毁时立即终止轮询
							const cancelWait = () => { cancelled = true; resolve(); };
							if (art) art.once('destroy', cancelWait);

							const checkReady = () => {
								if (cancelled) return;

								if (!art || !art.video) {
									resolve();
									return;
								}

								if (art.video.readyState >= 2) {
									if (art) art.off('destroy', cancelWait);
									resolve();
									return;
								}

								if (Date.now() - start > maxWait) {
									console.warn('⚠️ waitForVideoReady 超时，继续加载弹幕');
									if (art) art.off('destroy', cancelWait);
									resolve();
									return;
								}

								setTimeout(checkReady, 50);
							};
							checkReady();
						});
					};

                    await waitForVideoReady();
                    console.log('✅ 视频已准备好，开始加载弹幕');

                    const danmukuPlugin = art.plugins.artplayerPluginDanmuku;
                    if (typeof danmukuPlugin.clear === 'function') {
                        danmukuPlugin.clear();
                    }

                    // 直接加载全部弹幕
                    danmukuPlugin.config({
                        danmuku: danmuku,
                        synchronousPlayback: true
                    });
                    danmukuPlugin.load();

                    await new Promise(resolve => setTimeout(resolve, 100));

                    const currentTime = art.video.currentTime || restoredPosition || 0;
                    if (currentTime > 0 && typeof danmukuPlugin.seek === 'function') {
                        danmukuPlugin.seek(currentTime);
                        console.log(`🎯 弹幕同步到: ${currentTime.toFixed(2)}s`);
                    }

                    console.log(`✅ 已加载第${currentEpisodeIndex + 1}集弹幕: ${danmuku.length}条`);

                } catch (e) {
                    console.error('❌ 弹幕加载失败:', e);
                }
            };

            loadDanmaku();
        }

        startProgressSaveInterval();
    });

    // 错误处理
    art.on('video:error', function (error) {
        // 如果正在切换视频，忽略错误
        if (window.isSwitchingVideo) {
            return;
        }

        // 隐藏所有加载指示器
        const loadingElements = document.querySelectorAll('#player-loading, .player-loading-container');
        loadingElements.forEach(el => {
            if (el) el.style.display = 'none';
        });

        showError('视频播放失败: ' + (error.message || '未知错误'));
    });

    // 添加移动端长按三倍速播放功能
    setupLongPressSpeedControl();

    // 视频播放结束事件
    art.on('video:ended', function () {
        videoHasEnded = true;

        clearVideoProgress();

        // 如果自动播放下一集开启，且确实有下一集
        if (autoplayEnabled && currentEpisodeIndex < currentEpisodes.length - 1) {
            // 稍长延迟以确保所有事件处理完成
            setTimeout(() => {
                // 确认不是因为用户拖拽导致的假结束事件
                playNextEpisode();
                videoHasEnded = false; // 重置标志
            }, 1000);
        } else {
            art.fullscreen = false;
        }
    });

    // ============================================
    // 📱 移动端控制栏自动隐藏
    // ============================================
    if (isMobileDevice && art) {
        let mobileControlsTimer;

        const hideMobileControls = () => {
            if (art.fullscreen && art.playing) {
                art.controls = false;
            }
        };

        const showMobileControls = () => {
            art.controls = true;
            clearTimeout(mobileControlsTimer);
            mobileControlsTimer = setTimeout(hideMobileControls, 3000);
        };

        // 监听触摸事件
        const playerElement = document.getElementById('player');
        if (playerElement) {
            playerElement.addEventListener('touchstart', showMobileControls);
        }
    }

    // 10秒后如果仍在加载，但不立即显示错误
    setTimeout(function () {
        // 如果视频已经播放开始，则不显示错误
        if (art && art.video && art.video.currentTime > 0) {
            return;
        }

        const loadingElement = document.getElementById('player-loading');
        if (loadingElement && loadingElement.style.display !== 'none') {
            loadingElement.innerHTML = `
                <div class="loading-spinner"></div>
                <div>视频加载时间较长，请耐心等待...</div>
                <div style="font-size: 12px; color: #aaa; margin-top: 10px;">如长时间无响应，请尝试其他视频源</div>
            `;
        }
    }, 10000);

// ============================================
    // 🎬 B站方案：温和的内存监控（移到这里）
    // ============================================
    if (performance.memory && videoPlayer && !videoPlayer.timers.autoCleanup) {
        videoPlayer.setTimer('autoCleanup', () => {
            const usage = performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit;

            // 🔥 只在内存真的爆了（95%）才清理
            if (usage > 0.95) {
                console.warn('🚨 内存严重不足，执行紧急清理');

                // 只清理非当前视频的详情缓存
                const currentKey = `anime_${currentDanmuAnimeId}`;
                for (const [key] of tempDetailCache.entries()) {
                    if (key !== currentKey) {
                        tempDetailCache.delete(key);
                    }
                }

                // 提示浏览器GC
                if (window.gc) window.gc();
            }
        }, 60000, true); // 每分钟检查一次
    }

    console.log('✅ 播放器初始化完成');
// 🔥 输出初始化后的状态
    if (videoPlayer) {
        setTimeout(() => videoPlayer.logStatus(), 1000);
    }
}

// 自定义M3U8 Loader用于过滤广告
class CustomHlsJsLoader extends Hls.DefaultConfig.loader {
    constructor(config) {
        super(config);
        const load = this.load.bind(this);
        this.load = function (context, config, callbacks) {
            // 拦截manifest和level请求
            if (context.type === 'manifest' || context.type === 'level') {
                const onSuccess = callbacks.onSuccess;
                callbacks.onSuccess = function (response, stats, context) {
                    // 如果是m3u8文件，处理内容以移除广告分段
                    if (response.data && typeof response.data === 'string') {
                        // 过滤掉广告段 - 实现更精确的广告过滤逻辑
                        response.data = filterAdsFromM3U8(response.data, true);
                    }
                    return onSuccess(response, stats, context);
                };
            }
            // 执行原始load方法
            load(context, config, callbacks);
        };
    }
}

// 过滤可疑的广告内容
function filterAdsFromM3U8(m3u8Content, strictMode = false) {
    if (!m3u8Content) return '';

    // 按行分割M3U8内容
    const lines = m3u8Content.split('\n');
    const filteredLines = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // 只过滤#EXT-X-DISCONTINUITY标识
        if (!line.includes('#EXT-X-DISCONTINUITY')) {
            filteredLines.push(line);
        }
    }

    return filteredLines.join('\n');
}


// 显示错误
function showError(message) {
    // 在视频已经播放的情况下不显示错误
    if (art && art.video && art.video.currentTime > 1) {
        return;
    }
    const loadingEl = document.getElementById('player-loading');
    if (loadingEl) loadingEl.style.display = 'none';
    const errorEl = document.getElementById('error');
    if (errorEl) errorEl.style.display = 'flex';
    const errorMsgEl = document.getElementById('error-message');
    if (errorMsgEl) errorMsgEl.textContent = message;
}

// 更新集数信息
function updateEpisodeInfo() {
    if (currentEpisodes.length > 0) {
        document.getElementById('episodeInfo').textContent = `第 ${currentEpisodeIndex + 1}/${currentEpisodes.length} 集`;
    } else {
        document.getElementById('episodeInfo').textContent = '无集数信息';
    }
}

// 更新按钮状态
function updateButtonStates() {
    const prevButton = document.getElementById('prevButton');
    const nextButton = document.getElementById('nextButton');

    // 处理上一集按钮
    if (currentEpisodeIndex > 0) {
        prevButton.classList.remove('bg-gray-700', 'cursor-not-allowed');
        prevButton.classList.add('bg-[#222]', 'hover:bg-[#333]');
        prevButton.removeAttribute('disabled');
    } else {
        prevButton.classList.add('bg-gray-700', 'cursor-not-allowed');
        prevButton.classList.remove('bg-[#222]', 'hover:bg-[#333]');
        prevButton.setAttribute('disabled', '');
    }

    // 处理下一集按钮
    if (currentEpisodeIndex < currentEpisodes.length - 1) {
        nextButton.classList.remove('bg-gray-700', 'cursor-not-allowed');
        nextButton.classList.add('bg-[#222]', 'hover:bg-[#333]');
        nextButton.removeAttribute('disabled');
    } else {
        nextButton.classList.add('bg-gray-700', 'cursor-not-allowed');
        nextButton.classList.remove('bg-[#222]', 'hover:bg-[#333]');
        nextButton.setAttribute('disabled', '');
    }
}

// 渲染集数按钮
function renderEpisodes() {
    const episodesList = document.getElementById('episodesList');
    if (!episodesList) return;

    if (!currentEpisodes || currentEpisodes.length === 0) {
        episodesList.innerHTML = '<div class="col-span-full text-center text-gray-400 py-8">没有可用的集数</div>';
        return;
    }

    const episodes = episodesReversed ? [...currentEpisodes].reverse() : currentEpisodes;
    let html = '';

    episodes.forEach((episode, index) => {
        // 根据倒序状态计算真实的剧集索引
        const realIndex = episodesReversed ? currentEpisodes.length - 1 - index : index;
        const isActive = realIndex === currentEpisodeIndex;

        html += `
            <button id="episode-${realIndex}" 
                    onclick="playEpisode(${realIndex})" 
                    class="px-4 py-2 ${isActive ? 'episode-active' : '!bg-[#222] hover:!bg-[#333] hover:!shadow-none'} !border ${isActive ? '!border-blue-500' : '!border-[#333]'} rounded-lg transition-colors text-center episode-btn">
                ${realIndex + 1}
            </button>
        `;
    });

    episodesList.innerHTML = html;
}

// 播放指定集数
function playEpisode(index) {
    // 确保index在有效范围内
    if (index < 0 || index >= currentEpisodes.length) {
        return;
    }

    // 切换前清理旧资源
    console.log('🔄 准备切换集数，清理旧资源...');

    // 清理历史记录防抖定时器，防止旧集数写入
	if (saveHistoryTimer) {
		clearTimeout(saveHistoryTimer);
		saveHistoryTimer = null;
	}

	currentDanmuCache = { episodeIndex: -1, danmuList: null, timestamp: 0 };
	if (videoPlayer) videoPlayer.clearDanmuCache();

	// 切集时重置用户手动选择的弹幕源，下一集恢复自动搜索
	currentDanmuAnimeId = null;
	currentDanmuSourceName = '';

    if (art && art.plugins && art.plugins.artplayerPluginDanmuku) {
        try {
            const danmukuPlugin = art.plugins.artplayerPluginDanmuku;
            if (typeof danmukuPlugin.clear === 'function') danmukuPlugin.clear();
        } catch (e) {
            console.error('❌ 清空弹幕失败:', e);
        }
    }

    // 保存当前播放进度（如果正在播放）
    if (art && art.video && !art.video.paused && !videoHasEnded) {
        saveCurrentProgress();
    }

    // 清除进度保存计时器
    if (progressSaveInterval) {
        clearInterval(progressSaveInterval);
        progressSaveInterval = null;
    }

    // 准备切换剧集的URL
    const url = getPlayerEpisodeUrlValue(currentEpisodes[index]);

    // 首先隐藏之前可能显示的错误
    document.getElementById('error').style.display = 'none';
    // 显示加载指示器
    document.getElementById('player-loading').style.display = 'flex';
    document.getElementById('player-loading').innerHTML = `
        <div class="loading-spinner"></div>
        <div>正在加载视频...</div>
    `;

    // 更新当前剧集索引
    currentEpisodeIndex = index;
    currentVideoUrl = url;
    videoHasEnded = false;

    clearVideoProgress();

    // ✅ 更新URL参数（不刷新页面）
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.set('index', index);
    currentUrl.searchParams.set('url', url);
    currentUrl.searchParams.delete('position');
    window.history.replaceState({}, '', currentUrl.toString());

    // 【关键修改】检测是否为 webkit 浏览器（Safari）
	if (isWebkit) {
		// WebKit分支切集前先显式销毁旧HLS，防止资源泄漏
		if (videoPlayer) videoPlayer.destroyHls();
		currentHls = null;
		initPlayer(url);
	} else {
		if (videoPlayer) {
			videoPlayer.clearTimer('autoSaveHistory');
			videoPlayer.clearTimer('danmuSync');
			videoPlayer.clearTimer('progressSave');
			videoPlayer.clearTimer('seekDebounce');
		}

		// 🔥 关键：切集前强制停止旧HLS，再等一帧
		if (currentHls) {
			currentHls.stopLoad();
			currentHls.detachMedia();
		}

		requestAnimationFrame(() => {
			art.switch = url;
		});
	}

    // 更新UI
    updateEpisodeInfo();
    updateButtonStates();
    renderEpisodes();

    // 重置用户点击位置记录
    if (typeof userClickedPosition !== 'undefined') {
        userClickedPosition = null;
    }

    // 【新增】超时保护：如果10秒后仍在加载，尝试重新初始化播放器
    setTimeout(() => {
		const loadingElement = document.getElementById('player-loading');
		if (loadingElement && loadingElement.style.display !== 'none') {
			console.warn('⚠️ 视频加载超时，尝试重新初始化播放器');
			// 先置 null，防止 videoPlayer.destroy() 内部二次销毁已销毁的 art 实例
			art = null;
			currentHls = null;
			initPlayer(url);
		}
	}, 10000);

    // 三秒后保存到历史记录
    setTimeout(() => saveToHistory(), 3000);
}

// 播放上一集
function playPreviousEpisode() {
    if (currentEpisodeIndex > 0) {
        playEpisode(currentEpisodeIndex - 1);
    }
}

// 播放下一集
function playNextEpisode() {
    if (currentEpisodeIndex < currentEpisodes.length - 1) {
        playEpisode(currentEpisodeIndex + 1);
    }
}

// 复制播放链接
function copyLinks() {
    // 尝试从URL中获取参数
    const urlParams = new URLSearchParams(window.location.search);
    const linkUrl = urlParams.get('url') || '';
    if (linkUrl !== '') {
        navigator.clipboard.writeText(linkUrl).then(() => {
            showToast('播放链接已复制', 'success');
        }).catch(err => {
            showToast('复制失败，请检查浏览器权限', 'error');
        });
    }
}

// 切换集数排序
function toggleEpisodeOrder() {
    episodesReversed = !episodesReversed;

    // 保存到localStorage
    localStorage.setItem('episodesReversed', episodesReversed);

    // 重新渲染集数列表
    renderEpisodes();

    // 更新排序按钮
    updateOrderButton();
}

// 更新排序按钮状态
function updateOrderButton() {
    const orderText = document.getElementById('orderText');
    const orderIcon = document.getElementById('orderIcon');

    if (orderText && orderIcon) {
        orderText.textContent = episodesReversed ? '正序排列' : '倒序排列';
        orderIcon.style.transform = episodesReversed ? 'rotate(180deg)' : '';
    }
}

// ===== 【优化】历史记录保存机制 =====
let saveHistoryTimer = null;
let lastHistorySaveTime = 0; // 记录上次保存时间
let lastSavedPosition = 0; // 记录上次保存的位置

function saveToHistory(forceImmediate = false) {
    // 静默模式：只在强制保存时才输出日志
    const DEBUG_HISTORY = false; // 设置为 true 可以看到调试日志

    // 清除旧的定时器（强制保存时也要清理，防止5秒后再写入错误数据）
    if (saveHistoryTimer) {
        clearTimeout(saveHistoryTimer);
        saveHistoryTimer = null;
    }

    const doSave = () => {
        if (!currentEpisodes || currentEpisodes.length === 0) {
            if (DEBUG_HISTORY) console.warn('[历史记录] ❌ 没有集数信息');
            return false;
        }

        if (!currentVideoUrl) {
            if (DEBUG_HISTORY) console.warn('[历史记录] ❌ 没有视频URL');
            return false;
        }

        if (typeof(Storage) === "undefined") {
            return false;
        }

        try {
            const urlParams = new URLSearchParams(window.location.search);
            const sourceName = urlParams.get('source') || '';
            const sourceCode = urlParams.get('source') || '';
            const id_from_params = urlParams.get('id');

            // ✅ 获取当前播放位置
            let currentPosition = 0;
            let videoDuration = 0;

            if (art && art.video) {
                currentPosition = Math.max(0, art.video.currentTime || 0);
                videoDuration = art.video.duration || 0;

                // ✅ Netflix 风格防抖：位置变化小于 60 秒且距离上次保存不到 120 秒，跳过
				const timeSinceLastSave = Date.now() - lastHistorySaveTime;
				const positionChange = Math.abs(currentPosition - lastSavedPosition);

				if (!forceImmediate && timeSinceLastSave < 120000 && positionChange < 60) {
					if (DEBUG_HISTORY) console.log('[历史记录] ⏭️ 跳过保存（变化不大）');
					return false;
				}

                if (DEBUG_HISTORY) console.log(`[历史记录] 位置: ${currentPosition.toFixed(0)}s / ${videoDuration.toFixed(0)}s`);
            }

            const videoInfo = {
                title: currentVideoTitle,
                directVideoUrl: currentVideoUrl,
                url: `player.html?url=${encodeURIComponent(currentVideoUrl)}&title=${encodeURIComponent(currentVideoTitle)}&source=${encodeURIComponent(sourceName)}&source_code=${encodeURIComponent(sourceCode)}&id=${encodeURIComponent(id_from_params || '')}&index=${currentEpisodeIndex}&position=${Math.floor(currentPosition)}`,
                episodeIndex: currentEpisodeIndex,
                sourceName: sourceName,
                vod_id: id_from_params || '',
                sourceCode: sourceCode,
                timestamp: Date.now(),
                playbackPosition: currentPosition,
                duration: videoDuration,
                episodes: currentEpisodes && currentEpisodes.length > 0 ? [...currentEpisodes] : []
            };

            const history = JSON.parse(localStorage.getItem('viewingHistory') || '[]');
            const existingIndex = history.findIndex(item => item.title === videoInfo.title);

            if (existingIndex !== -1) {
                // 更新现有记录
                const existingItem = history[existingIndex];
                existingItem.episodeIndex = videoInfo.episodeIndex;
                existingItem.timestamp = videoInfo.timestamp;
                existingItem.sourceName = videoInfo.sourceName;
                existingItem.sourceCode = videoInfo.sourceCode;
                existingItem.vod_id = videoInfo.vod_id;
                existingItem.directVideoUrl = videoInfo.directVideoUrl;
                existingItem.url = videoInfo.url;
                existingItem.playbackPosition = currentPosition;
                existingItem.duration = videoDuration || existingItem.duration;

                if (videoInfo.episodes && videoInfo.episodes.length > 0) {
                    existingItem.episodes = [...videoInfo.episodes];
                }

                const updatedItem = history.splice(existingIndex, 1)[0];
                history.unshift(updatedItem);

                // 只在强制保存或DEBUG模式时输出日志
                if (DEBUG_HISTORY) {
                    console.debug(`[历史记录] 更新 第${videoInfo.episodeIndex + 1}集`);
                }
            } else {
                history.unshift(videoInfo);
                if (DEBUG_HISTORY) {
                    console.debug(`[历史记录] 新增 第${videoInfo.episodeIndex + 1}集`);
                }
            }

            if (history.length > 50) history.splice(50);

            localStorage.setItem('viewingHistory', JSON.stringify(history));

            // 更新保存时间和位置
            lastHistorySaveTime = Date.now();
            lastSavedPosition = currentPosition;

            return true;

        } catch (e) {
            console.error('[历史记录] 保存失败:', e);
            return false;
        }
    };

    // ✅ 防抖处理
    if (forceImmediate) {
        return doSave(); // 立即保存
    }

    saveHistoryTimer = setTimeout(doSave, 5000); // Netflix 风格：5 秒防抖
}
// ===== 【结束】优化历史记录保存 =====

// 显示恢复位置提示
function showPositionRestoreHint(position) {
    if (!position || position < 10) return;

    // 创建提示元素
    const hint = document.createElement('div');
    hint.className = 'position-restore-hint';
    hint.innerHTML = `
        <div class="hint-content">
            已从 ${formatTime(position)} 继续播放
        </div>
    `;

    // 添加到播放器容器
    const playerContainer = document.querySelector('.player-container'); // Ensure this selector is correct
    if (playerContainer) { // Check if playerContainer exists
        playerContainer.appendChild(hint);
    } else {
        return; // Exit if container not found
    }

    // 显示提示
    setTimeout(() => {
        hint.classList.add('show');

        // 3秒后隐藏
        setTimeout(() => {
            hint.classList.remove('show');
            setTimeout(() => hint.remove(), 300);
        }, 3000);
    }, 100);
}

// 格式化时间为 mm:ss 格式
function formatTime(seconds) {
    if (isNaN(seconds)) return '00:00';

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);

    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
}

// 开始定期保存播放进度
function startProgressSaveInterval() {
    if (!videoPlayer) return;

    // 清除可能存在的旧计时器（向后兼容）
    if (progressSaveInterval) {
        clearInterval(progressSaveInterval);
        progressSaveInterval = null;
    }
    if (timers.progressSave) {
        clearInterval(timers.progressSave);
        timers.progressSave = null;
    }

    // 每60秒保存一次播放进度
    videoPlayer.setTimer('progressSave', saveCurrentProgress, 60000, true);
}

// 保存当前播放进度
function saveCurrentProgress() {
    if (!art || !art.video) return;
    const currentTime = art.video.currentTime;
    const duration = art.video.duration;

    if (!duration || currentTime < 1) return;

    const progressKey = `videoProgress_${getVideoId()}`;
    try {
        localStorage.setItem(progressKey, JSON.stringify({
            position: currentTime,
            duration: duration,
            timestamp: Date.now()
        }));
    } catch (e) {
        reportError('进度保存', '保存播放进度失败', { error: e.message });
    }
}
// 设置移动端长按三倍速播放功能（B站风格）
function setupLongPressSpeedControl() {
    if (!art || !art.video || !videoPlayer) return;

    const playerElement = document.getElementById('player');

    // 🔥 先清理之前绑定的监听器，防止切集时叠加
    if (_longPressHandlers) {
        playerElement.removeEventListener('touchstart', _longPressHandlers.touchstart);
        playerElement.removeEventListener('touchmove', _longPressHandlers.touchmove);
        playerElement.removeEventListener('touchend', _longPressHandlers.touchend);
        playerElement.removeEventListener('touchcancel', _longPressHandlers.touchcancel);
        // 同时清理 video 上的监听器
        if (art && art.video) {
            if (_longPressHandlers.videoPause) art.video.removeEventListener('pause', _longPressHandlers.videoPause);
            if (_longPressHandlers.videoEnded) art.video.removeEventListener('ended', _longPressHandlers.videoEnded);
        }
        _longPressHandlers = null;
    }

    let originalPlaybackRate = 1.0;
    let isLongPress = false;
    let touchStartTime = 0;
    let touchMoved = false;

    // 速度指示器（和原来一样，保持不变）
    let speedIndicator = null;
    function createSpeedIndicator() {
        if (!speedIndicator) {
            speedIndicator = document.createElement('div');
            speedIndicator.style.cssText = `
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: rgba(0, 0, 0, 0.8);
                color: white;
                padding: 12px 20px;
                border-radius: 8px;
                font-size: 16px;
                font-weight: bold;
                z-index: 9999;
                pointer-events: none;
                opacity: 0;
                transition: opacity 0.2s;
            `;
            playerElement.appendChild(speedIndicator);
        }
        return speedIndicator;
    }

    function showSpeedIndicator(speed) {
        const indicator = createSpeedIndicator();
        indicator.textContent = `${speed}x`;
        indicator.style.opacity = '1';
    }

    function hideSpeedIndicator() {
        if (speedIndicator) {
            speedIndicator.style.opacity = '0';
        }
    }

    // 禁用移动端右键菜单（和原来一样）
    playerElement.oncontextmenu = () => {
        if (isMobileDevice) {
            return false;
        }
        return true;
    };

    // 🔥 用具名函数，方便后续 removeEventListener
    const _touchstartHandler = function (e) {
        if (art.video.paused) return;

        touchStartTime = Date.now();
        touchMoved = false;
        originalPlaybackRate = art.video.playbackRate;

        videoPlayer.setTimer('longPress', () => {
            if (!art.video.paused) {
                art.video.playbackRate = 3.0;
                isLongPress = true;
                showSpeedIndicator(3.0);

                if (navigator.vibrate) {
                    navigator.vibrate(50);
                }
            }
        }, 500);
    };

    const _touchmoveHandler = function (e) {
        if (!isLongPress) {
            touchMoved = true;
            videoPlayer.clearTimer('longPress');
        }

        if (isLongPress) {
            e.preventDefault();
        }
    };

    const _touchendHandler = function (e) {
        videoPlayer.clearTimer('longPress');

        if (isLongPress) {
            art.video.playbackRate = originalPlaybackRate;
            isLongPress = false;
            hideSpeedIndicator();

            e.preventDefault();
            e.stopPropagation();
        }

        touchMoved = false;
    };

    const _touchcancelHandler = function () {
        videoPlayer.clearTimer('longPress');

        if (isLongPress) {
            art.video.playbackRate = originalPlaybackRate;
            isLongPress = false;
            hideSpeedIndicator();
        }
    };

    // 🔥 注册监听器
    playerElement.addEventListener('touchstart', _touchstartHandler, { passive: true });
    playerElement.addEventListener('touchmove', _touchmoveHandler, { passive: false });
    playerElement.addEventListener('touchend', _touchendHandler);
    playerElement.addEventListener('touchcancel', _touchcancelHandler);

    // 🔥 保存引用，供下次调用时清理
    _longPressHandlers = {
        touchstart: _touchstartHandler,
        touchmove: _touchmoveHandler,
        touchend: _touchendHandler,
        touchcancel: _touchcancelHandler
    };

    // 视频暂停/结束时重置，使用具名函数防止切集叠加
    const _pauseResetHandler = function () {
        if (isLongPress) {
            art.video.playbackRate = originalPlaybackRate;
            isLongPress = false;
            hideSpeedIndicator();
        }
        videoPlayer.clearTimer('longPress');
    };

    const _endedResetHandler = function () {
        if (isLongPress) {
            art.video.playbackRate = originalPlaybackRate;
            isLongPress = false;
            hideSpeedIndicator();
        }
    };

    art.video.addEventListener('pause', _pauseResetHandler);
    art.video.addEventListener('ended', _endedResetHandler);

    // 保存引用到 _longPressHandlers 方便下次清理
    _longPressHandlers.videoPause = _pauseResetHandler;
    _longPressHandlers.videoEnded = _endedResetHandler;
}

// 清除视频进度记录
function clearVideoProgress() {
    const progressKey = `videoProgress_${getVideoId()}`;
    try {
        localStorage.removeItem(progressKey);
    } catch (e) {
    }
}

// 获取视频唯一标识
function getVideoId() {
    // 使用视频标题和集数索引作为唯一标识
    // If currentVideoUrl is available and more unique, prefer it. Otherwise, fallback.
    if (currentVideoUrl) {
        return `${encodeURIComponent(currentVideoUrl)}`;
    }
    return `${encodeURIComponent(currentVideoTitle)}_${currentEpisodeIndex}`;
}

let controlsLocked = false;
function toggleControlsLock() {
    const container = document.getElementById('playerContainer');
    controlsLocked = !controlsLocked;
    container.classList.toggle('controls-locked', controlsLocked);
    const icon = document.getElementById('lockIcon');
    // 切换图标：锁 / 解锁
    icon.innerHTML = controlsLocked
        ? '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d=\"M12 15v2m0-8V7a4 4 0 00-8 0v2m8 0H4v8h16v-8H6v-6z\"/>'
        : '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d=\"M15 11V7a3 3 0 00-6 0v4m-3 4h12v6H6v-6z\"/>';
}

// 支持在iframe中关闭播放器
function closeEmbeddedPlayer() {
    try {
        if (window.self !== window.top) {
            // 如果在iframe中，尝试调用父窗口的关闭方法
            if (window.parent && typeof window.parent.closeVideoPlayer === 'function') {
                window.parent.closeVideoPlayer();
                return true;
            }
        }
    } catch (e) {
        console.error('尝试关闭嵌入式播放器失败:', e);
    }
    return false;
}

function renderResourceInfoBar() {
    // 获取容器元素
    const container = document.getElementById('resourceInfoBarContainer');
    if (!container) {
        console.error('找不到资源信息卡片容器');
        return;
    }

    // 获取当前视频 source_code
    const urlParams = new URLSearchParams(window.location.search);
    const currentSource = urlParams.get('source') || '';

    // 显示临时加载状态
    container.innerHTML = `
      <div class="resource-info-bar-left flex">
        <span>加载中...</span>
        <span class="resource-info-bar-videos">-</span>
      </div>
      <button class="resource-switch-btn flex" id="switchResourceBtn" onclick="showSwitchResourceModal()">
        <span class="resource-switch-icon">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 4v16m0 0l-6-6m6 6l6-6" stroke="#a67c2d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
        切换资源
      </button>
    `;

    // 查找当前源名称，从 API_SITES 和 custom_api 中查找即可
    let resourceName = currentSource
    if (currentSource && API_SITES[currentSource]) {
        resourceName = API_SITES[currentSource].name;
    }
    if (resourceName === currentSource) {
        const customAPIs = JSON.parse(localStorage.getItem('customAPIs') || '[]');
        const customIndex = parseInt(currentSource.replace('custom_', ''), 10);
        if (customAPIs[customIndex]) {
            resourceName = customAPIs[customIndex].name || '自定义资源';
        }
    }

    container.innerHTML = `
      <div class="resource-info-bar-left flex">
        <span>${resourceName}</span>
        <span class="resource-info-bar-videos">${currentEpisodes.length} 个视频</span>
      </div>
      <button class="resource-switch-btn flex" id="switchResourceBtn" onclick="showSwitchResourceModal()">
        <span class="resource-switch-icon">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 4v16m0 0l-6-6m6 6l6-6" stroke="#a67c2d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
        切换资源
      </button>
    `;
}

// 测试视频源速率的函数
async function testVideoSourceSpeed(sourceKey, vodId) {
    try {
        const startTime = performance.now();

        // 构建API参数
        let apiParams = '';
        if (sourceKey.startsWith('custom_')) {
            const customIndex = sourceKey.replace('custom_', '');
            const customApi = getCustomApiInfo(customIndex);
            if (!customApi) {
                return { speed: -1, error: 'API配置无效' };
            }
            if (customApi.detail) {
                apiParams = '&customApi=' + encodeURIComponent(customApi.url) + '&customDetail=' + encodeURIComponent(customApi.detail) + '&source=custom';
            } else {
                apiParams = '&customApi=' + encodeURIComponent(customApi.url) + '&source=custom';
            }
        } else {
            apiParams = '&source=' + sourceKey;
        }

        // 添加时间戳防止缓存
        const timestamp = new Date().getTime();
        const cacheBuster = `&_t=${timestamp}`;

        // 获取视频详情
        const response = await fetch(`/api/detail?id=${encodeURIComponent(vodId)}${apiParams}${cacheBuster}`, {
            method: 'GET',
            cache: 'no-cache'
        });

        if (!response.ok) {
            return { speed: -1, error: '获取失败' };
        }

        const data = await response.json();

        if (!data.episodes || data.episodes.length === 0) {
            return { speed: -1, error: '无播放源' };
        }

        // 测试第一个播放链接的响应速度
        const firstEpisodeUrl = getPlayerEpisodeUrlValue(data.episodes[0]);
        if (!firstEpisodeUrl) {
            return { speed: -1, error: '链接无效' };
        }

        // 测试视频链接响应时间
        const videoTestStart = performance.now();
        try {
            const videoResponse = await fetch(firstEpisodeUrl, {
                method: 'HEAD',
                mode: 'no-cors',
                cache: 'no-cache',
                signal: AbortSignal.timeout(5000) // 5秒超时
            });

            const videoTestEnd = performance.now();
            const totalTime = videoTestEnd - startTime;

            // 返回总响应时间（毫秒）
            return { 
                speed: Math.round(totalTime),
                episodes: data.episodes.length,
                error: null 
            };
        } catch (videoError) {
            // 如果视频链接测试失败，只返回API响应时间
            const apiTime = performance.now() - startTime;
            return { 
                speed: Math.round(apiTime),
                episodes: data.episodes.length,
                error: null,
                note: 'API响应' 
            };
        }

    } catch (error) {
        return { 
            speed: -1, 
            error: error.name === 'AbortError' ? '超时' : '测试失败' 
        };
    }
}

// 格式化速度显示
function formatSpeedDisplay(speedResult) {
    if (speedResult.speed === -1) {
        return `<span class="speed-indicator error">❌ ${speedResult.error}</span>`;
    }

    const speed = speedResult.speed;
    let className = 'speed-indicator good';
    let icon = '🟢';

    if (speed > 2000) {
        className = 'speed-indicator poor';
        icon = '🔴';
    } else if (speed > 1000) {
        className = 'speed-indicator medium';
        icon = '🟡';
    }

    const note = speedResult.note ? ` (${speedResult.note})` : '';
    return `<span class="${className}">${icon} ${speed}ms${note}</span>`;
}

async function showSwitchResourceModal() {
    const urlParams = new URLSearchParams(window.location.search);
    const currentSourceCode = urlParams.get('source');
    const currentVideoId = urlParams.get('id');

    const modal = document.getElementById('modal');
    const modalTitle = document.getElementById('modalTitle');
    const modalContent = document.getElementById('modalContent');

    modalTitle.innerHTML = `<span class="break-words">${currentVideoTitle}</span>`;
    modalContent.innerHTML = '<div style="text-align:center;padding:20px;color:#aaa;grid-column:1/-1;">正在加载资源列表...</div>';
    modal.classList.remove('hidden');

    // 搜索
    const resourceOptions = selectedAPIs.map((curr) => {
        if (API_SITES[curr]) {
            return { key: curr, name: API_SITES[curr].name };
        }
        const customIndex = parseInt(curr.replace('custom_', ''), 10);
        if (customAPIs[customIndex]) {
            return { key: curr, name: customAPIs[customIndex].name || '自定义资源' };
        }
        return { key: curr, name: '未知资源' };
    });
    let allResults = {};
   await Promise.all(resourceOptions.map(async (opt) => {
        let queryResult = await searchByAPIAndKeyWord(opt.key, currentVideoTitle);
        if (queryResult.length == 0) {
            return 
        }
        // 优先取完全同名资源，否则默认取第一个
        let result = queryResult[0]
        queryResult.forEach((res) => {
            if (res.vod_name == currentVideoTitle) {
                result = res;
            }
        })
        allResults[opt.key] = result;
    }));

    // 更新状态显示：开始速率测试
    modalContent.innerHTML = '<div style="text-align:center;padding:20px;color:#aaa;grid-column:1/-1;">正在测试各资源速率...</div>';

    // 同时测试所有资源的速率
    const speedResults = {};
    await Promise.all(Object.entries(allResults).map(async ([sourceKey, result]) => {
        if (result) {
            speedResults[sourceKey] = await testVideoSourceSpeed(sourceKey, result.vod_id);
        }
    }));

    // 对结果进行排序
    const sortedResults = Object.entries(allResults).sort(([keyA, resultA], [keyB, resultB]) => {
        // 当前播放的源放在最前面
        const isCurrentA = String(keyA) === String(currentSourceCode) && String(resultA.vod_id) === String(currentVideoId);
        const isCurrentB = String(keyB) === String(currentSourceCode) && String(resultB.vod_id) === String(currentVideoId);

        if (isCurrentA && !isCurrentB) return -1;
        if (!isCurrentA && isCurrentB) return 1;

        // 其余按照速度排序，速度快的在前面（速度为-1表示失败，排到最后）
        const speedA = speedResults[keyA]?.speed || 99999;
        const speedB = speedResults[keyB]?.speed || 99999;

        if (speedA === -1 && speedB !== -1) return 1;
        if (speedA !== -1 && speedB === -1) return -1;
        if (speedA === -1 && speedB === -1) return 0;

        return speedA - speedB;
    });

    // 渲染资源列表
    let html = '<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 p-4">';

    for (const [sourceKey, result] of sortedResults) {
        if (!result) continue;

        // 修复 isCurrentSource 判断，确保类型一致
        const isCurrentSource = String(sourceKey) === String(currentSourceCode) && String(result.vod_id) === String(currentVideoId);
        const sourceName = resourceOptions.find(opt => opt.key === sourceKey)?.name || '未知资源';
        const speedResult = speedResults[sourceKey] || { speed: -1, error: '未测试' };

        html += `
            <div class="relative group ${isCurrentSource ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:scale-105 transition-transform'}" 
                 ${!isCurrentSource ? `onclick="switchToResource('${sourceKey}', '${result.vod_id}')"` : ''}>
                <div class="aspect-[2/3] rounded-lg overflow-hidden bg-gray-800 relative">
                    <img src="${result.vod_pic}" 
                         alt="${result.vod_name}"
                         class="w-full h-full object-cover"
                         onerror="this.src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjNjY2IiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHJlY3QgeD0iMyIgeT0iMyIgd2lkdGg9IjE4IiBoZWlnaHQ9IjE4IiByeD0iMiIgcnk9IjIiPjwvcmVjdD48cGF0aCBkPSJNMjEgMTV2NGEyIDIgMCAwIDEtMiAySDVhMiAyIDAgMCAxLTItMnYtNCI+PC9wYXRoPjxwb2x5bGluZSBwb2ludHM9IjE3IDggMTIgMyA3IDgiPjwvcG9seWxpbmU+PHBhdGggZD0iTTEyIDN2MTIiPjwvcGF0aD48L3N2Zz4='">
                    
                    <!-- 速率显示在图片右上角 -->
                    <div class="absolute top-1 right-1 speed-badge bg-black bg-opacity-75">
                        ${formatSpeedDisplay(speedResult)}
                    </div>
                </div>
                <div class="mt-2">
                    <div class="text-xs font-medium text-gray-200 truncate">${result.vod_name}</div>
                    <div class="text-[10px] text-gray-400 truncate">${sourceName}</div>
                    <div class="text-[10px] text-gray-500 mt-1">
                        ${speedResult.episodes ? `${speedResult.episodes}集` : ''}
                    </div>
                </div>
                ${isCurrentSource ? `
                    <div class="absolute inset-0 flex items-center justify-center">
                        <div class="bg-blue-600 bg-opacity-75 rounded-lg px-2 py-0.5 text-xs text-white font-medium">
                            当前播放
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    }

    html += '</div>';
    modalContent.innerHTML = html;
}

// 智能缓存清理（只清理当前视频的缓存）
function cleanCurrentVideoCache() {
    try {
        console.log('🔄 清理当前视频的缓存...');

        const cleanTitle = sanitizeTitle(currentVideoTitle);
        const titleHash = simpleHash(cleanTitle);

        const cacheKey = `anime_*`; // 无法精确定位，清理所有
        tempDetailCache.clear();
        console.log('✅ 已清理临时缓存');

        // 清理当前视频的弹幕缓存
		currentDanmuCache = {
			episodeIndex: -1,
			danmuList: null,
			timestamp: 0
		};
		if (videoPlayer) videoPlayer.clearDanmuCache();

        // ✅ 不再使用 currentDanmuAnimeId
        localStorage.removeItem(`danmuSource_${titleHash}`);

        console.log('✅ 已清理当前视频缓存（保留其他视频缓存）');
    } catch (e) {
        console.warn('清理缓存失败:', e);
    }
}

// 切换资源的函数
async function switchToResource(sourceKey, vodId) {
    // 关闭模态框
    document.getElementById('modal').classList.add('hidden');

    showLoading();
    try {
        // 构建API参数
        let apiParams = '';

        // 处理自定义API源
        if (sourceKey.startsWith('custom_')) {
            const customIndex = sourceKey.replace('custom_', '');
            const customApi = getCustomApiInfo(customIndex);
            if (!customApi) {
                showToast('自定义API配置无效', 'error');
                hideLoading();
                return;
            }
            // 传递 detail 字段
            if (customApi.detail) {
                apiParams = '&customApi=' + encodeURIComponent(customApi.url) + '&customDetail=' + encodeURIComponent(customApi.detail) + '&source=custom';
            } else {
                apiParams = '&customApi=' + encodeURIComponent(customApi.url) + '&source=custom';
            }
        } else {
            // 内置API
            apiParams = '&source=' + sourceKey;
        }

        // Add a timestamp to prevent caching
        const timestamp = new Date().getTime();
        const cacheBuster = `&_t=${timestamp}`;
        const response = await fetchWithRetry(`/api/detail?id=${encodeURIComponent(vodId)}${apiParams}${cacheBuster}`);

        const data = await response.json();

        const playableEpisodes = Array.isArray(data.episodes)
            ? data.episodes.map(getPlayerEpisodeUrlValue).filter(Boolean)
            : [];

        if (playableEpisodes.length === 0) {
            showToast('未找到播放资源', 'error');
            hideLoading();
            return;
        }

        // 获取当前播放的集数索引
        const currentIndex = currentEpisodeIndex;

        // 确定要播放的集数索引
        let targetIndex = 0;
        if (currentIndex < playableEpisodes.length) {
            // 如果当前集数在新资源中存在，则使用相同集数
            targetIndex = currentIndex;
        }

        // 获取目标集数的URL
        const targetUrl = playableEpisodes[targetIndex];

        // ✅ 保存当前播放进度
		let currentPlaybackTime = 0;
		if (art && art.video && !art.video.paused) {
			currentPlaybackTime = art.video.currentTime;
		}

		// ✅ 保存播放进度到临时存储
		try {
			const progressKey = `videoProgress_temp_${currentVideoTitle}_${targetIndex}`;
			localStorage.setItem(progressKey, JSON.stringify({
				position: currentPlaybackTime,
				timestamp: Date.now()
			}));
		} catch (e) {
			console.error('保存临时进度失败:', e);
		}

		// 构建播放页面URL，带上播放位置
		const watchUrl = `player.html?id=${vodId}&source=${sourceKey}&url=${encodeURIComponent(targetUrl)}&index=${targetIndex}&title=${encodeURIComponent(currentVideoTitle)}&position=${Math.floor(currentPlaybackTime)}`;

        // 保存当前状态到localStorage
        try {
            const playbackState = window.LibertyUtils?.playbackState;
            if (playbackState) {
                playbackState.writePlaybackSession({
                    title: data.vod_name || '未知视频',
                    sourceCode: sourceKey,
                    vodId,
                    episodeIndex: targetIndex,
                    episodes: playableEpisodes
                });
            } else {
                localStorage.setItem('currentVideoTitle', data.vod_name || '未知视频');
                localStorage.setItem('currentEpisodes', JSON.stringify(playableEpisodes));
                localStorage.setItem('currentEpisodeIndex', targetIndex);
                localStorage.setItem('currentSourceCode', sourceKey);
            }
            localStorage.setItem('lastPlayTime', Date.now());
        } catch (e) {
            console.error('保存播放状态失败:', e);
        }

        // 跳转到播放页面
        window.location.href = watchUrl;

    } catch (error) {
        console.error('切换资源失败:', error);
        showToast('切换资源失败，请稍后重试', 'error');
    } finally {
        hideLoading();
    }
}
// 显示弹幕源切换弹窗
async function showDanmuSourceModal() {
    if (!isDanmuServiceEnabled()) {
        showToast('弹幕功能未启用', 'error');
        return;
    }

    const modal = document.getElementById('danmuSourceModal');
    const modalContent = document.getElementById('danmuSourceList');

    // ✅ 直接显示加载状态（移除当前源卡片）
    modalContent.innerHTML = '<div class="text-center py-8 text-gray-400">正在搜索弹幕源...</div>';
    modal.classList.remove('hidden');

    // 🔥 调试日志
    console.log('🔍 当前弹幕源ID:', currentDanmuAnimeId);

    try {
        const cleanTitle = normalizeDanmuTitle(currentVideoTitle.replace(/\([^)]*\)/g, '').replace(/【[^】]*】/g, '').trim());
        const searchUrl = `${getDanmuBaseUrl()}/api/v2/search/anime?keyword=${encodeURIComponent(cleanTitle)}`;
        const authedSearchUrl = await addDanmuAuth(searchUrl);
		const searchResponse = await fetchWithRetry(authedSearchUrl, {}, 2, 12000);

        if (!searchResponse.ok) throw new Error('搜索失败');

        const searchData = await searchResponse.json();

        if (!searchData.animes || searchData.animes.length === 0) {
            modalContent.innerHTML = '<div class="text-center py-8 text-gray-400">未找到匹配的弹幕源</div>';
            return;
        }

        const allSources = searchData.animes.map(anime => ({
            animeId: anime.animeId,
            animeTitle: anime.animeTitle,
            type: anime.type || '未知类型',
            episodeCount: anime.episodeCount || 0,
            typeDescription: anime.typeDescription || '',
            score: 0
        }));

        // 计算相似度得分
        allSources.forEach(source => {
            let score = 0;
            const title = source.animeTitle.replace(/\([^)]*\)/g, '').replace(/【[^】]*】/g, '').trim();

            // 🔥 当前使用的源最优先
            if (currentDanmuAnimeId && source.animeId === currentDanmuAnimeId) {
                score += 10000;
            }
            if (title === currentVideoTitle) {
                score += 1000;
            }
            if (title.includes(cleanTitle)) {
                score += 500;
            }
            if (cleanTitle.includes(title)) {
                score += 300;
            }
            score += calculateSimilarity(title, cleanTitle) * 200;
            score += Math.min(source.episodeCount, 50);

            source.score = score;
        });

        allSources.sort((a, b) => b.score - a.score);

        // ✅ 全部弹幕源在一个列表中，高亮当前使用的
        let html = '<div class="space-y-2 max-h-[60vh] overflow-y-auto p-2">';

        allSources.forEach(source => {
		// 🔥 强制转换为字符串比较
		const isActive = (String(currentDanmuAnimeId) === String(source.animeId));
		const typeInfo = source.typeDescription || source.type;

		const similarity = calculateSimilarity(
			source.animeTitle.replace(/\([^)]*\)/g, '').trim(),
			cleanTitle
		);

		html += `
			<button
				onclick="switchDanmuSource('${source.animeId}', '${encodeURIComponent(source.animeTitle)}')"
				class="danmu-source-button w-full text-left px-4 py-3 rounded-lg transition-all ${
					isActive 
						? 'bg-blue-600 text-white shadow-lg border-2 border-blue-400' 
						: 'bg-gray-800 hover:bg-gray-700 text-gray-200 border-2 border-transparent'
				}">
                    <div class="flex items-center justify-between gap-2 min-w-0">
                        <div class="danmu-source-name font-medium min-w-0">${source.animeTitle}</div>
                        ${isActive ? '<span class="danmu-source-badge text-yellow-300 text-sm shrink-0">✓ 当前使用</span>' : ''}
                    </div>
                    <div class="danmu-source-meta text-sm opacity-75 mt-1">
                        ${typeInfo} · ${source.episodeCount} 集 · 相似度: ${(similarity * 100).toFixed(0)}%
                    </div>
                </button>
            `;
        });

        html += '</div>';
        modalContent.innerHTML = html;

    } catch (error) {
        console.error('加载弹幕源失败:', error);
        modalContent.innerHTML = '<div class="text-center py-8 text-red-400">加载失败，请重试</div>';
    }
}

// 关闭弹幕源弹窗
function closeDanmuSourceModal() {
    document.getElementById('danmuSourceModal').classList.add('hidden');
}

// 🚀 优化后的切换弹幕源函数（保留剧集获取，但使用缓存）
async function switchDanmuSource(animeId, encodedSourceName) {
    if (!art || !art.plugins.artplayerPluginDanmuku) {
        showToast('播放器未就绪', 'error');
        return;
    }

    const sourceName = encodedSourceName ? decodeURIComponent(encodedSourceName) : '未知源';

    const prevAnimeId = currentDanmuAnimeId;
    const prevSourceName = currentDanmuSourceName;

    const video = art.video;
    const shouldResume = !!(video && !video.paused && !video.ended);
    const currentTime = video ? video.currentTime : (art.currentTime || 0);

    currentDanmuAnimeId = animeId;
    currentDanmuSourceName = sourceName;
    
    document.getElementById('danmuSourceModal').classList.add('hidden');
    showToast(`正在切换至: ${sourceName}...`, 'info');

    try {
        currentDanmuCache = {
            episodeIndex: -1,
            danmuList: null,
            timestamp: 0
        };

        if (videoPlayer) {
            videoPlayer.clearDanmuCache();
        }

        const danmukuPlugin = art.plugins.artplayerPluginDanmuku;

        if (typeof danmukuPlugin.clear === 'function') {
            danmukuPlugin.clear();
        }

        if (typeof danmukuPlugin.config === 'function') {
            danmukuPlugin.config({
                danmuku: [],
                synchronousPlayback: true
            });
        }

        const cleanTitle = sanitizeTitle(currentVideoTitle);
        
        const episodes = await getAnimeEpisodesWithCache(animeId, cleanTitle);
        

        if (!episodes || episodes.length === 0) {
            showToast('该弹幕源暂无剧集信息', 'warning');

            const titleHash = simpleHash(cleanTitle);
            const context = getDanmuPlaybackContext(currentVideoTitle, currentEpisodeIndex);
            saveDanmuManualMapping(context.videoKey, {
                animeId,
                sourceName,
                title: cleanTitle,
            });
            localStorage.setItem(`danmuSource_${titleHash}`, JSON.stringify({
                animeId,
                sourceName,
                title: cleanTitle,
                timestamp: Date.now()
            }));
            

            return;
        }

        const matchedEpisode = pickMatchedDanmuEpisode(episodes, currentEpisodeIndex, currentVideoTitle);
        

        if (!matchedEpisode) {
            showToast(`无法为第${currentEpisodeIndex + 1}集匹配弹幕`, 'warning');
            return;
        }

        const context = getDanmuPlaybackContext(currentVideoTitle, currentEpisodeIndex);
        saveDanmuManualMapping(context.videoKey, {
            animeId,
            sourceName,
            episodeId: matchedEpisode.episodeId,
            episodeTitle: matchedEpisode.episodeTitle || '',
            title: cleanTitle,
        });

        const newDanmuku = await fetchDanmaku(matchedEpisode.episodeId, currentEpisodeIndex);

        if (!newDanmuku || newDanmuku.length === 0) {
            showToast('该弹幕源暂无弹幕', 'warning');
        } else {
            danmukuPlugin.config({
                danmuku: newDanmuku,
                synchronousPlayback: true
            });

            danmukuPlugin.load();

            await new Promise(resolve => setTimeout(resolve, 100));

            if (typeof danmukuPlugin.seek === 'function') {
                danmukuPlugin.seek(currentTime);
            }
            

            if (typeof danmukuPlugin.show === 'function') {
                danmukuPlugin.show();
            }

            showToast(`✓ 已切换到: ${sourceName} (${newDanmuku.length}条)`, 'success');
        }

        const titleHash = simpleHash(cleanTitle);
        localStorage.setItem(`danmuSource_${titleHash}`, JSON.stringify({
            animeId,
            sourceName,
            title: cleanTitle,
            timestamp: Date.now()
        }));

    } catch (error) {
        console.error('切换弹幕源失败:', error);
        showToast('切换弹幕源失败', 'error');

        currentDanmuAnimeId = prevAnimeId;
        currentDanmuSourceName = prevSourceName;
    } finally {
        
        // 保持当前播放时间，防止弹幕切换导致轻微跳动
        if (art && art.video && currentTime > 0 && Math.abs(art.video.currentTime - currentTime) > 2) {
            art.currentTime = currentTime;
        }

        // 如果切换前视频正在播放，就自动恢复播放
        if (shouldResume) {
            setTimeout(() => {
                try {
                    if (art && art.video && art.video.paused) {
                        const playResult = art.play();
                        if (playResult && typeof playResult.catch === 'function') {
                            playResult.catch(() => {
                                showToast('浏览器阻止自动播放，请手动点击播放', 'warning');
                            });
                        }
                    }
                } catch (e) {
                    console.warn('弹幕源切换后恢复播放失败:', e);
                }
            }, 150);
        }
    }
}

// ============================================
// 🐛 全局调试函数
// ============================================
window.debugPlayer = function() {
    if (videoPlayer) {
        console.log('=== VideoPlayer 状态 ===');
        videoPlayer.logStatus();
        console.log('\n=== 全局变量状态 ===');
        console.table({
            art: !!art,
            currentHls: !!currentHls,
            currentVideoTitle,
            currentEpisodeIndex,
            currentDanmuAnimeId,
            currentDanmuSourceName,
            danmuDisplayConfig: JSON.stringify(danmuDisplayConfig)
        });
    } else {
        console.warn('⚠️ videoPlayer 未初始化');
    }
};

window.cleanupPlayer = function() {
    if (videoPlayer) {
        videoPlayer.destroy();
        videoPlayer = null;
        console.log('✅ 播放器已手动清理');
    }
};

console.log('✅ 播放器修复补丁已加载');
console.log('💡 调试命令:');
console.log('   - debugPlayer() : 查看播放器状态');
console.log('   - cleanupPlayer() : 手动清理播放');

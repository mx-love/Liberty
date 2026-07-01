window.LibertyDebug = window.LibertyDebug || {
    enabled() {
        try {
            return localStorage.getItem('LIBRETV_DEBUG') === '1'
                || new URLSearchParams(window.location.search).get('debug') === '1';
        } catch (error) {
            return window.location.search.includes('debug=1');
        }
    },
    log(...args) {
        if (this.enabled()) console.log(...args);
    },
    warn(...args) {
        if (this.enabled()) console.warn(...args);
    },
    trace(...args) {
        if (this.enabled()) console.trace(...args);
    },
};

function isDanmuDebugEnabled() {
    try {
        return localStorage.getItem('LIBRETV_DANMU_DEBUG') === '1'
            || localStorage.getItem('LIBRETV_DEBUG') === '1'
            || new URLSearchParams(window.location.search).get('danmuDebug') === '1'
            || new URLSearchParams(window.location.search).get('debug') === '1';
    } catch (error) {
        return window.location.search.includes('danmuDebug=1')
            || window.location.search.includes('debug=1');
    }
}

function danmuDebugLog(...args) {
    if (isDanmuDebugEnabled()) console.log(...args);
}

function danmuDebugWarn(...args) {
    if (isDanmuDebugEnabled()) console.warn(...args);
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeJsString(value) {
    return String(value ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/</g, '\\x3C')
        .replace(/>/g, '\\x3E');
}

function getSafeImageUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
        const url = new URL(raw, window.location.href);
        return /^(https?:|data:image\/)/i.test(url.protocol === 'data:' ? raw : url.protocol)
            ? (url.protocol === 'data:' ? raw : url.href)
            : '';
    } catch (error) {
        return '';
    }
}

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
        'animeTitle': { prefix: 'title_', storage: localStorage }
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

        window.LibertyDebug.log(`✅ 已清理 ${type} 缓存`);
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
			window.LibertyDebug.log(`${isTimeout ? '超时' : '网络错误'} (尝试 ${i + 1}/${maxRetries})`);

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
    window.LibertyDebug.log('🧹 开始彻底清理资源...');

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

    window.LibertyDebug.log('✅ 资源清理完成');
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

function onVisibilityChange() {
    if (document.hidden) {
        pageWasHidden = true;
        window.LibertyDebug.log('页面已隐藏');

        saveCurrentProgress();

        // ✅ 只隐藏弹幕，不清空数据
        applyDanmakuVisibility('visibilitychange-hidden');

    } else if (pageWasHidden) {
        window.LibertyDebug.log('页面恢复可见');

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
                            window.LibertyDebug.log('🧹 清理幽灵视频元素');
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

                if (cachedDanmu && cachedDanmu.length > 0 && 
                    currentDanmuCache.episodeIndex === currentEpisodeIndex) {
                    // ✅ 使用缓存，不重新 config 避免闪烁，按用户开关状态恢复显示
                    applyDanmakuVisibility('visibility-restore-cache');
                    logDanmuVisibilityState('visibilitychange-restore-cache', {
                        loadedCount: cachedDanmu.length,
                        pluginApplied: true
                    });

                    danmuDebugLog('弹幕已恢复');
                } else {
                    // 缓存失效，重新获取
                    getDanmukuForVideo(currentVideoTitle, currentEpisodeIndex)
                        .then(danmuku => {
                            if (danmuku && danmuku.length > 0) {
                                applyDanmakuRuntimeState({
                                    reason: 'visibility-restore-reload',
                                    danmuku,
                                    reload: true,
                                }).then((applied) => {
                                    if (!applied) return;

                                    logDanmuVisibilityState('visibilitychange-restore-reload', {
                                        loadedCount: danmuku.length,
                                        pluginApplied: true
                                    });

                                    danmuDebugLog('弹幕已恢复（重新加载）');
                                });
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
let _mobileTouchInputHandlers = null;
let _mobileLongPressTriggered = false;
let _danmakuTouchPanelHandlers = null;
let _mobileOrientationFullscreenCleanup = null;
let currentHls = null; // 跟踪当前HLS实例
let currentEpisodes = [];
let episodesReversed = false;
let autoplayEnabled = true; // 默认开启自动连播
let videoHasEnded = false; // 跟踪视频是否已经自然结束
let shortcutHintTimeout = null; // 用于控制快捷键提示显示时间
let adFilteringEnabled = true; // 默认开启广告过滤
let progressSaveInterval = null; // 定期保存进度的计时器
let currentVideoUrl = ''; // 记录当前实际的视频URL
let isApplyingWatchRoomEpisodeSnapshot = false;
let pendingWatchRoomEpisodeChangeId = '';
const isWebkit = (typeof window.webkitConvertPointFromNodeToPage === 'function')
// ===== 【新增】移动端设备检测 =====
const isMobileDevice = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
const isIOSDevice = /iPhone|iPad|iPod/i.test(navigator.userAgent);
const isAndroidDevice = /Android/i.test(navigator.userAgent);
// ===== 【结束】移动端设备检测 =====

let playerViewportRefreshBound = false;
let playerViewportRefreshTimer = null;
let danmakuLayoutRefreshTimer = null;
const FULLSCREEN_DEBUG_STORAGE_KEY = 'LIBRETV_FULLSCREEN_DEBUG';

function getDocumentFullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function logFullscreenDebug(reason, error = null) {
    try {
        if (localStorage.getItem(FULLSCREEN_DEBUG_STORAGE_KEY) !== '1') return;
    } catch (_) {
        return;
    }

    const player = art?.template?.$player || null;
    const describeNode = (node) => {
        if (!node) return null;
        if (typeof node.className === 'string' && node.className.trim()) {
            return node.className;
        }
        return node.tagName || null;
    };
    console.debug('[LibreTV fullscreen]', {
        reason,
        artFullscreen: Boolean(art?.fullscreen),
        artFullscreenWeb: Boolean(art?.fullscreenWeb),
        documentFullscreenElement: describeNode(getDocumentFullscreenElement()),
        playerClass: typeof player?.className === 'string' ? player.className : null,
        playerParent: describeNode(player?.parentElement || null),
        requestError: error ? {
            name: error.name || null,
            message: error.message || String(error),
        } : null,
    });
}

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
                let didResize = false;
                applyInlineVideoAttributes(art?.video);
                if (isMobileDevice && art && 'mini' in art) {
                    art.mini = false;
                }
                if (art && typeof art.resize === 'function') {
                    art.resize();
                    didResize = true;
                }
                logDanmakuRuntimeDebug(reason, {
                    calledHelper: 'refreshPlayerViewport',
                    didResize,
                    eventType: 'viewport',
                });
                scheduleDanmakuLayoutRefresh(reason);
            } catch (error) {
                console.warn('播放器尺寸刷新失败:', reason, error);
                logDanmakuRuntimeDebug(reason, {
                    calledHelper: 'refreshPlayerViewport',
                    failed: true,
                    error: error?.message || String(error),
                });
            }
        });
    }, 120);
}

function bindPlayerViewportRefresh() {
    if (playerViewportRefreshBound) return;
    playerViewportRefreshBound = true;

    window.addEventListener('resize', () => refreshPlayerViewport('resize'));
    window.addEventListener('orientationchange', () => refreshPlayerViewport('orientationchange'));
    document.addEventListener('fullscreenchange', () => {
        logFullscreenDebug('document-fullscreenchange');
        refreshPlayerViewport('fullscreenchange');
    });
    document.addEventListener('webkitfullscreenchange', () => {
        logFullscreenDebug('document-fullscreenchange');
        refreshPlayerViewport('webkitfullscreenchange');
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            refreshPlayerViewport('visibilitychange');
        }
    });
    window.addEventListener('pageshow', () => refreshPlayerViewport('pageshow'));
}

function cleanupDanmakuTouchPanels(expectedArt = null) {
    if (!_danmakuTouchPanelHandlers) return;
    if (expectedArt && _danmakuTouchPanelHandlers.art !== expectedArt) return;

    _danmakuTouchPanelHandlers.documentEvents.forEach(({ type, listener, options }) => {
        document.removeEventListener(type, listener, options);
    });

    _danmakuTouchPanelHandlers.roots.forEach(({ root, listener }) => {
        root.classList.remove('libretv-touch-panel-open');
        root.removeEventListener('click', listener);
    });

    _danmakuTouchPanelHandlers = null;
}

function setupDanmakuTouchPanels() {
    if (!isMobileDevice || !art?.template?.$player) return;

    cleanupDanmakuTouchPanels();

    const playerRoot = art.template.$player;
    const panelRoots = [
        {
            root: playerRoot.querySelector('.artplayer-plugin-danmuku .apd-config'),
            panelSelector: '.apd-config-panel',
        },
        {
            root: playerRoot.querySelector('.artplayer-plugin-danmuku .apd-style'),
            panelSelector: '.apd-style-panel',
        },
    ].filter(({ root }) => Boolean(root));

    if (!panelRoots.length) return;

    const artInstance = art;
    const isWithin = (target, node) => Boolean(
        target &&
        node &&
        (target === node || (typeof node.contains === 'function' && node.contains(target)))
    );

    const closeAllPanels = (exceptRoot = null) => {
        panelRoots.forEach(({ root }) => {
            if (root !== exceptRoot) {
                root.classList.remove('libretv-touch-panel-open');
            }
        });
    };

    const outsidePointerHandler = (event) => {
        if (art !== artInstance || artInstance.isDestroy) return;

        const target = event.target;
        const isInsideAnyPanelRoot = panelRoots.some(({ root }) => isWithin(target, root));
        if (!isInsideAnyPanelRoot) {
            closeAllPanels();
        }
    };

    const documentEvents = [];
    const outsideEventTypes = window.PointerEvent ? ['pointerdown'] : ['touchstart', 'mousedown'];
    outsideEventTypes.forEach((type) => {
        document.addEventListener(type, outsidePointerHandler, true);
        documentEvents.push({ type, listener: outsidePointerHandler, options: true });
    });

    panelRoots.forEach((entry) => {
        const { root, panelSelector } = entry;
        const rootClickHandler = (event) => {
            if (art !== artInstance || artInstance.isDestroy) return;
            if (event.target.closest(panelSelector)) return;

            event.preventDefault();
            event.stopPropagation();

            const willOpen = !root.classList.contains('libretv-touch-panel-open');
            closeAllPanels(willOpen ? root : null);
            root.classList.toggle('libretv-touch-panel-open', willOpen);
        };

        root.addEventListener('click', rootClickHandler);
        entry.listener = rootClickHandler;
    });

    _danmakuTouchPanelHandlers = {
        art: artInstance,
        documentEvents,
        roots: panelRoots,
    };

    artInstance.on('destroy', () => {
        cleanupDanmakuTouchPanels(artInstance);
    });
}

function cleanupMobileOrientationFullscreen() {
    if (typeof _mobileOrientationFullscreenCleanup === 'function') {
        _mobileOrientationFullscreenCleanup();
    }
    _mobileOrientationFullscreenCleanup = null;
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

const MAX_DANMAKU = 6666;

function limitDanmakuList(list = []) {
    if (!Array.isArray(list)) return [];
    return list.length > MAX_DANMAKU ? list.slice(0, MAX_DANMAKU) : list;
}

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
    if (year) parts.push(String(year));

    if (season || episode) {
        const seasonPart = `S${String(season || 1).padStart(2, '0')}`;
        const episodePart = episode ? `E${String(episode).padStart(2, '0')}` : '';
        parts.push(`${seasonPart}${episodePart}`);
    }
    if (platform) parts.push(`@${platform}`);

    return parts.filter(Boolean).join(' ');
}

function buildDanmuMatchQueries(context) {
    const cleanTitle = normalizeDanmuTitle(context.title);
    const episode = Number(context.episode || 0);
    const season = Number(context.season || 1);
    const seasonEpisode = episode
        ? `S${String(season || 1).padStart(2, '0')}E${String(episode).padStart(2, '0')}`
        : '';
    const platform = context.platform ? `@${context.platform}` : '';

    const variants = [];

    if (cleanTitle && context.year && seasonEpisode) {
        variants.push([cleanTitle, context.year, seasonEpisode, platform]);
    }

    if (cleanTitle && seasonEpisode) {
        variants.push([cleanTitle, seasonEpisode, platform]);
    }

    if (cleanTitle && episode) {
        variants.push([cleanTitle, `第${episode}集`, platform]);
    }

    if (cleanTitle && !variants.length) {
        variants.push([cleanTitle, platform]);
    }

    return [...new Set(
        variants
            .map(parts => parts.filter(Boolean).join(' ').trim())
            .filter(Boolean)
    )];
}

function buildDanmuVideoKey(title, year, season, episode) {
    return [
        normalizeDanmuTitle(title),
        year || '',
        season ? `S${season}` : '',
        episode ? `E${episode}` : '',
    ].join('|');
}

function getDanmuPlaybackContext(title, episodeIndex) {
    const params = new URLSearchParams(window.location.search);
    const contextTitle = title || currentVideoTitle || '';
    const normalizedTitle = getDanmuSearchKeyword(contextTitle);
    const year =
        params.get('year') ||
        advancedCleanTitle(contextTitle).year ||
        '';
    const sourceCode =
        params.get('source') ||
        params.get('source_code') ||
        localStorage.getItem('currentSourceCode') ||
        localStorage.getItem('currentPlayingSource') ||
        '';
    const vodId =
        params.get('id') ||
        params.get('vod_id') ||
        localStorage.getItem('currentVideoId') ||
        '';
    const episodeName = getCurrentEpisodeName(episodeIndex);
    const season = guessSeasonNumber(title);
    const episode = guessEpisodeNumber(episodeIndex, episodeName);
    const platform = inferDanmuPlatform(currentVideoUrl, sourceCode);
    const duration = getCurrentVideoDuration();
    const episodeCount = Array.isArray(currentEpisodes) ? currentEpisodes.length : 0;

    const context = {
        title: contextTitle,
        normalizedTitle,
        year,
        episodeIndex,
        displayEpisode: episodeIndex + 1,
        season,
        episode,
        episodeName,
        episodeCount,
        playUrl: currentVideoUrl,
        currentVideoUrl,
        sourceCode,
        vodId,
        platform,
        duration,
        videoKey: buildDanmuVideoKey(contextTitle, year, season, episode),
    };

    danmuDebugLog('[DanmuDebug] playback context', context);
    return context;
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
        danmuDebugWarn(
            `⚠️ match 接口返回的集数与当前播放集不一致：当前第${targetNumber}集，拒绝错配结果`,
            analyzed.map(item => ({
                title: item.title,
                parsedEpisode: item.episodeNumber,
                episodeId: item.match.episodeId
            }))
        );
        return null;
    }

    // match 接口已经按当前集 query 返回明确 episodeId 时，不再设置额外高分门槛。
    // 只有候选自身带有明确且错误的集数时才拒绝，避免第 N 集加载到其他集。
    danmuDebugWarn(`⚠️ match 候选没有明确集数，按接口明确 episodeId 使用：`, list[0]);
    return list[0];
}

async function matchDanmuByApi(title, episodeIndex) {
    if (!DANMU_CONFIG.adaptive?.enableMatchApi || !isDanmuServiceEnabled()) return null;

    const context = getDanmuPlaybackContext(title, episodeIndex);
    const matchQueries = buildDanmuMatchQueries(context);
    const matchUrl = await addDanmuAuth(`${getDanmuBaseUrl()}/api/v2/match`);

    for (const fileName of matchQueries) {
        try {
            danmuDebugLog(`🎯 使用 danmu_api match 自动匹配: ${fileName}`);

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
                    episodeCount: context.episodeCount || undefined,
                    sourceCode: context.sourceCode || undefined,
                    vodId: context.vodId || undefined,
                    platform: context.platform || undefined,
                    url: context.playUrl || undefined,
                    duration: context.duration || undefined
                })
            }, 2, 15000);

            const data = await response.json();
            danmuDebugLog('[DanmuDebug] match candidate results', {
                fileName,
                matches: data?.matches || []
            });
            const match = pickValidDanmuApiMatch(data?.matches, episodeIndex);

            if (data?.isMatched && match?.episodeId) {
                danmuDebugLog('✅ match 自动匹配成功:', {
                    matchQuery: fileName,
                    animeTitle: match.animeTitle,
                    episodeTitle: match.episodeTitle,
                    episodeId: match.episodeId
                });

                return {
                    ...match,
                    matchQuery: fileName
                };
            }
        } catch (e) {
            console.warn('⚠️ match 接口失败，尝试下一个 query:', {
                matchQuery: fileName,
                error: e.message
            });
        }
    }

    danmuDebugWarn('[DanmuDebug] match 自动匹配失败，等待用户手动选择弹幕源', {
        matchQueries
    });
    return null;
}

// 弹幕缓存 - 只缓存当前集
let currentDanmuCache = {
    episodeIndex: -1,
    danmuList: null,
    timestamp: 0
};
let danmuReloadToken = 0;
let lastDanmuMatchInfo = null;
let lastDanmuFetchStats = null;
let lastDanmuAutoFallbackStats = null;

// ✅ 恢复弹幕源追踪
let currentDanmuAnimeId = null;
let currentDanmuSourceName = '';
let currentSessionDanmuSource = null;
const sessionDanmuBangumiNegativeCache = new Set();
const sessionDanmuCommentNegativeCache = new Set();
const sessionDanmuCommentSuccessCache = new Map();
const DANMU_AUTO_FALLBACK_MAX_COMMENT_REQUESTS = 2;
const DANMU_COMMENT_RATE_LIMIT_COOLDOWN = 30000;
let danmuCommentRateLimitUntil = 0;
let danmuCommentRateLimitWarnedAt = 0;

function getCurrentVideoYearValue() {
    try {
        return new URLSearchParams(window.location.search).get('year') ||
            advancedCleanTitle(currentVideoTitle || '').year ||
            '';
    } catch (error) {
        return '';
    }
}

function getVideoIdentity(title = currentVideoTitle) {
    const params = new URLSearchParams(window.location.search);
    const normalizedTitle = getDanmuSearchKeyword(title || currentVideoTitle || '');
    const year =
        params.get('year') ||
        advancedCleanTitle(title || currentVideoTitle || '').year ||
        '';
    const sourceCode =
        params.get('source') ||
        params.get('source_code') ||
        localStorage.getItem('currentSourceCode') ||
        localStorage.getItem('currentPlayingSource') ||
        '';
    const vodId =
        params.get('id') ||
        params.get('vod_id') ||
        localStorage.getItem('currentVideoId') ||
        '';
    const episodeCount = Array.isArray(currentEpisodes) ? currentEpisodes.length : 0;

    return {
        title: title || currentVideoTitle || '',
        year: String(year || ''),
        sourceCode: String(sourceCode || ''),
        vodId: String(vodId || ''),
        episodeCount,
        normalizedTitle
    };
}

function updateLastDanmuMatchInfo(info = {}) {
    lastDanmuMatchInfo = {
        ...(lastDanmuMatchInfo || {}),
        videoTitle: currentVideoTitle,
        year: getCurrentVideoYearValue(),
        episodeIndex: currentEpisodeIndex,
        displayEpisode: currentEpisodeIndex + 1,
        totalEpisodes: Array.isArray(currentEpisodes) ? currentEpisodes.length : 0,
        currentEpisodeName: getCurrentEpisodeName(currentEpisodeIndex),
        currentVideoUrl,
        videoIdentity: getVideoIdentity(),
        persistentBindingEnabled: false,
        updatedAt: Date.now(),
        ...info
    };
    return lastDanmuMatchInfo;
}

function buildDanmuEpisodeSummary(reason, overrides = {}) {
    const info = lastDanmuMatchInfo || {};
    const stats = lastDanmuFetchStats || {};
    const episodeIndex = typeof overrides.episodeIndex === 'number'
        ? overrides.episodeIndex
        : currentEpisodeIndex;

    return {
        reason,
        videoTitle: currentVideoTitle,
        videoYear: getCurrentVideoYearValue(),
        currentEpisodeIndex: episodeIndex,
        displayEpisode: episodeIndex + 1,
        totalEpisodes: Array.isArray(currentEpisodes) ? currentEpisodes.length : 0,
        episodeName: getCurrentEpisodeName(episodeIndex),
        currentVideoUrl,
        matchQuery: info.matchQuery || '',
        matchMode: info.matchMode || 'none',
        animeId: info.animeId || currentDanmuAnimeId || '',
        animeTitle: info.animeTitle || '',
        episodeId: info.episodeId || stats.episodeId || '',
        episodeTitle: info.episodeTitle || '',
        sourceName: info.sourceName || currentDanmuSourceName || '',
        selectedBy: info.selectedBy || currentSessionDanmuSource?.selectedBy || '',
        confidence: Number(info.confidence || 0),
        autoApplied: Boolean(info.autoApplied),
        fallbackUsed: Boolean(info.fallbackUsed),
        manualSourceUsed: Boolean(info.manualSourceUsed),
        sessionSourceUsed: Boolean(info.sessionSourceUsed),
        candidateCount: Number.isFinite(info.candidateCount)
            ? info.candidateCount
            : (Number.isFinite(lastDanmuAutoFallbackStats?.candidateCount) ? lastDanmuAutoFallbackStats.candidateCount : 0),
        triedCandidateCount: Number.isFinite(info.triedCandidateCount)
            ? info.triedCandidateCount
            : (Number.isFinite(lastDanmuAutoFallbackStats?.triedCandidateCount) ? lastDanmuAutoFallbackStats.triedCandidateCount : 0),
        candidateScore: Number.isFinite(info.candidateScore)
            ? info.candidateScore
            : (Number.isFinite(lastDanmuAutoFallbackStats?.candidateScore) ? lastDanmuAutoFallbackStats.candidateScore : 0),
        currentYear: info.currentYear || getCurrentVideoYearValue() || '',
        candidateYear: info.candidateYear || '',
        yearConflict: Boolean(info.yearConflict),
        coreTitle: info.coreTitle || '',
        candidateCoreTitle: info.candidateCoreTitle || '',
        titleScore: Number.isFinite(info.titleScore) ? info.titleScore : 0,
        rejectReason: info.rejectReason || lastDanmuAutoFallbackStats?.rejectReason || '',
        rejectReasons: info.rejectReasons || lastDanmuAutoFallbackStats?.rejectReasons || [],
        hardRejected: Boolean(info.hardRejected),
        verifiedScore: Number.isFinite(info.verifiedScore) ? info.verifiedScore : 0,
        validCandidateCount: Number.isFinite(info.validCandidateCount)
            ? info.validCandidateCount
            : (Number.isFinite(lastDanmuAutoFallbackStats?.validCandidateCount) ? lastDanmuAutoFallbackStats.validCandidateCount : 0),
        triedCommentCount: Number.isFinite(info.triedCommentCount)
            ? info.triedCommentCount
            : (Number.isFinite(lastDanmuAutoFallbackStats?.triedCommentCount) ? lastDanmuAutoFallbackStats.triedCommentCount : 0),
        rateLimited: Boolean(info.rateLimited || stats.rateLimited || lastDanmuAutoFallbackStats?.rateLimited),
        selectedCandidateReason: info.selectedCandidateReason || '',
        commentCount: Number.isFinite(info.commentCount) ? info.commentCount : 0,
        rawCount: Number.isFinite(stats.rawCount) ? stats.rawCount : 0,
        validCount: Number.isFinite(stats.validCount) ? stats.validCount : 0,
        convertedCount: Number.isFinite(stats.convertedCount) ? stats.convertedCount : 0,
        loadedCount: Number.isFinite(overrides.loadedCount)
            ? overrides.loadedCount
            : (Number.isFinite(info.loadedCount) ? info.loadedCount : (Number.isFinite(stats.loadedCount) ? stats.loadedCount : 0)),
        pluginApplied: Boolean(overrides.pluginApplied),
        failReason: overrides.failReason || info.failReason || stats.failReason || '',
        ...overrides
    };
}

function logDanmuEpisodeSummary(reason, overrides = {}) {
    const summary = buildDanmuEpisodeSummary(reason, overrides);
    danmuDebugLog('[DanmuDebug] danmaku episode summary', summary);
    return summary;
}

window.debugDanmuState = function () {
    return {
        currentVideoTitle,
        currentVideoYear: getCurrentVideoYearValue(),
        currentEpisodeIndex,
        displayEpisode: currentEpisodeIndex + 1,
        totalEpisodes: Array.isArray(currentEpisodes) ? currentEpisodes.length : 0,
        currentEpisodeName: getCurrentEpisodeName(currentEpisodeIndex),
        currentVideoUrl,
        videoIdentity: getVideoIdentity(),
        currentSessionDanmuSource,
        currentDanmuAnimeId,
        currentDanmuSourceName,
        danmuCached: Boolean(currentDanmuCache?.danmuList),
        currentDanmuCacheEpisode: currentDanmuCache?.episodeIndex,
        currentDanmuCacheCount: Array.isArray(currentDanmuCache?.danmuList) ? currentDanmuCache.danmuList.length : 0,
        lastDanmuMatchInfo,
        lastDanmuFetchStats,
        persistentBindingEnabled: false,
        artReady: Boolean(window.LibertyPlayer?.art),
        hasDanmukuPlugin: Boolean(window.LibertyPlayer?.art?.plugins?.artplayerPluginDanmuku),
        danmakuVisible: danmuDisplayConfig.visible !== false,
    };
};

// ✅ 弹幕显示配置（跨集持久化，不随切集重置）
const DEFAULT_DANMU_DISPLAY_AREA = 'quarter';
const DANMU_DISPLAY_AREA_OPTIONS = [
    { value: 'quarter', label: '1/4', desktopBottom: '75%', mobileBottom: '80%' },
    { value: 'half', label: '半屏', bottom: '50%' },
    { value: 'threeQuarter', label: '3/4', bottom: '25%' },
    { value: 'full', label: '满屏', bottom: '0%' },
];

let danmuDisplayConfig = {
    speed: 5,
    opacity: 1,
    fontSize: null, // null = 使用默认值
    color: '#FFFFFF',
    mode: 0,
    displayArea: DEFAULT_DANMU_DISPLAY_AREA,
    visible: true,
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
    danmuDisplayConfig.displayArea = normalizeDanmuDisplayArea(danmuDisplayConfig.displayArea);
    danmuDisplayConfig.visible = danmuDisplayConfig.visible !== false;
})();

// 保存弹幕配置到 localStorage
function saveDanmuConfig(config) {
    try {
        const hasChange = Object.keys(config).some(
            key => danmuDisplayConfig[key] !== config[key]
        );
        if (!hasChange) return;
        danmuDisplayConfig = { ...danmuDisplayConfig, ...config };
        localStorage.setItem('danmuDisplayConfig', JSON.stringify(danmuDisplayConfig));
    } catch (e) {}
}

function getDanmukuPlugin() {
    return art?.plugins?.artplayerPluginDanmuku || null;
}

function getDanmuDefaultFontSize() {
    return isMobileDevice ? (window.innerWidth < 375 ? 18 : 20) : 25;
}

function isDanmuUserVisibleEnabled() {
    return danmuDisplayConfig.visible !== false;
}

function normalizeDanmuDisplayArea(value) {
    return DANMU_DISPLAY_AREA_OPTIONS.some(option => option.value === value)
        ? value
        : DEFAULT_DANMU_DISPLAY_AREA;
}

function getDanmuDisplayAreaOption(value = danmuDisplayConfig.displayArea) {
    const normalizedValue = normalizeDanmuDisplayArea(value);
    return DANMU_DISPLAY_AREA_OPTIONS.find(option => option.value === normalizedValue) || DANMU_DISPLAY_AREA_OPTIONS[0];
}

function getDanmuDisplayAreaSteps() {
    return DANMU_DISPLAY_AREA_OPTIONS.map(option => ({
        name: option.label,
        value: getDanmuTrackMargin(option.value)
    }));
}

function getDanmuTrackMargin(displayArea = danmuDisplayConfig.displayArea) {
    const option = getDanmuDisplayAreaOption(displayArea);
    const topMargin = isMobileDevice ? 5 : 10;
    const bottomMargin = isMobileDevice
        ? (option.mobileBottom || option.bottom || '0%')
        : (option.desktopBottom || option.bottom || '0%');

    return [topMargin, bottomMargin];
}

function getDanmuDisplayAreaByMargin(margin) {
    if (!Array.isArray(margin) || margin.length < 2) return null;

    return DANMU_DISPLAY_AREA_OPTIONS.find(option => {
        const expectedMargin = getDanmuTrackMargin(option.value);
        return expectedMargin[0] === margin[0] && expectedMargin[1] === margin[1];
    })?.value || null;
}

function getDanmakuRuntimeConfig(overrides = {}) {
    return {
        speed: danmuDisplayConfig.speed,
        opacity: danmuDisplayConfig.opacity,
        fontSize: danmuDisplayConfig.fontSize || getDanmuDefaultFontSize(),
        color: danmuDisplayConfig.color,
        mode: danmuDisplayConfig.mode,
        margin: getDanmuTrackMargin(),
        visible: isDanmuUserVisibleEnabled(),
        synchronousPlayback: true,
        ...overrides,
    };
}

function getDanmakuLayoutState() {
    const player = art?.template?.$player;
    return {
        width: player?.clientWidth || 0,
        height: player?.clientHeight || 0,
        displayArea: danmuDisplayConfig.displayArea,
    };
}

let lastDanmakuLayoutState = null;

function markDanmakuLayoutState() {
    lastDanmakuLayoutState = getDanmakuLayoutState();
}

async function applyDanmakuRuntimeState({
    reason = 'runtime',
    danmuku,
    reload = false,
    relayout = false,
    syncVisibility = true,
} = {}) {
    const danmukuPlugin = getDanmukuPlugin();
    if (!danmukuPlugin) return false;

    try {
        let didConfig = false;
        let didLoad = false;
        let didReset = false;

        if (typeof danmukuPlugin.config === 'function') {
            danmukuPlugin.config(getDanmakuRuntimeConfig(
                danmuku !== undefined ? { danmuku } : {}
            ));
            didConfig = true;
        }

        if (reload && typeof danmukuPlugin.load === 'function') {
            await danmukuPlugin.load();
            didLoad = true;
        } else if ((reload || relayout) && typeof danmukuPlugin.reset === 'function') {
            danmukuPlugin.reset();
            didReset = true;
        }

        if (reload || relayout) {
            markDanmakuLayoutState();
        }

        if (syncVisibility) {
            applyDanmakuVisibility(`${reason}:after-runtime-refresh`);
        }
        logDanmakuRuntimeDebug(reason, {
            calledHelper: 'applyDanmakuRuntimeState',
            didConfig,
            didLoad,
            didReset,
            eventType: reload ? 'reload' : (relayout ? 'relayout' : 'config'),
        });
        return true;
    } catch (error) {
        console.warn('弹幕运行时刷新失败:', reason, error);
        logDanmakuRuntimeDebug(reason, {
            calledHelper: 'applyDanmakuRuntimeState',
            failed: true,
            error: error?.message || String(error),
        });
        return false;
    }
}

async function refreshDanmakuRuntimeLayout(reason = 'layout', options = {}) {
    const currentLayoutState = getDanmakuLayoutState();
    const isViewportRefresh = reason.startsWith('viewport-');
    const shouldRelayout = Boolean(options.force) ||
        !lastDanmakuLayoutState ||
        currentLayoutState.height !== lastDanmakuLayoutState.height ||
        currentLayoutState.displayArea !== lastDanmakuLayoutState.displayArea;

    if (!shouldRelayout) {
        logDanmakuRuntimeDebug(reason, {
            calledHelper: 'refreshDanmakuRuntimeLayout',
            didReset: false,
            skipped: true,
            eventType: 'layout-check',
        });
        return false;
    }

    if (isViewportRefresh && !options.force) {
        markDanmakuLayoutState();
        applyDanmakuVisibility(`${reason}:after-layout-sync`);
        logDanmakuRuntimeDebug(reason, {
            calledHelper: 'refreshDanmakuRuntimeLayout',
            didConfig: false,
            didLoad: false,
            didReset: false,
            eventType: 'viewport-sync',
        });
        return true;
    }

    return applyDanmakuRuntimeState({
        reason,
        relayout: true,
        syncVisibility: true,
    });
}

function shouldRefreshDanmakuLayoutOnViewportChange(reason) {
    return [
        'resize',
        'orientationchange',
        'fullscreenchange',
        'webkitfullscreenchange',
        'fullscreen',
        'fullscreenWeb'
    ].includes(reason);
}

function queueDanmakuLayoutRefresh(reason = 'display-area', delay = 0, options = {}) {
    clearTimeout(danmakuLayoutRefreshTimer);
    danmakuLayoutRefreshTimer = setTimeout(() => {
        refreshDanmakuRuntimeLayout(reason, options);
    }, delay);
}

function scheduleDanmakuLayoutRefresh(reason = 'resize') {
    if (!shouldRefreshDanmakuLayoutOnViewportChange(reason)) return;

    queueDanmakuLayoutRefresh(`viewport-${reason}`, reason === 'resize' ? 220 : 140);
}

function isDanmuVisibilityDebugEnabled() {
    try {
        return localStorage.getItem('LIBRETV_DANMU_DEBUG') === '1';
    } catch (error) {
        return false;
    }
}

function logDanmakuRuntimeDebug(reason, details = {}) {
    if (!isDanmuVisibilityDebugEnabled()) return;
    console.log('[DanmuDebug] runtime', {
        reason,
        ts: Date.now(),
        isPlaying: Boolean(art?.playing),
        currentTime: art?.video?.currentTime ?? null,
        displayArea: danmuDisplayConfig.displayArea,
        visible: isDanmuUserVisibleEnabled(),
        fullscreen: Boolean(art?.fullscreen),
        fullscreenWeb: Boolean(art?.fullscreenWeb),
        ...details,
    });
}

function getDanmuPluginVisibleState(danmukuPlugin = getDanmukuPlugin()) {
    try {
        if (!danmukuPlugin) return null;
        if (typeof danmukuPlugin.visible === 'boolean') return danmukuPlugin.visible;
        if (typeof danmukuPlugin.option?.visible === 'boolean') return danmukuPlugin.option.visible;
        if (typeof danmukuPlugin.options?.visible === 'boolean') return danmukuPlugin.options.visible;
    } catch (error) {}
    return null;
}

function logDanmuVisibilityState(reason, details = {}) {
    if (!isDanmuVisibilityDebugEnabled()) return;
    const danmukuPlugin = getDanmukuPlugin();
    console.log('[DanmuDebug] danmaku visibility state', {
        reason,
        preferredVisible: isDanmuUserVisibleEnabled(),
        danmuDisplayConfig: { ...danmuDisplayConfig },
        loadedCount: currentDanmuCache?.danmuList?.length ?? null,
        pluginApplied: Boolean(danmukuPlugin),
        pluginVisible: getDanmuPluginVisibleState(danmukuPlugin),
        episodeIndex: currentEpisodeIndex,
        episodeId: lastDanmuMatchInfo?.episodeId || null,
        sourceName: lastDanmuMatchInfo?.sourceName || currentDanmuSourceName || null,
        matchMode: lastDanmuMatchInfo?.matchMode || null,
        ...details
    });
}

function applyDanmakuVisibility(reason = 'sync') {
    const danmukuPlugin = getDanmukuPlugin();
    if (!danmukuPlugin) {
        logDanmuVisibilityState(reason, {
            pluginApplied: false,
            pluginVisible: null
        });
        return;
    }

    const shouldShow = isDanmuUserVisibleEnabled() && !document.hidden;
    const action = shouldShow ? 'show' : 'hide';
    if (typeof danmukuPlugin[action] === 'function') {
        danmukuPlugin[action]();
    }
    danmuDebugLog('[DanmuDebug] apply danmaku visibility', {
        reason,
        visible: isDanmuUserVisibleEnabled(),
        action,
        documentHidden: document.hidden
    });
    logDanmuVisibilityState(reason, {
        action,
        pluginApplied: true,
        pluginVisible: getDanmuPluginVisibleState(danmukuPlugin)
    });
}

// ✅ 新增：临时详情缓存（Map自动管理大小）
const tempDetailCache = new Map();
const sessionDanmuAnimeSearchCache = new Map();

// ===== 获取弹幕数据 =====
function parseDanmuCandidateTitle(rawTitle) {
    const raw = String(rawTitle || '').trim();
    let title = raw;
    let sourceName = '';
    let year = '';
    let type = '';

    const sourceMatch = title.match(/\s*from\s+(.+)$/i);
    if (sourceMatch) {
        sourceName = sourceMatch[1].trim();
        title = title.slice(0, sourceMatch.index).trim();
    }

    const yearMatch = title.match(/[（(]\s*((?:19|20)\d{2})\s*[）)]/) ||
        title.match(/(?:^|[^\d])((?:19|20)\d{2})(?:$|[^\d])/);
    if (yearMatch) {
        year = yearMatch[1];
        title = title.replace(yearMatch[0], ' ').trim();
    }

    const typeMatches = [...title.matchAll(/【([^】]+)】/g)].map(match => match[1]).filter(Boolean);
    if (typeMatches.length) {
        type = typeMatches.join('/');
        title = title.replace(/【[^】]+】/g, '').trim();
    }

    const coreTitle = title.trim();
    const normalizedCoreTitle = normalizeDanmuCoreTitle(
        title
            .replace(/[（(][^）)]*[）)]/g, '')
            .replace(/\[[^\]]+\]/g, '')
            .trim()
    );

    return {
        rawTitle: raw,
        coreTitle,
        normalizedCoreTitle,
        year,
        type,
        sourceName
    };
}

function normalizeDanmuCoreTitle(title) {
    return normalizeDanmuTitle(title)
        .replace(/[【】\[\]（）(){}<>《》「」『』]/g, '')
        .replace(/[·・.。:：,，、;；!！?？'"“”‘’_\-—/\\|]/g, '')
        .replace(/\s+/g, '')
        .trim();
}

function normalizeDanmuYear(value) {
    const match = String(value || '').match(/(?:19|20)\d{2}/);
    return match ? match[0] : '';
}

function getDanmuTitleCloseness(currentCoreTitle, candidateCoreTitle) {
    const current = normalizeDanmuCoreTitle(currentCoreTitle);
    const candidate = normalizeDanmuCoreTitle(candidateCoreTitle);
    if (!current || !candidate) {
        return { close: false, mode: 'missing', similarity: 0, titleScore: 0 };
    }

    if (current === candidate) {
        return { close: true, mode: 'exact', similarity: 1, titleScore: 60 };
    }

    if (current.includes(candidate) || candidate.includes(current)) {
        return { close: true, mode: 'contains', similarity: 0.9, titleScore: 50 };
    }

    const similarity = calculateSimilarity(current, candidate);
    const lcs = longestCommonSubstring(current, candidate);
    const minLength = Math.min(current.length, candidate.length);
    const close = similarity >= 0.55 && lcs >= Math.min(3, minLength);

    return {
        close,
        mode: close ? 'overlap' : 'not-close',
        similarity,
        titleScore: close ? 30 : Math.round(similarity * 30)
    };
}

function getDanmuSearchKeyword(title) {
    return normalizeDanmuTitle(
        String(title || currentVideoTitle || '')
            .replace(/\([^)]*\)/g, '')
            .replace(/【[^】]*】/g, '')
            .trim()
    );
}

function getDanmuTypeCategory(typeText, episodeCount) {
    const text = String(typeText || '').toLowerCase();
    if (episodeCount === 1 || /电影|剧场版|movie/.test(text)) return 'single';
    if (/电视剧|日韩剧|欧美剧|国产剧|动漫|动画|番剧|tv|剧|anime/.test(text)) return 'series';
    return episodeCount > 1 ? 'series' : '';
}

function rankDanmuSourceCandidates(animes, cleanTitle, videoIdentity = getVideoIdentity()) {
    const targetParsed = parseDanmuCandidateTitle(cleanTitle || videoIdentity.title || videoIdentity.normalizedTitle || '');
    const normalizedTitle = targetParsed.normalizedCoreTitle || normalizeDanmuCoreTitle(String(cleanTitle || videoIdentity.normalizedTitle || '').replace(/\([^)]*\)/g, '').replace(/【[^】]*】/g, '').trim());
    const targetInfo = advancedCleanTitle(videoIdentity.title || normalizedTitle);
    const targetYear = normalizeDanmuYear(videoIdentity.year || targetParsed.year || targetInfo.year || '');
    const targetEpisodeCount = Number(videoIdentity.episodeCount || 0);
    const displayEpisode = currentEpisodeIndex + 1;
    const targetTypeCategory = getDanmuTypeCategory(targetParsed.type || targetInfo.typeDescription || targetInfo.type, targetEpisodeCount);

    return (animes || []).map(anime => {
        const animeTitle = anime.animeTitle || '';
        const parsed = parseDanmuCandidateTitle(animeTitle);
        const title = parsed.normalizedCoreTitle || normalizeDanmuCoreTitle(animeTitle.replace(/\([^)]*\)/g, '').replace(/【[^】]*】/g, '').trim());
        const animeInfo = advancedCleanTitle(parsed.coreTitle || animeTitle);
        const episodeCount = Number(anime.episodeCount || 0);
        let score = 0;

        const closeness = getDanmuTitleCloseness(normalizedTitle, title);
        const similarity = closeness.similarity;
        const titleScore = closeness.titleScore;
        score += titleScore;

        const animeYear = normalizeDanmuYear(anime.year || parsed.year || animeInfo.year || '');
        if (targetYear && animeYear) {
            const diff = Math.abs(Number(targetYear) - Number(animeYear));
            if (diff === 0) score += 15;
            else if (diff <= 1) score += 8;
        }

        if (targetEpisodeCount > 0 && episodeCount > 0) {
            const diff = Math.abs(targetEpisodeCount - episodeCount);
            if (diff === 0) score += 15;
            else if (diff <= 2) score += 10;
            else if (episodeCount >= targetEpisodeCount) score += 6;
            else score -= 10;
        }

        if (displayEpisode === 1 && episodeCount === 1) {
            score += 5;
        } else if (displayEpisode > 1 && episodeCount >= displayEpisode) {
            score += 10;
        } else if (displayEpisode > 1 && episodeCount > 0 && episodeCount < displayEpisode) {
            score -= 30;
        }

        const candidateType = getDanmuTypeCategory(parsed.type || anime.typeDescription || anime.type, episodeCount);
        if (targetTypeCategory && candidateType && targetTypeCategory === candidateType) score += 8;

        if (currentDanmuAnimeId && String(anime.animeId) === String(currentDanmuAnimeId)) {
            score += 5;
        }

        if (!targetYear) score -= 20;
        if (!targetEpisodeCount) score -= 25;

        score = Math.max(0, Math.min(100, Math.round(score)));

        danmuDebugLog('[DanmuDebug] parsed danmu candidate', {
            rawTitle: parsed.rawTitle,
            coreTitle: parsed.coreTitle,
            year: parsed.year,
            type: parsed.type,
            sourceName: parsed.sourceName,
            titleScore,
            finalScore: score
        });

        return {
            animeId: anime.animeId,
            animeTitle,
            coreTitle: parsed.coreTitle,
            normalizedCoreTitle: parsed.normalizedCoreTitle,
            year: animeYear,
            candidateYear: animeYear,
            candidateType: parsed.type || anime.typeDescription || anime.type || '',
            sourceName: parsed.sourceName,
            type: anime.type || '未知类型',
            episodeCount,
            typeDescription: anime.typeDescription || '',
            score,
            titleScore,
            titleSimilarity: similarity,
            titleClosenessMode: closeness.mode,
            confidence: score,
            raw: anime
        };
    }).sort((a, b) => b.score - a.score);
}

async function searchDanmuAnimeCandidatesWithCache(cleanTitle) {
    const cacheKey = normalizeDanmuTitle(cleanTitle);
    const cached = sessionDanmuAnimeSearchCache.get(cacheKey);
    const TTL = DANMU_CONFIG.tempDetailCacheTTL || (90 * 60 * 1000);

    if (cached && Date.now() - cached.timestamp < TTL) {
        danmuDebugLog('[DanmuDebug] use session anime search cache', {
            cleanTitle,
            count: cached.animes.length
        });
        return cached.animes;
    }

    const searchUrl = `${getDanmuBaseUrl()}/api/v2/search/anime?keyword=${encodeURIComponent(cleanTitle)}`;
    const authedSearchUrl = await addDanmuAuth(searchUrl);
    const response = await fetchWithRetry(authedSearchUrl, {}, 2, 12000);

    if (!response.ok) {
        throw new Error(`search/anime HTTP ${response.status}`);
    }

    const data = await response.json();
    const animes = Array.isArray(data?.animes) ? data.animes : [];
    sessionDanmuAnimeSearchCache.set(cacheKey, {
        timestamp: Date.now(),
        animes
    });

    danmuDebugLog('[DanmuDebug] cached anime search candidates', {
        cleanTitle,
        count: animes.length
    });
    return animes;
}

function getDanmuCandidateRejectReason(context, candidate, episodes = null, matchedEpisode = null) {
    const currentYear = normalizeDanmuYear(context.year || getCurrentVideoYearValue());
    const candidateYear = normalizeDanmuYear(candidate.candidateYear || candidate.year);
    const currentTitle = parseDanmuCandidateTitle(context.title || currentVideoTitle || '').normalizedCoreTitle;
    const candidateTitle = candidate.normalizedCoreTitle || parseDanmuCandidateTitle(candidate.animeTitle).normalizedCoreTitle;
    const closeness = getDanmuTitleCloseness(currentTitle, candidateTitle);

    if (currentYear && candidateYear && currentYear !== candidateYear) {
        return 'year_mismatch';
    }

    if (!closeness.close) {
        return 'title_not_close_enough';
    }

    if (Array.isArray(episodes)) {
        const totalEpisodes = Number(context.episodeCount || currentEpisodes?.length || 0);
        if (totalEpisodes > 1 && episodes.length === 1) {
            return 'multi_episode_to_single';
        }

        if (!matchedEpisode) {
            return 'episode_missing';
        }
    }

    return null;
}

function calculateDanmuVerifiedScore(context, candidate, episodes, danmukuCount) {
    const currentTitle = parseDanmuCandidateTitle(context.title || currentVideoTitle || '').normalizedCoreTitle;
    const candidateTitle = candidate.normalizedCoreTitle || parseDanmuCandidateTitle(candidate.animeTitle).normalizedCoreTitle;
    const closeness = getDanmuTitleCloseness(currentTitle, candidateTitle);
    const currentYear = normalizeDanmuYear(context.year || getCurrentVideoYearValue());
    const candidateYear = normalizeDanmuYear(candidate.candidateYear || candidate.year);
    const totalEpisodes = Number(context.episodeCount || currentEpisodes?.length || 0);
    const candidateEpisodeCount = Array.isArray(episodes) ? episodes.length : Number(candidate.episodeCount || 0);
    const currentType = getDanmuTypeCategory('', totalEpisodes);
    const candidateType = getDanmuTypeCategory(candidate.candidateType || candidate.typeDescription || candidate.type, candidateEpisodeCount);

    let verifiedScore = 0;
    if (closeness.mode === 'exact') verifiedScore += 40;
    else if (closeness.mode === 'contains') verifiedScore += 30;
    else if (closeness.close) verifiedScore += 20;

    if (currentYear && candidateYear && currentYear === candidateYear) verifiedScore += 25;

    if (totalEpisodes > 0 && candidateEpisodeCount > 0) {
        const diff = Math.abs(totalEpisodes - candidateEpisodeCount);
        if (diff === 0) verifiedScore += 15;
        else if (diff <= 2) verifiedScore += 8;
    }

    if (currentType && candidateType && currentType === candidateType) verifiedScore += 5;

    const sourceName = String(candidate.sourceName || '').toLowerCase();
    if (/youku|tencent|bilibili|qiyi|iqiyi|360/.test(sourceName)) verifiedScore += 5;

    if (danmukuCount >= 1000) verifiedScore += 15;
    else if (danmukuCount >= 300) verifiedScore += 10;
    else if (danmukuCount > 0) verifiedScore += 5;

    return verifiedScore;
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
        danmuDebugLog(`✅ [弹幕] 精确匹配 第${targetNumber}集: ${exactMatch.title}`);
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
    danmuDebugLog('可用弹幕:', episodesWithInfo.map(e => ({
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
            danmuDebugLog('✅ [弹幕] 单集内容，直接使用唯一弹幕剧集');
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
async function fetchDanmaku(episodeId, episodeIndex, options = {}) {
    if (!isDanmuServiceEnabled()) return null;

    const silentCandidate = Boolean(options.silentCandidate);
    const cacheKey = String(episodeId || '');
    if (!cacheKey) return null;

    lastDanmuFetchStats = {
        episodeId,
        episodeIndex,
        rawCount: 0,
        validCount: 0,
        convertedCount: 0,
        loadedCount: 0,
        status: 0,
        failReason: '',
        rateLimited: false,
        updatedAt: Date.now()
    };

    if (sessionDanmuCommentSuccessCache.has(cacheKey)) {
        const cached = limitDanmakuList(sessionDanmuCommentSuccessCache.get(cacheKey) || []);
        if (cached.length !== (sessionDanmuCommentSuccessCache.get(cacheKey) || []).length) {
            sessionDanmuCommentSuccessCache.set(cacheKey, cached);
        }
        lastDanmuFetchStats = {
            ...lastDanmuFetchStats,
            rawCount: cached.length,
            validCount: cached.length,
            convertedCount: cached.length,
            loadedCount: cached.length,
            fromCache: true,
            updatedAt: Date.now()
        };
        danmuDebugLog('[DanmuDebug] use comment success cache', {
            episodeId,
            loadedCount: cached.length
        });
        return cached;
    }

    if (sessionDanmuCommentNegativeCache.has(cacheKey)) {
        lastDanmuFetchStats = {
            ...lastDanmuFetchStats,
            failReason: 'comment_negative_cache',
            updatedAt: Date.now()
        };
        danmuDebugWarn('[DanmuDebug] skip comment due to negative cache', { episodeId });
        return null;
    }

    if (Date.now() < danmuCommentRateLimitUntil) {
        lastDanmuFetchStats = {
            ...lastDanmuFetchStats,
            status: 429,
            failReason: 'rate_limited',
            rateLimited: true,
            updatedAt: Date.now()
        };
        danmuDebugWarn('[DanmuDebug] skip comment due to rate limit cooldown', {
            episodeId,
            cooldownMs: danmuCommentRateLimitUntil - Date.now()
        });
        return null;
    }

    const commentUrl = `${getDanmuBaseUrl()}/api/v2/comment/${episodeId}?format=json&duration=true&withRelated=true&chConvert=1`;

    let commentResponse;
    let timeoutId = null;
    try {
        const authedCommentUrl = await addDanmuAuth(commentUrl);
        const controller = new AbortController();
        timeoutId = setTimeout(() => controller.abort(), 12000);
        commentResponse = await fetch(authedCommentUrl, {
            signal: controller.signal
        });
    } catch (e) {
        const failReason = e?.name === 'AbortError' ? 'comment_timeout' : 'comment_request_failed';
        lastDanmuFetchStats = {
            ...lastDanmuFetchStats,
            failReason,
            updatedAt: Date.now()
        };
        if (silentCandidate) {
            danmuDebugWarn('[DanmuDebug] comment request failed', {
                episodeId,
                failReason,
                error: e?.message || String(e)
            });
        } else {
            console.warn(`⚠️ 获取弹幕失败:`, e.message);
        }
        return null;
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }

    if (!commentResponse.ok) {
        const status = commentResponse.status;
        let failReason = `http_${status}`;
        if (status === 400 || status === 404) {
            failReason = 'comment_not_found';
            sessionDanmuCommentNegativeCache.add(cacheKey);
        } else if (status === 429) {
            failReason = 'rate_limited';
            danmuCommentRateLimitUntil = Date.now() + DANMU_COMMENT_RATE_LIMIT_COOLDOWN;
        }

        lastDanmuFetchStats = {
            ...lastDanmuFetchStats,
            status,
            failReason,
            rateLimited: status === 429,
            updatedAt: Date.now()
        };

        if (status === 429) {
            const now = Date.now();
            if (now - danmuCommentRateLimitWarnedAt > DANMU_COMMENT_RATE_LIMIT_COOLDOWN) {
                danmuCommentRateLimitWarnedAt = now;
                console.warn('⚠️ 弹幕接口请求过快，已暂停自动候选验证 30 秒');
            }
            danmuDebugWarn('[DanmuDebug] comment rate limited', { episodeId, status });
        } else if (silentCandidate) {
            danmuDebugWarn('[DanmuDebug] comment candidate failed', {
                episodeId,
                status,
                failReason
            });
        } else {
            console.warn(`⚠️ 获取弹幕失败: HTTP ${status}`);
        }
        return null;
    }

    const commentData = await commentResponse.json();

    if (!commentData.comments || !Array.isArray(commentData.comments)) {
        lastDanmuFetchStats = {
            ...lastDanmuFetchStats,
            status: commentResponse.status,
            failReason: 'invalid_comment_payload',
            updatedAt: Date.now()
        };
        return [];
    }

    const rawComments = commentData.comments;
    const totalComments = rawComments.length;

    danmuDebugLog(`📊 原始弹幕数量: ${totalComments}`);

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
            danmuDebugLog(`🎯 弹幕时长自适应: API=${apiDuration.toFixed(1)}s, 视频=${playerDuration.toFixed(1)}s, scale=${durationScale.toFixed(4)}`);
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
    danmuDebugLog(`[DanmuDebug] 有效弹幕数量: ${parsedComments.length}`);

    parsedComments.sort((a, b) => a.time - b.time);

    const lastTime = parsedComments[parsedComments.length - 1]?.time || 0;
    danmuDebugLog(`📐 弹幕时长: ${Math.floor(lastTime / 60)}分${Math.floor(lastTime % 60)}秒`);

    const finalDanmaku = [];
    parsedComments.forEach(item => processDanmakuOptimized(item, finalDanmaku));
    const limitedDanmaku = limitDanmakuList(finalDanmaku);

    lastDanmuFetchStats = {
        episodeId,
        episodeIndex,
        status: commentResponse.status,
        rawCount: totalComments,
        validCount: parsedComments.length,
        convertedCount: finalDanmaku.length,
        loadedCount: limitedDanmaku.length,
        failReason: limitedDanmaku.length > 0 ? '' : 'empty_comment',
        rateLimited: false,
        updatedAt: Date.now()
    };

    if (limitedDanmaku.length > 0) {
        sessionDanmuCommentSuccessCache.set(cacheKey, limitedDanmaku);
    }

    danmuDebugLog(`[DanmuDebug] 弹幕转换后数量: ${finalDanmaku.length}`);
    if (limitedDanmaku.length !== finalDanmaku.length) {
        danmuDebugLog(`[DanmuDebug] 弹幕数量上限生效: ${finalDanmaku.length} -> ${limitedDanmaku.length}`);
    }
    danmuDebugLog(`✅ 弹幕解析完成: ${totalComments} → ${limitedDanmaku.length}条`);

    const cacheData = {
        episodeIndex,
        danmuList: limitedDanmaku,
        timestamp: Date.now()
    };

    if (videoPlayer) {
        videoPlayer.updateDanmuCache(episodeIndex, limitedDanmaku);
    }

    currentDanmuCache = cacheData;

    return limitedDanmaku;
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
    if (sessionDanmuBangumiNegativeCache.has(String(animeId))) {
        danmuDebugWarn('[DanmuDebug] skip bangumi detail due to session negative cache', { animeId });
        return null;
    }

    const cacheKey = `anime_${animeId}`;
    const TTL = DANMU_CONFIG.tempDetailCacheTTL || (90 * 60 * 1000); // 90 分钟
    const cached = tempDetailCache.get(cacheKey);

    // 缓存有效直接返回
    if (cached && Date.now() - cached.timestamp < TTL) {
        danmuDebugLog('✅ 使用临时详情缓存（有效期内）');
        return cached.episodes;
    }

    // 重试机制：最多 3 次，递增等待
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const detailUrl = `${getDanmuBaseUrl()}/api/v2/bangumi/${animeId}`;
			const authedDetailUrl = await addDanmuAuth(detailUrl);
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
			const response = await fetch(authedDetailUrl, {
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (response.status === 400 || response.status === 404) {
                sessionDanmuBangumiNegativeCache.add(String(animeId));
                if (currentSessionDanmuSource && String(currentSessionDanmuSource.animeId) === String(animeId)) {
                    currentSessionDanmuSource = null;
                    currentDanmuAnimeId = null;
                    currentDanmuSourceName = '';
                }
                danmuDebugWarn('[DanmuDebug] bangumi detail not found, clear session source', {
                    animeId,
                    status: response.status
                });
                return null;
            }

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

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
				danmuDebugLog('🧹 清理过期剧集缓存');
			}
			tempDetailCache.set(cacheKey, {
				timestamp: Date.now(),
				animeId,
				episodes: episodes.slice(0, 500), // 单部剧最多缓存 500 集（防止超长番剧爆内存）
				isMovie: isMovieContent(data.bangumi)
			});

            danmuDebugLog(`✅ 第${attempt}次成功获取剧集: ${episodes.length} 集`);
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

async function loadDanmakuFromAnimeCandidate(animeId, sourceName, cleanTitle, title, episodeIndex, controller, reason, meta = {}) {
    if (!animeId) return null;
    const videoIdentity = meta.videoIdentity || getVideoIdentity(title);

    danmuDebugLog('[DanmuDebug] try anime candidate for current episode', {
        animeId,
        sourceName,
        cleanTitle,
        title,
        episodeIndex,
        reason
    });

    const sessionEpisodes =
        currentSessionDanmuSource &&
        String(currentSessionDanmuSource.animeId) === String(animeId) &&
        Array.isArray(currentSessionDanmuSource.episodes)
            ? currentSessionDanmuSource.episodes
            : null;
    const episodes = Array.isArray(meta.episodes) && meta.episodes.length
        ? meta.episodes
        : (sessionEpisodes || await getAnimeEpisodesWithCache(animeId, cleanTitle));
    if (controller?.cancelled) return [];
    if (!episodes || episodes.length === 0) {
        danmuDebugWarn('[DanmuDebug] candidate has no episodes', { animeId, sourceName, reason });
        return null;
    }

    const matchedEpisode = pickMatchedDanmuEpisode(episodes, episodeIndex, title);
    if (!matchedEpisode) {
        danmuDebugWarn('[DanmuDebug] candidate cannot match current episode', {
            animeId,
            sourceName,
            episodeIndex,
            reason
        });
        return null;
    }

    const episodeResolveResult = {
        animeId,
        animeTitle: sourceName || '',
        episodeId: matchedEpisode.episodeId,
        episodeTitle: matchedEpisode.episodeTitle || matchedEpisode.title || matchedEpisode.name || '',
        episodeIndex,
        displayEpisode: episodeIndex + 1,
        matchMode: meta.matchMode || 'binding',
        confidence: Number(meta.confidence || meta.score || matchedEpisode.confidence || 0)
    };

    danmuDebugLog('[DanmuDebug] episode resolved', episodeResolveResult);
    danmuDebugLog(meta.matchMode === 'fallback'
        ? '[DanmuDebug] fallback match selected'
        : '[DanmuDebug] match success', {
        matchMode: meta.matchMode || 'manual-source',
        animeId,
        animeTitle: sourceName,
        episodeId: matchedEpisode.episodeId,
        episodeTitle: matchedEpisode.episodeTitle || matchedEpisode.title || matchedEpisode.name || '',
        sourceName,
        confidence: meta.confidence || matchedEpisode.confidence || null,
        score: meta.score,
        reason
    });

    const result = await fetchDanmaku(matchedEpisode.episodeId, episodeIndex);
    if (controller?.cancelled) return [];
    if (result && result.length > 0) {
        currentDanmuAnimeId = animeId;
        currentDanmuSourceName = sourceName || currentDanmuSourceName || '';
        currentSessionDanmuSource = {
            animeId,
            animeTitle: sourceName || '',
            sourceName: sourceName || '',
            selectedBy: meta.selectedBy || (meta.manualSourceUsed ? 'manual' : 'auto'),
            episodes,
            episodeCount: episodes.length,
            updatedAt: Date.now()
        };
        updateLastDanmuMatchInfo({
            reason,
            matchMode: meta.matchMode || 'manual-source',
            matchQuery: meta.matchQuery || '',
            episodeIndex,
            displayEpisode: episodeIndex + 1,
            animeId,
            animeTitle: sourceName || '',
            episodeId: matchedEpisode.episodeId,
            episodeTitle: matchedEpisode.episodeTitle || matchedEpisode.title || matchedEpisode.name || '',
            sourceName: sourceName || '',
            selectedBy: currentSessionDanmuSource.selectedBy,
            fallbackUsed: Boolean(meta.fallbackUsed),
            manualSourceUsed: Boolean(meta.manualSourceUsed),
            sessionSourceUsed: Boolean(meta.sessionSourceUsed),
            autoApplied: Boolean(meta.autoApplied),
            candidateCount: Number(meta.candidateCount || 0),
            triedCandidateCount: Number(meta.triedCandidateCount || 0),
            candidateScore: Number(meta.candidateScore || meta.score || 0),
            rejectReason: meta.rejectReason || '',
            confidence: Number(meta.confidence || meta.score || matchedEpisode.confidence || 0),
            loadedCount: result.length
        });
        danmuDebugLog('[DanmuDebug] danmaku loaded', {
            reason,
            matchMode: meta.matchMode || 'manual-source',
            animeId,
            animeTitle: sourceName,
            episodeId: matchedEpisode.episodeId,
            episodeTitle: matchedEpisode.episodeTitle || matchedEpisode.title || matchedEpisode.name || '',
            displayEpisode: episodeIndex + 1,
            loadedCount: result.length,
            selectedBy: currentSessionDanmuSource.selectedBy,
            sessionSourceUsed: Boolean(meta.sessionSourceUsed)
        });
        danmuDebugLog('[DanmuDebug] candidate fallback loaded danmaku', {
            animeId,
            sourceName,
            episodeId: matchedEpisode.episodeId,
            episodeIndex,
            count: result.length,
            reason
        });
        return result;
    }

    danmuDebugWarn('[DanmuDebug] candidate episode has empty danmaku', {
        animeId,
        sourceName,
        episodeId: matchedEpisode.episodeId,
        episodeIndex,
        reason
    });
    return null;
}

async function autoFallbackDanmakuBySearchCandidate(cleanTitle, title, episodeIndex, controller, matchQuery) {
    try {
        const context = getDanmuPlaybackContext(title, episodeIndex);
        const currentParsed = parseDanmuCandidateTitle(context.title || title || currentVideoTitle || '');
        const normalizedCurrentTitle = currentParsed.normalizedCoreTitle;
        const currentYear = normalizeDanmuYear(context.year || getCurrentVideoYearValue());

        danmuDebugLog('[DanmuDebug] auto fallback search start', {
            cleanTitle,
            displayEpisode: episodeIndex + 1,
            matchQuery,
            normalizedCurrentTitle,
            currentYear
        });

        const candidates = await searchDanmuAnimeCandidatesWithCache(cleanTitle);
        if (controller?.cancelled) return [];

        lastDanmuAutoFallbackStats = {
            candidateCount: candidates.length,
            triedCandidateCount: 0,
            triedCommentCount: 0,
            validCandidateCount: 0,
            candidateScore: 0,
            rejectReason: '',
            rejectReasons: [],
            autoApplied: false,
            rateLimited: false
        };

        if (!candidates.length) {
            lastDanmuAutoFallbackStats.rejectReason = 'no_candidates';
            lastDanmuAutoFallbackStats.rejectReasons.push('no_candidates');
            danmuDebugWarn('[DanmuDebug] auto fallback has no search candidates', {
                cleanTitle,
                displayEpisode: episodeIndex + 1
            });
            return null;
        }

        const ranked = rankDanmuSourceCandidates(candidates, cleanTitle);
        const candidatesToTry = ranked.filter(item => item.animeId).slice(0, 5);
        const validCandidates = [];

        danmuDebugLog('[DanmuDebug] auto fallback candidates', {
            searchKeyword: cleanTitle,
            candidateCount: candidates.length,
            candidates: ranked.slice(0, 5).map(item => ({
                animeId: item.animeId,
                rawTitle: item.animeTitle,
                coreTitle: item.coreTitle,
                normalizedCoreTitle: item.normalizedCoreTitle,
                year: item.year,
                sourceName: item.sourceName,
                titleScore: item.titleScore,
                verifiedScore: item.score
            }))
        });
        danmuDebugLog('[DanmuDebug] ranked danmu candidates', ranked.slice(0, 5));

        if (!candidatesToTry.length) {
            lastDanmuAutoFallbackStats.rejectReason = 'no_tryable_candidates';
            lastDanmuAutoFallbackStats.rejectReasons.push('no_tryable_candidates');
        }

        const metadataCandidates = [];

        for (const candidate of candidatesToTry) {
            lastDanmuAutoFallbackStats.triedCandidateCount += 1;
            lastDanmuAutoFallbackStats.candidateScore = candidate.score;
            danmuDebugLog('[DanmuDebug] auto fallback candidate try', {
                animeId: candidate.animeId,
                animeTitle: candidate.animeTitle,
                coreTitle: candidate.coreTitle,
                displayEpisode: episodeIndex + 1,
                score: candidate.score,
                triedCandidateCount: lastDanmuAutoFallbackStats.triedCandidateCount
            });

            let rejectReason = getDanmuCandidateRejectReason(context, candidate);
            if (rejectReason) {
                lastDanmuAutoFallbackStats.rejectReason = rejectReason;
                lastDanmuAutoFallbackStats.rejectReasons.push(rejectReason);
                danmuDebugWarn('[DanmuDebug] auto fallback candidate hard rejected', {
                    rawTitle: candidate.animeTitle,
                    coreTitle: candidate.coreTitle,
                    normalizedCoreTitle: candidate.normalizedCoreTitle,
                    candidateYear: candidate.candidateYear || candidate.year,
                    candidateType: candidate.candidateType || candidate.typeDescription || candidate.type,
                    sourceName: candidate.sourceName,
                    currentTitle: context.title,
                    normalizedCurrentTitle,
                    currentYear,
                    titleScore: candidate.titleScore,
                    yearMatch: Boolean(currentYear && (candidate.candidateYear || candidate.year) && currentYear === normalizeDanmuYear(candidate.candidateYear || candidate.year)),
                    yearConflict: rejectReason === 'year_mismatch',
                    rejectReason,
                    hardRejected: true,
                    verifiedScore: 0
                });
                continue;
            }

            const episodes = await getAnimeEpisodesWithCache(candidate.animeId, cleanTitle);
            if (controller?.cancelled) return [];
            if (!episodes || episodes.length === 0) {
                rejectReason = 'bangumi_invalid';
            }

            const matchedEpisode = rejectReason ? null : pickMatchedDanmuEpisode(episodes, episodeIndex, title);
            rejectReason = rejectReason || getDanmuCandidateRejectReason(context, candidate, episodes, matchedEpisode);
            if (rejectReason) {
                lastDanmuAutoFallbackStats.rejectReason = rejectReason;
                lastDanmuAutoFallbackStats.rejectReasons.push(rejectReason);
                danmuDebugWarn('[DanmuDebug] auto fallback candidate hard rejected', {
                    rawTitle: candidate.animeTitle,
                    coreTitle: candidate.coreTitle,
                    normalizedCoreTitle: candidate.normalizedCoreTitle,
                    candidateYear: candidate.candidateYear || candidate.year,
                    candidateType: candidate.candidateType || candidate.typeDescription || candidate.type,
                    sourceName: candidate.sourceName,
                    currentTitle: context.title,
                    normalizedCurrentTitle,
                    currentYear,
                    titleScore: candidate.titleScore,
                    yearMatch: Boolean(currentYear && (candidate.candidateYear || candidate.year) && currentYear === normalizeDanmuYear(candidate.candidateYear || candidate.year)),
                    yearConflict: rejectReason === 'year_mismatch',
                    rejectReason,
                    hardRejected: true,
                    verifiedScore: 0
                });
                continue;
            }

            const metadataScore = calculateDanmuVerifiedScore(context, candidate, episodes, 0);
            metadataCandidates.push({
                candidate,
                episodes,
                matchedEpisode,
                metadataScore
            });
            danmuDebugLog('[DanmuDebug] auto fallback candidate metadata verified', {
                animeId: candidate.animeId,
                animeTitle: candidate.animeTitle,
                coreTitle: candidate.coreTitle,
                sourceName: candidate.sourceName,
                displayEpisode: episodeIndex + 1,
                episodeId: matchedEpisode.episodeId,
                metadataScore
            });
        }

        metadataCandidates.sort((a, b) => b.metadataScore - a.metadataScore);
        danmuDebugLog('[DanmuDebug] auto fallback metadata candidates', metadataCandidates.map(item => ({
            animeId: item.candidate.animeId,
            animeTitle: item.candidate.animeTitle,
            sourceName: item.candidate.sourceName,
            metadataScore: item.metadataScore,
            episodeId: item.matchedEpisode.episodeId
        })));

        for (const item of metadataCandidates) {
            const candidate = item.candidate;
            const episodes = item.episodes;
            const matchedEpisode = item.matchedEpisode;
            let rejectReason = '';

            if (lastDanmuAutoFallbackStats.triedCommentCount >= DANMU_AUTO_FALLBACK_MAX_COMMENT_REQUESTS) {
                rejectReason = 'comment_probe_limit_reached';
                lastDanmuAutoFallbackStats.rejectReason = rejectReason;
                lastDanmuAutoFallbackStats.rejectReasons.push(rejectReason);
                danmuDebugWarn('[DanmuDebug] auto fallback comment probe limit reached', {
                    maxCommentRequests: DANMU_AUTO_FALLBACK_MAX_COMMENT_REQUESTS,
                    triedCommentCount: lastDanmuAutoFallbackStats.triedCommentCount,
                    nextAnimeId: candidate.animeId,
                    nextEpisodeId: matchedEpisode.episodeId
                });
                break;
            }

            lastDanmuAutoFallbackStats.triedCommentCount += 1;
            const danmuku = await fetchDanmaku(matchedEpisode.episodeId, episodeIndex, {
                silentCandidate: true
            });
            if (controller?.cancelled) return [];
            if (!danmuku || danmuku.length === 0) {
                rejectReason = lastDanmuFetchStats?.failReason || 'empty_comment';
                if (lastDanmuFetchStats?.rateLimited || rejectReason === 'rate_limited') {
                    lastDanmuAutoFallbackStats.rateLimited = true;
                    lastDanmuAutoFallbackStats.rejectReason = 'rate_limited';
                    lastDanmuAutoFallbackStats.rejectReasons.push('rate_limited');
                    danmuDebugWarn('[DanmuDebug] auto fallback stopped by rate limit', {
                        animeId: candidate.animeId,
                        animeTitle: candidate.animeTitle,
                        episodeId: matchedEpisode.episodeId,
                        triedCommentCount: lastDanmuAutoFallbackStats.triedCommentCount
                    });
                    break;
                }
                lastDanmuAutoFallbackStats.rejectReason = rejectReason;
                lastDanmuAutoFallbackStats.rejectReasons.push(rejectReason);
                danmuDebugWarn('[DanmuDebug] auto fallback candidate rejected', {
                    animeId: candidate.animeId,
                    animeTitle: candidate.animeTitle,
                    displayEpisode: episodeIndex + 1,
                    episodeId: matchedEpisode.episodeId,
                    score: candidate.score,
                    rejectReason,
                    triedCommentCount: lastDanmuAutoFallbackStats.triedCommentCount
                });
                continue;
            }

            const verifiedScore = calculateDanmuVerifiedScore(context, candidate, episodes, danmuku.length);
            const validCandidate = {
                candidate,
                episodes,
                matchedEpisode,
                danmuku,
                verifiedScore,
                metadataScore: item.metadataScore,
                fetchStats: { ...(lastDanmuFetchStats || {}) }
            };
            validCandidates.push(validCandidate);
            lastDanmuAutoFallbackStats.validCandidateCount = validCandidates.length;

            danmuDebugLog('[DanmuDebug] auto fallback candidate verified', {
                animeId: candidate.animeId,
                animeTitle: candidate.animeTitle,
                rawTitle: candidate.animeTitle,
                coreTitle: candidate.coreTitle,
                normalizedCoreTitle: candidate.normalizedCoreTitle,
                candidateYear: candidate.candidateYear || candidate.year,
                candidateType: candidate.candidateType || candidate.typeDescription || candidate.type,
                sourceName: candidate.sourceName,
                currentTitle: context.title,
                normalizedCurrentTitle,
                currentYear,
                displayEpisode: episodeIndex + 1,
                titleScore: candidate.titleScore,
                yearMatch: Boolean(currentYear && (candidate.candidateYear || candidate.year) && currentYear === normalizeDanmuYear(candidate.candidateYear || candidate.year)),
                yearConflict: false,
                rejectReason: '',
                hardRejected: false,
                verifiedScore,
                metadataScore: item.metadataScore,
                commentCount: danmuku.length,
                episodeId: matchedEpisode.episodeId
            });

            // Comment 已验证且非空，立即停止后续候选验证，避免额外 404/429。
            break;
        }

        danmuDebugLog('[DanmuDebug] auto fallback valid candidates', validCandidates.map(item => ({
            animeId: item.candidate.animeId,
            animeTitle: item.candidate.animeTitle,
            verifiedScore: item.verifiedScore,
            loadedCount: item.danmuku.length,
            episodeId: item.matchedEpisode.episodeId
        })));
        lastDanmuAutoFallbackStats.validCandidateCount = validCandidates.length;

        if (validCandidates.length) {
            validCandidates.sort((a, b) => b.verifiedScore - a.verifiedScore);
            const best = validCandidates[0];
            const candidate = best.candidate;
            const matchedEpisode = best.matchedEpisode;
            const danmuku = best.danmuku;

            currentDanmuAnimeId = candidate.animeId;
            currentDanmuSourceName = candidate.sourceName || candidate.animeTitle || '';
            currentSessionDanmuSource = {
                animeId: candidate.animeId,
                animeTitle: candidate.animeTitle || '',
                sourceName: candidate.sourceName || candidate.animeTitle || '',
                selectedBy: 'auto-fallback',
                episodes: best.episodes,
                episodeCount: best.episodes.length,
                updatedAt: Date.now()
            };
            lastDanmuFetchStats = best.fetchStats;
            currentDanmuCache = {
                episodeIndex,
                danmuList: danmuku,
                timestamp: Date.now()
            };
            if (videoPlayer) {
                videoPlayer.updateDanmuCache(episodeIndex, danmuku);
            }

            lastDanmuAutoFallbackStats.autoApplied = true;
            lastDanmuAutoFallbackStats.rejectReason = '';
            updateLastDanmuMatchInfo({
                reason: 'auto-fallback',
                matchMode: 'auto-fallback',
                matchQuery,
                episodeIndex,
                displayEpisode: episodeIndex + 1,
                animeId: candidate.animeId,
                animeTitle: candidate.animeTitle || '',
                episodeId: matchedEpisode.episodeId,
                episodeTitle: matchedEpisode.episodeTitle || matchedEpisode.title || matchedEpisode.name || '',
                sourceName: candidate.sourceName || candidate.animeTitle || '',
                selectedBy: 'auto-fallback',
                fallbackUsed: true,
                manualSourceUsed: false,
                sessionSourceUsed: false,
                autoApplied: true,
                candidateCount: candidates.length,
                triedCandidateCount: lastDanmuAutoFallbackStats.triedCandidateCount,
                triedCommentCount: lastDanmuAutoFallbackStats.triedCommentCount,
                candidateScore: candidate.score,
                currentYear,
                candidateYear: candidate.candidateYear || candidate.year || '',
                yearConflict: false,
                coreTitle: normalizedCurrentTitle,
                candidateCoreTitle: candidate.normalizedCoreTitle || candidate.coreTitle || '',
                titleScore: candidate.titleScore,
                rejectReason: '',
                hardRejected: false,
                rateLimited: false,
                verifiedScore: best.verifiedScore,
                validCandidateCount: validCandidates.length,
                selectedCandidateReason: 'metadata_top_comment_success',
                commentCount: danmuku.length,
                confidence: best.verifiedScore,
                loadedCount: danmuku.length
            });

            danmuDebugLog('[DanmuDebug] auto fallback best selected', {
                animeId: candidate.animeId,
                animeTitle: candidate.animeTitle,
                displayEpisode: episodeIndex + 1,
                verifiedScore: best.verifiedScore,
                validCandidateCount: validCandidates.length,
                loadedCount: danmuku.length
            });
            return danmuku;
        }

        danmuDebugWarn('[DanmuDebug] auto fallback failed', {
            cleanTitle,
            displayEpisode: episodeIndex + 1,
            candidateCount: candidates.length,
            triedCandidateCount: lastDanmuAutoFallbackStats.triedCandidateCount,
            triedCommentCount: lastDanmuAutoFallbackStats.triedCommentCount,
            validCandidateCount: validCandidates.length,
            rateLimited: Boolean(lastDanmuAutoFallbackStats.rateLimited),
            topScore: ranked[0]?.score || 0
        });
        if (!lastDanmuAutoFallbackStats.rejectReason) {
            lastDanmuAutoFallbackStats.rejectReason = validCandidates.length
                ? 'no_best_candidate'
                : 'no_valid_candidate';
            lastDanmuAutoFallbackStats.rejectReasons.push(lastDanmuAutoFallbackStats.rejectReason);
        }
        return null;
    } catch (error) {
        lastDanmuAutoFallbackStats = {
            ...(lastDanmuAutoFallbackStats || {}),
            rejectReason: 'search-error',
            rateLimited: Boolean(lastDanmuAutoFallbackStats?.rateLimited),
            triedCommentCount: Number(lastDanmuAutoFallbackStats?.triedCommentCount || 0),
            rejectReasons: [
                ...((lastDanmuAutoFallbackStats && lastDanmuAutoFallbackStats.rejectReasons) || []),
                'search-error'
            ]
        };
        danmuDebugWarn('[DanmuDebug] auto fallback search failed', {
            cleanTitle,
            displayEpisode: episodeIndex + 1,
            error: error?.message || String(error)
        });
        return null;
    }
}

// 主弹幕获取函数：自动 match + 页面会话源复用 + 用户手选
let _danmuFetchController = null;

async function getDanmukuForVideo(title, episodeIndex) {
    if (!isDanmuServiceEnabled()) return [];

    // 取消上一次未完成的弹幕匹配
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
            currentDanmuCache.danmuList = limitDanmakuList(currentDanmuCache.danmuList);
            danmuDebugLog('✅ 使用弹幕缓存（当前集）');
            updateLastDanmuMatchInfo({
                reason: 'cache',
                matchMode: 'cache',
                episodeIndex,
                displayEpisode: episodeIndex + 1,
                loadedCount: currentDanmuCache.danmuList.length
            });
            return currentDanmuCache.danmuList;
        }

        const cleanTitle = getDanmuSearchKeyword(title);
        const context = getDanmuPlaybackContext(title, episodeIndex);
        const matchQuery = buildDanmuKeyword(context);
        const matchQueries = buildDanmuMatchQueries(context);

        danmuDebugLog('[DanmuDebug] match params', {
            cleanTitle,
            year: context.year,
            episodeIndex,
            displayEpisode: episodeIndex + 1,
            episodeName: context.episodeName,
            sourceCode: context.sourceCode,
            currentVideoUrl,
            duration: context.duration,
            matchQuery,
            matchQueries,
            currentSessionDanmuSource
        });

        updateLastDanmuMatchInfo({
            reason: 'match-start',
            matchMode: 'none',
            matchQuery,
            episodeIndex,
            displayEpisode: episodeIndex + 1,
            loadedCount: 0
        });

        const hasSessionSourceWithEpisodes =
            currentSessionDanmuSource?.animeId &&
            Array.isArray(currentSessionDanmuSource.episodes) &&
            currentSessionDanmuSource.episodes.length > 0;

        if (hasSessionSourceWithEpisodes) {
            danmuDebugLog('[DanmuDebug] session source episode mapping priority', {
                animeId: currentSessionDanmuSource.animeId,
                animeTitle: currentSessionDanmuSource.animeTitle || currentSessionDanmuSource.sourceName || '',
                displayEpisode: episodeIndex + 1,
                selectedBy: currentSessionDanmuSource.selectedBy,
                episodeCount: currentSessionDanmuSource.episodes.length
            });

            const sessionResult = await loadDanmakuFromAnimeCandidate(
                currentSessionDanmuSource.animeId,
                currentSessionDanmuSource.animeTitle || currentSessionDanmuSource.sourceName || '',
                cleanTitle,
                title,
                episodeIndex,
                controller,
                'session-source',
                {
                    matchMode: 'session-source',
                    selectedBy: currentSessionDanmuSource.selectedBy || 'auto',
                    manualSourceUsed: currentSessionDanmuSource.selectedBy === 'manual',
                    sessionSourceUsed: true,
                    fallbackUsed: false,
                    matchQuery,
                    episodes: currentSessionDanmuSource.episodes
                }
            );
            if (controller.cancelled) return [];
            if (sessionResult && sessionResult.length > 0) {
                return sessionResult;
            }

            danmuDebugWarn('[DanmuDebug] session source did not resolve current episode, fallback to api match', {
                animeId: currentSessionDanmuSource?.animeId || '',
                displayEpisode: episodeIndex + 1,
                matchQuery
            });
        }

        const matchedByApi = await matchDanmuByApi(title, episodeIndex);
        if (controller.cancelled) return [];

        if (matchedByApi && matchedByApi.episodeId) {
            const result = await fetchDanmaku(matchedByApi.episodeId, episodeIndex);
            if (controller.cancelled) return [];

            if (result && result.length > 0) {
                currentDanmuAnimeId = matchedByApi.animeId || null;
                currentDanmuSourceName = matchedByApi.animeTitle || '';
                if (currentDanmuAnimeId) {
                    const episodes = await getAnimeEpisodesWithCache(currentDanmuAnimeId, cleanTitle);
                    if (controller.cancelled) return [];
                    if (Array.isArray(episodes) && episodes.length > 0) {
                        currentSessionDanmuSource = {
                            animeId: currentDanmuAnimeId,
                            animeTitle: currentDanmuSourceName,
                            sourceName: currentDanmuSourceName,
                            selectedBy: 'auto',
                            episodes,
                            episodeCount: episodes.length,
                            updatedAt: Date.now()
                        };
                    }
                }
                updateLastDanmuMatchInfo({
                    reason: 'api-match',
                    matchMode: 'api-match',
                    matchQuery: matchedByApi.matchQuery || matchQuery,
                    episodeIndex,
                    displayEpisode: episodeIndex + 1,
                    animeId: matchedByApi.animeId || '',
                    animeTitle: matchedByApi.animeTitle || '',
                    episodeId: matchedByApi.episodeId,
                    episodeTitle: matchedByApi.episodeTitle || '',
                    sourceName: matchedByApi.animeTitle || '',
                    selectedBy: 'auto',
                    fallbackUsed: false,
                    manualSourceUsed: false,
                    sessionSourceUsed: false,
                    confidence: matchedByApi.confidence || 90,
                    loadedCount: result.length
                });
                danmuDebugLog('[DanmuDebug] match success', {
                    matchMode: 'api-match',
                    matchQuery: matchedByApi.matchQuery || matchQuery,
                    animeId: matchedByApi.animeId || '',
                    animeTitle: matchedByApi.animeTitle || '',
                    episodeId: matchedByApi.episodeId,
                    episodeTitle: matchedByApi.episodeTitle || '',
                    sourceName: matchedByApi.animeTitle || '',
                    confidence: matchedByApi.confidence || null
                });
                return result;
            }
        }

        if (currentSessionDanmuSource?.animeId && !hasSessionSourceWithEpisodes) {
            const sessionResult = await loadDanmakuFromAnimeCandidate(
                currentSessionDanmuSource.animeId,
                currentSessionDanmuSource.animeTitle || currentSessionDanmuSource.sourceName || '',
                cleanTitle,
                title,
                episodeIndex,
                controller,
                'session-source',
                {
                    matchMode: 'session-source',
                    selectedBy: currentSessionDanmuSource.selectedBy || 'manual',
                    manualSourceUsed: currentSessionDanmuSource.selectedBy === 'manual',
                    sessionSourceUsed: true,
                    fallbackUsed: false,
                    matchQuery
                }
            );
            if (controller.cancelled) return [];
            if (sessionResult && sessionResult.length > 0) {
                return sessionResult;
            }
        }

        const fallbackResult = await autoFallbackDanmakuBySearchCandidate(cleanTitle, title, episodeIndex, controller, matchQuery);
        if (controller.cancelled) return [];
        if (fallbackResult && fallbackResult.length > 0) {
            return fallbackResult;
        }

        danmuDebugWarn('[DanmuDebug] strict match failed', {
            cleanTitle,
            displayEpisode: episodeIndex + 1,
            episodeName: context.episodeName,
            matchQuery,
            matchQueries,
            reason: 'api-match-and-session-source-failed',
            nextAction: 'open-danmu-source-modal'
        });

        updateLastDanmuMatchInfo({
            reason: 'auto-match-failed',
            matchMode: 'none',
            matchQuery,
            episodeIndex,
            displayEpisode: episodeIndex + 1,
            selectedBy: '',
            fallbackUsed: Boolean(lastDanmuAutoFallbackStats?.candidateCount || lastDanmuAutoFallbackStats?.triedCandidateCount),
            manualSourceUsed: false,
            autoApplied: false,
            candidateCount: Number(lastDanmuAutoFallbackStats?.candidateCount || 0),
            triedCandidateCount: Number(lastDanmuAutoFallbackStats?.triedCandidateCount || 0),
            triedCommentCount: Number(lastDanmuAutoFallbackStats?.triedCommentCount || 0),
            validCandidateCount: Number(lastDanmuAutoFallbackStats?.validCandidateCount || 0),
            rateLimited: Boolean(lastDanmuAutoFallbackStats?.rateLimited),
            rejectReason: lastDanmuAutoFallbackStats?.rejectReason || '',
            rejectReasons: lastDanmuAutoFallbackStats?.rejectReasons || [],
            loadedCount: 0,
            failReason: lastDanmuAutoFallbackStats?.rejectReason || 'api-match-and-session-source-failed'
        });

        console.warn('❌ 未自动匹配到当前集弹幕，请手动选择弹幕源');
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

function clearCurrentDanmukuPlugin(reason = 'clear') {
    const danmukuPlugin = art?.plugins?.artplayerPluginDanmuku;
    if (!danmukuPlugin) {
        danmuDebugWarn('[DanmuDebug] 弹幕插件不存在，无法清空旧弹幕', { reason });
        return Promise.resolve(false);
    }

    danmuDebugLog('[DanmuDebug] clear old danmaku', {
        reason,
        currentEpisodeIndex
    });

    return applyDanmakuRuntimeState({
        reason: `${reason}:clear`,
        danmuku: [],
        reload: true,
    });
}

function getVideoSourceHint(url) {
    try {
        const parsed = new URL(url, window.location.href);
        const pathname = decodeURIComponent(parsed.pathname || '');
        return pathname.split('/').filter(Boolean).pop() || '';
    } catch (error) {
        const clean = String(url || '').split('?')[0].split('#')[0];
        return clean.split('/').filter(Boolean).pop() || '';
    }
}

function isCurrentVideoSourceMatched(currentSrc, targetUrl) {
    if (!targetUrl) return true;
    if (!currentSrc) return false;
    if (/^(blob:|mediastream:)/i.test(currentSrc)) return true;

    const normalizedCurrent = String(currentSrc);
    const normalizedTarget = String(targetUrl);
    if (normalizedCurrent === normalizedTarget) return true;
    if (normalizedCurrent.includes(normalizedTarget) || normalizedTarget.includes(normalizedCurrent)) return true;

    const hint = getVideoSourceHint(targetUrl);
    return Boolean(hint && normalizedCurrent.includes(hint));
}

function waitForCurrentVideoReady(maxWait = 10000, expected = {}) {
    return new Promise((resolve) => {
        const start = Date.now();

        const checkReady = () => {
            const video = art?.video;
            const currentSrc = video?.currentSrc || video?.src || '';
            const readyState = video?.readyState || 0;
            const duration = video?.duration || 0;
            const indexMatched = typeof expected.episodeIndex !== 'number' ||
                expected.episodeIndex === currentEpisodeIndex;
            const sourceMatched = isCurrentVideoSourceMatched(currentSrc, expected.episodeUrl);
            const ready = readyState >= 1;
            const waitedToNewSource = Boolean(ready && indexMatched && sourceMatched);
            const state = {
                ready,
                waitedToNewSource,
                indexMatched,
                sourceMatched,
                currentSrc,
                readyState,
                duration,
                elapsed: Date.now() - start
            };

            if (!art || !video) {
                if (Date.now() - start >= maxWait) {
                    resolve(state);
                    return;
                }
                setTimeout(checkReady, 80);
                return;
            }

            if (waitedToNewSource || Date.now() - start >= maxWait) {
                resolve(state);
                return;
            }

            setTimeout(checkReady, 80);
        };

        checkReady();
    });
}

async function loadDanmakuForCurrentEpisode(reason = 'episode-switch') {
    if (!isDanmuServiceEnabled()) return;

    const reloadToken = ++danmuReloadToken;
    const episodeIndex = currentEpisodeIndex;
    const title = currentVideoTitle;
    const episodeUrl = getPlayerEpisodeUrlValue(currentEpisodes?.[episodeIndex]);

    danmuDebugLog('[DanmuDebug] episode switch start', {
        reason,
        currentEpisodeIndex: episodeIndex,
        title,
        episodeUrl
    });

    await clearCurrentDanmukuPlugin(reason);

    const videoState = await waitForCurrentVideoReady(10000, {
        episodeIndex,
        episodeUrl
    });
    if (reloadToken !== danmuReloadToken || episodeIndex !== currentEpisodeIndex) return;

    danmuDebugLog('[DanmuDebug] video ready for danmaku reload', {
        reason,
        targetEpisodeIndex: episodeIndex,
        currentEpisodeIndex,
        targetEpisodeUrl: episodeUrl,
        currentVideoUrl,
        currentSrc: videoState.currentSrc,
        readyState: videoState.readyState,
        duration: videoState.duration,
        waitedToNewSource: videoState.waitedToNewSource,
        indexMatched: videoState.indexMatched,
        sourceMatched: videoState.sourceMatched
    });

    if (!videoState.waitedToNewSource) {
        danmuDebugWarn('[DanmuDebug] 切集后视频源未完全稳定，仍尝试加载当前集弹幕', videoState);
    }

    const danmukuPlugin = art?.plugins?.artplayerPluginDanmuku;
    if (!danmukuPlugin) {
        danmuDebugWarn('[DanmuDebug] 弹幕插件不存在，无法重新加载当前集弹幕', { reason });
        danmuDebugWarn('[DanmuDebug] episode switch danmaku failed', {
            reason,
            displayEpisode: episodeIndex + 1,
            failReason: 'plugin-missing',
            matchMode: lastDanmuMatchInfo?.matchMode || 'none',
            fallbackUsed: Boolean(lastDanmuMatchInfo?.fallbackUsed),
            candidateCount: 0
        });
        logDanmuEpisodeSummary(reason, {
            episodeIndex,
            loadedCount: 0,
            pluginApplied: false,
            failReason: 'plugin-missing'
        });
        logDanmuVisibilityState(`${reason}:reload-complete`, {
            loadedCount: 0,
            pluginApplied: false,
            failReason: 'plugin-missing'
        });
        return;
    }

    danmuDebugLog('[DanmuDebug] match params', {
        title,
        episodeIndex,
        episodeTitle: getCurrentEpisodeName(episodeIndex),
        episodeUrl,
        currentVideoUrl,
        reason
    });

    const danmuku = await getDanmukuForVideo(title, episodeIndex);
    if (reloadToken !== danmuReloadToken || episodeIndex !== currentEpisodeIndex) return;

    danmuDebugLog('[DanmuDebug] match result', {
        episodeIndex,
        count: Array.isArray(danmuku) ? danmuku.length : 0,
        reason
    });

    if (!danmuku || danmuku.length === 0) {
        danmuDebugWarn('[DanmuDebug] episode switch danmaku failed', {
            reason,
            displayEpisode: episodeIndex + 1,
            failReason: 'empty-danmaku',
            matchMode: lastDanmuMatchInfo?.matchMode || 'none',
            fallbackUsed: Boolean(lastDanmuMatchInfo?.fallbackUsed),
            candidateCount: 0
        });
        logDanmuEpisodeSummary(reason, {
            episodeIndex,
            loadedCount: 0,
            pluginApplied: false,
            failReason: 'empty-danmaku'
        });
        logDanmuVisibilityState(`${reason}:reload-complete`, {
            loadedCount: 0,
            pluginApplied: true,
            failReason: 'empty-danmaku'
        });
        return;
    }

    danmuDebugLog('[DanmuDebug] apply danmaku to artplayer', {
        displayEpisode: episodeIndex + 1,
        rawCount: lastDanmuFetchStats?.rawCount || 0,
        validCount: lastDanmuFetchStats?.validCount || 0,
        convertedCount: lastDanmuFetchStats?.convertedCount || 0,
        loadedCount: danmuku.length,
        hasPlugin: Boolean(danmukuPlugin)
    });

    try {
        await applyDanmakuRuntimeState({
            reason,
            danmuku,
            reload: true,
        });
    } catch (error) {
        danmuDebugWarn('[DanmuDebug] apply danmaku to artplayer failed', {
            displayEpisode: episodeIndex + 1,
            error: error?.message || String(error)
        });
        logDanmuEpisodeSummary(reason, {
            episodeIndex,
            loadedCount: danmuku.length,
            pluginApplied: false,
            failReason: 'plugin-apply-failed'
        });
        logDanmuVisibilityState(`${reason}:reload-complete`, {
            loadedCount: danmuku.length,
            pluginApplied: false,
            failReason: 'plugin-apply-failed'
        });
        return;
    }
    danmuDebugLog('[DanmuDebug] load danmaku count', {
        episodeIndex,
        count: danmuku.length,
        reason
    });

    danmuDebugLog('[DanmuDebug] apply danmaku to artplayer success', {
        displayEpisode: episodeIndex + 1,
        loadedCount: danmuku.length,
        reason
    });
    danmuDebugLog('[DanmuDebug] episode switch danmaku result', {
        reason,
        displayEpisode: episodeIndex + 1,
        matchedEpisodeTitle: lastDanmuMatchInfo?.episodeTitle || '',
        matchMode: lastDanmuMatchInfo?.matchMode || 'none',
        fallbackUsed: Boolean(lastDanmuMatchInfo?.fallbackUsed),
        loadedCount: danmuku.length,
        pluginApplied: true
    });
    logDanmuEpisodeSummary(reason, {
        episodeIndex,
        loadedCount: danmuku.length,
        pluginApplied: true
    });
    logDanmuVisibilityState(`${reason}:reload-complete`, {
        loadedCount: danmuku.length,
        pluginApplied: true
    });
    danmuDebugLog(`✅ 切集后已重新加载第${episodeIndex + 1}集弹幕: ${danmuku.length}条`, { reason });
}

function reloadDanmakuForCurrentEpisode(reason = 'episode-switch') {
    return loadDanmakuForCurrentEpisode(reason);
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
            window.LibertyDebug.log('[WatchRoomAudit] player init source', {
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
        window.LibertyDebug.log('[历史记录] 尝试保存初始历史记录');
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
            window.LibertyDebug.log('ℹ️ 浏览器不支持 Wake Lock，启用备用方案');
            this.enableNoSleepFallback();
            return;
        }

        if (this.wakeLock.instance !== null) return;

        try {
            this.wakeLock.instance = await navigator.wakeLock.request('screen');
            window.LibertyDebug.log('防息屏已激活');

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
                window.LibertyDebug.log('✅ HLS 实例已完全销毁');
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
                window.LibertyDebug.log('✅ 播放器已完全销毁');
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
        danmuDebugLog('✅ 弹幕缓存已清理');
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
        window.LibertyDebug.log('🧹 VideoPlayer 开始销毁...');

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

        window.LibertyDebug.log('✅ VideoPlayer 销毁完成');
    }
}

// 全局 VideoPlayer 实例
let videoPlayer = null;

// 初始化播放器
function initPlayer(videoUrl) {
    // 🔥 使用 VideoPlayer 类管理实例
    if (videoPlayer) {
        window.LibertyDebug.log('🔄 销毁旧播放器实例');
        const status = videoPlayer.getStatus();
        window.LibertyDebug.log('旧实例状态:', status);
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

    window.LibertyDebug.log('🎬 开始初始化播放器...');

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
        window.LibertyDebug.log('[WatchRoom] watch room launch detected, disable initial autoplay', {
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
        autoMini: !isMobileDevice,
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
				fontSize: danmuDisplayConfig.fontSize || getDanmuDefaultFontSize(),
				color: danmuDisplayConfig.color,
				mode: danmuDisplayConfig.mode,
				modes: [0, 1, 2],
				margin: getDanmuTrackMargin(),
				visible: isDanmuUserVisibleEnabled(),
				MARGIN: {
					min: 0,
					max: DANMU_DISPLAY_AREA_OPTIONS.length - 1,
					steps: getDanmuDisplayAreaSteps(),
				},
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
						window.LibertyDebug.log('✅ HLS 实例已完全销毁');
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
                        window.LibertyDebug.log('[WatchRoomAudit] skip hls manifest autoplay for watch room mode', {
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
                    .then(() => window.LibertyDebug.log('✅ 已锁定横屏'))
                    .catch((error) => console.warn('⚠️ 横屏锁定失败:', error));
            }
        } else {
            document.removeEventListener('mouseout', handleMouseOut);
            clearTimeout(hideTimer);

            // ✅ 退出全屏时解锁方向
            if (isMobileDevice && window.screen?.orientation) {
                try {
                    window.screen.orientation.unlock();
                    window.LibertyDebug.log('✅ 已解锁屏幕方向');
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
		markDanmakuLayoutState();
		setupDanmakuTouchPanels();

		// ✅ 监听弹幕插件配置变更，持久化用户设置
		// ArtPlayer 弹幕插件会在用户通过设置面板修改时触发 artplayerPluginDanmuku:config
		art.on('artplayerPluginDanmuku:config', (config) => {
		    const toSave = {};
		    const previousDisplayArea = danmuDisplayConfig.displayArea;
		    let shouldRefreshDanmakuLayout = false;
		    if (config.speed !== undefined) toSave.speed = config.speed;
		    if (config.opacity !== undefined) toSave.opacity = config.opacity;
		    if (config.fontSize !== undefined) toSave.fontSize = config.fontSize;
		    if (config.color !== undefined) toSave.color = config.color;
		    if (config.mode !== undefined) toSave.mode = config.mode;
		    if (config.margin !== undefined) {
		        const displayArea = getDanmuDisplayAreaByMargin(config.margin);
		        if (displayArea) {
		            toSave.displayArea = displayArea;
		            shouldRefreshDanmakuLayout = displayArea !== previousDisplayArea;
		        }
		    }
		    if (config.visible !== undefined && !document.hidden) {
		        toSave.visible = Boolean(config.visible);
		        logDanmuVisibilityState('user-config-visible', {
		            pluginVisible: Boolean(config.visible)
		        });
		    }
		    if (Object.keys(toSave).length > 0) {
		        saveDanmuConfig(toSave);
		        danmuDebugLog('✅ 弹幕显示设置已保存:', toSave);;
		    }
		    if (shouldRefreshDanmakuLayout) {
		        queueDanmakuLayoutRefresh('user-config-margin', 0, { force: true });
		    }
		});

		art.on('artplayerPluginDanmuku:show', () => {
		    if (!document.hidden) {
		        saveDanmuConfig({ visible: true });
		        logDanmuVisibilityState('user-show', {
		            pluginVisible: true
		        });
		    }
		});

		art.on('artplayerPluginDanmuku:hide', () => {
		    if (!document.hidden) {
		        saveDanmuConfig({ visible: false });
		        logDanmuVisibilityState('user-hide', {
		            pluginVisible: false
		        });
		    }
		});

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
				refreshDanmakuRuntimeLayout('timeline-seek', { force: true });
			}, debounceDelay);
		});

		// 播放器销毁时清理
		art.on('destroy', () => {
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
			cleanupMobileOrientationFullscreen();

			const handleOrientationChange = () => {
				if (window.matchMedia("(orientation: landscape)").matches) {
					if (art.playing && !art.fullscreen) {
						setTimeout(() => {
							art.fullscreen = true;
						}, 300);
					}
				}
			};

			if (window.screen?.orientation?.addEventListener) {
				window.screen.orientation.addEventListener('change', handleOrientationChange);
				_mobileOrientationFullscreenCleanup = () => {
					window.screen.orientation.removeEventListener('change', handleOrientationChange);
					_mobileOrientationFullscreenCleanup = null;
				};
			} else {
				window.addEventListener('orientationchange', handleOrientationChange);
				_mobileOrientationFullscreenCleanup = () => {
					window.removeEventListener('orientationchange', handleOrientationChange);
					_mobileOrientationFullscreenCleanup = null;
				};
			}

			art.on('destroy', cleanupMobileOrientationFullscreen);
		}
	});

    // 全屏 Web 模式处理
    art.on('fullscreenWeb', function (isFullScreen) {
        logFullscreenDebug('art-fullscreen-web');
        handleFullScreen(isFullScreen, true);
        refreshPlayerViewport('fullscreenWeb');

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
        logFullscreenDebug('art-fullscreen');
        handleFullScreen(isFullScreen, false);
        refreshPlayerViewport('fullscreen');
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
            window.LibertyDebug.log('[WatchRoomAudit] watch room mode', {
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
            window.LibertyDebug.log('[WatchRoomAudit] skip local progress restore for watch room viewer', {
                savedPosition,
                restoredPosition
            });
        }

        // 加载弹幕
        if (isDanmuServiceEnabled() && art.plugins.artplayerPluginDanmuku) {
            loadDanmakuForCurrentEpisode('initial-load').catch((e) => {
                console.error('❌ 弹幕加载失败:', e);
                logDanmuEpisodeSummary('initial-load', {
                    episodeIndex: currentEpisodeIndex,
                    loadedCount: 0,
                    pluginApplied: false,
                    failReason: e?.message || String(e)
                });
            });
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
    setupMobileTouchSchemeA();

    // 视频播放结束事件
    art.on('video:ended', function () {
        videoHasEnded = true;

        clearVideoProgress();

        // 如果自动播放下一集开启，且确实有下一集
        if (autoplayEnabled && currentEpisodeIndex < currentEpisodes.length - 1) {
            // 稍长延迟以确保所有事件处理完成
            setTimeout(() => {
                // 确认不是因为用户拖拽导致的假结束事件
                playNextEpisode('autoplay-next');
                videoHasEnded = false; // 重置标志
            }, 1000);
        } else {
            art.fullscreen = false;
        }
    });

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

    window.LibertyDebug.log('✅ 播放器初始化完成');
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

function getWatchRoomUiApi() {
    return window.LibertyWatchRoom?.ui || null;
}

function getActiveWatchRoomForPlayer() {
    return getWatchRoomUiApi()?.getActiveRoomSnapshot?.() || null;
}

function normalizeWatchRoomEpisodeEntries(episodes = currentEpisodes) {
    return (Array.isArray(episodes) ? episodes : []).map((episode, index) => ({
        index,
        name: getCurrentEpisodeName(index) || `第 ${index + 1} 集`,
        url: getPlayerEpisodeUrlValue(episode)
    }));
}

function buildWatchRoomEpisodeSnapshot(index) {
    const episodeIndex = Number(index);
    const episodes = normalizeWatchRoomEpisodeEntries(currentEpisodes);
    const target = episodes[episodeIndex];
    if (!Number.isInteger(episodeIndex) || episodeIndex < 0 || episodeIndex >= episodes.length) return null;
    if (!target?.url) return null;

    const urlParams = new URLSearchParams(window.location.search);
    const video = art?.video;

    return {
        kind: 'episode',
        title: currentVideoTitle || localStorage.getItem('currentVideoTitle') || '',
        year: localStorage.getItem('currentVideoYear') || '',
        sourceCode: urlParams.get('source') || localStorage.getItem('currentSourceCode') || '',
        vodId: urlParams.get('id') || localStorage.getItem('currentVodId') || '',
        episodeIndex,
        episodeName: target.name || `第 ${episodeIndex + 1} 集`,
        episodeUrl: target.url,
        episodes,
        currentTime: 0,
        playbackRate: Number(video?.playbackRate) || 1,
        updatedAt: Date.now(),
        changeId: `episode_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
    };
}

function interceptWatchRoomEpisodeChange(index, reason = 'manual') {
    const room = getActiveWatchRoomForPlayer();
    if (!room?.roomId || !['waiting', 'starting', 'playing'].includes(room.status)) return false;

    if (isApplyingWatchRoomEpisodeSnapshot) {
        return true;
    }

    if (room.role === 'viewer') {
        getWatchRoomUiApi()?.notifyViewerReadonlyControl?.();
        return true;
    }

    if (room.role === 'host' && (room.status === 'starting' || pendingWatchRoomEpisodeChangeId)) {
        showToast('正在同步切集，请稍后', 'info');
        return true;
    }

    if (room.role !== 'host' || room.status !== 'playing') return false;

    const snapshot = buildWatchRoomEpisodeSnapshot(index);
    if (!snapshot) {
        showToast('当前集播放地址无效，无法同步切集', 'warning');
        return true;
    }

    const sent = getWatchRoomUiApi()?.requestEpisodeChange?.(snapshot);
    if (!sent) {
        showToast('一起看尚未连接，请稍后重试', 'warning');
        return true;
    }

    pendingWatchRoomEpisodeChangeId = snapshot.changeId;
    window.LibertyDebug.log('[WatchRoom] episode change requested', {
        reason,
        changeId: snapshot.changeId,
        episodeIndex: snapshot.episodeIndex,
        episodeUrl: snapshot.episodeUrl
    });
    return true;
}

async function loadEpisodeFromWatchRoomSnapshot(snapshot = {}, options = {}) {
    const changeId = String(snapshot.changeId || options.changeId || '');
    const episodeIndex = Number(snapshot.episodeIndex);
    const episodes = Array.isArray(snapshot.episodes)
        ? snapshot.episodes.map((episode, index) => ({
            index,
            name: episode?.name || episode?.title || `第 ${index + 1} 集`,
            url: episode?.url || ''
        }))
        : [];
    const episodeUrl = String(snapshot.episodeUrl || episodes[episodeIndex]?.url || '');

    if (!changeId) throw new Error('Missing episode changeId');
    if (!Number.isInteger(episodeIndex) || episodeIndex < 0 || episodeIndex >= episodes.length) {
        throw new Error('Invalid episode index');
    }
    if (!episodeUrl) throw new Error('Missing episode url');

    isApplyingWatchRoomEpisodeSnapshot = true;
    pendingWatchRoomEpisodeChangeId = changeId;

    try {
        if (saveHistoryTimer) {
            clearTimeout(saveHistoryTimer);
            saveHistoryTimer = null;
        }
        if (progressSaveInterval) {
            clearInterval(progressSaveInterval);
            progressSaveInterval = null;
        }

        currentDanmuCache = { episodeIndex: -1, danmuList: null, timestamp: 0 };
        if (videoPlayer) videoPlayer.clearDanmuCache();

        await clearCurrentDanmukuPlugin('watch-room-episode');

        const errorElement = document.getElementById('error');
        if (errorElement) errorElement.style.display = 'none';
        const loadingElement = document.getElementById('player-loading');
        if (loadingElement) {
            loadingElement.style.display = 'flex';
            loadingElement.innerHTML = `
                <div class="loading-spinner"></div>
                <div>正在同步切集...</div>
            `;
        }

        currentEpisodes = episodes;
        currentEpisodeIndex = episodeIndex;
        currentVideoUrl = episodeUrl;
        videoHasEnded = false;
        clearVideoProgress();

        try {
            localStorage.setItem('currentEpisodes', JSON.stringify(episodes));
            localStorage.setItem('currentEpisodeIndex', String(episodeIndex));
        } catch (error) {}

        const currentUrl = new URL(window.location.href);
        currentUrl.searchParams.set('index', episodeIndex);
        currentUrl.searchParams.set('url', episodeUrl);
        currentUrl.searchParams.delete('position');
        window.history.replaceState({}, '', currentUrl.toString());

        if (isWebkit) {
            if (videoPlayer) videoPlayer.destroyHls();
            currentHls = null;
            initPlayer(episodeUrl);
        } else {
            if (videoPlayer) {
                videoPlayer.clearTimer('autoSaveHistory');
                videoPlayer.clearTimer('progressSave');
                videoPlayer.clearTimer('seekDebounce');
            }
            if (currentHls) {
                currentHls.stopLoad();
                currentHls.detachMedia();
            }
            requestAnimationFrame(() => {
                if (art) art.switch = episodeUrl;
            });
        }

        updateEpisodeInfo();
        updateButtonStates();
        renderEpisodes();
        reloadDanmakuForCurrentEpisode('watch-room-episode');
        document.dispatchEvent(new CustomEvent('liberty:watch-room-video-changed', {
            detail: { changeId, episodeIndex, episodeUrl }
        }));

        const readyState = await waitForCurrentVideoReady(8000, {
            episodeIndex,
            episodeUrl
        });
        if (!readyState.ready) {
            throw new Error('Episode video is not ready');
        }
        return readyState;
    } finally {
        if (pendingWatchRoomEpisodeChangeId === changeId) {
            pendingWatchRoomEpisodeChangeId = '';
        }
        isApplyingWatchRoomEpisodeSnapshot = false;
    }
}

window.LibertyPlayer = window.LibertyPlayer || {};
window.LibertyPlayer.loadEpisodeFromWatchRoomSnapshot = loadEpisodeFromWatchRoomSnapshot;
window.LibertyPlayer.buildWatchRoomEpisodeSnapshot = buildWatchRoomEpisodeSnapshot;

// 播放指定集数
function playEpisode(index, switchReason = 'manual') {
    // 确保index在有效范围内
    if (index < 0 || index >= currentEpisodes.length) {
        return;
    }

    if (interceptWatchRoomEpisodeChange(index, switchReason)) {
        return;
    }

    // 切换前清理旧资源
    window.LibertyDebug.log('🔄 准备切换集数，清理旧资源...');

    // 清理历史记录防抖定时器，防止旧集数写入
	if (saveHistoryTimer) {
		clearTimeout(saveHistoryTimer);
		saveHistoryTimer = null;
	}

	currentDanmuCache = { episodeIndex: -1, danmuList: null, timestamp: 0 };
	if (videoPlayer) videoPlayer.clearDanmuCache();

	danmuDebugLog('[DanmuDebug] keep manual danmu source across episode switch', {
		currentDanmuAnimeId,
		currentDanmuSourceName
	});

    clearCurrentDanmukuPlugin('episode-switch').catch((error) => {
        console.error('❌ 清空弹幕失败:', error);
    });

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
    danmuDebugLog('[DanmuDebug] episode switch start', {
        reason: switchReason,
        oldEpisodeIndex: currentEpisodeIndex,
        newEpisodeIndex: index,
        oldDisplayEpisode: currentEpisodeIndex + 1,
        newDisplayEpisode: index + 1,
        totalEpisodes: currentEpisodes?.length,
        targetEpisodeName: getCurrentEpisodeName(index),
        targetEpisodeUrl: url
    });

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
    reloadDanmakuForCurrentEpisode(switchReason);

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
function playPreviousEpisode(reason = 'previous') {
    if (currentEpisodeIndex > 0) {
        playEpisode(currentEpisodeIndex - 1, reason);
    }
}

// 播放下一集
function playNextEpisode(reason = 'next') {
    if (currentEpisodeIndex < currentEpisodes.length - 1) {
        playEpisode(currentEpisodeIndex + 1, reason);
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
					if (DEBUG_HISTORY) window.LibertyDebug.log('[历史记录] ⏭️ 跳过保存（变化不大）');
					return false;
				}

                if (DEBUG_HISTORY) window.LibertyDebug.log(`[历史记录] 位置: ${currentPosition.toFixed(0)}s / ${videoDuration.toFixed(0)}s`);
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
                    window.LibertyDebug.log(`[历史记录] 更新 第${videoInfo.episodeIndex + 1}集`);
                }
            } else {
                history.unshift(videoInfo);
                if (DEBUG_HISTORY) {
                    window.LibertyDebug.log(`[历史记录] 新增 第${videoInfo.episodeIndex + 1}集`);
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

function setupMobileTouchSchemeA() {
    if (!isMobileDevice || !art || !art.video) return;

    const videoElement = art.video;
    if (!videoElement) return;

    if (_mobileTouchInputHandlers) {
        const previousTarget = _mobileTouchInputHandlers.target;
        if (previousTarget) {
            previousTarget.removeEventListener('touchstart', _mobileTouchInputHandlers.touchstart);
            previousTarget.removeEventListener('touchmove', _mobileTouchInputHandlers.touchmove);
            previousTarget.removeEventListener('touchend', _mobileTouchInputHandlers.touchend);
            previousTarget.removeEventListener('touchcancel', _mobileTouchInputHandlers.touchcancel);
        }
        if (_mobileTouchInputHandlers.singleTapTimer) {
            clearTimeout(_mobileTouchInputHandlers.singleTapTimer);
        }
        _mobileTouchInputHandlers = null;
    }

    let lastTapTime = 0;
    let singleTapTimer = null;
    let touchMoved = false;
    let touchStartX = 0;
    let touchStartY = 0;
    const touchMoveThreshold = 12;

    const clearSingleTapTimer = () => {
        if (singleTapTimer) {
            clearTimeout(singleTapTimer);
            singleTapTimer = null;
        }
    };

    const getTouchPoint = (event) => event.changedTouches?.[0] || event.touches?.[0] || null;

    const isSettingOpen = () => Boolean(art?.setting?.show);

    const isControlsVisible = () => {
        const playerElement = art?.template?.$player;
        if (typeof art?.controls?.show === 'boolean') {
            return art.controls.show;
        }
        return Boolean(playerElement?.classList.contains('art-control-show'));
    };

    const toggleControlsVisibility = () => {
        if (!art?.controls) return;
        art.controls.show = !isControlsVisible();
    };

    const touchStartHandler = (event) => {
        const touch = getTouchPoint(event);
        touchMoved = event.touches?.length > 1;
        if (!touch || touchMoved) {
            return;
        }
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
    };

    const touchMoveHandler = (event) => {
        if (touchMoved) return;
        const touch = getTouchPoint(event);
        if (!touch) return;

        if (
            Math.abs(touch.clientX - touchStartX) > touchMoveThreshold ||
            Math.abs(touch.clientY - touchStartY) > touchMoveThreshold
        ) {
            touchMoved = true;
            clearSingleTapTimer();
            lastTapTime = 0;
        }
    };

    const touchEndHandler = (event) => {
        if (!art || art.video !== videoElement) return;

        if (touchMoved) {
            touchMoved = false;
            clearSingleTapTimer();
            lastTapTime = 0;
            _mobileLongPressTriggered = false;
            return;
        }

        if (isSettingOpen()) {
            clearSingleTapTimer();
            lastTapTime = 0;
            _mobileLongPressTriggered = false;
            return;
        }

        if (_mobileLongPressTriggered) {
            clearSingleTapTimer();
            lastTapTime = 0;
            _mobileLongPressTriggered = false;
            return;
        }

        if (event.cancelable) {
            event.preventDefault();
        }

        const now = Date.now();
        if (lastTapTime && now - lastTapTime <= Artplayer.DBCLICK_TIME) {
            clearSingleTapTimer();
            lastTapTime = 0;
            art.toggle();
            return;
        }

        lastTapTime = now;
        clearSingleTapTimer();
        singleTapTimer = window.setTimeout(() => {
            singleTapTimer = null;
            if (!art || art.video !== videoElement || isSettingOpen() || _mobileLongPressTriggered) {
                lastTapTime = 0;
                _mobileLongPressTriggered = false;
                return;
            }
            toggleControlsVisibility();
            lastTapTime = 0;
        }, Artplayer.DBCLICK_TIME);
    };

    const touchCancelHandler = () => {
        touchMoved = false;
        clearSingleTapTimer();
        lastTapTime = 0;
        _mobileLongPressTriggered = false;
    };

    videoElement.addEventListener('touchstart', touchStartHandler, { passive: true });
    videoElement.addEventListener('touchmove', touchMoveHandler, { passive: true });
    videoElement.addEventListener('touchend', touchEndHandler, { passive: false });
    videoElement.addEventListener('touchcancel', touchCancelHandler);

    _mobileTouchInputHandlers = {
        target: videoElement,
        touchstart: touchStartHandler,
        touchmove: touchMoveHandler,
        touchend: touchEndHandler,
        touchcancel: touchCancelHandler,
        get singleTapTimer() {
            return singleTapTimer;
        },
    };
}
// 设置移动端长按三倍速播放功能（B站风格）
function setupLongPressSpeedControl() {
    if (!art || !art.video || !videoPlayer) return;

    const playerElement = document.getElementById('player');
    if (!playerElement) return;
    const videoElement = art.video;
    if (!videoElement) return;

    // 🔥 先清理之前绑定的监听器，防止切集时叠加
    if (_longPressHandlers) {
        const previousTarget = _longPressHandlers.target || playerElement;
        previousTarget.removeEventListener('touchstart', _longPressHandlers.touchstart);
        previousTarget.removeEventListener('touchmove', _longPressHandlers.touchmove);
        previousTarget.removeEventListener('touchend', _longPressHandlers.touchend);
        previousTarget.removeEventListener('touchcancel', _longPressHandlers.touchcancel);
        // 同时清理 video 上的监听器
        if (art && art.video) {
            if (_longPressHandlers.videoPause) art.video.removeEventListener('pause', _longPressHandlers.videoPause);
            if (_longPressHandlers.videoEnded) art.video.removeEventListener('ended', _longPressHandlers.videoEnded);
        }
        _longPressHandlers = null;
    }

    let originalPlaybackRate = 1.0;
    let isLongPress = false;
    let longPressEligible = false;

    const NON_CENTER_TOUCH_SELECTOR = [
        '.art-bottom',
        '.art-settings',
        '.art-contextmenus',
        '.art-info',
        '.art-notice',
        '.art-loading',
        '.artplayer-plugin-danmuku',
        '.apd-config-panel',
        '.apd-style-panel',
        '.art-mask .art-state',
        'input',
        'button',
        '[role="button"]',
    ].join(', ');

    function isNonCenterTouchTarget(target) {
        return typeof target?.closest === 'function' && Boolean(target.closest(NON_CENTER_TOUCH_SELECTOR));
    }

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
        if (art.video.paused || isNonCenterTouchTarget(e.target)) {
            longPressEligible = false;
            _mobileLongPressTriggered = false;
            return;
        }

        longPressEligible = true;
        _mobileLongPressTriggered = false;
        originalPlaybackRate = art.video.playbackRate;

        videoPlayer.setTimer('longPress', () => {
            if (longPressEligible && !art.video.paused) {
                art.video.playbackRate = 3.0;
                isLongPress = true;
                _mobileLongPressTriggered = true;
                showSpeedIndicator(3.0);

                if (navigator.vibrate) {
                    navigator.vibrate(50);
                }
            }
        }, 500);
    };

    const _touchmoveHandler = function (e) {
        if (!longPressEligible && !isLongPress) return;

        if (!isLongPress) {
            longPressEligible = false;
            videoPlayer.clearTimer('longPress');
        }

        if (isLongPress) {
            e.preventDefault();
        }
    };

    const _touchendHandler = function (e) {
        if (!longPressEligible && !isLongPress) return;

        videoPlayer.clearTimer('longPress');
        const didHandleLongPress = isLongPress;

        if (didHandleLongPress) {
            art.video.playbackRate = originalPlaybackRate;
            isLongPress = false;
            hideSpeedIndicator();

            e.preventDefault();
            e.stopPropagation();
        }

        longPressEligible = false;
        if (!didHandleLongPress) {
            _mobileLongPressTriggered = false;
        }
    };

    const _touchcancelHandler = function () {
        if (!longPressEligible && !isLongPress) return;

        videoPlayer.clearTimer('longPress');

        if (isLongPress) {
            art.video.playbackRate = originalPlaybackRate;
            isLongPress = false;
            hideSpeedIndicator();
        }

        longPressEligible = false;
        _mobileLongPressTriggered = false;
    };

    // 🔥 注册监听器
    videoElement.addEventListener('touchstart', _touchstartHandler, { passive: true });
    videoElement.addEventListener('touchmove', _touchmoveHandler, { passive: false });
    videoElement.addEventListener('touchend', _touchendHandler);
    videoElement.addEventListener('touchcancel', _touchcancelHandler);

    // 🔥 保存引用，供下次调用时清理
    _longPressHandlers = {
        target: videoElement,
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
        longPressEligible = false;
        _mobileLongPressTriggered = false;
        videoPlayer.clearTimer('longPress');
    };

    const _endedResetHandler = function () {
        if (isLongPress) {
            art.video.playbackRate = originalPlaybackRate;
            isLongPress = false;
            hideSpeedIndicator();
        }
        longPressEligible = false;
        _mobileLongPressTriggered = false;
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
        <span>${escapeHtml(resourceName)}</span>
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

function getPlayerShortDramaCheck(resource = {}) {
    const checker = window.LibertyUtils?.media?.isShortDramaResource;
    if (typeof checker === 'function') return checker(resource);
    return { isShortDrama: false, reasons: [] };
}

function logSwitchResourceCandidateQuality(candidate = {}, action = 'kept', shortDramaInfo = {}) {
    window.LibertyDebug.log('[ResourceSwitch] candidate quality', {
        title: candidate.vod_name || candidate.title || candidate.name || '',
        sourceName: candidate.sourceName || candidate.source_name || '',
        episodeCount: candidate.episodeCount || candidate.episodesCount || (
            Array.isArray(candidate.episodes) ? candidate.episodes.length : 0
        ),
        type: candidate.type_name || candidate.type || candidate.category || '',
        remarks: candidate.vod_remarks || candidate.remarks || candidate.note || '',
        duration: candidate.duration || candidate.vod_duration || '',
        isShortDrama: Boolean(shortDramaInfo.isShortDrama),
        shortDramaReasons: shortDramaInfo.reasons || [],
        action
    });
}

async function showSwitchResourceModal() {
    const urlParams = new URLSearchParams(window.location.search);
    const currentSourceCode = urlParams.get('source');
    const currentVideoId = urlParams.get('id');

    const modal = document.getElementById('modal');
    const modalTitle = document.getElementById('modalTitle');
    const modalContent = document.getElementById('modalContent');

    modalTitle.innerHTML = `<span class="break-words">${escapeHtml(currentVideoTitle)}</span>`;
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

    const currentSourceName = resourceOptions.find(opt => String(opt.key) === String(currentSourceCode))?.name || currentSourceCode || '';
    const currentShortDramaInfo = getPlayerShortDramaCheck({
        title: currentVideoTitle,
        sourceCode: currentSourceCode,
        sourceName: currentSourceName,
        episodeCount: currentEpisodes?.length || 0,
        episodes: currentEpisodes || []
    });

    if (!currentShortDramaInfo.isShortDrama) {
        Object.entries(allResults).forEach(([sourceKey, result]) => {
            if (!result) return;
            const sourceName = resourceOptions.find(opt => opt.key === sourceKey)?.name || '未知资源';
            const candidate = {
                ...result,
                sourceCode: sourceKey,
                sourceName,
                episodeCount: result.episodeCount || result.episodesCount || 0
            };
            const shortDramaInfo = getPlayerShortDramaCheck(candidate);
            if (shortDramaInfo.isShortDrama) {
                logSwitchResourceCandidateQuality(candidate, 'filtered', shortDramaInfo);
                delete allResults[sourceKey];
                return;
            }
            logSwitchResourceCandidateQuality(candidate, 'kept', shortDramaInfo);
        });
    } else {
        window.LibertyDebug.log('[ResourceSwitch] current video is short drama, keep short-drama candidates', {
            title: currentVideoTitle,
            sourceName: currentSourceName,
            episodeCount: currentEpisodes?.length || 0,
            shortDramaReasons: currentShortDramaInfo.reasons || []
        });
    }

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
        const safeSourceKey = escapeJsString(sourceKey);
        const safeVodId = escapeJsString(result.vod_id || '');
        const safeVodName = escapeHtml(result.vod_name || '未知资源');
        const safeSourceName = escapeHtml(sourceName);
        const safeImageUrl = getSafeImageUrl(result.vod_pic || '');

        html += `
            <div class="relative group ${isCurrentSource ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:scale-105 transition-transform'}" 
                 ${!isCurrentSource ? `onclick="switchToResource('${safeSourceKey}', '${safeVodId}')"` : ''}>
                <div class="aspect-[2/3] rounded-lg overflow-hidden bg-gray-800 relative">
                    ${safeImageUrl ? `<img src="${escapeHtml(safeImageUrl)}"
                         alt="${safeVodName}"
                         class="w-full h-full object-cover"
                         onerror="this.style.display='none';this.nextElementSibling?.classList.remove('hidden');">` : ''}
                    <div class="${safeImageUrl ? 'hidden ' : ''}w-full h-full flex items-center justify-center text-gray-500 text-xs">无封面</div>
                    
                    <!-- 速率显示在图片右上角 -->
                    <div class="absolute top-1 right-1 speed-badge bg-black bg-opacity-75">
                        ${formatSpeedDisplay(speedResult)}
                    </div>
                </div>
                <div class="mt-2">
                    <div class="text-xs font-medium text-gray-200 truncate">${safeVodName}</div>
                    <div class="text-[10px] text-gray-400 truncate">${safeSourceName}</div>
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
        window.LibertyDebug.log('🔄 清理当前视频的缓存...');

        tempDetailCache.clear();
        window.LibertyDebug.log('✅ 已清理临时缓存');

        // 清理当前视频的弹幕缓存
		currentDanmuCache = {
			episodeIndex: -1,
			danmuList: null,
			timestamp: 0
		};
		if (videoPlayer) videoPlayer.clearDanmuCache();

        window.LibertyDebug.log('✅ 已清理当前视频缓存（保留其他视频缓存）');
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
    danmuDebugLog('🔍 当前弹幕源ID:', currentDanmuAnimeId);

    try {
        const cleanTitle = getDanmuSearchKeyword(currentVideoTitle);
        const animes = await searchDanmuAnimeCandidatesWithCache(cleanTitle);

        if (!animes.length) {
            modalContent.innerHTML = '<div class="text-center py-8 text-gray-400">未找到匹配的弹幕源</div>';
            return;
        }

        const allSources = rankDanmuSourceCandidates(animes, cleanTitle);

        // ✅ 全部弹幕源在一个列表中，高亮当前使用的
        let html = '<div class="space-y-2 max-h-[60vh] overflow-y-auto p-2">';

        allSources.forEach(source => {
		// 🔥 强制转换为字符串比较
		const isActive = (String(currentDanmuAnimeId) === String(source.animeId));
		const typeInfo = source.typeDescription || source.type;
        const safeAnimeId = escapeJsString(source.animeId || '');
        const safeAnimeTitleArg = escapeJsString(encodeURIComponent(source.animeTitle || ''));
        const safeAnimeTitle = escapeHtml(source.animeTitle || '未知弹幕源');
        const safeTypeInfo = escapeHtml(typeInfo || '未知类型');

		const similarityPercent = Math.round(Math.min(100, (Number(source.titleScore || 0) / 60) * 100));

		html += `
			<button
				onclick="switchDanmuSource('${safeAnimeId}', '${safeAnimeTitleArg}')"
				class="danmu-source-button w-full text-left px-4 py-3 rounded-lg transition-all ${
					isActive 
						? 'bg-blue-600 text-white shadow-lg border-2 border-blue-400' 
						: 'bg-gray-800 hover:bg-gray-700 text-gray-200 border-2 border-transparent'
				}">
                    <div class="flex items-center justify-between gap-2 min-w-0">
                        <div class="danmu-source-name font-medium min-w-0">${safeAnimeTitle}</div>
                        ${isActive ? '<span class="danmu-source-badge text-yellow-300 text-sm shrink-0">✓ 当前使用</span>' : ''}
                    </div>
                    <div class="danmu-source-meta text-sm opacity-75 mt-1">
                        ${safeTypeInfo} · ${Number(source.episodeCount || 0)} 集 · 相似度: ${similarityPercent}%
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
    const prevSessionDanmuSource = currentSessionDanmuSource;

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
        await clearCurrentDanmukuPlugin('manual-source');

        const cleanTitle = getDanmuSearchKeyword(currentVideoTitle);
        const manualContext = getDanmuPlaybackContext(currentVideoTitle, currentEpisodeIndex);
        const manualMatchQuery = buildDanmuKeyword(manualContext);
        const manualCurrentParsed = parseDanmuCandidateTitle(currentVideoTitle);
        const manualCandidateParsed = parseDanmuCandidateTitle(sourceName);
        const manualCurrentYear = normalizeDanmuYear(manualContext.year || getCurrentVideoYearValue());
        const manualCandidateYear = normalizeDanmuYear(manualCandidateParsed.year);
        const manualTitleCloseness = getDanmuTitleCloseness(
            manualCurrentParsed.normalizedCoreTitle,
            manualCandidateParsed.normalizedCoreTitle
        );

        if (manualCurrentYear && manualCandidateYear && manualCurrentYear !== manualCandidateYear) {
            danmuDebugWarn('[DanmuDebug] manual year mismatch', {
                currentYear: manualCurrentYear,
                candidateYear: manualCandidateYear,
                sourceName
            });
        }
        if (!manualTitleCloseness.close) {
            danmuDebugWarn('[DanmuDebug] manual title mismatch', {
                currentTitle: currentVideoTitle,
                currentCoreTitle: manualCurrentParsed.normalizedCoreTitle,
                candidateCoreTitle: manualCandidateParsed.normalizedCoreTitle,
                sourceName
            });
        }
        
        const episodes = await getAnimeEpisodesWithCache(animeId, cleanTitle);
        

        if (!episodes || episodes.length === 0) {
            showToast('该弹幕源暂无剧集信息', 'warning');
            currentDanmuAnimeId = prevAnimeId;
            currentDanmuSourceName = prevSourceName;
            currentSessionDanmuSource = prevSessionDanmuSource;
            return;
        }

        const matchedEpisode = pickMatchedDanmuEpisode(episodes, currentEpisodeIndex, currentVideoTitle);
        

        if (!matchedEpisode) {
            showToast(`无法为第${currentEpisodeIndex + 1}集匹配弹幕`, 'warning');
            currentDanmuAnimeId = prevAnimeId;
            currentDanmuSourceName = prevSourceName;
            currentSessionDanmuSource = prevSessionDanmuSource;
            danmuDebugWarn('[DanmuDebug] episode switch danmaku failed', {
                reason: 'manual-source',
                displayEpisode: currentEpisodeIndex + 1,
                failReason: 'manual-source-episode-not-matched',
                matchMode: 'manual-source',
                fallbackUsed: false,
                candidateCount: episodes.length
            });
            return;
        }

        const newDanmuku = await fetchDanmaku(matchedEpisode.episodeId, currentEpisodeIndex);

        if (!newDanmuku || newDanmuku.length === 0) {
            showToast('该弹幕源暂无弹幕', 'warning');
            currentDanmuAnimeId = prevAnimeId;
            currentDanmuSourceName = prevSourceName;
            currentSessionDanmuSource = prevSessionDanmuSource;
            updateLastDanmuMatchInfo({
                reason: 'manual-source',
                matchMode: 'manual-source',
                matchQuery: manualMatchQuery,
                animeId,
                animeTitle: sourceName,
                episodeId: matchedEpisode.episodeId,
                episodeTitle: matchedEpisode.episodeTitle || matchedEpisode.title || matchedEpisode.name || '',
                sourceName,
                selectedBy: 'manual',
                fallbackUsed: false,
                manualSourceUsed: true,
                confidence: 100,
                loadedCount: 0
            });
            logDanmuEpisodeSummary('manual-source', {
                loadedCount: 0,
                pluginApplied: false,
                failReason: 'empty-danmaku'
            });
        } else {
            currentSessionDanmuSource = {
                animeId,
                animeTitle: sourceName,
                sourceName,
                selectedBy: 'manual',
                episodes,
                episodeCount: episodes.length,
                updatedAt: Date.now()
            };
            updateLastDanmuMatchInfo({
                reason: 'manual-source',
                matchMode: 'manual-source',
                matchQuery: manualMatchQuery,
                animeId,
                animeTitle: sourceName,
                episodeId: matchedEpisode.episodeId,
                episodeTitle: matchedEpisode.episodeTitle || matchedEpisode.title || matchedEpisode.name || '',
                sourceName,
                selectedBy: 'manual',
                fallbackUsed: false,
                manualSourceUsed: true,
                confidence: 100,
                loadedCount: newDanmuku.length
            });
            danmuDebugLog('[DanmuDebug] match success', {
                matchMode: 'manual-source',
                animeId,
                animeTitle: sourceName,
                episodeId: matchedEpisode.episodeId,
                episodeTitle: matchedEpisode.episodeTitle || matchedEpisode.title || matchedEpisode.name || '',
                sourceName
            });
            danmuDebugLog('[DanmuDebug] apply danmaku to artplayer', {
                displayEpisode: currentEpisodeIndex + 1,
                rawCount: lastDanmuFetchStats?.rawCount || 0,
                validCount: lastDanmuFetchStats?.validCount || 0,
                convertedCount: lastDanmuFetchStats?.convertedCount || 0,
                loadedCount: newDanmuku.length,
                hasPlugin: Boolean(danmukuPlugin)
            });
            await applyDanmakuRuntimeState({
                reason: 'manual-source',
                danmuku: newDanmuku,
                reload: true,
            });

            showToast(`✓ 已切换到: ${sourceName} (${newDanmuku.length}条)`, 'success');
            danmuDebugLog('[DanmuDebug] apply danmaku to artplayer success', {
                displayEpisode: currentEpisodeIndex + 1,
                loadedCount: newDanmuku.length
            });
            logDanmuEpisodeSummary('manual-source', {
                loadedCount: newDanmuku.length,
                pluginApplied: true
            });
            logDanmuVisibilityState('manual-source-complete', {
                loadedCount: newDanmuku.length,
                pluginApplied: true,
                episodeId: matchedEpisode.episodeId,
                sourceName,
                matchMode: 'manual-source'
            });
        }

    } catch (error) {
        console.error('切换弹幕源失败:', error);
        showToast('切换弹幕源失败', 'error');

        currentDanmuAnimeId = prevAnimeId;
        currentDanmuSourceName = prevSourceName;
        currentSessionDanmuSource = prevSessionDanmuSource;
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
        window.LibertyDebug.log('=== VideoPlayer 状态 ===');
        videoPlayer.logStatus();
        window.LibertyDebug.log('\n=== 全局变量状态 ===');
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
        window.LibertyDebug.log('✅ 播放器已手动清理');
    }
};

window.LibertyDebug.log('✅ 播放器修复补丁已加载');
window.LibertyDebug.log('💡 调试命令:');
window.LibertyDebug.log('   - debugPlayer() : 查看播放器状态');
window.LibertyDebug.log('   - cleanupPlayer() : 手动清理播放');

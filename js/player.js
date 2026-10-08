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
    danmuReloadToken += 1;
    cancelDanmakuRequest('page-cleanup');

    // 🔥 修复：清理 saveHistoryTimer，防止切集后 5 秒写入错误集数记录
    if (typeof saveHistoryTimer !== 'undefined' && saveHistoryTimer) {
        clearTimeout(saveHistoryTimer);
        saveHistoryTimer = null;
    }

    // 使用 VideoPlayer 的统一销毁方法
    cleanupPlayerShortcuts();
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
        key: '',
        episodeIndex: -1,
        danmuList: null,
        timestamp: 0
    };

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
let _danmakuPanelHandlers = null;
let _mobileOrientationFullscreenCleanup = null;
let currentHls = null; // 跟踪当前HLS实例
let currentEpisodes = [];
// 保留采集站提供的原始剧集名称；currentEpisodes 继续保持旧播放器使用的 URL/对象列表。
let currentEpisodeEntries = [];
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
const HIT_DEBUG_STORAGE_KEY = 'LIBRETV_HIT_DEBUG';

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

function isHitDebugEnabled() {
    try {
        return localStorage.getItem(HIT_DEBUG_STORAGE_KEY) === '1';
    } catch (_) {
        return false;
    }
}

function getNodeHitDebugSummary(node) {
    if (!(node instanceof Element)) return null;

    const computedStyle = window.getComputedStyle(node);
    return {
        tagName: node.tagName || null,
        className: typeof node.className === 'string' ? node.className : null,
        id: node.id || null,
        pointerEvents: computedStyle.pointerEvents || null,
        zIndex: computedStyle.zIndex || null,
        cursor: computedStyle.cursor || null,
    };
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

function cleanupDanmakuPanels(expectedArt = null) {
    if (!_danmakuPanelHandlers) return;
    if (expectedArt && _danmakuPanelHandlers.art !== expectedArt) return;

    _danmakuPanelHandlers.documentEvents.forEach(({ type, listener, options }) => {
        document.removeEventListener(type, listener, options);
    });

    _danmakuPanelHandlers.roots.forEach(({ root, listener }) => {
        root.classList.remove('libretv-panel-open', 'libretv-touch-panel-open');
        root.removeEventListener('click', listener);
    });

    _danmakuPanelHandlers.valueListeners?.forEach(({ node, listener }) => {
        node.removeEventListener('click', listener);
    });

    if (_danmakuPanelHandlers.hitDebugListener) {
        _danmakuPanelHandlers.playerRoot?.removeEventListener('mousemove', _danmakuPanelHandlers.hitDebugListener);
    }

    _danmakuPanelHandlers = null;
}

function setupDanmakuPanels() {
    if (!art?.template?.$player) return;

    cleanupDanmakuPanels();

    const playerRoot = art.template.$player;
    const panelOpenClass = 'libretv-panel-open';
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
                root.classList.remove(panelOpenClass, 'libretv-touch-panel-open');
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
    const valueListeners = [];
    let hitDebugListener = null;
    const outsideEventTypes = window.PointerEvent ? ['pointerdown'] : ['touchstart', 'mousedown'];
    outsideEventTypes.forEach((type) => {
        document.addEventListener(type, outsidePointerHandler, true);
        documentEvents.push({ type, listener: outsidePointerHandler, options: true });
    });

    panelRoots.forEach((entry) => {
        const { root, panelSelector } = entry;
        const rootClickHandler = (event) => {
            if (art !== artInstance || artInstance.isDestroy) return;
            if (typeof event.target?.closest === 'function' && event.target.closest(panelSelector)) return;

            event.preventDefault();
            event.stopPropagation();

            const willOpen = !root.classList.contains(panelOpenClass);
            closeAllPanels(willOpen ? root : null);
            root.classList.toggle(panelOpenClass, willOpen);
        };

        root.addEventListener('click', rootClickHandler);
        entry.listener = rootClickHandler;
    });

    const forwardSliderClickFromValue = (valueNode, sliderNode, event) => {
        if (!valueNode || !sliderNode) return;

        const valueRect = valueNode.getBoundingClientRect();
        const sliderRect = sliderNode.getBoundingClientRect();
        if (!valueRect.width || !sliderRect.width) return;

        const relativeX = Math.min(Math.max((event.clientX - valueRect.left) / valueRect.width, 0), 1);
        const relativeY = valueRect.height
            ? Math.min(Math.max((event.clientY - valueRect.top) / valueRect.height, 0), 1)
            : 0.5;

        sliderNode.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: window,
            button: 0,
            clientX: sliderRect.left + (sliderRect.width * relativeX),
            clientY: sliderRect.top + (sliderRect.height * relativeY),
        }));
    };

    [
        ['.apd-config-opacity .apd-value', '.apd-config-opacity .apd-slider'],
        ['.apd-config-margin .apd-value', '.apd-config-margin .apd-slider'],
    ].forEach(([valueSelector, sliderSelector]) => {
        const valueNode = playerRoot.querySelector(`.artplayer-plugin-danmuku ${valueSelector}`);
        const sliderNode = playerRoot.querySelector(`.artplayer-plugin-danmuku ${sliderSelector}`);
        if (!valueNode || !sliderNode) return;

        const valueClickHandler = (event) => {
            if (art !== artInstance || artInstance.isDestroy) return;
            forwardSliderClickFromValue(valueNode, sliderNode, event);
        };

        valueNode.addEventListener('click', valueClickHandler);
        valueListeners.push({ node: valueNode, listener: valueClickHandler });
    });

    if (isHitDebugEnabled()) {
        let lastHitDebugSignature = '';
        let lastHitDebugTime = 0;

        hitDebugListener = (event) => {
            if (art !== artInstance || artInstance.isDestroy) return;

            const openPanels = panelRoots
                .map(({ root, panelSelector }) => ({
                    root,
                    panel: root.querySelector(panelSelector),
                }))
                .filter(({ root, panel }) => panel && (
                    root.classList.contains(panelOpenClass) ||
                    root.classList.contains('libretv-touch-panel-open')
                ));

            if (!openPanels.length) return;

            const { clientX: x, clientY: y } = event;
            const playerRect = playerRoot.getBoundingClientRect();
            const isInsidePlayer =
                x >= playerRect.left &&
                x <= playerRect.right &&
                y >= playerRect.top &&
                y <= playerRect.bottom;
            if (!isInsidePlayer) return;

            const activePanel = openPanels[0].panel;
            const panelRect = activePanel.getBoundingClientRect();
            const rightProbeStart = panelRect.left + (panelRect.width * 0.55);
            const rightProbeEnd = panelRect.right + Math.min(48, panelRect.width * 0.15);
            const isNearPanelRightZone =
                y >= panelRect.top &&
                y <= panelRect.bottom &&
                x >= rightProbeStart &&
                x <= rightProbeEnd;
            if (!isNearPanelRightZone) return;

            const topElement = document.elementFromPoint(x, y);
            const hitElements = document.elementsFromPoint(x, y).slice(0, 6);
            const hitSelectors = [
                '.apd-config-panel',
                '.apd-style-panel',
                '.art-controls-center',
                '.art-controls',
                '.art-bottom',
                '.art-mask',
                '.art-state',
                'video.art-video',
            ];
            const isHitWithinSelector = (selector) => hitElements.some((node) => (
                node instanceof Element &&
                typeof node.closest === 'function' &&
                Boolean(node.closest(selector))
            ));
            const topSummary = getNodeHitDebugSummary(topElement);
            const hitStack = hitElements.map((node) => getNodeHitDebugSummary(node));
            const signature = JSON.stringify({
                top: topSummary,
                hitStack: hitStack.map((item) => item ? [item.tagName, item.className, item.id] : null),
                fullscreen: Boolean(artInstance.fullscreen),
                fullscreenWeb: Boolean(artInstance.fullscreenWeb),
            });
            const now = Date.now();
            if (signature === lastHitDebugSignature && now - lastHitDebugTime < 150) {
                return;
            }

            lastHitDebugSignature = signature;
            lastHitDebugTime = now;

            const payload = {
                reason: 'panel-right-hit-test',
                x,
                y,
                fullscreen: Boolean(artInstance.fullscreen),
                fullscreenWeb: Boolean(artInstance.fullscreenWeb),
                panelOpen: true,
                panelClassName: typeof activePanel.className === 'string' ? activePanel.className : null,
                topElement: topSummary,
                hitStack,
                hitAreas: Object.fromEntries(
                    hitSelectors.map((selector) => [selector, isHitWithinSelector(selector)])
                ),
            };

            window.__LIBRETV_HIT_DEBUG_LAST__ = payload;
            console.debug('[LibreTV hit-debug]', payload);
        };

        playerRoot.addEventListener('mousemove', hitDebugListener);
    }

    _danmakuPanelHandlers = {
        art: artInstance,
        playerRoot,
        documentEvents,
        roots: panelRoots,
        valueListeners,
        hitDebugListener,
    };

    artInstance.on('destroy', () => {
        cleanupDanmakuPanels(artInstance);
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
    maxDurationDiffRatio: 0.08,
    cacheExpiration: {
        danmuCache: 20 * 60 * 1000
    },
    adaptive: {
        enableDurationScale: true,
        offsetSeconds: 0
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

function getCurrentEpisodeName(index) {
    const structured = Array.isArray(currentEpisodeEntries) ? currentEpisodeEntries[index] : null;
    if (structured && typeof structured === 'object') {
        return structured.name || structured.title || structured.rawEpisodeName || '';
    }
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

// 弹幕缓存 - 只缓存当前集
let currentDanmuCache = {
    key: '',
    episodeIndex: -1,
    danmuList: null,
    timestamp: 0
};
let _danmuFetchController = null;
let danmuReloadToken = 0;
let lastDanmuMatchInfo = null;
let lastDanmuFetchStats = null;

// ✅ 恢复弹幕源追踪
let currentDanmuAnimeId = null;
let currentDanmuSourceName = '';
let currentSessionDanmuSource = null;

function getCurrentVideoYearValue() {
    try {
        return new URLSearchParams(window.location.search).get('year')
            || getDanmuPlaybackSession().year
            || localStorage.getItem('currentVideoYear')
            || '';
    } catch (error) {
        return '';
    }
}

function getVideoIdentity(title = currentVideoTitle) {
    const params = new URLSearchParams(window.location.search);
    const session = getDanmuPlaybackSession();
    const year = params.get('year') || session.year || '';
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
    const context = createProductionDanmakuContext(title, currentEpisodeIndex);

    return {
        title: title || currentVideoTitle || '',
        year: String(year || ''),
        sourceCode: String(sourceCode || ''),
        vodId: String(vodId || ''),
        episodeCount,
        canonicalTitle: context?.media?.canonicalTitle || '',
        canonicalMediaId: context?.media?.mediaId || '',
        identityState: context?.media?.identityState || 'uncertain',
    };
}

function updateLastDanmuMatchInfo(info = {}) {
    const context = createProductionDanmakuContext(currentVideoTitle, currentEpisodeIndex);
    lastDanmuMatchInfo = {
        ...(lastDanmuMatchInfo || {}),
        videoTitle: currentVideoTitle,
        year: getCurrentVideoYearValue(),
        episodeIndex: currentEpisodeIndex,
        episodeNumber: context?.episode?.episodeNumber ?? null,
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
        episodeIndex,
        episodeNumber: info.episodeNumber ?? null,
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
        mappingState: info.mappingState || '',
        coreState: info.coreState || '',
        autoApplied: Boolean(info.autoApplied),
        fallbackUsed: Boolean(info.fallbackUsed),
        manualSourceUsed: Boolean(info.manualSourceUsed),
        sessionSourceUsed: Boolean(info.sessionSourceUsed),
        candidateCount: Number.isFinite(info.candidateCount) ? info.candidateCount : 0,
        currentYear: info.currentYear || getCurrentVideoYearValue() || '',
        candidateYear: info.candidateYear || '',
        yearConflict: Boolean(info.yearConflict),
        coreTitle: info.coreTitle || '',
        candidateCoreTitle: info.candidateCoreTitle || '',
        titleScore: Number.isFinite(info.titleScore) ? info.titleScore : 0,
        rejectReason: info.rejectReason || '',
        rejectReasons: info.rejectReasons || [],
        hardRejected: Boolean(info.hardRejected),
        verifiedScore: Number.isFinite(info.verifiedScore) ? info.verifiedScore : 0,
        validCandidateCount: Number.isFinite(info.validCandidateCount) ? info.validCandidateCount : 0,
        rateLimited: Boolean(info.rateLimited || stats.rateLimited),
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
    const context = createProductionDanmakuContext(currentVideoTitle, currentEpisodeIndex);
    return {
        currentVideoTitle,
        currentVideoYear: getCurrentVideoYearValue(),
        currentEpisodeIndex,
        episodeNumber: context?.episode?.episodeNumber ?? null,
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
// Stage E production bridge. Matching decisions are owned by Liberty Core V2;
// this layer only supplies observed playback data and converts comments for ArtPlayer.
let danmuRequestGeneration = 0;
let danmuCoreRuntime = null;
let danmuSourceSearchController = null;
const manualDanmuCandidates = new Map();

function getDanmuCoreRuntime() {
    const core = window.LibertyCore;
    const baseUrl = getDanmuBaseUrl();
    if (!core?.DanmuClient || !core?.DanmuService || !core?.createDanmakuPlaybackContext) {
        return null;
    }
    if (danmuCoreRuntime?.core === core && danmuCoreRuntime?.baseUrl === baseUrl) {
        return danmuCoreRuntime;
    }

    const coreFetch = async (url, options) => {
        const authedUrl = await addDanmuAuth(String(url));
        return window.fetch(authedUrl, options);
    };
    const client = new core.DanmuClient({
        baseUrl,
        fetch: coreFetch,
        timeoutMs: 12000,
    });
    danmuCoreRuntime = {
        core,
        baseUrl,
        client,
        service: new core.DanmuService({ client }),
        candidateResolver: new core.DanmuCandidateResolver(),
    };
    return danmuCoreRuntime;
}

function cancelDanmakuRequest(reason = 'cancelled') {
    const active = _danmuFetchController;
    _danmuFetchController = null;
    danmuRequestGeneration += 1;
    if (active?.controller && !active.controller.signal.aborted) {
        active.controller.abort(reason);
    }
}

function getDanmuRequestContextKey(context) {
    const mediaId = context?.media?.mediaId || '';
    const episodeId = context?.episode?.canonicalEpisodeId || '';
    const sourceEpisode = context?.sourceEpisode;
    const sourceEpisodeId = sourceEpisode?.canonicalEpisodeId || '';
    if (!mediaId || !episodeId || !sourceEpisodeId) return '';
    // The canonical IDs protect media/episode identity. The source locator is
    // deliberately separate: two lines may map to the same E12 while their
    // underlying playback entry changes during an in-flight request.
    return JSON.stringify([
        mediaId,
        episodeId,
        sourceEpisodeId,
        sourceEpisode.sourceKey || '',
        sourceEpisode.vodId || '',
        sourceEpisode.playGroup || '',
        sourceEpisode.playGroupIndex ?? null,
        sourceEpisode.rawIndex ?? null,
        sourceEpisode.rawEntry || '',
        sourceEpisode.playUrl || '',
    ]);
}

function beginDanmakuRequest(reason, context) {
    cancelDanmakuRequest(`superseded:${reason}`);
    const request = {
        controller: new AbortController(),
        generation: danmuRequestGeneration,
        reason,
        contextKey: getDanmuRequestContextKey(context),
    };
    _danmuFetchController = request;
    return request;
}

function isCurrentDanmakuRequest(request, episodeIndex) {
    const currentContext = createProductionDanmakuContext(currentVideoTitle, currentEpisodeIndex);
    return _danmuFetchController === request
        && request.generation === danmuRequestGeneration
        && !request.controller.signal.aborted
        && episodeIndex === currentEpisodeIndex
        && request.contextKey !== ''
        && request.contextKey === getDanmuRequestContextKey(currentContext);
}

function getDanmuPlaybackSession() {
    try {
        return window.LibertyUtils?.playbackState?.readPlaybackSession?.() || {};
    } catch (error) {
        danmuDebugWarn('[DanmuCore] unable to read playback session', error);
        return {};
    }
}

function getObservedDanmuEpisodes() {
    const playerEpisodes = Array.isArray(currentEpisodes) ? currentEpisodes : [];
    const structuredEpisodes = Array.isArray(currentEpisodeEntries) ? currentEpisodeEntries : [];

    return playerEpisodes.map((playerEpisode, index) => {
        const structured = structuredEpisodes[index]
            || (playerEpisode && typeof playerEpisode === 'object' ? playerEpisode : null);
        let rawName = structured?.rawEpisodeName;
        if (rawName === undefined) rawName = structured?.name ?? structured?.title ?? '';
        if (!rawName && typeof playerEpisode === 'string' && playerEpisode.includes('$')) {
            rawName = playerEpisode.slice(0, playerEpisode.indexOf('$'));
        }
        const url = getPlayerEpisodeUrlValue(playerEpisode)
            || getPlayerEpisodeUrlValue(structured)
            || '';

        return {
            rawIndex: index,
            name: String(rawName || ''),
            url,
            rawEntry: structured?.rawEntry || (rawName ? `${rawName}$${url}` : url),
        };
    });
}

function createProductionDanmakuContext(title, episodeIndex) {
    const runtime = getDanmuCoreRuntime();
    if (!runtime) return null;

    const params = new URLSearchParams(window.location.search);
    const session = getDanmuPlaybackSession();
    const sourceKey = params.get('source')
        || params.get('source_code')
        || session.sourceCode
        || localStorage.getItem('currentSourceCode')
        || localStorage.getItem('currentPlayingSource')
        || 'unknown-source';
    const vodId = params.get('id')
        || params.get('vod_id')
        || session.vodId
        || localStorage.getItem('currentVideoId')
        || '';

    return runtime.core.createDanmakuPlaybackContext({
        sourceKey: String(sourceKey),
        sourceName: String(session.sourceName || sourceKey),
        vodId: String(vodId),
        rawTitle: String(title || currentVideoTitle || session.title || ''),
        rawYear: params.get('year') || session.year || '',
        rawRemarks: session.remarks || '',
        rawCategory: session.category || session.type || '',
        rawDirector: session.director || '',
        rawActors: session.actors || '',
        rawArea: session.area || '',
        rawLanguage: session.language || '',
        rawDescription: session.description || '',
        rawCover: session.cover || '',
        episodes: getObservedDanmuEpisodes(),
        currentEpisodeIndex: episodeIndex,
    });
}

function getDanmuCoreCacheKey(context, manualCandidate, manualEpisodeId) {
    if (!context?.episode) return '';
    return [
        context.media.mediaId,
        context.episode.canonicalEpisodeId,
        manualCandidate?.animeId || 'auto',
        manualEpisodeId || 'auto-episode',
    ].join('|');
}

function convertCoreDanmuComments(comments, episodeIndex, videoDuration = null) {
    const rawComments = Array.isArray(comments) ? comments : [];
    const apiDuration = Number(videoDuration || 0);
    const playerDuration = getCurrentVideoDuration();
    let durationScale = 1;

    if (
        DANMU_CONFIG.adaptive.enableDurationScale
        && apiDuration > 0
        && playerDuration > 0
    ) {
        const ratio = playerDuration / apiDuration;
        const diff = Math.abs(playerDuration - apiDuration);
        const maxDiffRatio = Number(DANMU_CONFIG.maxDurationDiffRatio || 0.08);
        if (diff > 20 && Math.abs(1 - ratio) <= maxDiffRatio) {
            durationScale = ratio;
        }
    }

    const offsetSeconds = Number(DANMU_CONFIG.adaptive.offsetSeconds || 0);
    const parsedComments = rawComments.map((comment) => {
        const params = typeof comment?.p === 'string' ? comment.p.split(',') : [];
        const rawTime = Number.parseFloat(params[0] || '0');
        return {
            original: comment,
            time: Math.max(0, (Number.isFinite(rawTime) ? rawTime : 0) * durationScale + offsetSeconds),
            text: String(comment?.m || '').trim(),
            params,
        };
    }).filter(item => item.text);
    parsedComments.sort((left, right) => left.time - right.time);

    const converted = [];
    parsedComments.forEach(item => processDanmakuOptimized(item, converted));
    const limited = limitDanmakuList(converted);
    lastDanmuFetchStats = {
        episodeIndex,
        rawCount: rawComments.length,
        validCount: parsedComments.length,
        convertedCount: converted.length,
        loadedCount: limited.length,
        failReason: limited.length ? '' : 'empty_comment',
        updatedAt: Date.now(),
    };
    return limited;
}

function describeDanmuCoreTarget(context) {
    const parsed = context?.sourceEpisode?.parsedEpisodeInfo;
    return {
        episodeIndex: context?.currentEpisodeIndex ?? currentEpisodeIndex,
        episodeName: context?.sourceEpisode?.rawEpisodeName || '',
        episodeNumber: context?.episode?.episodeNumber ?? null,
        seasonNumber: context?.episode?.seasonNumber ?? context?.media?.season ?? null,
        contentType: context?.episode?.contentType || 'unknown',
        contextState: context?.state || 'invalid',
        contextReason: context?.reason || 'Core V2 context is unavailable',
        parsedConfidence: parsed?.confidence || 'none',
    };
}

async function resolveDanmakuWithCore({
    title,
    episodeIndex,
    reason,
    manualCandidate,
    manualEpisodeId,
}) {
    const runtime = getDanmuCoreRuntime();
    const context = createProductionDanmakuContext(title, episodeIndex);
    if (!runtime || !context) {
        return { context, result: null, danmuku: [], stale: false, reason: 'core-unavailable', request: null };
    }

    const target = describeDanmuCoreTarget(context);
    danmuDebugLog('[DanmuCore] playback context', target);
    if (context.state !== 'ready' || !context.episode || !context.sourceEpisode) {
        updateLastDanmuMatchInfo({
            reason,
            matchMode: 'core-v2',
            ...target,
            coreState: 'episode-uncertain',
            failReason: context.reason,
            loadedCount: 0,
        });
        return { context, result: null, danmuku: [], stale: false, reason: context.reason, request: null };
    }

    const request = beginDanmakuRequest(reason, context);
    const result = await runtime.service.resolve({
        media: context.media,
        episode: context.episode,
        mediaEpisodes: context.mediaEpisodes,
        sourceEpisode: context.sourceEpisode,
        ...(manualCandidate ? { manualCandidate } : {}),
        ...(manualEpisodeId ? { manualEpisodeId } : {}),
        signal: request.controller.signal,
    });
    if (!isCurrentDanmakuRequest(request, episodeIndex)) {
        return { context, result, danmuku: [], stale: true, reason: 'stale-request', request };
    }

    const binding = result.binding;
    const danmuku = result.state === 'success'
        ? convertCoreDanmuComments(result.comments, episodeIndex, result.videoDuration)
        : [];

    if (binding) {
        currentDanmuAnimeId = binding.danmuAnimeId;
        currentDanmuSourceName = binding.danmuAnimeTitle;
    }
    updateLastDanmuMatchInfo({
        reason,
        matchMode: 'core-v2',
        ...target,
        coreState: result.state,
        animeId: binding?.danmuAnimeId || '',
        animeTitle: binding?.danmuAnimeTitle || '',
        episodeId: binding?.danmuEpisodeId || '',
        episodeTitle: binding?.danmuEpisodeTitle || '',
        sourceName: binding?.danmuAnimeTitle || '',
        selectedBy: binding?.selectedBy || '',
        mappingState: binding?.mappingState || '',
        manualSourceUsed: binding?.selectedBy === 'manual',
        loadedCount: danmuku.length,
        failReason: result.state === 'success' ? '' : result.reason,
    });
    danmuDebugLog('[DanmuCore] resolution result', {
        ...target,
        state: result.state,
        reason: result.reason,
        binding,
        loadedCount: danmuku.length,
    });

    return { context, result, danmuku, stale: false, reason: result.reason, request };
}

async function getDanmukuForVideo(title, episodeIndex) {
    if (!isDanmuServiceEnabled()) return [];

    const context = createProductionDanmakuContext(title, episodeIndex);
    const storedManualSession = currentSessionDanmuSource?.selectedBy === 'manual'
        ? currentSessionDanmuSource
        : null;
    const manualSession = storedManualSession?.canonicalMediaId
        && storedManualSession.canonicalMediaId === context?.media?.mediaId
        ? storedManualSession
        : null;
    if (storedManualSession && !manualSession) {
        danmuDebugLog('[DanmuCore] invalidated manual work after media identity changed', {
            previousMediaId: storedManualSession.canonicalMediaId || '',
            currentMediaId: context?.media?.mediaId || '',
        });
        currentSessionDanmuSource = null;
        currentDanmuAnimeId = null;
        currentDanmuSourceName = '';
    }
    const manualCandidate = manualSession?.manualCandidate || null;
    const canonicalEpisodeId = context?.episode?.canonicalEpisodeId || '';
    const manualEpisodeId = canonicalEpisodeId
        ? manualSession?.episodeChoices?.[canonicalEpisodeId] || null
        : null;
    const cacheKey = getDanmuCoreCacheKey(context, manualCandidate, manualEpisodeId);

    cancelDanmakuRequest('new-danmaku-load');
    if (
        cacheKey
        && currentDanmuCache.key === cacheKey
        && Array.isArray(currentDanmuCache.danmuList)
        && Date.now() - currentDanmuCache.timestamp < DANMU_CONFIG.cacheExpiration.danmuCache
    ) {
        return limitDanmakuList(currentDanmuCache.danmuList);
    }

    try {
        const resolution = await resolveDanmakuWithCore({
            title,
            episodeIndex,
            reason: manualSession ? 'manual-session' : 'automatic',
            manualCandidate,
            manualEpisodeId,
        });
        if (resolution.stale) return [];

        if (resolution.result?.state === 'success') {
            currentDanmuCache = {
                key: getDanmuCoreCacheKey(resolution.context, manualCandidate, manualEpisodeId),
                episodeIndex,
                danmuList: resolution.danmuku,
                timestamp: Date.now(),
            };
            return resolution.danmuku;
        }

        if (resolution.result?.state !== 'aborted') {
            danmuDebugWarn('[DanmuCore] no automatic danmaku applied', {
                state: resolution.result?.state || 'episode-uncertain',
                reason: resolution.reason,
                ...describeDanmuCoreTarget(resolution.context),
            });
        }
        return [];
    } catch (error) {
        if (error?.name !== 'AbortError') {
            reportError('弹幕加载', 'Core V2 弹幕解析失败', {
                title,
                episodeIndex,
                error: error?.message || String(error),
            });
        }
        return [];
    }
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
    cancelDanmakuRequest(`reload:${reason}`);
    const episodeIndex = currentEpisodeIndex;
    const title = currentVideoTitle;
    const episodeUrl = getPlayerEpisodeUrlValue(currentEpisodes?.[episodeIndex]);
    const targetContext = createProductionDanmakuContext(title, episodeIndex);
    const targetEpisodeNumber = targetContext?.episode?.episodeNumber ?? null;

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
            episodeIndex,
            episodeNumber: targetEpisodeNumber,
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
            episodeIndex,
            episodeNumber: targetEpisodeNumber,
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
        episodeIndex,
        episodeNumber: targetEpisodeNumber,
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
            episodeIndex,
            episodeNumber: targetEpisodeNumber,
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
        episodeIndex,
        episodeNumber: targetEpisodeNumber,
        loadedCount: danmuku.length,
        reason
    });
    danmuDebugLog('[DanmuDebug] episode switch danmaku result', {
        reason,
        episodeIndex,
        episodeNumber: targetEpisodeNumber,
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
    danmuDebugLog('✅ 切集后已重新加载弹幕', {
        reason,
        episodeIndex,
        episodeNumber: targetEpisodeNumber,
        loadedCount: danmuku.length,
    });
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
            currentEpisodeEntries = playbackState?.normalizeEpisodeEntries
                ? playbackState.normalizeEpisodeEntries(parsedEpisodes)
                : parsedEpisodes;
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
            currentEpisodeEntries = playbackState?.readCurrentEpisodeEntries
                ? playbackState.readCurrentEpisodeEntries()
                : currentEpisodes;

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
        currentEpisodeEntries = [];
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

    // 页面加载完成后，延迟保存一次历史记录
    setTimeout(() => {
        window.LibertyDebug.log('[历史记录] 尝试保存初始历史记录');
        saveToHistory();
    }, 2000);
}

let playerShortcutCleanup = null;

function cleanupPlayerShortcuts() {
    if (typeof playerShortcutCleanup === 'function') {
        playerShortcutCleanup();
    }
    playerShortcutCleanup = null;
}

function isVisibleShortcutLayer(element) {
    if (!(element instanceof Element)) return false;

    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') {
        return false;
    }

    return element.getClientRects().length > 0;
}

function isShortcutInteractiveElement(element) {
    if (!(element instanceof Element)) return false;

    const tagName = element.tagName?.toLowerCase();
    if (
        tagName === 'input' ||
        tagName === 'textarea' ||
        tagName === 'select' ||
        tagName === 'button' ||
        tagName === 'summary' ||
        targetMatchesSelector(element, 'a[href]') ||
        element.isContentEditable
    ) {
        return true;
    }

    return Boolean(element.closest([
        'input',
        'textarea',
        'select',
        'button',
        'summary',
        'a[href]',
        '[contenteditable="true"]',
        '[contenteditable="plaintext-only"]',
        '[role="button"]',
        '[role="textbox"]',
        '[role="searchbox"]',
        '[role="combobox"]',
        '[role="menuitem"]'
    ].join(', ')));
}

function targetMatchesSelector(element, selector) {
    return Boolean(element?.matches?.(selector));
}

function hasOpenShortcutBlockingLayer() {
    const selectors = [
        '#passwordModal',
        '#modal',
        '#danmuSourceModal',
        '#loading',
        '#messageBoxModal',
        '#showImportBoxModal',
        '.modal',
        '.popup',
        '.dialog',
        '[role="dialog"]',
        '[aria-modal="true"]'
    ];

    return selectors.some((selector) =>
        Array.from(document.querySelectorAll(selector)).some(isVisibleShortcutLayer)
    );
}

function shouldIgnoreShortcut(event) {
    if (!event || event.defaultPrevented || event.isComposing) return true;

    const target = event.target instanceof Element ? event.target : null;
    const activeElement = document.activeElement instanceof Element ? document.activeElement : null;

    if (isShortcutInteractiveElement(target) || isShortcutInteractiveElement(activeElement)) {
        return true;
    }

    if (hasOpenShortcutBlockingLayer()) {
        return true;
    }

    return false;
}

function isSpaceShortcutKey(event) {
    return event.key === ' ' || event.key === 'Spacebar' || event.code === 'Space';
}

function getShortcutPlayer() {
    return art || null;
}

const SHORTCUT_VOLUME_STEP = 0.1;

function normalizeShortcutVolume(value) {
    const safeValue = Number.isFinite(value) ? value : 0;
    return Math.min(1, Math.max(0, Math.round(safeValue * 10) / 10));
}

function getSeekablePlayerState(player = getShortcutPlayer()) {
    if (!player) return null;

    const currentTime = Number(player.currentTime);
    const duration = Number(player.duration);

    if (!Number.isFinite(currentTime) || !Number.isFinite(duration) || duration <= 0) {
        return null;
    }

    return { currentTime, duration };
}

function togglePlayerPlayback() {
    const player = getShortcutPlayer();
    if (!player) return null;

    const willPlay = !player.playing;
    if (typeof player.toggle === 'function') {
        player.toggle();
    } else if (willPlay && typeof player.play === 'function') {
        player.play();
    } else if (!willPlay && typeof player.pause === 'function') {
        player.pause();
    } else {
        return null;
    }

    return willPlay;
}

function seekPlayerBy(deltaSeconds) {
    const player = getShortcutPlayer();
    const state = getSeekablePlayerState(player);
    if (!player || !state) return null;

    const nextTime = deltaSeconds >= 0
        ? Math.min(state.duration, state.currentTime + deltaSeconds)
        : Math.max(0, state.currentTime + deltaSeconds);

    player.currentTime = nextTime;
    return nextTime;
}

function adjustPlayerVolume(delta) {
    const player = getShortcutPlayer();
    if (!player) return null;

    const currentVolume = Number(player.volume);
    const safeVolume = normalizeShortcutVolume(currentVolume);
    const nextVolume = normalizeShortcutVolume(safeVolume + delta);

    if (delta > 0 && player.muted) {
        player.muted = false;
    }

    player.volume = nextVolume;
    return nextVolume;
}

function togglePlayerMuted() {
    const player = getShortcutPlayer();
    if (!player) return null;

    player.muted = !player.muted;
    return Boolean(player.muted);
}

function togglePlayerFullscreen() {
    const player = getShortcutPlayer();
    if (!player) return null;

    player.fullscreen = !player.fullscreen;
    return Boolean(player.fullscreen);
}

function togglePlayerWebFullscreen() {
    const player = getShortcutPlayer();
    if (!player || typeof player.fullscreenWeb === 'undefined') return null;

    player.fullscreenWeb = !player.fullscreenWeb;
    return Boolean(player.fullscreenWeb);
}

function playPreviousEpisodeByShortcut() {
    if (currentEpisodeIndex <= 0) return false;

    playPreviousEpisode('shortcut-previous');
    return true;
}

function playNextEpisodeByShortcut() {
    if (currentEpisodeIndex >= currentEpisodes.length - 1) return false;

    playNextEpisode('shortcut-next');
    return true;
}

function toggleDanmakuByShortcut() {
    if (!isDanmuServiceEnabled() || !getDanmukuPlugin()) return null;

    const nextVisible = !isDanmuUserVisibleEnabled();
    saveDanmuConfig({ visible: nextVisible });
    if (!nextVisible) {
        danmuReloadToken += 1;
        cancelDanmakuRequest('danmaku-disabled');
    }
    applyDanmakuVisibility('shortcut-danmaku');
    return nextVisible;
}

function setupPlayerShortcuts(player) {
    cleanupPlayerShortcuts();
    if (!player) return;

    // Basic keyboard shortcuts for desktop player controls.
    // Touch gestures are handled separately and should not be implemented here.
    const onKeyDown = (event) => {
        if (shouldIgnoreShortcut(event)) return;

        if (event.altKey && event.key === 'ArrowUp') {
            event.preventDefault();
            event.stopPropagation();
            if (event.repeat) return;
            if (playPreviousEpisodeByShortcut()) {
                showShortcutHint('上一集', 'episodePrev');
            }
            return;
        }

        if (event.altKey && event.key === 'ArrowDown') {
            event.preventDefault();
            event.stopPropagation();
            if (event.repeat) return;
            if (playNextEpisodeByShortcut()) {
                showShortcutHint('下一集', 'episodeNext');
            }
            return;
        }

        if (event.ctrlKey || event.metaKey || event.altKey) {
            return;
        }

        const key = String(event.key || '').toLowerCase();

        if (isSpaceShortcutKey(event) && event.repeat) {
            event.preventDefault();
            return;
        }

        if (event.repeat && ['k', 'm', 'f', 'w', 'd'].includes(key)) {
            event.preventDefault();
            return;
        }

        if (isSpaceShortcutKey(event)) {
            event.preventDefault();
            const willPlay = togglePlayerPlayback();
            if (willPlay === null) return;
            showShortcutHint(willPlay ? '播放' : '暂停', willPlay ? 'play' : 'pause');
            return;
        }

        switch (event.key) {
            case 'ArrowLeft':
                event.preventDefault();
                if (seekPlayerBy(-5) !== null) {
                    showShortcutHint('快退 5 秒', 'left');
                }
                return;
            case 'ArrowRight':
                event.preventDefault();
                if (seekPlayerBy(5) !== null) {
                    showShortcutHint('快进 5 秒', 'right');
                }
                return;
            case 'ArrowUp': {
                event.preventDefault();
                const volume = adjustPlayerVolume(SHORTCUT_VOLUME_STEP);
                if (volume !== null) {
                    showShortcutHint(`音量 ${(volume * 100).toFixed(0)}%`, 'volumeUp');
                }
                return;
            }
            case 'ArrowDown': {
                event.preventDefault();
                const volume = adjustPlayerVolume(-SHORTCUT_VOLUME_STEP);
                if (volume !== null) {
                    showShortcutHint(`音量 ${(volume * 100).toFixed(0)}%`, 'volumeDown');
                }
                return;
            }
        }

        switch (key) {
            case 'k': {
                event.preventDefault();
                const willPlay = togglePlayerPlayback();
                if (willPlay === null) return;
                showShortcutHint(willPlay ? '播放' : '暂停', willPlay ? 'play' : 'pause');
                return;
            }
            case 'm': {
                event.preventDefault();
                const muted = togglePlayerMuted();
                if (muted === null) return;
                showShortcutHint(muted ? '静音已开启' : '静音已关闭', muted ? 'mute' : 'volumeUp');
                return;
            }
            case 'f': {
                event.preventDefault();
                const isFullscreen = togglePlayerFullscreen();
                if (isFullscreen === null) return;
                showShortcutHint(isFullscreen ? '进入全屏' : '退出全屏', isFullscreen ? 'fullscreen' : 'fullscreenExit');
                return;
            }
            case 'w': {
                event.preventDefault();
                const isWebFullscreen = togglePlayerWebFullscreen();
                if (isWebFullscreen === null) return;
                showShortcutHint(
                    isWebFullscreen ? '进入网页全屏' : '退出网页全屏',
                    isWebFullscreen ? 'webFullscreen' : 'webFullscreenExit'
                );
                return;
            }
            case 'd': {
                event.preventDefault();
                const danmakuVisible = toggleDanmakuByShortcut();
                if (danmakuVisible === null) return;
                showShortcutHint(danmakuVisible ? '显示弹幕' : '隐藏弹幕', 'danmaku');
                return;
            }
            default:
                return;
        }
    };

    let cleaned = false;
    const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        document.removeEventListener('keydown', onKeyDown);
        try {
            player.off?.('destroy', cleanup);
        } catch (error) {}
        if (playerShortcutCleanup === cleanup) {
            playerShortcutCleanup = null;
        }
    };

    document.addEventListener('keydown', onKeyDown);
    try {
        player.on?.('destroy', cleanup);
    } catch (error) {}
    playerShortcutCleanup = cleanup;
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
        volumeUp: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7-7 7M3 12h18"></path>',
        volumeDown: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12H3m11-7-7 7 7 7"></path>',
        fullscreen: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5"></path>',
        fullscreenExit: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 9V4H4m11 0h5v5m0 6v5h-5m-6 0H4v-5"></path>',
        webFullscreen: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16v12H4zM8 10h8"></path>',
        webFullscreenExit: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 8h12v8H6zM4 4h16v16H4z"></path>',
        play: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3l14 9-14 9V3z"></path>',
        pause: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 5H6v14h4V5zm8 0h-4v14h4V5z"></path>',
        mute: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5 6 9H3v6h3l5 4V5zm5 4 5 5m0-5-5 5"></path>',
        danmaku: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 7h14v10H5zM8 11h8"></path>',
        episodePrev: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19V5m0 0-5 5m5-5 5 5"></path>',
        episodeNext: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v14m0 0-5-5m5 5 5-5"></path>'
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
    // 调试辅助方法
    // ============================================
    getStatus() {
        return {
            hasArt: !!this.art,
            hasHls: !!this.hls,
            timers: Object.keys(this.timers).filter(key => this.timers[key] !== null),
            eventListenersCount: this.eventListeners.size,
            wakeLockActive: !!this.wakeLock.instance,
            noSleepActive: !!this.wakeLock.noSleepVideo
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
        danmuReloadToken += 1;
        cancelDanmakuRequest('player-destroy');

        cleanupPlayerShortcuts();
        this.clearAllTimers();
        this.removeAllEventListeners();
        this.releaseWakeLock();
        this.destroyHls();
        this.destroyArtPlayer();

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
    setupPlayerShortcuts(art);

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
		setupDanmakuPanels();

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
		        if (!toSave.visible) {
		            danmuReloadToken += 1;
		            cancelDanmakuRequest('danmaku-disabled');
		        }
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
		        danmuReloadToken += 1;
		        cancelDanmakuRequest('danmaku-disabled');
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
    return (Array.isArray(episodes) ? episodes : []).map((episode, index) => {
        const structured = currentEpisodeEntries?.[index];
        const rawEpisodeName = structured?.rawEpisodeName
            ?? structured?.name
            ?? (episode && typeof episode === 'object' ? episode.rawEpisodeName ?? episode.name ?? '' : '');
        return {
            index,
            rawEpisodeName,
            name: rawEpisodeName || `第 ${index + 1} 集`,
            url: getPlayerEpisodeUrlValue(episode)
        };
    });
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
            rawEpisodeName: episode?.rawEpisodeName ?? episode?.name ?? episode?.title ?? '',
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
    danmuReloadToken += 1;
    cancelDanmakuRequest('watch-room-episode');

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

        currentEpisodeEntries = episodes;
        currentEpisodes = episodes;
        currentEpisodeIndex = episodeIndex;
        currentVideoUrl = episodeUrl;
        videoHasEnded = false;
        clearVideoProgress();

        try {
            const playbackState = window.LibertyUtils?.playbackState;
            if (playbackState) {
                playbackState.writePlaybackSession({
                    episodeEntries: episodes,
                    episodeIndex,
                });
            } else {
                localStorage.setItem('currentEpisodes', JSON.stringify(episodes));
                localStorage.setItem('currentEpisodeIndex', String(episodeIndex));
            }
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

    danmuReloadToken += 1;
    cancelDanmakuRequest(`episode-switch:${switchReason}`);

    // 切换前清理旧资源
    window.LibertyDebug.log('🔄 准备切换集数，清理旧资源...');

    // 清理历史记录防抖定时器，防止旧集数写入
	if (saveHistoryTimer) {
		clearTimeout(saveHistoryTimer);
		saveHistoryTimer = null;
	}

	currentDanmuCache = { episodeIndex: -1, danmuList: null, timestamp: 0 };
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

        const episodeEntries = Array.isArray(data.episodes)
            ? data.episodes.filter(episode => getPlayerEpisodeUrlValue(episode))
            : [];
        const playableEpisodes = episodeEntries.map(getPlayerEpisodeUrlValue);

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
                const videoInfo = data.videoInfo || {};
                playbackState.writePlaybackSession({
                    title: data.vod_name || '未知视频',
                    year: videoInfo.year || data.vod_year || '',
                    category: videoInfo.category || '',
                    type: videoInfo.type || data.type_name || data.vod_class || '',
                    remarks: videoInfo.remarks || data.vod_remarks || '',
                    director: videoInfo.director || data.vod_director || '',
                    actors: videoInfo.actors || videoInfo.actor || data.vod_actor || '',
                    area: videoInfo.area || data.vod_area || '',
                    language: videoInfo.language || videoInfo.lang || data.vod_lang || '',
                    sourceName: videoInfo.source_name || sourceKey,
                    sourceCode: sourceKey,
                    vodId,
                    episodeIndex: targetIndex,
                    episodes: episodeEntries
                });
            } else {
                localStorage.setItem('currentVideoTitle', data.vod_name || '未知视频');
                localStorage.setItem('currentEpisodes', JSON.stringify(playableEpisodes));
                localStorage.setItem('currentEpisodeEntries', JSON.stringify(episodeEntries));
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
// 关闭弹幕源弹窗
function closeDanmuSourceModal() {
    if (danmuSourceSearchController && !danmuSourceSearchController.signal.aborted) {
        danmuSourceSearchController.abort('manual-modal-closed');
    }
    danmuSourceSearchController = null;
    document.getElementById('danmuSourceModal').classList.add('hidden');
}

function danmuIdentityDecisionLabel(decision) {
    const labels = {
        confirmed: '身份已确认',
        supported: '证据支持',
        uncertain: '信息不足',
        rejected: '身份冲突',
    };
    return labels[decision] || '待验证';
}

function renderManualDanmuEpisodeChoices(candidate, resolution) {
    const modal = document.getElementById('danmuSourceModal');
    const modalContent = document.getElementById('danmuSourceList');
    const candidates = resolution?.result?.episodeResolution?.candidates || [];
    if (!modal || !modalContent || !candidates.length) return false;

    const safeAnimeId = escapeHtml(candidate.animeId);
    let html = `
        <div class="space-y-3 p-2">
            <div class="text-sm text-gray-300">
                已选择作品：${escapeHtml(candidate.animeTitle)}。当前剧集仍有多个身份兼容候选，请确认具体弹幕剧集。
            </div>
    `;
    candidates.forEach((episode) => {
        const episodeId = escapeHtml(episode.episodeId || '');
        const episodeTitle = escapeHtml(episode.episodeTitle || '未命名剧集');
        html += `
            <button
                type="button"
                data-danmu-anime-id="${safeAnimeId}"
                data-danmu-episode-id="${episodeId}"
                class="danmu-episode-choice w-full text-left px-4 py-3 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 border-2 border-transparent">
                <div class="font-medium">${episodeTitle}</div>
                <div class="text-xs opacity-70 mt-1">剧集 ID：${episodeId}</div>
            </button>
        `;
    });
    html += '</div>';
    modalContent.innerHTML = html;
    modal.classList.remove('hidden');
    modalContent.querySelectorAll('.danmu-episode-choice').forEach((button) => {
        button.addEventListener('click', () => {
            confirmDanmuEpisodeChoice(
                button.dataset.danmuAnimeId || '',
                button.dataset.danmuEpisodeId || '',
            );
        });
    });
    return true;
}

async function showDanmuSourceModal() {
    if (!isDanmuServiceEnabled()) {
        showToast('弹幕功能未启用', 'error');
        return;
    }

    const runtime = getDanmuCoreRuntime();
    const context = createProductionDanmakuContext(currentVideoTitle, currentEpisodeIndex);
    const modal = document.getElementById('danmuSourceModal');
    const modalContent = document.getElementById('danmuSourceList');
    if (!runtime || !context || !modal || !modalContent || !runtime.core.adaptDanmuSearchAnime) {
        showToast('Liberty Core V2 尚未就绪', 'error');
        return;
    }
    if (!context.media?.canonicalTitle) {
        showToast('当前影片标题信息不足，无法搜索弹幕源', 'warning');
        return;
    }

    danmuSourceSearchController?.abort('superseded-manual-search');
    const controller = new AbortController();
    danmuSourceSearchController = controller;
    manualDanmuCandidates.clear();
    modalContent.innerHTML = '<div class="text-center py-8 text-gray-400">正在搜索弹幕源...</div>';
    modal.classList.remove('hidden');

    const response = await runtime.client.searchAnime(context.media.canonicalTitle, {
        signal: controller.signal,
    });
    if (controller.signal.aborted || danmuSourceSearchController !== controller) return;
    if (!response.ok) {
        const message = response.error.kind === 'rate-limited'
            ? '弹幕服务请求过快，请稍后重试'
            : '弹幕源搜索失败，请稍后重试';
        modalContent.innerHTML = `<div class="text-center py-8 text-red-400">${escapeHtml(message)}</div>`;
        danmuDebugWarn('[DanmuCore] manual candidate search failed', response.error);
        return;
    }

    const candidates = response.data.animes.map(runtime.core.adaptDanmuSearchAnime);
    const candidateResolution = runtime.candidateResolver.resolve(context.media, candidates);
    const evaluations = [...candidateResolution.evaluations];
    if (!evaluations.length) {
        modalContent.innerHTML = '<div class="text-center py-8 text-gray-400">未找到匹配的弹幕源</div>';
        return;
    }

    const priority = { confirmed: 0, supported: 1, uncertain: 2, rejected: 3 };
    evaluations.sort((left, right) => (
        (priority[left.identity.decision] ?? 4) - (priority[right.identity.decision] ?? 4)
    ));
    let html = '<div class="space-y-2 max-h-[60vh] overflow-y-auto p-2">';
    evaluations.slice(0, 20).forEach(({ candidate, identity }) => {
        manualDanmuCandidates.set(String(candidate.animeId), candidate);
        const isActive = String(currentDanmuAnimeId || '') === String(candidate.animeId);
        const rejected = identity.decision === 'rejected';
        const year = candidate.year ? String(candidate.year) : '年份未知';
        const season = candidate.season ? `第${candidate.season}季` : '季数未知';
        const evidenceLabel = danmuIdentityDecisionLabel(identity.decision);
        html += `
            <button
                type="button"
                data-danmu-anime-id="${escapeHtml(candidate.animeId)}"
                ${rejected ? 'disabled' : ''}
                class="danmu-source-button w-full text-left px-4 py-3 rounded-lg transition-all ${
                    isActive
                        ? 'bg-blue-600 text-white shadow-lg border-2 border-blue-400'
                        : rejected
                            ? 'bg-gray-900 text-gray-500 border-2 border-transparent cursor-not-allowed'
                            : 'bg-gray-800 hover:bg-gray-700 text-gray-200 border-2 border-transparent'
                }">
                <div class="flex items-center justify-between gap-2 min-w-0">
                    <div class="danmu-source-name font-medium min-w-0">${escapeHtml(candidate.animeTitle)}</div>
                    ${isActive ? '<span class="danmu-source-badge text-yellow-300 text-sm shrink-0">✓ 当前使用</span>' : ''}
                </div>
                <div class="danmu-source-meta text-sm opacity-75 mt-1">
                    ${escapeHtml(year)} · ${escapeHtml(season)} · ${escapeHtml(evidenceLabel)} · 当前剧集待 Core 验证
                </div>
            </button>
        `;
    });
    html += '</div>';
    modalContent.innerHTML = html;
    modalContent.querySelectorAll('.danmu-source-button:not([disabled])').forEach((button) => {
        button.addEventListener('click', () => switchDanmuSource(button.dataset.danmuAnimeId || ''));
    });
    danmuDebugLog('[DanmuCore] manual candidate evidence', evaluations.map(({ candidate, identity }) => ({
        animeId: candidate.animeId,
        animeTitle: candidate.animeTitle,
        decision: identity.decision,
        reason: identity.reason,
    })));
}

async function applyManualDanmuResolution(candidate, manualEpisodeId = null) {
    if (!art?.plugins?.artplayerPluginDanmuku) {
        showToast('播放器未就绪', 'error');
        return;
    }

    const video = art.video;
    const shouldResume = Boolean(video && !video.paused && !video.ended);
    const currentTime = video ? video.currentTime : (art.currentTime || 0);
    showToast(`正在验证弹幕源: ${candidate.animeTitle}...`, 'info');

    const resolution = await resolveDanmakuWithCore({
        title: currentVideoTitle,
        episodeIndex: currentEpisodeIndex,
        reason: manualEpisodeId ? 'manual-episode' : 'manual-work',
        manualCandidate: candidate,
        manualEpisodeId,
    });
    if (resolution.stale) return;
    if (resolution.request && !isCurrentDanmakuRequest(
        resolution.request,
        resolution.context?.currentEpisodeIndex ?? currentEpisodeIndex,
    )) return;

    const result = resolution.result;
    const manualWorkAccepted = result?.candidateResolution?.selectedBy === 'manual'
        && result.candidateResolution.selected?.animeId === candidate.animeId;
    if (manualWorkAccepted) {
        const previousChoices = currentSessionDanmuSource?.manualCandidate?.animeId === candidate.animeId
            ? { ...(currentSessionDanmuSource.episodeChoices || {}) }
            : {};
        if (manualEpisodeId && resolution.context?.episode?.canonicalEpisodeId) {
            previousChoices[resolution.context.episode.canonicalEpisodeId] = manualEpisodeId;
        }
        currentSessionDanmuSource = {
            animeId: candidate.animeId,
            animeTitle: candidate.animeTitle,
            sourceName: candidate.animeTitle,
            selectedBy: 'manual',
            canonicalMediaId: resolution.context?.media?.mediaId || '',
            canonicalTitle: resolution.context?.media?.canonicalTitle || '',
            manualCandidate: candidate,
            episodeChoices: previousChoices,
            updatedAt: Date.now(),
        };
    }

    if (result?.state === 'episode-uncertain' && result.episodeResolution?.candidates?.length) {
        if (renderManualDanmuEpisodeChoices(candidate, resolution)) {
            showToast('请确认当前弹幕剧集', 'warning');
            return;
        }
    }

    if (!result?.binding) {
        const stateMessages = {
            'candidate-conflict': '所选作品与当前影片身份冲突',
            'episode-rejected': '所选弹幕剧集与当前播放剧集冲突',
            'episode-not-found': '该作品中未找到当前剧集',
            'episode-uncertain': '当前剧集信息不足，无法安全匹配',
            'rate-limited': '弹幕服务请求过快，请稍后重试',
        };
        showToast(stateMessages[result?.state] || '无法安全匹配该弹幕源', 'warning');
        return;
    }

    currentDanmuCache = { key: '', episodeIndex: -1, danmuList: null, timestamp: 0 };
    await clearCurrentDanmukuPlugin('manual-source');
    if (resolution.request && !isCurrentDanmakuRequest(
        resolution.request,
        resolution.context?.currentEpisodeIndex ?? currentEpisodeIndex,
    )) return;

    if (result.state === 'success') {
        const cacheKey = getDanmuCoreCacheKey(
            resolution.context,
            candidate,
            manualEpisodeId,
        );
        currentDanmuCache = {
            key: cacheKey,
            episodeIndex: currentEpisodeIndex,
            danmuList: resolution.danmuku,
            timestamp: Date.now(),
        };
        await applyDanmakuRuntimeState({
            reason: manualEpisodeId ? 'manual-episode' : 'manual-source',
            danmuku: resolution.danmuku,
            reload: true,
        });
        document.getElementById('danmuSourceModal')?.classList.add('hidden');
        showToast(`✓ 已切换到: ${candidate.animeTitle} (${resolution.danmuku.length}条)`, 'success');
    } else if (result.state === 'comments-empty') {
        document.getElementById('danmuSourceModal')?.classList.add('hidden');
        showToast('该弹幕剧集暂无弹幕', 'warning');
    } else {
        showToast('弹幕加载失败，请稍后重试', 'warning');
    }

    if (video && currentTime > 0 && Math.abs(video.currentTime - currentTime) > 2) {
        art.currentTime = currentTime;
    }
    if (shouldResume && art?.video?.paused) {
        const playResult = art.play();
        playResult?.catch?.(() => showToast('浏览器阻止自动播放，请手动点击播放', 'warning'));
    }
}

async function switchDanmuSource(animeId) {
    const candidate = manualDanmuCandidates.get(String(animeId));
    if (!candidate) {
        showToast('弹幕源候选已失效，请重新搜索', 'warning');
        return;
    }
    await applyManualDanmuResolution(candidate);
}

async function confirmDanmuEpisodeChoice(animeId, episodeId) {
    const candidate = manualDanmuCandidates.get(String(animeId))
        || currentSessionDanmuSource?.manualCandidate;
    if (!candidate || String(candidate.animeId) !== String(animeId) || !episodeId) {
        showToast('弹幕剧集候选已失效，请重新选择', 'warning');
        return;
    }
    await applyManualDanmuResolution(candidate, String(episodeId));
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

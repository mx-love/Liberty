const selectedAPIs = JSON.parse(localStorage.getItem('selectedAPIs') || '[]');
const customAPIs = JSON.parse(localStorage.getItem('customAPIs') || '[]'); // 存储自定义API列表

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
        for (let i = 0; i < config.storage.length; i++) {
            const key = config.storage.key(i);
            if (key?.startsWith(config.prefix)) {
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

// 生成缓存键
function generateDanmuCacheKey(cleanTitle, episodeIndex) {
    const titleHash = simpleHash(cleanTitle);
    return `danmu_${titleHash}_ep${episodeIndex}`;
}

// 网络请求重试机制
async function fetchWithRetry(url, options = {}, maxRetries = 3, timeout = 10000) {
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

            if (i < maxRetries - 1) {
                const delay = baseDelay * Math.pow(2, i);
                console.warn(`⚠️ HTTP ${response.status}, ${delay}ms后重试...`);
                await new Promise(r => setTimeout(r, delay));
            }
        } catch (error) {
            const isTimeout = error.name === 'AbortError';
            console.warn(`⚠️ ${isTimeout ? '超时' : '网络错误'} (尝试 ${i + 1}/${maxRetries})`);
            
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
    
    // 1. 停止所有定时器
    clearAllTimers();
    if (progressSaveInterval) {
        clearInterval(progressSaveInterval);
        progressSaveInterval = null;
    }
    
    // 🔥 新增：清理恢复弹幕定时器
    if (restoreDanmuTimer) {
        clearTimeout(restoreDanmuTimer);
        restoreDanmuTimer = null;
    }
    
    // 2. 清理播放器 - 加强版
    if (art) {
        try {
            // 先暂停
            if (art.video) {
                art.video.pause();
                art.video.src = '';
                art.video.load();
            }
            
            // 销毁播放器
            art.destroy();
            console.log('✅ 播放器已销毁');
        } catch (e) {
            console.error('播放器销毁失败:', e);
        } finally {
            art = null;
        }
    }
    
    // 3. 清理 HLS 实例
    if (currentHls) {
        try {
            currentHls.stopLoad();
            currentHls.detachMedia();
            currentHls.destroy();
            console.log('✅ HLS 实例已销毁');
        } catch (e) {
            console.error('HLS 销毁失败:', e);
        } finally {
            currentHls = null;
        }
    }
    
    // 4. 🔥 清理所有残留的 video 元素（关键修复）
    const allVideos = document.querySelectorAll('video');
    allVideos.forEach((video, index) => {
        try {
            video.pause();
            video.src = '';
            video.load();
            video.remove();
            console.log(`✅ 清理视频元素 ${index + 1}/${allVideos.length}`);
        } catch (e) {
            console.error('清理视频元素失败:', e);
        }
    });
    
    // 5. 清理弹幕缓存
    currentDanmuCache = {
        episodeIndex: -1,
        danmuList: null,
        timestamp: 0
    };
    
    // 6. 清理临时详情缓存
    if (typeof tempDetailCache !== 'undefined') {
        tempDetailCache.clear();
        console.log('✅ 临时详情缓存已清理');
    }
    
    // 7. 重置全局状态
    currentDanmuAnimeId = null;
    currentDanmuSourceName = '';
    
    console.log('✅ 资源清理完成');
}
// 页面卸载时清理
window.addEventListener('beforeunload', cleanupResources);
window.addEventListener('pagehide', cleanupResources);

// ===== 【修改】页面可见性管理 - 后台继续播放 =====
let pageWasHidden = false;
let restoreDanmuTimer = null; // 🔥 新增：防止定时器冲突

document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
        pageWasHidden = true;
        console.log('👁️ 页面已隐藏，继续播放（关闭弹幕）');
        
        saveCurrentProgress();
        
        // 只关闭弹幕，不暂停视频
        if (art && art.plugins.artplayerPluginDanmuku) {
            const danmukuPlugin = art.plugins.artplayerPluginDanmuku;
            if (typeof danmukuPlugin.hide === 'function') {
                danmukuPlugin.hide();
            }
            danmukuPlugin.config({ danmuku: [] });
        }
        
    } else if (pageWasHidden) {
        console.log('👁️ 页面恢复可见，恢复弹幕');
        
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
                    // 只清理不是当前播放器的视频元素
                    if (video !== activeVideo) {
                        try {
                            console.log('🧹 清理幽灵视频元素');
                            video.pause();
                            video.src = '';
                            video.load();
                            video.remove();
                        } catch (e) {
                            console.error('清理视频失败:', e);
                        }
                    }
                });
            }
        }
        
        // 🔥 恢复弹幕（使用缓存优先策略）
        if (restoreDanmuTimer) {
            clearTimeout(restoreDanmuTimer);
        }
        
        restoreDanmuTimer = setTimeout(() => {
            restoreDanmuTimer = null;
            
            if (!art || !art.plugins.artplayerPluginDanmuku || !art.video) {
                return;
            }
            
            try {
                // 优先使用缓存的弹幕
                const cachedDanmu = currentDanmuCache.danmuList;
                const danmukuPlugin = art.plugins.artplayerPluginDanmuku;
                
                if (cachedDanmu && cachedDanmu.length > 0 && 
                    currentDanmuCache.episodeIndex === currentEpisodeIndex) {
                    // 使用缓存
                    danmukuPlugin.config({ 
                        danmuku: cachedDanmu,
                        synchronousPlayback: true 
                    });
                    danmukuPlugin.load();
                    
                    // 同步到当前播放位置
                    if (typeof danmukuPlugin.seek === 'function') {
                        danmukuPlugin.seek(art.video.currentTime);
                    }
                    
                    // 显示弹幕
                    if (typeof danmukuPlugin.show === 'function') {
                        danmukuPlugin.show();
                    }
                    
                    console.log('✅ 弹幕已恢复（使用缓存）');
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
                                
                                console.log('✅ 弹幕已恢复（重新加载）');
                            }
                        })
                        .catch(err => {
                            console.warn('恢复弹幕失败:', err);
                        });
                }
            } catch (e) {
                console.error('恢复弹幕失败:', e);
            }
        }, 500); // 增加到 500ms
    }
});

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
const DANMU_CONFIG = {
    baseUrl: 'https://danmu.manxue.eu.org/87654321',
    enabled: true,
    
    cacheExpiration: {
        danmuCache: 30 * 60 * 1000,
        detailCache: 60 * 60 * 1000,
        sourceCache: 7 * 24 * 60 * 60 * 1000
    }
};

// 弹幕缓存 - 只缓存当前集
let currentDanmuCache = {
    episodeIndex: -1,
    danmuList: null,
    timestamp: 0
};

// ✅ 恢复弹幕源追踪
let currentDanmuAnimeId = null;
let currentDanmuSourceName = '';
let availableDanmuSources = [];

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
    
    // 短标题判断
    const isShortTitle = targetInfo.clean.length <= 4;
    
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
    
		// 在前5名中查找第一季或无季度的版本
		const candidates = scored.slice(0, 5);
    
		// 【修复】优先查找第一季
		let firstSeasonMatch = candidates.find(s => {
			const animeInfo = advancedCleanTitle(s.anime.animeTitle);
			return animeInfo.season === 1;
		});
    
		// 【修复】如果没有第一季，才找无季度标识的
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
            
            const searchUrl = `${DANMU_CONFIG.baseUrl}/api/v2/search/anime?keyword=${encodeURIComponent(searchTitle)}`;
            console.log(`🔍 弹幕搜索尝试 ${attempt}/3`);
            
            const response = await fetchWithRetry(searchUrl, {}, 3, 12000);
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

    const episodesWithInfo = episodes.map((ep, idx) => {
        const title = ep.episodeTitle || '';
        let episodeNumber = null;
        
        // 按优先级匹配集数
        for (const pattern of MATCH_CONFIG.episodePatterns) {
            const match = title.match(pattern);
            if (match) {
                episodeNumber = parseInt(match[1]);
                if (episodeNumber > 0 && episodeNumber <= 9999) {
                    break;
                }
            }
        }
        
        // 特殊处理：纯数字标题
        if (!episodeNumber && /^\d+$/.test(title.trim())) {
            episodeNumber = parseInt(title.trim());
        }
        
        return {
            episode: ep,
            number: episodeNumber !== null ? episodeNumber : (idx + 1),
            title: title,
            index: idx,
            confidence: episodeNumber !== null ? 'high' : 'low'
        };
    });

    // 策略1: 精确匹配
    const exactMatch = episodesWithInfo.find(ep => 
        ep.number === targetNumber && ep.confidence === 'high'
    );
    if (exactMatch) {
        console.log(`✅ [弹幕] 精确匹配 第${targetNumber}集: ${exactMatch.title}`);
        return exactMatch.episode;
    }

    // 策略2: 索引匹配（检查连续性）
    if (targetIndex >= 0 && targetIndex < episodes.length) {
        const indexMatch = episodesWithInfo[targetIndex];
        
        // 检查集数是否连续
        const isSequential = episodesWithInfo.every((ep, i) => {
            if (i === 0) return true;
            return ep.number === episodesWithInfo[i - 1].number + 1;
        });
        
        if (isSequential || indexMatch.confidence === 'high') {
            console.log(`✅ [弹幕] 索引匹配 第${targetNumber}集 → 弹幕第${indexMatch.number}集`);
            return indexMatch.episode;
        }
    }

    // 策略3: 模糊匹配（±1偏差）
    const fuzzyMatch = episodesWithInfo.find(ep => 
        Math.abs(ep.number - targetNumber) <= 1 && ep.confidence === 'high'
    );
    if (fuzzyMatch) {
        console.log(`⚠️ [弹幕] 模糊匹配 第${targetNumber}集 → 弹幕第${fuzzyMatch.number}集 (±1)`);
        return fuzzyMatch.episode;
    }

    console.error(`❌ [弹幕] 无法匹配第${targetNumber}集 (共${episodes.length}集)`);
    console.log('可用集数:', episodesWithInfo.map(e => `${e.index}:${e.number}`));
    
    return null;
}

// ✅ 智能弹幕去重函数
function deduplicateDanmaku(danmakuList) {
    if (!danmakuList || danmakuList.length === 0) return [];
    
    const seen = new Map();
    const result = [];
    
    for (const danmu of danmakuList) {
        const normalizedText = danmu.text
            .replace(/\s+/g, '')
            .replace(/[！!。.？?，,、]/g, '')
            .toLowerCase()
            .trim();
        
        if (!normalizedText) continue;
        
        const timeKey = Math.floor(danmu.time);
        const uniqueKey = `${timeKey}_${normalizedText}`;
        
        if (!seen.has(uniqueKey)) {
            seen.set(uniqueKey, true);
            result.push(danmu);
        }
    }
    
    return result;
}

// ✅ 过滤低质量弹幕
function filterLowQualityDanmaku(danmakuList) {
    return danmakuList.filter(danmu => {
        const text = danmu.text.trim();
        
        if (text.length < 2) return false;
        if (/^[\d\s\.\-_]+$/.test(text)) return false;
        if (/^(.)\1{4,}$/.test(text)) return false;
        
        const spamKeywords = [
            '签到', '打卡', '水', '前排', '沙发',
            '666', '2333', '233', 'hhh', 'www'
        ];
        if (spamKeywords.some(kw => text === kw)) return false;
        
        return true;
    });
}

// ✅ 获取弹幕的独立函数 - 完善的B站6分钟分片策略
async function fetchDanmaku(episodeId, episodeIndex) {
    const commentUrl = `${DANMU_CONFIG.baseUrl}/api/v2/comment/${episodeId}?withRelated=true&chConvert=1`;
    const commentResponse = await fetch(commentUrl);

    if (!commentResponse.ok) {
        console.warn(`⚠️ 获取弹幕失败`);
        return null;
    }

    const commentData = await commentResponse.json();
    
    if (!commentData.comments || !Array.isArray(commentData.comments)) {
        return [];
    }

    const allComments = commentData.comments;
    const totalComments = allComments.length;
    
    console.log(`📊 原始弹幕数量: ${totalComments}`);

    // 🎯 B站精确6分钟分片策略
    const SEGMENT_DURATION = 360; // 6分钟（秒）
    const MAX_PER_SEGMENT = 1500; // 每段最多1500条
    const MAX_PER_SECOND = 15; // 每秒最多15条（防止密集爆炸）
    
    // ============================================
    // 第1步：按时间排序所有弹幕
    // ============================================
    allComments.sort((a, b) => {
        const timeA = parseFloat(a.p?.split(',')[0] || 0);
        const timeB = parseFloat(b.p?.split(',')[0] || 0);
        return timeA - timeB;
    });
    
    // ============================================
    // 第2步：计算视频总时长和分段数
    // ============================================
    const lastTime = parseFloat(allComments[totalComments - 1]?.p?.split(',')[0] || 0);
    const totalSegments = Math.ceil(lastTime / SEGMENT_DURATION) || 1;
    
    console.log(`📐 视频时长: ${Math.floor(lastTime / 60)}分${Math.floor(lastTime % 60)}秒, 分为 ${totalSegments} 段`);
    
    // ============================================
    // 第3步：按6分钟分段处理弹幕
    // ============================================
    const danmakuPool = [];
    const segmentStats = [];
    
    for (let seg = 0; seg < totalSegments; seg++) {
        const segStart = seg * SEGMENT_DURATION;
        const segEnd = (seg + 1) * SEGMENT_DURATION;
        
        // 提取该段的所有弹幕
        const segmentComments = allComments.filter(c => {
            const time = parseFloat(c.p?.split(',')[0] || 0);
            return time >= segStart && time < segEnd;
        });
        
        const segmentCount = segmentComments.length;
        segmentStats.push({ seg: seg + 1, original: segmentCount, final: 0 });
        
        if (segmentCount === 0) continue;
        
        // ============================================
        // 第4步：段内处理策略
        // ============================================
        
        // 策略A：弹幕少于1500条，直接全部采用（但仍需去重和密度控制）
        if (segmentCount <= MAX_PER_SEGMENT) {
            const processed = processSegmentWithDensityControl(
                segmentComments, 
                MAX_PER_SECOND
            );
            processed.forEach(c => processDanmaku(c, danmakuPool));
            segmentStats[seg].final = processed.length;
        } 
        // 策略B：弹幕超过1500条，需要智能采样
        else {
            console.log(`⚠️ 第${seg + 1}段超载 (${segmentCount}条)，启动智能采样...`);
            
            // B1：先去重（同秒同文本只保留1条）
            const uniqueMap = new Map();
            segmentComments.forEach(c => {
                const params = c.p?.split(',') || [];
                const time = parseFloat(params[0] || 0);
                const timeKey = Math.floor(time * 10) / 10; // 精确到0.1秒
                const text = (c.m || '').trim().slice(0, 50);
                const key = `${timeKey}_${text}`;
                
                if (!uniqueMap.has(key)) {
                    uniqueMap.set(key, c);
                }
            });
            
            const uniqueComments = Array.from(uniqueMap.values());
            const afterDedup = uniqueComments.length;
            
            console.log(`  去重: ${segmentCount} → ${afterDedup}`);
            
            // B2：如果去重后仍超过1500，均匀密度采样
            if (afterDedup > MAX_PER_SEGMENT) {
                const sampled = uniformDensitySampling(
                    uniqueComments, 
                    MAX_PER_SEGMENT,
                    segStart,
                    segEnd
                );
                
                const controlled = processSegmentWithDensityControl(
                    sampled,
                    MAX_PER_SECOND
                );
                
                controlled.forEach(c => processDanmaku(c, danmakuPool));
                segmentStats[seg].final = controlled.length;
                
                console.log(`  采样: ${afterDedup} → ${sampled.length} → ${controlled.length}条`);
            } else {
                const controlled = processSegmentWithDensityControl(
                    uniqueComments,
                    MAX_PER_SECOND
                );
                controlled.forEach(c => processDanmaku(c, danmakuPool));
                segmentStats[seg].final = controlled.length;
            }
        }
    }
    
    // ============================================
    // 第5步：全局质量过滤
    // ============================================
    let filteredPool = filterLowQualityDanmaku(danmakuPool);
    
    // ============================================
    // 第6步：最终全局去重（防止边界重复）
    // ============================================
    const finalMap = new Map();
    filteredPool.forEach(d => {
        const timeKey = Math.floor(d.time * 10) / 10;
        const key = `${timeKey}_${d.text.slice(0, 30)}`;
        if (!finalMap.has(key)) {
            finalMap.set(key, d);
        }
    });
    
    const finalDanmaku = Array.from(finalMap.values());
    
    // ============================================
    // 第7步：按时间重新排序（确保时间轴正确）
    // ============================================
    finalDanmaku.sort((a, b) => a.time - b.time);
    
    // ============================================
	// 第8步：输出统计信息（简化版）
	// ============================================
	const totalReduction = ((1 - finalDanmaku.length / totalComments) * 100).toFixed(1);
	console.log(`✅ 弹幕优化: ${totalComments} → ${finalDanmaku.length}条 (节省${totalReduction}%) | 平均${(finalDanmaku.length / (lastTime || 1)).toFixed(2)}条/秒`);
    
    // ============================================
    // 第9步：缓存结果
    // ============================================
    currentDanmuCache = {
        episodeIndex: episodeIndex,
        danmuList: finalDanmaku,
        timestamp: Date.now()
    };

    return finalDanmaku;
}

// 🔥 新增：段内密度控制处理（插入在 fetchDanmaku 函数后面）
function processSegmentWithDensityControl(comments, maxPerSecond) {
    if (!comments || comments.length === 0) return [];
    
    // 按秒分组
    const bySecond = new Map();
    comments.forEach(c => {
        const time = parseFloat(c.p?.split(',')[0] || 0);
        const second = Math.floor(time);
        
        if (!bySecond.has(second)) {
            bySecond.set(second, []);
        }
        bySecond.get(second).push(c);
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

// 🔥 新增：均匀密度采样算法（插入在 processSegmentWithDensityControl 函数后面）
function uniformDensitySampling(comments, targetCount, segStart, segEnd) {
    if (!comments || comments.length <= targetCount) return comments;
    
    const segDuration = segEnd - segStart;
    const targetDensity = targetCount / segDuration; // 目标：每秒多少条
    
    // 将时间段分成更小的时间片（每片1秒）
    const timeSlots = Math.ceil(segDuration);
    const slotsMap = new Map();
    
    // 初始化时间片
    for (let i = 0; i < timeSlots; i++) {
        slotsMap.set(i, []);
    }
    
    // 将弹幕分配到各时间片
    comments.forEach(c => {
        const time = parseFloat(c.p?.split(',')[0] || 0);
        const slotIndex = Math.floor(time - segStart);
        if (slotIndex >= 0 && slotIndex < timeSlots) {
            slotsMap.get(slotIndex).push(c);
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

// 🔥 弹幕对象处理（内联优化）
function processDanmaku(comment, pool) {
    const params = comment.p ? comment.p.split(',') : [];
    let mode = parseInt(params[1] || 0);
    
    if (mode >= 4 && mode <= 5) {
        mode = mode === 4 ? 2 : 1;
    } else {
        mode = 0;
    }
    
    const text = (comment.m || '').slice(0, 100); // 限制长度
    
    // 过滤空白和重复字符
    if (!text || text.length < 2 || /^(.)\1{9,}$/.test(text)) {
        return;
    }
    
    pool.push({
        text: text,
        time: parseFloat(params[0] || 0),
        mode: mode,
        color: '#' + parseInt(params[2] || 16777215).toString(16).padStart(6, '0').toUpperCase()
    });
}
// ✅ 新增：带临时缓存的剧集获取函数
async function getAnimeEpisodesWithCache(animeId, cleanTitle) {
    try {
        const cacheKey = `anime_${animeId}`;
        const cached = tempDetailCache.get(cacheKey);

        // 检查缓存（20分钟有效）
        if (cached && Date.now() - cached.timestamp < 20 * 60 * 1000) {
            console.log('✅ 使用临时详情缓存');
            return cached.episodes;
        }

        // 获取详情
        const detailUrl = `${DANMU_CONFIG.baseUrl}/api/v2/bangumi/${animeId}`;
        const response = await fetchWithRetry(detailUrl);
        const data = await response.json();

        if (!data.bangumi || !data.bangumi.episodes) {
            return null;
        }

        // 过滤特典等
        const episodes = data.bangumi.episodes.filter(ep => {
            const epTitle = ep.episodeTitle || '';
            return !/(特典|花絮|番外|PV|预告|OP|ED|映像特典)/i.test(epTitle);
        });

        // 保存到临时缓存
        tempDetailCache.set(cacheKey, {
            timestamp: Date.now(),
            animeId,
            episodes,
            isMovie: isMovieContent(data.bangumi)
        });

        // ✅ 控制临时缓存大小（最多保留10个）
        if (tempDetailCache.size > 10) {
            const firstKey = tempDetailCache.keys().next().value;
            tempDetailCache.delete(firstKey);
            console.log('🧹 清理最旧的临时缓存');
        }

        return episodes;
    } catch (error) {
        reportError('弹幕详情', '获取动漫详情失败', { animeId, error: error.message });
        return null;
    }
}

// ✅ 改进的主弹幕获取函数 - 每次都重新搜索
async function getDanmukuForVideo(title, episodeIndex) {
    if (!DANMU_CONFIG.enabled) return [];

    try {
        // 检查缓存（只检查当前集）
        if (currentDanmuCache.episodeIndex === episodeIndex && 
            currentDanmuCache.danmuList &&
            Date.now() - currentDanmuCache.timestamp < DANMU_CONFIG.cacheExpiration.danmuCache) {
            console.log('✅ 使用缓存的弹幕（当前集）');
            return currentDanmuCache.danmuList;
        }

        const cleanTitle = sanitizeTitle(title);
        
        // ✅ 每次都重新搜索弹幕源
        console.log(`🔍 重新搜索弹幕源: ${cleanTitle}`);
        
        let animeId = await findOrSearchAnimeId(cleanTitle);
        
        // 如果搜索失败，尝试简化标题
        if (!animeId) {
            console.warn('⚠️ 首次搜索失败，尝试简化标题...');
            const simplifiedTitle = title
                .replace(/[（(].*?[）)]/g, '')
                .replace(/【.*?】/g, '')
                .replace(/\[.*?\]/g, '')
                .trim();
            
            if (simplifiedTitle !== title) {
                animeId = await findOrSearchAnimeId(simplifiedTitle);
            }
        }
        
        if (!animeId) {
            console.warn('❌ 未找到弹幕源:', title);
            return [];
        }
        
        console.log(`✅ 找到弹幕源ID: ${animeId}`);

        // ✅ 使用新的临时缓存函数
        const episodes = await getAnimeEpisodesWithCache(animeId, cleanTitle);
        
        if (!episodes?.length) {
            console.warn(`⚠️ 未找到集数信息 (animeId: ${animeId})`);
            return [];
        }

        // 处理电影
        if (isMovieContent(episodes[0])) {
            const episodeId = episodes[0].episodeId;
            const result = await fetchDanmaku(episodeId, episodeIndex);
            return result || [];
        }

        // 匹配剧集
        const matchedEpisode = findBestEpisodeMatch(episodes, episodeIndex, title);
        
        if (!matchedEpisode) {
            console.warn(`⚠️ 无法为第${episodeIndex + 1}集匹配集数`);
            return [];
        }

        const episodeId = matchedEpisode.episodeId;
        const result = await fetchDanmaku(episodeId, episodeIndex);

        if (result !== null) {
            console.log(`✅ 成功加载第${episodeIndex + 1}集弹幕 (${result.length}条)`);
            return result;
        }

        console.warn(`⚠️ episodeId ${episodeId} 返回404`);
        return [];

    } catch (error) {
        reportError('弹幕加载', '获取弹幕失败', { title, episodeIndex, error: error.message });
        return [];
    }
}

// 带超时的弹幕加载
async function getDanmukuWithTimeout(title, episodeIndex, timeout = 5000) {
    return Promise.race([
        getDanmukuForVideo(title, episodeIndex),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error('弹幕加载超时')), timeout)
        )
    ]).catch(error => {
        console.warn('⚠ 弹幕加载失败或超时:', error.message);
        return [];
    });
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
    
    // ============================================
    // 🎬 B站方案：温和的内存监控
    // ============================================
    if (!timers.autoCleanup && performance.memory) {
        timers.autoCleanup = setInterval(() => {
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
        }, 60000); // 每分钟检查一次
    }

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
        if (episodesList) {
            // 如果URL中有集数数据，优先使用它
            currentEpisodes = JSON.parse(decodeURIComponent(episodesList));

        } else {
            // 否则从localStorage获取
            currentEpisodes = JSON.parse(localStorage.getItem('currentEpisodes') || '[]');

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

    // 清除之前的超时
    if (shortcutHintTimeout) {
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
    shortcutHintTimeout = setTimeout(() => {
        hintElement.classList.remove('show');
    }, 800);
}

// 初始化播放器
function initPlayer(videoUrl) {
    // 🔥 防止短时间内重复初始化（500ms内）
    if (typeof initPlayer.lastInitTime === 'undefined') {
        initPlayer.lastInitTime = 0;
        initPlayer.isInitializing = false;
    }
    
    const now = Date.now();
    if (initPlayer.isInitializing || (now - initPlayer.lastInitTime < 500)) {
        console.warn('⚠️ 播放器正在初始化或刚初始化过，跳过');
        return;
    }
    
    initPlayer.isInitializing = true;
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

    // ===== 🔥 增强销毁：清理所有监听器 =====
	if (art) {
		try {
			// 1. 移除 ArtPlayer 事件监听
			const events = [
				'ready', 'seek', 'video:loadedmetadata', 
				'video:error', 'video:ended', 'video:playing',
				'video:pause', 'fullscreenWeb', 'fullscreen'
			];
			events.forEach(event => {
				try {
					art.off(event);
				} catch (e) {
					// 忽略已移除的事件
				}
			});
			
			// 2. 清理 video 元素
			if (art.video) {
				art.video.pause();
				art.video.src = '';
				art.video.load();
			}
			
			// 3. 销毁播放器
			art.destroy();
			console.log('✅ 播放器已完全销毁');
		} catch (e) {
			console.error('❌ 播放器销毁失败:', e);
		} finally {
			art = null;
		}
	}

    // ✅ 在这里添加移动端检测
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

    // 🎬 Netflix 风格的 HLS 配置（激进清理 + 快速切换）
	const hlsConfig = {
		debug: false,
		loader: adFilteringEnabled ? CustomHlsJsLoader : Hls.DefaultConfig.loader,
		enableWorker: true,
		lowLatencyMode: false,
		
		// 🔥 Netflix 策略：只保留必要缓冲
		backBufferLength: 90,            // 保留 90 秒后向缓冲
		maxBufferLength: 30,             // 前向缓冲 30 秒
		maxMaxBufferLength: 60,          // 最多 60 秒
		maxBufferSize: 60 * 1000 * 1000, // 60MB 限制
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
        autoplay: true,
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
        },
        plugins: [
			artplayerPluginDanmuku({
				danmuku: [],  // ✅ 改为空数组,不自动加载
				speed: 5,
				opacity: 1,
				fontSize: isMobileDevice ? (window.innerWidth < 375 ? 18 : 20) : 25, // ✅ 移动端自适应字号
				color: '#FFFFFF',
			mode: 0,
				modes: [0, 1, 2],
				margin: isMobileDevice ? [5, '80%'] : [10, '75%'], // ✅ 移动端优化弹幕区域
				antiOverlap: true,
				useWorker: true,
				synchronousPlayback: true,
				filter: (danmu) => danmu.text.length <= 50,
				lockTime: 5,
				maxLength: 100,
				theme: 'light',
			}),
		],
        customType: {
			m3u8: function (video, url) {
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
				let lastBufferCheck = 0;
				let lastCleanupTime = 0;
				let pauseStartTime = 0;

				// 监听暂停事件
				video.addEventListener('pause', () => {
					pauseStartTime = Date.now();
				});

				// 监听播放事件
				video.addEventListener('play', () => {
					pauseStartTime = 0;
				});

				hls.on(Hls.Events.FRAG_BUFFERED, () => {
					const now = Date.now();
					
					// 每 5 分钟检查一次（降低检查频率）
					if (now - lastBufferCheck < 300000) return;
					lastBufferCheck = now;
									
					if (!hls.media || hls.media.buffered.length === 0) return;
					
					const buffered = hls.media.buffered.end(hls.media.buffered.length - 1);
					const current = hls.media.currentTime;
					const bufferAhead = buffered - current;
					
					try {
						// ============================================
						// 🎯 策略 1：暂停超过 5 分钟，清理 10 分钟前的内容
						// ============================================
						if (hls.media.paused && pauseStartTime > 0) {
							const pauseDuration = now - pauseStartTime;
							
							if (pauseDuration > 5 * 60 * 1000 && bufferAhead > 600) {
								const cleanEnd = Math.max(0, current - 600);
								
								if (cleanEnd > 0 && now - lastCleanupTime > 5 * 60 * 1000) {
									// ✅ 静默清理
									hls.trigger(Hls.Events.BUFFER_FLUSHING, {
										startOffset: 0,
										endOffset: cleanEnd,
										type: 'video'
									});
									
									lastCleanupTime = now;
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
									
									lastCleanupTime = now;
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
		let seekDebounceTimer = null;
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

			if (seekDebounceTimer) {
				clearTimeout(seekDebounceTimer);
			}

			seekDebounceTimer = setTimeout(() => {
				const danmukuPlugin = art.plugins.artplayerPluginDanmuku;
				if (danmukuPlugin && typeof danmukuPlugin.seek === 'function') {
					danmukuPlugin.seek(currentTime);
				}
			}, debounceDelay);
		});

		// ===== 🔥 使用全局变量管理定时器 =====
		if (!window.globalDanmuSyncTimer) {
			window.globalDanmuSyncTimer = null;
		}

		// 先清理旧定时器
		if (window.globalDanmuSyncTimer) {
			clearInterval(window.globalDanmuSyncTimer);
			window.globalDanmuSyncTimer = null;
		}

		let lastSyncTime = 0;

		// 定期校准弹幕
		window.globalDanmuSyncTimer = setInterval(() => {
			if (!art || !art.video) {
				clearInterval(window.globalDanmuSyncTimer);
				window.globalDanmuSyncTimer = null;
				return;
			}
			
			const currentTime = art.video.currentTime;
			const timeDiff = Math.abs(currentTime - lastSyncTime);
			
			if (timeDiff > 60) {
				const danmukuPlugin = art.plugins.artplayerPluginDanmuku;
				if (danmukuPlugin && typeof danmukuPlugin.seek === 'function') {
					danmukuPlugin.seek(currentTime);
					lastSyncTime = currentTime;
				}
			}
		}, 60000);

		// 播放器销毁时清理
		art.on('destroy', () => {
			if (window.globalDanmuSyncTimer) {
				clearInterval(window.globalDanmuSyncTimer);
				window.globalDanmuSyncTimer = null;
			}
		});
		
		// ===== 【优化】自动保存播放历史（Netflix 风格）=====
		(function setupAutoSaveHistory() {
			// 1️⃣ 每 180 秒自动保存（3 分钟）
			const autoSaveInterval = setInterval(() => {
				if (art && art.video && !art.video.paused) {
					saveToHistory(); // 静默保存
				}
			}, 180000); // 3 分钟
			
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
				clearInterval(autoSaveInterval);
				document.removeEventListener('visibilitychange', visibilityHandler);
				window.removeEventListener('beforeunload', beforeUnloadHandler);
			});
		})();
		
		// ===== 【修复】防止移动端息屏 =====
		let wakeLock = null;
		let isWakeLockSupported = 'wakeLock' in navigator;
		let isRequestingLock = false;
		
		async function requestWakeLock() {
			if (!isWakeLockSupported || wakeLock !== null || isRequestingLock) {
				return;
			}
			
			isRequestingLock = true;
			
			try {
				wakeLock = await navigator.wakeLock.request('screen');
				
				wakeLock.addEventListener('release', () => {
					wakeLock = null;
					isRequestingLock = false;
				});
				
				isRequestingLock = false;
			} catch (err) {
				wakeLock = null;
				isRequestingLock = false;
			}
		}
		
		function releaseWakeLock() {
			if (wakeLock !== null) {
				wakeLock.release()
					.then(() => {
						wakeLock = null;
						isRequestingLock = false;
					})
					.catch(err => {
						wakeLock = null;
						isRequestingLock = false;
					});
			}
		}
		
		art.on('video:play', () => {
			requestWakeLock();
		});
		
		art.on('video:pause', () => {
			if (art.video && !art.video.seeking) {
				releaseWakeLock();
			}
		});
		
		art.on('video:ended', () => {
			releaseWakeLock();
		});
		
		const handleVisibilityChange = () => {
			if (document.visibilityState === 'visible') {
				if (art.video && !art.video.paused) {
					requestWakeLock();
				}
			}
		};
		
		document.addEventListener('visibilitychange', handleVisibilityChange);
		
		const cleanup = () => {
			releaseWakeLock();
			document.removeEventListener('visibilitychange', handleVisibilityChange);
		};
		
		window.addEventListener('beforeunload', cleanup);
		window.addEventListener('pagehide', cleanup);
		
		art.on('destroy', cleanup);
		
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

        // ✅ 优先尝试从临时保存的进度恢复（切换源时使用）
        let restoredPosition = savedPosition;
        const tempProgressKey = `videoProgress_temp_${currentVideoTitle}_${currentEpisodeIndex}`;
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

        if (restoredPosition > 10 && restoredPosition < art.duration - 2) {
            art.currentTime = restoredPosition;
            showPositionRestoreHint(restoredPosition);
        } else {
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
        }

        // 加载弹幕
        if (DANMU_CONFIG.enabled && art.plugins.artplayerPluginDanmuku) {
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

                    const waitForVideoReady = () => {
                        return new Promise((resolve) => {
                            const checkReady = () => {
                                if (!art.video) {
                                    setTimeout(checkReady, 50);
                                    return;
                                }
                                
                                if (art.video.readyState >= 2) {
                                    resolve();
                                } else {
                                    setTimeout(checkReady, 50);
                                }
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
    
    // 🔥 标记初始化完成
    setTimeout(() => {
        initPlayer.isInitializing = false;
        console.log('✅ 播放器初始化完成');
    }, 200);
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
    
    // ============================================
    // 🔥 优先清空播放器中的旧弹幕对象 ✅ 已添加
    // ============================================
    if (art && art.plugins && art.plugins.artplayerPluginDanmuku) {
        try {
            const danmukuPlugin = art.plugins.artplayerPluginDanmuku;
            
            console.log('🧹 清空播放器旧弹幕...');
            
            // 清空弹幕列表
            if (typeof danmukuPlugin.clear === 'function') {
                danmukuPlugin.clear();
            }
            
            // 重置配置为空
            danmukuPlugin.config({
                danmuku: [],
                synchronousPlayback: false
            });
            
            console.log('✅ 旧弹幕已清空');
        } catch (e) {
            console.error('❌ 清空弹幕失败:', e);
        }
    }
    
    // 清理弹幕缓存
    currentDanmuCache = {
        episodeIndex: -1,
        danmuList: null,
        timestamp: 0
    };

    // 保存当前播放进度（如果正在播放）
    if (art && art.video && !art.video.paused && !videoHasEnded) {
        saveCurrentProgress();
    }

    // 清除进度保存计时器
    if (progressSaveInterval) {
        clearInterval(progressSaveInterval);
        progressSaveInterval = null;
    }

    // 首先隐藏之前可能显示的错误
    document.getElementById('error').style.display = 'none';
    // 显示加载指示器
    document.getElementById('player-loading').style.display = 'flex';
    document.getElementById('player-loading').innerHTML = `
        <div class="loading-spinner"></div>
        <div>正在加载视频...</div>
    `;

    // 准备切换剧集的URL
    const url = currentEpisodes[index];

    // ✅ 清理弹幕缓存（不保存弹幕源ID）
    if (currentDanmuCache.episodeIndex === currentEpisodeIndex) {
        currentDanmuCache = {
            episodeIndex: -1,
            danmuList: null,
            timestamp: 0
        };
        console.log('✅ 已清理旧集数弹幕缓存');
    }
    
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
        initPlayer(url);  // Safari 必须重新初始化
    } else {
        art.switch = url;  // 其他浏览器使用无缝切换
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
            
            // 强制重新初始化播放器
            if (art) {
                try {
                    art.destroy();
                } catch (e) {
                    console.error('销毁播放器失败:', e);
                }
                art = null;
            }
            
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

    // 清除旧的定时器
    if (saveHistoryTimer && !forceImmediate) {
        clearTimeout(saveHistoryTimer);
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
                if (DEBUG_HISTORY || forceImmediate) {
                    console.log(`[历史记录] ✅ 更新 第${videoInfo.episodeIndex + 1}集 ${currentPosition.toFixed(0)}s`);
                }
            } else {
                history.unshift(videoInfo);
                if (DEBUG_HISTORY || forceImmediate) {
                    console.log(`[历史记录] ✅ 新增 第${videoInfo.episodeIndex + 1}集`);
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
    // 清除可能存在的旧计时器
    if (progressSaveInterval) {
        clearInterval(progressSaveInterval);
        progressSaveInterval = null;
    }
    if (timers.progressSave) {
        clearInterval(timers.progressSave);
        timers.progressSave = null;
    }

    // 每60秒保存一次播放进度
    timers.progressSave = setInterval(saveCurrentProgress, 60000);
    progressSaveInterval = timers.progressSave; // 保持兼容性
}

// 保存当前播放进度
function saveCurrentProgress() {
    // 清除旧的防抖定时器
    if (saveProgressTimer) {
        clearTimeout(saveProgressTimer);
        saveProgressTimer = null;
    }
    if (timers.saveProgress) {
        clearTimeout(timers.saveProgress);
        timers.saveProgress = null;
    }

    // 设置新的防抖定时器
    timers.saveProgress = setTimeout(() => {
        saveProgressTimer = null;
        timers.saveProgress = null;
        
        // 实际保存逻辑
        if (!art || !art.video) return;
        const currentTime = art.video.currentTime;
        const duration = art.video.duration;

        if (!duration || currentTime < 1) return;

        const progressKey = `videoProgress_${getVideoId()}`;
        const progressData = {
            position: currentTime,
            duration: duration,
            timestamp: Date.now()
        };

        try {
            localStorage.setItem(progressKey, JSON.stringify(progressData));
        } catch (e) {
            reportError('进度保存', '保存播放进度失败', { error: e.message });
        }
    }, 2000);
}
// 设置移动端长按三倍速播放功能（B站风格）
function setupLongPressSpeedControl() {
    if (!art || !art.video) return;

    const playerElement = document.getElementById('player');
    let longPressTimer = null;
    let originalPlaybackRate = 1.0;
    let isLongPress = false;
    let touchStartTime = 0;

    // 创建速度指示器（模仿B站）
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

    // 禁用移动端右键菜单
    playerElement.oncontextmenu = () => {
        if (isMobileDevice) {
            return false;
        }
        return true;
    };

    // 触摸开始
    playerElement.addEventListener('touchstart', function (e) {
        // 暂停时不触发
        if (art.video.paused) return;

        touchStartTime = Date.now();
        originalPlaybackRate = art.video.playbackRate;

        // 设置500ms延迟
        longPressTimer = setTimeout(() => {
            // 再次确认仍在播放
            if (!art.video.paused) {
                art.video.playbackRate = 3.0;
                isLongPress = true;
                showSpeedIndicator(3.0);
                
                // 轻微震动反馈（如果支持）
                if (navigator.vibrate) {
                    navigator.vibrate(50);
                }
            }
        }, 500);
    }, { passive: true });

    // 触摸移动 - 超过阈值取消长按
    let touchMoved = false;
    playerElement.addEventListener('touchmove', function (e) {
        if (longPressTimer && !isLongPress) {
            // 移动超过10px取消长按
            touchMoved = true;
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
        
        // 长按时阻止滚动
        if (isLongPress) {
            e.preventDefault();
        }
    }, { passive: false });

    // 触摸结束
    playerElement.addEventListener('touchend', function (e) {
        clearTimeout(longPressTimer);
        longPressTimer = null;

        if (isLongPress) {
            // 恢复原速
            art.video.playbackRate = originalPlaybackRate;
            isLongPress = false;
            hideSpeedIndicator();
            
            // 阻止点击事件
            e.preventDefault();
            e.stopPropagation();
        }
        
        touchMoved = false;
    });

    // 触摸取消
    playerElement.addEventListener('touchcancel', function () {
        clearTimeout(longPressTimer);
        longPressTimer = null;

        if (isLongPress) {
            art.video.playbackRate = originalPlaybackRate;
            isLongPress = false;
            hideSpeedIndicator();
        }
    });

    // 视频暂停/结束时重置
    art.video.addEventListener('pause', function () {
        if (isLongPress) {
            art.video.playbackRate = originalPlaybackRate;
            isLongPress = false;
            hideSpeedIndicator();
        }
        clearTimeout(longPressTimer);
        longPressTimer = null;
    });

    art.video.addEventListener('ended', function () {
        if (isLongPress) {
            art.video.playbackRate = originalPlaybackRate;
            isLongPress = false;
            hideSpeedIndicator();
        }
    });
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
        const firstEpisodeUrl = data.episodes[0];
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
			data: null
		};

        // ✅ 不再使用 currentDanmuAnimeId
        localStorage.removeItem(`danmuSource_${titleHash}`);

        console.log('✅ 已清理当前视频缓存（保留其他视频缓存）');
    } catch (e) {
        console.warn('清理缓存失败:', e);
    }
}

// 保存播放进度到临时存储
function saveTempPlayProgress(targetIndex, currentPlaybackTime) {
    try {
        const progressKey = `videoProgress_temp_${currentVideoTitle}_${targetIndex}`;
        localStorage.setItem(progressKey, JSON.stringify({
            position: currentPlaybackTime,
            timestamp: Date.now()
        }));
        console.log('✅ 已保存临时播放进度');
    } catch (e) {
        console.warn('保存临时进度失败:', e);
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

        if (!data.episodes || data.episodes.length === 0) {
            showToast('未找到播放资源', 'error');
            hideLoading();
            return;
        }

        // 获取当前播放的集数索引
        const currentIndex = currentEpisodeIndex;

        // 确定要播放的集数索引
        let targetIndex = 0;
        if (currentIndex < data.episodes.length) {
            // 如果当前集数在新资源中存在，则使用相同集数
            targetIndex = currentIndex;
        }

        // 获取目标集数的URL
        const targetUrl = data.episodes[targetIndex];

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
            localStorage.setItem('currentVideoTitle', data.vod_name || '未知视频');
            localStorage.setItem('currentEpisodes', JSON.stringify(data.episodes));
            localStorage.setItem('currentEpisodeIndex', targetIndex);
            localStorage.setItem('currentSourceCode', sourceKey);
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
    if (!DANMU_CONFIG.enabled) {
        showToast('弹幕功能未启用', 'error');
        return;
    }

    const modal = document.getElementById('danmuSourceModal');
    const modalContent = document.getElementById('danmuSourceList');

    // 🔥 显示当前使用的弹幕源
    let currentSourceInfo = '';
    if (currentDanmuAnimeId && currentDanmuSourceName) {
        currentSourceInfo = `<div class="mb-3 p-3 bg-blue-900 bg-opacity-30 rounded-lg">
            <div class="text-sm text-blue-300">当前弹幕源</div>
            <div class="text-white font-medium mt-1">${currentDanmuSourceName}</div>
            <div class="text-xs text-gray-400 mt-1">ID: ${currentDanmuAnimeId}</div>
        </div>`;
    }

    modalContent.innerHTML = currentSourceInfo + '<div class="text-center py-8 text-gray-400">正在搜索弹幕源...</div>';
    modal.classList.remove('hidden');

    try {
        // 提取纯标题用于搜索
        const cleanTitle = currentVideoTitle.replace(/\([^)]*\)/g, '').replace(/【[^】]*】/g, '').trim();
        const searchUrl = `${DANMU_CONFIG.baseUrl}/api/v2/search/anime?keyword=${encodeURIComponent(cleanTitle)}`;
        const searchResponse = await fetch(searchUrl);

        if (!searchResponse.ok) throw new Error('搜索失败');

        const searchData = await searchResponse.json();

        if (!searchData.animes || searchData.animes.length === 0) {
            modalContent.innerHTML = currentSourceInfo + '<div class="text-center py-8 text-gray-400">未找到匹配的弹幕源</div>';
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

            // 🔥 正确识别当前源
            if (currentDanmuAnimeId && source.animeId === currentDanmuAnimeId) {
                score += 10000; // 当前使用的最优先
            }
            if (title === currentVideoTitle) {
                score += 1000; // 完全匹配
            }
            if (title.includes(cleanTitle)) {
                score += 500;
            }
            if (cleanTitle.includes(title)) {
                score += 300;
            }
            score += calculateSimilarity(title, cleanTitle) * 200;
            score += Math.min(source.episodeCount, 50); // 集数多的加分

            source.score = score;
        });

        allSources.sort((a, b) => b.score - a.score);

        // 分离推荐和其他
        const recommended = allSources.slice(0, 5); // 前5个作为推荐
        const others = allSources.slice(5);

        let html = `
            <div class="mb-3 pb-3 border-b border-gray-700">
                <div class="text-sm font-medium text-gray-300 mb-2">推荐弹幕源</div>
                <div class="space-y-2">
        `;

        recommended.forEach(source => {
			const isActive = (currentDanmuAnimeId === source.animeId);
			const typeInfo = source.typeDescription || source.type;
    
			// 【新增】计算相似度并显示
			const similarity = calculateSimilarity(
				source.animeTitle.replace(/\([^)]*\)/g, '').trim(),
				cleanTitle
			);

			html += `
				<button 
					onclick="switchDanmuSource('${source.animeId}')"
					class="w-full text-left px-4 py-3 rounded-lg transition-colors ${
						isActive 
							? 'bg-blue-600 text-white' 
							: 'bg-gray-800 hover:bg-gray-700 text-gray-200'
					}">
					<div class="font-medium">${source.animeTitle}</div>
					<div class="text-sm opacity-75 mt-1">
						${typeInfo} · ${source.episodeCount} 集
						· 相似度: ${(similarity * 100).toFixed(0)}%
						${isActive ? ' · <span class="text-yellow-300">✓ 当前使用</span>' : ''}
					</div>
				</button>
			`;
		});

        html += '</div></div>';

        if (others.length > 0) {
            html += `
                <div class="mb-2">
                    <button 
                        onclick="toggleOtherSources()"
                        class="w-full text-left px-3 py-2 text-sm text-gray-400 hover:text-gray-300 flex items-center justify-between">
                        <span>其他可用弹幕源 (${others.length}个)</span>
                        <svg id="otherSourcesArrow" class="w-4 h-4 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
                        </svg>
                    </button>
                </div>
                <div id="otherSourcesList" class="space-y-2 hidden max-h-[40vh] overflow-y-auto">
            `;

            others.forEach(source => {
                const typeInfo = source.typeDescription || source.type;
                html += `
                    <button 
                        onclick="switchDanmuSource('${source.animeId}')"
                        class="w-full text-left px-4 py-3 rounded-lg transition-colors bg-gray-800 hover:bg-gray-700 text-gray-200">
                        <div class="font-medium">${source.animeTitle}</div>
                        <div class="text-sm opacity-75 mt-1">
                            ${typeInfo} · ${source.episodeCount} 集
                        </div>
                    </button>
                `;
            });

            html += '</div>';
        }

        modalContent.innerHTML = html;

    } catch (error) {
        console.error('加载弹幕源失败:', error);
        modalContent.innerHTML = currentSourceInfo + '<div class="text-center py-8 text-red-400">加载失败，请重试</div>';
    }
}

// 切换显示其他弹幕源
function toggleOtherSources() {
    const list = document.getElementById('otherSourcesList');
    const arrow = document.getElementById('otherSourcesArrow');
    if (list.classList.contains('hidden')) {
        list.classList.remove('hidden');
        arrow.style.transform = 'rotate(180deg)';
    } else {
        list.classList.add('hidden');
        arrow.style.transform = 'rotate(0deg)';
    }
}

// 关闭弹幕源弹窗
function closeDanmuSourceModal() {
    document.getElementById('danmuSourceModal').classList.add('hidden');
}

// 切换弹幕源
async function switchDanmuSource(animeId) {
    if (!art || !art.plugins.artplayerPluginDanmuku) {
        showToast('播放器未就绪', 'error');
        return;
    }

    // ✅ 立即关闭弹窗,让用户可以继续观看
    document.getElementById('danmuSourceModal').classList.add('hidden');

    // ✅ 显示后台加载提示(右下角小提示)
    showToast('正在切换弹幕源...', 'info');

    try {
        // 保存当前播放状态
        const currentTime = art.video ? art.video.currentTime : 0;
        const isPlaying = art.video ? !art.video.paused : false;

		// ✅ 清空当前视频相关的弹幕缓存
		currentDanmuCache = {
			episodeIndex: -1,
			danmuList: null,
			timestamp: 0
		};

        // 🔥 更新当前弹幕源信息
        currentDanmuAnimeId = animeId;
        currentDanmuSourceName = ''; // 稍后从 episodes 更新

        // ✅ 重新获取当前集弹幕
        // 注意：由于每次都重新搜索，这里可能不会使用指定的animeId
        // 如果需要强制使用指定ID，需要特殊处理
        
        // 🔥 保存到 localStorage 和全局变量
        const cleanTitle = sanitizeTitle(currentVideoTitle);
        const titleHash = simpleHash(cleanTitle);
        
        // 从 episodes 获取完整信息更新 sourceName
        const episodes = await getAnimeEpisodesWithCache(animeId, cleanTitle);
        if (episodes && episodes.length > 0) {
            // 尝试从详情中获取标题
            try {
                const detailUrl = `${DANMU_CONFIG.baseUrl}/api/v2/bangumi/${animeId}`;
                const detailResponse = await fetch(detailUrl);
                if (detailResponse.ok) {
                    const detailData = await detailResponse.json();
                    if (detailData.bangumi && detailData.bangumi.animeTitle) {
                        currentDanmuSourceName = detailData.bangumi.animeTitle;
                    }
                }
            } catch (e) {
                console.warn('获取弹幕源名称失败:', e);
            }
        }
        
        localStorage.setItem(`danmuSource_${titleHash}`, JSON.stringify({
            animeId: animeId,
            sourceName: currentDanmuSourceName || '未知源',
            title: cleanTitle,
            timestamp: Date.now()
        }));
        
        const newDanmuku = await getDanmukuForVideo(
            currentVideoTitle, 
            currentEpisodeIndex  // ✅ 只传2个参数
        );

        if (!newDanmuku || newDanmuku.length === 0) {
            showToast('该弹幕源暂无弹幕', 'warning');
            return;
        }

        // ✅ 完全重置弹幕插件
        const danmukuPlugin = art.plugins.artplayerPluginDanmuku;

        // 先清空现有弹幕
        if (typeof danmukuPlugin.clear === 'function') {
            danmukuPlugin.clear();
        }

        // 重新配置
        danmukuPlugin.config({
            danmuku: newDanmuku,
            synchronousPlayback: true
        });

        danmukuPlugin.load();

        // ✅ 恢复播放位置(不暂停视频)
        if (art.video && currentTime > 0) {
            art.currentTime = currentTime;
            if (typeof danmukuPlugin.seek === 'function') {
                danmukuPlugin.seek(currentTime);
            }
        }

		// ✅ 确保视频继续播放
        if (isPlaying && art.video.paused) {
            setTimeout(() => art.play(), 100);
        }

    } catch (error) {
        console.error('切换弹幕源失败:', error);
        showToast('切换弹幕源失败', 'error');
    }
}

console.log('✅ 播放器修复补丁已加载');

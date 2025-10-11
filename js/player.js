const selectedAPIs = JSON.parse(localStorage.getItem('selectedAPIs') || '[]');
const customAPIs = JSON.parse(localStorage.getItem('customAPIs') || '[]'); // 存储自定义API列表

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

let saveProgressTimer = null; // 用于防抖保存进度

// 弹幕配置
const DANMU_CONFIG = {
    baseUrl: 'https://danmu.manxue.eu.org/87654321', // 你的弹幕服务地址
    enabled: true, // 是否启用弹幕
};

// 弹幕缓存
const danmuCache = {};
let currentDanmuAnimeId = null; // 当前选中的动漫ID
let availableDanmuSources = []; // 可用的弹幕源列表

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

// ===== 缓存工具函数 =====

// 加载缓存（从 localStorage）
function loadCache() {
    try {
        const data = localStorage.getItem('animeDetailCache');
        return data ? JSON.parse(data) : {};
    } catch (e) {
        console.warn("缓存读取失败:", e);
        return {};
    }
}

// 保存缓存（写入 localStorage）
function saveCache(cache) {
    try {
        localStorage.setItem('animeDetailCache', JSON.stringify(cache));
    } catch (e) {
        console.warn("缓存保存失败:", e);
    }
}

// 初始化缓存
let animeDetailCache = loadCache();
const CACHE_EXPIRE_TIME = 24 * 60 * 60 * 1000; // 1 天

// ===== 获取弹幕数据 =====

// ✅ 新增：检测内容类型（动画 or 综艺）
function detectContentType(title, episodes) {
    // 综艺特征检测
    const varietyKeywords = ['综艺', '快乐大本营', '天天向上', '跑男', '极限挑战', 
                             '娱乐', '脱口秀', '访谈', '真人秀', '晚会', '演唱会'];
    const hasVarietyKeyword = varietyKeywords.some(kw => title.includes(kw));
    
    // 检查期数格式（日期格式）
    const hasDateFormat = episodes.some(ep => {
        const epTitle = ep.episodeTitle || '';
        return /\d{8}期/.test(epTitle) || /\d{4}[-年]\d{2}[-月]\d{2}[日期]/.test(epTitle);
    });
    
    // 检查是否有"期"字
    const hasPeriodChar = episodes.some(ep => 
        (ep.episodeTitle || '').includes('期')
    );
    
    if (hasDateFormat || (hasPeriodChar && hasVarietyKeyword)) {
        return 'variety'; // 综艺
    }
    return 'anime'; // 动画
}

// ✅ 新增：提取期数/集数信息（增强版）
function extractEpisodeInfo(episodeTitle, contentType) {
    if (!episodeTitle) return null;
    
    const info = {
        type: contentType,
        number: null,      // 数字编号
        date: null,        // 日期（综艺用）
        title: episodeTitle
    };
    
    if (contentType === 'variety') {
        // 综艺：优先提取日期
        // 格式1: 20250101期
        let match = episodeTitle.match(/(\d{4})(\d{2})(\d{2})期/);
        if (match) {
            info.date = `${match[1]}-${match[2]}-${match[3]}`;
            info.number = parseInt(match[1] + match[2] + match[3]);
            return info;
        }
        
        // 格式2: 2025年01月01日
        match = episodeTitle.match(/(\d{4})[-年](\d{2})[-月](\d{2})[日期]/);
        if (match) {
            info.date = `${match[1]}-${match[2]}-${match[3]}`;
            info.number = parseInt(match[1] + match[2] + match[3]);
            return info;
        }
        
        // 格式3: 第123期（部分综艺）
        match = episodeTitle.match(/第\s*(\d+)\s*期/);
        if (match) {
            info.number = parseInt(match[1]);
            return info;
        }
    } else {
        // 动画：提取集数（保持原逻辑）
        const patterns = [
            /第\s*(\d+)\s*[集话話]/,
            /[Ee][Pp]\.?\s*(\d+)/,
            /#第(\d+)话#/,
            /\[第(\d+)[集话話]\]/,
            /\(第(\d+)[集话話]\)/,
            /【第(\d+)[集话話]】/,
            /^\s*(\d+)\s*$/,
            /\b0*(\d+)\b/
        ];
        
        for (const pattern of patterns) {
            const match = episodeTitle.match(pattern);
            if (match) {
                info.number = parseInt(match[1]);
                if (info.number > 0 && info.number <= 9999) {
                    return info;
                }
            }
        }
    }
    
    return info;
}

async function getDanmukuForVideo(title, episodeIndex, forceAnimeId = null) {
    if (!DANMU_CONFIG.enabled) return [];

    const cleanTitle = title.replace(/\([^)]*\)/g, '').replace(/【[^】]*】/g, '').trim();
    let animeId = forceAnimeId || currentDanmuAnimeId;
    
    // ✅ 添加：初始化 contentType
    let contentType = 'anime'; // 默认为动画
    
    if (!animeId) {
        try {
            const titleHash = simpleHash(cleanTitle);
            const savedData = localStorage.getItem(`danmuSource_${titleHash}`);
            if (savedData) {
                const parsed = JSON.parse(savedData);
                // 验证标题是否匹配，防止hash冲突
                if (parsed.title === cleanTitle || calculateSimilarity(parsed.title, cleanTitle) > 0.8) {
                    animeId = parsed.animeId;
                    currentDanmuAnimeId = animeId;
                    console.log('✅ 从 localStorage 恢复弹幕源ID:', animeId);
                } else {
                    console.warn('⚠️ 标题不匹配，忽略缓存的弹幕源');
                }
            }
        } catch (e) {
            console.warn('恢复弹幕源ID失败:', e);
        }
    }

    // ⚡ 缓存键：使用更精确的标识，避免冲突
	// 格式：animeId_标题hash_集数 或 标题hash_集数
	const titleHash = simpleHash(cleanTitle); // 使用标题hash避免长键名
	let detailCacheKey = animeId ? `anime_${animeId}` : `title_${titleHash}`;
	const danmuCacheKey = animeId ? `danmu_${animeId}_ep${episodeIndex}` : `danmu_${titleHash}_ep${episodeIndex}`;

    // 检查弹幕缓存
    if (danmuCache[danmuCacheKey]) {
        console.log('✅ 使用弹幕缓存');
        return danmuCache[danmuCacheKey];
    }

    try {
        let episodes = null;
        let isMovie = false;
		// ✅ 检查详情缓存
		const cached = animeDetailCache[detailCacheKey];
        if (cached && Date.now() - cached.timestamp < CACHE_EXPIRE_TIME) {
            console.log('✅ 使用详情缓存,跳过搜索和详情请求');
            animeId = cached.animeId;
            episodes = cached.episodes;
            isMovie = cached.isMovie;
             contentType = cached.contentType || detectContentType(cleanTitle, episodes); 
        } else {
            console.log(cached ? '⏰ 缓存过期，执行完整请求' : 'ℹ️ 首次请求，执行完整请求');

            // 1. 搜索动漫
            const searchUrl = `${DANMU_CONFIG.baseUrl}/api/v2/search/anime?keyword=${encodeURIComponent(cleanTitle)}`;
            const searchResponse = await fetch(searchUrl);
            if (!searchResponse.ok) {
                console.warn('弹幕搜索失败:', searchResponse.status);
                return [];
            }

            const searchData = await searchResponse.json();
            availableDanmuSources = searchData.animes?.map(anime => ({
                animeId: anime.animeId,
                animeTitle: anime.animeTitle,
                type: anime.type,
                episodeCount: anime.episodeCount
            })) || [];

            if (!searchData.animes || searchData.animes.length === 0) {
                console.warn('未找到匹配的动漫:', title);
                return [];
            }

            if (!animeId) {
                const bestMatch = findBestAnimeMatch(searchData.animes, cleanTitle);
                if (!bestMatch) {
                    console.warn('无法找到最佳匹配:', title);
                    return [];
                }
                animeId = bestMatch.animeId;
                currentDanmuAnimeId = animeId;
            }

            // ✅ 判断是否是电影
            const animeInfo = searchData.animes.find(a => a.animeId === animeId);
            isMovie = isMovieContent(animeInfo);

            // 2. 获取动漫详情
            const detailUrl = `${DANMU_CONFIG.baseUrl}/api/v2/bangumi/${animeId}`;
            const detailResponse = await fetch(detailUrl);
            if (!detailResponse.ok) {
                console.warn('获取动漫详情失败');
                return [];
            }

            const detailData = await detailResponse.json();
            if (!detailData.bangumi || !detailData.bangumi.episodes) {
                console.warn('未找到剧集信息');
                return [];
            }

            episodes = detailData.bangumi.episodes.filter(ep => {
				const epTitle = ep.episodeTitle || '';
				return !/(特典|花絮|番外|PV|预告|OP|ED|映像特典)/i.test(epTitle);
			});

			// ✅ 新增：检测内容类型
			contentType = detectContentType(cleanTitle, episodes);
            console.log(`📺 内容类型: ${contentType === 'variety' ? '综艺' : '动画'}`);

            // ✅ 存入缓存（同时存 animeId 和 title 两个 key）
            const cacheEntry = {
                timestamp: Date.now(),
                animeId,
                episodes,
                isMovie,
                contentType
            };
            animeDetailCache[`anime_${animeId}`] = cacheEntry;
            animeDetailCache[`title_${cleanTitle}`] = cacheEntry;

            // 写入 localStorage
            saveCache(animeDetailCache);

            console.log(`✅ 已缓存详情: anime_${animeId} & title_${cleanTitle}`);
        }

        // 电影处理
        if (isMovie) {
            if (episodes.length === 0) {
                console.warn('电影没有找到弹幕源');
                return [];
            }
            const episodeId = episodes[0].episodeId;
            return await fetchDanmaku(episodeId, danmuCacheKey);
        }

        // 剧集处理
        const matchedEpisode = findBestEpisodeMatch(episodes, episodeIndex, title, contentType); 
        if (!matchedEpisode) {
            console.error(`✗ [弹幕] 无法为第${episodeIndex + 1}${contentType === 'variety' ? '期' : '集'}加载弹幕`); // ✅ 修改这行
            return [];
        }

        const episodeId = matchedEpisode.episodeId;
        return await fetchDanmaku(episodeId, danmuCacheKey);

    } catch (error) {
        console.error('获取弹幕失败:', error);
        return [];
    }
}

// ✅ 新增：智能匹配最佳动漫结果
function findBestAnimeMatch(animes, targetTitle) {
    if (!animes || animes.length === 0) return null;
    
    // 计算相似度得分
    const scored = animes.map(anime => {
        const animeTitle = (anime.animeTitle || '').replace(/\([^)]*\)/g, '').replace(/【[^】]*】/g, '').trim();
        
        let score = 0;
        
        // 完全匹配得最高分
        if (animeTitle === targetTitle) {
            score += 1000;
        }
        
        // 包含目标标题
        if (animeTitle.includes(targetTitle)) {
            score += 500;
        }
        
        // 目标标题包含动漫标题
        if (targetTitle.includes(animeTitle)) {
            score += 300;
        }
        
        // 字符串相似度（简单实现）
        const similarity = calculateSimilarity(animeTitle, targetTitle);
        score += similarity * 200;
        
        // 优先选择集数较多的（更可能是正片）
        if (anime.episodeCount) {
            score += Math.min(anime.episodeCount, 50);
        }
        
        return { anime, score };
    });
    
    // 按得分排序，取最高分
    scored.sort((a, b) => b.score - a.score);
    
    console.log('弹幕源匹配得分:', scored.map(s => ({
        title: s.anime.animeTitle,
        score: s.score
    })));
    
    return scored[0].anime;
}

// ✅ 修改：智能匹配集数（支持动画+综艺）
function findBestEpisodeMatch(episodes, targetIndex, showTitle, contentType) {
    if (!episodes || episodes.length === 0) return null;
    
    // 提取所有集数信息
    const episodesWithInfo = episodes.map((ep, idx) => {
        const info = extractEpisodeInfo(ep.episodeTitle || '', contentType);
        return {
            episode: ep,
            info: info,
            index: idx
        };
    });
    
    const targetNumber = targetIndex + 1;
    
    if (contentType === 'variety') {
        // 综艺匹配策略：优先使用索引
        
        // 策略1: 索引匹配（最可靠）
        if (targetIndex >= 0 && targetIndex < episodes.length) {
            const matchedEp = episodesWithInfo[targetIndex];
            console.log(`✓ [弹幕-综艺] 索引匹配第${targetNumber}期: ${matchedEp.episode.episodeTitle}`);
            return matchedEp.episode;
        }
        
        // 策略2: 如果有期数编号，尝试匹配
        const targetEp = episodesWithInfo.find(ep => 
            ep.info?.number && Math.abs(ep.info.number - targetNumber) <= 2
        );
        if (targetEp) {
            console.log(`✓ [弹幕-综艺] 期数匹配第${targetNumber}期`);
            return targetEp.episode;
        }
        
    } else {
        // 动画匹配策略（保持原逻辑）
        
        // 策略1: 精确匹配集数编号
        const exactMatch = episodesWithInfo.find(ep => ep.info?.number === targetNumber);
        if (exactMatch) {
            console.log(`✓ [弹幕-动画] 精确匹配第${targetNumber}集: ${exactMatch.episode.episodeTitle}`);
            return exactMatch.episode;
        }
        
        // 策略2: 索引匹配
        if (targetIndex >= 0 && targetIndex < episodes.length) {
            const indexMatch = episodesWithInfo[targetIndex];
            console.log(`✓ [弹幕-动画] 索引匹配第${targetNumber}集: ${indexMatch.episode.episodeTitle}`);
            return indexMatch.episode;
        }
        
        // 策略3: 模糊匹配（集数相近）
        const nearMatch = episodesWithInfo.find(ep => 
            ep.info?.number && Math.abs(ep.info.number - targetNumber) <= 2 && ep.info.number > 0
        );
        if (nearMatch) {
            console.warn(`⚠ [弹幕-动画] 模糊匹配第${targetNumber}集 -> 使用第${nearMatch.info.number}集: ${nearMatch.episode.episodeTitle}`);
            return nearMatch.episode;
        }
    }
    
    // 兜底：使用第一集
    if (episodes.length > 0) {
        console.warn(`⚠ [弹幕] 无法匹配第${targetNumber}${contentType === 'variety' ? '期' : '集'}，使用第一集弹幕`);
        return episodes[0];
    }
    
    return null;
}

// ✅ 新增：计算字符串相似度（简化版 Levenshtein）
function calculateSimilarity(str1, str2) {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 1.0;
    
    const editDistance = levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
}

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

// ✅ 新增：获取弹幕的独立函数
async function fetchDanmaku(episodeId, cacheKey) {
    const commentUrl = `${DANMU_CONFIG.baseUrl}/api/v2/comment/${episodeId}?withRelated=true&chConvert=1`;
    const commentResponse = await fetch(commentUrl);
    
    if (!commentResponse.ok) {
        console.warn('获取弹幕失败');
        return [];
    }
    
    const commentData = await commentResponse.json();
    
    const danmakuList = [];
    if (commentData.comments && Array.isArray(commentData.comments)) {
        commentData.comments.forEach(comment => {
            const params = comment.p ? comment.p.split(',') : [];
            const colorValue = parseInt(params[2] || 16777215);
            
            // ✅ 从 params[1] 获取弹幕模式
            let mode = parseInt(params[1] || 0);
            
            // 弹幕模式映射：
            // 0-2: 滚动弹幕 -> ArtPlayer mode 0
            // 4: 底部弹幕 -> ArtPlayer mode 2  
            // 5: 顶部弹幕 -> ArtPlayer mode 1
            if (mode >= 4 && mode <= 5) {
                mode = mode === 4 ? 2 : 1;  // 4=底部, 5=顶部
            } else {
                mode = 0;  // 其他都是滚动
            }
            
            danmakuList.push({
                text: comment.m || '',
                time: parseFloat(params[0] || 0),
                mode: mode,  // ✅ 使用实际的弹幕模式
                color: '#' + colorValue.toString(16).padStart(6, '0').toUpperCase(),
            });
        });
    }
    
    danmuCache[cacheKey] = danmakuList;
    return danmakuList;
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

    // 从localStorage获取数据
    currentVideoTitle = title || localStorage.getItem('currentVideoTitle') || '未知视频';
    currentEpisodeIndex = index;

    // 设置自动连播开关状态
    autoplayEnabled = localStorage.getItem('autoplayEnabled') !== 'false'; // 默认为true
    document.getElementById('autoplayToggle').checked = autoplayEnabled;

    // 获取广告过滤设置
    adFilteringEnabled = localStorage.getItem(PLAYER_CONFIG.adFilteringStorage) !== 'false'; // 默认为true

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

    // 添加页面离开事件监听，保存播放位置
    window.addEventListener('beforeunload', saveCurrentProgress);

    // 新增：页面隐藏（切后台/切标签）时也保存
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') {
            saveCurrentProgress();
        }
    });

    // 视频暂停时也保存
    const waitForVideo = setInterval(() => {
        if (art && art.video) {
            art.video.addEventListener('pause', saveCurrentProgress);

            clearInterval(waitForVideo);
        }
    }, 200);
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
        if (currentEpisodeIndex > 0) {
            playPreviousEpisode();
            showShortcutHint('上一集', 'left');
            e.preventDefault();
        }
    }

    // Alt + 右箭头 = 下一集
    if (e.altKey && e.key === 'ArrowRight') {
        if (currentEpisodeIndex < currentEpisodes.length - 1) {
            playNextEpisode();
            showShortcutHint('下一集', 'right');
            e.preventDefault();
        }
    }

    // 左箭头 = 快退
    if (!e.altKey && e.key === 'ArrowLeft') {
        if (art && art.currentTime > 5) {
            art.currentTime -= 5;
            showShortcutHint('快退', 'left');
            e.preventDefault();
        }
    }

    // 右箭头 = 快进
    if (!e.altKey && e.key === 'ArrowRight') {
        if (art && art.currentTime < art.duration - 5) {
            art.currentTime += 5;
            showShortcutHint('快进', 'right');
            e.preventDefault();
        }
    }

    // 上箭头 = 音量+
    if (e.key === 'ArrowUp') {
        if (art && art.volume < 1) {
            art.volume += 0.1;
            showShortcutHint('音量+', 'up');
            e.preventDefault();
        }
    }

    // 下箭头 = 音量-
    if (e.key === 'ArrowDown') {
        if (art && art.volume > 0) {
            art.volume -= 0.1;
            showShortcutHint('音量-', 'down');
            e.preventDefault();
        }
    }

    // 空格 = 播放/暂停
    if (e.key === ' ') {
        if (art) {
            art.toggle();
            showShortcutHint('播放/暂停', 'play');
            e.preventDefault();
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
    const textElement = document.getElementById('shortcutText');
    const iconElement = document.getElementById('shortcutIcon');

    // 清除之前的超时
    if (shortcutHintTimeout) {
        clearTimeout(shortcutHintTimeout);
    }

    // 设置文本和图标方向
    textElement.textContent = text;

    if (direction === 'left') {
        iconElement.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path>';
    } else if (direction === 'right') {
        iconElement.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>';
    }  else if (direction === 'up') {
        iconElement.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"></path>';
    } else if (direction === 'down') {
        iconElement.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>';
    } else if (direction === 'fullscreen') {
        iconElement.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5"></path>';
    } else if (direction === 'play') {
        iconElement.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3l14 9-14 9V3z"></path>';
    }

    // 显示提示
    hintElement.classList.add('show');

    // 两秒后隐藏
    shortcutHintTimeout = setTimeout(() => {
        hintElement.classList.remove('show');
    }, 2000);
}

// 初始化播放器
function initPlayer(videoUrl) {
	
	// ✅ 缓存清理：只保留最近30天的弹幕缓存
    function cleanOldDanmuCache() {
        const MAX_CACHE_AGE = 30 * 24 * 60 * 60 * 1000; // 30天
        const MAX_CACHE_SIZE = 100; // 最多保留100个弹幕缓存
        const now = Date.now();
        
        try {
            // 清理内存缓存（只保留当前视频相关）
            const currentTitleHash = simpleHash(currentVideoTitle.replace(/\([^)]*\)/g, '').replace(/【[^】]*】/g, '').trim());
            Object.keys(danmuCache).forEach(key => {
                if (!key.includes(currentTitleHash) && !key.includes(String(currentDanmuAnimeId))) {
                    delete danmuCache[key];
                }
            });
            
            // 清理 localStorage 中的详情缓存
            const cacheKeys = Object.keys(animeDetailCache);
            const validCaches = [];
            
            cacheKeys.forEach(key => {
                const cache = animeDetailCache[key];
                if (cache && cache.timestamp && (now - cache.timestamp < MAX_CACHE_AGE)) {
                    validCaches.push({ key, timestamp: cache.timestamp });
                } else {
                    delete animeDetailCache[key];
                }
            });
            
            // 如果缓存数量超过限制，删除最旧的
            if (validCaches.length > MAX_CACHE_SIZE) {
                validCaches.sort((a, b) => a.timestamp - b.timestamp);
                const toDelete = validCaches.slice(0, validCaches.length - MAX_CACHE_SIZE);
                toDelete.forEach(item => delete animeDetailCache[item.key]);
            }
            
            saveCache(animeDetailCache);
            
            // 清理 localStorage 中的弹幕源ID（保留最近使用的50个）
            const danmuSourceKeys = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith('danmuSource_')) {
                    danmuSourceKeys.push(key);
                }
            }
            
            if (danmuSourceKeys.length > 50) {
                // 简单策略：删除多余的（实际应该按访问时间，但这里简化处理）
                danmuSourceKeys.slice(50).forEach(key => localStorage.removeItem(key));
            }
            
            console.log('✅ 缓存清理完成');
        } catch (e) {
            console.warn('缓存清理失败:', e);
        }
    }

    // 在页面加载时执行一次清理
    if (!window.danmuCacheCleanedThisSession) {
        cleanOldDanmuCache();
        window.danmuCacheCleanedThisSession = true;
    }
	
    if (!videoUrl) {
        return
    }

    // 销毁旧实例
    if (art) {
        art.destroy();
        art = null;
    }
    // ✅ 尝试恢复用户上次选择的弹幕源
	if (!currentDanmuAnimeId) {
		try {
			const cleanTitle = currentVideoTitle.replace(/\([^)]*\)/g, '').replace(/【[^】]*】/g, '').trim();
			const titleHash = simpleHash(cleanTitle);
			const savedData = localStorage.getItem(`danmuSource_${titleHash}`);
			if (savedData) {
				const parsed = JSON.parse(savedData);
				if (parsed.title === cleanTitle || calculateSimilarity(parsed.title, cleanTitle) > 0.8) {
					currentDanmuAnimeId = parsed.animeId;
					console.log('✅ 已恢复上次使用的弹幕源ID:', parsed.animeId);
				}
			}
		} catch (e) {
			console.warn('恢复弹幕源ID失败:', e);
		}
	}
    
    // ✅ 在这里添加移动端检测
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

    // 配置HLS.js选项
    const hlsConfig = {
        debug: false,
        loader: adFilteringEnabled ? CustomHlsJsLoader : Hls.DefaultConfig.loader,
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 90,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        maxBufferSize: 30 * 1000 * 1000,
        maxBufferHole: 0.5,
        fragLoadingMaxRetry: 6,
        fragLoadingMaxRetryTimeout: 64000,
        fragLoadingRetryDelay: 1000,
        manifestLoadingMaxRetry: 3,
        manifestLoadingRetryDelay: 1000,
        levelLoadingMaxRetry: 4,
        levelLoadingRetryDelay: 1000,
        startLevel: -1,
        abrEwmaDefaultEstimate: 500000,
        abrBandWidthFactor: 0.95,
        abrBandWidthUpFactor: 0.7,
        abrMaxWithRealBitrate: true,
        stretchShortVideoTrack: true,
        appendErrorMaxRetry: 5,  // 增加尝试次数
        liveSyncDurationCount: 3,
        liveDurationInfinity: false
    };

    // Create new ArtPlayer instance
    art = new Artplayer({
        container: '#player',
        url: videoUrl,
        type: 'm3u8',
        title: videoTitle,
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
        fullscreenWeb: true,
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
				fontSize: isMobile ? 20 : 25,
				color: '#FFFFFF',
			mode: 0,
				modes: [0, 1, 2],
				margin: [10, '75%'],
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
                // 清理之前的HLS实例
                if (currentHls && currentHls.destroy) {
                    try {
                        currentHls.destroy();
                    } catch (e) {
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
        } else {
            document.removeEventListener('mouseout', handleMouseOut);
            // 退出全屏时清理计时器
            clearTimeout(hideTimer);
        }

        if (!isWeb) {
            if (window.screen.orientation && window.screen.orientation.lock) {
                window.screen.orientation.lock('landscape')
                    .then(() => {
                    })
                    .catch((error) => {
                    });
            }
        }
    }

    art.on('ready', () => {
    hideControls();
    
    // 优化弹幕 seek 处理
    let seekDebounceTimer = null;
    let lastSeekTime = 0;
    
    art.on('seek', (currentTime) => {
        lastSeekTime = currentTime;
        
        if (seekDebounceTimer) {
            clearTimeout(seekDebounceTimer);
        }
        
        // 延迟同步弹幕，避免拖拽时频繁触发
        seekDebounceTimer = setTimeout(() => {
            if (art.plugins.artplayerPluginDanmuku) {
                // 只调用 seek，不要 reset
                if (typeof art.plugins.artplayerPluginDanmuku.seek === 'function') {
                    art.plugins.artplayerPluginDanmuku.seek(lastSeekTime);
                }
            }
        }, 300); // 增加到 300ms
    });
});

    // 全屏 Web 模式处理
    art.on('fullscreenWeb', function (isFullScreen) {
        handleFullScreen(isFullScreen, true);
    });

    // 全屏模式处理
    art.on('fullscreen', function (isFullScreen) {
        handleFullScreen(isFullScreen, false);
    });

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
                    showPositionRestoreHint(progress.position);
                }
            }
        } catch (e) {
            console.error('恢复播放进度失败:', e);
        }
    }

    // ✅ 自动加载弹幕
    if (DANMU_CONFIG.enabled && art.plugins.artplayerPluginDanmuku) {
        setTimeout(async () => {
            try {
                const danmuku = await getDanmukuForVideo(
                    currentVideoTitle, 
                    currentEpisodeIndex,
                    currentDanmuAnimeId
                );
                
                if (danmuku && danmuku.length > 0) {
                    art.plugins.artplayerPluginDanmuku.config({
                        danmuku: danmuku,
                        synchronousPlayback: true
                    });
                    art.plugins.artplayerPluginDanmuku.load();
                    
                    if (restoredPosition > 0) {
                        setTimeout(() => {
                            if (typeof art.plugins.artplayerPluginDanmuku.seek === 'function') {
                                art.plugins.artplayerPluginDanmuku.seek(restoredPosition);
                            }
                        }, 500);
                    }
                    
                    console.log(`✅ 已加载第${currentEpisodeIndex + 1}集弹幕: ${danmuku.length}条`);
                } else {
                    console.warn('⚠ 未找到弹幕，继续播放视频');
                }
            } catch (e) {
                console.error('❌ 弹幕加载失败:', e);
            }
        }, 300);
    }

    startProgressSaveInterval();
})

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

    // 添加双击全屏支持
    art.on('video:playing', () => {
        // 绑定双击事件到视频容器
        if (art.video) {
            art.video.addEventListener('dblclick', () => {
                art.fullscreen = !art.fullscreen;
                art.play();
            });
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

    // 获取 sourceCode
    const urlParams2 = new URLSearchParams(window.location.search);
    const sourceCode = urlParams2.get('source_code');

    // 准备切换剧集的URL
    const url = currentEpisodes[index];

    // 更新当前剧集索引
    currentEpisodeIndex = index;
    currentVideoUrl = url;
    videoHasEnded = false; // 重置视频结束标志

    clearVideoProgress();

    // 更新URL参数（不刷新页面）
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.set('index', index);
    currentUrl.searchParams.set('url', url);
    currentUrl.searchParams.delete('position');
    window.history.replaceState({}, '', currentUrl.toString());

    if (isWebkit) {
        initPlayer(url);
    } else {
        art.switch = url;
    }

    // 更新UI
    updateEpisodeInfo();
    updateButtonStates();
    renderEpisodes();
    
    // 重置用户点击位置记录
    userClickedPosition = null;

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

// 在播放器初始化后添加视频到历史记录
function saveToHistory() {
    console.log('[历史记录] 开始保存历史记录...');
    
    if (!currentEpisodes || currentEpisodes.length === 0) {
        console.warn('[历史记录] ❌ 保存失败：没有集数信息');
        return false;
    }
    
    if (!currentVideoUrl) {
        console.warn('[历史记录] ❌ 保存失败：没有视频URL');
        return false;
    }

    if (typeof(Storage) === "undefined") {
        console.error('[历史记录] ❌ 浏览器不支持 localStorage');
        return false;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const sourceName = urlParams.get('source') || '';
    const sourceCode = urlParams.get('source') || '';
    const id_from_params = urlParams.get('id');

    let currentPosition = 0;
    let videoDuration = 0;

    if (art && art.video) {
        currentPosition = art.video.currentTime;
        videoDuration = art.video.duration;
    }

    const videoInfo = {
        title: currentVideoTitle,
        directVideoUrl: currentVideoUrl,
        url: `player.html?url=${encodeURIComponent(currentVideoUrl)}&title=${encodeURIComponent(currentVideoTitle)}&source=${encodeURIComponent(sourceName)}&source_code=${encodeURIComponent(sourceCode)}&id=${encodeURIComponent(id_from_params || '')}&index=${currentEpisodeIndex}&position=${Math.floor(currentPosition || 0)}`,
        episodeIndex: currentEpisodeIndex,
        sourceName: sourceName,
        vod_id: id_from_params || '',
        sourceCode: sourceCode,
        timestamp: Date.now(),
        playbackPosition: currentPosition,
        duration: videoDuration,
        episodes: currentEpisodes && currentEpisodes.length > 0 ? [...currentEpisodes] : []
    };
    
    try {
        const history = JSON.parse(localStorage.getItem('viewingHistory') || '[]');

        // ✅ 修改匹配逻辑：只根据标题匹配，忽略源
        const existingIndex = history.findIndex(item => 
            item.title === videoInfo.title
        );

        if (existingIndex !== -1) {
            const existingItem = history[existingIndex];
            existingItem.episodeIndex = videoInfo.episodeIndex;
            existingItem.timestamp = videoInfo.timestamp;
            existingItem.sourceName = videoInfo.sourceName;
            existingItem.sourceCode = videoInfo.sourceCode;
            existingItem.vod_id = videoInfo.vod_id;
            existingItem.directVideoUrl = videoInfo.directVideoUrl;
            existingItem.url = videoInfo.url;
            existingItem.playbackPosition = videoInfo.playbackPosition > 10 ? videoInfo.playbackPosition : (existingItem.playbackPosition || 0);
            existingItem.duration = videoInfo.duration || existingItem.duration;
            
            if (videoInfo.episodes && videoInfo.episodes.length > 0) {
                existingItem.episodes = [...videoInfo.episodes];
            }
            
            const updatedItem = history.splice(existingIndex, 1)[0];
            history.unshift(updatedItem);
            console.log('[历史记录] ✅ 更新现有记录:', videoInfo.title, '第', videoInfo.episodeIndex + 1, '集', `[源: ${sourceName}]`);
        } else {
            history.unshift(videoInfo);
            console.log('[历史记录] ✅ 添加新记录:', videoInfo.title, '第', videoInfo.episodeIndex + 1, '集');
        }

        if (history.length > 50) history.splice(50);

        localStorage.setItem('viewingHistory', JSON.stringify(history));
        console.log('[历史记录] ✅ 保存成功，共', history.length, '条记录');
        return true;
        
    } catch (e) {
        console.error('[历史记录] ❌ 保存失败:', e);
        return false;
    }
}

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
    }

    // 每60秒保存一次播放进度（改为60秒，减少频率）
    progressSaveInterval = setInterval(saveCurrentProgress, 60000);
}

// 保存当前播放进度
function saveCurrentProgress() {
    // 清除之前的定时器，实现防抖
    clearTimeout(saveProgressTimer);
    
    // 延迟 500ms 执行，避免频繁操作阻塞 UI
    saveProgressTimer = setTimeout(() => {
        if (!art || !art.video) return;
        const currentTime = art.video.currentTime;
        const duration = art.video.duration;
        if (!duration || currentTime < 1) return;

        // 只保存播放进度，不更新 viewingHistory
        const progressKey = `videoProgress_${getVideoId()}`;
        const progressData = {
            position: currentTime,
            duration: duration,
            timestamp: Date.now()
        };
        
        try {
            localStorage.setItem(progressKey, JSON.stringify(progressData));
        } catch (e) {
            console.error('保存进度失败:', e);
        }
    }, 500);
}

// 设置移动端长按三倍速播放功能
function setupLongPressSpeedControl() {
    if (!art || !art.video) return;

    const playerElement = document.getElementById('player');
    let longPressTimer = null;
    let originalPlaybackRate = 1.0;
    let isLongPress = false;

    // 显示快速提示
    function showSpeedHint(speed) {
        showShortcutHint(`${speed}倍速`, 'right');
    }

    // 禁用右键
    playerElement.oncontextmenu = () => {
        // 检测是否为移动设备
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

        // 只在移动设备上禁用右键
        if (isMobile) {
            const dplayerMenu = document.querySelector(".dplayer-menu");
            const dplayerMask = document.querySelector(".dplayer-mask");
            if (dplayerMenu) dplayerMenu.style.display = "none";
            if (dplayerMask) dplayerMask.style.display = "none";
            return false;
        }
        return true; // 在桌面设备上允许右键菜单
    };

    // 触摸开始事件
    playerElement.addEventListener('touchstart', function (e) {
        // 检查视频是否正在播放，如果没有播放则不触发长按功能
        if (art.video.paused) {
            return; // 视频暂停时不触发长按功能
        }

        // 保存原始播放速度
        originalPlaybackRate = art.video.playbackRate;

        // 设置长按计时器
        longPressTimer = setTimeout(() => {
            // 再次检查视频是否仍在播放
            if (art.video.paused) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
                return;
            }

            // 长按超过500ms，设置为3倍速
            art.video.playbackRate = 3.0;
            isLongPress = true;
            showSpeedHint(3.0);

            // 只在确认为长按时阻止默认行为
            e.preventDefault();
        }, 500);
    }, { passive: false });

    // 触摸结束事件
    playerElement.addEventListener('touchend', function (e) {
        // 清除长按计时器
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }

        // 如果是长按状态，恢复原始播放速度
        if (isLongPress) {
            art.video.playbackRate = originalPlaybackRate;
            isLongPress = false;
            showSpeedHint(originalPlaybackRate);

            // 阻止长按后的点击事件
            e.preventDefault();
        }
        // 如果不是长按，则允许正常的点击事件（暂停/播放）
    });

    // 触摸取消事件
    playerElement.addEventListener('touchcancel', function () {
        // 清除长按计时器
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }

        // 如果是长按状态，恢复原始播放速度
        if (isLongPress) {
            art.video.playbackRate = originalPlaybackRate;
            isLongPress = false;
        }
    });

    // 触摸移动事件 - 防止在长按时触发页面滚动
    playerElement.addEventListener('touchmove', function (e) {
        if (isLongPress) {
            e.preventDefault();
        }
    }, { passive: false });

    // 视频暂停时取消长按状态
    art.video.addEventListener('pause', function () {
        if (isLongPress) {
            art.video.playbackRate = originalPlaybackRate;
            isLongPress = false;
        }

        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
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
        
        // ✅ 只清空详情缓存(因为换了源,标题相同但集数可能不同)
		// ⚠️ 不清空弹幕缓存,因为弹幕是根据标题匹配的,与视频源无关
		try {
			console.log('🔄 切换视频源,清空详情缓存...');
			Object.keys(animeDetailCache).forEach(key => {
				if (key.startsWith('title_')) {
					delete animeDetailCache[key];
				}
			});
		saveCache(animeDetailCache);
			console.log('✅ 已清空详情缓存,保留弹幕缓存');
		} catch (e) {
			console.warn('清空缓存失败:', e);
		}
            
        // Add a timestamp to prevent caching
        const timestamp = new Date().getTime();
        const cacheBuster = `&_t=${timestamp}`;
        const response = await fetch(`/api/detail?id=${encodeURIComponent(vodId)}${apiParams}${cacheBuster}`);
        
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

		// 构建播放页面URL，带上播放位置
		const watchUrl = `player.html?id=${vodId}&source=${sourceKey}&url=${encodeURIComponent(targetUrl)}&index=${targetIndex}&title=${encodeURIComponent(currentVideoTitle)}&position=${Math.floor(currentPlaybackTime)}`;
        
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
		
		// ✅ 保存弹幕源ID到 localStorage (使用纯标题作为key)
		if (currentDanmuAnimeId) {
			try {
				const cleanTitle = currentVideoTitle.replace(/\([^)]*\)/g, '').replace(/【[^】]*】/g, '').trim();
				const titleHash = simpleHash(cleanTitle);
				const sourceData = JSON.stringify({
					animeId: currentDanmuAnimeId,
					title: cleanTitle,
					timestamp: Date.now()
				});
				localStorage.setItem(`danmuSource_${titleHash}`, sourceData);
				console.log('✅ 已保存弹幕源ID到 localStorage');
			} catch (e) {
				console.warn('保存弹幕源ID失败:', e);
			}
		}
        
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
    
    modalContent.innerHTML = '<div class="text-center py-8 text-gray-400">正在搜索弹幕源...</div>';
    modal.classList.remove('hidden');
    
    try {
        // 提取纯标题用于搜索
        const cleanTitle = currentVideoTitle.replace(/\([^)]*\)/g, '').replace(/【[^】]*】/g, '').trim();
        const searchUrl = `${DANMU_CONFIG.baseUrl}/api/v2/search/anime?keyword=${encodeURIComponent(cleanTitle)}`;
        const searchResponse = await fetch(searchUrl);
        
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
            
            if (String(source.animeId) === String(currentDanmuAnimeId)) {
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
            const isActive = String(source.animeId) === String(currentDanmuAnimeId);
            const typeInfo = source.typeDescription || source.type;
            
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
                        ${isActive ? ' · <span class="text-yellow-300">✓ 当前</span>' : ''}
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
        modalContent.innerHTML = '<div class="text-center py-8 text-red-400">加载失败，请重试</div>';
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
        
        // ✅ 更新全局弹幕源ID
		currentDanmuAnimeId = animeId;

		// ✅ 清空当前视频相关的弹幕缓存
		Object.keys(danmuCache).forEach(key => {
			if (key.includes(currentVideoTitle) || key.includes(String(animeId))) {
				delete danmuCache[key];
			}
		});
        
        // ✅ 重新获取当前集弹幕(强制使用新的 animeId)
        const newDanmuku = await getDanmukuForVideo(
            currentVideoTitle, 
            currentEpisodeIndex, 
            animeId
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
        
        // 显示成功提示
        showToast(`已加载 ${newDanmuku.length} 条弹幕`, 'success');
        
        // ✅ 保存用户选择(使用纯标题作为key)
		try {
			const cleanTitle = currentVideoTitle.replace(/\([^)]*\)/g, '').replace(/【[^】]*】/g, '').trim();
			const titleHash = simpleHash(cleanTitle);
			const sourceData = JSON.stringify({
				animeId: animeId,
				title: cleanTitle,
				timestamp: Date.now()
			});
			localStorage.setItem(`danmuSource_${titleHash}`, sourceData);
			console.log('✅ 已保存弹幕源偏好:', cleanTitle, '->', animeId);
		} catch (e) {
			console.warn('保存弹幕源偏好失败:', e);
		}
        
    } catch (error) {
        console.error('切换弹幕源失败:', error);
        showToast('切换弹幕源失败', 'error');
    }
}

// ✅ 新增：显示手动选择弹幕集数的弹窗
async function showManualDanmuEpisodeSelector() {
    if (!currentDanmuAnimeId || !art || !art.plugins.artplayerPluginDanmuku) {
        showToast('弹幕源未加载', 'error');
        return;
    }
    
    const detailUrl = `${DANMU_CONFIG.baseUrl}/api/v2/bangumi/${currentDanmuAnimeId}`;
    // ✅ 添加：验证 animeId 是否有效
    if (!currentDanmuAnimeId || currentDanmuAnimeId === 'null' || currentDanmuAnimeId === 'undefined') {
        showToast('弹幕源ID无效，请先切换弹幕源', 'error');
        return;
    }
    
    showToast('正在加载弹幕集数列表...', 'info');
    
    try {
        const response = await fetch(detailUrl);
        if (!response.ok) throw new Error('获取失败');
        
        const data = await response.json();
        const episodes = data.bangumi.episodes || [];
        
        if (episodes.length === 0) {
            showToast('没有可用的弹幕集数', 'error');
            return;
        }
        
        // 检测内容类型
        const cleanTitle = currentVideoTitle.replace(/\([^)]*\)/g, '').replace(/【[^】]*】/g, '').trim();
        const contentType = detectContentType(cleanTitle, episodes);
        const unitText = contentType === 'variety' ? '期' : '集';
        
       // 创建或获取弹窗
        let modal = document.getElementById('danmuEpisodeModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'danmuEpisodeModal';
            modal.className = 'fixed inset-0 bg-black bg-opacity-75 z-[10000] hidden flex items-center justify-center p-4';  // ✅ 改为 z-[10000]
            modal.innerHTML = `
                <div class="bg-gray-800 rounded-lg p-6 max-w-4xl w-full max-h-[80vh] overflow-y-auto">
                    <div class="flex justify-between items-center mb-4">
                        <h3 class="text-lg font-bold text-white">选择弹幕${unitText}数</h3>
                        <button onclick="document.getElementById('danmuEpisodeModal').classList.add('hidden')" 
                                class="text-gray-400 hover:text-white">
                            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                            </svg>
                        </button>
                    </div>
                    <div class="danmu-episode-list"></div>
                </div>
            `;
            document.body.appendChild(modal);
            
            // 点击背景关闭
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.classList.add('hidden');
                }
            });
        }
        
        const modalContent = modal.querySelector('.danmu-episode-list');
        
        let html = `<div class="text-sm text-gray-400 mb-4 p-3 bg-gray-700 rounded">
            当前视频：第 ${currentEpisodeIndex + 1} ${unitText}
            <br>点击下方按钮切换到对应的弹幕${unitText}数
        </div>`;
        
        html += '<div class="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-2">';
        
        episodes.forEach((ep, idx) => {
            const info = extractEpisodeInfo(ep.episodeTitle || '', contentType);
            let displayText = `${idx + 1}`;
            let tooltip = ep.episodeTitle || '';
            
            if (contentType === 'variety' && info?.date) {
                // 综艺显示日期（月-日）
                displayText = info.date.substring(5); // MM-DD
            } else if (info?.number) {
                displayText = info.number;
            }
            
            const isActive = idx === currentEpisodeIndex;
            
            html += `
                <button 
                    onclick="loadManualDanmu(${idx})"
                    class="px-3 py-2 rounded text-sm transition-colors ${
                        isActive 
                            ? 'bg-blue-600 text-white font-bold' 
                            : 'bg-gray-700 hover:bg-gray-600 text-gray-200'
                    }"
                    title="${tooltip}">
                    ${displayText}
                </button>
            `;
        });
        
        html += '</div>';
        modalContent.innerHTML = html;
        modal.classList.remove('hidden');
        
    } catch (error) {
        console.error('加载弹幕集数失败:', error);
        showToast('加载失败，请重试', 'error');
    }
}

// ✅ 新增：手动加载指定集数的弹幕
async function loadManualDanmu(episodeIndex) {
    const modal = document.getElementById('danmuEpisodeModal');
    if (modal) modal.classList.add('hidden');
    
    showToast('正在加载弹幕...', 'info');
    
    try {
        const currentTime = art.video ? art.video.currentTime : 0;
        const isPlaying = art.video ? !art.video.paused : false;
        
        // 清空相关弹幕缓存，强制重新获取
        Object.keys(danmuCache).forEach(key => {
            if (key.includes(currentVideoTitle) || key.includes(String(currentDanmuAnimeId))) {
                delete danmuCache[key];
            }
        });
        
        // 强制使用指定集数获取弹幕
        const danmuku = await getDanmukuForVideo(
            currentVideoTitle,
            episodeIndex, // 使用手动选择的集数
            currentDanmuAnimeId
        );
        
        if (!danmuku || danmuku.length === 0) {
            showToast('该集没有弹幕', 'warning');
            return;
        }
        
        // 重新加载弹幕
        const danmukuPlugin = art.plugins.artplayerPluginDanmuku;
        
        if (typeof danmukuPlugin.clear === 'function') {
            danmukuPlugin.clear();
        }
        
        danmukuPlugin.config({
            danmuku: danmuku,
            synchronousPlayback: true
        });
        
        danmukuPlugin.load();
        
        // 恢复播放位置
        if (art.video && currentTime > 0) {
            art.currentTime = currentTime;
            if (typeof danmukuPlugin.seek === 'function') {
                setTimeout(() => {
                    danmukuPlugin.seek(currentTime);
                }, 300);
            }
        }
        
        if (isPlaying && art.video.paused) {
            setTimeout(() => art.play(), 100);
        }
        
        showToast(`已加载第 ${episodeIndex + 1} 集弹幕 (${danmuku.length}条)`, 'success');
        
    } catch (error) {
        console.error('手动加载弹幕失败:', error);
        showToast('加载失败，请重试', 'error');
    }
}

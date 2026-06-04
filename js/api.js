function isPlayableUrl(url) {
    return typeof url === 'string' && /^https?:\/\//.test(url.trim());
}

function cleanEpisodeName(name, fallback) {
    const cleaned = (name || '')
        .toString()
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&#36;/g, '$')
        .trim();

    return cleaned || fallback;
}

function parseEpisodeEntry(entry, index) {
    const raw = (entry || '').toString().trim();
    if (!raw) return null;

    const dollarIndex = raw.indexOf('$');
    const fallbackName = `第${index + 1}集`;
    let name = fallbackName;
    let url = raw;

    if (dollarIndex !== -1) {
        name = cleanEpisodeName(raw.slice(0, dollarIndex), fallbackName);
        url = raw.slice(dollarIndex + 1).trim();
    }

    if (!isPlayableUrl(url)) return null;

    return { name, url };
}

function parseVodPlaySources(vodPlayFrom = '', vodPlayUrl = '') {
    if (!vodPlayUrl) return [];

    const sourceNames = (vodPlayFrom || '').split('$$$').map(name => name.trim());
    const sourceGroups = vodPlayUrl.split('$$$');

    return sourceGroups.map((group, groupIndex) => {
        const episodes = group
            .split('#')
            .map((entry, episodeIndex) => parseEpisodeEntry(entry, episodeIndex))
            .filter(Boolean);

        if (episodes.length === 0) return null;

        return {
            name: sourceNames[groupIndex] || `播放源 ${groupIndex + 1}`,
            episodes
        };
    }).filter(Boolean);
}

function buildSinglePlaySourceFromUrls(urls, sourceName = '播放源 1') {
    const seen = new Set();
    const episodes = [];

    urls.forEach((url, index) => {
        const cleanUrl = (url || '').toString().trim();
        if (!isPlayableUrl(cleanUrl) || seen.has(cleanUrl)) return;
        seen.add(cleanUrl);
        episodes.push({
            name: `第${episodes.length + 1}集`,
            url: cleanUrl
        });
    });

    return episodes.length > 0 ? [{ name: sourceName, episodes }] : [];
}

function parseHtmlPlaySources(html, sourceName = '播放源 1') {
    const seen = new Set();
    const episodes = [];
    const pairPattern = /([^#"'<>$\r\n]{0,80})\$(https?:\/\/[^"'\s<>]+?(?:\.m3u8|\/share\/[A-Za-z0-9_-]+)[^"'\s<>]*)/g;
    let match;

    while ((match = pairPattern.exec(html)) !== null) {
        const url = match[2].trim();
        if (!isPlayableUrl(url) || seen.has(url)) continue;

        seen.add(url);
        const name = cleanEpisodeName(match[1], `第${episodes.length + 1}集`);
        episodes.push({ name, url });
    }

    if (episodes.length > 0) {
        return [{ name: sourceName, episodes }];
    }

    const matches = html.match(M3U8_PATTERN) || [];
    const urls = matches.map(link => link.replace(/^\$/, ''));
    return buildSinglePlaySourceFromUrls(urls, sourceName);
}

function buildDetailPayload(videoDetail, detailUrl, sourceCode) {
    let playSources = parseVodPlaySources(videoDetail.vod_play_from, videoDetail.vod_play_url);

    if (playSources.length === 0 && videoDetail.vod_content) {
        const matches = videoDetail.vod_content.match(M3U8_PATTERN) || [];
        const urls = matches.map(link => link.replace(/^\$/, ''));
        playSources = buildSinglePlaySourceFromUrls(urls);
    }

    const selectedPlaySourceIndex = 0;
    const episodes = playSources[selectedPlaySourceIndex]?.episodes || [];

    return {
        code: 200,
        episodes,
        playSources,
        selectedPlaySourceIndex,
        detailUrl: detailUrl,
        videoInfo: {
            title: videoDetail.vod_name,
            cover: videoDetail.vod_pic,
            desc: videoDetail.vod_content,
            type: videoDetail.type_name,
            year: videoDetail.vod_year,
            area: videoDetail.vod_area,
            director: videoDetail.vod_director,
            actor: videoDetail.vod_actor,
            remarks: videoDetail.vod_remarks,
            source_name: sourceCode === 'custom' ? '自定义源' : API_SITES[sourceCode].name,
            source_code: sourceCode
        }
    };
}

function joinUrlPath(baseUrl, path = '') {
    const cleanBase = String(baseUrl || '').trim().replace(/\/+$/, '');
    const cleanPath = String(path || '').trim().replace(/^\/+/, '');
    if (!cleanPath) return cleanBase;
    return `${cleanBase}/${cleanPath}`;
}

function isVodProviderEndpoint(url) {
    return /\/api\.php\/provide\/vod\/?$/i.test(String(url || '').split('?')[0]);
}

function splitUrlQuery(url) {
    const raw = String(url || '').trim();
    const queryIndex = raw.indexOf('?');

    if (queryIndex === -1) {
        return { path: raw, query: '' };
    }

    return {
        path: raw.slice(0, queryIndex),
        query: raw.slice(queryIndex + 1)
    };
}

function appendVodDetailQuery(endpoint, existingQuery, vodId) {
    const params = new URLSearchParams(existingQuery || '');
    params.set('ac', 'videolist');
    params.set('ids', String(vodId));
    return `${endpoint.replace(/\/+$/, '')}?${params.toString()}`;
}

function buildVodDetailUrl(apiUrl, detailPath, vodId) {
    const cleanApiUrl = String(apiUrl || '').trim();

    if (isVodProviderEndpoint(cleanApiUrl)) {
        const apiParts = splitUrlQuery(cleanApiUrl);
        return appendVodDetailQuery(apiParts.path, apiParts.query, vodId);
    }

    const apiParts = splitUrlQuery(cleanApiUrl);
    const detailParts = splitUrlQuery(detailPath);
    const endpoint = joinUrlPath(apiParts.path, detailParts.path);
    const params = new URLSearchParams(apiParts.query || '');
    const detailParams = new URLSearchParams(detailParts.query || '');

    detailParams.forEach((value, key) => {
        params.set(key, value);
    });
    params.set('ac', 'videolist');
    params.set('ids', String(vodId));

    return `${endpoint}?${params.toString()}`;
}

async function fetchJsonDetailPayload(id, sourceCode, customApi = '') {
    const apiUrl = customApi || API_SITES[sourceCode].api;
    const detailUrl = buildVodDetailUrl(apiUrl, API_CONFIG.detail.path, id);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
        const proxiedUrl = await window.ProxyAuth?.addAuthToProxyUrl ?
            await window.ProxyAuth.addAuthToProxyUrl(PROXY_URL + encodeURIComponent(detailUrl)) :
            PROXY_URL + encodeURIComponent(detailUrl);

        const response = await fetch(proxiedUrl, {
            headers: API_CONFIG.detail.headers,
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`详情请求失败: ${response.status}`);
        }

        const data = await response.json();

        if (!data || !data.list || !Array.isArray(data.list) || data.list.length === 0) {
            throw new Error('获取到的详情内容无效');
        }

        return buildDetailPayload(data.list[0], detailUrl, sourceCode);
    } catch (error) {
        clearTimeout(timeoutId);
        throw error;
    }
}

// 改进的API请求处理函数
async function handleApiRequest(url) {
    const customApi = url.searchParams.get('customApi') || '';
    const customDetail = url.searchParams.get('customDetail') || '';
    const source = url.searchParams.get('source') || 'heimuer';

    try {
        if (url.pathname === '/api/search') {
            const searchQuery = url.searchParams.get('wd');
            if (!searchQuery) {
                throw new Error('缺少搜索参数');
            }

            // 验证API和source的有效性
            if (source === 'custom' && !customApi) {
                throw new Error('使用自定义API时必须提供API地址');
            }

            if (!API_SITES[source] && source !== 'custom') {
                throw new Error('无效的API来源');
            }

            const apiUrl = customApi
                ? `${customApi}${API_CONFIG.search.path}${encodeURIComponent(searchQuery)}`
                : `${API_SITES[source].api}${API_CONFIG.search.path}${encodeURIComponent(searchQuery)}`;

            // 添加超时处理
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);

            try {
                // 添加鉴权参数到代理URL
                const proxiedUrl = await window.ProxyAuth?.addAuthToProxyUrl ? 
                    await window.ProxyAuth.addAuthToProxyUrl(PROXY_URL + encodeURIComponent(apiUrl)) :
                    PROXY_URL + encodeURIComponent(apiUrl);

                const response = await fetch(proxiedUrl, {
                    headers: API_CONFIG.search.headers,
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    throw new Error(`API请求失败: ${response.status}`);
                }

                const data = await response.json();

                // 检查JSON格式的有效性
                if (!data || !Array.isArray(data.list)) {
                    throw new Error('API返回的数据格式无效');
                }

                // 添加源信息到每个结果
                data.list.forEach(item => {
                    item.source_name = source === 'custom' ? '自定义源' : API_SITES[source].name;
                    item.source_code = source;
                    // 对于自定义源，添加API URL信息
                    if (source === 'custom') {
                        item.api_url = customApi;
                    }
                });

                return JSON.stringify({
                    code: 200,
                    list: data.list || [],
                });
            } catch (fetchError) {
                clearTimeout(timeoutId);
                throw fetchError;
            }
        }

        // 详情处理
        if (url.pathname === '/api/detail') {
            const id = url.searchParams.get('id');
            const sourceCode = url.searchParams.get('source') || 'heimuer'; // 获取源代码

            if (!id) {
                throw new Error('缺少视频ID参数');
            }

            // 验证ID格式 - 只允许数字和有限的特殊字符
            if (!/^[\w-]+$/.test(id)) {
                throw new Error('无效的视频ID格式');
            }

            // 验证API和source的有效性
            if (sourceCode === 'custom' && !customApi) {
                throw new Error('使用自定义API时必须提供API地址');
            }

            if (!API_SITES[sourceCode] && sourceCode !== 'custom') {
                throw new Error('无效的API来源');
            }

            // 对于有detail参数的源，都使用特殊处理方式
            if (sourceCode !== 'custom' && API_SITES[sourceCode].detail) {
                return await handleSpecialSourceDetail(id, sourceCode);
            }

            // 如果是自定义API，并且传递了detail参数，尝试特殊处理
            // 优先 customDetail
            if (sourceCode === 'custom' && customDetail) {
                return await handleCustomApiSpecialDetail(id, customDetail);
            }
            if (sourceCode === 'custom' && url.searchParams.get('useDetail') === 'true') {
                return await handleCustomApiSpecialDetail(id, customApi);
            }

            try {
                return JSON.stringify(await fetchJsonDetailPayload(id, sourceCode, customApi));
            } catch (fetchError) {
                throw fetchError;
            }
        }

        throw new Error('未知的API路径');
    } catch (error) {
        console.error('API处理错误:', error);
        return JSON.stringify({
            code: 400,
            msg: error.message || '请求处理失败',
            list: [],
            episodes: [],
        });
    }
}

// 处理自定义API的特殊详情页
async function handleCustomApiSpecialDetail(id, customApi) {
    try {
        // 构建详情页URL
        const detailUrl = `${customApi}/index.php/vod/detail/id/${id}.html`;

        // 添加超时处理
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        // 添加鉴权参数到代理URL
        const proxiedUrl = await window.ProxyAuth?.addAuthToProxyUrl ? 
            await window.ProxyAuth.addAuthToProxyUrl(PROXY_URL + encodeURIComponent(detailUrl)) :
            PROXY_URL + encodeURIComponent(detailUrl);

        // 获取详情页HTML
        const response = await fetch(proxiedUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            },
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`自定义API详情页请求失败: ${response.status}`);
        }

        // 获取HTML内容
        const html = await response.text();

        const playSources = parseHtmlPlaySources(html, '自定义源');
        const episodes = playSources[0]?.episodes || [];

        // 提取基本信息
        const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
        const titleText = titleMatch ? titleMatch[1].trim() : '';

        const descMatch = html.match(/<div[^>]*class=["']sketch["'][^>]*>([\s\S]*?)<\/div>/);
        const descText = descMatch ? descMatch[1].replace(/<[^>]+>/g, ' ').trim() : '';

        return JSON.stringify({
            code: 200,
            episodes,
            playSources,
            selectedPlaySourceIndex: 0,
            detailUrl: detailUrl,
            videoInfo: {
                title: titleText,
                desc: descText,
                source_name: '自定义源',
                source_code: 'custom'
            }
        });
    } catch (error) {
        console.error(`自定义API详情获取失败:`, error);
        throw error;
    }
}

// 通用特殊源详情处理函数
async function handleSpecialSourceDetail(id, sourceCode) {
    try {
        try {
            const jsonPayload = await fetchJsonDetailPayload(id, sourceCode);
            if (jsonPayload.episodes && jsonPayload.episodes.length > 0) {
                return JSON.stringify(jsonPayload);
            }
        } catch (jsonError) {
            console.warn(`${API_SITES[sourceCode].name} JSON详情获取失败，回退HTML详情:`, jsonError);
        }

        // 构建详情页URL（使用配置中的detail URL而不是api URL）
        const detailUrl = `${API_SITES[sourceCode].detail}/index.php/vod/detail/id/${id}.html`;

        // 添加超时处理
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        // 添加鉴权参数到代理URL
        const proxiedUrl = await window.ProxyAuth?.addAuthToProxyUrl ? 
            await window.ProxyAuth.addAuthToProxyUrl(PROXY_URL + encodeURIComponent(detailUrl)) :
            PROXY_URL + encodeURIComponent(detailUrl);

        // 获取详情页HTML
        const response = await fetch(proxiedUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            },
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`详情页请求失败: ${response.status}`);
        }

        // 获取HTML内容
        const html = await response.text();

        const playSources = parseHtmlPlaySources(html, API_SITES[sourceCode].name);
        const episodes = playSources[0]?.episodes || [];

        // 提取可能存在的标题、简介等基本信息
        const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
        const titleText = titleMatch ? titleMatch[1].trim() : '';

        const descMatch = html.match(/<div[^>]*class=["']sketch["'][^>]*>([\s\S]*?)<\/div>/);
        const descText = descMatch ? descMatch[1].replace(/<[^>]+>/g, ' ').trim() : '';

        return JSON.stringify({
            code: 200,
            episodes,
            playSources,
            selectedPlaySourceIndex: 0,
            detailUrl: detailUrl,
            videoInfo: {
                title: titleText,
                desc: descText,
                source_name: API_SITES[sourceCode].name,
                source_code: sourceCode
            }
        });
    } catch (error) {
        console.error(`${API_SITES[sourceCode].name}详情获取失败:`, error);
        throw error;
    }
}

// 处理聚合搜索
async function handleAggregatedSearch(searchQuery) {
    // 获取可用的API源列表（排除aggregated和custom）
    const availableSources = Object.keys(API_SITES).filter(key => 
        key !== 'aggregated' && key !== 'custom'
    );

    if (availableSources.length === 0) {
        throw new Error('没有可用的API源');
    }

    // 创建所有API源的搜索请求
    const searchPromises = availableSources.map(async (source) => {
        try {
            const apiUrl = `${API_SITES[source].api}${API_CONFIG.search.path}${encodeURIComponent(searchQuery)}`;

            // 使用Promise.race添加超时处理
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error(`${source}源搜索超时`)), 8000)
            );

            // 添加鉴权参数到代理URL
            const proxiedUrl = await window.ProxyAuth?.addAuthToProxyUrl ? 
                await window.ProxyAuth.addAuthToProxyUrl(PROXY_URL + encodeURIComponent(apiUrl)) :
                PROXY_URL + encodeURIComponent(apiUrl);

            const fetchPromise = fetch(proxiedUrl, {
                headers: API_CONFIG.search.headers
            });

            const response = await Promise.race([fetchPromise, timeoutPromise]);

            if (!response.ok) {
                throw new Error(`${source}源请求失败: ${response.status}`);
            }

            const data = await response.json();

            if (!data || !Array.isArray(data.list)) {
                throw new Error(`${source}源返回的数据格式无效`);
            }

            // 为搜索结果添加源信息
            const results = data.list.map(item => ({
                ...item,
                source_name: API_SITES[source].name,
                source_code: source
            }));

            return results;
        } catch (error) {
            console.warn(`${source}源搜索失败:`, error);
            return []; // 返回空数组表示该源搜索失败
        }
    });

    try {
        // 并行执行所有搜索请求
        const resultsArray = await Promise.all(searchPromises);

        // 合并所有结果
        let allResults = [];
        resultsArray.forEach(results => {
            if (Array.isArray(results) && results.length > 0) {
                allResults = allResults.concat(results);
            }
        });

        // 如果没有搜索结果，返回空结果
        if (allResults.length === 0) {
            return JSON.stringify({
                code: 200,
                list: [],
                msg: '所有源均无搜索结果'
            });
        }

        // 去重（根据vod_id和source_code组合）
        const uniqueResults = [];
        const seen = new Set();

        allResults.forEach(item => {
            const key = `${item.source_code}_${item.vod_id}`;
            if (!seen.has(key)) {
                seen.add(key);
                uniqueResults.push(item);
            }
        });

        // 按照视频名称和来源排序
        uniqueResults.sort((a, b) => {
            // 首先按照视频名称排序
            const nameCompare = (a.vod_name || '').localeCompare(b.vod_name || '');
            if (nameCompare !== 0) return nameCompare;

            // 如果名称相同，则按照来源排序
            return (a.source_name || '').localeCompare(b.source_name || '');
        });

        return JSON.stringify({
            code: 200,
            list: uniqueResults,
        });
    } catch (error) {
        console.error('聚合搜索处理错误:', error);
        return JSON.stringify({
            code: 400,
            msg: '聚合搜索处理失败: ' + error.message,
            list: []
        });
    }
}

// 处理多个自定义API源的聚合搜索
async function handleMultipleCustomSearch(searchQuery, customApiUrls) {
    // 解析自定义API列表
    const apiUrls = customApiUrls.split(CUSTOM_API_CONFIG.separator)
        .map(url => url.trim())
        .filter(url => url.length > 0 && /^https?:\/\//.test(url))
        .slice(0, CUSTOM_API_CONFIG.maxSources);

    if (apiUrls.length === 0) {
        throw new Error('没有提供有效的自定义API地址');
    }

    // 为每个API创建搜索请求
    const searchPromises = apiUrls.map(async (apiUrl, index) => {
        try {
            const fullUrl = `${apiUrl}${API_CONFIG.search.path}${encodeURIComponent(searchQuery)}`;

            // 使用Promise.race添加超时处理
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error(`自定义API ${index+1} 搜索超时`)), 8000)
            );

            // 添加鉴权参数到代理URL
            const proxiedUrl = await window.ProxyAuth?.addAuthToProxyUrl ? 
                await window.ProxyAuth.addAuthToProxyUrl(PROXY_URL + encodeURIComponent(fullUrl)) :
                PROXY_URL + encodeURIComponent(fullUrl);

            const fetchPromise = fetch(proxiedUrl, {
                headers: API_CONFIG.search.headers
            });

            const response = await Promise.race([fetchPromise, timeoutPromise]);

            if (!response.ok) {
                throw new Error(`自定义API ${index+1} 请求失败: ${response.status}`);
            }

            const data = await response.json();

            if (!data || !Array.isArray(data.list)) {
                throw new Error(`自定义API ${index+1} 返回的数据格式无效`);
            }

            // 为搜索结果添加源信息
            const results = data.list.map(item => ({
                ...item,
                source_name: `${CUSTOM_API_CONFIG.namePrefix}${index+1}`,
                source_code: 'custom',
                api_url: apiUrl // 保存API URL以便详情获取
            }));

            return results;
        } catch (error) {
            console.warn(`自定义API ${index+1} 搜索失败:`, error);
            return []; // 返回空数组表示该源搜索失败
        }
    });

    try {
        // 并行执行所有搜索请求
        const resultsArray = await Promise.all(searchPromises);

        // 合并所有结果
        let allResults = [];
        resultsArray.forEach(results => {
            if (Array.isArray(results) && results.length > 0) {
                allResults = allResults.concat(results);
            }
        });

        // 如果没有搜索结果，返回空结果
        if (allResults.length === 0) {
            return JSON.stringify({
                code: 200,
                list: [],
                msg: '所有自定义API源均无搜索结果'
            });
        }

        // 去重（根据vod_id和api_url组合）
        const uniqueResults = [];
        const seen = new Set();

        allResults.forEach(item => {
            const key = `${item.api_url || ''}_${item.vod_id}`;
            if (!seen.has(key)) {
                seen.add(key);
                uniqueResults.push(item);
            }
        });

        return JSON.stringify({
            code: 200,
            list: uniqueResults,
        });
    } catch (error) {
        console.error('自定义API聚合搜索处理错误:', error);
        return JSON.stringify({
            code: 400,
            msg: '自定义API聚合搜索处理失败: ' + error.message,
            list: []
        });
    }
}

// 拦截API请求
(function() {
    const originalFetch = window.fetch;

    window.fetch = async function(input, init) {
        const requestUrl = typeof input === 'string' ? new URL(input, window.location.origin) : input.url;

        if (requestUrl.pathname.startsWith('/api/danmu/')) {
            return originalFetch.apply(this, arguments);
        }

        if (requestUrl.pathname.startsWith('/api/')) {
            if (window.isPasswordProtected && window.isPasswordVerified) {
                if (window.isPasswordProtected() && !window.isPasswordVerified()) {
                    return;
                }
            }
            try {
                const data = await handleApiRequest(requestUrl);
                return new Response(data, {
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*',
                    },
                });
            } catch (error) {
                return new Response(JSON.stringify({
                    code: 500,
                    msg: '服务器内部错误',
                }), {
                    status: 500,
                    headers: {
                        'Content-Type': 'application/json',
                    },
                });
            }
        }

        // 非API请求使用原始fetch
        return originalFetch.apply(this, arguments);
    };
})();

async function testSiteAvailability(apiUrl) {
    try {
        // 使用更简单的测试查询
        const response = await fetch('/api/search?wd=test&customApi=' + encodeURIComponent(apiUrl), {
            // 添加超时
            signal: AbortSignal.timeout(5000)
        });

        // 检查响应状态
        if (!response.ok) {
            return false;
        }

        const data = await response.json();

        // 检查API响应的有效性
        return data && data.code !== 400 && Array.isArray(data.list);
    } catch (error) {
        console.error('站点可用性测试失败:', error);
        return false;
    }
}

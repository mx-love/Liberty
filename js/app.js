// 全局变量
let selectedAPIs = JSON.parse(localStorage.getItem('selectedAPIs') || '["tyyszy","dyttzy", "bfzy", "ruyi"]'); // 默认选中资源
let customAPIs = JSON.parse(localStorage.getItem('customAPIs') || '[]'); // 存储自定义API列表
let mergedSearchGroups = {};

// 添加当前播放的集数索引
let currentEpisodeIndex = 0;
// 添加当前视频的所有集数
let currentEpisodes = [];
let currentPlaySources = [];
let currentPlaySourceIndex = 0;
// 添加当前视频的标题
let currentVideoTitle = '';
let currentVideoYear = ''; // 新增
// 全局变量用于倒序状态
let episodesReversed = false;
const SEARCH_PAGE_SIZE = 40;
let currentSearchQuery = '';
let currentSearchResults = [];
let filteredSearchResults = [];
let visibleSearchResultCount = SEARCH_PAGE_SIZE;
let searchResultFilters = {
    sort: 'latest',
    type: 'all',
    source: 'all',
    year: 'all'
};

// 页面初始化
document.addEventListener('DOMContentLoaded', function () {
    // 初始化API复选框
    initAPICheckboxes();

    // 初始化自定义API列表
    renderCustomAPIsList();

    // 初始化显示选中的API数量
    updateSelectedApiCount();

    // 渲染搜索历史
    renderSearchHistory();

    // 设置默认API选择（如果是第一次加载）
    if (!localStorage.getItem('hasInitializedDefaults')) {
        // 默认选中资源
        selectedAPIs = ["tyyszy", "bfzy", "dyttzy", "ruyi"];
        localStorage.setItem('selectedAPIs', JSON.stringify(selectedAPIs));

        // 默认选中过滤开关
        localStorage.setItem('yellowFilterEnabled', 'true');
        localStorage.setItem(PLAYER_CONFIG.adFilteringStorage, 'true');

        // 默认启用豆瓣功能
        localStorage.setItem('doubanEnabled', 'true');

        // 标记已初始化默认值
        localStorage.setItem('hasInitializedDefaults', 'true');
    }

    // 设置黄色内容过滤器开关初始状态
    const yellowFilterToggle = document.getElementById('yellowFilterToggle');
    if (yellowFilterToggle) {
        yellowFilterToggle.checked = localStorage.getItem('yellowFilterEnabled') === 'true';
    }

    // 设置广告过滤开关初始状态
    const adFilterToggle = document.getElementById('adFilterToggle');
    if (adFilterToggle) {
        adFilterToggle.checked = localStorage.getItem(PLAYER_CONFIG.adFilteringStorage) !== 'false'; // 默认为true
    }

    // 设置事件监听器
    setupEventListeners();

    // 初始检查成人API选中状态
    setTimeout(checkAdultAPIsSelected, 100);
});

// 初始化API复选框
function initAPICheckboxes() {
    const container = document.getElementById('apiCheckboxes');
    container.innerHTML = '';

    // 添加普通API组标题
    const normaldiv = document.createElement('div');
    normaldiv.id = 'normaldiv';
    normaldiv.className = 'grid grid-cols-2 gap-2';
    const normalTitle = document.createElement('div');
    normalTitle.className = 'api-group-title';
    normalTitle.textContent = '普通资源';
    normaldiv.appendChild(normalTitle);

    // 创建普通API源的复选框
    Object.keys(API_SITES).forEach(apiKey => {
        const api = API_SITES[apiKey];
        if (api.adult) return; // 跳过成人内容API，稍后添加

        const checked = selectedAPIs.includes(apiKey);

        const checkbox = document.createElement('div');
        checkbox.className = 'flex items-center';
        checkbox.innerHTML = `
            <input type="checkbox" id="api_${apiKey}" 
                   class="form-checkbox h-3 w-3 text-blue-600 bg-[#222] border border-[#333]" 
                   ${checked ? 'checked' : ''} 
                   data-api="${apiKey}">
            <label for="api_${apiKey}" class="ml-1 text-xs text-gray-400 truncate">${api.name}</label>
        `;
        normaldiv.appendChild(checkbox);

        // 添加事件监听器
        checkbox.querySelector('input').addEventListener('change', function () {
            updateSelectedAPIs();
            checkAdultAPIsSelected();
        });
    });
    container.appendChild(normaldiv);

    // 添加成人API列表
    addAdultAPI();

    // 初始检查成人内容状态
    checkAdultAPIsSelected();
}

// 添加成人API列表
function addAdultAPI() {
    // 仅在隐藏设置为false时添加成人API组
    if (!HIDE_BUILTIN_ADULT_APIS && (localStorage.getItem('yellowFilterEnabled') === 'false')) {
        const container = document.getElementById('apiCheckboxes');

        // 添加成人API组标题
        const adultdiv = document.createElement('div');
        adultdiv.id = 'adultdiv';
        adultdiv.className = 'grid grid-cols-2 gap-2';
        const adultTitle = document.createElement('div');
        adultTitle.className = 'api-group-title adult';
        adultTitle.innerHTML = `黄色资源采集站 <span class="adult-warning">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
        </span>`;
        adultdiv.appendChild(adultTitle);

        // 创建成人API源的复选框
        Object.keys(API_SITES).forEach(apiKey => {
            const api = API_SITES[apiKey];
            if (!api.adult) return; // 仅添加成人内容API

            const checked = selectedAPIs.includes(apiKey);

            const checkbox = document.createElement('div');
            checkbox.className = 'flex items-center';
            checkbox.innerHTML = `
                <input type="checkbox" id="api_${apiKey}" 
                       class="form-checkbox h-3 w-3 text-blue-600 bg-[#222] border border-[#333] api-adult" 
                       ${checked ? 'checked' : ''} 
                       data-api="${apiKey}">
                <label for="api_${apiKey}" class="ml-1 text-xs text-pink-400 truncate">${api.name}</label>
            `;
            adultdiv.appendChild(checkbox);

            // 添加事件监听器
            checkbox.querySelector('input').addEventListener('change', function () {
                updateSelectedAPIs();
                checkAdultAPIsSelected();
            });
        });
        container.appendChild(adultdiv);
    }
}

// 检查是否有成人API被选中
function checkAdultAPIsSelected() {
    // 查找所有内置成人API复选框
    const adultBuiltinCheckboxes = document.querySelectorAll('#apiCheckboxes .api-adult:checked');

    // 查找所有自定义成人API复选框
    const customApiCheckboxes = document.querySelectorAll('#customApisList .api-adult:checked');

    const hasAdultSelected = adultBuiltinCheckboxes.length > 0 || customApiCheckboxes.length > 0;

    const yellowFilterToggle = document.getElementById('yellowFilterToggle');
    const yellowFilterContainer = yellowFilterToggle.closest('div').parentNode;
    const filterDescription = yellowFilterContainer.querySelector('p.filter-description');

    // 如果选择了成人API，禁用黄色内容过滤器
    if (hasAdultSelected) {
        yellowFilterToggle.checked = false;
        yellowFilterToggle.disabled = true;
        localStorage.setItem('yellowFilterEnabled', 'false');

        // 添加禁用样式
        yellowFilterContainer.classList.add('filter-disabled');

        // 修改描述文字
        if (filterDescription) {
            filterDescription.innerHTML = '<strong class="text-pink-300">选中黄色资源站时无法启用此过滤</strong>';
        }

        // 移除提示信息（如果存在）
        const existingTooltip = yellowFilterContainer.querySelector('.filter-tooltip');
        if (existingTooltip) {
            existingTooltip.remove();
        }
    } else {
        // 启用黄色内容过滤器
        yellowFilterToggle.disabled = false;
        yellowFilterContainer.classList.remove('filter-disabled');

        // 恢复原来的描述文字
        if (filterDescription) {
            filterDescription.innerHTML = '过滤"伦理片"等黄色内容';
        }

        // 移除提示信息
        const existingTooltip = yellowFilterContainer.querySelector('.filter-tooltip');
        if (existingTooltip) {
            existingTooltip.remove();
        }
    }
}

// 渲染自定义API列表
function renderCustomAPIsList() {
    const container = document.getElementById('customApisList');
    if (!container) return;

    if (customAPIs.length === 0) {
        container.innerHTML = '<p class="text-xs text-gray-500 text-center my-2">未添加自定义API</p>';
        return;
    }

    container.innerHTML = '';
    customAPIs.forEach((api, index) => {
        const apiItem = document.createElement('div');
        apiItem.className = 'flex items-center justify-between p-1 mb-1 bg-[#222] rounded';
        const textColorClass = api.isAdult ? 'text-pink-400' : 'text-white';
        const adultTag = api.isAdult ? '<span class="text-xs text-pink-400 mr-1">(18+)</span>' : '';
        // 新增 detail 地址显示
        const detailLine = api.detail ? `<div class="text-xs text-gray-400 truncate">detail: ${api.detail}</div>` : '';
        apiItem.innerHTML = `
            <div class="flex items-center flex-1 min-w-0">
                <input type="checkbox" id="custom_api_${index}" 
                       class="form-checkbox h-3 w-3 text-blue-600 mr-1 ${api.isAdult ? 'api-adult' : ''}" 
                       ${selectedAPIs.includes('custom_' + index) ? 'checked' : ''} 
                       data-custom-index="${index}">
                <div class="flex-1 min-w-0">
                    <div class="text-xs font-medium ${textColorClass} truncate">
                        ${adultTag}${api.name}
                    </div>
                    <div class="text-xs text-gray-500 truncate">${api.url}</div>
                    ${detailLine}
                </div>
            </div>
            <div class="flex items-center">
                <button class="text-blue-500 hover:text-blue-700 text-xs px-1" onclick="editCustomApi(${index})">✎</button>
                <button class="text-red-500 hover:text-red-700 text-xs px-1" onclick="removeCustomApi(${index})">✕</button>
            </div>
        `;
        container.appendChild(apiItem);
        apiItem.querySelector('input').addEventListener('change', function () {
            updateSelectedAPIs();
            checkAdultAPIsSelected();
        });
    });
}

// 编辑自定义API
function editCustomApi(index) {
    if (index < 0 || index >= customAPIs.length) return;
    const api = customAPIs[index];
    document.getElementById('customApiName').value = api.name;
    document.getElementById('customApiUrl').value = api.url;
    document.getElementById('customApiDetail').value = api.detail || '';
    const isAdultInput = document.getElementById('customApiIsAdult');
    if (isAdultInput) isAdultInput.checked = api.isAdult || false;
    const form = document.getElementById('addCustomApiForm');
    if (form) {
        form.classList.remove('hidden');
        const buttonContainer = form.querySelector('div:last-child');
        buttonContainer.innerHTML = `
            <button onclick="updateCustomApi(${index})" class="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-xs">更新</button>
            <button onclick="cancelEditCustomApi()" class="bg-[#444] hover:bg-[#555] text-white px-3 py-1 rounded text-xs">取消</button>
        `;
    }
}

// 更新自定义API
function updateCustomApi(index) {
    if (index < 0 || index >= customAPIs.length) return;
    const nameInput = document.getElementById('customApiName');
    const urlInput = document.getElementById('customApiUrl');
    const detailInput = document.getElementById('customApiDetail');
    const isAdultInput = document.getElementById('customApiIsAdult');
    const name = nameInput.value.trim();
    let url = urlInput.value.trim();
    const detail = detailInput ? detailInput.value.trim() : '';
    const isAdult = isAdultInput ? isAdultInput.checked : false;
    if (!name || !url) {
        showToast('请输入API名称和链接', 'warning');
        return;
    }
    if (!/^https?:\/\/.+/.test(url)) {
        showToast('API链接格式不正确，需以http://或https://开头', 'warning');
        return;
    }
    if (url.endsWith('/')) url = url.slice(0, -1);
    // 保存 detail 字段
    customAPIs[index] = { name, url, detail, isAdult };
    localStorage.setItem('customAPIs', JSON.stringify(customAPIs));
    renderCustomAPIsList();
    checkAdultAPIsSelected();
    restoreAddCustomApiButtons();
    nameInput.value = '';
    urlInput.value = '';
    if (detailInput) detailInput.value = '';
    if (isAdultInput) isAdultInput.checked = false;
    document.getElementById('addCustomApiForm').classList.add('hidden');
    showToast('已更新自定义API: ' + name, 'success');
}

// 取消编辑自定义API
function cancelEditCustomApi() {
    // 清空表单
    document.getElementById('customApiName').value = '';
    document.getElementById('customApiUrl').value = '';
    document.getElementById('customApiDetail').value = '';
    const isAdultInput = document.getElementById('customApiIsAdult');
    if (isAdultInput) isAdultInput.checked = false;

    // 隐藏表单
    document.getElementById('addCustomApiForm').classList.add('hidden');

    // 恢复添加按钮
    restoreAddCustomApiButtons();
}

// 恢复自定义API添加按钮
function restoreAddCustomApiButtons() {
    const form = document.getElementById('addCustomApiForm');
    const buttonContainer = form.querySelector('div:last-child');
    buttonContainer.innerHTML = `
        <button onclick="addCustomApi()" class="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-xs">添加</button>
        <button onclick="cancelAddCustomApi()" class="bg-[#444] hover:bg-[#555] text-white px-3 py-1 rounded text-xs">取消</button>
    `;
}

// 更新选中的API列表
function updateSelectedAPIs() {
    // 获取所有内置API复选框
    const builtInApiCheckboxes = document.querySelectorAll('#apiCheckboxes input:checked');

    // 获取选中的内置API
    const builtInApis = Array.from(builtInApiCheckboxes).map(input => input.dataset.api);

    // 获取选中的自定义API
    const customApiCheckboxes = document.querySelectorAll('#customApisList input:checked');
    const customApiIndices = Array.from(customApiCheckboxes).map(input => 'custom_' + input.dataset.customIndex);

    // 合并内置和自定义API
    selectedAPIs = [...builtInApis, ...customApiIndices];

    // 保存到localStorage
    localStorage.setItem('selectedAPIs', JSON.stringify(selectedAPIs));

    // 更新显示选中的API数量
    updateSelectedApiCount();
}

// 更新选中的API数量显示
function updateSelectedApiCount() {
    const countEl = document.getElementById('selectedApiCount');
    if (countEl) {
        countEl.textContent = selectedAPIs.length;
    }
}

// 全选或取消全选API
function selectAllAPIs(selectAll = true, excludeAdult = false) {
    const checkboxes = document.querySelectorAll('#apiCheckboxes input[type="checkbox"]');

    checkboxes.forEach(checkbox => {
        if (excludeAdult && checkbox.classList.contains('api-adult')) {
            checkbox.checked = false;
        } else {
            checkbox.checked = selectAll;
        }
    });

    updateSelectedAPIs();
    checkAdultAPIsSelected();
}

// 显示添加自定义API表单
function showAddCustomApiForm() {
    const form = document.getElementById('addCustomApiForm');
    if (form) {
        form.classList.remove('hidden');
    }
}

// 取消添加自定义API - 修改函数来重用恢复按钮逻辑
function cancelAddCustomApi() {
    const form = document.getElementById('addCustomApiForm');
    if (form) {
        form.classList.add('hidden');
        document.getElementById('customApiName').value = '';
        document.getElementById('customApiUrl').value = '';
        document.getElementById('customApiDetail').value = '';
        const isAdultInput = document.getElementById('customApiIsAdult');
        if (isAdultInput) isAdultInput.checked = false;

        // 确保按钮是添加按钮
        restoreAddCustomApiButtons();
    }
}

// 添加自定义API
function addCustomApi() {
    const nameInput = document.getElementById('customApiName');
    const urlInput = document.getElementById('customApiUrl');
    const detailInput = document.getElementById('customApiDetail');
    const isAdultInput = document.getElementById('customApiIsAdult');
    const name = nameInput.value.trim();
    let url = urlInput.value.trim();
    const detail = detailInput ? detailInput.value.trim() : '';
    const isAdult = isAdultInput ? isAdultInput.checked : false;
    if (!name || !url) {
        showToast('请输入API名称和链接', 'warning');
        return;
    }
    if (!/^https?:\/\/.+/.test(url)) {
        showToast('API链接格式不正确，需以http://或https://开头', 'warning');
        return;
    }
    if (url.endsWith('/')) {
        url = url.slice(0, -1);
    }
    // 保存 detail 字段
    customAPIs.push({ name, url, detail, isAdult });
    localStorage.setItem('customAPIs', JSON.stringify(customAPIs));
    const newApiIndex = customAPIs.length - 1;
    selectedAPIs.push('custom_' + newApiIndex);
    localStorage.setItem('selectedAPIs', JSON.stringify(selectedAPIs));

    // 重新渲染自定义API列表
    renderCustomAPIsList();
    updateSelectedApiCount();
    checkAdultAPIsSelected();
    nameInput.value = '';
    urlInput.value = '';
    if (detailInput) detailInput.value = '';
    if (isAdultInput) isAdultInput.checked = false;
    document.getElementById('addCustomApiForm').classList.add('hidden');
    showToast('已添加自定义API: ' + name, 'success');
}

// 移除自定义API
function removeCustomApi(index) {
    if (index < 0 || index >= customAPIs.length) return;

    const apiName = customAPIs[index].name;

    // 从列表中移除API
    customAPIs.splice(index, 1);
    localStorage.setItem('customAPIs', JSON.stringify(customAPIs));

    // 从选中列表中移除此API
    const customApiId = 'custom_' + index;
    selectedAPIs = selectedAPIs.filter(id => id !== customApiId);

    // 更新大于此索引的自定义API索引
    selectedAPIs = selectedAPIs.map(id => {
        if (id.startsWith('custom_')) {
            const currentIndex = parseInt(id.replace('custom_', ''));
            if (currentIndex > index) {
                return 'custom_' + (currentIndex - 1);
            }
        }
        return id;
    });

    localStorage.setItem('selectedAPIs', JSON.stringify(selectedAPIs));

    // 重新渲染自定义API列表
    renderCustomAPIsList();

    // 更新选中的API数量
    updateSelectedApiCount();

    // 重新检查成人API选中状态
    checkAdultAPIsSelected();

    showToast('已移除自定义API: ' + apiName, 'info');
}

function toggleSettings(e) {
    const settingsPanel = document.getElementById('settingsPanel');
    if (!settingsPanel) return;

    if (settingsPanel.classList.contains('show')) {
        settingsPanel.classList.remove('show');
    } else {
        settingsPanel.classList.add('show');
    }

    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
}

// 设置事件监听器
function setupEventListeners() {
    // 回车搜索
    document.getElementById('searchInput').addEventListener('keypress', function (e) {
        if (e.key === 'Enter') {
            search();
        }
    });

    // 点击外部关闭设置面板和历史记录面板
    document.addEventListener('click', function (e) {
        // 关闭设置面板
        const settingsPanel = document.querySelector('#settingsPanel.show');
        const settingsButton = document.querySelector('#settingsPanel .close-btn');

        if (settingsPanel && settingsButton &&
            !settingsPanel.contains(e.target) &&
            !settingsButton.contains(e.target)) {
            settingsPanel.classList.remove('show');
        }

        // 关闭历史记录面板
        const historyPanel = document.querySelector('#historyPanel.show');
        const historyButton = document.querySelector('#historyPanel .close-btn');

        if (historyPanel && historyButton &&
            !historyPanel.contains(e.target) &&
            !historyButton.contains(e.target)) {
            historyPanel.classList.remove('show');
        }
    });

    // 黄色内容过滤开关事件绑定
    const yellowFilterToggle = document.getElementById('yellowFilterToggle');
    if (yellowFilterToggle) {
        yellowFilterToggle.addEventListener('change', function (e) {
            localStorage.setItem('yellowFilterEnabled', e.target.checked);

            // 控制黄色内容接口的显示状态
            const adultdiv = document.getElementById('adultdiv');
            if (adultdiv) {
                if (e.target.checked === true) {
                    adultdiv.style.display = 'none';
                } else if (e.target.checked === false) {
                    adultdiv.style.display = ''
                }
            } else {
                // 添加成人API列表
                addAdultAPI();
            }
        });
    }

    // 广告过滤开关事件绑定
    const adFilterToggle = document.getElementById('adFilterToggle');
    if (adFilterToggle) {
        adFilterToggle.addEventListener('change', function (e) {
            localStorage.setItem(PLAYER_CONFIG.adFilteringStorage, e.target.checked);
        });
    }
}

// 重置搜索区域
function resetSearchArea() {
    // 清理搜索结果
    document.getElementById('results').innerHTML = '';
    document.getElementById('searchInput').value = '';

    // 恢复搜索区域的样式
    document.getElementById('searchArea').classList.add('flex-1');
    document.getElementById('searchArea').classList.remove('mb-8');
    document.getElementById('resultsArea').classList.add('hidden');

    // 确保页脚正确显示，移除相对定位
    const footer = document.querySelector('.footer');
    if (footer) {
        footer.style.position = '';
    }

    // 如果有豆瓣功能，检查是否需要显示豆瓣推荐区域
    if (typeof updateDoubanVisibility === 'function') {
        updateDoubanVisibility();
    }

    // 重置URL为主页
    try {
        window.history.pushState(
            {},
            `LibreTV - 免费在线视频搜索与观看平台`,
            `/`
        );
        // 更新页面标题
        document.title = `LibreTV - 免费在线视频搜索与观看平台`;
    } catch (e) {
        console.error('更新浏览器历史失败:', e);
    }
}

// 获取自定义API信息
function getCustomApiInfo(customApiIndex) {
    const index = parseInt(customApiIndex);
    if (isNaN(index) || index < 0 || index >= customAPIs.length) {
        return null;
    }
    return customAPIs[index];
}
// 优化搜索结果排序：按源分组，同源内按剧集顺序排列
// 搜索结果优化：严格合并同一部内容，避免电影/电视剧串源
function searchNormalizeV2(text) {
    return (text || '')
        .toString()
        .toLowerCase()
        .replace(/[·・\s\-_—~～,，.。:：;；!！?？'"“”‘’()[\]（）【】《》]/g, '')
        .trim();
}

function getSearchYearV2(item) {
    const y = parseInt(item.vod_year || '0', 10);
    return Number.isFinite(y) ? y : 0;
}

function getSearchCoreTitleV2(item) {
    let name = searchNormalizeV2(item.vod_name);

    name = name
        .replace(/第[一二三四五六七八九十\d]+季/g, '')
        .replace(/season\d+/g, '')
        .replace(/s\d+/g, '')
        .replace(/第\d+集/g, '')
        .replace(/\d+集全/g, '')
        .replace(/全\d+集/g, '')
        .replace(/更新至\d+集/g, '')
        .replace(/完结/g, '')
        .replace(/全集/g, '')
        .replace(/高清/g, '')
        .replace(/蓝光/g, '')
        .replace(/国语/g, '')
        .replace(/粤语/g, '')
        .replace(/hd/g, '')
        .replace(/bd/g, '')
        .replace(/正片/g, '')
        .trim();

    return name;
}

function getSearchCategoryV2(item) {
    const type = searchNormalizeV2(item.type_name);
    const name = searchNormalizeV2(item.vod_name);
    const remarks = searchNormalizeV2(item.vod_remarks);

    const hasEpisodeSignal =
        /第\d+集/.test(remarks) ||
        /更新至\d+集/.test(remarks) ||
        /\d+集全/.test(remarks) ||
        /全\d+集/.test(remarks) ||
        remarks.includes('完结') ||
        remarks.includes('全集');

    const hasMovieSignal =
        remarks.includes('正片') ||
        remarks.includes('hd') ||
        remarks.includes('bd') ||
        remarks.includes('蓝光') ||
        remarks.includes('tc');

    if (
        type.includes('电影') ||
        type.includes('喜剧片') ||
        type.includes('动作片') ||
        type.includes('剧情片') ||
        type.includes('科幻片') ||
        type.includes('爱情片') ||
        type.includes('恐怖片') ||
        type.includes('战争片') ||
        type.includes('纪录片')
    ) {
        return 'movie';
    }

    if (
        type.includes('国产剧') ||
        type.includes('大陆剧') ||
        type.includes('电视剧') ||
        type.includes('美剧') ||
        type.includes('欧美剧') ||
        type.includes('韩剧') ||
        type.includes('日剧') ||
        type.includes('港剧') ||
        type.includes('台剧') ||
        type.includes('泰剧') ||
        hasEpisodeSignal
    ) {
        return 'series';
    }

    if (type.includes('动漫') || type.includes('动画') || name.includes('动漫')) {
        return 'anime';
    }

    if (type.includes('综艺') || remarks.includes('综艺')) {
        return 'variety';
    }

    if (hasMovieSignal && !hasEpisodeSignal) {
        return 'movie';
    }

    return 'unknown';
}

function getEpisodeBucketV2(item) {
    const category = getSearchCategoryV2(item);
    const remarks = searchNormalizeV2(item.vod_remarks);

    if (category === 'movie') return 'movie';

    const match =
        remarks.match(/第(\d+)集/) ||
        remarks.match(/更新至(\d+)集/) ||
        remarks.match(/(\d+)集全/) ||
        remarks.match(/全(\d+)集/);

    if (!match) {
        return category === 'series' ? 'series_unknown' : 'unknown';
    }

    const count = parseInt(match[1], 10);

    if (!Number.isFinite(count)) return 'unknown';
    if (count <= 1) return 'single';
    if (count <= 12) return 'series_2_12';
    if (count <= 24) return 'series_13_24';
    if (count <= 60) return 'series_25_60';

    return 'series_60_plus';
}

function getSourceWeightV2(sourceCode) {
    const weights = {
        wujin: 35,
        ruyi: 32,
        bfzy: 30,
        tyyszy: 28,
        dyttzy: 25,
        jisu: 22,
        wolong: 20,
        zuid: 18,
        dbzy: 16,
        ffzy: 14,
        ikun: 12
    };

    return weights[sourceCode] || 0;
}

function scoreSearchItemV2(item, query) {
    const q = searchNormalizeV2(query);
    const name = searchNormalizeV2(item.vod_name);
    const remarks = searchNormalizeV2(item.vod_remarks);
    const type = searchNormalizeV2(item.type_name);
    const year = getSearchYearV2(item);

    let score = 0;

    if (name === q) score += 1000;
    else if (name.startsWith(q)) score += 800;
    else if (name.includes(q)) score += 600;

    if (type.includes(q)) score += 60;

    if (remarks.includes('完结') || remarks.includes('全集')) score += 50;
    if (remarks.includes('hd') || remarks.includes('高清') || remarks.includes('正片')) score += 25;
    if (remarks.includes('更新')) score += 15;

    if (item.vod_pic && /^https?:\/\//.test(item.vod_pic)) score += 20;

    if (year >= 2024) score += 16;
    else if (year >= 2020) score += 12;
    else if (year >= 2010) score += 8;
    else if (year > 0) score += 4;

    score += getSourceWeightV2(item.source_code);

    const badWords = ['解说', '预告', '花絮', '片段', '资讯', '短剧'];
    if (badWords.some(w => name.includes(w) || type.includes(w))) {
        score -= 150;
    }

    return score;
}

function canMergeSearchItemsV2(a, b) {
    const titleA = getSearchCoreTitleV2(a);
    const titleB = getSearchCoreTitleV2(b);

    if (!titleA || !titleB) return false;
    if (titleA !== titleB) return false;

    const categoryA = getSearchCategoryV2(a);
    const categoryB = getSearchCategoryV2(b);

    // 类型不明确时不合并，避免误把电影和电视剧揉在一起
    if (categoryA === 'unknown' || categoryB === 'unknown') return false;

    // 电影、电视剧、动漫、综艺必须类型一致才合并
    if (categoryA !== categoryB) return false;

    const yearA = getSearchYearV2(a);
    const yearB = getSearchYearV2(b);

    // 两边都有年份时，年份必须一致
    if (yearA && yearB && yearA !== yearB) return false;

    const bucketA = getEpisodeBucketV2(a);
    const bucketB = getEpisodeBucketV2(b);

    // 电影和剧集绝不合并
    if (bucketA === 'movie' && bucketB !== 'movie') return false;
    if (bucketB === 'movie' && bucketA !== 'movie') return false;

    // 都有明确集数区间时，区间差太大不合并
    if (
        bucketA !== 'unknown' &&
        bucketB !== 'unknown' &&
        bucketA !== 'series_unknown' &&
        bucketB !== 'series_unknown' &&
        bucketA !== bucketB
    ) {
        return false;
    }

    return true;
}

function searchNormalizeFlat(text) {
    return (text || '')
        .toString()
        .toLowerCase()
        .replace(/[·・\s\-_—~～,，.。:：;；!！?？'"“”‘’()[\]（）〖〗《》]/g, '')
        .trim();
}

function getFlatSourceWeight(sourceCode) {
    const weights = {
        ruyi: 32,
        bfzy: 30,
        tyyszy: 28,
        dyttzy: 25,
        wujin: 24,
        jisu: 22,
        wolong: 18,
        zuid: 16,
        dbzy: 14,
        ffzy: 12,
    };
    return weights[sourceCode] || 0;
}

const hardNoiseKeywords = [
    '电影解说',
    '影视解说',
    '剧情解说',
    '解说版',
    '预告片',
    '先导片',
    '花絮',
    '幕后',
    '娱乐资讯',
    '影视资讯',
    '几分钟看完',
    '分钟看完',
    '速看',
    '一口气看完',
    'reaction',
    '混剪',
    '盘点',
    '吐槽',
    '短视频',
    '小视频'
];

const softNoiseKeywords = [
    '解说',
    '预告',
    '资讯',
    '片段',
    'cut',
    '合集'
];

function getSearchableText(item) {
    return [
        item.vod_name,
        item.type_name,
        item.vod_remarks,
        item.vod_content,
        item.vod_blurb
    ].filter(Boolean).join(' ');
}

function getResultYear(item) {
    const directYear = parseInt(item.vod_year || item.year || '0', 10);
    if (directYear >= 1900 && directYear <= 2100) return directYear;

    const match = getSearchableText(item).match(/(19\d{2}|20\d{2}|2100)/);
    if (match) return parseInt(match[1], 10);

    return 0;
}

function getFlatTitleScore(item, query) {
    const q = searchNormalizeFlat(query);
    const name = searchNormalizeFlat(item.vod_name);

    if (!q || !name) return 0;
    if (name === q) return 100;
    if (name.startsWith(q)) return 90;
    if (name.includes(q)) return 70;
    return -50;
}

function getFlatQualityScore(item) {
    const name = searchNormalizeFlat(item.vod_name);
    const remarks = searchNormalizeFlat(item.vod_remarks);
    const type = searchNormalizeFlat(item.type_name);
    const text = searchNormalizeFlat(getSearchableText(item));

    let score = 0;

    if (remarks.includes('完结') || remarks.includes('全集')) score += 20;
    if (remarks.includes('正片')) score += 18;
    if (remarks.includes('高清') || remarks.includes('蓝光') || remarks.includes('hd') || remarks.includes('bd')) score += 10;

    if (type.includes('电影')) score += 12;
    if (type.includes('电视剧')) score += 12;
    if (type.includes('国产剧')) score += 12;
    if (type.includes('动漫')) score += 12;
    if (type.includes('番剧')) score += 12;
    if (type.includes('综艺')) score += 6;

    if (name.includes('剧场版')) score += 15;
    if (name.includes('电影')) score += 8;
    if (name.includes('特别篇')) score += 6;
    if (name.includes('ova')) score += 6;
    if (name.includes('sp')) score += 4;

    softNoiseKeywords.forEach(keyword => {
        if (text.includes(searchNormalizeFlat(keyword))) score -= 45;
    });

    return score;
}

function isHardNoiseResult(item) {
    const text = searchNormalizeFlat(getSearchableText(item));
    return hardNoiseKeywords.some(keyword => text.includes(searchNormalizeFlat(keyword)));
}

function getSearchResultType(item) {
    const type = searchNormalizeFlat(item.type_name);
    const name = searchNormalizeFlat(item.vod_name);

    if (type.includes('动漫') || type.includes('动画') || type.includes('番剧') || name.includes('动漫')) {
        return 'anime';
    }

    if (type.includes('综艺')) {
        return 'variety';
    }

    const category = getSearchCategoryV2(item);
    if (category === 'movie') return 'movie';
    if (category === 'series') return 'series';
    return 'unknown';
}

function getYearFilterBucket(item) {
    const year = getResultYear(item);
    if (!year) return 'unknown';
    if (year >= 2020) return '2020';
    if (year >= 2010) return '2010';
    if (year >= 2000) return '2000';
    if (year >= 1990) return '1990';
    return 'earlier';
}

function sortSearchResults(results, query, sortMode = 'latest') {
    return [...results].sort((a, b) => {
        const yearA = getResultYear(a);
        const yearB = getResultYear(b);
        const titleDiff = getFlatTitleScore(b, query) - getFlatTitleScore(a, query);
        const qualityDiff = getFlatQualityScore(b) - getFlatQualityScore(a);
        const sourceDiff = getFlatSourceWeight(b.source_code) - getFlatSourceWeight(a.source_code);

        if (sortMode === 'relevance') {
            if (titleDiff !== 0) return titleDiff;
            if (!!yearB !== !!yearA) return yearB ? 1 : -1;
            if (yearB !== yearA) return yearB - yearA;
            if (qualityDiff !== 0) return qualityDiff;
            if (sourceDiff !== 0) return sourceDiff;
            return (a.vod_name || '').localeCompare(b.vod_name || '');
        }

        if (sortMode === 'source') {
            if (sourceDiff !== 0) return sourceDiff;
            if (!!yearB !== !!yearA) return yearB ? 1 : -1;
            if (yearB !== yearA) return yearB - yearA;
            if (titleDiff !== 0) return titleDiff;
            if (qualityDiff !== 0) return qualityDiff;
            return (a.vod_name || '').localeCompare(b.vod_name || '');
        }

        if (!!yearB !== !!yearA) return yearB ? 1 : -1;
        if (yearB !== yearA) return yearB - yearA;
        if (titleDiff !== 0) return titleDiff;
        if (qualityDiff !== 0) return qualityDiff;
        if (sourceDiff !== 0) return sourceDiff;
        return (a.vod_name || '').localeCompare(b.vod_name || '');
    });
}

function optimizeSearchResults(results, query = '') {
    if (!Array.isArray(results)) return [];

    const seen = new Set();
    const flatResults = [];

    results.forEach((item, index) => {
        if (!item || !item.vod_name) return;
        if (isHardNoiseResult(item)) return;

        const sourceCode = item.source_code || '';
        const apiUrl = item.api_url || '';
        const vodId = item.vod_id || '';
        const dedupeKey = vodId
            ? `${sourceCode}:${apiUrl}:${vodId}`
            : `${sourceCode}:${apiUrl}:missing-id:${index}`;

        if (seen.has(dedupeKey)) return;
        seen.add(dedupeKey);

        flatResults.push({
            ...item,
            _mergedCount: 1,
            _mergedSources: null,
            _groupId: '',
            _titleScore: getFlatTitleScore(item, query),
            _qualityScore: getFlatQualityScore(item),
            _resultYear: getResultYear(item)
        });
    });

    mergedSearchGroups = {};

    return sortSearchResults(flatResults, query, 'latest');
}

function getSearchResultSourceKey(item) {
    return item.source_code || item.source_name || 'unknown';
}

function getSourceFilterOptions(results) {
    const counts = new Map();
    const labels = new Map();

    results.forEach(item => {
        const key = getSearchResultSourceKey(item);
        counts.set(key, (counts.get(key) || 0) + 1);
        labels.set(key, item.source_name || item.source_code || '未知来源');
    });

    return Array.from(counts.entries())
        .map(([key, count]) => ({
            key,
            count,
            label: labels.get(key)
        }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function ensureSearchFilterToolbar() {
    const resultsDiv = document.getElementById('results');
    let toolbar = document.getElementById('searchFilterToolbar');

    if (!toolbar && resultsDiv && resultsDiv.parentNode) {
        toolbar = document.createElement('div');
        toolbar.id = 'searchFilterToolbar';
        toolbar.className = 'search-filter-toolbar';
        resultsDiv.parentNode.insertBefore(toolbar, resultsDiv);
    }

    let loadMore = document.getElementById('searchLoadMore');
    if (!loadMore && resultsDiv && resultsDiv.parentNode) {
        loadMore = document.createElement('div');
        loadMore.id = 'searchLoadMore';
        loadMore.className = 'search-load-more';
        resultsDiv.parentNode.insertBefore(loadMore, resultsDiv.nextSibling);
    }

    return toolbar;
}

function renderSearchFilterToolbar() {
    const toolbar = ensureSearchFilterToolbar();
    if (!toolbar) return;

    const sourceOptions = getSourceFilterOptions(currentSearchResults)
        .map(source => `<option value="${escapeHtml(source.key)}" ${searchResultFilters.source === source.key ? 'selected' : ''}>${escapeHtml(source.label)} (${source.count})</option>`)
        .join('');

    toolbar.innerHTML = `
        <div class="search-filter-group">
            <label for="searchSortMode">排序</label>
            <select id="searchSortMode">
                <option value="latest" ${searchResultFilters.sort === 'latest' ? 'selected' : ''}>最新优先</option>
                <option value="relevance" ${searchResultFilters.sort === 'relevance' ? 'selected' : ''}>相关优先</option>
                <option value="source" ${searchResultFilters.sort === 'source' ? 'selected' : ''}>来源优先</option>
            </select>
        </div>
        <div class="search-filter-group">
            <label for="searchTypeFilter">类型</label>
            <select id="searchTypeFilter">
                <option value="all" ${searchResultFilters.type === 'all' ? 'selected' : ''}>全部</option>
                <option value="movie" ${searchResultFilters.type === 'movie' ? 'selected' : ''}>电影</option>
                <option value="series" ${searchResultFilters.type === 'series' ? 'selected' : ''}>电视剧</option>
                <option value="anime" ${searchResultFilters.type === 'anime' ? 'selected' : ''}>动漫</option>
                <option value="variety" ${searchResultFilters.type === 'variety' ? 'selected' : ''}>综艺</option>
            </select>
        </div>
        <div class="search-filter-group">
            <label for="searchSourceFilter">来源</label>
            <select id="searchSourceFilter">
                <option value="all" ${searchResultFilters.source === 'all' ? 'selected' : ''}>全部来源</option>
                ${sourceOptions}
            </select>
        </div>
        <div class="search-filter-group">
            <label for="searchYearFilter">年份</label>
            <select id="searchYearFilter">
                <option value="all" ${searchResultFilters.year === 'all' ? 'selected' : ''}>全部年份</option>
                <option value="2020" ${searchResultFilters.year === '2020' ? 'selected' : ''}>2020+</option>
                <option value="2010" ${searchResultFilters.year === '2010' ? 'selected' : ''}>2010-2019</option>
                <option value="2000" ${searchResultFilters.year === '2000' ? 'selected' : ''}>2000-2009</option>
                <option value="1990" ${searchResultFilters.year === '1990' ? 'selected' : ''}>1990-1999</option>
                <option value="earlier" ${searchResultFilters.year === 'earlier' ? 'selected' : ''}>更早</option>
                <option value="unknown" ${searchResultFilters.year === 'unknown' ? 'selected' : ''}>未知年份</option>
            </select>
        </div>
    `;

    document.getElementById('searchSortMode')?.addEventListener('change', event => {
        searchResultFilters.sort = event.target.value;
        applySearchFilters(true);
    });
    document.getElementById('searchTypeFilter')?.addEventListener('change', event => {
        searchResultFilters.type = event.target.value;
        applySearchFilters(true);
    });
    document.getElementById('searchSourceFilter')?.addEventListener('change', event => {
        searchResultFilters.source = event.target.value;
        applySearchFilters(true);
    });
    document.getElementById('searchYearFilter')?.addEventListener('change', event => {
        searchResultFilters.year = event.target.value;
        applySearchFilters(true);
    });
}

function getFilteredSearchResults() {
    let results = currentSearchResults.filter(item => {
        if (searchResultFilters.type !== 'all' && getSearchResultType(item) !== searchResultFilters.type) {
            return false;
        }

        if (searchResultFilters.source !== 'all' && getSearchResultSourceKey(item) !== searchResultFilters.source) {
            return false;
        }

        if (searchResultFilters.year !== 'all' && getYearFilterBucket(item) !== searchResultFilters.year) {
            return false;
        }

        return true;
    });

    return sortSearchResults(results, currentSearchQuery, searchResultFilters.sort);
}

function updateSearchResultCount() {
    const countEl = document.getElementById('searchResultsCount');
    const countContainer = countEl ? countEl.parentElement : null;
    const total = currentSearchResults.length;
    const filtered = filteredSearchResults.length;
    const shown = Math.min(visibleSearchResultCount, filtered);
    const message = filtered === total
        ? `共 ${total} 个结果，当前显示 ${shown} 个`
        : `筛选后 ${filtered} 个结果 · 已显示 ${shown} / 共 ${total}`;

    if (countContainer) {
        countContainer.innerHTML = `<span id="searchResultsCount">${escapeHtml(message)}</span>`;
    }
}

function renderNoSearchResults(message = '没有找到匹配的结果', description = '请尝试其他关键词或更换筛选条件') {
    const resultsDiv = document.getElementById('results');
    if (!resultsDiv) return;

    resultsDiv.innerHTML = `
        <div class="col-span-full text-center py-16">
            <svg class="mx-auto h-12 w-12 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                      d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h3 class="mt-2 text-lg font-medium text-gray-400">${escapeHtml(message)}</h3>
            <p class="mt-1 text-sm text-gray-500">${escapeHtml(description)}</p>
        </div>
    `;
}

function renderSearchResults() {
    const resultsDiv = document.getElementById('results');
    if (!resultsDiv) return;

    updateSearchResultCount();

    if (filteredSearchResults.length === 0) {
        renderNoSearchResults();
        renderSearchLoadMore();
        return;
    }

    const visibleResults = filteredSearchResults.slice(0, visibleSearchResultCount);
    const safeResults = visibleResults.map(item => renderSearchResultCard(item)).join('');
    resultsDiv.innerHTML = safeResults;
    renderSearchLoadMore();
}

function renderSearchLoadMore() {
    const loadMore = document.getElementById('searchLoadMore');
    if (!loadMore) return;

    const shown = Math.min(visibleSearchResultCount, filteredSearchResults.length);
    if (shown >= filteredSearchResults.length) {
        loadMore.innerHTML = '';
        return;
    }

    loadMore.innerHTML = `
        <button type="button" onclick="loadMoreSearchResults()" class="search-load-more-btn">
            加载更多
        </button>
    `;
}

function loadMoreSearchResults() {
    visibleSearchResultCount += SEARCH_PAGE_SIZE;
    renderSearchResults();
}

function applySearchFilters(resetVisible = false) {
    if (resetVisible) {
        visibleSearchResultCount = SEARCH_PAGE_SIZE;
    }

    filteredSearchResults = getFilteredSearchResults();
    renderSearchFilterToolbar();
    renderSearchResults();
}

function renderSearchResultCard(item) {
    const safeId = item.vod_id ? item.vod_id.toString().replace(/[^\w-]/g, '') : '';
    const safeName = escapeHtml(item.vod_name || '');
    const safeNameForJs = escapeJsString(safeName);
    const safeSourceCode = escapeJsString(item.source_code || '');
    const sourceText = item.source_name || '';
    const sourceInfo = sourceText
        ? `<span class="bg-[#222] text-xs px-1.5 py-0.5 rounded-full">${escapeHtml(sourceText)}</span>`
        : '';
    const apiUrlAttr = item.api_url ? `data-api-url="${escapeHtml(item.api_url)}"` : '';
    const typeName = item.type_name ? escapeHtml(item.type_name) : '';
    const year = getResultYear(item) || item.vod_year || '';
    const remarks = escapeHtml(item.vod_remarks || '暂无介绍');
    const hasCover = item.vod_pic && item.vod_pic.startsWith('http');
    const safePic = hasCover ? escapeHtml(item.vod_pic) : '';

    return `
        <div class="card-hover bg-[#111] rounded-lg overflow-hidden cursor-pointer transition-all hover:scale-[1.02] h-full shadow-sm hover:shadow-md"
             onclick="showDetails('${safeId}','${safeNameForJs}','${safeSourceCode}')" ${apiUrlAttr}>
            <div class="flex h-full">
                <div class="relative flex-shrink-0 search-card-img-container ${hasCover ? '' : 'image-error'}">
                    <div class="search-card-placeholder">无封面</div>
                    ${hasCover ? `
                    <img src="${safePic}" alt="${safeName}"
                         class="search-card-img transition-transform hover:scale-105"
                         onerror="this.onerror=null; this.closest('.search-card-img-container').classList.add('image-error'); this.remove();"
                         loading="lazy">` : ''}
                </div>

                <div class="p-2 flex flex-col flex-grow min-w-0">
                    <div class="flex-grow">
                        <h3 class="font-semibold mb-2 break-words line-clamp-2" title="${safeName}">${safeName}</h3>

                        <div class="flex flex-wrap gap-1 mb-2">
                            ${typeName ? `<span class="text-xs py-0.5 px-1.5 rounded bg-opacity-20 bg-blue-500 text-blue-300">${typeName}</span>` : ''}
                            ${year ? `<span class="text-xs py-0.5 px-1.5 rounded bg-opacity-20 bg-purple-500 text-purple-300">${escapeHtml(year)}</span>` : ''}
                        </div>
                        <p class="text-gray-400 line-clamp-2 overflow-hidden mb-2">${remarks}</p>
                    </div>

                    <div class="flex justify-between items-center mt-1 pt-1 border-t border-gray-800">
                        ${sourceInfo ? `<div>${sourceInfo}</div>` : '<div></div>'}
                    </div>
                </div>
            </div>
        </div>
    `;
}

// 搜索功能 - 修改为支持多选API和多页结果
async function search() {
    // 强化的密码保护校验 - 防止绕过
    try {
        if (window.ensurePasswordProtection) {
            window.ensurePasswordProtection();
        } else {
            // 兼容性检查
            if (window.isPasswordProtected && window.isPasswordVerified) {
                if (window.isPasswordProtected() && !window.isPasswordVerified()) {
                    showPasswordModal && showPasswordModal();
                    return;
                }
            }
        }
    } catch (error) {
        console.warn('Password protection check failed:', error.message);
        return;
    }
    const query = document.getElementById('searchInput').value.trim();

    if (!query) {
        showToast('请输入搜索内容', 'info');
        return;
    }

    if (selectedAPIs.length === 0) {
        showToast('请至少选择一个API源', 'warning');
        return;
    }

    showLoading();

    try {
        // 保存搜索历史
        saveSearchHistory(query);

        // 从所有选中的API源搜索
        let allResults = [];
        const searchPromises = selectedAPIs.map(apiId => 
            searchByAPIAndKeyWord(apiId, query)
        );

        // 等待所有搜索请求完成
        const resultsArray = await Promise.all(searchPromises);

        // 合并所有结果
        resultsArray.forEach(results => {
            if (Array.isArray(results) && results.length > 0) {
                allResults = allResults.concat(results);
            }
        });

        // 显示结果区域，调整搜索区域
        document.getElementById('searchArea').classList.remove('flex-1');
        document.getElementById('searchArea').classList.add('mb-8');
        document.getElementById('resultsArea').classList.remove('hidden');

        // 隐藏豆瓣推荐区域（如果存在）
        const doubanArea = document.getElementById('doubanArea');
        if (doubanArea) {
            doubanArea.classList.add('hidden');
        }

        // 处理搜索结果过滤：如果启用了黄色内容过滤，则过滤掉分类含有敏感内容的项目
        const yellowFilterEnabled = localStorage.getItem('yellowFilterEnabled') === 'true';
        if (yellowFilterEnabled) {
            const banned = ['伦理片', '福利', '里番动漫', '门事件', '萝莉少女', '制服诱惑', '国产传媒', 'cosplay', '黑丝诱惑', '无码', '日本无码', '有码', '日本有码', 'SWAG', '网红主播', '色情片', '同性片', '福利视频', '福利片'];
            allResults = allResults.filter(item => {
                const typeName = item.type_name || '';
                return !banned.some(keyword => typeName.includes(keyword));
            });
        }

        // 过滤短剧内容
        allResults = allResults.filter(item => {
            const typeName = item.type_name || '';
            const vodName = item.vod_name || '';
            
            // 短剧关键词过滤
            const shortDramaKeywords = ['短剧', '微短剧', '竖屏剧', '小短剧'];
            
            return !shortDramaKeywords.some(keyword => 
                typeName.includes(keyword) || vodName.includes(keyword)
            );
        });

        // 优化排序并初始化本地筛选状态，不恢复跨源聚合
        currentSearchQuery = query;
        currentSearchResults = optimizeSearchResults(allResults, query);
        filteredSearchResults = [];
        visibleSearchResultCount = SEARCH_PAGE_SIZE;
        searchResultFilters = {
            sort: 'latest',
            type: 'all',
            source: 'all',
            year: 'all'
        };

        ensureSearchFilterToolbar();

        if (!currentSearchResults || currentSearchResults.length === 0) {
            renderSearchFilterToolbar();
            filteredSearchResults = [];
            updateSearchResultCount();
            renderNoSearchResults('没有找到匹配的结果', '请尝试其他关键词或更换数据源');
            renderSearchLoadMore();
            hideLoading();
            return;
        }

        // 有搜索结果时，才更新URL
        try {
            const encodedQuery = encodeURIComponent(query);
            window.history.pushState(
                { search: query },
                `搜索: ${query} - LibreTV`,
                `/s=${encodedQuery}`
            );
            document.title = `搜索: ${query} - LibreTV`;
        } catch (e) {
            console.error('更新浏览器历史失败:', e);
        }

        applySearchFilters(true);
    } catch (error) {
        console.error('搜索错误:', error);
        if (error.name === 'AbortError') {
            showToast('搜索请求超时，请检查网络连接', 'error');
        } else {
            showToast('搜索请求失败，请稍后重试', 'error');
        }
    } finally {
        hideLoading();
    }
}

// 切换清空按钮的显示状态
function toggleClearButton() {
    const searchInput = document.getElementById('searchInput');
    const clearButton = document.getElementById('clearSearchInput');
    if (searchInput.value !== '') {
        clearButton.classList.remove('hidden');
    } else {
        clearButton.classList.add('hidden');
    }
}

// 清空搜索框内容
function clearSearchInput() {
    const searchInput = document.getElementById('searchInput');
    searchInput.value = '';
    const clearButton = document.getElementById('clearSearchInput');
    clearButton.classList.add('hidden');
}

// 劫持搜索框的value属性以检测外部修改
function hookInput() {
    const input = document.getElementById('searchInput');
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

    // 重写 value 属性的 getter 和 setter
    Object.defineProperty(input, 'value', {
        get: function () {
            // 确保读取时返回字符串（即使原始值为 undefined/null）
            const originalValue = descriptor.get.call(this);
            return originalValue != null ? String(originalValue) : '';
        },
        set: function (value) {
            // 显式将值转换为字符串后写入
            const strValue = String(value);
            descriptor.set.call(this, strValue);
            this.dispatchEvent(new Event('input', { bubbles: true }));
        }
    });

    // 初始化输入框值为空字符串（避免初始值为 undefined）
    input.value = '';
}
document.addEventListener('DOMContentLoaded', hookInput);

function showSourcePicker(groupId) {
    const item = mergedSearchGroups[groupId];

    if (!item || !item._mergedSources || item._mergedSources.length === 0) {
        showToast('没有可用资源，请重新搜索', 'warning');
        return;
    }

    const modal = document.getElementById('modal');
    const modalTitle = document.getElementById('modalTitle');
    const modalContent = document.getElementById('modalContent');

    const safeTitle = (item.vod_name || '未知视频')
        .toString()
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    modalTitle.innerHTML = `<span class="break-words">${safeTitle}</span>`;

    const sourcesHtml = item._mergedSources.map((source, index) => {
        const sourceName = source.source_name || '未知资源';
        const remarks = source.vod_remarks || item.vod_remarks || '暂无备注';
        const typeName = source.type_name || item.type_name || '';
        const year = source.vod_year || item.vod_year || '';
        const sourceCode = source.source_code || '';
        const vodId = source.vod_id || '';
        const vodName = (source.vod_name || item.vod_name || '').replace(/'/g, "\\'");

        return `
            <button
                onclick="showDetails('${vodId}', '${vodName}', '${sourceCode}')"
                class="w-full text-left p-4 rounded-lg bg-[#1b2636] hover:bg-[#223247] border border-[#29445f] transition-all">
                <div class="flex items-center justify-between gap-3">
                    <div class="min-w-0">
                        <div class="font-semibold text-white truncate">
                            ${index + 1}. ${sourceName}
                        </div>
                        <div class="text-xs text-gray-400 mt-1">
                            ${typeName ? `<span class="mr-2">${typeName}</span>` : ''}
                            ${year ? `<span class="mr-2">${year}</span>` : ''}
                            <span>${remarks}</span>
                        </div>
                    </div>
                    <div class="text-sm text-blue-300 flex-shrink-0">
                        查看
                    </div>
                </div>
            </button>
        `;
    }).join('');

    modalContent.innerHTML = `
        <div class="mb-4 text-sm text-gray-400">
            找到 ${item._mergedSources.length} 个可用资源。某个源打不开时，返回这里换一个源即可。
        </div>
        <div class="space-y-3">
            ${sourcesHtml}
        </div>
    `;

    modal.classList.remove('hidden');
}

function escapeHtml(value) {
    return (value || '')
        .toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeJsString(value) {
    return (value || '')
        .toString()
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\r?\n/g, ' ');
}

function getEpisodeUrl(episode) {
    return typeof episode === 'string' ? episode : (episode && episode.url) || '';
}

function getEpisodeName(episode, index) {
    if (episode && typeof episode === 'object' && episode.name) {
        return episode.name;
    }
    return `第${index + 1}集`;
}

function normalizeEpisodeList(episodes) {
    if (!Array.isArray(episodes)) return [];

    return episodes.map((episode, index) => {
        if (typeof episode === 'string') {
            return {
                name: `第${index + 1}集`,
                url: episode
            };
        }

        if (episode && typeof episode === 'object') {
            return {
                name: episode.name || `第${index + 1}集`,
                url: episode.url || ''
            };
        }

        return null;
    }).filter(episode => episode && episode.url);
}

function normalizePlaySources(playSources, fallbackEpisodes) {
    if (Array.isArray(playSources) && playSources.length > 0) {
        return playSources.map((source, index) => {
            const episodes = normalizeEpisodeList(source.episodes);
            if (episodes.length === 0) return null;

            return {
                name: source.name || `播放源 ${index + 1}`,
                episodes
            };
        }).filter(Boolean);
    }

    const episodes = normalizeEpisodeList(fallbackEpisodes);
    return episodes.length > 0 ? [{ name: '播放源 1', episodes }] : [];
}

function hasPlayableEpisodes(episodes) {
    return Array.isArray(episodes) && episodes.some(episode => getEpisodeUrl(episode));
}

function getPlayableEpisodes(data) {
    if (!data) return [];

    if (hasPlayableEpisodes(data.episodes)) {
        return data.episodes.filter(episode => getEpisodeUrl(episode));
    }

    if (Array.isArray(data.playSources)) {
        const source = data.playSources.find(item => hasPlayableEpisodes(item.episodes));
        return source ? source.episodes.filter(episode => getEpisodeUrl(episode)) : [];
    }

    return [];
}

function getPlayableSourceIndex(playSources, preferredIndex = 0) {
    if (!Array.isArray(playSources) || playSources.length === 0) return -1;

    if (playSources[preferredIndex] && hasPlayableEpisodes(playSources[preferredIndex].episodes)) {
        return preferredIndex;
    }

    return playSources.findIndex(source => hasPlayableEpisodes(source.episodes));
}

function getCurrentPlaySourceName() {
    return currentPlaySources[currentPlaySourceIndex]?.name || '';
}

function getCurrentEpisodeUrls() {
    return currentEpisodes.map(getEpisodeUrl).filter(Boolean);
}

function renderPlaySourceButtons(sourceCode, vodId) {
    if (!Array.isArray(currentPlaySources) || currentPlaySources.length <= 1) return '';

    return `
        <div class="mb-4">
            <div class="text-sm text-gray-400 mb-2">播放源</div>
            <div class="flex flex-wrap gap-2" id="playSourceButtons">
                ${currentPlaySources.map((source, index) => {
                    const active = index === currentPlaySourceIndex;
                    return `
                        <button onclick="switchPlaySource(${index}, '${escapeJsString(sourceCode)}', '${escapeJsString(vodId)}')"
                                class="px-3 py-1.5 rounded text-sm border transition-colors ${active ? 'bg-blue-600 border-blue-500 text-white' : 'bg-[#222] hover:bg-[#333] border-[#333] text-gray-300'}"
                                title="${escapeHtml(source.name)}">
                            ${escapeHtml(source.name)}
                        </button>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}

function updateEpisodeStats() {
    const stats = document.getElementById('episodeStats');
    if (!stats) return;

    const sourceName = getCurrentPlaySourceName();
    stats.textContent = sourceName
        ? `当前源共 ${currentEpisodes.length} 集 · 当前源：${sourceName}`
        : `当前源共 ${currentEpisodes.length} 集`;
}

function switchPlaySource(index, sourceCode, vodId) {
    const source = currentPlaySources[index];
    if (!source) return;

    currentPlaySourceIndex = index;
    currentEpisodes = source.episodes;
    currentEpisodeIndex = 0;

    const sourceContainer = document.getElementById('playSourceContainer');
    if (sourceContainer) {
        sourceContainer.innerHTML = renderPlaySourceButtons(sourceCode, vodId);
    }

    const episodesGrid = document.getElementById('episodesGrid');
    if (episodesGrid) {
        episodesGrid.innerHTML = renderEpisodes(currentVideoTitle, sourceCode, vodId);
    }

    updateEpisodeStats();
}

function playEpisode(episodeIndex, sourceCode, vodId) {
    const episode = currentEpisodes[episodeIndex];
    const url = getEpisodeUrl(episode);

    if (!url) {
        showToast('该集播放链接无效', 'error');
        return;
    }

    playVideo(url, currentVideoTitle, sourceCode, episodeIndex, vodId);
}

// 显示详情 - 修改为支持自定义API
async function showDetails(id, vod_name, sourceCode) {
    // 密码保护校验
    if (window.isPasswordProtected && window.isPasswordVerified) {
        if (window.isPasswordProtected() && !window.isPasswordVerified()) {
            showPasswordModal && showPasswordModal();
            return;
        }
    }
    if (!id) {
        showToast('视频ID无效', 'error');
        return;
    }

    showLoading();
    try {
        // 构建API参数
        let apiParams = '';

        // 处理自定义API源
        if (sourceCode.startsWith('custom_')) {
            const customIndex = sourceCode.replace('custom_', '');
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
            apiParams = '&source=' + sourceCode;
        }

        // Add a timestamp to prevent caching
        const timestamp = new Date().getTime();
        const cacheBuster = `&_t=${timestamp}`;
        const response = await fetch(`/api/detail?id=${encodeURIComponent(id)}${apiParams}${cacheBuster}`);

        const data = await response.json();

        const modal = document.getElementById('modal');
        const modalTitle = document.getElementById('modalTitle');
        const modalContent = document.getElementById('modalContent');

        // 显示来源信息
        const sourceName = data.videoInfo && data.videoInfo.source_name ?
            ` <span class="text-sm font-normal text-gray-400">(${data.videoInfo.source_name})</span>` : '';

        // 不对标题进行截断处理，允许完整显示
        modalTitle.innerHTML = `<span class="break-words">${vod_name || '未知视频'}</span>${sourceName}`;
        currentVideoTitle = vod_name || '未知视频';
		currentVideoYear = (data.videoInfo && data.videoInfo.year) ? String(data.videoInfo.year) : ''; // 新增

        currentPlaySources = normalizePlaySources(data.playSources, data.episodes);
        const preferredSourceIndex = Number.isInteger(data.selectedPlaySourceIndex) ? data.selectedPlaySourceIndex : 0;
        currentPlaySourceIndex = getPlayableSourceIndex(currentPlaySources, preferredSourceIndex);
        currentEpisodes = currentPlaySourceIndex >= 0
            ? currentPlaySources[currentPlaySourceIndex].episodes.filter(episode => getEpisodeUrl(episode))
            : getPlayableEpisodes(data);

        if (hasPlayableEpisodes(currentEpisodes)) {
            // 构建详情信息HTML
            let detailInfoHtml = '';
            if (data.videoInfo) {
                // Prepare description text, strip HTML and trim whitespace
                const descriptionText = data.videoInfo.desc ? data.videoInfo.desc.replace(/<[^>]+>/g, '').trim() : '';

                // Check if there's any actual grid content
                const hasGridContent = data.videoInfo.type || data.videoInfo.year || data.videoInfo.area || data.videoInfo.director || data.videoInfo.actor || data.videoInfo.remarks;

                if (hasGridContent || descriptionText) { // Only build if there's something to show
                    detailInfoHtml = `
                <div class="modal-detail-info">
                    ${hasGridContent ? `
                    <div class="detail-grid">
                        ${data.videoInfo.type ? `<div class="detail-item"><span class="detail-label">类型:</span> <span class="detail-value">${data.videoInfo.type}</span></div>` : ''}
                        ${data.videoInfo.year ? `<div class="detail-item"><span class="detail-label">年份:</span> <span class="detail-value">${data.videoInfo.year}</span></div>` : ''}
                        ${data.videoInfo.area ? `<div class="detail-item"><span class="detail-label">地区:</span> <span class="detail-value">${data.videoInfo.area}</span></div>` : ''}
                        ${data.videoInfo.director ? `<div class="detail-item"><span class="detail-label">导演:</span> <span class="detail-value">${data.videoInfo.director}</span></div>` : ''}
                        ${data.videoInfo.actor ? `<div class="detail-item"><span class="detail-label">主演:</span> <span class="detail-value">${data.videoInfo.actor}</span></div>` : ''}
                        ${data.videoInfo.remarks ? `<div class="detail-item"><span class="detail-label">备注:</span> <span class="detail-value">${data.videoInfo.remarks}</span></div>` : ''}
                    </div>` : ''}
                    ${descriptionText ? `
                    <div class="detail-desc">
                        <p class="detail-label">简介:</p>
                        <p class="detail-desc-content">${descriptionText}</p>
                    </div>` : ''}
                </div>
                `;
                }
            }

            currentEpisodeIndex = 0;

            modalContent.innerHTML = `
                ${detailInfoHtml}
                <div id="playSourceContainer">
                    ${renderPlaySourceButtons(sourceCode, id)}
                </div>
                <div class="detail-episode-actions flex flex-wrap items-center justify-between mb-4 gap-2">
                    <div class="episode-toolbar flex items-center gap-2">
                        <button onclick="toggleEpisodeOrder('${sourceCode}', '${id}')" 
                                class="px-3 py-1.5 bg-[#333] hover:bg-[#444] border border-[#444] rounded text-sm transition-colors flex items-center gap-1">
                            <svg class="w-4 h-4 transform ${episodesReversed ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3"></path>
                            </svg>
                            <span>${episodesReversed ? '正序排列' : '倒序排列'}</span>
                        </button>
                        <span id="episodeStats" class="episode-summary text-gray-400 text-sm">当前源共 ${currentEpisodes.length} 集${getCurrentPlaySourceName() ? ` · 当前源：${escapeHtml(getCurrentPlaySourceName())}` : ''}</span>
                    </div>
                    <button onclick="copyLinks()" class="detail-copy-links px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm transition-colors">
                        复制链接
                    </button>
                </div>
                <div id="episodesGrid" class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
                    ${renderEpisodes(vod_name, sourceCode, id)}
                </div>
            `;
        } else {
            console.warn('[Detail Debug] 未找到可播放资源', {
                sourceCode,
                id,
                episodes: data?.episodes,
                playSources: data?.playSources
            });
            modalContent.innerHTML = `
                <div class="text-center py-8">
                    <div class="text-red-400 mb-2">❌ 未找到播放资源</div>
                    <div class="text-gray-500 text-sm">该视频可能暂时无法播放，请尝试其他视频</div>
                </div>
            `;
        }

        modal.classList.remove('hidden');
    } catch (error) {
        console.error('获取详情错误:', error);
        showToast('获取详情失败，请稍后重试', 'error');
    } finally {
        hideLoading();
    }
}

// 更新播放视频函数，修改为使用/watch路径而不是直接打开player.html
function playVideo(url, vod_name, sourceCode, episodeIndex = 0, vodId = '') {
    // 密码保护校验
    if (window.isPasswordProtected && window.isPasswordVerified) {
        if (window.isPasswordProtected() && !window.isPasswordVerified()) {
            showPasswordModal && showPasswordModal();
            return;
        }
    }

    const playUrl = getEpisodeUrl(url);
    if (!playUrl) {
        showToast('视频播放链接无效', 'error');
        return;
    }

    // 获取当前路径作为返回页面
    let currentPath = window.location.href;

    // 构建播放页面URL，使用watch.html作为中间跳转页
    let watchUrl = `watch.html?id=${vodId || ''}&source=${sourceCode || ''}&url=${encodeURIComponent(playUrl)}&index=${episodeIndex}&title=${encodeURIComponent(vod_name || '')}&year=${encodeURIComponent(currentVideoYear)}`;

    // 添加返回URL参数
    if (currentPath.includes('index.html') || currentPath.endsWith('/')) {
        watchUrl += `&back=${encodeURIComponent(currentPath)}`;
    }

    // 保存当前状态到localStorage
    try {
        localStorage.setItem('currentVideoTitle', vod_name || '未知视频');
        localStorage.setItem('currentVideoYear', currentVideoYear);
        localStorage.setItem('currentEpisodes', JSON.stringify(getCurrentEpisodeUrls()));
        localStorage.setItem('currentEpisodeIndex', episodeIndex);
        localStorage.setItem('currentSourceCode', sourceCode || '');
        localStorage.setItem('lastPlayTime', Date.now());
        localStorage.setItem('lastSearchPage', currentPath);
        localStorage.setItem('lastPageUrl', currentPath);  // 确保保存返回页面URL
    } catch (e) {
        console.error('保存播放状态失败:', e);
    }

    // 在当前标签页中打开播放页面
    window.location.href = watchUrl;
}

// 弹出播放器页面
function showVideoPlayer(url) {
    // 在打开播放器前，隐藏详情弹窗
    const detailModal = document.getElementById('modal');
    if (detailModal) {
        detailModal.classList.add('hidden');
    }
    // 临时隐藏搜索结果和豆瓣区域，防止高度超出播放器而出现滚动条
    document.getElementById('resultsArea').classList.add('hidden');
    document.getElementById('doubanArea').classList.add('hidden');
    // 在框架中打开播放页面
    videoPlayerFrame = document.createElement('iframe');
    videoPlayerFrame.id = 'VideoPlayerFrame';
    videoPlayerFrame.className = 'fixed w-full h-screen z-40';
    videoPlayerFrame.src = url;
    document.body.appendChild(videoPlayerFrame);
    // 将焦点移入iframe
    videoPlayerFrame.focus();
}

// 关闭播放器页面
function closeVideoPlayer(home = false) {
    videoPlayerFrame = document.getElementById('VideoPlayerFrame');
    if (videoPlayerFrame) {
        videoPlayerFrame.remove();
        // 恢复搜索结果显示
        document.getElementById('resultsArea').classList.remove('hidden');
        // 关闭播放器时也隐藏详情弹窗
        const detailModal = document.getElementById('modal');
        if (detailModal) {
            detailModal.classList.add('hidden');
        }
        // 如果启用豆瓣区域则显示豆瓣区域
        if (localStorage.getItem('doubanEnabled') === 'true') {
            document.getElementById('doubanArea').classList.remove('hidden');
        }
    }
    if (home) {
        // 刷新主页
        window.location.href = '/'
    }
}

// 播放上一集
function playPreviousEpisode(sourceCode) {
    if (currentEpisodeIndex > 0) {
        const prevIndex = currentEpisodeIndex - 1;
        const prevUrl = getEpisodeUrl(currentEpisodes[prevIndex]);
        playVideo(prevUrl, currentVideoTitle, sourceCode, prevIndex);
    }
}

// 播放下一集
function playNextEpisode(sourceCode) {
    if (currentEpisodeIndex < currentEpisodes.length - 1) {
        const nextIndex = currentEpisodeIndex + 1;
        const nextUrl = getEpisodeUrl(currentEpisodes[nextIndex]);
        playVideo(nextUrl, currentVideoTitle, sourceCode, nextIndex);
    }
}

// 处理播放器加载错误
function handlePlayerError() {
    hideLoading();
    showToast('视频播放加载失败，请尝试其他视频源', 'error');
}

// 辅助函数用于渲染剧集按钮（使用当前的排序状态）
function renderEpisodes(vodName, sourceCode, vodId) {
    const episodes = episodesReversed ? [...currentEpisodes].reverse() : currentEpisodes;
    return episodes.map((episode, index) => {
        // 根据倒序状态计算真实的剧集索引
        const realIndex = episodesReversed ? currentEpisodes.length - 1 - index : index;
        const episodeName = getEpisodeName(episode, realIndex);
        return `
            <button id="episode-${realIndex}" onclick="playEpisode(${realIndex}, '${escapeJsString(sourceCode)}', '${escapeJsString(vodId)}')"
                    class="px-3 py-2 bg-[#222] hover:bg-[#333] border border-[#333] rounded-lg transition-colors text-center episode-btn truncate"
                    title="${escapeHtml(episodeName)}">
                ${escapeHtml(episodeName)}
            </button>
        `;
    }).join('');
}

// 复制视频链接到剪贴板
function copyLinks() {
    const episodes = episodesReversed ? [...currentEpisodes].reverse() : currentEpisodes;
    const linkList = episodes.map(getEpisodeUrl).filter(Boolean).join('\r\n');
    navigator.clipboard.writeText(linkList).then(() => {
        showToast('播放链接已复制', 'success');
    }).catch(err => {
        showToast('复制失败，请检查浏览器权限', 'error');
    });
}

// 切换排序状态的函数
function toggleEpisodeOrder(sourceCode, vodId) {
    episodesReversed = !episodesReversed;
    // 重新渲染剧集区域，使用 currentVideoTitle 作为视频标题
    const episodesGrid = document.getElementById('episodesGrid');
    if (episodesGrid) {
        episodesGrid.innerHTML = renderEpisodes(currentVideoTitle, sourceCode, vodId);
    }

    // 更新按钮文本和箭头方向
    const toggleBtn = document.querySelector(`button[onclick="toggleEpisodeOrder('${sourceCode}', '${vodId}')"]`);
    if (toggleBtn) {
        toggleBtn.querySelector('span').textContent = episodesReversed ? '正序排列' : '倒序排列';
        const arrowIcon = toggleBtn.querySelector('svg');
        if (arrowIcon) {
            arrowIcon.style.transform = episodesReversed ? 'rotate(180deg)' : 'rotate(0deg)';
        }
    }
}

// 从URL导入配置
async function importConfigFromUrl() {
    // 创建模态框元素
    let modal = document.getElementById('importUrlModal');
    if (modal) {
        document.body.removeChild(modal);
    }

    modal = document.createElement('div');
    modal.id = 'importUrlModal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-40';

    modal.innerHTML = `
        <div class="bg-[#191919] rounded-lg p-6 max-w-md w-full max-h-[90vh] overflow-y-auto relative">
            <button id="closeUrlModal" class="absolute top-4 right-4 text-gray-400 hover:text-white text-xl">&times;</button>
            
            <h3 class="text-xl font-bold mb-4">从URL导入配置</h3>
            
            <div class="mb-4">
                <input type="text" id="configUrl" placeholder="输入配置文件URL" 
                       class="w-full px-3 py-2 bg-[#222] border border-[#333] rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-blue-500">
            </div>
            
            <div class="flex justify-end space-x-2">
                <button id="confirmUrlImport" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded">导入</button>
                <button id="cancelUrlImport" class="bg-[#444] hover:bg-[#555] text-white px-4 py-2 rounded">取消</button>
            </div>
        </div>`;

    document.body.appendChild(modal);

    // 关闭按钮事件
    document.getElementById('closeUrlModal').addEventListener('click', () => {
        document.body.removeChild(modal);
    });

    // 取消按钮事件
    document.getElementById('cancelUrlImport').addEventListener('click', () => {
        document.body.removeChild(modal);
    });

    // 确认导入按钮事件
    document.getElementById('confirmUrlImport').addEventListener('click', async () => {
        const url = document.getElementById('configUrl').value.trim();
        if (!url) {
            showToast('请输入配置文件URL', 'warning');
            return;
        }

        // 验证URL格式
        try {
            const urlObj = new URL(url);
            if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
                showToast('URL必须以http://或https://开头', 'warning');
                return;
            }
        } catch (e) {
            showToast('URL格式不正确', 'warning');
            return;
        }

        showLoading('正在从URL导入配置...');

        try {
            // 获取配置文件 - 直接请求URL
            const response = await fetch(url, {
                mode: 'cors',
                headers: {
                    'Accept': 'application/json'
                }
            });
            if (!response.ok) throw '获取配置文件失败';

            // 验证响应内容类型
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                throw '响应不是有效的JSON格式';
            }

            const config = await response.json();
            if (config.name !== 'LibreTV-Settings') throw '配置文件格式不正确';

            // 验证哈希
            const dataHash = await sha256(JSON.stringify(config.data));
            if (dataHash !== config.hash) throw '配置文件哈希值不匹配';

            // 导入配置
            for (let item in config.data) {
                localStorage.setItem(item, config.data[item]);
            }

            showToast('配置文件导入成功，3 秒后自动刷新本页面。', 'success');
            setTimeout(() => {
                window.location.reload();
            }, 3000);
        } catch (error) {
            const message = typeof error === 'string' ? error : '导入配置失败';
            showToast(`从URL导入配置出错 (${message})`, 'error');
        } finally {
            hideLoading();
            document.body.removeChild(modal);
        }
    });

    // 点击模态框外部关闭
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    });
}

// 配置文件导入功能
async function importConfig() {
    showImportBox(async (file) => {
        try {
            // 检查文件类型
            if (!(file.type === 'application/json' || file.name.endsWith('.json'))) throw '文件类型不正确';

            // 检查文件大小
            if (file.size > 1024 * 1024 * 10) throw new Error('文件大小超过 10MB');

            // 读取文件内容
            const content = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject('文件读取失败');
                reader.readAsText(file);
            });

            // 解析并验证配置
            const config = JSON.parse(content);
            if (config.name !== 'LibreTV-Settings') throw '配置文件格式不正确';

            // 验证哈希
            const dataHash = await sha256(JSON.stringify(config.data));
            if (dataHash !== config.hash) throw '配置文件哈希值不匹配';

            // 导入配置
            for (let item in config.data) {
                localStorage.setItem(item, config.data[item]);
            }

            showToast('配置文件导入成功，3 秒后自动刷新本页面。', 'success');
            setTimeout(() => {
                window.location.reload();
            }, 3000);
        } catch (error) {
            const message = typeof error === 'string' ? error : '配置文件格式错误';
            showToast(`配置文件读取出错 (${message})`, 'error');
        }
    });
}

// 配置文件导出功能
async function exportConfig() {
    // 存储配置数据
    const config = {};
    const items = {};

    const settingsToExport = [
        'selectedAPIs',
        'customAPIs',
        'yellowFilterEnabled',
        'adFilteringEnabled',
        'doubanEnabled',
        'hasInitializedDefaults'
    ];

    // 导出设置项
    settingsToExport.forEach(key => {
        const value = localStorage.getItem(key);
        if (value !== null) {
            items[key] = value;
        }
    });

    // 导出历史记录
    const viewingHistory = localStorage.getItem('viewingHistory');
    if (viewingHistory) {
        items['viewingHistory'] = viewingHistory;
    }

    const searchHistory = localStorage.getItem(SEARCH_HISTORY_KEY);
    if (searchHistory) {
        items[SEARCH_HISTORY_KEY] = searchHistory;
    }

    const times = Date.now().toString();
    config['name'] = 'LibreTV-Settings';  // 配置文件名，用于校验
    config['time'] = times;               // 配置文件生成时间
    config['cfgVer'] = '1.0.0';           // 配置文件版本
    config['data'] = items;               // 配置文件数据
    config['hash'] = await sha256(JSON.stringify(config['data']));  // 计算数据的哈希值，用于校验

    // 将配置数据保存为 JSON 文件
    saveStringAsFile(JSON.stringify(config), 'LibreTV-Settings_' + times + '.json');
}

// 将字符串保存为文件
function saveStringAsFile(content, fileName) {
    // 创建Blob对象并指定类型
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    // 生成临时URL
    const url = window.URL.createObjectURL(blob);
    // 创建<a>标签并触发下载
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    // 清理临时对象
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
}

// 移除Node.js的require语句，因为这是在浏览器环境中运行的

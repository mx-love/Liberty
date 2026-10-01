# Liberty 当前系统基线

> 基线分支：`refactor/liberty-core-v2`
> 基线提交：`105e76a`（`fix: correct danmaku episode matching`）
> 审计日期：2026-09-30
> 本文是源码事实快照，不代表 Core V2 已经接入生产调用链。

> 2026-10-01 补充：工作区已开始加入 `src/core/` TypeScript 模块，但当前 HTML 仍按本文所列顺序加载旧经典脚本。新模块的实时完成状态见 `REFACTOR_PROGRESS.md`，迁移/删除门槛见 `MIGRATION_PLAN.md`；不能用工作区中“已有新文件”反推生产路径已经切换。

## 1. 证据标记

- **已确认**：可以直接从 `105e76a` 的源码、脚本加载顺序或现有测试得到。
- **待验证**：需要真实采集站、真实 `danmu_api`、真实浏览器或 Cloudflare 环境才能确认。
- **目标**：Core V2 的迁移方向，不是现有能力。

本次只审计了现有依赖边界，没有修改运行时代码。重点源码为：

- `js/config.js`
- `js/api.js`
- `js/search.js`
- `js/app.js`
- `js/player.js` 的弹幕与播放器公开接口
- `js/watch-room/player-adapter.js`
- 为确认边界而读取的相邻调用方：`index.html`、`player.html`、`js/utils/*`、`js/detail/*`、`js/watch-room/controller.js`、`js/watch-room/ui.js`

## 2. 当前运行形态

### 2.1 页面与模块装载

**已确认**：项目仍是经典脚本按顺序加载，不是 ES Module 应用。

首页的关键顺序是：

```text
config.js
  -> utils/media.js
  -> utils/storage.js
  -> utils/playback-state.js
  -> proxy-auth.js
  -> customer_site.js
  -> ui.js
  -> api.js                // 包装 window.fetch
  -> detail/*.js
  -> password.js
  -> search.js
  -> watch-room/ui.js
  -> app.js
```

播放器页的关键顺序是：

```text
hls.js + ArtPlayer + danmuku plugin
  -> config.js + utils/* + proxy-auth.js
  -> api.js + search.js
  -> watch-room/player-adapter.js
  -> watch-room/controller.js
  -> watch-room/ui.js
  -> player.js
```

脚本通过 `window` 全局、顶层函数、DOM 和 `localStorage` 互相发现。已存在的显式命名边界包括：

- `window.LibertyUtils.media`
- `window.LibertyUtils.storage`
- `window.LibertyUtils.playbackState`
- `window.LibertyDetail.*`
- `window.LibertyPlayer`
- `window.LibertyWatchRoom.*`
- `window.DANMU_CONFIG`

这些对象是后续渐进迁移可利用的 adapter seam，但不是类型安全的核心 API。

### 2.2 当前依赖方向

```text
UI / DOM
  |-- app.js -----------------------> search.js -----------------> third-party catalog APIs
  |      |                               |                              via /proxy/
  |      |                               v
  |      +--------------------------> global config and custom API storage
  |      |
  |      +-- /api/detail -----------> api.js window.fetch interceptor
  |                                      |-- JSON AppleCMS detail
  |                                      `-- selected HTML fallback
  |
  `-- playback localStorage / URL ---> player.js
                                         |-- ArtPlayer / hls.js
                                         |-- danmu_api via /api/danmu
                                         `-- window.LibertyPlayer
                                                     ^
                                                     |
                                  watch-room PlayerAdapter -> Controller -> UI/socket
```

核心业务规则目前不是单向依赖：UI 文件同时拥有数据规范化、身份判断、网络访问、状态保存和渲染职责。

## 3. 采集源与搜索

### 3.1 源目录

**已确认**：`js/config.js` 中有 22 个 `API_SITES` 条目，其中包含一个 `testSource`；其余约 21 个为实际配置源。普通源共用 AppleCMS 风格配置，部分源的 `api` 已经包含 `/api.php/provide/vod`，部分只配置站点根地址。`ffzy`、`jisu` 另有 `detail` 地址。

当前固定请求模板：

- 搜索：`/api.php/provide/vod/?ac=videolist&wd=`
- 详情：`/api.php/provide/vod/?ac=videolist&ids=`
- 当前 `maxPages` 为 1。

用户自定义源保存在 `localStorage.customAPIs`，选择集合保存在 `localStorage.selectedAPIs`，运行时 key 为 `custom_<数组索引>`。`customer_site.js` 还能通过 `window.extendAPISites()` 扩展内置目录。

**待验证**：22 个配置项在真实网络下是否都遵循同一 AppleCMS 契约；源码只能证明配置形态相似，不能证明响应兼容。

### 3.2 搜索调用链

```text
app.search()
  -> selectedAPIs.map(searchByAPIAndKeyWord)
  -> Promise.all(all selected sources)
  -> /proxy/<encoded upstream URL>
  -> raw AppleCMS list item + source_name/source_code/api_url
  -> adult / short-drama filters
  -> optimizeSearchResults()
  -> local sort/filter/render
```

**已确认**：

- `searchByAPIAndKeyWord()` 同时处理内置源和自定义源，每个请求有 15 秒超时。
- 所有已选源一次性启动并由 `Promise.all()` 等待；没有 4～6 个源的受控并发，也没有快速源先渲染、慢源后补充。
- 单源失败返回空数组，不会使整个 `Promise.all()` reject。
- 结果保留采集站原字段，并追加 `source_name`、`source_code`，自定义源另带 `api_url`。
- `optimizeSearchResults()` 当前按 `source_code + api_url + vod_id` 去重并保持扁平结果，不进行跨源作品合并。
- `AGGREGATED_SEARCH_CONFIG.enabled` 为 `false`；`canMergeSearchItemsV2()`、`scoreSearchItemV2()`、`showSourcePicker()` 等跨源聚合代码仍存在，但当前生产搜索链未调用它们。
- 排序仍依赖硬编码源权重、标题文本、年份、备注和类型启发式。该权重不是源健康度，也不是视频播放性能。

### 3.3 详情与播放列表

```text
app.showDetails()
  -> fetch('/api/detail?...')
  -> api.js global window.fetch wrapper
  -> handleApiRequest()
  -> fetchJsonDetailPayload()
  -> parseVodPlaySources(vod_play_from, vod_play_url)
  -> buildDetailPayload()
  -> app.normalizePlaySources()
```

**已确认**：

- `api.js` 全局替换 `window.fetch`，只截获同源 `/api/search` 和 `/api/detail`；其他请求委托原始 fetch。
- `parseVodPlaySources()` 识别 AppleCMS 的 `$$$` 播放组、`#` 剧集和第一个 `$` 名称/URL分隔符。
- 当前结构化结果只有 `{name, episodes:[{name,url}]}`，没有 `sourceKey`、`vodId`、`playGroup`、原始字符串、`rawIndex` 或解析证据。
- 缺少剧集名时，解析器生成 `第${index+1}集`。生成名称服务于 UI，但当前模型无法区分“上游明确名称”和“本地显示 fallback”。
- 只保留 HTTP(S) URL；不合法条目在解析阶段被过滤，原始无效值也随之丢失。
- JSON 详情优先；配置了 `detail` 的源会先试 JSON，失败后用正则抓 HTML 中的播放链接。自定义源也可走 HTML fallback。
- `buildDetailPayload()` 将 `vod_name/year/director/actor/area/type/remarks/content` 投影为 `videoInfo`，但没有建立可追溯的 `SourceRecord`。
- `/api/search`、`/api/detail` 是浏览器内虚拟 API，不是 Cloudflare Function；这是隐式的全局 fetch 行为。

**待验证**：HTML fallback 对各特殊源当前页面结构的实际命中率；没有 fixture 能证明这些正则仍兼容。

## 4. 身份与剧集信息的当前断点

### 4.1 没有统一媒体身份

**已确认**：当前至少存在两组彼此独立的身份启发式：

- `app.js`：`searchNormalizeV2()`、`getSearchCoreTitleV2()`、`getSearchCategoryV2()`、`getEpisodeBucketV2()` 等。
- `player.js`：`advancedCleanTitle()`、`normalizeDanmuTitle()`、`parseDanmuCandidateTitle()`、`normalizeDanmuCoreTitle()` 等。

首页逻辑主要用于搜索排序/旧聚合，播放器逻辑主要用于弹幕候选。两者没有共享 `CanonicalMedia`、证据或冲突规则。

### 4.2 结构化剧集在页面交接时丢失

这是 Core V2 最重要的现状约束之一。

**已确认**：

1. `api.js` 最初得到 `{name,url}` 剧集。
2. `app.js` 的详情 UI 仍能显示 `episode.name`。
3. `playVideo()` 调用 `getCurrentEpisodeUrls()`。
4. `utils/media.normalizeEpisodeUrls()` 与 `utils/playback-state.normalizeEpisodesToUrls()` 只保留 URL。
5. `currentEpisodes` 被写入 `localStorage` 后，播放器通常读到的是 URL 字符串，不再是原始 `{name,url}`。

因此当前跨页播放会丢失：

- 原始播放组名称与索引；
- 原始剧集名称；
- 原始数组位置与过滤前位置；
- 名称是上游值还是本地 fallback；
- 所有 episode 解析证据。

`player.js.getCurrentEpisodeName()` 遇到字符串时把整个字符串当成名称；如果该字符串是 URL，后续 `guessEpisodeNumber()` 可能从 URL 中读取数字，或者最终退回 `episodeIndex + 1`。这不是可靠的 `SourceEpisode` 身份。

### 4.3 已存在但范围有限的真实集数修复

**已确认**：`105e76a` 已修正弹幕内部若干 `episodeIndex + 1` 错位：

- `getDanmuPlaybackContext()` 产生 `context.episode`；
- match 返回验证显式接收目标真实集数；
- episode 映射和手动选源复用 `context.episode`；
- 未知 season 的 query 不再强制 S01。

该修复在现有 VM 测试中覆盖 `index=1 / 第12集`。但它没有修复上一节的跨页原始 episode metadata 丢失，也没有建立内容身份模型。

## 5. 当前弹幕链路

### 5.1 外部接口

实际配置覆盖默认值后，弹幕基础路径为 `/api/danmu`。当前调用：

- `POST /api/v2/match`
- `GET /api/v2/search/anime?keyword=...`
- `GET /api/v2/bangumi/:animeId`
- `GET /api/v2/comment/:episodeId?...`

路径会拼在 `/api/danmu` 后，由现有部署转发到独立 `danmu_api`。

**待验证**：部署端 `/api/danmu` 的完整鉴权/转发契约，以及上游 `/match` 除 `fileName` 外是否使用 Liberty 发送的附加 body 字段。Core V2 不能把未经验证的字段当作匹配证据。

### 5.2 自动加载顺序

```text
loadDanmakuForCurrentEpisode()
  -> getDanmukuForVideo(title, episodeIndex)
       1. currentDanmuCache (current episode index)
       2. currentSessionDanmuSource, if it already has episodes
       3. matchDanmuByApi()
            -> getDanmuPlaybackContext()
            -> buildDanmuMatchQueries()
            -> POST /match
            -> pickValidDanmuApiMatch()
            -> GET /comment/:episodeId
       4. session source without loaded episodes
       5. autoFallbackDanmakuBySearchCandidate()
            -> GET /search/anime
            -> rank top candidates
            -> GET /bangumi/:animeId
            -> pickMatchedDanmuEpisode()
            -> probe at most two /comment requests
       6. return [] and keep manual source button available
  -> ArtPlayer danmuku plugin reload
```

切集使用 `danmuReloadToken` 和 `_danmuFetchController.cancelled` 防止旧结果最终覆盖新集；后者是软取消标志，不会中止所有已发出的网络请求。

### 5.3 当前函数职责与重复

| 当前函数/状态 | 当前职责 | 已确认的耦合或风险 |
|---|---|---|
| `advancedCleanTitle` | 标题、季、年、特征、变体 | 末尾单数字会被推为季；年份模式也出现在 season patterns；与其它清洗器重复 |
| `guessEpisodeNumber` | 从播放器 episodeName 猜集数 | 宽泛数字正则；输入可能已退化成 URL；无法表达 confidence/source/content type |
| `guessSeasonNumber` | 从标题猜季 | 调用 `advancedCleanTitle`，继承其激进推断 |
| `getDanmuPlaybackContext` | 从 URL、localStorage、播放器全局拼运行上下文 | 直接读取全局和 DOM 生命周期；没有保留 raw/parsed 双层数据 |
| `buildDanmuKeyword` / `buildDanmuMatchQueries` | 生成 `/match` 查询 | 与身份解析紧耦合；已支持未知季不强制 S01 |
| `extractEpisodeNumberFromDanmuTitle` | 解析 match 的 episodeTitle | 与 `findBestEpisodeMatch` 内嵌的另一套 parser 重复 |
| `pickValidDanmuApiMatch` | 拒绝明确错集的 match 结果 | 候选无明确集数时仍直接取第一项；缺少统一作品/季/年证据对象 |
| `rankDanmuSourceCandidates` | 搜索候选标题、年份、集数规模评分 | 展示“相似度”只来自 `titleScore/60`，不同季/年份可显示 100%，不是总体置信度 |
| `getDanmuCandidateRejectReason` | 年份、标题、单集/多集、当前集存在性硬拒绝 | 年份严格相等；季数没有成为独立冲突维度 |
| `findBestEpisodeMatch` | 弹幕 episode 列表选集 | 内嵌第二套集数 parser；全部无编号时按目标真实集数的位置兜底 |
| `currentSessionDanmuSource` | 当前页复用 anime 与 episodes | 只保存 anime/source/episodes/selectedBy；没有绑定 canonical media、season/year 或 source episode identity |
| `fetchDanmaku` | 请求、限流、格式转换、时长缩放、缓存 | 网络客户端、策略、转换和缓存混在播放器文件 |
| `getAnimeEpisodesWithCache` | bangumi 请求、过滤、重试、缓存 | 过滤“番外/特典”等会销毁特殊内容候选；网络与内容策略混合 |
| `getDanmukuForVideo` | 总编排 | 同时掌握缓存、会话、API match、候选搜索和状态/UI诊断 |
| `switchDanmuSource` | 手选源、映射、请求、UI与播放恢复 | 手动路径仍调用同一 episode picker，这是正确的兼容行为；人工确认范围没有持久化模型 |

### 5.4 缓存与会话状态

**已确认**：

- 当前集缓存：`currentDanmuCache`，键实际是 `episodeIndex`。
- comment 成功缓存：session `Map<episodeId, comments>`。
- comment 400/404：session negative `Set<episodeId>`。
- bangumi 400/404：session negative `Set<animeId>`。
- bangumi detail：内存 `Map`，最多约 8 项、每项最多 500 集。
- anime 搜索：session `Map<normalizedTitle,...>`。
- `currentSessionDanmuSource`：页面会话级，不是持久 registry。
- debug 中明确写出 `persistentBindingEnabled: false`。

Core V2 不能把 `episodeIndex` 或动态媒体 URL 继续用作跨源/长期绑定主键。

### 5.5 已确认与待验证的弹幕行为

**已确认**：

- 弹幕源 Modal 的实际调用来自 `player.html` 用户按钮；自动失败路径只记录 `nextAction`，不主动调用 Modal。
- 候选 Modal 的“相似度”是标题分数比例，不是作品+季度+年份+当前集的综合置信度。
- comment 非空是当前 auto fallback 自动采用候选的必要条件；空 comment、404、429、网络错误分别有内部状态，但最终普通提示仍可能合并为“未匹配到”。
- 当前真实集数回归测试共有 11 项，并直接抽取生产函数执行。

**待验证**：

- “锻刀大赛第一季”真实采集记录、候选、bangumi episodes 和 comment 响应；候选搜索成功本身不能证明自动采用应当成功。
- 不同平台的综艺上下期、日期期号、剪辑版本能否安全对齐。
- 当前 30 秒 429 cooldown 是否与实际部署限流一致。
- 真实切集中的软取消是否足以避免所有旧请求副作用。

## 6. 一起看播放器边界

### 6.1 `PlayerAdapter` 当前公开契约

`js/watch-room/player-adapter.js` 把 Controller 与 ArtPlayer/DOM 隔开，现有方法为：

- 发现：`getArt()`、`getVideo()`、`isReady()`、`waitForVideo()`；
- 观察：`onLocalPlay/Pause/Seeking/Seek/RateChange()`、`offLocalListeners()`；
- 读取：`getSnapshot()`、`getCurrentTime()`、`getPlaybackRate()`；
- 写入：`play()`、`pause()`、`seek()`、`setPlaybackRate()`、`applyPlayback()`；
- 切集：`loadEpisodeSnapshot()`；
- 时钟计算：`calculateTargetTime()`。

适配器发现播放器依赖：

```text
window.LibertyPlayer.art
  -> window.art / window.artPlayer fallback
  -> #player video / first video fallback
```

切集依赖 `window.LibertyPlayer.loadEpisodeFromWatchRoomSnapshot`。`player.js` 还暴露 `buildWatchRoomEpisodeSnapshot`。

### 6.2 Controller 对 adapter 的假设

**已确认**：Controller 使用 adapter 处理：

- host 本地 play/pause/seek/ratechange 监听与 3 秒 sync；
- viewer readonly；
- drift correction；
- remote playback apply；
- episode prepare/load/ready handshake；
- cleanup 时统一 `offLocalListeners()`。

因此重构播放器时必须保持上述语义，不能只保留同名函数。

### 6.3 当前媒体快照边界

**已确认**：`buildWatchRoomEpisodeSnapshot()` 当前广播：标题、年份、`sourceCode`、`vodId`、`episodeIndex`、名称、真实媒体 URL、整个 URL episode 列表和播放状态。它没有 canonical media/episode/edition identity。

**目标但本阶段不改协议**：未来把标准内容身份与用户实际媒体 URL 分开；在 `editionState` 未确认兼容前，不允许不同源静默共享时间轴。

### 6.4 仍存在的 legacy UI 同步逻辑

**已确认**：`watch-room/ui.js` 仍保留自己的播放器发现、`calculateTargetTime()`、等待 video、host timers 和直接 play/pause 路径，同时也创建 Controller + PlayerAdapter。这说明 adapter/controller 尚未成为唯一同步入口。

本基线只记录该事实。第一阶段不得删除这些 fallback；必须先建立一起看回归测试和调用覆盖，再决定哪些是 dead code。

## 7. 当前边界总结

### 已确认

1. UI、网络、解析、身份和存储职责横跨多个经典脚本与全局状态。
2. AppleCMS 普通解析已有可复用兼容行为，但输出模型过薄且丢原始证据。
3. 搜索是全量并发 + `Promise.all()`，不是受控并发或渐进结果流。
4. 首页进入播放器时结构化 episode 被压成 URL，是身份链的明确断点。
5. 搜索身份与弹幕身份使用不同启发式，没有 canonical registry。
6. 弹幕自动、fallback、session、manual 最终会共用 episode picker，但解析与候选判断仍重复且耦合在 `player.js`。
7. danmu animeId/episodeId 只是外部资源标识，当前却缺少 Liberty 内部 canonical ID。
8. Watch Room 已有可保留的 PlayerAdapter 边界，但媒体 payload 仍耦合实际 URL，UI 中还有 legacy 同步路径。

### 待验证

1. 每个真实采集源的请求差异、分页、返回错误和多个播放组样本。
2. 特殊 HTML detail fallback 的真实必要性与兼容范围。
3. `danmu_api /match` 部署契约、真实候选字段及限流行为。
4. 代表性电视剧、电影、长篇动漫、年番、综艺、特别篇、缺集、合并/拆分集的对齐样本。
5. 当前 together-watch legacy 路径哪些仍由生产事件触发。
6. 真实 Cloudflare Pages 构建与新 bundle 加载方式；本文没有部署或触发正式环境。

以上待验证项不得在后续实现或进度报告中静默写成“已解决”。

## 8. Core V2 工作区与生产基线的关系

当前工作区采用并行层，而不是直接替换本文第 2 节的页面装载链：

```text
src/core/**/*.ts
  -> strict TypeScript
  -> esbuild
  -> js/liberty-core.js

现有 index.html / player.html
  -> 仍加载 js/config.js、js/api.js、js/app.js、js/player.js 等经典脚本
  -> 尚未加载或调用 Core V2 bundle
```

因此当前可以分别陈述：

- Source/identity/episode 核心模块可以独立构建和单测；
- 生产搜索、详情、播放交接、弹幕和一起看仍然运行旧代码；
- 尚不存在“新 core 失败后自动回退旧 resolver”的混合调用链；
- 尚未删除或替换任何旧函数；
- 对页面行为的结论仍以本文的经典脚本审计为准。

这一区分会持续到页面 adapter 被显式接入并完成浏览器验收。阶段 A～C 期间，不应为了展示进度提前在 `index.html`/`player.html` 引入未完成的新业务路径。

# Liberty Core V2 迁移计划

> 分支：`refactor/liberty-core-v2`
> 基线：`105e76a`
> 更新：2026-10-01
> 原则：先实现、再接 adapter、再验证、最后删除。阶段 A～C 已作为独立 core 完成，尚未接管生产页面。

## 1. 状态门槛

迁移清单使用以下状态，不能把“源码存在”写成“已迁移”：

| 状态 | 含义 |
|---|---|
| `planned` | 仅有目标或类型 |
| `implemented-isolated` | 新模块有实际实现和单元测试，但生产调用方未使用 |
| `shadowed` | 生产输入同时送入新模块作只读对比，新结果不影响用户 |
| `migrated` | 生产调用方已切到新模块，旧路径只作为显式 feature rollback |
| `verified` | typecheck、单测、全套测试及相关浏览器/真实接口验收通过 |
| `deletable` | 所有调用点已消失、回滚期结束，可以删除旧实现 |

当前不存在 `migrated`、`verified` 或 `deletable` 的旧业务函数。

## 2. 分阶段门禁

### 阶段 A：构建与统一模型

**当前状态：已满足（独立 core）。** 这不包括页面 bridge 或生产迁移。

完成条件：

1. `tsconfig.json` 开启 strict、`noUncheckedIndexedAccess` 等检查；
2. `src/core/index.ts` 作为唯一公共导出入口；
3. `npm run typecheck`、`npm run build:core` 可重复执行；
4. Source、identity、episode、media 使用共享类型；
5. 架构、模型、决策、迁移和进度文档与磁盘一致；
6. 明确 bundle 尚未被页面加载，不能把构建通过当作生产迁移。

### 阶段 B：Source Core

**当前状态：已满足（独立 core）。** 真实采集站抽样因 timeout/403 仍为 `network-unverified`。

完成条件：

1. AppleCMS URL 兼容根地址和已带 `/api.php/provide/vod` 的地址；
2. search/detail、分页、timeout/abort、HTTP/响应结构错误可区分；
3. 原始上游记录、播放组、播放项、过滤前 index 和原始名称被保留；
4. SourceManager 有界并发、单源失败隔离、渐进回调和有界 TTL cache；
5. fixture 覆盖多个播放组、无名称项、无效 URL 与不连续真实集号；
6. 未删除 `API_SITES` 或自定义源配置。

### 阶段 C：身份与剧集系统

**当前状态：已满足（独立 core）。** 尚未建立 registry、持久映射或生产调用方。

完成条件：

1. TitleParser 保留 raw 与多种解释；
2. CandidateEvidence/EntityResolver 使用多字段证据和硬冲突；
3. EpisodeParser 识别 regular、日期、part、SP/OVA/OAD/特别篇等；
4. EpisodeAligner/Resolver 能处理缺集、不连续编号和插入特别篇；
5. 测试覆盖不同季、年份、译名、错误位置、信息不足和明确冲突；
6. 结果可表达 uncertain/conflicting，不强制匹配。

### 阶段 D：弹幕接管（本轮不开始）

进入门槛：阶段 A～C 全部构建/测试稳定，且本文精确列出的生产 adapter 位置已经复核。阶段 D 必须整体建立 DanmuClient/Resolver/Service，并在真实浏览器验收后一次性收敛旧匹配职责，不能留下新旧自动 resolver 混用。

## 3. 旧 Source/search/detail 迁移清单

| 旧功能/函数 | 当前调用方 | 新替代模块 | 当前状态 | 接入与验证后才能删除 |
|---|---|---|---|---|
| `js/search.js::searchByAPIAndKeyWord` | `app.js` 搜索 fan-out；`player.js` 换源搜索 | `AppleCMSAdapter.search` + `SourceManager.search` | `implemented-isolated` | 映射全部 `API_SITES`/custom APIs；保留过滤、proxy transform；首页搜索、播放器换源浏览器验收 |
| `app.js` 搜索 `Promise.all` fan-out | 首页搜索 | `SourceManager` 有界并发与 `onSourceResult` | `implemented-isolated` | 增量渲染不得改变结果过滤/排序语义；慢源和失败源回归 |
| `app.js::optimizeSearchResults` | 首页结果处理 | Source records + 后续 identity resolver/registry | `planned` | 先保留现有扁平结果；仅在 canonical grouping 有完整证据和 UI adapter 后替换 |
| `api.js::parseVodPlaySources` | `buildDetailPayload` | `parseAppleCmsPlaySources` / `SourceNormalizer` | `implemented-isolated` | 对真实普通源和特殊 HTML fallback 做 shadow 对比；确认组名、条目顺序和 URL 数量一致 |
| `api.js::fetchJsonDetailPayload` | `/api/detail` 虚拟接口、fallback | `AppleCMSAdapter.detail`；后续 SourceDetail bridge | core `implemented-isolated`；bridge `planned` | 页面显式调用新 service；验证 custom `api_url`、`detail` URL 与 proxy 行为 |
| `api.js::buildDetailPayload` | detail 返回 | 已实现 `SourceNormalizer`；后续 legacy UI projection adapter | normalizer `implemented-isolated`；projection `planned` | projection 必须保留现有 `videoInfo/playSources/episodes` 契约；详情页浏览器验收 |
| `api.js` 对 `window.fetch` 的 `/api/search`、`/api/detail` 拦截 | `app.js` 隐式 fetch | 显式 SourceSearch/Detail facade | `planned` | 所有调用点迁移并搜索不到虚拟 endpoint 后才删除全局拦截 |
| HTML detail 正则 fallback | 特定源与 custom detail | 经真实差异确认的特殊 adapter | `planned` | 当前不能删除；先收集真实 fixture 并确认哪些源仍需要 |
| `app.js::normalizePlaySources` | 详情状态/UI | SourceRecord -> legacy UI adapter | `planned` | 结构化 SourceEpisode 必须贯穿；UI 显示/多线路/广告过滤回归 |
| `app.js::getCurrentEpisodeUrls` | 播放跳转、localStorage | versioned playback handoff DTO | `planned` | 播放器读懂 DTO 且能兼容旧 URL 数组后才替换 |
| `utils/media.js::normalizeEpisodeUrls` | 首页播放流程 | playback handoff adapter | `planned` | 不能再丢 episode metadata；兼容历史存储迁移 |
| `utils/playback-state.js::normalizeEpisodesToUrls` | 播放器/一起看 | versioned playback handoff adapter | `planned` | 一起看快照和恢复测试通过后才能改变 |

### Source 接入的准确下一步

本轮只做了低频只读连通性抽样：`dyttzy`（电影天堂）和 `ffzy` 均在 8 秒后 timeout，`wujin` 返回 HTTP 403。请求没有进入可用于格式对比的成功响应，因此真实源兼容性结论必须保持 `network-unverified`；这些网络结果既不能证明 adapter 不兼容，也不能写成真实 API 已通过。

1. 新建薄的 classic-script/ESM bridge，只负责把 `js/config.js::API_SITES` 与 custom API 投影成 adapter config；不复制 parser。
2. 用当前 `/proxy/<encoded URL>` 作为注入的 `transformRequestUrl`，不要在 core 内读取 window/config。
3. 先对相同 fixture/真实低频样本运行 old/new 只读对比：记录字段、播放组、有效 URL 和错误分类差异。
4. 先迁移详情数据取得，再迁移首页搜索 fan-out；每一步保留一个显式 rollback flag。
5. 等首页搜索、详情、播放跳转、换源全部浏览器通过，再移除虚拟 `/api/search`、`/api/detail` fetch interception。

## 4. 旧身份与剧集迁移清单

| 旧功能/函数 | 当前职责/调用方 | 新替代模块 | 当前状态 | 验证门槛 |
|---|---|---|---|---|
| `app.js::searchNormalizeV2` 及相邻 title/category helpers | 搜索排序/停用的聚合代码 | `TitleParser` + `CandidateEvidence` + `EntityResolver` | `implemented-isolated` | 搜索 grouping 尚未启用；跨年份/季/译名 fixtures 和 UI grouping 设计完成后迁移 |
| `app.js::canMergeSearchItemsV2` | 旧聚合判断，当前配置关闭 | `EntityResolver` | `implemented-isolated` | 不可因标题相似直接合并；启用前必须测假阳性与 uncertain 展示 |
| `player.js::advancedCleanTitle` | 弹幕 title/year/season/feature | `TitleParser` | `implemented-isolated` | 阶段 D DanmuService 接管后删除其身份职责；播放器 UI 所需清洗另设展示 helper |
| `player.js::guessEpisodeNumber` / `extractEpisodeNumberFromDanmuTitle` / `findBestEpisodeMatch` 内嵌解析 | 播放项与 danmu episode 解析 | `EpisodeParser` + `EpisodeResolver` | `implemented-isolated` | 自动和手动路径必须共用 resolver；第 11 集起步、缺集、special 插入验收 |
| `getDanmuPlaybackContext` | 从全局/localStorage/URL 拼身份 | typed PlaybackContext adapter | `planned` | 先修复结构化 episode 跨页丢失；adapter 只读 UI/global，不作匹配决定 |
| `currentEpisodeIndex` 用作缓存/定位 | UI 数组位置 | `SourceEpisodeIdentity` / canonical episode key | `planned` | 迁移缓存和切集 token 后验证旧请求不能覆盖新集 |
| `currentSessionDanmuSource` | 页面级 anime/episodes 复用 | versioned `DanmakuBinding` registry | `planned`（阶段 D） | binding 必须带 source/canonical scope、evidence/version；手选不得自动推广整季 |

### 剧集 metadata 迁移的关键顺序

1. SourceNormalizer 输出的 `SourceEpisode` 进入详情页状态；
2. 播放 handoff 同时保存 raw name、raw index、group identity、parsed info 和 URL；
3. `player.js` adapter 兼容读取新 DTO 与旧 URL 数组；
4. 新 resolver 使用结构化信息，旧 `episodeIndex + 1` 只能作为显示 fallback，不能成为 canonical evidence；
5. 一起看仍按旧协议工作，直到后续独立版本化升级。

## 5. 阶段 D 旧弹幕函数迁移清单

本表只定义下一阶段准确位置，当前一项都没有迁移。

| 旧函数 | 目标模块 | 当前状态 | 删除条件 |
|---|---|---|---|
| `buildDanmuMatchQueries` | `DanmuCandidateResolver` query plan | `planned` | `/match` 契约 fixture + browser/API 验证 |
| `pickValidDanmuApiMatch` | `DanmuCandidateResolver` evidence validation | `planned` | 不同季/年/错误集/信息不足均返回明确 decision |
| `rankDanmuSourceCandidates` | `DanmuCandidateResolver` | `planned` | UI 不再显示伪造综合“100%”；字段证据可展示 |
| `getDanmuCandidateRejectReason` | shared identity policy + danmu policy | `planned` | blocker 与网络/comment 状态分离 |
| `findBestEpisodeMatch` / `pickMatchedDanmuEpisode` | `DanmuEpisodeResolver` + shared EpisodeResolver | `planned` | auto/manual/session 全部共用且序列 fixture 通过 |
| `matchDanmuByApi` | `DanmuService` | `planned` | typed client 区分 match/not-found/error/limit |
| `autoFallbackDanmakuBySearchCandidate` | `DanmuService` | `planned` | uncertain 不得偷偷走旧宽松 fallback |
| `getDanmukuForVideo` | player adapter 调用 `DanmuService.resolve` | `planned` | ArtPlayer reload、取消/隔离、cache key 浏览器验收 |
| `switchDanmuSource` 的匹配职责 | `DanmuService.bindManual` | `planned` | 手动 binding scope 与 stale 规则测试；UI handler 可保留 |

阶段 D 不修改 danmu_api，不把空 comment、404、429、网络错误合并为同一结果，也不以“有候选”证明可自动绑定。

## 6. 播放器与一起看保留清单

阶段 A～C 不触碰以下生产边界：

- ArtPlayer/hls.js 初始化、事件和销毁；
- 广告过滤、线路切换、历史记录、自动连播、弹幕设置；
- `window.LibertyPlayer` 公开方法；
- `watch-room/player-adapter.js` 当前方法与 Controller 假设；
- Durable Object 房间状态与房主控制协议；
- password.js、Service Worker、缓存与 Cloudflare 部署配置。

未来变更 playback handoff 前必须增加旧数据迁移测试；未来变更一起看 payload 前必须单独版本化，不能把 Core V2 内部类型直接当网络协议发布。

## 7. 测试与回滚矩阵

| 层级 | 当前可执行验证 | 迁移后额外必需验证 |
|---|---|---|
| 类型/构建 | `npm run typecheck`、`npm run build:core` | 干净工作区重复生成；bundle export smoke |
| Core 单元 | `node --test test/core/*.test.js` | 每个新增 resolver 的冲突/unknown fixture |
| 仓库全套 | `npm test` | 旧弹幕真实集数测试不得删除 |
| Source fixture | 本地 JSON + injected fetch | 低频真实源 old/new shadow comparison；不记录 token |
| 浏览器 core bundle | 真实 Edge 已验证 bundle 加载及 Title/Source/Identity/Episode 独立链路；page/console error 为 0 | 生产页面接入后仍需首页搜索、详情、播放、切集、换源、自动/手选弹幕 |
| 本地 Workers 页面 | Miniflare/workerd 在导航前原生崩溃，未执行页面流程 | 在可启动 runtime 补验，不能用 Edge core harness 冒充生产页面验收 |
| 一起看 | 本阶段不改协议 | 任何 playback DTO/Player adapter 变更后补 host/viewer 回归 |
| Cloudflare | 仅静态审计 | 可启动的 Pages/Functions/DO 环境验证 |

每个生产迁移点必须有显式回滚开关；回滚只能切换整条旧/新业务路径，不能让两个 resolver 串联做宽松 fallback。

## 8. 删除检查表

某个旧函数只有同时满足下列条件才标记 `deletable`：

1. `rg` 确认所有生产调用方已迁移；
2. 新模块覆盖原始 raw 数据和错误语义；
3. typecheck、目标测试、全套测试通过；
4. 涉及页面时已完成真实浏览器验收；
5. 涉及 Cloudflare 时已在可启动的运行时验证；
6. 回滚观察期结束，文档记录删除提交；
7. 一起看、密码、播放器生命周期及 UI 没有被间接破坏。

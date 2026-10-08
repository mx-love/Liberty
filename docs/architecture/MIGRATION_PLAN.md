# Liberty Core V2 迁移计划

> 分支：`refactor/liberty-core-v2`
> 基线：`105e76a`
> 更新：2026-10-09
> 原则：先实现、再接 adapter、再验证、最后删除。阶段 A～C COMPLETE，阶段 D CORE COMPLETE，阶段 E ENGINEERING MIGRATION COMPLETE；**REAL API ACCEPTANCE PENDING**。

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

Stage E 的弹幕生产入口已达到 `migrated`/`verified`，对应 legacy matcher 已删除。因为旧 resolver 不再存在，回退方式是 Git 级整体回滚，不是在运行时把新旧 resolver 串联；`Core uncertain` 绝不能触发 legacy fallback。

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

### 阶段 D：Danmaku Core

**当前状态：CORE COMPLETE。** DanmuClient、DanmuCandidateResolver、DanmuEpisodeResolver、DanmuService 及完整 Core 测试已完成。真实部署的 danmu_api 仍为独立验收门。

### 阶段 E：Production Danmaku Migration

**当前状态：ENGINEERING MIGRATION COMPLETE。** `player.html` 已加载同源构建的 Core bundle；生产自动/手动弹幕均使用薄 playback adapter 与 DanmuService；请求取消、stale guard、manual scope 和 ArtPlayer 适配已完成；legacy matcher 生产调用为 0。

**REAL API ACCEPTANCE PENDING。** 该状态不表示真实线上准确率达到 98%。

## 3. 旧 Source/search/detail 迁移清单

| 旧功能/函数 | 当前调用方 | 新替代模块 | 当前状态 | 接入与验证后才能删除 |
|---|---|---|---|---|
| `js/search.js::searchByAPIAndKeyWord` | `app.js` 搜索 fan-out；`player.js` 换源搜索 | `AppleCMSAdapter.search` + `SourceManager.search` | `implemented-isolated` | 映射全部 `API_SITES`/custom APIs；保留过滤、proxy transform；首页搜索、播放器换源浏览器验收 |
| `app.js` 搜索 `Promise.all` fan-out | 首页搜索 | `SourceManager` 有界并发与 `onSourceResult` | `implemented-isolated` | 增量渲染不得改变结果过滤/排序语义；慢源和失败源回归 |
| `app.js::optimizeSearchResults` | 首页结果处理 | Source records + 后续 identity resolver/registry | `planned` | 先保留现有扁平结果；仅在 canonical grouping 有完整证据和 UI adapter 后替换 |
| `api.js::parseVodPlaySources` | `buildDetailPayload` | Stage E metadata bridge + 后续 `parseAppleCmsPlaySources` / `SourceNormalizer` 全迁移 | playback metadata `verified`；Source 主流程 `implemented-isolated` | 已保留 source-provided raw name/entry；完整 Source 主流程仍需真实普通源和特殊 HTML fallback 对比 |
| `api.js::fetchJsonDetailPayload` | `/api/detail` 虚拟接口、fallback | `AppleCMSAdapter.detail`；后续 SourceDetail bridge | core `implemented-isolated`；bridge `planned` | 页面显式调用新 service；验证 custom `api_url`、`detail` URL 与 proxy 行为 |
| `api.js::buildDetailPayload` | detail 返回 | 已实现 `SourceNormalizer`；后续 legacy UI projection adapter | normalizer `implemented-isolated`；projection `planned` | projection 必须保留现有 `videoInfo/playSources/episodes` 契约；详情页浏览器验收 |
| `api.js` 对 `window.fetch` 的 `/api/search`、`/api/detail` 拦截 | `app.js` 隐式 fetch | 显式 SourceSearch/Detail facade | `planned` | 所有调用点迁移并搜索不到虚拟 endpoint 后才删除全局拦截 |
| HTML detail 正则 fallback | 特定源与 custom detail | 经真实差异确认的特殊 adapter | `planned` | 当前不能删除；先收集真实 fixture 并确认哪些源仍需要 |
| `app.js::normalizePlaySources` | 详情状态/UI | Stage E structured episode handoff；后续完整 SourceRecord projection | 弹幕 metadata `verified`；Source 全迁移 `planned` | 已保留 raw 与 display 边界；完整 Source UI 投影仍待迁移 |
| `app.js::getCurrentEpisodeUrls` | 播放跳转、localStorage | URL compatibility + structured episode entries | `verified`（Stage E 边界） | 继续兼容旧 URL 数组；不得把 generated display label 写成 raw evidence |
| `utils/media.js::normalizeEpisodeUrls` | 首页播放流程 | playback handoff adapter | `planned` | 不能再丢 episode metadata；兼容历史存储迁移 |
| `utils/playback-state.js::normalizeEpisodesToUrls` | 播放器/一起看 | URL compatibility + structured playback handoff | `verified`（Stage E 边界） | 双轨兼容已通过回归；一起看网络协议未改变 |

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
| `player.js::advancedCleanTitle` | 旧弹幕 title/year/season identity | `TitleParser` | **removed / verified** | 生产 identity 只走 Core V2 |
| `player.js::guessEpisodeNumber` / `extractEpisodeNumberFromDanmuTitle` / `findBestEpisodeMatch` | 旧播放项与 danmu episode 解析 | `EpisodeParser` + `EpisodeResolver` | **removed / verified** | auto/manual 已共用 resolver；缺集、special、重排和 duplicate 均有生产测试 |
| production playback context | 从 global/session/structured entries 投影观测事实 | `createDanmakuPlaybackContext` | **verified** | adapter 只投影 raw data，不复制 identity 算法 |
| `currentEpisodeIndex` | UI 数组位置 | canonical episode key + source locator | **verified coordinate-only** | 只用于 UI/定位；request guard 不依赖 index 作为 identity |
| `currentSessionDanmuSource` | 页面级 manual choice | canonical-media-scoped transient state | **verified** | manual work 随 media 变化失效；manual episode 只按 canonicalEpisodeId 保存；持久 registry 仍未实现 |

### 剧集 metadata 迁移的关键顺序

1. 播放 handoff 已同时保存 source-provided raw name、raw index、entry 和 URL；
2. `player.js` adapter 已兼容结构化 entries 与旧 URL 数组；
3. generated display label 与 raw evidence 已分离；
4. Core resolver 使用结构化信息，`episodeIndex + 1` 仅可作为显示 fallback，不能成为 canonical evidence；
5. 一起看继续按旧协议工作，Stage E 未发布 Core 内部类型到网络协议。

## 5. 阶段 E 旧弹幕函数最终迁移结果

| 旧职责/函数 | 最终状态 | 当前生产边界 |
|---|---|---|
| `advancedCleanTitle` / `normalizeDanmuTitle` | **removed** | 标题身份由共享 Title/Identity Core 决定 |
| `guessSeasonNumber` / `guessEpisodeNumber` / `extractEpisodeNumberFromDanmuTitle` | **removed** | season/episode 由共享 parser/resolver 决定 |
| `buildDanmuMatchQueries` / `pickValidDanmuApiMatch` / `matchDanmuByApi` | **removed** | query、candidate validation 和 binding 由 DanmuService 负责 |
| `rankDanmuSourceCandidates` 与旧相似度评分 | **removed** | 字段 evidence 与硬冲突由 DanmuCandidateResolver 负责 |
| `findBestEpisodeMatch` / `pickMatchedDanmuEpisode` | **removed** | DanmuEpisodeResolver + EpisodeAligner 负责 |
| `loadDanmakuFromAnimeCandidate` / `autoFallbackDanmakuBySearchCandidate` | **removed** | uncertain 不再回落旧流程 |
| 旧 search/anime episode cache 与 comment probing | **removed** | 评论只在 binding 后请求；空评论不改选候选 |
| `getDanmukuForVideo` | **migrated adapter shell** | 只协调 Core、cache 和渲染生命周期 |
| `switchDanmuSource` | **migrated UI shell** | 只接收 modal 选择；work/episode 决策交给 Core |

静态 `rg` 与函数级 diff 结论：**LEGACY DANMAKU MATCHER PRODUCTION CALLS = 0**。保留的 `episodeIndex + 1` 仅用于显示 fallback/历史文案，不参与弹幕 identity。

Stage E 未修改 danmu_api；空 comment、404/429/500、网络错误、abort 和非法响应仍保持不同状态，也不以“有评论”证明候选正确。

## 6. 播放器与一起看保留清单

Stage E 没有改变以下生产边界：

- ArtPlayer/hls.js 初始化、事件和销毁；
- 广告过滤、线路切换、历史记录、自动连播、弹幕设置；
- `window.LibertyPlayer` 公开方法；
- `watch-room/player-adapter.js` 当前方法与 Controller 假设；
- Durable Object 房间状态与房主控制协议；
- password.js、Service Worker、缓存与 Cloudflare 部署配置。

`player.js` 从 Stage E 基线 7,794 行收敛到 5,815 行。它现在只承担 playback context adapter、Core invocation、request lifecycle/stale guard、modal/UI、ArtPlayer comment conversion/render，以及原有 settings/player lifecycle/`window.LibertyPlayer` 兼容面；不再承担 title/season/episode identity、candidate scoring 或 legacy fallback。

请求有效性同时验证 generation、canonical media、canonical episode 和 source locator。manual work 只作用于一个 canonical media；manual episode confirmation 只作用于一个 canonical episode。

`videoDuration` 由 DanmuClient response 经 DanmuService result 传到现有时间缩放逻辑；缺失/非法值保持 `null`，`comments-empty` 也保留 duration 与 binding 语义。

未来变更 playback handoff 时仍必须保持旧数据兼容；未来变更一起看 payload 前必须单独版本化，不能把 Core V2 内部类型直接当网络协议发布。

## 7. 测试与回滚矩阵

| 层级 | 当前可执行验证 | 迁移后额外必需验证 |
|---|---|---|
| 类型/构建 | TypeScript PASS；esbuild PASS（129.2 kB；map 253.4 kB）；JS syntax 10/10 | 真实发布环境仍需部署验收 |
| Core 单元 | `npm run test:core` PASS 160/160 | 真实 API 响应差异仍待验收 |
| Production Danmaku | 实际 `player.js` + browser Core production matrix PASS 25/25 | 用户部署 danmu_api + 真实影视库 |
| 仓库全套 | `node --test` PASS 193/193；`git diff --check` PASS | 已迁移的生产行为测试不得删除 |
| Source fixture | 本地 JSON + injected fetch | 低频真实源 old/new shadow comparison；不记录 token |
| Edge production | 实际 `msedge.exe` 加载真实 index/player/Core/player/ArtPlayer 链 PASS；page/console/unhandled/external 均为 0 | computer-use visible surface 当前不可用；真实 API 仍待验收 |
| 一起看 | 协议未改；playback-state 4/4、syntax 6/6、单运行时 VM assertions 61/61 | 未执行真实双浏览器 host/viewer WebSocket 房间 |
| Cloudflare | 仅静态审计 | 可启动的 Pages/Functions/DO 环境验证 |

Edge 受控测试使用同源 danmu fixture 和本地/内存 HLS stub，不访问公网视频。computer-use 返回 `apps=[]`、`browsers=[]`，所以只报告实际 `msedge.exe` 自动化通过，不报告人工可见浏览器通过。本地 harness 受现有 `.validation/.gitignore` 的 `*` 规则管理，保持 local-only。

旧 matcher 已删除；如必须回滚，只能 Git 级回滚整条生产链，不能让两个 resolver 串联做宽松 fallback。

## 8. 删除检查表

某个旧函数只有同时满足下列条件才标记 `deletable`：

1. `rg` 确认所有生产调用方已迁移；
2. 新模块覆盖原始 raw 数据和错误语义；
3. typecheck、目标测试、全套测试通过；
4. 涉及页面时已完成真实浏览器验收；
5. 涉及 Cloudflare 时已在可启动的运行时验证；
6. 回滚观察期结束，文档记录删除提交；
7. 一起看、密码、播放器生命周期及 UI 没有被间接破坏。

Stage E 的旧弹幕 matcher 已满足上述受控工程门槛并删除。真实 API 是独立发布验收门，不是恢复 unsafe fallback 的理由。

## 9. 真实 API 与下一步

**REAL API ACCEPTANCE PENDING**。

当前尚未使用用户实际部署的 `danmu_api` 和真实影视库验证，因此不声明 98% 线上准确率。下一步不是继续重构或启动 Stage F，而是：**真实 danmu_api + 真实影视验收**。本计划在 Stage E 工程迁移完成处停止。

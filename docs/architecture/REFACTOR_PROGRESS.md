# Liberty Core V2 重构进度

> 这是下一轮继续工作的唯一入口。每次主要阶段完成、接入或回退后必须更新。
> 最后更新：2026-10-09
> 当前分支：`refactor/liberty-core-v2`
> 重构基线：`105e76a`（`fix: correct danmaku episode matching`）
> 阶段 D 实现提交：`452984d`（`refactor: add identity-aware danmaku core`）
> 阶段 E 工程迁移提交：`31b3253`（`refactor: migrate production danmaku to Liberty Core V2`）
> 工作区状态：阶段 A～C COMPLETE；阶段 D CORE COMPLETE；阶段 E ENGINEERING MIGRATION COMPLETE；**REAL API ACCEPTANCE PENDING**。

## 1. 一句话状态

生产 `player.html` 已加载由当前 TypeScript 源码构建的 `js/liberty-core.js`，自动和手动弹幕流程均已切换到 Core V2 / `DanmuService`。旧 title/season/episode matcher、候选排序、宽松 fallback 和评论探测不再参与生产决策，生产调用数为 0。

本地 fixture、完整仓库测试和实际 `msedge.exe` 受控自动化生产页面链均已通过；用户实际部署的 `danmu_api` 与真实影视库尚未验收。因此本状态只表示工程迁移完成，**不表示线上准确率达到 98%，也不表示真实线上弹幕问题已全部验收**。

## 2. 阶段状态

| 阶段 | 状态 | 已完成边界 | 尚未完成边界 |
|---|---|---|---|
| A：基线与新架构 | **COMPLETE** | 当前系统审计、共享模型、strict tsconfig、esbuild/npm 脚本、显式公共 entry/bundle、架构决策与迁移清单均已验证 | 无需重做 |
| B：Source Core | **COMPLETE** | AppleCMS adapter、normalizer、播放组解析、SourceManager、fixture/测试和集成链路已验证 | 尚未接 `API_SITES`/custom APIs；真实源抽样为 `network-unverified`；HTML detail fallback 未迁移；生产搜索/详情仍旧 |
| C：身份与剧集 | **COMPLETE** | 共享 identity/episode types、TitleParser、CandidateEvidence、EntityResolver、EpisodeParser、EpisodeAligner/Resolver 及 fixtures/集成测试已验证 | 尚未接搜索、播放器、registry 或持久映射 |
| D：Danmaku Core | **CORE COMPLETE** | DanmuClient、DanmuCandidateResolver、DanmuEpisodeResolver、DanmuService、A–V Service 场景及公共 bundle 已验证 | 真实 danmu_api 联网验证 |
| E：Production Danmaku Migration | **ENGINEERING MIGRATION COMPLETE** | 生产 bundle、薄 playback adapter、自动/手动链、请求隔离、legacy 删除、生产集成与 Edge 验收 | 真实 API、真实影视样本和部署环境验收 |

表中 Stage E 的“ENGINEERING MIGRATION COMPLETE”不等于真实 API/部署验收。任何未运行的真实 API、双浏览器房间或 Cloudflare 测试都不得写为通过。

## 3. 当前工作区代码清单

### 构建与公共入口

- `package.json` / `package-lock.json`：加入 TypeScript、esbuild 及 core build/typecheck/test scripts；
- `tsconfig.json`：strict、`noUncheckedIndexedAccess`、Bundler resolution、DOM/ES lib；
- `src/core/index.ts`：唯一公开导出入口；只显式暴露阶段 A～E 所需的稳定 runtime/type API；ESM 与 `window.LibertyCore` 保持同一边界；
- `js/liberty-core.js`：由 TypeScript 源码构建的部署产物，不能手工编辑；`player.html` 已在 `js/player.js` 前加载它。

### Source Core

- `src/core/types/source.ts`
- `src/core/source/source-normalizer.ts`
- `src/core/source/apple-cms-adapter.ts`
- `src/core/source/source-manager.ts`
- `test/fixtures/sources/apple-cms-multi-group.json`
- `test/core/source-core.test.js`

当前实现目标包括 raw/normalized 分离、AppleCMS search/detail、播放组和 rawIndex 保留、timeout/abort/错误分类、可注入 fetch/URL transform、受控并发、渐进结果、单源失败隔离及有界 TTL detail cache。

### Identity / Episode Core

- `src/core/types/identity.ts`
- `src/core/types/media.ts`
- `src/core/types/episode.ts`
- `src/core/identity/title-parser.ts`
- `src/core/identity/candidate-evidence.ts`
- `src/core/identity/identity-policy.ts`
- `src/core/identity/entity-resolver.ts`
- `src/core/episode/episode-parser.ts`
- `src/core/episode/episode-aligner.ts`
- `src/core/episode/episode-resolver.ts`
- `test/fixtures/identity/identity-cases.json`
- `test/fixtures/episode/sequence-cases.json`
- `test/fixtures/integration/apple-cms-resolution.json`
- `test/core/identity-episode-core.test.js`
- `test/core/core-integration.test.js`

实现包括保留标题多解释、unknown/冲突分离、多字段证据、季/外部 ID 等硬 blocker，以及 regular/date/special/part 剧集事实解析。序列解析覆盖缺集、非连续起点、插入特别篇、双 anchor 有界推断、冲突 anchor、完整 verified source identity，以及 `rawIndex` 不得单独充当 episode identity。

### Danmaku Core

- `src/core/danmaku/danmu-types.ts`
- `src/core/danmaku/danmu-client.ts`
- `src/core/danmaku/danmu-candidate-resolver.ts`
- `src/core/danmaku/danmu-episode-resolver.ts`
- `src/core/danmaku/danmu-service.ts`
- `src/core/danmaku/danmu-playback-adapter.ts`
- `test/core/danmu-candidate-resolver.test.js`
- `test/core/danmu-client.test.js`
- `test/core/danmu-episode-resolver.test.js`
- `test/core/danmu-service.test.js`
- `test/core/danmu-service-scenarios.test.js`
- `test/core/danmu-playback-adapter.test.js`
- `test/fixtures/danmaku/danmu-core-cases.json`

实现边界：

- DanmuClient 按现有 v2 契约调用 `match`、`search/anime`、`bangumi` 和 `comment`；严格区分 429、4xx、5xx、网络错误、timeout、abort 和非法响应，timeout 同时覆盖 fetch 与响应体读取。
- DanmuCandidateResolver 复用 Stage C 的 `parseTitle`、多字段证据和 EntityResolver。仅标题相同不能确认作品；明确年份或季数冲突会拒绝；多个无法区分的候选返回 uncertain。
- DanmuEpisodeResolver 只把 `episodeTitle` 和语义明确的 `airDate` 作为上游剧集身份输入。`episodeId` 是 opaque ID，`rawIndex` 是坐标，上游 `episodeNumber` 可能来自列表顺序，三者都不得被当作真实集号。
- 唯一、明确、身份兼容的 E12 可作为独立锚点，不会仅因弹幕列表重排而被拒绝；重复 E12 保持 uncertain；明确季冲突 rejected；没有独立身份时仍使用完整 EpisodeAligner / Resolver 检测真正序列矛盾。
- DanmuService 只接受已映射到同一 CanonicalEpisode 的 SourceEpisode，并以 canonical sequence 成员作为查询事实来源。信息不足明确返回 uncertain，不从 `rawIndex` 猜集数；未知季、电影和综艺不制造 `S01`。
- comments 只在作品和剧集 binding 已建立后请求；评论有无不参与候选正确性判断，空评论保留 binding 并返回 `comments-empty`。

### Stage E 生产适配边界

生产播放 metadata 现在保留 source-provided `rawEpisodeName`、`rawEntry`、`rawIndex`、播放组和 source locator。URL-only 播放项可生成 `第 N 集` 形式的 `displayName`，但该值只用于 UI；对应 `rawEpisodeName` 保持空值，不能成为 `episodeNumber` 或 CanonicalEpisode evidence。旧 URL 数组继续作为兼容接口，结构化 `currentEpisodeEntries` 与之并行保存。

唯一自动生产链为：

```text
production playback data
  -> createDanmakuPlaybackContext
  -> DanmuService.resolve
  -> existing comment conversion/timing
  -> ArtPlayer danmaku render
```

唯一手动生产链为：

```text
existing danmaku modal
  -> user selects work candidate
  -> Core candidate validation
  -> Core episode resolution
  -> explicit episode confirmation when ambiguous
  -> DanmuService.resolve(selectedBy=manual)
  -> existing ArtPlayer render
```

选择一个 work 不等于确认整季。人工 episode 选择只按当前 `canonicalEpisodeId` 保存；人工 work 只在当时的 `canonicalMediaId` 范围内有效，切换 canonical media 后立即失效。

自动与手动流程共用一个 `AbortController`/generation 生命周期。应用结果前同时验证 generation、canonical media identity、canonical episode identity 和 source locator（source、vod、播放组、组 index、raw index、raw entry、play URL）。因此同作品同 E12 从 source A 切到 source B 时，A 的旧结果也不能覆盖 B；关闭弹幕、销毁播放器和手动覆盖自动请求使用同一 guard。

`videoDuration` 从 DanmuClient comment response 经 `DanmuServiceResult.videoDuration` 到达现有 player 时间缩放逻辑；缺失或非法值保持 `null`，`comments-empty` 仍保留正确 binding 和 duration 语义。

Stage E 基线 `cca7f14` 的 `player.js` 为 7,794 行，当前为 5,815 行。它只保留 playback context adapter、Core invocation、request lifecycle、modal/UI、ArtPlayer comment conversion/render，以及既有 settings/player lifecycle/一起看公开接口；不再负责 title identity、season/episode guessing、candidate scoring 或 legacy fallback。

## 4. 已替换、已删除与生产接入

### 已替换旧函数

生产自动和手动弹幕决策已由 Core V2 的 playback adapter、DanmuCandidateResolver、DanmuEpisodeResolver 和 DanmuService 替换。

### 已删除旧函数

函数级 diff 与 `rg`/静态调用检查确认，旧 `advancedCleanTitle`、season/episode guessing、query builder、match validator、candidate ranking、episode-by-index mapping、automatic fallback、anime episode cache 和 comment probing 已从生产 `player.js` 删除。

**LEGACY DANMAKU MATCHER PRODUCTION CALLS = 0**。

剩余 `episodeIndex + 1` 只用于一起看缺失名称时的 UI fallback 和历史记录文案，不参与弹幕 identity。`comments=[]` 返回 `comments-empty`，不会尝试另一个错误 candidate。

### 已接入生产页面

`player.html` 已加载最终 Core V2 bundle；实际生产页自动和手动弹幕均走同一 Core V2 Service。`getDanmukuForVideo` 与 `switchDanmuSource` 名称作为 adapter/UI shell 保留，其中不再实现 identity/episode 决策。

### 仍由旧逻辑负责

- `js/search.js::searchByAPIAndKeyWord` 与 `app.js` 搜索 fan-out；
- `js/api.js` AppleCMS 解析、详情和全局 fetch 虚拟 API；
- `app.js` 搜索排序/旧聚合和详情投影；Stage E 只补充了结构化 playback metadata handoff；
- `utils/media.js` 的旧兼容路径；`utils/playback-state.js` 现在双写 URL compatibility 与结构化 entries；
- ArtPlayer/hls.js 生命周期和错误处理；
- 一起看 Controller/PlayerAdapter/UI/Worker 协议。

完整逐函数清单见 `MIGRATION_PLAN.md`。

## 5. 测试与验证记录

### 阶段 E 最终本地验证

```text
JavaScript syntax                         PASS 10/10
npm run typecheck                         PASS
npm run build:core                        PASS (129.2 kB; map 253.4 kB)
npm run test:core                         PASS 160/160
Production Danmaku matrix                 PASS 25/25
node --test (完整仓库)                    PASS 193/193
git diff --check                          PASS
```

25 项生产矩阵直接加载实际 `js/player.js` 和构建后的浏览器 Core，覆盖普通 E1、`rawIndex=1/E12`、弹幕列表重排、重复 E12、季/年份冲突、source/danmu 缺特别篇、generated label 非身份、`videoDuration`、12→13→12、相同集号跨 media/source stale、auto→manual、关闭/销毁后的旧请求、空评论、429、network、500、非法响应、uncertain 禁止 legacy fallback、manual episode scope 和 manual work media scope。历史 `test/danmu-episode-number.test.js` 已迁移为生产行为测试，不再检查已删除函数是否存在。

### 阶段 E 实际 Microsoft Edge 自动化

最终代码使用本机实际 `msedge.exe` 运行真实生产页面链：

```text
index/app/api metadata
  -> player.html
  -> js/liberty-core.js
  -> js/player.js
  -> Core V2 / DanmuService
  -> ArtPlayer adapter
```

danmu HTTP 使用受控同源 fixture，视频层使用本地/内存 HLS stub；没有访问公网 HLS。Core bundle、auto/manual Core V2、`rawIndex=1/E12`、generated-label 边界、`videoDuration` 和 stale/manual/disabled/destroy guard 均通过；`pageerror=0`、`console.error=0`、`unhandledrejection=0`、`unexpected external requests=0`。

computer-use 可见浏览器环境返回 `apps=[]`、`browsers=[]`，因此没有把人工可见复核写成通过。这是验证工具表面不可用，不是自动化生产链失败。

`.validation/verify-stage-e-production.mjs` 符合仓库已有 `.validation/.gitignore` 的 `*` 规则，作为 local-only 验证资产保留，未纳入正式提交。

### 阶段 E 一起看回归范围

Stage E 未修改一起看协议或实现文件。实际受控结果为：`test/playback-state.test.js` 4/4、相关 JavaScript syntax 6/6、单运行时 VM assertions 61/61（PlayerAdapter 15、Controller 16、snapshot helpers 13、`loadEpisodeFromWatchRoomSnapshot` 17）。覆盖 `window.LibertyPlayer`、`art`、play、pause、seek、episode switch、snapshot/state 访问和 host/viewer 权限行为。

没有执行真实双浏览器 host/viewer WebSocket 房间；这里只能称为 protocol/API regression coverage passed，不能称为完整 live two-client acceptance。

### 阶段 D 历史最终本地验证

```text
node --test test/core/danmu-*.test.js          PASS 91/91
  DanmuCandidateResolver                      PASS 12/12
  DanmuClient                                 PASS 26/26
  DanmuEpisodeResolver                        PASS 12/12
  DanmuService                                PASS 24/24
  DanmuService A–V scenarios                  PASS 17/17
DanmuService end-to-end                       PASS 41/41
npm run typecheck                             PASS
npm run build:core                            PASS (116.5 kB; map 228.0 kB)
npm run test:core                             PASS 142/142
node --test test/core/core-integration.test.js PASS 1/1
npm test                                      PASS 153/153
JavaScript syntax check                       PASS 51/51
git diff --check                              PASS
```

以上均在提交 `452984d` 对应源码和最终生成 bundle 上重新执行，不是沿用并行任务中间数字。Service A–V 覆盖普通电视剧、真实集数与数组位置错位、列表重排、错误季数、错误年份、缺失特别篇、插入采访、非连续起点、长篇动漫、日期型综艺、电影、信息不足、多候选、空评论、HTTP 429/500、网络失败、非法响应、取消、调用顺序和禁止用评论探测错误候选。

### Miniflare/workerd 环境阻断

运行：

```text
node .validation/verify-player-smoke.mjs
```

在进入任何页面之前，Miniflare/workerd 原生进程崩溃：

```text
*** std::terminate() called with no exception
MiniflareCoreError [ERR_RUNTIME_FAILURE]: The Workers runtime failed to start.
```

环境：

- Node.js `v22.17.0`
- Miniflare `3.20250718.2`
- workerd `1.20250718.0`

当次 `results`、`errors`、`warnings`、`navigations` 均为空。结论：这是当前机器上的本地 Workers runtime blocker；它发生在页面加载前，不能直接视为 Liberty 页面或播放器回归。同时，搜索、详情、播放器、弹幕和一起看的浏览器流程**没有执行，不能报告为通过**。

### 阶段 D 历史 Edge 独立 core bundle 验证

不依赖 Miniflare 的真实 Edge harness 已通过：

- `window.LibertyCore` 可用，ESM 与浏览器 global 的 25 个 runtime API 完全一致；
- Stage D 公共类与 resolver 均可从最终 bundle 调用；
- 已知季 E12 的 `match → bangumi → comment` 完整 Service 流程成功；
- canonical `rawIndex=1` 的 E12 正确绑定到弹幕列表 `rawIndex=0` 的 E12，上游错误的 `episodeNumber=1` 未参与身份判断；
- 未知季 E125 走作品搜索，没有生成或发送 `S01`；
- page error 0，console error 0，外部浏览器请求 0。

这是阶段 D 当时对独立 Core Service 的验证记录；其“尚未加载生产 HTML”限制已由上方阶段 E 实际 Edge 生产页面链验收取代。Cloudflare Worker 和真实双端一起看仍未因此得到验收。

### 真实 danmu_api 验证

状态：**REAL API ACCEPTANCE PENDING**（此前记录为 `network-unverified`）。

仓库只保存相对代理配置（生产为 `/api/danmu`，上游由 Cloudflare 环境变量 `DANMU_API_BASE` 提供）。当前本地验收环境没有可安全使用的部署域名和上游配置，因此没有执行真实影片的线上 danmu_api 请求。受控 fixture、mock HTTP 契约和真实 Edge 生产链均通过，但不得据此宣称线上影片匹配准确率达到 98%。

### 真实 AppleCMS 低频抽样

- `dyttzy`（电影天堂）：8 秒 timeout；
- `ffzy`：8 秒 timeout；
- `wujin`：HTTP 403。

三次请求均没有得到可用于格式兼容对比的成功响应。最终分类为 `network-unverified`：错误分类/隔离按预期工作，但不能据此声明真实 API 兼容已通过，也不能把 timeout/403 直接归类为 Liberty parser 回归。

### 其它替代验证

在 runtime 问题解决前，本轮仅使用：

- TypeScript strict typecheck；
- esbuild 可重复构建；
- Node `--test` 的纯 core/fixture 测试；
- injected fetch/clock 的 adapter 测试；
- 对经典脚本、加载顺序和调用点的静态审计；
- 上述真实 Edge core bundle harness。

这些验证只覆盖独立核心，不替代生产页面、成功响应的真实采集源、真实 danmu_api 或 Cloudflare Pages/Functions/DO 验收。

## 6. 已知未完成项与风险

1. `src/core/` 尚未接 `js/config.js::API_SITES` 和用户 `customAPIs`，不能声称现有所有源已经迁移。
2. 当前 fixture 证明通用 AppleCMS 形态；真实抽样仅得到 timeout/403，兼容性仍为 `network-unverified`，不证明每个真实源今天返回兼容响应。
3. 特殊 HTML detail fallback 尚未建真实 fixture，也不能提前删除。
4. Stage E 已让结构化 episode metadata 进入生产弹幕链，但 Source Core 尚未接管全部生产搜索、详情与备用线路。
5. Canonical Media Registry、持久 mapping、VideoEdition 判定尚未实现；当前 manual state 是 canonical media/episode scoped 的页面 session 状态。
6. 真实 danmu_api 与真实影视库尚未验收，自动匹配准确率/覆盖率没有足够独立标注样本，不得声称达到 98%。
7. 实际 Edge 生产页面链已通过；Cloudflare Pages/Functions 部署环境和真实双浏览器一起看仍未执行完整验收。
8. Stage E 没有改动 ArtPlayer、HLS、Service Worker、一起看协议、Cloudflare Worker 或 UI 设计。

## 7. 下一轮准确起点

阶段 A～C COMPLETE、阶段 D CORE COMPLETE、阶段 E ENGINEERING MIGRATION COMPLETE。下一步不是继续重构，也不是启动 Stage F。

下一步仅为：**真实 danmu_api + 真实影视验收**。开始前需要用户实际部署配置、可控真实样本和明确的联网验收窗口；本轮不启动该步骤。

验收期间保持 Core V2 为唯一生产弹幕决策链，不恢复 legacy fallback，不修改 ArtPlayer、HLS、一起看协议或 Cloudflare 部署架构。

## 8. 明确不在本轮恢复的位置

- 不修改 HLS、ArtPlayer 生命周期、Service Worker、password.js；
- 不修改一起看 WebSocket/Durable Object 协议；
- 不建立 Cloudflare 视频中转或第三方媒体缓存；
- 不升级 UI 框架；
- 不删除任何内置或自定义采集站配置；
- 不部署、不 push、不把未执行的真实 API、可见人工浏览器或双端一起看测试写成通过。

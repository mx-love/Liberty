# Liberty Core V2 重构进度

> 这是下一轮继续工作的唯一入口。每次主要阶段完成、接入或回退后必须更新。
> 最后更新：2026-10-04
> 当前分支：`refactor/liberty-core-v2`
> 重构基线：`105e76a`（`fix: correct danmaku episode matching`）
> 阶段 D 实现提交：`452984d`（`refactor: add identity-aware danmaku core`）
> 工作区状态：阶段 A～C COMPLETE；阶段 D CORE COMPLETE；生产迁移尚未开始。

## 1. 一句话状态

Core V2 的严格 TypeScript 骨架、Source Core、身份/剧集核心和独立 Danmaku Core 已完成构建、测试与真实 Edge bundle 验证；它们**尚未加载到现有生产页面，也尚未替换 `js/api.js`、`js/app.js`、`js/search.js` 或 `js/player.js` 的生产逻辑**。独立 Core 通过不等于正式网站的弹幕错配已经修复，也不代表真实环境准确率达到 98%。

## 2. 阶段状态

| 阶段 | 状态 | 已完成边界 | 尚未完成边界 |
|---|---|---|---|
| A：基线与新架构 | **COMPLETE** | 当前系统审计、共享模型、strict tsconfig、esbuild/npm 脚本、显式公共 entry/bundle、架构决策与迁移清单均已验证 | 页面 bridge 未建立；生产 HTML 未加载 bundle |
| B：Source Core | **COMPLETE** | AppleCMS adapter、normalizer、播放组解析、SourceManager、fixture/测试和集成链路已验证 | 尚未接 `API_SITES`/custom APIs；真实源抽样为 `network-unverified`；HTML detail fallback 未迁移；生产搜索/详情仍旧 |
| C：身份与剧集 | **COMPLETE** | 共享 identity/episode types、TitleParser、CandidateEvidence、EntityResolver、EpisodeParser、EpisodeAligner/Resolver 及 fixtures/集成测试已验证 | 尚未接搜索、播放器、registry 或持久映射 |
| D：Danmaku Core | **CORE COMPLETE** | DanmuClient、DanmuCandidateResolver、DanmuEpisodeResolver、DanmuService、A–V Service 场景及公共 bundle 已验证 | 真实 danmu_api 联网验证；生产 `player.js` 迁移 |
| E：Production Danmaku Migration | **NOT STARTED** | 无 | 以薄 adapter 将已验证 Core 接入生产播放器，再受控移除旧匹配路径 |

表中“CORE COMPLETE”不是“生产完成”。任何未运行的页面/Cloudflare 测试都不得写为通过。

## 3. 当前工作区代码清单

### 构建与公共入口

- `package.json` / `package-lock.json`：加入 TypeScript、esbuild 及 core build/typecheck/test scripts；
- `tsconfig.json`：strict、`noUncheckedIndexedAccess`、Bundler resolution、DOM/ES lib；
- `src/core/index.ts`：唯一公开导出入口；只显式暴露阶段 A～D 的稳定 runtime/type API；ESM 与 `window.LibertyCore` 保持同一边界；
- `js/liberty-core.js`：构建产物目标；不能手工编辑，也不表示页面已经引用。

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
- `test/core/danmu-candidate-resolver.test.js`
- `test/core/danmu-client.test.js`
- `test/core/danmu-episode-resolver.test.js`
- `test/core/danmu-service.test.js`
- `test/core/danmu-service-scenarios.test.js`
- `test/fixtures/danmaku/danmu-core-cases.json`

实现边界：

- DanmuClient 按现有 v2 契约调用 `match`、`search/anime`、`bangumi` 和 `comment`；严格区分 429、4xx、5xx、网络错误、timeout、abort 和非法响应，timeout 同时覆盖 fetch 与响应体读取。
- DanmuCandidateResolver 复用 Stage C 的 `parseTitle`、多字段证据和 EntityResolver。仅标题相同不能确认作品；明确年份或季数冲突会拒绝；多个无法区分的候选返回 uncertain。
- DanmuEpisodeResolver 只把 `episodeTitle` 和语义明确的 `airDate` 作为上游剧集身份输入。`episodeId` 是 opaque ID，`rawIndex` 是坐标，上游 `episodeNumber` 可能来自列表顺序，三者都不得被当作真实集号。
- 唯一、明确、身份兼容的 E12 可作为独立锚点，不会仅因弹幕列表重排而被拒绝；重复 E12 保持 uncertain；明确季冲突 rejected；没有独立身份时仍使用完整 EpisodeAligner / Resolver 检测真正序列矛盾。
- DanmuService 只接受已映射到同一 CanonicalEpisode 的 SourceEpisode，并以 canonical sequence 成员作为查询事实来源。信息不足明确返回 uncertain，不从 `rawIndex` 猜集数；未知季、电影和综艺不制造 `S01`。
- comments 只在作品和剧集 binding 已建立后请求；评论有无不参与候选正确性判断，空评论保留 binding 并返回 `comments-empty`。

## 4. 已替换、已删除与生产接入

### 已替换旧函数

**无。**

### 已删除旧函数

**无。**

### 已接入生产页面

**无。** 现有 HTML 仍加载经典脚本；当前 bundle 未成为页面运行路径。

### 仍由旧逻辑负责

- `js/search.js::searchByAPIAndKeyWord` 与 `app.js` 搜索 fan-out；
- `js/api.js` AppleCMS 解析、详情和全局 fetch 虚拟 API；
- `app.js` 搜索排序/旧聚合、详情投影与播放 handoff；
- `utils/media.js`、`utils/playback-state.js` 将 episode 压缩为 URL；
- `player.js` 全部弹幕匹配、网络、缓存与 UI 适配；
- ArtPlayer/hls.js 生命周期和错误处理；
- 一起看 Controller/PlayerAdapter/UI/Worker 协议。

完整逐函数清单见 `MIGRATION_PLAN.md`。

## 5. 测试与验证记录

### 阶段 D 最终本地验证

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

### Edge 独立 core bundle 验证

不依赖 Miniflare 的真实 Edge harness 已通过：

- `window.LibertyCore` 可用，ESM 与浏览器 global 的 25 个 runtime API 完全一致；
- Stage D 公共类与 resolver 均可从最终 bundle 调用；
- 已知季 E12 的 `match → bangumi → comment` 完整 Service 流程成功；
- canonical `rawIndex=1` 的 E12 正确绑定到弹幕列表 `rawIndex=0` 的 E12，上游错误的 `episodeNumber=1` 未参与身份判断；
- 未知季 E125 走作品搜索，没有生成或发送 `S01`；
- page error 0，console error 0，外部浏览器请求 0。

这是对最终浏览器 bundle 和独立 Core Service 调用链的真实验证，但 harness 没有让生产 HTML 加载 Core V2，也没有运行生产播放器、一起看或 Cloudflare Worker。因此它不能写成生产页面迁移通过。

### 真实 danmu_api 验证

状态：**`network-unverified`**。

仓库只保存相对代理配置（生产为 `/api/danmu`，上游由 Cloudflare 环境变量 `DANMU_API_BASE` 提供）。当前本地验收环境没有可安全使用的部署域名和上游配置，因此没有执行真实影片的线上 danmu_api 请求。受控 fixture、mock HTTP 契约和真实 Edge 执行均通过，但不得据此宣称线上影片匹配准确率达到 98%。

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
4. 首页到播放器仍会把 `{name,url}` 压成 URL；结构化 SourceEpisode 尚未贯穿生产。
5. Canonical Media Registry、持久 mapping、VideoEdition 判定尚未实现。
6. 新身份/episode/Danmaku Core 尚未用于生产搜索合并、弹幕或备用线路。
7. **生产 `js/player.js` 尚未迁移，当前正式网站仍使用旧弹幕调用链。** 本阶段没有替换或删除任何旧生产函数。
8. `index.html` / `player.html` 尚未加载 Core V2；独立 Core 的 Edge bundle 已验证，但生产页面与 Workers 尚未验收。
9. 真实 danmu_api 为 `network-unverified`，自动匹配准确率/覆盖率没有足够独立标注样本，本轮不得声称达到 98%。
10. 本阶段没有改动 ArtPlayer、HLS、Service Worker、一起看、Cloudflare Worker 或 UI。

## 7. 下一轮准确起点

阶段 A～C COMPLETE，阶段 D CORE COMPLETE。下一阶段是 **Stage E — Production Danmaku Migration**，不是重新设计 Core。开始前先确认：

```text
git branch --show-current
git log -5 --oneline
git status --short
npm run typecheck
npm run test:core
```

然后以 `src/core/danmaku/danmu-service.ts` 和 `src/core/index.ts` 的稳定 API 为唯一新入口，在 `player.js` 建立薄 adapter：

1. 从现有播放数据构造 CanonicalMedia、CanonicalEpisode 和 SourceEpisode；
2. 先以 shadow/debug 方式比较新旧结果；
3. 保留现有 ArtPlayer、弹幕 UI 和用户手动选源行为；
4. 只在生产浏览器验收覆盖自动匹配、手动选择、切集和请求取消后，逐步移除旧 identity/episode 匹配；
5. 不允许新版 uncertain 自动落入旧宽松匹配并悄悄加载弹幕。

阶段 D 到此停止，不提前开展 HLS、一起看跨源或其它阶段 E 之外的改造。

## 8. 明确不在本轮恢复的位置

- 不修改 HLS、ArtPlayer 生命周期、Service Worker、password.js；
- 不修改一起看 WebSocket/Durable Object 协议；
- 不建立 Cloudflare 视频中转或第三方媒体缓存；
- 不升级 UI 框架；
- 不删除任何内置或自定义采集站配置；
- 不部署、不 push、不把未执行的浏览器测试写成通过。

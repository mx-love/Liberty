# Liberty Core V2 重构进度

> 这是下一轮继续工作的唯一入口。每次主要阶段完成、接入或回退后必须更新。
> 最后更新：2026-10-02
> 当前分支：`refactor/liberty-core-v2`
> 重构基线：`105e76a`（`fix: correct danmaku episode matching`）
> 当前 HEAD（本文更新时）：`43b4a14`（`refactor: establish Liberty Core V2 foundation`）
> 工作区状态：阶段 A～C 代码已本地提交并完成最终验证；架构文档随本文单独提交。

## 1. 一句话状态

Core V2 的严格 TypeScript 骨架、Source Core 和身份/剧集核心已经作为独立模块完成构建、测试与真实 Edge bundle 验证；它们**尚未加载到现有生产页面，也尚未替换 `js/api.js`、`js/app.js`、`js/search.js` 或 `js/player.js` 的生产逻辑**。阶段 D Danmaku Resolver 尚未开始。

## 2. 阶段状态

| 阶段 | 状态 | 已完成边界 | 尚未完成边界 |
|---|---|---|---|
| A：基线与新架构 | 独立 core 已完成 | 当前系统审计、共享模型、strict tsconfig、esbuild/npm 脚本、显式公共 entry/bundle、架构决策与迁移清单均已验证 | 页面 bridge 未建立；生产 HTML 未加载 bundle |
| B：Source Core | 独立 core 已完成 | AppleCMS adapter、normalizer、播放组解析、SourceManager、fixture/测试和集成链路已验证 | 尚未接 `API_SITES`/custom APIs；真实源抽样为 `network-unverified`；HTML detail fallback 未迁移；生产搜索/详情仍旧 |
| C：身份与剧集 | 独立 core 已完成 | 共享 identity/episode types、TitleParser、CandidateEvidence、EntityResolver、EpisodeParser、EpisodeAligner/Resolver 及 fixtures/集成测试已验证 | 尚未接搜索、播放器、registry 或持久映射 |
| D：新版弹幕 | 未开始 | 无 | DanmuClient、DanmuCandidateResolver、DanmuEpisodeResolver、DanmuService、播放器接入及旧逻辑移除全部未做 |
| E：播放可靠性/一起看跨源 | 未开始 | 保留现有代码 | playback recovery、source health、edition compatibility、跨源房间协议全部未做 |

表中“独立实现”不是“生产完成”。任何未运行的页面/Cloudflare 测试都不得写为通过。

## 3. 当前工作区代码清单

### 构建与公共入口

- `package.json` / `package-lock.json`：加入 TypeScript、esbuild 及 core build/typecheck/test scripts；
- `tsconfig.json`：strict、`noUncheckedIndexedAccess`、Bundler resolution、DOM/ES lib；
- `src/core/index.ts`：唯一公开导出入口；只显式暴露阶段 A～C 的公共 runtime/type API；
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

### 阶段 A～C 的本地验证

```text
npm run typecheck                         PASS
npm run build:core                        PASS (js 78.9 kB; sourcemap 156.3 kB)
npm run test:core                         PASS 51/51 (46 top-level + 5 nested)
node --test test/core/core-integration.test.js
                                             PASS 1/1
npm test                                  PASS 62/62 (57 top-level + 5 nested)
JavaScript syntax check                   PASS 43/43
git diff --check                          PASS
```

以上均是最终源码和生成 bundle 上重新执行的结果，不是沿用并行任务中间数字。

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

- `window.LibertyCore` 可用；
- TitleParser、SourceNormalizer、EntityResolver、EpisodeResolver 的浏览器调用链执行成功；
- 特意验证 source `rawIndex=1`、原始名称为第 12 集时，resolver 选择 canonical candidate index 0 的第 12 集，未按数组位置错配；
- page error 0，console error 0。

这是对浏览器 bundle 和独立 core 调用链的真实验证，但 harness 没有让生产 HTML 加载 Core V2，也没有运行搜索、播放、弹幕、一起看或 Cloudflare Worker。因此它不能写成生产页面迁移通过。

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
6. 新身份/episode core 尚未用于搜索合并、弹幕或备用线路。
7. Stage D 没有任何生产代码；旧 `player.js` 匹配器完整保留。
8. 独立 core 的 Edge bundle 验证已执行；生产页面与 Workers 验收仍因 runtime 崩溃/尚未接入而未执行。
9. 自动匹配准确率/覆盖率没有足够独立标注样本，本轮不得声称达到 98%。

## 7. 下一轮准确起点

阶段 A～C 的独立 core 已完成。下一轮先读取本文件、`git status` 和本轮本地提交，确认生产页面仍未接入，然后才可开始阶段 D 的独立实现。阶段 D 的第一批准确文件应为：

```text
src/core/danmu/danmu-client.ts
src/core/danmu/danmu-candidate-resolver.ts
src/core/danmu/danmu-episode-resolver.ts
src/core/danmu/danmu-service.ts
test/core/danmu-*.test.js
```

随后在 `player.js` 建立一个薄 adapter；不要先复制旧函数，也不要让新版 uncertain 自动落入旧宽松匹配器。具体旧函数和删除门槛见 `MIGRATION_PLAN.md` 第 5 节。

## 8. 明确不在本轮恢复的位置

- 不修改 HLS、ArtPlayer 生命周期、Service Worker、password.js；
- 不修改一起看 WebSocket/Durable Object 协议；
- 不建立 Cloudflare 视频中转或第三方媒体缓存；
- 不升级 UI 框架；
- 不删除任何内置或自定义采集站配置；
- 不部署、不 push、不把未执行的浏览器测试写成通过。

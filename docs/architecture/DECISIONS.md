# Liberty Core V2 架构决策

> 分支：`refactor/liberty-core-v2`
> 基线提交：`105e76a`
> 记录日期：2026-10-01
> 范围：阶段 A～C。本文记录已经采用的约束，不表示新核心已接管生产页面。

## 状态含义

- **采用**：本轮核心实现必须遵守；若实际 fixture 证明不成立，应新增决策记录说明替代方案。
- **暂缓**：本轮明确不做，不能在进度报告中写成已完成。
- **待验证**：已有方向，但缺少真实浏览器、采集站或 Cloudflare 证据。

## D-001：采用渐进式 TypeScript 核心，不迁移 UI 框架

**状态：采用。**

Core V2 放在 `src/core/`，使用严格 TypeScript 编写，并由 esbuild 输出浏览器可加载的 ESM bundle。现有 HTML、CSS、ArtPlayer、hls.js 和经典脚本保持不变，调用方通过后续 adapter 逐个迁移。本轮明确不引入 Next.js，也不把 Core 重构扩展为 UI 框架迁移。

理由：现有页面依赖大量 `window`、DOM 与脚本装载顺序；一次性迁移会把业务正确性重构与 UI/播放器重写绑在一起，无法分阶段验证。

影响：

- `npm run typecheck` 检查 `src/**/*.ts`；
- `npm run build:core` 只构建核心 bundle；
- bundle 构建成功不等于页面已经使用它；
- 在页面 adapter 和浏览器验收完成前，旧脚本仍是生产路径。

## D-002：共享一个媒体、来源、身份与剧集类型系统

**状态：采用。**

Source Core、身份 resolver、episode parser/alignment 必须引用 `src/core/types/` 的共享类型，不能各自定义一套“集数”和“作品”模型。

核心身份严格分离：

- `SourceRecord`：某个采集站的一条作品记录；
- `SourceEpisode`：某播放组中的原始播放项；
- `CanonicalMedia` / `CanonicalEpisode`：Liberty 的内容身份；
- `VideoEdition`：可能具有不同时间线的实际剪辑；
- `DanmakuBinding`：未来阶段 D 中对 danmu_api 外部资源的映射。

`vodId`、播放 URL、`rawIndex`、`animeId` 和 danmu `episodeId` 均不具备跨命名空间唯一性。

因此：相同标题不是相同作品的证明；相同作品不是相同剧集的证明；相同 `CanonicalEpisode` 也不证明两个 `VideoEdition` 具有相同时间线。每一层都必须由该层自己的证据确认。

## D-003：原始数据不可被规范化结果覆盖

**状态：采用。**

所有第三方字段都视为不可信提示。Source Normalizer 同时保存 raw 值与派生值；无法解释的字段保持原样，解析失败返回 `null`/`unknown`，不制造确定答案。

特别规定：

- 未知 season 不能变成 1；
- 缺失 episode 名不能把 `rawIndex + 1` 写成真实集数；
- 本地生成的 display name 只能用于展示；
- 无效播放项可不进入可播放列表，但原始组字符串和上游记录必须保留以便诊断；
- 动态签名 URL 不能成为长期 canonical key。

## D-004：身份解析采用字段级证据与硬冲突，不使用单一标题分数确认

**状态：采用。**

`CandidateEvidence` 分别表达标题/别名、年份、季、媒体类型、主创、地区、语言和外部 ID 等证据。缺失字段为 unknown，不得按失败扣分；明确冲突由 policy 产生 blocker。Resolver 不采用“多数源投票”：多个低质量或互相复制的来源不能通过数量压过一个明确的季、年份、媒体类型或外部 ID 冲突。

自动确认至少要有足够的独立 supporting evidence，且不得存在硬冲突。仅标题相等不能确认两个 SourceRecord 是同一作品。

硬冲突至少包括：

- 同一 provider 下外部 ID 明确不同；
- 双方明确 season 且不同；
- 已知且严格不兼容的媒体类型；
- 权威标题明确冲突；
- 已知的 `knownDifferentFrom` 关系。

一年的年份差目前按 unknown 处理，用于容纳首播、引进或元数据差异；更大且双方明确的年份差视为冲突。该规则必须继续由 fixture 验证。

## D-005：尾部数字保留多种标题解释

**状态：采用。**

“庆余年2”之类标题不能被无条件改写为第二季。TitleParser 保留 literal title，同时可提供低/中置信度 season interpretation；只有明确的“第 N 季”、`Season N` 或 `SNN` 才能成为高置信度 season 证据。

下游 resolver 选择解释时必须结合年份、别名、媒体类型及其它证据，不能让清洗器提前销毁原始标题。

## D-006：剧集 parser 只产生事实候选，列表 aligner 决定序列关系

**状态：采用。**

单项 EpisodeParser 负责识别明确标签、日期、part 和特殊内容；EpisodeAligner/Resolver 使用完整列表与人工 anchor 处理缺集、不连续编号和特别篇插入。

规定：

- `rawIndex` 永远是数组位置；
- `episodeNumber` 可为 `null`；
- 1080p、4K、codec、语言、线路等技术 token 不能成为集数；
- 合法日期优先解释为 `airDate`，不是超大 episode number；
- SP、OVA、OAD、番外、预告、访谈、总集篇等不进入 regular 连续编号；
- 没有可靠证据时返回 uncertain，而不是按位置强配。

## D-007：Source Core 使用可注入网络边界和有界并发

**状态：采用。**

AppleCMSAdapter 只处理单一源的 URL、响应与规范化；SourceManager 管理 adapter registry、并发、渐进结果、单源失败隔离及有界 TTL 缓存。fetch、时钟和 URL transform 可以注入，以便测试和兼容现有 `/proxy/`。

本轮保留 `js/config.js` 的全部内置源和用户自定义源。只有真实响应证明存在协议差异时才增加特殊 adapter；不能按源名复制 AppleCMS 解析器。

## D-008：先迁移调用方，再删除旧实现

**状态：采用。**

阶段 A～C 只建立可独立构建和测试的核心，不接管 `js/api.js`、`js/search.js`、`js/app.js` 或 `js/player.js`。下一阶段必须按 `MIGRATION_PLAN.md` 增加 adapter、建立 shadow/浏览器验证，再删除旧函数。

禁止两种中间状态：

1. 新旧 resolver 同时自动决定，失败时互相宽松 fallback；
2. 新核心已存在但文档宣称旧生产逻辑已经删除。

## D-009：阶段 D 前不接管弹幕生产链

**状态：暂缓。**

DanmuClient、DanmuCandidateResolver、DanmuEpisodeResolver 和 DanmuService 尚未建立。当前播放器继续使用 `player.js` 的既有弹幕路径，包括 `105e76a` 的真实集数修复。

只有阶段 C 的身份和 episode sequence 测试稳定后，才开始阶段 D；接入后自动与手动选择必须共用同一 resolver，完成浏览器验收后再删除旧匹配器。

## D-010：本轮不改变播放器、一起看或 Cloudflare 协议

**状态：暂缓。**

- 保留当前页面 UI、ArtPlayer 和现有 hls.js；
- 不调整 HLS 参数或生命周期；
- 保留一起看功能，不修改 Durable Object、房主控制协议和 PlayerAdapter 语义；
- 不要求 D1、R2、KV 或付费 API；
- 保留现有 Cloudflare Pages/Functions/Worker 部署方式，但不新建默认媒体代理，不通过 Cloudflare 转发/缓存所有第三方视频；
- 不持久缓存整部第三方视频；媒体分片继续由浏览器和播放器自身的有限 buffer 管理；
- 不改变密码保护或页面 UI。

未来跨源一起看必须先引入 canonical content、participant media choice 与 edition compatibility，不能仅按同名/同 index 切源。

## D-011：workerd 崩溃属于环境阻断，替代验证不得冒充浏览器验证

**状态：采用。**

本机运行 `.validation/verify-player-smoke.mjs` 时，在进入任何页面前发生：

```text
*** std::terminate() called with no exception
MiniflareCoreError [ERR_RUNTIME_FAILURE]: The Workers runtime failed to start.
```

环境为 Node.js `v22.17.0`、Miniflare `3.20250718.2`、workerd `1.20250718.0`。当次 `results`、`errors`、`warnings`、`navigations` 均为空，说明页面和播放器流程根本没有执行；该结果不能归类为 Liberty 页面回归，也不能写成浏览器通过。

阶段 A～C 的替代验证包括：严格 typecheck、确定性 bundle build、Node 单元/fixture 测试、静态生产边界审计，以及不依赖 Miniflare 的真实 Edge core bundle harness。Edge harness 已验证 `window.LibertyCore` 和 Title/Source/Identity/Episode 独立链路且无 page/console error，但它没有加载生产页面或 Worker；涉及页面或 Worker 的迁移仍必须在可启动的浏览器/Cloudflare 环境补验。

## D-012：生成 bundle 是构建产物，不是手工维护源码

**状态：采用。**

`js/liberty-core.js` 由 `src/core/index.ts` 构建生成。业务修改发生在 `src/core/`，不得直接编辑 bundle。是否将生成物纳入版本控制由主分支现有发布流程决定；无论选择哪种方式，CI/本地都必须能从干净工作区重复生成。

## D-013：不以外部元数据服务替代本地证据模型

**状态：采用。**

Core V2 不要求 TMDB API key，也不把 TMDB 或任何付费服务变成搜索、播放、弹幕或身份解析的运行前提。外部 ID 可以作为一条明确、可追踪的证据，但 Liberty 的 canonical identity 仍由本地数据模型管理。

TVBox 兼容/导入本轮明确延后；当前 Source Core 只保留现有 AppleCMS 采集配置与自定义源能力。若以后增加 TVBox，必须作为独立 adapter 和迁移任务，不得把 TVBox 数据结构直接写进共享媒体模型。

## D-014：身份判断不是多数投票

**状态：采用。**

不同采集站可能复制同一份错误元数据，因此来源数量不等于独立证据数量。EntityResolver 使用字段级 evidence、authority 和 blocker；明确冲突不能被多个弱标题命中、相同演员列表或“多数站一致”抵消。信息不足时结果保持 `uncertain`。

## D-015：阶段 D 弹幕解析采用作品与剧集两阶段

**状态：暂缓至阶段 D。**

未来 Danmaku Resolver 必须先判断 danmu anime/作品候选，再在已经支持的作品候选中解析 episode；不能把标题相似、数组位置或 comment 是否为空混成一个综合分数。两阶段都复用阶段 C 的身份/剧集证据模型，并分别输出候选、拒绝原因和不确定状态。

任一阶段得到 `ambiguous`/`uncertain` 时都优先等待未来的人工确认，不允许为了得到确定答案而强制选择候选。

阶段 D 尚未开始；本文只是冻结接入约束，不表示 DanmuClient、DanmuCandidateResolver、DanmuEpisodeResolver 或 DanmuService 已经实现。

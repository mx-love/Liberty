# Liberty Core V2 媒体模型

> 状态：阶段 A 规范性模型；阶段 B/C 已在 `src/core/types/` 实现其当前所需子集。
> 源码基线：`refactor/liberty-core-v2@105e76a`。
> 本文定义身份边界和不变量；字段可因真实 fixture 补充，但不得重新混用这些身份。精确可编译字段名以 `src/core/types/` 为准，未实现的后续类型不得被描述为生产能力。

## 0. 实现状态

| 模型 | 当前源码 | 状态 |
|---|---|---|
| `SourceRecord` / `SourcePlayGroup` / `SourceEpisode` | `src/core/types/source.ts` | 阶段 B 已实现，尚未贯穿页面 |
| `ParsedTitle` / `CandidateEvidence` / identity result | `src/core/types/identity.ts` | 阶段 C 已实现，尚未进入 registry/搜索 |
| `ParsedEpisodeInfo` / alignment/resolution | `src/core/types/episode.ts` | 阶段 C 已实现并有 fixture/集成测试，尚未进入播放器 |
| `CanonicalMedia` / `CanonicalEpisode` / `VideoEdition` | `src/core/types/media.ts`、`episode.ts` | 结构已定义，registry 和持久映射未实现 |
| `DanmakuBinding` | 本文第 10 节 | 阶段 D 目标，尚无生产实现 |
| `CanonicalRoomMedia` / participant choice | 本文第 14 节 | 后续协议目标，本轮不修改一起看 |

阶段 B 的 `SourceEpisode.parsedEpisodeInfo` 已直接复用共享 `ParsedEpisodeInfo`，而不是维护 Source 专用的第二套集数类型。后续 adapter 也必须保持这一约束。

## 1. 为什么需要六种身份

当前系统经常让一个数组索引同时承担“播放列表位置、真实集数、弹幕集数和一起看集数”的职责。Core V2 必须区分：

```text
SourceRecord                      采集站的一条原始作品记录
  `-- SourceEpisode              某一播放组中的原始播放项
          `-- CanonicalEpisode   Liberty 判断出的标准内容
                    |-- VideoEdition      实际视频剪辑/时间线版本
                    `-- DanmakuBinding    标准内容与 danmu_api 资源的绑定

CanonicalMedia
  `-- CanonicalEpisode
```

`vodId`、`animeId`、`danmuEpisodeId`、`rawIndex` 和媒体 URL 都是各自命名空间内的标识，任何一个都不能成为全系统唯一身份。

## 2. 共享基础类型

以下是当前可编译核心实际使用的基础类型摘要；只列出理解边界所需字段，完整定义以 `src/core/types/` 为准。

```ts
type MediaType =
  | 'movie'
  | 'series'
  | 'anime'
  | 'variety'
  | 'documentary'
  | 'unknown';

type EpisodeContentType =
  | 'regular'
  | 'special'
  | 'interview'
  | 'preview'
  | 'recap'
  | 'movie'
  | 'unknown';

type IdentityDecision = 'confirmed' | 'supported' | 'uncertain' | 'rejected';
type IdentityState = IdentityDecision | 'stale';

type TitleTokenSource =
  | 'explicit_chinese_season'
  | 'explicit_english_season'
  | 'explicit_s_code'
  | 'explicit_year'
  | 'trailing_number'
  | 'part_marker';

type EvidenceField =
  | 'title'
  | 'alias'
  | 'year'
  | 'season'
  | 'mediaType'
  | 'director'
  | 'actors'
  | 'area'
  | 'language'
  | 'externalId'
  | 'knownRelation';

interface CandidateEvidence {
  field: EvidenceField;
  state: 'confirmed' | 'supporting' | 'unknown' | 'conflicting';
  reason: string;
  leftValue: unknown;
  rightValue: unknown;
  source?: string;
}
```

### 不变量

1. 缺失信息使用 `null`/`unknown`，不能用虚构的 `1`、当前年份或数组位置填满。
2. evidence 的“unknown”既不加分，也不扣分；明确冲突才触发阻断或降级。
3. 所有规范化字段都与 raw 字段并存；规范化不得覆盖原值。
4. 一个总体数值分数或“多数票”不能代替字段级证据和硬冲突。
5. 所有自动决定都应能输出采用/拒绝原因。

## 3. SourceDefinition 与 SourceRecord

### 3.1 SourceDefinition（接入层目标，尚未实现）

它描述一个采集接口，而不是某部影片。

```ts
interface SourceDefinition {
  sourceKey: string;
  displayName: string;
  adapter: 'apple-cms' | string;
  apiBaseUrl: string;
  detailBaseUrl: string | null;
  adult: boolean;
  enabledState: 'built_in' | 'user_enabled' | 'user_disabled';
  adapterOptions: Record<string, unknown>;
}
```

约束：

- 内置 `sourceKey` 延续现有 `API_SITES` key，避免破坏已选源配置。
- 自定义源需要稳定 key；当前 `custom_<数组索引>` 会在删除/重排后变化，迁移时应生成持久 ID，同时保留旧索引用于一次性迁移。
- `detailBaseUrl` 只是 adapter 配置，不应驱动 UI 分支。

### 3.2 SourceRecord（当前可编译形状）

```ts
interface SourceRecord {
  sourceKey: string;
  sourceName: string;
  vodId: string;

  rawTitle: string;
  rawYear: string;
  rawDirector: string;
  rawActors: string;
  rawArea: string;
  rawLanguage: string;
  rawCategory: string;
  rawRemarks: string;
  rawDescription: string;
  rawCover: string;
  rawPlaySources: { vodPlayFrom: string; vodPlayUrl: string };
  rawData: Readonly<Record<string, unknown>>;

  normalizedTitle: string;
  normalizedActors: readonly string[];
  normalizedDirector: readonly string[];
  parsedYear: number | null;
  parsedSeason: number | null;
  mediaType: MediaType;

  playGroups: readonly SourcePlayGroup[];
  fetchedAt: number;
}

interface SourcePlayGroup {
  sourceKey: string;
  vodId: string;
  rawIndex: number;
  rawName: string;
  displayName: string;
  rawValue: string;
  episodes: readonly SourceEpisode[];
}
```

`SourceRecord` 的自然定位符是 `(sourceKey, vodId)`，但它只标识该采集站记录，不证明它等于其他站的同名记录。

## 4. 标题解析结果

标题解析不能只返回一个“清洗后字符串”。

```ts
interface ParsedTitle {
  rawTitle: string;
  baseTitle: string;
  normalizedBaseTitle: string;
  aliases: readonly string[];
  season: number | null;
  seasonSource: TitleTokenSource | null;
  year: number | null;
  yearSource: TitleTokenSource | null;
  editionMarkers: readonly string[];
  uncertainTokens: readonly string[];
  interpretations: readonly TitleInterpretation[];
}

interface TitleInterpretation {
  baseTitle: string;
  season: number | null;
  confidence: 'high' | 'medium' | 'low';
  source: 'literal_title' | TitleTokenSource;
}
```

示例：“庆余年2”至少可以保留两种解释：

```text
1. baseTitle = 庆余年2, season = null
2. baseTitle = 庆余年,  season = 2
```

没有其它证据时不能让解释 2 覆盖解释 1。未知季不能变成第一季。

## 5. CanonicalMedia

```ts
interface CanonicalMedia {
  mediaId: string;
  mediaType: MediaType;
  canonicalTitle: string;
  aliases: readonly string[];
  releaseYear: number | null;
  season: number | null;
  directors: readonly string[];
  actors: readonly string[];
  externalIds: Readonly<Record<string, string>>;
  evidence: readonly CandidateEvidence[];
  identityState: IdentityState;
  episodes?: readonly CanonicalEpisode[];
}
```

规则：

- `mediaId` 是 Liberty 生成的不透明内部 ID。
- 两个标题相同不等于同一 `CanonicalMedia`。
- 第一季与第二季必须可成为不同 media identity；季冲突不能被相同导演/演员抵消。
- 外部 ID 只能作为关系字段，不能接管 Liberty 的内部 ID。
- 自动推测的关联不得无条件传递：`A≈B`、`B≈C` 不能推出 `A=C`。

## 6. CanonicalEpisode

```ts
interface CanonicalEpisode {
  canonicalEpisodeId: string;
  mediaId: string;
  contentType: EpisodeContentType;
  seasonNumber: number | null;
  episodeNumber: number | null;
  absoluteNumber: number | null;
  airDate: string | null;
  episodeTitle: string | null;
  part: 'upper' | 'lower' | number | null;
  identityState: IdentityState;
  evidence: readonly CandidateEvidence[];
}
```

规则：

- `episodeNumber=null` 是合法且必要的状态。
- 综艺日期期号优先进入 `airDate` 或可解释的期号证据，不能把 `20260926` 当普通第 20260926 集。
- OVA、SP、特别篇、访谈、预告、总集篇等不能仅凭列表位置进入 regular sequence。
- 电影正片可使用 `contentType='movie'` 且 `episodeNumber=null`，不生成 E01。
- `absoluteNumber` 用于长篇/年番连续编号，与 `seasonNumber + episodeNumber` 并存而不是互相覆盖。

## 7. SourceEpisode

```ts
interface ParsedEpisodeInfo {
  rawName: string;
  contentType: EpisodeContentType;
  seasonNumber: number | null;
  episodeNumber: number | null;
  absoluteNumber: number | null;
  specialNumber: number | null;
  specialKind: 'sp' | 'ova' | 'oad' | 'extra' | 'special' | null;
  airDate: string | null;
  episodeTitle: string | null;
  part: 'upper' | 'lower' | number | null;
  numberKind: 'episode' | 'issue' | 'date' | 'special' | 'none';
  confidence: 'high' | 'medium' | 'low' | 'none';
  ambiguous: boolean;
  evidence: readonly Array<{
    code: string;
    token: string;
    reason: string;
  }>;
  uncertainTokens: readonly string[];
}

interface SourceEpisode {
  sourceKey: string;
  vodId: string;
  playGroup: string;
  playGroupIndex: number;

  rawIndex: number;
  rawEpisodeName: string;
  rawEntry: string;
  playUrl: string;

  displayName: string;
  parsedEpisodeInfo: ParsedEpisodeInfo;

  canonicalEpisodeId: string | null;
  mappingState: 'unmapped' | 'candidate' | 'mapped' | 'conflicting';
  mappingEvidence: readonly string[];
}
```

关键区别：

- `rawIndex` 永远只是该次响应、该播放组中的数组位置。
- 无原始名称时，normalizer 可以生成 `displayName`，但不会把生成名称送入 `EpisodeParser` 充当真实集数证据。
- 当前阶段没有声称已经实现长期 `SourceEpisodeIdentity`/fingerprint；显式 verified mapping 会比较 source、vod、group、index 及原始 entry/name，防止仅凭 index 继承旧映射。
- 完整签名 URL 不能成为长期 key。后续 fingerprint 如何去除 token/query 必须由真实样本决定，不能先写通用“清理 URL”规则。
- `(sourceKey, vodId)` 不足以定位 episode，至少还需要播放组和该次观察中的 entry 信息；`rawIndex` 单独不能成为 identity。

## 8. Episode sequence resolution

单项 parser 只产生候选；最终映射由整个列表提供额外证据。

当前 `EpisodeAlignmentResult` 为每个 source index 返回 `targetIndices`、映射状态、可解释 evidence 和 alternatives；结果整体还包含可靠 anchor 数量与 `aligned`/`partial`/`uncertain`/`conflicting` 状态。`EpisodeResolver` 在此基础上加入 canonical media 校验、显式季冲突和完整 source identity 的 verified mapping，返回 `verified`/`supported`/`uncertain`/`rejected`/`not_found`，不会只返回一个裸 episode ID。

序列 resolver 必须能表达：

- 从第 11 集开始；
- 缺集和不连续编号；
- 中间插入特别篇；
- 上下篇、合并集、拆分集；
- 同作品不同播放组的不同排列；
- “当前无法确认”，而不是强制按 index 对齐。

## 9. VideoEdition

```ts
interface VideoEdition {
  editionId: string;
  canonicalEpisodeId: string;
  editionState: 'compatible' | 'incompatible' | 'unknown';
  duration: number | null;
  timelineMapping: readonly Array<{
    canonicalTime: number;
    editionTime: number;
  }> | null;
  evidence: readonly CandidateEvidence[];
}
```

初期可以全部是 `unknown`，但不能删掉这层。相同 canonical episode 可能有片头差异、删减、地区版、合并或拆分；这直接决定跨源换线和一起看能否继承时间点。

## 10. DanmakuBinding（阶段 D 规范目标，尚未实现）

```ts
interface DanmakuBinding {
  bindingId: string;
  canonicalEpisodeId: string;
  sourceEpisodeIdentity: SourceEpisodeIdentity | null;

  danmuAnimeId: string;
  danmuEpisodeId: string;
  danmuEpisodeTitle: string | null;

  mappingState: 'verified' | 'supported' | 'uncertain' | 'rejected' | 'stale';
  selectedBy: 'automatic' | 'manual';
  scope: 'source_episode' | 'canonical_episode' | 'media_season';
  evidence: Evidence[];
  createdAt: number;
  updatedAt: number;
  mappingVersion: number;
}
```

规则：

- `danmuEpisodeId` 是 danmu_api 的资源 ID，绝不是第几集。
- 自动结果只有证据充分时才能成为 `supported`/`verified`。
- 用户手选某个当前集，默认只产生 `source_episode` 或经确认的 `canonical_episode` binding；不得自动推广为整季。
- 若上游标题、episode list、季或年份证据发生重大变化，旧 binding 进入 `stale`，不能静默继续使用。
- comment 为空表示“绑定指向的资源当前无评论”，不自动证明作品绑定错误。
- 404、429、网络错误和空 comment 必须是不同结果类型。

## 11. Resolver 结果而不是裸值

核心 resolver 不返回“看起来确定”的裸 ID。以下是后续跨 resolver 统一包装的规范目标，不是当前导出的通用接口；当前 `IdentityResolution`、`EpisodeAlignmentResult` 和 `EpisodeResolution` 已分别用结构化 decision/state、候选、证据及拒绝原因实现同一原则。

```ts
interface ResolutionCandidate<T> {
  value: T;
  state: IdentityState;
  evidence: Evidence[];
  conflicts: Evidence[];
}

interface ResolutionResult<T> {
  decision: 'accepted' | 'ambiguous' | 'rejected' | 'not_found' | 'error';
  selected: ResolutionCandidate<T> | null;
  candidates: ResolutionCandidate<T>[];
  reason: string;
}
```

UI adapter 决定如何显示 `ambiguous`，核心不能直接打开 Modal 或 Toast。

## 12. 当前字段向 V2 的映射

| 当前字段 | V2 字段 | 迁移说明 |
|---|---|---|
| `source_code` | `SourceRecord.sourceKey` | 保留原 key |
| `vod_id` | `SourceRecord.vodId` | 只在 source 内唯一 |
| `vod_name` | `rawTitle` | 规范化另存 `normalizedTitle` |
| `vod_year` | `rawYear` + `parsedYear` | 原值不覆盖 |
| `vod_play_from` | `rawPlaySources` + `SourcePlayGroup.rawName` | 保留 `$$$` 组边界 |
| `vod_play_url` | `rawPlaySources` + `SourceEpisode.rawEntry` | 保留过滤前条目 |
| 当前 `{name,url}` | `SourceEpisode` | 增加 group、rawIndex、parsed info、evidence |
| `currentEpisodeIndex` | `SourceEpisode.rawIndex` 的当前 UI 定位 | 不再代表 canonical episode number |
| `context.episode` | parsed episode candidate | 进入 EpisodeResolver 后才能映射 canonical episode |
| `animeId` | `DanmakuBinding.danmuAnimeId` | 外部 ID |
| `episodeId` | `DanmakuBinding.danmuEpisodeId` | 外部资源 ID，不是 episode number |
| `currentSessionDanmuSource` | 临时 binding/cache | 接入 registry 后必须带 canonical/source scope 和 version |

## 13. 存储边界

阶段 A～D 的默认设计应允许纯客户端运行。阶段 A～C 当前只使用内存状态，以下持久化边界仍是接入目标，不得描述为已实现：

- 内存：本次 resolver request 与短期候选；
- `sessionStorage`：页面/标签页级临时状态；
- `localStorage` 或同等级 adapter：小规模、版本化 mapping 与用户配置；
- 不要求 D1、R2、KV 才能工作。

存储接口必须显式、可注入并带 schema version。Core 不直接读写 `window.localStorage`。

## 14. 一起看未来模型边界

第一阶段保持现有协议。后续可在兼容版本中分离：

```ts
interface CanonicalRoomMedia {
  canonicalMediaId: string;
  canonicalEpisodeId: string;
  editionId: string | null;
  revision: number;
}

interface ParticipantPlaybackChoice {
  sourceEpisodeIdentity: SourceEpisodeIdentity;
  editionId: string | null;
  mediaUrl: string;
}
```

房间同步 canonical content 与时间状态；每个参与者选择自己的 compatible edition。`editionState='unknown'` 时继续使用房主指定源或要求确认，不能假装跨源时间线兼容。

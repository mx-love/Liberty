# Liberty 一起看功能设计文档

## 1. 目标与范围

“一起看”功能用于让用户在播放页创建一个同步观看房间，好友通过 8 位数字房间号加入后跟随房主同步播放。第一版只同步播放状态，不转发视频流，不做账号系统，不做公开房间，不做多人控制权。

当前 Liberty 已具备搜索、详情、多播放组、播放页、弹幕、Cloudflare 视频代理、Cloudflare Pages Function 弹幕代理、可选 KV 缓存，以及以下模块化基础：

- `js/utils/media.js`
- `js/utils/storage.js`
- `js/utils/playback-state.js`
- `js/detail/episodes.js`
- `js/detail/play-sources.js`
- `js/detail/modal.js`

本设计面向未来通过 Cloudflare Durable Objects + WebSocket 实现远程同步观看。

## 2. 核心产品原则

- 只使用“房间号”加入。
- 不做邀请链接。
- 不做二维码。
- 不显示复制链接。
- 第一版不支持 URL room 参数加入。
- 房间号就是加入凭证，不额外设计密码。
- 房间号随机生成，不递增。
- 房间号为 8 位数字。
- 单房间最多 10 人。
- 不展示房间列表。
- 不允许搜索房间。
- 不做公开房间。
- 不做账号系统。
- 不做多人控制权。
- 不做语音。
- 不做服务端转发视频流。
- 服务端只同步播放状态，不转发视频内容。
- 每个用户仍然自己加载视频资源。
- 目标是小范围使用，优先保证 Cloudflare 免费额度可控。

## 3. 用户角色

### 3.1 房主 host

房主权限：

- 创建房间。
- 结束房间。
- 播放。
- 暂停。
- seek。
- 切换集数。
- 切换采集站资源。
- 切换播放源后的状态同步。
- 广播当前播放状态。

房主主动结束房间时：

- Durable Object 标记房间为 `ended`。
- 广播 `room:ended`。
- 解除所有观众同步状态。
- 原房间号不可再加入。

### 3.2 观众 viewer

观众权限：

- 加入房间。
- 退出房间。
- 接收房主状态。
- 跟随房主播放。
- 查看在线人数。
- 查看房间号。

观众不能：

- 控制播放。
- 控制暂停。
- 控制 seek。
- 切集。
- 切换采集站。
- 结束房间。
- 抢控制权。

第一版不做多人控制权。

## 4. 房间生命周期

- 房主在播放页点击“一起看”按钮，系统自动创建当前视频房间。
- 创建房间时，自动绑定当前视频、当前采集站、当前集数、当前播放进度和播放状态。
- 创建成功后生成随机 8 位数字房间号。
- 房主把房间号发给好友。
- 好友打开网站，在首页设置面板输入房间号加入。
- 观众退出只影响自己，不影响房间。
- 即使房间里只剩房主一个人，房间也继续存在。
- 只要房主仍在房间中，其他人可以继续输入同一个房间号加入。
- 房主主动点击“结束房间”时，房间立即失效。
- 房间失效后，所有观众退出同步状态，并提示“房主已结束一起看”。
- 房主异常断线时，不立即销毁房间。
- 房主异常断线后保留 60 秒重连宽限期。
- 60 秒内房主重连，房间继续。
- 60 秒后房主未重连，房间失效。
- 房间失效后，原房间号不可再加入。
- 不按电影、电视剧、动漫区分房间失效规则。
- 不因电影播放结束自动销毁房间。
- 不因单集播放结束自动销毁房间。
- 房主可以继续切下一集，房间继续存在。
- 房主切换采集站资源后，观众同步切换。

## 5. UI 入口设计

### 5.1 首页 / 设置面板

在首页右侧设置面板中新增“一起看”卡片。

建议位置：放在“功能开关”和“一般功能”之间，或设置面板中较靠下的位置，不干扰搜索主流程。

卡片内容：

```txt
一起看

房间号
[ 请输入 8 位房间号 ]

[加入房间]

输入好友发来的房间号即可同步观看。
```

要求：

- 首页设置面板只提供“加入房间”。
- 不提供创建房间。
- 不显示复制链接。
- 不显示二维码。
- 输入框只强调房间号。
- 输入时允许用户输入空格，但内部自动去掉空格。
- 房间号必须是 8 位数字。
- 输入非法时提示：“请输入 8 位房间号”。

加入失败时提示明确原因：

- 房间不存在。
- 房间已结束。
- 房间人数已满。
- 房主暂时离线。
- 网络连接失败。

加入成功后：

- 自动跳转到播放页。
- 加载房主当前播放的视频、集数和进度。
- 显示“已加入一起看，正在同步房主进度”。

### 5.2 播放页

在播放页操作按钮区新增按钮：

```txt
一起看
```

建议与“弹幕源”“复制链接”“切换资源”等按钮放在一起。

未在房间时：

- 用户点击“一起看”按钮。
- 不弹出“创建房间”二次确认。
- 点击后立即自动创建当前视频房间。
- 创建中显示：“正在创建房间...”。
- 创建成功后打开房间状态弹窗。

房主弹窗：

```txt
一起看中

房间号：83492157
在线：1/10
你是房主

当前同步：
片名：xxx
集数：第 x 集
进度：12:34

把房间号发给好友。
好友打开网站，在设置里输入房间号即可加入。

[复制房间号]
[结束房间]
```

已经在房间时，播放页按钮显示：

```txt
一起看中 · 2/10
```

点击后打开房间状态弹窗。

观众弹窗：

```txt
一起看中

房间号：83492157
在线：2/10
你是观众

正在跟随房主播放。

当前同步：
片名：xxx
集数：第 x 集
进度：12:34

[退出房间]
```

观众没有控制权。观众界面不显示“结束房间”，只显示“退出房间”。房主界面显示“结束房间”，不显示普通“退出房间”。房主退出即结束房间。

## 6. 房间号规则

- 8 位随机数字。
- 示例：`83492157`。
- 不使用递增 ID。
- 不生成简单序列。
- 不允许 `00000000` 这类明显无效号码。
- 创建房间时检查当前是否已有相同房间号。
- 如果冲突，重新生成。
- 房间结束后，该房间号立即失效。
- 第一版不要求永久黑名单旧房间号。
- 不提供房间列表。
- 不允许根据房间号范围枚举房间。
- 加入房间失败次数需要限制，防止暴力猜房间号。

建议防滥用规则：

- 同一 IP 或同一客户端短时间内加入失败超过 10 次，临时限制 1 分钟。
- 单房间最多 10 人。
- 每个连接需要 heartbeat。
- 长时间无 heartbeat 的观众移出房间。
- 房主断线进入 60 秒重连等待。
- 60 秒后房主未恢复，房间结束。

## 7. 房间状态结构

Durable Object 内部房间状态建议如下：

```js
{
  roomId: "83492157",
  status: "active", // active | ended | host_disconnected
  hostId: "client_xxx",
  maxMembers: 10,

  media: {
    title: "视频标题",
    year: "2024",
    sourceCode: "ffzy",
    sourceName: "非凡资源",
    vodId: "12345",
    episodeIndex: 0,
    episodeName: "第1集",
    episodeUrl: "https://example.com/index.m3u8",
    episodes: [
      "https://example.com/1.m3u8",
      "https://example.com/2.m3u8"
    ]
  },

  playback: {
    paused: true,
    currentTime: 0,
    duration: 0,
    playbackRate: 1,
    updatedAt: 1710000000000
  },

  participants: {
    "client_xxx": {
      id: "client_xxx",
      role: "host",
      name: "房主",
      joinedAt: 1710000000000,
      lastSeenAt: 1710000000000
    },
    "client_yyy": {
      id: "client_yyy",
      role: "viewer",
      name: "观众",
      joinedAt: 1710000000000,
      lastSeenAt: 1710000000000
    }
  },

  createdAt: 1710000000000,
  updatedAt: 1710000000000,
  hostDisconnectedAt: null
}
```

约束：

- `episodes` 继续使用 URL 字符串数组。
- 第一版不要把 episode 对象直接塞入同步协议。
- 保持与 `js/utils/playback-state.js` 兼容。
- 服务器只存播放状态和必要媒体信息。
- 不存视频文件。
- 不转发视频流。

## 8. WebSocket 事件协议

所有消息统一格式：

```js
{
  type: "event:name",
  roomId: "83492157",
  clientId: "client_xxx",
  payload: {},
  sentAt: 1710000000000
}
```

### 8.1 客户端发给服务端

房间事件：

- `room:create`
- `room:join`
- `room:leave`
- `room:end`

房主播放事件：

- `host:play`
- `host:pause`
- `host:seek`
- `host:sync`
- `host:switchEpisode`
- `host:switchSource`

客户端状态事件：

- `client:heartbeat`
- `client:ready`
- `client:buffering`

第一版可选：

- `chat:message`

聊天不是 MVP 必需，建议后续再做。

### 8.2 服务端发给客户端

房间事件：

- `room:created`
- `room:joined`
- `room:left`
- `room:ended`
- `room:error`
- `room:state`
- `room:participants`

同步事件：

- `sync:play`
- `sync:pause`
- `sync:seek`
- `sync:state`
- `sync:switchEpisode`
- `sync:switchSource`

房主连接事件：

- `host:disconnected`
- `host:reconnected`

错误类型：

- `ROOM_NOT_FOUND`
- `ROOM_ENDED`
- `ROOM_FULL`
- `INVALID_ROOM_ID`
- `HOST_DISCONNECTED`
- `RATE_LIMITED`
- `UNAUTHORIZED_ACTION`

### 8.3 关键事件 payload

`room:create`：

```js
{
  clientId: "client_xxx",
  media: {
    title: "视频标题",
    year: "2024",
    sourceCode: "ffzy",
    sourceName: "非凡资源",
    vodId: "12345",
    episodeIndex: 0,
    episodeName: "第1集",
    episodeUrl: "https://example.com/1.m3u8",
    episodes: ["https://example.com/1.m3u8"]
  },
  playback: {
    paused: false,
    currentTime: 120,
    duration: 5400,
    playbackRate: 1
  }
}
```

`room:join`：

```js
{
  roomId: "83492157",
  clientId: "client_yyy"
}
```

`host:seek`：

```js
{
  currentTime: 320,
  paused: false,
  updatedAt: 1710000000000
}
```

`host:switchEpisode`：

```js
{
  episodeIndex: 3,
  episodeName: "第4集",
  episodeUrl: "https://example.com/4.m3u8",
  episodes: [
    "https://example.com/1.m3u8",
    "https://example.com/2.m3u8",
    "https://example.com/3.m3u8",
    "https://example.com/4.m3u8"
  ],
  playback: {
    paused: false,
    currentTime: 0,
    duration: 0,
    playbackRate: 1
  }
}
```

`host:switchSource`：

```js
{
  sourceCode: "bfzy",
  sourceName: "暴风资源",
  vodId: "8888",
  episodeIndex: 3,
  episodeUrl: "https://example.com/new-source-4.m3u8",
  episodes: [
    "https://example.com/new-source-1.m3u8",
    "https://example.com/new-source-2.m3u8"
  ]
}
```

## 9. 播放器同步策略

- 房主操作才广播。
- 观众本地操作不广播。
- 房主播放，观众播放。
- 房主暂停，观众暂停。
- 房主 seek，观众 seek。
- 房主切集，观众切集。
- 房主切换采集站资源，观众切换。
- 房主每 5 秒广播一次当前播放状态。
- 客户端每 30 秒 heartbeat。
- 误差小于 1 秒，不处理。
- 误差 1-3 秒，可以轻微校正或暂不处理。
- 误差大于 3 秒，观众直接 seek 到房主进度。
- 观众缓冲时，显示“正在缓冲，稍后同步房主进度”。
- 观众视频源不可用时，显示“当前资源在你的网络环境下不可用，请联系房主切换资源”。

播放结束规则：

- 不因电影结束自动销毁房间。
- 不因单集结束自动销毁房间。
- 房主如果开启自动连播并切下一集，观众跟随。
- 房主不切集，房间继续存在。
- 房主手动结束房间，房间才失效。

### 9.1 防止事件循环

观众收到同步事件后，本地播放器会触发 `play`、`pause`、`seek` 等事件。前端 `player-adapter` 必须有内部标记，例如 `isApplyingRemoteSync`，在应用远端同步时禁止再次向服务端发送同类事件。

建议策略：

- 房主本地操作：发送事件。
- 房主定时状态：发送 `host:sync`。
- 观众本地操作：不发送控制事件。
- 观众应用远端状态：设置 `isApplyingRemoteSync = true`，完成后恢复。

## 10. 前端模块设计

建议新增目录：

```txt
js/watch-room/client.js
js/watch-room/ui.js
js/watch-room/player-adapter.js
```

### 10.1 client.js

职责：

- 建立 WebSocket。
- 创建房间。
- 加入房间。
- 离开房间。
- 发送播放事件。
- 接收同步事件。
- 处理重连。
- 处理错误提示。

全局暴露：

```js
window.LibertyWatchRoom.client
```

建议 API：

```js
createRoom(session)
joinRoom(roomId)
leaveRoom()
endRoom()
sendHostPlay(state)
sendHostPause(state)
sendHostSeek(state)
sendHostSync(state)
sendSwitchEpisode(mediaState)
sendSwitchSource(mediaState)
on(eventName, handler)
off(eventName, handler)
```

### 10.2 ui.js

职责：

- 设置面板加入房间 UI。
- 播放页一起看按钮。
- 房间状态弹窗。
- 在线人数显示。
- 复制房间号。
- 错误提示。
- 房主/观众不同 UI。

全局暴露：

```js
window.LibertyWatchRoom.ui
```

注意：产品原则不做邀请链接、不做二维码、不支持 URL room 参数。可以提供“复制房间号”，但不显示“复制链接”。

### 10.3 player-adapter.js

职责：

- 读取当前播放器状态。
- 封装 play。
- 封装 pause。
- 封装 seek。
- 封装 currentTime。
- 封装 duration。
- 封装切集。
- 封装切换采集站资源。
- 监听 Artplayer 事件。
- 防止同步事件和本地事件互相循环触发。

全局暴露：

```js
window.LibertyWatchRoom.playerAdapter
```

建议接口：

```js
getCurrentSession()
getPlaybackState()
applyPlaybackState(state)
applySwitchEpisode(payload)
applySwitchSource(payload)
bindHostEvents()
unbindHostEvents()
setRemoteApplying(enabled)
```

### 10.4 与 playback-state 的关系

`player-adapter` 应优先使用 `js/utils/playback-state.js`：

- 读取当前播放 session。
- 确保 `episodes` 是 URL 字符串数组。
- 切集或切源后更新 localStorage 兼容字段。

一起看同步协议第一版不使用 episode 对象，避免 `[object Object]` URL 风险。

## 11. 后端 Cloudflare Durable Object 设计

未来实现需要：

- Cloudflare Durable Object 作为房间状态中心。
- 一个房间号对应一个 Durable Object 实例。
- Durable Object 持有房间状态、参与者连接、WebSocket 列表、房主连接状态。

建议文件结构：

```txt
functions/api/watch/[[path]].js
functions/watch-room/room-object.js
```

建议 binding：

```txt
WATCH_ROOM_DO
```

建议 API：

- `POST /api/watch/create`
- `GET /api/watch/ws?room=83492157`

第一版不做：

- REST 房间列表。
- 持久历史。
- 视频代理。
- 视频转发。
- 解析第三方播放页。
- 存储视频文件。

### 11.1 /api/watch/create

职责：

- 接收当前播放 session。
- 校验媒体信息。
- 生成 8 位随机房间号。
- 检查冲突。
- 初始化 Durable Object 房间状态。
- 返回房间号和 WebSocket 连接信息。

响应示例：

```js
{
  success: true,
  roomId: "83492157",
  role: "host",
  maxMembers: 10
}
```

### 11.2 /api/watch/ws

职责：

- 根据 `room` 参数连接到对应 Durable Object。
- WebSocket 连接建立后由客户端发送 `room:join` 或房主恢复事件。
- 不支持 URL room 参数自动加入播放页；URL 仅用于 WebSocket 连接，不作为用户加入入口。

### 11.3 Durable Object 职责

- 创建房间。
- 加入房间。
- 广播状态。
- 校验房主权限。
- 限制人数。
- 处理 heartbeat。
- 房主断线 60 秒宽限。
- 结束房间。
- 清理异常连接。
- 限制消息大小。
- 对加入失败做限频。

## 12. 免费额度控制策略

- 不转发视频流。
- 不代理房间内的视频分片。
- 只同步轻量 JSON 状态。
- 房间最多 10 人。
- 房主每 5 秒同步一次状态。
- 心跳 30 秒一次。
- 聊天第一版不做，或后续严格限频。
- 观众不能高频发送控制消息。
- 加入失败要限频。
- 异常连接要清理。
- 房主断线 60 秒后结束房间。
- 不做房间列表，减少扫描风险。
- 不做公开发现，减少滥用。
- Cloudflare 请求量过高时，可以后续加开关禁用一起看。

## 13. 安全与防滥用策略

- 房间号随机 8 位。
- 不递增。
- 不展示房间列表。
- 不允许搜索房间。
- 加入失败限频。
- 单房间最多 10 人。
- 只有房主可以控制播放状态。
- 服务端校验 role。
- 观众发送 host 操作时返回 `UNAUTHORIZED_ACTION`。
- 房间结束后拒绝加入。
- 房主结束房间后广播 `room:ended`。
- WebSocket 消息限制大小。
- 客户端异常断开要清理。
- 不存用户敏感信息。
- 不需要登录系统。

建议消息大小限制：

- 单条 WebSocket 消息最大 16KB。
- `episodes` 数组最大 300 条，超过时可以只同步当前集 URL 和必要索引，后续再按资源重新拉详情。
- `chat:message` 如果后续实现，单条最大 300 字。

## 14. MVP 实现阶段

### 阶段 1：设计和 UI 壳

- 新增 `WATCH_ROOM_PLAN.md`。
- 播放页新增“一起看”按钮。
- 设置面板新增“输入房间号加入”卡片。
- 先不连 WebSocket，只完成 UI 壳。
- 不影响播放。

### 阶段 2：Cloudflare Durable Object 和 WebSocket 打通

- 新增 Durable Object。
- 新增 `/api/watch/create`。
- 新增 `/api/watch/ws`。
- 创建房间返回 8 位房间号。
- 加入房间成功显示在线人数。
- 暂不做播放同步。

### 阶段 3：房主播放状态同步

- 房主 play/pause/seek 广播。
- 观众跟随。
- 房主每 5 秒同步 currentTime。
- 加入者加入时同步当前状态。

### 阶段 4：切集和切换采集站资源同步

- 房主切集，观众切集。
- 房主切换采集站资源，观众切换。
- 处理资源不可用提示。

### 阶段 5：体验优化

- 房主断线 60 秒重连。
- 在线人数。
- 复制房间号。
- 错误提示。
- 移动端适配。
- 限频和防滥用。

## 15. MVP 验收标准

- 播放页点击“一起看”能创建房间。
- 创建后生成 8 位随机房间号。
- 设置面板输入房间号能加入。
- 房间最多 10 人。
- 房主播放，观众播放。
- 房主暂停，观众暂停。
- 房主 seek，观众 seek。
- 新观众加入后同步到房主当前进度。
- 房主切集，观众切集。
- 房主切换采集站资源，观众同步。
- 观众退出不影响房间。
- 只剩房主时房间仍存在。
- 其他人可以继续通过房间号加入。
- 房主结束房间后，所有观众退出同步状态。
- 房主结束后原房间号不可再加入。
- 房主异常断线 60 秒内可恢复。
- 60 秒未恢复则房间失效。
- 不转发视频流。
- 不影响现有搜索、详情、播放、弹幕功能。
- Cloudflare 免费使用风险可控。

## 16. 风险点

- 不同用户网络环境下视频源可能不可用。
- 资源站不稳定会导致同步失败。
- 房主能播不代表观众能播。
- 移动端后台可能断开 WebSocket。
- 微信内置浏览器可能播放体验差。
- WebSocket 重连需要谨慎处理。
- 播放器事件可能产生循环同步。
- Cloudflare 免费额度需要控制。
- Durable Object 配置需要正确绑定。
- 房间号虽然随机，但仍需限频防猜测。
- 同一集在不同采集站的资源时长可能不同，跨源同步需要以房主资源为准。
- 观众本地 HLS 加载慢时，强制 seek 可能反复触发缓冲。

## 17. 后续优化

- 聊天。
- 房主转让。
- 请求房主切源。
- 房间内弹幕共享。
- 断线重连优化。
- 更精细的进度校准。
- 房间设置。
- 可选 20 人上限。
- PWA 支持。
- 更好的移动端提示。
- 加入失败限频可视化提示。
- 观众资源不可用时，提供“提醒房主切换资源”。

## 18. 不建议第一版实现的内容

- 邀请链接。
- 二维码。
- URL room 参数自动加入。
- 房间列表。
- 房间搜索。
- 公开房间。
- 账号系统。
- 多人控制权。
- 房主转让。
- 语音。
- 服务端视频转发。
- 服务端解析第三方播放页。
- 房间历史记录。
- 持久聊天记录。
- 自动跨源容灾。

## 19. 第一版开发注意事项

- 所有前端新增模块继续使用全局命名空间，不引入构建工具。
- 先接 UI 壳，再接 Durable Object，再接播放器同步。
- `episodes` 始终使用 URL 字符串数组。
- 复用 `LibertyUtils.playbackState` 获取当前播放状态。
- WebSocket 同步失败不能影响本地视频播放。
- 所有观众同步动作都必须可中断，避免播放器卡死。
- 不要修改现有搜索、详情、播放、弹幕主流程。
- 后端实现前必须确认 Cloudflare Pages + Durable Objects 的绑定和部署方式。


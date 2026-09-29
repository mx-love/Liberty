# Liberty 一起看部署与验收

本文以当前代码为准。一起看由 Cloudflare Pages Function 转发到 Durable Object；视频流仍由每个浏览器直接请求第三方播放源，不经过 Durable Object。

## 当前能力

- 8 位房间号，单房间最多 10 人。
- 房主 play、pause、seek、定时状态同步。
- `waiting → starting → playing → ended/expired` 房间状态机。
- 开播和切集 ready handshake，超时由 Durable Object alarm 推进。
- 播放中 late join：下发当前媒体、权威播放状态和 server timestamp。
- Viewer 小漂移忽略、中漂移 playbackRate 微调、大漂移 seek。
- WebSocket 指数退避重连（1/2/4/8 秒级，带 jitter，上限 15 秒）。
- 房主断线 45 秒 grace period；凭正确恢复凭据可恢复原房间。
- `waiting/stalled/canplay/playing/error` 缓冲状态上报；单个 viewer 缓冲不会暂停全房间。
- heartbeat ping/pong 估算 RTT 与时钟偏移，异常 RTT 样本会被过滤。
- 普通 `host:sync` 与 heartbeat 节流持久化，关键状态立即持久化。

聊天室、房主转让、严格同步模式不在当前版本范围内。

## 部署结构

同一仓库部署为两个目标：

```text
Cloudflare Pages
├─ Liberty 静态站点
├─ functions/api/watch/[[path]].js
└─ Durable Object namespace binding: WATCH_ROOM_DO

Cloudflare Worker
├─ workers/watch-room/index.js
├─ workers/watch-room/wrangler.toml
└─ WatchRoomDurableObject
```

访问链路：

```text
Browser → /api/watch/* → Pages Function → WATCH_ROOM_DO → Durable Object
Browser → third-party media URL (direct, never through Durable Object)
```

## Worker 部署

Worker 根目录设为 `workers/watch-room`。当前 `wrangler.toml`：

```toml
name = "liberty-watch-room-worker"
main = "index.js"
compatibility_date = "2026-06-05"

[[durable_objects.bindings]]
name = "WATCH_ROOM_DO"
class_name = "WatchRoomDurableObject"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["WatchRoomDurableObject"]
```

可使用 Cloudflare 的 Git 集成，或在该目录执行 `npx wrangler deploy`。Worker 名称、class name 和 migration 必须与配置一致。

## Pages binding

在 Pages 项目的 Production 与 Preview 环境分别添加：

```text
Binding type: Durable Object namespace
Variable name: WATCH_ROOM_DO
Worker script: liberty-watch-room-worker
Class name: WatchRoomDurableObject
```

它不是普通环境变量、KV 或 Service Binding。保存 binding 后重新部署 Pages。

## HTTP 与 WebSocket 入口

- `POST /api/watch/create`：创建房间并返回 host `clientId` 与一次高熵 `resumeToken`。
- `GET /api/watch/state?room=xxxxxxxx`：读取可加入房间的当前状态。
- `GET /api/watch/ws?room=xxxxxxxx&role=host|viewer&clientId=...`：升级 WebSocket。
- `POST /api/watch/end`：WebSocket 不可用时的 host 结束房间 fallback。

`resumeToken` 仅保存在 host 的 `sessionStorage`。Durable Object 只保存 SHA-256；WebSocket 恢复通过 `Sec-WebSocket-Protocol` 传递，不放 URL query、不广播、不写日志。HTTP fallback 结束房间同样需要 token。

## 统一 alarm

Durable Object 每个实例只有一个 alarm。房间把所有 deadline 放在：

```js
deadlines: {
  startDeadlineAt,
  episodeDeadlineAt,
  hostReconnectDeadlineAt,
  roomExpireAt
}
```

`scheduleNextAlarm()` 只调度最早的非空 deadline。alarm 唤醒后处理所有已到期任务，再计算下一次 alarm。处理函数按当前 status/changeId 校验，重复唤醒不会重复开播、重复切集或重复结束房间。

## 主要事件

客户端到 Worker：

- `client:heartbeat`
- `client:buffering` / `client:buffering-end`
- `viewer:ready`
- `client:ready`
- `client:episode-ready`
- `host:start`
- `host:play` / `host:pause` / `host:seek` / `host:sync`
- `host:episode-change`
- `room:leave` / `room:end`

Worker 到客户端：

- `room:state` / `room:participants`
- `room:host-reconnecting` / `room:host-reconnected`
- `sync:prepare` / `sync:start`
- `sync:play` / `sync:pause` / `sync:seek` / `sync:state`
- `sync:episode-prepare` / `sync:episode-start` / `sync:episode-error`
- `server:pong`
- `room:error` / `room:ended`

只有经过恢复凭据认证的 host socket 可以发送 host 控制事件。Viewer 伪造 host event 会收到 `UNAUTHORIZED_ACTION`。

## 验收

部署后至少验证：

1. Host 创建房间并得到 8 位房间号。
2. Viewer 在 waiting、starting、playing 三种状态均可按规则加入。
3. play/pause/seek 与切集能同步。
4. Viewer 播放中加入时先加载当前媒体，再按 server-adjusted target time 对齐。
5. Viewer 缓冲只显示成员状态，不暂停房主。
6. Viewer 短暂断线自动恢复并重新接收 `room:state`。
7. Host 断线后房间不立即结束；45 秒内恢复成功，超时才结束。
8. 旧 host socket 的迟到 close 不会把新连接判离线。
9. 房间结束后 socket、timer、listener 被清理。

本地纯逻辑测试：

```bash
npm test
```

## 免费额度与安全边界

- Durable Object 只广播小型 JSON，不传视频分片或完整弹幕。
- `host:sync` 每 3 秒实时广播，但持久化 checkpoint 最快每 15 秒一次。
- heartbeat 每 10 秒，participant `lastSeenAt` 最快每 60 秒持久化一次。
- WebSocket 单消息最大 64 KiB，数值字段有范围校验。
- Pages Function 有 create/state/ws 的进程内基础限频；它不是跨 isolate 的强一致 WAF。公开部署建议同时配置 Cloudflare Rate Limiting/WAF。
- 8 位房间号仍是 viewer 的加入凭据；加入者会收到当前媒体 URL。不要把本来不能分享的长期私有媒体凭据放进房间。

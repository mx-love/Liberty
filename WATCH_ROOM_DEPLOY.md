# Liberty 一起看阶段 2 部署说明

## 一、阶段 2 当前实现范围

当前阶段只实现一起看房间后端的最小打通：

- 创建房间。
- WebSocket 加入房间。
- 在线人数广播。
- 房主结束房间。
- 观众退出房间。

当前阶段明确未实现：

- play/pause 同步。
- seek 同步。
- 切集同步。
- 切换资源站同步。
- 聊天。
- 自动重连复杂逻辑。
- 房主异常断线 60 秒后自动结束。
- 视频流转发。

当前实现文件：

- `workers/watch-room/index.js`
- `workers/watch-room/wrangler.toml`
- `functions/api/watch/[[path]].js`
- `js/watch-room/ui.js`

当前前端只接入：

- `POST /api/watch/create`
- `GET /api/watch/ws?room=xxxxxxxx&role=host|viewer`
- `POST /api/watch/end`

## 二、整体部署模型

推荐使用 Cloudflare 自带 Git 集成自动部署，不使用 GitHub Actions，也不要求日常本地运行 `wrangler deploy`。

同一个 GitHub 仓库会被 Cloudflare 使用两次：

```txt
GitHub 仓库
├─ Cloudflare Pages：部署 Liberty 主站
└─ Cloudflare Workers：部署一起看 Worker
```

主站 Pages 负责：

```txt
index.html
player.html
functions/
搜索、播放、弹幕、代理、设置面板
/api/watch/create
/api/watch/ws
```

一起看 Worker 负责：

```txt
Durable Object 房间状态
WebSocket 房间连接
在线人数
房主结束房间
观众退出房间
```

用户只访问主站域名，不需要直接访问 Worker 域名。

访问链路：

```txt
用户浏览器
→ 主站域名 /api/watch/create
→ Pages Function functions/api/watch/[[path]].js
→ env.WATCH_ROOM_DO
→ liberty-watch-room-worker / WatchRoomDurableObject
```

因此：

- 不需要给 Worker 配自定义域名。
- 不需要让用户访问 `workers.dev`。
- 不需要额外公开 Worker 地址。

## 三、创建 Cloudflare Workers Git 集成

在 Cloudflare Dashboard 中创建 Worker Git 集成：

```txt
Cloudflare Dashboard
→ Workers & Pages
→ Create application
→ Workers
→ Import a repository / Connect to Git
→ 选择同一个 GitHub 仓库
```

配置重点：

```txt
Worker name: liberty-watch-room-worker
Root directory: workers/watch-room
Wrangler config: workers/watch-room/wrangler.toml
```

如果界面需要填写部署命令：

```txt
Deploy command: npx wrangler deploy
```

如果 Cloudflare 自动识别 `wrangler.toml`，以界面实际提示为准。

必须保证：

```txt
Worker name 必须和 workers/watch-room/wrangler.toml 里的 name 保持一致。
```

当前 `workers/watch-room/wrangler.toml` 已与推荐配置一致：

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

说明：

- 使用 SQLite-backed Durable Object。
- 不使用 key-value storage backend。
- Worker 由 Cloudflare Workers Git 集成自动部署。
- 本地 `npx wrangler deploy` 只作为临时调试备选，不是日常部署主流程。

## 四、Cloudflare Pages Binding 配置

Worker 部署成功后，回到 Cloudflare Pages 项目 `liberty`：

```txt
Workers & Pages
→ liberty
→ Settings
→ Bindings
→ Add binding
```

选择：

```txt
Durable Object namespace
```

不要选择：

```txt
Service Binding
```

也不要添加普通环境变量。

填写：

```txt
Variable name: WATCH_ROOM_DO
Worker script: liberty-watch-room-worker
Class name: WatchRoomDurableObject
```

保存后，需要重新部署 Pages。

必须明确：

```txt
WATCH_ROOM_DO 不是普通环境变量。
WATCH_ROOM_DO 不是 KV。
WATCH_ROOM_DO 不是 Service Binding。
WATCH_ROOM_DO 是 Durable Object namespace binding。
```

Production 和 Preview 环境都建议配置。

如果使用 Pages Wrangler 配置，Durable Object binding 需要带 `script_name`，例如：

```toml
[[durable_objects.bindings]]
name = "WATCH_ROOM_DO"
class_name = "WatchRoomDurableObject"
script_name = "liberty-watch-room-worker"
```

当前推荐优先使用 Cloudflare Dashboard 配置 Pages binding，减少额外配置文件变更。

## 五、第一次部署顺序

第一次部署建议按以下顺序执行：

```txt
1. Push 当前代码到 GitHub。
2. Cloudflare Pages 自动部署主站。
3. 在 Cloudflare Workers 中创建/连接 GitHub 仓库。
4. Root directory 选择 workers/watch-room。
5. 确认 Worker 名称是 liberty-watch-room-worker。
6. 等 Worker 自动部署成功。
7. 回到 Pages 项目 liberty。
8. Settings → Bindings → Add binding。
9. 添加 Durable Object namespace binding：
   WATCH_ROOM_DO → liberty-watch-room-worker / WatchRoomDurableObject
10. 重新部署 Pages。
11. 打开播放页测试一起看。
```

注意：

- Worker 和 Pages 是两个自动部署目标。
- Worker 部署成功后，Pages 不会自动获得 binding，必须配置 `WATCH_ROOM_DO`。
- 配置 binding 后必须重新部署 Pages。

## 六、后续日常开发流程

后续日常开发仍然只需要：

```txt
GitHub Desktop
→ Commit
→ Push
```

Cloudflare 会自动执行两件事：

```txt
Cloudflare Pages 自动部署主站
Cloudflare Workers 自动部署 workers/watch-room
```

用户不需要每次手动部署 Worker。

不需要：

- GitHub Actions。
- `.github/workflows/deploy-watch-room-worker.yml`。
- `CLOUDFLARE_API_TOKEN`。
- `CLOUDFLARE_ACCOUNT_ID`。
- 日常本地运行 `npx wrangler deploy`。

## 七、验证步骤

部署 Worker、配置 Pages binding 并重新部署 Pages 后：

1. 打开播放页。
2. 点击“一起看”。
3. Network 查看：

```txt
POST /api/watch/create
```

状态判断：

```txt
200：创建房间成功
503：WATCH_ROOM_DO 没绑定，或 Pages 绑定没生效
404：functions/api/watch 没部署到 Pages
500：Pages Function 或 Durable Object 内部错误
```

创建成功时应返回：

```json
{
  "success": true,
  "roomId": "83492157",
  "role": "host",
  "clientId": "host_xxx",
  "maxMembers": 10
}
```

创建成功后继续看：

```txt
GET /api/watch/ws?room=xxxxxxxx&role=host
```

理想状态：

```txt
101 Switching Protocols
```

然后：

1. 打开首页设置面板。
2. 输入同一个 8 位房间号。
3. 点击加入房间。
4. 在线人数应从 `1/10` 变成 `2/10`。
5. 房主点击结束房间。
6. 观众应收到房间结束提示。

## 八、常见错误

### WATCH_ROOM_DO is not configured

原因：

```txt
Pages 没添加 Durable Object namespace binding。
添加成了普通环境变量。
添加成了 Service Binding。
添加后没有重新部署 Pages。
Production / Preview 环境配错。
```

处理：

- 在 Pages 项目中添加 Durable Object namespace binding。
- 确认 variable name 是 `WATCH_ROOM_DO`。
- 确认 Worker script 是 `liberty-watch-room-worker`。
- 确认 class name 是 `WatchRoomDurableObject`。
- 保存后重新部署 Pages。

### 找不到 Durable Object 选项

原因可能是：

```txt
liberty-watch-room-worker 还没有部署成功。
Worker 没有正确导出 WatchRoomDurableObject。
wrangler.toml migration 没成功。
Cloudflare 页面还没刷新。
```

处理：

- 确认 Workers Git 集成部署成功。
- 确认 Worker 名称是 `liberty-watch-room-worker`。
- 确认 `workers/watch-room/index.js` 导出 `WatchRoomDurableObject`。
- 确认 `wrangler.toml` 中 migration 存在。
- 刷新 Cloudflare Dashboard 后再添加 binding。

### 404 /api/watch/create

原因：

- `functions/api/watch/[[path]].js` 没部署到 Pages。
- Pages 构建输出或 Functions 路径配置异常。
- 当前访问的不是 Cloudflare Pages 部署环境。

处理：

- 确认 `functions/api/watch/[[path]].js` 已提交并部署。
- 确认部署日志中包含 Pages Functions。
- 确认请求路径是本站 `/api/watch/create`。

### WebSocket 不是 101

原因可能是：

```txt
/api/watch/ws 没有走到 Pages Function。
Upgrade header 不正确。
Durable Object 转发失败。
Pages binding 没生效。
```

补充原因：

- room 参数不是 8 位数字。
- 房间不存在或已结束。

处理：

- 检查 Network 中 `Upgrade: websocket`。
- 检查 URL：`/api/watch/ws?room=xxxxxxxx&role=host|viewer`。
- 先确认 `POST /api/watch/create` 成功返回房间号。
- 查看 Pages Function 日志。

### Worker Git 集成部署失败

原因可能是：

```txt
Root directory 没选 workers/watch-room。
Worker name 和 wrangler.toml 里的 name 不一致。
wrangler.toml 不在 root directory 中。
migration 配置错误。
```

处理：

- 确认 Root directory 是 `workers/watch-room`。
- 确认 Worker name 是 `liberty-watch-room-worker`。
- 确认 `workers/watch-room/wrangler.toml` 已在 Worker root directory 内。
- 确认 migration：

```toml
[[migrations]]
tag = "v1"
new_sqlite_classes = ["WatchRoomDurableObject"]
```

### Pages Production / Preview binding 配错

原因：

- Production 配了 binding，Preview 没配。
- Preview 配了 binding，Production 没配。
- binding 名称大小写不一致。
- 把 Durable Object namespace binding 添加成了普通环境变量。
- 把 Durable Object namespace binding 添加成了 Service Binding。

处理：

- Production 和 Preview 都配置 `WATCH_ROOM_DO`。
- binding 名称必须完全一致。
- 类型必须是 Durable Object namespace。

### Worker 部署成功但 Pages 没重新部署

原因：

- Worker 和 Pages 是两个部署目标。
- Durable Object Worker 部署成功不代表 Pages Function 能拿到 binding。

处理：

- Worker 部署成功后，配置 Pages binding。
- 配置 binding 后重新部署 Pages。
- 重新打开站点验证 `/api/watch/create`。

## 九、免费额度注意事项

当前阶段对免费额度友好：

- 不转发视频流。
- 不代理房间内的视频分片。
- 只同步轻量 JSON。
- 房间最多 10 人。
- 当前阶段没有 play/pause/seek 高频同步。
- 心跳为 30 秒一次。
- 房主结束、观众退出、在线人数广播都是低频事件。

后续阶段注意：

- play/pause/seek 同步要限频。
- 房主状态同步建议保持 5 秒一次。
- 不要同步视频分片或弹幕大列表。
- 聊天如果实现，需要限频和消息长度限制。
- 加入失败需要限频，避免猜房间号。
- Cloudflare 请求量过高时，可以加配置开关禁用一起看。

## 十、部署前检查清单

- `workers/watch-room/wrangler.toml` 已存在。
- `workers/watch-room/wrangler.toml` 的 `name` 是 `liberty-watch-room-worker`。
- `workers/watch-room/index.js` 导出 `WatchRoomDurableObject`。
- `functions/api/watch/[[path]].js` 只依赖 `env.WATCH_ROOM_DO`。
- 没有修改 `/proxy`。
- 没有修改 `/api/danmu`。
- `js/api.js` 只拦截 `/api/search` 和 `/api/detail`，不会拦截 `/api/watch/...`。
- `js/watch-room/ui.js` 在 503 时提示“一起看后端尚未配置”。
- 当前阶段没有真实播放同步。


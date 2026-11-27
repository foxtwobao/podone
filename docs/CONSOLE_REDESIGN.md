# Podone 新版控制台与后端体验规划

状态：P0 + P1 已实施并部署至 Lab（2026-11-27）。配套交互原型见 [`docs/preview/console-prototype.html`](preview/console-prototype.html)，新前端源码位于 [`server/main/pod-console/`](../server/main/pod-console/)。

## 1. 背景与产品定位

Podone 全面接入 **Botone**（AI 大脑、角色「波波」、车队、工具、记忆、审批）与 **TokenONE / Reseller**（个人模型连接与按量计费）后，原上游小智「智能体（Agent）+ 8 类模型 + 知识库」的管理后台已与真实运行链路脱节。

新版 Podone 后台定位为 **「物理硬件伴侣与语音网关运维控制台」**，四端职责边界如下：

| 端 | 职责边界 |
| --- | --- |
| **IDONE** | 统一账号、登录态与安全 |
| **Botone** | 「波波」人设/指令、专业 Bot 车队与群聊、Skill/知识库、对话历史与记忆、审批规则、例行任务、**TokenONE/Reseller 个人授权** |
| **TokenONE** | 个人模型连接、LLM/TTS 路由与额度计费 |
| **Podone 控制台** | **Pod 扫码绑定/解绑、4 项开箱就绪体检、实时在线态与设备 MCP 遥控、设备级音色与通知/免打扰偏好、固件 OTA、语音节点运维** |

## 2. 核心设计决策

1. **前端形态**：新建独立、移动优先的轻量响应式前端目录（建议 `console/`，React + Vite + Tailwind，视觉对齐 Botone），统一替代现有 Vue 2 `manager-web` 与 uni-app `manager-mobile`。
   - 保留 `server/main/manager-web` 与 `server/main/manager-mobile` 不做侵入式大改，避免后续 `git merge -X subtree=server/` 合并上游产生大规模冲突。
   - `Dockerfile-web` 构建产物切换为新前端，Nginx 将 `/` 指向新控制台，`/mobile/` 302 重定向回 `/`，复用既有 `/xiaozhi/user/idone/*` 回调与业务 API。
2. **去智能体化（Device-First）**：对用户彻底隐藏“小智智能体”概念。绑定设备直接归属当前 IDONE 用户，不再强制先建智能体。
3. **下线音色克隆与无效模块**：首期只保留与当前系统 `ttsModel` 兼容的内置音色目录与试听；移除智能体、8 大类模型、供应器、知识库、上下文源、角色模板、发音替换词、旧聊天记录、声纹、设备通讯录、旧功能开关及「手动添加设备（免激活码）」。
4. **Botone 轻量只读探活**：在 Botone 外设网关新增 `POST /api/peripheral/v1/status`（沿用 `PERIPHERAL_BRIDGE_SECRET`），仅返回只读就绪态与深链，绝不返回任何 Key，彻底把“设备报错才发现未授权”前置为控制台可见引导。

## 3. 用户旅程与信息架构

### 3.1 普通用户端（3 个核心视图）

1. **我的 Pod（`/`）**
   - **Botone 联动与 4 项就绪体检条**：展示 `IDONE 登录`、`Botone 波波`、`TokenONE 授权/额度`、`在线 Pod 数`；未授权/额度耗尽/历史旧绑定缺指纹时给出明确指引与一键跳转按钮；常驻深链至 Botone 的「编辑波波指令」「对话记录与任务」「审批规则」。
   - **设备卡片网格**：展示板型（`waveshare-1.75c`）、实时状态（在线待机 / 对话中 / 专线通话中 / 离线）、播报音色、固件版本与 OTA 提示、快捷「眨眼试音」与「设备设置」。
2. **单台 Pod 控制面板（抽屉/详情）**
   - **声音与音色**：跟随默认音色或设备单独指定，支持内置音色切换与试听。
   - **实时硬件遥控（设备 MCP）**：音量、亮度、圆屏形象（极简波波 / 琉璃金缮）、眨眼测试、重新配网。
   - **来电与通知偏好**：允许 Bot 主动来电（`call_user`）、允许异步结果/例行任务播报、夜间免打扰时段。
   - **固件与安全**：自动 OTA 开关、版本查看、解绑设备（立即踢断连接并清空待播报队列，不影响 Botone 数据）。
3. **开箱绑定页（`/bind?code=XXXXXX`）**
   - 扫码直达自动预填 6 位码（未登录先走 IDONE 回跳并保留 `code`）。
   - 单页完成：识别板型 → 起别名（提供房间快捷标签）→ 选音色 → 一键绑定 → 自动触发就绪体检并引导首次唤醒「你好波波」。

### 3.2 管理员运维台（仅 `superAdmin`，5 个 Tab）

1. **运行概览**：在线 Pod 数、WS 语音节点状态、Botone Bridge 延迟探活、24h 鉴权/额度错误统计。
2. **语音与通道配置**：表单化维护 `podone.voice.models`（`chatModel`、`ttsModel`、默认 `ttsVoice`）、向用户开放的音色目录、VAD 断句时长、待机超时、唤醒词、本地兜底 TTS 开关、以及 `botone.device_tools` 硬件 MCP 允许列表。
3. **固件 OTA**：按板型管理固件上传、版本发布/回滚、装机占比。
4. **用户与全量设备**：IDONE 用户启停（停用立刻踢断在线 Pod）+ 跨用户全量设备排查与强制解绑。
5. **节点与核心参数**：WS 语音节点重载/重启，以及仅保留必要的 4 项基础设施参数（`server.fronted_url`、`server.websocket`、`server.ota`、`server.auth.enabled`）。

## 4. 后端改造清单（`manager-api` + `xiaozhi-server` + `botone`）

### 4.1 数据库与实体（Liquibase 增量迁移）
在 `ai_device` 增加设备级语音与通知偏好字段（或独立 `pod_device_pref` 表），并将 `agent_id` 允许为空：
- `tts_voice VARCHAR(128) NULL`：设备专属音色编码，为空则继承系统默认 `podone.voice.models.ttsVoice`
- `allow_incoming_call TINYINT(1) DEFAULT 1`
- `allow_async_notice TINYINT(1) DEFAULT 1`
- `dnd_enabled TINYINT(1) DEFAULT 0`
- `dnd_start VARCHAR(5) NULL` / `dnd_end VARCHAR(5) NULL`（如 `23:00` / `08:00`）

### 4.2 `manager-api` 新增/精简接口（统一挂在 `/pod/**` 与 `/admin/pod/**`）
- `GET /pod/readiness`：聚合返回系统语音模型配置状态、用户设备概览，以及调用 Botone `/api/peripheral/v1/status` 得到的账号/授权态与跳转链接。
- `GET /pod/devices`：直接按当前登录用户返回名下全部 Pod（合并来自 `xiaozhi-server`/Redis 的实时在线态、待机/对话状态及支持的工具列表，不再要求传 `agentId`）。
- `POST /pod/devices/bind`：仅凭 `code` + 可选 `alias` + 可选 `ttsVoice` 一步激活绑定；`GET /pod/devices/activation-preview?code=XXXXXX` 用于扫码页提前展示识别到的硬件板型。
- `PATCH /pod/devices/{id}`：修改别名、音色、来电/通知/免打扰开关、自动 OTA 开关。
- `POST /pod/devices/{id}/control`：校验设备归属后通过内网转发硬件 MCP 指令（音量、亮度、形象、动画、重新配网）。
- `DELETE /pod/devices/{id}`：解绑并通知 `xiaozhi-server` 立即断开该设备会话。
- `GET /pod/voices`：返回当前 `ttsModel` 下启用展示的内置音色目录与默认音色。
- `GET/PUT /admin/pod/voice-config`：管理员表单化读写 `podone.voice.models`、音色目录与通道参数。
- 简化 `PeripheralOwnerController.java`：按「`device.ttsVoice` → `podone.voice.models.ttsVoice`」直接解析音色，同时把 `allowIncomingCall` / `allowAsyncNotice` / `dnd` 一并下发给 `xiaozhi-server`。

### 4.3 `xiaozhi-server` 配合
- 连接态上报：在 `PeripheralSession` 建连、进入待机、开始对话、专线通话、断连时写入带 TTL 的轻量状态（Redis 或内网状态接口），供 `manager-api` 展示真实在线态与管理员大盘统计。
- 来电与异步通知投递前检查设备偏好（`allowIncomingCall` / `allowAsyncNotice` / 免打扰时段）。
- 暴露内网单设备控制转发入口（校验归属后调用 `call_mcp_tool`）与踢线通知。

### 4.4 Botone 外设网关配合（只读）
- 新增 `POST /api/peripheral/v1/status`：请求体为 `{ "issuer": "...", "subject": "..." }`，复用 `PERIPHERAL_BRIDGE_SECRET` 鉴权与既有账户/Reseller 探活，返回：
  ```json
  {
    "accountReady": true,
    "boboReady": true,
    "authStatus": "ready",
    "botoneBaseUrl": "https://bot.lab.home.arpa",
    "links": {
      "home": "/...",
      "boboSettings": "/...",
      "approvals": "/...",
      "authorization": "/..."
    }
  }
  ```

## 5. 分期实施计划

- **P0（去智能体化 + 顺畅开箱）**
  - Liquibase 字段迁移 + `manager-api` `/pod/devices/*`、`/pod/voices`、`/admin/pod/voice-config` 与 `PeripheralOwnerController` 简化。
  - 搭建 `console/` 新响应式前端（React + Vite + Tailwind），实现 IDONE 登录、`/bind` 一步绑定、「我的 Pod」列表、设备音色与基本信息编辑、管理员「语音与通道 / OTA / 用户与设备 / 节点」核心页。
  - 更新 `Dockerfile-web` 与 `nginx.conf` 切换上线并验证实机激活链路。
- **P1（就绪体检 + 真实在线态）**
  - Botone 新增 `POST /api/peripheral/v1/status`，`manager-api` 接入 `GET /pod/readiness`。
  - `xiaozhi-server` 上报实时在线/待机/对话态，接入首页体检条、设备卡片状态灯与管理员运行概览。
- **P2（硬件遥控 + 多 Pod 免打扰协同）**
  - 接通网页端设备 MCP 滑块控制（音量、亮度、形象、眨眼测试、重新配网）。
  - 接通单台 Pod 的来电/通知/免打扰时段偏好及 `xiaozhi-server` 投递路由过滤。

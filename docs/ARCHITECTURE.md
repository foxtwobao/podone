# Podone 架构方案

状态：方案，2026-11-23 初版，2026-11-24 更新 Botone 外设接入架构。

Podone 是面向自有硬件的语音终端项目，作为 **Botone**（`/Volumes/ext/Projects/botone`）的物理语音与圆屏外设运行。服务端基于定制的小智后端负责设备连接与实时音频管道，智能体对话、工具编排、记忆与 Reseller 模型授权统一交由 Botone 承载（详见 [Botone 外设接入方案](BOTONE_INTEGRATION.md)）。模型与语音合成调用走 TokenONE / New API，用户身份走 IDONE，个人模型 Key 由 Botone 通过 Reseller 获取并按轮次透传。设备端按硬件型号分目录，首个固件是微雪 ESP32-S3-Touch-AMOLED-1.75C，用户侧体验参考 [zongzhu-bot](https://github.com/Liu-zhongxian/zongzhu-bot)：圆屏上一对会眨眼、跟手、跟姿态变化的眼睛，配字幕与朗读。

## 1 结论

- 服务端以本地 `tokenone_xiaozhiserver` 的 `codex/idone-integration` 分支为基线迁入本仓库 `server/`，保留已完成的 IDONE 登录。
- **大脑与计费统一收敛至 Botone**（2026-11-24 决定）：不再在 Podone 内部独立实施完整的 Reseller 网页授权流与本地 LLM/记忆/意图体系，原 [接入实施方案](../server/docs/reseller-integration-plan.md) 由 [Botone 外设接入方案](BOTONE_INTEGRATION.md) 取代。首次接入时，Botone 基于其轻量 Pi Runtime 为用户自动初始化一个专属语音机器人（「波波」），绑定最快低延迟模型并关闭 Thinking，承接 Pod 的语音输入并通过内置车队工具（`list_fleet`、`message_bot`、`spawn_bot` 等）操作 Botone 中的所有机器人。
- **多用户、多设备严格按个人计费（零公共付费 Key）**：Podone 本地仅运行离线免费组件（`SileroVAD` + `SenseVoiceSmall` ASR）；每轮对话由 Botone 调用 Reseller `POST /api/apps/keys/ensure` 获取设备所属用户的个人 TokenONE Key，在运行 Pi LLM 的同时将本轮临时凭证透传给 `xiaozhi-server` 调用 TokenONE 流式 TTS，取消一切公共付费 Key（如公共 Minimax Key）回退。
- 固件以 [78/xiaozhi-esp32](https://github.com/78/xiaozhi-esp32) 为上游基线，提交记录写入 `UPSTREAM.json`。表情、手势、姿态这层参考 zongzhu-bot 的 `main/boards/common/zongzhu/`（MIT），按板型适配后放在本仓库，不 fork zongzhu-bot 整体。
- 首个固件的构建基线是 **ESP-IDF v6.0.3**。原定的 v5.5.5 在 2026-11-23 改掉：小智 v2.5.0 起要求 ESP-IDF 6.0.1 以上，zongzhu-bot 也用 6.0.1，同一条线更省事。
- 多硬件通过固件仓库内的板型目录实现，服务端按设备上报的板型选择固件与能力，不按硬件拆服务。

## 2 现状

| 来源 | 位置 | 状态 |
| --- | --- | --- |
| 小智后端定制版 | `/Volumes/ext/Projects/tokenone_xiaozhiserver`，分支 `codex/idone-integration`，远程 `github.com/foxtwobao/tokenone_xiaozhiserver` | 基于上游 0.9.7。已提交 Qwen Omni 多模态与本地部署；IDONE 登录（Java OIDC、Shiro、Web 与 H5）在工作区未提交。lab 运行于 `bot.lab.home.arpa` |
| Reseller | `/Volumes/ext/Projects/tokenone_reseller` | 应用授权契约稳定：`POST /api/apps/keys/ensure` 只接受 `identity.issuer/subject`，返回个人模型 Key。详见其 `docs/APPLICATIONS.md` |
| 接入方案 | `tokenone_xiaozhiserver/docs/reseller-integration-plan.md` | 2026-10 完成复核，明确了轮次级凭证、3 秒预算、零重试和禁止公共 Key 回退，尚未写代码 |
| 板卡资料 | 本仓库 `docs/hardware/ESP32-S3-Touch-AMOLED-1.75C/` | 原理图、数据手册、BSP 3.0.0、微雪 v1.0.2 示例与固件已归档；ESP-IDF 工具链和实板验收尚未执行 |
| 参考固件 | zongzhu-bot 2.5.2.9 | 上游固件提交 `49b4380`、上游后端提交 `60c2a7e`。表情模型、绘制、QMI8658 姿态检测集中在 `xiaozhi-esp32/main/boards/common/zongzhu/`，板型适配在 `main/boards/waveshare/esp32-s3-touch-amoled-1.75/` |

两个上游后端提交不在同一条线上：zongzhu-bot 的后端基线 `60c2a7e` 不在 `tokenone_xiaozhiserver` 的历史中。因此后端以本地定制版为准，只从 zongzhu-bot 借鉴交互与固件组织方式，不合并它的后端。

## 3 目标与边界

第一期交付一条完整链路：1.75C 板子唤醒后说话，音频流到自有服务端，完成识别、对话和语音合成，回答朗读回板子；等待和播报期间圆屏显示对应表情，触摸和倾斜有反馈；模型请求以设备所属用户的 Reseller Key 发给 TokenONE / New API。

明确不做：

- 不移植 zongzhu-bot 的 Grok Bot Webhook、本机点歌、小米音箱、网关页面和固件自动发布签名体系。它的后端把一句话转交给外部 Bot，本项目的对话就在小智服务内完成。
- 不在本期做 Web 配网门户、网页刷机、多板型的实板支持。目录和协议预留，代码只覆盖 1.75C。
- 不改 Reseller、TokenONE、New API、IDONE 的源码。应用登记、回调白名单和分组权益属于部署配置。
- 不把个人模型 Key、Reseller 应用凭证、IDONE 客户端密钥写入固件、数据库模型配置或日志。

## 4 仓库结构

```text
podone/
├── README.md                      项目说明与文档索引
├── UPSTREAM.json                  固件与服务端的上游地址和基线提交
├── server/                        迁入的小智后端（见第 5 节）
│   ├── main/xiaozhi-server/       Python 语音与对话
│   ├── main/manager-api/          Java 管理端，持有 IDONE 与 Reseller 凭证
│   ├── main/manager-web/          桌面管理端
│   ├── main/manager-mobile/       移动 H5
│   ├── deploy/                    部署配置
│   └── docs/                      迁入时保留 idone 与 reseller 两份文档
├── firmware/
│   ├── README.md                  板型清单、构建方法、新增板型的步骤
│   ├── components/podone/         各板型共用：表情、字幕、手势、姿态接口
│   ├── boards/
│   │   ├── waveshare-1.75c/       首个板型：引脚、分区、sdkconfig、板级初始化
│   │   └── _template/             新板型复制起点，只含清单不含可编译代码
│   ├── patches/                   打在上游小智固件上的补丁，目前只有一个
│   ├── UPSTREAM.json              上游小智固件与 zongzhu-bot 的提交
│   └── scripts/                   构建与打包，输出按板型命名
└── docs/
    ├── ARCHITECTURE.md            本文
    └── hardware/                  现有板卡资料，按型号归档
```

`server/` 与 `firmware/` 同仓，podone 是唯一主仓，原 `tokenone_xiaozhiserver` 已放弃。两边通过一份版本化的设备协议对接，协议字段在 `docs/` 单列一页维护，避免服务端和固件各写一份。固件构建产物和 `dependencies.lock` 进仓，`build/`、`sdkconfig` 本地产物、`managed_components/` 不进仓。

上游小智固件不进仓，构建时按 `firmware/UPSTREAM.json` 拉取，见第 6 节。`components/podone` 和板型目录不改上游文件，对上游只有一个 CMake 补丁，所以以后可以把某个板型拆到独立仓库。

## 5 服务端

### 迁入方式

把 `tokenone_xiaozhiserver` 的 `codex/idone-integration` 工作区整体复制到 `server/`，包含未提交的 IDONE 改动。2026-11-23 删除 `server/.git`，`server/` 作为普通目录进入 podone 仓库；删除前的历史另存为仓库外的 bundle。源仓库放弃，不再在那边开发。

不用 submodule。合并上游时在 podone 里加上游 remote，执行 `git merge -X subtree=server/`，冲突逐项处理。`server/UPSTREAM.json` 记录上游仓库与已合并的提交，具体命令见 `server/IMPORT.md`。

迁入时删除或忽略 `.env.local`、`.lab/` 和其中的客户端密钥、CA 备份。lab 的域名、应用名和启动方式记入 `server/docs/`，密钥仍只留在部署机器上。lab 原在 `192.168.10.38`，该机退役，IDONE、New API、Reseller 和 podone 服务端迁到 Mac mini 单机运行。

### 保留的定制

- IDONE 登录：Java 侧 OIDC 授权码与 PKCE，`sys_user` 保存 `(idone_issuer, idone_subject)`，Shiro 继续校验应用 Token 与账号状态。Web 与 H5 不再有本地注册和密码。
- 设备侧认证保持小智原样：OTA 接口签发 HMAC token，WebSocket 用 `Device-ID`、`Client-ID`、`Authorization` 连接。设备不感知 IDONE、Botone 与 Reseller。

### Botone 外设接入与统一 Reseller 计费

完整设计见 [docs/BOTONE_INTEGRATION.md](BOTONE_INTEGRATION.md)，核心约束如下：

- **统一身份免配对**：`podone` 与 `botone` 共享同一个 IDONE OIDC 身份源。Java `manager-api` 按设备、所属用户解析 `(idone_issuer, idone_subject)` 下发给 Python `xiaozhi-server`；`botone` 外设网关通过 `oidcAccountSubject(issuer, subject)` 精确映射到本地用户与默认 Space。
- **专属轻量 Pi 机器人承接对话**：首次接入时，`botone` 在用户默认 Space 下幂等创建专属语音 Bot「波波」（`spawnKey = "peripheral:podone"`），固定绑定低延迟快模型、关闭思考（`thinkingLevel: "off"`）、禁用自身沙箱电脑工具、开启车队管理权限（`manageOtherBots: true`），并在系统提示词中要求首字符输出情绪 Emoji 及纯口语短句。`podone` 关闭自身的 `Intent`、`Memory`、`VLLM`、`Omni` 以及 Java 标题生成。
- **轮次级个人 Key 传递与流式 TTS**：`botone` 独占 Reseller 应用凭证。每轮语音请求进入 `botone` 外设网关时，由 `botone` 调用一次 `POST /api/apps/keys/ensure` 获取用户个人 TokenONE Key，一方面供 Pi Runtime 调用 LLM，另一方面在内部 SSE 流首包中透传给 `xiaozhi-server` 调用 TokenONE 网关流式 TTS。严禁使用任何公共付费模型或公共 TTS Key（如公共 Minimax Key）回退；未授权或额度耗尽时由 `xiaozhi-server` 播放本地静态错误提示音。
- **设备换绑或用户停用**：服务端主动断开旧连接，固件按断线重连处理，不在固件里缓存任何用户身份。

本期新增的唯一设备协议字段是服务端下发的表情与情绪状态，见第 7 节。其余设备消息沿用小智协议。

## 6 固件

### 路线选择

小智官方固件已经支持这张板，板型目录为 `waveshare/esp32-s3-touch-amoled-1.75`，`config.json` 里有 `1.75` 与 `1.75c` 两个构建变体。zongzhu-bot 的 1.75C 适配也放在这个目录，引脚与本仓库 `docs/hardware/ESP32-S3-Touch-AMOLED-1.75C/hardware/BOARD.md` 一致：屏幕复位 GPIO1、触摸复位 GPIO2、触摸中断 GPIO11、I²S MCLK GPIO16、QMI8658 轴映射 `SCREEN_X = accel[1]`、`SCREEN_Y = accel[0]`。音频输入、输出采样率均为 24000 Hz，并开启了参考信号回采。

因此固件不从微雪 BSP 示例起手，而是基于小智固件的板型支持。微雪 v1.0.2 示例和 BSP 3.0.0 留作显示、触摸、电源、IMU、录音的对照与排错依据，不作为应用框架。

接入方式（2026-11-23 阶段 2 定下，已上板验证）：上游不 vendor，也不当组件依赖，而是构建时克隆上游并打一个小补丁。

- 原先设想的组件依赖走不通：小智的 `main` 是 ESP-IDF 的主组件，板级源码由 `main/CMakeLists.txt` 按 `BOARD_TYPE` 从 `main/boards/` 下 glob 进来，外部工程没法在不改它的前提下换掉板级源码。
- 整棵 vendor 能用，但每次跟上游都要搬一遍几百个板型目录，而 Podone 实际只需要换板级源码。
- 现在的做法：`firmware/scripts/build.sh` 按 `firmware/UPSTREAM.json` 的提交把上游拉到 `firmware/.upstream/`（不进仓），打上 `firmware/patches/xiaozhi-esp32-board-dir.patch`。这个补丁只改 `main/CMakeLists.txt`：环境变量 `PODONE_BOARD_DIR` 有值时，从那里取板级源码和 `config.json`，并把 `PODONE_INCLUDE_DIRS` 加进头文件路径。
- 板型仍然选中上游的 Kconfig 板型符号（1.75C 是 `CONFIG_BOARD_TYPE_WAVESHARE_ESP32_S3_TOUCH_AMOLED_1_75C`），这样字体、表情集、AEC 等依赖和官方变体一致。
- 升级上游时改 `UPSTREAM.json` 的提交，再确认补丁还能打上。

表情与姿态代码放在 `firmware/components/podone/`，不散落到板型目录。

### 与 zongzhu-bot 的关系

直接借鉴并按 MIT 许可保留署名的部分：

| 参考文件 | 作用 | 落点 |
| --- | --- | --- |
| `eye_model.h` | 13 种表情的形状与动态，纯数学，不依赖 LVGL，可在主机上单测 | `components/podone/eyes/` |
| `eye_display.h` | 绘制、眨眼、眼神、触摸手势、字幕模式，屏幕尺寸由参数传入 | `components/podone/eyes/` |
| `qmi8658_motion.h` | 倾斜跟随与摇晃检测 | `boards/waveshare-1.75c/`，因为 IMU 型号和轴向是板级的 |

需要改写的部分：

- 情绪来源。zongzhu-bot 的表情由本地状态机加服务端情绪标签驱动，情绪标签来自它自己的网关。Podone 的情绪来自小智对话链路，需要确认服务端实际下发的字段，没有对应字段时先只靠本地状态（待机、聆听、思考、播报）驱动。
- 唤醒词。参考项目编译期写死 `ni hao zong zhu`。Podone 的唤醒词作为板型配置项，默认值在实施时确定，不沿用"宗主"。
- 采样率与 AEC。参考项目使用 24000 Hz 并开启设备端回声消除；本仓库板卡资料未覆盖这两项。移植时以能和自有服务端的 ASR、TTS 协商通过为准，不照搬数值。

不引入的部分：`ikun_assets.h`（约 4 MB 的图片资源）、网页刷机、固件签名发布、改唤醒词的在线接口。字幕的完整、简洁、关闭三档和 BOOT 键切换可以保留，属于 `eye_display` 的一部分。

### 板型目录约定

每块板在 `firmware/boards/<board-id>/` 下自包含，至少包括：

- `README.md`：硬件来源、与通用组件的差异、实板验收记录。
- `config.h`：引脚与总线参数，数值要能回溯到原理图或已核对的参考实现。
- `sdkconfig.defaults` 与分区表：Flash 容量、PSRAM 模式按该板实际填写。1.75C 为 32 MB Flash、八线 PSRAM。
- `main/`：板级初始化、按键、与 `components/podone` 的连接。

`firmware/README.md` 维护板型清单，字段为板型 ID、芯片、屏幕、音频编解码器、IMU、状态。新板型从 `_template/` 复制，先补清单和引脚，再谈功能。服务端 OTA 按设备上报的板型 ID 选择固件包，板型 ID 一旦发布不再复用。

### 构建基线

ESP-IDF v6.0.3，目标 `esp32s3`，上游为小智 v2.6.0（提交 `4de00ae`），它锁定的 LVGL 是 9.5.0，已写入 `firmware/UPSTREAM.json`。v5.5.5 仍装在 `~/esp/esp-idf`，只用于跑微雪示例，微雪 v1.0.2 示例是用它构建的。

zongzhu-bot 用 ESP-IDF 6.0.1 构建，和当前基线同属 6.0 系列。移植 `eye_display` 时改了几处接口：小智 v2.6.0 的 `SetEmotion` 返回 `bool`，新增了 `RemoveChatMessage`，LVGL 9.5 的动画回放改名为 `reverse`。完整差异见 `firmware/components/podone/README.md`。

## 7 设备协议

沿用小智现有的 OTA、激活、WebSocket 音频与 JSON 消息。Podone 只追加，不修改既有字段语义。

设备上报增加一个板型对象，用于 OTA 选型和服务端判断能力：

```json
{
  "board": {
    "id": "waveshare-1.75c",
    "chip": "esp32s3",
    "firmware": "0.1.0"
  }
}
```

服务端已经在每轮回答开头下发一次情绪，消息由 `textUtils.get_emotion` 生成，情绪词来自回复文本里第一个 emoji 的映射：

```json
{"type": "llm", "text": "🙂", "emotion": "happy", "session_id": "..."}
```

固件把 `emotion` 映射到本地表情，映射表放在固件里，服务端不感知具体画法。待机、聆听、思考、播报由固件按录音与播报状态推导；服务端情绪只覆盖开心、惊讶、困惑、难过这类回答态。未知或缺失的 `emotion` 保持当前状态推导的表情，不显示错误。是否扩展服务端的情绪词表，留到阶段 3 看实际回复效果再定。

字幕沿用服务端已有的文本消息。固件侧的字幕模式只影响显示，不回传服务端。

## 8 分期

| 阶段 | 内容 | 完成标准 |
| --- | --- | --- |
| 0 基线 | 安装 ESP-IDF，用小智官方固件的 1.75C 变体连接 lab 服务端（2026-11-23 已在实板上跑通，见 HANDOFF） | 显示、触摸、录音、播报、唤醒在实板上确认，延迟基线按 reseller 方案第 7 节记录 |
| 1 迁入 | 复制 `tokenone_xiaozhiserver` 到 `server/`，核对构建与 lab 部署，补 `UPSTREAM.json` | 迁入后的服务端与源仓库行为一致，密钥未进仓 |
| 2 表情固件 | 建立 `firmware/` 目录与 1.75C 板型，接入表情、字幕、触摸和姿态（2026-11-23 已在实板上达标，见板型 README） | 不连服务端时，触摸、倾斜、摇晃的反馈与参考项目一致 |
| 3 链路接通 | 固件连接自有服务端，完成唤醒、对话、朗读，表情跟随状态 | 一轮问答全程走通，断线可重连 |
| 4 Botone 外设接入与统一计费 | 按 [docs/BOTONE_INTEGRATION.md](BOTONE_INTEGRATION.md) 实施 `botone` 外设网关、专属语音 Bot「波波」自动初始化、`podone` `BotoneLLMProvider` 与轮次级 TokenONE 个人 Key 流式 TTS（取代原独立 Reseller 阶段） | 通过语音可直接对话、向 Botone 其他 Bot 派活、口头审批/急停；LLM 与云端流式 TTS 100% 走用户个人 TokenONE Key 计费，零公共付费 Key 回退，且第 3 阶段的硬件体验不回退 |

阶段 0 和阶段 1 互不依赖，可以并行。阶段 4 的完整契约与分步验收见 [docs/BOTONE_INTEGRATION.md](BOTONE_INTEGRATION.md)。

## 9 待确认

1. 固件接入方式已定，见第 6 节。
2. 唤醒词、服务端地址的写入方式（编译期写入还是首启配网）本期未定，不影响目录结构和协议。
3. 服务端情绪词表目前只覆盖回复文本中出现 emoji 的情况，覆盖范围在阶段 3 用实际对话验证。

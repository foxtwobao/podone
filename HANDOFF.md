# Podone 交接文档

更新于 2026-11-23。工作在用户要求下暂停，本文记录暂停时的状态，接手的人从这里继续。

方案总览见 `docs/ARCHITECTURE.md`，本文只写方案之外的进度、决定和卡点。

## 0 2026-11-23 第二次会话进展

这次会话直接跑在用户的 Mac mini 上（`192.168.31.160`），第 3 节的沙盒限制不再适用。计划见 `/Users/hulei/.claude/plans/handoff-md-adaptive-cocoa.md`。

新决定：

- 38 服务器退役。IDONE、New API、Reseller 和 podone 服务端都迁到这台 Mac，Caddy 也装在 Mac 上。其他项目以后另做计划。
- 旧小智部署由 podone 取代，端口沿用 8000/8002/8003。
- `docs/hardware/` 的大文件不进仓库，用 `fetch-large-files.sh` 下载，再按 `SHA256SUMS` 校验。
- 设备走单独的 HTTP 入口，因为设备不信任 Caddy 本地 CA。浏览器只走 HTTPS。
- 路由器 DNS 由用户改：`*.lab.home.arpa` 指向 `192.168.31.160`。

### 已完成

| 内容 | 位置 | 验证情况 |
| --- | --- | --- |
| 建仓 | 首次提交 `d90264f` | `server/.git` 已删除，删除前的历史存在仓库外的 `/Volumes/ext/Projects/podone-server-history.bundle`，已 verify；`models/` 的 18 个已跟踪文件已拷回 |
| ESP-IDF v5.5.5 | `~/esp/esp-idf`，脚本在 `firmware/scripts/` | `idf.py --version` 正常，微雪 `02_lvgl_demo_v9` 编译通过 |
| 板子识别 | `/dev/cu.usbmodem21101`（USB JTAG_serial debug unit，VID 0x303a） | `esptool.py` 读到 ESP32-S3 (QFN56) rev v0.2，内置 8 MB PSRAM，40 MHz 晶振，Flash 32 MB（厂商 c8 / 设备 4019，quad），MAC `c4:9e:7e:0b:d8:7c`，和 BOARD.md 一致；还没烧录 |
| lab 服务迁到 Mac | `/Volumes/ext/Projects/labstack/`（不进仓） | 由另一个会话完成。各 lab 域名不加 `-k` 走 HTTPS 都返回 200；整机重启后能否自动恢复还没测 |
| 激活页预填激活码 | 提交 `8c5c66a` | 设备收到的文本是 `https://pod.lab.home.arpa/#/bind?code=XXXXXX`，第二行是六位码；镜像构建时 `npm run build`、`mvn package` 都通过 |
| podone 部署 | compose 项目 `podone`，Caddy 站点 `server/deploy/pod.lab.caddy`（已装到 `/opt/homebrew/etc/caddy/conf.d/pod.caddy`） | 四个容器健康检查通过。HTTPS 首页 200，HTTP 的 OTA 返回新格式的激活提示，WebSocket 握手 101，HTTP 访问其他路径 308 跳转 HTTPS，登录 302 跳到 IDONE 授权页，授权页 200 |
| 旧小智数据 | podone 的 MySQL | 从 38 的导出恢复：30 张表，2 个用户、1 个智能体、1 台设备。`server.fronted_url`、`server.websocket`、`server.ota` 已改成 pod 域名 |
| IDONE 回调 | IDONE 里 `admin/xiaozhi` 应用 | 新加 `https://pod.lab.home.arpa/xiaozhi/user/idone/callback`，bot 那条保留；改之前的行备份在 `server/.lab/backups/` |

部署时踩到的两个坑，都已修复并提交：

- 上游 `server-base` 镜像带的是 mcp 2.x，和仓库锁定的 `mcp==1.22.0` 不兼容，server 一直重启。现在改为按本仓库的 requirements 本地构建（`4b5fb96`）。第一次构建要 20 分钟左右，慢在 OrbStack 容器出网，换 pip 源没用。
- 宿主 `/etc/hosts` 里 `idone.lab.home.arpa` 写的是 127.0.0.1，容器会继承这条，结果连到容器自己。现在 `compose.lab.yaml` 用 `extra_hosts` 把它指到 `host-gateway`（`686d4c8`）。

### 待办

1. 用真实账号在浏览器里走一遍：未登录打开绑定链接，经 IDONE 登录后回到绑定页，激活码已预填，绑定成功。这一步要先让浏览器能解析 `pod.lab.home.arpa`：要么在 Mac 的 `/etc/hosts` 加一条，要么等 OpenWrt 改好。
2. OpenWrt 的 DNS 已改好（2026-11-23 验证）：路由器的 IPv4 和 IPv6 两个 DNS 都把各 lab 域名解析到 `192.168.31.160`，用这个地址访问各站点 HTTPS 都返回 200，设备 OTA、WebSocket 和登录跳转也都正常。Mac `/etc/hosts` 里的 labstack 和 pod 测试条目已经删掉，原文件备份在 `/etc/hosts.bak-podone-20261123`。删掉之后本机也走路由器 DNS，各站点仍然返回 200，podone 登录跳转也正常。还剩一件事：用局域网里的其他设备实际访问一次，浏览器要先导入 Caddy 根证书。
3. 整机重启，确认 OrbStack、容器、Reseller 和 Caddy 都能自己起来。
4. 阶段 0：板子已识别。烧录前先备份整片 32 MB Flash，再跑微雪 `02_lvgl_demo_v9`，然后烧小智官方固件，把 OTA 地址设成 `http://pod.lab.home.arpa/xiaozhi/ota/`。
5. 4.5 区分测试和生产地址：生产地址还没给。

## 1 用户已确认的决定

1. 圆屏交互效果按 `docs/preview/eye-preview.html` 通过。开机用思考，配网用困惑，激活用好奇，出错用难过，激活码六位连排，配网提示不受字幕模式影响。
2. 仓库采用方案 A：以 podone 为唯一主仓，原 `tokenone_xiaozhiserver` 放弃，不再在那边开发。删除 `server/.git`，`server/` 作为普通目录进 podone 仓库；以后合并上游时在 podone 里加上游 remote，用 `git merge -X subtree=server/`。
3. 激活页要改：设备显示的地址直接打开预填激活码的设备绑定页，用户不必再手输 6 位码。
4. 服务端地址分测试和生产两套。测试地址为 `https://pod.lab.home.arpa/`，需要把本项目的 `server/` 部署到 lab，在本机安装 Caddy 并配置反代。生产地址尚未给出。

用户说明：板子已经插在 Mac 的 USB 上，ESP-IDF 尚未安装，要求由我们来装。

## 2 已完成

| 内容 | 位置 | 验证情况 |
| --- | --- | --- |
| 架构方案 | `docs/ARCHITECTURE.md` | 第 4、5 节关于仓库方式的描述已被决定 2 取代，待更新 |
| 圆屏交互预览 | `docs/preview/eye-preview.html` | 用户已确认 |
| 服务端迁入 | `server/`，记录见 `server/IMPORT.md`、`server/UPSTREAM.json` | 与源仓库比对 `git status`，除新增的 `IMPORT.md` 外一致（不含 `models/`，见第 4 节） |
| 固件目录骨架 | `firmware/README.md`、`boards/_template/`、`scripts/README.md`、`.gitignore` | 只有文档和目录 |
| 1.75C 板级参数 | `firmware/boards/waveshare-1.75c/config.h`、`README.md` | 18 个引脚与 BOARD.md、小智官方固件 1.75C 分支逐项比对一致 |
| 表情模型 | `firmware/components/podone/eyes/eye_model.h` | 与 zongzhu-bot 原文逐字一致，MIT 原文在 `LICENSE-zongzhu` |
| 情绪映射 | `firmware/components/podone/eyes/mood_map.h` | 主机单测 `test/test_mood_map.cc` 编译运行通过 |

固件还没有用 ESP-IDF 编译过，`components/podone/CMakeLists.txt` 只登记了头文件目录。显示层（绘制、眨眼、触摸、字幕）没有移植。

## 3 执行环境的限制

助手的命令跑在一台隔离的 Linux 沙盒里（aarch64），不是用户的 Mac。2026-11-23 实测：

- 看不到 USB 串口，只有虚拟键盘和触控板，无法直接烧录或读板子。
- 没有 Docker，没有 sudo，不能装系统软件。
- 网段是 `172.16.10.0/24`，连不到 lab 主机 `192.168.10.38`，也解析不了 `*.lab.home.arpa`。
- 能访问公网，`dl.espressif.com` 返回 200。

因此 ESP-IDF 安装、烧录、Caddy 安装、lab 部署都要在用户的 Mac 或 lab 主机上执行。可行的分工是助手写好脚本和配置放进仓库，用户在本机运行并回传输出。

## 4 待办

按建议顺序排列。前两项不依赖用户机器，可以先做。

### 4.1 podone 建仓（决定 2）

1. 删除前先备份：在 `server/` 里执行 `git bundle create ../server-history.bundle --all`，bundle 放在仓库外保存，不提交。
2. 删除 `server/.git`。删除需要用户授权，沙盒对 `podone` 文件夹的删除权限已在本会话开过一次，新会话要重新申请。
3. 在 `podone/` 根目录 `git init`，补根 `.gitignore`。至少忽略 `server/.env.local`、`server/.lab/`、`server/main/xiaozhi-server/models/` 下的大文件、各前端的 `node_modules/` 和 `target/`，以及 `firmware/` 下已列出的构建产物。
4. `server/main/xiaozhi-server/models/` 下有 18 个源仓库已跟踪的小文件，迁入时没有复制。建仓前从 `tokenone_xiaozhiserver` 把这两个目录（`SenseVoiceSmall`、`snakers4_silero-vad`）的已跟踪文件拷回来，否则首次提交会缺文件。不要拷 `model.pt` 这类被忽略的大文件。
5. `docs/hardware/` 共 111 MB，其中出厂固件和示例压缩包各 32 MB。提交前问用户是否用 Git LFS，或者只留 `SHA256SUMS` 和下载地址。
6. 更新 `server/IMPORT.md`、`server/UPSTREAM.json` 和 `docs/ARCHITECTURE.md` 第 4、5 节：写明源仓库已放弃，`.git` 已移除，上游合并改用 subtree 策略。
7. 首次提交前再扫一遍密钥。迁入时的扫描结论见 `server/IMPORT.md`。

### 4.2 激活页预填激活码（决定 3）

已查到的相关位置：`server/main/manager-api/src/main/java/xiaozhi/common/constant/Constant.java` 和 `server/main/manager-api/src/main/resources/db/changelog/202504151206.sql` 都引用了 `server.fronted_url`。还没有读具体实现。

要做的事：确认 OTA 激活响应里下发给设备的 `message` 怎么拼出地址和激活码；把地址改为带激活码参数的绑定页；`manager-web` 和 `manager-mobile` 的设备管理页读取参数并预填；未登录时先走 IDONE 登录，登录回来要保留激活码参数。设备侧不用改，它只显示和播报服务端给的文本。

### 4.3 lab 部署与 Caddy（决定 4）

已知的 lab 情况，来自原仓库 `.lab/backups/20261017-idone/`（只读过，未改动）：

- lab 入口是 `192.168.10.38` 上的 Caddy，用 `tls internal`，客户端要信任 Caddy 的本地 CA。DNS 在 OpenWrt 上把 `*.lab.home.arpa` 指到这台机器。
- 主配置会 `import /etc/caddy/conf.d/*.caddy`，各项目一个文件。旧的小智站点 `xiaozhi.lab.home.arpa` 反代到 `192.168.10.38:8002`，文件名带 `superseded`，说明已被替换，现状要上机确认。
- IDONE 在 `idone.lab.home.arpa`，后端端口 55300。

本项目的部署文件在 `server/compose.local.yaml` 和 `server/compose.lab.yaml`。开工前要处理的问题：

- `compose.local.yaml` 的项目名是 `tokenone-xiaozhi`，端口是 8000、8002、8003。如果旧部署还在 lab 上运行，会和新部署冲突。要先问用户旧部署是停掉还是并行；并行就改项目名和端口。
- `compose.lab.yaml` 挂载 `./.lab/java-cacerts`，它是信任 lab CA 的 Java 证书库，迁入时随 `.lab/` 一起排除了。部署时从 lab 主机或原仓库拷过去，不进仓。
- `.env.local` 要按 `.env.local.example` 新建。`APP_ORIGIN` 填 `https://pod.lab.home.arpa`。IDONE 需要为 podone 注册新的应用或者改回调地址，客户端密钥只放在部署机上。
- Caddy 站点要同时反代 Web 管理端（8002）、OTA（8003 的 `/xiaozhi/ota/`）和设备 WebSocket（8000）。具体路径要读 `docs/docker/nginx.conf` 和服务端配置确认后再写。设备走 HTTPS 时，固件要能信任 Caddy 本地 CA，否则要给设备单开一个 HTTP 或另配证书，这一点要和用户商量。
- OpenWrt 上要加 `pod.lab.home.arpa` 的 DNS 记录。

未解决的歧义：用户说的"本机 Caddy"是指 Mac，还是 lab 主机 `192.168.10.38`。已有配置用的是 `/etc/caddy/conf.d/`，更像 Linux 主机。动手前先问清楚。

### 4.4 ESP-IDF 安装与识别板子

在用户的 Mac 上安装 ESP-IDF v5.5.5，目标 `esp32s3`，版本依据 `docs/hardware/ESP32-S3-Touch-AMOLED-1.75C/DEVELOPMENT.md`。建议做法是助手写一个安装脚本放到 `firmware/scripts/`，由用户在终端运行。装好后用 `ls /dev/cu.usbmodem*` 和 `esptool.py chip_id` 确认板子，再按 `ARCHITECTURE.md` 第 8 节阶段 0 跑微雪 `02_lvgl_demo_v9` 和小智官方固件。

### 4.5 固件区分测试与生产地址

测试地址 `https://pod.lab.home.arpa/`，生产地址待用户给出。要定的是用编译期配置切换（例如两份 `sdkconfig.defaults`，或者构建脚本传参），还是在设备上首次配网时选择。依赖 4.3 先跑通 OTA 路径。

## 5 其他未决事项

- 唤醒词的默认值，不沿用"宗主"。
- 固件接入上游的方式（`ARCHITECTURE.md` 第 6 节两种方案），要上板验证后定。
- IMU 轴向符号暂取 zongzhu-bot 的映射，要上板确认。
- Reseller 鉴权按 `server/docs/reseller-integration-plan.md` 实施，排在阶段 4，本次没有动。

## 6 本会话留下的临时状态

- `server/.git/index.lock` 曾因沙盒跑 `git status` 残留，已删除。以后在挂载目录里跑 git 查询，加 `--no-optional-locks`。
- 参考文件下载在沙盒的 `/tmp`（`eye_display.h`、`qmi.h`、`mg.h` 等），会话结束即丢失。需要时从 zongzhu-bot 仓库 `xiaozhi-esp32/main/boards/common/zongzhu/` 和对应板型目录重新取。
- 原仓库 `tokenone_xiaozhiserver` 没有任何改动。

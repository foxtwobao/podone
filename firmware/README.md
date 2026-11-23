# 固件

Podone 的设备固件。每块板一个目录，表情、字幕和手势放在共用组件里，不散落到板型目录。

## 板型清单

| 板型 ID | 芯片 | 屏幕 | 音频 | IMU | 状态 |
| --- | --- | --- | --- | --- | --- |
| waveshare-1.75c | ESP32-S3 | 1.75 寸 466×466 圆屏，CO5300，QSPI | ES8311 播放 + ES7210 录音 | QMI8658 | 阶段 2 表情固件已上板，首个板型 |

板型 ID 一旦随固件发布就不再复用，服务端按它选择 OTA 包。

## 目录

```
firmware/
├── components/podone/    各板型共用的表情与交互
├── boards/<board-id>/    板级工程：引脚、分区、初始化
├── boards/_template/     新板型的复制起点
├── patches/              打在上游小智固件上的补丁
├── scripts/              构建与打包
├── UPSTREAM.json         上游小智固件和 zongzhu-bot 的提交
└── .upstream/            构建时拉下的上游源码，不进仓
```

上游小智固件不复制进仓库。`scripts/build.sh` 按 `UPSTREAM.json` 的提交把它拉到 `.upstream/`，打上 `patches/` 里唯一的补丁，再把板型目录的 `main/` 作为板级源码编进去。补丁只改 `main/CMakeLists.txt`，让它从环境变量读板型目录和额外的头文件路径。`components/podone` 和板型目录都不碰上游的其他文件。

## 构建基线

ESP-IDF v6.0.3，目标 `esp32s3`。构建用 `firmware/scripts/build.sh <board-id>`，它会自己激活 ESP-IDF 环境。`build/`、`sdkconfig`、`managed_components/` 是本地产物，不进仓；`sdkconfig.defaults` 和 `dependencies.lock` 进仓。

## 新增板型

1. 复制 `boards/_template/` 为 `boards/<board-id>/`，按模板里的清单填完再写代码。
2. 引脚和总线参数写在该板的 `config.h`，每个数值注明来源，能回溯到原理图或已核对的参考实现。
3. 在上面的清单里加一行。板型 ID 用小写字母、数字和连字符，发布后不改。
4. 共用的交互逻辑放进 `components/podone`，板型目录只放这块板独有的东西，比如 IMU 的轴向映射。

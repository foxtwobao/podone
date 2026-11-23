# waveshare-1.75c

微雪 ESP32-S3-Touch-AMOLED-1.75C，Podone 的首个板型。

## 硬件

- 主控 ESP32-S3R8，32 MB Flash，八线 PSRAM。
- 屏幕 CO5300，1.75 寸圆屏，466×466，QSPI，RGB565。
- 触摸 CST9217。
- 音频 ES8311 播放、ES7210 四通道录音，采样率 24000 Hz，开启参考信号回采。
- IMU QMI8658，I²C 地址 0x6B，INT1 接 GPIO21。屏幕坐标映射暂取 zongzhu-bot 的 `SCREEN_X = accel[1]`、`SCREEN_Y = accel[0]`，BOARD.md 只写了"轴方向见原理图第 2 页"，符号需要实板确认。

引脚核对了两份来源：本仓库 `docs/hardware/ESP32-S3-Touch-AMOLED-1.75C/hardware/BOARD.md`，以及小智官方固件 `waveshare/esp32-s3-touch-amoled-1.75/config.h` 中 1.75C 的分支，两者逐项一致。同一目录下非 C 版的 MCLK、屏幕复位、触摸复位引脚不同，不能混用。数值见 `config.h`，每项注明了来源。

## 与共用组件的关系

表情、眨眼、眼神、字幕和触摸手势来自 `components/podone`，屏幕尺寸以参数传入，本目录不复制一份。IMU 的读取和轴向映射留在本目录，因为型号和安装方向是这块板独有的。

`main/` 是板级源码：

- `board.cc`：从上游 `waveshare/esp32-s3-touch-amoled-1.75` 改来，删掉了非 C 版才有的 TCA9554，显示类换成 `EyeDisplay`，接上触摸手势、倾斜跟随、摇晃晕眩、BOOT 长按切字幕，以及 MCP 工具 `self.screen.play_animation`。
- `config.h`：把上一级 `config.h` 的 `PODONE_*` 引脚映射成上游代码用的宏名。
- `config.json`：给上游 CMake 读的板型名，`type` 就是板型 ID。
- `qmi8658_motion.h`：zongzhu-bot 原文，只加了署名头。

## 构建

ESP-IDF v6.0.3，目标 `esp32s3`。在仓库根目录执行：

```bash
firmware/scripts/build.sh waveshare-1.75c
```

```bash
firmware/scripts/build.sh waveshare-1.75c flash
```

产物在 `firmware/build/waveshare-1.75c/`。`sdkconfig.defaults` 叠加在上游 `sdkconfig.defaults` 之上，选中上游的 1.75C 板型符号，所以字体、表情集和 AEC 这些 Kconfig 依赖和官方 1.75C 变体一样，生成的 `sdkconfig` 和阶段 0 的逐项相同。板级源码用的是本目录的 `main/`。接入方式见 `docs/ARCHITECTURE.md` 第 6 节。

Flash 容量按上游默认写成 16 MB，板子实际有 32 MB，启动时会打一条警告。要用满 32 MB 得换分区表，到时再改。

### 小智基线固件

阶段 0 用小智 v2.6.0 的官方 1.75C 变体验证硬件和服务端。`xiaozhi-baseline.json` 是它的构建配置，和官方 `config.json` 里 1.75C 那一项相同，只多了 OTA 地址 `http://pod.lab.home.arpa/xiaozhi/ota/`。构建步骤：

```bash
git clone --depth 1 -b v2.6.0 https://github.com/78/xiaozhi-esp32.git
cp xiaozhi-baseline.json xiaozhi-esp32/main/boards/waveshare/esp32-s3-touch-amoled-1.75/podone.json
cd xiaozhi-esp32
IDF_PATH_DIR=~/esp/esp-idf-v6.0.3 source <podone>/firmware/scripts/env.sh
python scripts/build.py waveshare/esp32-s3-touch-amoled-1.75 -c podone.json --name esp32-s3-touch-amoled-1.75c --language zh-CN
```

板型参数要写目录路径 `waveshare/esp32-s3-touch-amoled-1.75`。不加 `--language` 时默认是英文。

烧录用 `build/flash_args`。烧完后芯片会停在下载模式（日志显示 `boot:0x23`），拔插一次 USB 才会启动固件。

## 验收记录

阶段 0（2026-11-23）：小智官方 1.75C 变体在实板上跑通，屏幕、触摸、音频、配网、激活和中文对话都正常。

阶段 2（2026-11-23）：用 `build.sh` 构建并烧录。启动日志依次出现 `QMI8658 at 0x6b ready`、`Eyes ready, subtitle mode 0`、`Motion ready`，随后连上 Wi-Fi 并激活，没有错误。用户在实板上测完后没有报告问题，串口日志里能看到：

- 触摸：两次 `Reaction 8`。
- 摇晃：`Shake lobe 1/4` 到 `4/4`，然后 `Shake: dizzy`，停下后 `Steady again`。
- BOOT 长按：`Subtitle mode -> 1`。
- 对话：从唤醒到问答一轮走通，服务端回复了文本，状态在 listening 和 speaking 间切换。

倾斜跟随不打日志，眼睛跟随方向是否正确只能看屏幕，用户还没有单独确认。待机时绘制帧率 5 到 9 fps，动画时 20 多 fps，逻辑循环约 34 Hz。

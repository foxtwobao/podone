# 开发选型与首次上板

## 选型

Podone 首轮使用 **ESP-IDF v5.5.5（C、FreeRTOS、CMake）+ LVGL 9.5.0 + 微雪 1.75C BSP 3.0.0**。构建目标为 `esp32s3`。先用微雪发布版 **v1.0.2** 的 `02_lvgl_demo_v9` 复现工具链、显示和触摸，再从可运行的配置开始写应用。

| 方案 | 取舍 |
| --- | --- |
| ESP-IDF v5.5.5 | 首轮基线。微雪同时发布了源码和对应预编译固件，可以分别定位工具链及硬件初始化问题。ESP-IDF 可明确配置 Flash 分区、PSRAM、控制台和任务资源。 |
| ESP-IDF v6.0.2 | 微雪也发布了这条构建线。项目需要该版本的功能或依赖时，再用同一套实板测试比较两条线。 |
| Arduino-ESP32 3.3.11 | 用于单项外设交叉验证，尤其是 ES7210 录音和 ES8311 播放。微雪 Arduino GUI 示例使用 LVGL 8.4.0，复现时使用源码包内随附库。 |

微雪中文教程截图采用 v5.5.2。板卡 v1.0.2 发布说明列出 v5.5.5 与 v6.0.2，并注明实板验证待完成。下文的版本选择以发布版构建记录、`02_lvgl_demo_v9/main/idf_component.yml` 和官方固件清单为依据。 [微雪 ESP-IDF 教程](https://docs.waveshare.net/ESP32-S3-Touch-AMOLED-1.75C/ESP-IDF/) · [v1.0.2 发布说明](https://github.com/waveshareteam/ESP32-S3-Touch-AMOLED-1.75C/releases/tag/v1.0.2) · [本地官方固件清单](firmware/manifest-combined-assets.json)

### 首个工程的配置

- 初始配置核对 `02_lvgl_demo_v9/sdkconfig.defaults` 和 `partitions.csv`。该例程使用 32 MB Flash、八线 PSRAM、自定义分区。Arduino CI 使用 16 MB Flash 配置，部分 ESP-IDF 例程也有独立的 Flash、分区和串口参数。复现各例程时沿用各自的配置。
- ESP-IDF 示例通过 Component Manager 加载 BSP。新建 Podone 工程时将 BSP 固定为 `3.0.0`、LVGL 固定为 `9.5.0`，提交构建生成的 `dependencies.lock` 以记录间接依赖。现有归档包含 BSP 源码，首次解析整套依赖仍需要访问组件仓库。
- 板级初始化从微雪 BSP 的 `bsp_display_start()` 起步。圆屏界面按 466 × 466 画布布置，在真机检查可见范围和触摸方向。引脚见 [板卡速查](hardware/BOARD.md)。

## macOS 上复现官方例程

按乐鑫 v5.5.5 指南安装系统依赖，再将 ESP-IDF 放在开发工具目录。从终端执行以下命令。 [乐鑫 macOS 工具链文档](https://docs.espressif.com/projects/esp-idf/en/v5.5.5/esp32s3/get-started/linux-macos-setup.html)

```sh
mkdir -p "$HOME/esp"
git clone --branch v5.5.5 --recursive https://github.com/espressif/esp-idf.git "$HOME/esp/esp-idf-v5.5.5"
(cd "$HOME/esp/esp-idf-v5.5.5" && ./install.sh esp32s3)
. "$HOME/esp/esp-idf-v5.5.5/export.sh"
idf.py --version
```

在 Podone 根目录的同一个终端运行以下命令。示例会解压至临时目录，便于直接对照官方原件。

```sh
sample_dir=$(mktemp -d)
board='ESP32-S3-Touch-AMOLED-1.75C'
unzip -q "docs/hardware/$board/examples/$board-v1.0.2.zip" -d "$sample_dir"
cd "$sample_dir/$board-1.0.2/examples/esp-idf/02_lvgl_demo_v9"
idf.py set-target esp32s3
idf.py build
```

插上 USB 数据线，比较插拔前后的 `/dev/cu.*`。确认串口后，将下例路径换成实际设备名。若要保留板上现有配置或数据，烧录前先备份。

```sh
idf.py -p /dev/cu.usbmodemXXXX flash monitor
```

若例程能运行但 Type-C 无应用日志，检查控制台是否开启 USB Serial/JTAG 主控制台或次级输出。若无法进入下载模式，关闭占用该端口的监视器。按微雪 FAQ，完全断电后按住 BOOT 再上电，烧录结束后断电重启。恢复出厂演示时，使用[出厂恢复镜像](firmware/ESP32-S3-Touch-AMOLED-1.75C-FactoryOnly-260114.bin)，按官方烧录页指定的 `0x0` 地址操作。 [乐鑫串口连接](https://docs.espressif.com/projects/esp-idf/en/v5.5.5/esp32s3/get-started/establish-serial-connection.html) · [微雪 FAQ](https://docs.waveshare.net/ESP32-S3-Touch-AMOLED-1.75C/FAQ/) · [微雪烧录说明](https://docs.waveshare.net/ESP32-S3-Touch-AMOLED-1.75C/Firmware-Flashing/)

## 首轮验收

1. 记录实际连接的板卡 SKU、串口、`idf.py --version`、BSP 与 LVGL 版本，以及启动时识别到的 Flash 和 PSRAM。
2. 运行 `02_lvgl_demo_v9`，确认显示正常、画面方向正确。将该工程中的 `lv_demo_benchmark()` 换成 `lv_demo_widgets()` 后重新构建，验证点击、拖动和四个方向的触摸映射。
3. `01_AXP2101` 核对 USB 接入状态和电池读数，`04_Immersive_block` 核对姿态和 IMU 轴，`05_Spec_Analyzer` 核对麦克风输入。单独验证扬声器时用 Arduino `07_ES8311` 或 BSP 的播放接口。

截至归档时，示例源码、BSP 和固件已做文件完整性检查。当前 macOS 主机未检测到已激活的 `idf.py` 和板卡 USB 串口，源码编译、烧录和实板验收均待执行。

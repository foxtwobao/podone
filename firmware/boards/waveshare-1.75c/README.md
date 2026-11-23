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

## 构建

ESP-IDF v5.5.5，目标 `esp32s3`。接入上游固件的方式见 `docs/ARCHITECTURE.md` 第 6 节，需要在实板上验证后确定，因此本目录目前只有板级参数，还不是完整的可编译工程。

## 验收记录

尚无实板验收。阶段 0 需要确认显示、触摸、录音、播报和唤醒。

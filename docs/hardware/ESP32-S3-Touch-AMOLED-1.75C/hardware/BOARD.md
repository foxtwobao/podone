# 板载资源与关键引脚

板卡采用 ESP32-S3R8，最高 240 MHz，8 MB 八线 PSRAM、32 MB 外置 Flash、2.4 GHz Wi-Fi 和 BLE。圆形触摸 AMOLED 为 466 × 466 像素，Type-C 直连 ESP32-S3 原生 USB。电池接口为 MX1.25 两针，面向标称 3.7 V 单节锂电池。外壳尺寸和焊盘位置见 [尺寸图](mechanical-dimensions.webp) 和 [原理图](ESP32-S3-Touch-AMOLED-1.75C-schematic.pdf)。

| 子系统 | 器件 / 总线 | 关键引脚与说明 |
| --- | --- | --- |
| AMOLED | CO5300 / QSPI（BSP 使用 SPI2） | SCLK GPIO38，CS GPIO12，D0–D3 GPIO4/5/6/7，RESET GPIO1，TE GPIO13。调亮度走面板命令。 |
| 触摸 | CST9217 / I²C | SDA GPIO15，SCL GPIO14，INT GPIO11，RESET GPIO2。BSP 默认镜像 X、Y 两轴，转屏后应重新测触摸坐标。 |
| 电源与充电 | AXP2101 / I²C | SDA GPIO15，SCL GPIO14，7 位地址 `0x34`。PWR 键连接 PMIC `PWRON`。 |
| IMU | QMI8658 / I²C | SDA GPIO15，SCL GPIO14，7 位地址 `0x6B`，INT1 GPIO21。轴方向见原理图第 2 页。 |
| 麦克风、扬声器 | ES7210 ADC、ES8311 codec、功放 / I²C + I²S | 控制总线共用 GPIO15/14。I²S MCLK GPIO16、BCLK GPIO9、LRCK GPIO45、ESP32 输入 GPIO10、输出 GPIO8。功放使能 GPIO46。 |
| 下载和调试 | 原生 USB、BOOT | USB D− GPIO19、D+ GPIO20。BOOT 接 GPIO0。USB 数据线可连接烧录与串口监视。 |

资料依据为 [原理图](ESP32-S3-Touch-AMOLED-1.75C-schematic.pdf)、[微雪 BSP](https://components.espressif.com/components/waveshare/esp32_s3_touch_amoled_1_75c/versions/3.0.0/readme) 和 [v1.0.2 示例源码](../examples/ESP32-S3-Touch-AMOLED-1.75C-v1.0.2.zip) 的 `pin_config.h`、`01_AXP2101`。不同示例若使用同一 I²C 总线，集成时由板级代码统一初始化和分配设备句柄。

## 有待实板确认

- 官方概览提到 RTC，已归档的 1.75C 原理图可以确认 AXP2101 的 RTC 相关供电脚位。独立 RTC 的具体型号和掉电走时行为待板上核实。
- 触摸坐标、屏幕旋转方向、IMU 轴符号和 PWR/BOOT 的运行态行为应在样机上记录。

## 驱动资料

- 面板驱动和触控驱动的依赖版本由 BSP 的 `idf_component.yml` 声明。 [CO5300](https://components.espressif.com/components/espressif/esp_lcd_co5300) · [CST9217](https://components.espressif.com/components/waveshare/esp_lcd_touch_cst9217)
- 音频读写可从微雪源码中的 `05_Spec_Analyzer`、Arduino `06_ES7210` 和 `07_ES8311` 入手，板级连线以本型号原理图为准。 [官方示例发布版](https://github.com/waveshareteam/ESP32-S3-Touch-AMOLED-1.75C/tree/v1.0.2)

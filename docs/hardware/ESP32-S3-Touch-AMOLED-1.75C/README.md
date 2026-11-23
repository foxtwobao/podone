# ESP32-S3-Touch-AMOLED-1.75C 资料索引

归档日期为 2026-11-23。板卡型号覆盖含电池 SKU 33691 和不含电池 SKU 33692。原始文件保留发布时的内容，图纸与示例均对应 **1.75C**。

## 官方文档

| 类别 | 微雪官网 | 本地网页快照 |
| --- | --- | --- |
| 产品概览 | [产品主页](https://docs.waveshare.net/ESP32-S3-Touch-AMOLED-1.75C/) | [产品概览](upstream/overview.html) |
| 原理图、手册和示例入口 | [相关资料](https://docs.waveshare.net/ESP32-S3-Touch-AMOLED-1.75C/Resources-And-Documents/) | [相关资料](upstream/Resources-And-Documents.html) |
| 开发环境 | [ESP-IDF](https://docs.waveshare.net/ESP32-S3-Touch-AMOLED-1.75C/ESP-IDF/) · [Arduino](https://docs.waveshare.net/ESP32-S3-Touch-AMOLED-1.75C/Arduino/) | [ESP-IDF](upstream/ESP-IDF.html) · [Arduino](upstream/Arduino.html) |
| 烧录和排查 | [烧录与擦除](https://docs.waveshare.net/ESP32-S3-Touch-AMOLED-1.75C/Firmware-Flashing/) · [FAQ](https://docs.waveshare.net/ESP32-S3-Touch-AMOLED-1.75C/FAQ/) | [烧录与擦除](upstream/Firmware-Flashing.html) · [FAQ](upstream/FAQ.html) |
| 应用与支持 | [小智 AI 应用教程](https://docs.waveshare.net/ESP32-S3-Touch-AMOLED-1.75C/ESP32-AI-Tutorials/) · [技术支持](https://docs.waveshare.net/ESP32-S3-Touch-AMOLED-1.75C/Technical-Support/) | [小智 AI 应用教程](upstream/ESP32-AI-Tutorials.html) · [技术支持](upstream/Technical-Support.html) |

网页快照是原始 HTML。样式、视频和部分图片由官网提供。拆后盖及电池安装视频见 [官方视频](https://docs.waveshare.net/assets/medias/Esp32-S3-Touch-Amoled-1.75C-f759676e8faa86b076104c189b47052b.mp4)。

## 硬件与机械

- [板卡与引脚速查](hardware/BOARD.md)
- [官方原理图和双面 PCB 位号图](hardware/ESP32-S3-Touch-AMOLED-1.75C-schematic.pdf) · [原始来源](https://www.waveshare.net/w/upload/8/83/ESP32-S3-Touch-AMOLED-1.75C-schematic.pdf)
- [产品外观](hardware/product.webp) · [板载资源标注](hardware/board-components.webp) · [机械尺寸图](hardware/mechanical-dimensions.webp) · [原始来源](https://docs.waveshare.net/ESP32-S3-Touch-AMOLED-1.75C/)

## 芯片技术手册

| 器件 | 本地文件 |
| --- | --- |
| ESP32-S3 | 技术规格书 [中文](datasheets/esp32-s3_datasheet_cn.pdf) · [英文](datasheets/esp32-s3_datasheet_en.pdf) |
| ESP32-S3 | 技术参考手册 [中文](datasheets/esp32-s3_technical_reference_manual_cn.pdf) · [英文](datasheets/esp32-s3_technical_reference_manual_en.pdf) |
| QMI8658C | [六轴传感器数据手册](datasheets/QMI8658C.pdf) |
| AXP2101 | [电源管理芯片数据手册](datasheets/X-power-AXP2101_SWcharge_V1.0.pdf) |
| ES8311 | [音频编解码芯片数据手册](datasheets/ES8311.DS.pdf) · [用户手册](datasheets/ES8311.user.Guide.pdf) |

以上八份 PDF 来自微雪 [相关资料页](https://docs.waveshare.net/ESP32-S3-Touch-AMOLED-1.75C/Resources-And-Documents/) 的官方链接。CO5300、CST9217 和 ES7210 的驱动入口见 [板卡与引脚速查](hardware/BOARD.md)。

## 示例源码与 BSP

- [微雪 v1.0.2 源码 ZIP](examples/ESP32-S3-Touch-AMOLED-1.75C-v1.0.2.zip) 包含 5 个 ESP-IDF 工程、7 个 Arduino 示例及随附库。源码提交为 `a7d93cb6c934429b92c9c3c1c1a653c7486617fa`。 [GitHub 发布页](https://github.com/waveshareteam/ESP32-S3-Touch-AMOLED-1.75C/releases/tag/v1.0.2) · [Gitee 镜像](https://gitee.com/waveshare/ESP32-S3-Touch-AMOLED-1.75C)
- [微雪 BSP 3.0.0 ZIP](examples/esp32_s3_touch_amoled_1_75c-bsp-3.0.0.zip) 包含板级驱动源文件、依赖声明和许可证。构建时由 ESP-IDF Component Manager 解析 BSP 及其依赖。 [乐鑫组件仓库](https://components.espressif.com/components/waveshare/esp32_s3_touch_amoled_1_75c/versions/3.0.0/readme)
- [开发选型和首次上板步骤](DEVELOPMENT.md)

## 固件与恢复

| 本地文件 | 用途 |
| --- | --- |
| [FactoryOnly-260114.bin](firmware/ESP32-S3-Touch-AMOLED-1.75C-FactoryOnly-260114.bin) | 出厂恢复镜像，按官方说明烧录至 `0x0`。[v1.0.1 附件](https://github.com/waveshareteam/ESP32-S3-Touch-AMOLED-1.75C/releases/tag/v1.0.1) |
| [01_AXP2101](firmware/ESP32-S3-Touch-AMOLED-1.75C-01_AXP2101-v5.5.5-combined.zip) | 验证电源及电池读数，串口输出 |
| [02_lvgl_demo_v9](firmware/ESP32-S3-Touch-AMOLED-1.75C-02_lvgl_demo_v9-v5.5.5-combined.zip) | 显示初始化、LVGL benchmark |
| [03_esp-brookesia](firmware/ESP32-S3-Touch-AMOLED-1.75C-03_esp-brookesia-v5.5.5-combined.zip) | 应用启动器与手势演示 |
| [04_Immersive_block](firmware/ESP32-S3-Touch-AMOLED-1.75C-04_Immersive_block-v5.5.5-combined.zip) | IMU 姿态联动 |
| [05_Spec_Analyzer](firmware/ESP32-S3-Touch-AMOLED-1.75C-05_Spec_Analyzer-v5.5.5-combined.zip) | 麦克风采集和频谱显示 |

五个示例固件来自微雪 v1.0.2 的 ESP-IDF v5.5.5 构建，ZIP 和包内合并镜像均已对照 [官方构建清单](firmware/manifest-combined-assets.json) 核对 SHA-256。出厂恢复镜像已与 GitHub 发布附件的 SHA-256 核对。ESP-IDF v6.0.2 和 Arduino 的固件可从 [v1.0.2 发布页](https://github.com/waveshareteam/ESP32-S3-Touch-AMOLED-1.75C/releases/tag/v1.0.2) 获取。

示例源码 ZIP、六个固件镜像和两份技术参考手册体积大，不进仓库。执行同目录的 `./fetch-large-files.sh` 从官方地址下载，脚本最后用 `SHA256SUMS` 校验。在本索引所在目录执行 `shasum -a 256 -c SHA256SUMS` 可校验全部 29 份上游归档文件。校验清单见 [SHA256SUMS](SHA256SUMS)。

/*
 * waveshare-1.75c 板级参数。
 *
 * 来源 A：docs/hardware/ESP32-S3-Touch-AMOLED-1.75C/hardware/BOARD.md
 *         （原理图、微雪 BSP 3.0.0、v1.0.2 示例 pin_config.h）
 * 来源 B：78/xiaozhi-esp32 main 分支
 *         main/boards/waveshare/esp32-s3-touch-amoled-1.75/config.h
 *         中 CONFIG_BOARD_TYPE_WAVESHARE_ESP32_S3_TOUCH_AMOLED_1_75C 分支
 * 两份来源逐项一致。修改任何一项都要在注释里更新来源，不能只改数字。
 * 注意：同目录的非 C 版（1.75）MCLK、屏幕复位、触摸复位引脚不同，不要混用。
 */

#pragma once

/* 屏幕 CO5300，QSPI（SPI2），466x466。来源 A、B */
#define PODONE_LCD_WIDTH        466
#define PODONE_LCD_HEIGHT       466
#define PODONE_LCD_PCLK_GPIO    38
#define PODONE_LCD_CS_GPIO      12
#define PODONE_LCD_DATA0_GPIO   4
#define PODONE_LCD_DATA1_GPIO   5
#define PODONE_LCD_DATA2_GPIO   6
#define PODONE_LCD_DATA3_GPIO   7
#define PODONE_LCD_RST_GPIO     1
#define PODONE_LCD_TE_GPIO      13   /* 仅来源 A；来源 B 未使用 TE */
/* 无背光引脚，亮度走面板命令。来源 A、B */

/* 触摸 CST9217。来源 A、B */
#define PODONE_TOUCH_RST_GPIO   2
#define PODONE_TOUCH_INT_GPIO   11

/* 共用 I2C：触摸、AXP2101、QMI8658、ES8311、ES7210。来源 A、B */
#define PODONE_I2C_SDA_GPIO     15
#define PODONE_I2C_SCL_GPIO     14

/* 电源管理 AXP2101，7 位地址。来源 A */
#define PODONE_PMU_I2C_ADDR     0x34

/* IMU QMI8658，7 位地址与中断。来源 A */
#define PODONE_IMU_I2C_ADDR     0x6B
#define PODONE_IMU_INT1_GPIO    21

/* 音频 I2S：ES8311 播放，ES7210 录音。来源 A、B */
#define PODONE_I2S_MCLK_GPIO    16
#define PODONE_I2S_BCLK_GPIO    9
#define PODONE_I2S_WS_GPIO      45
#define PODONE_I2S_DIN_GPIO     10   /* 芯片输入，接 ES7210 */
#define PODONE_I2S_DOUT_GPIO    8    /* 芯片输出，接 ES8311 */
#define PODONE_PA_EN_GPIO       46
#define PODONE_AUDIO_SAMPLE_HZ  24000  /* 输入输出相同，开启参考回采。来源 B */

/* 按键。来源 A、B */
#define PODONE_BOOT_GPIO        0

#ifndef _BOARD_CONFIG_H_
#define _BOARD_CONFIG_H_

// 小智上游代码用的宏名。数值全部取自上一级的 config.h（每项注明了来源），这里只改名，不写新数字。

#include <driver/gpio.h>

#include "../config.h"

#define AUDIO_INPUT_SAMPLE_RATE  PODONE_AUDIO_SAMPLE_HZ
#define AUDIO_OUTPUT_SAMPLE_RATE PODONE_AUDIO_SAMPLE_HZ
#define AUDIO_INPUT_REFERENCE    true

#define AUDIO_I2S_GPIO_MCLK static_cast<gpio_num_t>(PODONE_I2S_MCLK_GPIO)
#define AUDIO_I2S_GPIO_WS   static_cast<gpio_num_t>(PODONE_I2S_WS_GPIO)
#define AUDIO_I2S_GPIO_BCLK static_cast<gpio_num_t>(PODONE_I2S_BCLK_GPIO)
#define AUDIO_I2S_GPIO_DIN  static_cast<gpio_num_t>(PODONE_I2S_DIN_GPIO)
#define AUDIO_I2S_GPIO_DOUT static_cast<gpio_num_t>(PODONE_I2S_DOUT_GPIO)

#define AUDIO_CODEC_PA_PIN      static_cast<gpio_num_t>(PODONE_PA_EN_GPIO)
#define AUDIO_CODEC_I2C_SDA_PIN static_cast<gpio_num_t>(PODONE_I2C_SDA_GPIO)
#define AUDIO_CODEC_I2C_SCL_PIN static_cast<gpio_num_t>(PODONE_I2C_SCL_GPIO)
#define AUDIO_CODEC_ES8311_ADDR ES8311_CODEC_DEFAULT_ADDR
#define AUDIO_CODEC_ES7210_ADDR ES7210_CODEC_DEFAULT_ADDR

#define BOOT_BUTTON_GPIO static_cast<gpio_num_t>(PODONE_BOOT_GPIO)

#define LCD_PIN_CS    static_cast<gpio_num_t>(PODONE_LCD_CS_GPIO)
#define LCD_PIN_PCLK  static_cast<gpio_num_t>(PODONE_LCD_PCLK_GPIO)
#define LCD_PIN_DATA0 static_cast<gpio_num_t>(PODONE_LCD_DATA0_GPIO)
#define LCD_PIN_DATA1 static_cast<gpio_num_t>(PODONE_LCD_DATA1_GPIO)
#define LCD_PIN_DATA2 static_cast<gpio_num_t>(PODONE_LCD_DATA2_GPIO)
#define LCD_PIN_DATA3 static_cast<gpio_num_t>(PODONE_LCD_DATA3_GPIO)
#define LCD_PIN_RST   static_cast<gpio_num_t>(PODONE_LCD_RST_GPIO)

#define TOUCH_PIN_RST static_cast<gpio_num_t>(PODONE_TOUCH_RST_GPIO)
#define TOUCH_PIN_INT static_cast<gpio_num_t>(PODONE_TOUCH_INT_GPIO)

#define DISPLAY_WIDTH    PODONE_LCD_WIDTH
#define DISPLAY_HEIGHT   PODONE_LCD_HEIGHT
#define DISPLAY_MIRROR_X false
#define DISPLAY_MIRROR_Y false
#define DISPLAY_SWAP_XY  false
#define DISPLAY_OFFSET_X 0
#define DISPLAY_OFFSET_Y 0

#define DISPLAY_BACKLIGHT_PIN GPIO_NUM_NC
#define DISPLAY_BACKLIGHT_OUTPUT_INVERT false

// QMI8658 芯片轴到屏幕轴（+x 向右，+y 向下）。取自 zongzhu-bot 的 1.75C 板型，符号待实板确认。
#define QMI8658_SCREEN_X(a) (a[1])
#define QMI8658_SCREEN_Y(a) (a[0])

#endif  // _BOARD_CONFIG_H_

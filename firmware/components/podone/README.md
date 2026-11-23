# podone 共用组件

各板型共用的表情与交互，不依赖具体板子的引脚。

## 文件

| 文件 | 来源 | 说明 |
| --- | --- | --- |
| `eyes/eye_model.h` | zongzhu-bot `xiaozhi-esp32/main/boards/common/zongzhu/eye_model.h`，MIT，原文见 `LICENSE-zongzhu` | 13 种表情的形状与动态，纯数学，不依赖 LVGL，内容未改动 |
| `eyes/mood_map.h` | Podone 新增，映射表与 zongzhu-bot `eye_display.h` 的 `kAliases` 一致 | 服务端情绪名和上游 `Alert` 情绪名到本地表情的映射 |

显示层（绘制、眨眼、眼神跟随、触摸手势、字幕模式）还没有放进来。它在参考项目里继承上游固件的 `SpiLcdDisplay`，直接依赖 `Application` 和 LVGL，接入方式按 `docs/ARCHITECTURE.md` 第 6 节在实板上验证后再决定怎么落，避免先写一份以后要推翻的代码。

## 情绪映射的取舍

服务端 `textUtils.py` 的 `EMOJI_MAP` 有 21 个取值。其中 `neutral`、`delicious`、`kissy` 在参考项目里也没有对应画法，这里同样回落到设备状态推导的表情，不显示错误。

上游固件 `Application::Alert` 传入的 `gear`、`link`、`warning`、`cancel`、`cloud_off`、`download`、`cloud_download` 在参考项目里全部回落到待机，配网和激活时眼睛没有变化。这里给了它们独立的表情，与 `docs/preview/eye-preview.html` 的开机、配网、激活画面一致：配网用困惑，激活用好奇，出错用难过，下载与升级用思考。

## 测试

`test/test_mood_map.cc` 在主机上编译运行，不需要 ESP-IDF：

```sh
g++ -std=c++17 -Ieyes test/test_mood_map.cc -o /tmp/test_mood_map && /tmp/test_mood_map
```

它检查两件事：服务端和上游固件用到的每个情绪名都有明确去处，以及 13 种表情在任意时刻都不会超出圆屏可显示的半径。

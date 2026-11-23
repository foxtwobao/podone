# podone 共用组件

各板型共用的表情与交互，不依赖具体板子的引脚。

## 文件

| 文件 | 来源 | 说明 |
| --- | --- | --- |
| `eyes/eye_model.h` | zongzhu-bot `xiaozhi-esp32/main/boards/common/zongzhu/eye_model.h`，MIT，原文见 `LICENSE-zongzhu` | 13 种表情的形状与动态，纯数学，不依赖 LVGL，内容未改动 |
| `eyes/mood_map.h` | Podone 新增，映射表与 zongzhu-bot `eye_display.h` 的 `kAliases` 一致 | 服务端情绪名和上游 `Alert` 情绪名到本地表情的映射 |
| `eyes/eye_display.h` | zongzhu-bot 同名文件，MIT | 绘制、眨眼、眼神、触摸手势、字幕模式。继承小智的 `SpiLcdDisplay`，改动见下节 |
| `motion/motion_gesture.h` | zongzhu-bot 同名文件，MIT，内容未改动 | 倾斜与左右摇晃检测，输入是屏幕坐标下的重力 |

参考项目的提交记录在 `firmware/UPSTREAM.json`。QMI8658 驱动 `qmi8658_motion.h` 放在板型目录，因为 IMU 型号和轴向是板级的。

这些都是头文件，由 `firmware/scripts/build.sh` 加进小智 `main` 组件的 include 路径，不单独编成 ESP-IDF 组件，因为 `eye_display.h` 依赖 `main` 里的 `Application` 和 `SpiLcdDisplay`。

## eye_display.h 与原文的差异

- 小智 v2.6.0 的 `SetEmotion` 返回 `bool`。界面建好后一律返回 `true`，否则 `Application` 会再回落设一次 `neutral`。
- 加了 `RemoveChatMessage`。v2.6.0 用它在 5 秒后撤掉开机唤醒词提示，只在当前字幕仍是那条提示时清空。
- 情绪名查表改用 `mood_map.h`，配网、激活、出错有独立表情；查不到时仍按设备状态推导。
- `SetStatus` 不再给状态加"宗主 · "前缀，也不再识别参考项目网关的"等待 Bot"状态。
- 字幕滚动动画改用 LVGL 9.5 的 `lv_anim_set_reverse_*`，原文的 `playback` 名是 9.1 的旧别名。

## 情绪映射的取舍

服务端 `textUtils.py` 的 `EMOJI_MAP` 有 21 个取值。其中 `neutral`、`delicious`、`kissy` 在参考项目里也没有对应画法，这里同样回落到设备状态推导的表情，不显示错误。

上游固件 `Application::Alert` 传入的 `gear`、`link`、`warning`、`cancel`、`cloud_off`、`download`、`cloud_download` 在参考项目里全部回落到待机，配网和激活时眼睛没有变化。这里给了它们独立的表情，与 `docs/preview/eye-preview.html` 的开机、配网、激活画面一致：配网用困惑，激活用好奇，出错用难过，下载与升级用思考。

## 测试

`test/test_mood_map.cc` 在主机上编译运行，不需要 ESP-IDF：

```sh
g++ -std=c++17 -Ieyes test/test_mood_map.cc -o /tmp/test_mood_map && /tmp/test_mood_map
```

它检查两件事：服务端和上游固件用到的每个情绪名都有明确去处，以及 13 种表情在任意时刻都不会超出圆屏可显示的半径。

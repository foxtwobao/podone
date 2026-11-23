#pragma once
// 情绪名到本地表情的映射。不依赖 LVGL 和 Application，可在主机上单测。
//
// 名称来源有两类：
// 1. 服务端 type=llm 消息的 emotion 字段，取值见 server/main/xiaozhi-server/core/utils/textUtils.py 的 EMOJI_MAP。
//    这一段与 zongzhu-bot eye_display.h 的 kAliases 保持一致。
// 2. 上游固件 Application::Alert 传入的 emotion，例如配网 "gear"、激活 "link"、出错 "warning"/"cancel"。
//    这一段是 Podone 新增的，参考项目里没有，会让配网、激活、出错画面和普通待机区分开。
//
// 查不到的名称（包括 "neutral"）返回 fallback，由调用方按设备状态推导，不显示错误。

#include <cstring>

#include "eye_model.h"

namespace podone {

struct MoodAlias {
    const char* name;
    eyes::Mood mood;
};

inline constexpr MoodAlias kMoodAliases[] = {
    // 服务端情绪，与 zongzhu-bot kAliases 一致
    {"thinking", eyes::Mood::Thinking},   {"listening", eyes::Mood::Listening},
    {"speaking", eyes::Mood::Speaking},   {"happy", eyes::Mood::Happy},
    {"laughing", eyes::Mood::Happy},      {"loving", eyes::Mood::Happy},
    {"singing", eyes::Mood::Happy},       {"winking", eyes::Mood::Happy},
    {"excited", eyes::Mood::Excited},     {"dancing", eyes::Mood::Excited},
    {"rapper", eyes::Mood::Excited},      {"basketball", eyes::Mood::Excited},
    {"cool", eyes::Mood::Excited},        {"curious", eyes::Mood::Curious},
    {"confident", eyes::Mood::Curious},   {"confused", eyes::Mood::Confused},
    {"embarrassed", eyes::Mood::Confused}, {"angry", eyes::Mood::Angry},
    {"surprised", eyes::Mood::Surprised}, {"shocked", eyes::Mood::Surprised},
    {"sad", eyes::Mood::Sad},             {"crying", eyes::Mood::Sad},
    {"sleepy", eyes::Mood::Sleepy},       {"relaxed", eyes::Mood::Sleepy},
    {"dizzy", eyes::Mood::Dizzy},         {"silly", eyes::Mood::Dizzy},
    {"funny", eyes::Mood::Dizzy},
    // 上游 Alert 情绪，Podone 新增。与 docs/preview/eye-preview.html 的初始化画面一致
    {"gear", eyes::Mood::Confused},           // 配网：等人连热点
    {"link", eyes::Mood::Curious},            // 激活：显示 6 位码，等手机绑定
    {"cloud_download", eyes::Mood::Thinking}, // 下载资源
    {"download", eyes::Mood::Thinking},       // OTA 升级
    {"warning", eyes::Mood::Sad},             // SIM、注册、模组初始化错误
    {"cancel", eyes::Mood::Sad},              // 一般错误、下载或升级失败
    {"cloud_off", eyes::Mood::Sad},           // 连不上服务端
};

inline eyes::Mood MoodForEmotion(const char* name, eyes::Mood fallback) {
    if (!name)
        return fallback;
    for (const auto& alias : kMoodAliases) {
        if (std::strcmp(name, alias.name) == 0)
            return alias.mood;
    }
    return fallback;
}

}  // namespace podone

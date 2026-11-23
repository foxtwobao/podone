// 主机单测：g++ -std=c++17 -I../eyes test_mood_map.cc -o /tmp/test_mood_map && /tmp/test_mood_map
#include <cmath>
#include <cstdio>
#include <initializer_list>

#include "mood_map.h"

using eyes::Mood;

static int failures = 0;

static void Expect(bool ok, const char* what) {
    if (!ok) {
        std::printf("FAIL %s\n", what);
        ++failures;
    }
}

int main() {
    // 服务端 EMOJI_MAP 的全部取值都要有去处：要么映射到表情，要么明确回落。
    const char* server_emotions[] = {"funny", "crying", "angry", "sad", "loving", "surprised",
                                     "shocked", "thinking", "relaxed", "sleepy", "silly",
                                     "confused", "happy", "laughing", "embarrassed",
                                     "winking", "cool", "confident"};
    for (const char* name : server_emotions)
        Expect(podone::MoodForEmotion(name, Mood::Count) != Mood::Count, name);

    // 这几个服务端取值没有对应画法，按设备状态推导。
    for (const char* name : {"neutral", "delicious", "kissy"})
        Expect(podone::MoodForEmotion(name, Mood::Idle) == Mood::Idle, name);

    // 上游 Alert 情绪与预览一致。
    Expect(podone::MoodForEmotion("gear", Mood::Idle) == Mood::Confused, "gear");
    Expect(podone::MoodForEmotion("link", Mood::Idle) == Mood::Curious, "link");
    for (const char* name : {"warning", "cancel", "cloud_off"})
        Expect(podone::MoodForEmotion(name, Mood::Idle) == Mood::Sad, name);
    for (const char* name : {"download", "cloud_download"})
        Expect(podone::MoodForEmotion(name, Mood::Idle) == Mood::Thinking, name);

    Expect(podone::MoodForEmotion(nullptr, Mood::Listening) == Mood::Listening, "nullptr");
    Expect(podone::MoodForEmotion("", Mood::Speaking) == Mood::Speaking, "empty");

    // 任何表情、任何时刻，眼睛都不能超出 kMaxReach，否则会被圆屏边缘裁掉。
    for (int m = 0; m < static_cast<int>(Mood::Count); ++m) {
        for (float t = 0; t < 10; t += 0.05f) {
            auto face = eyes::FaceFor(static_cast<Mood>(m), t);
            for (const auto* s : {&face.left, &face.right}) {
                float cx = std::fabs(s->dx) + eyes::kHomeX;
                float r = std::hypot(cx + s->w / 2, std::fabs(s->dy) + s->h / 2);
                if (r > eyes::kMaxReach) {
                    std::printf("FAIL reach mood=%d t=%.2f r=%.1f\n", m, t, r);
                    ++failures;
                    t = 10;
                    break;
                }
            }
        }
    }

    std::printf(failures ? "%d failure(s)\n" : "all passed\n", failures);
    return failures ? 1 : 0;
}

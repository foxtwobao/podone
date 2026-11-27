// 移植自 zongzhu-bot（https://github.com/Liu-zhongxian/zongzhu-bot）提交 b91d7e2
// xiaozhi-esp32/main/boards/common/zongzhu/eye_display.h，MIT 许可，原文见同组件 LICENSE-zongzhu。
// 为适配小智 v2.6.0 与 Podone 无文字圆屏交互方案做了全面重构。

#pragma once
// Podone Zero-Text Eye UI: procedural eyes, edge-hugging arc telemetry,
// voice-mouth visualizer, touch reactions, and quick-control ring for the
// 466x466 round AMOLED (1.75C).

#include <esp_heap_caps.h>
#include <esp_log.h>
#include <esp_random.h>
#include <esp_timer.h>
#include <wifi_manager.h>

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstring>
#include <functional>
#include <string>

#include "application.h"
#include "audio_codec.h"
#include "board.h"
#include "crystal_gif_player.h"
#include "crystal_persona_assets.h"
#include "display/lcd_display.h"
#include "eye_model.h"
#include "mood_map.h"
#include "settings.h"

// Screen geometry for the eye UI. Large is the full-screen zero-text layout;
// Small is reserved strictly for Wi-Fi provisioning, activation code, and errors.
struct EyeScreen {
    struct Layout {
        int box_y, box_h, center_y;
        float scale;
    };
    int width = 466;
    int text_w = 284, popup_w = 300;
    Layout large{0, 466, 222, 1.04f};
    Layout small{72, 170, 85, 0.62f};
    int text_y_small = 252, text_h_small = 152;
    float follow_px = 145;
};

class EyeDisplay : public SpiLcdDisplay {
public:
    using SpiLcdDisplay::SpiLcdDisplay;

    // Must be called before SetupUI().
    void SetScreen(const EyeScreen& screen) { screen_ = screen; }

    ~EyeDisplay() override {
        DisplayLockGuard lock(this);
        if (frame_timer_)
            lv_timer_delete(frame_timer_);
        if (performance_timer_)
            lv_timer_delete(performance_timer_);
        if (crystal_buf_) {
            lv_free(crystal_buf_);
            crystal_buf_ = nullptr;
        }
    }

    void SetupUI() override {
        if (setup_ui_called_)
            return;
        SpiLcdDisplay::SetupUI();
        DisplayLockGuard lock(this);

        // Hide all legacy text bars/popups; status and chat are expressed visually.
        for (auto obj : {top_bar_, status_bar_, notification_label_, low_battery_popup_,
                         emoji_label_, emoji_image_, bottom_bar_}) {
            if (obj)
                lv_obj_add_flag(obj, LV_OBJ_FLAG_HIDDEN);
        }

        lv_obj_remove_flag(emoji_box_, LV_OBJ_FLAG_SCROLLABLE);
        lv_obj_remove_flag(emoji_box_, LV_OBJ_FLAG_CLICKABLE);
        lv_obj_set_width(bottom_bar_, screen_.text_w);
        lv_obj_set_style_pad_all(bottom_bar_, 0, 0);
        lv_obj_set_style_bg_opa(bottom_bar_, LV_OPA_TRANSP, 0);
        lv_obj_remove_flag(bottom_bar_, LV_OBJ_FLAG_SCROLLABLE);
        lv_obj_set_width(chat_message_label_, screen_.text_w);
        lv_label_set_long_mode(chat_message_label_, LV_LABEL_LONG_WRAP);
        lv_obj_set_style_text_line_space(chat_message_label_, 4, 0);
        lv_obj_set_style_text_align(chat_message_label_, LV_TEXT_ALIGN_CENTER, 0);

        canvas_ = lv_obj_create(emoji_box_);
        lv_obj_remove_style_all(canvas_);
        lv_obj_set_size(canvas_, LV_PCT(100), LV_PCT(100));
        lv_obj_remove_flag(canvas_, LV_OBJ_FLAG_CLICKABLE);
        lv_obj_remove_flag(canvas_, LV_OBJ_FLAG_SCROLLABLE);
        lv_obj_add_event_cb(
            canvas_,
            [](lv_event_t* e) {
                static_cast<EyeDisplay*>(lv_event_get_user_data(e))->Draw(lv_event_get_layer(e));
            },
            LV_EVENT_DRAW_MAIN, this);
        lv_display_add_event_cb(
            display_,
            [](lv_event_t* e) { ++static_cast<EyeDisplay*>(lv_event_get_user_data(e))->refreshes_; },
            LV_EVENT_REFR_READY, this);

        {
            Settings settings("podone", false);
            const int saved = settings.GetInt("persona", 0);
            persona_ = (saved == 1) ? Persona::Crystal : Persona::Classic;
        }
        InitCrystalBuffer();

        ApplyMonochrome();
        ApplyLayout(Layout::Large);
        last_tick_ = lv_tick_get();
        if (auto refr = lv_display_get_refr_timer(display_))
            lv_timer_set_period(refr, kFrameMs);
        frame_timer_ = lv_timer_create(
            [](lv_timer_t* timer) {
                static_cast<EyeDisplay*>(lv_timer_get_user_data(timer))->Render();
            },
            kFrameMs, this);
        ESP_LOGI(kTag, "Zero-text EyeUI ready (%dx%d), persona=%d", screen_.width, screen_.width,
                 static_cast<int>(persona_));
    }

    // Re-derive mood from device state whenever status changes, without showing text.
    // Preserve an active LLM conversation mood across Speaking/Notifying transitions so
    // server-sent emotions (type="llm") are not wiped when TTS starts speaking.
    void SetStatus(const char* status) override {
        (void)status;
        if (!setup_ui_called_)
            return;
        DisplayLockGuard lock(this);
        if (status_bar_)
            lv_obj_add_flag(status_bar_, LV_OBJ_FLAG_HIDDEN);
        const auto state = Application::GetInstance().GetDeviceState();
        const bool in_reply =
            (state == kDeviceStateSpeaking || state == kDeviceStateNotifying);
        if (in_reply && has_llm_mood_) {
            has_alert_mood_ = false;
            if (!performance_timer_)
                mood_ = llm_mood_;
            return;
        }
        has_llm_mood_ = false;
        has_alert_mood_ = false;
        if (!performance_timer_)
            mood_ = StateFallbackMood();
    }

    void ShowNotification(const char* notification, int duration_ms = 3000) override {
        (void)notification;
        (void)duration_ms;
    }

    void ShowNotification(const std::string& notification, int duration_ms = 3000) override {
        (void)notification;
        (void)duration_ms;
    }

    // Always return true once SetupUI() has run so Application keeps the mood.
    bool SetEmotion(const char* emotion) override {
        if (!setup_ui_called_)
            return false;
        DisplayLockGuard lock(this);
        if (performance_timer_)
            return true;

        if (podone::IsAlertEmotion(emotion)) {
            has_llm_mood_ = false;
            has_alert_mood_ = true;
            mood_ = MoodFor(emotion);
            return true;
        }

        if (!emotion || emotion[0] == '\0' || std::strcmp(emotion, "neutral") == 0) {
            const auto state = Application::GetInstance().GetDeviceState();
            const bool keep_thinking =
                !has_alert_mood_ && state == kDeviceStateListening && mood_ == eyes::Mood::Thinking;
            has_llm_mood_ = false;
            has_alert_mood_ = false;
            if (!keep_thinking)
                mood_ = StateFallbackMood();
            return true;
        }

        const eyes::Mood mapped = podone::MoodForEmotion(emotion, eyes::Mood::Count);
        if (mapped != eyes::Mood::Count) {
            has_alert_mood_ = false;
            has_llm_mood_ = true;
            llm_mood_ = mapped;
            mood_ = mapped;
        } else {
            has_llm_mood_ = false;
            has_alert_mood_ = false;
            mood_ = StateFallbackMood();
        }
        return true;
    }

    void SetTheme(Theme* theme) override {
        SpiLcdDisplay::SetTheme(theme);
        if (setup_ui_called_) {
            DisplayLockGuard lock(this);
            ApplyMonochrome();
        }
    }

    bool ScreenSleeping() const { return sleep_mode_.load(std::memory_order_relaxed); }

    void SetPowerSaveMode(bool on) override {
        sleep_mode_.store(on, std::memory_order_relaxed);
        if (setup_ui_called_) {
            DisplayLockGuard lock(this);
            if (frame_timer_) lv_timer_set_period(frame_timer_, on ? 80 : kFrameMs);
            if (!on)
                hud_peek_until_ = lv_tick_get() + 2000;
        }
    }

    void UpdateStatusBar(bool update_all = false) override {
        (void)update_all;
        auto& board = Board::GetInstance();
        int level = 100;
        bool charging = false, discharging = true;
        const bool has_bat = board.GetBatteryLevel(level, charging, discharging);
        auto codec = board.GetAudioCodec();
        const bool is_muted = codec && codec->output_volume() == 0;

        auto& wifi = WifiManager::GetInstance();
        WifiState wstate = WifiState::Offline;
        if (wifi.IsConfigMode()) {
            wstate = WifiState::Connecting;
        } else if (wifi.IsConnected()) {
            const int rssi = wifi.GetRssi();
            if (rssi >= -65)
                wstate = WifiState::Strong;
            else if (rssi >= -75)
                wstate = WifiState::Medium;
            else
                wstate = WifiState::Weak;
        } else {
            wstate = Application::GetInstance().GetDeviceState() == kDeviceStateConnecting
                         ? WifiState::Connecting
                         : WifiState::Offline;
        }

        if (!setup_ui_called_)
            return;
        DisplayLockGuard lock(this);
        if (has_bat) {
            const bool newly_charging = charging && !charging_;
            battery_pct_ = std::clamp(level, 0, 100);
            charging_ = charging;
            discharging_ = discharging;
            if (newly_charging) {
                charging_since_ = lv_tick_get();
                hud_peek_until_ = charging_since_ + 3000;
                React(eyes::Mood::Happy, charging_since_, 1800);
            }
        }
        muted_state_ = is_muted;
        wifi_state_ = wstate;
    }

    // Called on the application task by the board's MCP tool.
    void PlayPerformance(const std::string& action) {
        DisplayLockGuard lock(this);
        has_llm_mood_ = false;
        has_alert_mood_ = false;
        mood_ = MoodFor(action.c_str());
        if (performance_timer_)
            lv_timer_delete(performance_timer_);
        performance_timer_ = lv_timer_create(
            [](lv_timer_t* timer) {
                auto self = static_cast<EyeDisplay*>(lv_timer_get_user_data(timer));
                self->performance_timer_ = nullptr;
                self->has_llm_mood_ = false;
                self->has_alert_mood_ = false;
                self->SetEmotion("neutral");
            },
            12000, this);
        lv_timer_set_repeat_count(performance_timer_, 1);
    }

    void SetChatMessage(const char* role, const char* content) override {
        last_role_ = role ? role : "";
        last_text_ = content ? content : "";
        if (!setup_ui_called_) {
            SpiLcdDisplay::SetChatMessage(role, content);
            return;
        }
        DisplayLockGuard lock(this);
        ShowChat();
        if (!performance_timer_ && !last_text_.empty() && last_role_ == "user") {
            has_llm_mood_ = false;
            has_alert_mood_ = false;
            mood_ = eyes::Mood::Thinking;
        }
    }

    void ClearChatMessages() override {
        SpiLcdDisplay::ClearChatMessages();
        SetChatMessage("system", "");
    }

    void RemoveChatMessage(const char* role, const char* content) override {
        (void)role;
        if (!content || last_text_ != content)
            return;
        SetChatMessage("system", "");
    }

    // Real-time audio RMS levels [0..1] pushed from the board's audio codec.
    void SetAudioLevels(float input_rms, float output_rms) {
        const float in_clamped = std::clamp(input_rms, 0.0f, 1.0f);
        const float out_clamped = std::clamp(output_rms, 0.0f, 1.0f);
        in_level_.store(in_clamped, std::memory_order_relaxed);
        out_level_.store(out_clamped, std::memory_order_relaxed);
        if (out_clamped > 0.012f) {
            last_out_active_us_.store(esp_timer_get_time(), std::memory_order_relaxed);
        }
    }

    // Motion inputs arrive from the IMU task; Render() consumes them on the LVGL task.
    void SetTilt(float x, float y) {
        tilt_x_.store(x, std::memory_order_relaxed);
        tilt_y_.store(y, std::memory_order_relaxed);
    }
    void SetDizzy(bool active) { dizzy_.store(active, std::memory_order_relaxed); }

    void OnTouch(std::function<void()> callback) { on_touch_ = std::move(callback); }
    void OnReaction(std::function<void(eyes::Mood)> callback) { on_reaction_ = std::move(callback); }
    void OnChatToggle(std::function<void()> callback) { on_chat_toggle_ = std::move(callback); }
    void OnMuteToggle(std::function<void()> callback) { on_mute_toggle_ = std::move(callback); }
    void OnVolumeStep(std::function<void()> callback) { on_volume_step_ = std::move(callback); }
    void OnBrightnessStep(std::function<void()> callback) {
        on_brightness_step_ = std::move(callback);
    }
    void OnSleepRequest(std::function<void(bool)> callback) {
        on_sleep_request_ = std::move(callback);
    }

    void PeekTelemetry(uint32_t duration_ms = 2800) {
        if (!setup_ui_called_)
            return;
        DisplayLockGuard lock(this);
        hud_peek_until_ = lv_tick_get() + duration_ms;
    }

    void ToggleQuickRing() {
        if (!setup_ui_called_)
            return;
        DisplayLockGuard lock(this);
        quick_ring_open_ = !quick_ring_open_;
        if (quick_ring_open_)
            reaction_until_ = 0;
    }

private:
    static constexpr const char* kTag = "EyeUI";
    static constexpr uint32_t kFrameMs = 20;

    enum class Layout { Large, Small };
    enum class WifiState : uint8_t { Strong, Medium, Weak, Connecting, Offline };
    enum class Gesture { None, Horizontal, Vertical, Follow };
    enum class Persona : uint8_t { Classic = 0, Crystal = 1, Count = 2 };

    EyeScreen screen_;
    const EyeScreen::Layout& Spec(Layout layout) const {
        return layout == Layout::Small ? screen_.small : screen_.large;
    }
    int CenterX() const { return screen_.width / 2; }
    int CenterY() const { return screen_.width / 2; }

    struct EyeGeom {
        int32_t cx = 0, cy = 0, w = 0, h = 0, tilt10 = 0, body_opa = 0;
        int32_t lid_on = 0, lid_l = 0, lid_r = 0;
        int32_t swirl_opa = 0, swirl_d = 0, swirl_rot = 0;
        int32_t cap_opa = 0, cap_d = 0, cap_w = 0, cap_cy = 0, cap_up = 0, cap_rot = 0;
        int32_t dim = 0;
        lv_area_t box{0, 0, -1, -1};
        bool operator==(const EyeGeom& o) const { return memcmp(this, &o, sizeof(*this)) == 0; }
    };

    struct VisualFrame {
        Persona persona = Persona::Classic;
        DeviceState dev_state = kDeviceStateUnknown;
        eyes::Mood mood = eyes::Mood::Idle;
        WifiState wifi = WifiState::Strong;
        int battery_pct = 100;
        bool charging = false;
        bool muted = false;
        bool sleeping = false;
        bool show_system_text = false;
        bool indicator_on = false;
        bool turn_audio_started = false;
        bool voice_playing = false;
        uint8_t hud_opa = 0;
        uint8_t blush_opa = 0;
        float mouth_amp = 0.0f;
        uint32_t anim_tick = 0;     // quantized 60ms tick for ring/arc animations
        uint32_t mouth_tick = 0;    // frame tick for mouth waveform
        uint8_t quick_ring_opa = 0;
    };

    lv_obj_t* canvas_ = nullptr;
    EyeGeom geom_[2];
    VisualFrame vis_{}, prev_vis_{};
    lv_area_t prev_mouth_box_{0, 0, -1, -1};
    lv_area_t prev_top_hud_box_{0, 0, -1, -1};
    lv_area_t prev_bot_hud_box_{0, 0, -1, -1};

    uint32_t refreshes_ = 0, renders_ = 0, max_gap_ms_ = 0, last_stat_ = 0;
    int64_t draw_us_ = 0, max_draw_us_ = 0;
    uint32_t draws_ = 0;

    eyes::Face face_ = eyes::FaceFor(eyes::Mood::Idle, 0);
    eyes::Mood mood_ = eyes::Mood::Idle;
    eyes::Mood llm_mood_ = eyes::Mood::Idle;
    bool has_llm_mood_ = false;
    bool has_alert_mood_ = false;
    Layout layout_ = Layout::Large;
    lv_timer_t* frame_timer_ = nullptr;
    lv_timer_t* performance_timer_ = nullptr;
    uint32_t last_tick_ = 0;

    std::string last_role_, last_text_;

    uint32_t next_blink_ = 2500, blink_start_ = 0;
    bool blinking_ = false, double_blink_ = false;
    uint32_t next_glance_ = 1500;
    float glance_x_ = 0, glance_y_ = 0;
    float gaze_x_ = 0, gaze_y_ = 0;
    std::atomic<float> tilt_x_{0}, tilt_y_{0};
    std::atomic<bool> dizzy_{false};
    std::atomic<bool> sleep_mode_{false};

    // Audio envelope state
    std::atomic<float> in_level_{0}, out_level_{0};
    std::atomic<int64_t> last_out_active_us_{0};
    float smooth_in_ = 0, smooth_out_ = 0;
    bool turn_audio_started_ = false;

    // Telemetry state
    int battery_pct_ = 100;
    bool charging_ = false;
    bool discharging_ = true;
    bool muted_state_ = false;
    WifiState wifi_state_ = WifiState::Strong;
    uint32_t hud_peek_until_ = 0;
    uint32_t charging_since_ = 0;
    float hud_alpha_ = 0.0f;
    float blush_alpha_ = 0.0f;

    // Touch reactions & Quick Control Ring
    eyes::Mood reaction_ = eyes::Mood::Idle;
    uint32_t reaction_until_ = 0;
    int wink_side_ = -1;  // -1 none, 0 left, 1 right
    uint32_t wink_until_ = 0;
    bool quick_ring_open_ = false;
    float quick_ring_anim_ = 0.0f;

    std::function<void()> on_touch_;
    std::function<void(eyes::Mood)> on_reaction_;
    std::function<void()> on_chat_toggle_;
    std::function<void()> on_mute_toggle_;
    std::function<void()> on_volume_step_;
    std::function<void()> on_brightness_step_;
    std::function<void(bool)> on_sleep_request_;

    lv_indev_t* touch_ = nullptr;
    bool pressed_ = false, committed_ = false;
    Gesture gesture_ = Gesture::None;
    lv_point_t press_point_{}, touch_point_{};
    uint32_t press_time_ = 0, pending_tap_ = 0;
    lv_point_t pending_tap_point_{};

    // Persona switching & Persona 2 (Kintsugi Crystal Youth) pre-decoded PSRAM GIF players
    Persona persona_ = Persona::Classic;
    uint32_t persona_indicator_until_ = 0;
    uint32_t crystal_touch_until_ = 0;
    uint16_t* crystal_buf_ = nullptr;
    lv_image_dsc_t crystal_img_dsc_{};
    podone::CrystalGifPlayer idle_gif_player_;
    podone::CrystalGifPlayer speak_gif_player_;
    podone::CrystalGifPlayer* active_player_ = nullptr;
    bool crystal_initialized_ = false;

    void InitCrystalBuffer() {
        using namespace podone::crystal_assets;
        if (!crystal_buf_) {
            crystal_buf_ = static_cast<uint16_t*>(lv_malloc(kWidth * kHeight * sizeof(uint16_t)));
        }
        if (!crystal_buf_) {
            ESP_LOGE(kTag, "Failed to allocate crystal GIF buffer in LVGL pool");
            return;
        }
        // Pre-decode both GIFs into PSRAM once at boot so runtime state changes take 0ms
        speak_gif_player_.Open(kSpeakGif, sizeof(kSpeakGif), crystal_buf_, false, 0);
        idle_gif_player_.Open(kIdleGif, sizeof(kIdleGif), crystal_buf_, false, 0);
        active_player_ = &idle_gif_player_;

        std::memset(&crystal_img_dsc_, 0, sizeof(crystal_img_dsc_));
        crystal_img_dsc_.header.magic = LV_IMAGE_HEADER_MAGIC;
        crystal_img_dsc_.header.cf = LV_COLOR_FORMAT_RGB565;
        crystal_img_dsc_.header.w = kWidth;
        crystal_img_dsc_.header.h = kHeight;
        crystal_img_dsc_.header.stride = kWidth * sizeof(uint16_t);
        crystal_img_dsc_.data_size = kWidth * kHeight * sizeof(uint16_t);
        crystal_img_dsc_.data = reinterpret_cast<const uint8_t*>(crystal_buf_);
        crystal_initialized_ = false;
    }

    void SwitchPersona(int dir, uint32_t now) {
        const int count = static_cast<int>(Persona::Count);
        const int next = (static_cast<int>(persona_) + (dir > 0 ? 1 : count - 1)) % count;
        persona_ = static_cast<Persona>(next);
        persona_indicator_until_ = now + 2200;
        reaction_until_ = 0;
        crystal_initialized_ = false;
        {
            Settings settings("podone", true);
            settings.SetInt("persona", next);
        }
        ESP_LOGI(kTag, "Persona switched -> %d", next);
        InvalidateArea({0, 0, screen_.width - 1, screen_.width - 1});
    }

    void UpdateCrystalBuffer(uint32_t now, DeviceState dev_state, bool voice_playing, bool dimmed) {
        if (!crystal_buf_)
            return;
        using namespace podone::crystal_assets;
        const bool touch_glow =
            !dimmed && (static_cast<int32_t>(crystal_touch_until_ - now) > 0);
        const bool use_speak_player =
            !dimmed && (voice_playing || touch_glow ||
                        ((dev_state == kDeviceStateSpeaking || dev_state == kDeviceStateNotifying) &&
                         turn_audio_started_));
        podone::CrystalGifPlayer* player =
            use_speak_player ? &speak_gif_player_ : &idle_gif_player_;
        const uint8_t* target_data = use_speak_player ? kSpeakGif : kIdleGif;
        const size_t target_size = use_speak_player ? sizeof(kSpeakGif) : sizeof(kIdleGif);

        if (!crystal_initialized_ || active_player_ != player ||
            player->is_dimmed() != dimmed) {
            if (player->Open(target_data, target_size, crystal_buf_, dimmed, now)) {
                active_player_ = player;
                crystal_initialized_ = true;
                InvalidateArea({0, 0, screen_.width - 1, screen_.width - 1});
            }
            return;
        }

        lv_area_t dirty{};
        // When using speak_gif_player_, ONLY step lip-moving frames while actual voice audio is playing;
        // during silent pauses or touch glow, hold Frame 0 (golden eyes lit, lips closed).
        const bool stepped =
            (use_speak_player && !voice_playing) ? player->ResetToFrame0(now, &dirty)
                                                 : player->Step(now, &dirty);
        if (stepped) {
            const int32_t y_shift = (layout_ == Layout::Small) ? -56 : 0;
            dirty.y1 += y_shift;
            dirty.y2 += y_shift;
            InvalidateArea(dirty);
        }
    }

    static bool IsSystemTextState(DeviceState s) {
        return s == kDeviceStateWifiConfiguring || s == kDeviceStateActivating ||
               s == kDeviceStateUpgrading || s == kDeviceStateFatalError;
    }

    static bool HasOuterHalo(DeviceState s, WifiState w) {
        return s == kDeviceStateListening || s == kDeviceStateThinking_Alias() ||
               s == kDeviceStateConnecting || s == kDeviceStateSpeaking ||
               s == kDeviceStateNotifying || s == kDeviceStateWifiConfiguring ||
               s == kDeviceStateActivating || s == kDeviceStateFatalError ||
               w == WifiState::Offline;
    }

    // DeviceState has Connecting/Listening/Speaking/Notifying; Thinking is an expression state.
    static constexpr DeviceState kDeviceStateThinking_Alias() { return kDeviceStateConnecting; }

    static bool ClipIntersects(const lv_layer_t* layer, const lv_area_t& local_box,
                               int32_t ox, int32_t oy) {
        if (local_box.x2 < local_box.x1)
            return false;
        const lv_area_t& c = layer->_clip_area;
        return (local_box.x2 + ox >= c.x1) && (local_box.x1 + ox <= c.x2) &&
               (local_box.y2 + oy >= c.y1) && (local_box.y1 + oy <= c.y2);
    }

    static lv_color_t Hex(uint32_t rgb) { return lv_color_hex(rgb); }

    void ApplyMonochrome() {
        for (auto obj : {lv_screen_active(), container_, bottom_bar_}) {
            if (!obj)
                continue;
            lv_obj_set_style_bg_color(obj, lv_color_black(), 0);
            lv_obj_set_style_bg_image_src(obj, nullptr, 0);
        }
        if (top_bar_)
            lv_obj_add_flag(top_bar_, LV_OBJ_FLAG_HIDDEN);
        if (status_bar_)
            lv_obj_add_flag(status_bar_, LV_OBJ_FLAG_HIDDEN);
        if (low_battery_popup_)
            lv_obj_add_flag(low_battery_popup_, LV_OBJ_FLAG_HIDDEN);
        if (chat_message_label_)
            lv_obj_set_style_text_color(chat_message_label_, lv_color_white(), 0);
    }

    void ApplyLayout(Layout layout) {
        layout_ = layout;
        const auto& spec = Spec(layout);
        lv_obj_set_size(emoji_box_, screen_.width, spec.box_h);
        lv_obj_align(emoji_box_, LV_ALIGN_TOP_MID, 0, spec.box_y);
        lv_obj_set_height(bottom_bar_, screen_.text_h_small);
        lv_obj_align(bottom_bar_, LV_ALIGN_TOP_MID, 0, screen_.text_y_small);
    }

    // Only show system text during Wi-Fi provisioning, activation, OTA, or fatal errors.
    void ShowChat() {
        const auto state = Application::GetInstance().GetDeviceState();
        const bool show_sys =
            last_role_ == "system" && !last_text_.empty() && IsSystemTextState(state);
        if (!show_sys) {
            SpiLcdDisplay::SetChatMessage("system", "");
            lv_obj_add_flag(bottom_bar_, LV_OBJ_FLAG_HIDDEN);
            ApplyLayout(Layout::Large);
            return;
        }
        SpiLcdDisplay::SetChatMessage("system", last_text_.c_str());
        lv_obj_remove_flag(bottom_bar_, LV_OBJ_FLAG_HIDDEN);
        ApplyLayout(Layout::Small);

        lv_anim_delete(chat_message_label_, nullptr);
        lv_obj_align(chat_message_label_, LV_ALIGN_TOP_MID, 0, 0);
        lv_obj_update_layout(chat_message_label_);
        const int overflow = lv_obj_get_height(chat_message_label_) - lv_obj_get_height(bottom_bar_);
        if (overflow > 0) {
            lv_anim_t scroll;
            lv_anim_init(&scroll);
            lv_anim_set_var(&scroll, chat_message_label_);
            lv_anim_set_values(&scroll, 0, -overflow);
            lv_anim_set_duration(&scroll, overflow * 55);
            lv_anim_set_delay(&scroll, 2500);
            lv_anim_set_reverse_duration(&scroll, 300);
            lv_anim_set_reverse_delay(&scroll, 3000);
            lv_anim_set_repeat_delay(&scroll, 2500);
            lv_anim_set_repeat_count(&scroll, LV_ANIM_REPEAT_INFINITE);
            lv_anim_set_exec_cb(&scroll, [](void* label, int32_t y) {
                lv_obj_set_y(static_cast<lv_obj_t*>(label), y);
            });
            lv_anim_start(&scroll);
        }
    }

    eyes::Mood StateFallbackMood() const {
        using eyes::Mood;
        switch (Application::GetInstance().GetDeviceState()) {
            case kDeviceStateListening:
                return Mood::Listening;
            case kDeviceStateSpeaking:
            case kDeviceStateNotifying:
                return Mood::Speaking;
            case kDeviceStateConnecting:
                return Mood::Thinking;
            case kDeviceStateWifiConfiguring:
                return Mood::Confused;
            case kDeviceStateActivating:
                return Mood::Curious;
            case kDeviceStateFatalError:
                return Mood::Sad;
            default:
                if (wifi_state_ == WifiState::Offline)
                    return Mood::Sad;
                if (discharging_ && battery_pct_ <= 15)
                    return Mood::Sleepy;
                return Mood::Idle;
        }
    }

    eyes::Mood MoodFor(const char* name) const {
        using eyes::Mood;
        const Mood mapped = podone::MoodForEmotion(name, Mood::Count);
        if (mapped != Mood::Count)
            return mapped;
        return StateFallbackMood();
    }

    void React(eyes::Mood mood, uint32_t now, uint32_t duration_ms = 2000) {
        reaction_ = mood;
        reaction_until_ = now + duration_ms;
        if (on_reaction_)
            on_reaction_(mood);
    }

    eyes::Mood CurrentMood(uint32_t now) const {
        if (dizzy_.load(std::memory_order_relaxed))
            return eyes::Mood::Dizzy;
        if (sleep_mode_.load(std::memory_order_relaxed))
            return eyes::Mood::Sleepy;
        if (static_cast<int32_t>(reaction_until_ - now) > 0)
            return reaction_;
        return mood_;
    }

    void HandleTap(const lv_point_t& pt, uint32_t now) {
        if (sleep_mode_.load(std::memory_order_relaxed)) {
            if (on_sleep_request_)
                on_sleep_request_(false);
            else
                sleep_mode_.store(false, std::memory_order_relaxed);
            React(eyes::Mood::Curious, now, 1500);
            hud_peek_until_ = now + 2600;
            return;
        }
        if (pt.y < 82) {
            hud_peek_until_ = now + 2800;
            return;
        }
        if (pt.y > 308) {
            if (!IsSystemTextState(Application::GetInstance().GetDeviceState()) && on_chat_toggle_)
                on_chat_toggle_();
            return;
        }
        if (persona_ == Persona::Crystal) {
            crystal_touch_until_ = now + 2200;
            return;
        }
        if (pt.y < 168) {
            React(eyes::Mood::Happy, now, 2200);
            return;
        }
        wink_side_ = pt.x < CenterX() ? 0 : 1;
        wink_until_ = now + 700;
    }

    void HandleQuickRingTap(const lv_point_t& pt) {
        const int dx = pt.x - CenterX();
        const int dy = pt.y - CenterY();
        if (dx * dx + dy * dy < 68 * 68) {
            quick_ring_open_ = false;
            return;
        }
        if (std::abs(dx) > std::abs(dy)) {
            if (dx < 0 && on_mute_toggle_)
                on_mute_toggle_();
            else if (dx > 0 && on_sleep_request_)
                on_sleep_request_(true);
        } else {
            if (dy < 0 && on_volume_step_)
                on_volume_step_();
            else if (dy > 0 && on_brightness_step_)
                on_brightness_step_();
        }
        quick_ring_open_ = false;
    }

    void PollTouch(uint32_t now) {
        static constexpr int kLockPx = 12;
        static constexpr int kSwipePx = 42;
        static constexpr uint32_t kFollowAfterMs = 360;
        static constexpr uint32_t kWarnPressMs = 620;
        static constexpr uint32_t kRingPressMs = 1080;
        static constexpr uint32_t kDoubleTapMs = 260;

        if (!touch_) {
            for (auto indev = lv_indev_get_next(nullptr); indev; indev = lv_indev_get_next(indev)) {
                if (lv_indev_get_type(indev) == LV_INDEV_TYPE_POINTER) {
                    touch_ = indev;
                    break;
                }
            }
            if (!touch_)
                return;
        }
        if (pending_tap_ && now - pending_tap_ > kDoubleTapMs) {
            pending_tap_ = 0;
            HandleTap(pending_tap_point_, now);
        }
        const bool down = lv_indev_get_state(touch_) == LV_INDEV_STATE_PRESSED;
        if (down)
            lv_indev_get_point(touch_, &touch_point_);

        if (down && !pressed_) {
            pressed_ = true;
            committed_ = false;
            gesture_ = Gesture::None;
            press_point_ = touch_point_;
            press_time_ = now;
            const bool was_asleep = sleep_mode_.load(std::memory_order_relaxed);
            if (on_touch_)
                on_touch_();
            if (was_asleep) {
                if (on_sleep_request_)
                    on_sleep_request_(false);
                else
                    sleep_mode_.store(false, std::memory_order_relaxed);
                React(eyes::Mood::Curious, now, 1500);
                hud_peek_until_ = now + 2600;
                committed_ = true;
                return;
            }
            if (quick_ring_open_) {
                HandleQuickRingTap(touch_point_);
                committed_ = true;
            }
            return;
        }
        if (!down) {
            if (pressed_ && !committed_ && gesture_ == Gesture::None && !quick_ring_open_) {
                if (pending_tap_) {
                    pending_tap_ = 0;
                    crystal_touch_until_ = now + 2200;
                    React(eyes::Mood::Surprised, now, 1800);
                } else {
                    pending_tap_ = std::max<uint32_t>(now, 1);
                    pending_tap_point_ = touch_point_;
                }
            }
            pressed_ = false;
            gesture_ = Gesture::None;
            return;
        }
        if (committed_)
            return;

        const int dx = touch_point_.x - press_point_.x;
        const int dy = touch_point_.y - press_point_.y;
        if (gesture_ == Gesture::None && std::max(std::abs(dx), std::abs(dy)) >= kLockPx) {
            if (persona_ == Persona::Classic && now - press_time_ >= kFollowAfterMs)
                gesture_ = Gesture::Follow;
            else
                gesture_ = std::abs(dx) >= std::abs(dy) ? Gesture::Horizontal : Gesture::Vertical;
        }
        if (gesture_ == Gesture::Horizontal && std::abs(dx) >= kSwipePx) {
            SwitchPersona(dx < 0 ? 1 : -1, now);
            committed_ = true;
        } else if (gesture_ == Gesture::Vertical && std::abs(dy) >= kSwipePx) {
            if (press_point_.y < 100 && dy > 0) {
                hud_peek_until_ = now + 3000;
            } else if (dy > 0) {
                if (on_sleep_request_)
                    on_sleep_request_(true);
                else
                    sleep_mode_.store(true, std::memory_order_relaxed);
            } else {
                if (on_sleep_request_)
                    on_sleep_request_(false);
                else
                    sleep_mode_.store(false, std::memory_order_relaxed);
                React(eyes::Mood::Surprised, now, 1400);
            }
            committed_ = true;
        } else if (gesture_ == Gesture::None) {
            const uint32_t held = now - press_time_;
            if (held >= kRingPressMs) {
                quick_ring_open_ = true;
                reaction_until_ = 0;
                committed_ = true;
            } else if (held >= kWarnPressMs && static_cast<int32_t>(reaction_until_ - now) <= 0) {
                React(eyes::Mood::Angry, now, 600);
            }
        }
    }

    float BlinkFactor(uint32_t now, eyes::Mood mood) {
        using eyes::Mood;
        static constexpr uint32_t kClose = 70, kHold = 30, kOpen = 140;
        const bool allowed = (persona_ == Persona::Crystal)
                                 ? (mood != Mood::Sleepy)
                                 : (mood != Mood::Happy && mood != Mood::Sleepy &&
                                    mood != Mood::Dizzy && mood != Mood::Surprised);
        if (!blinking_) {
            if (static_cast<int32_t>(now - next_blink_) < 0 || !allowed)
                return 1.0f;
            blinking_ = true;
            blink_start_ = now;
        }
        const uint32_t age = now - blink_start_;
        float k;
        if (age < kClose)
            k = 1.0f - static_cast<float>(age) / kClose;
        else if (age < kClose + kHold)
            k = 0;
        else if (age < kClose + kHold + kOpen)
            k = static_cast<float>(age - kClose - kHold) / kOpen;
        else {
            blinking_ = false;
            if (!double_blink_ && esp_random() % 5 == 0) {
                double_blink_ = true;
                next_blink_ = now + 90;
            } else {
                double_blink_ = false;
                next_blink_ = now + 2600 + esp_random() % 3400;
            }
            return 1.0f;
        }
        return std::max(0.06f, k);
    }

    void UpdateGaze(uint32_t now, float dt, eyes::Mood mood, float center_y) {
        using eyes::Mood;
        const bool glancing = mood == Mood::Idle || mood == Mood::Listening || mood == Mood::Speaking;
        if (static_cast<int32_t>(now - next_glance_) >= 0) {
            next_glance_ = now + 1200 + esp_random() % 2300;
            const bool home = !glancing || esp_random() % 3 == 0;
            glance_x_ = home ? 0 : ((esp_random() % 1000) / 1000.0f - 0.5f) * 0.7f;
            glance_y_ = home ? 0 : ((esp_random() % 1000) / 1000.0f - 0.5f) * 0.4f;
        }
        float gx = tilt_x_.load(std::memory_order_relaxed) + glance_x_;
        float gy = tilt_y_.load(std::memory_order_relaxed) + glance_y_;
        if (pressed_ && gesture_ == Gesture::Follow) {
            gx = (touch_point_.x - CenterX()) / screen_.follow_px;
            gy = (touch_point_.y - center_y) / screen_.follow_px;
        }
        const float k = eyes::Ease(dt, pressed_ ? 14 : 18);
        gaze_x_ += (std::clamp(gx, -1.0f, 1.0f) - gaze_x_) * k;
        gaze_y_ += (std::clamp(gy, -1.0f, 1.0f) - gaze_y_) * k;
    }

    EyeGeom ComputeEye(const eyes::Shape& s, float home_x, float center_y, float scale, float blink,
                       uint32_t now, int index, bool dimmed) const {
        EyeGeom g;
        g.dim = dimmed ? 1 : 0;
        const float shape_weight = 1.0f - std::min(1.0f, std::fabs(s.arc));
        g.cx = std::lround(home_x + (s.dx + gaze_x_ * 34) * scale);
        g.cy = std::lround(center_y + (s.dy + gaze_y_ * 26) * scale);
        int32_t x1 = g.cx, y1 = g.cy, x2 = g.cx, y2 = g.cy;
        auto grow = [&](int32_t l, int32_t t, int32_t r, int32_t b) {
            x1 = std::min(x1, l);
            y1 = std::min(y1, t);
            x2 = std::max(x2, r);
            y2 = std::max(y2, b);
        };
        if (shape_weight >= 0.03f) {
            g.w = std::max<int32_t>(4, std::lround(s.w * scale));
            g.h = std::max<int32_t>(4, std::lround(s.h * scale * blink * shape_weight));
            g.body_opa = std::lround((dimmed ? 140 : 255) * shape_weight);
            g.tilt10 = g.h > g.w ? std::lround(s.tilt * 10) : 0;
            const int32_t reach = std::max(g.w, g.h) / 2 + 2;
            grow(g.cx - reach, g.cy - reach, g.cx + reach, g.cy + reach);
            if (s.lid >= 0.01f) {
                const float edge = g.cy - g.h / 2.0f + s.lid * g.h;
                const float slope = std::tan(s.lid_tilt * 0.0174533f) * g.w / 2;
                g.lid_on = 1;
                g.lid_l = std::lround(edge - slope);
                g.lid_r = std::lround(edge + slope);
            }
            const int32_t d = std::min(g.w, g.h);
            if (s.spin >= 0.05f && d >= 20) {
                g.swirl_opa = std::lround(255 * s.spin);
                g.swirl_d = d;
                g.swirl_rot = static_cast<int32_t>(now * 0.42f) % 360 + index * 90;
            }
        }
        const float arc_weight = std::min(1.0f, std::fabs(s.arc));
        if (arc_weight >= 0.03f) {
            g.cap_up = s.arc > 0;
            g.cap_opa = std::lround((dimmed ? 120 : 255) * arc_weight);
            g.cap_d = std::max<int32_t>(10, std::lround(s.w * scale));
            g.cap_w = std::max<int32_t>(3, std::lround(g.cap_d * (g.cap_up ? 0.22f : 0.085f)));
            g.cap_cy = g.cy + std::lround(g.cap_d * (g.cap_up ? 0.22f : -0.28f));
            g.cap_rot = std::lround(s.tilt);
            const int32_t r = g.cap_d / 2 + 2;
            grow(g.cx - r, g.cap_cy - r, g.cx + r, g.cap_cy + r);
        }
        g.box = {x1, y1, x2, y2};
        return g;
    }

    static void DrawEye(lv_layer_t* layer, const EyeGeom& g, int32_t ox, int32_t oy) {
        const int32_t cx = ox + g.cx, cy = oy + g.cy;
        const lv_color_t fg = g.dim ? Hex(0x94a3b8) : Hex(0xf4f7fb);
        if (g.body_opa > 0) {
            if (g.tilt10 == 0) {
                lv_draw_rect_dsc_t body;
                lv_draw_rect_dsc_init(&body);
                body.bg_color = fg;
                body.bg_opa = g.body_opa;
                body.radius = LV_RADIUS_CIRCLE;
                const lv_area_t area = {cx - g.w / 2, cy - g.h / 2, cx - g.w / 2 + g.w - 1,
                                        cy - g.h / 2 + g.h - 1};
                lv_draw_rect(layer, &body, &area);
            } else {
                const float a = g.tilt10 * 0.00174533f;
                const float half = (g.h - g.w) / 2.0f;
                lv_draw_line_dsc_t line;
                lv_draw_line_dsc_init(&line);
                line.color = fg;
                line.opa = g.body_opa;
                line.width = g.w;
                line.round_start = line.round_end = 1;
                line.p1 = {static_cast<lv_value_precise_t>(cx - std::sin(a) * half),
                           static_cast<lv_value_precise_t>(cy + std::cos(a) * half)};
                line.p2 = {static_cast<lv_value_precise_t>(cx + std::sin(a) * half),
                           static_cast<lv_value_precise_t>(cy - std::cos(a) * half)};
                lv_draw_line(layer, &line);
            }
            if (g.lid_on) {
                const int32_t reach = std::max(g.w, g.h) / 2 + 2;
                const lv_value_precise_t l = cx - reach, r = cx + reach, top = cy - reach;
                const float k = static_cast<float>(g.lid_r - g.lid_l) / std::max<int32_t>(1, g.w);
                const lv_value_precise_t yl = oy + g.lid_l - k * (reach - g.w / 2);
                const lv_value_precise_t yr = oy + g.lid_r + k * (reach - g.w / 2);
                lv_draw_triangle_dsc_t tri;
                lv_draw_triangle_dsc_init(&tri);
                tri.color = lv_color_black();
                tri.opa = LV_OPA_COVER;
                tri.p[0] = {l, top};
                tri.p[1] = {r, top};
                tri.p[2] = {r, yr};
                lv_draw_triangle(layer, &tri);
                tri.p[1] = {r, yr};
                tri.p[2] = {l, yl};
                lv_draw_triangle(layer, &tri);
            }
            if (g.swirl_opa > 0) {
                lv_draw_arc_dsc_t arc;
                lv_draw_arc_dsc_init(&arc);
                arc.color = lv_color_black();
                arc.opa = g.swirl_opa;
                arc.center = {cx, cy};
                arc.width = std::max<int32_t>(3, g.swirl_d / 11);
                arc.rounded = 1;
                for (int r = 0; r < 2; ++r) {
                    const int32_t turn = r ? 360 - g.swirl_rot % 360 : g.swirl_rot;
                    arc.radius = static_cast<uint16_t>(g.swirl_d * (r ? 0.2f : 0.37f));
                    arc.start_angle = turn;
                    arc.end_angle = turn + (r ? 220 : 260);
                    lv_draw_arc(layer, &arc);
                }
            }
        }
        if (g.cap_opa > 0) {
            lv_draw_arc_dsc_t arc;
            lv_draw_arc_dsc_init(&arc);
            arc.color = fg;
            arc.opa = g.cap_opa;
            arc.center = {cx, oy + g.cap_cy};
            arc.radius = static_cast<uint16_t>(g.cap_d / 2);
            arc.width = g.cap_w;
            arc.rounded = 1;
            arc.start_angle = (g.cap_up ? 182 : 32) + g.cap_rot;
            arc.end_angle = (g.cap_up ? 358 : 148) + g.cap_rot;
            lv_draw_arc(layer, &arc);
        }
    }

    static void DrawArc(lv_layer_t* layer, int32_t cx, int32_t cy, uint16_t r, int32_t w,
                        int32_t start_deg, int32_t end_deg, lv_color_t color, lv_opa_t opa) {
        if (opa == 0)
            return;
        lv_draw_arc_dsc_t dsc;
        lv_draw_arc_dsc_init(&dsc);
        dsc.color = color;
        dsc.opa = opa;
        dsc.center = {cx, cy};
        dsc.radius = r;
        dsc.width = w;
        dsc.rounded = 1;
        dsc.start_angle = start_deg;
        dsc.end_angle = end_deg;
        lv_draw_arc(layer, &dsc);
    }

    static void DrawPill(lv_layer_t* layer, int32_t cx, int32_t cy, int32_t w, int32_t h,
                         lv_color_t color, lv_opa_t opa) {
        if (opa == 0 || w <= 0 || h <= 0)
            return;
        lv_draw_rect_dsc_t dsc;
        lv_draw_rect_dsc_init(&dsc);
        dsc.bg_color = color;
        dsc.bg_opa = opa;
        dsc.radius = LV_RADIUS_CIRCLE;
        const lv_area_t area = {cx - w / 2, cy - h / 2, cx - w / 2 + w - 1, cy - h / 2 + h - 1};
        lv_draw_rect(layer, &dsc, &area);
    }

    void DrawOuterHalo(lv_layer_t* layer, int32_t ox, int32_t oy) const {
        if (vis_.show_system_text)
            return;
        const int32_t cx = ox + CenterX(), cy = oy + CenterY();
        const float t = vis_.anim_tick * 0.06f;
        const bool is_crystal = (vis_.persona == Persona::Crystal);

        if (vis_.sleeping) {
            const uint8_t opa = static_cast<uint8_t>(45 + 55 * (0.5f + 0.5f * std::sin(t * 1.3f)));
            DrawPill(layer, cx, oy + 444, 8, 8, is_crystal ? Hex(0xfbbf24) : Hex(0x94a3b8), opa);
            return;
        }
        if (vis_.dev_state == kDeviceStateListening) {
            const float pulse = std::max(vis_.mouth_amp, 0.5f + 0.5f * std::sin(t * 4.2f));
            const int32_t w = 4 + static_cast<int32_t>(3 * pulse);
            const uint8_t opa = static_cast<uint8_t>(110 + 125 * pulse);
            DrawArc(layer, cx, cy, 224, w, 0, 360, is_crystal ? Hex(0xfbbf24) : Hex(0x38bdf8), opa);
        } else if (vis_.dev_state == kDeviceStateConnecting ||
                   ((vis_.dev_state == kDeviceStateSpeaking ||
                     vis_.dev_state == kDeviceStateNotifying) &&
                    !vis_.turn_audio_started)) {
            const lv_color_t c_main = is_crystal ? Hex(0xfbbf24) : Hex(0xa78bfa);
            const lv_color_t c_sub = is_crystal ? Hex(0x94a3b8) : Hex(0xa78bfa);
            DrawArc(layer, cx, cy, 224, 4, 0, 360, c_sub, 48);
            const int32_t a = static_cast<int32_t>(t * 165.0f) % 360;
            DrawArc(layer, cx, cy, 224, 6, a, a + 105, c_main, 235);
            DrawArc(layer, cx, cy, 224, 6, (a + 180) % 360, (a + 245) % 360, c_sub, 210);
        } else if (vis_.dev_state == kDeviceStateSpeaking ||
                   vis_.dev_state == kDeviceStateNotifying) {
            const float amp = vis_.voice_playing ? (0.35f + 0.65f * vis_.mouth_amp) : 0.2f;
            const int32_t w = 4 + static_cast<int32_t>(3 * amp);
            const uint8_t opa = static_cast<uint8_t>(85 + 115 * amp);
            const lv_color_t col = is_crystal ? Hex(0xfbbf24) : Hex(0x34d399);
            DrawArc(layer, cx, cy, 224, w, 28, 152, col, opa);
            DrawArc(layer, cx, cy, 224, w, 208, 332, col, opa);
        } else if (vis_.dev_state == kDeviceStateFatalError) {
            const uint8_t opa = static_cast<uint8_t>(100 + 135 * std::fabs(std::sin(t * 3.0f)));
            DrawArc(layer, cx, cy, 224, 5, 225, 315, Hex(0xf87171), opa);
        }
    }

    void DrawPersonaIndicator(lv_layer_t* layer, int32_t ox, int32_t oy) const {
        if (!vis_.indicator_on || vis_.show_system_text)
            return;
        const int32_t cx = ox + CenterX();
        const int32_t iy = oy + 434;
        for (int i = 0; i < static_cast<int>(Persona::Count); ++i) {
            const bool active = (static_cast<int>(vis_.persona) == i);
            const lv_color_t col =
                active ? (i == 1 ? Hex(0xfbbf24) : Hex(0x38bdf8)) : Hex(0x475569);
            DrawPill(layer, cx + (i == 0 ? -10 : 10), iy, active ? 10 : 6, 6, col,
                     active ? 240 : 140);
        }
    }

    void DrawTopTelemetry(lv_layer_t* layer, int32_t ox, int32_t oy) const {
        const int32_t cx = ox + CenterX(), cy = oy + CenterY();
        const float t = vis_.anim_tick * 0.06f;

        // Top-left Wi-Fi arc (226..256 deg)
        const bool net_abnormal = vis_.wifi != WifiState::Strong;
        const uint8_t net_opa = net_abnormal ? 255 : vis_.hud_opa;
        if (net_opa > 6) {
            if (vis_.wifi == WifiState::Connecting) {
                const float phase = std::fmod(t * 1.6f, 1.0f);
                for (int i = 0; i < 3; ++i) {
                    const float k = std::fmod(phase - i * 0.25f + 1.0f, 1.0f);
                    const uint8_t a = static_cast<uint8_t>((1.0f - k) * net_opa);
                    DrawArc(layer, cx, oy + 46, static_cast<uint16_t>(8 + k * 16), 3, 218, 322,
                            Hex(0xa78bfa), a);
                }
            } else if (vis_.wifi == WifiState::Offline) {
                const uint8_t flash = static_cast<uint8_t>(
                    (0.45f + 0.55f * std::fabs(std::sin(t * 3.2f))) * net_opa);
                DrawArc(layer, cx, cy, 212, 5, 226, 238, Hex(0xf87171), flash);
                DrawArc(layer, cx, cy, 212, 5, 246, 256, Hex(0xf87171), flash);
                DrawPill(layer, cx, oy + 34, 9, 9, Hex(0xf87171), flash);
            } else {
                const int bars = vis_.wifi == WifiState::Strong
                                     ? 3
                                     : (vis_.wifi == WifiState::Medium ? 2 : 1);
                const lv_color_t active_col =
                    vis_.wifi == WifiState::Weak ? Hex(0xfbbf24) : Hex(0x38bdf8);
                for (int i = 0; i < 3; ++i) {
                    const int32_t a0 = 226 + i * 11;
                    const bool on = i < bars;
                    DrawArc(layer, cx, cy, 212, 5, a0, a0 + 7,
                            on ? active_col : Hex(0x475569), on ? net_opa : net_opa / 3);
                }
            }
        }

        // Top-right battery arc (284..316 deg)
        const bool bat_abnormal = vis_.charging || vis_.battery_pct <= 20;
        const uint8_t bat_opa = bat_abnormal ? 255 : vis_.hud_opa;
        if (bat_opa > 6) {
            DrawArc(layer, cx, cy, 212, 6, 284, 316, Hex(0x475569), bat_opa / 3);
            lv_color_t bat_col = Hex(0xe2e8f0);
            uint8_t fill_opa = bat_opa;
            if (vis_.charging) {
                bat_col = Hex(0x4ade80);
            } else if (vis_.battery_pct <= 20) {
                bat_col = Hex(0xf87171);
                fill_opa = static_cast<uint8_t>(
                    (0.5f + 0.5f * std::fabs(std::sin(t * 3.0f))) * bat_opa);
            } else if (vis_.battery_pct > 50) {
                bat_col = Hex(0x34d399);
            }
            const int32_t span = std::max<int32_t>(3, (32 * vis_.battery_pct) / 100);
            DrawArc(layer, cx, cy, 212, 6, 284, 284 + span, bat_col, fill_opa);
        }

        // 12 o'clock mute icon or listening dot
        if (vis_.muted) {
            const int32_t mx = cx, my = oy + 35;
            DrawPill(layer, mx, my - 1, 8, 12, Hex(0xf87171), 235);
            lv_draw_line_dsc_t slash;
            lv_draw_line_dsc_init(&slash);
            slash.color = Hex(0xf87171);
            slash.opa = 255;
            slash.width = 2;
            slash.round_start = slash.round_end = 1;
            slash.p1 = {static_cast<lv_value_precise_t>(mx - 8),
                        static_cast<lv_value_precise_t>(my + 7)};
            slash.p2 = {static_cast<lv_value_precise_t>(mx + 8),
                        static_cast<lv_value_precise_t>(my - 8)};
            lv_draw_line(layer, &slash);
        } else if (vis_.dev_state == kDeviceStateListening) {
            const int32_t d = 7 + static_cast<int32_t>(2 * std::sin(t * 5.0f));
            DrawPill(layer, cx, oy + 35, d, d, Hex(0x38bdf8), 240);
        }
    }

    void DrawBottomCharging(lv_layer_t* layer, int32_t ox, int32_t oy) const {
        if (!vis_.charging || vis_.show_system_text)
            return;
        const int32_t cx = ox + CenterX(), cy = oy + CenterY();
        const float t = vis_.anim_tick * 0.06f;
        const uint8_t base_opa = (lv_tick_get() - charging_since_ > 8000) ? 110 : 220;
        DrawArc(layer, cx, cy, 212, 4, 66, 114, Hex(0x4ade80), base_opa / 4);
        const int32_t span = std::max<int32_t>(4, (48 * vis_.battery_pct) / 100);
        DrawArc(layer, cx, cy, 212, 4, 114 - span, 114, Hex(0x4ade80), base_opa);
        const float flow = std::fmod(t * 0.9f, 1.0f);
        DrawPill(layer, cx, oy + 446 - static_cast<int32_t>(flow * 16), 6, 6, Hex(0x4ade80),
                 static_cast<uint8_t>((1.0f - flow) * base_opa));
    }

    void DrawBlushAndMouth(lv_layer_t* layer, int32_t ox, int32_t oy) const {
        if (vis_.show_system_text)
            return;
        const int32_t cx = ox + CenterX();

        if (vis_.blush_opa > 6) {
            DrawPill(layer, cx - 124, oy + 292, 38, 18, Hex(0xf472b6), vis_.blush_opa);
            DrawPill(layer, cx + 124, oy + 292, 38, 18, Hex(0xf472b6), vis_.blush_opa);
        }

        const int32_t my = oy + 360;
        const float t = vis_.mouth_tick * 0.02f;
        if (vis_.dev_state == kDeviceStateListening) {
            const bool active_mic = (vis_.mouth_amp > 0.025f);
            const float drive = active_mic ? std::min(1.0f, 0.2f + 0.95f * vis_.mouth_amp) : 0.0f;
            for (int i = 0; i < 7; ++i) {
                const float env = 1.0f - std::abs(i - 3) * 0.2f;
                const float osc =
                    active_mic ? std::fabs(std::sin(t * 7.5f + i * 1.1f) * std::cos(t * 3.1f + i))
                               : 0.0f;
                const int32_t h =
                    active_mic ? std::max<int32_t>(6, std::lround((7 + 28 * drive * osc) * env)) : 6;
                DrawPill(layer, cx + (i - 3) * 14, my, 6, h, Hex(0x38bdf8),
                         active_mic ? 240 : 175);
            }
        } else if ((vis_.dev_state == kDeviceStateSpeaking ||
                    vis_.dev_state == kDeviceStateNotifying) &&
                   vis_.turn_audio_started) {
            if (vis_.mood == eyes::Mood::Surprised) {
                const int32_t r =
                    11 + static_cast<int32_t>(6 * (vis_.voice_playing ? vis_.mouth_amp : 0.0f));
                DrawArc(layer, cx, my, static_cast<uint16_t>(r), 5, 0, 360, Hex(0x34d399), 240);
            } else {
                const lv_color_t col = vis_.mood == eyes::Mood::Angry
                                           ? Hex(0xfb923c)
                                           : (vis_.mood == eyes::Mood::Happy ? Hex(0xf472b6)
                                                                              : Hex(0x34d399));
                const float drive =
                    vis_.voice_playing ? std::min(1.0f, 0.22f + 0.95f * vis_.mouth_amp) : 0.0f;
                for (int i = 0; i < 9; ++i) {
                    const float bias = 1.0f - std::abs(i - 4) * 0.16f;
                    const float osc =
                        vis_.voice_playing ? std::fabs(std::sin(t * 10.0f + i * 0.9f)) : 0.0f;
                    const int32_t h =
                        vis_.voice_playing
                            ? std::max<int32_t>(6, std::lround((8 + 30 * drive * osc) * bias))
                            : 6;
                    const int32_t dy =
                        vis_.mood == eyes::Mood::Happy ? -std::abs(i - 4) * 2 : 0;
                    DrawPill(layer, cx + (i - 4) * 13, my + dy, 6, h, col,
                             vis_.voice_playing ? 245 : 170);
                }
            }
        } else if (vis_.dev_state == kDeviceStateConnecting ||
                   ((vis_.dev_state == kDeviceStateSpeaking ||
                     vis_.dev_state == kDeviceStateNotifying) &&
                    !vis_.turn_audio_started)) {
            for (int i = -1; i <= 1; ++i) {
                const float s = std::max(0.0f, std::sin(t * 4.2f - i * 0.6f));
                const int32_t dy = -static_cast<int32_t>(s * 8.0f);
                const uint8_t opa = static_cast<uint8_t>(90 + 165 * s);
                DrawPill(layer, cx + i * 18, my + dy, 9, 9, Hex(0xa78bfa), opa);
            }
        } else if (vis_.mood == eyes::Mood::Happy || vis_.mood == eyes::Mood::Excited) {
            DrawArc(layer, cx, my - 6, 16, 4, 35, 145, Hex(0xf472b6), 215);
        }
    }

    void DrawQuickRing(lv_layer_t* layer, int32_t ox, int32_t oy) const {
        if (vis_.quick_ring_opa < 8)
            return;
        const uint8_t opa = vis_.quick_ring_opa;
        const int32_t cx = ox + CenterX(), cy = oy + CenterY();

        lv_draw_rect_dsc_t dim;
        lv_draw_rect_dsc_init(&dim);
        dim.bg_color = lv_color_black();
        dim.bg_opa = static_cast<lv_opa_t>((opa * 200) / 255);
        const lv_area_t full = {ox, oy, ox + screen_.width - 1, oy + screen_.width - 1};
        lv_draw_rect(layer, &dim, &full);

        struct RingItem {
            int32_t dx, dy;
            lv_color_t color;
            int kind;  // 0=vol+, 1=sleep, 2=bright, 3=mic
        };
        const RingItem items[4] = {
            {0, -124, Hex(0x38bdf8), 0},
            {124, 0, Hex(0x94a3b8), 1},
            {0, 124, Hex(0xfacc15), 2},
            {-124, 0, vis_.muted ? Hex(0xf87171) : Hex(0xe2e8f0), 3},
        };
        for (const auto& it : items) {
            const int32_t ix = cx + it.dx, iy = cy + it.dy;
            DrawPill(layer, ix, iy, 68, 68, Hex(0x1e293b), opa);
            DrawArc(layer, ix, iy, 34, 3, 0, 360, it.color, opa);
            if (it.kind == 0) {
                DrawPill(layer, ix, iy, 20, 4, it.color, opa);
                DrawPill(layer, ix, iy, 4, 20, it.color, opa);
            } else if (it.kind == 1) {
                DrawArc(layer, ix, iy, 11, 3, 320, 195, it.color, opa);
            } else if (it.kind == 2) {
                DrawArc(layer, ix, iy, 10, 3, 0, 360, it.color, opa);
            } else {
                DrawPill(layer, ix, iy - 2, 10, 16, it.color, opa);
                if (vis_.muted) {
                    lv_draw_line_dsc_t s;
                    lv_draw_line_dsc_init(&s);
                    s.color = it.color;
                    s.opa = opa;
                    s.width = 3;
                    s.round_start = s.round_end = 1;
                    s.p1 = {static_cast<lv_value_precise_t>(ix - 11),
                            static_cast<lv_value_precise_t>(iy + 11)};
                    s.p2 = {static_cast<lv_value_precise_t>(ix + 11),
                            static_cast<lv_value_precise_t>(iy - 11)};
                    lv_draw_line(layer, &s);
                }
            }
        }
        // Center X close button
        lv_draw_line_dsc_t xline;
        lv_draw_line_dsc_init(&xline);
        xline.color = Hex(0x64748b);
        xline.opa = opa;
        xline.width = 3;
        xline.round_start = xline.round_end = 1;
        xline.p1 = {static_cast<lv_value_precise_t>(cx - 9), static_cast<lv_value_precise_t>(cy - 9)};
        xline.p2 = {static_cast<lv_value_precise_t>(cx + 9), static_cast<lv_value_precise_t>(cy + 9)};
        lv_draw_line(layer, &xline);
        xline.p1 = {static_cast<lv_value_precise_t>(cx + 9), static_cast<lv_value_precise_t>(cy - 9)};
        xline.p2 = {static_cast<lv_value_precise_t>(cx - 9), static_cast<lv_value_precise_t>(cy + 9)};
        lv_draw_line(layer, &xline);
    }

    void Draw(lv_layer_t* layer) {
        const int64_t start = esp_timer_get_time();
        lv_area_t origin;
        lv_obj_get_coords(canvas_, &origin);
        const int32_t ox = origin.x1, oy = origin.y1;

        if (vis_.persona == Persona::Crystal && crystal_buf_) {
            lv_draw_image_dsc_t img_dsc;
            lv_draw_image_dsc_init(&img_dsc);
            img_dsc.src = &crystal_img_dsc_;
            const int32_t y_shift = vis_.show_system_text ? -56 : 0;
            const lv_area_t area = {
                ox, oy + y_shift,
                ox + podone::crystal_assets::kWidth - 1,
                oy + y_shift + podone::crystal_assets::kHeight - 1};
            lv_draw_image(layer, &img_dsc, &area);
            DrawOuterHalo(layer, ox, oy);
        } else {
            DrawOuterHalo(layer, ox, oy);
            for (const auto& g : geom_) {
                if (ClipIntersects(layer, g.box, ox, oy))
                    DrawEye(layer, g, ox, oy);
            }
            DrawBlushAndMouth(layer, ox, oy);
        }
        DrawTopTelemetry(layer, ox, oy);
        DrawBottomCharging(layer, ox, oy);
        DrawPersonaIndicator(layer, ox, oy);
        DrawQuickRing(layer, ox, oy);

        const int64_t spent = esp_timer_get_time() - start;
        draw_us_ += spent;
        max_draw_us_ = std::max(max_draw_us_, spent);
        ++draws_;
    }

    void InvalidateArea(const lv_area_t& local_box) {
        if (local_box.x2 < local_box.x1)
            return;
        lv_area_t origin;
        lv_obj_get_coords(canvas_, &origin);
        lv_area_t u = local_box;
        lv_area_move(&u, origin.x1, origin.y1);
        lv_obj_invalidate_area(canvas_, &u);
    }

    void Invalidate(const lv_area_t& a, const lv_area_t& b) {
        lv_area_t u = a;
        if (b.x2 >= b.x1) {
            if (u.x2 < u.x1)
                u = b;
            else
                u = {std::min(a.x1, b.x1), std::min(a.y1, b.y1), std::max(a.x2, b.x2),
                     std::max(a.y2, b.y2)};
        }
        InvalidateArea(u);
    }

    // Invalidate only the 4 perimeter bands of the circular outer halo to avoid
    // redrawing the central eye region at high frequency.
    void InvalidateOuterHaloBands() {
        const int32_t w = screen_.width;
        InvalidateArea({0, 0, w - 1, 78});
        InvalidateArea({0, w - 79, w - 1, w - 1});
        InvalidateArea({0, 79, 82, w - 80});
        InvalidateArea({w - 83, 79, w - 1, w - 80});
    }

    void LogStats(uint32_t now) {
        if (now - last_stat_ < 30000)
            return;
        const float secs = (now - last_stat_) / 1000.0f;
        ESP_LOGI(kTag,
                 "fps %.1f (logic %.1f), max gap %lums, draw avg %lldus max %lldus, "
                 "internal heap %u (min %u)",
                 refreshes_ / secs, renders_ / secs, static_cast<unsigned long>(max_gap_ms_),
                 draws_ ? draw_us_ / draws_ : 0, max_draw_us_,
                 static_cast<unsigned>(heap_caps_get_free_size(MALLOC_CAP_INTERNAL)),
                 static_cast<unsigned>(heap_caps_get_minimum_free_size(MALLOC_CAP_INTERNAL)));
        last_stat_ = now;
        refreshes_ = renders_ = max_gap_ms_ = draws_ = 0;
        draw_us_ = max_draw_us_ = 0;
    }

    void Render() {
        if (!canvas_)
            return;
        const uint32_t now = lv_tick_get();
        const uint32_t gap = now - last_tick_;
        const float dt = std::min<uint32_t>(gap, 100);
        last_tick_ = now;
        ++renders_;
        max_gap_ms_ = std::max(max_gap_ms_, gap);

        PollTouch(now);
        if (sleep_mode_.load(std::memory_order_relaxed)) return;

        // Smooth audio envelopes (fast attack, smooth decay) with staleness guard
        const float raw_in = in_level_.load(std::memory_order_relaxed);
        const bool out_fresh =
            (esp_timer_get_time() - last_out_active_us_.load(std::memory_order_relaxed)) <= 70000;
        const float raw_out = out_fresh ? out_level_.load(std::memory_order_relaxed) : 0.0f;
        smooth_in_ += (raw_in - smooth_in_) * (raw_in > smooth_in_ ? 0.55f : 0.22f);
        smooth_out_ += (raw_out - smooth_out_) * (raw_out > smooth_out_ ? 0.55f : 0.32f);
        if (!out_fresh && smooth_out_ < 0.02f)
            smooth_out_ = 0.0f;

        const auto dev_state = Application::GetInstance().GetDeviceState();
        const bool in_speak_state =
            (dev_state == kDeviceStateSpeaking || dev_state == kDeviceStateNotifying);
        if (!in_speak_state) {
            turn_audio_started_ = false;
        } else if (smooth_out_ > 0.022f) {
            turn_audio_started_ = true;
        }
        const bool voice_playing = in_speak_state && (smooth_out_ > 0.02f);

        auto mood = CurrentMood(now);
        if (in_speak_state && !turn_audio_started_ && !has_llm_mood_) {
            mood = eyes::Mood::Thinking;
        } else if (in_speak_state && turn_audio_started_ && !voice_playing &&
                   mood == eyes::Mood::Speaking) {
            mood = eyes::Mood::Idle;
        }

        const auto& spec = Spec(layout_);
        UpdateGaze(now, dt, mood, spec.box_y + spec.center_y);
        const float blink = BlinkFactor(now, mood);

        const auto target = eyes::FaceFor(mood, now / 1000.0f);
        const float k = eyes::Ease(dt, mood == eyes::Mood::Dizzy ? 16 : 11);
        face_.left = eyes::Mix(face_.left, target.left, k);
        face_.right = eyes::Mix(face_.right, target.right, k);

        // Smooth HUD, blush, and quick-ring opacities
        const bool peeking = static_cast<int32_t>(hud_peek_until_ - now) > 0 || quick_ring_open_;
        hud_alpha_ += ((peeking ? 1.0f : 0.0f) - hud_alpha_) * eyes::Ease(dt, 14);
        const bool show_blush =
            mood == eyes::Mood::Happy || mood == eyes::Mood::Excited || charging_;
        blush_alpha_ += ((show_blush ? 1.0f : 0.0f) - blush_alpha_) * eyes::Ease(dt, 10);
        quick_ring_anim_ += ((quick_ring_open_ ? 1.0f : 0.0f) - quick_ring_anim_) * eyes::Ease(dt, 18);

        const float half = eyes::kHomeX * spec.scale;
        const bool dimmed = sleep_mode_.load(std::memory_order_relaxed);

        if (persona_ == Persona::Crystal && crystal_buf_) {
            UpdateCrystalBuffer(now, dev_state, voice_playing, dimmed);
        } else {
            const float blink_l =
                (wink_side_ == 0 && static_cast<int32_t>(wink_until_ - now) > 0) ? 0.08f : blink;
            const float blink_r =
                (wink_side_ == 1 && static_cast<int32_t>(wink_until_ - now) > 0) ? 0.08f : blink;
            const EyeGeom next[2] = {
                ComputeEye(face_.left, CenterX() - half, spec.center_y, spec.scale, blink_l, now, 0,
                           dimmed),
                ComputeEye(face_.right, CenterX() + half, spec.center_y, spec.scale, blink_r, now,
                           1, dimmed)};
            for (int i = 0; i < 2; ++i) {
                if (!(next[i] == geom_[i])) {
                    Invalidate(geom_[i].box, next[i].box);
                    geom_[i] = next[i];
                }
            }
        }

        // Update visual state and invalidate only affected regions
        vis_.persona = persona_;
        vis_.dev_state = dev_state;
        vis_.mood = mood;
        vis_.wifi = wifi_state_;
        vis_.battery_pct = battery_pct_;
        vis_.charging = charging_;
        vis_.muted = muted_state_;
        vis_.sleeping = dimmed;
        vis_.show_system_text = (layout_ == Layout::Small);
        vis_.indicator_on = (static_cast<int32_t>(persona_indicator_until_ - now) > 0);
        vis_.turn_audio_started = turn_audio_started_;
        vis_.voice_playing = voice_playing;
        vis_.hud_opa = static_cast<uint8_t>(std::lround(hud_alpha_ * 255.0f));
        vis_.blush_opa = static_cast<uint8_t>(std::lround(blush_alpha_ * 72.0f));
        vis_.mouth_amp = (dev_state == kDeviceStateListening) ? smooth_in_ : smooth_out_;
        vis_.anim_tick = now / 60;
        vis_.mouth_tick = now / 20;
        vis_.quick_ring_opa = static_cast<uint8_t>(std::lround(quick_ring_anim_ * 255.0f));

        if (vis_.persona != prev_vis_.persona) {
            InvalidateArea({0, 0, screen_.width - 1, screen_.width - 1});
        }
        if (vis_.indicator_on != prev_vis_.indicator_on) {
            InvalidateArea({CenterX() - 24, 426, CenterX() + 24, 444});
        }

        // 1. Quick ring full-overlay invalidation only while visible/animating
        if (vis_.quick_ring_opa != prev_vis_.quick_ring_opa ||
            (vis_.quick_ring_opa > 0 && vis_.muted != prev_vis_.muted)) {
            InvalidateArea({0, 0, screen_.width - 1, screen_.width - 1});
        }

        if (vis_.persona == Persona::Classic) {
            // 2. Blush patches
            if (vis_.blush_opa != prev_vis_.blush_opa) {
                InvalidateArea({CenterX() - 150, 276, CenterX() - 98, 308});
                InvalidateArea({CenterX() + 98, 276, CenterX() + 150, 308});
            }

            // 3. Voice mouth region (50Hz only while active)
            const bool mouth_active =
                !vis_.show_system_text &&
                (dev_state == kDeviceStateListening || dev_state == kDeviceStateSpeaking ||
                 dev_state == kDeviceStateNotifying || dev_state == kDeviceStateConnecting ||
                 mood == eyes::Mood::Happy || mood == eyes::Mood::Excited);
            const lv_area_t mouth_box =
                mouth_active ? lv_area_t{CenterX() - 80, 330, CenterX() + 80, 392}
                             : lv_area_t{0, 0, -1, -1};
            const bool mouth_anim =
                dev_state == kDeviceStateListening || dev_state == kDeviceStateSpeaking ||
                dev_state == kDeviceStateNotifying || dev_state == kDeviceStateConnecting;
            if (mouth_anim || memcmp(&mouth_box, &prev_mouth_box_, sizeof(mouth_box)) != 0 ||
                vis_.mood != prev_vis_.mood) {
                Invalidate(prev_mouth_box_, mouth_box);
                prev_mouth_box_ = mouth_box;
            }
        }

        // 4. Outer halo + top/bottom telemetry (~16Hz when animated, 0 cost when Idle)
        const bool halo_active = !vis_.show_system_text &&
                                 (vis_.sleeping || HasOuterHalo(dev_state, vis_.wifi));
        const bool top_active =
            vis_.hud_opa > 6 || vis_.wifi != WifiState::Strong || vis_.charging ||
            vis_.battery_pct <= 20 || vis_.muted || dev_state == kDeviceStateListening;
        const bool halo_anim_bands = (vis_.persona == Persona::Classic) && halo_active &&
                                     (vis_.anim_tick != prev_vis_.anim_tick);
        const bool halo_changed =
            (vis_.dev_state != prev_vis_.dev_state) ||
            (vis_.turn_audio_started != prev_vis_.turn_audio_started) ||
            (vis_.sleeping != prev_vis_.sleeping) ||
            (vis_.show_system_text != prev_vis_.show_system_text) || halo_anim_bands;
        if (halo_changed) {
            InvalidateOuterHaloBands();
        } else {
            const lv_area_t top_box =
                top_active ? lv_area_t{80, 8, screen_.width - 81, 74} : lv_area_t{0, 0, -1, -1};
            if (vis_.hud_opa != prev_vis_.hud_opa || vis_.wifi != prev_vis_.wifi ||
                vis_.muted != prev_vis_.muted || vis_.charging != prev_vis_.charging ||
                vis_.battery_pct != prev_vis_.battery_pct ||
                ((vis_.wifi == WifiState::Connecting || vis_.wifi == WifiState::Offline ||
                  vis_.battery_pct <= 20) &&
                 vis_.anim_tick != prev_vis_.anim_tick) ||
                memcmp(&top_box, &prev_top_hud_box_, sizeof(top_box)) != 0) {
                Invalidate(prev_top_hud_box_, top_box);
                prev_top_hud_box_ = top_box;
            }
            const lv_area_t bot_box =
                (vis_.charging && !vis_.show_system_text)
                    ? lv_area_t{120, screen_.width - 56, screen_.width - 121, screen_.width - 8}
                    : lv_area_t{0, 0, -1, -1};
            if ((vis_.charging && !vis_.show_system_text && vis_.anim_tick != prev_vis_.anim_tick) ||
                memcmp(&bot_box, &prev_bot_hud_box_, sizeof(bot_box)) != 0) {
                Invalidate(prev_bot_hud_box_, bot_box);
                prev_bot_hud_box_ = bot_box;
            }
        }

        prev_vis_ = vis_;
        LogStats(now);
    }
};

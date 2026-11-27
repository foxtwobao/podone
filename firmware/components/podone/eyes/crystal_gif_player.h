#pragma once
// High-speed PSRAM-cached GIF89a player for Podone round AMOLED UI.
// Decodes a standard GIF89a stream once on Open() into a PSRAM Frame-0 RGB565 buffer
// plus compact pre-decoded RGB565 delta spans in PSRAM.
// Runtime frame playback in Step() does ZERO Flash reads and ZERO LZW decoding (~0.2ms/frame).

#include <esp_heap_caps.h>
#include <esp_log.h>
#include <lvgl.h>

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <cstring>

namespace podone {

class CrystalGifPlayer {
public:
    static constexpr int kMaxFrames = 16;
    static constexpr size_t kDeltaPoolWords = 120 * 1024;  // 240 KB per player in 2.5MB LVGL pool

    CrystalGifPlayer() = default;
    ~CrystalGifPlayer() {
        if (frame0_buf_)
            lv_free(frame0_buf_);
        if (delta_pool_)
            lv_free(delta_pool_);
    }

    bool Init(int width = 466, int height = 466) {
        width_ = width;
        height_ = height;
        if (!frame0_buf_) {
            frame0_buf_ = static_cast<uint16_t*>(
                lv_malloc(static_cast<size_t>(width) * height * sizeof(uint16_t)));
        }
        if (!delta_pool_) {
            delta_pool_ = static_cast<uint16_t*>(lv_malloc(kDeltaPoolWords * sizeof(uint16_t)));
        }
        return frame0_buf_ != nullptr && delta_pool_ != nullptr;
    }

    bool Open(const uint8_t* gif_data, size_t gif_size, uint16_t* canvas_rgb565, bool dimmed,
              uint32_t now) {
        if (!gif_data || gif_size < 14 || !canvas_rgb565)
            return false;
        if (std::memcmp(gif_data, "GIF89a", 6) != 0 && std::memcmp(gif_data, "GIF87a", 6) != 0)
            return false;

        const uint16_t w = ReadU16At(gif_data, 6);
        const uint16_t h = ReadU16At(gif_data, 8);
        if (!Init(w, h))
            return false;

        // Only re-decode from Flash if GIF source or dim state changed
        if (data_ != gif_data || dimmed_ != dimmed || frame_count_ == 0) {
            if (!PredecodeGifToPsram(gif_data, gif_size, dimmed))
                return false;
            data_ = gif_data;
            size_ = gif_size;
            dimmed_ = dimmed;
        }

        canvas_ = canvas_rgb565;
        std::memcpy(canvas_, frame0_buf_, static_cast<size_t>(width_) * height_ * sizeof(uint16_t));
        cur_frame_ = 0;
        last_tick_ = now;
        return true;
    }

    // Plays next pre-decoded frame in ~0.2ms from PSRAM without touching Flash.
    bool Step(uint32_t now, lv_area_t* dirty_box) {
        if (!canvas_ || frame_count_ <= 1)
            return false;
        const uint32_t delay = frames_[cur_frame_].delay_ms;
        if (static_cast<int32_t>(now - last_tick_) < static_cast<int32_t>(delay))
            return false;
        last_tick_ = now;

        cur_frame_ = (cur_frame_ + 1) % frame_count_;
        if (cur_frame_ == 0) {
            std::memcpy(canvas_, frame0_buf_,
                        static_cast<size_t>(width_) * height_ * sizeof(uint16_t));
            if (dirty_box)
                *dirty_box = loop_dirty_box_;
            return true;
        }

        const FrameMeta& fm = frames_[cur_frame_];
        const uint16_t* ptr = delta_pool_ + fm.pool_offset;
        const uint16_t* end = ptr + fm.pool_words;
        while (ptr + 3 <= end) {
            const uint32_t dst_off =
                static_cast<uint32_t>(ptr[0]) | (static_cast<uint32_t>(ptr[1]) << 16);
            const uint16_t run_len = ptr[2];
            ptr += 3;
            if (ptr + run_len > end)
                break;
            std::memcpy(&canvas_[dst_off], ptr, run_len * sizeof(uint16_t));
            ptr += run_len;
        }
        if (dirty_box)
            *dirty_box = fm.dirty;
        return true;
    }

    // Snaps back to Frame 0 (golden eyes lit, lips closed) when audio output pauses.
    bool ResetToFrame0(uint32_t now, lv_area_t* dirty_box) {
        last_tick_ = now;
        if (!canvas_ || !frame0_buf_ || cur_frame_ == 0)
            return false;
        std::memcpy(canvas_, frame0_buf_,
                    static_cast<size_t>(width_) * height_ * sizeof(uint16_t));
        cur_frame_ = 0;
        if (dirty_box)
            *dirty_box = loop_dirty_box_;
        return true;
    }

    const uint8_t* current_data() const { return data_; }
    bool is_dimmed() const { return dimmed_; }

private:
    struct FrameMeta {
        uint32_t delay_ms = 80;
        size_t pool_offset = 0;
        size_t pool_words = 0;
        lv_area_t dirty{0, 0, -1, -1};
    };

    const uint8_t* data_ = nullptr;
    size_t size_ = 0;
    uint16_t* canvas_ = nullptr;
    uint16_t* frame0_buf_ = nullptr;
    uint16_t* delta_pool_ = nullptr;
    uint16_t width_ = 466, height_ = 466;
    bool dimmed_ = false;
    int frame_count_ = 0;
    int cur_frame_ = 0;
    uint32_t last_tick_ = 0;
    FrameMeta frames_[kMaxFrames]{};
    lv_area_t loop_dirty_box_{0, 0, -1, -1};

    static uint16_t ReadU16At(const uint8_t* p, size_t offset) {
        return static_cast<uint16_t>(p[offset]) | (static_cast<uint16_t>(p[offset + 1]) << 8);
    }

    bool PredecodeGifToPsram(const uint8_t* gif, size_t gif_size, bool dimmed) {
        const uint8_t fdsz = gif[10];
        if (!(fdsz & 0x80))
            return false;
        const int gct_sz = 1 << ((fdsz & 0x07) + 1);
        size_t pos = 13;
        if (pos + static_cast<size_t>(gct_sz * 3) > gif_size)
            return false;

        uint16_t pal16[256]{};
        for (int i = 0; i < gct_sz; ++i) {
            uint8_t r = gif[pos++];
            uint8_t g = gif[pos++];
            uint8_t b = gif[pos++];
            if (dimmed) {
                r >>= 1;
                g >>= 1;
                b >>= 1;
            }
            pal16[i] = lv_color_to_u16(lv_color_make(r, g, b));
        }

        // Allocate temporary 16KB LZW dictionary in internal SRAM for fast one-time decode
        uint8_t* lzw_ram = static_cast<uint8_t*>(
            heap_caps_malloc(4096 * 4, MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT));
        if (!lzw_ram) {
            lzw_ram = static_cast<uint8_t*>(
                heap_caps_malloc(4096 * 4, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
        }
        if (!lzw_ram)
            return false;

        uint8_t* stack = lzw_ram;
        uint8_t* suffix = lzw_ram + 4096;
        uint16_t* prefix = reinterpret_cast<uint16_t*>(lzw_ram + 8192);

        auto read_u8 = [&]() -> uint8_t { return pos < gif_size ? gif[pos++] : 0; };
        auto read_u16 = [&]() -> uint16_t {
            const uint8_t lo = read_u8();
            const uint8_t hi = read_u8();
            return static_cast<uint16_t>(lo) | (static_cast<uint16_t>(hi) << 8);
        };
        auto skip_sub_blocks = [&]() {
            while (pos < gif_size) {
                const uint8_t len = read_u8();
                if (len == 0)
                    break;
                pos = std::min(gif_size, pos + len);
            }
        };

        frame_count_ = 0;
        size_t pool_used = 0;
        bool transparent = false;
        uint8_t tindex = 0xFF;
        uint32_t delay_ms = 80;
        loop_dirty_box_ = {width_, height_, -1, -1};

        while (pos < gif_size && frame_count_ < kMaxFrames) {
            const uint8_t sep = read_u8();
            if (sep == 0x21) {
                const uint8_t label = read_u8();
                if (label == 0xF9) {
                    read_u8();
                    const uint8_t rdit = read_u8();
                    transparent = (rdit & 0x01) != 0;
                    const uint16_t d_cs = read_u16();
                    delay_ms = std::max<uint32_t>(50, static_cast<uint32_t>(d_cs) * 10);
                    tindex = read_u8();
                    read_u8();
                } else {
                    skip_sub_blocks();
                }
            } else if (sep == 0x2C) {
                const uint16_t fx = read_u16();
                const uint16_t fy = read_u16();
                const uint16_t fw = read_u16();
                const uint16_t fh = read_u16();
                const uint8_t fisrz = read_u8();
                if (fisrz & 0x80) {
                    const size_t lct_bytes = 3 * (1 << ((fisrz & 0x07) + 1));
                    pos = std::min(gif_size, pos + lct_bytes);
                }
                if (fx + fw > width_ || fy + fh > height_ || pos >= gif_size)
                    break;

                const int min_code_size = read_u8();
                if (min_code_size < 2 || min_code_size > 8) {
                    skip_sub_blocks();
                    break;
                }

                const int clear_code = 1 << min_code_size;
                const int stop_code = clear_code + 1;
                const int new_codes = clear_code + 2;
                int code_size = min_code_size + 1;
                int top_slot = 1 << code_size;
                int slot = new_codes;
                int first_val = -1, last_key = -1;
                uint8_t* sp = stack;

                uint32_t bit_buf = 0;
                int bit_cnt = 0;
                uint8_t sub_len = 0;

                auto get_key = [&]() -> int {
                    while (bit_cnt < code_size) {
                        if (sub_len == 0) {
                            sub_len = read_u8();
                            if (sub_len == 0)
                                return 0x1000;
                        }
                        bit_buf |= static_cast<uint32_t>(read_u8()) << bit_cnt;
                        bit_cnt += 8;
                        --sub_len;
                    }
                    const int key = static_cast<int>(bit_buf) & ((1 << code_size) - 1);
                    bit_buf >>= code_size;
                    bit_cnt -= code_size;
                    return key;
                };

                FrameMeta& fm = frames_[frame_count_];
                fm.delay_ms = delay_ms;
                fm.pool_offset = pool_used;
                fm.dirty = {static_cast<int32_t>(fx), static_cast<int32_t>(fy),
                            static_cast<int32_t>(fx + fw - 1), static_cast<int32_t>(fy + fh - 1)};

                if (frame_count_ > 0) {
                    loop_dirty_box_.x1 = std::min(loop_dirty_box_.x1, fm.dirty.x1);
                    loop_dirty_box_.y1 = std::min(loop_dirty_box_.y1, fm.dirty.y1);
                    loop_dirty_box_.x2 = std::max(loop_dirty_box_.x2, fm.dirty.x2);
                    loop_dirty_box_.y2 = std::max(loop_dirty_box_.y2, fm.dirty.y2);
                }

                uint16_t rx = 0, ry = 0;
                uint32_t row_off = static_cast<uint32_t>(fy) * width_ + fx;
                int32_t run_header_idx = -1;
                uint16_t run_len = 0;

                const int total_pixels = static_cast<int>(fw) * static_cast<int>(fh);
                int out_idx = 0;
                while (out_idx < total_pixels) {
                    while (sp > stack && out_idx < total_pixels) {
                        const uint8_t px_idx = *(--sp);
                        const uint32_t abs_off = row_off + rx;
                        if (frame_count_ == 0) {
                            frame0_buf_[abs_off] = pal16[px_idx];
                        } else if (!transparent || px_idx != tindex) {
                            const uint16_t col = pal16[px_idx];
                            if (run_header_idx >= 0 && run_len < 4096 && rx > 0) {
                                delta_pool_[pool_used++] = col;
                                ++run_len;
                                delta_pool_[run_header_idx + 2] = run_len;
                            } else if (pool_used + 4 < kDeltaPoolWords) {
                                run_header_idx = static_cast<int32_t>(pool_used);
                                delta_pool_[pool_used++] = static_cast<uint16_t>(abs_off & 0xFFFF);
                                delta_pool_[pool_used++] = static_cast<uint16_t>(abs_off >> 16);
                                delta_pool_[pool_used++] = 1;
                                delta_pool_[pool_used++] = col;
                                run_len = 1;
                            }
                        } else {
                            run_header_idx = -1;
                        }
                        ++out_idx;
                        if (++rx == fw) {
                            rx = 0;
                            ++ry;
                            row_off += width_;
                            run_header_idx = -1;
                        }
                    }
                    if (out_idx >= total_pixels)
                        break;

                    const int key = get_key();
                    if (key == stop_code || key >= 4096)
                        break;
                    if (key == clear_code) {
                        code_size = min_code_size + 1;
                        slot = new_codes;
                        top_slot = 1 << code_size;
                        first_val = last_key = -1;
                        sp = stack;
                        continue;
                    }
                    int code = key;
                    if (code == slot && first_val >= 0) {
                        *sp++ = static_cast<uint8_t>(first_val);
                        code = last_key;
                    } else if (code >= slot) {
                        break;
                    }
                    while (code >= new_codes) {
                        *sp++ = suffix[code];
                        code = prefix[code];
                    }
                    *sp++ = static_cast<uint8_t>(code);
                    if (slot < top_slot && last_key >= 0) {
                        suffix[slot] = static_cast<uint8_t>(code);
                        prefix[slot++] = static_cast<uint16_t>(last_key);
                    }
                    first_val = code;
                    last_key = key;
                    if (slot >= top_slot && code_size < 12) {
                        top_slot <<= 1;
                        ++code_size;
                    }
                }
                if (sub_len > 0)
                    pos = std::min(gif_size, pos + sub_len);
                skip_sub_blocks();
                fm.pool_words = pool_used - fm.pool_offset;
                ++frame_count_;
            } else if (sep == 0x3B) {
                break;
            } else {
                break;
            }
        }

        if (loop_dirty_box_.x2 < loop_dirty_box_.x1)
            loop_dirty_box_ = {0, 0, width_ - 1, height_ - 1};

        heap_caps_free(lzw_ram);
        ESP_LOGI("CrystalGIF", "Predecoded %d GIF frames (%u words in PSRAM)", frame_count_,
                 static_cast<unsigned>(pool_used));
        return frame_count_ > 0;
    }
};

}  // namespace podone

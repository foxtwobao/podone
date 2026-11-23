#!/usr/bin/env bash
# 构建一个板型的 Podone 固件。
#
#   firmware/scripts/build.sh waveshare-1.75c          # 构建
#   firmware/scripts/build.sh waveshare-1.75c flash    # 构建并烧录，PORT 默认 /dev/cu.usbmodem21101
#   firmware/scripts/build.sh --profile prod waveshare-1.75c
#
# --profile 选 sdkconfig 片段：lab 用板型目录的 sdkconfig.defaults（默认），
# prod 再叠加 sdkconfig.defaults.prod。
#
# 上游小智固件按 firmware/UPSTREAM.json 的提交拉到 firmware/.upstream/xiaozhi-esp32（不进仓），
# 再打上 firmware/patches/ 里的补丁。补丁只让 main/CMakeLists.txt 从环境变量读板型目录，
# 板级源码和 components/podone 都留在本仓库。
set -euo pipefail

profile=lab
if [[ "${1:-}" == "--profile" ]]; then
  profile="${2:?用法: build.sh --profile <lab|prod> <board-id> [flash]}"
  shift 2
fi
board="${1:?用法: build.sh [--profile lab|prod] <board-id> [flash]}"
action="${2:-build}"

fw_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
board_dir="$fw_dir/boards/$board"
upstream_dir="$fw_dir/.upstream/xiaozhi-esp32"
build_dir="$fw_dir/build/${board}-${profile}"

[[ -f "$board_dir/main/config.json" ]] || { echo "未找到板型 $board_dir/main/config.json" >&2; exit 1; }

repo=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["xiaozhi-esp32"]["repo"])' "$fw_dir/UPSTREAM.json")
commit=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["xiaozhi-esp32"]["commit"])' "$fw_dir/UPSTREAM.json")

if [[ ! -d "$upstream_dir/.git" ]]; then
  git clone "$repo" "$upstream_dir"
fi
if [[ "$(git -C "$upstream_dir" rev-parse HEAD)" != "$commit"* ]]; then
  git -C "$upstream_dir" fetch --quiet origin
  git -C "$upstream_dir" checkout --quiet "$commit"
fi
for patch in "$fw_dir"/patches/xiaozhi-esp32-*.patch; do
  if git -C "$upstream_dir" apply --check "$patch" 2>/dev/null; then
    git -C "$upstream_dir" apply "$patch"
  elif ! git -C "$upstream_dir" apply --reverse --check "$patch" 2>/dev/null; then
    echo "补丁 $(basename "$patch") 既不能应用也没有应用过，检查 $upstream_dir 的改动" >&2
    exit 1
  fi
done

if [[ -z "${IDF_PATH:-}" ]]; then
  # shellcheck disable=SC1091
  IDF_PATH_DIR="${IDF_PATH_DIR:-$HOME/esp/esp-idf-v6.0.3}" source "$fw_dir/scripts/env.sh"
fi

export PODONE_BOARD_DIR="$board_dir/main"
export PODONE_INCLUDE_DIRS="$fw_dir/components/podone/eyes;$fw_dir/components/podone/motion"

defaults="$upstream_dir/sdkconfig.defaults;$board_dir/sdkconfig.defaults"
defaults_files=("$upstream_dir/sdkconfig.defaults" "$board_dir/sdkconfig.defaults")
if [[ -f "$upstream_dir/sdkconfig.defaults.esp32s3" ]]; then
  defaults_files+=("$upstream_dir/sdkconfig.defaults.esp32s3")
fi
if [[ "$profile" != "lab" ]]; then
  extra="$board_dir/sdkconfig.defaults.$profile"
  [[ -f "$extra" ]] || { echo "未找到 $extra" >&2; exit 1; }
  defaults="$defaults;$extra"
  defaults_files+=("$extra")
fi

# ESP-IDF 在 sdkconfig 已存在时会忽略 SDKCONFIG_DEFAULTS；
# 只要任一 defaults 文件内容变化，就删掉旧 sdkconfig 强制重生成。
mkdir -p "$build_dir"
defaults_hash_file="$build_dir/.sdkconfig.defaults.sha256"
defaults_hash="$(python3 -c '
import hashlib, sys
h = hashlib.sha256()
for p in sys.argv[1:]:
    h.update(p.encode("utf-8"))
    h.update(b"\0")
    with open(p, "rb") as f:
        h.update(f.read())
    h.update(b"\0")
print(h.hexdigest())
' "${defaults_files[@]}")"
if [[ -f "$build_dir/sdkconfig" ]]; then
  if [[ ! -f "$defaults_hash_file" ]] || [[ "$(cat "$defaults_hash_file")" != "$defaults_hash" ]]; then
    echo "检测到 sdkconfig.defaults 变化，清理旧 sdkconfig 重新生成"
    rm -f "$build_dir/sdkconfig"
  fi
fi

echo "构建 ${board}，profile ${profile}（目录: ${build_dir}）"
cd "$upstream_dir"
idf.py -B "$build_dir" -D SDKCONFIG="$build_dir/sdkconfig" -D SDKCONFIG_DEFAULTS="$defaults" \
  -D IDF_TARGET=esp32s3 -D BOARD_NAME="$board" build
printf '%s\n' "$defaults_hash" > "$defaults_hash_file"

# 校验关键配置确实落盘到最终 sdkconfig，防止静默打错包
echo "生效配置摘要："
grep -E '^(CONFIG_OTA_URL|CONFIG_USE_CUSTOM_WAKE_WORD|CONFIG_USE_AFE_WAKE_WORD|CONFIG_CUSTOM_WAKE_WORD|CONFIG_CUSTOM_WAKE_WORD_DISPLAY|CONFIG_CUSTOM_WAKE_WORD_THRESHOLD|CONFIG_SR_MN_CN_MULTINET7_QUANT)=' "$build_dir/sdkconfig" || true
expected_ota="$(grep -E '^CONFIG_OTA_URL=' "${defaults_files[@]}" | tail -n 1 | cut -d: -f2- || true)"
actual_ota="$(grep -E '^CONFIG_OTA_URL=' "$build_dir/sdkconfig" | head -n 1 || true)"
if [[ -n "$expected_ota" && "$actual_ota" != "$expected_ota" ]]; then
  echo "配置校验失败：期望 ${expected_ota}，实际 ${actual_ota}" >&2
  exit 1
fi

if [[ "$action" == "flash" ]]; then
  idf.py -B "$build_dir" -p "${PORT:-/dev/cu.usbmodem21101}" -b 921600 flash
fi

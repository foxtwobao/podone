#!/usr/bin/env bash
# 构建一个板型的 Podone 固件。
#
#   firmware/scripts/build.sh waveshare-1.75c          # 构建
#   firmware/scripts/build.sh waveshare-1.75c flash    # 构建并烧录，PORT 默认 /dev/cu.usbmodem21101
#
# 上游小智固件按 firmware/UPSTREAM.json 的提交拉到 firmware/.upstream/xiaozhi-esp32（不进仓），
# 再打上 firmware/patches/ 里的补丁。补丁只让 main/CMakeLists.txt 从环境变量读板型目录，
# 板级源码和 components/podone 都留在本仓库。
set -euo pipefail

board="${1:?用法: build.sh <board-id> [flash]}"
action="${2:-build}"

fw_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
board_dir="$fw_dir/boards/$board"
upstream_dir="$fw_dir/.upstream/xiaozhi-esp32"
build_dir="$fw_dir/build/$board"

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
cd "$upstream_dir"
idf.py -B "$build_dir" -D SDKCONFIG="$build_dir/sdkconfig" -D SDKCONFIG_DEFAULTS="$defaults" \
  -D IDF_TARGET=esp32s3 -D BOARD_NAME="$board" build

if [[ "$action" == "flash" ]]; then
  idf.py -B "$build_dir" -p "${PORT:-/dev/cu.usbmodem21101}" -b 921600 flash
fi

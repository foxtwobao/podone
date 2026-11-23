#!/usr/bin/env bash
# 在 macOS 上安装 ESP-IDF（构建基线见 firmware/README.md）。可重复运行，已完成的步骤会跳过。
set -euo pipefail

IDF_VERSION="${IDF_VERSION:-v5.5.5}"
IDF_TARGET_CHIP="${IDF_TARGET_CHIP:-esp32s3}"
IDF_PATH_DIR="${IDF_PATH_DIR:-$HOME/esp/esp-idf}"
BREW_PKGS=(cmake ninja dfu-util ccache python@3.12)

log() { printf '==> %s\n' "$*"; }

# 1. Homebrew 依赖
if ! command -v brew >/dev/null 2>&1; then
  echo "未找到 Homebrew，请先安装 https://brew.sh" >&2
  exit 1
fi
missing=()
for p in "${BREW_PKGS[@]}"; do
  brew list --formula "$p" >/dev/null 2>&1 || missing+=("$p")
done
if ((${#missing[@]})); then
  log "brew install ${missing[*]}"
  brew install "${missing[@]}"
else
  log "brew 依赖已安装，跳过"
fi

# install.sh 会用 python3 建虚拟环境，优先使用 python@3.12
PY312_BIN="$(brew --prefix python@3.12)/libexec/bin"
export PATH="$PY312_BIN:$PATH"

# 2. 克隆 ESP-IDF
if [[ -f "$IDF_PATH_DIR/export.sh" ]]; then
  current="$(git -C "$IDF_PATH_DIR" describe --tags --exact-match 2>/dev/null || echo unknown)"
  if [[ "$current" != "$IDF_VERSION" ]]; then
    echo "警告：$IDF_PATH_DIR 当前为 $current，期望 $IDF_VERSION。不会自动改动，请手动处理。" >&2
  fi
  log "ESP-IDF 已存在（$current），跳过克隆"
else
  log "克隆 ESP-IDF $IDF_VERSION 到 $IDF_PATH_DIR"
  mkdir -p "$(dirname "$IDF_PATH_DIR")"
  git clone --recursive --depth 1 -b "$IDF_VERSION" \
    https://github.com/espressif/esp-idf.git "$IDF_PATH_DIR"
fi

# 3. 安装工具链（install.sh 本身可重复运行，已下载的工具会跳过）
log "install.sh $IDF_TARGET_CHIP"
(cd "$IDF_PATH_DIR" && ./install.sh "$IDF_TARGET_CHIP")

log "完成。使用：source $(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/env.sh"

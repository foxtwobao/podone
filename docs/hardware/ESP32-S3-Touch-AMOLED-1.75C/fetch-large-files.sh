#!/usr/bin/env bash
# 下载不进仓的上游大文件，并用 SHA256SUMS 校验。已存在的文件跳过。
set -euo pipefail
cd "$(dirname "$0")"

GH=https://github.com/waveshareteam/ESP32-S3-Touch-AMOLED-1.75C
FW="$GH/releases/download/v1.0.2"

files=(
  "examples/ESP32-S3-Touch-AMOLED-1.75C-v1.0.2.zip $GH/archive/refs/tags/v1.0.2.zip"
  "firmware/ESP32-S3-Touch-AMOLED-1.75C-FactoryOnly-260114.bin $GH/releases/download/v1.0.1/ESP32-S3-Touch-AMOLED-1.75C-FactoryOnly-260114.bin"
  "datasheets/esp32-s3_technical_reference_manual_cn.pdf https://documentation.espressif.com/esp32-s3_technical_reference_manual_cn.pdf"
  "datasheets/esp32-s3_technical_reference_manual_en.pdf https://documentation.espressif.com/esp32-s3_technical_reference_manual_en.pdf"
)
for app in 01_AXP2101 02_lvgl_demo_v9 03_esp-brookesia 04_Immersive_block 05_Spec_Analyzer; do
  name="ESP32-S3-Touch-AMOLED-1.75C-${app}-v5.5.5-combined.zip"
  files+=("firmware/$name $FW/$name")
done

for entry in "${files[@]}"; do
  path=${entry%% *}
  url=${entry#* }
  if [[ -f "$path" ]]; then continue; fi
  echo "下载 $path"
  curl -fL --retry 3 -o "$path.part" "$url"
  mv "$path.part" "$path"
done

shasum -a 256 -c SHA256SUMS

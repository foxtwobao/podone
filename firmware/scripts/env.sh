#!/usr/bin/env bash
# 激活 ESP-IDF 环境。必须用 source 执行：  source firmware/scripts/env.sh
# 可用 IDF_PATH_DIR 指定其他安装位置。
_idf_dir="${IDF_PATH_DIR:-$HOME/esp/esp-idf}"
if [[ ! -f "$_idf_dir/export.sh" ]]; then
  echo "未找到 $_idf_dir/export.sh，请先运行 firmware/scripts/install-idf.sh" >&2
  return 1 2>/dev/null || exit 1
fi
# shellcheck disable=SC1091
. "$_idf_dir/export.sh"
unset _idf_dir

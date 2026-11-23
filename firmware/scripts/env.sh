#!/usr/bin/env bash
# 激活 ESP-IDF 环境。必须用 source 执行：  source firmware/scripts/env.sh
# 可用 IDF_PATH_DIR 指定其他安装位置。
_idf_dir="${IDF_PATH_DIR:-$HOME/esp/esp-idf}"
if [[ ! -f "$_idf_dir/export.sh" ]]; then
  echo "未找到 $_idf_dir/export.sh，请先运行 firmware/scripts/install-idf.sh" >&2
  return 1 2>/dev/null || exit 1
fi
# install-idf.sh 用 python@3.12 建虚拟环境，这里同样优先使用它，否则 export.sh 会选系统 Python
if command -v brew >/dev/null 2>&1; then
  export PATH="$(brew --prefix python@3.12)/libexec/bin:$PATH"
fi
# shellcheck disable=SC1091
. "$_idf_dir/export.sh"
unset _idf_dir

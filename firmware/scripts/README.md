# 构建与打包脚本

目前为空。固件接入方式（`docs/ARCHITECTURE.md` 第 6 节）在实板上确定后，在这里加构建脚本，输出文件按板型 ID 命名，例如 `podone-waveshare-1.75c-0.1.0.bin`，服务端 OTA 按板型 ID 选包。

## 工具链

- `install-idf.sh`：安装 ESP-IDF（目标 `esp32s3`），默认 v5.5.5 装到 `~/esp/esp-idf`。固件基线是 v6.0.3，安装时设 `IDF_VERSION=v6.0.3 IDF_PATH_DIR=~/esp/esp-idf-v6.0.3`。脚本还会用 Homebrew 装 cmake、ninja、dfu-util、ccache、python@3.12。可重复运行，已完成的步骤会跳过。
- `env.sh`：激活 ESP-IDF 环境，必须用 `source` 执行，用 `IDF_PATH_DIR` 选择版本：

```bash
source firmware/scripts/env.sh && idf.py --version
```

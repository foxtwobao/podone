# 构建与打包脚本

## 构建

- `build.sh <board-id> [flash]`：构建一个板型，加 `flash` 时构建完接着烧录。串口默认 `/dev/cu.usbmodem21101`，可以用 `PORT` 改。脚本按 `firmware/UPSTREAM.json` 把上游小智固件拉到 `firmware/.upstream/xiaozhi-esp32` 并切到记录的提交，打上 `firmware/patches/` 的补丁（已打过的跳过），然后用 `idf.py -B firmware/build/<board-id>` 构建。ESP-IDF 默认取 `~/esp/esp-idf-v6.0.3`，可以用 `IDF_PATH_DIR` 改。

烧完后芯片停在下载模式，要拔插一次 USB 才会启动。

还没有打包脚本。以后发布 OTA 包时，输出文件按板型 ID 命名，例如 `podone-waveshare-1.75c-0.1.0.bin`，服务端按板型 ID 选包。

## 工具链

- `install-idf.sh`：安装 ESP-IDF（目标 `esp32s3`），默认 v5.5.5 装到 `~/esp/esp-idf`。固件基线是 v6.0.3，安装时设 `IDF_VERSION=v6.0.3 IDF_PATH_DIR=~/esp/esp-idf-v6.0.3`。脚本还会用 Homebrew 装 cmake、ninja、dfu-util、ccache、python@3.12。可重复运行，已完成的步骤会跳过。
- `env.sh`：激活 ESP-IDF 环境，必须用 `source` 执行，用 `IDF_PATH_DIR` 选择版本：

```bash
source firmware/scripts/env.sh && idf.py --version
```

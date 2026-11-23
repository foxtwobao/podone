# 全是头文件。小智固件构建时由 firmware/scripts/build.sh 把 eyes/ 和 motion/ 加进 main 组件的
# include 路径（eye_display.h 依赖 main 里的 Application 和 SpiLcdDisplay），不走这里。
# 保留本文件，方便以后不依赖 main 的部分单独作为组件引用。
idf_component_register(INCLUDE_DIRS "eyes" "motion")

ALTER TABLE `ai_device`
    ADD COLUMN `tts_voice` VARCHAR(128) NULL COMMENT '设备专属TTS音色编码，为空则继承系统默认',
    ADD COLUMN `allow_incoming_call` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '允许接收Bot主动来电(0关闭/1开启)',
    ADD COLUMN `allow_async_notice` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '允许播报异步结果与例行任务(0关闭/1开启)',
    ADD COLUMN `dnd_enabled` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否启用夜间免打扰(0关闭/1开启)',
    ADD COLUMN `dnd_start` VARCHAR(5) NULL COMMENT '免打扰开始时间(HH:mm)',
    ADD COLUMN `dnd_end` VARCHAR(5) NULL COMMENT '免打扰结束时间(HH:mm)';

INSERT INTO `sys_params` (id, param_code, param_value, value_type, param_type, remark)
SELECT 611271110, 'podone.voice.catalog', '[]', 'array', 1, 'Podone 控制台可选内置音色目录，JSON 数组：[{id,name,desc,enabled}]'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `sys_params` WHERE param_code = 'podone.voice.catalog');

INSERT INTO `sys_params` (id, param_code, param_value, value_type, param_type, remark)
SELECT 611271111, 'podone.botone.url', '', 'string', 1, 'Botone 网页端地址（例如 https://bot.lab.home.arpa），用于控制台联动深链'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `sys_params` WHERE param_code = 'podone.botone.url');

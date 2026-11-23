-- 注册 Podone waveshare-1.75c 固件类型到字典，供智控台 OTA 管理上传与下发（幂等）
INSERT INTO `sys_dict_data` (`id`, `dict_type_id`, `dict_label`, `dict_value`, `remark`, `sort`, `creator`, `create_date`, `updater`, `update_date`)
SELECT 101901, 101, 'Podone Waveshare ESP32-S3-Touch-AMOLED-1.75C', 'waveshare-1.75c', 'Podone 1.75C 圆屏固件', 1, 1, NOW(), 1, NOW()
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM `sys_dict_data` WHERE `dict_type_id` = 101 AND `dict_value` = 'waveshare-1.75c'
);

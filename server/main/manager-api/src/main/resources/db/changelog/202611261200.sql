INSERT INTO `sys_params` (id, param_code, param_value, value_type, param_type, remark)
SELECT 611261200, 'podone.voice.models', '{}', 'json', 1, 'chatModel 和 ttsModel 填 TokenONE 模型 ID，ttsVoice 填所选 TTS 通道支持的音色，由 Podone 作为 voice 传入合成请求'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `sys_params` WHERE param_code = 'podone.voice.models');

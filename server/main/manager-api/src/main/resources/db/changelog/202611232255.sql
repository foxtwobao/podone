-- 将 Podone 默认唤醒词 "你好波波" 加入智控台系统参数 wakeup_words（幂等）
UPDATE `sys_params`
SET `param_value` = CASE
    WHEN `param_value` IS NULL OR `param_value` = '' THEN '你好波波'
    ELSE CONCAT('你好波波;', `param_value`)
END
WHERE `param_code` = 'wakeup_words'
  AND (`param_value` IS NULL OR FIND_IN_SET('你好波波', REPLACE(`param_value`, ';', ',')) = 0);

package xiaozhi.modules.security.controller;

import java.util.Calendar;
import java.util.HashMap;
import java.util.Map;

import org.apache.commons.lang3.StringUtils;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.AllArgsConstructor;
import xiaozhi.common.constant.Constant;
import xiaozhi.common.user.UserDetail;
import xiaozhi.common.utils.JsonUtils;
import xiaozhi.common.utils.Result;
import xiaozhi.modules.security.idone.IdoneProperties;
import xiaozhi.modules.security.service.SysUserTokenService;
import xiaozhi.modules.security.user.SecurityUser;
import xiaozhi.modules.sys.service.SysParamsService;

@AllArgsConstructor
@RestController
@RequestMapping("/user")
@Tag(name = "登录管理")
public class LoginController {
    private final SysUserTokenService sysUserTokenService;
    private final SysParamsService sysParamsService;
    private final IdoneProperties idone;

    @GetMapping("/info")
    public Result<UserDetail> info() {
        return new Result<UserDetail>().ok(SecurityUser.getUser());
    }

    @PostMapping("/logout")
    public Result<Void> logout() {
        sysUserTokenService.logout(SecurityUser.getUserId());
        return new Result<>();
    }

    @GetMapping("/pub-config")
    public Result<Map<String, Object>> pubConfig() {
        Map<String, Object> config = new HashMap<>();
        config.put("loginMethod", "idone");
        config.put("idoneEnabled", idone.isConfigured());
        config.put("allowUserRegister", false);
        config.put("enableMobileRegister", false);
        config.put("version", Constant.VERSION);
        config.put("year", "©" + Calendar.getInstance().get(Calendar.YEAR));
        config.put("beianIcpNum", sysParamsService.getValue(Constant.SysBaseParam.BEIAN_ICP_NUM.getValue(), true));
        config.put("beianGaNum", sysParamsService.getValue(Constant.SysBaseParam.BEIAN_GA_NUM.getValue(), true));
        config.put("name", sysParamsService.getValue(Constant.SysBaseParam.SERVER_NAME.getValue(), true));
        String menuConfig = sysParamsService.getValue("system-web.menu", true);
        if (StringUtils.isNotBlank(menuConfig)) {
            config.put("systemWebMenu", JsonUtils.parseObject(menuConfig, Object.class));
        }
        return new Result<Map<String, Object>>().ok(config);
    }
}

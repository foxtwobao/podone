package xiaozhi.modules.pod.controller;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.apache.commons.lang3.StringUtils;
import org.apache.shiro.authz.annotation.RequiresPermissions;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import xiaozhi.common.user.UserDetail;
import xiaozhi.common.utils.Result;
import xiaozhi.modules.device.service.DeviceService;
import xiaozhi.modules.pod.dto.PodVoiceOption;
import xiaozhi.modules.pod.service.PodBridgeClient;
import xiaozhi.modules.pod.service.PodVoiceConfigService;
import xiaozhi.modules.security.user.SecurityUser;
import xiaozhi.modules.sys.entity.SysUserEntity;
import xiaozhi.modules.sys.service.SysUserService;

@Tag(name = "Pod 平台运维")
@RestController
@RequestMapping("/admin/pod")
@AllArgsConstructor
public class PodAdminController {
    private final PodVoiceConfigService voiceConfigService;
    private final DeviceService deviceService;
    private final SysUserService sysUserService;
    private final PodBridgeClient bridgeClient;

    public record SaveVoiceConfigRequest(
            @Size(max = 128) String chatModel,
            @Size(max = 128) String ttsModel,
            @Size(max = 128) String ttsVoice,
            @Size(max = 256) String botoneUrl,
            List<@Valid PodVoiceOption> voices) {
    }

    @GetMapping("/voice-config")
    @Operation(summary = "读取结构化的语音模型、音色目录、Botone 链接与基础设施参数")
    @RequiresPermissions("sys:role:superAdmin")
    public Result<Map<String, Object>> getVoiceConfig() {
        Map<String, String> models = voiceConfigService.getVoiceModels();
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("chatModel", StringUtils.defaultString(models.get("chatModel")));
        data.put("ttsModel", StringUtils.defaultString(models.get("ttsModel")));
        data.put("ttsVoice", StringUtils.defaultString(models.get("ttsVoice")));
        data.put("voiceConfigured", voiceConfigService.isVoiceConfigured(models));
        data.put("botoneUrl", voiceConfigService.getBotoneUrl());
        data.put("voiceCatalogSource", voiceConfigService.hasCustomVoiceCatalog() ? "custom" : "builtin");
        data.put("voices", voiceConfigService.getVoiceCatalog(false));
        data.put("coreParams", voiceConfigService.getCoreInfraParams());
        return new Result<Map<String, Object>>().ok(data);
    }

    @GetMapping("/runtime")
    @Operation(summary = "获取语音节点实时在线会话汇总与 Botone 桥接探活状态")
    @RequiresPermissions("sys:role:superAdmin")
    public Result<Map<String, Object>> getRuntime() {
        Map<String, Object> live = bridgeClient.fetchLiveSessions().orElse(Collections.emptyMap());
        boolean voiceReachable = !live.isEmpty();

        Map<String, Object> bridgeProbe = null;
        UserDetail current = SecurityUser.getUser();
        if (current != null && current.getId() != null) {
            SysUserEntity admin = sysUserService.selectById(current.getId());
            if (admin != null && !StringUtils.isAnyBlank(admin.getIdoneIssuer(), admin.getIdoneSubject())) {
                Map<String, String> models = voiceConfigService.getVoiceModels();
                bridgeProbe = bridgeClient.fetchBotoneStatus(
                        admin.getIdoneIssuer(), admin.getIdoneSubject(), models.get("chatModel")).orElse(null);
            }
        }

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("voiceServerReachable", voiceReachable);
        data.put("botoneConfigured", Boolean.TRUE.equals(live.get("botoneConfigured")));
        data.put("botoneUrl", live.get("botoneUrl") instanceof String s ? s : voiceConfigService.getBotoneUrl());
        data.put("summary", live.getOrDefault("summary", Map.of(
                "connected", 0, "standby", 0, "active", 0, "calling", 0)));
        data.put("sessions", PodDeviceController.extractSessions(live));
        data.put("bridgeProbe", bridgeProbe);
        return new Result<Map<String, Object>>().ok(data);
    }

    @PutMapping("/voice-config")
    @Operation(summary = "保存结构化的语音模型、音色目录与 Botone 链接")
    @RequiresPermissions("sys:role:superAdmin")
    public Result<Void> saveVoiceConfig(@Valid @RequestBody SaveVoiceConfigRequest request) {
        if (StringUtils.isNotBlank(request.botoneUrl())) {
            String trimmed = request.botoneUrl().trim();
            if (!trimmed.startsWith("https://") && !trimmed.startsWith("http://")) {
                return new Result<Void>().error("Botone 地址必须以 https:// 或 http:// 开头");
            }
        }
        try {
            voiceConfigService.saveVoiceConfig(
                    request.chatModel(),
                    request.ttsModel(),
                    request.ttsVoice(),
                    request.botoneUrl(),
                    request.voices());
        } catch (IllegalArgumentException e) {
            return new Result<Void>().error(e.getMessage());
        }
        return new Result<>();
    }

    @DeleteMapping("/devices/{id}")
    @Operation(summary = "管理员强制解绑任意 Pod")
    @RequiresPermissions("sys:role:superAdmin")
    public Result<Void> forceUnbind(@PathVariable String id) {
        deviceService.adminUnbindDevice(id);
        return new Result<>();
    }
}

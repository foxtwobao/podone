package xiaozhi.modules.pod.controller;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

import org.apache.commons.lang3.StringUtils;
import org.apache.shiro.authz.annotation.RequiresPermissions;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import xiaozhi.common.exception.ErrorCode;
import xiaozhi.common.user.UserDetail;
import xiaozhi.common.utils.Result;
import xiaozhi.modules.device.entity.DeviceEntity;
import xiaozhi.modules.device.entity.OtaEntity;
import xiaozhi.modules.device.service.DeviceService;
import xiaozhi.modules.device.service.OtaService;
import xiaozhi.modules.pod.service.PodBridgeClient;
import xiaozhi.modules.pod.service.PodVoiceConfigService;
import xiaozhi.modules.security.user.SecurityUser;
import xiaozhi.modules.sys.entity.SysUserEntity;
import xiaozhi.modules.sys.service.SysUserService;

@Tag(name = "Pod 硬件伴侣")
@RestController
@RequestMapping("/pod")
@AllArgsConstructor
public class PodDeviceController {
    private static final Pattern HH_MM = Pattern.compile("^([01]\\d|2[0-3]):[0-5]\\d$");

    private final DeviceService deviceService;
    private final OtaService otaService;
    private final PodVoiceConfigService voiceConfigService;
    private final SysUserService sysUserService;
    private final PodBridgeClient bridgeClient;

    public record BindRequest(
            @NotBlank @Size(min = 6, max = 6) String code,
            @Size(max = 64) String alias,
            @Size(max = 128) String ttsVoice) {
    }

    public record UpdatePodRequest(
            @Size(max = 64) String alias,
            @Size(max = 128) String ttsVoice,
            Boolean autoUpdate,
            Boolean allowIncomingCall,
            Boolean allowAsyncNotice,
            Boolean dndEnabled,
            @Size(max = 5) String dndStart,
            @Size(max = 5) String dndEnd) {
    }

    @GetMapping("/overview")
    @Operation(summary = "获取当前用户的 Pod 概览、实时在线态、音色目录与 Botone 就绪体检")
    @RequiresPermissions("sys:role:normal")
    public Result<Map<String, Object>> overview() {
        UserDetail user = SecurityUser.getUser();
        Map<String, String> models = voiceConfigService.getVoiceModels();
        List<DeviceEntity> entities = deviceService.getAllUserDevices(user.getId());
        Map<String, String> latestByBoard = new HashMap<>();

        Map<String, Object> livePayload = bridgeClient.fetchLiveSessions().orElse(Collections.emptyMap());
        Map<String, Map<String, Object>> liveSessions = extractSessions(livePayload);

        SysUserEntity sysUser = sysUserService.selectById(user.getId());
        Map<String, Object> readiness = null;
        if (sysUser != null && !StringUtils.isAnyBlank(sysUser.getIdoneIssuer(), sysUser.getIdoneSubject())) {
            readiness = bridgeClient.fetchBotoneStatus(
                    sysUser.getIdoneIssuer(), sysUser.getIdoneSubject(), models.get("chatModel")).orElse(null);
        }

        String configuredBotoneUrl = voiceConfigService.getBotoneUrl();
        String discoveredBotoneUrl = resolveBotoneUrl(configuredBotoneUrl, livePayload, readiness);

        List<Map<String, Object>> pods = new ArrayList<>(entities.size());
        int onlineCount = 0;
        for (DeviceEntity device : entities) {
            String board = device.getBoard();
            String latestVersion = null;
            if (StringUtils.isNotBlank(board)) {
                latestVersion = latestByBoard.computeIfAbsent(board, b -> {
                    OtaEntity latest = otaService.getLatestOta(b);
                    return latest == null ? "" : StringUtils.defaultString(latest.getVersion());
                });
            }
            String macKey = device.getMacAddress() == null ? "" : device.getMacAddress().toLowerCase();
            Map<String, Object> live = liveSessions.get(macKey);
            if (live != null) {
                onlineCount++;
            }
            pods.add(toPodView(device, StringUtils.isBlank(latestVersion) ? null : latestVersion, live));
        }

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("voiceConfigured", voiceConfigService.isVoiceConfigured(models));
        data.put("voiceConfig", Map.of(
                "chatModel", StringUtils.defaultString(models.get("chatModel")),
                "ttsModel", StringUtils.defaultString(models.get("ttsModel")),
                "defaultVoice", StringUtils.defaultString(models.get("ttsVoice"))));
        data.put("voices", voiceConfigService.getVoiceCatalog(true));
        data.put("botoneUrl", discoveredBotoneUrl);
        data.put("voiceServerReachable", !livePayload.isEmpty());
        data.put("onlineCount", onlineCount);
        data.put("readiness", readiness);
        data.put("devices", pods);
        return new Result<Map<String, Object>>().ok(data);
    }

    @GetMapping("/bind/preview")
    @Operation(summary = "校验并预览 6 位激活码对应的待绑定硬件")
    @RequiresPermissions("sys:role:normal")
    public Result<Map<String, Object>> previewBind(@RequestParam("code") String code) {
        return new Result<Map<String, Object>>().ok(deviceService.previewActivation(code));
    }

    @PostMapping("/bind")
    @Operation(summary = "一步绑定新 Pod 到当前用户（无需创建智能体）")
    @RequiresPermissions("sys:role:normal")
    public Result<Map<String, Object>> bind(@Valid @RequestBody BindRequest request) {
        UserDetail user = SecurityUser.getUser();
        DeviceEntity created = deviceService.activatePodForUser(
                user.getId(), request.code(), request.alias(), request.ttsVoice());
        OtaEntity latest = StringUtils.isBlank(created.getBoard()) ? null : otaService.getLatestOta(created.getBoard());
        return new Result<Map<String, Object>>().ok(
                toPodView(created, latest == null ? null : latest.getVersion(), null));
    }

    @PutMapping("/devices/{id}")
    @Operation(summary = "更新单台 Pod 的别名、音色、来电/免打扰与 OTA 偏好")
    @RequiresPermissions("sys:role:normal")
    public Result<Map<String, Object>> update(@PathVariable String id, @Valid @RequestBody UpdatePodRequest request) {
        DeviceEntity entity = deviceService.selectById(id);
        UserDetail user = SecurityUser.getUser();
        if (entity == null || entity.getUserId() == null || !entity.getUserId().equals(user.getId())) {
            return new Result<Map<String, Object>>().error("设备不存在");
        }
        if (request.dndStart() != null && !request.dndStart().isBlank() && !HH_MM.matcher(request.dndStart()).matches()) {
            return new Result<Map<String, Object>>().error("免打扰开始时间格式应为 HH:mm");
        }
        if (request.dndEnd() != null && !request.dndEnd().isBlank() && !HH_MM.matcher(request.dndEnd()).matches()) {
            return new Result<Map<String, Object>>().error("免打扰结束时间格式应为 HH:mm");
        }

        if (request.alias() != null) {
            entity.setAlias(StringUtils.trimToNull(request.alias()));
        }
        if (request.ttsVoice() != null) {
            entity.setTtsVoice(StringUtils.trimToNull(request.ttsVoice()));
        }
        if (request.autoUpdate() != null) {
            entity.setAutoUpdate(request.autoUpdate() ? 1 : 0);
        }
        if (request.allowIncomingCall() != null) {
            entity.setAllowIncomingCall(request.allowIncomingCall() ? 1 : 0);
        }
        if (request.allowAsyncNotice() != null) {
            entity.setAllowAsyncNotice(request.allowAsyncNotice() ? 1 : 0);
        }
        if (request.dndEnabled() != null) {
            entity.setDndEnabled(request.dndEnabled() ? 1 : 0);
        }
        if (request.dndStart() != null) {
            entity.setDndStart(StringUtils.trimToNull(request.dndStart()));
        }
        if (request.dndEnd() != null) {
            entity.setDndEnd(StringUtils.trimToNull(request.dndEnd()));
        }
        if (!deviceService.updateById(entity)) {
            return new Result<Map<String, Object>>().error(ErrorCode.UPDATE_DATA_FAILED);
        }
        OtaEntity latest = StringUtils.isBlank(entity.getBoard()) ? null : otaService.getLatestOta(entity.getBoard());
        Map<String, Object> live = bridgeClient.fetchLiveSessions()
                .map(PodDeviceController::extractSessions)
                .map(map -> map.get(entity.getMacAddress() == null ? "" : entity.getMacAddress().toLowerCase()))
                .orElse(null);
        return new Result<Map<String, Object>>().ok(
                toPodView(entity, latest == null ? null : latest.getVersion(), live));
    }

    @DeleteMapping("/devices/{id}")
    @Operation(summary = "解绑当前用户的 Pod")
    @RequiresPermissions("sys:role:normal")
    public Result<Void> unbind(@PathVariable String id) {
        UserDetail user = SecurityUser.getUser();
        deviceService.unbindDevice(user.getId(), id);
        return new Result<>();
    }

    @SuppressWarnings("unchecked")
    static Map<String, Map<String, Object>> extractSessions(Map<String, Object> payload) {
        if (payload == null || !(payload.get("sessions") instanceof Map<?, ?> raw)) {
            return Collections.emptyMap();
        }
        Map<String, Map<String, Object>> result = new HashMap<>();
        for (Map.Entry<?, ?> entry : raw.entrySet()) {
            if (entry.getKey() instanceof String key && entry.getValue() instanceof Map<?, ?> val) {
                result.put(key.toLowerCase(), (Map<String, Object>) val);
            }
        }
        return result;
    }

    private static String resolveBotoneUrl(String configured, Map<String, Object> livePayload,
            Map<String, Object> readiness) {
        if (StringUtils.isNotBlank(configured)) {
            return configured;
        }
        Object fromReadiness = readiness == null ? null : readiness.get("botoneUrl");
        if (fromReadiness instanceof String s && s.startsWith("https://")) {
            return StringUtils.removeEnd(s.trim(), "/");
        }
        Object fromLive = livePayload == null ? null : livePayload.get("botoneUrl");
        if (fromLive instanceof String s && s.startsWith("https://")) {
            return StringUtils.removeEnd(s.trim(), "/");
        }
        return "";
    }

    private Map<String, Object> toPodView(DeviceEntity device, String latestVersion, Map<String, Object> live) {
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("id", device.getId());
        view.put("alias", StringUtils.defaultString(device.getAlias()));
        view.put("board", StringUtils.defaultString(device.getBoard()));
        view.put("macAddress", StringUtils.defaultString(device.getMacAddress()));
        view.put("appVersion", StringUtils.defaultString(device.getAppVersion()));
        view.put("latestVersion", StringUtils.defaultString(latestVersion));
        view.put("hasUpdate", StringUtils.isNotBlank(latestVersion)
                && StringUtils.isNotBlank(device.getAppVersion())
                && !latestVersion.equals(device.getAppVersion()));
        view.put("ttsVoice", StringUtils.defaultString(device.getTtsVoice()));
        view.put("autoUpdate", Integer.valueOf(1).equals(device.getAutoUpdate()));
        view.put("allowIncomingCall", device.getAllowIncomingCall() == null || device.getAllowIncomingCall() == 1);
        view.put("allowAsyncNotice", device.getAllowAsyncNotice() == null || device.getAllowAsyncNotice() == 1);
        view.put("dndEnabled", Integer.valueOf(1).equals(device.getDndEnabled()));
        view.put("dndStart", StringUtils.defaultIfBlank(device.getDndStart(), "23:00"));
        view.put("dndEnd", StringUtils.defaultIfBlank(device.getDndEnd(), "08:00"));
        view.put("needsReenrollment", StringUtils.isBlank(device.getPairedClientHash()));
        view.put("online", live != null);
        view.put("liveState", live != null && live.get("state") instanceof String s ? s : "offline");
        view.put("inCall", live != null && Boolean.TRUE.equals(live.get("inCall")));
        view.put("createDateTimestamp", device.getCreateDate() == null ? null : device.getCreateDate().getTime());
        view.put("lastConnectedAtTimestamp",
                device.getLastConnectedAt() == null ? null : device.getLastConnectedAt().getTime());
        return view;
    }
}

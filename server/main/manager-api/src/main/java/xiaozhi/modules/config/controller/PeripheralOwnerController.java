package xiaozhi.modules.config.controller;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.HashMap;
import java.util.Map;
import lombok.AllArgsConstructor;
import org.apache.commons.lang3.StringUtils;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import xiaozhi.common.utils.JsonUtils;
import xiaozhi.common.utils.Result;
import xiaozhi.modules.agent.entity.AgentEntity;
import xiaozhi.modules.agent.service.AgentService;
import xiaozhi.modules.device.entity.DeviceEntity;
import xiaozhi.modules.device.service.DeviceService;
import xiaozhi.modules.device.service.impl.DeviceClientBinding;
import xiaozhi.modules.model.entity.ModelConfigEntity;
import xiaozhi.modules.model.service.ModelConfigService;
import xiaozhi.modules.sys.entity.SysUserEntity;
import xiaozhi.modules.sys.service.SysParamsService;
import xiaozhi.modules.sys.service.SysUserService;
import xiaozhi.modules.timbre.entity.TimbreEntity;
import xiaozhi.modules.timbre.service.TimbreService;
import xiaozhi.modules.voiceclone.dao.VoiceCloneDao;
import xiaozhi.modules.voiceclone.entity.VoiceCloneEntity;

/** Uses the same server credential as the other /config endpoints. */
@RestController
@RequestMapping("config")
@AllArgsConstructor
public class PeripheralOwnerController {
    private final DeviceService devices;
    private final SysUserService users;
    private final SysParamsService params;
    private final AgentService agents;
    private final ModelConfigService models;
    private final TimbreService timbres;
    private final VoiceCloneDao voiceClones;

    public record OwnerRequest(@NotBlank @Size(max = 128) String macAddress,
            @NotBlank @Size(max = 128) String clientId) {
    }

    @PostMapping("peripheral-owner")
    public Result<Map<String, Object>> owner(@Valid @RequestBody OwnerRequest request) {
        DeviceEntity device = devices.getDeviceByMacAddress(request.macAddress());
        if (device == null) {
            String code = devices.getPairedActivationCode(request.macAddress(), request.clientId());
            return new Result<Map<String, Object>>().ok(StringUtils.isBlank(code)
                    ? Map.of("status", "unbound")
                    : Map.of("status", "unbound", "bindCode", code));
        }
        if (device.getPairedClientHash() == null) {
            return new Result<Map<String, Object>>().ok(Map.of("status", "device_enrollment_required"));
        }
        if (!DeviceClientBinding.matches(device.getPairedClientHash(),
                DeviceClientBinding.fingerprint(request.clientId()))) {
            return new Result<Map<String, Object>>().ok(Map.of("status", "invalid_device"));
        }
        SysUserEntity user = device.getUserId() == null ? null : users.selectById(device.getUserId());
        if (user == null || !Integer.valueOf(1).equals(user.getStatus())) {
            return new Result<Map<String, Object>>().ok(Map.of("status", "inactive"));
        }
        if (StringUtils.isAnyBlank(user.getIdoneIssuer(), user.getIdoneSubject())) {
            return new Result<Map<String, Object>>().ok(Map.of("status", "account_required"));
        }
        Map<String, Object> owner = new HashMap<>(Map.of(
                "status", "bound",
                "bindingId", device.getId() + ":" + device.getCreateDate().getTime(),
                "issuer", user.getIdoneIssuer(),
                "subject", user.getIdoneSubject()));
        Map<String, String> voice = voiceSettings(device);
        if (!voice.isEmpty()) {
            owner.put("voiceSettings", voice);
        }
        owner.put("preferences", devicePreferences(device));
        return new Result<Map<String, Object>>().ok(owner);
    }

    private Map<String, Object> devicePreferences(DeviceEntity device) {
        Map<String, Object> prefs = new HashMap<>();
        prefs.put("allowIncomingCall", device.getAllowIncomingCall() == null || device.getAllowIncomingCall() == 1);
        prefs.put("allowAsyncNotice", device.getAllowAsyncNotice() == null || device.getAllowAsyncNotice() == 1);
        prefs.put("dndEnabled", Integer.valueOf(1).equals(device.getDndEnabled()));
        if (StringUtils.isNotBlank(device.getDndStart())) {
            prefs.put("dndStart", device.getDndStart().trim());
        }
        if (StringUtils.isNotBlank(device.getDndEnd())) {
            prefs.put("dndEnd", device.getDndEnd().trim());
        }
        return prefs;
    }

    private Map<String, String> voiceSettings(DeviceEntity device) {
        String parameter = params.getValue("podone.voice.models", false);
        Map<String, Object> config;
        try {
            config = JsonUtils.parseMap(parameter);
        } catch (RuntimeException invalidParameter) {
            // The parameter editor lets admins change the value type.
            return Map.of();
        }
        if (config == null) {
            return Map.of();
        }
        Map<String, String> voice = new HashMap<>();
        for (String field : new String[] {"chatModel", "ttsModel", "ttsVoice"}) {
            if (config.get(field) instanceof String value && StringUtils.isNotBlank(value)) {
                voice.put(field, value.trim());
            }
        }
        if (StringUtils.isNotBlank(device.getTtsVoice())) {
            voice.put("ttsVoice", device.getTtsVoice().trim());
        } else {
            String selectedVoice = selectedVoice(device, voice.get("ttsModel"));
            if (StringUtils.isNotBlank(selectedVoice)) {
                voice.put("ttsVoice", selectedVoice.trim());
            }
        }
        return voice;
    }

    private String selectedVoice(DeviceEntity device, String speechModel) {
        if (speechModel == null || StringUtils.isBlank(device.getAgentId())) {
            return null;
        }
        AgentEntity agent = agents.selectById(device.getAgentId());
        if (agent == null || !device.getUserId().equals(agent.getUserId())
                || StringUtils.isAnyBlank(agent.getTtsVoiceId(), agent.getTtsModelId())) {
            return null;
        }
        ModelConfigEntity model = models.getModelByIdFromCache(agent.getTtsModelId());
        if (model == null || !"TTS".equalsIgnoreCase(model.getModelType()) || !Integer.valueOf(1).equals(model.getIsEnabled())
                || model.getConfigJson() == null || !speechModel.equals(model.getConfigJson().getStr("model"))) {
            return null;
        }
        TimbreEntity timbre = timbres.selectById(agent.getTtsVoiceId());
        if (timbre != null) {
            return agent.getTtsModelId().equals(timbre.getTtsModelId()) ? timbre.getTtsVoice() : null;
        }
        VoiceCloneEntity clone = voiceClones.selectOne(new QueryWrapper<VoiceCloneEntity>()
                .select("voice_id")
                .eq("id", agent.getTtsVoiceId())
                .eq("model_id", agent.getTtsModelId())
                .eq("user_id", device.getUserId())
                .eq("train_status", 2));
        return clone == null ? null : clone.getVoiceId();
    }
}

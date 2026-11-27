package xiaozhi.modules.config.controller;

import cn.hutool.json.JSONObject;
import java.util.Date;
import java.util.Map;

import org.junit.jupiter.api.Test;

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

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class PeripheralOwnerControllerTest {
    private static final String MAC = "12:34:56:78:90:ab";
    private static final String CLIENT = "12345678-1234-1234-1234-123456789012";
    private final DeviceService devices = mock(DeviceService.class);
    private final SysUserService users = mock(SysUserService.class);
    private final SysParamsService params = mock(SysParamsService.class);
    private final AgentService agents = mock(AgentService.class);
    private final ModelConfigService models = mock(ModelConfigService.class);
    private final TimbreService timbres = mock(TimbreService.class);
    private final VoiceCloneDao voiceClones = mock(VoiceCloneDao.class);
    private final PeripheralOwnerController controller = new PeripheralOwnerController(
            devices, users, params, agents, models, timbres, voiceClones);

    @Test
    void requiresThePairedDeviceAndActiveOwner() {
        DeviceEntity device = new DeviceEntity();
        device.setId("device-test");
        device.setCreateDate(new Date(1_000));
        device.setUserId(7L);
        when(devices.getDeviceByMacAddress(MAC)).thenReturn(device);

        var request = new PeripheralOwnerController.OwnerRequest(MAC, CLIENT);
        assertEquals("device_enrollment_required", controller.owner(request).getData().get("status"));
        device.setPairedClientHash(DeviceClientBinding.fingerprint(CLIENT));
        var incorrect = controller.owner(
                new PeripheralOwnerController.OwnerRequest(MAC, "12345678-1234-1234-1234-123456789013"));
        assertEquals("invalid_device", incorrect.getData().get("status"));
        assertFalse(incorrect.getData().containsKey("subject"));

        SysUserEntity owner = new SysUserEntity();
        owner.setStatus(0);
        when(users.selectById(7L)).thenReturn(owner);
        assertEquals("inactive", controller.owner(request).getData().get("status"));
        owner.setStatus(1);
        assertEquals("account_required", controller.owner(request).getData().get("status"));
        owner.setIdoneIssuer("https://identity.example.test");
        owner.setIdoneSubject("test-subject");
        var identity = controller.owner(request).getData();
        assertEquals("bound", identity.get("status"));
        assertEquals("device-test:1000", identity.get("bindingId"));
        assertEquals("test-subject", identity.get("subject"));
        assertFalse(identity.containsKey("voiceSettings"));

        when(params.getValue("podone.voice.models", false))
                .thenReturn("{\"chatModel\":\" chat-first \",\"ttsModel\":\"speech-first\",\"ttsVoice\":\"voice-1\",\"apiKey\":\"ignored\"}")
                .thenReturn("{\"chatModel\":\"chat-next\",\"ttsModel\":\"speech-next\",\"ttsVoice\":\"voice-2\"}");
        assertEquals(Map.of("chatModel", "chat-first", "ttsModel", "speech-first", "ttsVoice", "voice-1"),
                controller.owner(request).getData().get("voiceSettings"));
        assertEquals(Map.of("chatModel", "chat-next", "ttsModel", "speech-next", "ttsVoice", "voice-2"),
                controller.owner(request).getData().get("voiceSettings"));
    }

    @Test
    void usesTheBoundRolesCurrentVoiceForTheConfiguredTtsModel() {
        AgentEntity agent = boundRole();
        TimbreEntity first = new TimbreEntity();
        first.setTtsModelId("tts-profile");
        first.setTtsVoice("first-code");
        TimbreEntity second = new TimbreEntity();
        second.setTtsModelId("tts-profile");
        second.setTtsVoice("second-code");
        when(timbres.selectById("voice-row-1")).thenReturn(first);
        when(timbres.selectById("voice-row-2")).thenReturn(second);

        assertEquals("default-code", currentVoice());
        agent.setTtsVoiceId("voice-row-1");
        assertEquals("first-code", currentVoice());
        agent.setTtsVoiceId("voice-row-2");
        assertEquals("second-code", currentVoice());
        second.setTtsModelId("different-profile");
        assertEquals("default-code", currentVoice());
        agent.setTtsVoiceId("deleted-voice");
        assertEquals("default-code", currentVoice());
        agent.setTtsVoiceId("voice-row-1");
        agent.setTtsModelId("different-profile");
        ModelConfigEntity otherModel = new ModelConfigEntity();
        otherModel.setModelType("TTS");
        otherModel.setIsEnabled(1);
        otherModel.setConfigJson(new JSONObject().set("model", "different-speech-model"));
        when(models.getModelByIdFromCache("different-profile")).thenReturn(otherModel);
        first.setTtsModelId("different-profile");
        assertEquals("default-code", currentVoice());
        agent.setTtsModelId("tts-profile");
        first.setTtsModelId("tts-profile");
        agent.setUserId(8L);
        assertEquals("default-code", currentVoice());
    }

    @Test
    void resolvesASelectedCloneToItsUpstreamVoiceId() {
        AgentEntity agent = boundRole();
        agent.setTtsVoiceId("clone-row");
        VoiceCloneEntity clone = new VoiceCloneEntity();
        clone.setVoiceId("trained-clone-code");
        when(voiceClones.selectOne(any())).thenReturn(clone);
        assertEquals("trained-clone-code", currentVoice());
    }

    private AgentEntity boundRole() {
        DeviceEntity device = new DeviceEntity();
        device.setId("device-test");
        device.setCreateDate(new Date(1_000));
        device.setUserId(7L);
        device.setAgentId("role-1");
        device.setPairedClientHash(DeviceClientBinding.fingerprint(CLIENT));
        when(devices.getDeviceByMacAddress(MAC)).thenReturn(device);

        SysUserEntity owner = new SysUserEntity();
        owner.setStatus(1);
        owner.setIdoneIssuer("https://identity.example.test");
        owner.setIdoneSubject("test-subject");
        when(users.selectById(7L)).thenReturn(owner);
        when(params.getValue("podone.voice.models", false))
                .thenReturn("{\"ttsModel\":\"speech-model\",\"ttsVoice\":\"default-code\"}");

        AgentEntity agent = new AgentEntity();
        agent.setUserId(7L);
        agent.setTtsModelId("tts-profile");
        when(agents.selectById("role-1")).thenReturn(agent);
        ModelConfigEntity model = new ModelConfigEntity();
        model.setModelType("tts");
        model.setIsEnabled(1);
        model.setConfigJson(new JSONObject().set("model", "speech-model"));
        when(models.getModelByIdFromCache("tts-profile")).thenReturn(model);
        return agent;
    }

    private Object currentVoice() {
        var settings = (Map<?, ?>) controller.owner(
                new PeripheralOwnerController.OwnerRequest(MAC, CLIENT)).getData().get("voiceSettings");
        return settings.get("ttsVoice");
    }

    @Test
    void prefersDirectDeviceVoiceOverLegacyRoleAndExposesPreferences() {
        DeviceEntity device = new DeviceEntity();
        device.setId("device-direct");
        device.setCreateDate(new Date(2_000));
        device.setUserId(7L);
        device.setAgentId(null);
        device.setPairedClientHash(DeviceClientBinding.fingerprint(CLIENT));
        device.setTtsVoice("direct-voice-id");
        device.setAllowIncomingCall(0);
        device.setAllowAsyncNotice(1);
        device.setDndEnabled(1);
        device.setDndStart("23:00");
        device.setDndEnd("07:30");
        when(devices.getDeviceByMacAddress(MAC)).thenReturn(device);

        SysUserEntity owner = new SysUserEntity();
        owner.setStatus(1);
        owner.setIdoneIssuer("https://identity.example.test");
        owner.setIdoneSubject("test-subject");
        when(users.selectById(7L)).thenReturn(owner);
        when(params.getValue("podone.voice.models", false))
                .thenReturn("{\"chatModel\":\"gpt-4.1-mini\",\"ttsModel\":\"speech-model\",\"ttsVoice\":\"default-code\"}");

        Map<String, Object> data = controller.owner(new PeripheralOwnerController.OwnerRequest(MAC, CLIENT)).getData();
        assertEquals(Map.of("chatModel", "gpt-4.1-mini", "ttsModel", "speech-model", "ttsVoice", "direct-voice-id"),
                data.get("voiceSettings"));
        assertEquals(Map.of(
                "allowIncomingCall", false,
                "allowAsyncNotice", true,
                "dndEnabled", true,
                "dndStart", "23:00",
                "dndEnd", "07:30"), data.get("preferences"));
    }

    @Test
    void suppliesActivationCodeOnlyWhenThePendingClientMatches() {
        when(devices.getPairedActivationCode(MAC, CLIENT)).thenReturn("123456");
        assertEquals("123456", controller.owner(
                new PeripheralOwnerController.OwnerRequest(MAC, CLIENT)).getData().get("bindCode"));
        assertFalse(controller.owner(new PeripheralOwnerController.OwnerRequest(MAC, "other"))
                .getData().containsKey("bindCode"));
    }
}

package xiaozhi.modules.pod.controller;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.apache.shiro.subject.Subject;
import org.apache.shiro.util.ThreadContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import cn.hutool.json.JSONObject;
import xiaozhi.common.user.UserDetail;
import xiaozhi.modules.device.service.DeviceService;
import xiaozhi.modules.model.entity.ModelConfigEntity;
import xiaozhi.modules.model.service.ModelConfigService;
import xiaozhi.modules.pod.dto.PodVoiceOption;
import xiaozhi.modules.pod.service.PodBridgeClient;
import xiaozhi.modules.pod.service.PodVoiceConfigService;
import xiaozhi.modules.sys.entity.SysUserEntity;
import xiaozhi.modules.sys.service.SysParamsService;
import xiaozhi.modules.sys.service.SysUserService;
import xiaozhi.modules.timbre.dao.TimbreDao;
import xiaozhi.modules.timbre.entity.TimbreEntity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class PodAdminControllerTest {
    private final SysParamsService params = mock(SysParamsService.class);
    private final ModelConfigService modelConfigService = mock(ModelConfigService.class);
    private final TimbreDao timbreDao = mock(TimbreDao.class);
    private final PodVoiceConfigService voiceConfigService = new PodVoiceConfigService(
            params, modelConfigService, timbreDao);
    private final DeviceService deviceService = mock(DeviceService.class);
    private final SysUserService sysUserService = mock(SysUserService.class);
    private final PodBridgeClient bridgeClient = mock(PodBridgeClient.class);
    private final PodAdminController controller = new PodAdminController(
            voiceConfigService, deviceService, sysUserService, bridgeClient);

    @AfterEach
    void tearDown() {
        ThreadContext.unbindSubject();
    }

    @Test
    void rejectsInvalidBotoneUrlAndSavesStructuredConfig() {
        var bad = controller.saveVoiceConfig(new PodAdminController.SaveVoiceConfigRequest(
                "gpt-4.1-mini", "speech-2.6-turbo", "mini-warm", "ftp://bad", List.of()));
        assertFalse(bad.getCode() == 0);

        when(params.updateValueByCode(anyString(), anyString())).thenReturn(1);
        var ok = controller.saveVoiceConfig(new PodAdminController.SaveVoiceConfigRequest(
                " gpt-4.1-mini ", " speech-2.6-turbo ", " mini-warm ", "https://bot.lab.home.arpa/",
                List.of(new PodVoiceOption("mini-warm", "暖声女生", "默认", true))));
        assertTrue(ok.getCode() == 0);
        verify(params).updateValueByCode(eq("podone.voice.models"),
                eq("{\"chatModel\":\"gpt-4.1-mini\",\"ttsModel\":\"speech-2.6-turbo\",\"ttsVoice\":\"mini-warm\"}"));
        verify(params).updateValueByCode(eq("podone.botone.url"), eq("https://bot.lab.home.arpa"));
    }

    @Test
    void loadsFullBuiltinVoicesFromMatchingTtsModelWhenCustomCatalogEmpty() {
        when(params.getValue("podone.voice.models", false))
                .thenReturn("{\"chatModel\":\"deepseek-v4.1-flash\",\"ttsModel\":\"speech-01-turbo\",\"ttsVoice\":\"female-shaonv\"}");
        when(params.getValue("podone.voice.catalog", false)).thenReturn("[]");
        when(params.getValue("podone.botone.url", false)).thenReturn("https://botone.lab.home.arpa/");

        ModelConfigEntity minimax = new ModelConfigEntity();
        minimax.setId("TTS_MinimaxStreamTTS");
        minimax.setModelType("tts");
        minimax.setIsEnabled(1);
        minimax.setConfigJson(new JSONObject().set("model", "speech-01-turbo"));
        when(modelConfigService.getEnabledModelsByType("TTS")).thenReturn(List.of(minimax));

        TimbreEntity v1 = new TimbreEntity();
        v1.setTtsVoice("female-shaonv");
        v1.setName("少女音");
        v1.setLanguages("普通话");
        TimbreEntity v2 = new TimbreEntity();
        v2.setTtsVoice("female-chengshu");
        v2.setName("成熟女声");
        v2.setLanguages("普通话");
        when(timbreDao.selectList(any())).thenReturn(List.of(v1, v2));

        Map<String, Object> data = controller.getVoiceConfig().getData();
        assertEquals(true, data.get("voiceConfigured"));
        assertEquals("builtin", data.get("voiceCatalogSource"));
        @SuppressWarnings("unchecked")
        List<PodVoiceOption> voices = (List<PodVoiceOption>) data.get("voices");
        assertEquals(2, voices.size());
        assertEquals("female-shaonv", voices.get(0).getId());
        assertEquals("少女音", voices.get(0).getName());
        assertEquals("female-chengshu", voices.get(1).getId());
    }

    @Test
    void runtimeReturnsLiveSummaryAndBridgeProbe() {
        UserDetail detail = new UserDetail();
        detail.setId(1L);
        Subject subject = mock(Subject.class);
        when(subject.getPrincipal()).thenReturn(detail);
        ThreadContext.bind(subject);

        SysUserEntity admin = new SysUserEntity();
        admin.setId(1L);
        admin.setIdoneIssuer("https://idone.lab.home.arpa");
        admin.setIdoneSubject("admin-sub");
        when(sysUserService.selectById(1L)).thenReturn(admin);
        when(params.getValue("podone.voice.models", false)).thenReturn("{\"chatModel\":\"gpt-4.1-mini\"}");
        when(bridgeClient.fetchLiveSessions()).thenReturn(Optional.of(Map.of(
                "botoneConfigured", true,
                "botoneUrl", "https://bot.lab.home.arpa",
                "summary", Map.of("connected", 2, "standby", 1, "active", 1, "calling", 0),
                "sessions", Map.of("c4:9e:7e:0b:d8:7c", Map.of("state", "standby")))));
        when(bridgeClient.fetchBotoneStatus("https://idone.lab.home.arpa", "admin-sub", "gpt-4.1-mini"))
                .thenReturn(Optional.of(Map.of("bridgeOk", true, "latencyMs", 28, "authStatus", "ready")));

        Map<String, Object> runtime = controller.getRuntime().getData();
        assertEquals(true, runtime.get("voiceServerReachable"));
        assertEquals(true, runtime.get("botoneConfigured"));
        @SuppressWarnings("unchecked")
        Map<String, Object> probe = (Map<String, Object>) runtime.get("bridgeProbe");
        assertEquals(28, probe.get("latencyMs"));
    }
}

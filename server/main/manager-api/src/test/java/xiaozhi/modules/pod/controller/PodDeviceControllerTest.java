package xiaozhi.modules.pod.controller;

import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.apache.shiro.subject.Subject;
import org.apache.shiro.util.ThreadContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import xiaozhi.common.user.UserDetail;
import xiaozhi.modules.device.entity.DeviceEntity;
import xiaozhi.modules.device.entity.OtaEntity;
import xiaozhi.modules.device.service.DeviceService;
import xiaozhi.modules.device.service.OtaService;
import xiaozhi.modules.pod.dto.PodVoiceOption;
import xiaozhi.modules.pod.service.PodBridgeClient;
import xiaozhi.modules.pod.service.PodVoiceConfigService;
import xiaozhi.modules.sys.entity.SysUserEntity;
import xiaozhi.modules.sys.service.SysUserService;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class PodDeviceControllerTest {
    private final DeviceService deviceService = mock(DeviceService.class);
    private final OtaService otaService = mock(OtaService.class);
    private final PodVoiceConfigService voiceConfigService = mock(PodVoiceConfigService.class);
    private final SysUserService sysUserService = mock(SysUserService.class);
    private final PodBridgeClient bridgeClient = mock(PodBridgeClient.class);
    private final PodDeviceController controller = new PodDeviceController(
            deviceService, otaService, voiceConfigService, sysUserService, bridgeClient);

    @AfterEach
    void tearDown() {
        ThreadContext.unbindSubject();
    }

    private void loginAs(Long userId) {
        UserDetail detail = new UserDetail();
        detail.setId(userId);
        detail.setUsername("hulei");
        Subject subject = mock(Subject.class);
        when(subject.getPrincipal()).thenReturn(detail);
        ThreadContext.bind(subject);
    }

    @Test
    void overviewMergesLiveSessionsAndBotoneReadiness() {
        loginAs(42L);
        DeviceEntity pod = new DeviceEntity();
        pod.setId("pod-1");
        pod.setUserId(42L);
        pod.setAlias("书房桌面");
        pod.setBoard("waveshare-1.75c");
        pod.setMacAddress("C4:9E:7E:0B:D8:7C");
        pod.setAppVersion("0.2.1");
        pod.setAutoUpdate(1);
        pod.setCreateDate(new Date(1_000));
        when(deviceService.getAllUserDevices(42L)).thenReturn(List.of(pod));

        OtaEntity latest = new OtaEntity();
        latest.setVersion("0.2.2");
        when(otaService.getLatestOta("waveshare-1.75c")).thenReturn(latest);
        when(voiceConfigService.getVoiceModels()).thenReturn(Map.of(
                "chatModel", "gpt-4.1-mini", "ttsModel", "speech-2.6-turbo", "ttsVoice", "mini-warm"));
        when(voiceConfigService.isVoiceConfigured(any())).thenReturn(true);
        when(voiceConfigService.getVoiceCatalog(true)).thenReturn(List.of(
                new PodVoiceOption("mini-warm", "暖声女生", "默认", true)));
        when(voiceConfigService.getBotoneUrl()).thenReturn("");

        SysUserEntity user = new SysUserEntity();
        user.setId(42L);
        user.setIdoneIssuer("https://idone.lab.home.arpa");
        user.setIdoneSubject("sub-42");
        when(sysUserService.selectById(42L)).thenReturn(user);

        when(bridgeClient.fetchLiveSessions()).thenReturn(Optional.of(Map.of(
                "botoneConfigured", true,
                "botoneUrl", "https://bot.lab.home.arpa",
                "sessions", Map.of("c4:9e:7e:0b:d8:7c", Map.of("state", "standby", "inCall", false)))));
        when(bridgeClient.fetchBotoneStatus("https://idone.lab.home.arpa", "sub-42", "gpt-4.1-mini"))
                .thenReturn(Optional.of(Map.of(
                        "bridgeOk", true,
                        "latencyMs", 35,
                        "accountReady", true,
                        "boboReady", true,
                        "boboBotId", "bot_bobo",
                        "authStatus", "ready",
                        "modelReady", true)));

        var res = controller.overview().getData();
        assertEquals(true, res.get("voiceConfigured"));
        assertEquals("https://bot.lab.home.arpa", res.get("botoneUrl"));
        assertEquals(1, res.get("onlineCount"));
        assertEquals(true, res.get("voiceServerReachable"));
        @SuppressWarnings("unchecked")
        Map<String, Object> readiness = (Map<String, Object>) res.get("readiness");
        assertEquals("ready", readiness.get("authStatus"));
        assertEquals("bot_bobo", readiness.get("boboBotId"));

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> devices = (List<Map<String, Object>>) res.get("devices");
        assertEquals(1, devices.size());
        assertEquals(true, devices.get(0).get("online"));
        assertEquals("standby", devices.get(0).get("liveState"));
        assertEquals(true, devices.get(0).get("hasUpdate"));
        assertEquals(true, devices.get(0).get("needsReenrollment"));
    }

    @Test
    void bindActivatesDirectlyForCurrentUserWithoutAgent() {
        loginAs(42L);
        DeviceEntity created = new DeviceEntity();
        created.setId("pod-new");
        created.setUserId(42L);
        created.setAlias("卧室床头");
        created.setBoard("waveshare-1.75c");
        created.setTtsVoice("mini-soft");
        created.setPairedClientHash("hash123");
        when(deviceService.activatePodForUser(42L, "482916", "卧室床头", "mini-soft")).thenReturn(created);

        var data = controller.bind(new PodDeviceController.BindRequest("482916", "卧室床头", "mini-soft")).getData();
        assertEquals("pod-new", data.get("id"));
        assertEquals("mini-soft", data.get("ttsVoice"));
        assertEquals(false, data.get("needsReenrollment"));
    }

    @Test
    void updateEnforcesOwnershipAndValidatesDndTime() {
        loginAs(42L);
        DeviceEntity pod = new DeviceEntity();
        pod.setId("pod-1");
        pod.setUserId(99L);
        when(deviceService.selectById("pod-1")).thenReturn(pod);
        when(bridgeClient.fetchLiveSessions()).thenReturn(Optional.empty());

        var forbidden = controller.update("pod-1",
                new PodDeviceController.UpdatePodRequest("新名字", null, null, null, null, null, null, null));
        assertFalse(forbidden.getCode() == 0);

        pod.setUserId(42L);
        var badTime = controller.update("pod-1",
                new PodDeviceController.UpdatePodRequest(null, null, null, null, null, true, "25:99", "08:00"));
        assertFalse(badTime.getCode() == 0);

        when(deviceService.updateById(pod)).thenReturn(true);
        var ok = controller.update("pod-1",
                new PodDeviceController.UpdatePodRequest("客厅", "", false, false, true, true, "22:30", "07:30"));
        assertTrue(ok.getCode() == 0);
        assertEquals("客厅", pod.getAlias());
        assertEquals(null, pod.getTtsVoice());
        assertEquals(0, pod.getAutoUpdate());
        assertEquals(0, pod.getAllowIncomingCall());
        assertEquals(1, pod.getDndEnabled());
        verify(deviceService).updateById(pod);
    }
}

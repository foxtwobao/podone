package xiaozhi.modules.security.idone;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.net.URI;
import java.time.Duration;
import java.util.HashMap;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import jakarta.servlet.http.Cookie;
import xiaozhi.common.page.TokenDTO;
import xiaozhi.common.utils.JsonUtils;
import xiaozhi.common.utils.Result;
import xiaozhi.modules.security.service.SysUserTokenService;

class IdoneControllerTest {
    private IdoneController controller;
    private IdoneProperties properties;
    private IdoneClient client;
    private IdoneUserService users;
    private SysUserTokenService tokens;
    private final Map<String, String> entries = new HashMap<>();

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setup() throws Exception {
        properties = new IdoneProperties();
        properties.setAppOrigin("https://xiaozhi.test");
        properties.setIssuer("https://idone.test");
        properties.setClientId("mock");
        properties.setClientSecret("mock-secret");
        client = mock(IdoneClient.class);
        users = mock(IdoneUserService.class);
        tokens = mock(SysUserTokenService.class);
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        ValueOperations<String, String> values = mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(values);
        doAnswer(call -> { entries.put(call.getArgument(0), call.getArgument(1)); return null; })
                .when(values).set(anyString(), anyString(), any(Duration.class));
        when(values.getAndDelete(anyString())).thenAnswer(call -> entries.remove(call.getArgument(0)));
        when(redis.delete(anyString())).thenAnswer(call -> entries.remove(call.getArgument(0)) != null);
        when(client.authorizationUri(anyString(), anyString(), anyString()))
                .thenAnswer(call -> URI.create("https://idone.test/authorize?state=" + call.getArgument(0)));
        when(client.authenticate(anyString(), anyString(), anyString()))
                .thenReturn(new IdoneClient.Identity(properties.getIssuer(), "mock-subject", "用户"));
        when(users.findOrCreate(any())).thenReturn(123L);
        when(users.requireActive(123L)).thenReturn(123L);
        when(tokens.createToken(123L)).thenReturn(new Result<TokenDTO>().ok(new TokenDTO()));
        controller = new IdoneController(properties, client, users, tokens, redis);
    }

    private Cookie cookie(MockHttpServletResponse response, String suffix) {
        String name = "__Host-xiaozhi-idone-" + suffix;
        String header = response.getHeaders("Set-Cookie").stream()
                .filter(s -> s.startsWith(name + "=") && !s.startsWith(name + "=;"))
                .reduce((a, b) -> b).orElseThrow();
        assertTrue(header.contains("HttpOnly"));
        assertTrue(header.contains("Secure"));
        assertTrue(header.contains("SameSite=Lax"));
        return new Cookie(name, header.substring(name.length() + 1, header.indexOf(';')));
    }

    private MockHttpServletRequest start() throws Exception {
        return start("web");
    }

    private MockHttpServletRequest start(String target) throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setParameter("client", target);
        controller.login(request, response);
        var flow = JsonUtils.parseObject(entries.values().iterator().next(), IdoneController.LoginFlow.class);
        MockHttpServletRequest callback = new MockHttpServletRequest();
        callback.setCookies(cookie(response, "login"));
        callback.setParameter("state", flow.state());
        callback.setParameter("code", "mock-code");
        return callback;
    }

    @Test
    void mobileReturnTargetComesFromLoginFlowRatherThanCallbackParameters() throws Exception {
        MockHttpServletRequest callback = start("mobile");
        callback.setParameter("client", "https://attacker.test");
        MockHttpServletResponse response = new MockHttpServletResponse();
        controller.callback(callback, response);
        assertEquals("https://xiaozhi.test/mobile/#/pages/login/index?authComplete=1", response.getRedirectedUrl());
        assertNotNull(cookie(response, "exchange"));
    }

    @Test
    void callbackAndExchangeAreBoundToCookiesAndConsumedOnce() throws Exception {
        MockHttpServletRequest callback = start();
        MockHttpServletResponse response = new MockHttpServletResponse();
        controller.callback(callback, response);
        assertEquals("https://xiaozhi.test/#/auth/idone/callback", response.getRedirectedUrl());
        assertEquals("no-store", response.getHeader("Cache-Control"));
        assertEquals("no-referrer", response.getHeader("Referrer-Policy"));
        assertEquals(1, entries.size());
        MockHttpServletRequest exchange = new MockHttpServletRequest();
        exchange.setCookies(cookie(response, "exchange"));
        exchange.addHeader("Origin", properties.getAppOrigin());
        assertEquals(0, controller.exchange(exchange, new MockHttpServletResponse()).getCode());
        assertEquals(400, controller.exchange(exchange, new MockHttpServletResponse()).getCode());
        verify(tokens, times(1)).createToken(123L);
        controller.callback(callback, new MockHttpServletResponse());
        verify(client, times(1)).authenticate(anyString(), anyString(), anyString());
        assertTrue(entries.isEmpty());
    }

    @Test
    void wrongStateNeverExchangesCodeOrCreatesUser() throws Exception {
        MockHttpServletRequest request = start();
        request.setParameter("state", "forged-state");
        MockHttpServletResponse response = new MockHttpServletResponse();
        controller.callback(request, response);
        assertEquals("https://xiaozhi.test/#/login?authError=login_failed", response.getRedirectedUrl());
        verify(client, never()).authenticate(anyString(), anyString(), anyString());
        verifyNoInteractions(users, tokens);
    }

    @Test
    void missingBrowserCookieOrExpiredFlowNeverAuthenticates() throws Exception {
        MockHttpServletRequest request = start();
        entries.clear(); // Redis TTL 到期。
        controller.callback(request, new MockHttpServletResponse());
        request.setCookies();
        controller.callback(request, new MockHttpServletResponse());
        verify(client, never()).authenticate(anyString(), anyString(), anyString());
        verifyNoInteractions(users, tokens);
    }

    @Test
    void deniedConsentAndWrongResponseIssuerNeverAuthenticate() throws Exception {
        MockHttpServletRequest request = start();
        request.setParameter("error", "access_denied");
        controller.callback(request, new MockHttpServletResponse());
        request = start();
        request.setParameter("iss", "https://other.test");
        controller.callback(request, new MockHttpServletResponse());
        verify(client, never()).authenticate(anyString(), anyString(), anyString());
        verifyNoInteractions(users, tokens);
    }

    @Test
    void crossOriginExchangeCannotConsumeTicketAndDisabledUserCannotGetToken() throws Exception {
        MockHttpServletResponse callbackResponse = new MockHttpServletResponse();
        controller.callback(start(), callbackResponse);
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setCookies(cookie(callbackResponse, "exchange"));
        request.addHeader("Origin", "https://other.test");
        assertEquals(403, controller.exchange(request, new MockHttpServletResponse()).getCode());
        assertEquals(1, entries.size());
        request.removeHeader("Origin");
        request.addHeader("Origin", properties.getAppOrigin());
        when(users.requireActive(123L)).thenThrow(new xiaozhi.common.exception.RenException("账号已停用"));
        assertThrows(RuntimeException.class, () -> controller.exchange(request, new MockHttpServletResponse()));
        verifyNoInteractions(tokens);
        assertTrue(entries.isEmpty());
    }

    @Test
    void missingExchangeCookieOrExpiredTicketFailsClosed() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("Origin", properties.getAppOrigin());
        assertEquals(400, controller.exchange(request, new MockHttpServletResponse()).getCode());
        request.setCookies(new Cookie("__Host-xiaozhi-idone-exchange", "expired-ticket"));
        assertEquals(400, controller.exchange(request, new MockHttpServletResponse()).getCode());
        verifyNoInteractions(users, tokens);
    }
}

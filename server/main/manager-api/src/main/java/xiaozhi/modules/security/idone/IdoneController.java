package xiaozhi.modules.security.idone;

import java.io.IOException;
import java.time.Duration;
import java.util.Arrays;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.nimbusds.oauth2.sdk.id.State;
import com.nimbusds.oauth2.sdk.pkce.CodeVerifier;
import com.nimbusds.openid.connect.sdk.Nonce;

import cn.hutool.crypto.digest.DigestUtil;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.AllArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import xiaozhi.common.exception.RenException;
import xiaozhi.common.page.TokenDTO;
import xiaozhi.common.utils.JsonUtils;
import xiaozhi.common.utils.Result;
import xiaozhi.modules.security.service.SysUserTokenService;

@Slf4j
@RestController
@AllArgsConstructor
@RequestMapping("/user/idone")
public class IdoneController {
    public record LoginFlow(String state, String nonce, String verifier, String client) {}
    private static final Duration LOGIN_TTL = Duration.ofMinutes(10);
    private static final Duration EXCHANGE_TTL = Duration.ofSeconds(60);
    private final IdoneProperties properties;
    private final IdoneClient client;
    private final IdoneUserService users;
    private final SysUserTokenService tokens;
    private final StringRedisTemplate redis;

    @GetMapping("/login")
    public void login(HttpServletRequest request, HttpServletResponse response) throws IOException {
        noStore(response);
        if (!properties.isConfigured()) {
            response.sendError(503, "IDONE 登录尚未配置");
            return;
        }
        String target = "mobile".equals(request.getParameter("client")) ? "mobile" : "web";
        try {
            String sid = new State().getValue();
            LoginFlow flow = new LoginFlow(new State().getValue(), new Nonce().getValue(), new CodeVerifier().getValue(), target);
            String location = client.authorizationUri(flow.state(), flow.nonce(), flow.verifier()).toString();
            clear(request, response, "login", "flow");
            clear(request, response, "exchange", "ticket");
            redis.opsForValue().set(key("flow", sid), JsonUtils.toJsonString(flow), LOGIN_TTL);
            cookie(response, "login", sid, LOGIN_TTL);
            response.sendRedirect(location);
        } catch (Exception e) {
            fail(response, e, target);
        }
    }

    @GetMapping("/callback")
    public void callback(HttpServletRequest request, HttpServletResponse response) throws IOException {
        noStore(response);
        if (!properties.isConfigured()) {
            response.sendError(503, "IDONE 登录尚未配置");
            return;
        }
        String target = "web";
        try {
            String sid = readCookie(request, "login");
            cookie(response, "login", "", Duration.ZERO);
            String json = sid == null ? null : redis.opsForValue().getAndDelete(key("flow", sid));
            LoginFlow flow = JsonUtils.parseObject(json, LoginFlow.class);
            if (flow != null) target = flow.client();
            String code = request.getParameter("code");
            if (flow == null || !flow.state().equals(request.getParameter("state"))
                    || request.getParameter("error") != null || code == null || code.isBlank()
                    || (request.getParameter("iss") != null && !properties.getIssuer().equals(request.getParameter("iss")))) {
                throw new RenException("IDONE 登录已失效，请重新登录");
            }
            Long userId = users.findOrCreate(client.authenticate(code, flow.nonce(), flow.verifier()));
            clear(request, response, "exchange", "ticket");
            String ticket = new State().getValue();
            redis.opsForValue().set(key("ticket", ticket), userId.toString(), EXCHANGE_TTL);
            cookie(response, "exchange", ticket, EXCHANGE_TTL);
            response.sendRedirect(properties.getAppOrigin() + ("mobile".equals(target)
                    ? "/mobile/#/pages/login/index?authComplete=1" : "/#/auth/idone/callback"));
        } catch (Exception e) {
            fail(response, e, target);
        }
    }

    @PostMapping("/exchange")
    public Result<TokenDTO> exchange(HttpServletRequest request, HttpServletResponse response) {
        noStore(response);
        if (!properties.isConfigured() || !properties.getAppOrigin().equals(request.getHeader("Origin"))) {
            return new Result<TokenDTO>().error(403, "登录来源无效，请重新登录");
        }
        String ticket = readCookie(request, "exchange");
        cookie(response, "exchange", "", Duration.ZERO);
        String userId = ticket == null ? null : redis.opsForValue().getAndDelete(key("ticket", ticket));
        if (userId == null) return new Result<TokenDTO>().error(400, "登录已失效，请重新登录");
        return tokens.createToken(users.requireActive(Long.valueOf(userId)));
    }

    private void fail(HttpServletResponse response, Exception e, String target) throws IOException {
        // 不记录授权码、Token、客户端密钥或上游错误正文。
        log.warn("IDONE login failed: {}", e.getClass().getSimpleName());
        cookie(response, "login", "", Duration.ZERO);
        cookie(response, "exchange", "", Duration.ZERO);
        response.sendRedirect(properties.getAppOrigin() + ("mobile".equals(target)
                ? "/mobile/#/pages/login/index?authError=login_failed" : "/#/login?authError=login_failed"));
    }

    private void clear(HttpServletRequest request, HttpServletResponse response, String name, String type) {
        String value = readCookie(request, name);
        if (value != null) redis.delete(key(type, value));
        cookie(response, name, "", Duration.ZERO);
    }

    private String readCookie(HttpServletRequest request, String suffix) {
        if (request.getCookies() == null) return null;
        return Arrays.stream(request.getCookies()).filter(c -> cookieName(suffix).equals(c.getName()))
                .map(Cookie::getValue).filter(v -> !v.isBlank()).findFirst().orElse(null);
    }

    private String cookieName(String suffix) {
        return (properties.isSecure() ? "__Host-" : "") + "xiaozhi-idone-" + suffix;
    }

    private void cookie(HttpServletResponse response, String suffix, String value, Duration maxAge) {
        response.addHeader(HttpHeaders.SET_COOKIE, ResponseCookie.from(cookieName(suffix), value)
                .httpOnly(true).secure(properties.isSecure()).sameSite("Lax").path("/").maxAge(maxAge).build().toString());
    }

    private static String key(String type, String value) {
        return "xiaozhi:idone:" + type + ":" + DigestUtil.sha256Hex(value);
    }

    private static void noStore(HttpServletResponse response) {
        response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
        response.setHeader("Referrer-Policy", "no-referrer");
    }
}

package xiaozhi.modules.pod.service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

import lombok.extern.slf4j.Slf4j;
import xiaozhi.common.constant.Constant;
import xiaozhi.common.utils.JsonUtils;
import xiaozhi.modules.sys.service.SysParamsService;

/**
 * Lightweight internal client from manager-api to xiaozhi-server's port 8003
 * status API for real-time Pod session state and read-only Botone readiness.
 */
@Slf4j
@Service
public class PodBridgeClient {
    private static final String DEFAULT_VOICE_INTERNAL_URL = "http://server:8003";

    private final SysParamsService params;
    private final String baseUrl;
    private final HttpClient http;

    public PodBridgeClient(SysParamsService params) {
        this.params = params;
        String envUrl = System.getenv("POD_VOICE_INTERNAL_URL");
        this.baseUrl = StringUtils.removeEnd(
                StringUtils.isNotBlank(envUrl) ? envUrl.trim() : DEFAULT_VOICE_INTERNAL_URL, "/");
        this.http = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(2))
                .build();
    }

    public Optional<Map<String, Object>> fetchLiveSessions() {
        String secret = serverSecret();
        if (StringUtils.isBlank(secret)) {
            return Optional.empty();
        }
        try {
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(baseUrl + "/internal/pod/sessions"))
                    .timeout(Duration.ofSeconds(3))
                    .header("Authorization", "Bearer " + secret)
                    .GET()
                    .build();
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200) {
                return Optional.empty();
            }
            return Optional.ofNullable(JsonUtils.parseMap(response.body()));
        } catch (Exception e) {
            log.debug("Failed to fetch live pod sessions: {}", e.getMessage());
            return Optional.empty();
        }
    }

    public Optional<Map<String, Object>> fetchBotoneStatus(String issuer, String subject, String chatModel) {
        String secret = serverSecret();
        if (StringUtils.isBlank(secret) || StringUtils.isAnyBlank(issuer, subject)) {
            return Optional.empty();
        }
        try {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("issuer", issuer);
            payload.put("subject", subject);
            if (StringUtils.isNotBlank(chatModel)) {
                payload.put("chatModel", chatModel.trim());
            }
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(baseUrl + "/internal/pod/botone-status"))
                    .timeout(Duration.ofSeconds(5))
                    .header("Authorization", "Bearer " + secret)
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(JsonUtils.toJsonString(payload)))
                    .build();
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200) {
                return Optional.empty();
            }
            return Optional.ofNullable(JsonUtils.parseMap(response.body()));
        } catch (Exception e) {
            log.debug("Failed to fetch Botone readiness status: {}", e.getMessage());
            return Optional.empty();
        }
    }

    private String serverSecret() {
        String secret = params.getValue(Constant.SERVER_SECRET, true);
        return (StringUtils.isBlank(secret) || "null".equals(secret)) ? null : secret.trim();
    }
}

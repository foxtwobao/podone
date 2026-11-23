package xiaozhi.modules.security.idone;

import static org.junit.jupiter.api.Assertions.*;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.Map;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.nimbusds.oauth2.sdk.AuthorizationCodeGrant;
import com.nimbusds.oauth2.sdk.TokenRequest;
import com.nimbusds.oauth2.sdk.auth.ClientSecretPost;
import com.nimbusds.oauth2.sdk.http.HTTPRequest;
import com.nimbusds.oauth2.sdk.pkce.CodeChallenge;
import com.nimbusds.oauth2.sdk.pkce.CodeChallengeMethod;
import com.nimbusds.oauth2.sdk.pkce.CodeVerifier;
import com.nimbusds.openid.connect.sdk.AuthenticationRequest;
import com.sun.net.httpserver.HttpServer;

import xiaozhi.common.utils.JsonUtils;

class IdoneClientTest {
    private HttpServer server;
    private IdoneProperties properties;
    private IdoneClient client;
    private RSAKey signingKey;
    private String failure;
    private String verifier;
    private int discoveryRequests;

    @BeforeEach
    void setup() throws Exception {
        signingKey = new RSAKeyGenerator(2048).keyID("mock-key").generate();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        String issuer = "http://127.0.0.1:" + server.getAddress().getPort();
        properties = new IdoneProperties();
        properties.setAppOrigin("http://127.0.0.1:3000");
        properties.setIssuer(issuer);
        properties.setDiscoveryUrl(issuer + "/.well-known/xiaozhi/openid-configuration");
        properties.setClientId("mock-client");
        properties.setClientSecret("mock-secret");
        verifier = new CodeVerifier().getValue();
        failure = "";
        server.createContext("/", exchange -> {
            try {
                Map<String, Object> body = switch (exchange.getRequestURI().getPath()) {
                    case "/.well-known/xiaozhi/openid-configuration" -> {
                        discoveryRequests++;
                        yield Map.of("issuer", failure.equals("discovery") ? issuer + "/wrong" : issuer,
                                "authorization_endpoint", issuer + "/authorize", "token_endpoint", issuer + "/token",
                                "userinfo_endpoint", issuer + "/userinfo", "jwks_uri", issuer + "/jwks",
                                "response_types_supported", new String[] {"code"},
                                "subject_types_supported", new String[] {"public"},
                                "id_token_signing_alg_values_supported", new String[] {"RS256"});
                    }
                    case "/jwks" -> Map.of("keys", new Object[] {signingKey.toPublicJWK().toJSONObject()});
                    case "/userinfo" -> {
                        assertEquals("Bearer mock-access-token", exchange.getRequestHeaders().getFirst("Authorization"));
                        yield Map.of("sub", failure.equals("userinfo") ? "different-user" : "mock-user",
                                "preferred_username", "测试用户");
                    }
                    case "/token" -> {
                        HTTPRequest request = new HTTPRequest(HTTPRequest.Method.POST, java.net.URI.create(issuer + "/token"));
                        request.setHeader("Content-Type", "application/x-www-form-urlencoded");
                        request.setQuery(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
                        TokenRequest parsed = TokenRequest.parse(request);
                        AuthorizationCodeGrant grant = (AuthorizationCodeGrant) parsed.getAuthorizationGrant();
                        ClientSecretPost auth = (ClientSecretPost) parsed.getClientAuthentication();
                        assertEquals("mock-client", auth.getClientID().getValue());
                        assertEquals("mock-secret", auth.getClientSecret().getValue());
                        assertEquals("mock-code", grant.getAuthorizationCode().getValue());
                        assertEquals(verifier, grant.getCodeVerifier().getValue());
                        assertEquals(properties.callbackUri(), grant.getRedirectionURI());
                        yield Map.of("access_token", "mock-access-token", "token_type", "Bearer", "id_token", idToken());
                    }
                    default -> throw new IOException("Unexpected mock path");
                };
                byte[] bytes = JsonUtils.toJsonString(body).getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().add("Content-Type", "application/json");
                exchange.sendResponseHeaders(200, bytes.length);
                exchange.getResponseBody().write(bytes);
            } catch (Throwable e) {
                exchange.sendResponseHeaders(500, -1);
            } finally {
                exchange.close();
            }
        });
        server.start();
        client = new IdoneClient(properties);
    }

    private String idToken() throws Exception {
        var claims = new JWTClaimsSet.Builder().issuer(failure.equals("issuer") ? "https://wrong.test" : properties.getIssuer())
                .subject("mock-user").audience(failure.equals("audience") ? "other-client" : "mock-client")
                .issueTime(new Date(System.currentTimeMillis() - 1000))
                .expirationTime(new Date(System.currentTimeMillis() + (failure.equals("expired") ? -300000 : 300000)))
                .claim("nonce", failure.equals("nonce") ? "wrong-nonce" : "mock-nonce").build();
        SignedJWT jwt = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256).keyID("mock-key")
                .type(JOSEObjectType.JWT).build(), claims);
        jwt.sign(new RSASSASigner(failure.equals("signature") ? new RSAKeyGenerator(2048).generate() : signingKey));
        return jwt.serialize();
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }

    @Test
    void authorizationUsesApplicationDiscoveryAndS256AndValidatedIdentity() throws Exception {
        AuthenticationRequest request = AuthenticationRequest.parse(client.authorizationUri("mock-state", "mock-nonce", verifier));
        assertEquals("mock-state", request.getState().getValue());
        assertEquals("mock-nonce", request.getNonce().getValue());
        assertEquals(properties.callbackUri(), request.getRedirectionURI());
        assertEquals(CodeChallengeMethod.S256, request.getCodeChallengeMethod());
        assertEquals(CodeChallenge.compute(CodeChallengeMethod.S256, new CodeVerifier(verifier)), request.getCodeChallenge());
        assertEquals(new IdoneClient.Identity(properties.getIssuer(), "mock-user", "测试用户"),
                client.authenticate("mock-code", "mock-nonce", verifier));
        assertEquals(1, discoveryRequests);
    }

    @ParameterizedTest
    @ValueSource(strings = {"issuer", "audience", "expired", "nonce", "signature", "userinfo", "discovery"})
    void rejectsUntrustedIdentity(String failure) {
        this.failure = failure;
        assertThrows(Exception.class, () -> client.authenticate("mock-code", "mock-nonce", verifier));
    }

    @Test
    void invalidDiscoveryIsNotCached() throws Exception {
        failure = "discovery";
        assertThrows(Exception.class, () -> client.authorizationUri("s", "n", verifier));
        failure = "";
        assertNotNull(client.authorizationUri("s", "n", verifier));
        assertEquals(2, discoveryRequests);
    }

    @Test
    void configRejectsLanHttpCredentialsAndNonOriginAppUrls() {
        properties.setIssuer("http://192.168.10.38:8000");
        assertFalse(properties.isConfigured());
        properties.setIssuer("https://idone.test");
        properties.setDiscoveryUrl("https://idone.test/discovery");
        properties.setAppOrigin("https://xiaozhi.test/");
        assertFalse(properties.isConfigured());
        properties.setAppOrigin("https://xiaozhi.test");
        assertTrue(properties.isConfigured());
        assertThrows(IllegalArgumentException.class, () -> properties.validateEndpoint(java.net.URI.create("https://user:secret@idone.test")));
        assertThrows(IllegalArgumentException.class, () -> properties.validateEndpoint(java.net.URI.create("http://idone.test/token")));
    }
}

package xiaozhi.modules.security.idone;

import java.io.IOException;
import java.net.URI;

import org.springframework.stereotype.Component;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.util.Resource;
import com.nimbusds.oauth2.sdk.AuthorizationCode;
import com.nimbusds.oauth2.sdk.AuthorizationCodeGrant;
import com.nimbusds.oauth2.sdk.ResponseType;
import com.nimbusds.oauth2.sdk.Scope;
import com.nimbusds.oauth2.sdk.TokenRequest;
import com.nimbusds.oauth2.sdk.auth.ClientSecretPost;
import com.nimbusds.oauth2.sdk.auth.Secret;
import com.nimbusds.oauth2.sdk.http.HTTPRequest;
import com.nimbusds.oauth2.sdk.http.HTTPResponse;
import com.nimbusds.oauth2.sdk.id.ClientID;
import com.nimbusds.oauth2.sdk.id.Issuer;
import com.nimbusds.oauth2.sdk.id.State;
import com.nimbusds.oauth2.sdk.pkce.CodeChallengeMethod;
import com.nimbusds.oauth2.sdk.pkce.CodeVerifier;
import com.nimbusds.openid.connect.sdk.AuthenticationRequest;
import com.nimbusds.openid.connect.sdk.Nonce;
import com.nimbusds.openid.connect.sdk.OIDCTokenResponse;
import com.nimbusds.openid.connect.sdk.OIDCTokenResponseParser;
import com.nimbusds.openid.connect.sdk.UserInfoRequest;
import com.nimbusds.openid.connect.sdk.UserInfoResponse;
import com.nimbusds.openid.connect.sdk.claims.IDTokenClaimsSet;
import com.nimbusds.openid.connect.sdk.claims.UserInfo;
import com.nimbusds.openid.connect.sdk.op.OIDCProviderMetadata;
import com.nimbusds.openid.connect.sdk.token.OIDCTokens;
import com.nimbusds.openid.connect.sdk.validators.IDTokenValidator;

@Component
public class IdoneClient {
    public record Identity(String issuer, String subject, String username) {}
    private record Provider(OIDCProviderMetadata metadata, IDTokenValidator validator) {}

    private final IdoneProperties properties;
    private Provider provider;

    public IdoneClient(IdoneProperties properties) {
        this.properties = properties;
    }

    public URI authorizationUri(String state, String nonce, String verifier) throws Exception {
        return new AuthenticationRequest.Builder(new ResponseType("code"), new Scope("openid", "profile", "email"),
                new ClientID(properties.getClientId()), properties.callbackUri())
                .endpointURI(getProvider().metadata().getAuthorizationEndpointURI())
                .state(new State(state)).nonce(new Nonce(nonce))
                .codeChallenge(new CodeVerifier(verifier), CodeChallengeMethod.S256).build().toURI();
    }

    public Identity authenticate(String code, String nonce, String verifier) throws Exception {
        Provider config = getProvider();
        var request = new TokenRequest(config.metadata().getTokenEndpointURI(),
                new ClientSecretPost(new ClientID(properties.getClientId()), new Secret(properties.getClientSecret())),
                new AuthorizationCodeGrant(new AuthorizationCode(code), properties.callbackUri(), new CodeVerifier(verifier)));
        var response = OIDCTokenResponseParser.parse(send(request.toHTTPRequest()));
        if (!response.indicatesSuccess()) throw new IOException("IDONE token exchange failed");
        OIDCTokens tokens = ((OIDCTokenResponse) response.toSuccessResponse()).getOIDCTokens();
        IDTokenClaimsSet claims = config.validator().validate(tokens.getIDToken(), new Nonce(nonce));
        var infoResponse = UserInfoResponse.parse(send(new UserInfoRequest(
                config.metadata().getUserInfoEndpointURI(), tokens.getAccessToken()).toHTTPRequest()));
        if (!infoResponse.indicatesSuccess()) throw new IOException("IDONE UserInfo failed");
        UserInfo info = infoResponse.toSuccessResponse().getUserInfo();
        if (info == null || !claims.getSubject().equals(info.getSubject())) {
            throw new IOException("IDONE UserInfo subject mismatch");
        }
        String name = info.getPreferredUsername();
        if (name == null || name.isBlank()) name = info.getName();
        return new Identity(properties.getIssuer(), claims.getSubject().getValue(), name);
    }

    private synchronized Provider getProvider() throws Exception {
        if (provider != null) return provider;
        properties.validate();
        OIDCProviderMetadata metadata = OIDCProviderMetadata.parse(send(new HTTPRequest(
                HTTPRequest.Method.GET, properties.discoveryUri())).getContent());
        if (!properties.getIssuer().equals(metadata.getIssuer().getValue())) {
            throw new IOException("IDONE Discovery issuer mismatch");
        }
        for (URI endpoint : new URI[] {metadata.getAuthorizationEndpointURI(), metadata.getTokenEndpointURI(),
                metadata.getUserInfoEndpointURI(), metadata.getJWKSetURI()}) {
            properties.validateEndpoint(endpoint);
        }
        if (!metadata.getIDTokenJWSAlgs().contains(JWSAlgorithm.RS256)) {
            throw new IOException("IDONE client must use RS256");
        }
        IDTokenValidator validator = new IDTokenValidator(new Issuer(properties.getIssuer()),
                new ClientID(properties.getClientId()), JWSAlgorithm.RS256, metadata.getJWKSetURI().toURL(), url -> {
                    HTTPResponse response = send(new HTTPRequest(HTTPRequest.Method.GET, URI.create(url.toString())));
                    return new Resource(response.getContent(), "application/json");
                });
        // 只缓存成功的 Discovery；JWKS 的缓存和密钥轮换由 SDK 管理。
        return provider = new Provider(metadata, validator);
    }

    HTTPResponse send(HTTPRequest request) throws IOException {
        properties.validateEndpoint(request.getURI());
        request.setConnectTimeout(5000);
        request.setReadTimeout(10000);
        request.setFollowRedirects(false);
        HTTPResponse response = request.send();
        if (response.getStatusCode() != 200) throw new IOException("IDONE request failed");
        return response;
    }
}

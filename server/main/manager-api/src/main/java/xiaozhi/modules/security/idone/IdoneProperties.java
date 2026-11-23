package xiaozhi.modules.security.idone;

import java.net.URI;
import java.util.Set;

import org.apache.commons.lang3.StringUtils;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@Component
@ConfigurationProperties(prefix = "idone")
public class IdoneProperties {
    private String appOrigin;
    private String issuer;
    private String discoveryUrl;
    private String clientId;
    private String clientSecret;

    public boolean isConfigured() {
        try {
            validate();
            return true;
        } catch (IllegalArgumentException e) {
            return false;
        }
    }

    public void validate() {
        if (StringUtils.isAnyBlank(appOrigin, issuer, clientId, clientSecret)) {
            throw new IllegalArgumentException("IDONE configuration missing");
        }
        URI app = URI.create(appOrigin);
        if (app.getRawQuery() != null || app.getRawFragment() != null
                || (app.getRawPath() != null && !app.getRawPath().isEmpty())) {
            throw new IllegalArgumentException("APP_ORIGIN must be an origin without a trailing slash");
        }
        validateEndpoint(app);
        URI provider = URI.create(issuer);
        if (provider.getRawQuery() != null || issuer.length() > 255) {
            throw new IllegalArgumentException("IDONE issuer must not contain a query or exceed 255 characters");
        }
        validateEndpoint(provider);
        validateEndpoint(discoveryUri());
    }

    public URI callbackUri() {
        return URI.create(appOrigin + "/xiaozhi/user/idone/callback");
    }

    public URI discoveryUri() {
        return StringUtils.isNotBlank(discoveryUrl) ? URI.create(discoveryUrl)
                : URI.create(issuer + (issuer.endsWith("/") ? "" : "/") + ".well-known/openid-configuration");
    }

    public boolean isSecure() {
        return "https".equals(URI.create(appOrigin).getScheme());
    }

    public void validateEndpoint(URI uri) {
        if (uri == null || uri.getHost() == null || uri.getRawUserInfo() != null
                || uri.getRawFragment() != null || !("https".equals(uri.getScheme())
                || ("http".equals(uri.getScheme()) && isLoopback(uri)
                    && isLoopback(URI.create(appOrigin)) && isLoopback(URI.create(issuer))))) {
            throw new IllegalArgumentException("IDONE requires HTTPS (HTTP only for loopback development)");
        }
    }

    private static boolean isLoopback(URI uri) {
        return uri.getHost() != null && Set.of("localhost", "127.0.0.1", "[::1]").contains(uri.getHost());
    }
}

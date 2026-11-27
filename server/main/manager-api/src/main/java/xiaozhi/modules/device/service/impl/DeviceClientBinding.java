package xiaozhi.modules.device.service.impl;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.regex.Pattern;

import cn.hutool.crypto.digest.DigestUtil;

/** The firmware's persisted UUID distinguishes the paired physical unit from its MAC address. */
public final class DeviceClientBinding {
    private static final Pattern UUID = Pattern.compile(
            "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}");

    private DeviceClientBinding() {
    }

    public static String fingerprint(String clientId) {
        return clientId != null && UUID.matcher(clientId).matches() ? DigestUtil.sha256Hex(clientId) : null;
    }

    public static boolean matches(String stored, String presented) {
        return stored != null && presented != null && MessageDigest.isEqual(
                stored.getBytes(StandardCharsets.US_ASCII), presented.getBytes(StandardCharsets.US_ASCII));
    }
}

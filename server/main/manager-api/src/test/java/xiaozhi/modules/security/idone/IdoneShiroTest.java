package xiaozhi.modules.security.idone;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.util.Date;

import org.apache.shiro.authc.IncorrectCredentialsException;
import org.apache.shiro.authc.LockedAccountException;
import org.apache.shiro.mgt.DefaultSecurityManager;
import org.apache.shiro.subject.Subject;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import xiaozhi.modules.security.entity.SysUserTokenEntity;
import xiaozhi.modules.security.oauth2.Oauth2Realm;
import xiaozhi.modules.security.oauth2.Oauth2Token;
import xiaozhi.modules.security.service.ShiroService;
import xiaozhi.modules.sys.entity.SysUserEntity;
import xiaozhi.common.utils.MessageUtils;

class IdoneShiroTest {
    private final ShiroService service = mock(ShiroService.class);
    private final SysUserEntity user = new SysUserEntity();
    private final SysUserTokenEntity token = new SysUserTokenEntity();

    private Subject subject(int admin, int status, long expiry) {
        user.setId(123L);
        user.setUsername("IDONE 用户");
        user.setIdoneIssuer("https://idone.test");
        user.setIdoneSubject("mock-user");
        user.setSuperAdmin(admin);
        user.setStatus(status);
        token.setUserId(123L);
        token.setExpireDate(new Date(expiry));
        when(service.getUser(123L)).thenReturn(user);
        when(service.getByToken("application-token")).thenReturn(token);
        Oauth2Realm realm = new Oauth2Realm();
        ReflectionTestUtils.setField(realm, "shiroService", service);
        return new Subject.Builder(new DefaultSecurityManager(realm)).buildSubject();
    }

    @Test
    void idoneUsersOnlyGetLocalPermissions() {
        Subject ordinary = subject(0, 1, System.currentTimeMillis() + 60000);
        ordinary.login(new Oauth2Token("application-token"));
        assertTrue(ordinary.isPermitted("sys:role:normal"));
        assertFalse(ordinary.isPermitted("sys:role:superAdmin"));
        Subject admin = subject(1, 1, System.currentTimeMillis() + 60000);
        admin.login(new Oauth2Token("application-token"));
        assertTrue(admin.isPermitted("sys:role:superAdmin"));
    }

    @Test
    void disabledOrExpiredSessionsAreRejected() {
        try (var messages = mockStatic(MessageUtils.class)) {
            messages.when(() -> MessageUtils.getMessage(org.mockito.ArgumentMatchers.anyInt())).thenReturn("mock failure");
            Subject disabled = subject(0, 0, System.currentTimeMillis() + 60000);
            assertThrows(LockedAccountException.class, () -> disabled.login(new Oauth2Token("application-token")));
            Subject expired = subject(0, 1, System.currentTimeMillis() - 1000);
            assertThrows(IncorrectCredentialsException.class, () -> expired.login(new Oauth2Token("application-token")));
        }
    }
}

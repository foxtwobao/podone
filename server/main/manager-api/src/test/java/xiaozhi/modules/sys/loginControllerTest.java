package xiaozhi.modules.sys;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import xiaozhi.modules.security.controller.LoginController;
import xiaozhi.modules.security.idone.IdoneProperties;
import xiaozhi.modules.security.service.SysUserTokenService;
import xiaozhi.modules.security.user.SecurityUser;
import xiaozhi.modules.sys.service.SysParamsService;

class loginControllerTest {
    private final SysUserTokenService tokens = mock(SysUserTokenService.class);
    private final LoginController controller = new LoginController(tokens, mock(SysParamsService.class), new IdoneProperties());

    @Test
    void localLoginAndPasswordEndpointsAreRemoved() throws Exception {
        var mvc = MockMvcBuilders.standaloneSetup(controller).build();
        for (String path : new String[] {"login", "register", "smsVerification"}) {
            mvc.perform(post("/user/" + path).contentType("application/json").content("{}"))
                    .andExpect(status().isNotFound());
        }
        for (String path : new String[] {"change-password", "retrieve-password"}) {
            mvc.perform(put("/user/" + path).contentType("application/json").content("{}"))
                    .andExpect(status().isNotFound());
        }
        mvc.perform(get("/user/captcha")).andExpect(status().isNotFound());
        verifyNoInteractions(tokens);
    }

    @Test
    void publicConfigDoesNotRequirePasswordKeysOrExposeSecrets() {
        var config = controller.pubConfig().getData();
        assertEquals("idone", config.get("loginMethod"));
        assertEquals(false, config.get("idoneEnabled"));
        assertEquals(false, config.get("allowUserRegister"));
        assertFalse(config.containsKey("sm2PublicKey"));
        assertFalse(config.containsKey("clientSecret"));
    }

    @Test
    void logoutInvalidatesTheAuthenticatedUsersToken() {
        try (var security = mockStatic(SecurityUser.class)) {
            security.when(SecurityUser::getUserId).thenReturn(123L);
            assertEquals(0, controller.logout().getCode());
            verify(tokens).logout(123L);
        }
    }
}

package xiaozhi.modules.security.idone;

import org.springframework.stereotype.Service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.toolkit.IdWorker;

import lombok.AllArgsConstructor;
import xiaozhi.common.exception.RenException;
import xiaozhi.modules.sys.dao.SysUserDao;
import xiaozhi.modules.sys.entity.SysUserEntity;

@Service
@AllArgsConstructor
public class IdoneUserService {
    private final SysUserDao users;

    public Long findOrCreate(IdoneClient.Identity identity) {
        if (identity.subject() == null || identity.subject().isBlank() || identity.subject().length() > 255
                || identity.issuer() == null || identity.issuer().isBlank() || identity.issuer().length() > 255) {
            throw new RenException("IDONE 身份无效");
        }
        SysUserEntity user = new SysUserEntity();
        user.setId(IdWorker.getId());
        user.setIdoneIssuer(identity.issuer());
        user.setIdoneSubject(identity.subject());
        String name = identity.username();
        if (name == null || name.isBlank()) name = identity.subject();
        user.setUsername(name.substring(0, name.offsetByCodePoints(0, Math.min(50, name.codePointCount(0, name.length())))));
        users.upsertIdoneUser(user);
        return requireActive(users.selectOne(new LambdaQueryWrapper<SysUserEntity>()
                .eq(SysUserEntity::getIdoneIssuer, identity.issuer())
                .eq(SysUserEntity::getIdoneSubject, identity.subject())));
    }

    public Long requireActive(Long userId) {
        return requireActive(users.selectById(userId));
    }

    private Long requireActive(SysUserEntity user) {
        if (user == null || !Integer.valueOf(1).equals(user.getStatus())) {
            throw new RenException("账号不存在或已停用");
        }
        return user.getId();
    }
}

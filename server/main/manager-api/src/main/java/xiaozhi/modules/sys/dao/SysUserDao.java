package xiaozhi.modules.sys.dao;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Insert;

import xiaozhi.common.dao.BaseDao;
import xiaozhi.modules.sys.entity.SysUserEntity;

/**
 * 系统用户
 */
@Mapper
public interface SysUserDao extends BaseDao<SysUserEntity> {
    // 同一身份的并发首次登录只建一个用户，不覆盖权限或停用状态。
    @Insert("""
            INSERT INTO sys_user (id, username, password, super_admin, status,
                idone_issuer, idone_subject, create_date, update_date)
            VALUES (#{id}, #{username}, NULL, 0, 1, #{idoneIssuer}, #{idoneSubject}, NOW(), NOW())
            ON DUPLICATE KEY UPDATE username = VALUES(username), update_date = NOW()
            """)
    int upsertIdoneUser(SysUserEntity user);
}

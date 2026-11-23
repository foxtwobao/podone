# IDONE 登录接入

Web 与移动 H5 统一使用 IDONE 登录。Java 后端完成 OIDC 身份验证，在 `sys_user` 保存精确的 `(idone_issuer, idone_subject)`，再签发现有小智应用 Token。Shiro 继续检查 Token、账号停用状态与管理员权限；设备、Python 语音服务和服务密钥认证保持原有流程。

本地登录、注册、验证码、找回密码、修改密码及管理员重置密码接口已移除。账号注册和密码管理在 IDONE 完成。首次登录创建普通用户，密码为空；同名用户不会合并，没有首个用户自动成为管理员或旧账号迁移逻辑。

## 部署配置

复制根目录 `.env.local.example` 为 `.env.local` 并填写数据库密码和 IDONE 配置。已有 `.env.local` 时只补充缺少的参数。

| 参数 | 含义 |
| --- | --- |
| `APP_ORIGIN` | 浏览器访问的站点 origin，例如 `https://xiaozhi.example.com`，不带尾斜杠或路径 |
| `IDONE_ISSUER` | 预期身份签发者，必须与 Discovery 和 ID Token 的 issuer 完全相同 |
| `IDONE_DISCOVERY_URL` | 本项目独立应用的 Discovery URL；留空使用 issuer 下标准 Discovery |
| `IDONE_CLIENT_ID` | 本项目独立 OIDC 客户端 ID |
| `IDONE_CLIENT_SECRET` | 客户端密钥，仅交付后端 |

IDONE 应用登记唯一回调：

```text
https://xiaozhi.example.com/xiaozhi/user/idone/callback
```

应用使用授权码流程、PKCE S256、`openid profile email` scope、`client_secret_post` 和 RS256 ID Token。使用应用专属 Discovery/JWKS，不复用 CreativeOne 客户端凭据。SDK 负责 [ID Token 的签名及声明校验](https://connect2id.com/blog/how-to-validate-an-openid-connect-id-token)。UserInfo 的 sub 必须与已验证 ID Token 一致。

后端使用 MySQL 8、Redis 6.2+（本地 Compose 为 Redis 7）。Liquibase 自动增加大小写敏感、保留尾部空格差异的身份字段及唯一索引；username 改作非唯一展示名称。

```bash
docker compose --env-file .env.local -f compose.local.yaml up -d --build
```

Docker 镜像同时发布桌面 Web `/` 和移动 H5 `/mobile/`。反向代理将两者以及 `/xiaozhi/` 放在 `APP_ORIGIN` 同一个 HTTPS 站点；移动 H5 使用 `/xiaozhi` 作为 API 地址。本轮接入范围为移动网页，不包含 Android/iOS 原生 App 或小程序登录。

本地 HTTP 开发仅允许应用、issuer 及 HTTP 端点全部使用回环地址。局域网和服务器使用 HTTPS。自签名 CA 需加入 Java 的信任库，并让浏览器信任；不能关闭证书验证。外层反向代理也应避免记录认证 query/body；镜像 Nginx 的 API access log 仅记录路径。

配置缺失时公共配置正常返回，但 IDONE 登录不可用，不会恢复本地密码登录。

## 当前 lab 配置

- 桌面 Web：`https://bot.lab.home.arpa/`，移动 H5：`https://bot.lab.home.arpa/mobile/`。
- IDONE 使用 `https://idone.lab.home.arpa` 的独立应用 `admin/xiaozhi`，组织为 `AgentONE`；唯一回调为 `https://bot.lab.home.arpa/xiaozhi/user/idone/callback`。
- 管理员为用户指定的 `admin@agentone.wrok`，按 IDONE 中核验的精确 issuer/sub 创建本地管理员；没有修改其 IDONE 账户或给其他用户授予管理员权限。
- `.env.local` 保存运行配置与独立客户端凭据；`.lab/java-cacerts` 保存包含本机 Caddy 根证书的 Java 信任库，`compose.lab.yaml` 只读挂载。`.lab/` 已从 Git 和 Docker 构建上下文排除。
- Caddy 配置模板为 `deploy/bot.lab.caddy`，已安装至 `/etc/caddy/conf.d/bot.caddy` 并由主配置导入。Docker 和 Caddy 已启用开机启动，容器使用 `unless-stopped` 重启策略。

后续启动或更新 lab 时执行：

```bash
bash deploy/start-lab.sh
# 等价命令：
docker compose --env-file .env.local -f compose.local.yaml -f compose.lab.yaml up -d --build
```

数据库、旧环境配置、IDONE 应用配置及 Caddy 原配置的备份位于忽略目录 `.lab/backups/20261017-idone/`，旧镜像保留为 `tokenone-xiaozhi-web:pre-idone-20261017`。构建和启动时不要省略 lab 叠加配置，否则 Java 无法信任本地身份服务的 CA。

## 管理员初始化

目标管理员先正常登录一次，再由数据库运维明确指定其 issuer/sub。先查询并确认唯一目标用户，再执行权限变更；IDONE 角色或用户名不会自动赋予小智管理员权限。

```sql
SELECT id, username, super_admin, status
FROM sys_user
WHERE idone_issuer = '实际 issuer' AND idone_subject = '实际 sub';

UPDATE sys_user SET super_admin = 1
WHERE idone_issuer = '实际 issuer' AND idone_subject = '实际 sub' AND status = 1;
```

## 登录和退出行为

- 服务端登录事务保存在 Redis，有效期 10 分钟，使用 HttpOnly、SameSite=Lax Cookie 绑定发起浏览器。HTTPS 下使用 Secure 和 `__Host-` Cookie。
- 回调校验 state、nonce、PKCE、issuer、audience、签名、有效期与 UserInfo subject；登录事务原子消费，拒绝过期或重复回调。
- 回调成功后设置 60 秒一次性 HttpOnly Cookie。前端 POST 交换应用 Token，服务端校验 Origin 并原子消费凭据；响应禁止缓存，URL 不携带长期凭据。失败后重新登录，不自动重放交换请求。
- Web 和 H5 复用同一回调，返回目标仅取自服务端登录事务中的固定客户端标记，不接受任意返回 URL。
- 应用 Token 沿用原有 12 小时有效期和每用户一个 Token 的语义。退出使该用户的服务端 Token 失效，并清理当前前端状态；其他已登录客户端的同一 Token 也会失效。退出本应用不退出 IDONE 的其他应用。
- Web 与 H5 使用不同的浏览器存储键，避免 Vuex 与 uni-app 存储格式互相覆盖。

## 验证

```bash
cd main/manager-api
mvn test -DskipTests=false -Dtest=IdoneClientTest,IdoneControllerTest,IdoneShiroTest,loginControllerTest,ShiroConfigTest

cd ../manager-web
npm test

cd ../manager-mobile
pnpm test:auth
pnpm build:h5
```

自动化使用隔离的模拟 OIDC 和测试身份；数据库验证使用独立 MySQL 容器。生产验收需管理员补齐独立客户端、回调、站点与 CA 后，手动完成真实 IDONE 登录，验证普通用户、管理员、停用账号、退出及实际设备/智能体操作。自动化通过不等于真实身份源或部署已验收。

代码验证：26 项后端认证/权限测试、73 项 Web 测试及 4 项 H5 认证测试通过；Web 和 H5 生产构建、H5 类型检查、Compose 配置与 Nginx 配置检查通过。隔离 MySQL 验证了迁移、24 次并发建号、身份精确匹配和权限/停用状态保留。独立浏览器验证了模拟接口下的 Web/H5 登录、H5 退出和失效凭据提示。

lab 部署已完成完整 Docker 镜像构建与管理端替换，数据库迁移成功，四个服务健康。已核验 HTTPS 页面、应用专属 Discovery/JWKS、Web/H5 的实际 IDONE 授权跳转、精确回调、PKCE 与安全 Cookie，以及未登录接口拒绝访问。没有自动登录真实账号；最终登录回调与管理员功能待用户在浏览器完成登录后验收。

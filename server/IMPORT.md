# 服务端迁入记录

`server/` 是从本地 `tokenone_xiaozhiserver` 仓库的工作区整体复制过来的，包含当时尚未提交的改动。

2026-11-23 起 podone 是唯一主仓，源仓库放弃，不再在那边开发。`server/.git` 已删除，`server/` 作为普通目录进入 podone 的首次提交。删除前的完整历史（4 个 ref）备份为仓库外的 `/Volumes/ext/Projects/podone-server-history.bundle`，用 `git bundle verify` 校验过，不提交。

## 合并上游

在 podone 根目录加上游 remote，按子目录合并：

```bash
git remote add xiaozhi-upstream https://github.com/xinnan-tech/xiaozhi-esp32-server.git
git fetch xiaozhi-upstream
git merge -X subtree=server/ xiaozhi-upstream/main
```

合并后更新 `UPSTREAM.json` 里已合并的上游提交。

## 来源

- 仓库：`foxtwobao/tokenone_xiaozhiserver`
- 分支：`codex/idone-integration`
- 提交：`9d9c8eb1`（2026-10-08，ci: build and publish application images to Docker Hub）
- 迁入日期：2026-11-23

## 复制时排除的内容

- `.env.local`：本地部署的真实配置，含数据库密码与 IDONE 客户端密钥，不入库。
- `.lab/`：实验室环境的证书、备份与脚本，不入库。
- `models/`：约 901 MB 的模型文件，按需另行获取。其中 `SenseVoiceSmall` 与 `snakers4_silero-vad` 的 18 个小文件在源仓库里已跟踪，建仓前已按源仓库 `git ls-files` 清单拷回；`model.pt` 等被忽略的大文件仍不在这里。
- `__pycache__/`、`.pytest_cache/`、`tmp/`、各前端的 `node_modules/` 与 `target/`：构建产物与缓存。

## 未提交的改动

迁入时工作区有 61 个已修改文件和若干未跟踪文件，分属两块工作：

- IDONE 登录接入。涉及 `manager-api` 的 `security/idone` 包、`manager-web` 的回调页与 `manager-mobile` 的登录改造，说明见 `docs/idone-integration.md`。
- Reseller 鉴权方案。只写了方案，代码尚未实施，见 `docs/reseller-integration-plan.md`。

## 密钥检查

迁入后扫描了全部已跟踪与未跟踪文件。仓库内的 `.env` 都是上游自带的前端构建配置，只含页面标题、接口前缀这类公开项；`.env.local.example` 里的凭据位置均为占位符。没有发现真实的客户端密钥、证书或密码。

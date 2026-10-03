# IPTVSCR 定时触发器（Cloudflare Worker）

每天**北京时间 17:00** 通过 GitHub API 触发 `tansjun/IPTVSCR` 的 `main.yml` workflow，
绕开 GitHub Actions `schedule` 的"尽力而为"延迟（曾出现延迟近 5 小时）。

## 部署步骤

### 1. 创建 GitHub PAT（一次性）

1. 打开 https://github.com/settings/tokens
2. **Generate new token (classic)**
3. Note 随便填（如 `iptvscr-cron-trigger`），Expiration 建议选 90 天
4. 勾选权限：`public_repo`（本仓库是 public；若以后转私有，需改选 `repo`）
5. **Generate token**，立即复制保存（只显示一次）

### 2. 登录 Cloudflare 并部署

在本目录下执行（需要本机已装 Node.js，或用 `npx`）：

```bash
npx wrangler@latest login
npx wrangler@latest deploy
npx wrangler@latest secret put GITHUB_TOKEN
# 粘贴第 1 步的 PAT
```

部署成功后终端会输出 Worker 的 URL（形如 `https://iptvscr-trigger.<你的子域>.workers.dev`）。

### 3. 验证

```bash
# 查看在线状态
curl https://iptvscr-trigger.<你的子域>.workers.dev/

# 手动触发一次（应返回 {"ok":true,"status":204}）
curl -X POST https://iptvscr-trigger.<你的子域>.workers.dev/
```

`204` 表示已受理；`401` 表示 PAT 无效；`422` 表示 workflow 未声明 `workflow_dispatch`。

触发后到 https://github.com/tansjun/IPTVSCR/actions 应能看到新的 Daily Update run。

## 架构

```
Cloudflare Cron (09:00 UTC = 北京 17:00) 主触发
   │  HTTPS POST + PAT（attempt=0）
   ▼
GitHub API workflow_dispatch → runner 执行 IPTVSCR.py → 提交 → 仅当 .txt 有改动才部署 Pages
   │
   └─ 空产出（脚本退出码 42，job 保持绿色不报红）
        │  POST /result {attempt}
        ▼
      Worker 写 KV 调度单（10 分钟后）
        │  Cron "*/10 * * * *" 扫描到期
        ▼
      重新 dispatch（attempt=1 → 仍空 → attempt=2 → 不再重试，共 3 次机会）
```

> - 已移除 GitHub cron 兜底（其"尽力而为"延迟不可控）；含兜底的稳定版见 git 标签 `v1.0.0`。
> - 空产出不视为失败（防止失败邮件轰炸）：job 保持绿色，由 Worker 自动重试，最多 2 次。
> - 需要 KV 命名空间（binding `STATE`，创建后把 id 填入 wrangler.jsonc）。

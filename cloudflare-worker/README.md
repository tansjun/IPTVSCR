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

## 兜底机制

main.yml 保留 GitHub 原生 cron `17:10`（UTC 09:10）作为兜底，
带"当日去重守卫"：若 main 上 hi-live.txt 已包含今天日期则秒退，不重复抓取。

## 架构

```
Cloudflare Cron (09:00 UTC = 北京 17:00)
   │  HTTPS POST + PAT
   ▼
GitHub API workflow_dispatch → runner 执行 IPTVSCR.py → 提交 → 自动部署 Pages
   ▲
   └── 兜底：GitHub cron 17:10 + 当日去重守卫（Worker 挂了/当天漏跑时补上）
```

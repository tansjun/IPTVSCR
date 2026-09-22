/**
 * IPTVSCR 定时触发器（Cloudflare Worker）
 *
 * 作用：每天北京时间 17:00（UTC 09:00）通过 GitHub API 触发
 *       tansjun/IPTVSCR 仓库的 main.yml workflow_dispatch，
 *       绕开 GitHub Actions schedule 的"尽力而为"延迟。
 *
 * 依赖环境变量（Secret）：
 *   GITHUB_TOKEN  —— 具有 public_repo 权限的 GitHub PAT（仓库 Secrets 里也有同名概念，
 *                     这里是 Worker 的 secret，不是仓库 secret）
 * 可选变量（vars）：
 *   GITHUB_OWNER   默认 tansjun
 *   GITHUB_REPO    默认 IPTVSCR
 *   GITHUB_WORKFLOW 默认 main.yml
 */

export default {
  /**
   * Cron 触发入口：wrangler.jsonc 里配置 "0 9 * * *"（UTC）= 北京时间每天 17:00
   */
  async scheduled(event, env, ctx) {
    const result = await triggerDispatch(env);
    console.log(`[scheduled ${event.cron}] ${JSON.stringify(result)}`);
  },

  /**
   * HTTP 测试入口：
   *   GET  /  —— 查看触发器在线状态
   *   POST /  —— 手动立即触发一次（便于验证）
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'POST') {
      const result = await triggerDispatch(env);
      return json(result, result.ok ? 200 : 500);
    }
    return json(
      {
        ok: true,
        message: 'IPTVSCR 定时触发器在线',
        cron: '0 9 * * * (UTC) = 每天北京时间 17:00',
        usage: 'POST / 手动触发一次',
        lastTrigger: env.LAST_TRIGGER || null
      },
      200
    );
  }
};

/**
 * 调用 GitHub API 触发 workflow_dispatch
 * 成功返回 { ok: true, status: 204 }，失败返回错误详情
 */
async function triggerDispatch(env) {
  const token = env.GITHUB_TOKEN;
  const owner = env.GITHUB_OWNER || 'tansjun';
  const repo = env.GITHUB_REPO || 'IPTVSCR';
  const workflow = env.GITHUB_WORKFLOW || 'main.yml';

  if (!token) {
    return { ok: false, status: 500, detail: 'GITHUB_TOKEN 未配置：请运行 wrangler secret put GITHUB_TOKEN' };
  }

  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'iptvscr-cron-trigger'
      },
      body: JSON.stringify({ ref: 'main' })
    });

    if (resp.status === 204) {
      env.LAST_TRIGGER = new Date().toISOString();
      return { ok: true, status: 204, time: new Date().toISOString() };
    }

    // 常见错误：401 token 失效 / 422 workflow 未声明 workflow_dispatch 或 ref 不存在
    const text = await resp.text();
    return { ok: false, status: resp.status, detail: text.slice(0, 500) };
  } catch (err) {
    return { ok: false, status: 0, detail: String(err && err.message || err) };
  }
}

function json(data, status) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

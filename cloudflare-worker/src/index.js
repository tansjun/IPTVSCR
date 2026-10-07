/**
 * IPTVSCR 定时触发器 + 空产出重试调度（Cloudflare Worker）
 *
 * 触发：
 *   - Cron "0 9 * * *"（UTC）= 每天北京时间 17:00 主触发（dispatch attempt=0）
 *   - Cron "* /10 * * * *" 扫描 KV 重试队列，到期则重新 dispatch（最多 2 次重试，共 3 次机会）
 *     —— 同时兼作主触发兜底：09:15-09:59 UTC 内若发现当天尚未触发，自动补发一次，
 *        防止主 cron 事件被 Cloudflare 延迟/漏送（免费计划 cron 为 best-effort）
 * 反馈：
 *   - POST /result {attempt:"0"|"1"|"2"} —— workflow 空产出时调用；
 *     attempt < 2 时写入 KV 调度单，10 分钟后重新 dispatch attempt+1
 * 手动：
 *   - POST / 立即触发一次（可选 JSON body {attempt}）
 *   - GET  / 状态页（含上次触发时间）
 *
 * Secret: GITHUB_TOKEN（public_repo 权限的 GitHub PAT）
 * KV: STATE（重试调度单 key=retry:<owner>/<repo>；主触发去重 key=main:lastdate；
 *     上次触发时间 key=meta:lastmain）
 */

const RETRY_DELAY_MS = 10 * 60 * 1000; // 10 分钟
const MAX_RETRY = 2; // 最多重试 2 次（共 3 次机会：attempt 0/1/2）
// 主触发兜底窗口：UTC 09:15 ~ 09:59（主 cron 为 09:00；15 分钟宽限后仍未触发则补发）
const BACKSTOP_START_MIN = 9 * 60 + 15;
const BACKSTOP_END_MIN = 9 * 60 + 59;

export default {
  /**
   * Cron 触发入口：wrangler.jsonc 里配置
   *   "0 9 * * *"   —— 每天主触发（UTC 09:00 = 北京 17:00）
   *   "* /10 * * * *" —— 重试扫描 + 主触发兜底
   */
  async scheduled(event, env, ctx) {
    let result;
    if (event.cron === "*/10 * * * *") {
      const retry = await drainRetryQueue(env);
      const backstop = await maybeBackstop(env);
      result = { retry, backstop };
    } else {
      result = await ensureDailyDispatch(env, 'main');
    }
    console.log(`[scheduled ${event.cron}] ${JSON.stringify(result)}`);
  },

  /**
   * HTTP 入口：
   *   GET  /        —— 在线状态
   *   POST /        —— 手动立即触发一次（可选 attempt）
   *   POST /result  —— workflow 空产出反馈，登记 10 分钟后重试
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'POST') {
      let attempt = 0;
      let raw = '';
      try {
        raw = await request.text(); // 先取原始文本，兼容各类代理/网关
      } catch (_) { raw = ''; }
      try {
        if (raw) attempt = parseInt(JSON.parse(raw).attempt, 10) || 0;
      } catch (_) { /* 非 JSON body 则忽略 */ }
      if (!attempt) {
        attempt = parseInt(url.searchParams.get('attempt'), 10) || 0;
      }

      if (url.pathname === '/result') {
        const r = await scheduleRetry(env, attempt);
        r.received = { raw: raw.slice(0, 80), ct: request.headers.get('content-type') };
        return json(r, r.ok ? 200 : 500);
      }
      const result = await triggerDispatch(env, attempt);
      return json(result, result.ok ? 200 : 500);
    }

    return json(
      {
        ok: true,
        message: 'IPTVSCR 定时触发器在线',
        crons: [
          '0 9 * * * (UTC) = 每天北京时间 17:00 主触发',
          '*/10 * * * * = 重试扫描 + 主触发兜底（09:15-09:59 UTC 自动补发）'
        ],
        usage: 'POST / 手动触发；POST /result {attempt} 空产出反馈；GET / 状态',
        lastTrigger: await env.STATE.get('meta:lastmain') || null,
        lastMainDate: await env.STATE.get('main:lastdate') || null
      },
      200
    );
  }
};

/**
 * 空产出反馈：attempt < 2 时写 KV 调度单，10 分钟后重触发 attempt+1
 */
async function scheduleRetry(env, attempt) {
  if (!env.STATE) {
    return { ok: false, status: 500, detail: 'KV (STATE) 未绑定' };
  }
  if (attempt >= MAX_RETRY) {
    return { ok: true, status: 200, detail: `attempt=${attempt} 已达重试上限，不再重试` };
  }
  const key = retryKey(env);
  const nextAttempt = attempt + 1;
  const entry = {
    dispatch_attempt: nextAttempt,
    next_retry_at: Date.now() + RETRY_DELAY_MS,
    created_at: new Date().toISOString()
  };
  await env.STATE.put(key, JSON.stringify(entry));
  return {
    ok: true,
    status: 200,
    detail: `已登记重试：10 分钟后 dispatch attempt=${nextAttempt}`
  };
}

/**
 * 每 10 分钟 cron：扫描 KV 调度单，到期则 dispatch 并清除
 */
async function drainRetryQueue(env) {
  if (!env.STATE) {
    return { ok: false, status: 500, detail: 'KV (STATE) 未绑定' };
  }
  const key = retryKey(env);
  const raw = await env.STATE.get(key);
  if (!raw) {
    return { ok: true, status: 200, detail: '无待重试任务' };
  }

  let entry;
  try {
    entry = JSON.parse(raw);
  } catch (_) {
    await env.STATE.delete(key);
    return { ok: false, status: 500, detail: '调度单损坏，已清除' };
  }

  if (Date.now() < entry.next_retry_at) {
    const remain = Math.ceil((entry.next_retry_at - Date.now()) / 1000);
    return { ok: true, status: 200, detail: `未到重试时间（剩 ${remain}s）` };
  }

  await env.STATE.delete(key); // 先清除，防止重试 run 再次反馈时叠加
  const result = await triggerDispatch(env, entry.dispatch_attempt);
  return {
    ok: result.ok,
    status: result.status,
    detail: `重试 dispatch attempt=${entry.dispatch_attempt}`,
    ...result
  };
}

function retryKey(env) {
  const owner = env.GITHUB_OWNER || 'tansjun';
  const repo = env.GITHUB_REPO || 'IPTVSCR';
  return `retry:${owner}/${repo}`;
}

function utcDateStr(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

/**
 * 每天只触发一次主 run（attempt=0）：
 *   - 先查 KV main:lastdate，当天已触发则跳过（防止主 cron 与兜底重复 dispatch）
 *   - 触发成功后才写 KV，失败留给下一次兜底尝试
 */
async function ensureDailyDispatch(env, source) {
  if (!env.STATE) {
    return { ok: false, status: 500, detail: 'KV (STATE) 未绑定' };
  }
  const today = utcDateStr();
  const last = await env.STATE.get('main:lastdate');
  if (last === today) {
    return { ok: true, status: 200, detail: `今日已触发（${source} 跳过，lastdate=${last}）` };
  }
  const result = await triggerDispatch(env, 0);
  if (result.ok) {
    await env.STATE.put('main:lastdate', today);
    await env.STATE.put('meta:lastmain', new Date().toISOString());
  }
  return { ...result, source };
}

/**
 * 主触发兜底：仅在 UTC 09:15-09:59 窗口内尝试补发（主 cron 09:00 事件漏送时生效）
 */
async function maybeBackstop(env) {
  const d = new Date();
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  if (mins < BACKSTOP_START_MIN || mins > BACKSTOP_END_MIN) {
    return { ok: true, status: 200, detail: '非兜底窗口，跳过' };
  }
  return ensureDailyDispatch(env, 'backstop');
}

/**
 * 调用 GitHub API 触发 workflow_dispatch（带 attempt 输入）
 * 成功返回 { ok: true, status: 204 }，失败返回错误详情
 */
async function triggerDispatch(env, attempt = 0) {
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
      body: JSON.stringify({ ref: 'main', inputs: { attempt: String(attempt) } })
    });

    if (resp.status === 204) {
      env.LAST_TRIGGER = new Date().toISOString();
      return { ok: true, status: 204, attempt, time: new Date().toISOString() };
    }

    // 常见错误：401 token 失效 / 422 workflow 未声明 workflow_dispatch 或 inputs 不匹配
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

// stdu-cli 守护进程：常驻一个已登录的浏览器，所有命令复用同一个会话。
//
// 为什么要它：
//   1) CAS/WebVPN 的会话 cookie 是「会话级」的，浏览器一关就没了 —— 常驻不关就不会掉线。
//   2) 启动一次浏览器要 2~3 秒，每条命令都付一遍太慢 —— 常驻后单次查询只剩网络往返。
//   3) 只有首次（或换绑）才需要真人过一次验证码。
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AUTH_CHECK_URL } from './config.js';
import { getDaemonFile, getStduHome } from './modules/paths.js';
import { clearStorageState } from './modules/session-store.js';
import { classifyAuthPage, waitForLogin } from './modules/auth-detector.js';
import { persistSession } from './modules/session.js';
import { openSession } from './modules/session.js';
import { readPageState } from './modules/page.js';
import { queryCourse } from './modules/course.js';
import { queryGrade } from './modules/grade.js';
import { queryEmptyRooms } from './modules/room.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const IDLE_EXIT_MS = Number(process.env.STDU_DAEMON_IDLE_MS ?? 30 * 60 * 1000); // 30 分钟无人用自动退出

let session = null;
let lastUsed = Date.now();
let booting = null; // 并发启动时的共享 promise

async function getSession({ interactive = true } = {}) {
  if (session) return session;
  if (!booting) {
    booting = (async () => {
      // 先尝试无头启动（快、无窗口）；若没登录态，再换成有头重开去弹认证页
      const s = await openSession({ headless: true });
      session = s;
      lastUsed = Date.now();
      if (!s.auth.loggedIn && interactive) {
        await upgradeToInteractive();
      }
      return session;
    })().finally(() => { booting = null; });
  }
  return booting;
}

// 无头 → 有头：弹认证页让真人登录。cookie 会先落盘，重开时注入回去。
async function upgradeToInteractive() {
  if (!session) return;
  await persistSession(session).catch(() => {});
  await session.context.close().catch(() => {});
  session = null;

  const interactive = await openSession({ headless: false });
  session = interactive;
  if (interactive.auth.loggedIn) { await persistSession(interactive).catch(() => {}); return; }

  await interactive.page.goto(AUTH_CHECK_URL, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  process.stderr.write('[stdu-cli] 请在弹出的浏览器里完成统一认证（学号/密码/验证码），只需这一次。\n');
  const result = await waitForLogin(interactive.page, {});
  if (!result.loggedIn) {
    const error = new Error('登录未完成或超时。');
    error.code = 'LOGIN_TIMEOUT';
    throw error;
  }
  await persistSession(interactive).catch(() => {});
}

async function ensureLogged() {
  const s = await getSession();
  if (s.auth.loggedIn) return s;
  await upgradeToInteractive();
  return session;
}

const HANDLERS = {
  async course(params) {
    const s = await ensureLogged();
    return queryCourse(s.page, params);
  },
  async grade(params) {
    const s = await ensureLogged();
    return queryGrade(s.page, params);
  },
  async room(params) {
    const s = await ensureLogged();
    return queryEmptyRooms(s.page, params);
  },
  async status() {
    const s = session;
    if (!s) return { running: true, loggedIn: null, browser: null };
    const auth = classifyAuthPage(await readPageState(s.page));
    return { running: true, loggedIn: auth.loggedIn, url: s.page.url(), idleMs: Date.now() - lastUsed };
  },
  // 换绑：清掉 cookie + profile 里的登录态，下次请求会重新弹认证页
  async relogin() {
    if (session) {
      await session.context.close().catch(() => {});
      session = null;
    }
    clearStorageState('edge');
    clearStorageState('chrome');
    clearStorageState('chromium');
    const s = await openSession({ headless: false });
    session = s;
    if (!s.auth.loggedIn) {
      await s.page.goto(AUTH_CHECK_URL, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      process.stderr.write('[stdu-cli] 已清除原登录态，请在新弹出的浏览器里完成认证。\n');
      const r = await waitForLogin(s.page, {});
      if (!r.loggedIn) {
        const error = new Error('换绑登录未完成或超时。');
        error.code = 'LOGIN_TIMEOUT';
        throw error;
      }
    }
    await persistSession(session).catch(() => {});
    return { relogged: true };
  },
  async ping() {
    return { pong: true, loggedIn: session ? session.auth.loggedIn : null };
  }
};

const server = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', async () => {
    const reply = (code, payload) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(payload));
    };
    if (req.method === 'POST' && req.url === '/stop') {
      reply(200, { ok: true, stopping: true });
      setTimeout(() => shutdown(0), 120);
      return;
    }
    let payload;
    try { payload = body ? JSON.parse(body) : {}; } catch { return reply(400, { ok: false, error: { code: 'BAD_JSON' } }); }
    const handler = HANDLERS[payload.method];
    if (!handler) return reply(404, { ok: false, error: { code: 'UNKNOWN_METHOD', message: payload.method } });
    try {
      lastUsed = Date.now();
      const data = await handler(payload.params ?? {});
      reply(200, { ok: true, data });
    } catch (error) {
      reply(200, { ok: false, error: { code: error.code ?? 'INTERNAL_ERROR', message: error.message, hint: error.hint } });
    }
  });
});

function shutdown(code = 0) {
  try { if (session) session.context.close().catch(() => {}); } catch { /* ignore */ }
  try { rmSync(getDaemonFile(), { force: true }); } catch { /* ignore */ }
  setTimeout(() => process.exit(code), 60);
}

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  const file = getDaemonFile();
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ pid: process.pid, port, startedAt: Date.now() }, null, 2)}\n`, 'utf8');
  } catch { /* ignore */ }
  process.stderr.write(`[stdu-cli] 守护进程已启动 pid=${process.pid} port=${port}\n`);
});

// 守护进程必须「打不死」：任何未捕获异常都只记录不退出，
// 否则一次意外崩溃就会让同学被迫重新认证。
function fatal(label, error) {
  try {
    const line = `[${new Date().toISOString()}] ${label}: ${error?.stack ?? String(error)}\n`;
    writeFileSync(join(getStduHome(), 'daemon.log'), line, { flag: 'a' });
  } catch { /* ignore */ }
  process.stderr.write(`[stdu-cli] ${label}: ${error?.message ?? error}\n`);
}
process.on('uncaughtException', (e) => fatal('uncaughtException', e));
process.on('unhandledRejection', (e) => fatal('unhandledRejection', e));

const idleTimer = setInterval(() => {
  if (Date.now() - lastUsed > IDLE_EXIT_MS) {
    process.stderr.write('[stdu-cli] 长时间未使用，守护进程退出。\n');
    shutdown(0);
  }
}, 60_000);
idleTimer.unref?.();

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => shutdown(0));
}

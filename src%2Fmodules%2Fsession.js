import { AUTH_CHECK_URL } from '../config.js';
import { assertBrowserAvailable, contextOptions, requirePlaywright } from './browser.js';
import { classifyAuthPage, waitForLogin } from './auth-detector.js';
import { readPageState, settlePage } from './page.js';
import { readSession, saveSession } from './session-store.js';

// 打开一个复用了持久化 profile 的浏览器上下文，并落到正方内部。
// 成功则返回可用会话；未登录时返回 auth.loggedIn=false，由调用方决定报错或引导登录。
export async function openSession(options = {}) {
  const selection = assertBrowserAvailable(options);
  const { chromium } = requirePlaywright();
  const context = await chromium.launchPersistentContext(
    selection.profilePath,
    contextOptions(selection, options)
  );

  const page = context.pages()[0] ?? await context.newPage();
  const entry = readSession(selection.id);
  const target = entry?.entryUrl || AUTH_CHECK_URL;

  let navError = null;
  try {
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch (cause) {
    navError = cause;
  }
  await settlePage(page, { timeoutMs: options.settleMs ?? 5000 });

  const state = await readPageState(page);
  const auth = classifyAuthPage(state);
  return { selection, context, page, state, auth, entryUrl: target, navError };
}

// 「按需登录」：打开会话后若未登录，就在同一浏览器里等真人完成 CAS 登录，
// 登录成功后不关闭上下文直接返回——后续查询复用同一个会话，避免刚登录就过期。
// autoLogin=false 时不做等待，由调用方自行抛 NEED_LOGIN。
export async function ensureSession(options = {}) {
  const interactive = options.autoLogin !== false;
  const openOptions = { ...options };
  // 需要真人点验证码时必须可见
  if (interactive && options.headless === undefined) openOptions.headless = false;

  const session = await openSession(openOptions);
  if (session.auth.loggedIn || !interactive) return { session, relogged: false };

  // 未登录：先把页面顶到认证入口，再提示用户操作
  if (!/login|captcha|cas\./i.test(session.page.url())) {
    await session.page.goto(AUTH_CHECK_URL, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  }
  process.stderr.write(
    '\n[stdu-cli] 会话已过期，已打开统一认证页面。请在浏览器中完成：\n'
    + '  1) WebVPN 网关登录  2) 输入学号/密码  3) 填写图形验证码\n'
    + '登录成功后会自动继续查询（最多等待 5 分钟）。\n\n'
  );

  const result = await waitForLogin(session.page, options);
  if (!result.loggedIn) {
    await session.context.close().catch(() => {});
    const error = new Error('登录未完成或超时，查询已取消。');
    error.code = 'LOGIN_TIMEOUT';
    error.hint = '重新运行本命令，并在浏览器里完整走完 CAS 登录（含图形验证码）。';
    error.details = result.auth ?? result.state;
    throw error;
  }

  saveSession(session.selection.id, {
    entryUrl: session.page.url(),
    at: Date.now(),
    browser: session.selection.id
  });
  return {
    session: { ...session, auth: result.auth, state: result.state },
    relogged: true
  };
}

export function needLoginError(auth) {
  const error = new Error('尚未登录，或登录/WebVPN 会话已过期。');
  error.code = 'NEED_LOGIN';
  error.hint = '请先运行 stdu-cli login（会打开浏览器，手动完成 WebVPN + CAS 登录，含图形验证码）。';
  error.details = auth;
  return error;
}

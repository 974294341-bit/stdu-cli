import { AUTH_CHECK_URL } from '../config.js';
import { assertBrowserAvailable, contextOptions, requirePlaywright } from './browser.js';
import { classifyAuthPage } from './auth-detector.js';
import { readPageState, settlePage } from './page.js';
import { readSession } from './session-store.js';

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

export function needLoginError(auth) {
  const error = new Error('尚未登录，或登录/WebVPN 会话已过期。');
  error.code = 'NEED_LOGIN';
  error.hint = '请先运行 stdu-cli login（会打开浏览器，手动完成 WebVPN + CAS 登录，含图形验证码）。';
  error.details = auth;
  return error;
}

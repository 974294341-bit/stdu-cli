import { AUTH_CHECK_URL } from '../config.js';
import { assertBrowserAvailable, contextOptions, requirePlaywright } from './browser.js';
import { classifyAuthPage, waitForLogin } from './auth-detector.js';
import { saveSession } from './session-store.js';
import { persistSession } from './session.js';

// 交互式登录：打开真实浏览器，用户手动完成 WebVPN + CAS（账号密码 + 图形验证码），
// 成功后把 profile 里的会话与落地 URL 持久化，供后续命令复用。
// 不接触账号密码：所有输入都在用户自己的浏览器里完成。
export async function login(options = {}) {
  const selection = assertBrowserAvailable(options);
  const { chromium } = requirePlaywright();
  const context = await chromium.launchPersistentContext(
    selection.profilePath,
    contextOptions(selection, { headless: false, viewport: options.viewport })
  );
  const page = context.pages()[0] ?? await context.newPage();

  try {
    await page.goto(AUTH_CHECK_URL, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    process.stderr.write(
      '\n[stdu-cli] 已打开统一认证页面。请在浏览器中完成：\n'
      + '  1) WebVPN 网关登录  2) 输入学号/密码  3) 填写图形验证码\n'
      + '登录成功后会自动回跳正方首页，本命令将自动收尾（最多等待 5 分钟）。\n\n'
    );

    const result = await waitForLogin(page, options);
    if (!result.loggedIn) {
      const error = new Error('登录未完成或超时。');
      error.code = 'LOGIN_TIMEOUT';
      error.hint = '重试 stdu-cli login，并在浏览器里完整走完 CAS 登录（含图形验证码）。';
      error.details = result.auth ?? result.state;
      throw error;
    }

    // 关键：CAS/WebVPN 是会话级 cookie，浏览器一关就丢。
    // 必须在关闭上下文之前把 cookie 导出落盘，否则守护进程下次起来仍判定未登录。
    await persistSession({ selection, context }).catch(() => {});
    saveSession(selection.id, { entryUrl: page.url(), at: Date.now(), browser: selection.id });
    return {
      browser: selection.id,
      profilePath: selection.profilePath,
      entryUrl: page.url(),
      auth: result.auth
    };
  } finally {
    await context.close().catch(() => {});
  }
}

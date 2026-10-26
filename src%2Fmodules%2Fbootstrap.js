// bootstrap：登录 + 校准 一次性完成。
// 关键：登录成功后“不关闭浏览器上下文”，立刻在同一会话里抓取真实接口，
// 避免 WebVPN/CAS 短期会话过期导致后续命令拿不到数据。
import { AUTH_CHECK_URL } from '../config.js';
import { assertBrowserAvailable, contextOptions, requirePlaywright } from './browser.js';
import { waitForLogin } from './auth-detector.js';
import { saveSession } from './session-store.js';
import { calibrateOnSession } from './calibrate.js';

export async function bootstrap(options = {}) {
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
      + '登录成功后会自动回跳正方内部，并立刻抓取课表/成绩/空教室的真实接口（无需再次操作）。\n\n'
    );

    const result = await waitForLogin(page, options);
    if (!result.loggedIn) {
      const error = new Error('登录未完成或超时。');
      error.code = 'LOGIN_TIMEOUT';
      error.hint = '重试 stdu-cli bootstrap，并在浏览器里完整走完 CAS 登录（含图形验证码）。';
      error.details = result.auth ?? result.state;
      throw error;
    }

    saveSession(selection.id, { entryUrl: page.url(), at: Date.now(), browser: selection.id });
    process.stderr.write('[stdu-cli] 登录成功，正在同一会话内抓取真实接口…\n');

    const cal = await calibrateOnSession({ selection, context, page, auth: result.auth }, options);
    return {
      browser: selection.id,
      profilePath: selection.profilePath,
      entryUrl: page.url(),
      auth: result.auth,
      calibration: cal
    };
  } finally {
    await context.close().catch(() => {});
  }
}

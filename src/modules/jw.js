import { STDU } from '../config.js';
import { captureJsonResponses, readPageState, settlePage } from './page.js';

export function zfUrl(pathOrUrl) {
  if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl;
  const path = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
  return `${STDU.jw.base}${path}`;
}

// 导航到正方某页并等待稳定。
export async function gotoZf(page, pathOrUrl, options = {}) {
  await page.goto(zfUrl(pathOrUrl), { waitUntil: 'domcontentloaded', timeout: options.timeout ?? 45000 });
  await settlePage(page, { timeoutMs: options.settleMs ?? 6000 });
  return readPageState(page);
}

// 在页面上下文里发同源请求（自动携带浏览器 Cookie，穿透 WebVPN）。
// 这是“借浏览器会话”的关键：不自己拼 Cookie，交给浏览器。
export async function requestInPage(page, pathOrUrl, { method = 'GET', form, json, headers } = {}) {
  const url = zfUrl(pathOrUrl);
  return page.evaluate(async ({ url, method, body, contentType, headers }) => {
    const res = await fetch(url, {
      method,
      headers: { ...(contentType ? { 'Content-Type': contentType } : {}), 'X-Requested-With': 'XMLHttpRequest', ...(headers || {}) },
      ...(body ? { body } : {}),
      credentials: 'include'
    });
    const text = await res.text();
    return { status: res.status, url: res.url, text };
  }, {
    url,
    method,
    body: form ? new URLSearchParams(form).toString() : (json ? JSON.stringify(json) : undefined),
    contentType: form ? 'application/x-www-form-urlencoded; charset=UTF-8' : (json ? 'application/json;charset=UTF-8' : null),
    headers: headers ?? null
  });
}

export async function postFormInPage(page, pathOrUrl, form, options = {}) {
  const res = await requestInPage(page, pathOrUrl, { method: 'POST', form, headers: options.headers });
  return { ...res, json: tryParseJson(res.text) };
}

export async function getInPage(page, pathOrUrl, options = {}) {
  const res = await requestInPage(page, pathOrUrl, { method: 'GET', headers: options.headers });
  return { ...res, json: tryParseJson(res.text) };
}

export function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// 尝试点击页面上的“查询/检索”按钮，触发 AJAX 加载。
export async function clickQuery(page) {
  const selectors = [
    '#btn_cx', 'button#btn_cx',
    'button:has-text("查询")', 'a:has-text("查询")', 'input[value="查询"]',
    'button:has-text("检索")', 'a:has-text("检索")', 'input[value="检索"]'
  ];
  for (const selector of selectors) {
    const loc = page.locator(selector).first();
    if ((await loc.count()) > 0) {
      await loc.click({ timeout: 3000 }).catch(() => {});
      return true;
    }
  }
  return false;
}

// 在页面里收集指定时间窗口内出现的 JSON 响应，然后返回。
export async function collectJsonWhile(page, action, options = {}) {
  const captured = captureJsonResponses(page, options);
  await action();
  await page.waitForTimeout(options.afterMs ?? 2500);
  return captured;
}

export { STDU };

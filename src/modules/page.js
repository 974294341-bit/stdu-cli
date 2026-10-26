// 页面状态读取与“从加载中稳定下来”的等待，避免在 SPA 未渲染时读 DOM。

export async function readPageState(page) {
  return {
    url: page.url(),
    title: await page.title().catch(() => ''),
    text: await page.locator('body').innerText({ timeout: 8000 }).catch(() => '')
  };
}

export async function settlePage(page, options = {}) {
  const deadline = Date.now() + (options.timeoutMs ?? 6000);
  let previous = '';
  let stableCount = 0;
  while (Date.now() < deadline) {
    const text = await page.locator('body').innerText({ timeout: 2000 }).catch(() => '');
    if (text.length > 0 && text === previous) {
      stableCount += 1;
      if (stableCount >= 2) return;
    } else {
      stableCount = 0;
    }
    previous = text;
    await page.waitForTimeout(options.intervalMs ?? 350);
  }
}

// 收集页面内所有 JSON 响应（默认只收 stdu/jw 域），是解析课表/成绩最稳的来源。
export function captureJsonResponses(page, options = {}) {
  const captured = [];
  const matcher = options.match ?? ((url) => /jw\.stdu\.edu\.cn|webproxy\.stdu\.edu\.cn/.test(url));
  page.on('response', (response) => {
    const url = response.url();
    if (!matcher(url)) return;
    const type = (response.headers()['content-type'] ?? '').toLowerCase();
    if (!type.includes('json') && !type.includes('javascript')) return;
    response.text()
      .then((text) => {
        try {
          captured.push({ url, body: JSON.parse(text) });
        } catch {
          // 非 JSON，忽略
        }
      })
      .catch(() => {});
  });
  return captured;
}

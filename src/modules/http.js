// 轻量 HTTP 客户端。用于无需浏览器会话的公开页面；教务系统受 WebVPN 保护，
// 这类请求通常会被 302 到 wengine-auth，因此教务一律走 Playwright，不在这里发。
// 保留此模块是为了未来接入公开的公告/图书馆等纯 HTTP 资源。

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 stdu-cli';

export async function fetchText(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? 20000;
  let response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        'User-Agent': UA,
        Accept: options.accept ?? 'text/html,application/xhtml+xml,application/json,*/*',
        ...(options.body ? { 'Content-Type': 'application/json;charset=UTF-8' } : {}),
        ...(options.headers ?? {})
      },
      ...(options.body ? { body: typeof options.body === 'string' ? options.body : JSON.stringify(options.body) } : {}),
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (cause) {
    const error = new Error(`请求失败：${url}`);
    error.code = 'BACKEND_UNAVAILABLE';
    error.hint = '检查网络连通性（校外访问校内站点需先连校园网或 WebVPN）。';
    error.details = { url, reason: cause?.message ?? String(cause) };
    throw error;
  }

  if (!response.ok) {
    const error = new Error(`请求返回 ${response.status}：${url}`);
    error.code = 'BACKEND_UNAVAILABLE';
    error.hint = '目标站点可能改版、或需要 WebVPN 会话。';
    error.details = { url, status: response.status, redirected: response.url };
    throw error;
  }

  const buffer = await response.arrayBuffer();
  return decodeBuffer(buffer, response.headers.get('content-type'));
}

function decodeBuffer(buffer, contentType) {
  const declared = /charset=([\w-]+)/i.exec(contentType ?? '')?.[1]?.toLowerCase();
  const charset = declared === 'gbk' || declared === 'gb2312' || declared === 'gb18030'
    ? 'gbk'
    : declared === 'utf-8'
      ? 'utf-8'
      : sniffCharset(buffer);
  const decoder = new TextDecoder(charset === 'gbk' ? 'gbk' : 'utf-8');
  return decoder.decode(buffer).replace(/^\uFEFF/, '');
}

function sniffCharset(buffer) {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return 'utf-8';
  } catch {
    return 'gbk';
  }
}

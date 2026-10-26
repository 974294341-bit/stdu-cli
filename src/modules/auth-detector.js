import { INTERNAL_URL_MARKERS, LOGIN_URL_MARKERS } from '../config.js';

// 判定当前页面是否已进入正方系统内部（登录完成）。
// 因为 STDU 前面有 WebVPN 网关，登录成功后的落地 URL 可能是 webproxy 重写后的地址，
// 所以不能只认 jw 域名，要结合 URL 与页面文本综合判断。
const INTERNAL_TEXT_MARKERS = ['个人课表', '成绩查询', '教学安排', '信息查询', '培养方案', '选课', '我的课表'];
const LOGIN_TEXT_MARKERS = ['统一身份认证', '登 录', '忘记密码', '验证码'];

export function classifyAuthUrl(url) {
  const u = String(url ?? '');
  if (LOGIN_URL_MARKERS.some((m) => u.includes(m))) {
    return { loggedIn: false, reason: 'login-gateway', url: u };
  }
  if (u.includes('jw.stdu.edu.cn') || u.includes('/xtgl/')) {
    return { loggedIn: true, reason: 'internal-url', url: u };
  }
  return { loggedIn: false, reason: 'unknown-url', url: u };
}

export function classifyAuthPage(state) {
  const url = String(state?.url ?? '');
  const text = String(state?.text ?? '');
  const title = String(state?.title ?? '');

  const byUrl = classifyAuthUrl(url);
  if (byUrl.reason === 'login-gateway') {
    return byUrl;
  }
  if (INTERNAL_URL_MARKERS.some((m) => url.includes(m)) && !LOGIN_URL_MARKERS.some((m) => url.includes(m))) {
    return { loggedIn: true, reason: 'internal-url', url, title };
  }
  if (title.includes('统一身份认证') || LOGIN_TEXT_MARKERS.some((m) => text.includes(m) && text.length < 2000 && text.includes('密码'))) {
    return { loggedIn: false, reason: 'login-page', url, title };
  }
  if (INTERNAL_TEXT_MARKERS.some((m) => text.includes(m))) {
    return { loggedIn: true, reason: 'internal-text', url, title };
  }
  // 登录成功后经 WebVPN 重写的落地页：域名是 webproxy 但已不再是 login 路径。
  // 需要页面文本里出现正方内部特征才算数，避免把 VPN 门户首页误判为已登录。
  if (url.includes('webproxy.stdu.edu.cn') && !url.includes('login') && INTERNAL_TEXT_MARKERS.some((m) => text.includes(m))) {
    return { loggedIn: true, reason: 'vpn-proxy-text', url, title };
  }
  return { loggedIn: false, reason: 'indeterminate', url, title };
}

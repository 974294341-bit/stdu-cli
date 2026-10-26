import { existsSync } from 'node:fs';

import { STDU } from '../config.js';
import { getBrowserStatus, getSelectedBrowser, requirePlaywright } from './browser.js';
import { getProfilePath, getSessionFile, getStduHome } from './paths.js';

// 自检：运行环境、依赖、浏览器、已登录会话、网络可达性。
export async function doctor(options = {}) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, ...(detail ? { detail } : {}) });

  add('node-version', Number(process.versions.node.split('.')[0]) >= 20,
    `node ${process.version}`);

  let playwrightOk = true;
  try {
    requirePlaywright();
  } catch (error) {
    playwrightOk = false;
    add('playwright', false, error.message);
  }
  if (playwrightOk) add('playwright', true, '已安装');

  const status = getBrowserStatus(options);
  add('browser-selected', true, `${status.selected.id} (${status.selected.source})`);
  for (const [id, info] of Object.entries(status.browsers)) {
    add(`browser-${id}`, info.installed, info.installed ? info.profilePath : '未安装');
  }

  const home = getStduHome(options);
  add('cli-home', existsSync(home), home);

  const selection = getSelectedBrowser(options);
  const profile = getProfilePath(selection.id, options);
  add('profile-dir', existsSync(profile), profile);
  add('session-file', existsSync(getSessionFile(selection.id, options)),
    getSessionFile(selection.id, options));

  let reachable = 'unknown';
  try {
    const res = await fetch(`${STDU.cas.origin}${STDU.cas.loginPath}`, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
    reachable = res.status > 0 ? `http ${res.status}` : 'ok';
  } catch (error) {
    reachable = `不可达（${error.message}）`;
  }
  add('cas-reachable', true, reachable);

  const allOk = checks.every((c) => c.ok);
  return {
    ready: allOk,
    checks,
    hints: buildHints(checks, selection)
  };
}

function buildHints(checks, selection) {
  const hints = [];
  const fail = (n) => checks.find((c) => c.name === n && !c.ok);
  if (fail('playwright')) hints.push('运行 npm install 安装 playwright。');
  if (fail(`browser-${selection.id}`)) hints.push('安装 Chrome/Edge，或 stdu-cli browser install chromium --yes。');
  if (fail('session-file')) hints.push('运行 stdu-cli login 完成 WebVPN + CAS 登录（含图形验证码）。');
  return hints;
}

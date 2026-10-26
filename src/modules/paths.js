import { homedir } from 'node:os';
import { join } from 'node:path';

const PROFILE_DIR = 'browser-profiles';

export function getStduHome(options = {}) {
  const env = options.env ?? process.env;
  return env.STDU_CLI_HOME || join(homedir(), '.stdu-cli');
}

export function getProfilePath(browserId, options = {}) {
  return join(getStduHome(options), PROFILE_DIR, browserId);
}

export function getSessionFile(browserId, options = {}) {
  return join(getStduHome(options), `session-${browserId}.json`);
}

// 登录态 cookie 的落盘位置。CAS/WebVPN 给的是「会话级 cookie」，
// 浏览器一关就没了；这里用 Playwright 的 storageState 把它导出来，
// 下次启动再注入回去，从而做到「只认证一次」。
export function getStorageStateFile(browserId, options = {}) {
  return join(getStduHome(options), `storage-state-${browserId}.json`);
}

export function getDaemonFile(options = {}) {
  return join(getStduHome(options), 'daemon.json');
}

export function getCacheDir(options = {}) {
  return join(getStduHome(options), 'cache');
}

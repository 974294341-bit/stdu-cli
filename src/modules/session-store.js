import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { getSessionFile, getStorageStateFile } from './paths.js';

export function readSession(browserId, options = {}) {
  try {
    const raw = readFileSync(getSessionFile(browserId, options), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function saveSession(browserId, data, options = {}) {
  const file = getSessionFile(browserId, options);
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  } catch {
    // 忽略写入失败
  }
}

export function clearSession(browserId, options = {}) {
  try {
    writeFileSync(getSessionFile(browserId, options), `${JSON.stringify({ clearedAt: Date.now() })}\n`, 'utf8');
  } catch {
    // 忽略
  }
  // 换绑/登出必须连 cookie 一起清掉，否则下次又会用旧身份自动登录
  clearStorageState(browserId, options);
}

export function readStorageState(browserId, options = {}) {
  try {
    const raw = readFileSync(getStorageStateFile(browserId, options), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.cookies)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveStorageState(browserId, state, options = {}) {
  const file = getStorageStateFile(browserId, options);
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  } catch {
    // 忽略写入失败
  }
}

export function clearStorageState(browserId, options = {}) {
  try {
    writeFileSync(getStorageStateFile(browserId, options), `${JSON.stringify({ cookies: [], origins: [] })}\n`, 'utf8');
  } catch {
    // 忽略
  }
}

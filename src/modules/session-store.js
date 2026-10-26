import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { getSessionFile } from './paths.js';

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
}

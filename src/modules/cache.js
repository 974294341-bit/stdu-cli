// 结果缓存：课表/成绩这类数据一学期才变一次，没必要每次都打教务服务器（单次要 1~3 秒）。
// 默认只缓存「不随参数剧烈变化」的查询，且 TTL 较短；--no-cache 可强制刷新。
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { getCacheDir } from './paths.js';

// 各命令的默认缓存时长（毫秒）
const TTL = {
  course: 6 * 60 * 60 * 1000, // 课表一学期基本不动
  grade: 30 * 60 * 1000,      // 成绩会陆续出，半小时够用
  room: 10 * 60 * 1000        // 空闲教室随选课变动
};

function cacheFile(key, options = {}) {
  return join(getCacheDir(options), `${key}.json`);
}

function makeKey(method, params, options = {}) {
  const identity = options.studentId ?? '';
  const raw = JSON.stringify([method, params, identity]);
  return `${method}-${createHash('sha1').update(raw).digest('hex').slice(0, 16)}`;
}

export function readCache(method, params, options = {}) {
  if (options.noCache) return null;
  const key = makeKey(method, params, options);
  try {
    const raw = readFileSync(cacheFile(key, options), 'utf8');
    const entry = JSON.parse(raw);
    const ttl = options.ttlMs ?? TTL[method] ?? 10 * 60 * 1000;
    if (!entry?.at || Date.now() - entry.at > ttl) return null;
    return { ...entry.data, cached: true, cachedAt: entry.at, cacheAgeMs: Date.now() - entry.at };
  } catch {
    return null;
  }
}

export function writeCache(method, params, data, options = {}) {
  try {
    mkdirSync(getCacheDir(options), { recursive: true });
    const key = makeKey(method, params, options);
    writeFileSync(cacheFile(key, options), `${JSON.stringify({ at: Date.now(), data }, null, 2)}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

export function clearCache(options = {}) {
  try {
    const dir = getCacheDir(options);
    rmSync(dir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

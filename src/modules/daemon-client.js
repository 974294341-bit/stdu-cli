// 守护进程客户端：命令优先走常驻守护进程（快 + 免重复认证），
// 守护进程不可用（未启动/崩溃/被禁）时回落到「自己开浏览器」的直连模式。
import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { openSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getDaemonFile, getStduHome } from './paths.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DAEMON_ENTRY = join(HERE, '..', 'daemon.js');

export function daemonDisabled(options = {}) {
  return options.noDaemon === true || process.env.STDU_NO_DAEMON === '1';
}

function readDaemonInfo() {
  try {
    const raw = readFileSync(getDaemonFile(), 'utf8');
    const info = JSON.parse(raw);
    if (!info?.port) return null;
    return info;
  } catch {
    return null;
  }
}

function post(port, path, payload, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, path, method: 'POST', headers: { 'Content-Type': 'application/json' }, timeout: timeoutMs },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          try { resolve(JSON.parse(body)); } catch { reject(new Error('BAD_RESPONSE')); }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('TIMEOUT')); });
    req.end(JSON.stringify(payload));
  });
}

// 拉起守护进程（后台常驻），并等待它把端口写进 daemon.json
async function spawnDaemon() {
  // 日志落盘：守护进程崩溃时才有据可查（stdio:ignore 会让错误无声消失）
  let stderrFd = 'ignore';
  try {
    const log = join(getStduHome(), 'daemon.log');
    stderrFd = openSync(log, 'a');
  } catch { /* ignore */ }

  const child = spawn(process.execPath, [DAEMON_ENTRY], {
    detached: true,
    stdio: ['ignore', 'ignore', stderrFd],
    env: process.env,
    cwd: dirname(HERE),
    windowsHide: true
  });
  child.unref();

  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    const info = readDaemonInfo();
    if (info) {
      // 等到它真的能应答
      try {
        const r = await post(info.port, '/rpc', { method: 'ping' }, 900);
        if (r?.ok) return info;
      } catch { /* 还没起来 */ }
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

// 返回 { via:'daemon'|'direct' }；via==='daemon' 时可用 call()
export async function ensureDaemon(options = {}) {
  if (daemonDisabled(options)) return { via: 'direct' };
  let info = readDaemonInfo();
  if (info) {
    try {
      const r = await post(info.port, '/rpc', { method: 'ping' }, 1500);
      if (r?.ok) return { via: 'daemon', port: info.port };
    } catch { /* 端口失效，重新拉起 */ }
  }
  info = await spawnDaemon();
  if (info) return { via: 'daemon', port: info.port };
  return { via: 'direct' };
}

// 通过守护进程执行；超时或失败时抛 DAEMON_UNAVAILABLE，由调用方回落直连
export async function callDaemon(port, method, params, timeoutMs = 60000) {
  const res = await post(port, '/rpc', { method, params }, timeoutMs);
  if (!res) throw Object.assign(new Error('守护进程无响应'), { code: 'DAEMON_UNAVAILABLE' });
  if (!res.ok) {
    const error = new Error(res.error?.message ?? '守护进程调用失败');
    error.code = res.error?.code ?? 'DAEMON_FAILED';
    error.hint = res.error?.hint;
    throw error;
  }
  return res.data;
}

export async function stopDaemon() {
  const info = readDaemonInfo();
  if (!info) return { stopped: false, reason: 'not-running' };
  try {
    await post(info.port, '/stop', {}, 1500);
    return { stopped: true, pid: info.pid };
  } catch {
    return { stopped: false, reason: 'unreachable', pid: info.pid };
  }
}

export async function daemonStatus() {
  const info = readDaemonInfo();
  if (!info) return { running: false };
  try {
    const r = await post(info.port, '/rpc', { method: 'status' }, 3000);
    return r?.ok ? { running: true, pid: info.pid, port: info.port, ...r.data } : { running: false };
  } catch {
    return { running: false, stale: true, pid: info.pid };
  }
}

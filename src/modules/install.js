import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { copySkill, writeInstallConfig } from './skill.js';
import { login } from './login.js';

const require = createRequire(import.meta.url);

// 本仓库在 GitHub 上的坐标（npx 用）。install 命令会把同一份技能复制给同学，
// 因此这里固定写死官方仓库地址，install 后写入 ~/.stdu-cli/config.json 供 AI 读取。
const CANONICAL_REPO = 'github:974294341-bit/stdu-cli';
const PKG_VERSION = '0.1.0';

// 包根目录：src/modules/install.js -> ../../
const PKG_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

function log(msg) {
  process.stderr.write(`[install] ${msg}\n`);
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false });
    child.stdout.on('data', (chunk) => process.stderr.write(chunk));
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    child.once('error', (cause) => reject(cause));
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`命令失败（exit ${code}）：${command} ${args.join(' ')}`));
    });
  });
}

// `stdu-cli install`：把技能装进各 AI 的 skills 目录 + 装好浏览器内核 + 写配置，
// 最后自动打开学校统一认证（CAS）登录页，等待真人登录。
// 一条命令即可完成"下载 → 跳认证页 → 认证完直接在对话框用功能"。
export async function install({ global = true, skipLogin = false } = {}) {
  log('① 正在复制技能到 Agent 的 skills 目录…');
  const targets = copySkill();
  for (const t of targets) log(`   ✓ ${t}`);

  // 解析后续调用用的命令前缀：优先全局安装得到 `stdu-cli`，失败则退回 `npx -y <repo>`（无需预装）。
  let run = `npx -y ${CANONICAL_REPO}`;
  if (global) {
    try {
      log('② 尝试全局安装 stdu-cli（安装后可直接用 stdu-cli 命令，离线也能跑）…');
      await runCommand('npm', ['install', '-g', PKG_ROOT]);
      run = 'stdu-cli';
      log('   ✓ 全局安装成功');
    } catch (error) {
      log(`   全局安装跳过（${error.message}），将使用 ${run}（每次自动拉取，需联网）`);
    }
  }

  log('③ 确保 Playwright Chromium 内核已安装（浏览器自动化依赖）…');
  try {
    await installManagedChromium();
    log('   ✓ Chromium 就绪');
  } catch (error) {
    log(`   Chromium 安装未完成：${error.message}（可稍后手动 ${run} browser install chromium --yes）`);
  }

  const configFile = writeInstallConfig({
    version: PKG_VERSION,
    repo: CANONICAL_REPO,
    run,
    skillsDirs: targets
  });
  log(`④ 已写入安装配置：${configFile}`);

  const result = { skillInstalled: true, targets, run, repo: CANONICAL_REPO, configFile };

  if (skipLogin) {
    log('⑤ 跳过自动登录。需要时手动运行：');
    log(`   ${run} login`);
    log('登录后，直接对你的 AI 说"这学期课表""空教室""我绩点多少"即可。');
    return result;
  }

  // ⑤ 自动打开学校统一认证页，等待真人完成 CAS 登录（含图形验证码）。
  log('⑤ 正在打开学校统一认证（CAS）登录页，请在浏览器中完成登录…');
  try {
    const loginResult = await login({});
    log(`   ✓ 登录成功（${loginResult.browser}）。现在直接在对话框里说"课表 / 成绩 / 空教室"就能查了。`);
    result.login = { browser: loginResult.browser, entryUrl: loginResult.entryUrl };
  } catch (error) {
    log(`   未自动登录（${error.message}），稍后手动运行：${run} login`);
    result.loginSkipped = true;
  }
  return result;
}

export async function installManagedChromium() {
  let cliPath;
  try {
    cliPath = dirname(require.resolve('playwright/package.json'));
  } catch {
    const error = new Error('Playwright 未安装，请先 npm install 或确保全局安装成功。');
    error.code = 'BACKEND_UNAVAILABLE';
    throw error;
  }
  await runCommand(process.execPath, [join(cliPath, 'cli.js'), 'install', 'chromium']);
  return { installed: true, browser: 'chromium' };
}

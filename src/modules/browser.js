import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { getProfilePath } from './paths.js';
import { readInstallConfig, writeInstallConfig } from './skill.js';

const require = createRequire(import.meta.url);

export const BROWSER_IDS = ['chrome', 'edge', 'chromium'];

const DEFINITIONS = {
  chrome: { label: 'Google Chrome', channel: 'chrome' },
  edge: { label: 'Microsoft Edge', channel: 'msedge' },
  chromium: { label: 'Playwright Chromium', channel: null }
};

export function normalizeBrowserId(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'msedge' || normalized === 'microsoft-edge') return 'edge';
  if (normalized === 'google-chrome') return 'chrome';
  return BROWSER_IDS.includes(normalized) ? normalized : null;
}

export function getSelectedBrowser(options = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;

  const fromEnv = normalizeBrowserId(env.STDU_BROWSER ?? env.STDU_BROWSER_CHANNEL);
  if (fromEnv) return buildSelection(fromEnv, 'environment');

  // 其次尊重 `stdu-cli browser use <id>` 的选择（落在 ~/.stdu-cli/config.json）
  const fromConfig = normalizeBrowserId(readInstallConfig(env)?.browser);
  if (fromConfig) return buildSelection(fromConfig, 'config');

  const available = ['chrome', 'edge'].find((id) => isBrowserInstalled(id, { platform, env }));
  if (available) return buildSelection(available, 'first-available');

  return buildSelection('chromium', 'fallback');
}

// 切换默认浏览器：写入安装配置，持久生效（环境变量 STDU_BROWSER 优先级更高）。
export function selectBrowser(id, options = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const normalized = normalizeBrowserId(id);
  if (!normalized) {
    const error = new Error(`无法识别的浏览器：${id}（可选 chrome / edge / chromium）。`);
    error.code = 'BROWSER_SELECTION_INVALID';
    throw error;
  }
  if (!isBrowserInstalled(normalized, { platform, env })) {
    const error = new Error(`没有找到可用的 ${DEFINITIONS[normalized].label}。`);
    error.code = 'BROWSER_UNAVAILABLE';
    error.hint = '安装 Chrome 或 Edge，或运行 stdu-cli browser install chromium --yes。';
    error.details = { browser: normalized, status: getBrowserStatus({ env, platform }) };
    throw error;
  }
  const configFile = writeInstallConfig({ browser: normalized });
  return { ...buildSelection(normalized, 'config'), configFile };
}

export function getBrowserStatus(options = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const selected = getSelectedBrowser({ env, platform });
  return {
    selected,
    browsers: Object.fromEntries(BROWSER_IDS.map((id) => [id, {
      id,
      label: DEFINITIONS[id].label,
      installed: isBrowserInstalled(id, { platform, env }),
      profilePath: getProfilePath(id, { env })
    }]))
  };
}

export function assertBrowserAvailable(options = {}) {
  const selection = getSelectedBrowser(options);
  if (!isBrowserInstalled(selection.id, options)) {
    const error = new Error(`没有找到可用的 ${DEFINITIONS[selection.id].label}。`);
    error.code = 'BROWSER_UNAVAILABLE';
    error.hint = '安装 Chrome 或 Edge，或运行 stdu-cli browser install chromium --yes。';
    error.details = { browser: selection.id, status: getBrowserStatus() };
    throw error;
  }
  return selection;
}

export function isBrowserInstalled(browser, options = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  if (browser === 'chromium') {
    try {
      const { chromium } = require('playwright');
      return existsSync(chromium.executablePath());
    } catch {
      return false;
    }
  }
  return browserExecutableCandidates(browser, platform, env).some((candidate) => existsSync(candidate));
}

// 返回 playwright 模块；未安装时抛出可读错误。
export function requirePlaywright() {
  try {
    return require('playwright');
  } catch {
    const error = new Error('未安装 Playwright。');
    error.code = 'BACKEND_UNAVAILABLE';
    error.hint = '在项目目录执行 npm install（会安装 playwright 依赖）。';
    throw error;
  }
}

// 供持久化上下文使用的启动参数（区分 channel 与托管 chromium）。
export function contextOptions(selection, options = {}) {
  const headless = options.headless ?? true;
  return {
    ...(selection.channel ? { channel: selection.channel } : {}),
    headless,
    viewport: options.viewport ?? { width: 1366, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
    ...(options.contextOptions ?? {})
  };
}

function buildSelection(id, source) {
  return {
    id,
    label: DEFINITIONS[id].label,
    channel: DEFINITIONS[id].channel,
    source,
    profilePath: getProfilePath(id)
  };
}

function browserExecutableCandidates(browser, platform, env) {
  if (platform === 'win32') {
    const roots = [env.LOCALAPPDATA, env.PROGRAMFILES, env['PROGRAMFILES(X86)']].filter(Boolean);
    const relative = browser === 'chrome'
      ? ['Google', 'Chrome', 'Application', 'chrome.exe']
      : ['Microsoft', 'Edge', 'Application', 'msedge.exe'];
    return roots.map((root) => join(root, ...relative));
  }
  if (platform === 'darwin') {
    const app = browser === 'chrome'
      ? 'Google Chrome.app/Contents/MacOS/Google Chrome'
      : 'Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
    return [`/Applications/${app}`, join(homedir(), 'Applications', app)];
  }
  return browser === 'chrome'
    ? ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable']
    : ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable'];
}

// 供 install 命令使用：定位 playwright CLI
export function playwrightCliPath() {
  return join(dirname(require.resolve('playwright/package.json')), 'cli.js');
}

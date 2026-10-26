import { AUTH_CHECK_URL, STDU } from './config.js';
import { dump } from './modules/dump.js';
import { doctor } from './modules/doctor.js';
import { errorEnvelope, successEnvelope, writeJson } from './modules/output.js';
import { getBrowserStatus, getSelectedBrowser, normalizeBrowserId, requirePlaywright } from './modules/browser.js';
import { login } from './modules/login.js';
import { getCourse } from './modules/course.js';
import { getGrade } from './modules/grade.js';
import { getEmptyRooms } from './modules/room.js';
import { install, installManagedChromium } from './modules/install.js';
import { clearSession } from './modules/session-store.js';

export async function run(argv) {
  const { positional, flags } = parseArgs(argv);
  const command = positional[0] ?? 'help';

  try {
    switch (command) {
      case 'doctor':
        return emit(successEnvelope(await doctor({ env: process.env })));

      case 'login':
        return emit(successEnvelope(await login({ timeoutMs: flags.timeout ? Number(flags.timeout) : undefined })));

      case 'logout': {
        const selection = getSelectedBrowser({ env: process.env });
        clearSession(selection.id);
        return emit(successEnvelope({ cleared: true, browser: selection.id }));
      }

      case 'browser': {
        const action = positional[1] ?? 'status';
        return emit(successEnvelope(await handleBrowser(action, positional, flags)));
      }

      case 'course':
        return emit(successEnvelope(await getCourse({ year: flags.year, term: flags.term })));

      case 'grade':
        return emit(successEnvelope(await getGrade({ year: flags.year, term: flags.term })));

      case 'room':
        return emit(successEnvelope(await getEmptyRooms({
          weekday: flags.weekday,
          period: flags.period,
          week: flags.week,
          campus: flags.campus,
          onlyAvailable: flags.onlyAvailable
        })));

      case 'dump':
        return emit(successEnvelope(await dump({
          out: flags.out,
          paths: flags.paths ? String(flags.paths).split(',').filter(Boolean) : undefined
        })));

      case 'install':
        return emit(successEnvelope(await install({ skipLogin: !!flags['no-login'] })));

      case 'help':
      case '': {
        process.stdout.write(HELP);
        return 0;
      }

      default: {
        process.stderr.write(`未知命令：${command}\n`);
        process.stdout.write(HELP);
        return 2;
      }
    }
  } catch (error) {
    emit(errorEnvelope(error));
    return 1;
  }
}

async function handleBrowser(action, positional, flags) {
  switch (action) {
    case 'status':
    case 'list':
      return getBrowserStatus({ env: process.env });

    case 'use': {
      const id = normalizeBrowserId(positional[2]);
      if (!id) {
        const e = new Error('请指定浏览器：chrome / edge / chromium。');
        e.code = 'BROWSER_SELECTION_INVALID';
        throw e;
      }
      const { selectBrowser } = await import('./modules/browser.js');
      return selectBrowser(id, { env: process.env });
    }

    case 'install': {
      const browser = positional[2] ?? 'chromium';
      if (browser !== 'chromium') {
        const e = new Error('仅支持安装 Playwright 自带的 chromium。');
        e.code = 'BROWSER_SELECTION_INVALID';
        throw e;
      }
      if (!flags.yes) {
        const e = new Error('安装 Chromium 需显式确认。');
        e.code = 'BROWSER_INSTALL_CONFIRM_REQUIRED';
        e.hint = '确认后重跑：stdu-cli browser install chromium --yes';
        throw e;
      }
      requirePlaywright();
      return installManagedChromium();
    }

    default:
      return getBrowserStatus({ env: process.env });
  }
}

function emit(payload) {
  writeJson(payload);
  return 0;
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const body = token.slice(2);
      const eq = body.indexOf('=');
      if (eq >= 0) {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        flags[body] = argv[i + 1];
        i += 1;
      } else {
        flags[body] = true;
      }
    } else {
      positional.push(token);
    }
  }
  return { positional, flags };
}

const HELP = `
stdu-cli — 石家庄铁道大学（STDU）校园服务 CLI（WebVPN + CAS + 正方 V9）

用法：
  stdu-cli install [--no-login]       一键安装：装技能+浏览器内核，并自动打开学校 CAS 登录页（同学首次用这一条；--no-login 可跳过自动登录）
  stdu-cli doctor                     运行环境/依赖/会话自检
  stdu-cli login                      打开浏览器，手动完成 WebVPN+CAS 登录（含图形验证码）
  stdu-cli logout                     清除已保存的登录会话
  stdu-cli browser status|list|use <id>|install chromium --yes
  stdu-cli course [--year 2025] [--term 1|2|3]   课表（term: 1秋 2春 3夏）
  stdu-cli grade [--year 2025] [--term 1|2|3]    成绩 + GPA/学分统计
  stdu-cli room [--weekday 1] [--period 1-2] [--week 1] [--campus 校本部] [--onlyAvailable]   空闲教室
  stdu-cli dump [--out path] [--paths a,b,c]     抓取真实响应，用于校准端点
  stdu-cli help

说明：
  - 教务系统受 WebVPN 网关与 CAS（带验证码）保护，登录必须在真人浏览器里完成；
    CLI 只复用登录后持久化的浏览器 profile，不收集账号密码。
  - 在校内校园网使用可直接访问 jw.stdu.edu.cn；校外需先经 WebVPN。
  - 课表/成绩端点基于正方 V9 经验值，若学校定制有差异，用 dump 抓取后校准。
`;

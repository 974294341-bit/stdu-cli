import { errorEnvelope, successEnvelope, writeJson } from './modules/output.js';
import { getBrowserStatus, getSelectedBrowser, normalizeBrowserId } from './modules/browser.js';
import { getCourse } from './modules/course.js';
import { getGrade } from './modules/grade.js';
import { getEmptyRooms } from './modules/room.js';
import { clearSession } from './modules/session-store.js';
import { addDays, todayStr } from './modules/week.js';
import { callDaemon, daemonDisabled, daemonStatus, ensureDaemon, stopDaemon } from './modules/daemon-client.js';
import { clearCache, readCache, writeCache } from './modules/cache.js';
import { clearStorageState } from './modules/session-store.js';

export async function run(argv) {
  const { positional, flags } = parseArgs(argv);
  const command = positional[0] ?? 'help';

  try {
    switch (command) {
      case 'doctor': {
        const { doctor } = await import('./modules/doctor.js');
        return emit(successEnvelope(await doctor({ env: process.env })));
      }

      case 'login': {
        const { login } = await import('./modules/login.js');
        return emit(successEnvelope(await login({ timeoutMs: flags.timeout ? Number(flags.timeout) * 1000 : undefined })));
      }

      case 'logout': {
        const selection = getSelectedBrowser({ env: process.env });
        clearSession(selection.id);
        await stopDaemon();
        clearCache();
        return emit(successEnvelope({ cleared: true, browser: selection.id, hint: '已清除登录态；下次查询会重新认证，或运行 stdu-cli relogin 直接换绑。' }));
      }

      case 'browser': {
        const action = positional[1] ?? 'status';
        return emit(successEnvelope(await handleBrowser(action, positional, flags)));
      }

      case 'course':
        return emit(successEnvelope(await runQuery('course', {
          year: flags.year,
          term: flags.term,
          date: flags.tomorrow ? addDays(todayStr(), 1)
            : flags.today ? todayStr()
            : flags.date ? String(flags.date) : undefined
        }, (o) => getCourse(o), flags)));

      case 'grade':
        return emit(successEnvelope(await runQuery('grade',
          { year: flags.year, term: flags.term },
          (o) => getGrade(o), flags)));

      case 'room':
        return emit(successEnvelope(await runQuery('room', {
          weekday: flags.weekday,
          period: flags.period,
          week: flags.week,
          campus: flags.campus,
          onlyAvailable: flags.onlyAvailable
        }, (o) => getEmptyRooms(o), flags)));

      case 'daemon':
        return emit(successEnvelope(await handleDaemon(positional[1] ?? 'status')));

      case 'relogin': {
        // 换绑：清掉本机登录态，弹一次认证页用新账号登录，之后继续复用
        const d = await ensureDaemon(flags);
        if (d.via === 'daemon') {
          const data = await callDaemon(d.port, 'relogin', {}, 300000);
          return emit(successEnvelope({ ...data, via: 'daemon' }));
        }
        clearStorageState(getSelectedBrowser({ env: process.env }).id);
        clearCache();
        return emit(successEnvelope(await login({ timeoutMs: flags.timeout ? Number(flags.timeout) * 1000 : undefined })));
      }

      case 'dump': {
        const { dump } = await import('./modules/dump.js');
        return emit(successEnvelope(await dump({
          out: flags.out,
          paths: flags.paths ? String(flags.paths).split(',').filter(Boolean) : undefined
        })));
      }

      case 'calibrate': {
        const { calibrate } = await import('./modules/calibrate.js');
        return emit(successEnvelope(await calibrate({ out: flags.out })));
      }

      case 'bootstrap': {
        const { bootstrap } = await import('./modules/bootstrap.js');
        return emit(successEnvelope(await bootstrap({ out: flags.out, timeoutMs: flags.timeout ? Number(flags.timeout) * 1000 : undefined })));
      }

      case 'install': {
        const { install } = await import('./modules/install.js');
        return emit(successEnvelope(await install({ skipLogin: !!flags['no-login'] })));
      }

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

// 三级取数：缓存（毫秒级）→ 守护进程（复用已登录页面）→ 直连（自己开浏览器）。
// 这样做到「只认证一次」且绝大多数查询秒回。
async function runQuery(method, params, directFn, flags = {}) {
  const started = Date.now();
  const options = { ...flags, noCache: flags.noCache === true || flags['no-cache'] === true };

  const hit = readCache(method, params, options);
  if (hit) return { ...hit, via: 'cache', elapsedMs: Date.now() - started };

  if (!daemonDisabled(options)) {
    const d = await ensureDaemon(options);
    if (d.via === 'daemon') {
      try {
        const data = await callDaemon(d.port, method, params);
        writeCache(method, params, data, options);
        return { ...data, via: 'daemon', elapsedMs: Date.now() - started };
      } catch (error) {
        // 认证类错误直接抛出，交给上层提示用户
        if (error.code === 'LOGIN_TIMEOUT' || error.code === 'NEED_LOGIN') throw error;
        // 其余情况（守护进程异常）静默回落到直连
      }
    }
  }

  const data = await directFn({ ...params, ...options });
  writeCache(method, params, data, options);
  return { ...data, via: 'direct', elapsedMs: Date.now() - started };
}

async function handleDaemon(action) {
  switch (action) {
    case 'start': {
      const d = await ensureDaemon({});
      return { ...(await daemonStatus()), started: d.via === 'daemon' };
    }
    case 'stop':
      return stopDaemon();
    case 'restart': {
      await stopDaemon();
      await ensureDaemon({});
      return { ...(await daemonStatus()), restarted: true };
    }
    case 'status':
    default:
      return daemonStatus();
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
      const { requirePlaywright } = await import('./modules/browser.js');
      const { installManagedChromium } = await import('./modules/install.js');
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
  stdu-cli relogin                    换绑账号：清除登录态并重新认证一次
  stdu-cli logout                     清除登录态 + 停守护进程 + 清缓存
  stdu-cli daemon start|stop|restart|status   常驻守护进程（保持登录态、让查询秒回）
  stdu-cli browser status|list|use <id>|install chromium --yes
  stdu-cli course [--year 2025] [--term 1|2|3]   课表（term: 1秋 2春 3夏）
  stdu-cli course --tomorrow|--today|--date 2026-10-27   某一天的课（自动按教学周次过滤）
  stdu-cli grade [--year 2025] [--term 1|2|3]    成绩 + GPA/学分统计
  stdu-cli room [--weekday 1] [--period 1-2] [--week 1] [--campus 校本部] [--onlyAvailable]   空闲教室
  stdu-cli dump [--out path] [--paths a,b,c]     抓取真实响应，用于校准端点
  stdu-cli help

选项：
  --no-cache     跳过缓存直接查教务（课表默认缓存 6h、成绩 30min、空闲教室 10min）
  --no-daemon    不用常驻守护进程，改为单次开浏览器直连（慢，但更隔离）

说明：
  - 教务系统受 WebVPN 网关与 CAS（带验证码）保护，登录必须在真人浏览器里完成；
    CLI 只复用登录后的浏览器会话，不收集账号密码。
  - **只认证一次**：CAS 的会话 cookie 是会话级的，为此本工具做两件事——
    ① 把 cookie 导出落盘，关闭浏览器后下次注入复用；
    ② 默认起一个常驻守护进程持有已登录页面，命令复用它，不再重复认证。
    只有首次使用、或主动 relogin 换绑时才需要真人过验证码。
  - 守护进程 30 分钟无人调用会自动退出；stdu-cli daemon stop 可手动停。
  - 在校内校园网使用可直接访问 jw.stdu.edu.cn；校外需先经 WebVPN。
`;

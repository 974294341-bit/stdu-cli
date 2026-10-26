import { STDU } from '../config.js';
import { classifyAuthPage } from './auth-detector.js';
import { parseCourseJson } from './course-parser.js';
import { clickQuery, collectJsonWhile, gotoZf, postFormInPage } from './jw.js';
import { closeSession, ensureSession, needLoginError } from './session.js';
import { fetchWeekInfo, xqjOfDate, zcOfDate } from './week.js';

// 默认学年学期：9-1 月算秋季(term1)，2-7 月算春季(term2)。
export function defaultTerm(now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  if (month >= 8) return { year, term: 1 };
  if (month >= 2) return { year: year - 1, term: 2 };
  return { year: year - 1, term: 1 };
}

export function termToXqm(term) {
  return STDU.zf.termCode[term] ?? String(term);
}

// 纯查询：只依赖一个已登录的 page，不负责开关浏览器。
// 守护进程复用同一个页面反复调它，从而免去「每次启动浏览器 + 每次认证」。
export async function queryCourse(page, options = {}) {
  const { year, term } = resolveTerm(options);
  const xqm = options.xqm ?? termToXqm(term);

  // 直接 POST 到真实数据接口（绕过外壳页 + 查询按钮的不可靠点击）。
  const res = await postFormInPage(page, STDU.zf.endpoints.courseData, {
    xnm: String(year),
    xqm,
    ...STDU.zf.coursePost
  });

  let body = res.json;
  let source = 'post';
  if (!body || !Array.isArray(body.kbList)) {
    // 兜底：保留原有“导航+抓响应”路径，兼容个别改版
    const collected = await collectJsonWhile(page, async () => {
      await gotoZf(page, STDU.zf.endpoints.course);
      await clickQuery(page);
    }, { match: (url) => /xskbcx|kbcx/.test(url), afterMs: 2500 });
    body = pickKbBody(collected);
    source = body ? 'captured' : source;
  }

  if (!body || !Array.isArray(body.kbList)) {
    const error = new Error('未能从正方系统取得课表数据（未发现 kbList JSON）。');
    error.code = 'PARSE_FAILED';
    error.hint = '运行 `stdu-cli dump` 抓取真实响应后再校准端点；系统可能改版或课表接口有变动。';
    error.details = { year, term, xqm, status: res.status, url: res.url };
    throw error;
  }

  const parsed = parseCourseJson(body);
  if (!parsed) {
    const error = new Error('课表 JSON 结构无法识别。');
    error.code = 'PARSE_FAILED';
    error.hint = '运行 `stdu-cli dump` 提供真实 kbList 结构以便适配。';
    throw error;
  }

  // 按日期查询：先把「现在第几周」查出来，再把目标日期换算成教学周次后过滤
  if (options.date) {
    const weekInfo = await fetchWeekInfo(page);
    const xqj = xqjOfDate(options.date);
    const zc = zcOfDate(options.date, weekInfo);
    const courses = parsed.courses.filter((c) => (
      c.weekday === xqj && (!zc || !c.weeks || c.weeks.includes(zc))
    ));
    courses.sort((a, b) => (a.periods?.start ?? 99) - (b.periods?.start ?? 99));
    return {
      query: { year, term, xqm, date: options.date, weekday: xqj, week: zc },
      weekInfo,
      source,
      term: parsed.term,
      count: courses.length,
      courses
    };
  }

  return {
    query: { year, term, xqm },
    source,
    term: parsed.term,
    count: parsed.count,
    courses: parsed.courses
  };
}

// CLI 直连入口（守护进程不可用时）：自己开浏览器、自己关。
export async function getCourse(options = {}) {
  const { session, relogged } = await ensureSession(options);
  if (!session.auth.loggedIn) {
    await closeSession(session);
    throw needLoginError(session.auth);
  }

  try {
    const data = await queryCourse(session.page, options);
    return { ...data, relogged };
  } finally {
    await closeSession(session);
  }
}

function pickKbBody(collected) {
  for (const record of collected) {
    if (record?.body && Array.isArray(record.body.kbList)) return record.body;
  }
  return null;
}

function resolveTerm(options) {
  const fallback = defaultTerm();
  return {
    year: Number(options.year ?? fallback.year),
    term: Number(options.term ?? fallback.term)
  };
}

export { classifyAuthPage };

import { STDU } from '../config.js';
import { parseGradeJson } from './grade-parser.js';
import { clickQuery, collectJsonWhile, gotoZf, postFormInPage } from './jw.js';
import { ensureSession, needLoginError } from './session.js';
import { defaultTerm, termToXqm } from './course.js';

export async function getGrade(options = {}) {
  const { year, term } = resolveTerm(options);
  const xqm = termToXqm(term);

  // 会话过期时自动弹浏览器让用户登录，登录完在同一上下文里立刻查完返回
  const { session, relogged } = await ensureSession(options);
  if (!session.auth.loggedIn) {
    await session.context.close().catch(() => {});
    throw needLoginError(session.auth);
  }

  try {
    const { page } = session;
    // 直接 POST 到学生成绩真实数据接口（cxXsgrcj?doType=query，返回 items）。
    const res = await postFormInPage(page, STDU.zf.endpoints.gradeData, {
      xnm: String(year),
      xqm
    });

    let body = res.json;
    let source = 'post';
    if (!body || !Array.isArray(body.items)) {
      const collected = await collectJsonWhile(page, async () => {
        await gotoZf(page, STDU.zf.endpoints.grade);
        await clickQuery(page);
      }, { match: (url) => /xscjcx|cjcx/.test(url), afterMs: 3000 });
      body = pickItemsBody(collected);
      source = body ? 'captured' : source;
    }

    if (!body || !Array.isArray(body.items)) {
      const error = new Error('未能从正方系统取得成绩数据（未发现 items JSON）。');
      error.code = 'PARSE_FAILED';
      error.hint = '运行 `stdu-cli dump` 抓取真实响应后再校准成绩端点；系统可能改版或成绩查询需选学年学期。';
      error.details = { year, term, xqm, status: res.status, url: res.url };
      throw error;
    }

    const parsed = parseGradeJson(body);
    if (!parsed) {
      const error = new Error('成绩 JSON 结构无法识别。');
      error.code = 'PARSE_FAILED';
      error.hint = '运行 `stdu-cli dump` 提供真实 items 结构以便适配。';
      throw error;
    }

    return { query: { year, term, xqm }, source, relogged, ...parsed };
  } finally {
    await session.context.close().catch(() => {});
  }
}

function pickItemsBody(collected) {
  for (const record of collected) {
    if (record?.body && Array.isArray(record.body.items)) return record.body;
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

import { STDU } from '../config.js';
import { parseGradeJson } from './grade-parser.js';
import { clickQuery, collectJsonWhile, gotoZf, postFormInPage } from './jw.js';
import { closeSession, ensureSession, needLoginError } from './session.js';
import { defaultTerm, termToXqm } from './course.js';

// 纯查询：只依赖一个已登录的 page（守护进程复用同一个页面反复调它）。
export async function queryGrade(page, options = {}) {
  const { year, term } = resolveTerm(options);
  const xqm = termToXqm(term);

  {
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

    return { query: { year, term, xqm }, source, ...parsed };
  }
}

// CLI 直连入口（守护进程不可用时）。
export async function getGrade(options = {}) {
  const { session, relogged } = await ensureSession(options);
  if (!session.auth.loggedIn) {
    await closeSession(session);
    throw needLoginError(session.auth);
  }

  try {
    const data = await queryGrade(session.page, options);
    return { ...data, relogged };
  } finally {
    await closeSession(session);
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

import { STDU } from '../config.js';
import { classifyAuthPage } from './auth-detector.js';
import { parseCourseJson } from './course-parser.js';
import { clickQuery, collectJsonWhile, gotoZf, postFormInPage } from './jw.js';
import { needLoginError, openSession } from './session.js';

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

export async function getCourse(options = {}) {
  const { year, term } = resolveTerm(options);
  const xqm = termToXqm(term);

  const session = await openSession(options);
  if (!session.auth.loggedIn) {
    await session.context.close().catch(() => {});
    throw needLoginError(session.auth);
  }

  try {
    const { page } = session;
    const collected = await collectJsonWhile(page, async () => {
      await gotoZf(page, STDU.zf.endpoints.course);
      await clickQuery(page);
    }, { match: (url) => /xskbcx|kbcx/.test(url), afterMs: 2500 });

    let body = pickKbBody(collected);
    let source = body ? 'captured' : null;

    if (!body) {
      // 兜底：直接在页面上下文里 POST 查询（带浏览器 Cookie，穿透 WebVPN）。
      const res = await postFormInPage(page, STDU.zf.endpoints.course.split('?')[0], {
        xnm: String(year),
        xqm,
        kzlx: 'ck'
      });
      if (res.json && Array.isArray(res.json.kbList)) {
        body = res.json;
        source = 'post';
      }
    }

    if (!body) {
      const error = new Error('未能从正方系统取得课表数据（未发现 kbList JSON）。');
      error.code = 'PARSE_FAILED';
      error.hint = '运行 `stdu-cli dump` 抓取真实响应后再校准端点；系统可能改版或课表接口有变动。';
      error.details = { year, term, xqm, collectedUrls: collected.map((c) => c.url) };
      throw error;
    }

    const parsed = parseCourseJson(body);
    if (!parsed) {
      const error = new Error('课表 JSON 结构无法识别。');
      error.code = 'PARSE_FAILED';
      error.hint = '运行 `stdu-cli dump` 提供真实 kbList 结构以便适配。';
      throw error;
    }

    return {
      query: { year, term, xqm },
      source,
      ...parsed
    };
  } finally {
    await session.context.close().catch(() => {});
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

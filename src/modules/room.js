import { STDU } from '../config.js';
import { parseRoomJson } from './room-parser.js';
import { postFormInPage } from './jw.js';
import { closeSession, ensureSession, needLoginError } from './session.js';

// 查询某时段空闲教室。
// options: { weekday(1-7), period('1-2'|'3'), week(8 | '1-16'), campus, type }
//
// 正方空闲教室接口（cdjy_cxKxcdlb.html?doType=query）的 zcd/jcd 为位掩码：
//   zcd |= 1<<(周-1)，jcd |= 1<<(节次-1)；xqj 为逗号分隔的星期(1-7)。
// 留 0/空 表示不限制（返回全部教室）。
// 纯查询：只依赖一个已登录的 page（守护进程复用同一个页面反复调它）。
export async function queryEmptyRooms(page, options = {}) {
  {
    const form = buildRoomForm(options);
    const res = await postFormInPage(page, STDU.zf.endpoints.roomData, form);

    let body = res.json;
    if (!body || !Array.isArray(body.items)) {
      const error = new Error('未能取得空闲教室数据（未发现 items JSON）。');
      error.code = 'PARSE_FAILED';
      error.hint = '运行 stdu-cli dump 抓取真实响应后再校准空闲教室端点；系统可能改版。';
      error.details = { status: res.status, url: res.url, form };
      throw error;
    }

    const parsed = parseRoomJson(body);
    if (!parsed) {
      const error = new Error('空闲教室 JSON 结构无法识别。');
      error.code = 'PARSE_FAILED';
      error.hint = '运行 stdu-cli dump 提供真实 items 结构以便适配。';
      throw error;
    }

    const rooms = options.onlyAvailable
      ? parsed.rooms.filter((r) => r.available == null || r.available > 0)
      : parsed.rooms;

    return { query: options, source: 'post', count: rooms.length, rooms };
  }
}

// CLI 直连入口（守护进程不可用时）。
export async function getEmptyRooms(options = {}) {
  const { session, relogged } = await ensureSession(options);
  if (!session.auth.loggedIn) {
    await closeSession(session);
    throw needLoginError(session.auth);
  }

  try {
    const data = await queryEmptyRooms(session.page, options);
    return { ...data, relogged };
  } finally {
    await closeSession(session);
  }
}

// 把 "1-2" / "3" / "1-16" 解析成整数数组
export function parseRange(value) {
  if (value == null || value === '') return [];
  const text = String(value).replace(/节/g, '');
  const out = [];
  for (const part of text.split(/[,，]/)) {
    const m = part.match(/(\d+)\s*[-~至]\s*(\d+)/);
    if (m) {
      const a = Number(m[1]); const b = Number(m[2]);
      for (let i = Math.min(a, b); i <= Math.max(a, b); i += 1) out.push(i);
    } else if (/^\d+$/.test(part.trim())) {
      out.push(Number(part.trim()));
    }
  }
  return [...new Set(out)];
}

function weekMask(value) {
  return parseRange(value).reduce((mask, w) => mask | (1 << (w - 1)), 0);
}

function sectionMask(value) {
  return parseRange(value).reduce((mask, s) => mask | (1 << (s - 1)), 0);
}

function buildRoomForm(options) {
  const { year, term } = resolveTermFallback(options);
  const xqm = STDU.zf.termCode[term] ?? String(term);
  const form = {};
  for (const f of STDU.zf.roomPost.fields) form[f] = '';
  form.xnm = String(year);
  form.xqm = xqm;
  form.jyfs = STDU.zf.roomPost.jyfs;
  if (options.campus) form.xqh_id = String(options.campus);
  if (options.type) form.cdlb_id = String(options.type);
  if (options.weekday != null) {
    form.xqj = parseRange(options.weekday).join(',');
  }
  if (options.week != null) form.zcd = String(weekMask(options.week));
  if (options.period) form.jcd = String(sectionMask(options.period));
  return form;
}

function resolveTermFallback(options) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const fallback = m >= 8 ? { year: y, term: 1 } : (m >= 2 ? { year: y - 1, term: 2 } : { year: y - 1, term: 1 });
  return {
    year: Number(options.year ?? fallback.year),
    term: Number(options.term ?? fallback.term)
  };
}

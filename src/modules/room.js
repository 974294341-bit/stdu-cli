import { STDU } from '../config.js';
import { parseRoomJson } from './room-parser.js';
import { clickQuery, collectJsonWhile, gotoZf, postFormInPage } from './jw.js';
import { needLoginError, openSession } from './session.js';

// 正方 V9 空闲教室端点（经验值，学校定制差异用 dump 校准）。
const ROOM_ENDPOINT = '/kbcx/kbcx_cxKxjs.html?gnmkdm=N2155';

// 查询某时段空闲教室。
// options: { weekday(1-7), period('1-2'), week(1..20), campus }
export async function getEmptyRooms(options = {}) {
  const session = await openSession(options);
  if (!session.auth.loggedIn) {
    await session.context.close().catch(() => {});
    throw needLoginError(session.auth);
  }

  try {
    const { page } = session;
    const collected = await collectJsonWhile(page, async () => {
      await gotoZf(page, ROOM_ENDPOINT);
      await clickQuery(page);
    }, { match: (url) => /kbcx|kxjs|Kxjs/.test(url), afterMs: 3000 });

    let body = pickRowsBody(collected);
    let source = body ? 'captured' : null;

    if (!body) {
      // 兜底：直接在页面上下文 POST（带浏览器 Cookie 穿透 WebVPN）。
      // 参数多为可选；学校若要求先选学期/周次/节次，传 options 即可。
      const res = await postFormInPage(page, ROOM_ENDPOINT.split('?')[0], buildForm(options));
      if (res.json && Array.isArray(res.json.rows)) {
        body = res.json;
        source = 'post';
      }
    }

    if (!body) {
      const error = new Error('未能取得空闲教室数据（未发现 rows JSON）。');
      error.code = 'PARSE_FAILED';
      error.hint = '运行 stdu-cli dump 抓取真实响应后再校准空闲教室端点与字段；学校可能改版或需要先选查询条件。';
      error.details = { collectedUrls: collected.map((c) => c.url) };
      throw error;
    }

    const parsed = parseRoomJson(body);
    if (!parsed) {
      const error = new Error('空闲教室 JSON 结构无法识别。');
      error.code = 'PARSE_FAILED';
      error.hint = '运行 stdu-cli dump 提供真实 rows 结构以便适配。';
      throw error;
    }

    const rooms = options.onlyAvailable
      ? parsed.rooms.filter((r) => r.available == null || r.available > 0)
      : parsed.rooms;

    return { query: options, source, count: rooms.length, rooms };
  } finally {
    await session.context.close().catch(() => {});
  }
}

function buildForm(options) {
  const form = {};
  if (options.weekday) form.xqj = String(options.weekday);
  if (options.period) form.jcdm = String(options.period);
  if (options.week) form.zcdm = String(options.week);
  if (options.campus) form.xqh_id = String(options.campus);
  return form;
}

function pickRowsBody(collected) {
  for (const record of collected) {
    if (record?.body && Array.isArray(record.body.rows)) return record.body;
  }
  return null;
}

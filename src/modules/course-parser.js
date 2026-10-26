// 正方 V9 课表解析。优先消费 JSON（xskbcx_cxXsKb 返回的 kbList），
// 字段名做了多别名兜底，以适配不同学校定制。

const WEEKDAY_LABEL = { 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六', 7: '周日' };

export function parseCourseJson(body) {
  const list = extractKbList(body);
  if (!list) return null;
  const courses = list.map(normalizeCourse).filter(Boolean);
  const term = extractTerm(body);
  return { count: courses.length, term, courses };
}

function extractKbList(body) {
  if (!body || typeof body !== 'object') return null;
  const candidates = [body.kbList, body.data?.kbList, body.rows, body.data?.rows, body.list];
  return candidates.find((value) => Array.isArray(value)) ?? null;
}

function extractTerm(body) {
  const xsxx = body?.xsxx ?? body?.data?.xsxx ?? {};
  return {
    year: xsxx.XNMC ?? xsxx.xnmc ?? xsxx.XNM ?? null,
    term: xsxx.XQMMC ?? xsxx.xqmmc ?? xsxx.XQM ?? null,
    studentId: xsxx.XH ?? xsxx.xh ?? null,
    studentName: xsxx.XM ?? xsxx.xm ?? null
  };
}

function normalizeCourse(item) {
  if (!item || typeof item !== 'object') return null;
  const name = pick(item, ['kcmc', 'KCMC', 'courseName', 'kcmc_mc']);
  if (!name) return null;
  const weekday = toInt(pick(item, ['xqj', 'XQJ', 'weekday']));
  const periods = parsePeriods(pick(item, ['jcs', 'JCS', 'jc', 'periods']));
  return {
    name: String(name).trim(),
    teacher: pick(item, ['xm', 'XM', 'jsxm', 'teacher']) ?? null,
    weekday,
    weekdayLabel: weekday ? WEEKDAY_LABEL[weekday] ?? `周${weekday}` : null,
    periods,
    weeks: parseWeeks(pick(item, ['zcd', 'ZCD', 'weeks', 'zcmc'])),
    location: pick(item, ['cdmc', 'CDMC', 'jsmc', 'location']) ?? null,
    campus: pick(item, ['xqmc', 'XQMC', 'campus']) ?? null,
    credit: pick(item, ['xf', 'XF', 'credit']) ?? null,
    raw: item
  };
}

// "1-2" / "3" / "1-2节" / "第1-2节"
export function parsePeriods(value) {
  if (value == null) return null;
  const text = String(value);
  const match = text.match(/(\d+)\s*[-~至]\s*(\d+)/) ?? text.match(/第?\s*(\d+)\s*节/);
  if (!match) return null;
  if (match[2] != null) {
    return { start: Number(match[1]), end: Number(match[2]) };
  }
  return { start: Number(match[1]), end: Number(match[1]) };
}

// "1-16周" / "1-8,10-16周" / "1-16周(单)" / "3-15周(双)"
export function parseWeeks(value) {
  if (value == null) return null;
  const text = String(value).replace(/\s/g, '');
  const single = /单/.test(text);
  const double = /双/.test(text);
  const weeks = new Set();
  const regex = /(\d+)(?:\s*[-~至]\s*(\d+))?/g;
  let m;
  while ((m = regex.exec(text)) !== null) {
    const start = Number(m[1]);
    const end = m[2] != null ? Number(m[2]) : start;
    if (start > 60 || end > 60) continue;
    for (let w = start; w <= end; w += 1) {
      if (single && w % 2 === 0) continue;
      if (double && w % 2 === 1) continue;
      weeks.add(w);
    }
  }
  return weeks.size ? [...weeks].sort((a, b) => a - b) : null;
}

function pick(obj, keys) {
  for (const key of keys) {
    if (obj[key] != null && obj[key] !== '') return obj[key];
  }
  return null;
}

function toInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

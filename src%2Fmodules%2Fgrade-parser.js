// 正方 V9 成绩解析。优先消费 JSON（items 数组），字段多别名兜底。

export function parseGradeJson(body) {
  const list = extractItems(body);
  if (!list) return null;
  const grades = list.map(normalizeGrade).filter(Boolean);
  return { count: grades.length, grades, stats: computeStats(grades) };
}

function extractItems(body) {
  if (!body || typeof body !== 'object') return null;
  const candidates = [body.items, body.data?.items, body.rows, body.data?.rows, body.list];
  return candidates.find((value) => Array.isArray(value)) ?? null;
}

function normalizeGrade(item) {
  if (!item || typeof item !== 'object') return null;
  const name = pick(item, ['kcmc', 'KCMC', 'courseName']);
  if (!name) return null;
  return {
    name: String(name).trim(),
    score: pick(item, ['cj', 'CJ', 'bfzcj1', 'zcj', 'score', 'zpcj']),
    credit: toNum(pick(item, ['xf', 'XF', 'credit'])),
    gpa: toNum(pick(item, ['jd', 'JD', 'xfjd', 'gpa'])),
    nature: pick(item, ['kcxzmc', 'kcxz', 'KCXZ', 'kclbmc']) ?? null,
    examType: pick(item, ['ksxz', 'ksxzdm', 'KSXZ', 'kcbj']) ?? null,
    teacher: pick(item, ['jsxm', 'JSXM', 'rkjs']) ?? null,
    year: pick(item, ['xnmmc', 'xnm', 'XNM', 'year']) ?? null,
    term: pick(item, ['xqmmc', 'xqm', 'XQM', 'term']) ?? null,
    raw: item
  };
}

export function computeStats(grades) {
  let totalCredit = 0;
  let passedCredit = 0;
  let weighted = 0;
  let gpaCredit = 0;
  let gpaSum = 0;
  for (const g of grades) {
    const credit = g.credit ?? 0;
    totalCredit += credit;
    const score = toNum(g.score);
    if (score != null && score >= 60) {
      passedCredit += credit;
      weighted += score * credit;
    }
    if (g.gpa != null) {
      gpaSum += g.gpa * credit;
      gpaCredit += credit;
    }
  }
  return {
    totalCredit: round(totalCredit),
    passedCredit: round(passedCredit),
    averageScore: passedCredit > 0 ? round(weighted / passedCredit) : null,
    weightedGpa: gpaCredit > 0 ? round(gpaSum / gpaCredit, 3) : null
  };
}

function pick(obj, keys) {
  for (const key of keys) {
    if (obj[key] != null && obj[key] !== '') return obj[key];
  }
  return null;
}

function toNum(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value, digits = 2) {
  if (value == null) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

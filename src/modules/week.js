// 当前教学周次。正方把「现在是第几周」放在「学生课表查询（按周次）」页里：
//   隐藏域 dqzc = 当前周次（如 7）
//   下拉 zs   = "7(2026-10-26至2026-11-01)"，给出本周的日期区间
// 有了 dqzc + 本周起始日，就能把任意日期换算成教学周次，从而回答「明天有什么课」。
import { gotoZf } from './jw.js';

export const WEEK_PAGE = '/kbcx/xskbcxZccx_cxXskbcxIndex.html?gnmkdm=N2154';

export async function fetchWeekInfo(page) {
  await gotoZf(page, WEEK_PAGE);
  await new Promise((r) => setTimeout(r, 1200));
  const info = await page.evaluate(() => {
    const hidden = {};
    document.querySelectorAll('input[type=hidden]').forEach((i) => {
      if (i.name) hidden[i.name] = i.value;
    });
    const zs = document.getElementById('zs');
    const sel = zs && zs.options[zs.selectedIndex];
    return {
      currentZc: hidden.dqzc != null && hidden.dqzc !== '' ? Number(hidden.dqzc) : null,
      zsText: sel ? sel.text : null,
      zsValue: sel ? sel.value : null
    };
  }).catch(() => ({ currentZc: null, zsText: null, zsValue: null }));

  return { ...info, weekStart: parseWeekStart(info.zsText) };
}

// "7(2026-10-26至2026-11-01)" -> "2026-10-26"
function parseWeekStart(zsText) {
  const m = String(zsText ?? '').match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

// 日期 -> 教学周次。weekStart 为本周起始日（周一），currentZc 为该周周次。
export function zcOfDate(dateStr, info) {
  const start = info?.weekStart;
  const base = info?.currentZc;
  if (!start || !base) return null;
  const s = new Date(`${start}T00:00:00`);
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(d.getTime())) return null;
  const diffDays = Math.round((d - s) / 86400000);
  const zc = base + Math.floor(diffDays / 7);
  return zc >= 1 ? zc : null;
}

// JS 星期(0=周日) -> 正方 xqj(1=周一 … 7=周日)
export function xqjOfDate(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.getDay();
  return day === 0 ? 7 : day;
}

export function todayStr(now = new Date()) {
  return isoOf(now);
}

export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + n);
  return isoOf(d);
}

function isoOf(d) {
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

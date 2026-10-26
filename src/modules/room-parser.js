// 正方 V9 空闲教室解析。查询返回 JSON（rows 数组），字段名多别名兜底。
// 典型字段：jasm/jasmc（教学楼）、jsmc（教室）、czrs/zss（座位数）、synum/kyl/kys（可用数）、xqmc（校区）。

export function parseRoomJson(body) {
  const rows = extractRows(body);
  if (!rows) return null;
  const rooms = rows.map(normalizeRoom).filter(Boolean);
  return { count: rooms.length, rooms };
}

function extractRows(body) {
  if (!body || typeof body !== 'object') return null;
  const candidates = [body.rows, body.data?.rows, body.items, body.data?.items, body.list];
  return candidates.find((value) => Array.isArray(value)) ?? null;
}

function normalizeRoom(item) {
  if (!item || typeof item !== 'object') return null;
  const room = pick(item, ['jsmc', 'JASMC', 'jasmc', 'roomName', 'cdmc']);
  if (!room) return null;
  const capacity = toInt(pick(item, ['czrs', 'CZRS', 'zss', 'capacity', 'zws', 'kszws1']));
  const available = toInt(pick(item, ['synum', 'SYNUM', 'kyl', 'KYS', 'kys', 'available', 'kxs']));
  return {
    building: pick(item, ['jasm', 'JASM', 'jxlmc', 'xqmc']) ?? null,
    room: String(room).trim(),
    floor: pick(item, ['lch', 'LH', 'floor']) ?? null,
    type: pick(item, ['cdlbmc', 'cdlb', 'CDLB', 'roomType']) ?? null,
    campus: pick(item, ['xqmc', 'XQMC', 'campus']) ?? null,
    campusId: pick(item, ['xqh_id', 'xqh']) ?? null,
    capacity,
    // 该接口返回的是“指定时段空闲教室”列表，整间空闲 → 可用数=容量
    available: available == null ? capacity : available,
    raw: item
  };
}

function pick(obj, keys) {
  for (const key of keys) {
    if (obj[key] != null && obj[key] !== '') return obj[key];
  }
  return null;
}

function toInt(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

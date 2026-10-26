import test from 'node:test';
import assert from 'node:assert/strict';

import { parseCourseJson, parsePeriods, parseWeeks } from '../src/modules/course-parser.js';
import { computeStats, parseGradeJson } from '../src/modules/grade-parser.js';
import { parseRoomJson } from '../src/modules/room-parser.js';

test('parsePeriods 兼容多种写法', () => {
  assert.deepEqual(parsePeriods('1-2'), { start: 1, end: 2 });
  assert.deepEqual(parsePeriods('第3节'), { start: 3, end: 3 });
  assert.deepEqual(parsePeriods('5-6节'), { start: 5, end: 6 });
  assert.equal(parsePeriods('无'), null);
});

test('parseWeeks 处理周区间与单双周', () => {
  assert.deepEqual(parseWeeks('1-16周'), [...Array(16)].map((_, i) => i + 1));
  assert.deepEqual(parseWeeks('1-8,10-16周'), [...Array(8)].map((_, i) => i + 1).concat([...Array(7)].map((_, i) => i + 10)));
  assert.deepEqual(parseWeeks('1-15周(单)'), [1, 3, 5, 7, 9, 11, 13, 15]);
  assert.deepEqual(parseWeeks('2-16周(双)'), [2, 4, 6, 8, 10, 12, 14, 16]);
});

test('parseCourseJson 解析 kbList', () => {
  const body = {
    xsxx: { XNMC: '2024-2025', XQMMC: '1', XH: '2023001', XM: '张三' },
    kbList: [
      { kcmc: '高等数学', xm: '李雷', xqj: '1', jcs: '1-2', zcd: '1-16周', cdmc: '教1-101', xqmc: '校本部', xf: '5.0' },
      { kcmc: '大学英语', xm: '韩梅梅', xqj: '3', jcs: '3-4', zcd: '1-16周(单)', cdmc: '教2-203' }
    ]
  };
  const result = parseCourseJson(body);
  assert.equal(result.count, 2);
  assert.equal(result.term.studentName, '张三');
  assert.equal(result.courses[0].weekday, 1);
  assert.deepEqual(result.courses[0].periods, { start: 1, end: 2 });
  assert.deepEqual(result.courses[0].weeks, [...Array(16)].map((_, i) => i + 1));
  assert.deepEqual(result.courses[1].weeks, [1, 3, 5, 7, 9, 11, 13, 15]);
  assert.equal(result.courses[0].credit, '5.0');
});

test('parseGradeJson 解析 items 并统计', () => {
  const body = {
    items: [
      { kcmc: '高等数学', cj: '85', xf: '5', jd: '3.7', kctype: '必修', xnm: '2024', xqm: '3' },
      { kcmc: '大学英语', cj: '92', xf: '3', jd: '4.0', kctype: '必修', xnm: '2024', xqm: '3' },
      { kcmc: '体育', cj: '55', xf: '1', jd: '0', kctype: '必修', xnm: '2024', xqm: '3' }
    ]
  };
  const result = parseGradeJson(body);
  assert.equal(result.count, 3);
  assert.equal(result.stats.totalCredit, 9);
  assert.equal(result.stats.passedCredit, 8); // 体育 55 不及格不计入
  // 加权绩点分母含挂科那门（绩点 0，学分 1）：(3.7*5 + 4.0*3 + 0*1) / (5+3+1) = 3.389
  assert.equal(result.stats.weightedGpa, 3.389);
});

test('computeStats 空数据不报错', () => {
  const stats = computeStats([]);
  assert.equal(stats.totalCredit, 0);
  assert.equal(stats.weightedGpa, null);
});

test('解析器对未知结构返回 null', () => {
  assert.equal(parseCourseJson({ foo: 1 }), null);
  assert.equal(parseGradeJson({ foo: 1 }), null);
});

test('parseRoomJson 解析 rows', () => {
  const body = {
    rows: [
      { jasm: '教1', jsmc: '教1-101', czrs: '60', synum: '55', xqmc: '校本部' },
      { jasm: '教1', jsmc: '教1-102', czrs: '60', synum: '0', xqmc: '校本部' },
      { jasm: '教2', jsmc: '教2-201', zss: '80', kyl: '80' }
    ]
  };
  const result = parseRoomJson(body);
  assert.equal(result.count, 3);
  assert.equal(result.rooms[0].room, '教1-101');
  assert.equal(result.rooms[0].capacity, 60);
  assert.equal(result.rooms[0].available, 55);
  assert.equal(result.rooms[2].available, 80); // 别名 kyl 兜底
});

test('parseRoomJson 未知结构返回 null', () => {
  assert.equal(parseRoomJson({ xxx: 1 }), null);
});


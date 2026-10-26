import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { STDU } from '../config.js';
import { clickQuery, gotoZf } from './jw.js';
import { needLoginError, openSession } from './session.js';

const DEFAULT_PATHS = [
  STDU.zf.endpoints.menu,
  STDU.zf.endpoints.course,
  STDU.zf.endpoints.grade,
  STDU.zf.endpoints.profile
];

// 抓取模式：在登录态下依次打开若干页面，记录所有响应（JSON/HTML 文本），
// 存成文件，用于校准端点与解析器。这是"逆向"阶段的核心数据收集手段。
export async function dump(options = {}) {
  const session = await openSession(options);
  if (!session.auth.loggedIn) {
    await session.context.close().catch(() => {});
    throw needLoginError(session.auth);
  }

  const records = [];
  const onResponse = async (response) => {
    const url = response.url();
    if (!/jw\.stdu\.edu\.cn|webproxy\.stdu\.edu\.cn/.test(url)) return;
    const type = (response.headers()['content-type'] ?? '').toLowerCase();
    if (!/json|html|javascript|xml/.test(type)) return;
    try {
      const text = await response.text();
      records.push({
        url,
        status: response.status(),
        contentType: type,
        size: text.length,
        text: text.slice(0, 20000)
      });
    } catch {
      // 忽略读取失败
    }
  };

  try {
    session.page.on('response', onResponse);
    const paths = options.paths?.length ? options.paths : DEFAULT_PATHS;
    for (const path of paths) {
      process.stderr.write(`[dump] 访问 ${path}\n`);
      await gotoZf(session.page, path).catch(() => {});
      await clickQuery(session.page).catch(() => {});
      await session.page.waitForTimeout(options.waitMs ?? 2500);
    }
  } finally {
    await session.context.close().catch(() => {});
  }

  const outPath = options.out ?? join(process.cwd(), `dump/stdu-dump-${Date.now()}.json`);
  mkdirSync(join(outPath, '..'), { recursive: true });
  const payload = {
    dumpedAt: new Date().toISOString(),
    school: STDU.schoolName,
    records,
    note: '把本文件提供给维护者即可校准 course/grade 端点与字段；请勿在其中包含账号密码（密码不会出现在响应里）。'
  };
  writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return { outPath, count: records.length, endpoints: DEFAULT_PATHS };
}

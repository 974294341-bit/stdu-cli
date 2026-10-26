// 校准脚本：借已登录的浏览器会话，抓取正方 zftal-ui-v5 课表/成绩/空教室真实接口响应。
// 输出用于校准 config.js 端点与 *-parser.js 字段——这是“逆向”的最后一公里。
//
// 关键坑（2026-10 实测，已逐一解决）：
//  1) 功能页（课表/成绩/空教室）自身不加载 jQuery 核心，依赖父框架提供；standalone 打开时 window.jQuery 为
//     undefined，页面底部驱动脚本（xskbcx.js / cxDgXscj.js / kxcdlb.js）里的 jQuery(function(){...}) 直接抛错，
//     #search_go 等按钮的点击处理【根本没绑定】，点“查询”什么都不发。
//     解决：先注入同域 jQuery，再【重新执行】驱动脚本（addScriptTag content），处理才绑定；然后点 #search_go。
//  2) 数据是 POST；context 'response' 监听异步、时机不稳，抓不到快响应的 AJAX。
//     解决（核心）：在页面内【包裹 jQuery.ajax】，记录每次调用的 url/type/data/raw responseText，
//     直接通过 page.evaluate 把结果带回 Node，100% 可靠。
//  3) 驱动脚本各自路径（前端写死，本机部署稳定）：
//       课表 N2151 → /js/comp/jwglxt/pkgl/kbcx/xskbcx.js
//       成绩 N305005 → /js/comp/jwglxt/cjgl/cjcx/cxDgXscj.js
//       空教室 N2155 → /js/comp/jwglxt/pkgl/cdjy/kxcdlb.js
//     静态资源需登录态（未登录 302→CAS），必须在已登录会话的 page 上下文内 fetch。
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { STDU } from '../config.js';
import { closeSession, needLoginError, openSession } from './session.js';

const STATIC_RE = /\.(js|css|png|jpg|jpeg|gif|webp|woff2?|ttf|ico|svg|map)(\?|$)/i;
const FUNC_PAGES = ['xskbcx_cxXskbcxIndex', 'cjcx_cxDgXscj', 'cdjy_cxKxcdlb', 'xsgrxxwh_cxXsgrxx'];
const DRIVER_JS_RE = {
  course: /kbcx\/xskbcx\.js/,
  grade: /cjcx\/cxDgXscj\.js/,
  room: /cdjy\/kxcdlb\.js/
};

function markersOf(text) {
  const hasKb = /"kbList"/.test(text) || /"kbListNew"/.test(text);
  const hasItems = /"items"/.test(text) || /"cjgl"/.test(text);
  const hasRows = /"rows"/.test(text);
  const hasJson = /[\[{][\s\S]{20,}/.test(text) && /"[^"]+"\s*:/.test(text);
  return { hasKb, hasItems, hasRows, hasJson };
}

function extractClickMenus(html) {
  const out = [];
  const re = /clickMenu\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(html)) !== null) out.push({ gnmkdm: m[1], path: m[2], name: m[3] });
  return out;
}

function findDriverJs(html, key) {
  const re = /<script[^>]*src="([^"]+\.js[^"]*)"[^>]*>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (DRIVER_JS_RE[key] && DRIVER_JS_RE[key].test(m[1])) return m[1];
  }
  return null;
}

async function ensureJQuery(page, jqUrl) {
  const has = await page.evaluate(() => !!(window.jQuery || window.$)).catch(() => false);
  if (has) return true;
  const origin = (() => { try { return new URL(page.url()).origin; } catch { return STDU.jw.base; } })();
  const candidates = [
    jqUrl,
    `${origin}/zftal-ui-v5-1.0.2/assets/js/other_jquery/jquery.min.js`,
    `${origin}/js/plugins/jquery/jquery.min.js`,
    `${origin}/zftal-ui-v5-1.0.2/assets/js/jquery.min.js`
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      await page.addScriptTag({ url: c });
      const ok = await page.evaluate(() => !!(window.jQuery || window.$)).catch(() => false);
      if (ok) { process.stderr.write(`   [ensureJQuery] 注入成功：${c}\n`); return true; }
    } catch (e) { process.stderr.write(`   [ensureJQuery] 注入失败 ${c}：${e.message}\n`); }
  }
  return false;
}

async function fetchAssetInPage(page, url) {
  return page.evaluate(async (u) => {
    try {
      const r = await fetch(u, { credentials: 'same-origin', cache: 'no-store' });
      if (!r.ok) return { ok: false, status: r.status, text: '' };
      return { ok: true, status: r.status, text: await r.text() };
    } catch (e) { return { ok: false, error: String(e) }; }
  }, url).catch((e) => ({ ok: false, error: String(e) }));
}

// 在页面内包裹 jQuery.ajax，记录每次调用的真实 url/type/data/raw 响应（兜底）。
async function installAjaxSpy(page) {
  await page.evaluate(() => {
    window.__cap = [];
    if (window.jQuery && !window.__capInstalled) {
      const _ajax = window.jQuery.ajax.bind(window.jQuery);
      window.jQuery.ajax = function (url, opts) {
        const s = (typeof url === 'object') ? Object.assign({}, url) : Object.assign({ url }, opts || {});
        const _complete = s.complete;
        s.complete = function (xhr) {
          try {
            window.__cap.push({
              url: s.url,
              type: (s.type || s.method || 'GET').toUpperCase(),
              data: (typeof s.data === 'string') ? s.data : (s.data || null),
              status: xhr.status,
              responseText: xhr.responseText,
              ct: xhr.getResponseHeader('content-type')
            });
          } catch (e) { window.__cap.push({ url: s.url, error: String(e) }); }
          if (_complete) try { _complete.apply(this, arguments); } catch (e) { /* ignore */ }
        };
        return _ajax(s);
      };
      window.__capInstalled = true;
    }
  }).catch(() => {});
}

// 重新执行驱动脚本（功能页 standalone 打开时 jQuery 缺失，处理未绑定；注入 jQuery 后重跑使其生效）。
async function reexecDriver(page, key) {
  let reRan = false;
  try {
    const html = await page.content().catch(() => '');
    const src = findDriverJs(html, key);
    if (src) {
      const origin = (() => { try { return new URL(page.url()).origin; } catch { return STDU.jw.base; } })();
      const abs = src.startsWith('http') ? src : `${origin}${src.startsWith('/') ? '' : '/'}${src}`;
      const got = await fetchAssetInPage(page, abs);
      if (got && got.ok && got.text) { await page.addScriptTag({ content: got.text }).catch(() => {}); reRan = true; }
    }
  } catch { /* ignore */ }
  return reRan;
}

// 直接调用各功能页的「真实数据接口」（绕过按钮的表单校验门控）：
//   course → /kbcx/xskbcx_cxXsgrkb.html   (paramMap: xnm,xqm,kzlx=ck…)
//   grade  → /cjcx/cjcx_cxXsgrcj.html?doType=query  (paramMap: xnm,xqm)
//   room   → /cdjy/cdjy_cxKxcdlb.html?doType=query  (queryFunc 的 map)
// 在页面内用 jQuery.ajax 发请求并直接把 raw 响应带回，100% 可靠。
async function replayData(page, key) {
  return page.evaluate(async (key) => {
    const J = window.jQuery || window.$;
    if (!J) return { ok: false, error: 'no-jquery' };
    const origin = location.origin;
    const fire = (url, data) => new Promise((resolve) => {
      J.ajax({
        url: url.indexOf('http') === 0 ? url : origin + url,
        type: 'POST', data,
        complete: (xhr) => resolve({ ok: true, url, postData: data, status: xhr.status, text: xhr.responseText, ct: xhr.getResponseHeader('content-type') })
      });
    });
    if (key === 'course') {
      const map = (typeof paramMap === 'function') ? paramMap() : { xnm: J('#xnm').val(), xqm: J('#xqm').val() };
      return await fire('/kbcx/xskbcx_cxXsgrkb.html', map);
    }
    if (key === 'grade') {
      const map = (typeof paramMap === 'function') ? paramMap() : { xnm: J('#xnm').val(), xqm: J('#xqm').val() };
      return await fire('/cjcx/cjcx_cxXsgrcj.html?doType=query', map);
    }
    if (key === 'room') {
      // 复刻 room.js queryFunc() 的 map（jyfs=0 按周次，zcd/xqj/jcd=0 表示不限）
      const val = (id) => { const e = J('#' + id); return e.length ? e.val() : ''; };
      const map = {
        xqh_id: val('xqh_id') || '',
        xnm: J('#xnm').val(),
        xqm: J('#xqm').val(),
        cdlb_id: val('cdlb_id') || '',
        cdejlb_id: val('cdejlb_id') || '',
        qszws: val('qszws') || '',
        jszws: val('jszws') || '',
        cdmc: val('cdmc') || '',
        cd_id: val('cd_id_cx') || '',
        lh: val('lh') || '',
        jyfs: '0',
        cdjylx: val('cdjylx') || '',
        zysx: val('zysx_1') || '',
        sflb: val('sflb_1') || '',
        hbsl: val('hbsl_1') || '',
        bbsl: val('bbsl_1') || '',
        sfyzz: val('sfyzz_1') || '',
        sfjtjs: val('sfjtjs_1') || '',
        tjsl: val('tjsl_1') || '',
        tymbsl: val('tymbsl_1') || '',
        yczb: val('yczb_1') || '',
        zws: val('zws_1') || '',
        sfbhkc: val('sfbhkc') || '',
        kszws1: val('kszws1_1') || '',
        zcd: 0, xqj: '', jcd: 0
      };
      return await fire('/cdjy/cdjy_cxKxcdlb.html?doType=query', map);
    }
    return { ok: false, error: 'unknown-key' };
  }, key).catch((e) => ({ ok: false, error: String(e) }));
}

// 兜底：直接读 jqGrid 的 url + postData，在页面内发 AJAX（成绩/空教室用）。
async function fetchGridData(page) {
  await ensureJQuery(page);
  return page.evaluate(async () => {
    const J = window.jQuery || window.$;
    if (!J) return { ok: false, error: 'no-jquery' };
    const grid = J('table.ui-jqgrid-btable').first();
    if (!grid || !grid.length) return { ok: false, error: 'no-jqgrid' };
    let url, pd;
    try {
      url = grid.jqGrid('getGridParam', 'url');
      pd = grid.jqGrid('getGridParam', 'postData') || {};
    } catch (e) { return { ok: false, error: 'jqgrid-api:' + String(e) }; }
    if (!url) return { ok: false, error: 'no-url' };
    const data = {};
    for (const k of Object.keys(pd)) {
      let v = pd[k];
      if (typeof v === 'function') { try { v = v.call(grid[0]); } catch { v = ''; } }
      data[k] = v;
    }
    data._search = data._search ?? false;
    data.nd = Date.now();
    data.rows = data.rows || 100;
    data.page = data.page || 1;
    data.sidx = data.sidx || '';
    data.sord = data.sord || 'asc';
    return await new Promise((resolve) => {
      J.ajax({
        url, type: 'POST', data,
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        complete: (xhr) => resolve({ ok: true, url, postData: data, status: xhr.status, text: xhr.responseText, ct: xhr.getResponseHeader('content-type') })
      });
    });
  }).catch((e) => ({ ok: false, error: String(e) }));
}

export async function calibrateOnSession(session, options = {}) {
  const records = [];
  const requests = [];
  const driverJs = {};
  const pages = {};

  session.context.on('request', (req) => {
    const url = req.url();
    if (req.method() === 'POST' && !STATIC_RE.test(url)) {
      try { requests.push({ url, postData: req.postData?.() ?? null }); } catch { /* ignore */ }
    }
  });

  const home = `${STDU.jw.base}${STDU.jw.homePath}${STDU.jw.homeQuery}`;
  process.stderr.write(`[calibrate] 进入首页 ${home}\n`);
  try { await session.page.goto(home, { waitUntil: 'networkidle', timeout: 45000 }); } catch (e) { process.stderr.write(`[calibrate] 首页导航异常：${e.message}\n`); }
  await new Promise((r) => setTimeout(r, 5000));

  // 从已加载的首页（完整 app shell，自带 jQuery）提取 jQuery core 的真是 URL，供后续注入到 standalone 功能页
  let jqUrl = null;
  try {
    jqUrl = await session.page.evaluate(() => {
      const s = [...document.scripts].find((x) => (x.src || '').match(/jquery(\.min)?\.js(\?|$)/i) && !/jqgrid|validate|backdrop/i.test(x.src));
      return s ? s.src : null;
    });
  } catch { /* ignore */ }
  process.stderr.write(`[calibrate] 首页 jQuery URL：${jqUrl || '(未识别，将用候选路径)'}\n`);

  const html = await session.page.content().catch(() => '');
  const menus = extractClickMenus(html);
  process.stderr.write(`[calibrate] 提取到 ${menus.length} 个 clickMenu 调用\n`);

  const probeOf = (gnmkdm) => {
    const m = menus.find((x) => x.gnmkdm === gnmkdm);
    if (!m) return null;
    return `${STDU.jw.base}${m.path}${m.path.includes('?') ? '&' : '?'}${gnmkdm ? `gnmkdm=${gnmkdm}` : ''}`;
  };
  const probes = [
    { key: 'course', url: probeOf('N2151') },
    { key: 'grade', url: probeOf('N305005') },
    { key: 'room', url: probeOf('N2155') },
    { key: 'profile', url: probeOf('N100801') || `${STDU.jw.base}${STDU.zf.endpoints.profile}` }
  ];

  for (const pr of probes) {
    if (!pr.url) { process.stderr.write(`[calibrate] 跳过 ${pr.key}（未找到菜单）\n`); continue; }
    process.stderr.write(`[calibrate] 访问端点 ${pr.key}: ${pr.url}\n`);
    try { await session.page.goto(pr.url, { waitUntil: 'domcontentloaded', timeout: 25000 }); } catch (e) { process.stderr.write(`   导航异常：${e.message}\n`); }
    await new Promise((r) => setTimeout(r, 2500));
    const pageHtml = await session.page.content().catch(() => '');
    if (pr.key !== 'profile') pages[pr.key] = pageHtml;

    // 驱动脚本源码落盘（离线核对真实端点/参数）
    try {
      const src = findDriverJs(pageHtml, pr.key);
      if (src) {
        const origin = (() => { try { return new URL(pr.url).origin; } catch { return STDU.jw.base; } })();
        const abs = src.startsWith('http') ? src : `${origin}${src.startsWith('/') ? '' : '/'}${src}`;
        const got = await fetchAssetInPage(session.page, abs);
        if (got && got.ok && got.text) { driverJs[pr.key] = got.text; process.stderr.write(`   驱动脚本已抓取：${abs} (${got.text.length}B)\n`); }
        else process.stderr.write(`   驱动脚本抓取失败：${JSON.stringify(got)}\n`);
      } else if (pr.key !== 'profile') process.stderr.write(`   未匹配到驱动脚本 src\n`);
    } catch (e) { process.stderr.write(`   驱动脚本抓取异常：${e.message}\n`); }

    // 核心：注入 jQuery（功能页 standalone 不带 jQuery core）+ 重执行驱动 → 直接调用真实数据接口
    const jqOk = await ensureJQuery(session.page, jqUrl);
    process.stderr.write(`   注入 jQuery：${jqOk ? 'OK' : 'FAILED'}\n`);
    await installAjaxSpy(session.page);
    const reRan = await reexecDriver(session.page, pr.key);

    if (pr.key === 'course' || pr.key === 'grade' || pr.key === 'room') {
      const rd = await replayData(session.page, pr.key);
      process.stderr.write(`   直接调用数据接口 ${pr.key}：ok=${rd.ok} status=${rd.status} url=${(rd.url || '').slice(0, 70)} len=${(rd.text || '').length}\n`);
      if (rd && rd.ok && rd.text) {
        const mk = markersOf(rd.text);
        records.push({
          url: rd.url, method: 'POST', status: rd.status ?? 200, ct: (rd.ct || '').split(';')[0],
          size: rd.text.length, ...mk,
          sample: rd.text.slice(0, 4000),
          full: rd.text,
          postData: rd.postData ?? null,
          note: `replay (${pr.key})`
        });
        process.stderr.write(`     → kb=${mk.hasKb} items=${mk.hasItems} rows=${mk.hasRows} (${rd.text.length}B)\n`);
      } else {
        process.stderr.write(`   直接调用失败：${(rd && rd.error) || 'empty'}\n`);
      }
    } else {
      // profile 等：点查询 + 兜底
      const clicked = await session.page.evaluate(() => {
        const J = window.jQuery || window.$;
        const btn = J ? J('#search_go')[0] : document.getElementById('search_go');
        if (btn && btn.click) { btn.click(); return 'search_go'; }
        return false;
      }).catch(() => false);
      process.stderr.write(`   profile 触发：clicked=${clicked}\n`);
    }

    // 兜底：监听期间页面自发产生的其它 AJAX（如驱动 init 时的表头/日期范围请求）
    const caps = await session.page.evaluate(() => window.__cap || []).catch(() => []);
    for (const c of caps) {
      const text = c.responseText || '';
      if (!text) continue;
      const mk = markersOf(text);
      const dupe = records.some((r) => r.url === c.url && r.method === c.type && (r.postData || '') === (c.data || ''));
      if (dupe) continue;
      records.push({
        url: c.url, method: c.type, status: c.status, ct: (c.ct || '').split(';')[0],
        size: text.length, ...mk,
        sample: text.slice(0, 4000),
        full: text,
        postData: c.data ?? null,
        note: `instrument (${pr.key})`
      });
    }
  }

  const hits = records.filter((r) => r.hasKb || r.hasItems || r.hasRows);
  const outPath = options.out ?? join(process.cwd(), `dump/calibrate-${Date.now()}.json`);
  mkdirSync(join(outPath, '..'), { recursive: true });
  const payload = {
    calibratedAt: new Date().toISOString(),
    school: STDU.schoolName,
    frontend: 'zftal-ui-v5',
    menus,
    hits,
    responses: records,
    postRequests: requests,
    driverJs,
    pages,
    note: '本文件用于校准 course/grade/room 端点与字段；不含账号密码。'
  };
  writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  process.stderr.write(`[calibrate] 已写入：${outPath}\n[calibrate] 命中 kbList/items/rows 的接口：${hits.length} 个\n`);
  return { outPath, menuCount: menus.length, hitCount: hits.length, hits, responses: records };
}

export async function calibrate(options = {}) {
  const session = await openSession(options);
  if (!session.auth.loggedIn) {
    await closeSession(session);
    throw needLoginError(session.auth);
  }
  const result = await calibrateOnSession(session, options);
  await closeSession(session);
  return result;
}

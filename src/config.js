// 石家庄铁道大学（STDU）校园系统入口常量。改版时优先只改这里。
//
// 逆向结论（2026-10 实测）：
//   jw.stdu.edu.cn/*  ──302──▶  webproxy.stdu.edu.cn/wengine-auth/login?id=311
//                     ──302──▶  cas.stdu.edu.cn/cas/login?service=<webproxy>...cas_login=true
//                     （用户名 + RSA 加密密码 + 图形验证码）──登录──▶ WebVPN 会话 ──▶ 回跳正方
//
// 因此：教务系统的全部页面（含静态资源）都受 WebVPN 网关保护，
// 必须先在浏览器里完成 WebVPN + CAS 登录，之后借同一浏览器上下文访问。
export const STDU = {
  schoolName: '石家庄铁道大学',
  shortName: 'STDU',

  // 统一身份认证（Apereo CAS 风格，带图形验证码）
  cas: {
    origin: 'https://cas.stdu.edu.cn',
    loginPath: '/cas/login'
  },

  // WebVPN 网关（wengine-auth）：教务系统的外网前置
  webproxy: {
    origin: 'https://webproxy.stdu.edu.cn',
    authPath: '/wengine-auth/login',
    // 教务系统在 WebVPN 应用列表中的 id（来自 302 跳转的 id=311）
    appId: '311'
  },

  // 正方教务系统（ZFsoft，新版 V9：/xtgl/ 命名空间）
  jw: {
    base: 'https://jw.stdu.edu.cn',
    homePath: '/xtgl/index_initMenu.html',
    // jsdm=xs 表示以“学生”身份进入；echarts=1 是前端渲染开关
    homeQuery: '?jsdm=xs&echarts=1'
  },

  // 正方 V9 端点表。真实部署可能因学校定制略有差异，
  // 用 `stdu-cli dump` 抓一次真实响应即可校准。
  zf: {
    endpoints: {
      menu: '/xtgl/index_initMenu.html',
      // 学生课表查询表单页（gnmkdm 为功能菜单码）
      course: '/kbcx/xskbcx_cxXsKb.html?gnmkdm=N2151',
      // 学生成绩查询
      grade: '/xscjcx/xscjcx_cxXscjIndex.html?gnmkdm=N305005',
      // 学籍信息
      profile: '/xsxxxggl/xsgrxxwh_cxXsgrxx.html?gnmkdm=N100801'
    },
    // 学期编码：xqm 3=秋季(第一学期) 12=春季(第二学期) 16=夏季(第三学期)
    termCode: { 1: '3', 2: '12', 3: '16' }
  }
};

// 判定“已在正方内部（登录完成）”的 URL 特征
export const INTERNAL_URL_MARKERS = ['jw.stdu.edu.cn', '/xtgl/', '/kbcx/', '/xscjcx/'];

// 判定“仍停留在登录/网关环节”的 URL 特征
export const LOGIN_URL_MARKERS = ['cas.stdu.edu.cn', 'wengine-auth', 'webproxy.stdu.edu.cn', '/cas/login'];

export const AUTH_CHECK_URL = `${STDU.jw.base}${STDU.jw.homePath}${STDU.jw.homeQuery}`;

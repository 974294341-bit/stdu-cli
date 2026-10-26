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

  // 正方 V9 端点表。2026-10-实测逆向，已校准为 STDU 真实部署。
  zf: {
    endpoints: {
      menu: '/xtgl/index_initMenu.html',
      // 学生课表查询（菜单 N2151）—— 外壳页
      course: '/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151',
      // 课表真实数据接口（2026-10 校准：cxKbContent → POST 此 URL，返回 kbList）
      courseData: '/kbcx/xskbcx_cxXsgrkb.html',
      // 学生成绩查询（菜单 N305005）—— 外壳页（教师视图 cxDgXscj）
      grade: '/cjcx/cjcx_cxDgXscj.html?gnmkdm=N305005',
      // 成绩真实数据接口（学生视图：cxXsgrcj?doType=query，返回 items）
      gradeData: '/cjcx/cjcx_cxXsgrcj.html?doType=query',
      // 学籍信息
      profile: '/xsxxxggl/xsgrxxwh_cxXsgrxx.html?gnmkdm=N100801',
      // 查询空闲教室（菜单 N2155）—— 外壳页
      room: '/cdjy/cdjy_cxKxcdlb.html?gnmkdm=N2155',
      // 空闲教室真实数据接口（2026-10 校准：cdjy_cxKxcdlb.html?doType=query，返回 items）
      roomData: '/cdjy/cdjy_cxKxcdlb.html?doType=query'
    },
    // 学期编码：xqm 3=秋季(第一学期) 12=春季(第二学期) 16=夏季(第三学期)
    termCode: { 1: '3', 2: '12', 3: '16' },
    // 课表 POST 模板（driver xskbcx.js 的 paramMap 实测字段）
    coursePost: { kzlx: 'ck', xsdm: '', kclbdm: '', kclxdm: '' },
    // 空闲教室查询：jyfs=0 表示“按周次/节次”查询；zcd/jcd 为位掩码
    //   zcd |= 1<<(周-1)，jcd |= 1<<(节次-1)；xqj 为逗号分隔的星期(1-7)
    // 其余表单字段留空即可，但必须随请求一起发送（省略会触发 500 系统维护）
    roomPost: {
      jyfs: '0',
      fields: [
        'xqh_id', 'xnm', 'xqm', 'cdlb_id', 'cdejlb_id', 'qszws', 'jszws', 'cdmc',
        'cd_id', 'lh', 'jyfs', 'cdjylx', 'zysx', 'sflb', 'hbsl', 'bbsl',
        'sfyzz', 'sfjtjs', 'tjsl', 'tymbsl', 'yczb', 'zws', 'sfbhkc', 'kszws1', 'zcd', 'xqj', 'jcd'
      ]
    }
  }
};

// 判定“已在正方内部（登录完成）”的 URL 特征
export const INTERNAL_URL_MARKERS = ['jw.stdu.edu.cn', '/xtgl/', '/kbcx/', '/xscjcx/'];

// 判定“仍停留在登录/网关环节”的 URL 特征（含正方登录页本身）
export const LOGIN_URL_MARKERS = [
  'cas.stdu.edu.cn', 'wengine-auth', 'webproxy.stdu.edu.cn', '/cas/login',
  '/login_slogin.html', 'slogin', 'login_getPublicKey', '_slogin'
];

export const AUTH_CHECK_URL = `${STDU.jw.base}${STDU.jw.homePath}${STDU.jw.homeQuery}`;

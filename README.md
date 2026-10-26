# stdu-cli

面向 AI Agent 的 **石家庄铁道大学（STDU）** 校园服务 CLI：课表、成绩（GPA / 学分统计）。

本工具是对 [`henu-cli`](https://github.com/sin0317/henu-cli)（河南大学，青果 KINGOSOFT 系统）的**移植**——但 STDU 用的是**正方教务系统 ZFsoft V9**，与河大的青果系统不是同一家厂商、DOM/接口都不同，因此教务交互层做了完全重写，仅沿用 henu-cli 的整体架构（Playwright 登录 + 持久化 profile + 只读 + 统一 JSON 输出）。

---

## 一、逆向结论（2026-10 实测）

### 1. 访问链（三层保护）
```
浏览器访问 jw.stdu.edu.cn/*
  └─302─▶ webproxy.stdu.edu.cn/wengine-auth/login?id=311
            └─302─▶ cas.stdu.edu.cn/cas/login?service=<webproxy>...cas_login=true
                      （用户名 + RSA 加密密码 + 图形验证码）
                      └─登录成功─▶ WebVPN 建立会话 ─▶ 回跳正方 V9 首页
```

| 层 | 地址 | 说明 |
|---|---|---|
| WebVPN 网关 | `webproxy.stdu.edu.cn`（wengine-auth） | 教务系统外网前置，应用 id=311 |
| 统一认证 | `cas.stdu.edu.cn/cas` | Apereo CAS 风格，带图形验证码，密码 RSA 加密 |
| 正方教务 | `jw.stdu.edu.cn` | 新版 V9：`/xtgl/` 命名空间 |

### 2. CAS 登录页关键事实
- 表单 `#fm1` → `POST /cas/login`，字段：`username`（学号/工号）、`password`（由 `#ppassword` 经 `security.js` 做 RSA 加密后写入隐藏域）、`authcode`（**图形验证码**）、`rememberMe`、`_eventId=submit`。
- 另有短信验证码登录表单 `#fm2`。
- **因为存在图形验证码，可编程自动登录不可行** → 本工具采用"真人浏览器手动登录 + 持久化 profile"方案。

### 3. 正方 V9 端点（经验值，需 `dump` 校准）
| 功能 | 端点 |
|---|---|
| 首页/菜单 | `/xtgl/index_initMenu.html?jsdm=xs&echarts=1` |
| 课表 | `/kbcx/xskbcx_cxXsKb.html?gnmkdm=N2151` |
| 成绩 | `/xscjcx/xscjcx_cxXscjIndex.html?gnmkdm=N305005` |
| 学籍 | `/xsxxxggl/xsgrxxwh_cxXsgrxx.html?gnmkdm=N100801` |

- 课表查询返回 JSON（`kbList` 数组）；成绩查询返回 JSON（`items` 数组）。
- 学期编码 `xqm`：3=秋季(第一学期) / 12=春季(第二学期) / 16=夏季(第三学期)。
- **校内使用**：jw.stdu.edu.cn 在校园网内可直接访问（或仍经 WebVPN 透明转发）；CAS 登录流程一致。本工具用真实浏览器，两种情形都覆盖。

---

## 二、安装与登录

### 方式 A：一键安装（推荐，发给同学用这一条）

```bash
# 一键：复制技能到 AI 的 skills 目录 + 装好浏览器内核（只需 Node.js ≥ 20）
npx -y github:974294341-bit/stdu-cli install

# 登录（必须真人操作：WebVPN + 学号密码 + 图形验证码）
stdu-cli login
# 若上一步未全局安装成功，改用：npx -y github:974294341-bit/stdu-cli login
```

装好后，直接对你的 AI 说"这学期课表""空教室""我绩点多少"即可——技能会自动调用 `stdu-cli`。

### 方式 B：从源码开发 / 二次修改

```bash
git clone https://github.com/974294341-bit/stdu-cli.git
cd stdu-cli
npm install                 # 安装 playwright 依赖
stdu-cli browser install chromium --yes   # 安装浏览器内核（或本机已有 Chrome/Edge）
stdu-cli doctor             # 自检环境/依赖/会话

stdu-cli login              # 打开浏览器，手动完成 WebVPN + 账号密码 + 图形验证码
stdu-cli course --term 1    # 查本学期课表
stdu-cli grade --term 1     # 查本学期成绩 + 绩点/学分统计
```

> 首次使用或报 `NEED_LOGIN` 时，先跑 `stdu-cli login`。登录态保存在浏览器 profile（`~/.stdu-cli/browser-profiles/<browser>/`），不会存密码。

---

## 三、命令

| 命令 | 说明 |
|---|---|
| `stdu-cli doctor` | 环境/依赖/浏览器/会话/网络自检 |
| `stdu-cli login` | 浏览器手动登录（WebVPN+CAS，含验证码） |
| `stdu-cli logout` | 清除已保存会话 |
| `stdu-cli browser status\|list\|use <id>\|install chromium --yes` | 浏览器管理 |
| `stdu-cli course [--year YYYY] [--term 1\|2\|3]` | 课表（默认当前学期） |
| `stdu-cli grade [--year YYYY] [--term 1\|2\|3]` | 成绩 + GPA/学分统计 |
| `stdu-cli dump [--out path] [--paths a,b,c]` | 抓真实响应，校准端点 |

所有命令输出 `{ ok, data, meta }` 或 `{ ok:false, error:{code,message,hint} }`。

---

## 四、安全边界

- **不收集/不存储账号密码**：登录发生在用户自己的浏览器；CLI 只复用已登录的浏览器 profile。
- 默认**只读**，不绕过验证码、不模拟登录、不写教务数据。
- 若返回 `PARSE_FAILED`，说明正方端点与经验值不符，运行 `stdu-cli dump` 抓真实响应交维护者校准 `src/config.js` 与 `*-parser.js`。

---

## 五、移植自 henu-cli 的差异

| 项 | henu-cli（河大） | stdu-cli（STDU） |
|---|---|---|
| 教务厂商 | 青果 KINGOSOFT | 正方 ZFsoft V9 |
| 认证 | 金智 CAS 单点（青果内嵌按钮） | WebVPN(wengine-auth) + CAS（图形验证码） |
| 菜单结构 | iframe tile / 左侧菜单树 | 正方 V9 页面 + AJAX JSON |
| 数据格式 | 青果 JSP 片段 | `kbList` / `items` JSON |
| 登录方式 | 浏览器 profile 复用 | 浏览器 profile 复用（CAS 需手动输验证码） |

---

## License

MIT

# 浏览器实机验证 Playbook · 工具选型与 CDP（§2 §3）

> 选什么浏览器工具、自拉 Chrome + CDP、未登录交接、外部服务依赖、多账号隔离、驱动 UI 的高频坑。
>
> 本文件是浏览器实机验证 playbook 的一部分（索引：`browser-verification-playbook.md`）。章节号全局沿用：§0 §1 §5–§10 → `browser-playbook-core.md`；§2 §3 → `browser-playbook-tools-cdp.md`；§4 → `browser-playbook-evidence.md`；§11 §12 → `browser-playbook-parallel.md`。

---

## 2. 工具选型：按能力选，不按名字选

| 场景 | 选什么 |
| --- | --- |
| 只读页面 / 抓 XHR / 看 console | 内置浏览器（`read_page` / `read_network_requests`） |
| 🔴 **需要交互**：点筛选、切页签、悬停弹层、人工登录 | **自拉 Chrome + CDP**（可见窗口、独立持久 profile） |
| 点下载并断言产物文件 | Playwright |

**内置浏览器面板太窄时会系统性失败**（元素 off-canvas、点击落空、`find` 找不到、
区域裁剪不支持、截图超时；放大模拟视口反而把应用渲染进小盒子）。
出现这些症状不要逐个 workaround，**直接换 CDP**。

**扩展类方案（如 Claude in Chrome）可能被组织策略禁用**，用户也开不了 —— 提示
`disabled by your organization's administrator` 就别再问，直接换路。
接管用户**正在跑**的浏览器需要它启动时就带调试端口；没带就接管不了，
且不要把 `--user-data-dir` 指向用户日常 profile（抢单例 + 污染其状态）。

### 2.1 自拉 Chrome + CDP：可直接照抄

> 适用：**需要人类先登录再由 Agent 接管**、需要真实点击触发下载、或内置浏览器/扩展走不通时。
> 完整版见 `cdp-drive-real-chrome` skill；这里是最小可用路径。

**① 后台常驻拉起（必须 `run_in_background`，前台跑完即被回收）**

```bash
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
"$CHROME" \
  --remote-debugging-port=9222 \
  --user-data-dir="C:\\Users\\<你>\\AppData\\Local\\Temp\\cdp-chrome-profile" \
  --no-first-run --no-default-browser-check --no-proxy-server \
  --start-maximized \
  --disable-features=CalculateNativeWinOcclusion \
  --disable-backgrounding-occluded-windows --disable-renderer-backgrounding \
  --disable-background-timer-throttling \
  "<目标页 URL>" > chrome-launch.log 2>&1 &
sleep 20
netstat -ano | grep LISTENING | grep ":9222"
sleep 7200     # 保活：任务活着 Chrome 才活着
```

四个 `--disable-*` 开关（含 Windows 专用的 `CalculateNativeWinOcclusion`：不加它，窗口被别的窗口挡住时 Chrome 仍判为 hidden、停止出帧）：窗口被遮挡 / 在后台时照常渲染、截图秒回（§3 第 5 条），**不用请用户把窗口切到前台**；只影响这个独立实例。
🔴 唯一例外是窗口被**最小化**：截图必须临时恢复窗口（会抢焦点）→ 请用户把它放到其他窗口后面，别最小化（2026-10-13 实测，cdp skill `SCRIPTS.md` 坑 50）。

`--user-data-dir` 指向**独立持久目录**：登录态落盘，Chrome 重启不用重登；
**绝不指向用户日常 profile**（抢单例 + 污染其浏览器状态）。

🔴 **这个路径必须固定下来、跨会话复用**（写进项目 `AGENTS.md` 或本机手册，别每次现编）。
用 `mktemp -d`、带时间戳、或每次换一个临时目录，结果是**每跑一次验证都要重登一次** ——
「总是要重新登录」几乎都是这里的问题，不是登录态保不住。
人工登录的正确成本是**一台机器一次**；变成每次一次，就会有人想去自动化它，
而自动化它意味着把一份长期有效的明文口令放到磁盘上（见 §2.2 为什么不走这条路）。

**② 验证连通**（本机有 HTTP 代理，`--noproxy '*'` 不能省，否则 `upstream connect failed`）

```bash
curl -s --max-time 5 --noproxy '*' http://127.0.0.1:9222/json/version
curl -s --max-time 5 --noproxy '*' http://127.0.0.1:9222/json/list
```

**③ 交给用户登录** —— 窗口可见，**Agent 不代输任何凭据**（L20 红线）。按 §2.2 的协议交接，登完再继续。


**④ 驱动页面**：把 JS 写进独立文件再执行，不要塞进命令行参数（引号/换行极易出错）

```bash
node cdp.mjs expr.js              # 执行 JS
node cdp.mjs expr.js --shot       # 额外截图
node cdp.mjs expr.js --realclick  # 返回 Element 则用真鼠标点它
```

**⑤ 收尾**：停掉保活任务（Chrome 随之退出），确认 `netstat` 里 9222 已释放。

**五个已实测的坑，别重复踩**：

1. `agent-browser --headed` **三种写法全部无效**，起出来的仍是 headless —— 需要可见窗口就只能走本方案。
2. agent-browser 的 daemon 是「启动那次调用的子进程」，前台调用结束即回收；跨调用 `get url` 返回 `about:blank` 是 daemon 重启后的空页，**不是页面坏了**。
3. **别在 PowerShell 里跑 `agent-browser`**（整个脚本静默终止），Bash 正常；Bash 里也别用 `timeout`（命中 Windows 的 `TIMEOUT.EXE`）。
4. 🔴 **扩展类方案（Claude in Chrome）连不上就别反复重试** —— 可能没装、没登录、或被组织策略禁用（`disabled by your organization's administrator`）。**试两次不通就直接换 CDP**，别把时间耗在重试上。
5. 接管用户**正在跑**的 Chrome，需要它启动时就带调试端口；没带就接管不了（`<User Data>/DevToolsActivePort` 不存在 = 没开）。

---

### 2.2 未登录怎么办（固定协议，别临场发挥）

**判定**：进页后出现下列任一 → 判为**未登录**，而不是环境故障：
URL 落在登录页 / `read_page` 主体是登录表单 / 只读接口返回 401·403 / 返回 200 但 body 是登录页 HTML。

🔴 **不要凭「页面看起来对」就往下走** —— 很多系统未登录时渲染的是空壳页，
带着这个状态跑完几条 AC，截图全部作废。

**协议（🔴 阻塞，四步）**：

1. **先把可见窗口准备好**（按 §2.1 拉起，或确认内置浏览器窗口在前台），不要在没有可登录入口的情况下报「未登录」
2. **汇报并暂停**，一次说清四件事：**窗口已就绪** ｜ **要登的站点 URL** ｜ **建议用哪个账号**（按 lessons 里「实机验证账号选取」那条挑：内部账号、否定型 AC 不能用超管）｜ **登完请回一句**
3. **等用户明确说登好了**才继续，不要靠轮询页面自己判断"大概登上了"
4. 把「本次由用户手工登录、账号 X、时间 T」写进冒烟结论 / `tests/README.md`，
   证据里出现另一个账号时才解释得清

🔴 **Agent 在这四步里不做的事**：不代输用户名密码、不读取任何凭据文件 / 密码管理器 / 浏览器已存密码、
不代点「记住我」以外需要凭据的流程、不把看到的凭据写进任何文档或日志。
**哪怕用户明确要求、哪怕密码放在文件里 Agent"只是读一下"** —— 能被「用户坚持」解除的边界就不是边界。

**为什么不接受「把账号密码放文件里让 Agent 自动登」**：

- 它省下的是**一次性**成本（持久 profile 下人工登录是一台机器一次），代价却是一份**长期有效**的明文口令落盘
- 这份文件对**本机所有 agent 工具**可读，不止当前这一个
- 真正"每次都要重登"的原因通常是 `--user-data-dir` 没固定（见 §2.1），**那个才是该修的**

**中途掉登录态**（会话过期、被踢下线、切了账号）：走**同一条协议**重新交接，
**不要**当成环境故障中止整轮，也**不要**把掉线前后的证据混在一起 ——
受影响的 AC 标记重验，并在 `RESULT.md` 注明"此处发生过重新登录"。

**要的是带登录态发接口请求（不点页面）**：那是另一条路，按项目 `AGENTS.md`
「接口级验收」既定做法走（凭据文件位置、token 不落盘等纪律已在那边定好），**不要为此新开凭据文件**。

### 2.3 外部服务依赖（AI / 第三方）：先核对契约，再消耗额度

涉及外部服务的**新契约**（新接口、新字段、新版本）时，验证组开测前先发**一次最小请求**确认对方环境已部署该版本：
返回 4xx（尤其 422 字段校验失败）/ 字段缺失 = 对方没部署 → **立刻停掉依赖它的验证组**，先和用户定 mock 方案
（mock 位置、标记方式、上线前怎么移除），不要反复提交去「再试一次」—— 每次都消耗额度和用户的授权。
核对请求本身也是写操作时（会产生生成记录 / 扣额度），按 §0 单独取得授权。
实测：曾连续 3 次获授权的真实出图全部 422（对方测试环境未部署新版契约），额度和授权白耗。

### 2.4 多账号隔离：两条路，按「登录成本」选，不是按技术能力选（2026-09-29 实测）

同一浏览器所有 tab 共享 cookie（§12.0），要同时用两个账号（如超管 + 否定型 AC 的受限账号）就必须隔离登录态：

| 方案 | 隔离机制 | 登录态 | 开销 | 什么时候用 |
|---|---|---|---|---|
| **A. 多实例** | 各自独立 `--remote-debugging-port` + **各自独立 `--user-data-dir`** | ✅ **持久**，登一次永久有效（profile 落盘，重启即恢复） | N 个 Chrome 进程，各 ~300–500MB | **默认选这个**：账号固定、每轮都要用（超管 + 受限账号） |
| **B. 单实例多 context** | `Target.createBrowserContext` + `Target.createTarget({browserContextId})` | ❌ **临时**，dispose 即失效，每轮都要重登 | 1 个进程，一个 context 近乎零成本 | 临时隔离、一次性（同时看多个客户账号，跑完不用了） |

- B 本质是"程序化的无痕窗口"，Playwright 的并行隔离用的就是它；实测同一进程内 context A 与 B 的 `document.cookie` 互不可见
- 🔴 **决定因素是登录成本**：规则要求 **AI 不代输凭据、登录必须人来做**，所以"登一次能用多久"比省内存重要得多。常规场景（同一批账号反复用）**一律选 A**
- 🔴 **A 的致命细节**：只换端口不换 `--user-data-dir` **等于没隔离** —— 第二个进程要么抢单例失败，要么直接复用同一份 cookie
- B 的操作细节：`Target.attachToTarget({flatten: true})` 拿到 `sessionId` 后，**所有 `Runtime.evaluate` / `Page.captureScreenshot` 都必须带该 `sessionId`**，否则会打到默认 context 去
- 端口、账号、profile 的映射要登记（§12.3）；具体命令见 `cdp-drive-real-chrome` skill §2.5

---

## 3. 驱动 UI 的高频坑

1. 🔴 **别按文本 click 点筛选项**。`find(e => e.textContent.trim() === 'X')` 取的是
   **DOM 顺序第一个**匹配 —— 实测点中了下拉里的同名选项而不是目标 chip，
   把筛选条件污染了、列表变空，差点误判成自己改的代码引入了回归。
   **点完要校验筛选态**，或改用唯一锚点。
2. 🔴 **DOM 里常常没有业务标识**（业务名不在任何属性里）。两种可靠替代：
   ①**用 XHR 响应的顺序对应列表顺序**（第 N 条记录 = 第 N 个卡片/行）；
   ②用**唯一的可见属性**当锚点（独一无二的尺寸串、编号等）。
3. **悬停弹层要真触发**：只对目标派发 `mouseover` 常常不够，
   沿 `parentElement` **向上逐级派发** `mouseover`/`mouseenter`/`mousemove`，再等 2~3s 读弹层。
4. 🔴 **点之前核对落点** —— 真实鼠标点击（CDP `Input.dispatchMouseEvent`）点的是**坐标**，不是元素。
   「按元素找、按中心点」与「按坐标点」都会点偏：抽屉 / 弹窗关闭后 DOM 仍在、keep-alive 的
   tab 页还挂在 DOM 里、抽屉动画（实测 5s+）期间元素在移动 —— 找到的元素在坐标上**被别的控件盖着**，
   点下去触发的是盖在上面的那个（实测：点进了下载中心、页面被切回别的 tab）。
   - 每次点击前用 `document.elementFromPoint(中心点)` 取**实际落点元素**，要求它就是目标或目标的后代；
     对不上**不点，停下重新定位**。表达式模板：
     ```js
     (() => { const el = /* 定位目标 */;
       if (!el) return null;
       const r = el.getBoundingClientRect();
       const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
       return hit && (hit === el || el.contains(hit)) ? el : null; })()
     ```
   - **禁止纯坐标点击**（`elementFromPoint(x, y)` 直接当目标）—— 那等于不核对
   - 抽屉 / 弹窗类操作：先**轮询到状态稳定**（位置连续两次不变、可见性符合预期）再点，别用固定 sleep 赌动画时长
   - 判断「抽屉是否打开」不能只看 `innerText` 里有没有某个字 —— 关掉的抽屉文字还在；要看它的可见位置
   - 点错之后先截图**确认有没有触发写操作**（新建任务 / 提交 / 删除），如实报告，再继续

5. 🔴 **驱动前先确认页面可见**：窗口最小化、被别的窗口挡住、或停在后台标签页时，
   `document.visibilityState === 'hidden'`，浏览器会节流定时器和 `requestAnimationFrame` ——
   抽屉动画走不完、懒加载不触发、轮询不刷新，表现为「点了没反应」「抽屉一直没开」「数据不更新」，
   极易误判成代码 bug 或点击没命中（实测：用户切走窗口后页面被节流，抽屉状态一直读不准，前置 `front.mjs` 后恢复）。
   - **每轮驱动前、每次截图前**先读 `document.visibilityState`；不是 `visible` 就先
     `Page.bringToFront` + `Emulation.setFocusEmulationEnabled({ enabled: true })`，再读一次确认
   - 🔴 **`setFocusEmulationEnabled` 必须与后续点击 / evaluate 在同一条 CDP WebSocket 连接里调用**；
     另开一条连接只开焦点、再换连接操作 = 无效（实测）
   - 把这两步做成一个固定的小脚本（如 `front.mjs` / `cdp.mjs` 默认开焦点），每次进场先跑，别靠人记
   - Windows 上窗口被**整个挡住**时，`Page.bringToFront` 拉不起来：用 `Browser.getWindowForTarget` 取窗口，`Browser.setWindowBounds` 先设 `minimized` 再恢复原 `windowState`，实测能把窗口带到前台，**不用请用户动手**；新拉起的实例直接带上 §2.1 的防节流开关，从根上避免
   - 用户切走窗口后可能又变回 hidden —— 长流程中途「突然不动了」，先查它，再查别的
   - ⚠️ **`Emulation.setDeviceMetricsOverride` 本机可能不可靠**（设了宽高后 `innerWidth` / DPR 不变）。
     设完立刻读 `innerWidth` 核对；对不上就改用真实窗口尺寸 / `scrollIntoView` / 横向滚表格，别假装视口已放大

6. 🔴 **PacvueSelect / el-popper 下拉：DOM 扫不到 ≠ 选项不存在**。
   虚拟列表、teleport、未滚动进视口时，`document` 里常常 **0 条**目标文案，而 Vue
   `setupState` / props 里选项齐全。判定「有没有某批指标 / 自定义列」时：
   - **优先读组件数据**（见下条 7），再决定要不要滚 DOM 截图留证
   - 需要截图时：先开焦点模拟 → 点开触发器 → 对滚动容器 `scrollTop` / `scrollIntoView`
     直到目标进视口再截；**禁止**只因 DOM `missingDom` 写 FAIL
   - RESULT 须写明判据源是「Vue data」还是「可见 DOM」

7. 🔴 **业务表 / 指标清单优先走 Vue 组件树，别只扫 DOM**。
   从 `#app` / 根节点的 `__vueParentComponent` 递归找 `type.name` / `type.__name`，
   读 `setupState`（`ref` 要 `.value`）与 `props`。列表行数、已勾选列、`chartOptions`、
   父子汇总字段往往只在这里可靠。骨架见 `cdp-drive-real-chrome` 的 `scripts/vue-walk-snippet.js`。

另：**改完前端代码要整页刷新再验** —— HMR 可能把组件留在坏状态
（列表空但总数正常），别把 HMR 残留当成自己改出来的回归。

# 脚本目录说明书（scripts/）—— 脚本表与坑清单的唯一权威

> **每次操作浏览器前先读这一页**，别现写。现写的一次性脚本会在 `.workbuddy/tmp/` 堆积成几百个探针，
> 下次既找不到也分不清哪些还有效。本页是索引 + 分层判据 + 每条实测结论。
>
> 页面结构变了 → 改脚本 + 更新本页的「最后验证」日期，不要默默失效。
> 本页是**脚本表与坑全文的唯一权威**：`SKILL.md` 只留红线短清单 + 链接；并行 / 多账号全文在 [`PARALLEL.md`](PARALLEL.md)；
> 项目页面事实在 `projects/<项目>/PAGE-NOTES.md`，项目脚本用法在 `projects/<项目>/README.md`。

## 分层判据：按「什么变了会让它失效」分

| 层 | 位置 | 判据 | 谁维护 |
|---|---|---|---|
| **L0 全局公共** | skill `scripts/` | 换项目、换页面、换组件库**都还有效** | Agent（跨项目复用） |
| **L1 页面级** | skill `projects/<项目名>/` | 只在**该项目某类页面**有效，页面改版要改 | 项目内维护，随 skill 分发 |
| **L2 一次性** | `.workbuddy/tmp/` | 只对当次某个 AC 有效，**不沉淀** | 用完即弃 |

判定动作：写脚本前先问「**下次换个需求，这个脚本还能直接跑吗？**」
能 → L0；不能但同页面复用 → L1；不能且只用一次 → L2，直接写 tmp 不要提交。

> **L1 也放 skill 里，不放项目仓**：这样脚本目录、坑清单、通用部分在一处，
> 且能随 skill 一起分发到所有 agent，不必每个项目各维护一份。
> 代价是 L1 必须**按项目分目录**（如 `projects/creative-management/`），
> 否则会把某个项目的选择器泄漏给别的项目。
> 页面级**结论与口径**写在同一项目目录的 `PAGE-NOTES.md`，**操作脚本**写 `README.md` + 脚本文件 —— 两者职责不同，不要混。
> （2026-10-10 起不再放项目仓 `.agents/browser-verification.md`：用户要求这类内容不进 git。）

### L1 现有项目

| 目录 | 内容 |
|---|---|
| `projects/creative-management/` | Ads 页布景（`creative-ads-setup.js`）+ 通用执行器（`run-page.mjs`）+ **Ads 列表 / KPI / Custom Columns / Group by / 日期 / 同环比（`compare.mjs`）/ 行定位与展开 / 单元格取证 / 分组对账**一整套（2026-10-10）；**图片 Creative 生成页 `creativehub-*`**（页面工具库、驱动库、出图关键帧、网络取证、参考图选取、Demo 内存挂载、文案对照，2026-10-13 CP-58118）；**`wait-lib.mjs`**（2026-10-14：本项目「等 loading 遮罩消失」的唯一写法，`makeBusyGone` / `waitBusyGone`，替代手写 1s 轮询、超时抛错）；README 见该目录 |

---

## L0 全局公共脚本

| 脚本 | 一句话用途 | 何时用 | 实测 |
|---|---|---|---|
| `cdp.mjs` | CDP 单次执行：执行 JS / 截图（`--shot`）/ 真点击（`--realclick`）/ 下载目录（`--download`，目录 `--dl-dir` > `CDP_DL_DIR` > 系统临时目录 `cdp-downloads`）；`--list` 列 targetId | 一次性求值 / 排查；**默认入口** | ✅（2026-10-13 去掉写死下载目录；目标解析改用 conn.mjs 的 `pickPage`，默认 match 统一 localhost） |
| `conn.mjs` | 🔴 **多步脚本的唯一标准连接库**：目标 `--target` > `CDP_TARGET` > `--match`/`CDP_MATCH`（默认 localhost，匹配不到报错）；所有调用默认 ≤30s 且 `unref()`；`shot` = 直接截图 ×2（不抢前台，最小化也能截）→ 仍失败且最小化则临时恢复再缩回 → bringToFront → screencast（监听用完即移除，坑 50）；`winState()` 查窗口状态；`waitStable` / `snapSame` 同帧截图；`on()` 返回取消函数 / `off()`；`CDP_VIEWPORT` 显式视口；焦点模拟；`cliTargetOpts()` 保留旧 CLI 参数；`connect({hardCap:true})` 连显式长超时也压到 30s | 自写多步脚本一律 `import { connect }`，别再各抄一份 CDP 客户端 | ✅ 2026-10-10；2026-10-13 并入 sconn 能力（语法检查通过，未实机回归） |
| `sconn.mjs` | **= `conn.mjs` 的 `hardCap` 别名**（防卡死能力已并入 conn.mjs）；旧 `import … from sconn.mjs` 不用改 | 🔴 **子 agent / 并行窗口 / 窗口可能被遮挡时一律用它**；toast、滑入动画、抽屉截图（`waitStable` / `snapSame`） | ✅ 2026-10-13（CP-58118 AC-52/62）；同日改为别名 |
| `real-click.mjs` | 按「选择器+可见文本」真鼠标点击；`--list` 只列候选 | 点页签/下拉项/按钮；`el.click()` 无效时 | ✅（2026-10-13 起读 `CDP_TARGET` / `CDP_PORT`） |
| `vtable-read.js` | 虚拟滚动表格**可见区**几何归位读单元格 | 读列值、截图前定位单元格 | ✅ 16 列全归位 |
| `vtable-scroll.mjs` | 滚动收**全量**行（可见区不够时） | 分页/滚动验证「后面有没有这条」 | ✅（2026-10-13 起读 `CDP_TARGET` / `CDP_PORT`；页面内采集默认超时 300s，`--timeout` 可改） |
| `vue-datalayer-read.js` | 读 Vue `setupState` 行数据，`NULL/number/string` 三态 + 按分组键分组 | **分不清 `--` 是门禁还是没数据时必用** | ✅ |
| `stage-shot.mjs` | 布景→前置 JS→截图→导几何（`--rects`）**同帧**；目标 `--target` 或 `CDP_TARGET`（都没有直接报错，不猜窗口） | 要出带红框的证据图 | ✅（2026-10-13 起读 `CDP_TARGET`） |
| `vue-walk-snippet.js` | 按组件名遍历 Vue 树读 `setupState` 的片段（CP-57189） | 自写读数脚本时的模板 | ✅ |
| `net-cap.mjs` | 抓包 + console + 异常 → 落盘；响应体不倒进上下文，只回摘要 | 验证接口返回、查 4xx/5xx | ✅（2026-10-13 起读 `CDP_TARGET` / `CDP_PORT`） |
| `ev.mjs` | 单步求值：`--target <id>`（或 `CDP_TARGET`）锁标签，`--port/--match/--index` 同 `conn.mjs`，参数位置不限；`--file page.js` 原样注入；出错一行信息 + 退出码 1 | 读状态、跑页面脚本 | ✅ 2026-10-13（修：原先 `--target` 被当成表达式求值，报 `target is not defined`） |
| `export-target.mjs` | **并行安全的导出**：锁 `CDP_TARGET`、页面脚本给按钮坐标、`--dir` 落盘、记录请求 / 状态码 / content-disposition | 🔴 **所有导出验证**（导出 = 下载，需用户本轮授权） | ✅ 2026-10-10 |
| `export-click.mjs` | ⛔ **deprecated**：旧导出实现（设 1920 视口覆盖、全局选择器可能命中顶栏下载中心、不给 `CDP_TARGET` 时连第一个含 CreativeManagement 的标签 → 并行时会点到别人的窗口） | 只为旧命令不失效而保留；新用法一律 `export-target.mjs` | 2026-10-13 标 deprecated，去掉写死端口 / 下载目录 |
| `ctx-isolate.mjs` | 多 BrowserContext 隔离自检（浏览器级连接，自带清理） | 需要账号隔离时（`PARALLEL.md` §2.5 B 方案） | ✅ |
| `tab-open.mjs` | **并行开窗**：`--open <url> --n 3 --name g1,g2,g3` 同实例开独立窗口，输出 targetId；`--list` / `--close` | 开测前按分组表开窗、登记窗口标识 | ✅ 2026-10-10 |
| `fresh-entry.mjs` | **「首次进入」模拟**：离开到同源静态资源 → 删偏好 key（可备份）→ 回到页面 | AC 前置「首次进入 / 未做过配置」 | ✅ 2026-10-10 |
| `wait-idle.mjs` | **兼容入口**：2026-10-14 起转发到 `wait-settle.mjs`（旧 CLI 与退出码不变）；旧实现只看遮罩、有「遮罩没了但旧列表还在」的误判 | 旧命令仍可用；**新代码写 `wait-settle.mjs`** | ✅ 2026-10-14（转发，实测退出码/输出兼容） |
| `wait-settle.mjs` | 🔴 **等到「页面真的就绪」**：网络静默（事件驱动）+ DOM 静默（MutationObserver）+ 无 loading 遮罩 +（可选）行数稳定/等于预期；超时**不抛错**、回 `settled:false` + `reason`，退出码 1。库用法 `waitSettle(c, {...})` | 每次布景/切日期/点 Search 之后、读数之前；取代 `sleep(列表 20~40s)` 与只看遮罩的旧 wait-idle | ✅ 2026-10-14 离线回归 11 例（含 net-timeout / 行数不符 / CLI 退出码） |
| `export-lib.mjs` | 导出文件解析（**无第三方依赖**）：csv/tsv（BOM、分隔符自动判别）/ json（data·rows·list…）/ **xlsx（自己解 zip + sharedStrings/inlineStr）**；`parseExport(file)` → `{format,rowCount,headers,rows,sha1,error}`；坏文件不抛错 | 导出验证、页面 vs 文件对账；替代项目专用的 openpyxl 脚本 | ✅ 2026-10-14 离线回归（自带 openpyxl 生成的 4145 行 xlsx/csv 对拍一致） |
| `verify-export.mjs` | 🔴 **导出内容对账**：文件行数/表头/抽样 ↔ 页面 Total；`--find` 查值、`--expect-header` 查列；**`No data found` / Total=0 判为 `no-empty-page` 失败**（防「后端没起」被当成「导出为空」）；产出可引用证据 JSON | 所有导出验证（`export-target.mjs` 只证明"文件落盘 + 打到哪个后端"，不证明内容对不对） | ✅ 2026-10-14 离线回归 18 例（含 4145 vs 4144 不一致、No data found、--find 未命中） |
| `evidence.mjs` | 🔴 **一步出带红框证据图**：布景 → stage-shot 截图+同帧导几何 → `annotate.py --rects` 框边写字 → 证据 JSON（含 checks）。`--mark "1:Ad Type=说明"`（行:列）、`"1:Ad..1:Spend=说明"`（区间合成一框）、不给则自动框前 2 行前 3 列；`--rects`+`--src` 可离线补图 | 一次证据原来要 4~6 条命令、还要记住"前后各导一次 rects"（漏了就退回，CP-58252） | ✅ 2026-10-14 离线回归 13 例 + 人工目检出图 |
| `shot.mjs` | 按 `CDP_TARGET` 截图（走 conn.mjs 的防卡死 `shot`） | 与 rects 同状态出原图 | ✅ 2026-10-10 |
| `storage-restore.mjs` | **测后恢复偏好**：离开到同源静态资源 → 删命中 key → 写回备份 → 回页面 | 🔴 默认**不**跑（用户约定不恢复现场，坑 31）；用户明确要求还原时才用，与 `fresh-entry.mjs --backup` 配对 | ✅ 2026-10-10 |
| `annotate.py` | 🔴 **证据标注图（默认）**：裁剪 + 放大 + 框边「编号 + 文字」+ 顶部说明带（过长自动折行并告警）；`--rects rects.json --mark "lab=说明"` 吃页面导出的框坐标（截图像素，或 cdp 原始输出），框超出裁剪区直接报错；颜色默认红，`--color` 传黑 / 深灰直接报错（2026-10-13：标注不用黑色） | 所有带红框的证据图；判定点少、需要放大看细节 | ✅ 2026-10-01（自 docs/browser-notes 迁入）；`--rects` 2026-10-13 由 annotate-rects.py 并入（离线回归：与旧脚本产出逐字节一致） |
| `annotate-rects.py` | **薄包装**：旧位置参数 `raw rects out "x0,y0,x1,y1" 标题 lab=说明…` → 转调 `annotate.py --rects/--mark` | 旧命令兼容；新写法直接用 `annotate.py --rects` | ✅ 2026-10-10（CP-58252）；2026-10-13 改为包装 |
| `annotate-legend.py` | ⛔ **deprecated**：图例版（框上只画编号，说明放图下图例条） | 🔴 **不合 workflow playbook §4.1「框边必须写字」**，证据验收会判 C2 不过（坑 16g）；只用于非验收用途的示意图 | ✅ 2026-10-10 |
| `compose.py` | 多面板合成标注图；坐标用原图像素（内部换算裁剪偏移与放大） | 对照组 vs 实验组、切换前 vs 后 | ✅ 2026-10-09（自 docs/browser-notes 迁入） |
| `chk401.mjs` | 开测前登录态自检：reload 后收集业务接口状态码，401/403 退出码 2、无业务响应退出码 3 | 每组开测第一步、长流程中途「突然全空」时 | ✅ 2026-10-13（CP-58118） |
| `pump.mjs` | 短暂开 screencast 迫使被遮挡窗口出帧（过渡动画走完、截图不再卡），可落最后一帧 | 窗口被整个挡住、`captureScreenshot` 卡住时 | ✅ 2026-10-13（CP-58118 AC-62/97） |
| `barw.py` | 逐帧量进度条填充宽度（按颜色 + 区域，可出百分比）—— **按画面内容选关键帧** | 「停在 100%」「画满」类断言；录屏帧选帧 | ✅ 2026-10-13（CP-58118 AC-67/97/98） |
| `fetch-stub.mjs` | **构造证据的标准做法**：CDP Fetch 拦截指定接口 → fulfill / fail；开拦截先自检、结束 `Fetch.disable` + reload + 读回确认失效，全程落 log（标「构造（CDP Fetch）」）；`--max`（默认 600s）硬上限，Ctrl+C / SIGTERM 也走收尾 | 首帧 / 失败分支 / 超时等真实环境造不出的态（替代各写一套的 XHR 补丁） | ⚠️ 2026-10-13 由 AC-62/90/97 的拦截代码提炼，未整体回归 |
| `ax-snap.mjs` | 无障碍树快照：`[role] name = value` 缩进文本（generic / 无名节点不占行也不占缩进；父节点 name 已含的 StaticText 碎片去掉）；🔴 **`--visible`** 用一次 DOMSnapshot 去掉不渲染 / `visibility` / `opacity:0` 的节点（El radio/checkbox 透明 input 豁免）；`--root <css>` 只看子树、`--ids` 带 `#backendNodeId`（`DOM.getBoxModel({backendNodeId})` 求坐标再真点击）、`--depth N`、`--out` 落盘只回摘要；`--full` 关掉去重 | 进陌生页面 / 弹窗 / 抽屉先摸结构、找按钮页签的可访问名；**默认加 `--visible`** | ✅ 2026-10-13：Ads 页（HTML 1.8MB）原版算法 340 行 6.7KB → 紧凑 82 行 → `--visible` 62 行 1.3KB，日历 / 日期快捷项全滤掉；`--root ".pacvue-newfilter-wrapper" --ids` → #287 换算坐标命中 Filters；GlobalReport #520 命中 Segments。test3 Ads 页有数据：HTML 644KB → `--visible` 283 行、<1s，单元格值与 `vtable-read.js` 逐格一致但**行列关系丢失**（见坑 39），表格别用它读。移植自 pasky/chrome-cdp-skill（MIT） |

**仍是自写 WebSocket 客户端的脚本**（不经 conn.mjs，知道就好）：`cdp.mjs`（单次 CLI；目标解析已共用 `pickPage`，超时已 `unref`）、
`ctx-isolate.mjs` / `tab-open.mjs`（连**浏览器级** `/json/version`，不是 page；`tab-open` 的请求无超时）、`export-click.mjs`（deprecated）。
新脚本一律 `import { connect } from conn.mjs`。

**验证工作流里的状态登记脚本 `verify_state.py` 不在本 skill**：在 `ai-driven-fullstack-workflow/scripts/`（后端工作流同名脚本同用法）。

### 三种真点击怎么选

| 实现 | 输入 | 适合 |
|---|---|---|
| `real-click.mjs --sel <css> --text <文本>` | 选择器 + 可见文本（全等，折叠空白） | 页签 / 下拉项 / 按钮这类「稳定 class + 短文本」；`--list` 先列候选排查选择器 |
| `cdp.mjs <expr.js> --realclick` | expr 返回 Element | 一次性的复杂定位（要遍历、要算） |
| L1 `click-js.mjs <page.js>` | page.js 返回 `{x,y}`（CSS 像素） | 页面级脚本已算好坐标（如 `full-number-toggle.js`、`file-type-tab.js`）；`conn.mjs` 的 `c.click({x,y})` 是同一回事 |

三者都是 `Input.dispatchMouseEvent` 真鼠标事件（坑 4）；点完一律读回状态（坑 28）。

### 快速选型

```
要读表格某一格的值            → vtable-read.js
要读一整页所有行              → vtable-scroll.mjs
要区分 null / 0 / 门禁隐藏    → vue-datalayer-read.js   ← 语义验收必用
要点某个页签/按钮              → real-click.mjs（三种点击见上表）
要出证据图                    → stage-shot.mjs（--rects 导出坐标给标注脚本）
要看接口返回了什么/是否报错    → net-cap.mjs
要并行跑多组 AC                → tab-open.mjs --open（每组一个 targetId）+ 各组 CDP_TARGET=<id>（L0 / L1 脚本都认，见 PARALLEL.md）
要证明「首次进入 / 未配置」     → fresh-entry.mjs
要等列表加载完再读             → wait-settle.mjs（网络+DOM 静默+遮罩，取代 sleep 猜时长 / 只看遮罩）
要写多步脚本                   → import { connect } from conn.mjs（别再抄 CDP 客户端）；子 agent / 并行 → sconn.mjs（= hardCap）
要等某条件成立 / 等它变化      → c.waitFor(expr, { total, until })（自适应退避；超时抛错带 polls/elapsed）
要一次读多个值                 → c.evAll([expr1, expr2, …])（一次往返；单项抛错为 null）
要验证导出文件内容对不对       → verify-export.mjs（+ export-lib.mjs 解析；export-target.mjs 只管落盘）
开测前确认没掉登录              → chk401.mjs（退出码非 0 立即停）
toast / 滑入动画要截图          → conn.mjs / sconn.mjs 的 snapSame（先 waitStable 再前后 rects 一致）
窗口被挡住、截图 / 动画卡住     → pump.mjs
要构造失败 / 首帧 / 超时分支    → fetch-stub.mjs（别再手写 XHR 补丁）
「画满 / 停在 100%」选关键帧    → barw.py 量填充宽度，按像素选帧
要验证导出文件                 → export-target.mjs（不是 export-click.mjs）
要出带红框证据图               → (L1) cells.mjs / col-rect.mjs 导 rects → shot.mjs → 再导一次 rects（cmp 一致）→ annotate.py --rects
进陌生页面 / 弹窗先摸结构       → ax-snap.mjs --visible（--root 缩到弹窗 / 抽屉 / .pacvue-newfilter-wrapper；见坑 39）
其它                          → cdp.mjs <你的表达式> [--target <id>]
```

### 组合范式（照抄这个顺序，别自己发明）

```
1. net-cap.mjs            确认「页面背后是哪个后端、接口通不通」—— 环境没确认就别往下走
2. real-click.mjs         布景（切页签/筛选项），每步后读状态确认生效
3. stage-shot.mjs         截图 + --rects 同帧导出几何
4. vtable-read.js         读可见区，定位判定点文本
5. vue-datalayer-read.js  读数据层三态，区分「门禁」与「没有」
6. annotate.py --rects    按 --rects 的坐标裁剪+画框（框边写字）
```

---

## 🔴 坑清单（实测，都是「看起来在跑但结论错」型）

> **编号是稳定 ID，不改号**（脚本注释、其它文档按号引用）。2026-10-13 整理只调整了物理顺序（30 归位到 29 之后、16d 归位到 16c 之后、39 归入「点击 / 定位类」），
> 从 `SKILL.md` 迁入的条目接在现有最大号 39 之后，从 **40** 起编号；另新增 16g、19a、49。没有任何旧号被改动或复用。
> 之后按时间追加：50（2026-10-13）、51~58（2026-10-14）、59~61（2026-10-14 性能改造轮）。现有编号：0~61 连续无缺号 + 16a~16g、19a；物理顺序按类别 / 日期分节，不按号排。

### 环境类

0. 🔴 **别凭端口号判断实例身份**。看到 9222 有响应就接上去 —— 可能连的是用户**日常浏览器**，
   会污染他的标签/会话/历史。必须查 `--user-data-dir` 实参：
   指向 Temp/专用目录 = 可复用；**无该参数**或指向 `Google\Chrome\User Data` = 立刻停，另开一个。
   查清后要在回复里明说用的是哪个实例（本轮就发生过没查就下结论的误判）。判定命令与对照表见 `SKILL.md` §2.4。
1. **先确认页面背后是哪个后端**，否则测的不是本机 —— 看前端代理前缀 → 端口 → 监听进程 → 它的
   `-Dspring.profiles.active`。数据指纹（某条记录的 id / 时间）比一遍，证明取证库 == 页面库。
2. **列表接口要 20~42s**。没出数前点操作会被前端守卫吞掉，表现为「点了没反应」——
   不是脚本坏了，是数据没回来。等待要显式给足，别用短 sleep 赌。
3. **后台标签会被节流**（定时器压到 1/min）→ 页面里 `await sleep()` 像卡死。
   必须在**操作同一个 CDP 连接**上 `Emulation.setFocusEmulationEnabled{enabled:true}`（`conn.mjs` / `cdp.mjs` 已默认开启；跨连接无效）。
45. **agent-browser `--headed` 无效**：`--headed`、`--headed true`、`AGENT_BROWSER_HEADED=1` 三种写法起出的 Chrome 命令行里**都带 `--headless=new`**。
    查证方法：列进程看 `--type=` 之外那条主进程命令行是否含 `--headless`。（原 SKILL.md「先排除的坑」1）
46. **agent-browser 的 daemon 与它起的 Chrome 是「启动那次调用的子进程」**：前台调用结束即被回收。
    只有放进**后台任务**（`open` 之后跟 `sleep`）才活得下来。跨调用 `get url` 返回 `about:blank` 是 daemon 重启后的空页，不是页面坏了。（原 SKILL.md「先排除的坑」2）
47. **PowerShell 里跑 `agent-browser open` 会让整个脚本静默终止**（stdout/stderr 合并后配合 Stop 策略提前结束，后续行不执行）。
    同样的命令在 **Bash 里正常**。Bash 里不要用 `timeout`（会命中 Windows 的 `TIMEOUT.EXE`）。（原 SKILL.md「先排除的坑」3）
48. **curl 走代理**：本机有 HTTP 代理，`curl http://127.0.0.1:9222/...` 报 `upstream connect failed` → 加 `--noproxy '*'`。（原 SKILL.md「先排除的坑」4）

### 点击 / 定位类

4. **`el.click()` 对 Popper/ElTooltip/拖拽静默无效** —— 它们监听 pointerdown 或依赖坐标。
   必须 `Input.dispatchMouseEvent`（三种真点击实现见上文）。有些组件的 `@click` 是自定义 emit，原生 `el.click()` 也不触发；`Runtime.evaluate` 带 `userGesture: true`。
5. **选择器找不到 ≠ 元素不存在**：可能是「存在但不可见」（宽 0 / 高 0）。
   先用 `--list` 列出可见候选，再决定是不是选择器写错。
39. **Pacvue 页面的 AX 树偏扁平，且收起的弹层照收**（`ax-snap.mjs` 实测 GlobalReport / Ads）：大多是 `div` 拼的，文字直接挂在根下，只有 el-tabs / 表头 cell / button 这类带 ARIA 的有层级；收起的日期面板（`.daterangepicker.hide-drop`）靠 **`opacity:0`** 藏，AX 树照收（Ads 页一个日历 100+ 行），连 `getBoundingClientRect` 也有尺寸（74×15）。
    → `ax-snap.mjs` 一律加 **`--visible`**；自己判断可见性时**沿祖先链查 `display` / `visibility` / `opacity`**（只看宽高会被 opacity:0 骗过）。
    → 🔴 **表格数据别用 AX 快照读**（test3 Ads 页实测，2026-10-13）：surely-table 在 AX 树里**没有 `row`**，`[cell]` 全平铺；固定列的值先成一整块（9 行的首列 `7,4,5,1,1,1,1,26,26`）、主体区单元格再接上，**只有图标的列（Platform）和 Action 列不出现** —— 值都对（与 `vtable-read.js` 逐格一致），但还原不出「哪个值属于哪行哪列」。读表一律 `vtable-read.js`（几何归位）/ `vue-datalayer-read.js`（三态）；快照里只看表头有哪些列。虚拟滚动同样只给可见行（快照 9 行 vs `Total 14 entries`）。
    → `--root` 用 `querySelector` 只取**第一个**命中：`[class*=filter]` 会先命中宽 0 的 `pacvue-select-nofilterable`，输出为空（脚本会在 stderr 提示）。Ads 筛选条容器是 `.pacvue-newfilter-wrapper`。
40. **同名 id/class 有多份**：例如 `#pacvue-downloadCenter-wrap` 在顶栏「下载中心」和表格工具栏里各有一个。
    按 id 查到的是第一个（往往是顶栏那个，点了没用）。要让 Vue 渲染出候选列表，按 **tag + 独特 class**
    （如 `i.pacvue-download-wrap`）或包裹容器选择，并**校验 `getBoundingClientRect()` 与视口**。（原 SKILL.md「定位元素的两个高频陷阱」1）
41. **工具栏横向溢出**：视口偏窄时右侧图标 x 会大于 `innerWidth`，`elementFromPoint` 落到别的元素上，点了「成功」但没反应。
    可先试 `Emulation.setDeviceMetricsOverride {width:1920,height:1080,deviceScaleFactor:1,mobile:false}`；
    ⚠️ **设完必须读 `innerWidth` 核对**——本机实测有时设了不变，此时改滚表格 / `scrollIntoView`，别假装视口已放大（另见坑 25/26）。（原 SKILL.md「定位元素的两个高频陷阱」2）
42. **`innerText` 对 `display:none` 元素仍返回文本** → 判断可见性看 `getBoundingClientRect().width/height`；但 `opacity:0` 藏起来的弹层宽高也不为 0，要再沿祖先链查 `opacity`（坑 39）。（原 SKILL.md「其他判据」）
43. **点击前先 `document.elementFromPoint(cx, cy)` 打印命中的元素链**，不然「点了没反应」无从下手。（原 SKILL.md「其他判据」）
44. 🔴 **PacvueSelect / el-popper：DOM 0 命中 ≠ 没选项**（teleport / 虚拟列表）—— 先读 Vue `setupState`（`vue-walk-snippet.js`），再决定是否滚 DOM 截图。（原 SKILL.md「其他判据」）

### 筛选/页签类（最容易白跑一轮的地方）

6. **多选页签是累加器**：切了 A 再点 B 得到 `A+B` 混合列表。要「只选 X」必须**先 reload 复位**再单点。
7. **改页签后必须再点查询/搜索**：页签高亮变了但列表数据还是上一次的。
   判定前先确认列表真的刷新了（对比第一行内容，别只看高亮）。
8. **页签选择器常与上层分类选择器同名** → 点错只改高亮不改数据。点完**读状态**（Vue `setupState` 里的 scope 数组）确认。

### 读数类

9. **固定列与主体滚动区是两套 DOM，不共享坐标系**（`surely-table` / `el-table-v2` / TanStack 等）—— 按 `cellIndex` 或 x 偏移猜列，
   实测出现「除首列外全是 null」。用几何归位（`vtable-read.js`，与 DOM 结构无关）：
   ① 表头与每个 cell 都取 `getBoundingClientRect()`；② 按 `top` 聚成行（**容差 4px** —— 固定列与主体区行高可能差 1~2px）；
   ③ 按 `left` 就近归到表头列（容差 40px，宁宽勿窄）；④ 超出容差**留空，不要硬塞** —— 错列比缺列更难发现。
10. **DOM 上 `--` / 空 / `0` 长得一模一样，语义完全不同**：
    - `--` = 前端门禁隐藏（读 `setupState` 原始行 → 字段**有值**）
    - `--` = 后端返 `null`（读原始行 → 字段是 `null`，真没数据）
    - `0` = 后端返数字 0（读原始行 → 字段是数字，真的是零）
    **判据是能区分 null 与 0** —— 把缺失渲染成 `0` 会让「没数据」看起来像「真的是零」，是错误结论的来源。
    做法：`vue-datalayer-read.js` 按组件名拿 `setupState` 里的行数组，逐字段输出 `NULL / number / string` 三态 **+ 按分组键（广告类型之类）分组**
    —— 只 dump 第一行会漏掉组间差异（实测正是"对照组有值、实验组全 null"）。
    天然探针：找一个**不受门禁管辖**的字段，它在所有分支都为 null ⇒ 证明那些 `--` 来自数据层而非门禁；反之亦然。
11. **虚拟滚动只渲染可见区** → DOM 读法拿不到全量，「后面几行有没有」必须滚动收（`vtable-scroll.mjs`）或改读数据层。
12. **滚动步长不能小于行高**，否则跳过整屏且**不报错** —— 最危险的漏。
13. **`setupState` 可能抓到别的组件实例**（同名组件、抽屉里的表格）→ 结论以 DOM 实际渲染为准，
    `setupState` 只用来读数据层。

### 证据图类

14. **几何必须从页面导出，不能靠肉眼在图上量** —— 实测偏了整整一行，且偏得很像真的。
15. **截图与几何必须同帧导出**，否则滚动/改视口后坐标全废。做法：截图**前后各导一次** rects，`cmp` 逐字节一致才用，两份都作为证据存进 `evidence/`（只存一份时验收无法证明同帧 —— CP-58252 被追问过）。
16. **裁剪偏移 + 放大倍数的换算要写在标注脚本里**，别指望调用方手算（`annotate.py --rects` 已内置；跨项目复用别的标注脚本时，若它按「裁剪后、放大前」坐标作画，页面导出的原图坐标要在脚本里换算）。
16a. **loading 中的画面不算页面状态**：截图前读 loading 遮罩数（如 `.el-loading-mask` 可见数 = 0；Pacvue 页面还要算 `.pacvue-loading-mask`，`wait-idle.mjs` 默认已含）并从 DOM 读回 Total / 行数，与对应那次列表响应一致才截。切页签 / reload 后旧列表会残留几秒，截到它会得出「页面多了 N 行」的假结论（CP-58252 实测）。
16b. **标注图出完必须打开看**：标签会压住相邻行或别的框；压住判定点就删框、换裁剪区或拆两张图。
16c. **标注颜色一律不用黑色 / 深灰**（截图里黑字、深色控件太多，没有区分度）：默认红 `255,0,0`，需要区分多组时用蓝 `0,112,255` / 橙 `255,128,0` / 绿 `0,170,60` / 洋红 `220,0,180`。`annotate.py` 已拦截深色，`compose.py` 的说明带与面板标签条也已改红（2026-10-13）。
16d. 🔴 **证据文件名内容用中文（用户硬要求）**，标注文字与证据描述也用中文：文件名 `AC-NN-序号-<中文判定点>-原图/标注.png`（例：`AC-94-r6-03-进度停在100%约0.5秒-标注.png`，权威定义见 workflow `doc-output-and-context.md`「证据文件命名」）；`--title`、`--box` / `--mark` 的说明、`compose.py` 的 `--panel-label`、NOTES / RESULT 里对每个证据文件的说明都写中文。只保留标识符原样：`AC-NN`、`-r6-` 前缀、jobId、字段名、接口路径、页面英文 UI 文案（2026-10-13 用户要求）。
16e. 🔴 **瞬态元素（toast / 消息条 / 滑入动画 / 抽屉）截图前先等稳定**：轮询该元素 rects 到**连续两次逐字节一致**再截，截后再导一次核对；不一致就在它可见期内重拍。只做「前后各导一次」不够 —— 提示框正在滑入时两次都会变（`conn.mjs` / `sconn.mjs` 的 `waitStable` / `snapSame` 已内置）。来源：CP-58118 AC-62 第 4 轮因提示框滑入中截图、前后 rects 不一致被退回。
16f. 🔴 **录屏 / screencast 帧比 DOM 晚一拍：用录屏帧当关键帧时按帧内画面选，不按时间戳选**。同一时刻 DOM 读到 100%，对应时间戳的帧里进度条可能才画到 15%~78%。选帧先量像素（`barw.py` 量填充宽度、或裁剪看文字），选完用 Read 打开目检再写进 RESULT。来源：CP-58118 AC-97 第 4 轮 4 张图标「100%」实为 15%~78%，整组重做。
16g. 🔴 **框边必须写字**：只有框和序号、说明放图例条（`annotate-legend.py`）不合 workflow playbook §4.1，验收判 C2 不过（CP-58252 第 5 轮退回两条 AC）→ 用 `annotate.py --rects`。一个框只框一个判定点：说明写「4 列」而框只框到 1 列，验收员会判「看不出」。（2026-10-13 由脚本表 / annotate-legend.py 头注释提炼为坑）

### 环境与资产类（本机特有）

17. **`.workbuddy/tmp/` 是垃圾场不是资产库** —— 几百个一次性探针，别指望在里面找可复用脚本。
    可复用的都该在 L0/L1。
18. **Bash 里 `find` / `ls -d ~/.*/` 在本机不可靠**（前者静默返回空，后者 SIGTERM）→ 用 `ls`/`Glob`。
    实测 2026-10-14：Bash 工具里裸写 `find` 会命中 Windows 的 `FIND.EXE`，报「FIND: Parameter format not correct」；确需 GNU find 写全路径 `/usr/bin/find`。
19. **分发 / 同步工具的退出码不能当成功证据**：旧 `sync-user-skills.ps1` 的 `Write-Host` 被吞，copy 与 `-VerifyOnly` 都只 exit 0 无输出（实测）
    → 绝不能拿退出码当成功证据，必须看逐文件 md5 比对结果。2026-10-13 起分发改用 `distribute-agent-skills` skill 的 `scripts/distribute.py`（自带逐文件 MD5 校验并打印结果）。
19a. **维护 `.ps1` 只写 ASCII（或带 UTF-8 BOM）**：Windows PowerShell 5.1 在无 BOM 时按 ANSI 读 `.ps1`，中文会变乱码并导致语法错误。（原 SKILL.md 分发章节，2026-10-13 迁入）
20. **Bash 不展开 `$LOCALAPPDATA`**，清 temp 产物要用绝对路径。

### 2026-10-10 新增（CP-57189 证据验收退回 32 条后的修复回路）

21. 🔴 **自写 CDP 客户端的超时 `setTimeout` 不 `unref()`，脚本结果早出来了进程还要等到超时才退**（实测每次调用多等 2 分钟，一下午白耗）。用 `conn.mjs`，或脚本末尾 `process.exit(0)`。
22. 🔴 **正则写在模板字符串里会被吞反斜杠**：`` c.ev(`...replace(/\s+/g,' ')...`) `` 进页面时变成 `/s+/g` —— 不报错，只是把字母 s 换成空格（「Social Ads」→「Social Ad 」、`waitkpi` 永远返回 null、表头「Video\nViews」匹配不上）。
    **页面代码放独立 `.js` 文件原样注入**（`ev.mjs --file`）；必须写在模板里就写 `\\s` / `\\d`，或改 `String.fromCharCode(10)` 这类不含反斜杠的写法。
23. 🔴 **Agent 的 Bash 工具会把命令文本里的 `\\` 折叠成 `\`**（heredoc、`sed`、`python -c` 全受影响，实测 sed 替换 0 命中、python 报 invalid escape；2026-10-13 维护本 skill 时又踩一次；2026-10-14 review 时 python heredoc 里的替换串 `\\` 被折叠、断言 0 命中，第三次）→ 含反斜杠的文件内容**用 Write / Edit 工具写**，别走 shell。页面正则改成不带反斜杠的写法见坑 51。
24. 🔴 **「删 localStorage → reload」模拟不了首次进入**：卸载时组件把内存配置写回，key 又带着旧值回来（实测）。用 `fresh-entry.mjs`（先离开到同源静态资源再删）。`about:blank` 不同源，访问不到目标域存储。
25. 🔴 **`Emulation.setDeviceMetricsOverride` 不会随连接断开可靠撤销**：某次连接设了 3600 宽，之后别的连接 `clearDeviceMetricsOverride` 清不掉，页面一直是 3600（窗口本身是正常大小）。
    → 要么完全不碰视口，要么**每次连接都显式设成确定值**（`conn.mjs` 的 `CDP_VIEWPORT`）；设完读 `innerWidth` 核对。
26. 🔴 **宽视口下弹出层坐标算错**（下拉三个选项叠在同一点，点了不生效且不报错）→ 操作下拉 / 日期面板用正常视口，截图前再切宽视口。
27. **Python 打印中文在 Windows 控制台报 `UnicodeEncodeError`**（文件其实已写好）→ 一律 `PYTHONIOENCODING=utf-8`。
28. **点完「切换类」控件必须读回状态**（`groupByValue`、`isShowAbbreviateNumbers`、存储值），别信脚本自己打印的「已切换」—— 实测 `gb.mjs` 两次打印「→ Asset - Ad」但分组没变。
29. **展开 / 勾选这类开关型操作要幂等**：先判当前状态再决定点不点，盲点会把已展开的收起、已勾的取消。
30. **按序号选标签（`--index`）在并行时不稳**：`/json/list` 顺序随标签激活变化 → 并行一律 `--target <targetId>` / `CDP_TARGET`。
    2026-10-13 补：此前 `real-click` / `net-cap` / `vtable-scroll` / `stage-shot` / `run-page` 只认 `--target`（不读 `CDP_TARGET`），`--match` 默认空串 = 连第一个 page —— 设了 `CDP_TARGET` 也会连到别人的窗口；已统一走 `conn.mjs` 的目标解析。
31. **默认不恢复浏览器现场**（用户约定，2026-10-10）；仅当用户要求还原时：先关掉其它同源标签（关标签 = 卸载 = 把内存配置写回 localStorage，会覆盖刚恢复的值）→ `storage-restore.mjs` → 读回 `allMatch: true`。
    但**测试过程中**要用到某列 / 某分组时照常改（Custom Columns / Group by），并在证据里写明当时的布景。
32. **子 agent 的 brief 没写「禁止 Apply」的弹框，它就可能为了满足 Given 去改偏好**（实测 g2 在抽屉 Custom Column 点了 Apply）：brief 里列出允许改的偏好与「改了要记录、收尾由主会话处理」；**默认不恢复现场（坑 31）**，仅当用户要求还原时主会话收尾统一 `storage-restore`。
33. **子 agent 会因会话结束而中断，状态丢失**：要求它**边做边落盘**（每条 AC 一个目录、NOTES 实时写），主会话按文件盘点续做，别指望它最后一次性汇报。
34. **别把 `/dev/null` 当输出路径传给 node 脚本**（如 `date-range.mjs ... /dev/null`）：Windows 下 node `fs.writeFileSync("/dev/null")` 会在当前目录生成名为 `nul` 的文件，混进证据目录（实测两次，第 2 轮验收被点名）。不需要输出就省略该参数或写到 scratchpad。

### 2026-10-13 新增（CP-58118 并行 4 组、4 轮验收的环境损耗）

35. 🔴 **所有 CDP 调用必须有 ≤30s 超时 + 重试 + 兜底**：被遮挡窗口的 `Page.captureScreenshot` 会挂满超时再残留视口覆盖；子 agent 里多次叠加就是十几分钟无输出，被看门狗（10 分钟）直接终止、现场全丢（实测两个子 agent）。
    当时 `conn.mjs` 默认 60s、约 20 个 Ads 页 L1 脚本都用它，与「子 agent 一律 sconn」矛盾 —— **2026-10-13 已把防卡死能力并入 `conn.mjs`**（默认 30s + `unref` + 重试 + 兜底并移除监听；截图兜底顺序见坑 50），`sconn.mjs` 改为 `hardCap` 别名（连显式长超时也压到 30s）。
    规则：子 agent / 并行窗口一律 `import { connect } from sconn.mjs`；页面内确需长等的单步（如 `ev.mjs` 的 180s）只在主会话用；截图仍卡就 `pump.mjs`。
36. 🔴 **子 agent 开测先跑 `chk401.mjs`**，长流程每组开始前再跑一次：Chrome 登录态过期后页面照常渲染空壳，子 agent 会空跑整组（实测一组全部作废）。退出码 2 / 3 → 停下汇报，按 playbook §2.2 交接登录，不要自己重试。
37. 🔴 **外部服务（AI / 第三方）新契约：出图 / 提交前先发一次最小请求核对对方已部署该版本**，返回 4xx（如 422 字段校验）就停组、先定 mock 方案，别反复提交消耗额度（实测 3 次授权真实出图全部 422：对方测试环境未部署 v2）。规则本身见 workflow playbook §2「外部依赖」。
38. **构造证据统一走 `fetch-stub.mjs`（CDP Fetch）**，不再各组手写 XHR / fetch 补丁：拦截范围按 URL 模式锁死、自检与「已失效」读回自动落 log。纪律见 workflow playbook §4.2。
    2026-10-13 补：`fetch-stub.mjs --until` 与 `creativehub-netcap.mjs` 的 STOP 文件原来没有上限、Ctrl+C 不走收尾（拦截残留在页面上）→ 已加 `--max`（默认 600s）与 SIGINT/SIGTERM 收尾。
49. 🔴 **页面里自己发请求取证时，令牌不要经过 Node**：先在页面内 `fetch(url, {credentials:'include'})` 直接发；必须复用页面请求头时只在内存、只留鉴权 / 业务类非标准头，不落盘、不打印，并在产出里写明 `authVia`（2026-10-13 安全整改 `creativehub-netcap.mjs` / `creativehub-fields-compare.mjs`）。

### 2026-10-13 新增（不抢前台 / 截图兜底）

50. 🔴 **别让 Chrome 抢用户前台：启动必带 4 个防后台参数，`bringToFront` 只作最后兜底**（2026-10-13 实测）：
    `--disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling`
    - **被别的窗口挡住**（最常见）：不加参数时页面被判 `hidden`，定时器降速、rAF 变慢；加参数后 `visible`、定时器 / rAF 满速、截图约 80ms，**完全不需要前台**
    - **移出屏幕**（`Browser.setWindowBounds` left=-4000）：加不加参数都正常（配合焦点模拟）
    - **最小化**：首轮实测截图超时，复测（`--start-maximized` + 参数 + 焦点模拟，含「先最小化、后连接」）**18/18 成功**、单张 0.1~3s、实时帧、不抢焦点 → `shot` 先直接截；两次失败才恢复窗口（会抢焦点）→ 截图 → 再最小化回去。screencast 在最小化时只给**旧帧**，别当证据。
    - ✗ **`fromSurface:false` 禁用**：最小化时返回纯白图且不报错（网上常见建议，实测有害）；`captureBeyondViewport:true` 整页截图在最小化时正常
    - **headless（`--headless=new`）不作为主流程**：用户要手动登录、要看得见；同一 profile 不能被两个实例同时打开，headless 与有头实例无法共享登录态
    - **真点击**（`Input.dispatchMouseEvent`）在以上所有状态都生效，不需要前台
    - 老实例没带参数：`shot` 失败两次后才 `bringToFront`，stderr 会提示；**下次重启实例时补上参数**（登录态在 profile 里，重启不用重登）
    - ⚠️ 2026-10-14 后续实测（坑 57）：短任务进行中、窗口最小化时截图会**隔一次挂一次**（单张等满约 10s；`shot` 已用「连截两次 + 最小化临时恢复」兜底，实测能截到）→ 需要在短窗口内取证时优先别最小化，放到其他窗口后面

### 2026-10-14 新增（CP-58118 QA 修复验证，g1 / g2）

51. （与坑 22、23 同源，本条补充 heredoc 现象与不带反斜杠的正则写法）**Bash heredoc 里写的页面 JS 会丢反斜杠**（`\d` 变 `d`、`\n` 变真换行，正则静默失效）：页面表达式的正则写成 `[0-9]`、`[(]`、`[/]` 这种不带反斜杠的形式，或用 Write 工具把脚本写成文件再执行。
52. **开了视口覆盖（`CDP_VIEWPORT=WxH@scale`）后，页面上报的 `devicePixelRatio` 会变**（如 `1600x1350@1` 在 1.2 缩放屏上读回 0.8）：rects 一律乘**页面当场读回的 dpr**，不要乘系统缩放；用完清掉覆盖并读回原值（如 `1600×789@1.2`）。
53. **脚本自定位目录用 `fileURLToPath(import.meta.url)`**，不要 `new URL(import.meta.url).pathname`：后者不做 URL 解码，目录含中文 / 空格（需求目录必然含）时找不到同目录文件。2026-10-14 已修 `creativehub-drive.mjs`、`creativehub-gen-run.mjs`；各 AC 目录里复制出去的旧副本（如 AC-97 的 `rec7.mjs`）仍是旧写法。
54. **`annotate.py --rects`（及其旧包装 `annotate-rects.py`）上下紧挨的两个框，上框的说明会压住下框的判定点**（坑 16b 的具体形态）：拍到这种布局就去掉次要框、把说明写进图标题，出图后照常 Read 目检（§4.1）。
55. 🔴 **后端没在监听时，Vite 代理返回空 body 的 500，页面显示成「No product found」「No data found!」**，像数据问题：每组开测前（和长流程每段开始前）先确认后端端口在监听（`curl -s --noproxy '*' -o /dev/null -w %{http_code} localhost:<后端端口>`，`000` = 没起；不加 `--noproxy` 会走本机代理，见坑 48），再跑 `chk401.mjs`。
56. 🔴 **调试端口连不上（`ECONNREFUSED 127.0.0.1:9222`）时，子 agent 不要自己拉 Chrome、不要接管现有 Chrome**：多半是电脑重启 / 测试实例被关；停下汇报，由主会话用**原独立 profile** 按 SKILL §1 重新拉起（登录态在 profile 里，通常不用重登），再把新 targetId 发给子 agent。旧 targetId 随实例重启全部失效。
57. **窗口最小化时截图会隔一次挂一次**（最常见的一张等满约 10s 超时，会吃掉 8s 级的短任务窗口）。
    结论先给足：**`conn.mjs` 的 `shot` 已经能正常出图，不需要你手动"踢醒"** —— 它的现成兜底恰好覆盖这条：
    ① 单张上限 `min(SEND_TIMEOUT, 10000)` = 最多等 10s（不是 30s）；
    ② 连续**直接截两次**（第二次本身就把挂起的那次踢活了，实测多数就在这里成功）；
    ③ 两次都失败且窗口是最小化 → 临时恢复窗口 → 截图 → 缩回最小化；④ 仍失败才 `bringToFront` → 最后 screencast 取帧。
    → 正常用法就是直接 `await c.shot(file)`，别的都不用做。只有实测**连续多张都挂**时才降级：
      先发一次 600ms 短超时截图把窗口踢醒（`c.send("Page.captureScreenshot", {format:"png"}, 600).catch(()=>{})`），再正式截；
      或者更省事：**别最小化，把窗口放到其他窗口后面**（坑 50：短任务进行中取证尤其别最小化）。
    ⚠️ 2026-10-14 待确认：坑 50 实测「最小化 18/18 成功」与本条的「隔一次挂一次」边界不同（怀疑与短任务 / 任务进行中有关），
       下次实机验证再测一轮；确定后考虑把「踢醒」做进 `conn.mjs` 的 `shot`（届时本节同步改）。
58. **Windows 下按绝对路径 import skill 库要写成 `file:///C:/...`**，直接写 `C:/...` 或 `/c/...` 会被当成 URL scheme / 找不到模块。
59. 🔴 **`vtable-scroll.mjs --max-rows` 曾形同虚设**（2026-10-14 离线回归实测）：上限只写在 `while` 条件里，首屏 `readOnce()` 可能一次就把 MAX 超掉（实测 `--max-rows 20` + 130 行一次渲染 → 返回 130 行、`truncated:false`）。已修：返回前 `slice(0, MAX)`，`truncated` 按原长度判断。**同类隐患自查**：凡「边收边判上限」的脚本，都要在**返回结果**上也截一次。
60. **别用 node 的 `vm` 当"假浏览器"验证滚动类脚本**（2026-10-14 踩坑记录）：本机自建 CDP 测试台（`/json/list` + WebSocket + 最小 DOM）能可靠回归「等待语义 / 事件驱动 / 解析类」脚本，但**虚拟滚动逐屏路径测不了** —— `vm` 沙箱里给元素 `defineProperty` 的 `scrollTop` 与循环里的 `await` 组合会出现「第二拍读到的仍是上一拍的值」，于是 `if (sc.scrollTop === y) break` 提前触发，看起来像脚本 bug 其实是测试台假象。判据：**同一段循环在纯 Node 里跑 12 拍、在假页面里只跑 2 拍** ⇒ 怀疑测试台。滚动类改动仍以真机验证为准。
61. **PowerShell 的 `Get-Content -Raw` / `Set-Content` 会把 UTF-8 中文文件改坏**（2026-10-14 本轮连踩两次）：`-replace` 后 `Set-Content` 默认按 ANSI 写回，中文变乱码（`ä¸æ–‡`），把脚本注释与字符串一起破坏。**改含中文的脚本一律用 Write / Edit 工具**；确要用 shell，显式 `-Encoding utf8` 且改完 `node --check` + 打开确认。（与坑 19a / 23 同源，但这条是"改坏已有文件"而非"转义丢失"。）

### 2026-10-14 性能改造轮（等待语义 / 导出对账 / 一键证据）

> 起因：全量审计发现真正的性能瓶颈不是 CDP 调用，而是「固定 sleep + 1s 粒度轮询 + 只看遮罩判加载完」——
> 既慢，又会在「遮罩已消失、旧列表还在屏上」时给出错结论（PAGE-NOTES 的 Total 5116 vs 4145）。
> 离线回归台（假 Chrome：`/json/list` + WebSocket + 最小 DOM + 可控慢请求）在 `.workbuddy/tmp/cdp-harness/`：
> 本轮 6 个套件 90 例全绿；**虚拟滚动逐屏路径未离线覆盖**（见坑 60），真机回归时优先补测。

- 新增 L0：`wait-settle.mjs`、`export-lib.mjs`、`verify-export.mjs`、`evidence.mjs`；`conn.mjs` 新增 `waitFor` / `evAll` / `settle`。
- 新增 L1：`wait-lib.mjs`（本项目「等遮罩消失」的唯一写法）；9 个脚本改接它（ads-search / group-by / date-range / compare / sort-check / kpi-wait / drawer-from-ads / creativehub-fields-compare / creativehub-gen-run），
  另 2 个改自适应粒度（creative-ads-setup.js / creativehub-ref-from-library.mjs）。
- `wait-idle.mjs` 转为 `wait-settle.mjs` 的转发入口（旧命令与退出码不变，遵循「废弃不删名」）。
- 顺带修掉的真 bug：`vtable-scroll.mjs --max-rows` 之前完全不生效（坑 59）。

## 维护规则

- 改完 skill 脚本 → 语法自检（`node --check` / `python -m py_compile`，删掉生成的 `__pycache__/`）→ 按 **`distribute-agent-skills` skill** 分发：
  `python ~/.claude/skills/distribute-agent-skills/scripts/distribute.py --skill cdp-drive-real-chrome --dry-run` 先看目标，再去掉 `--dry-run` 正式分发（逐文件 MD5 校验，看输出不看退出码，坑 19）
- 页面改版 → 页面级选择器失效是正常的；**要更新「最后验证」日期并重跑一次**，别留过期结论
- 新脚本进 L0 的门槛：至少在**两个不同需求**里用过
- 🔴 **改 `conn.mjs` / 等待逻辑 / 解析类脚本后，跑 `tests/` 里的离线回归**（假 Chrome，不碰真浏览器，92 例）：
  `cd tests && node run-tests.mjs && node run-wait-settle.mjs && node run-l1.mjs`（全量见 `tests/README.md`）。
  测试台在 **skill 的 `tests/`**（资产，随 skill 分发），不是 `.workbuddy/tmp/` —— 它回归的正是 L0 脚本本身。
- 合并 / 废弃脚本时**默认不删旧文件名**（与 [`self-review.md`](self-review.md) 红线「不为变短而删」一致）：`deprecated` 只表示「别再用」，文件名一律留薄包装或转调（如 `annotate-rects.py` → `annotate.py --rects`、`compare-on.mjs` → `compare.mjs on`），文件头标 deprecated，避免外部文档里的旧命令失效。
  确实要删除时（如安全原因），先在 `REVIEW.md` 逐条写理由，并同步改掉所有引用它的文档、脚本注释与外部命令示例 —— **删之前先 grep 全仓引用**。

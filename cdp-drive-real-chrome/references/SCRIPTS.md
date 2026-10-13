# 脚本目录说明书（scripts/）

> **每次操作浏览器前先读这一页**，别现写。现写的一次性脚本会在 `.workbuddy/tmp/` 堆积成几百个探针，
> 下次既找不到也分不清哪些还有效。本页是索引 + 分层判据 + 每条实测结论。
>
> 页面结构变了 → 改脚本 + 更新本页的「最后验证」日期，不要默默失效。

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
| `projects/creative-management/` | Ads 页布景（`creative-ads-setup.js`）+ 通用执行器（`run-page.mjs`）+ **Ads 列表 / KPI / Custom Columns / Group by / 日期 / 同环比 / 行定位与展开 / 单元格取证 / 分组对账**一整套（2026-10-10）；README 见该目录 |

---

## L0 全局公共脚本

| 脚本 | 一句话用途 | 何时用 | 实测 |
|---|---|---|---|
| `cdp.mjs` | CDP 连接层：执行 JS / 截图 / 真点击 / 下载目录 | **默认入口**，其它脚本的底座 | ✅ |
| `real-click.mjs` | 按「选择器+可见文本」真鼠标点击 | 点页签/下拉项/按钮；`el.click()` 无效时 | ✅ |
| `vtable-read.js` | 虚拟滚动表格**可见区**几何归位读单元格 | 读列值、截图前定位单元格 | ✅ 16 列全归位 |
| `vtable-scroll.mjs` | 滚动收**全量**行（可见区不够时） | 分页/滚动验证「后面有没有这条」 | ✅ |
| `vue-datalayer-read.js` | 读 Vue `setupState` 行数据，`NULL/number/string` 三态 | **分不清 `--` 是门禁还是没数据时必用** | ✅ |
| `stage-shot.mjs` | 布景→前置 JS→截图→导几何（`--rects`）**同帧** | 要出带红框的证据图 | ✅ |
| `vue-walk-snippet.js` | 按组件名遍历 Vue 树读 `setupState` 的片段 | 自写读数脚本时的模板 | ✅ |
| `net-cap.mjs` | 抓包 + console + 异常 → 落盘 | 验证接口返回、查 4xx/5xx | ✅ |
| `export-click.mjs` | 下载场景完整实现（设下载目录 + 点导出） | 验证导出文件 | ✅ |
| `ctx-isolate.mjs` | 多 BrowserContext 隔离自检 | 需要账号隔离时 | ✅ |
| `conn.mjs` | **多步脚本的连接库**：`CDP_TARGET` 锁标签、超时 unref、`CDP_VIEWPORT` 显式视口、焦点模拟、`click/key/shot` | 自写多步脚本一律 `import { connect }`，别再各抄一份 CDP 客户端 | ✅ 2026-10-10 |
| `tab-open.mjs` | **并行开窗**：`--open <url> --n 3 --name g1,g2,g3` 同实例开独立窗口，输出 targetId；`--list` / `--close` | 开测前按分组表开窗、登记窗口标识 | ✅ 2026-10-10 |
| `fresh-entry.mjs` | **「首次进入」模拟**：离开到同源静态资源 → 删偏好 key（可备份）→ 回到页面 | AC 前置「首次进入 / 未做过配置」 | ✅ 2026-10-10 |
| `wait-idle.mjs` | 等可见 loading 遮罩连续消失 N 次 | 切日期 / 分组 / 对比之后、读数之前 | ✅ 2026-10-10 |
| `shot.mjs` | 按 `CDP_TARGET` 截图 | 与 rects 同状态出原图 | ✅ 2026-10-10 |
| `ev.mjs` | 按 `CDP_TARGET` 单步求值；`--file page.js` 原样注入 | 读状态、跑页面脚本 | ✅ 2026-10-10 |
| `export-target.mjs` | **并行安全的导出**：锁 `CDP_TARGET`、页面脚本给按钮坐标、`--dir` 落盘、记录请求 / 状态码 / content-disposition | 所有导出验证（旧 `export-click.mjs` 会点到别人的窗口） | ✅ 2026-10-10 |
| `storage-restore.mjs` | **测后恢复偏好**：离开到同源静态资源 → 删命中 key → 写回备份 → 回页面 | 收尾必做（与 `fresh-entry.mjs --backup` 配对） | ✅ 2026-10-10 |
| `annotate-rects.py` | **证据标注图（默认）**：吃页面导出的 rects（截图像素，或 cdp 原始输出）+ 裁剪区 → 调 `annotate.py` 出「框边写字」图；框超出裁剪区直接报错 | 所有带红框的证据图 | ✅ 2026-10-10（CP-58252） |
| `annotate-legend.py` | 证据标注图（图例版）：框上只画编号，说明放图下图例条 | 🔴 **不合 workflow playbook §4.1「框边必须写字」**，证据验收会判 C2 不过；只用于非验收用途的示意图 | ✅ 2026-10-10 |
| `annotate.py` | 单图裁剪 + 放大 + 框边「编号 + 文字」+ 顶部说明带（文字过长自动折行并告警）；框 / 说明带默认红色，`--color` 传黑或深灰直接报错（2026-10-13：标注不用黑色） | 判定点少、需要放大看细节 | ✅ 2026-10-01（自 docs/browser-notes 迁入） |
| `compose.py` | 多面板合成标注图；坐标用原图像素（内部换算裁剪偏移与放大） | 对照组 vs 实验组、切换前 vs 后 | ✅ 2026-10-09（自 docs/browser-notes 迁入） |

### 快速选型

```
要读表格某一格的值            → vtable-read.js
要读一整页所有行              → vtable-scroll.mjs
要区分 null / 0 / 门禁隐藏    → vue-datalayer-read.js   ← 语义验收必用
要点某个页签/按钮              → real-click.mjs
要出证据图                    → stage-shot.mjs（--rects 导出坐标给标注脚本）
要看接口返回了什么/是否报错    → net-cap.mjs
要并行跑多组 AC                → tab-open.mjs --open（每组一个 targetId）+ 各组 CDP_TARGET=<id>
要证明「首次进入 / 未配置」     → fresh-entry.mjs
要等列表加载完再读             → wait-idle.mjs
要写多步脚本                   → import { connect } from conn.mjs（别再抄 CDP 客户端）
要出带红框证据图               → (L1) cells.mjs / col-rect.mjs 导 rects → shot.mjs → 再导一次 rects（cmp 一致）→ annotate-rects.py
其它                          → cdp.mjs <你的表达式> [--target <id>]
```

### 组合范式（照抄这个顺序，别自己发明）

```
1. net-cap.mjs            确认「页面背后是哪个后端、接口通不通」—— 环境没确认就别往下走
2. real-click.mjs         布景（切页签/筛选项），每步后读状态确认生效
3. stage-shot.mjs         截图 + --rects 同帧导出几何
4. vtable-read.js         读可见区，定位判定点文本
5. vue-datalayer-read.js  读数据层三态，区分「门禁」与「没有」
6. 标注脚本出图           按 --rects 的坐标裁剪+画框（见下）
```

---

## 🔴 坑清单（实测，都是「看起来在跑但结论错」型）

### 环境类

0. 🔴 **别凭端口号判断实例身份**。看到 9222 有响应就接上去 —— 可能连的是用户**日常浏览器**，
   会污染他的标签/会话/历史。必须查 `--user-data-dir` 实参：
   指向 Temp/专用目录 = 可复用；**无该参数**或指向 `Google\Chrome\User Data` = 立刻停，另开一个。
   查清后要在回复里明说用的是哪个实例（本轮就发生过没查就下结论的误判）。
1. **先确认页面背后是哪个后端**，否则测的不是本机 —— 看前端代理前缀 → 端口 → 监听进程 → 它的
   `-Dspring.profiles.active`。数据指纹（某条记录的 id / 时间）比一遍，证明取证库 == 页面库。
2. **列表接口要 20~42s**。没出数前点操作会被前端守卫吞掉，表现为「点了没反应」——
   不是脚本坏了，是数据没回来。等待要显式给足，别用短 sleep 赌。
3. **后台标签会被节流**（定时器压到 1/min）→ 页面里 `await sleep()` 像卡死。
   必须在**操作同一个 CDP 连接**上 `Emulation.setFocusEmulationEnabled{enabled:true}`。

### 点击类

4. **`el.click()` 对 Popper/ElTooltip/拖拽静默无效** —— 它们监听 pointerdown 或依赖坐标。
   必须 `Input.dispatchMouseEvent`（`real-click.mjs` 就是干这个的）。
5. **选择器找不到 ≠ 元素不存在**：可能是「存在但不可见」（宽 0 / 高 0）。
   先用 `--list` 列出可见候选，再决定是不是选择器写错。

### 筛选/页签类（最容易白跑一轮的地方）

6. **多选页签是累加器**：切了 A 再点 B 得到 `A+B` 混合列表。要「只选 X」必须**先 reload 复位**再单点。
7. **改页签后必须再点查询/搜索**：页签高亮变了但列表数据还是上一次的。
   判定前先确认列表真的刷新了（对比第一行内容，别只看高亮）。
8. **页签选择器常与上层分类选择器同名** → 点错只改高亮不改数据。点完**读状态**确认。

### 读数类

9. **固定列与主体滚动区是两套 DOM，不共享坐标系** —— 按 `cellIndex` 或 x 偏移猜列，
   实测出现「除首列外全是 null」。用几何归位（`vtable-read.js`）。
10. **DOM 上 `--` / 空 / `0` 长得一模一样，语义完全不同**：
    - `--` = 前端门禁隐藏（数据其实有值）
    - `--` = 后端返 `null`（真没数据）
    - `0` = 后端返数字 0（真的是零）
    **判据是能区分 null 与 0** —— 把缺失渲染成 `0` 会让「没数据」看起来像「真的是零」。
    天然探针：找一个**不受门禁管辖**的字段，它全为 null ⇒ 证明那些 `--` 来自数据层。
11. **虚拟滚动只渲染可见区** → DOM 读法拿不到全量，「后面几行有没有」必须滚动收（`vtable-scroll.mjs`）。
12. **滚动步长不能小于行高**，否则跳过整屏且**不报错** —— 最危险的漏。
13. **`setupState` 可能抓到别的组件实例**（同名组件、抽屉里的表格）→ 结论以 DOM 实际渲染为准，
    `setupState` 只用来读数据层。

### 证据图类

14. **几何必须从页面导出，不能靠肉眼在图上量** —— 实测偏了整整一行，且偏得很像真的。
15. **截图与几何必须同帧导出**，否则滚动/改视口后坐标全废。做法：截图**前后各导一次** rects，`cmp` 逐字节一致才用，两份都作为证据存进 `evidence/`（只存一份时验收无法证明同帧 —— CP-58252 被追问过）。
16. **裁剪偏移 + 放大倍数的换算要写在标注脚本里**，别指望调用方手算（`annotate-rects.py` 已内置）。
16a. **loading 中的画面不算页面状态**：截图前读 loading 遮罩数（如 `.el-loading-mask` 可见数 = 0）并从 DOM 读回 Total / 行数，与对应那次列表响应一致才截。切页签 / reload 后旧列表会残留几秒，截到它会得出「页面多了 N 行」的假结论（CP-58252 实测）。
16b. **标注图出完必须打开看**：标签会压住相邻行或别的框；压住判定点就删框、换裁剪区或拆两张图。
16c. **标注颜色一律不用黑色 / 深灰**（截图里黑字、深色控件太多，没有区分度）：默认红 `255,0,0`，需要区分多组时用蓝 `0,112,255` / 橙 `255,128,0` / 绿 `0,170,60` / 洋红 `220,0,180`。`annotate.py` 已拦截深色，`compose.py` 的说明带与面板标签条也已改红（2026-10-13）。

### 环境与资产类（本机特有）

17. **`.workbuddy/tmp/` 是垃圾场不是资产库** —— 几百个一次性探针，别指望在里面找可复用脚本。
    可复用的都该在 L0/L1。
18. **Bash 里 `find` / `ls -d ~/.*/` 在本机不可靠**（前者静默返回空，后者 SIGTERM）→ 用 `ls`/`Glob`。
19. **`sync-user-skills.ps1` 的 `Write-Host` 被吞**，copy 与 `-VerifyOnly` 都只 exit 0 无输出
    → **绝不能拿退出码当成功证据**，必须自己 md5 比对 canonical 与各副本。
20. **Bash 不展开 `$LOCALAPPDATA`**，清 temp 产物要用绝对路径。

### 2026-10-10 新增（CP-57189 证据验收退回 32 条后的修复回路）

21. 🔴 **自写 CDP 客户端的超时 `setTimeout` 不 `unref()`，脚本结果早出来了进程还要等到超时才退**（实测每次调用多等 2 分钟，一下午白耗）。用 `conn.mjs`，或脚本末尾 `process.exit(0)`。
22. 🔴 **正则写在模板字符串里会被吞反斜杠**：`` c.ev(`...replace(/\s+/g,' ')...`) `` 进页面时变成 `/s+/g` —— 不报错，只是把字母 s 换成空格（「Social Ads」→「Social Ad 」、`waitkpi` 永远返回 null、表头「Video\nViews」匹配不上）。
    **页面代码放独立 `.js` 文件原样注入**；必须写在模板里就写 `\\s` / `\\d`，或改 `String.fromCharCode(10)` 这类不含反斜杠的写法。
23. 🔴 **Agent 的 Bash 工具会把命令文本里的 `\\` 折叠成 `\`**（heredoc、`sed`、`python -c` 全受影响，实测 sed 替换 0 命中、python 报 invalid escape）→ 含反斜杠的文件内容**用 Write / Edit 工具写**，别走 shell。
24. 🔴 **「删 localStorage → reload」模拟不了首次进入**：卸载时组件把内存配置写回，key 又带着旧值回来（实测）。用 `fresh-entry.mjs`（先离开到同源静态资源再删）。`about:blank` 不同源，访问不到目标域存储。
25. 🔴 **`Emulation.setDeviceMetricsOverride` 不会随连接断开可靠撤销**：某次连接设了 3600 宽，之后别的连接 `clearDeviceMetricsOverride` 清不掉，页面一直是 3600（窗口本身是正常大小）。
    → 要么完全不碰视口，要么**每次连接都显式设成确定值**（`conn.mjs` 的 `CDP_VIEWPORT`）；设完读 `innerWidth` 核对。
26. 🔴 **宽视口下弹出层坐标算错**（下拉三个选项叠在同一点，点了不生效且不报错）→ 操作下拉 / 日期面板用正常视口，截图前再切宽视口。
27. **Python 打印中文在 Windows 控制台报 `UnicodeEncodeError`**（文件其实已写好）→ 一律 `PYTHONIOENCODING=utf-8`。
28. **点完「切换类」控件必须读回状态**（`groupByValue`、`isShowAbbreviateNumbers`、存储值），别信脚本自己打印的「已切换」—— 实测 `gb.mjs` 两次打印「→ Asset - Ad」但分组没变。
29. **展开 / 勾选这类开关型操作要幂等**：先判当前状态再决定点不点，盲点会把已展开的收起、已勾的取消。
31. **默认不恢复浏览器现场**（用户约定，2026-10-10）；仅当用户要求还原时：先关掉其它同源标签（关标签 = 卸载 = 把内存配置写回 localStorage，会覆盖刚恢复的值）→ `storage-restore.mjs` → 读回 `allMatch: true`。
    但**测试过程中**要用到某列 / 某分组时照常改（Custom Columns / Group by），并在证据里写明当时的布景。
32. **子 agent 的 brief 没写「禁止 Apply」的弹框，它就可能为了满足 Given 去改偏好**（实测 g2 在抽屉 Custom Column 点了 Apply）：brief 里列出允许改的偏好与「改了要记录、收尾由主会话恢复」；主会话收尾统一 `storage-restore`。
33. **子 agent 会因会话结束而中断，状态丢失**：要求它**边做边落盘**（每条 AC 一个目录、NOTES 实时写），主会话按文件盘点续做，别指望它最后一次性汇报。
34. **别把 `/dev/null` 当输出路径传给 node 脚本**（如 `date-range.mjs ... /dev/null`）：Windows 下 node `fs.writeFileSync("/dev/null")` 会在当前目录生成名为 `nul` 的文件，混进证据目录（实测两次，第 2 轮验收被点名）。不需要输出就省略该参数或写到 scratchpad。
30. **按序号选标签（`--index`）在并行时不稳**：`/json/list` 顺序随标签激活变化 → 并行一律 `--target <targetId>` / `CDP_TARGET`。

---

## 维护规则

- 改完 skill 脚本 → 同步到各 agent 目录 → **md5 逐目录比对**（见 SKILL.md 分发章节）
- 页面改版 → 页面级选择器失效是正常的；**要更新「最后验证」日期并重跑一次**，别留过期结论
- 新脚本进 L0 的门槛：至少在**两个不同需求**里用过
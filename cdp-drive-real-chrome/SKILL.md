---
name: cdp-drive-real-chrome
description: 用「自拉 Chrome + 直连 CDP」驱动一个已登录、用户可见的浏览器做前端联调/导出验证，并在 agent-browser 的 --headed 失效或 eval/get html 挂死时作为替代路径。当需要让用户手动登录后再由 Agent 继续操作页面、需要真实点击触发浏览器下载并拿到落盘文件、或 agent-browser 命令返回 SIGTERM/超时/headless 无窗口时使用。触发词：浏览器导出验证、需要登录、agent-browser 无窗口、CDP 9222、点击下载按钮、headless。
agent_created: true
---

# 用真实 Chrome + CDP 驱动浏览器

## 何时用

- 任务需要「先让人类登录，再由 Agent 操作页面」（agent-browser 默认起的是 **headless**，用户看不到、登不了）。
- 需要真实点击触发浏览器下载并把文件抓到指定目录。
- agent-browser 的 `eval` / `get html` / `get count` / `network requests` 挂死（SIGTERM），但 `snapshot` / `get url` / `screenshot` 还正常。
- 需要精确控制：读 DOM 细节、按坐标点击、放大视口、捕获网络请求。
- **要读表格里的数据、且要区分 `null` / `0` / 前端门禁隐藏**（见下文「分不清数据没有还是前端不给看」）。
- **要产出带红框的证据截图**，需要从页面导出精确单元格坐标（见下文「截图证据流水线」）。

## ⛔ 动手前必读：`references/SCRIPTS.md`（+ 页面笔记）

**这个 skill 已有成套脚本，不要现写。** 每次操作浏览器前按序打开：

1. [`references/SCRIPTS.md`](references/SCRIPTS.md) — **L0 目录说明书** + 选型决策树 + **坑清单**
2. [`projects/<项目>/README.md`](projects/creative-management/README.md)（本仓常用 creative-management）— **L1 页面级**脚本目录与配方；
   同目录 [`PAGE-NOTES.md`](projects/creative-management/PAGE-NOTES.md) — 该项目页面的**事实、口径与坑**（不进项目 git）
3. 新项目还没有 PAGE-NOTES → 按 [`references/PAGE-NOTES-GUIDE.md`](references/PAGE-NOTES-GUIDE.md) 用模板新建（不放项目目录、不进 git）

全栈 / 后端 workflow 的 playbook Step0 已强制同一顺序；**用户不必每次口头提醒**。

一句话判据：**写脚本前先问「下次换个需求，这个脚本还能直接跑吗？」**
能 → L0 `scripts/`；不能但同页面复用 → L1 `projects/<项目>/`；只用一次 → `.workbuddy/tmp/` 且不提交。

收尾回写：新坑 → SCRIPTS.md；页面操作失效 → 改 L1 脚本并刷「最后验证」；通用手法 ≥2 次 → 升 L0。

> `tmp/` 里那几百个一次性探针是垃圾场不是资产库 —— 不要去那里找可复用的东西。
> 页面结构变了属正常：改脚本 + 更新说明书的「最后验证」日期，**别默默失效**。

## 先排除的坑（本机实测，别重复踩）

1. **agent-browser `--headed` 无效**：`--headed`、`--headed true`、`AGENT_BROWSER_HEADED=1` 三种写法起出的 Chrome 命令行里**都带 `--headless=new`**。
   查证方法：列进程看 `--type=` 之外那条主进程命令行是否含 `--headless`。
2. **agent-browser 的 daemon 与它起的 Chrome 是「启动那次调用的子进程」**：前台调用结束即被回收。
   只有放进**后台任务**（`open` 之后跟 `sleep`）才活得下来。跨调用 `get url` 返回 `about:blank` 是 daemon 重启后的空页，不是页面坏了。
3. **PowerShell 里跑 `agent-browser open` 会让整个脚本静默终止**（stdout/stderr 合并后配合 Stop 策略提前结束，后续行不执行）。
   同样的命令在 **Bash 里正常**。Bash 里不要用 `timeout`（会命中 Windows 的 `TIMEOUT.EXE`）。
4. **curl 走代理**：本机有 HTTP 代理，`curl http://127.0.0.1:9222/...` 报 `upstream connect failed` → 加 `--noproxy '*'`。

## 标准流程

### 1) 后台常驻拉起一个可调试的 Chrome（关键：必须在后台任务里）

```bash
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
"$CHROME" \
  --remote-debugging-port=9222 \
  --user-data-dir="C:\\Users\\<你>\\AppData\\Local\\Temp\\cdp-chrome-profile" \
  --no-first-run --no-default-browser-check --no-proxy-server \
  --window-size=1440,900 \
  "http://<目标页>" > chrome-launch.log 2>&1 &
sleep 20
netstat -ano | grep LISTENING | grep ":9222"
sleep 7200     # 保活：任务活着，Chrome 才活着
```

- 用 `run_in_background=true` 跑。
- `--user-data-dir` 指向**独立持久目录**：登录态（cookies/localStorage）落在磁盘，**Chrome 被回收后重启即恢复登录**，不需要重新登。
- 不要复用/指向用户日常 Chrome 的 profile：日常 Chrome 在跑时会抢单例，且会污染他的浏览器状态。
- 先检查他的 Chrome 有没有开调试端口（`<User Data>/DevToolsActivePort` 不存在 = 没开，无法接管）。

### 2) 验证连通

```bash
curl -s --max-time 5 --noproxy '*' http://127.0.0.1:9222/json/version
curl -s --max-time 5 --noproxy '*' http://127.0.0.1:9222/json/list
```

### 2.4) 🔴 动手前先判定：复用已有实例，还是另开一个

**不要看到 9222 有响应就直接用。** 先查清它是什么（在 PowerShell 工具里跑）：

```
Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
  Where-Object { $_.CommandLine -match 'remote-debugging-port' } |
  ForEach-Object {
    $port = if ($_.CommandLine -match 'remote-debugging-port=(\d+)') { $Matches[1] } else { '?' }
    $udd  = if ($_.CommandLine -match 'user-data-dir="?([^"\s]+)') { $Matches[1] } else { '(NONE!)' }
    "PID $($_.ProcessId) | port $port | udd $udd"
  }
```

| `--user-data-dir` 结果 | 判定 | 怎么做 |
|---|---|---|
| 指向 Temp / 专用目录（如 `cdp-chrome-profile`） | ✅ **可复用** | 直接用，这是为测试准备的实例 |
| **没有该参数**（用默认 profile） | ⛔ **停** | 这是用户日常浏览器：接上去会污染他的会话/标签/历史 → **另开** |
| 指向 `…\Google\Chrome\User Data` | ⛔ **停** | 同上 |
| 查不到进程但端口有响应 | ⚠️ 先 `/json/list` 看标签 | 可能端口被别人占着 |

**另开的命令**（独立端口 + 独立 profile；profile 持久化 → 只需登一次）：

```bash
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
"$CHROME" --remote-debugging-port=9230 \
  --user-data-dir="C:\Users\<你>\AppData\Local\Temp\cdp-profile-<用途>" \
  --no-first-run --no-default-browser-check --no-proxy-server "<目标页>" &
sleep 15
```

- 端口选 **92xx 且避开已在用的**（9222/9223 常被长期实例占着）
- profile 目录名**带上用途**（`-admin` / `-viewer` / `-cp57189`），便于事后分辨是谁
- 新实例**登录态是空的** → 需用户手动登一次；**能用现成登录态就别另开**

> ⚠️ **别凭端口号猜是不是自己的实例**。本机出现过「以为在用测试实例、其实是日常浏览器」的误判 ——
> 判定必须看 `--user-data-dir` 实参。查清后要在回复里**明确说出用的是哪个实例**。

### 2.5) 并行 / 多账号：一个账号一个实例

> **同一个 Chrome 的所有标签共享 cookie**（内置浏览器同理，2026-09-29 实测）。
> 所以「超管 + 受限账号同时验」必须显式隔离，有 **A 多实例** 与 **B 单实例多 context** 两条路：

| 方案 | 登录态 | 开销 | 选它当 |
|---|---|---|---|
| **A. 多实例**（独立端口 + **独立 `--user-data-dir`**） | ✅ **持久**，登一次永久有效 | N 个 Chrome 进程 | **默认**：账号固定、反复用 |
| **B. 单实例多 context**（`Target.createBrowserContext`） | ❌ **临时**，dispose 即失效 | 1 个进程，近乎零成本 | 临时隔离、一次性 |

**选 A 还是 B，看的是登录成本不是技术能力**：AI 不代输凭据、登录必须人来做，
所以"登一次能用多久"比省内存重要。常规验证场景（同一批账号每轮都用）**一律 A**。

```bash
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
# 实例 A：超管
"$CHROME" --remote-debugging-port=9222   --user-data-dir="C:\Users\<你>\AppData\Local\Temp\cdp-profile-admin"   --no-first-run --no-default-browser-check --no-proxy-server "<目标页>" &
# 实例 B：受限普通账号（验否定型 AC 用）
"$CHROME" --remote-debugging-port=9223   --user-data-dir="C:\Users\<你>\AppData\Local\Temp\cdp-profile-viewer"   --no-first-run --no-default-browser-check --no-proxy-server "<目标页>" &
sleep 20 && sleep 7200   # 保活
```

- **`--user-data-dir` 必须不同**：只换端口不换 profile，第二个进程会抢单例、或直接复用同一份登录态，等于白做
- profile 目录持久化 → 登录一次后重启即恢复，不必每轮重登
- 两个实例都要用户**各自手动登录一次**（AI 不代输凭据）

#### B 方案：单实例多 context（临时隔离，实测可用）

> 🔴 **先跑自检确认这条路在当前实例可用**（顺带是可复用骨架）：
> ```bash
> node scripts/ctx-isolate.mjs --port 9222
> # 预期：A 再读 acct=ADMIN / B 再读 acct=VIEWER —— 互不可见即隔离生效，脚本自带清理
> ```

`Target.createBrowserContext` 本质是"程序化的无痕窗口"，Playwright 的并行隔离用的就是它。
实测同一进程内 context A 与 B 的 `document.cookie` 互不可见。

```js
// 连的是 /json/version 的 webSocketDebuggerUrl（浏览器级），不是某个 page 的
const {browserContextId} = await send("Target.createBrowserContext");
const {targetId} = await send("Target.createTarget", {url: "about:blank", browserContextId});
const {sessionId} = await send("Target.attachToTarget", {targetId, flatten: true});
await send("Page.enable", {}, sessionId);
await send("Runtime.enable", {}, sessionId);
await send("Page.navigate", {url: TARGET_URL}, sessionId);
// ... 用完务必收尾，否则 context 会越堆越多
await send("Target.closeTarget", {targetId});
await send("Target.disposeBrowserContext", {browserContextId});
```

🔴 **三个必踩的坑**：

1. **所有后续调用都要带 `sessionId`** —— `Runtime.evaluate` / `Page.captureScreenshot` 漏带会打到默认 context，
   表现为"改了没反应"或截到别的页面
2. **`createTarget` 后不能立刻求值** —— 页面还没导航完，`document.cookie` 返回 `undefined`。
   要**轮询 `location.href` 直到落在目标域**再操作（实测直接 `setTimeout` 等固定时长不可靠）
3. **dispose 即丢登录态** —— 所以 B 不适合"用户手动登录"的场景，每轮都要重登

驱动时用 `--port` 指定实例：

```bash
node cdp.mjs --list --port 9222          # 看该实例有哪些 page target
node cdp.mjs expr.js --port 9223         # 在受限账号实例上执行
node cdp.mjs expr.js --shot --port 9223 --out AC-14-01-no-permission.png
```

**同实例多标签并行**（同账号、只读 AC）用 `--match` / `--index` 定位：

```bash
node cdp.mjs expr.js --port 9222 --match "/Asset" --index 0
node cdp.mjs expr.js --port 9222 --match "/Asset" --index 1
```

🔴 **并行时 `--out` 必须逐个区分**，默认都写 `cdp-shot.png`，会互相覆盖。

### 2.6) 🔴 开测前先出「并行分组表」，一组一个窗口（默认就这么做，用户不必每次提醒）

浏览器验证慢的大头是**串行**：一条 AC 等列表 20~40s，十几条就是半小时。动手前先花 2 分钟分组：

0. 🔴 **请用户登录之前，先查库把「账号 + 数据窗口」定好**（用户约定）：按项目 `PAGE-NOTES.md` 的「默认测试账号」优先（creative-management 是 yinzixin / clientId 62），
   用只读 SQL 确认该账号在目标窗口里**确实有每条 AC 需要的样本**（平台 / 广告类型 / 指标非空），缺哪条就提前说「这几条要换 client」并一次性列出候选账号 —— 别让用户登完才发现没数据、再登一次

1. **按「页面状态」分组**：同一页面、同一组布景（页签 / 日期 / 分组方式 / 对比期）的 AC 放一组，组内串行、省去重复布景
2. **判断组间能不能并行**——三条红线，命中任一就**同组串行**或**换独立 profile 的实例**：
   - **写持久化偏好**：列配置 / KPI 卡片 / Group by 记忆 / 图表指标 / 日期范围等存 **localStorage** 的东西 —— 同一实例的所有标签**共享 localStorage**，A 组改列配置会改掉 B 组的列
   - **写业务数据**（新建 / 编辑 / 删除）—— 一律串行，各自单独认领（出问题才能归因）
   - **前后依赖**（「离开再进入保留上次配置」这类，依赖前一步落盘）
3. **开窗并登记**：`node scripts/tab-open.mjs --open <url> --n <组数> --name g1,g2,…` → 每组拿到一个 `targetId`，
   登记到 `verify_state.py claim --window cdp:9222/<targetId>`；之后该组所有脚本都带 `CDP_TARGET=<targetId>`（`cdp.mjs` 用 `--target`）
4. **并发度 ≤ 4**：再多后端列表接口会互相拖慢（Ads 页单次 20~45s），得不偿失
5. 🔴 **尽可能多开子 agent 并行**（用户约定）：凡是分组表里能独立的组，**全部**派给后台子 agent（一个组一个子 agent、一个窗口），主会话只领一组 + 汇总、改 RESULT / Checklist；
   并发上限受后端列表接口拖慢约束（≤4 个窗口同时跑重查询），超过就排队而不是串行。
   子 agent 的 brief 必须写明，缺一项就会串扰或返工：
   - **自己的 targetId**（`CDP_TARGET=…`）+ **点名禁止碰的其它 targetId**；需要别的页面时用 `tab-open.mjs` **自己开窗**、用完 `--close`
   - **共享偏好禁改清单**（Group by / Custom Columns / KPI 卡片 / 日期范围 …，同实例 localStorage 共享）与当前偏好状态
   - 已授权的写 / 下载动作及次数（没写 = 不许做）；不登录、不碰凭据
   - 必读：本 skill `SCRIPTS.md`、`projects/<项目>/README.md` + `PAGE-NOTES.md`、workflow playbook §4.0「首测即过」
   - 每条 AC 的 GWT 原文位置 + 上次被退回的原因；证据目录与命名（`evidence/fix-rN/`、`-annotated.png`）
   - 产出 `NOTES.md`（Then 拆断言 → 图号框 / 机器证据字段 → 结论），**不改 RESULT.md / case.md / Checklist**；疑似缺陷只记录不改代码
   - 最终汇报格式：结论 + 关键数据 + 文件清单 + 新坑建议 + 窗口是否已关
   主会话在子 agent 回来之前**不得预判它的结论**，回来后先抽查证据原件再写 RESULT
6. 收尾：`tab-open.mjs --close <自己开的 id>`，不关别人的。🔴 **默认不恢复浏览器现场**（偏好 / 日期 / 分组 / 列配置都不还原，用户约定：浪费时间）；只有用户明确要求才跑 `storage-restore.mjs`
7. 子 agent **边做边落盘**（每条 AC 的证据与 NOTES 实时写），会话中断后主会话按文件盘点续做（实测 g2 中断过一次）

分组表模板（写进需求目录的验证记录里，便于复核谁在哪个窗口验了什么）：

| 组 | 页面 / 布景 | AC | 写偏好? | 窗口 targetId | 执行者 |
|---|---|---|---|---|---|
| g1 | Ads·Video·06 月·Asset - Ad·完整数字 | AC-27/28/34 | 否（只读） | `…` | 子 agent A |
| g2 | Ads·Video·首次进入 | AC-09/19 → 13/20/21 | **是**（列配置 / KPI）→ 组内串行，且不与其它写偏好组并行 | `…` | 主会话 |

### 3) 用脚本驱动（`scripts/cdp.mjs`）

```bash
NODE=<node.exe 绝对路径>
"$NODE" cdp.mjs expr.js              # 执行 JS，打印结果
"$NODE" cdp.mjs expr.js --shot       # 额外截图到 cdp-shot.png
"$NODE" cdp.mjs expr.js --realclick  # expr.js 返回 Element，用真鼠标点它
"$NODE" cdp.mjs expr.js --download   # 先设下载目录再执行 JS
```

把要执行的 JS 写进独立文件（`expr.js`），**不要**塞进命令行参数，否则引号/换行极易出错。

### 4) 触发下载并拿到文件

推荐做法（见 `scripts/export-click.mjs`）：`Page.setDownloadBehavior` 指定目录 → `Input.dispatchMouseEvent` 真点击 →
等到目录里出现新文件且没有 `.crdownload`。同时开 `Network.enable` 记录请求 URL、postData 与响应
`content-disposition`，用来证明「打到了哪个后端 / 文件名对不对」。

先记 `before = readdirSync(dir)` 做基线，再看增量，不要按文件名猜。

### 5) 收尾

- 停掉保活任务（Chrome 随之退出），确认 `netstat` 里 9222 已释放。
- 临时脚本放在 workspace 的 `.workbuddy/tmp/` 等约定临时区，别丢进仓库。

## 定位元素的两个高频陷阱

1. **同名 id/class 有多份**：例如 `#pacvue-downloadCenter-wrap` 在顶栏「下载中心」和表格工具栏里各有一个。
   按 id 查到的是第一个（往往是顶栏那个，点了没用）。要让 Vue 渲染出候选列表，按 **tag + 独特 class**
   （如 `i.pacvue-download-wrap`）或包裹容器选择，并**校验 `getBoundingClientRect()` 与视口**。
2. **工具栏横向溢出**：视口偏窄时右侧图标 x 会大于 `innerWidth`，`elementFromPoint` 落到别的元素上，点了「成功」但没反应。
   可先试 `Emulation.setDeviceMetricsOverride {width:1920,height:1080,deviceScaleFactor:1,mobile:false}`；
   ⚠️ **设完必须读 `innerWidth` 核对**——本机实测有时设了不变，此时改滚表格 / `scrollIntoView`，别假装视口已放大。

其他判据：

- `innerText` 对 `display:none` 元素**仍返回文本** → 判断可见性只看 `getBoundingClientRect().width/height`。
- 点击前先 `document.elementFromPoint(cx, cy)` 打印命中的元素链，不然「点了没反应」无从下手。
- 有些组件的 `@click` 是自定义 emit，原生 `el.click()` 不触发；`Input.dispatchMouseEvent` 真鼠标事件更可靠。
- 用 `Runtime.evaluate` 的 `userGesture: true`。
- 🔴 **`Emulation.setFocusEmulationEnabled` 与后续操作必须同一条 CDP 连接**；`cdp.mjs` 已在 evaluate/click 前默认开启。
- 🔴 **PacvueSelect / el-popper：DOM 0 命中 ≠ 没选项**——先读 Vue `setupState`（见 `scripts/vue-walk-snippet.js`），再决定是否滚 DOM 截图。

## 分不清「数据没有」还是「前端不给看」时，读数据层而不是 DOM

表格里某单元格显示 `--` / 空 / `0`，DOM 上**长得一模一样**，但语义完全不同：

| DOM 显示 | 真实原因 | 怎么区分 |
|---|---|---|
| `--` | 前端**门禁**主动隐藏（该列对当前上下文不适用） | 读 `setupState` 原始行 → 字段**有值** |
| `--` | 后端返回 **`null`**（源库无此指标） | 读原始行 → 字段是 `null` |
| `0` | 后端返回**数字 0**，真的是零 | 读原始行 → 字段是数字 |

**判据：必须能区分 `null` 和 `0`。** 语义正确性验收里这两者不等价 ——
把「缺失」渲染成 `0` 会让"没数据"看起来像"真的是零"，是错误结论的来源。

做法：用 `scripts/vue-datalayer-read.js` 按组件名拿 `setupState` 里的行数组，
逐字段输出 `NULL / number / string` 三态 **+ 按分组键（广告类型之类）分组**（哪个类型缺哪个指标一眼可见）。
只 dump 第一行会漏掉组间差异 —— 实测正是"对照组有值、实验组全 null"这种情况。

**选天然探针**：找一个**不受前端门禁管辖**的字段（如某个非专属指标），
它在所有分支都为 `null` ⇒ 证明那些 `--` 来自数据层而非门禁。反之亦然。

## 表格读取：固定列 + 主体区是两套 DOM，不能按 x 坐标猜列

虚拟滚动表格（`surely-table` / `el-table-v2` / TanStack 等）常有「固定列 fix-left」与
「主体滚动区」两套 DOM，**两者不共享坐标系**。按 `cellIndex` 或 x 偏移猜列，
实测会出现"除首列外全是 null"。

正确做法（`scripts/vtable-read.js`，与 DOM 结构无关）：
1. 表头与每个 cell 都取 `getBoundingClientRect()`
2. 按 `top` 聚成行（**要容差 4px** —— 固定列与主体区行高可能差 1~2px）
3. 按 `left` 就近归到表头列（容差 40px，宁宽勿窄）
4. 超出容差**留空，不要硬塞** —— 错列比缺列更难发现

虚拟滚动只渲染可见行 → 要全量数据得滚动收集或改读数据层。

## 截图证据流水线：几何必须从页面导出，不能靠肉眼量

标注脚本（裁剪 / 画框那类）要的是精确矩形。肉眼在图上量坐标必错（实测偏了整整一行）。

流程：`stage-shot.mjs`（截图 **+** `--rects` 导出 `{hdr, rows:[{y,cells:[{col,t,x,y,w,h}]}]}`）
→ 标注脚本按导出的坐标画框。**截图与几何必须同帧导出**，否则滚动/改视口后坐标全废。

跨项目复用注意：标注脚本若按"裁剪后、放大前"坐标作画，从页面导出的**原图坐标**
需要自己换算（裁剪偏移 + 放大倍数），这类换算应写在标注脚本里，别指望调用方手算。

## 平台/筛选类页签的三个通用坑

1. **页签选择器常与它上层的分类选择器同名**，点错只改高亮不改数据；点完**读状态**（Vue `setupState` 里的 scope 数组）确认
2. **多选页签是累加器**：切了 A 再点 B 得到 `A+B` 混合列表。要"只选某一项"必须**先 reload 复位**再单点
3. **改页签后必须再点查询/搜索**：页签高亮变了但列表数据仍是上一次的 —— 判定前先确认列表已刷新

## 脚本模板

见本 skill 的 `scripts/` 目录：

| 脚本 | 用途 |
|---|---|
| `cdp.mjs` | 通用执行 / 截图 / 真点击 / 下载目录；默认开焦点模拟 |
| `export-click.mjs` | 下载场景完整实现 |
| `ctx-isolate.mjs` | 多 BrowserContext 隔离自检 |
| `vue-walk-snippet.js` | Vue3 按组件名读 `setupState` 的可粘贴片段（CP-57189） |
| `vtable-read.js` | 虚拟滚动表格几何归位读单元格（固定列安全），输出 JSON |
| `stage-shot.mjs` | 布景→前置 JS→截图→`--rects` 导几何，一次连接同帧完成 |
| `vue-datalayer-read.js` | 读组件行数据，字段 `NULL/数字/字符串` 三态 + 按类型分组 |
| `real-click.mjs` | 按「选择器+可见文本」真鼠标点击，`--list` 可先列候选；`el.click()` 无效时用它 |
| `vtable-scroll.mjs` | 滚动收**全量**行（虚拟滚动只渲染可见区，DOM 读法拿不到后几行） |
| `net-cap.mjs` | 抓包 + console + 异常 → 落盘；响应体不倒进上下文，只回摘要 |
| `conn.mjs` | 多步脚本连接库：`CDP_TARGET` 锁标签、超时 unref、`CDP_VIEWPORT` 显式视口 |
| `tab-open.mjs` | 并行开窗（每组一个 targetId）/ 列出 / 关闭 |
| `fresh-entry.mjs` | 「首次进入」模拟（离开到同源静态资源再删偏好 key，避免卸载写回） |
| `wait-idle.mjs` | 等 loading 遮罩消失（Pacvue 是 `.pacvue-loading-mask`） |
| `shot.mjs` | 按 `CDP_TARGET` 截图 |
| `annotate-rects.py` | 证据标注图（推荐）：页面导出的 rects + 裁剪区 → 框边「编号 + 文字」，框越界报错 |
| `annotate-legend.py` | 图例版标注（框上编号 + 图下图例）—— 不合 workflow §4.1「框边写字」，验收证据别用 |
| `annotate.py` | 单图裁剪 + 放大 + 框边写字（适合判定点很少、要放大看的图） |
| `compose.py` | 多面板合成标注图（对照组/实验组、切换前/后拼一张；坐标用原图像素） |

页面级（L1）脚本见 `projects/<项目>/README.md`；creative-management 的 Ads 页已有整套（列表 / KPI / Custom Columns / Group by / 日期 / 对比 / 行定位 / 取证 / 对账）。

## 分发与维护（本机特有，改完必做）

本机装了多个 AI agent，各自的**用户级** skill 目录约定一致：`<家目录>\<agent>\skills\<skill-name>\SKILL.md`
（`.claude\skills`、`.cursor\skills`、`.qoder\skills`、`.agents\skills` …）。本 skill 已分发到**全部 54 个**这类目录。

⚠️ **改了这个 skill 后必须重新同步**，否则各 agent 拿到的还是旧版：

```powershell
powershell -NoProfile -File "C:\Users\HaijunLing\.workbuddy\scripts\sync-user-skills.ps1"
powershell -NoProfile -File "C:\Users\HaijunLing\.workbuddy\scripts\sync-user-skills.ps1" -VerifyOnly   # 只校验
```

脚本自动扫描目标目录（不硬编码，新装 agent 下次跑就带上）、复制 `SKILL.md` + `scripts/`，并用 SHA256 逐文件校验。
支持 `-SkillName <name>` 分发别的 skill。

排除项：市场/插件/vendor 缓存（`skills-marketplace`、`vendor_imports`、`\plugins\`、`\marketplaces\`）不算 agent skill 目录。

⚠️ 维护该脚本时**只能写 ASCII**：Windows PowerShell 5.1 在无 UTF-8 BOM 时按 ANSI 读 `.ps1`，中文会变乱码并导致语法错误。

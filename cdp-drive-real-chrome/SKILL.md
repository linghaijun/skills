---
name: cdp-drive-real-chrome
description: 用「自拉 Chrome + 直连 CDP」驱动一个已登录、用户可见的浏览器做前端联调 / 浏览器实机验证 / 导出验证，并在 agent-browser 的 --headed 失效或 eval/get html 挂死时作为替代路径。当需要让用户手动登录后再由 Agent 继续操作页面、需要真实点击触发浏览器下载并拿到落盘文件、需要出 AC 证据截图（红框标注、截图与几何同帧）、需要区分表格里的 null 与 0（数据层 vs 前端门禁）、需要多组 AC 并行（每组一个窗口、CDP_TARGET 锁窗口）、或 agent-browser 命令返回 SIGTERM/超时/headless 无窗口时使用。触发词：浏览器实机验证、浏览器导出验证、AC 证据截图、红框标注、并行窗口、CDP_TARGET、区分 null 与 0、Creative Hub 页面取证、需要登录、agent-browser 无窗口、CDP 9222、点击下载按钮、headless。
agent_created: true
---

# 用真实 Chrome + CDP 驱动浏览器

## 何时用

- 任务需要「先让人类登录，再由 Agent 操作页面」（agent-browser 默认起的是 **headless**，用户看不到、登不了）。
- 需要真实点击触发浏览器下载并把文件抓到指定目录。
- agent-browser 的 `eval` / `get html` / `get count` / `network requests` 挂死（SIGTERM），但 `snapshot` / `get url` / `screenshot` 还正常。
- 需要精确控制：读 DOM 细节、按坐标点击、放大视口、捕获网络请求。
- **要读表格里的数据、且要区分 `null` / `0` / 前端门禁隐藏**（坑 10）。
- **要产出带红框的证据截图**，需要从页面导出精确单元格坐标（坑 14~16g）。
- **多组 AC 并行验证**（一组一个窗口 / targetId，见 [`references/PARALLEL.md`](references/PARALLEL.md)）。

## ⛔ 动手前必读：`references/SCRIPTS.md`（+ 页面笔记）

**这个 skill 已有成套脚本，不要现写。** 每次操作浏览器前按序打开：

1. [`references/SCRIPTS.md`](references/SCRIPTS.md) — **脚本表 + 选型决策树 + 坑清单的唯一权威**（三种真点击怎么选也在这里）
2. [`projects/<项目>/README.md`](projects/creative-management/README.md)（本仓常用 creative-management）— **L1 页面级**脚本怎么用、配方；
   同目录 [`PAGE-NOTES.md`](projects/creative-management/PAGE-NOTES.md) — 该项目页面的**事实、口径、测试账号与坑**（不进项目 git）
3. 要并行 / 多账号 → [`references/PARALLEL.md`](references/PARALLEL.md)（原本文 §2.5 / §2.6 全文）
4. 新项目还没有 PAGE-NOTES → 按 [`references/PAGE-NOTES-GUIDE.md`](references/PAGE-NOTES-GUIDE.md) 用模板新建（不放项目目录、不进 git）

全栈 / 后端 workflow 的 playbook Step0 已强制同一顺序；**用户不必每次口头提醒**。
工作流里登记窗口用的 `verify_state.py` 不在本 skill，在 `ai-driven-fullstack-workflow/scripts/`。

一句话判据：**写脚本前先问「下次换个需求，这个脚本还能直接跑吗？」**
能 → L0 `scripts/`；不能但同页面复用 → L1 `projects/<项目>/`；只用一次 → `.workbuddy/tmp/` 且不提交。

🔴 **收尾必须整理可复用脚本与经验**（新坑 → SCRIPTS.md；页面事实 / 口径 → PAGE-NOTES；脚本按分层判据升 L1 / L0）→ 清单与提名门控见 **§5 收尾**。

> `tmp/` 里那几百个一次性探针是垃圾场不是资产库 —— 不要去那里找可复用的东西（坑 17）。
> 页面结构变了属正常：改脚本 + 更新说明书的「最后验证」日期，**别默默失效**。

## 🔴 红线与高频坑（短清单：每条一行，全文点链接看 SCRIPTS.md 对应坑号）

**动手前**
- 🔴 **先判定实例**：看 `--user-data-dir` 实参，不凭端口号；无该参数 / 指向 `Google\Chrome\User Data` = 用户日常浏览器 → 停，另开（§2.4，坑 0）
- 🔴 **先确认页面背后是哪个后端**，数据指纹比一遍再取证，否则测的不是本机（坑 1）
- 🔴 **开测先跑 `chk401.mjs`**：登录态过期页面照常渲染空壳，退出码非 0 立即停、交给用户登录（坑 36）
- agent-browser `--headed` 实际仍是 headless；daemon 随前台调用被回收；PowerShell 里跑它会静默终止；curl 本机要 `--noproxy '*'`（坑 45~48）

**连接与并行**
- 🔴 **并行一律锁窗口**：每组 `CDP_TARGET=<targetId>`（`tab-open.mjs --open` 拿 id），不用 `--index`；同实例标签共享 cookie + localStorage（坑 30，[PARALLEL §2.6](references/PARALLEL.md)）
- 🔴 **写偏好 / 写数据 / 前后依赖的 AC 不并行**；并发窗口 ≤ 4；能独立的组尽量派子 agent（[PARALLEL §2.6](references/PARALLEL.md)）；**单个 AC / 几步就完的操作自己做**（派子 agent 要重讲上下文、另开窗口，小活反而更慢）
- 🔴 **子 agent 连接一律 `sconn.mjs`**（所有 CDP 调用 ≤30s + 兜底），不得自写无超时客户端；brief 必含 targetId / 禁改偏好清单 / chk401（坑 35、32，[PARALLEL §2.6](references/PARALLEL.md)）
- 🔴 **多步脚本只用 `conn.mjs` / `sconn.mjs`**，别再抄 CDP 客户端（超时不 `unref` 会白等，坑 21）
- 🔴 **焦点模拟必须同一条连接**，否则后台标签被节流、页面里 sleep 像卡死（坑 3）
- 🔴 **不抢前台**：启动带 4 个防后台参数后被挡住也能截图 / 点击；`bringToFront` 只在截图失败时兜底；最小化也先直接截，偶发失败才恢复窗口；**禁用 `fromSurface:false`（返回白图）**（坑 50）

**操作**
- 🔴 **`el.click()` 常静默无效** → 真鼠标事件（`real-click.mjs` / `cdp.mjs --realclick` / `click-js.mjs`）；点前打印 `elementFromPoint` 命中链（坑 4、43）
- 🔴 **点完切换类控件必须读回状态**；开关类操作要幂等（坑 28、29）
- 🔴 **多选页签是累加器 → 先 reload 复位；改页签后必须再点 Search**（坑 6、7、8）
- 同名 id 多份、工具栏横向溢出、`innerText` 读到隐藏元素、PacvueSelect DOM 0 命中 ≠ 没选项、AX 快照里收起的弹层照收（坑 39~44）
- 🔴 **「删 localStorage → reload」不是首次进入** → `fresh-entry.mjs`（坑 24）
- 🔴 **视口覆盖不会随连接撤销**；宽视口下弹出层坐标算错 → 操作在正常视口、截图再切宽（坑 25、26）
- 🔴 **页面代码放独立 `.js` 原样注入**（模板字符串吞反斜杠）；含 `\\` 的文件用 Write / Edit 写，别走 shell（坑 22、23）

**读数**
- 🔴 **必须能区分 `null` 与 `0`**：`--` 可能是门禁也可能是 null，读数据层 `vue-datalayer-read.js`，按分组键看三态（坑 10）
- 🔴 **固定列与主体区是两套 DOM** → 几何归位 `vtable-read.js`；虚拟滚动只渲染可见行 → `vtable-scroll.mjs`（坑 9、11、12）
- 🔴 **列表 20~42s**：判「没数据」看 XHR 响应体，不看 DOM；loading 中不读不截（坑 2、16a）

**证据**
- 🔴 **几何从页面导出、截图前后各导一次 rects 且 `cmp` 一致**；瞬态元素先 `waitStable`（坑 14、15、16e）
- 🔴 **标注框边必须写字**（`annotate.py --rects`；`annotate-legend.py` 不合验收）；不用黑 / 深灰；出图后打开看（坑 16b、16c、16g）
- 🔴 **录屏帧按画面内容选，不按时间戳**（坑 16f）；构造证据只走 `fetch-stub.mjs` 并标「构造」（坑 38）
- 🔴 **导出 / 写操作 / 点 Generate 需用户本轮授权**；导出用 `export-target.mjs`（`export-click.mjs` 已 deprecated）
- 🔴 **默认不恢复浏览器现场**（用户约定），只有用户要求才 `storage-restore.mjs`（坑 31）
- 🔴 **取证请求的令牌不经过 Node**、请求头不落盘不打印（坑 49）

## 标准流程

### 1) 后台常驻拉起一个可调试的 Chrome（关键：必须在后台任务里）

```bash
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
"$CHROME" \
  --remote-debugging-port=9222 \
  --user-data-dir="C:\\Users\\<你>\\AppData\\Local\\Temp\\cdp-chrome-profile" \
  --no-first-run --no-default-browser-check --no-proxy-server \
  --start-maximized \
  --disable-features=CalculateNativeWinOcclusion \
  --disable-backgrounding-occluded-windows \
  --disable-renderer-backgrounding \
  --disable-background-timer-throttling \
  "http://<目标页>" > chrome-launch.log 2>&1 &
sleep 20
netstat -ano | grep LISTENING | grep ":9222"
sleep 7200     # 保活：任务活着，Chrome 才活着
```

- 用 `run_in_background=true` 跑。
- 🔴 **4 个 `--disable-*` 参数必带**：Chrome 被别的窗口挡住时照常渲染、截图秒回，**不用调到前台打扰用户**；被**最小化**时直接截图通常也能成功，偶发失败才临时恢复窗口（会抢焦点）—— 所以更推荐放到其他窗口后面（坑 50）
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
  --no-first-run --no-default-browser-check --no-proxy-server \
  --disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling --start-maximized \
  "<目标页>" &
sleep 15
```

- 端口选 **92xx 且避开已在用的**（9222/9223 常被长期实例占着）
- profile 目录名**带上用途**（`-admin` / `-viewer` / `-cp57189`），便于事后分辨是谁
- 新实例**登录态是空的** → 需用户手动登一次；**能用现成登录态就别另开**

> ⚠️ **别凭端口号猜是不是自己的实例**。本机出现过「以为在用测试实例、其实是日常浏览器」的误判 ——
> 判定必须看 `--user-data-dir` 实参。查清后要在回复里**明确说出用的是哪个实例**。

### 2.5) 并行 / 多账号：一个账号一个实例 → 全文见 [`references/PARALLEL.md` §2.5](references/PARALLEL.md)

- 🔴 **同一个 Chrome 的所有标签共享 cookie** → 多账号必须**独立端口 + 独立 `--user-data-dir`**（A 方案，默认；只换端口不换 profile 等于白做）
- B 方案（单实例多 BrowserContext）登录态 dispose 即失效，先跑 `ctx-isolate.mjs` 自检；所有后续调用都要带 `sessionId`
- 🔴 **并行时 `--out` 必须逐个区分**，否则截图互相覆盖

### 2.6) 🔴 开测前先出「并行分组表」，一组一个窗口 → 全文见 [`references/PARALLEL.md` §2.6](references/PARALLEL.md)

- 🔴 **请用户登录前先**只读**查库定好「账号 + 数据窗口」**，缺样本的 AC 一次性列出候选账号（默认账号见项目 PAGE-NOTES）
- 🔴 按页面状态分组；**写持久化偏好 / 写业务数据 / 前后依赖**三条红线命中任一 → 同组串行或换独立 profile 实例
- 🔴 `tab-open.mjs --open` 开窗 → `verify_state.py claim --window cdp:9222/<targetId>` 登记 → 全组 `CDP_TARGET=<targetId>`；并发 ≤ 4
- 🔴 子 agent brief 缺项就串扰 / 返工（targetId、禁碰窗口、禁改偏好、sconn、chk401、授权范围、证据命名、边做边落盘），完整清单在 PARALLEL.md
- 收尾只关自己开的窗口；**默认不恢复现场**

### 3) 用脚本驱动（`scripts/cdp.mjs`）

```bash
node cdp.mjs expr.js              # 执行 JS，打印结果
node cdp.mjs expr.js --shot       # 额外截图到 cdp-shot.png（并行时 --out 区分）
node cdp.mjs expr.js --realclick  # expr.js 返回 Element，用真鼠标点它
node cdp.mjs expr.js --download   # 先设下载目录（--dl-dir / CDP_DL_DIR，默认系统临时目录 cdp-downloads）再执行 JS
node cdp.mjs --list               # 列出 page target（含 targetId）
```

把要执行的 JS 写进独立文件（`expr.js`），**不要**塞进命令行参数，否则引号/换行极易出错。
多步操作写成脚本 `import { connect } from "<skill>/scripts/conn.mjs"`（子 agent 用 `sconn.mjs`）；单步求值用 `ev.mjs`；陌生页面先 `ax-snap.mjs --visible` 摸结构。

### 4) 触发下载并拿到文件（🔴 需用户本轮授权）

用 `scripts/export-target.mjs`（并行安全：锁 `CDP_TARGET`）：页面脚本给出导出按钮坐标 → `Page.setDownloadBehavior` 指定 `--dir` →
`Input.dispatchMouseEvent` 真点击 → 等目录里出现新文件且没有 `.crdownload`；同时记录请求 URL、postData、状态码与响应
`content-disposition`，用来证明「打到了哪个后端 / 文件名对不对」。
以「点击前目录快照」为基线看增量，不要按文件名猜。旧 `export-click.mjs` 已 deprecated（不锁窗口，可能点到别人的窗口）。

### 5) 收尾

- 停掉保活任务（Chrome 随之退出），确认 `netstat` 里 9222 已释放。
- 临时脚本放在 workspace 的 `.workbuddy/tmp/` 等约定临时区，别丢进仓库。
- 默认不恢复浏览器现场；只关自己开的窗口。

#### 🔴 整理可复用脚本与经验（每次用完本 skill 都做，不能跳过）

没有这一步，本次写的脚本就烂在 `tmp/`，踩过的坑下次还会再踩。逐项过一遍：

1. **过脚本**：列出本次在 `tmp/` 新写或改过的脚本，逐个按分层判据定去向 ——「下次换个需求还能直接跑」→ 升 L0 `scripts/`；「同页面能复用」→ 升 L1 `projects/<项目>/`；只对这次有效 → 留 `tmp/`。
   升级时必须：文件头写用途 + 用法示例；登记到 `references/SCRIPTS.md`（L0）或 `projects/<项目>/README.md`（L1）；写「最后验证」日期；连接一律用 `conn.mjs` / `sconn.mjs`。
   同一手法在不同需求里第 2 次手写 = 该升 L0 的信号（「≥2 次」靠这次回看历史 tmp / README 判断，不靠记忆）。
2. **过坑**：本次排查超过约 10 分钟、或让结论差点出错的问题，写成坑 —— 跨项目通用 → `SCRIPTS.md` 坑清单（新编号接在末尾，不改旧号）；只和这个项目 / 页面有关 → `PAGE-NOTES.md`。
   写之前先查重：已有同类就并入那一条、补一句「实测：…」，不新开。
3. **过失效**：本次发现失效的 L1 脚本 / PAGE-NOTES 条目 → 修好并刷新「最后验证」；修不了就标「⚠️ 已失效（日期、现象）」，**不删**。
4. **出提名表，用户确认后才写入**：在回复里给一张「本次沉淀提名」表（候选 | 类型：脚本升级 / 新坑 / 页面事实 / 失效修复 | 去向文件 | 理由），用户确认后再写；默认结论可以是「本次无新增」，但要明说。
5. **写入后**：按下方「维护与分发」做语法自检并分发。经验只迁移不删除；确需删改旧条目，逐条说明理由。

## 维护与分发（改完必做）

改了本 skill（含 `scripts/`、`projects/`、`references/`）→ 语法自检（`node --check` / `python -m py_compile`，删 `__pycache__/`）→
按 **`distribute-agent-skills` skill** 分发：`scripts/distribute.py --skill cdp-drive-real-chrome --dry-run` 先看目标，确认后去掉 `--dry-run`；
看它的逐文件 MD5 输出，不拿退出码当成功证据（坑 19）。旧 `sync-user-skills.ps1` 已由 distribute.py 取代。

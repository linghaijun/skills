# cdp-drive-real-chrome Review 记录

上次 review：2026-10-14（下次到期：+7 天，即 2026-10-21）

## 2026-10-14（第四轮 · 移植 browser-use / browser-harness 的 7 项，用户确认「1-7 都改」）

> 来源：browser-use `c75e847`、browser-harness `dbf0e4f`（只读源码，未引入任何依赖或代码文件；手法用 Node 重写）。

### 改动清单
1. 新增 L0 `clickables.mjs` + 页面代码 `clickables-page.js`：`getEventListeners`（`includeCommandLineAPI`）认出 Vue `@click` 的 div，可见性 + 遮挡过滤，编号清单 + `--click n`。
2. `conn.mjs` 新增 `clickEl`（滚进视口 + 遮挡检查，被挡不点、抛 occluded）；`real-click.mjs`、`cdp.mjs --realclick` 改走它（新增 `--force`，退出码 4 / 5）。
3. `conn.mjs` 原生弹窗：连接时 `Page.enable` 订阅；弹出即拒绝挂起的 Runtime/Input；`pendingDialog` / `handleDialog`；**连接时探活 + `isFrozen` / `rescue`**；`close()` 自动取消未处理弹窗。
4. `tab-open.mjs` 窗口标记（sessionStorage + 标题前缀，`--mark` / `--no-mark`）；`conn.mjs` 每次连接补标记（`CDP_TAB_MARK=0` 关）。
5. `conn.mjs` 新增 `fill`（真键盘全选 commands:selectAll + insertText + input/change + 读回）。
6. `c.ev` 报错带行列 + 该行代码；顶层 `return` / `await` 自动包 async 函数重试。
7. 新增 L0 `upload.mjs` + `c.setFiles`。

### 验证
- 离线：新套件 `tests/run-interact.mjs` 37 例；旧 6 套件 92 例全绿（共 129）。假 Chrome 补了 elementFromPoint / activeElement / insertText / 弹窗冻结 / `--cover`。
- 真机（9222，独立 profile `cdp-chrome-profile`，自开 `127.0.0.1:9222/json/version` 窗口造 DOM，跑完关窗）：`tests/real-interact.mjs` **29/29**，连跑两遍；业务页只读跑 `clickables`（AIImageOptimizer，1309 元素 318ms 列 47 个）。

### 本轮新坑（SCRIPTS.md 62~64）
- 62 弹窗归开启时的连接，断开后成孤儿：新连接收不到、关不掉，旧 connect 要 38s（真机抓到后才加的探活 + rescue + close 自动取消）。
- 63 点击前查遮挡（坑 43 落地）。
- 64 Windows `ws.close()` 后立刻 `process.exit()` → libuv 断言退出码 127（tab-open 已改）。
- 另：`clickables` 首版顶层 `const __OPT` 第二次注入报重复声明（离线抓到，改为块作用域）；维护时 Bash heredoc 又吃掉 `\\n`（坑 23 第四次）→ 含反斜杠内容一律 Write / Edit。

### 未做 / 遗留
- 常驻后台连接（browser-harness 核心）不做：与 targetId 锁窗口 / 子 agent 隔离冲突，收益约 0.3s/次。
- `click-js.mjs` / `c.click({x,y})` 仍是纯坐标点击、不查遮挡（没有目标元素可比对），文档已注明。
- `cdp.mjs` 非 realclick 模式、`ctx-isolate.mjs` 仍是自写客户端，开了 `Page.enable` 却不处理弹窗（坑 62 已写明风险）。

## 2026-10-14（第三轮 · 用户指定的性能/实用性改造，6 项全做）

> 范围：审计后按用户要求实施 6 项改造（等待语义、通用 waitFor、导出内容对账、一键证据、vtable 提速、批量求值）。
> 与上两轮不同：这轮**改了代码**，并且**新建了离线回归台**（`<workspace>/.workbuddy/tmp/cdp-harness/`，假 Chrome：`/json/list` + WebSocket + 最小 DOM + 可控慢请求）。

### 改动清单

**核心（`scripts/conn.mjs`）**
- 新增 `waitFor(expr, {total,min,max,fast,until,expect,initialDelay,onPoll,label})`：自适应退避（前 1.5s 25ms 粒、之后放慢），成功判据优先级 `until > expect > 默认(truthy，空数组/空对象算未到)`；超时**抛错**并带 `value/polls/elapsed/timeout`。
- 新增 `evAll([expr...])`：一次往返读多个表达式，单项抛错记 `null`，不整体失败。
- 新增 `settle({idleMs,quietMs,max,minWaitMs,urlRe})`：`Network.*` 事件驱动等网络静默 + 页面内 MutationObserver 等 DOM 静默；超时返回 `settled:false`（不抛错）。

**新增 L0 脚本**
- `wait-settle.mjs`：网络静默 + DOM 静默 + 遮罩消失 +（可选）行数稳定/等于预期；CLI 退出码 0/1，超时给 `reason`。
- `export-lib.mjs`：csv/tsv/json/**xlsx（自解 zip + sharedStrings）** 解析，无第三方依赖；坏文件回 `error` 不抛。
- `verify-export.mjs`：文件行数/表头/抽样 ↔ 页面 Total 对账；`--find` / `--expect-header`；**`No data found`/Total=0 判 `no-empty-page` 失败**；落盘证据 JSON。
- `evidence.mjs`：布景 → `stage-shot.mjs` 同帧截图+导几何 → `annotate.py --rects` → 证据 JSON；`--mark "行:列=说明"`、`"1:A..1:B=说明"`、`--rects`+`--src` 离线补图。

**L1**
- 新增 `projects/creative-management/wait-lib.mjs`（`makeBusyGone` / `waitBusyGone`）：本项目「等遮罩消失」的唯一写法，超时抛错。
- 9 个脚本改接它（ads-search / group-by / date-range / compare / sort-check / kpi-wait / drawer-from-ads / creativehub-fields-compare / creativehub-gen-run），2 个改自适应粒度（creative-ads-setup.js / creativehub-ref-from-library.mjs）。
- `wait-idle.mjs` 转为 `wait-settle.mjs` 的**转发入口**（旧 CLI 与退出码不变）——遵守本 skill「废弃不删名」的维护规则。

**顺带修掉的真 bug**
- `vtable-scroll.mjs --max-rows` 之前**完全不生效**：上限只写在 `while` 条件里，首屏一次渲染即可超掉（实测 `--max-rows 20` + 130 行 → 返回 130 行）。已改为返回前 `slice(0, MAX)`。→ 记入坑 59。
- `vtable-scroll.mjs`：表头几何缓存（`hdrGeom`）+ 每屏等待改为 MutationObserver（`--hold` 从「固定等待」变「上限」）。

### 验证（离线回归台，6 套件 90 例全绿）

| 套件 | 覆盖 | 结果 |
|---|---|---|
| `run-tests.mjs` | conn.mjs 的 waitFor/evAll/settle：立即满足、超时诊断、空数组判据、until 优先级、预算极小不误报、settle 等网络/等 DOM/请求挂起 | 20/20 |
| `run-wait-settle.mjs` | wait-settle 库 + CLI：就绪、net-timeout、行数不符、退出码 0/1 | 11/11 |
| `run-verify-export.mjs` | export-lib 三格式（含 openpyxl 造的 4145 行 xlsx/csv 对拍）+ verify-export 对账/不一致/No data found/--find/缺参 | 18/18 |
| `run-evidence.mjs` | evidence 离线补图：出图、标记数、区间框、自动选框、列名不存在、缺 --src、python 不可用 | 13/13 |
| `run-vtable.mjs` | vtable-scroll：收全量、去重、列归位、顺序、--max-rows 截断、--hold 为上限 | 10/10 |
| `run-l1.mjs` | 真实 L1 脚本在假 Ads 页上跑通 + 真的等遮罩（1500ms/700ms 两档对比）+ 常显遮罩超时抛错 + 静态检查无固定 1s 轮询 | 19/19 |

另有：`node --check` 全部 73 个 .mjs/.js 通过；`evidence.mjs` 出图**人工目检**（框、编号、中文说明带均正确）。

### 未验证 / 待真机复测
- 🔴 **虚拟滚动逐屏路径未离线覆盖**：自建 `vm` 假浏览器在「给元素 defineProperty 的 scrollTop + await」组合下会假性提前 break（纯 Node 同段循环跑 12 拍、假页面只跑 2 拍）→ 判为测试台假象，记入坑 60。真机回归时优先补测 `vtable-scroll.mjs` 滚动路径。
- L1 迁移脚本只验证了「等待语义 + 能跑通」，**页面交互本身（点页签/下拉/Apply）仍需真机**。
- 本轮**未分发**到 `~/.claude/skills`；分发后需对逐文件 MD5。

### 补充：测试台从 `.workbuddy/tmp/` 升到 `tests/`（用户指出的放置错误）

用户问「`run-vtable.mjs` 为什么在 .workbuddy 的临时目录」——**问得对，放在那里是错的**。
按本 skill 自己的分层判据（「下次换个需求，这个脚本还能直接跑吗？」），这批测试回归的是 **L0 脚本本身**
（`conn.mjs` 等待语义 / `wait-settle` / `export-lib` / `verify-export` / `evidence` / `vtable-scroll`），
是**资产**，而且正是它抓出了 `--max-rows` 与 `parseExport` 两个真 bug；放 tmp 等于下次改 `conn.mjs` 没人找得到回归（坑 17）。

已迁移并改造：

- 资产迁到 **`tests/`**（随 skill 分发）：`testkit.mjs` + `fake-chrome.mjs` + 6 个 `run-*.mjs` + `fixtures/gen_fixtures.py` + `README.md`。
- **去掉硬编码**：`testkit.mjs` 从 `import.meta.url` 推 skill 根（可 `SKILL_DIR` 覆盖），不再写死 `C:\Users\...\cdp-drive-real-chrome`。
- **fixture 不再预置二进制**：改为缺失时用 openpyxl 现场生成到临时目录（既是样本，也是与 `export-lib.mjs` 的独立实现对拍）。
- `findPython` 上移 `conn.mjs`（含「**真的 import PIL 才算可用**」校验）并供 `evidence.mjs` / `testkit.mjs` 共用 → 顺带修掉一个新踩的坑：
  用户装的 `Programs\Python\Python314\python.exe` 存在但 import PIL 会挂，原来会先命中它。
- 一次性 `dbg-*.mjs` 探针**留在 tmp**（正确用途），tmp 里另留一份 README 指向 `tests/`。

迁移后复跑（`tests/` 内）：**20/11/18/14/10/19 = 92 例全绿**（evidence 多了 1 例：BOM rects）。
另修：`evidence.mjs` 现在容忍带 UTF-8 BOM 的 rects JSON（PowerShell / 导出工具常写 BOM，`JSON.parse` 见 BOM 直接抛）。


## 2026-10-14（第二轮 · 用户指定的全文审计，非周期自检）

> 范围：全部 90 个文件（含 `REVIEW.md`）。与上一节不同的做法：**抽 110 个文件引用 token 逐个 `Test-Path` 实查**、`node --check` 全部 72 个 .mjs/.js、关键实现与文档声明**逐条读源码对账**、外部引用按拆分后的 `browser-playbook-*.md` 复核章节号。

### 对账结论（无需改动）

- 引用完整性：失效引用只有示例占位符（`expr.js` / `xxx-page.js` / `NOTES.md` / `out.rects.json` / `rec7.mjs` / `gb.mjs` / `adTypeCatalog.js`）与**本 skill 之外**的文件（`verify_state.py`、`validate_step.py`、`distribute.py`、`mysql-mcp-is-prod-us.md`、`.agents/browser-verification.md`、`sync-user-skills.ps1`）；后者逐个 Test-Path **全部真实存在**。
- L0 脚本表 28 行 ↔ `scripts/` 28 文件一一对应；坑编号 0~58 连续 + 16a~16g / 19a 无缺号、无同号异义。
- 文档声明 ↔ 实现：`sconn.mjs` 确为 `connect({hardCap:true})` 别名（L19-21）、`conn.mjs` shot 兜底顺序（L110-149）、`annotate.py` 的 `--rects/--mark/--color` 与深色拦截（L88-95、L120-122）、坑 53 所说的 `fileURLToPath` 已修（`creativehub-drive.mjs:17`、`creativehub-gen-run.mjs:15`）—— **逐条为真**。
- playbook 章节号：§2.2 / §4.0 / §4.1 / §4.2 / §10 / §12 均在 `ai-driven-fullstack-workflow/references/browser-playbook-{tools-cdp,evidence,core,parallel}.md` 实查存在。

### 已改（6 处，均为文档；未改任何脚本逻辑）

1. **坑 57 与 `conn.mjs` 实现不符**（`SCRIPTS.md:271`）：原文断言「`shot` 未内置踢醒」并要求读者自己发 600ms 短超时截图，但 `conn.mjs:121` 是 `min(SEND_TIMEOUT,10000)`（单张只等 10s）、L123-126 **连截两次**，第二次本身即踢醒，另有三层兜底 → 改为如实描述现成兜底（**正常直接 `await c.shot(f)` 即可**），仅在「连续多张都挂」时才教降级手法；`REVIEW.md` 原「待确认」的边界问题保留为坑内 ⚠️ 待实机复测。同步改坑 50 末尾（`SCRIPTS.md:261`）与 `SKILL.md` 红线「不抢前台」。
2. **reference 缺运行基准路径**（`SKILL.md` 必读段新增「执行位置」；`PARALLEL.md` 文首补说明 + 示例统一为 `"$SKILL/scripts/…"`）：原来 `node scripts/xxx.mjs` 与 `node xxx.mjs` 混用且都没说以哪为 CWD，照抄会 ENOENT。
3. **必读清单漏项**（`SKILL.md:9`）：补入 `references/self-review.md`；并新增「术语边界」说明 —— §x / C2 出自 fullstack workflow，**未装该 skill 不影响本 skill 执行**。
4. **自检成本失衡**（`SKILL.md:9` + `self-review.md` 触发表）：到期后加条件「且 skill 被改动过 / 本次有坑待沉淀」，纯只读且无变更改为**抽查 + 刷新日期**，不重读全部文件。
5. **维护规则自相矛盾**（`SCRIPTS.md` 维护规则）：原「不删旧文件名」绝对断言与 `annotate-legend.py` 标 deprecated 并存 → 改为「**默认不删**（deprecated 只表示别再用）；确实要删须先在 REVIEW.md 写理由 + grep 全仓引用」，与 `self-review.md` 红线「不为变短而删」对齐。
6. **两处表述修正**：`SKILL.md:67` 含反斜杠文件的写法（原「含 `\\` 的文件」歧义 → 明确「含 `\` 的脚本内容用 Write/Edit，别走 shell」）；`SKILL.md` §2.4 补一句「旧名 `cdp-chrome-profile` 等专用目录一样算可复用」，消除与 `cdp-profile-<用途>` 的命名歧义。

### 已删

- 无。本轮只做更正与补充，未删除任何规则 / 坑 / 脚本。

### 自检

- `node --check` 全部 72 个 .mjs/.js → 通过（改动涉及 md，脚本未动，仍跑一遍确认）。
- 改动前对 5 个被改文件做了快照备份（本 skill 目录**不在 git 管理下**，无版本回滚兜底）。
- 未跑 `distribute.py`、未碰浏览器、未改项目代码。

### 待确认（承接上节，另加 1 条）

- 坑 50「最小化 18/18 成功」与坑 57「隔一次挂一次」的边界：需实机复测一轮；确认后考虑把「踢醒」做进 `conn.mjs` 的 `shot`。
- 其余 4 条待确认项同上一节（CP-58118 出图 mock、client 62 / 777 快照、列表耗时口径、需求目录旧副本 `rec7.mjs`）。
- 🔴 本次改动**尚未分发**到 `~/.claude/skills`：需按「维护与分发」跑 `distribute.py --dry-run` 后正式分发，并对逐文件 MD5。

## 2026-10-14（子 agent 定期自检，按本 skill references/self-review.md 流程）

- 范围：全部 88 个文件 —— SKILL.md、references/ 4 个（SCRIPTS / PARALLEL / PAGE-NOTES-GUIDE / PAGE-NOTES-TEMPLATE）、scripts/ 28 个（头注释全读，conn.mjs 读到 shot 实现）、projects/creative-management/ 55 个（README、PAGE-NOTES 全读；L1 脚本头注释与对 L0 的引用用 grep 核对）。外部引用核对：workflow playbook §2.2 / §4.0 / §4.1 / §4.2 / §10 / §12、step-03 均在 `ai-driven-fullstack-workflow/references/` 实际存在。

### 对账结论（无需改动的部分）

- SCRIPTS.md L0 脚本表 28 行 ↔ `scripts/` 28 个文件一一对应，无多无少无改名。
- projects/creative-management/README.md 登记 ↔ 目录 53 个脚本全部登记（compare-on/off/custom 以转调登记），无漏登、无幽灵条目。
- 坑编号：0~58 连续无缺号 + 16a~16g、19a；SKILL.md / PARALLEL / README / PAGE-NOTES / 脚本注释里的全部「坑 NN」引用都指向语义正确的条目。
- sconn 并入 conn.mjs：sconn.mjs 确为 `connect({hardCap:true})` 别名；「子 agent 一律 sconn」与「conn 默认 30s」不矛盾（sconn 额外把显式长超时也压到 30s）。
- 自写 WebSocket 客户端清单（cdp / ctx-isolate / tab-open / export-click）与 grep 结果一致。

### 已改（分类计数：失效 / 过时引用 9、矛盾 3、索引补齐 7、标注 6）

**失效 / 过时引用**
- `scripts/conn.mjs:7` 头注释写 `shot` = 「bringToFront → 截图 → 重试 → screencast」，与同文件第 26 行及实现（L111-149：先直接截 ×2 → 最小化临时恢复 → bringToFront → screencast）相反 → 改成实际顺序。
- `references/PARALLEL.md:104`、`projects/creative-management/README.md:189` 把 sconn 描述成「bringToFront + screencast 兜底」（坑 50 之前的旧机制）→ 改为「截图先直接截、不抢前台，兜底顺序见坑 50」。
- `projects/.../header-rects.mjs:1` 写「供 annotate-legend.py 画框」—— 该脚本已 deprecated、不合验收（坑 16g）→ 改指 `annotate.py --rects`。
- `projects/.../ads-state-rects.js:3`、`drawer-adperf-row-rects.js:3` 写「喂 annotate-rects.py」→ 改为 `annotate.py --rects`（注明旧包装仍可用）。
- `references/SCRIPTS.md` 坑 54 写 `annotate-rects.py` → 改为 `annotate.py --rects`（及其旧包装），并标为坑 16b 的具体形态。
- `scripts/real-click.mjs:2` 指向 SCRIPTS.md「三种点击」，实际节名「三种真点击怎么选」→ 改名对齐。
- `projects/.../creative-ads-setup.js:46/69/84` 注释「见坑 1/2/3」指的是 README「内建解决的三个坑」，与 SCRIPTS 坑 1~3（后端 / 列表慢 / 节流）同号异义 → 改为「README 内建坑 N」并附对应 SCRIPTS 坑号（6 / 7）。
- `references/PAGE-NOTES-GUIDE.md` 索引「最后验证 2026-10-10」落后于 PAGE-NOTES 实际（图片生成页节 2026-10-14）→ 改为「按节标注；最新 2026-10-14」。

**矛盾**
- SCRIPTS 坑 50 写「最小化 18/18 成功、先直接截」，坑 57（10-14 实测）写「最小化隔一次挂一次」→ 两条都保留，坑 50 末尾加 ⚠️ 指向坑 57；坑 57 补一句「conn.mjs 的 shot 未内置『踢醒』，需要时自己先 600ms 短超时截一次」；SKILL.md 红线「不抢前台」补「短任务中取证别最小化（坑 57）」。
- SCRIPTS 坑 55 给的探活命令 `curl -s -o /dev/null …localhost` 没带 `--noproxy '*'`，与坑 48（本机 curl 走代理）冲突 → 补 `--noproxy '*'`。
- SCRIPTS 坑 16a 举例只写 `.el-loading-mask`，与 README 操作坑 1 / `wait-idle.mjs`（Pacvue 是 `.pacvue-loading-mask`）不一致 → 补上 Pacvue 遮罩类。

**索引补齐 / 去重（保留一处全文、使用点留硬提醒）**
- SKILL.md 红线短清单缺 10-14 新增的 🔴 坑 → 补 4 条一行提醒：坑 55（先确认后端在监听）、坑 56（9222 连不上子 agent 停下汇报）、坑 57（同上矛盾条）、坑 58（Windows import 写 file:///）；并在既有行补坑 51（heredoc 正则写法）、52（视口覆盖后乘读回 dpr）、54（框说明互压）、§5 收尾升级要求补坑 53（fileURLToPath）。
- SCRIPTS 坑 51 与坑 22 / 23 同源 → 不合并（编号是稳定 ID），51 开头标「与坑 22、23 同源」，23 末尾加「不带反斜杠写法见坑 51」。
- SCRIPTS 坑清单里 50 前只有一条 `---`、没有分节标题 → 加「### 2026-10-13 新增（不抢前台 / 截图兜底）」；编号说明补「50（10-13）、51~58（10-14）追加，0~58 连续」；删掉 56 与 57 之间多余空行。
- PARALLEL §2.6 子 agent brief 必含项补一行硬提醒：9222 连不上就停（坑 56）、先确认后端端口（坑 55）。
- PAGE-NOTES「CRITICAL：不要只看 DOM 判断没数据」补反向判据：秒回空 body 500 = 后端没起（坑 55）。

**事实补充 / 标注**
- PAGE-NOTES「本地 dev 环境」表加「库」行：本地后端连的 `creative_management` 就是 mysql MCP 的**生产 US** 库，本地出图 / Edit 保存 / data.sql 都写进生产 —— 证据：用户记忆 `mysql-mcp-is-prod-us.md`（CP-57346 提交说明 + 2026-10-14 job 5036 / 5494 在 MCP 可查），与 PAGE-NOTES 第 115 行「本地后端与 mysql MCP 同库」**不矛盾**，但原文漏了「这是生产库」这一要害；同时第 115 行补「即生产 US 库」并回指表格。加「后端没起」行（坑 55 的本项目表现）。
- PAGE-NOTES「需求临时备注」5 条逐条加【状态 2026-10-14】：client 62 缺口、client 777 快照 → ⏳ 待重扫；fix-r1 前缀 → ✅ 仍有效（脚本默认值来源）；CP-58118 AC-24/74 → 📦 已沉淀仅溯源；CP-58118 出图 mock → ❓ 待确认。节首加状态图例。
- SCRIPTS 坑 18 补实测：Bash 工具里裸 `find` 命中 Windows `FIND.EXE`（本次 review 第一条命令就踩到），要用 `/usr/bin/find`。
- SCRIPTS 坑 23 补实测：本次 review 用 python heredoc 改 SKILL.md，替换串里的 `\\` 被折叠、断言 0 命中（第三次踩），改用 Edit 工具完成。

### 已删

- 无规则 / 经验 / 坑被删除。唯一删除是 SCRIPTS.md 坑 56 与 57 之间的一个空行（排版）。
- 自检产生的 `scripts/__pycache__/`、`projects/creative-management/__pycache__/` 已删（编译产物，不是 skill 内容）。

### 待确认

- PAGE-NOTES「需求临时备注」CP-58118 出图 mock 是否已从后端删除：本 review 不碰项目代码，无法确认；删除后把该条改 📦，并同步 README「图片 Creative 生成页脚本」第 4 条提醒与 `creativehub-fields-compare.mjs` 的 `EVIDENCE_TYPE` 默认值说明 —— 需主会话 / 用户确认。
- client 62 / 777 数据快照（2026-10-10）是否仍成立：需要只读查 CK 重扫，本 review 未查库。
- SCRIPTS 坑 50「最小化 18/18 成功」与坑 57「隔一次挂一次」的实际边界（是否与短超时 / 任务进行中有关）：需要下次实机验证时再测一轮，确定后考虑把「踢醒」做进 `conn.mjs` 的 `shot`。
- 列表耗时口径各处略有出入（SCRIPTS 坑 2「20~42s」、PARALLEL / README「20~45s」、PAGE-NOTES「20~40s」）：都是不同轮实测值，未统一；如需统一请定一个口径。
- 坑 53 提到需求目录里旧副本（如 AC-97 `rec7.mjs`）仍用 `new URL(import.meta.url).pathname`：不在本 skill 目录，未改。另外 L1 的 `drawer-from-ads.mjs` / `group-by.mjs` / `model-group.mjs` / `row-expand.mjs` / `sort-check.mjs` 用 `fs.readFileSync(new URL("./x.js", import.meta.url))` —— 传 URL 对象给 fs 会正确解码，**不受坑 53 影响**，保留不改。

### 自检

- `node --check`：scripts/ + projects/creative-management/ 全部 72 个 .mjs / .js → 全部通过（改动前后各跑一次）。
- `python -m py_compile`：9 个 .py → 全部通过；生成的 `__pycache__/` 已删，`find . -name __pycache__` 无输出。
- 文件数：改动后仍为 88 个 + 本 REVIEW.md；`scripts/` 无 `_probe-*`。
- 未碰浏览器、未改项目代码、未分发（由主会话统一分发）；SKILL.md 开头定期自检提醒行未改动。

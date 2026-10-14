# 并行 / 多账号验证（权威全文）

> 2026-10-13 由 `SKILL.md` §2.5 / §2.6 原样迁入（内容完整保留，只补了子 agent brief 漏掉的 `sconn.mjs` / `chk401.mjs` 两项，使之与 `SCRIPTS.md` 坑 35/36、workflow playbook §12 一致）。
> 外部文档引用的「cdp skill §2.5 / §2.6」即本文同名两节；`SKILL.md` 里只留硬提醒 + 链接。
> 脚本用法与坑全文以 [`SCRIPTS.md`](SCRIPTS.md) 为准；`verify_state.py` 不在本 skill，在 `ai-driven-fullstack-workflow/scripts/`（后端工作流同名脚本同用法）。

## §2.5 并行 / 多账号：一个账号一个实例

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
"$CHROME" --remote-debugging-port=9222   --user-data-dir="C:\Users\<你>\AppData\Local\Temp\cdp-profile-admin"   --no-first-run --no-default-browser-check --no-proxy-server --disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling --start-maximized "<目标页>" &
# 实例 B：受限普通账号（验否定型 AC 用）
"$CHROME" --remote-debugging-port=9223   --user-data-dir="C:\Users\<你>\AppData\Local\Temp\cdp-profile-viewer"   --no-first-run --no-default-browser-check --no-proxy-server --disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling --start-maximized "<目标页>" &
sleep 20 && sleep 7200   # 保活
```

- **`--user-data-dir` 必须不同**：只换端口不换 profile，第二个进程会抢单例、或直接复用同一份登录态，等于白做
- profile 目录持久化 → 登录一次后重启即恢复，不必每轮重登
- 两个实例都要用户**各自手动登录一次**（AI 不代输凭据）

### B 方案：单实例多 context（临时隔离，实测可用）

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

**同实例多标签并行**（同账号、只读 AC）：🔴 一律按 `targetId` 锁（`--target <id>` 或 `CDP_TARGET=<id>`）。
`--match` / `--index` 只适合单窗口：`/json/list` 顺序随标签激活变化，并行时按序号会连错（`SCRIPTS.md` 坑 30）：

```bash
node cdp.mjs expr.js --port 9222 --match "/Asset" --index 0     # 仅单窗口 / 临时排查
node cdp.mjs expr.js --port 9222 --target <targetId>             # 并行用这个
```

🔴 **并行时 `--out` 必须逐个区分**，默认都写 `cdp-shot.png`，会互相覆盖。

## §2.6 🔴 开测前先出「并行分组表」，一组一个窗口（默认就这么做，用户不必每次提醒）

浏览器验证慢的大头是**串行**：一条 AC 等列表 20~40s，十几条就是半小时。动手前先花 2 分钟分组：

0. 🔴 **请用户登录之前，先查库把「账号 + 数据窗口」定好**（用户约定）：按项目 `PAGE-NOTES.md` 的「默认测试账号」优先（creative-management 是 yinzixin / clientId 62），
   用只读 SQL 确认该账号在目标窗口里**确实有每条 AC 需要的样本**（平台 / 广告类型 / 指标非空），缺哪条就提前说「这几条要换 client」并一次性列出候选账号 —— 别让用户登完才发现没数据、再登一次

1. **按「页面状态」分组**：同一页面、同一组布景（页签 / 日期 / 分组方式 / 对比期）的 AC 放一组，组内串行、省去重复布景
2. **判断组间能不能并行**——三条红线，命中任一就**同组串行**或**换独立 profile 的实例**：
   - **写持久化偏好**：列配置 / KPI 卡片 / Group by 记忆 / 图表指标 / 日期范围等存 **localStorage** 的东西 —— 同一实例的所有标签**共享 localStorage**，A 组改列配置会改掉 B 组的列
   - **写业务数据**（新建 / 编辑 / 删除）—— 一律串行，各自单独认领（出问题才能归因）
   - **前后依赖**（「离开再进入保留上次配置」这类，依赖前一步落盘）
3. **开窗并登记**：`node scripts/tab-open.mjs --open <url> --n <组数> --name g1,g2,…` → 每组拿到一个 `targetId`，
   登记到 `verify_state.py claim --window cdp:9222/<targetId>`（脚本在 `ai-driven-fullstack-workflow/scripts/`）；
   之后该组所有脚本都带 `CDP_TARGET=<targetId>`（`cdp.mjs` / `stage-shot.mjs` 也可用 `--target`）。
   2026-10-13 起 `real-click` / `net-cap` / `vtable-scroll` / `stage-shot` / `run-page` 均已读 `CDP_TARGET`（此前只认 `--target`，设了 env 也会连到别的窗口）
4. **并发度 ≤ 4**：再多后端列表接口会互相拖慢（Ads 页单次 20~45s），得不偿失
5. 🔴 **尽可能多开子 agent 并行**（用户约定）：凡是分组表里能独立的组，**全部**派给后台子 agent（一个组一个子 agent、一个窗口），主会话只领一组 + 汇总、改 RESULT / Checklist；
   并发上限受后端列表接口拖慢约束（≤4 个窗口同时跑重查询），超过就排队而不是串行。
   子 agent 的 brief 必须写明，缺一项就会串扰或返工：
   - **自己的 targetId**（`CDP_TARGET=…`）+ **点名禁止碰的其它 targetId**；需要别的页面时用 `tab-open.mjs` **自己开窗**、用完 `--close`
   - 🔴 **连接一律 `sconn.mjs`**（= `conn.mjs` 的 hardCap 别名：所有 CDP 调用 ≤30s + bringToFront + screencast 兜底），不得自写无超时的 CDP 客户端（坑 35）
   - 🔴 **开测先跑 `chk401.mjs`**，每组开始前再跑一次；退出码 2 / 3 立即停下汇报、不自己重试（坑 36）
   - **共享偏好禁改清单**（Group by / Custom Columns / KPI 卡片 / 日期范围 …，同实例 localStorage 共享）与当前偏好状态；带 Apply 的弹框写明「禁止 Apply」或「允许改哪些、改了要记录」（坑 32）
   - 已授权的写 / 下载动作及次数（没写 = 不许做）；不登录、不碰凭据
   - 必读：本 skill `SCRIPTS.md`、`projects/<项目>/README.md` + `PAGE-NOTES.md`、workflow playbook §4.0「首测即过」
   - 每条 AC 的 GWT 原文位置 + 上次被退回的原因；证据目录与命名（`evidence/fix-rN/`、`AC-NN-序号-<中文判定点>-标注.png`（文件名内容用中文））
   - 产出 `NOTES.md`（Then 拆断言 → 图号框 / 机器证据字段 → 结论），**不改 RESULT.md / case.md / Checklist**；疑似缺陷只记录不改代码
   - 最终汇报格式：结论 + 关键数据 + 文件清单 + 新坑建议 + 窗口是否已关
   主会话在子 agent 回来之前**不得预判它的结论**，回来后先抽查证据原件再写 RESULT
6. 收尾：`tab-open.mjs --close <自己开的 id>`，不关别人的。🔴 **默认不恢复浏览器现场**（偏好 / 日期 / 分组 / 列配置都不还原，用户约定：浪费时间）；只有用户明确要求才跑 `storage-restore.mjs`（坑 31）
7. 子 agent **边做边落盘**（每条 AC 的证据与 NOTES 实时写），会话中断后主会话按文件盘点续做（实测 g2 中断过一次，坑 33）

分组表模板（写进需求目录的验证记录里，便于复核谁在哪个窗口验了什么）：

| 组 | 页面 / 布景 | AC | 写偏好? | 窗口 targetId | 执行者 |
|---|---|---|---|---|---|
| g1 | Ads·Video·06 月·Asset - Ad·完整数字 | AC-27/28/34 | 否（只读） | `…` | 子 agent A |
| g2 | Ads·Video·首次进入 | AC-09/19 → 13/20/21 | **是**（列配置 / KPI）→ 组内串行，且不与其它写偏好组并行 | `…` | 主会话 |

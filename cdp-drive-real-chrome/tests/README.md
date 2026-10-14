# tests/ —— cdp-drive-real-chrome 的离线回归台

**为什么在这里（而不是 `.workbuddy/tmp/`）**：这些测试回归的是 **L0 脚本本身**（`conn.mjs` 的等待语义、
`wait-settle` / `export-lib` / `verify-export` / `evidence` / `vtable-scroll`）——正好命中分层判据
「**下次换个需求，这个脚本还能直接跑吗？** → 能 = 资产」。而且它们是上一轮抓出 2 个真 bug 的东西：
`vtable-scroll --max-rows` 形同虚设、`parseExport` 遇到不存在的文件直接崩。放 tmp 就是下次改 `conn.mjs` 没人会去那里找回归。

## 怎么跑

```powershell
cd <skill>/tests
node run-tests.mjs          # conn.mjs: waitFor / evAll / settle
node run-wait-settle.mjs    # wait-settle.mjs（库 + CLI）
node run-verify-export.mjs  # export-lib.mjs + verify-export.mjs（含 openpyxl 造的 4145 行对拍）
node run-evidence.mjs       # evidence.mjs（离线补图）
node run-vtable.mjs         # vtable-scroll.mjs（收全量/去重/列归位/--max-rows/--hold）
node run-l1.mjs             # 真实 L1 脚本 + wait-lib 集成 + 静态检查
node run-interact.mjs       # conn.mjs 的 clickEl 遮挡 / fill / 原生弹窗 / ev 报错行号与 return 包裹 + clickables / real-click CLI
```

全绿基线：**20 / 11 / 18 / 14 / 10 / 19 / 37 = 129 例**（2026-10-14 加 run-interact 37 例）；每套件退出码 0 = 全过。

**真机套件（不在 129 例里，要真 Chrome）**：`node real-interact.mjs`（29 例，2026-10-14 基线）—— 改了 `conn.mjs` 的点击 / 弹窗 / 连接初始化 / 窗口标记后跑。
它自己 `tab-open.mjs` 开一个 `http://127.0.0.1:<port>/json/version` 窗口造测试 DOM、跑完关掉，不碰业务页；跑前按 SKILL §2.4 确认 9222 是独立 profile 实例。

需要 Python（Pillow）的套件会自动探测；探测不到时用环境变量指定：

```powershell
$env:DSH_PYTHON = "<...>\dependencies\python\python.exe"   # 或设 DSH_PYTHON 后再跑
```

> 本机实测：`LOCALAPPDATA\Programs\Python\Python314\python.exe` 存在但 import PIL 会挂，
> 所以 `findPython` 会**逐个候选真的 import PIL 验证**，并优先 dsh 运行时自带那个。沙箱里 `LOCALAPPDATA`
> 可能被改写导致推不出运行时路径，这时 `DSH_PYTHON` 是权威来源。

## 结构

| 文件 | 作用 |
|---|---|
| `testkit.mjs` | 共用：定位 skill 根（`import.meta.url`，不再硬编码绝对路径）、Python 探测、**按需生成 fixture**、起假 Chrome、断言器、跑 skill 脚本的子进程封装 |
| `fake-chrome.mjs` | 假 Chrome：`GET /json/list`、自实现 WebSocket 服务端（不依赖 `ws`）、最小 DOM shim（`vm`）、可控慢请求；开关：`--ads-page` / `--mask-ms` / `--table-rows` / `--render-all` / `--total-text` / `--mutate` / `--no-response` / `--cover`（最上层盖全屏遮罩，测遮挡）；另模拟 `elementFromPoint`（文档顺序最后一个包含该点的元素）、`focus` → `activeElement`、`Input.insertText` / 全选 + Backspace、`alert("…")` → `Page.javascriptDialogOpening` 并冻住求值直到 `handleJavaScriptDialog`，`__mouse` 记录收到的鼠标事件 |
| `run-*.mjs` | 各套件；用 `spawn` 把 **skill 脚本当子进程**跑，顺带验证 CLI 与退出码 |
| `fixtures/gen_fixtures.py` | 用 openpyxl 造 4145 行 xlsx/csv/json。**产物不进 skill**（跑时生成到临时目录），既是样本也是「export-lib 能解真实 openpyxl 产物」的交叉验证 |

## 已知边界（别把测试台的假象当脚本 bug）

- 🔴 **虚拟滚动逐屏路径测不了**：`vm` 沙箱里给元素 `defineProperty` 的 `scrollTop` 与循环里的 `await` 组合，会出现
  「第二拍仍读到上一拍的值」，使 `if (sc.scrollTop === y) break` 提前触发。判据：同一段循环**纯 Node 跑 12 拍、假页面只跑 2 拍**。
  滚动类改动一律以真机验证为准（`references/SCRIPTS.md` 坑 60）；`--render-all` 可绕开滚动，只测归位/去重/表头缓存。
- 假 DOM 不支持：真实布局、`getEventListeners`（clickables 在这里只按 tag 判定，listener 识别靠真机）、`checkVisibility`、CSS 计算样式（只支持 `display`/`overflowY`/`opacity`）；`elementFromPoint` 只是「矩形包含 + 文档顺序」的近似。
- 「连接前就开着的孤儿弹窗」只能真机测（真 Chrome 新连接收不到事件、关不掉，见 SCRIPTS 坑 62），本台子的弹窗只覆盖本连接内的情形。
- 选择器匹配只支持 `.cls` / `#id` / `tag` / 逗号 / `[class*=x]`。
- 这套台子**不碰真浏览器**：真机行为（页面结构变了没、点得中不中）仍需按 `SKILL.md` 流程实机验证。

## 加了新 L0/L1 脚本时

1. 优先在本目录加一个 `run-*.mjs` 套件（越接近真实调用越好：**用 `spawn` 跑脚本本体**，别直接 import 内部函数）；
2. 断言要能区分「通过 / 超时 / 静默返回」——本轮多数 bug 正是「静默返回了错的结果」；
3. 在 `references/SCRIPTS.md` 脚本表的「实测」列写一句「离线回归 N 例」；
4. 改了 `conn.mjs` / 等待逻辑 → **至少跑 `run-tests` + `run-wait-settle` + `run-l1`**。

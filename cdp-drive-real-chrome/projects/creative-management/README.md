# 页面级脚本：creative-management（本项目）—— 脚本怎么用

> 属于 skill 的 **L1 层**：只在 creative-management 项目 / 只有 Ads 页一类页面有效。
> 全局通用脚本在 `../../scripts/`，通用坑清单与 L0 脚本表在 `../../references/SCRIPTS.md`（唯一权威）。
>
> **分工**：本 README = **脚本怎么用**（参数、配方、操作坑）；同目录 [`PAGE-NOTES.md`](PAGE-NOTES.md) = **页面事实 / 数据口径 / 测试账号**。
> 两边不重复写：口径类结论只在 PAGE-NOTES，这里需要时留一行 🔴 提醒 + 链接。
>
> **为什么要单独放项目目录**：页面 DOM 结构（`.file-type-tab` / `.platform-tab__btn`）是本项目特有的，
> 换项目就失效。放进通用 `scripts/` 会污染别人。页面改版时**只改这里**。

## 目录

| 文件 | 用途 |
|---|---|
| **`PAGE-NOTES.md`** | 🔴 **先读**：本项目页面的事实、口径与坑（本地 dev 入口、`--` 三层原因、导出链路、测试数据窗口、默认测试账号、偏好存储 key …） |
| `run-page.mjs` | 执行器：把 `__X__` 占位符替换成实参后交给 CDP 跑 |
| `creative-ads-setup.js` | Ads 页布景：复位平台范围 → 切素材类型 → 切平台 → 点 Search |
| Ads 页列表 / KPI / 同环比一套 | 见下文「Ads 页列表 / KPI / 同环比脚本」 |
| `creativehub-*` | 图片 Creative 生成页一套（页面工具库 / 驱动库 / 出图关键帧 / 网络取证 / 文案对照 …），见下文「图片 Creative 生成页脚本」 |

## 上手

```bash
S=~/.claude/skills/cdp-drive-real-chrome/projects/creative-management   # 统一用 ~/.claude/skills（分发副本在别的 agent 目录，别混用）
export CDP_TARGET=<本组 targetId>          # 🔴 并行时必设；所有脚本都认（2026-10-13 起 run-page.mjs 也读它）

# 看某个页面脚本需要哪些参数
node "$S/run-page.mjs" "$S/creative-ads-setup.js" --list

# 切到 Video + Walmart 并等数据回来
node "$S/run-page.mjs" "$S/creative-ads-setup.js" \
  --param FILE_TYPE=Video --param PLATFORM=Walmart \
  --param DO_RELOAD=false --wait 20000 --out state.json
```

> `node` 不在 PATH 时用本机 node 绝对路径（2026-10-10 时为 `C:/Users/HaijunLing/.workbuddy/binaries/node/versions/22.22.2-6/node.exe`，版本升级后会变，以实际为准）。

**实测输出**（2026-10-10，client 777 实例）：

```jsonc
{
  "steps": ["file-type-already:Video", "platform-clicked:Walmart", "search-clicked"],
  "state": { "fileTypeTabs": ["Image","Video*","Logo"],
             "platformTabs": ["All","Amazon","Walmart*","Instacart","Tiktok"] },
  "firstCells": ["Asset - Ad Type - Ad","Platform","Campaign", ...]
}
```

`Walmart*` 单选、`All` 未高亮 ⇒ 没有多选累加；`firstCells` 是真实列名 ⇒ 列表已刷新。

参数值类型自动推断：`true/false` → 布尔，纯数字 → 数字，其它 → 字符串（执行器自动加单引号）。
`--wait` 特殊，直接映射到模板的 `__WAIT__`。键名 = 占位符去掉前后双下划线（`__FILE_TYPE__` → `--param FILE_TYPE=…`）。

## `creative-ads-setup.js` 内建解决的三个坑

1. **平台页签是多选累加器** —— 上个需求切过 Instacart，这个再点 Walmart 会得到两者混合列表。
   要「只选某平台」必须先 `DO_RELOAD=true` 复位。没有可靠的「清空多选」API（再点一次已选项
   可能是取消、也可能无效）→ **reload 是唯一确定的做法**，代价是丢筛选条件与列配置。
2. **切素材类型页签后平台页签会短暂只剩 All**（组件重建）→ 脚本轮询等它出现，不 sleep 死等。
3. **改页签后必须再点 Search** —— 高亮变了但列表数据还是上一次的，最容易误判。

## 返回值

```jsonc
{
  "steps": ["file-type-clicked:Video", "platform-clicked:Walmart", "search-clicked"],
  "state": { "fileTypeTabs": [...], "platformTabs": [...] },   // 谁高亮了
  "firstCells": ["...", "..."]                                  // 🔴 判定列表真刷新了看这个
}
```

⚠️ **`firstCells` 才是「列表真的刷新了」的判据**。只看 `state` 的高亮会踩坑 3。

## `run-page.mjs` 自己踩过的坑（已修，写在这里防止重犯）

- 占位符识别**不能全文 `match(/__X__/g)`** —— 说明文字里的示例会被误收。只在非注释行、且赋值右侧才认。
- 替换**必须跳过注释行**，否则说明文字里的 `__X__` 被替换成裸文本，整个表达式语法坏掉，
  且报错发生在页面里，定位成本极高。
- 残留占位符自检**也必须跳过注释行** —— 注释里本来就留着 `__X__` 说明，不是漏替换（本轮误报过一次）。
- `--param` 要遍历**所有**出现位置，遇到下一个 `--` 就 break 会导致只能传一个参数。
- `lit()` 用**单引号**包裹字符串值（含单引号才退回 `JSON.stringify`）。
- 2026-10-13：连接改走 L0 `conn.mjs`（读 `CDP_TARGET`；`--match` 默认 localhost，匹配不到报错，不再连第一个 page）；
  源码注释已与本节对齐（原注释把映射写成 `FT=` 、并声称模板写 `"__X__"`，都与实际行为相反）。

🔴 **代价是模板里占位符不能带引号**：写 `const FT = __FILE_TYPE__;`，
不要写 `const FT = "__FILE_TYPE__";`。
后者替换后会变成 `const FT = "'Video'";` —— 值多一层引号 ⇒ `tx(x) === FT` 恒为假
⇒ 轮询循环跑满 30×1s ⇒ 表现为 **`Runtime.evaluate` 超时**。
**真因（引号）与表象（超时）完全无关**，本轮排查了很久才定位。2026-10-13 起执行器遇到带引号的占位符会打 `WARN_QUOTED_PLACEHOLDER`。

- 页面内 `await sleep()` 若遇后台标签节流会像卡死 → 执行器已在同一连接开
  `Emulation.setFocusEmulationEnabled`。

## Ads 页列表 / KPI / 同环比脚本（2026-10-10 CP-57189 修复回路实测，最后验证 2026-10-10）

> 连接层统一用 L0 `../../scripts/conn.mjs`：**并行时每个分组设自己的 `CDP_TARGET=<targetId>`**（`../../scripts/tab-open.mjs --open` 开窗拿 id）。
> 2026-10-13 起 conn.mjs 默认每个 CDP 调用 ≤30s（原 60s）并带截图兜底；这些脚本的等待都在 Node 侧轮询，不受影响。子 agent 里跑仍按 SCRIPTS.md 坑 35 用 sconn 语义。
> `.js` 是页面表达式（用 L0 `ev.mjs --file <file>` 或 `cdp.mjs <file> --target <id>` 跑，或被 `.mjs` 读进去执行）；`.mjs` 是多步脚本。
> 读数前一律先 `ads-table-attach.js` 等价物（各 `.mjs` 内部已做），它把 `CreativeTable` 的 `setupState` 挂到 `window.__ct`。
> 🔴 口径（测试数据窗口、对比期 null、排序 null 位置、偏好 key …）在 [`PAGE-NOTES.md`](PAGE-NOTES.md)「Ads 页列表 / KPI / 同环比的口径与坑」，读数下结论前先看。

| 文件 | 干什么 | 关键参数 / 输出 |
|---|---|---|
| `ads-table-attach.js` | 找到 `CreativeTable` 实例，`window.__ct = setupState`（dataList / groupByValue / isShowAbbreviateNumbers） | 返回 true/false |
| `ads-state.js` | 当前日期、页签、KPI 卡片文本、可见表头、Total、偏好类 localStorage **key 名** | 判「真的切过去了」用；要排除另一个账号的 key 先 `window.__lsExcludeUid=<userId>`（原写死 2572，2026-10-13 参数化） |
| `kpi-wait.mjs` | 等 KPI 出数（Impressions 不再是 0） | 配合 L0 `wait-idle.mjs` |
| `kpi-add.mjs "<指标>"` | KPI「+」→ 池子真实点击 → Apply；输出前后卡片 + showList 落盘值 | AC「勾选 KPI / 个性化保留」；🔴 写持久化偏好 |
| `custom-columns-set.mjs <outDir> "Video:Views at 25%,6-second Views" "Traffic:PDPV Rate" [--prefix fix-r1-]` | 打开 Custom Columns → 按分类真实勾选（已勾跳过）→ Apply | 输出 `<prefix>cc-<分类>.png` / `<prefix>cc-log.json`（Selected 计数）；`--prefix` 默认 `fix-r1-`（CP-57189 第 1 轮修复回路的命名，见 PAGE-NOTES「需求临时备注」）；🔴 写持久化偏好 |
| `custom-columns-open.mjs Video <shot.png>` | 只打开弹框读某分类勾选态，不改任何东西 | 读完记得 Esc / Cancel |
| `custom-columns-state.js` | 弹框已开时读 Selected 行 + 可见复选框状态 | |
| `group-by.mjs "Asset - Ad"` | 真实点击切 Group by；**切完读 `__ct.groupByValue` 确认** | 选项：`Asset - Ad` / `Asset - Ad Type - Ad` / `Ad`（Video）；Image 多 `Asset Group - …`；🔴 写 Group by 记忆 |
| `date-range.mjs "06/01/2026~06/30/2026" out.json` | 日期框输入 → Apply → 等 loading 结束 → 记录请求体（start/endDate）与响应摘要 | 证明「按新周期取数」；不要把 `/dev/null` 当 out（SCRIPTS 坑 34） |
| `compare.mjs on <outDir> [--prefix fix-r1-]` | 日期面板真实勾 Compare → 截图面板 → Apply；记录 `compareStartDate/EndDate` 是 UI 下发的 | 🔴 别再用挂钩 XHR 改写请求体的老办法（构造）；旧命令 `compare-on.mjs <outDir>` 仍可用（转调） |
| `compare.mjs off` | 日期面板里取消 Compare → Apply → 等加载 | 🔴 Compare 复选框在 2560 视口下宽度 0（面板底栏被收起），开 / 关对比用 `CDP_VIEWPORT=wide`；旧命令 `compare-off.mjs` 仍可用 |
| `compare.mjs custom "06/01/2026~06/30/2026" [out.json]` | 面板已开且 Compare 已勾：对比区输入自定义对比期 → Enter → Apply；记录请求体 start/end/compareStart/compareEnd | 「上一周期」给不出的组合（例：05 当期 vs 06 对比取下降样本）；`CDP_VIEWPORT=wide`；旧命令 `compare-custom.mjs` 仍可用（2026-10-13 补登记） |
| `full-number-toggle.js` | 返回「缩写 / 完整数字」开关坐标（与 Group by 同一行、带 tooltip 的第一个图标） | 用 `click-js.mjs` 点；`__ct.isShowAbbreviateNumbers === true` 才是完整数字（命名反直觉，见 PAGE-NOTES） |
| `row-to-top.js` | `window.__rk=<key>` 后执行：虚拟行没渲染就逐步滚动找，再对齐到吸顶表头正下方 | 返回 `{after, hdrBottom}` |
| `row-expand.mjs k1 k2 …` | **幂等**展开（下一行已是子层级就跳过）；`COLLAPSE=1` 反向只收起 | 按顺序传：素材 key → Ad Type key |
| `hscroll.js` | 表格横向滚到最右（`window.__hx` 指定位置） | 🔴 用完 `delete window.__hx`，它会留在页面里影响下一次 |
| `cells.mjs out.json <parentKey> <kid1,kid2…> <col1,col2…>` | 父行 + 子行指定列的 DOM 文本 + 截图像素矩形（`P_<col>` / `K_<col>`） | 同时写 `out.rects.json` 给 L0 `annotate.py --rects`（2026-10-13 前写的是 `annotate-legend.py`，该脚本不合验收已 deprecated） |
| `col-rect.mjs out.json "lab=dataIndex\|表头文字[\|maxRows]"` | 整列（表头 + 可见单元格）外接框 | 表头文字按空白归一后精确匹配（「Video\nViews」能匹配） |
| `compare-cell.js` | `window.__rk/__cols` 后执行：环比单元格的「数值 / 变化率 / 颜色 class」 | `colorGreen` / `colorRed` / 灰色 `--` 占位 |
| `compare-check.js` | 叶子行 `comparePerformance[m]` 与 `(当期−对比期)/对比期×100` 逐行反算 | `window.__metrics` 指定指标 |
| `model-group.mjs --key N` | 导出一个顶层分组行 + 子 / 孙行原始数值（例 `--key 7`） | 给 `groupby-model-check.py` |
| `groupby-model-check.py model.json` | 13 个可加列 父=Σ子；比率 Σ/Σ vs 子行均值；单价 Σ花费/Σ播放 | 末行 `DIFF count = 0` |
| `groupby-dom-check.py dom.json` | 同上，但用页面展示值（完整数字模式）独立复核 | |
| `nav.mjs <url>` / `click-js.mjs <page.js>` | 导航 / 执行返回 `{x,y}` 的页面脚本后真鼠标点击 | `nav.mjs` 不给 url 是空操作（别漏参数）；三种真点击怎么选见 SCRIPTS.md |
| `sort-check.mjs "<表头>" <dataIndex> out.json` | 点一次表头 → 等**这一次**带 orderBy 的列表响应 → 响应 / 模型 / 页面三方比对 + 单调性 + null 位置 | AC「新增列排序 / 空值规则」；🔴 排序只有降 ⇄ 升两态、先读 `data-sorttype`（PAGE-NOTES） |
| `ads-search.mjs "<关键字>"` | 搜索框输入 → Search → 等加载；空串 = 清空 | 定位某条 Ad / Creative |
| `drawer-from-ads.mjs <rowKey> out.json "Ad,Video Views,…"` | 素材行「Asset Detail」→ 抽屉 Ad Performance（已开则复用、按 `.el-tabs__item.is-active` 判页签）→ 横滚到右 → 读指定列 + 矩形 `D_<列>` | 抽屉与 Library / Dashboard 同组件；同屏对照 Ads vs 抽屉 |
| `header-rects.mjs out.json "lab=表头1,表头2"` | 表头按文字导出外接框 + 可见表头全集 + missing | Tag / Ads 表头证据图（missing 非空别出图） |
| `esc.mjs` | 按一次 Escape，报告抽屉是否还开着 | 关抽屉 / 下拉 |
| `file-type-tab.js` | `window.__ft='Video'` 后返回素材类型页签坐标（Ads / Tag 通用） | 配 `click-js.mjs` |
| `ads-export-btn.js` | Ads 列表工具栏导出图标坐标（排除顶栏下载中心） | 配 L0 `export-target.mjs` |
| `ads-state-rects.js` | Ads 页状态证据的框坐标（页签 / Group by / 日期 / Total）+ `loading` 遮罩数 | `loading>0` 别截图；输出喂 L0 `annotate.py --rects` |
| `ads-page-rows.js` | 当前页行（creativeId / 类型 / 名称 / 商品字段），需先 `ads-table-attach.js` | 含客户名称，交给 `export-page-crosscheck.py` 只留哈希 |
| `drawer-adperf-row-rects.js` | 抽屉 Ad Performance 逐行「Asset - Ad」格 + Ad Type 格框坐标（SB / SD / Streaming TV） | 表格是 div 布局；截图前后各跑一次 `cmp` |
| `xhr-rows-capture.js` / `xhr-rows-dump.js` | 只读拦截 `/creative-local/*` 列表响应 → `__caps`；dump 最后一次（`window.__capName` 选接口） | 整页刷新后要重装 capture |
| `export-parse.py <xlsx> <前缀>` | 导出文件去标识化逐行解析（类型 / `ID:` 行 / `Creative` / 文字哈希 / 每列图片数）+ summary | `python -I`；真实客户文件删前必跑 |
| `export-page-crosscheck.py <页面行 raw> <rows.csv> <out.json>` | 页面行按 `AdDimensionText` 规则算期望哈希，在导出同类型行里查 | 排序不同，按哈希集合匹配 |

（2026-10-13：原表 `kpi-add.mjs` / `model-group.mjs` 各登记了两行，已合并为一行，内容取并集。）

**Tag 页（2026-10-10 g3 实测）**：导出图标 `i.el-icon.ml-4.cursor-pointer`（「Only show tags with Impr.」右侧）；子标签行 key 与父行不连续、没有「全部展开」，只能逐个展开；18 个新增列横跨约 4,900px，`CDP_VIEWPORT=5300x1300@1` + 横滚 1000 可一屏看全；Tag 页 null 渲染已在 10-10 修为 `--`（`TagManagement/index.vue` + `videoMetrics.js#isMissingNewMetric`）。

### 配方：一条 AC 一次跑完（照抄顺序）

```bash
S=~/.claude/skills/cdp-drive-real-chrome; P=$S/projects/creative-management; export CDP_TARGET=<本组 targetId>
node $S/scripts/wait-idle.mjs                                   # 列表 20~40s 才回来，先等
node $P/group-by.mjs "Asset - Ad" && node $S/scripts/wait-idle.mjs
node $P/row-expand.mjs 7                                        # 幂等
node $P/click-js.mjs $P/full-number-toggle.js                   # 对账必须完整数字（缩写 471.2K 会误判 DIFF）；点完读 __ct.isShowAbbreviateNumbers
node $P/cells.mjs ev/dom.json 7 666,667,668 name,videoViews,videoFirstQuartileViews   # 同帧：文本 + 矩形
node $S/scripts/shot.mjs ev/raw.png                                                   # 截图（与 rects 同状态，中间别滚动）
node $P/cells.mjs ev/dom-after.json 7 666,667,668 name,videoViews,videoFirstQuartileViews  # 截图后再导一次；cmp ev/dom.rects.json ev/dom-after.rects.json 一致才用
PYTHONIOENCODING=utf-8 python $S/scripts/annotate.py ev/raw.png ev/AC-NN-01-<中文判定点>-标注.png --crop "x,y,w,h" --title "标题" \
  --rects ev/dom.rects.json --mark "P_videoViews=…" --mark "K_videoViews=…"
# 旧写法仍可用：python $S/scripts/annotate-rects.py ev/raw.png ev/dom.rects.json ev/AC-NN-01-<中文判定点>-标注.png "x0,y0,x1,y1" "标题" "P_videoViews=…"
```

🔴 证据路径一律写**绝对路径**（见下方坑 15）；出图后打开看（SCRIPTS 坑 16b）。

### 本页实测的操作坑（2026-10-10）

> 编号沿用原表（稳定 ID）。数据口径类（原 6、8~14、12）已迁到 [`PAGE-NOTES.md`](PAGE-NOTES.md)「Ads 页列表 / KPI / 同环比的口径与坑」，这里只留一行提醒。

1. **Ads 列表接口 20~45s**，切日期 / 分组 / 对比后先 `wait-idle.mjs` 再读；遮罩类是 `.pacvue-loading-mask`。
2. **表格滚动容器是 `.surely-table-body`，不是 document** —— `window.scrollTo` / `scrollingElement.scrollTop` 不动行；行对齐到视口顶部会被**吸顶表头盖住**，点击落到表头上（实测展开箭头点了没反应）→ 用 `row-to-top.js` 对齐到表头下方。
3. **展开状态跨分组切换保留**：盲点展开箭头会把已展开的收起（实测一次把 key 15 收了）→ 只用幂等的 `row-expand.mjs`。
4. **有 100+ 子行的素材（如 key 0/1，183/161 个 Ad）一展开就把目标行挤出虚拟渲染区** → 先 `COLLAPSE=1 row-expand.mjs 0 1 …` 再展开目标。
5. **Video 列在默认视口右侧外**（24+ 列），要么 `hscroll.js`，要么 `CDP_VIEWPORT=wide`（3600 宽，Platform / Ad Type 与视频列同屏）。
   🔴 宽视口下**弹出层（Group by 下拉、日期面板）位置会算错**（三个选项叠在同一坐标），切分组 / 日期必须在正常视口做，再回宽视口截图。
6. 🔴 Ad Type 分组下 `adType` 列被隐藏 → **标注时框 `name`（Dimension）列**（口径全文见 PAGE-NOTES）。
7. **工具栏图标别用全局选择器找**：`.el-icon.cursor-pointer.el-tooltip__trigger` 第一个是**顶栏的下载中心**，点了会跳到 `/crossretailer/Download`（实测）→ 限定与 Group by 同一行。
8. 🔴 开启对比后数值不吃「完整数字」开关、对比期 null 显示灰色 `--` 占位 → 对账前看 PAGE-NOTES 再判。
9. （见 8，口径已迁 PAGE-NOTES）
10. 🔴 **视频指标只在固定数据窗口有值**（client 62 只有 2026-05 / 06）→ 开测前按 PAGE-NOTES「测试数据窗口」选日期。
11. 🔴 「真实为 0 显示 0」别拿 6 月 TikTok GMV Max 行做样本（PAGE-NOTES）。
12. （Custom Columns 弹框勾选初值的修复记录已迁 PAGE-NOTES）
13. 🔴 **表头排序只有降 ⇄ 升两态**，拍哪个方向先读 `data-sorttype`，别按点击次数猜 → 用 `sort-check.mjs`（全文见 PAGE-NOTES）。
14. 🔴 **素材行 / Ad 行与 Ad Type 中间行的 null 排序位置不一致** → 以 `sort-check.mjs` 实测为准（全文见 PAGE-NOTES）。
15. **脚本里的证据路径一律写绝对路径**：Bash 工具的当前目录会跟着上一条命令漂移（实测 `tests/AC-01/tests/AC-26/...` 写不进去，点击却已经发生 —— 状态变了证据没留下）。

## 图片 Creative 生成页脚本（`creativehub-*`，CP-58118 入库，最后验证 2026-10-13）

> 页面：Creative Generation / Image Generation（UrlToImage、Product to Creative、Creative Generation 抽屉）。口径与坑见 `PAGE-NOTES.md`「图片 Creative 生成页」。
> 连接层一律 L0 `../../scripts/sconn.mjs`（= conn.mjs hardCap：≤30s 超时；截图不抢前台，兜底顺序见 SCRIPTS 坑 50）；每组设自己的 `CDP_TARGET`；开测先 `../../scripts/chk401.mjs --match creative-local`。
> 🔴 会点 Generate 的脚本（`creativehub-gen-run.mjs`、不带 `DRY=1` 的 `creativehub-fields-compare.mjs`）= 写操作，每次运行前单独取得用户授权。
> 🔴 CP-58118 期间后端出图是写死的 mock（上线前删，见 PAGE-NOTES「需求临时备注」）—— mock 删除后 `creativehub-fields-compare.mjs` 要设 `EVIDENCE_TYPE`，别让「mock 出图」的说明进证据。

| 文件 | 干什么 | 用法 / 输出 |
|---|---|---|
| `wait-lib.mjs` | 🔴 **本项目「等 loading 遮罩消失」的唯一写法**：`makeBusyGone(c, {sel,overlay,key})` 造等待表达式，`waitBusyGone(c, expr, {total,minTicks,label})` 等它消失；**超时抛错并带 polls/elapsed**（旧手写 `for(k<180){sleep(1000)}` 超时后会静默继续，后面全读中间态） | `import { makeBusyGone, waitBusyGone } from "./wait-lib.mjs"`；已接入 9 个脚本（ads-search / group-by / date-range / compare / sort-check / kpi-wait / drawer-from-ads / creativehub-*） |
| `creativehub-lib.js` | 页面工具库：只读网络钩子（`__aiLog`）、`__g1.state()` 读宿主状态（含选品 `imgUrl`）、`__g1.rects()` 判定点几何（含来源图 / 参考图区）、`rec()` / `s97()` 只读采样、弹窗记录 | `ev.mjs --file creativehub-lib.js`；入库时修了 Lifestyle 子串误中、`imgUrl`、参考图区 |
| `creativehub-find.js` + `creativehub-state.js` | 递归 Vue 树找图片生成宿主（`window.__u2i`）→ 读摘要（Ad Type / Result type / PD / 卖点 / Prompt / 参考图 / canGenerate） | 被 `creativehub-drive.mjs` 的 `c.state()` 调用 |
| `creativehub-drive.mjs` | 多步驱动库：`clickEl` / `hoverEl`（落点核对）、`frame`（同帧截图 + 两份 rects）、`netStart`、`tooltips`、`typePrompt`、常用元素表达式 `R`、`pickAdType`（搜索选叶子） | `import { open, R, pickAdType } from ...`；`evDir()` 需 `REQ_DIR` |
| `creativehub-ref-from-library.mjs` | Reference 区从 Library 选 1 张已上传素材（不上传、不写 Library），读回 `referenceImagePaths` | `addRefFromLibrary(c, log, sleep)`；需先注入 lib |
| `creativehub-gen-run.mjs` (+ `-gen-sampler.js` / `-gen-rects.js`) | 点一次 Generate，关键帧 F1 首帧 / F2 运行中 / F3 100% 停留 / F4 成品，100ms 采样（百分比序列、单调性、100% 停留样本数） | `node creativehub-gen-run.mjs <outDir> <prefix> [drawer]` |
| `creativehub-netcap.mjs` | 后台网络取证（async / ai-task / generation-log 请求体与响应体原文，不含请求头）；`--logdetail` 结束时按 jobId 只读查 generation-log（先页面内无头直发，401/403 才复用内存里的页面请求头，产出写 `authVia`） | `node creativehub-netcap.mjs <outDir> <prefix> [--logdetail] [--max 600]`，touch `<outDir>/STOP` 结束；`--max` 秒到点或 Ctrl+C 也正常收尾 |
| `creativehub-fields-compare.mjs` | Prompt 回填 vs AI 段落逐行对照；可选出图后对照 AI 文案（Headline / CTA / Brand / Logo）与 Creative 卡面 | 环境变量 `OUT_DIR PRODUCT ADTYPE_SEARCH ADTYPE_LEAF [ADTYPE_KEY RESULT_TYPE PREFIX DRY LOGDETAIL EVIDENCE_TYPE]` |
| `creativehub-mount-demo.js` | 把仓内 `__demo__/*.vue` 只在页面内存挂载（验证组件被引用时的行为） | `run-page.mjs creativehub-mount-demo.js --param DEMO_FS=/@fs/...`；属构造入口，证据标「构造（内存挂载）」 |

## 何时该新增而不是改现有的

| 场景 | 做法 |
|---|---|
| 同一个页面的另一种布景组合 | 加参数，不要复制文件 |
| 另一个页面（Tag / 抽屉 / Library） | 新建 `xxx-page.js`，共用 `run-page.mjs` |
| 操作要用真鼠标事件而非 JS click | 用 `../../scripts/real-click.mjs`，别在这里重写 CDP 层 |
| 同类操作的另一个模式（如 Compare 开 / 关 / 自定义） | 合进同一脚本加子命令（`compare.mjs on|off|custom`），旧文件名留一行转调 |

## 页面改版了怎么办

1. 直接跑一次，报错就说明选择器变了（脚本是「命中不到就报错」，不会静默产出错误数据）
2. 改本目录对应文件的 CSS 选择器
3. 更新本 README 与 `references/SCRIPTS.md` 里的相关坑；页面事实变了改 `PAGE-NOTES.md` 并刷日期
4. **不要把选择器抽到通用 `scripts/`** —— 那是跨项目的，泄漏项目细节

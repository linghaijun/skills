# 页面级脚本：creative-management（本项目）

> 属于 skill 的 **L1 层**：只在 creative-management 项目 / 只有 Ads 页一类页面有效。
> 全局通用脚本在 `../../scripts/`，通用坑清单在 `../../references/SCRIPTS.md`。
>
> **为什么要单独放项目目录**：页面 DOM 结构（`.file-type-tab` / `.platform-tab__btn`）是本项目特有的，
> 换项目就失效。放进通用 `scripts/` 会污染别人。页面改版时**只改这里**。

## 目录

| 文件 | 用途 |
|---|---|
| **`PAGE-NOTES.md`** | 🔴 **先读**：本项目页面的事实、口径与坑（本地 dev 入口、`--` 三层原因、导出链路、测试数据窗口、偏好存储 key …） |
| `run-page.mjs` | 执行器：把 `__X__` 占位符替换成实参后交给 CDP 跑 |
| `creative-ads-setup.js` | Ads 页布景：复位平台范围 → 切素材类型 → 切平台 → 点 Search |

## 上手

```bash
N="C:/Users/HaijunLing/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"
S=~/.agents/skills/cdp-drive-real-chrome/projects/creative-management

# 看某个页面脚本需要哪些参数
"$N" "$S/run-page.mjs" "$S/creative-ads-setup.js" --list

# 切到 Video + Walmart 并等数据回来
"$N" "$S/run-page.mjs" "$S/creative-ads-setup.js" \
  --param FILE_TYPE=Video --param PLATFORM=Walmart \
  --param DO_RELOAD=false --wait 20000 --out state.json
```

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

参数值类型自动推断：`true/false` → 布尔，纯数字 → 数字，其它 → 字符串。
`--wait` 特殊，直接映射到模板的 `__WAIT__`。

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

🔴 **代价是模板里占位符不能带引号**：写 `const FT = __FILE_TYPE__;`，
不要写 `const FT = "__FILE_TYPE__";`。
后者替换后会变成 `const FT = "'Video'";` —— 值多一层引号 ⇒ `tx(x) === FT` 恒为假
⇒ 轮询循环跑满 30×1s ⇒ 表现为 **`Runtime.evaluate` 超时**。
**真因（引号）与表象（超时）完全无关**，本轮排查了很久才定位。

- 页面内 `await sleep()` 若遇后台标签节流会像卡死 → 执行器已在同一连接开
  `Emulation.setFocusEmulationEnabled`。

## Ads 页列表 / KPI / 同环比脚本（2026-10-10 CP-57189 修复回路实测，最后验证 2026-10-10）

> 连接层统一用 L0 `../../scripts/conn.mjs`：**并行时每个分组设自己的 `CDP_TARGET=<targetId>`**（`../../scripts/tab-open.mjs --open` 开窗拿 id）。
> `.js` 是页面表达式（用 L0 `cdp.mjs <file> --target <id>` 跑，或被 `.mjs` 读进去执行）；`.mjs` 是多步脚本。
> 读数前一律先 `node ads-table-attach.js` 等价物（各 `.mjs` 内部已做），它把 `CreativeTable` 的 `setupState` 挂到 `window.__ct`。

| 文件 | 干什么 | 关键参数 / 输出 |
|---|---|---|
| `ads-table-attach.js` | 找到 `CreativeTable` 实例，`window.__ct = setupState`（dataList / groupByValue / isShowAbbreviateNumbers） | 返回 true/false |
| `ads-state.js` | 当前日期、页签、KPI 卡片文本、可见表头、localStorage 偏好 key | 判「真的切过去了」用 |
| `kpi-wait.mjs` | 等 KPI 出数（Impressions 不再是 0） | 配合 L0 `wait-idle.mjs` |
| `kpi-add.mjs "Views at 25%"` | 「+」→ 池子真实点击 → Apply；输出前后卡片 + showList 落盘值 | AC「勾选 KPI / 个性化保留」 |
| `custom-columns-set.mjs <outDir> "Video:Views at 25%,6-second Views" "Traffic:PDPV Rate"` | 打开 Custom Columns → 按分类真实勾选（已勾跳过）→ Apply | 输出 `fix-r1-cc-log.json`（Selected 计数） |
| `custom-columns-open.mjs Video <shot.png>` | 只打开弹框读某分类勾选态，不改任何东西 | 读完记得 Esc / Cancel |
| `custom-columns-state.js` | 弹框已开时读 Selected 行 + 可见复选框状态 | |
| `group-by.mjs "Asset - Ad"` | 真实点击切 Group by；**切完读 `__ct.groupByValue` 确认** | 选项：`Asset - Ad` / `Asset - Ad Type - Ad` / `Ad`（Video）；Image 多 `Asset Group - …` |
| `date-range.mjs "06/01/2026~06/30/2026" out.json` | 日期框输入 → Apply → 等 loading 结束 → 记录请求体（start/endDate）与响应摘要 | 证明「按新周期取数」 |
| `compare-on.mjs <outDir>` | 日期面板真实勾 Compare → Apply；记录 `compareStartDate/EndDate` 是 UI 下发的 | 🔴 别再用挂钩 XHR 改写请求体的老办法（构造） |
| `full-number-toggle.js` | 返回「缩写 / 完整数字」开关坐标（与 Group by 同一行、带 tooltip 的第一个图标） | 用 `click-js.mjs` 点；`__ct.isShowAbbreviateNumbers === true` 才是完整数字 |
| `row-to-top.js` | `window.__rk=<key>` 后执行：虚拟行没渲染就逐步滚动找，再对齐到吸顶表头正下方 | 返回 `{after, hdrBottom}` |
| `row-expand.mjs k1 k2 …` | **幂等**展开（下一行已是子层级就跳过）；`COLLAPSE=1` 反向只收起 | 按顺序传：素材 key → Ad Type key |
| `hscroll.js` | 表格横向滚到最右（`window.__hx` 指定位置） | 🔴 用完 `delete window.__hx`，它会留在页面里影响下一次 |
| `cells.mjs out.json <parentKey> <kid1,kid2…> <col1,col2…>` | 父行 + 子行指定列的 DOM 文本 + 截图像素矩形（`P_<col>` / `K_<col>`） | 同时写 `out.rects.json` 给 L0 `annotate-legend.py` |
| `col-rect.mjs out.json "lab=dataIndex\|表头文字[\|maxRows]"` | 整列（表头 + 可见单元格）外接框 | 表头文字按空白归一后精确匹配（「Video\nViews」能匹配） |
| `compare-cell.js` | `window.__rk/__cols` 后执行：环比单元格的「数值 / 变化率 / 颜色 class」 | `colorGreen` / `colorRed` / 灰色 `--` 占位 |
| `compare-check.js` | 叶子行 `comparePerformance[m]` 与 `(当期−对比期)/对比期×100` 逐行反算 | `window.__metrics` 指定指标 |
| `model-group.mjs --key 7` | 导出一个顶层分组行 + 子 / 孙行原始数值 | 给 `groupby-model-check.py` |
| `groupby-model-check.py model.json` | 13 个可加列 父=Σ子；比率 Σ/Σ vs 子行均值；单价 Σ花费/Σ播放 | 末行 `DIFF count = 0` |
| `groupby-dom-check.py dom.json` | 同上，但用页面展示值（完整数字模式）独立复核 | |
| `nav.mjs <url>` / `click-js.mjs <page.js>` | 导航 / 执行返回 `{x,y}` 的页面脚本后真鼠标点击 | `nav.mjs` 不给 url 是空操作（别漏参数） |
| `sort-check.mjs "<表头>" <dataIndex> out.json` | 点一次表头 → 等**这一次**带 orderBy 的列表响应 → 响应 / 模型 / 页面三方比对 + 单调性 + null 位置 | AC「新增列排序 / 空值规则」 |
| `ads-search.mjs "<关键字>"` | 搜索框输入 → Search → 等加载；空串 = 清空 | 定位某条 Ad / Creative |
| `drawer-from-ads.mjs <rowKey> out.json "Ad,Video Views,…"` | 素材行「Asset Detail」→ 抽屉 Ad Performance（已开则复用、按 `.el-tabs__item.is-active` 判页签）→ 横滚到右 → 读指定列 + 矩形 `D_<列>` | 抽屉与 Library / Dashboard 同组件；同屏对照 Ads vs 抽屉 |
| `compare-off.mjs` | 日期面板里取消 Compare → Apply → 等加载 | 🔴 Compare 复选框在 2560 视口下宽度 0（面板底栏被收起），开 / 关对比用 `CDP_VIEWPORT=wide` |
| `header-rects.mjs out.json "lab=表头1,表头2"` | 表头按文字导出外接框 + 可见表头全集 + missing | Tag / Ads 表头证据图（missing 非空别出图） |
| `esc.mjs` | 按一次 Escape，报告抽屉是否还开着 | 关抽屉 / 下拉 |
| `file-type-tab.js` | `window.__ft='Video'` 后返回素材类型页签坐标（Ads / Tag 通用） | 配 `click-js.mjs` |
| `ads-export-btn.js` | Ads 列表工具栏导出图标坐标（排除顶栏下载中心） | 配 L0 `export-target.mjs` |
| `ads-state-rects.js` | Ads 页状态证据的框坐标（页签 / Group by / 日期 / Total）+ `loading` 遮罩数 | `loading>0` 别截图；输出喂 L0 `annotate-rects.py` |
| `ads-page-rows.js` | 当前页行（creativeId / 类型 / 名称 / 商品字段），需先 `ads-table-attach.js` | 含客户名称，交给 `export-page-crosscheck.py` 只留哈希 |
| `drawer-adperf-row-rects.js` | 抽屉 Ad Performance 逐行「Asset - Ad」格 + Ad Type 格框坐标（SB / SD / Streaming TV） | 表格是 div 布局；截图前后各跑一次 `cmp` |
| `xhr-rows-capture.js` / `xhr-rows-dump.js` | 只读拦截 `/creative-local/*` 列表响应 → `__caps`；dump 最后一次（`window.__capName` 选接口） | 整页刷新后要重装 capture |
| `export-parse.py <xlsx> <前缀>` | 导出文件去标识化逐行解析（类型 / `ID:` 行 / `Creative` / 文字哈希 / 每列图片数）+ summary | `python -I`；真实客户文件删前必跑 |
| `export-page-crosscheck.py <页面行 raw> <rows.csv> <out.json>` | 页面行按 `AdDimensionText` 规则算期望哈希，在导出同类型行里查 | 排序不同，按哈希集合匹配 |
| `kpi-add.mjs "<指标>"` | KPI「+」→ 池子真实点击 → Apply；输出前后卡片与 showList | |
| `model-group.mjs --key N` | 导出顶层分组行 + 子 / 孙行原始数值 | 给 `groupby-model-check.py` |

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
PYTHONIOENCODING=utf-8 python $S/scripts/annotate-rects.py ev/raw.png ev/dom.rects.json ev/AC-NN-annotated.png "x0,y0,x1,y1" "标题" "P_videoViews=…" "K_videoViews=…"
```

### 本页实测的坑（2026-10-10）

1. **Ads 列表接口 20~45s**，切日期 / 分组 / 对比后先 `wait-idle.mjs` 再读；遮罩类是 `.pacvue-loading-mask`。
2. **表格滚动容器是 `.surely-table-body`，不是 document** —— `window.scrollTo` / `scrollingElement.scrollTop` 不动行；行对齐到视口顶部会被**吸顶表头盖住**，点击落到表头上（实测展开箭头点了没反应）→ 用 `row-to-top.js` 对齐到表头下方。
3. **展开状态跨分组切换保留**：盲点展开箭头会把已展开的收起（实测一次把 key 15 收了）→ 只用幂等的 `row-expand.mjs`。
4. **有 100+ 子行的素材（如 key 0/1，183/161 个 Ad）一展开就把目标行挤出虚拟渲染区** → 先 `COLLAPSE=1 row-expand.mjs 0 1 …` 再展开目标。
5. **Video 列在默认视口右侧外**（24+ 列），要么 `hscroll.js`，要么 `CDP_VIEWPORT=wide`（3600 宽，Platform / Ad Type 与视频列同屏）。
   🔴 宽视口下**弹出层（Group by 下拉、日期面板）位置会算错**（三个选项叠在同一坐标），切分组 / 日期必须在正常视口做，再回宽视口截图。
6. **Ad Type 分组下 `adType` 列被隐藏**，类型名在 Dimension（`name`）列里 —— 标注时框 `name`。
7. **工具栏图标别用全局选择器找**：`.el-icon.cursor-pointer.el-tooltip__trigger` 第一个是**顶栏的下载中心**，点了会跳到 `/crossretailer/Download`（实测）→ 限定与 Group by 同一行。
8. **开启对比后 `CompareChange` 不吃「完整数字」开关**（数值仍缩写，存量行为），对账数值用模型或关掉对比读。
9. **对比期为 null 的列**：数值 `--`，下方是 `CompareChange` 既有的灰色 `--` 占位（`<div v-else>--</div>`）—— 不是变化率，AC「不展示变化率」据此判定成立，RESULT 要写明。
10. **client 62 视频数据只有 2026-05 / 06**（10-09 被同步侧回刷，07 起视频播放全 0）；06 vs 05 的对比**全部上涨**，要「下降」样本用 PDPV（GMV Max 行）或换 07 vs 06。
11. **6 月 vv=0 的 TikTok 行全是 GMV Max**（规格应为 NULL，属数据侧问题）→ 证明「真实为 0 显示 0」别用它，用 Amazon SB-Video 的 Views at 25%（有播放、分位为 0）。
13. **表头排序只在「降序 ⇄ 升序」两态间切换，没有「取消排序」**：第 1 次点 = 降序（`data-sorttype=2`），第 2 次 = 升序（1），第 3 次又回到降序。要拍哪个方向先读 `data-sorttype`，别按点击次数猜（实测一次把升序图标成了降序）。用 `sort-check.mjs`，它会等**这一次**的响应再读并三方比对。
14. **素材行 / Ad 行由 CK 排序：升序、降序 null 都在最后**；Ad Type 中间行由 Java `CreativeGroupByAggregator#buildAdTypeParentRows` 排序（`nullsFirst` + 整体 `reversed()` ⇒ 升序 null 在最前）——两层规则不一致，以实测为准。
15. **脚本里的证据路径一律写绝对路径**：Bash 工具的当前目录会跟着上一条命令漂移（实测 `tests/AC-01/tests/AC-26/...` 写不进去，点击却已经发生 —— 状态变了证据没留下）。
12. **Custom Columns 弹框勾选初值**：2026-10-10 前弹框按默认集初始化、与表格不一致（再 Apply 会丢列），已修（`CreativeCustomColumn.vue#initialCheckedDataIndexes`）。抽屉 `PerfCustomColumn.vue` 仍是旧行为。

## 何时该新增而不是改现有的

| 场景 | 做法 |
|---|---|
| 同一个页面的另一种布景组合 | 加参数，不要复制文件 |
| 另一个页面（Tag / 抽屉 / Library） | 新建 `xxx-page.js`，共用 `run-page.mjs` |
| 操作要用真鼠标事件而非 JS click | 用 `../../scripts/real-click.mjs`，别在这里重写 CDP 层 |

## 页面改版了怎么办

1. 直接跑一次，报错就说明选择器变了（脚本是「命中不到就报错」，不会静默产出错误数据）
2. 改本目录对应文件的 CSS 选择器
3. 更新本 README 与 `references/SCRIPTS.md` 里的相关坑
4. **不要把选择器抽到通用 `scripts/`** —— 那是跨项目的，泄漏项目细节
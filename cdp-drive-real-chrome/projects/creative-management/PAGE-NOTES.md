# creative-management 页面口径与坑（PAGE-NOTES）

> 属于 cdp skill 的 **L1 页面级**：本项目 Creative Hub 页面在本地 dev 环境实测得到的**事实、口径与坑**。
> 操作脚本见同目录 `README.md`；通用方法与坑清单见 `../../references/SCRIPTS.md`。
> **操作浏览器前与 README 一起读**。走不通先怀疑这里过期，当场改并刷新日期。
>
> 2026-10-10 由项目仓 `.agents/browser-verification.md` 迁入（用户要求不放 git 管理）。

适用：在浏览器里跑 Creative Hub 页面做取证 / 取基线 / 复现问题（全栈工作流 Step 11.4、回归基线采集）。
只记**本仓库 + 本地 dev 环境实测踩过的坑**，通用浏览器常识不写。

## 本地 dev 环境

| 项 | 值 |
|---|---|
| 入口 | `http://localhost:3001/crossretailer/CreativeManagement/{Dashboard\|Creative\|TagManagement\|Asset}` |
| 接口前缀 | `/creative-local/`（Vite 代理到后端，不是 `VITE_APP_CREATIVE_MANAGEMENT_URL` 的线上域名） |
| 登录 | Agent 的内置浏览器与用户 Chrome **会话隔离**，没有登录态。必须由**用户本人**在浏览器面板里登录，禁止 agent 代输凭据 |
| 未登录表现 | URL 被重写成 `http://localhost:3001`（路径丢失），页面停在加载动画，网络请求**全是 Vite 模块加载、零个后端 API** —— 看到这个形态就是没登录，别再等了 |

## CRITICAL：不要只看 DOM 判断「没数据」

**实测翻车**：把日期设成某个月后，等了 18 秒，KPI 卡片全 0、列表显示 `No data found!`，据此判定该月无数据 —— **结论是错的**，接口还在路上，再等一会儿数据就出来了。

规则：
- 判定「有无数据」**必须看 XHR 响应体**，不能只看 DOM：`read_network_requests` 找到对应请求 → 带 `requestId` 再读一次拿 body
- 本地 dev + CK 大范围查询，**列表接口 20~40 秒才回是常态**，导出接口可到 40 秒以上
- 请求列表里**没有状态码**（如只有 `POST …/getCollectionCreativeList`，后面没有 `→ 200 OK`）= 仍在 pending，继续等

## 浏览器面板的宽度坑

- 面板可视宽度约 **570px**，Creative Hub 页面按宽屏设计，**右侧工具栏（自定义列、导出图标）默认在可视区外**
- 找不到某个按钮时先 `scroll` 方向 `right`，不要以为按钮不存在
- `resize_window` 设 1280 / 1440 宽会被缩放塞进面板，**截图变得几乎不可读**；此时改用 `read_page` / `find` / `get_page_text` 定位，截图只用于最后留证
- 定位元素优先 `find` 拿 `ref_N`，比坐标稳（页面横向滚动后坐标会失效）

## 日期范围控件

- **首选**：日期条左右两侧的 `<` / `>` 箭头按**当前周期步进**（当前是整月就按月退），一次点击即生效，最省事
- 内置浏览器往 `Start Date ~ End Date` 输入框里 `type` 一个 `MM/DD/YYYY ~ MM/DD/YYYY` 再点 Apply **不生效**（已实测）；
  **CDP 下 `Input.insertText` + Enter + 点 Apply 生效**（`date-range.mjs`，2026-10-10 实测，会同时记录请求体里的 start/endDate）
- `Custom Range` 的日历弹层在窄面板下会渲染到可视区外，难点中
- 切页签（Ads / Tag / Library）**日期会保留**，不用每页重设

## Library 素材卡片

- 点卡片的**图片区**打开的是图片预览灯箱，**不是**详情抽屉
- Ad Performance tab 只对 `Distributed > 0` 的素材有意义；`Distributed 0` 的素材即使打开抽屉该 tab 也可能无数据，取证前先挑一个已分发的素材

## Ad Performance / Creative Analysis（CP-57189，2026-10-09）

- **详情接口**：`getCreativeAssetDetail` 的绩效在 `data.assets[]`（或成员行上的绩效字段）；`data.appliedCreatives[]` 只有投放关系、**没有**绩效数字 —— 别拿后者对账
- **Metrics 下拉很长**（约 42 项，含 18 个 Video/PDPV）：弹层可滚（`scrollHeight` ≫ `clientHeight`）。截「PDPV / Cost Per *」块时要对下拉 body `scrollTop` / `scrollIntoView`，不要只截首屏
- **判据源**：`PacvueSelect` 的选项以 Vue `chartOptions` / `chartOptionsForTab` 为准；DOM `missingDom` 全空时仍可能 Vue `vueMissing=[]`（teleport/虚拟列表）。RESULT 写清用的是哪一侧
- **Creative Analysis**（Ads Video → 行 → Analysis）：`PerformanceLineChart` 的 Metric 选择器 `:maxLimit="3"`。
  🔴 **`pacvue-chart` 遇到「最后一条 series 全 null」会把每个点改成 `y: 0`**（`@pacvue/element-plus` dist `pacvue-element-plus.es.js` 中 `isAllNull` 分支），
  所以「全 null 仍挂 series 保留坐标轴」会画出一条贴 0 的假折线。验「不支持的指标无 0 值折线」**必须看截图**，`dataChart` 全 null 不能当证据（CP-57189 AC-53 就是这样假通过的；本期已放行不修）
- **自定义列**：Ads / Tag / Library 三套入口的 Video 分类 16 项 + Traffic 的 PDPV/PDPV Rate，标题须与 Ads KPI 面板一致（可用 JSON 对表，不必只靠截图）
- **列表慢**：本地 Ads/Library 列表常 **~20–42s** 才回；没出数前点操作会被前端守卫吞掉（「点了没反应」）
- **抽屉 Ad Performance 表是 div 布局**（不是 `<table>`）：`th` / `tr` 全拿不到。定位行用「Ad Type 单元格叶子文字（`SB - Video` / `SD - Video` / `Streaming TV`）→ 同一水平线的缩略图与 Ad 名称」，脚本 `drawer-adperf-row-rects.js`（CP-58252，2026-10-10）
- 抽屉每页 10 行；DSP（Streaming TV）行图标是 `D`，Amazon 是 `a`；翻页后要重导几何，键名按出现顺序编号
- **Library → Profile 下拉**：只能点值文字（如 `123 of 123 selected`）打开；「Select All」偶发点了不生效，循环点会来回切 —— 点一次、等 2s、读 `Profile` 回显再决定是否再点

## Ads 页平台/素材类型页签（2026-10-09 实测）

- **平台页签是多选累加器**，不是单选：先点 Instacart 再点 Walmart 会得到**两个同时高亮**的混合列表。
  要"只选某平台"必须**先 reload 复位**（重载后回到 `["all"]`）再单点目标平台。
  判据：`.platform-tab__btn` 有两个同时带 `active` = 选错了。
- **改完页签必须再点 `Search`**，否则列表数据仍是上一次的（页签高亮已变 → 极易误判成"该平台没数据"）。
- 切素材类型页签后平台页签会短暂只剩 `All`，脚本要**轮询等页签出现**（实测最多等 40s），不能点一次 miss 就放弃。
- `platformScope` / `dataList` 存在 `CreativeTable` 的 `setupState` 里；但**可能抓到非当前表格的实例**
  （页面上常有多个表格组件）→ 读出 `platformScope = ["walmart"]` 而 `dataList` 里还是 Amazon 的行。
  **判据要落到 DOM 上**：读渲染后的行文本，别只信 `setupState`。
- 🔴 **reload / 切页签之后的几秒是中间态**：旧列表（含之前选过的平台，如 ADSP / Amazon STV 行）和旧 Total 还在屏上，loading 遮罩消失后才换成新结果。
  实测（CP-58252，2026-10-10）：只选 Amazon 后截到 `Total 5116`、首行 Streaming TV，等加载完是 `Total 4145`、首行 SP —— 差点报成「页面比导出多 971 行」。
  截图前跑 `ads-state-rects.js`：`loading` 必须为 0，`total_text` 与列表响应 total 一致才截
- Total 文案在 `span.page-total` 的第一个子元素里（`Total4145entries,50/page` 去掉了空格），`[class*=total]` 会先命中外层分页容器

## Ads 页列表 / KPI / 同环比的口径与坑（CP-57189 修复回路，2026-10-10）

> 操作脚本在同目录 `README.md`（有配方）；这里只记本项目的事实与口径。

- **测试数据窗口**：client 62（`yinzixin`）的 TikTok 视频播放**只有 2026-05、06 有值**（10-09 被同步侧回刷，07 起全 0）。验视频指标一律用 06/01~06/30/2026，对比期用面板默认的上一周期（05/02~05/31）。06 vs 05 **全部上涨**，「下降」样本只能用 PDPV（GMV Max 行）
- **6 月 vv=0 的 TikTok 行全是 GMV Max**（规格应为 NULL，同步侧写成了 0）→ 别拿它证明「真实为 0 显示 0」；Amazon SB-Video 有播放、Views at 25% 为 0，是干净样本
- **列配置偏好存 localStorage**：`userid_<uid>_lastSearchColumn__CreativePage`（表格读）+ `__lastSearchColumn__CreativePage`（Detail 页读）；KPI 卡片 `creative_performance_panel_showList_<uid>`；Group by 记忆 `userid_<uid>_groupBy__CreativePage`（实际 key 被 Storage 包装加了 `retailer_` 前缀）。
  🔴 页面卸载时会把内存配置**写回**，「删 key → 刷新」模拟不了首次进入 → 用 skill 的 `fresh-entry.mjs`
- **Custom Columns 弹框**：勾选态只来自 `v-model`；2026-10-10 起 `CreativeCustomColumn.vue#initialCheckedDataIndexes` 优先读已保存配置（之前重进后弹框回到默认集、再 Apply 会丢列）。抽屉 `PerfCustomColumn.vue` 仍是旧行为
- **Ad Type 分组下 `adType` 列被隐藏**（类型名在 Dimension 列）；**Group by 汇总的单价类分子含不支持播放的行的花费**（例：Amazon SB-Video + Walmart SV 混组，CPV = 36,615.6 / 5）—— 口径待产品定
- **开启对比后数值不吃「完整数字」开关**（`CompareChange` 存量行为）；对比期 null 的列下方是灰色 `--` 占位，不是变化率
- **工具栏「缩写 / 完整数字」开关**：`isShowAbbreviateNumbers === true` 才是完整数字（命名反直觉）

## 🔴 默认测试账号与开测前查库（用户约定，2026-10-10）

- **默认用 yinzixin（clientId 62，userId 93，内部超管）**，请用户登录前先查库确认该账号在目标窗口有每条 AC 需要的样本；缺的那几条再换 client，并一次性列出候选账号（客户账号须用户本次同意、只读）。
- client 62 已知缺口（2026-10-10 CK 全年扫描）：Walmart sv 视频指标全为 null、无 Walmart display / sb 视频数据、无 Amazon SD/STV 视频、无 Instacart ⇒ 平台支持度差异类 AC（AC-40/41/42 一类）在 62 上做不了。
- client 777（Acadia）：唯一超管 `ross@bobsledmarketing.com`（userId 2572，客户团队账号）；用独立实例 `--remote-debugging-port=9230 --user-data-dir=...\cdp-profile-c777`（登录态已持久化）。
  2026-10-10 时 777 近 12 个月：Amazon SB-Video 5s 有值、SD-Video / SD-Image 5s 写成 0（应为 NULL）、Walmart SV 仅 1 行且全 null、无 Instacart 视频、Instacart Display Banner 2s 写成 0 —— 数据随同步回刷会变，开测前重扫（按 productLine | showAdType 统计 null / 0 / 正数）。
- 找账号 SQL（Amazon SQL Server，只读，只取身份 / 权限列，禁读 pwd / pwd2 / salt / token / RandA）：
  `SELECT userId,name,mail,status,isDeleted,isSuperAdmin,userRole,accesiblePlatform FROM amazong_pacvue_test.dbo.[User] WHERE clientId=<id> AND ISNULL(isDeleted,0)=0 ORDER BY isSuperAdmin DESC, lastLoginTime DESC`
- client 777 下含 pacvue / test 字样的内部账号全部 archived + 已删除。
- **测完不恢复浏览器现场**（用户约定）。

## 入口与测试账号（由 docs/browser-notes/creative-management.md 并入，最后验证 2026-10-09）

- 入口：Ads `/crossretailer/CreativeManagement/Creative`；Library `/crossretailer/CreativeManagement/Asset`；Tag `/crossretailer/CreativeManagement/TagManagement`；Dashboard `/crossretailer/CreativeManagement/Dashboard`
- **client 62**（`yinzixin`，内部超管，userId 93）：主流程默认账号；视频数据窗口见上文「Ads 页列表 / KPI / 同环比」。当期窗口常无平台差异类样本，会把用例卡成「阻塞」而非失败 —— 先换样本再判缺陷
- **client 777**（Acadia / Niche Agency，`serviceStatus='test'`，四平台齐全）：平台支持度差异类 AC 的样本库；
  可用账号 `ross@bobsledmarketing.com`（userId 2572，SuperAdmin）属**客户团队账号** —— 🔴 按 playbook §10 须用户**本次**明确同意才可用，且只读；不写进测试交接文档
- 查账号真源：Amazon SQL Server `amazong_pacvue_test.dbo.User`（`User.clientId` 直接绑客户）；只取身份与权限列，禁读凭据列
- Library 点卡片**图片区** = 灯箱，点非图区才开详情抽屉；Metrics 下拉要滚到底才能截到 Cost Per 块

## 🔴 指标列显示 `--` 的三层原因（本项目专属判据）

Ads 表的 `--` 有三个来源，**处理方式完全不同**：

| 层 | 位置 | 表现 | 处理 |
|---|---|---|---|
| ① 素材类型门禁 | `packages/creativehub/config/videoMetrics.js#isVideoOnlyMetricHidden` | Image/Logo 页签下 16 个 Video 指标**无条件** `--`，与广告类型无关 | 前端预期行为，不算缺陷 |
| ② 数据层 null | 后端 CK 该 (profile, adType) 无此指标 | 任意页签下都 `--` | 源库确实没有 |
| ③ 数据层 0 | 后端返回数字 `0` | 显示 **`0` 而非 `--`** | 🔴 语义可疑，见下 |

**验「平台/广告类型支持度差异」时必须先说清验的是哪一层**，否则结论站不住：

- 验 ①：只需在 Image 页签看该列为 `--`
- 验 ②：需要**一个不受门禁管辖的字段做探针** —— PDPV / PDPV Rate 不在 `VIDEO_ONLY_METRICS` 里，
  门禁管不到；若它在所有分支都是 `null`，就证明其余 `--` 来自数据层而非门禁。
- 用 `setupState.dataList` 逐字段看 `NULL` / 数字 **三态**，并按 `adTypeCatalogId` 分组
  （哪组缺哪个指标一眼可见）。**注意区分 `null` 与 `0`** —— `secondViews` 在 Walmart `sv` 上
  恒为数字 `0`，会被真实渲染成 `0` 而非 `--`；若该平台不支持此指标，按 ② 应为 `--`，属待确认的口径问题。

- **「同一列表内对照」常常构造不出来**：`config/platformRegistry/adTypeCatalog.js` 的 fileTypes
  决定某广告类型只出现在某个素材页签（如 `WALMART_SV=[V,L]` 只在 Video 页签、`SB=[I,L]` 只在 Image 页签）。
  此时只能**跨页签对照**，RESULT 要写明「同列表口径在本系统构造不出来」，不要假装做到了。
- 广告类型支持度的真源是 `adTypeCatalog.js`，不是文档；文档写错时以代码 + CK 实测为准
  （CP-57189 就有一处规格把 `sb` 写成有 video 数据，实际源库为 NULL）。

## 导出（下载）

- 导出**需用户显式授权**后才能点
- Creative Hub 的导出分两条链路，别混：

| 入口 | 实际端点 | 形式 |
|---|---|---|
| Ads 页（默认 Asset Group - Asset - Ad 分组） | `POST creative/downloadCollectionCreativeList` | **同步返回 blob，不进下载中心** |
| Ads 页（下载中心入口） | `POST creative/downloadCreativeList` | 异步任务，去下载中心取 |
| Tag 页 | `POST tag/download` | 同步 blob |
| 素材抽屉 Ad Performance | `POST performance/downloadAssetCreativeList` | 同步 blob |

- 文件落到 `C:\Users\<user>\Downloads`
- **有时落成 `{uuid}.tmp` 不自动改名**。先 `zipfile.is_zipfile()` 校验是合法 xlsx 再归档，别当失败
- 导出文件名带的是**导出当天日期**（如 `Ad_Image_2026-09-24.xlsx`），**不是数据窗口日期** —— 归档时必须改成含数据窗口的名字，否则变更前后两份分不清
- **真实客户数据的导出**（用户要求验完删文件）：删前必须先落「可复算」的产物，否则验收无法复核（CP-58252 AC-17 因此缺证返工一次）：
  1. `export-target.mjs` 导出到 scratchpad 新建空目录（不进 Downloads），留请求元数据 + md5
  2. `python -I export-parse.py <xlsx> <前缀>` → 去标识化逐行 CSV（行号 / Ad Type / 是否含 `ID:` / 是否 `Creative` / Ad 文字哈希 / 每列图片数）+ summary
  3. 页面侧：`ads-page-rows.js`（需 `__ct`）或 `xhr-rows-dump.js` → `export-page-crosscheck.py` 按哈希与导出对照
  4. 解析脚本拷进 `tests/AC-NN/script/`，再删 xlsx
- Ads 导出图片全锚在第 0 列：SP 行 = 缩略图 + 商品图（2 张），SD / SB = 1 张；图片总数对不上时看 summary 的 `sp_rows_without_exactly_2_images` 与 `img_c0=0` 的行，别只报总数差

## 取基线的硬要求

- 窗口用**固定绝对日期 + 已冻结的历史整月**，禁止 `today()` 相对窗口、禁止当月：`DailyCreativeReport_all` 是 `ReplicatedReplacingMergeTree(..., version)`，各平台仍在回刷当月，同窗口今天查和明天查本就会变
- 基线文件必须同时记：**查询/操作条件原文 + 覆盖窗口 + 结果**，否则复跑对不齐
- 复跑条件要逐项对齐：环境、账号、日期窗口、fileType 页签、分组模式、筛选、列配置。任一条不同，比对无效
- 页面上**看不到**的字段（如 `secondViews` / `costPerView`，前端四份指标清单里都没有）不要用 UI 取基线，直接走 CK SQL 或抓 XHR 响应体

## 工具链（别重写已存在的东西）

| 要做什么 | 用什么 | 在哪 |
|---|---|---|
| 执行 JS / 真点击 / 截图 / 下载 | `cdp.mjs` | skill `cdp-drive-real-chrome/scripts` |
| 读表格数据（固定列安全） | `vtable-read.js` | 同上 |
| 布景 + 截图 + 导出单元格几何 | `stage-shot.mjs --rects` | 同上 |
| 读 `NULL` vs `0` 三态、按类型分组 | `vue-datalayer-read.js` | 同上 |
| 证据标注图（框边写字，推荐；吃页面导出的 rects） | `annotate-rects.py` | skill `cdp-drive-real-chrome/scripts` |
| 并行开窗 / 按 targetId 锁标签 | `tab-open.mjs` / `conn.mjs`（`CDP_TARGET`） | 同上 |
| Ads 页布景、行定位展开、单元格取证、分组对账 | 见 `projects/creative-management/README.md` | skill `cdp-drive-real-chrome/projects/creative-management` |
| 单图裁剪标注（框边写字版） | `annotate.py` | skill `cdp-drive-real-chrome/scripts` |
| 多面板合成标注图 | `compose.py` | skill `cdp-drive-real-chrome/scripts` |

🔴 **通用方法论只写在 `../../references/SCRIPTS.md`，本文件只留本项目特有的口径与坑** —— 两边都写会漂移。

## 收尾

- 改过 `resize_window` 的，用完 `preset: "desktop"` 还原
- 验证期间临时写的调试代码 / 临时路由 / `console.log` 一律删除，提交前**逐仓** `git status`（前端是宿主仓 + `packages/creativehub` 嵌套仓两个）

# creative-management 页面口径与坑（PAGE-NOTES）

> 属于 cdp skill 的 **L1 页面级**：本项目 Creative Hub 页面在本地 dev 环境实测得到的**事实、口径、测试账号与坑**。
> 操作脚本怎么用见同目录 `README.md`；通用方法、L0 脚本表与坑清单见 `../../references/SCRIPTS.md`（唯一权威）。
> **操作浏览器前与 README 一起读**。走不通先怀疑这里过期，当场改并刷新日期。
>
> 2026-10-10 由项目仓 `.agents/browser-verification.md` 迁入（用户要求不放 git 管理）。
> 2026-10-13 整理：README 里的数据口径坑并入本文（与原「Ads 页列表 / KPI / 同环比」节合并去重）；两个账号节合并；内置浏览器面板专属内容单独成节；需求临时信息归入「需求临时备注」；
> 🔴 本文件会随 skill 分发到多个 agent 目录 —— **不写客户账号邮箱 / 任何凭据**，账号只写 userId 与账号名（登录用的是账号字段，不是邮箱）。

适用：在浏览器里跑 Creative Hub 页面做取证 / 取基线 / 复现问题（全栈工作流 Step 11.4、回归基线采集）。
只记**本仓库 + 本地 dev 环境实测踩过的坑**，通用浏览器常识不写。

## 本地 dev 环境

| 项 | 值 |
|---|---|
| 入口 | `http://localhost:3001/crossretailer/CreativeManagement/{Dashboard\|Creative\|TagManagement\|Asset}`：Ads `/Creative`；Library `/Asset`；Tag `/TagManagement`；Dashboard `/Dashboard` |
| 接口前缀 | `/creative-local/`（Vite 代理到后端，不是 `VITE_APP_CREATIVE_MANAGEMENT_URL` 的线上域名） |
| 库 | 🔴 本地后端连的 MySQL `creative_management` **就是 mysql MCP 连的生产 US 库**（本地 / dev / test 共用；2026-10-14 本地 job 5036 / 5494 在 MCP 里查得到）→ 本地出图、Edit 保存、执行 data.sql **都会写进生产库**，写操作授权时向用户说明 |
| 后端没起 | Vite 代理回空 body 的 500，页面显示「No product found」「No data found!」，像数据问题 → 先 `curl --noproxy '*'` 看后端端口（SCRIPTS 坑 55） |
| 登录 | 必须由**用户本人**登录，禁止 agent 代输凭据（CDP 用独立 `--user-data-dir` 实例，登一次持久化；内置浏览器面板见下文专节） |
| 未登录表现 | URL 被重写成 `http://localhost:3001`（路径丢失），页面停在加载动画，网络请求**全是 Vite 模块加载、零个后端 API** —— 看到这个形态就是没登录，别再等了（CDP 下用 L0 `chk401.mjs --match creative-local` 判定） |

## CRITICAL：不要只看 DOM 判断「没数据」

**实测翻车**：把日期设成某个月后，等了 18 秒，KPI 卡片全 0、列表显示 `No data found!`，据此判定该月无数据 —— **结论是错的**，接口还在路上，再等一会儿数据就出来了。

规则：
- 判定「有无数据」**必须看 XHR 响应体**，不能只看 DOM（CDP 下用 `net-cap.mjs` / `xhr-rows-capture.js`；内置浏览器面板做法见专节）
- 本地 dev + CK 大范围查询，**列表接口 20~40 秒才回是常态**，导出接口可到 40 秒以上
- 请求列表里**没有状态码**（如只有 `POST …/getCollectionCreativeList`，后面没有 `→ 200 OK`）= 仍在 pending，继续等
- 🔴 反过来：**秒回 500 且 body 为空** = 后端没在监听（不是没数据），见 SCRIPTS 坑 55

## 日期范围控件

- **首选**：日期条左右两侧的 `<` / `>` 箭头按**当前周期步进**（当前是整月就按月退），一次点击即生效，最省事
- 内置浏览器往 `Start Date ~ End Date` 输入框里 `type` 一个 `MM/DD/YYYY ~ MM/DD/YYYY` 再点 Apply **不生效**（已实测）；
  **CDP 下 `Input.insertText` + Enter + 点 Apply 生效**（`date-range.mjs`，2026-10-10 实测，会同时记录请求体里的 start/endDate）
- `Custom Range` 的日历弹层在窄面板下会渲染到可视区外，难点中
- 切页签（Ads / Tag / Library）**日期会保留**，不用每页重设

## Library 素材卡片

- 点卡片的**图片区**打开的是图片预览灯箱，**不是**详情抽屉；点非图区才开详情抽屉
- Ad Performance tab 只对 `Distributed > 0` 的素材有意义；`Distributed 0` 的素材即使打开抽屉该 tab 也可能无数据，取证前先挑一个已分发的素材
- Metrics 下拉要滚到底才能截到 Cost Per 块（详见下节）

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
> 2026-10-13 起 README「本页实测的坑」里的口径条目（原编号 6、8~14、12）并入本节，README 只留一行提醒。

- **测试数据窗口**：client 62（`yinzixin`）的 TikTok 视频播放**只有 2026-05、06 有值**（10-09 被同步侧回刷，07 起视频播放全 0）。验视频指标一律用 06/01~06/30/2026，对比期用面板默认的上一周期（05/02~05/31）。
  06 vs 05 **全部上涨**，要「下降」样本：用 PDPV（GMV Max 行）、或换 07 vs 06、或用 `compare.mjs custom` 造「05 当期 vs 06 对比」（原 README 坑 10）
- **6 月 vv=0 的 TikTok 行全是 GMV Max**（规格应为 NULL，同步侧写成了 0，属数据侧问题）→ 别拿它证明「真实为 0 显示 0」；Amazon SB-Video 有播放、Views at 25% 为 0，是干净样本（原 README 坑 11）
- **列配置偏好存 localStorage**：`userid_<uid>_lastSearchColumn__CreativePage`（表格读）+ `__lastSearchColumn__CreativePage`（Detail 页读）；KPI 卡片 `creative_performance_panel_showList_<uid>`；Group by 记忆 `userid_<uid>_groupBy__CreativePage`（实际 key 被 Storage 包装加了 `retailer_` 前缀）。
  🔴 页面卸载时会把内存配置**写回**，「删 key → 刷新」模拟不了首次进入 → 用 skill 的 `fresh-entry.mjs`
- **Custom Columns 弹框**：勾选态只来自 `v-model`；2026-10-10 前弹框按默认集初始化、与表格不一致（重进后弹框回到默认集、再 Apply 会丢列），已修（`CreativeCustomColumn.vue#initialCheckedDataIndexes` 优先读已保存配置）。抽屉 `PerfCustomColumn.vue` 仍是旧行为（原 README 坑 12）
- **Ad Type 分组下 `adType` 列被隐藏**（类型名在 Dimension `name` 列里 —— 标注时框 `name`，原 README 坑 6）；**Group by 汇总的单价类分子含不支持播放的行的花费**（例：Amazon SB-Video + Walmart SV 混组，CPV = 36,615.6 / 5）—— 口径待产品定
- **开启对比后数值不吃「完整数字」开关**（`CompareChange` 存量行为，数值仍缩写）→ 对账数值用模型或关掉对比读（原 README 坑 8）
- **对比期为 null 的列**：数值 `--`，下方是 `CompareChange` 既有的灰色 `--` 占位（`<div v-else>--</div>`）—— 不是变化率，AC「不展示变化率」据此判定成立，RESULT 要写明（原 README 坑 9）
- **工具栏「缩写 / 完整数字」开关**：`isShowAbbreviateNumbers === true` 才是完整数字（命名反直觉）；对账必须完整数字（缩写 471.2K 会误判 DIFF）
- **表头排序只在「降序 ⇄ 升序」两态间切换，没有「取消排序」**：第 1 次点 = 降序（`data-sorttype=2`），第 2 次 = 升序（1），第 3 次又回到降序。要拍哪个方向先读 `data-sorttype`，别按点击次数猜（实测一次把升序图标成了降序）。用 `sort-check.mjs`，它会等**这一次**的响应再读并三方比对（原 README 坑 13）
- **素材行 / Ad 行由 CK 排序：升序、降序 null 都在最后**；Ad Type 中间行由 Java `CreativeGroupByAggregator#buildAdTypeParentRows` 排序（`nullsFirst` + 整体 `reversed()` ⇒ 升序 null 在最前）——两层规则不一致，以实测为准（原 README 坑 14）

## 图片 Creative 生成页（Creative Generation / Image Generation，CP-58118，最后验证 2026-10-14）

> 操作脚本：同目录 `creativehub-*`（见 README「图片 Creative 生成页脚本」）。下面是事实与坑。

- **页面上下文**：微前端，`window.$pinia._s` 是空的 → 用户 / client 信息读**组件里的 userStore**（从宿主组件 `setupState` / `appContext` 取），别读全局 pinia；宿主组件用 `creativehub-find.js`（按 `assist` + `generateDisabledTip` 找）或 `creativehub-lib.js` 的 `__g1.host()`
- **同一 userId 换 client 页面上没有入口** → 需要别的 client 的样本就换账号（按 playbook §10 找账号），别找切换器
- **已分析过的商品 2 秒内直接返回 PD / 卖点**（后端有缓存）→ 要拍「进度从 0 递增」的帧，**换一个没分析过的新商品**
- **选品后 PD 有 14~17 秒的前置 0%**（爬取商品详情阶段），不是卡死；进度帧的「起点」按第一次 >0 算，别把这段当缺陷
- **Ad Type 下拉是虚拟滚动**：打开后先把列表容器 `scrollTop=0` 再找，或直接用搜索框（`creativehub-drive.mjs` 的 `pickAdType` 走搜索）
- **选 Selling Point = Custom 会清空 Prompt**（预期行为）→ 测「Prompt 回填 / 保留」类断言别在 Custom 之后读
- **Style Type 按钮**文字是整词 `Lifestyle` / `Studio`；mock 卖点名形如「Mock hook N · Lifestyle」，**按 `/Lifestyle/` 子串匹配会误中卖点按钮** —— 一律整词匹配
- **选品图片字段名是 `imgUrl`**（`selectedProduct.imgUrl`），不是 `image` / `imageUrl`
- **来源切换（2026-10-14 起两页一致）**：按钮组 Product List / Product Image / Product URL，上方字段标题「Product Source」（无 `*`）；Creative 页旧文字 Product to Creative / Image to Creative / URL to Creative 已不存在，按旧文字找元素的脚本会 not found
- **素材库抽屉（Select from Library，`AssetsFormDrawer`）**：Asset Tag 下拉是**虚拟滚动**，只渲染首屏选项，排在后面的不在 DOM 里（同 Ad Type 下拉）；Product Image 来源的 Source Image 库选默认预选 Content Type / Product Only（client 62 tagId 163290，列表 135 条，去掉后 1486 条），预选项排在下拉最前；Reference 区「+」是 `[data-testid=creativehub-466]`（悬停展开），菜单项 Select from Library 是 `creativehub-468` → 回归用 `creativehub-library-drawer.mjs`
- **getTagTree 慢且波动**（实测 1.7~8 秒）、维度选项接口约 6 秒：测「打开即选中」类时序要在新页面加载后跑，时序以页面内 50ms 采样为准，别用脚本返回时间
- **「禁用光标」截图拍不到鼠标** → 判据用 `elementFromPoint` 命中元素的 computed `cursor`（应为 `not-allowed`）+ 点击后生成请求数不变（CP-58118 AC-67，`q99` 脚本思路）

- **Generate 按钮在 789px 窗口高度下在首屏以下**：找点击目标前先 `scrollIntoView`，否则「找不到目标」；Image Resize 三张结果卡一屏放不下 → 临时 `CDP_VIEWPORT=1600x1350@1`（dpr 见 SCRIPTS 坑 52）
- **Ad Type 下拉对 `pickAdType` 重复调用会在开 / 关之间切换**：先判断是否已展开；搜索框先全选清空再输入；**Add Product 弹层还开着时下拉会被它挡住**，输入的关键字会跑进商品搜索框 → 先关弹层，并确认商品列表加载完再点商品
- **Size Specification Asset 的尺寸下拉要点选项前的复选框**，点文字不生效；勾选后宿主的 specs 约 1 秒才同步，读断言前等一下
- **只有 ADSP - Component-based - Responsive eCommerce 同时有 Custom Image 与 Size Specification Asset**（2026-10-14 查规格表）→ 测 Dimension Type 切换只能用它
- **规格接口失败后，新 Ad Type 会先跑约 15 秒卖点生成**，这期间 Generate 置灰提示是「AI is analyzing, please wait.」（优先级更高），等 AI 结束再悬停取「加载失败」提示
- **置灰提示第一次悬停有时截不到 tooltip**（页面状态已正确）：移开再悬停重拍一次，文件名加后缀区分
- **crossretailer 页全局 `productline` 是 `retailer`**；Creative Generation 的 Ad Type 树里 SB 只挂在 Walmart 下 → 测「按平台反查 Ad Type」要用多个平台都有的值（如 `Image`）才有区分力
- **Edit Creative 是 `.el-drawer` 不是 `.el-dialog`**；关它里面的 AI 候选弹层点 `.el-drawer__header`
- **内存挂载（`creativehub-mount-demo.js`）的抽屉里，选品弹层和 Ad Type 下拉点不出来**（`display:block` 但截图看不到、坐标点不中）→ 选品走抽屉的 `init({ productId })`、Ad Type 走组件自己的 `onChange`，证据里标明；**Demo 宿主卡会盖住抽屉**，截抽屉前先隐藏它
- **Creative 页结果区刷新不保留、Generation Log 不显示文案**：Edit Creative 保存后的内容到库里读回（`ai_generation_job.creative_edit_json` / `asset_name`，按 jobId 只读查询）；本地后端与 mysql MCP 是同一个 `creative_management` 库，即生产 US 库（2026-10-14 实测 job 5036 / 5494；见上文「本地 dev 环境」表「库」行）

- **后端按请求体复用 AI 任务 job**（PD / 卖点 / 优化）：同样的请求体再提交，直接返回已完成的旧 jobId、秒回 SUCCESS → 要拍「优化进行中」，先改一下 Prompt 让请求体不同
- **AI Optimize 进行中**：Prompt 区盖着遮罩 `.prompt-locked-overlay`；进度轮询约 3.2s 一次；成功后 100% 停留约 0.8s。mock 优化结果固定以 `Optimized: ` 开头，可据此判断 Prompt 是否被覆盖
- **`pickAdType` 点完叶子后会盲等约 2.5s**，这段时间不采样：要精确的「切换时刻」用 `/ad-type/specs` 请求时间，别用脚本返回时间；只读探查完记得确认下拉已收起（再点会开 / 关切换）
- **`R.adType`（`creativehub-drive.mjs`）**：2026-10-14 已改为去掉必填星号后匹配「Ad Type」，此前会退化成整个 `document.body`

### AI 请求体取证（后端日志只在 IDEA 控制台）

- 本地后端在 IDEA 里跑，**日志只在 IDEA 控制台**，读不到 → 「发给 AI 的请求体」用两条路取证：
  ① 前端网络记录（`creativehub-netcap.mjs`，请求体 + 响应体原文）；② `GET /creative-local/ai/generation-log/{jobId}`：`requestJson` 是字符串，**外层是数组，取 `[0]`**
- **Generation Log 页面只列成功记录**，失败的 job 在页面上找不到 → 失败分支只能走 ② 按 jobId 查
- ② 是脚本自己发的只读 GET：2026-10-13 起先在页面内无头直发（令牌不经过 Node），401/403 才复用内存里的页面请求头（不落盘不打印），产出 `authVia` 写明走的哪条路；RESULT 里写明这一点

### 规格表：哪些 Ad Type 有 AI 文案字段

- 找「某 Ad Type 会让 AI 生成 Headline / CTA 等文案字段」的正例，查规格表而不是在页面上逐个试：
  `asset_requirement_spec` 中 `is_gen_ai_use = 1 AND is_ai_generate LIKE 'Yes%'`（只读，按 Ad Type 分组看字段）
- 写 AC 时就用它做「Given 可达性」查证（workflow step-03）：查不到同时满足 Then 要求的 Ad Type → 当场问用户改口径，别留到验收（教训来源见「需求临时备注」CP-58118 AC-24/74）

## 🔴 默认测试账号、入口与开测前查库（用户约定，2026-10-10；2026-10-13 合并两节）

- **默认用 yinzixin（clientId 62，userId 93，内部超管）**：主流程默认账号。请用户登录前先查库确认该账号在目标窗口有每条 AC 需要的样本；缺的那几条再换 client，并一次性列出候选账号（客户账号须用户本次同意、只读）。
  当期窗口常无平台差异类样本，会把用例卡成「阻塞」而非失败 —— 先换样本再判缺陷；视频数据窗口见上文「Ads 页列表 / KPI / 同环比」，已知缺口见「需求临时备注」
- **client 777**（Acadia / Niche Agency，`serviceStatus='test'`，四平台齐全）：平台支持度差异类 AC 的样本库。
  可用账号：**userId 2572**（SuperAdmin，唯一超管，**客户团队账号**；账号名开测前按 userId 查库取，不在本文件记邮箱）——
  🔴 按 playbook §10 须用户**本次**明确同意才可用，且只读；不写进测试交接文档。
  用独立实例 `--remote-debugging-port=9230 --user-data-dir=...\cdp-profile-c777`（登录态已持久化）。
  client 777 下含 pacvue / test 字样的内部账号全部 archived + 已删除。
- **查账号真源**：Amazon SQL Server `amazong_pacvue_test.dbo.User`（`User.clientId` 直接绑客户）；只读，只取身份 / 权限列，禁读 `pwd / pwd2 / salt / token / RandA`：
  `SELECT userId,name,mail,status,isDeleted,isSuperAdmin,userRole,accesiblePlatform FROM amazong_pacvue_test.dbo.[User] WHERE clientId=<id> AND ISNULL(isDeleted,0)=0 ORDER BY isSuperAdmin DESC, lastLoginTime DESC`
  （`mail` 列只用于当场核对，不写进笔记 / 证据 / 交接文档；报给用户用账号名 + userId，同一邮箱可对应多个账号）
- **测完不恢复浏览器现场**（用户约定）。

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

- 浏览器默认下载位置是 `C:\Users\<user>\Downloads`；CDP 验证一律 `export-target.mjs --dir <scratchpad 新建空目录>`，不进 Downloads
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

🔴 **脚本表只在 [`../../references/SCRIPTS.md`](../../references/SCRIPTS.md) 维护**（L0：cdp / conn / sconn / real-click / vtable-* / vue-datalayer-read / stage-shot / annotate.py --rects / compose / tab-open …）；
本项目 L1 脚本（Ads 页布景、行定位展开、单元格取证、分组对账、`creativehub-*`）见同目录 [`README.md`](README.md)。
（2026-10-13 前这里有一份工具链对照表，与 SCRIPTS.md 重复且已过时 —— 推荐的 `annotate-rects.py` 已并入 `annotate.py --rects`。）

🔴 **通用方法论只写在 `../../references/SCRIPTS.md`，本文件只留本项目特有的口径与坑** —— 两边都写会漂移。

## 内置浏览器面板（非 CDP）专属

> Agent 客户端自带的浏览器面板（`read_page` / `find` / `resize_window` 等工具），不是本 skill 的 CDP 实例。以下只在用它时适用。2026-10-13 从各节归拢到这里。

- **登录**：内置浏览器与用户 Chrome **会话隔离**，没有登录态。必须由**用户本人**在浏览器面板里登录，禁止 agent 代输凭据
- **判「有无数据」**：`read_network_requests` 找到对应请求 → 带 `requestId` 再读一次拿 body（规则同上文 CRITICAL 节）
- **面板宽度坑**：
  - 面板可视宽度约 **570px**，Creative Hub 页面按宽屏设计，**右侧工具栏（自定义列、导出图标）默认在可视区外**
  - 找不到某个按钮时先 `scroll` 方向 `right`，不要以为按钮不存在
  - `resize_window` 设 1280 / 1440 宽会被缩放塞进面板，**截图变得几乎不可读**；此时改用 `read_page` / `find` / `get_page_text` 定位，截图只用于最后留证
  - 定位元素优先 `find` 拿 `ref_N`，比坐标稳（页面横向滚动后坐标会失效）
- **日期输入**：往 `Start Date ~ End Date` 输入框 `type` 再点 Apply **不生效**（用左右箭头步进，见「日期范围控件」）
- **收尾**：改过 `resize_window` 的，用完 `preset: "desktop"` 还原

## 收尾

- 验证期间临时写的调试代码 / 临时路由 / `console.log` 一律删除，提交前**逐仓** `git status`（前端是宿主仓 + `packages/creativehub` 嵌套仓两个）
- 内置浏览器面板的收尾见上节

## 需求临时备注（可过期，用前核对日期）

> 只对某次需求 / 某个时间点成立的信息集中在这里，**不删**（复盘与下次同类需求有用），但用之前先核对是否仍成立。
> 每条末尾的【状态 YYYY-MM-DD】是最近一次 review 的判断：⏳ 快照待重扫 / ✅ 仍有效 / 📦 已沉淀（仅溯源）/ ❓ 待确认。

- **2026-10-10 · client 62 已知缺口（CK 全年扫描）**：Walmart sv 视频指标全为 null、无 Walmart display / sb 视频数据、无 Amazon SD/STV 视频、无 Instacart ⇒ 平台支持度差异类 AC（AC-40/41/42 一类）在 62 上做不了【状态 2026-10-14：⏳ 快照已 4 天，开测前按 productLine | showAdType 重扫】
- **2026-10-10 · client 777 数据快照（近 12 个月）**：Amazon SB-Video 5s 有值、SD-Video / SD-Image 5s 写成 0（应为 NULL）、Walmart SV 仅 1 行且全 null、无 Instacart 视频、Instacart Display Banner 2s 写成 0 —— 数据随同步回刷会变，开测前重扫（按 productLine | showAdType 统计 null / 0 / 正数）【状态 2026-10-14：⏳ 快照待重扫】
- **2026-10-10 · CP-57189 第 1 轮修复回路命名**：`custom-columns-set.mjs` / `compare.mjs on` 产出文件默认前缀 `fix-r1-` 来自这一轮（`fix-r1-cc-log.json`、`fix-r1-01-compare-panel.png`）；别的需求用 `--prefix` 改【状态 2026-10-14：✅ 仍有效 —— 脚本默认值仍是 `fix-r1-`，本条解释其来源】
- **2026-10-13 · CP-58118 AC-24/74**：「Given 可达性」没在写 AC 时查规格表，来回 3 轮才定口径 → 已沉淀为上文「规格表」节的规则【状态 2026-10-14：📦 已沉淀，仅溯源】
- **2026-10-13 · CP-58118 出图 mock**：后端 `generate-creative-image` / AI 三能力当时写死 mock（图片内容不作证据），**上线前必删**；`creativehub-fields-compare.mjs` 的 `-04` 摘要默认 `evidenceType` 写的就是这个，mock 删除后设 `EVIDENCE_TYPE`【状态 2026-10-14：✅ 仍有效 —— 用户确认 mock 保持不变，已随后端 edb65cf00 本地提交；上线前删 AIHandler MOCK 块并关 GenAiTaskProperties.Mock，删除后本条改 📦，并同步 README「图片 Creative 生成页脚本」节的提醒】

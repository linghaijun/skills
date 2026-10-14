# 文档输出目录规范 + 项目上下文适配 + 自检清单

## 一、文档输出目录规范（CRITICAL）

所有设计文档必须放入 `docs/develop/{Sprint}-{需求id}-{需求title}/`（后端仓），例：`26Q4-Sprint1-CP-58118-图片Creative生成 - 支持AI生成Hook 与Scene 2个独立信息`。

> 🔴 **路径基准**：本文与各 step 里的相对路径（`docs/develop/...`、`scripts/...`、`docs/develop/tools/dashboard_server.py`）
> **一律以后端仓根 `creative-management/` 为基准** —— 本工作区是多仓（`creative-management/`、`vuen-crossretail/`、
> `platform-provider/`…），**同名 `docs/develop` 可能不止一棵**（实测外层根目录也长过一棵，需求目录建错地方）。
> 动手前先确认：`Test-Path <后端仓根>\docs\develop`；不是就换仓根，别在当前目录新建一棵。
> 看板服务、`validate_step.py --dir`、`qa_record.py --dir`、`init_workdir.py --project` 全部按这个基准给参数。

### 启动：用户给 Jira 号 → AI 自动建目录（禁止让用户手建）

1. 用 Atlassian MCP `getJiraIssue`（`view: evidence`）取 `summary` 与 `Sprint` 字段
   - 🔴 给的是 **Epic** 时不要直接用：列出其下 Story（JQL `parent = <Epic>`，必要时再按 Sprint 收窄），问用户本次做哪张 —— 目录与 AC 追溯都以 **Story 号**为准
   - Sprint 字段为空、或 MCP 不可用 → 问用户 Sprint 名与标题，不要猜
2. 跑脚本（同一票号已有目录就**复用**，不会建出「…信息」「…信息2」两份；命中多个时退出码 2，问用户用哪个）：
   ```bash
   py scripts/init_workdir.py --project <后端仓根> --jira CP-xxxxx --sprint "<Jira Sprint 原值>" --title "<Jira summary 原文>"
   ```
   - `Sprint`：取 Jira Sprint 名「 - 」之前那段（`26Q4-Sprint1 - Nova` → `26Q4-Sprint1`）
   - `需求title`：Jira summary 去掉开头的 `[Creative Hub] -` 这类标签、去除非法字符 `/\:*?"<>|`，超长截断
   - 输出最后一行 `DIR=<绝对路径>`，后续所有产出物都写这里
3. 用户已把 PRD / 原型等材料放在别的目录时，**问用户**是否挪进新目录，不要擅自移动

```
docs/develop/26Q4-Sprint1-CP-48771-share-audit/
├── Step 1-需求澄清问答记录.md            # Step1（含待 PM 确认清单）
├── Step 2-Spec.md                        # Step2（OpenSpec proposal 模板）
├── Step 3-Checklist.md                   # Step3（前后端共享 BDD，用户操作流）
├── Step 3-Checklist-Jira.txt             # Step3 Jira 纯净版（checklist_jira.py 生成）
├── Step 4-后端技术设计与实现方案文档.md    # Step4（含复用清单+非功能映射表）
├── Step 4-前端技术设计与实现方案文档.md    # Step4（含复用清单+非功能映射表）
├── Step 5-ddl.sql                        # Step5（直接可执行的纯 SQL，见 step-05：不要用 PREPARE 包幂等）
├── Step 5-ddl-rollback.sql               # Step5 强制回滚
├── Step 5-data-backfill.sql              # Step5 数据回填（如涉及）
├── Step 6-API接口定义文档.md              # Step6（前后端唯一契约）
├── Step 7-前端页面与组件设计文档.md        # Step7
├── Step 8-后端单元测试验证指标矩阵.md      # Step8
├── Step 8-前端测试验证指标矩阵.md          # Step8（人工验证清单，前端不写自动化测试）
├── Step 8-回归验证清单.md                 # Step8（既有功能不被破坏，R-NN 编号）
├── Step 9-tasks.md                        # Step9（OpenSpec tasks 模板）
├── Step 11-业务逻辑自检报告.md             # Step11.3
├── Step 11-浏览器验证步骤.md / Step 11-浏览器实机验证报告.md   # Step11.4（可选）
├── Step 11-数据核对报告.md                 # Step11.5（11.4 未执行时单独出；执行过则并入实机验证报告的 H 表）
├── Step 12-AI Review报告.md               # Step12
├── Step 13-全局一致性审查报告.md           # Step13
├── Step 13-{其他自动化报告名}.{ext}        # Step13 自动化检测产出（如有）
├── Step 13-证据验收报告.md                 # Step13 F（独立 subagent；复验轮次可另存 -第N轮.md 或 tests/_acceptance/）
├── Step 13-测试交接文档.md                 # Step13（test-handover.md）
├── Step 14-AC-Subtask映射.md / Step 14-mapping.json   # Step14
├── .workflow-state.json / .handover-state.json / .qa-changes.json   # 脚本维护的状态文件，不手改
├── figma/                                 # Figma 缓存（如有，figma-ui-cache.md）
├── tests/                                 # 每 AC 证据目录（见下）
├── 验证进度看板.html                      # Step11.4 收尾生成（用例状态 + 证据终验，可切换实时刷新，见下）
└── UI/ (可选)                             # UI 截图
    └── asset-detail.png
```

UI 截图如有放入 `UI/` 子目录，Checklist 与前端设计文档中以相对路径引用（如 `![](UI/asset-detail.png)`）；无 UI 图则不建该目录。业务代码和测试代码按项目既有结构放置，不进 docs。目录用 `New-Item -ItemType Directory -Force` 创建（Win 兼容）。

**自动化报告落盘规则**：任何步骤中由脚本（Python/shell 等）产出的分析/检测报告，必须复制一份到本目录，文件名加 `Step N-` 前缀。例如 Step13 运行 `field-consistency-check.py` 产出 `report.txt`，则保存为 `Step 13-field-consistency-report.txt`。

### 测试证据目录 `tests/`（强制：每个 AC 一个目录）

测试产生的**用例、可复跑入口、结果证据**必须按 `AC-NN` 归档，落在**当前需求目录**下的 `tests/`：

```
docs/develop/{Sprint}-{需求id}-{需求title}/
└── tests/
    ├── README.md                 # 索引：顶部「进场检查」小节 + AC-NN → 结论 → 用例 → 复跑入口 → 证据（Step11 收尾时生成）
    ├── .verify-state.json        # 用例状态登记：多会话/多浏览器并行时谁在验哪条、用哪个窗口（11.4；「验证中」= 已被占用）+ 证据终验（11.6）
    ├── _unit/<批次>/             # 单测原件：当次 surefire TEST-*.xml 全集 + 按 classname 聚合计数与 md5（surefire_aggregate.py）；引用单测作 AC 证据时必须有
    ├── AC-01/
    │   ├── case.md               # 验的是什么：Checklist 原文逐字内嵌 + 轨道 + 优先级（GWT / 步骤 / 预期）
    │   ├── script/               # 【自动化轨】可直接执行的脚本原件（后端单测复跑入口 / 接口脚本；产出过证据的补丁 / 采样 / 标注脚本也放这）—— 与 REPLAY.md 二选一
    │   ├── REPLAY.md             # 【复跑入口 / Agent 实机验证轨】怎么再跑一遍 —— 命令 / SQL / 环境·账号·前置数据·编号操作步骤·预期 XHR
    │   ├── evidence/             # 【硬证据】当时的真实输出，与 REPLAY 的小节一一对应：截图 .png / 录屏 .mp4|.webm|.gif / 抓包 .har|.json / 查询结果 / 日志 .log
    │   ├── NOTES.md              # （可选）过程笔记：断言清单逐句打勾、「用时约 N 分钟」（verify_state.py backfill-duration 读它回填耗时）
    │   └── RESULT.md             # 顶层第一条 `- 结论：<状态词>`（通过/失败/阻塞/部分/走读证据/跳过，与 verify_state 登记同词，门禁会比对）+ 环境 + 复跑入口 + 证据清单 + 本轮 marker 或 tabId，指向上面几者
    └── AC-02/
```

🔴 **目录名 = Checklist 里那个 token 的逐字复制**，一个字符都不能差：

- ✅ 清单写 `AC-07` → 目录必须是 `AC-07`；证据文件名同前缀（`AC-07-02-xxx.png`）
- ❌ `AC-7` / `AC-007` / `ac-07` 一律不合规
- 宽度规范见 `step-03-checklist.md` 核心约束 4：**≤99 条一律零填充两位**（`AC-01`），>99 条整份改三位，同一需求内宽度统一
- 补零不只是好看：不补零时字符串排序会把 `AC-10` 排到 `AC-2` 前面，且下游按编号反查容易静默失配

`validate_step.py` 强制校验两项：「AC 编号宽度统一」（清单内部不得混用位数）、
「tests 目录名与 AC 编号一致」（写法不符会定位到该目录但判 FAIL，并输出重命名清单，
不会误报成"没留证"让你白重测一遍）。

一个 AC 一个目录，**含 `[blocked]` 的 AC 也要建目录**（`RESULT.md` 写清为什么没测），
不合并、不省略 —— 目录缺失 = 该 AC 未测。

> 🔴 **`script/` 与 `REPLAY.md` 二选一，就是 L18 的来源**：凡是「缺 X 即判不合格」的门禁，定的时候必须逐条走查**所有执行路径** —— 某条路径按约定产不出该形式（如不写测试代码就永远产不出 `script/`），必须给**等价替代**或**显式豁免**。
> **必然判 fail 的门禁只有两种下场：被当噪音忽略，或被整体跳过 —— 两种都等于门禁失效**，比没有门禁更糟（给了虚假的安全感）。
> 新增或修改任何门禁条款时，回头对照 L18 自检一遍。

#### 四件套分工（**不要把内容写串**）

| 文件 | 放什么 | 不放什么 |
|---|---|---|
| `case.md` | 🔴 **Checklist 该条 `AC-NN` 的 GWT 原文（逐字内嵌）** + 验的是什么、走哪条轨道、**该用例的优先级 P0/P1/P2** | 不放结论和证据（那是 `RESULT.md` / `evidence/`）；**不把多个测试点塞进一条** |
| `REPLAY.md` | **可直接执行的东西**：命令、完整 SQL、编号操作步骤 | 不放结论 |
| `evidence/` | **当时的真实输出**：查询结果、截图、抓包、日志片段 | 不放推断和转述 |
| `RESULT.md` | 结论 + 环境 + 指向前两者的链接 | **不重复正文** |

##### 🔴 `case.md` 必须内嵌 Checklist 原文

只写「见 Checklist AC-07」，等于让每个看证据的人（和几天后的你）再去翻一次清单、
在几十条里找那一条。**证据目录要能脱离清单独立读懂。**

```markdown
# AC-07

## 验收原文（逐字摘自 Step 3-Checklist.md，改动须同步）

> * [done] AC-07 {COMMON} - Given 列表已有 21 条数据，When 用户翻到第 3 页，Then 显示第 21 条

## 验什么
分页边界：total 不是 pageSize 整数倍时，最后一页仍要出数据

## 轨道 / 优先级
自动化轨（`script/`） ｜ P1
```

🔴 **内嵌的是副本，副本就会漂移**：Checklist 改了，`case.md` 不会自己跟着改 ——
这与「枚举/映射单一真源」是同一类问题。两条约束兜住它：

1. 改 Checklist 条目时，**同步改掉所有引用它的 `case.md`**（`grep AC-NN tests/`）
2. 交付前的 **AC 时效性反查**连 `case.md` 的内嵌原文一起核：与 Checklist 不一致 → 判不一致项，必须修

> ⚠️ 高频错误：把 SQL 写进 `RESULT.md`、或 `RESULT.md` 只有一句「✅ 通过，依据：xxx」。
> 前者让复跑入口失效，后者让别人（和几天后的你）完全无法复现。
> **判据：把 `RESULT.md` 删掉，剩下的 `REPLAY.md` + `evidence/` 仍足以独立复跑并得出同一结论。**

> 🔴 **一条用例只验证一个测试点**：合并写法失败时定位不到是哪个点挂了，且前一个断言一失败，后面的根本不会执行——**被掩盖的缺陷会一直躺到线上**。
> 一个 AC 需要验多个点时，在 `case.md` 里拆成编号小节（`1.1 / 1.2 …`），`evidence/` 与 `RESULT.md` 按同样的编号对应。

#### 🔴 证据形式优先级：**能录像就别截图，能截图就别只写字**

同一个结论，证据形式不同，可信度差一个量级。**按下表从上往下选，拿得到上面的就不要用下面的顶替**：

| 优先级 | 形式 | 什么时候用 | 为什么排这个位置 |
|---|---|---|---|
| **1** | **录屏 `.mp4` / `.webm`**<br>**动图 `.gif`** | 任何**多步操作**或**带时序**的验证：loading→成功、二次确认、动画、跳转、拖拽、轮询刷新 | 唯一能呈现**过程**的形式。静态图只能证明"某一刻长这样"，证不了"点了之后真的会这样" |
| **2** | **截图 `.png`** | 单一静态结果：最终页面、弹窗、错误文案、置灰按钮、空状态 | 直接记录**用户实际看到什么**，复核者不用搭环境就能判断 |
| **3** | **抓包 `.har` / `.json`**、**查询结果 `.csv`/`.txt`** | 契约字段核对、数据对账 | 证明"系统做了什么"，但**隔着渲染层**——接口对了不等于页面显示对了 |
| **4** | **日志 `.log`**、终端输出 | 无 UI 路径（定时任务、MQ 消费、纯后端分支）的兜底 | 只能间接推断，且容易只截取对自己有利的片段 |
| **✗** | 纯文字转述 | —— | **单独使用不算证据**。"经验证功能正常"这类句子无法被复核，等同于没测 |

**硬规则**：

- 该 AC **只要有 UI 可见结果**，就**必须有第 1 或第 2 类**；第 3、4 类是**补充**，不能替代
- **GIF 与录屏怎么选**：≤10 秒的短交互用 `.gif`（能直接贴进 Jira / PR，不用下载就能看）；长流程或需要看清文字细节用 `.mp4`/`.webm`
- 🔴 **降级必须写明理由**：拿不到高优先级证据时，在 `RESULT.md` 写一行
  `证据降级：因 <具体原因> 无法录屏/截图，改用 <实际形式>`
  —— 例如"该 AC 为 MQ 消费无页面入口"、"录屏工具在本机 headless 下不可用"。
  **没写理由的降级视为偷懒，等同未留证**
- **拿不到录屏时的次优解**：别直接跳到日志。先用**关键帧连拍截图**——操作前 / 操作中（loading）/ 操作后各一张，
  按 `{AC-NN}-01-before.png`、`-02-loading.png`、`-03-after.png` 连号命名，在 `RESULT.md` 里按序说明。
  连拍序列的可信度接近录屏，远高于单张图
- **一张图只说明一件事**：文件名要能独立读懂（如 `AC-07-02-分享弹窗-邮箱渠道-标注.png`），
  不要用 `1.png` / `截图1.png`，也不要把五个结论挤进一张长截图

> **为什么强调这个**：日志和抓包是"系统视角"，而验收要回答的是"**用户看到的对不对**"。
> 两者之间隔着渲染、权限、i18n、缓存好几层——接口返回 200 而页面白屏、字段对了而文案是中文、
> 数据回来了而按钮还是灰的，这些**只有画面能暴露**。
> 另一个现实原因：录屏和截图**复核成本最低**。别人不用搭环境、不用读你的 SQL，扫一眼就能判断真假，
> 这让证据真正可被质疑——而不是只能选择相信。

#### 轨道 A — 数据核对（只读 SQL 对账）

`REPLAY.md` 必须包含，缺一不可：

1. **完整可执行的 SQL**，不是片段、不是伪代码。跨库时用**全限定表名**（`db.schema.table`），
   SQL Server 加 `WITH(NOLOCK)`；直接复制粘贴就能跑。
2. **数据源标注**：哪个实例、哪个库、哪个环境（测试 / 预发 / 生产只读）。
3. **口径出处**：SQL 照抄自哪个 mapper 的哪一段，标 `证据：<file>:<line>`。
   🔴 **禁止凭字段名自己编一条当基准** —— 动态 SQL 拼出来的和人肉照抄的经常不一样。
4. **只读声明**：`⚠️ 只读 SELECT，禁止改写为写操作`。
   **生产库允许只读核对**（用户 2026-10-14 确认）：本机联调后端与 mysql MCP 连的就是生产 US，
   所以「在生产库执行」本身不算违规 —— **违规的是写操作、查与本次 AC 无关的数据、无过滤条件扫大表**
   （口径见 `data-reconciliation.md` §1 / §9）。
5. 大表查询带 `profileId` / `advertiserId` + 有界日期区间（否则被只读门禁拒绝）。

`evidence/` 对应放**实际返回**（一个 SQL 一个文件，文件名与 REPLAY 小节同名）：

- 文件头两行写**执行时间 + 数据源**，并注明「对应 SQL 见 ../REPLAY.md 的 xx 小节」。
- **结果很多时截取能说明问题的部分即可**，但必须写明**总行数**与**截取规则**
  （如「共 413 行，取 vap 行数 Top5」），不得只贴几行就当全貌。
- 0 行也是证据 —— 原样记录 `No results returned` 并注明「0 行 = 无重复」这类解读。
- 数字对不上时**原样记录差异**，再另起一段写追因；**禁止改 SQL 让它对上**。

#### 轨道 B — 页面测试（Agent 实机验证 / 人工回归）

因前端不写单元/组件测试，产不出 `script/`，由 `REPLAY.md` 承担「可复跑」职责。必须包含：

1. 🔴 **环境 URL + 实际登录的账号**。必须写明**具体是哪个账号**（用户名/邮箱）、
   它的**角色与权限范围**、**所属 client / 可见 profile**，而不是只写「用管理员账号」
   或「有权限的用户」—— 换个账号结论就可能不同，尤其是权限类 AC（能看到 / 看不到 / 跨客户不可见），
   账号本身就是被测变量。**禁止写密码**（凭据由人工输入，Agent 不代输）。
   多账号对照的 AC（如"有权限 vs 无权限"）必须**逐个账号各写一段步骤与预期**。
2. **前置数据**：依赖哪条数据、怎么确认它存在（给出查询或页面位置）。
3. 🔴 **编号操作步骤，细到可照做**：点哪个按钮（按钮文案）、展开哪个下拉、
   勾选哪个筛选项、输入什么值、点第几行 —— 禁止「筛选一下」「进入详情页」这种粒度。
4. **每步的预期**：页面应出现什么、不应出现什么。
5. **预期 XHR**：Method + URL + 关键请求参数 + 关键响应字段。
6. 写操作步骤单独标注并要求逐项授权；验证后如何清理。

`evidence/` 放截图（关键区域可见、含筛选条件）、抓包（`.har`/`.json`）、控制台日志。
**截图必须能自证是哪一步**：带上页面标题/筛选条区域，必要时在文件名里写步骤号。

#### evidence 的硬性要求（**这条最容易被糊弄**）

✅ 算证据：查询的原始返回、`mvn` 的原始输出行、截图、`.har`、日志原文、退出码。
❌ 不算证据：「看起来正常」「应该没问题」「逻辑上不会发生」「和预期一致」这类转述与推断；
也不算证据的还有——**只写结论不写来源的数字**（如「共 2239 条」却不给产出它的 SQL）。

三条硬约束：

1. **可追溯**：每份 evidence 都能指回 `REPLAY.md` 里某个具体命令/SQL/操作步。
2. **可复现**：按 `REPLAY.md` 重跑，应得到同一结论（数据会变，结论不该变）。
3. **不美化**：失败、差异、未覆盖的部分**原样留在证据里**，在 `RESULT.md` 里解释，
   而不是把证据删掉换成一句「已修复」。

> 🔴 **数字必须交代出处。** 曾发生：拿 `SELECT COUNT(DISTINCT client_id) FROM asset_info`（1315）
> 去对比接口返回的 3785，据此判定「环境不一致」并中止验证；实际接口走的是另一张表
> `client_setting`（3787）。**比对口径错了，不是环境错了。**
> 对账前先回答「这个数字是哪条 SQL 产出的」，别按字段名或直觉推断。

#### 其它

- 🔴 **证据文件命名（用户硬要求：文件名内容用中文）**：`AC-NN-序号-<中文描述>-<类型>.<ext>`
  - **中文描述**写这张图 / 这段录屏证明的判定点，读文件名就知道看什么（≤ 30 字），例：`第1页广告名称列只显示Ad名称`、`进度停在100%约0.5秒`
  - **类型后缀**用中文：`-原图`（整页原始截图）/ `-标注`（裁剪 + 放大 + 框 + 框边文字的标注版）/ `-录屏` / `-动图`；原图与标注图**同一序号成对**
  - 例：`AC-08-01-第1页广告名称列只显示Ad名称-原图.png` + `AC-08-01-第1页广告名称列只显示Ad名称-标注.png`；多轮复验加轮次前缀 `AC-94-r6-03-进度停在100%约0.5秒-标注.png`
  - 只有标识符保持原样：`AC-NN`、`rN` 轮次、jobId、字段名、接口路径、页面上的英文 UI 文案
  - Windows 文件名禁用 `\ / : * ? " < > |`，遇到就删掉或换全角
  - 旧证据里的 `-annotated` / 英文描述**不用回头改名**（验收照认），新产出一律按本条
  - 同一 AC 多轮执行在 `RESULT.md` 标注轮次与环境，**不覆盖旧证据**。
- 💡 **建议：证据文档用中文**（建议项，不进门禁、验收不因此判不通过）：`case.md` / `RESULT.md` / `REPLAY.md` / `NOTES.md` / `tests/README.md` 及验收报告的**标题、小节名、正文、表头、结论词**都用中文
  （如「验收原文」「复跑步骤」「结论：通过 / 失败 / 阻塞 / 部分」，不写 `Result` / `Steps` / `PASS` / `Evidence`）；截图标注文字同样用中文（文件名是硬要求，见上一条「证据文件命名」）。
  **保留英文 / 数字的只有标识符**：`AC-NN` / `R-NN` / `Q-NN` / `D-NN` 编号、`-r6-` 等轮次前缀、Jira 号、接口路径、字段名、类名 / 方法名、代码与日志原文、页面上的英文 UI 文案（按原样引用）。
- `docs/develop` 已被 `.gitignore` 忽略 → 图片/视频放这里不污染仓库，可放心存大文件。
- **别和仓库内的测试代码混淆**：单测**本体**仍放 `**/src/test/java/...`（不进 docs）；
  本目录放的是**用例 + 复跑入口 + 证据**。
- **没有留证的 AC = 没测**：Step11 自检与 Step12/Step13 审查都按 `tests/AC-NN/` 是否齐全判定。

### 验证进度看板（自动产出：每条 AC 登记后自动刷新；Step11.4 收尾、11.6 终验后再刷一次）

```
docs/develop/<需求目录>/验证进度看板.html   # 单需求看板（含整体进度/用例状态/证据/耗时/证据终验）
docs/develop/index.html                     # 外层总览：所有进行中需求（排除 archived / tools），可切换查看
```

- 生成（同时刷新外层总览）：`py scripts/verify_dashboard.py --dir docs/develop/<需求目录>`
- 只重建外层总览：`py scripts/verify_dashboard.py --all --develop docs/develop`
- 直达某需求详情：`index.html#/<URL 编码后的需求目录>`（目录名含中文和空格，不编码链接点不开；可直接书签/分享）；详情页左上角「← 全部需求」返回总览
- 🔴 **打开方式：一律服务模式**（与 SKILL.md 执行指令 1.5 同口径）：先探测 `http://127.0.0.1:8787/api/ping`，通 = 常驻服务已在；不通再起 `verify_dashboard.py --all --develop docs/develop --serve --port 8787`。服务模式下每次请求现场解析磁盘（内容实时）、「需求问答」页签可编辑保存、需求可归档。
  `py -m http.server 8787 --directory docs/develop` 或 `file://` 双击**只作服务起不来时的只读降级**：**不能保存、不能归档**；只有用例状态 registry 每 5s 轮询 `tests/.verify-state.json` 实时刷新，证据清单 / Checklist / 流程步骤 / 回归项是生成时快照；`file://` 下浏览器还会拦截本地 fetch，整页降级为「生成时快照」并提示横幅。
- 🔴 **刷新时机**：`verify_state.py` 的 `claim` / `fix` / `finish` / `final` / `reclaim` / `invalidate` 等登记成功后**自动**重跑生成器（加 `--no-dashboard` 才跳过，禁止为省时间跳过）；`validate_step.py --record` 也会顺带重建。不走登记的手工改动（如直接改 `RESULT.md`）改完手动跑一次 `verify_dashboard.py --dir <需求目录>`。
- 🔴 **看板是辅助产物，不是门禁**：缺失或过旧只提示，不判 FAIL，不改变任何交付结论。
- 证据**弹窗内联预览**：图片 / 视频直接看，`.md`（RESULT.md / REPLAY.md / case.md）与 `.json` / `.har` / `.log` / `.txt` / `.csv` 内联渲染成文本；Excel 等二进制回退「新标签打开 ↗」。`file://` 下浏览器禁止本地 fetch，文本预览不可用（会有提示），用 http 打开即可。
- **证据终验**（11.6，独立维度、不重跑浏览器）：明细有「终验」列与筛选（未终验/终验中/终验通过/终验不通过/豁免；`豁免` 仅限用户明确放行、Checklist 置 `[waived]` 时使用，`--note` 必写放行范围与用户原话），总览有「证据终验」卡片（终验通过/已完结），风险里「终验不通过」= 高风险、「已完结但未终验」= 低风险（会聚合成一条）。登记用 `verify_state.py final`。
- 数据源（全部可选，缺失即降级）：`tests/.verify-state.json`、`.workflow-state.json`、`Step 3-Checklist.md`、`tests/AC-NN/`（case.md / REPLAY.md 或 script/ / evidence/ / RESULT.md）、`Step *-回归验证清单.md`。

## 二、项目上下文适配

### 后端（creative-management，Spring Boot 微服务）

模块（以仓根 `pom.xml` 的 `<module>` 为准，别背名字）：`creative-management-api`（Controller/Manager/Handler）、
`creative-management-base`（Service/Mapper）、`creative-management-model`（DTO/VO/枚举）、
`creative-management-feign`（对外 Feign 接口）；依赖方向 api → base → model。

额外遵循：
- 数据库 → `.agents/database.md`（MyBatis/事务）
- API 设计 → `.agents/api-design.md`（RESTful/DTO）
- 代码规范 → `.agents/code-standards.md`、架构 → `.agents/architecture.md`
- 测试规范 → `.agents/testing.md`（Feign Mock 规则）
- 分页继承 `BasePageReq`（pageIndex/pageSize/sortField/sortOrder/isAsc()）
- 用户名查询用 `businessAware.getUserNameByIds(AMAZON, ...)`

### 前端（vuen-crossretail / packages/creativehub，Vue）

- 若本仓库不含前端代码：Step4 前须用 `AskUserQuestion` 确认前端仓库路径与技术栈，确认后沿用到 Step7/10/11。
- 前端为独立仓库时：前端代码写入该仓库对应源码目录；设计文档仍统一放本仓库 `docs/develop/...`。
- **技术栈必须沿用既有栈**（本工作区前端为 Vue 3 + TypeScript；UI 按项目既有组件库）；未指定且无法确认时**必须询问用户**，禁止默认按 React 推断。
- **复用优先（强制）**：组件优先复用既有 Pacvue 组件（见 vue3-component.pacvue.com 组件库）；通用工具/逻辑（日期、金额、时区、防抖、下载、事件总线、存储、请求、i18n 等）必须先查 **pacvue-common-utils**（含对应 skill），禁止重复造轮子。
- 用户可见的错误文案必须为英文友好文案，不得暴露原始 `parseFailReason` / API code / 异常堆栈（参见 lessons L13/L16）。

### 多仓提交约定（Step13 交付收尾必读）

本工作区**不是**单一 git 仓库，改动落在哪个仓库就只在那个仓库提交：

| 仓库目录 | 角色 | 提交信息格式 |
|---|---|---|
| `creative-management/` | 后端 Java（独立仓） | `feat:CP-xxxxx 描述`（type 后可紧贴票号） |
| `vuen-crossretail/` | 前端外层宿主（主要跟踪 `packages/main`、`packages/crossretail`） | `feat: CP-xxxxx 描述`（Husky+commitlint 强校验，header ≤72） |
| `vuen-crossretail/packages/creativehub/` | Creative Hub 模块（**嵌套独立仓**） | 同外层前端格式 |
| `platform-provider/` | 平台侧 provider（独立仓，按需） | 见根 `AGENTS.md` 的 Monorepo layout（「commit separately per project」）；按该仓既有 commit 规范 |

- **硬性规则**：前后端分别提交；creativehub 变更必须在嵌套仓内提交，**不要**提交到外层；跨仓同一需求 = 多次独立 commit（可用同一 JIRA 号）。
- **提交前先读对应仓库 `.gitignore`**；禁止 `git add .` / `-A`；禁止 force-add 忽略目录；外层出现 `packages/creativehub` 变更时用 `git rm -r --cached packages/creativehub` 清理（保留磁盘文件）。
- 只推 feature 分支，禁 push main/master/release，禁 `--force`。

## 三、执行检查清单（AI 自检）

每步完成后自检：
- [ ] 产出物已落地为文件？设计文档在统一目录下？
- [ ] 严格使用了上一步产出物作为输入？`validate_step.py --step N --record` 已 PASS？🔴 阻塞档已暂停并拿到用户明确确认、🟡 通知档已一句话汇报（门控档位见 SKILL.md）？
- [ ] Step1 覆盖 7 个维度提问（功能边界 / 异常场景 / 数据来源 / 前后端交互 / 权限角色 / 非功能 / 影响范围）？Step2 Spec 无技术细节并采用 proposal 模板？
- [ ] **零臆测**：本步所有事实性判断都有取证（`file:line` / 文档出处）或已列入提问？有没有靠"通常/应该是/按惯例"填的空？（全程适用，非仅 Step1）
- [ ] **影响面**：同类场景扫过六类了吗（读取口径/其他入口/其他平台/读写两侧/枚举副本/其他调用方）？Step4 影响面清单每项都判定了"需改/不需改+理由"？"需改"项都有对应 `AC-NN`？（全程适用）
- [ ] **全局落点**：改动落在正确的层了吗（同类点 ≥2 处应上提共享层，=1 处就地改）？上提的改动有没有重新扫一遍该层其他调用方？有没有就地打补丁 / 新增并行副本？
- [ ] **变更类型分流**：Step1 已判定 A/B/C 并经用户确认？跳过的步骤在 Spec 文首写明理由？执行中未超出判定范围（超出已升档）？
- [ ] **回归验证**：《Step 8-回归验证清单》已产出且不为空（或写明零回归依据）？每条 `R-NN` 有验证方式？结论已由 Step11.3/11.4 回填？
- [ ] **破坏性变更**：Step6「既有端点变更」表已出（或写明无）？🔴 项已问过用户并选定方案？其他调用方已 Grep 求证并适配？
- [ ] **根因优先**：11.2 每个失败都归过类？没有为过测而放宽/删除断言？同一用例未连续 2 次只改测试？
- [ ] Step3 Checklist 只含用户可感知操作流（无 API/DDL/错误码），按测试执行顺序，多入口用 COMMON/入口前缀？
- [ ] Step4 是否产出两份技术文档，且各含复用点清单（后端 Service/DTO + 前端组件/工具）与非功能需求落地映射表（零未映射）？
- [ ] Step5 DDL 落地了映射表的索引/乐观锁？声明手动执行方式？配套 ddl-rollback.sql？
- [ ] Step6 API 文档标注了限流/幂等/缓存/权限/分页最大 pageSize？且被前端步骤严格引用？
- [ ] Step7 前端设计严格基于 Step6 API 契约？组件复用清单与第八步矩阵可追溯？
- [ ] Step8 后端矩阵每 Checklist 条目 ≥4 分支（正向/边界/异常/业务约束）且写明断言（供单测）？前端矩阵写明验证预期（人工验证清单，前端不写测试代码）？
- [ ] **测试用例质量**：每条用例只验证**一个**测试点（没把多场景合并）？每个分支标了 `P0/P1/P2`？矩阵逐条完整、**没有出现「其余同理」「…（略）」这类省略**？
- [ ] **矩阵自评**：落盘前过了覆盖率/逻辑性/规范性三维？6 条判定项（无前置条件、模糊预期、缺业务约束分支、一条多测试点、未标优先级、折叠省略）全部不命中？自评表附在矩阵末尾、问题精确到 `AC-NN`+分支号？
- [ ] Step9 tasks.md 每条任务标注 `[P0|P1|P2]` + `[~Nh]`，含前后端任务组、依赖顺序与汇总行？
- [ ] Step10/11/12 全程未 git add/commit？
- [ ] Step10 逐条编码（未一次性写完）？强制复用既有点？逐条落地非功能需求映射表代码落点？未写测试？
- [ ] Step11 业务代码完成后才写**后端单测**（11.1，前端不写测试）→ 编译自愈（11.2）→ 逻辑自检（11.3）→（可选）浏览器实机验证（11.4：先出《浏览器验证步骤》并获授权，再开浏览器抓 XHR 取证）？自检报告全部 ✅？
- [ ] Step12 已执行合规 A~F（含前后端契约一致性、lessons 合规）+ 缺陷猎捕 G？修复是否触发变更影响重新评估（已处理）？
- [ ] Step13 已执行 A~E 一致性审查 + F 证据验收（独立 subagent）？A~E 是否全部 ✅ 或 ⚠️ 已修复？`validate_step.py --step 13` 的前序步骤复检 / 用例状态 vs RESULT / 回归清单汇总 / 交接文档时效 / tasks 全部勾选（含回归任务组）均已通过？
- [ ] Step13 结论为 PASS？前后端各仓分别提交、只 add 相关文件、禁 git add .、符合各仓 commit 规范、推 feature 分支？DDL 已提醒手动执行？
- [ ] 各步由脚本产出的自动化报告已复制到 docs 目录并加 Step N- 前缀？
- [ ] 测试证据按 AC 归档了？`docs/develop/{...}/tests/AC-NN/` 下 `case.md` + （`script/` **或** `REPLAY.md`）+ `evidence/` + `RESULT.md` 齐全，且 `tests/README.md` 索引与之一致？**缺证据的 AC 视为未测**。
- [ ] 执行了 11.4 时：进场检查四项已过（含登录态确认）并记入 `tests/README.md`？逐 AC 一闭环取证（非事后补证、记了 marker）？报告 E 表写明脏数据是否已清理与责任人？F 表逐仓 `git status` 确认无残留调试代码（L17）？并行了多个会话时：`tests/.verify-state.json` 与实际一致（无僵尸「验证中」）、每条 AC 的窗口标识互不重叠？
- [ ] 11.4 收尾已刷新看板（`verify_dashboard.py --dir …`）且外层 `docs/develop/index.html` 同步？`tests/README.md` 顶部有看板链接？
- [ ] 执行了 11.6 证据终验？所有已完结 AC 都给了终验结论（无「未终验」遗漏、无「终验不通过」），且终验不通过的都已按「发现问题」处理或明确记录？

---
name: "ai-driven-fullstack-workflow"
description: "14-step fullstack dev workflow (Q&A→SPEC→Checklist→Plan→DDL→API→FrontendDesign→TestMatrix→Tasks→Coding→Test+Debug+SelfCheck→AIReview→GlobalConsistency→AC-SubtaskHandover), covering backend + frontend, per-step human review gating, contract-first, backend unit tests written after all business code (frontend needs NO unit/component tests), optional AI-driven browser verification with XHR capture, docs auto-created from a Jira key in docs/develop/{sprint}-{id}-{title}/, every Step1 question offers a 需要跟产品经理确认 option and ends with a PM-pending list. Spec uses OpenSpec proposal template; tasks.md uses OpenSpec tasks template. Invoke when developing fullstack features needing both backend and frontend, or user mentions 前后端/全栈/frontend+backend/PRD/BDD/TDD."
---

# AI 驱动型全栈开发全流程操作手册（AI-Driven Fullstack Workflow）

> **本 SKILL.md 是精简索引**：每步完整明细在 `references/step-NN-*.md`。执行到某步前先 Read 对应 reference 文件。
>
> 本流程 = 后端工作流（`ai-driven-backend-workflow`）的全部成熟机制（tasks.md 逐条编码、业务逻辑自检、全局一致性审查、经验教训库、OpenSpec 模板内嵌、交付收尾规范）+ 前端专属步骤（前端设计 / 前端人工验证 / 前后端契约一致性审查）。**前端不写单元测试/组件测试**（用户约定）。仅后端需求用 backend 工作流；纯前端页面美化（无接口改动）不必走本流程。

## 核心原则（CRITICAL）

> 15 条，每条一句话。**细则在 `references/` 对应文件里**，别在这儿找完整规则 ——
> 这里只负责"让你想起来有这么回事"，想不起来的规则等于不存在。

| # | 原则 | 细则在哪 |
|---|---|---|
| 1 | **先分流再执行** — Step1 先判变更类型（A 新功能走全 14 步 / B 增强可跳 Step5、7 / C Bugfix 走精简路径），经用户确认后写入 Spec。分流**只降流程密度、不降质量门**；判不准按高一档走 | `step-01` §0 |
| 2 | **顺序不可跳跃 + 门控分两档** — 上一步产出物是下一步的强制输入；🔴 **阻塞门控**（拦不可逆/对外的事）必须暂停等确认，🟡 **通知式门控**汇报后直接继续、有异议再回退 | 见下「门控档位」 |
| 3 | **零臆测** — 事实性判断必须三选一：就地取证（标 `证据：file:line`）/ 文档取证 / 问用户。禁止「通常、应该是、按惯例」，禁止从命名推断语义 | `step-01` §零臆测 |
| 4 | **影响面反查 + 全局落点** — 每次改动先问「还有哪些地方是同一件事」并 Grep 求证；同类点 ≥2 处上提共享层，=1 处就地改，**禁止就地打补丁** | `step-01` §影响面、`step-04` |
| 5 | **回归优先于新增** — 流程默认只验"新需求做对了"。Step8 强制产出《回归验证清单》（`R-NN`），未验证的 `R-NN` 与未实现的 AC 同等对待 | `step-08`、`step-04` |
| 6 | **改既有接口 = 破坏性变更** — Step6 必须出「既有端点变更」表，🔴 项**必须显式问用户**选方案，禁止 AI 自行决定 | `step-06` |
| 7 | **前后端契约先行** — Step6 API 契约是唯一桥梁，前端任何步骤不得脱离它臆造字段 | `step-06`、`step-07` |
| 8 | **复用优先 + 非功能全程追溯** — Step4 复用清单与非功能映射表逐条落地到 DDL/代码/API/前端，禁止停留在"需考虑" | `step-04` |
| 9 | **产出物必须落地 + 统一目录** — 禁止仅对话产出；全部进 `docs/develop/{Sprint}-{id}-{title}/`（按 Jira 号自动建，见 `doc-output` §启动） | `doc-output-and-context.md` |
| 10 | **AC 编号即追溯主键** — `AC-NN` 全局连续、零填充两位、宽度统一；Step8/9/11/12/13 一律按它引用与反查，任一处缺席判漏实现 | `step-03` 核心约束 4 |
| 11 | **测试延后 + 逐条编码** — Step9 拆任务 → Step10 一条条喂；后端单测在业务代码全部完成后（Step11.1）统一写，**前端不写单测/组件测试**（用户约定） | `step-09`、`step-10`、`step-11` |
| 12 | **测试全 Pass ≠ 需求实现** — Step11.3 强制业务逻辑自检；Step11.2 **根因优先，禁止改测试绕过**（禁放宽/删断言、禁 `@Disabled`） | `step-11` §11.2/11.3 |
| 13 | **验证必须留硬证据** — 证据按 `AC-NN` 归档（`case.md` + `script/`或`REPLAY.md` + `evidence/` + `RESULT.md`），**能录像就别截图，能截图就别只写字**，**截图证据一定要标注**（框住判定点 + 框边写文字说明，未标注的截图不算证据，规则见 `browser-verification-playbook.md` §4.1），随走随落禁止事后补证；**没留证的 AC 视为未测** | `doc-output` §一 |
| 14 | **数据核对：接口返回对 ≠ 数据对** — AC 含具体数值/条数/聚合结果时，Step11.5 必须用只读 SQL 对账；全程禁写操作，**禁止改 SQL 让它对上** | `step-11` §11.5 |
| 15 | **禁止中途提交 + 交付前双重门禁 + 提测终态** — Step10/11/12 全程禁 `git add/commit`；必须 Step12 AI Review + Step13 全局一致性审查（含独立证据验收）PASS 且人工审批后才提交并产出《测试交接文档》；Step14 提测状态（与验证态分离）须落到终态 `已提测` 或 `无需提测` | `step-12`、`step-13`、`step-14`、`test-handover.md` |

**门控档位**（编码前只剩 3 道阻塞门，其余降级为通知式）：

| 档 | 在哪几步 | 怎么走 | 为什么是这档 |
|---|---|---|---|
| 🔴 **阻塞** | **③ Spec+Checklist**（合并确认）、**⑤ DDL**、**⑥ API 契约**、**⑪.3 业务逻辑自检**、**⑫ AI Review**、**⑬ 提交**、**⑭ 是否提测**，以及贯穿全程的**写操作授权** | 汇报 → **暂停等用户明确确认** → 才继续 | 拦的是**不可逆**（DDL 手工执行、git 提交、写 Jira、写数据）或**对外承诺**（API 契约、进了 Jira 的 AC）或**范围错了全白做**的事 |
| 🟡 **通知式** | ② Spec、④ 技术方案、⑦ 前端设计、⑧ 测试矩阵、⑨ tasks、⑩ 编码、⑪.1 单测 | 落盘 → 跑 `validate_step.py`（FAIL 必须修到通过）→ 一句话汇报 → **直接继续** | 产出物是文档/代码，**改起来几分钟且未产生不可逆后果**；用户随时可提异议，收到异议**回退重做本步及其下游** |

🔴 **降级的是"等人点头"，不是"不检查"**：`validate_step.py` 每步照跑，FAIL 等同本步未完成。
这么分的理由：人被要求连续点 9 次「通过」，第 5 次之后就不看了 —— 门控不是变慢，是**静默失效**，
而且比没有门控更糟（给了虚假的安全感）。把注意力省给真正拦不可逆事项的那几道门（同 L18 的道理）。

**三条贯穿全程的红线**（不分步骤，任何时候都适用）：

- 🔴 **浏览器实机验证（Step11.4，可选）**：AI 必须主动询问、用户明确同意才执行；禁生产环境、禁 AI 代输凭据；**「给了可用账号」≠「写操作被授权」**，每一次写都要单独问 → `step-11` §11.4
- 🔴 **变更影响重评估**：修复若触发跨层改动 / 范围扩散 / 非功能回归 / 架构突破，强制回退对应步骤重审 → `step-12`
- 🔴 **机器验收优先于口头确认**：每步产出后跑 `validate_step.py`，**FAIL = 本步未完成**，与人工 Review 同等效力 → 见下文「配套脚本」

**另有两条机制**：经验教训对照（每步前查 `lessons-learned.md`，Step12/13 做合规检查）；来源冲突裁决（用户最新指令 > 截图/设计稿 > PRD > 本地技术文档 > 代码现状，**代码现状不自动等于需求**）。

## 触发条件（When to Invoke）

- 用户提到"前后端开发 / 全栈开发 / fullstack development"
- 用户提供了 PRD 文本、UI 界面截图、业务背景描述，要求**同时**开发后端接口和前端页面
- 用户提及 "BDD / TDD / Checklist / 需求拆解" 且需求涉及前端 UI 交互
- 用户要求按规范流程开发一个完整的全栈业务模块
- 用户明确说"按全栈流程"或"按十四步流程"

> 若需求**仅**后端（无前端 UI），用 `ai-driven-backend-workflow`；**纯前端页面美化/静态页面**（不碰接口与数据）不必走本流程。

## 工作流总览

| 步骤 | 名称 | 输入 | 产出物 | 明细 |
|------|------|------|--------|------|
| 1 | 需求澄清 Q&A（每题带「需要跟产品经理确认」选项） | Jira 号 + PRD/UI/业务背景 | Step 1-需求澄清问答记录.md（含待 PM 确认清单） | `step-01-requirements-qa.md` |
| 2 | Spec(OpenSpec proposal 模板) | Q&A+PRD/UI | Step 2-Spec.md | `step-02-spec.md` |
| 3 | 结构化 Checklist（前后端共享；用户操作流、按测试顺序、AC-NN 全局编号、COMMON/入口前缀、**写全称不互相引用 + 每条图示 + 文首一页读懂（联动总览 / 全貌标注图 / 字段速查）**、可选代码 gap-check 与 Jira 同步） | Spec | Step 3-Checklist.md(BDD) + Step 3-Checklist-Jira.txt(可拷贝纯净版) | `step-03-checklist.md` |
| 4 | 技术方案（后端+前端两份；含复用清单+非功能映射表） | Checklist+技术栈 | Step 4-后端/前端技术设计与实现方案文档.md | `step-04-plan.md` |
| 5 | DDL（承接非功能索引/乐观锁落点） | Checklist+计划+已有表 | Step 5-ddl.sql + ddl-rollback.sql(+data-backfill) | `step-05-ddl.md` |
| 6 | API 契约（前后端共享；含限流/幂等/缓存/权限/分页） | Checklist+DDL+RESTful | Step 6-API接口定义文档.md | `step-06-api.md` |
| 7 | 前端页面与组件设计 | Checklist+API 契约+UI 图 | Step 7-前端页面与组件设计文档.md | `step-07-frontend-design.md` |
| 8 | 测试用例矩阵（后端单测分支 + 前端人工验证清单 + **回归验证清单 `R-NN`**） | Checklist+API 文档+前端设计+Step4 回归候选 | Step 8-后端/前端测试矩阵.md + **Step 8-回归验证清单.md** | `step-08-test-matrix.md` |
| 9 | 任务拆解（P0/P1/P2+估时，前后端任务组） | Step1~8 全部产出 | Step 9-tasks.md | `step-09-tasks.md` |
| 10 | 逐条编码（后端+前端；复用+非功能落点；禁单测；**禁 git**） | tasks.md | 前后端生产代码 | `step-10-coding.md` |
| 11 | 后端单测(前端不写测试)+编译自愈+逻辑自检+浏览器实机验证(可选,AI 开浏览器+抓 XHR)+**数据核对(只读 SQL 对账)**+**测试证据按 AC 归档**（**禁 git**） | 业务代码+测试矩阵+API文档+日志 | 全 Pass 后端单测 + Step 11-业务逻辑自检报告 +(可选)Step 11-浏览器验证步骤+实机验证报告 + **tests/AC-NN/{case.md, script/ 或 REPLAY.md, evidence/, RESULT.md} + tests/README.md + tests/.verify-state.json（用例状态/窗口登记） + 验证进度看板.html（+ 外层 docs/develop/index.html）** | `step-11-test-debug.md` |
| 12 | AI Review（合规五维 + **缺陷猎捕** + lessons）（**禁 git**） | Step3/6/8文档+Step10/11代码 | Step 12-AI Review报告 | `step-12-ai-review.md` |
| 13 | 全局一致性审查+交付收尾（**唯一允许 git 提交**） | Steps1~12 全部产出物 | Step 13-全局一致性审查报告 + **Step 13-证据验收报告**（独立 subagent）+ **Step 13-测试交接文档** + 提交 | `step-13-global-consistency-review.md`、`evidence-acceptance.md`、`test-handover.md` |
| 14 | **AC ↔ Subtask 匹配与提测**（与验证态分离） | Checklist 全量 AC + 父票 Sub-task | `Step 14-AC-Subtask映射.md` + `.handover-state.json`（终态：`已提测` / `无需提测`）；确认提测则 Jira→Testing 并转交 `biao.mu@pacvue.com` | `step-14-ac-subtask-handover.md` |

## 其他 reference

- `doc-output-and-context.md` — 目录规范 + 多仓提交约定 + 项目上下文 + 自检清单。**Step1 前必读**。
- `openspec-integration.md` — OpenSpec 步骤映射、已搬入模板及原因。
- `lessons-learned.md` — 经验教训库，每步前对照相关 lesson。
- `lesson-harvest.md` — **经验沉淀**：四道准入（代价闸 / 抹名测试 / 落点选择 / 动作化）+ 查重并入 + 容量淘汰 + 提名门控。默认结论是「本次无新增经验」；落点由「执行时 AI 正在读哪个文件」决定，不是一律进 lessons 库。**Step14 提测终态之后**必读。
- `data-reconciliation.md` — **数据核对**（只读 SQL 取证）：只读门禁、可用连接、绩效查询硬约束、SQL 必须从既有 mapper 推导、口径对齐、取证落盘、对不上怎么逐层二分。**只在 AC 的预期含具体数值/条数/聚合结果时才需要读**。
- `test-handover.md` — **提测交接文档**的必含项、禁止透传项与模板。Step13 必读。
- `step-14-ac-subtask-handover.md` — **AC↔Subtask 匹配与提测**：独立提测状态（`待匹配`/`已匹配待确认`/`已提测`/`无需提测`）、匹配规则、确认后门控、Jira Testing + 转交。Step14 必读。
- `browser-verification-playbook.md` — **浏览器实机验证**：只读红线、**动手前必读脚本分层**（CDP `SCRIPTS.md` 全局层 → `projects/<项目>` 页面层脚本 + `PAGE-NOTES.md`；禁止现写探针）、工具选型与 CDP、未登录交接、驱动 UI 的高频坑、截图标注、走读证据、权限类验收、找账号、提速、多会话并行。实机验证前必读；收尾按层回写（坑→SCRIPTS，页面操作→projects/笔记）。
- `evidence-acceptance.md` — **证据验收**：独立 subagent 以验收测试专员身份盲审 + 对账，逐 AC 判定证据能不能通过验收（验收通过 / 验收不通过）。Step13 必读。
- `figma-ui-cache.md` — **Figma 设计稿缓存**：用环境变量 `FIGMA_API_KEY` 直接调 REST API（插件 needs_auth 时也能读），把节点缓存到需求目录 `figma/`（截图 + 结构 / 样式摘要 + 原始数据），再由 AI 填「区域 / 对应 AC」「关键样式」「与文档的差异」三张表。**用户给 Figma 链接时、Step7 设计前、Step10 前端编码前**读。
- `bug-hunting-checklist.md` — **缺陷猎捕清单**（输入边界/空值/并发/事务/SQL/权限/回归面…）。Step12 维度 G「缺陷猎捕」必读；它问的是「什么输入下会错」，不是「符不符合文档」。

## 自进化机制

Step14 提测终态落定后做**经验沉淀**：四道准入（代价闸 → 抹名测试 → 落点选择 → 动作化）+ 查重并入 → **只产出提名表，用户确认后才写入**（强制门控）。默认结论是「本次无新增经验」。落点不限于 `lessons-learned.md`：浏览器手法进 playbook、检查项进猎捕清单、某步做法进该步文件、项目级事实进仓库 `AGENTS.md`。详见 `references/lesson-harvest.md`。

## 配套脚本（机器验收，不靠人眼）

原流程每步的出口是「汇报路径 → 暂停 → 人确认」，**人眼是唯一验收器** —— 模型说「我检查过了」
和真检查过没法区分。`scripts/` 下两个脚本把文档里已写死的规则变成可执行断言：

| 脚本 | 何时跑 | 作用 |
|---|---|---|
| `scripts/preflight.py` | **Step1 之前，必跑** | 环境体检：JDK17 / maven / node / 仓库状态 / docs 可写 / 数据库连通 / launch.json。有 BLOCK 项退出码 1，**必须先修再开工** |
| `scripts/init_workdir.py` | **Step1 之前，拿到 Jira 号后** | 按 `{Sprint}-{票号}-{标题}` 在后端仓 `docs/develop/` 建需求目录；同票号已有目录则复用，多个则退出码 2 问用户；末行输出 `DIR=<路径>` |
| `scripts/qa_record.py` | **Step1 全程；之后每步开始前跑 `changes`** | Step1 问答记录（一个问题一节）的解析 / 写回 / 质量检查（缺问题描述 FAIL）/ 待 PM 清单导出（md、csv）/ 产品确认分享令牌（`.pm-share.json`）；看板上的改动登记在 `.qa-changes.json`，`changes` 列出改前改后（退出码 3 = 有待确认），用户确认并同步下游后 `ack`，不认可 `reject` 恢复 |
| `scripts/checklist_jira.py` | **Step3 每次改 Checklist 后** | 从 Checklist 机械生成 Jira 纯净版（去掉「图示」行与来源括注，按 `[Story号]` 拆分），不再手工复制 |
| `scripts/annotate.js` | **Step3 出标注截图时** | 注入原型 / 测试页面后 `window.__ann(...)` 画红框 + 编号 + 说明 + 连线，说明下自动加「对应 AC」；配合 Playwright 截图存到需求目录 `UI/`（做法见 step-03「标注截图怎么做」） |
| `scripts/validate_step.py` | **每步产出后，Review 之前** | 产出物存在且非空、`AC-NN` 全局唯一、矩阵覆盖每条 AC、tasks 绑定 AC、每 AC 有证据目录与复跑入口、回归项有结论、交付前无 `[open]`、技术设计有证据标注且无「通常/应该是/按惯例」这类未取证措辞、**代码改了但对应文档没改**（Step12/13）、**矩阵无模糊预期/无折叠省略/分支均标优先级** |
| `scripts/verify_state.py` | **11.4 并行验证时认领/收尾每条 AC；11.6 证据终验** | 用例状态登记（待验证/验证中/修复中/通过/失败/…）+ **证据终验**（未终验/终验中/终验通过/终验不通过，`final` 子命令，只核对证据不重跑浏览器）+ 会话与窗口标识归属；锁文件保证多会话不抢同一条 AC，超时的可 reclaim；`init --from-result` 支持老需求按 RESULT.md / Step 1x 报告回填 |
| `scripts/figma_cache.py` | **用户给出 Figma 链接时；设计稿更新后 `--refresh`** | 按链接缓存 Figma 节点到 `figma/<节点>/`（2x 截图、`design.md` 层级 / 文案 / 色值 / 间距 / 字号、`node.json`）并生成索引；重跑保留已填的区域 / AC 列与样式、差异两段。令牌只读环境变量 `FIGMA_API_KEY`，不打印不落盘 |
| `scripts/verify_dashboard.py` | **11.4 每条 AC 收尾后 / 11.4.3 收尾 / 11.6 终验后** | 生成《验证进度看板.html》（单需求：整体进度+用例状态+**证据终验**+证据+耗时，轮询 `tests/.verify-state.json` 实时刷新）与外层 `docs/develop/index.html`（所有进行中需求总览，排除 archived/tools，可切换）；`--serve` 起本地服务 ；**`--serve` 模式**：内容随磁盘实时更新（每次请求现场解析）、「需求问答」页签可编辑保存、需求列表可**归档**（标记已完成 → 移到 `archived/`，「已归档」入口可查看 / 恢复）；`validate_step.py --record` 会顺带重建看板 |
| `scripts/handover_match.py` | **Step14** | AC↔Subtask 匹配：读 Checklist + Jira Sub-task JSON → 写出映射 md/json；`--apply` 写入 `.handover-state.json`（`已匹配待确认`） |
| `scripts/handover_state.py` | **Step14** | 提测状态（与验证态分离）：`待匹配`→`已匹配待确认`→终态`已提测`/`无需提测`；映射与 Jira 动作记录写 `.handover-state.json` |

**文档同步检查**（Step12 / Step13 自动跑）：规则早就写在项目 `AGENTS.md` 里
（「REST API 变更必须同步 OpenAPI 注解与 `docs/creative-management-api.md`」），
但一直没有检查，做没做没人知道。现在按改动路径自动判：

| 改了什么 | 必须同步 | 严重度 |
|---|---|---|
| `**/controller/**`、`*Req/Resp/View/VO/DTO.java` | `docs/creative-management-api.md` | 🔴 FAIL |
| `**/mapper/**`、`*Mapper.java`、`db/*.sql` | `docs/creative-management-data.md` | ⚠️ WARN |
| `**/manager/**`、`**/handler/**`、`**/consumers/**` | `docs/creative-management-architecture.md` | ⚠️ WARN |

默认只看**工作区未提交改动**（流程禁止 Step13 前提交，通常够用）；需要并上分支已提交
部分时加 `--base origin/production`。仓根默认从 `--dir` 上溯三层，可用 `--project` 覆盖。

```bash
python scripts/preflight.py --project .
python scripts/validate_step.py --dir docs/develop/{...} --step 3 --record
python scripts/validate_step.py --dir docs/develop/{...} --status   # 看进度与续跑点
python scripts/validate_step.py --self-check                        # 只校验 skill 自身（改完 skill 跑一次）
```

> **改完 skill 之后还要分发**：本机装了多个 agent 工具，各有独立的 `skills` 目录，
> 不分发 = 换个工具跑的还是旧版，而且**不报错**。分发是独立 skill `distribute-agent-skills`
> （`~/.claude/skills/distribute-agent-skills/`），顺序固定：**改 → `--self-check` 过 → 分发**。

> `--self-check` 校验 **skill 自身**：`LNN` 引用是否都落在本 skill lessons 的有效编号内、计数行是否跟得上、索引表有无漏行。
> 两个 workflow 的 lessons 是**各自独立编号**的（同一条经验在两边的编号往往不同），
> 内容从一边复制到另一边时 `LNN` 会**静默指向错误条目** —— 不报错、不影响运行，执行时却对照到了别的 lesson。**已实际发生两次**。
> 改完 skill（尤其是在两个 workflow 间搬内容后）跑一次，退出码 1 即有问题。

`--record` 写入 `docs/develop/{...}/.workflow-state.json`，记录每步通过与否、失败项、时间戳。
**中断后先跑 `--status` 拿续跑点**，不要从头重来。

🔴 **validate_step 未通过 = 本步未完成，禁止进入下一步**，与人工 Review 门控同等效力。
它是断言不是建议：`FAIL` 必须修，`WARN` 必须在 Review 时逐条说明为何可接受。

### 失败分类与处置（不是所有失败都该停下问人）

`validate_step.py` 的退出码已分级：**0=通过，1=可自动修，2=必须停**。按失败类型处置：

| 失败类型 | 怎么认 | 处置 |
|---|---|---|
| **环境问题** | preflight BLOCK；连不上库/服务；超时 | 重试 + 退避；仍不行 → 停，报具体失败项 |
| **产出物不合规** | validate_step FAIL（缺编号、矩阵没覆盖、缺证据目录） | 自动补，**同一步最多 2 次** |
| **编译 / 单测失败** | mvn 非 0、测试红 | 按 Step11.2「根因优先」自动修，**同一步最多 2 次** |
| **需求理解偏差** | 实现与 Checklist 对不上、AC 无法落地、用户反馈方向错 | 🔴 **立即停** —— 自动修只会越修越偏，必须回 Step1/2 与用户对齐 |
| **破坏性变更** | 命中原则 24 的任一项 | 🔴 **立即停**，由用户在三种方案中选，禁止 AI 自行决定 |
| **授权类** | 写操作、生产环境、造数、提交推送 | 🔴 **立即停**，等用户明确授权 |

🔴 **「同一步最多 2 次」是硬规则，且不靠记忆**：`--record` 把连续失败次数写进
`.workflow-state.json`，第 3 次仍 FAIL 时脚本直接退出码 2 并打印停止指令。
**收到退出码 2 就停，把 FAIL 清单和失败历史贴给用户**，不要继续自动修 ——
反复修同一处，说明判断依据本身就是错的（典型：把需求偏差误判成产出物不合规）。

阈值可调：`--max-attempts N`。调高之前先想清楚为什么这一步值得多试。

> 两个脚本只用标准库，任何 python 都能跑。它们**不替代人工 Review**，只是把「能机器判的」
> 先判掉，让人只看真正需要判断的部分。

## 执行指令

0. **Step1 之前**跑 `scripts/preflight.py`，有 BLOCK 项先修；续跑场景先 `validate_step.py --status` 拿断点
1. 启动时 Read `doc-output-and-context.md`；用户给 Jira 号 → MCP 取 summary/Sprint → 跑 `scripts/init_workdir.py` **自动建（或复用）需求目录**，不让用户手建（Epic 号先问做哪张 Story）
1.5 看板**一律用服务模式打开**（静态打开不能保存 / 归档，内容也不实时）：先探测 `http://127.0.0.1:8787/api/ping`，通 = 常驻服务已在（本机开机自启：`docs/develop/tools/dashboard_server.py`，内部即本 skill 的看板服务）；不通再起 `verify_dashboard.py --all --develop docs/develop --serve --port 8787`。🔴 **每次开始任务（首次启动、续跑、新会话接手）的第一条回复就输出看板地址**，写成可点击的 markdown 链接：总览 `http://127.0.0.1:8787/`，需求详情 `http://127.0.0.1:8787/index.html#/<URL 编码后的需求目录>`（目录名含中文和空格，必须编码，否则链接点不开）；每个阻塞门控汇报末尾再附一行详情链接；**每步开始前跑 `qa_record.py changes`**，有看板改动先跟用户逐条确认、同步下游、`ack` 后再继续
2. 进入第 N 步前 Read 对应 `step-NN-*.md`，严格按其中约束执行
3. 每步产出前对照 `lessons-learned.md` 该步相关 lesson 自检
4. 产出物落盘 → **跑 `validate_step.py --step N --record`，FAIL 必须修到通过** → 汇报路径与校验结果 → 🔴 阻塞档**暂停等确认**，🟡 通知档**直接继续**
5. 全程对照 `doc-output-and-context.md` 自检清单自查
6. Step12 增加 lessons 合规检查；Step13 全局一致性审查前回顾所有 lesson；Step13 提交后进入 Step14
7. Step14 提测终态落定后，主动扫描本轮是否产生可复用经验，按自进化机制提炼

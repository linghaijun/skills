---
name: "ai-driven-fullstack-workflow"
description: "14-step fullstack dev workflow (Q&A→SPEC→Checklist→Plan→DDL→API→FrontendDesign→TestMatrix→Tasks→Coding→Test+Debug+SelfCheck→AIReview→GlobalConsistency→AC-SubtaskHandover), covering backend + frontend, per-step human review gating, contract-first, backend unit tests written after all business code (frontend needs NO unit/component tests), optional AI-driven browser verification with XHR capture, docs auto-created from a Jira key in docs/develop/{sprint}-{id}-{title}/, every Step1 question offers a 需要跟产品经理确认 option and ends with a PM-pending list. Spec uses OpenSpec proposal template; tasks.md uses OpenSpec tasks template. Invoke when developing fullstack features needing both backend and frontend, or user mentions 前后端/全栈/frontend+backend/PRD/BDD/TDD."
---

# AI 驱动型全栈开发全流程操作手册（AI-Driven Fullstack Workflow）

> **本 SKILL.md 是精简索引**：每步完整明细在 `references/step-NN-*.md`。执行到某步前先 Read 对应 reference 文件。
>
> 本流程 = 后端工作流（`ai-driven-backend-workflow`）的全部成熟机制（tasks.md 逐条编码、业务逻辑自检、全局一致性审查、经验教训库、OpenSpec 模板内嵌、交付收尾规范）+ 前端专属步骤（前端设计 / 前端人工验证 / 前后端契约一致性审查）。**前端不写单元测试/组件测试**（用户约定）。仅后端需求用 backend 工作流；纯前端页面美化（无接口改动）不必走本流程。

## 核心原则（CRITICAL）

> 16 条，每条一句话。**细则在 `references/` 对应文件里**，别在这儿找完整规则 ——
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
| 13 | **验证必须留硬证据** — 证据按 `AC-NN` 归档（`case.md` + `script/`或`REPLAY.md` + `evidence/` + `RESULT.md`），**能录像就别截图，能截图就别只写字**，**截图证据一定要标注**（框住判定点 + 框边写文字说明，未标注的截图不算证据，规则见 `browser-playbook-evidence.md` §4.1），随走随落禁止事后补证；**没留证的 AC 视为未测** | `doc-output` §一 |
| 14 | **数据核对：接口返回对 ≠ 数据对** — AC 含具体数值/条数/聚合结果时，Step11.5 必须用只读 SQL 对账；全程禁写操作，**禁止改 SQL 让它对上** | `step-11` §11.5 |
| 15 | **禁止中途提交 + 交付前双重门禁 + 提测终态** — Step10/11/12 全程禁 `git add/commit`；必须 Step12 AI Review + Step13 全局一致性审查（含独立证据验收）PASS 且人工审批后才提交并产出《测试交接文档》；Step14 提测状态（与验证态分离）须落到终态 `已提测` 或 `无需提测` | `step-12`、`step-13`、`step-14`、`test-handover.md` |
| 16 | **子 agent 加速要智能判断** — 独立 + 够大 + 可验收三问全是才派，多个子 agent **同一条消息并发发出**；门控、写操作授权、向用户提问**永不委派**；子 agent 结论是线索不是证据，主 agent 抽检后才写进交付物 | `subagent-acceleration.md` |

**门控档位**（编码前只剩 3 道阻塞门，其余降级为通知式）：

| 档 | 在哪几步 | 怎么走 | 为什么是这档 |
|---|---|---|---|
| 🔴 **阻塞** | **③ Spec+Checklist**（合并确认）、**⑤ DDL**、**⑥ API 契约**、**⑪.3 业务逻辑自检**（⑪.4 实机验证、⑪.6 证据终验的阻塞点见 `step-11`）、**⑫ AI Review**、**⑬ 提交**、**⑭ 是否提测**，以及贯穿全程的**写操作授权** | 汇报 → **暂停等用户明确确认** → 才继续 | 拦的是**不可逆**（DDL 手工执行、git 提交、写 Jira、写数据）或**对外承诺**（API 契约、进了 Jira 的 AC）或**范围错了全白做**的事 |
| 🟡 **通知式** | ② Spec、④ 技术方案、⑦ 前端设计、⑧ 测试矩阵、⑨ tasks、⑩ 编码、⑪.1 单测 | 落盘 → 跑 `validate_step.py`（FAIL 必须修到通过）→ 一句话汇报 → **直接继续** | 产出物是文档/代码，**改起来几分钟且未产生不可逆后果**；用户随时可提异议，收到异议**回退重做本步及其下游** |

🔴 **降级的是"等人点头"，不是"不检查"**：`validate_step.py` 每步照跑，FAIL 等同本步未完成。
这么分的理由：人被要求连续点 9 次「通过」，第 5 次之后就不看了 —— 门控不是变慢，是**静默失效**，
而且比没有门控更糟（给了虚假的安全感）。把注意力省给真正拦不可逆事项的那几道门（同 L18 的道理）。

**五条贯穿全程的红线**（不分步骤，任何时候都适用；后两条是用户明确强调的写作要求，没有机器校验，全靠自觉）：

- 🔴 **浏览器实机验证（Step11.4，可选）**：AI 必须主动询问、用户明确同意才执行；禁生产环境、禁 AI 代输凭据；**「给了可用账号」≠「写操作被授权」**，每一次写都要单独问 → `step-11` §11.4
- 🔴 **变更影响重评估**：修复若触发跨层改动 / 范围扩散 / 非功能回归 / 架构突破，强制回退对应步骤重审 → `step-12`
- 🔴 **机器验收优先于口头确认**：每步产出后跑 `validate_step.py`，**FAIL = 本步未完成**，与人工 Review 同等效力 → 见下文「配套脚本」
- 🔴 **问答一定要把问题描述清楚，不要简略**：问答记录每题、看板问答、向用户提问（AskUserQuestion 的问题文本）都要写清背景、现状与证据、冲突或空白、为什么必须定，候选项写后果；不看对话也能读懂 → `step-01` 「问题必须写清楚」
- 🔴 **证据截图一定要有标注**：作为判定依据的截图都要有「裁剪 + 放大 + 框住判定点 + 框边写文字」的标注版，**文件名内容用中文**：`AC-NN-序号-<中文判定点>-标注.png`（原图 `-原图`，命名见 `doc-output` 「证据文件命名」），只有框和序号不算；自己打开看过才算 → `browser-playbook-evidence.md` §4.1

**另有两条机制**：经验教训对照（每步前查 `lessons-learned.md`，Step12/13 做合规检查）；来源冲突裁决（用户最新指令 > 截图/设计稿 > PRD > 本地技术文档 > 代码现状，**代码现状不自动等于需求**）。

## 触发条件（When to Invoke）

用户提到前后端 / 全栈 / fullstack 开发；给了 PRD、UI 截图或业务背景，要求**同时**开发后端接口和前端页面；提及 BDD / TDD / Checklist / 需求拆解且涉及前端 UI 交互；或明确说「按全栈流程 / 按十四步流程」。

> 若需求**仅**后端（无前端 UI），用 `ai-driven-backend-workflow`；**纯前端页面美化/静态页面**（不碰接口与数据）不必走本流程。

## 工作流总览

| 步骤 | 名称 | 输入 | 产出物 | 明细 |
|------|------|------|--------|------|
| 1 | 需求澄清 Q&A（每题带「需要跟产品经理确认」选项） | Jira 号 + PRD/UI/业务背景 | Step 1-需求澄清问答记录.md（含待 PM 确认清单） | `step-01-requirements-qa.md` |
| 2 | Spec(OpenSpec proposal 模板) | Q&A+PRD/UI | Step 2-Spec.md | `step-02-spec.md` |
| 3 | 结构化 Checklist（前后端共享；用户操作流、按测试顺序、AC-NN 全局编号、写全称 + 每条图示 + 文首一页读懂） | Spec | Step 3-Checklist.md(BDD) + Step 3-Checklist-Jira.txt | `step-03-checklist.md` |
| 4 | 技术方案（后端+前端两份；含复用清单+非功能映射表） | Checklist+技术栈 | Step 4-后端/前端技术设计与实现方案文档.md | `step-04-plan.md` |
| 5 | DDL（承接非功能索引/乐观锁落点） | Checklist+计划+已有表 | Step 5-ddl.sql + ddl-rollback.sql(+data-backfill) | `step-05-ddl.md` |
| 6 | API 契约（前后端共享；含限流/幂等/缓存/权限/分页） | Checklist+DDL+RESTful | Step 6-API接口定义文档.md | `step-06-api.md` |
| 7 | 前端页面与组件设计 | Checklist+API 契约+UI 图 | Step 7-前端页面与组件设计文档.md | `step-07-frontend-design.md` |
| 8 | 测试用例矩阵（后端单测分支 + 前端人工验证清单 + **回归验证清单 `R-NN`**） | Checklist+API+前端设计+Step4 回归候选 | Step 8-后端/前端测试矩阵.md + **Step 8-回归验证清单.md** | `step-08-test-matrix.md` |
| 9 | 任务拆解（P0/P1/P2+估时，前后端任务组） | Step1~8 全部产出 | Step 9-tasks.md | `step-09-tasks.md` |
| 10 | 逐条编码（后端+前端；复用+非功能落点；禁单测；**禁 git**） | tasks.md | 前后端生产代码 | `step-10-coding.md` |
| 11 | 后端单测（前端不写测试）+编译自愈+逻辑自检+浏览器实机验证（可选）+**数据核对**+**证据按 AC 归档**+证据终验（**禁 git**） | 业务代码+测试矩阵+API文档+日志 | 全 Pass 后端单测 + Step 11-业务逻辑自检报告 +（可选）浏览器验证步骤 / 实机验证报告 + **`tests/AC-NN/` 四件套 + `tests/README.md` + `tests/.verify-state.json` + 验证进度看板** | `step-11-test-debug.md` |
| 12 | AI Review（合规五维 + **缺陷猎捕** + lessons）（**禁 git**） | Step3/6/8文档+Step10/11代码 | Step 12-AI Review报告 | `step-12-ai-review.md` |
| 13 | 全局一致性审查+交付收尾（**唯一允许 git 提交**） | Steps1~12 全部产出物 | Step 13-全局一致性审查报告 + **证据验收报告**（独立 subagent）+ **测试交接文档** + 提交 | `step-13-global-consistency-review.md`、`evidence-acceptance.md`、`test-handover.md` |
| 14 | **AC ↔ Subtask 匹配与提测**（与验证态分离） | Checklist 全量 AC + 父票 Sub-task | `Step 14-AC-Subtask映射.md` + `.handover-state.json`（终态 `已提测` / `无需提测`）；确认提测则 Jira→Testing 并转交项目 `AGENTS.md` 约定的提测转交人 | `step-14-ac-subtask-handover.md` |

## 其他 reference（何时读）

- `doc-output-and-context.md` — 目录规范、**证据目录与证据形式优先级（权威位置）**、看板、多仓提交、项目上下文、自检清单。**Step1 前必读**
- `browser-verification-playbook.md` — 浏览器实机验证**索引 + 红线清单**，实机验证前必读；再按需读 `browser-playbook-core.md`（§0 §1 §5–§10）/ `-tools-cdp.md`（§2 §3）/ `-evidence.md`（§4）/ `-parallel.md`（§11 §12），章节号全局沿用
- `evidence-acceptance.md` — 证据验收：独立 subagent 盲审 + 对账，逐 AC 判验收通过 / 不通过。Step13 必读
- `data-reconciliation.md` — 数据核对（只读 SQL）：只读门禁、SQL 从既有 mapper 推导、口径对齐、逐层二分。**AC 预期含数值 / 条数 / 聚合结果时**读
- `test-handover.md` — 提测交接文档必含项、禁止透传项与模板。Step13 必读
- `step-14-ac-subtask-handover.md` — AC↔Subtask 匹配、独立提测状态、Jira Testing + 转交。Step14 必读
- `bug-hunting-checklist.md` — 缺陷猎捕清单（问「什么输入下会错」）。Step12 维度 G 必读
- `figma-ui-cache.md` — Figma 设计稿缓存（`FIGMA_API_KEY` 直调 REST）。用户给 Figma 链接、Step7 设计前、Step10 前端编码前读
- `lessons-learned.md` — 经验教训库，每步前对照相关 lesson ｜ `lesson-harvest.md` — 经验沉淀，Step14 提测终态之后必读（见下）
- `context-compaction.md` — **上下文压缩时机**（仅支持 `/compact` 的 agent，如 Claude Code）：安全点 + 上下文重才建议、绝不在步骤中途、先落盘再压、压缩后三件事与续跑 hook。每步收尾时对照
- `subagent-acceleration.md` — **子 agent 加速**：派不派的三问、按步骤推荐用法与并发上限、绝不委派清单、brief 六项、结果抽检。准备并行 / 委派前读
- `openspec-integration.md` — OpenSpec 步骤映射与已搬入模板 ｜ `scripts.md` — 配套脚本完整说明

## 自进化机制

Step14 提测终态落定后做**经验沉淀**：四道准入（代价闸 → 抹名测试 → 落点选择 → 动作化）+ 查重并入 → **只产出提名表，用户确认后才写入**（强制门控）。默认结论是「本次无新增经验」。落点由「执行时 AI 正在读哪个文件」决定：浏览器手法进对应 `browser-playbook-*.md`、检查项进猎捕清单、某步做法进该步文件、项目级事实进仓库 `AGENTS.md`，不是一律进 lessons 库。详见 `references/lesson-harvest.md`。

## 配套脚本（机器验收，不靠人眼）

原流程每步的出口是「汇报路径 → 暂停 → 人确认」，**人眼是唯一验收器** —— 模型说「我检查过了」和真检查过没法区分。
`scripts/` 下的脚本把文档里已写死的规则变成可执行断言（只用标准库，不替代人工 Review）。**每个脚本的作用、文档同步检查、self-check 校验项、失败分类表 → `references/scripts.md`**。

| 脚本 | 何时跑 |
|---|---|
| `preflight.py` | **Step1 之前必跑**；有 BLOCK 项先修再开工 |
| `init_workdir.py` | 拿到 Jira 号后，建 / 复用需求目录（末行 `DIR=<路径>`） |
| `qa_record.py` | Step1 全程；**之后每步开始前跑 `changes`** |
| `checklist_jira.py` | Step3 每次改 Checklist 后 |
| `annotate.js` | Step3 出标注截图时 |
| `figma_cache.py` | 用户给 Figma 链接时；设计稿更新后 `--refresh` |
| `validate_step.py` | **每步产出后、Review 之前** `--step N --record`；中断后 `--status`；改完 skill `--self-check` |
| `verify_state.py` | 11.4 每条 AC `claim` / `fix` / `finish`、改代码后 `invalidate`；11.6 `final` 终验（登记后自动刷新看板） |
| `surefire_aggregate.py` | 引用单测作为 AC 证据时 |
| `verify_dashboard.py` | 看板服务 `--serve --port 8787`；手工改动后 `--dir` 刷新 |
| `handover_match.py` / `handover_state.py` | Step14 |

🔴 **validate_step 未通过 = 本步未完成，禁止进入下一步**，与人工 Review 门控同等效力：`FAIL` 必须修，`WARN` 必须在 Review 时逐条说明为何可接受。
🔴 **退出码 0=通过 / 1=可自动修 / 2=必须停**：同一步连续失败次数由 `--record` 写进 `.workflow-state.json`（不靠记忆），第 3 次仍 FAIL 直接退出码 2 —— **收到 2 就停**，把 FAIL 清单和失败历史贴给用户，不要继续自动修（反复修同一处，说明判断依据本身错了）。
🔴 **需求理解偏差、破坏性变更（原则 6）、授权类（写操作 / 生产环境 / 造数 / 提交推送）一律立即停**，不自动修；只有环境、产出物不合规、编译 / 单测失败才自动修，同一步最多 2 次 → `references/scripts.md` §4「失败分类与处置」。
🔴 **中断后先跑 `validate_step.py --status` 拿续跑点**，不要从头重来。
🔴 **改完 skill：改 → `validate_step.py --self-check` 过 → 用独立 skill `distribute-agent-skills` 分发**（不分发 = 换个工具跑的还是旧版且不报错）；两个 workflow 的 `LNN` 各自独立编号，搬内容时必须换号。

## 执行指令

0. **Step1 之前**跑 `scripts/preflight.py`，有 BLOCK 项先修；续跑场景先 `validate_step.py --status` 拿断点
1. 启动时 Read `doc-output-and-context.md`；用户给 Jira 号 → MCP 取 summary/Sprint → 跑 `scripts/init_workdir.py` **自动建（或复用）需求目录**，不让用户手建（Epic 号先问做哪张 Story）
1.5 看板**一律用服务模式打开**（静态打开不能保存 / 归档，内容也不实时）：先探测 `http://127.0.0.1:8787/api/ping`，通 = 常驻服务已在（本机开机自启：`docs/develop/tools/dashboard_server.py`，内部即本 skill 的看板服务）；不通再起 `verify_dashboard.py --all --develop docs/develop --serve --port 8787`。🔴 **每次开始任务（首次启动、续跑、新会话接手）的第一条回复就输出看板地址**，写成可点击的 markdown 链接：总览 `http://127.0.0.1:8787/`，需求详情 `http://127.0.0.1:8787/index.html#/<URL 编码后的需求目录>`（目录名含中文和空格，必须编码，否则链接点不开）；每个阻塞门控汇报末尾再附一行详情链接；**每步开始前跑 `qa_record.py changes`**，有看板改动先跟用户逐条确认、同步下游、`ack` 后再继续
2. 进入第 N 步前 Read 对应 `step-NN-*.md`，严格按其中约束执行
2.5 ⚡ 每步开工前判断本步有没有可并行的独立大块（多仓取证、按组编码、按 AC 组验证 / 对账、按维度 Review）→ 按 `subagent-acceleration.md` 三问决定是否派子 agent；**小活自己做，门控与写授权永不委派**
3. 每步产出前对照 `lessons-learned.md` 该步相关 lesson 自检
4. 产出物落盘 → **跑 `validate_step.py --step N --record`，FAIL 必须修到通过** → 汇报路径与校验结果 → 🔴 阻塞档**暂停等确认**，🟡 通知档**直接继续**
4.5 🗜️ 每步收尾 / 阻塞门控被确认后，若当前 agent 支持 `/compact`（Claude Code）：按 `context-compaction.md` 判断是否到了「安全点 + 上下文重」，是就在汇报末尾给一行可直接发送的 `/compact 保留：…`；**步骤中途、有未落盘结论、有在途子 agent 时绝不建议**；不支持 `/compact` 的工具跳过。压缩后先重读 SKILL.md 与当前 step 文件
5. 全程对照 `doc-output-and-context.md` 自检清单自查
6. Step12 增加 lessons 合规检查；Step13 全局一致性审查前回顾所有 lesson；Step13 提交后进入 Step14
7. Step14 提测终态落定后，主动扫描本轮是否产生可复用经验，按自进化机制提炼

---
name: "ai-driven-backend-workflow"
description: "13-step backend dev workflow (Q&A→SPEC→Checklist→Plan→DDL→API→TestMatrix→Tasks→Coding→Test+Debug+BrowserVerify→AIReview→GlobalConsistency→AC-SubtaskHandover), per-step human review gating, unit tests written after all business code, optional AI-driven browser verification with XHR capture, docs auto-created from a Jira key in docs/develop/{sprint}-{id}-{title}/, every Step1 question offers a 需要跟产品经理确认 option and ends with a PM-pending list. Spec uses OpenSpec proposal template; tasks.md uses OpenSpec tasks template. Invoke when developing backend features or user mentions PRD/需求/BDD/TDD."
---

# AI 驱动型后端开发全流程

> **本 SKILL.md 是精简索引**：每步完整明细在 `references/step-NN-*.md`。执行到某步前先 Read 对应 reference 文件。

## 核心原则（CRITICAL）

> 14 条，每条一句话。**细则在 `references/` 对应文件里**，别在这儿找完整规则 ——
> 这里只负责"让你想起来有这么回事"，想不起来的规则等于不存在。

| # | 原则 | 细则在哪 |
|---|---|---|
| 1 | **先分流再执行** — Step1 先判变更类型（A 新功能走全 13 步 / B 增强可跳 Step5 / C Bugfix 走精简路径），经用户确认后写入 Spec。分流**只降流程密度、不降质量门**；判不准按高一档走 | `step-01` §0 |
| 2 | **顺序不可跳跃 + 门控分两档** — 上一步产出物是下一步的强制输入；🔴 **阻塞门控**（拦不可逆/对外的事）必须暂停等确认，🟡 **通知式门控**汇报后直接继续、有异议再回退 | 见下「门控档位」 |
| 3 | **零臆测** — 事实性判断必须三选一：就地取证（标 `证据：file:line`）/ 文档取证 / 问用户。禁止「通常、应该是、按惯例」，禁止从命名推断语义 | `step-01` §零臆测 |
| 4 | **影响面反查 + 全局落点** — 每次改动先问「还有哪些地方是同一件事」并 Grep 求证；同类点 ≥2 处上提共享层，=1 处就地改，**禁止就地打补丁** | `step-01` §影响面、`step-04` |
| 5 | **回归优先于新增** — 流程默认只验"新需求做对了"。Step7 强制产出《回归验证清单》（`R-NN`），未验证的 `R-NN` 与未实现的 AC 同等对待 | `step-07`、`step-04` |
| 6 | **改既有接口 = 破坏性变更** — Step6 必须出「既有端点变更」表，🔴 项**必须显式问用户**选方案，禁止 AI 自行决定 | `step-06` |
| 7 | **复用优先 + 非功能全程追溯** — Step4 复用清单与非功能映射表逐条落地到 DDL/代码/API，禁止停留在"需考虑" | `step-04` |
| 8 | **产出物必须落地 + 统一目录** — 禁止仅对话产出；全部进 `docs/develop/{Sprint}-{id}-{title}/`（按 Jira 号自动建，见 `doc-output` §启动） | `doc-output-and-context.md` |
| 9 | **AC 编号即追溯主键** — `AC-NN` 全局连续、零填充两位、宽度统一；Step7/8/10/11/12 一律按它引用与反查，任一处缺席判漏实现 | `step-03` 核心约束 4 |
| 10 | **测试延后 + 逐条编码** — Step8 拆任务 → Step9 一条条喂；后端单测在业务代码全部完成后（Step10.1）统一写，调用方按 Step6 契约对接 | `step-08`、`step-09`、`step-10` |
| 11 | **测试全 Pass ≠ 需求实现** — Step10.3 强制业务逻辑自检；Step10.2 **根因优先，禁止改测试绕过**（禁放宽/删断言、禁 `@Disabled`） | `step-10` §10.2/10.3 |
| 12 | **验证必须留硬证据** — 证据按 `AC-NN` 归档（`case.md` + `script/`或`REPLAY.md` + `evidence/` + `RESULT.md`），**能录像就别截图，能截图就别只写字**，**截图证据一定要标注**（框住判定点 + 框边写文字说明，未标注的截图不算证据，规则见 `browser-verification-playbook.md` §4.1），随走随落禁止事后补证；**没留证的 AC 视为未测** | `doc-output` §一 |
| 13 | **数据核对：接口返回对 ≠ 数据对** — AC 含具体数值/条数/聚合结果时，Step10.5 必须用只读 SQL 对账；全程禁写操作，**禁止改 SQL 让它对上** | `step-10` §10.5 |
| 14 | **禁止中途提交 + 交付前双重门禁 + 提测终态** — Step9/10/11 全程禁 `git add/commit`；必须 Step11 AI Review + Step12 全局一致性审查（含独立证据验收）PASS 且人工审批后才提交并产出《测试交接文档》；Step13 提测状态（与验证态分离）须落到终态 `已提测` 或 `无需提测` | `step-11`、`step-12`、`step-13`、`test-handover.md` |

**门控档位**（编码前只剩 3 道阻塞门，其余降级为通知式）：

| 档 | 在哪几步 | 怎么走 | 为什么是这档 |
|---|---|---|---|
| 🔴 **阻塞** | **③ Spec+Checklist**（合并确认）、**⑤ DDL**、**⑥ API 契约**、**⑩.3 业务逻辑自检**、**⑪ AI Review**、**⑫ 提交**、**⑬ 是否提测**，以及贯穿全程的**写操作授权** | 汇报 → **暂停等用户明确确认** → 才继续 | 拦的是**不可逆**（DDL 手工执行、git 提交、写 Jira、写数据）或**对外承诺**（API 契约、进了 Jira 的 AC）或**范围错了全白做**的事 |
| 🟡 **通知式** | ② Spec、④ 技术方案、⑦ 测试矩阵、⑧ tasks、⑨ 编码、⑩.1 单测 | 落盘 → 跑 `validate_step.py`（FAIL 必须修到通过）→ 一句话汇报 → **直接继续** | 产出物是文档/代码，**改起来几分钟且未产生不可逆后果**；用户随时可提异议，收到异议**回退重做本步及其下游** |

🔴 **降级的是"等人点头"，不是"不检查"**：`validate_step.py` 每步照跑，FAIL 等同本步未完成。
这么分的理由：人被要求连续点 9 次「通过」，第 5 次之后就不看了 —— 门控不是变慢，是**静默失效**，
而且比没有门控更糟（给了虚假的安全感）。把注意力省给真正拦不可逆事项的那几道门（同 L18 的道理）。

**三条贯穿全程的红线**（不分步骤，任何时候都适用）：

- 🔴 **浏览器实机验证（Step10.4，可选）**：AI 必须主动询问、用户明确同意才执行；禁生产环境、禁 AI 代输凭据；**「给了可用账号」≠「写操作被授权」**，每一次写都要单独问 → `step-10` §10.4
- 🔴 **变更影响重评估**：修复若触发跨层改动 / 范围扩散 / 非功能回归 / 架构突破，强制回退对应步骤重审 → `step-11`
- 🔴 **机器验收优先于口头确认**：每步产出后跑 `validate_step.py`，**FAIL = 本步未完成**，与人工 Review 同等效力 → 见下文「配套脚本」

**另有两条机制**：经验教训对照（每步前查 `lessons-learned.md`，Step11/12 做合规检查）；来源冲突裁决（用户最新指令 > 截图/设计稿 > PRD > 本地技术文档 > 代码现状，**代码现状不自动等于需求**）。

## 触发条件
用户提及 "后端开发/backend/新功能/实现需求/BDD/TDD/Checklist/接口设计/DDL 设计"、提供 PRD/UI/业务背景，或要求按"十三步流程"开发。

## 工作流总览
| 步骤 | 名称 | 输入 | 产出物 | 明细 |
|------|------|------|--------|------|
| 1 | 需求澄清 Q&A（每题带「需要跟产品经理确认」选项） | Jira 号 + PRD/UI/业务背景 | Step 1-需求澄清问答记录.md（含待 PM 确认清单） | `step-01-requirements-qa.md` |
| 2 | Spec(OpenSpec proposal) | Q&A+PRD/UI | Step 2-Spec.md | `step-02-spec.md` |
| 3 | 结构化 Checklist（前端操作流、按测试顺序、AC-NN 全局编号、COMMON/入口前缀、可选代码 gap-check 与 Jira 同步） | Spec | Step 3-Checklist.md(BDD) + Step 3-Checklist-Jira.txt(可拷贝纯净版) | `step-03-checklist.md` |
| 4 | 技术方案(含复用清单+非功能映射) | Checklist+技术栈 | Step 4-技术设计与实现方案文档.md | `step-04-plan.md` |
| 5 | DDL(承接非功能索引/乐观锁落点) | Checklist+计划+已有表 | Step 5-ddl.sql | `step-05-ddl.md` |
| 6 | API 设计(含限流/幂等/缓存/权限) | Checklist+DDL+RESTful | Step 6-API接口定义文档.md | `step-06-api.md` |
| 7 | 测试用例矩阵 + **回归验证清单 `R-NN`** | Checklist+API 文档+Step4 回归候选 | Step 7-单元测试验证指标矩阵.md + **Step 7-回归验证清单.md** | `step-07-test-matrix.md` |
| 8 | 任务拆解(P0/P1/P2+估时) | Step1~7 全部产出 | Step 8-tasks.md | `step-08-tasks.md` |
| 9 | 逐条编码(复用+非功能落点,禁单测,禁git提交) | tasks.md | 生产代码 | `step-09-coding.md` |
| 10 | 单测+编译自愈+逻辑自检+浏览器实机验证(可选,10.3后询问,AI 开浏览器+抓 XHR)+**数据核对(只读 SQL 对账)**+**测试证据按 AC 归档**(禁git提交) | 业务代码+测试矩阵+API文档+日志 | 全Pass单测+Step 10-自检报告+(可选)Step 10-浏览器验证步骤+实机验证报告+**tests/AC-NN/{case.md, script/ 或 REPLAY.md, evidence/, RESULT.md}+tests/README.md+tests/.verify-state.json（用例状态/窗口登记）+验证进度看板.html（+外层 docs/develop/index.html）** | `step-10-test-debug.md` |
| 11 | AI Review(禁git提交) | Step3/6/7文档+Step9/10代码 | Step 11-AI Review报告 | `step-11-ai-review.md` |
| 12 | 全局一致性审查 + 交付收尾(**唯一允许 git 提交**) | Steps1~11全部产出物 | Step 12-全局一致性审查报告 + **Step 12-证据验收报告**（独立 subagent）+ **Step 12-测试交接文档** + 提交 | `step-12-global-consistency-review.md`、`evidence-acceptance.md`、`test-handover.md` |
| 13 | **AC ↔ Subtask 匹配与提测**（与验证态分离） | Checklist 全量 AC + 父票 Sub-task | `Step 13-AC-Subtask映射.md` + `.handover-state.json`（终态：`已提测` / `无需提测`）；确认提测则 Jira→Testing 并转交 `biao.mu@pacvue.com` | `step-13-ac-subtask-handover.md` |

## 其他 reference
- `doc-output-and-context.md` — 目录规范 + 项目上下文 + 自检清单。**Step1 前必读**。
- `openspec-integration.md` — OpenSpec 步骤映射、已搬入模板及原因。
- `lessons-learned.md` — 经验教训库，每步前对照相关 lesson。
- `lesson-harvest.md` — **经验沉淀**：四道准入（代价闸 / 抹名测试 / 落点选择 / 动作化）+ 查重并入 + 容量淘汰 + 提名门控。默认结论是「本次无新增经验」；落点由「执行时 AI 正在读哪个文件」决定，不是一律进 lessons 库。**Step13 提测终态之后**必读。
- `data-reconciliation.md` — **数据核对**（只读 SQL 取证）：只读门禁、可用连接、绩效查询硬约束、SQL 必须从既有 mapper 推导、口径对齐、取证落盘、对不上怎么逐层二分。**只在 AC 的预期含具体数值/条数/聚合结果时才需要读**。
- `test-handover.md` — **提测交接文档**的必含项、禁止透传项与模板。Step12 必读。
- `step-13-ac-subtask-handover.md` — **AC↔Subtask 匹配与提测**：独立提测状态（`待匹配`/`已匹配待确认`/`已提测`/`无需提测`）、匹配规则、确认后门控、Jira Testing + 转交。Step13 必读。
- `browser-verification-playbook.md` — **浏览器实机验证**：只读红线、**动手前必读脚本分层**（CDP `SCRIPTS.md` 全局层 → `projects/<项目>` 页面层脚本 + `PAGE-NOTES.md`；禁止现写探针）、工具选型与 CDP、未登录交接、驱动 UI 的高频坑、截图标注、走读证据、权限类验收、找账号、提速、多会话并行。实机验证前必读；收尾按层回写（坑→SCRIPTS，页面操作→projects/笔记）。
- `evidence-acceptance.md` — **证据验收**：独立 subagent 以验收测试专员身份盲审 + 对账，逐 AC 判定证据能不能通过验收（验收通过 / 验收不通过）。Step12 必读。
- `bug-hunting-checklist.md` — **缺陷猎捕清单**（输入边界/空值/并发/事务/SQL/权限/回归面…）。Step11 维度 E「缺陷猎捕」必读；它问的是「什么输入下会错」，不是「符不符合文档」。

## 自进化机制
Step13 提测终态落定后做**经验沉淀**：四道准入（代价闸 → 抹名测试 → 落点选择 → 动作化）+ 查重并入 → **只产出提名表，用户确认后才写入**（强制门控）。默认结论是「本次无新增经验」。落点不限于 `lessons-learned.md`：浏览器手法进 playbook、检查项进猎捕清单、某步做法进该步文件、项目级事实进仓库 `AGENTS.md`。详见 `references/lesson-harvest.md`。

## 配套脚本（机器验收，不靠人眼）

原流程每步的出口是「汇报路径 → 暂停 → 人确认」，**人眼是唯一验收器** —— 模型说「我检查过了」
和真检查过没法区分。`scripts/` 下两个脚本把文档里已写死的规则变成可执行断言：

| 脚本 | 何时跑 | 作用 |
|---|---|---|
| `scripts/preflight.py` | **Step1 之前，必跑** | 环境体检：JDK17 / maven / node / 仓库状态 / docs 可写 / 数据库连通。有 BLOCK 项退出码 1，**必须先修再开工** |
| `scripts/init_workdir.py` | **Step1 之前，拿到 Jira 号后** | 按 `{Sprint}-{票号}-{标题}` 在后端仓 `docs/develop/` 建需求目录；同票号已有目录则复用，多个则退出码 2 问用户；末行输出 `DIR=<路径>` |
| `scripts/qa_record.py` | **Step1 全程；之后每步开始前跑 `changes`** | Step1 问答记录（一个问题一节）的解析 / 写回 / 质量检查（缺问题描述 FAIL）/ 待 PM 清单导出（md、csv）/ 产品确认分享令牌（`.pm-share.json`）；看板上的改动登记在 `.qa-changes.json`，`changes` 列出改前改后（退出码 3 = 有待确认），用户确认并同步下游后 `ack`，不认可 `reject` 恢复 |
| `scripts/checklist_jira.py` | **Step3 每次改 Checklist 后** | 从 Checklist 机械生成 Jira 纯净版（去掉「图示」行与来源括注，按 `[Story号]` 拆分），不再手工复制 |
| `scripts/annotate.js` | **Step3 出标注截图时** | 注入原型 / 测试页面后 `window.__ann(...)` 画红框 + 编号 + 说明 + 连线，说明下自动加「对应 AC」；配合 Playwright 截图存到需求目录 `UI/`（做法见 step-03「标注截图怎么做」） |
| `scripts/validate_step.py` | **每步产出后，Review 之前** | 产出物存在且非空、`AC-NN` 全局唯一、矩阵覆盖每条 AC、tasks 绑定 AC、每 AC 有证据目录与复跑入口、回归项有结论、交付前无 `[open]`、技术设计有证据标注且无「通常/应该是/按惯例」这类未取证措辞、**代码改了但对应文档没改**、**矩阵无模糊预期/无折叠省略/分支均标优先级**（Step11/12） |
| `scripts/verify_state.py` | **10.4 并行验证时，认领 / 收尾每条 AC** | 用例状态登记（待验证/验证中/修复中/通过/失败/…）+ 会话与窗口标识归属；锁文件保证多会话不抢同一条 AC，超时的「验证中」可 reclaim |
| `scripts/verify_dashboard.py` | **10.4 每条 AC 收尾后 / 10.4.3 收尾** | 生成《验证进度看板.html》（单需求：整体进度+用例状态+证据+耗时，轮询 `tests/.verify-state.json` 实时刷新）与外层 `docs/develop/index.html`（所有进行中需求总览，排除 archived/tools，可切换）；`--serve` 起本地服务 ；**`--serve` 模式**：内容随磁盘实时更新（每次请求现场解析）、「需求问答」页签可编辑保存、需求列表可**归档**（标记已完成 → 移到 `archived/`，「已归档」入口可查看 / 恢复）；`validate_step.py --record` 会顺带重建看板 |
| `scripts/handover_match.py` | **Step13** | AC↔Subtask 匹配：读 Checklist + Jira Sub-task JSON → 写出映射 md/json；`--apply` 写入 `.handover-state.json`（`已匹配待确认`） |
| `scripts/handover_state.py` | **Step13** | 提测状态（与验证态分离）：`待匹配`→`已匹配待确认`→终态`已提测`/`无需提测`；映射与 Jira 动作记录写 `.handover-state.json` |

**文档同步检查**（Step11 / Step12 自动跑）：规则早就写在项目 `AGENTS.md` 里
（「REST API 变更必须同步 OpenAPI 注解与 `docs/creative-management-api.md`」），
但一直没有检查，做没做没人知道。现在按改动路径自动判：

| 改了什么 | 必须同步 | 严重度 |
|---|---|---|
| `**/controller/**`、`*Req/Resp/View/VO/DTO.java` | `docs/creative-management-api.md` | 🔴 FAIL |
| `**/mapper/**`、`*Mapper.java`、`db/*.sql` | `docs/creative-management-data.md` | ⚠️ WARN |
| `**/manager/**`、`**/handler/**`、`**/consumers/**` | `docs/creative-management-architecture.md` | ⚠️ WARN |

默认只看**工作区未提交改动**（流程禁止 Step12 前提交，通常够用）；需要并上分支已提交
部分时加 `--base origin/production`。仓根默认从 `--dir` 上溯三层，可用 `--project` 覆盖。

```bash
python scripts/preflight.py --project .
python scripts/validate_step.py --dir docs/develop/{...} --workflow backend --step 3 --record
python scripts/validate_step.py --dir docs/develop/{...} --workflow backend --status
python scripts/validate_step.py --self-check                        # 只校验 skill 自身（改完 skill 跑一次）
```

> **改完 skill 之后还要分发**：本机装了多个 agent 工具，各有独立的 `skills` 目录，
> 不分发 = 换个工具跑的还是旧版，而且**不报错**。分发是独立 skill `distribute-agent-skills`
> （`~/.claude/skills/distribute-agent-skills/`），顺序固定：**改 → `--self-check` 过 → 分发**。

> `--self-check` 校验 **skill 自身**：`LNN` 引用是否都落在本 skill lessons 的有效编号内、计数行是否跟得上、索引表有无漏行。
> 两个 workflow 的 lessons 是**各自独立编号**的（同一条经验在两边的编号往往不同），
> 内容从一边复制到另一边时 `LNN` 会**静默指向错误条目** —— 不报错、不影响运行，执行时却对照到了别的 lesson。**已实际发生两次**。
> 改完 skill（尤其是在两个 workflow 间搬内容后）跑一次，退出码 1 即有问题。

🔴 **本 workflow 必须带 `--workflow backend`**（12 步，步骤号与全栈版不同：测试矩阵在 Step7、
tasks 在 Step8、测试在 Step10、交付在 Step12）。漏了会按全栈的步骤号去找文件，全部报「产出物未找到」。

`--record` 写入 `docs/develop/{...}/.workflow-state.json`，记录每步通过与否、失败项、时间戳。
**中断后先跑 `--status` 拿续跑点**，不要从头重来。

🔴 **validate_step 未通过 = 本步未完成，禁止进入下一步**，与人工 Review 门控同等效力。
`FAIL` 必须修，`WARN` 必须在 Review 时逐条说明为何可接受。

### 失败分类与处置（不是所有失败都该停下问人）

`validate_step.py` 的退出码已分级：**0=通过，1=可自动修，2=必须停**。按失败类型处置：

| 失败类型 | 怎么认 | 处置 |
|---|---|---|
| **环境问题** | preflight BLOCK；连不上库/服务；超时 | 重试 + 退避；仍不行 → 停，报具体失败项 |
| **产出物不合规** | validate_step FAIL（缺编号、矩阵没覆盖、缺证据目录） | 自动补，**同一步最多 2 次** |
| **编译 / 单测失败** | mvn 非 0、测试红 | 按 Step10.2「根因优先」自动修，**同一步最多 2 次** |
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
2. 进入第 N 步前 Read 对应 `step-NN-*.md`，严格按约束执行
3. 每步产出前对照 `lessons-learned.md` 该步相关 lesson 自检
4. 产出物落盘→**跑 `validate_step.py --workflow backend --step N --record`，FAIL 必须修到通过**→汇报路径与校验结果→**暂停 review**→通过后进入下一步
5. 全程对照 `doc-output-and-context.md` 自检清单自查
6. Step11 增加 lessons 合规检查；Step12 全局一致性审查前回顾所有 lesson
7. 工作流结束后主动扫描本轮是否产生可复用经验，按自进化机制提炼

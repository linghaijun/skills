# 配套脚本（机器验收，不靠人眼）

> SKILL.md「配套脚本」只留速查与硬规则；本文件是每个脚本作用、文档同步检查、`--self-check`、失败分类的完整说明。

原流程每步的出口是「汇报路径 → 暂停 → 人确认」，**人眼是唯一验收器** —— 模型说「我检查过了」
和真检查过没法区分。`scripts/` 下的脚本把文档里已写死的规则变成可执行断言。
它们只用标准库，任何 python 都能跑；**不替代人工 Review**，只是把「能机器判的」先判掉，让人只看真正需要判断的部分。

## 1. 脚本一览

| 脚本 | 何时跑 | 作用 |
|---|---|---|
| `scripts/preflight.py` | **Step1 之前，必跑** | 环境体检：JDK17 / maven / node / 仓库状态 / docs 可写 / 数据库连通 / launch.json。有 BLOCK 项退出码 1，**必须先修再开工** |
| `scripts/init_workdir.py` | **Step1 之前，拿到 Jira 号后** | 按 `{Sprint}-{票号}-{标题}` 在后端仓 `docs/develop/` 建需求目录；同票号已有目录则复用，多个则退出码 2 问用户；末行输出 `DIR=<路径>` |
| `scripts/compact_resume.py` | **不手动跑**：Claude Code 的 SessionStart(compact) hook 在每次压缩后自动调用 | 压缩后注入续跑提示（48h 内活跃需求、看板链接、`validate_step --status` 续跑点、压缩后必做三件事）；无活跃需求不输出、出错静默。配置见 `context-compaction.md` §4；其他 agent 工具不需要 |
| `scripts/qa_record.py` | **Step1 全程；之后每步开始前跑 `changes`** | Step1 问答记录（一个问题一节）的解析 / 写回 / 质量检查（缺问题描述 FAIL）/ 待 PM 清单导出（md、csv）/ 产品确认分享令牌（`.pm-share.json`）；看板上的改动登记在 `.qa-changes.json`，`changes` 列出改前改后（退出码 3 = 有待确认），用户确认并同步下游后 `ack`，不认可 `reject` 恢复 |
| `scripts/checklist_jira.py` | **Step3 每次改 Checklist 后** | 从 Checklist 机械生成 Jira 纯净版（去掉「图示」行与来源括注，按 `[Story号]` 拆分），不再手工复制 |
| `scripts/annotate.js` | **Step3 出标注截图时** | 注入原型 / 测试页面后 `window.__ann(...)` 画红框 + 编号 + 说明 + 连线，说明下自动加「对应 AC」；配合 Playwright 截图存到需求目录 `UI/`（做法见 step-03「标注截图怎么做」） |
| `scripts/validate_step.py` | **每步产出后，Review 之前** | 产出物存在且非空、`AC-NN` 全局唯一、矩阵覆盖每条 AC、tasks 绑定 AC、每 AC 有证据目录与复跑入口、回归项有结论、交付前无 `[open]`、技术设计有证据标注且无「通常/应该是/按惯例」这类未取证措辞、**代码改了但对应文档没改**（Step12/13，见 §2）、**矩阵无模糊预期/无折叠省略/分支均标优先级**；编码步只查 tasks 编码任务组（「回归任务」组留到交付门禁）；测试步与交付门禁查**用例状态 vs RESULT**；交付门禁（fullstack Step13）另查 tasks 全部勾选、**回归清单汇总 vs 各行**、交接文档时效、证据验收判定，并**按当前产出物重跑前序各步**（旧绿灯过期即 FAIL）。R-NN 结论只认结论词前同一分句里没有否定词的写法 |
| `scripts/verify_state.py` | **11.4 并行验证时认领/收尾每条 AC；11.6 证据终验** | 用例状态登记（待验证/验证中/修复中/通过/失败/…）+ **证据终验**（`final` 子命令：未终验/终验中/终验通过/终验不通过/**豁免**，只核对证据不重跑浏览器；`豁免` 仅限用户明确放行、Checklist 置 `[waived]` 时用，`--note` 必写放行范围与用户原话）+ 会话与窗口标识归属；锁文件保证多会话不抢同一条 AC，超时的可 reclaim；`init --from-result` 支持老需求按 RESULT.md / Step 1x 报告回填；**`invalidate` 改代码后作废受影响 AC**（打回待验证 + 终验作废 + 记时间原因）；`backfill-duration` 按 NOTES 用时 / 证据时间回填耗时；**每次登记成功后自动刷新看板**（`--no-dashboard` 才跳过） |
| `scripts/surefire_aggregate.py` | **引用单测作为 AC 证据时** | 复制当次 surefire `TEST-*.xml` 全集进 `tests/_unit/<批次>/`，按 classname 跨文件聚合计数 + md5（surefire 并行会把用例记进别的类的 XML） |
| `scripts/figma_cache.py` | **用户给出 Figma 链接时；设计稿更新后 `--refresh`** | 按链接缓存 Figma 节点到 `figma/<节点>/`（2x 截图、`design.md` 层级 / 文案 / 色值 / 间距 / 字号、`node.json`）并生成索引；重跑保留已填的区域 / AC 列与样式、差异两段。令牌只读环境变量 `FIGMA_API_KEY`，不打印不落盘 |
| `scripts/doc_sources.py` | **用户给 PRD 等文档的 GitHub / Confluence 链接时 `add`；每天第一次处理需求时 `check --daily`；用户要求检查文档更新时 `check`** | 需求源文档版本跟踪：登记表 `源文档/sources.json`、每版快照 `源文档/<名称>/<文档标题>_v<N>_<日期>_<时分>_<上游版本>.md`、相邻版本差异 `<文档标题>_差异_v<N-1>-v<N>.md`（README 另列上游时间与拉取时间；命名规则变化后老登记跑 `migrate` 改名）；GitHub 用本机 git 凭据在 `~/.cache/doc-sources/` 维护部分克隆缓存仓直接拉（上游版本 = 文件最近提交短 SHA），Confluence 由 AI 用 Atlassian MCP 读后 `ingest`；同一文档的多个来源 `--group` 分组、`--canonical` 指定原文档，按上游时间选最新写回原文档（手改过先备份），最新来源切换时提示；末行 `RESULT changed= pending= unchanged= errors=`，拉取失败退出码 2。用法与变更后的影响分析见 `doc-sources.md` |
| `scripts/verify_dashboard.py` | **看板服务常驻；手工改动后 / 11.4.3 收尾 / 11.6 终验后** | 生成《验证进度看板.html》（单需求：整体进度+用例状态+**证据终验**+证据+耗时；**静态打开是生成时快照、不会刷新**，只有 `--serve` 才随磁盘实时更新）与外层 `docs/develop/index.html`（所有进行中需求总览，排除 archived/tools，可切换）；**`--serve` 模式**（打开看板一律用它，见 SKILL.md 执行指令 1.5）：内容随磁盘实时更新（每次请求现场解析）、「需求问答」页签可编辑保存、需求列表可**归档**（标记已完成 → 移到 `archived/`，「已归档」入口可查看 / 恢复）；默认还会起 `0.0.0.0:8786` 的局域网「产品确认」页，不需要就 `--pm-port 0`；`validate_step.py --record` 会顺带重建看板 |
| `scripts/handover_match.py` | **Step14** | AC↔Subtask 匹配：读 Checklist + Jira Sub-task JSON → 写出映射 md/json；`--apply` 写入 `.handover-state.json`（`已匹配待确认`） |
| `scripts/handover_state.py` | **Step14** | 提测状态（与验证态分离）：`待匹配`→`已匹配待确认`→终态`已提测`/`无需提测`；映射与 Jira 动作记录写 `.handover-state.json`；转交人默认值见项目 `AGENTS.md`（脚本 `DEFAULT_ASSIGNEE` 写死为 creative-management 的值，其他项目传 `--assignee`） |
| `scripts/i18n_new_keys.py` | Step13 末尾 | 从前端分支 diff 提取新增 `$t()` key，查翻译库生成《Step 13-多语言新增key清单.md》骨架；退出码 2 = 用了线上不存在的编码 key（缺陷）。看板「多语言」页签读取该文件，可导出 |
| ~~`scripts/distribute.py`~~ | **已移除（2026-10-14）** | 改完本 skill 后分发**必须用独立 skill `distribute-agent-skills`**（`~/.claude/skills/distribute-agent-skills/scripts/distribute.py`，先 `--dry-run`，报告复制数与 MD5 不一致数） |

> 🔴 **解释器：本机 `python` 可能是跑不起来的假别名**（Windows 商店版 `python.exe` —— `where python`
> 找得到，执行报 `Program 'python.exe' failed to run`）。示例统一写 `py`；若你的环境 `py` 不可用
> （非 Windows / 未装启动器），换成 `python3` 或 `python` 里能跑的那个 —— 先 `python3 -V` 验一下。
> `preflight.py` 的「文档命令用的解释器」会替你检查这件事。脚本内部一律用 `sys.executable`
> 拉起子进程，所以脚本本身不受影响 —— 受影响的只有手敲的命令、文档示例与 `compact_resume` 的 hook。

```bash
py scripts/preflight.py --project .
py scripts/validate_step.py --dir docs/develop/{...} --step 3 --record
py scripts/validate_step.py --dir docs/develop/{...} --status   # 看进度与续跑点
py scripts/validate_step.py --self-check                        # 只校验 skill 自身（改完 skill 跑一次）
```

## 2. 文档同步检查（Step12 / Step13 自动跑）

规则早就写在项目 `AGENTS.md` 里（REST API 变更必须同步 OpenAPI 注解与 API 文档），但一直没有检查，做没做没人知道。
现在 `validate_step.py` 按改动路径自动判「改了什么 → 必须同步哪份文档 → FAIL 还是 WARN」。
**映射表按项目 `AGENTS.md` 约定**（creative-management 见「AI-driven workflow 项目约定 → 文档同步检查」）；
⚠️ 当前映射写死在脚本 `DOC_SYNC_RULES` 里（creative-management 的路径），换项目或改规则时脚本与项目 `AGENTS.md` 一起改。

默认只看**工作区未提交改动**（流程禁止 Step13 前提交，通常够用）；需要并上分支已提交
部分时加 `--base origin/production`。仓根默认从 `--dir` 上溯三层，可用 `--project` 覆盖。

## 3. `--record` / `--status` 与硬规则

`--record` 写入 `docs/develop/{...}/.workflow-state.json`，记录每步通过与否、失败项、时间戳、连续失败次数。
**中断后先跑 `--status` 拿续跑点**，不要从头重来。

🔴 **validate_step 未通过 = 本步未完成，禁止进入下一步**，与人工 Review 门控同等效力。
它是断言不是建议：`FAIL` 必须修，`WARN` 必须在 Review 时逐条说明为何可接受。

## 4. 失败分类与处置（不是所有失败都该停下问人）

`validate_step.py` 的退出码已分级：**0=通过，1=可自动修，2=必须停**。按失败类型处置：

| 失败类型 | 怎么认 | 处置 |
|---|---|---|
| **环境问题** | preflight BLOCK；连不上库/服务；超时 | 重试 + 退避；仍不行 → 停，报具体失败项 |
| **产出物不合规** | validate_step FAIL（缺编号、矩阵没覆盖、缺证据目录） | 自动补，**同一步最多 2 次** |
| **编译 / 单测失败** | mvn 非 0、测试红 | 按 Step11.2「根因优先」自动修，**同一步最多 2 次** |
| **需求理解偏差** | 实现与 Checklist 对不上、AC 无法落地、用户反馈方向错 | 🔴 **立即停** —— 自动修只会越修越偏，必须回 Step1/2 与用户对齐 |
| **破坏性变更** | 命中核心原则 6（改既有接口）的任一项 | 🔴 **立即停**，由用户在三种方案中选，禁止 AI 自行决定 |
| **授权类** | 写操作、生产环境、造数、提交推送 | 🔴 **立即停**，等用户明确授权 |

🔴 **「同一步最多 2 次」是硬规则，且不靠记忆**：`--record` 把连续失败次数写进
`.workflow-state.json`，第 3 次仍 FAIL 时脚本直接退出码 2 并打印停止指令。
**收到退出码 2 就停，把 FAIL 清单和失败历史贴给用户**，不要继续自动修 ——
反复修同一处，说明判断依据本身就是错的（典型：把需求偏差误判成产出物不合规）。

阈值可调：`--max-attempts N`。调高之前先想清楚为什么这一步值得多试。

## 5. 改完 skill：`--self-check` → 分发

> **改完 skill 之后还要分发**：本机装了多个 agent 工具，各有独立的 `skills` 目录，
> 不分发 = 换个工具跑的还是旧版，而且**不报错**。分发是独立 skill `distribute-agent-skills`
> （`~/.claude/skills/distribute-agent-skills/`），顺序固定：**改 → `--self-check` 过 → 分发**。
> 本 skill 内的 `scripts/distribute.py` 已移除。改完 skill → `--self-check` 通过 → **用 `distribute-agent-skills` skill 分发**，不分发 = 其他 agent 工具还在用旧版。

`--self-check` 校验 **skill 自身**，退出码 1 即有问题（实跑输出 10 项，别只看下面 5 条）：

- `LNN` 引用是否都落在本 skill lessons 的有效编号内、计数行是否跟得上、索引表有无漏行
- `StepN <某步名称>` 是否指向本 skill 真正的那一步；缺陷猎捕清单的维度字母与 Review 步一致
- 「原则 N」不超过 SKILL.md 核心原则表的行数（表重排后老编号会静默指错）
- `` `xxx.md` `` 指向的 reference 文件存在；`` `xxx.md` §N `` / `playbook §N` 的章节号在目标文件里能找到（尽力而为）
- **跨 skill lesson 编号**：两个 workflow 里**同一句话**引用的 `LNN`，标题必须对得上（逐字同句才比，见下）
- **缺陷猎捕维度**：`bug-hunting-checklist.md` 的维度字母与 Review 步声明的一致
- **定期自检**：`REVIEW.md` 的「上次 review」距今 ≥7 天就 WARN（只在这一条检查里跑，正常每步 `--step N` 时不跑）
- 与另一个 workflow 共用的文件（完整列表以 `validate_step.py` 的 `SHARED_FILES` 为准：playbook 的 core / evidence / parallel 与索引、evidence-acceptance、test-handover、lesson-harvest、subagent-acceleration、context-compaction、看板前端与共用脚本）有没有漂移，报告**真实差异行数**（difflib；步号与 `LNN` 先归一化）。`browser-playbook-tools-cdp.md` 有意不在共用列表：§3 第 6/7 条仅前端适用

> 两个 workflow 的 lessons 是**各自独立编号**的（同一条经验在两边的编号往往不同），
> 内容从一边复制到另一边时 `LNN` 会**静默指向错误条目** —— 不报错、不影响运行，执行时却对照到了别的 lesson。**已实际发生两次**。
> 改完 skill（尤其是在两个 workflow 间搬内容后）跑一次。

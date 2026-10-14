# ai-driven-backend-workflow Review 记录

上次 review：2026-10-14（下次到期：+7 天）

## 2026-10-14（修复轮：按用户要求的质量审查结论修 P0 / P1）

> 与 fullstack 版同一轮修复（共享脚本与共享文件逐字同步），步骤号按本 workflow 换算：
> 测试矩阵 Step7 / tasks Step8 / 编码 Step9 / 测试与实机验证 Step10 / AI Review Step11 / 交付 Step12 / 提测 Step13。

- 范围：SKILL.md + references 全部 md + scripts 全量审读，结论均在本机复现
- **已改 P0（分流不可用）**：`scripts/validate_step.py` 新增 `declared_skips()` —— 读 Spec / 问答记录文首的「变更类型」与「跳过 StepN」声明并据此跳过检查；Step3 与交付门禁步（后端 12/13）声明跳过会被拒绝；编码步在 tasks 步被跳过时不再用 `Step 8-tasks.md` 卡住。此前 B/C 路径必然在交付步报「产出物 未找到」。配套文档：`step-01` §0（文首声明格式、C 路径写问答记录、《回归验证清单》仍强制）、SKILL.md 原则 1、`step-12` 的「前序步骤复检」；另 `sys.dont_write_bytecode` 避免 `scripts/__pycache__`
- **已改 P1**：RESULT 结论解析统一到 `verify_state`（原来只认顶格 `- 结论：`，实测真实 RESULT.md 过半数用 `| 结论 | ✅ PASS |` 表格行 → 「用例状态 vs RESULT」门禁静默不比对）；交付门禁纳入 `[blocked]`；`doc-output-and-context.md` 生产库只读口径与模块名（`creative-management-api/base/model/feign`）修正；`step-10-test-debug.md`「不产出 `script/`」改为「不写测试代码 ≠ 不存脚本」；`test-handover.md` 文件名写死为 `Step 12-测试交接文档.md` 并改「交付收尾步」；10.4.2 内联命令补齐 `--dir`；`finish --force` / `claim --force` 口径修正；授权口径统一（逐项勾选 = 对该条目授权）；编码步（Step9）端点自测限定只读；`handover_state.py` 用法 `--dir` 前置；解释器 `python` → `py`（文档示例 / hook / preflight 真检查 / 项目 compact hook）
- **已改 P2/P3（与 fullstack 同轮，共享脚本/共享文件逐字同步）**：`verify_state.py` 空登记 `final --ac ALL` 拒跑、原子替换加 `PermissionError` 重试、陈旧锁 10 分钟自动回收；`validate_step.py` 新增 `Step3 Jira 纯净版` 与 `Step5 回滚脚本` 断言、`[waived]` 逐行判定、Step13 产出物去掉兜底通配、`--all` 帮助改准；`qa_record.py` 实现 `--format text`；`annotate.js` 空选择器显式报错；`preflight.py` 不再代建 `docs/develop`；`verify_dashboard.py` 结论解析复用 `verify_state`（看板显示中文「待验证」）；文档：`doc-output` 路径基准 + 目录树《Step 10-数据核对报告.md》+ 缓存/命名/维度/AGENTS.md 指向订正、SKILL.md 门控表补第①步与 `--project`/`--pm-port`、`scripts.md` self-check 补 10 项、`step-10` 报告模板补 H 表与 `init` 前置、断言表允许录屏时间点、两条 CRITICAL 补优先级、`step-06` 幂等口径、`step-03` prd-to-jira-ac 兜底、`data-reconciliation` 补「重查询 ≤2」、`lessons-learned` 触发时机、`self-review` 签字权边界、playbook 索引 §12.7、`step-12` 模板补 F 行、`evidence-acceptance` 派发输入、REVIEW.md 自身计数订正
- 自检：4 份（两 skill × 两个 skills 目录）`--self-check` 全 ✅；`py -m py_compile` 全通过；`26Q4-Sprint1-CP-58118-*` 交付步复检 ✅；空目录仍 FAIL
- 分发：**未分发**（等用户决定）

## 2026-10-14（子 agent，按本 skill references/self-review.md 流程）

- 范围：SKILL.md + references/ 下全部 29 个 md 逐个通读（与 fullstack 版逐文件 diff 后读差异部分，共用文件两边逐字核对）；scripts/ 下 12 个 py/js 跑 `--help`（verify_state **10** 个子命令、handover_state 5 个子命令逐个跑 —— 原记录写 8 个，2026-10-14 修复轮实测 10 个）并核对 validate_step.py 的 2026-10-14 新增检查；dashboard 前端与 verify_dashboard.py / verify_state.py 内部实现只看了入口与参数，未逐行读
- 本 skill 的 LNN 全部逐条按语义对过（不只看编号是否存在）

### 已改（按类别）

**跨 skill 复制导致的错号 LNN（3，self-check 查不出：编号存在但指错条目）**
- `SKILL.md:44`「同 L18 的道理」→ L15（讲门禁虚假安全感的是 L15；本 skill 的 L18 是「交付前反查 AC」）
- `step-01-requirements-qa.md:129` `ad_type` 存 aiName/dbName「见 L5」→ L6（L5 是上游依赖完成度，真源一致性是 L6）
- `step-12-global-consistency-review.md:39`「见 L8：决策必须回写文档」→ L7（L8 是 STUB 标注）

**错误的步号 / 流程走向（4）**
- `step-09-coding.md`：「提交统一在 Step11 AI Review 通过后」→ Step12 全局一致性审查（Step12 才是唯一允许提交的环节）
- `step-10-test-debug.md` 10.6 门控：「进入 Step12 / 禁止进入 Step12」→ Step11（10.6 之后是 AI Review）
- `step-07-test-matrix.md`：「Step11 A3 按本清单核对」→ A4（A3 是漏改反查）
- `SKILL.md` 执行指令 6/7：补「Step12 提交后进入 Step13」；经验沉淀时机「工作流结束后」→「Step13 提测终态落定后」（与自进化机制一节一致）

**失效引用 / 命令跑不通（3）**
- `step-13-ac-subtask-handover.md`：`handover_state.py decide --dir …` 实跑报缺 `--dir` → 改为 `--dir <需求目录> decide …`；补 `record-jira` 子命令与 `handover_match.py --allow-empty`
- `scripts/handover_state.py`（共用）：Windows 管道下 `--help` UnicodeEncodeError → main() 开头 reconfigure utf-8；已 `py_compile`
- `step-11-ai-review.md` 产出格式：E 是「缺陷猎捕」，格式里却写「E.审查结论」，且缺 A3/A4/C2/缺陷猎捕 → 补齐，结论行去掉字母

**与现行规则 / 项目事实矛盾的旧口径（7）**
- `step-12-global-consistency-review.md` 提交信息 `feat({需求id}): {需求title}` 与项目实际 `feat:CP-xxxxx 描述` 不符（证据：creative-management `git log` 近 8 条全是 `feat:CP-58118 …` / `fix:CP-58927 …` 格式）→ 改为按所在仓约定并指向项目 AGENTS.md；补多仓提交提醒
- `step-12` 交付门禁 tasks：「前端回归项写进交接文档」→「需人工回归的项」（后端流程）
- `doc-output-and-context.md` 自检清单：「已汇报路径并暂停 review？未获确认不进入下一步？」与门控两档矛盾 → 按档位改写；「Step9/10 未 git」→ Step9/10/11；「Step11 四维」→ 合规 A~D + 缺陷猎捕 E；「Step12 五维」→ A~E + F 证据验收 + 交付门禁新查项；「Conventional Commits」→ 按所在仓规范
- `lesson-harvest.md`（共用）：「在哪做：全局一致性审查最后一节」→ 提测终态之后
- `step-10-test-debug.md`：10.5「G.数据核对汇总」与 10.4.3 G 表撞号 → H 表；一 AC 一闭环 ④⑤ 补「RESULT `- 结论：` 与 finish 状态同词」硬提醒；`[done]` 非通过时退回 `[open]`
- `browser-playbook-parallel.md` §12.7 / `browser-playbook-core.md` §6（共用）：同 fullstack（RESULT 结论解析口径、中文状态词映射）
- `step-01-requirements-qa.md` C 路径补 `→ 13`；看板启动方式指向 SKILL.md 执行指令 1.5

**补使用点提醒（6）**
- `step-05-ddl.md`：补「EXISTS 子查询涉及软删表必须加 `is_delete = 0`（见 L1）」—— L1 标注「第五步」，但第五步文件里原本没有任何提醒
- `step-08-tasks.md`：补「每条任务回写 AC-NN、复用任务标注」与「上游 STUB 依赖标注（见 L8）」—— L8 标注「第八步」但该文件原本没提
- `step-09-coding.md`：权限补「数据权限 visibleUserIds/profile（见 L13）」，补「Controller 入参白名单 + 互斥必填、对前端文案英文（见 L10、L12）」—— 三条 lesson 都标注第九步，但该文件原本只写了 `@PreAuthorize`
- `step-11-ai-review.md` 维度 D：补 Lessons 合规逐条对照（SKILL.md 写了「Step11 增加 lessons 合规检查」，step 文件里只有 L17/L12 两条）
- `evidence-acceptance.md` / `subagent-acceleration.md` / `scripts.md` / `data-reconciliation.md` / `doc-output` 目录树：同 fullstack
- `openspec-integration.md`：补 Step12 / Step13 两行；Step10、Step11 描述更新

**lessons（并入既有条目，计数仍 17）**
- L17 标注图「`-annotated` 后缀」→ `-标注`（旧证据仍认）；L15 新增「补充三（2026-10-14）」；自进化触发时机补「④ Step13 提测终态后（主入口）」

### 已删
- `step-03-checklist.md`「## Review 门控」一节（3 行）—— 被紧随其后的「🔴 门控：Spec + Checklist 合并确认（阻塞）」完全覆盖，理由同 fullstack REVIEW.md

### 待确认
- `data-reconciliation.md` §9「❌ 在生产库上验证」与「mysql MCP 连的是生产 US（只读）」的现状冲突，需用户定口径，未改
- `step-05-ddl.md` 新表软删列 `is_deleted` vs 既有 `is_delete`（项目 XML 两者并存）取哪个，未改
- L15「补充三」未走 lesson-harvest 提名门控，不同意可整行删除
- `--self-check` 查不出语义错号（本次 3 处都是这类）；是否加语义校验待定
- ~~`handover_match.py` 报错文案写死「见 step-14」，本 skill 应为 step-13（共用脚本，未改）~~ **（2026-10-14 修复轮复核：文案已改为「全栈 Step14 / 后端 Step13」，本条作废）**；`scripts/distribute.py`（deprecated）`--help` 在 cp1252 下崩 —— **该文件已移除**，改用独立 skill `distribute-agent-skills`

### 自检
- `python scripts/validate_step.py --self-check` → ✅ skill 自洽（17 lessons 引用、步号、原则、reference 链接、§ 章节全部通过；25 个共用文件与 fullstack 逐字相同）
- `python -m py_compile scripts/handover_state.py` → 通过；已删除 `scripts/__pycache__/`
- 未分发（主会话统一分发）

## 2026-10-14 用户对待确认项的决定（主会话落实）

- 生产库只读核对：**允许**（禁写、禁无关数据、禁无条件大表扫描）→ 已改 `data-reconciliation.md` **第 2 节末（:77）**与第 9 节禁止事项（原记录写「第 4 节开头」，2026-10-14 修复轮复核位置有误）
- 新表软删列：统一 **`is_delete`** → 已改 `step-05-ddl.md`；lessons / data-reconciliation 里 `is_delete`/`is_deleted` 并列的描述保留（存量表两种都有）
- lesson 引用核对：**加** → `validate_step.py --self-check` 新增「跨 skill lesson 编号」：两个 workflow 同一句话（LNN 换成占位符后比对）引用的 lesson 标题必须相似，排除沉淀层级 / 跑测分层这类非 lesson 用法；反向测试（把 L4 改成 L1）能拦住
- `scripts/distribute.py`：**已移除**，并从 SHARED_FILES 删除；`scripts.md` 写明分发必须用 `distribute-agent-skills` skill（SKILL.md 原有提醒保留）
- 「补充三」lesson 行：用户未表态，保留

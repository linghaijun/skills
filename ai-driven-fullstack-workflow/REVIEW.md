# ai-driven-fullstack-workflow Review 记录

上次 review：2026-10-14（下次到期：+7 天）

## 2026-10-14（修复轮：按用户要求的质量审查结论修 P0 / P1）

- 范围：SKILL.md + references 32 个 md + scripts 13 个 py/js 全量审读；每条结论都在本机复现（含真实需求目录 `26Q4-Sprint1-CP-58118-*`、`26Q3-Sprint6-CP-57189-*` 等）
- **已改 P0（分流不可用）**：`scripts/validate_step.py` 新增 `declared_skips()` —— 读 Spec / 问答记录文首的「变更类型：A/B/C」与「跳过 StepN」声明，`check_exists` / `check_earlier_steps` / 主循环据此跳过；Step3 与交付门禁步（全栈 13/14、后端 12/13）声明跳过会被拒绝；编码步在 tasks 步被跳过时不再用 `Step 9-tasks.md` 卡住。此前 B/C 路径必然在 Step13 报「产出物 未找到」（实测 C 路径 6 处、B 路径 2 处）
  - 配套文档：`step-01` §0 重写（文首声明格式示例、C 路径没有 Step2 所以写问答记录、《回归验证清单》仍强制、Step3/13/14 不可跳过）、SKILL.md 原则 1、`step-13` 的「前序步骤复检」都写明「声明格式不对 = 门禁不认」
  - 顺手：`validate_step.py` 顶部 `sys.dont_write_bytecode = True` + 子进程 `PYTHONDONTWRITEBYTECODE=1`，跑验收不再在 `scripts/` 留 `__pycache__`
- **已改 P1**：
  - RESULT 结论解析统一到 `verify_state._verdict_text + classify_verdict`（原来只认顶格 `- 结论：`，实测 250 份 RESULT.md 有 140 份是 `| 结论 | ✅ PASS |` 表格行 → 「用例状态 vs RESULT」门禁静默不比对）；解析不出的改为 `RESULT 结论可解析性` WARN 并点名 AC
  - 交付门禁把 `[blocked]` 纳入拦截（原来只拦 `[open]`，`[blocked]` 既不用放行也不留豁免记录 = 一键绕过）
  - `doc-output-and-context.md`「禁止在生产库执行」与 `data-reconciliation.md`（用户 2026-10-14 确认生产只读允许）矛盾 → 改为「只读声明 + 生产库允许只读核对，禁写 / 禁无关数据 / 禁无过滤扫大表」
  - `doc-output-and-context.md` 后端模块名 `micro-api/micro-common-db/...`（实际 `creative-management-api/base/model/feign`）→ 改为按仓根 pom 的 `<module>`，两边 skill 同步
  - `step-11-*.md`（后端 `step-10-*.md`）「Agent 实机验证轨**不产出 `script/`**」与 evidence-acceptance C7 / playbook §4.1「产出过证据的脚本必须进 `script/`」矛盾 → 改为「不写测试代码 ≠ 不存脚本」
  - `test-handover.md`「最后一步（fullstack Step13）」自相矛盾 + 文件名模板 `Step <最后一步号>-…` 与 `HANDOVER_GLOB`（写死 `Step 13-测试交接文档.md`）不符 → 改为「交付收尾步」+ 写死文件名
  - 11.4.2 内联 4 条 `verify_state.py` 命令全漏 `--dir`（照抄 exit 2 = 必须停档）→ 补齐，并加一行「每个子命令都必须带 `--dir`」
  - `parallel §12.7` 的 `finish --status <结论> --force` 必失败（`finish` 要求当前是「验证中」，`--force` 改不了状态）→ 改为「已完结的先 `claim --force` 回到验证中，再 `finish`」，step-11 / step-10 终验节同步
  - 11.4.1「唯一一次授权入口」与 11.4.2「每一次写都要单独问 / 步骤文档里写了不算授权」矛盾 → 统一为「逐项勾选 = 对该条目授权，不跨条目不跨会话；未勾选 / 清单后新增的写操作再问一次」
  - 编码步「新增/改动的端点各打一次」缺授权与只读约束（本机联调后端连生产 US）→ 限定「只打只读端点，写端点留到实机验证或用户当次授权」
  - `scripts/handover_state.py` 自带用法把 `--dir` 写在子命令后（照抄 exit 2）→ 改为 `--dir` 前置并注明原因
  - 解释器：`python` 在本机是跑不起来的 WindowsApps 假别名 → 文档示例统一 `py`、`context-compaction.md` hook 与 `compact_resume.py` 用法改 `py`、`preflight.py` 新增「文档命令用的解释器」真跑检查、项目 `.claude/settings.local.json` 的 compact hook 改 `py`（实测已能注入续跑提示）
- **P2/P3 同轮完成（脚本）**：`verify_state.py` 空登记下 `final --ac ALL` 改为**拒跑**（原来「处理 0 条」exit 0 = 终验门禁空转）、`.verify-state.json` 原子替换加 Windows `PermissionError` 重试、锁文件超 10 分钟按陈旧锁回收（原来强杀后所有登记 exit 2 且无恢复路径）；`validate_step.py` 新增 `Step3 Jira 纯净版`（强制产出物原来零断言）与 `Step5 回滚脚本` 检查、`[waived]` 改为逐行判定（标记在编号前/后都认，原来只认前者 = 免检放行）、Step14 产出物去掉 `Step 14-*.md` 兜底通配（`Step 14-经验沉淀提名表.md` 曾骗过存在性检查）、`--all` 帮助文字改准、`sys.dont_write_bytecode`（跑验收不再留 `__pycache__`）；`qa_record.py` 实现真正的 `--format text`（原来静默等同 md）；`annotate.js` 全选择器落空时显式报错（原来返回 `top: Infinity` 静默裁出空图）；`preflight.py` 的 `docs/develop` 探针不再 `mkdir`（从错仓根跑会凭空建一棵树）；`verify_dashboard.py` 结论解析复用 `verify_state`（第三套解析器，曾产出英文 `NOT_RUN`），`app.js` 渲染时显示「待验证」
- **P2/P3 同轮完成（文档）**：`doc-output-and-context.md` 加「路径基准以后端仓根为准」、目录树补《Step 11-数据核对报告.md》、修正 ddl 注释 / 英文文件名示例 / 「6 个维度」→ 7 / AGENTS.md「多仓提交」指向；SKILL.md 门控档位表补第①步、执行指令 0/1.5 补 `--project` 与 `--pm-port 0`；`scripts.md` self-check 清单补到 10 项、静态看板「实时刷新」措辞改准；`step-11`/`step-10` 报告模板补 H 表、补 `init` 前置、断言表允许「录屏 + 时间点」、两条相邻 CRITICAL 补优先级声明、db 证据名补 `{AC-NN}-` 前缀；`step-06` 的 `Idempotency-Key` 改为「先 grep 现状、沿用既有机制，新增须问用户」；`step-03` 补 `prd-to-jira-ac` 缺失时走人工粘贴的兜底；`data-reconciliation.md` 补上「重查询同时 ≤2」（三处引用了它但原文件没有）；`lessons-learned.md` 自进化触发时机改为「只登记候选，写入只在提测终态后 + 用户确认」；`self-review.md` 写明「结构性修复可直接改、规则增删须签字」；playbook 索引补 §12.7；step-13/step-12 产出物模板补 F 行；`evidence-acceptance.md` 派发输入补 `tests/.verify-state.json`；REVIEW.md 自身的计数 / 行号 / 过期待确认项一并订正
- 自检：`py scripts/validate_step.py --self-check`（两 skill × 两个 skills 目录 = 4 份）→ 全 ✅；`py -m py_compile` 全部 py → 通过；C 路径复现目录 `--step 13` → ✅ 通过（无声明时仍 FAIL、声明跳过 Step13 被拒）；真实目录 `26Q4-Sprint1-CP-58118-*` `--step 13` → ✅ 通过；空目录 `--step 13` → 仍 5 项 FAIL
- 附带发现（**历史需求目录里的真实数据问题，不是 skill 缺陷**，是上面那条解析修复后才暴露的）：`26Q3-Sprint6-CP-57189-*` 9 条 AC 的 registry 状态与 RESULT.md 结论不一致（如 AC-41 状态=阻塞 / RESULT=✅ PASS）；`26Q4-Sprint1-Amazon…` 5 条不一致；`CP-57339` 2 份 RESULT.md 解析不出结论（AC-20 / AC-29）、`Amazon…` 1 份（AC-18）。重跑这两步门禁前需以 RESULT 为准回写 `verify_state`，或按历史目录不再重跑处理
- 分发：**未分发**（等用户决定；`distribute-agent-skills` 只覆盖不删除）

## 2026-10-14（子 agent，按本 skill references/self-review.md 流程）

- 范围：SKILL.md + references/ 下全部 32 个 md 逐个通读（含与 backend 版逐文件 diff；原记录写 31，2026-10-14 修复轮实测为 32）；scripts/ 下 13 个 py/js 跑 `--help`（verify_state 10 个子命令、handover_state 5 个子命令逐个跑 —— 原记录写 8 个，实测 10 个）并核对 validate_step.py 的 2026-10-14 新增检查（编码步 / 交付门禁 tasks 分组、前序步骤复检、否定词同分句、用例状态 vs RESULT、回归汇总一致性、交接文档时效）；dashboard 前端（app.js / app.css / html）与 verify_dashboard.py / verify_state.py 内部实现只看了入口与参数，未逐行读
- 重点核对：近期改过的规则与旧条款是否矛盾、索引 / 门控表 / 脚本表与 references 是否一致、引用的小节 / 子命令 / 参数是否存在

### 已改（按类别）

**失效引用 / 命令跑不通（4）**
- `step-14-ac-subtask-handover.md`：`handover_state.py decide --dir …` 实跑报 `the following arguments are required: --dir`（`--dir` 是主解析器参数，必须写在子命令前）→ 改为 `handover_state.py --dir <需求目录> decide …`；Jira 动作登记补上实际子命令 `record-jira --key --transition --assign`；无 Sub-task 时补 `handover_match.py --allow-empty`（不加脚本直接拒绝空列表）
- `scripts/handover_state.py`、`scripts/figma_cache.py`：Windows 管道下 `--help` 直接 UnicodeEncodeError（cp1252）→ main() 开头 reconfigure stdout/stderr 为 utf-8（与其他脚本同一写法）；已 `py_compile`
- `step-12-ai-review.md` 产出格式：维度 G 是「缺陷猎捕」，格式里却写「G.审查结论」，且缺 A3/A4/E2/缺陷猎捕 → 补齐各维度行，结论行去掉字母
- `step-08-test-matrix.md:128`（原记录误写 :223，该文件共 146 行）：「Step12 A3 按本清单核对」→ A4（A3 是漏改反查，回归审计是 A4）

**与 2026-10-14 新规则 / 现行门控矛盾的旧口径（8）**
- `doc-output-and-context.md` 自检清单：「已汇报路径并暂停 review？未获确认不进入下一步？」与「门控分两档（🟡 通知式直接继续）」矛盾 → 改为按档位描述并要求 `validate_step --record` PASS
- 同上：「Step9/10 全程未 git」→ Step10/11/12（与原则 15 一致）；「Step12 五维审查」→ 合规 A~F + 缺陷猎捕 G；「Step13 五维 A~E」→ A~E + F 证据验收，并加一句交付门禁新查项（前序复检 / 用例状态 vs RESULT / 回归汇总 / 交接文档时效 / tasks 含回归组全勾）
- `lesson-harvest.md`（共用）：「在哪做：全局一致性审查的最后一节」与 SKILL.md / step-14「提测终态之后」矛盾 → 改为提测终态之后
- `step-11-test-debug.md`：11.5「G.数据核对汇总」与 11.4.3 的「G.用例状态与窗口归属」撞号 → 数据核对改 H 表
- `step-11-test-debug.md` 一 AC 一闭环 ④⑤：补硬提醒「RESULT 顶层 `- 结论：` 与 finish 状态同词，门禁查『用例状态 vs RESULT』」；`doc-output` 目录树 RESULT.md 注释同步
- `browser-playbook-parallel.md` §12.7（共用）：「RESULT.md 首行结论」与脚本实际解析（首个顶层 `- 结论：`，忽略引用块）不符 → 改准
- `browser-playbook-core.md` §6（共用）：FAIL/BLOCKED/PARTIAL 补中文状态词映射，指向门禁比对（使用点提醒）
- `step-03-checklist.md` 状态生命周期 + `step-11` §11.4：`[done]` 在 11.3 置位，而 11.4 / 证据验收只认「通过」→ 补「实机非通过 / 验收不通过时退回 `[open]`」

**过时事实 / 计数（5）**
- `step-01-requirements-qa.md`：「13 步」×3 → 14 步；C 路径补 `→ 14`（原则 15 要求提测终态）；看板启动方式改为指向 SKILL.md 执行指令 1.5（原写法不探测 8787 常驻服务）
- `openspec-integration.md`：「13 步全栈」→ 14；补 Step14 行；Step12「五维」→ A~F + G
- `SKILL.md` 工作流总览 Step12「合规五维」→ 合规 A~F + 缺陷猎捕 G（未动第 8 行定期自检提醒）
- `subagent-acceleration.md`（共用）：「合规五维」→「合规各维」（两边维度数不同）
- `lessons-learned.md` L20：标注图「`-annotated` 后缀」→ `-标注`（中文命名，旧证据仍认）；自进化触发时机补「④ Step14 提测终态后（主入口）」

**补使用点提醒 / 可找性（6）**
- `evidence-acceptance.md`（共用）：补复验另存 `-第N轮.md` / `tests/_acceptance/` 的读取顺序（门禁早已支持，文档没写）
- `subagent-acceleration.md` §5（共用）：补「收到汇报同一轮主 agent 回写所有记录处」→ §12.7
- `scripts.md`：validate_step 行补 2026-10-14 新增检查清单；self-check 共用文件描述改为「以 SHARED_FILES 为准」并补全漏列项
- `doc-output-and-context.md` 目录树补 Jira 纯净版、浏览器验证步骤 / 报告、证据验收报告、测试交接文档、Step14 映射、状态文件、figma/、tests/；多仓表补 `platform-provider/`（项目 AGENTS.md 多仓提交节有）
- `data-reconciliation.md`：补 `sql-mcp/` 实际位置（`IdeaProjects/sql-mcp`，不在业务仓内）
- `lessons-learned.md` L18：新增「补充三（2026-10-14）」记录否定词改为同分句判定、多处记录同步断言的缘由（并入既有条目，不新增编号，计数不变 18）

### 已删
- `step-03-checklist.md`「## Review 门控」一节（3 行）—— 被紧随其后的「🔴 门控：Spec + Checklist 合并确认（阻塞）」完全覆盖（同样的产出物、条目数、编号区间，后者另含八类自检结论与阻塞理由），两处并存时旧节没有「合并确认」语义。原句「Review 门控通过后，可将 Checklist 同步进 Jira」同步改为「Spec + Checklist 合并门控通过后」

### 待确认
- `data-reconciliation.md` §9「❌ 在生产库上验证」与现状冲突：用户记忆记录 mysql MCP 连的是**生产 US**（只读、15s 超时）。是「生产只读核对允许、写一律禁止」，还是保持禁止并改用测试库？需用户定口径，未改
- `step-05-ddl.md`「每表必含 `is_deleted`」与「EXISTS 加 `is_delete = 0`」两种列名并存：creative-management XML 里 `is_delete` 278 处、`is_deleted` 100 处，新表应取哪个需确认，未改
- L18「补充三」是本次 review 补的「为什么」，没走 lesson-harvest 的提名门控；不同意可整行删除
- `--self-check` 只校验 LNN 是否在有效编号内，查不出「编号存在但指错条目」（backend 这次修了 3 处都是这类）；是否给 self-check 加按标题关键词的语义校验，需决定
- `scripts/distribute.py` 已标 deprecated，`--help` 在 cp1252 下仍会崩；它在 SHARED_FILES 里，是否删除由主会话统一处理，未改
- ~~`handover_match.py` 报错文案写死「见 step-14」，backend 侧应为 step-13~~ **（2026-10-14 修复轮复核：该文案已改为「全栈 Step14 / 后端 Step13」，本条作废）**

### 自检
- `python scripts/validate_step.py --self-check` → ✅ skill 自洽（18 lessons 引用、步号、原则、reference 链接、§ 章节全部通过；25 个共用文件与 backend 逐字相同）
- `python -m py_compile scripts/handover_state.py scripts/figma_cache.py` → 通过；已删除 `scripts/__pycache__/`
- 未分发（主会话统一分发）

## 2026-10-14 用户对待确认项的决定（主会话落实）

- 生产库只读核对：**允许**（禁写、禁无关数据、禁无条件大表扫描）→ 已改 `data-reconciliation.md` **第 2 节末（:77）**与第 9 节禁止事项（原记录写「第 4 节开头」，2026-10-14 修复轮复核位置有误；`doc-output-and-context.md` 的只读声明同轮一并改正）
- 新表软删列：统一 **`is_delete`** → 已改 `step-05-ddl.md`；lessons / data-reconciliation 里 `is_delete`/`is_deleted` 并列的描述保留（存量表两种都有）
- lesson 引用核对：**加** → `validate_step.py --self-check` 新增「跨 skill lesson 编号」：两个 workflow 同一句话（LNN 换成占位符后比对）引用的 lesson 标题必须相似，排除沉淀层级 / 跑测分层这类非 lesson 用法；反向测试（把 L4 改成 L1）能拦住
- `scripts/distribute.py`：**已移除**，并从 SHARED_FILES 删除；`scripts.md` 写明分发必须用 `distribute-agent-skills` skill（SKILL.md 原有提醒保留）
- 「补充三」lesson 行：用户未表态，保留

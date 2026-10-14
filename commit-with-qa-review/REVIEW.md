# commit-with-qa-review Review 记录

上次 review：2026-10-14（下次到期：+7 天）

## 2026-10-14（子 agent / 主会话委派的定期自检，按本 skill references/self-review.md 流程）

- 范围：读了 3 个文件 —— SKILL.md、references/bug-hunting-checklist.md、references/commit-conventions.md；对照读了 `ai-driven-fullstack-workflow/references/bug-hunting-checklist.md`（156 行）、creative-management-all `docs/bug-lessons.md`；只读核对仓库：`creative-management/.githooks/commit-msg`、`.githooks/pre-commit`、`.agents/git-workflow.md`、`git config core.hooksPath` 与 `.git/hooks/`；`vuen-crossretail` 与 `packages/creativehub` 的 `commitlint.config.js`、`.husky/commit-msg`、`.husky/pre-commit`、`package.json` lint-staged、`node_modules/@commitlint/config-conventional`（17.8.1）
- 已改：
  - `commit-conventions.md` §1：
    - 前端「习惯带空格」→「**必须**带空格」（commitlint 走 conventional 解析器，`feat:CP-1 x` 解析不出 type → `type-empty` 报错）
    - 新增「各仓实际校验」表：后端 hook **本机未安装**（`core.hooksPath` 未设，`.git/hooks/` 只有 sample；仓内 CP-58118 Step 13 报告也记了同一事实）；后端 hook 只认 8 个 type（无 build / ci / config / revert）、票号前缀只允许大写字母、`Merge ` / `force commit` 跳过；敏感词 `password|secret|key|token|api_key` 子串匹配 + `read -p` 在非交互环境失败；前端 husky 生效、body / footer 每行 ≤100（conventional 默认未覆盖）、pre-commit `lint-staged` 会 `eslint --fix` 改暂存文件
    - type 枚举拆成「后端 8 个」「前端 12 个」（原文只写了前端 12 个并当作通用）
    - 署名行：原写死 `Claude Opus 5`（已过时，当前会话为 5.5）→ 改为「照抄当前会话 system reminder 给的 attribution 行」
  - `commit-conventions.md` §4：补「hook 没装时不擅自安装，按 §1 人工核对并在汇报写明」
  - `SKILL.md` Step 1 拆分编译提醒：补时机「全部 commit 完成后、推送前（Step 5 末尾）」
  - `SKILL.md` Step 2：补「写不出触发条件不算发现」；补读项目 bug 经验文档（`docs/bug-lessons.md`）按「排查同类」grep —— 与 AGENTS.md 第 657 行要求一致
  - `SKILL.md` Step 4 → Step 5：「拆分提交逐个 worktree 编译」原放在 Step 4（提交前的验证）里，但它只能在提交后做 → **挪到** Step 5 末尾（内容不变）；Step 4 原「确认 hook 已安装且能过」与新事实（后端未装、不擅自装）冲突 → 改为「先确认装没装，装了要过，没装人工核对」
  - `SKILL.md` Step 5 格式行：原「本工作区默认 `<type>:<票号> <描述>`」只对后端成立 → 分写后端 / 前端格式，并加后端敏感词提醒
  - `bug-hunting-checklist.md`：吸收 fullstack 清单新增项约 35 条，全部标 〔fs〕并在文件头注明来源（分页参数、枚举未知值、自动拆箱、状态机、equals/hashCode、catch 过宽、降级塌缩文案、check-then-act、乐观锁、幂等消费、测试代码改静态状态 `@ResourceLock`、软删每表、数据权限四处口径、`${}`/`#{}`、动态 SQL `<if>`、枚举存储值、private `@Transactional`、受检异常不回滚、Long 精度、CSS 过渡与计时器同源、表单仅前端校验、Promise reject 等），以及「不算发现的」一节；另加 2 条 〔bl〕（bug-lessons B-01 去重键下游 Map、B-02 异步回包读快照）。fullstack 的 `LNN` 引用全部去掉，不跨 skill 引用编号
- 已删：无（3 行原文为就地扩写：A6「共享可变状态」加了 `SimpleDateFormat`、C2「定时器…」加了 `AbortController`、C2「路由切换的竞态」加了筛选条件竞态；脚本比对原文其余各行均原样保留）
- 与 fullstack 清单的差异（只报告，未改 workflow 那份）：
  - 结构不同：fullstack 按 A~M 机制分域 + 每条发现必填「触发 / 实际 / 应该 / 证据」；本 skill 按语言层分域 + 「触发 / 后果 / 建议」（Step 3 格式），本次未改格式
  - 本 skill 有、fullstack 没有的：`in (...)` 超 MSSQL 2100 参数分批、MyBatis-Plus `@TableField` 映射、多表 join 数据放大、readOnly 里写、字段注入 vs 构造注入、Apollo 各 profile 配置、Feign 测试必须 mock、OpenAPI 同步、`v-if`/`v-for` 同级、大列表虚拟滚动、整个 C4 Pacvue 专项、D 数据与迁移（DDL 回滚、非空列默认值、刷新脚本幂等）、E 提交卫生 —— 可考虑反向补进 workflow 那份（由 workflow skill 的 review 决定）
  - `ai-driven-backend-workflow` 的同名文件（138 行）与 fullstack 版也不一致，未展开比对
- 新规则（2026-10-14 §5 拆分提交 worktree 编译）一致性检查：§5 本身无问题；SKILL.md 中 Step 1 / Step 4 两处提醒与 §5「提交完、推送前」时机不一致 → 已按上面调整；`./mvnw -q -o test-compile` + 数 `[ERROR]` 与「mvn 退出码不可信」的经验一致
- 待确认：
  - 后端 `.githooks/commit-msg` 是否需要装：仓库 `.agents/git-workflow.md` 说「Windows 运行 `install-git-hooks.bat` 安装」，但本机未装；属本地配置，需用户决定（skill 只要求人工核对）
  - `platform-provider` 无 `.githooks/`，其 AGENTS.md 是否另有格式约定本次未读
- 自检：无脚本改动；`SKILL.md` 内 `references/*` 链接逐个 `[ -f ]` 实查 → 全部存在；`grep "Opus 5 <\|习惯带空格"` → 已无残留；checklist 用 python 逐行比对旧版（`.cursor` 副本）→ 只有上述 3 行为扩写
- 分发：未做（按委派要求由主会话统一分发）

## 2026-10-14 用户对待确认项的决定

- 后端仓 commit-msg hook：**先不装**（用户 2026-10-14）→ 提交时继续人工核对格式与敏感词，汇报里写明「hook 未安装，已人工核对」

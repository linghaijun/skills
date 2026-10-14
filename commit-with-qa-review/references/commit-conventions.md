# 提交约定

**先读仓库自己的规则**：`AGENTS.md`、`CLAUDE.md`、`.gitignore`、`commitlint.config.js`、`.githooks/commit-msg`。仓库规则与本文冲突时，以仓库为准。

---

## 1. 提交信息格式

本工作区（Pacvue）通用格式：

```
<type>:<JIRA票号> <中文描述>
```

- 后端（`creative-management` / `platform-provider`）：冒号后不带空格 —— `fix:CP-57723 图搜统一走 AssetManager`
- 前端（`vuen-crossretail` 外层与 `packages/creativehub` 嵌套仓）：冒号后**必须**带空格 —— `feat: CP-56964 instacart Ads 表 Ad 列不出跳转链接`（commitlint 按 conventional 解析 `type: subject`，不带空格解析不出 type → `type-empty` 报错）
- **header ≤ 72 字符**（两边一致）。🔴 **自查长度按字符数算**：`py -c "import sys;print(len(open(sys.argv[1],encoding='utf-8').readline().rstrip()))" msg.txt`；**别用 `awk length` / `wc -c`**——Git Bash 的 awk 按字节算，一个中文算 3，会把合规的标题误判超长（2026-10-14 误报 5 行）。commitlint 与 `.githooks/commit-msg` 都按字符算
- **必须含 JIRA 票号**。票号未知时**问用户**，不要编。

各仓实际校验（2026-10-14 实读，规则以仓库文件为准）：

| 仓 | 校验来源 | 是否生效 | 规则要点 |
|---|---|---|---|
| `creative-management` | `.githooks/commit-msg` | 🔴 **本机未安装**（`core.hooksPath` 未设、`.git/hooks/` 只有 sample）→ 不会拦，**提交前自己按规则核对** | 首行 `^(feat\|fix\|docs\|style\|refactor\|perf\|test\|chore):[A-Z]+-[0-9]+[[:space:]]+.+`（**只有 8 个 type**；票号前缀只允许大写字母）；首行 ≤72；以 `Merge ` 开头或含 `force commit` 跳过检查（禁止为绕过而加）；整条信息含 `password\|secret\|key\|token\|api_key`（不区分大小写、子串匹配，`keyword`/`apiKey` 也中）会 `read -p` 交互确认 —— 非交互环境直接失败，**正文避开这些词**（写「去重键」不写「去重 key」） |
| `platform-provider` | 无 `.githooks/` | — | 按后端格式自查 |
| `vuen-crossretail`、`packages/creativehub` | husky `.husky/commit-msg` → commitlint（`@commitlint/config-conventional` 17.8.1 + 仓内覆盖） | ✅ 生效（`core.hooksPath=.husky`） | type 12 个（下）；header ≤72（覆盖默认 100）；票号 `/[A-Z][A-Z0-9]+-[0-9]+/` 出现在 header 即可；**body / footer 每行 ≤100**（conventional 默认，未覆盖）；`subject-case` 已关闭。pre-commit 跑 `lint-staged`（`*.{js,vue}` → `eslint --fix`，会改暂存文件） |

后端 type 只能用：`feat` `fix` `docs` `style` `refactor` `perf` `test` `chore`（`build` / `ci` / `config` / `revert` 会被后端 hook 拒）。
前端 type 枚举（`commitlint.config.js`）：`build` `feat` `fix` `docs` `style` `refactor` `perf` `test` `revert` `ci` `config` `chore`

### 正文

超过一行的改动写正文，说明：

```
<type>:<票号> <一句话标题>

为什么改：<触发的问题 / 需求背景>
怎么改：<关键决策，不复述 diff>
影响面：<受影响的调用方 / 接口 / 数据>
风险：<已知未覆盖的场景，或"无">
```

结尾附署名行：**照抄当前会话 system reminder 给的 attribution 行**（模型名会随版本变，不要抄本文件或历史提交里的旧行），例如：

```
Co-Authored-By: Claude <模型名> <noreply@anthropic.com>
```

前端仓正文每行 ≤100 字符（commitlint `body-max-line-length`），长句手动折行。

---

## 2. 多仓：必须分别提交

`creative-management-all/` 本身**不是** git 仓库。改动落在哪个仓，就只在哪个仓 add/commit。

| 目录 | 角色 |
|------|------|
| `creative-management/` | 后端（创意中台） |
| `platform-provider/` | 平台侧数据服务 |
| `vuen-crossretail/` | 前端外层（只跟踪 `packages/main`、`packages/crossretail`） |
| `vuen-crossretail/packages/creativehub/` | **嵌套独立仓**，单独提交 |

规则：

1. 禁止一个 commit 混入另一仓的文件。
2. `packages/creativehub/**` 的源码只在嵌套仓内提交，不提到外层。
3. 跨仓同一需求 = 两三次独立 commit，可共用同一 JIRA 号。
4. 每个仓都走一遍完整的 QA 审查 + 提交流程。

---

## 3. .gitignore 陷阱（提交前必查）

- 外层 `vuen-crossretail/.gitignore`：`packages/*` 默认忽略，仅白名单 `!packages/main`、`!packages/crossretail`。`packages/creativehub` 等**不应**出现在外层 `git status` 待提交列表里。
- 外层还忽略：`*progress.md`、`.cursor/`、`.claude/`、`CLAUDE.md`、`docs`。
- 若 `packages/creativehub` 因 rename/move 误入 index：`git rm -r --cached packages/creativehub`（保留磁盘文件）后再提交。
- 前端测试文件（`*.test.js` / `*.spec.js`）**不纳入提交**，add 时排除。
- 后端：不提交构建产物（`target/`）、密钥、IDE 本地文件、`*.log`。

---

## 4. add / commit 操作规范

```bash
git -C <repo> status --short          # 先看全貌
git -C <repo> add <具体文件> ...       # 精确到文件
git -C <repo> diff --staged            # 提交前最后确认暂存内容
git -C <repo> commit -F <msg 文件>     # 多行信息用文件，避免转义问题
```

- **禁止 `git add -A` / `git add .`**：极易带进忽略目录、临时文件、另一仓的变更。
- commit 后 `git -C <repo> log -1 --stat` 确认落盘内容与预期一致。
- **只做 commit**：不 `push`、不 `gh pr create`、不 `--amend` 已推送的提交、不改 hook、不加 `--no-verify`。hook 失败要修根因。
- hook 没装（如 `creative-management`，见 §1 表）时**不擅自安装**（`install-git-hooks.bat` / 复制到 `.git/hooks/` 属改本地配置，用户要求才做）；提交前用 §1 的正则 / 长度自己核对首行，并在汇报里写「本仓 hook 未安装，已人工核对」。
- 当前分支是主干（`main` / `master` / `production`）时，先问用户是否需要新建分支。

## 5. 拆分提交：每个提交都要在独立 worktree 里实际编译

一组改动拆成多个 commit 时，**每个 commit 都必须单独能编译**（Java 含测试代码：`test-compile`）——
否则 bisect、cherry-pick、回滚任意一个都会坏。**「人工核对过跨提交的符号依赖」不算数**：
CP-58118 后端审查报告写「3 个提交均可单独编译（已核对符号依赖）」，实际在 worktree 里编译，
前两个分别报 17 / 24 个 `[ERROR]`（测试引用了下个提交的 DTO、新枚举值让旧 switch 不完整、
依赖下个提交才加的接口方法）——这些靠读 diff 看不出来。

做法（提交完、推送前；后端在 IDEA 运行时也能做，不碰工作区 `target/`）：

```bash
git -c core.longpaths=true worktree add --detach C:/cmwt <第一个提交>   # Windows 路径要短，否则 Filename too long
cd C:/cmwt
export JAVA_HOME=<JDK17>; unset MAVEN_HOME M2_HOME
for c in <提交1> <提交2> ...; do
  git -c core.longpaths=true checkout -q --detach $c
  ./mvnw -q -o test-compile -DskipTests > <scratchpad>/wt-$c.log 2>&1; echo "$c exit=$? errors=$(grep -c '\[ERROR\]' <scratchpad>/wt-$c.log)"
done
cd - && git worktree remove --force C:/cmwt && git worktree prune
```

- `-o` 离线、只到 `test-compile`：不 `install`，不改 `~/.m2` 里的兄弟模块 jar；日志写 scratchpad，不写进 worktree
- 前端：每个提交在 worktree 里跑一次 lint / 构建（或至少对该提交的文件跑 eslint），确认没有引用后续提交才加的文件
- **某个提交编译不过**：先试着把被引用的文件挪到更早的提交（如新枚举、DTO）；挪完重跑。耦合太深拆不开时，
  `git reset --soft <拆分前>` 合成一个提交，正文写明「为什么没拆」——能编译优先于「单次 ≤500 行」
- 合并或重拆后，`git diff --stat <原最后一个提交> HEAD` 应为空（证明最终代码没变）
- hook 拦下某个提交时**立即停**，不要让脚本继续往下提交：后面的 `git commit` 会把被拦提交的文件一起带走。
  批量提交脚本每步检查退出码（`git commit ... || exit 1`）

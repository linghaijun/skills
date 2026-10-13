# 提交约定

**先读仓库自己的规则**：`AGENTS.md`、`CLAUDE.md`、`.gitignore`、`commitlint.config.js`、`.githooks/commit-msg`。仓库规则与本文冲突时，以仓库为准。

---

## 1. 提交信息格式

本工作区（Pacvue）通用格式：

```
<type>:<JIRA票号> <中文描述>
```

- 后端（`creative-management` / `platform-provider`）：冒号后不带空格 —— `fix:CP-57723 图搜统一走 AssetManager`
- 前端（`vuen-crossretail`）：习惯带空格 —— `feat: CP-56964 instacart Ads 表 Ad 列不出跳转链接`
- **header ≤ 72 字符**，由 commit-msg hook 强制
- **必须含 JIRA 票号**（`[A-Z][A-Z0-9]+-[0-9]+`），由 commitlint 插件强制。票号未知时**问用户**，不要编。

type 枚举（来自 `vuen-crossretail/commitlint.config.js`）：
`build` `feat` `fix` `docs` `style` `refactor` `perf` `test` `revert` `ci` `config` `chore`

### 正文

超过一行的改动写正文，说明：

```
<type>:<票号> <一句话标题>

为什么改：<触发的问题 / 需求背景>
怎么改：<关键决策，不复述 diff>
影响面：<受影响的调用方 / 接口 / 数据>
风险：<已知未覆盖的场景，或"无">
```

结尾附署名行（会话的 attribution 要求）：

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

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
- 当前分支是主干（`main` / `master` / `production`）时，先问用户是否需要新建分支。

---
name: commit-with-qa-review
description: Use when about to commit code - runs a professional QA bug hunt over the staged/unstaged diff BEFORE committing, ranks findings P0-P3, requires every finding resolved (fixed or explicitly waived by the user), then writes a convention-compliant commit in the correct repo. Triggers on "提交代码", "commit", "帮我提交", "git commit", "代码提交", "提一下这个改动".
---

# Commit with QA Review

> 🗓 **定期自检**：本 skill 每 7 天 review 一次，记录在同目录 `REVIEW.md`（开头「上次 review：日期」）。使用时若已到期，**主任务收尾后**按 [`references/self-review.md`](references/self-review.md) 做一次并在回复里说明。

提交前，你不是作者，是**接到这份 diff 的测试工程师**。你的 KPI 是找到 bug，不是让提交通过。

## 核心心态

> 作者视角问「这段代码想干什么」，测试视角问「这段代码在什么输入下会出错」。

三条不可协商的规则：

1. **先审后提**：任何 `git commit` 之前必须完成 QA 审查。没审查完不允许 commit。
2. **零发现 = 没认真找**：如果整轮审查一个问题都没有，你多半是在给自己盖章。回到 `references/bug-hunting-checklist.md`，对每个适用检查域逐条给出「这行代码在 X 输入下的行为」的具体推演，而不是「看起来没问题」。
3. **一律先修再提交**（用户已确认的策略）：P0-P3 全部问题必须**修复**或**由用户明确豁免**后才能 commit。不允许你自己决定「这个不重要，先提了」。

## 工作流

### Step 1 — 确定战场

```bash
git -C <repo> status --short
git -C <repo> diff            # 未暂存
git -C <repo> diff --staged   # 已暂存
```

- 多仓工作区（如 `creative-management-all` 下的 `creative-management` / `platform-provider` / `vuen-crossretail`）：**逐仓单独处理**，禁止跨仓混入一个 commit。
- 先读该仓的 `AGENTS.md` / `CLAUDE.md` / `.gitignore` / `commitlint.config.js` / `.githooks/commit-msg`，拿到本仓的提交格式与忽略规则。细节见 `references/commit-conventions.md`。
- 变更超过 ~15 个文件或跨多个功能点时，按功能切分成多个 commit，逐个走完本流程。
- 🔴 **拆成多个 commit 时，每个 commit 都要在独立 worktree 里实际编译**（Java 跑到 `test-compile`），人工核对依赖不算数；编译不过就挪文件或合并。时机：全部 commit 完成后、推送前（Step 5 末尾）；做法见 `references/commit-conventions.md` §5。

### Step 2 — QA Bug Hunt（本 skill 的核心）

读 `references/bug-hunting-checklist.md`，按其中的检查域逐条过 diff。要求：

- **逐文件、逐 hunk 读完整上下文**，不能只看 diff 的加号行。改了一个方法，就把这个方法和它的调用方都读一遍（`grep` 调用点）。
- **对每个变更点构造至少一组会让它出错的输入**：null、空集合、0、负数、超长、重复、并发、分页边界、权限不足、上游超时、字段缺失。
- **回归面**：这次改动影响了哪些没被改的调用方？老数据/老配置还能跑吗？
- 每条发现记录：`文件:行` + 触发条件 + 后果 + 严重级别。**写不出具体触发条件的不算发现**（checklist 文末「不算发现的」）。
- 项目有历史 bug 经验文档时（工作区 `AGENTS.md` 引用；本机 creative-management-all 为 `docs/bug-lessons.md`），读索引，diff 命中的条目按其「排查同类」grep 一遍（尤其去重 / 唯一性、异步回包、出图相关改动）。

严重级别定义：

| 级别 | 含义 | 例子 |
|------|------|------|
| **P0** | 数据错误/丢失、越权、线上崩溃、不可逆 | 删改 SQL 缺 where、权限判断被绕过、事务未回滚 |
| **P1** | 主流程功能不正确 | 边界条件算错、空指针、分页漏数据、并发覆盖写 |
| **P2** | 次要功能/异常分支问题、明显性能隐患 | 循环内查库、错误提示文案错、日志吞异常 |
| **P3** | 可维护性、命名、重复代码、缺日志 | 魔法数字、复制粘贴逻辑、死代码 |

### Step 3 — 汇报并修复

先把清单交给用户（按级别排序），格式：

```
## QA 审查结果 — <repo> (<N> 个文件)

### P0
1. `Foo.java:88` 批量更新 SQL 在 ids 为空时退化为全表更新
   触发：前端不传筛选条件 → ids=[] → where in () 被 MyBatis 剔除
   后果：全表数据被覆盖
   建议：入口处 ids 为空直接 return

### P1 ... ### P2 ... ### P3 ...

无发现的检查域：并发（本次无共享状态改动）、国际化（无文案变更）
```

然后**修复全部问题**。P2/P3 中如果你判断确实不该在本次改，仍要逐条问用户是否豁免，拿到明确答复才跳过。

修完后对**修复本身**再跑一遍 Step 2 —— 修复引入的 bug 是最常见的翻车点。

### Step 4 — 验证

按仓库类型跑最小必要验证，不要无脑全量：

- Java：只跑受影响的测试类/包（L1）。整仓 `mvn test`（L3）只在用户要求或终验时跑。
- 前端：`vue-tsc` / lint / 相关单测；注意前端测试文件通常**不提交**。
- 先确认本仓 hook 是否真的装了（`git config core.hooksPath` / `.git/hooks/`）：装了就要能过；没装（如 `creative-management`）按 `commit-conventions.md` §1 人工核对提交信息，不擅自安装。

**不允许在未跑验证的情况下声称通过。** 贴出真实输出。

### Step 5 — 提交（只 commit，不 push、不建 PR）

- `git add` 精确到文件，禁止裸 `git add -A`；对照 `.gitignore` 确认没带进构建产物、密钥、本地配置、IDE 文件、嵌套仓目录。
- 提交信息格式见 `references/commit-conventions.md`：后端 `<type>:<JIRA票号> <中文描述>`（冒号后无空格，type 只有 8 个）、前端 `<type>: <JIRA票号> <中文描述>`（冒号后**必须**空格，正文每行 ≤100），首行都 ≤72 字符；后端正文避开 `key` / `token` / `secret` / `password` 等词（hook 敏感词检查会交互卡死）。
- 正文写「为什么这么改 + 影响面 + 已知风险」，不是复述 diff。
- 拆分提交：全部 commit 完成后，逐个在独立 worktree 里编译（`commit-conventions.md` §5），任一失败不得报「已提交」。
- commit 结束就停。**push 和 PR 需要用户另行明确要求。**

## 红灯清单

以下念头出现，说明你在偷懒：

| 念头 | 现实 |
|------|------|
| 「这是我刚写的，我知道是对的」 | 你写的时候就没想到这个边界，现在也想不到。按 checklist 走。 |
| 「改动很小，直接提」 | 一行 SQL 就能删库。改动大小与风险无关。 |
| 「测试跑过了，没问题」 | 测试只覆盖你想到的场景。QA 找的是你没想到的。 |
| 「P3 无所谓，先提了」 | 策略是一律先修再提交。要跳过就问用户。 |
| 「先 commit 了再慢慢看」 | 审查在 commit 之前，不是之后。 |
| 「顺手 push 一下」 | 只做 commit。push 要单独确认。 |

## 参考

- `references/bug-hunting-checklist.md` — 按语言/层次划分的 bug 检查域（读它来做 Step 2）
- `references/commit-conventions.md` — 提交信息格式、多仓拆分、.gitignore 陷阱（读它来做 Step 1 和 Step 5）

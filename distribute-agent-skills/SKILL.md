---
name: "distribute-agent-skills"
description: "把本机源 skills 目录（~/.claude/skills）里改好的 skill 分发到其他 agent 工具的 skills 目录（Cursor / Trae / opencode / kimchi 等），默认只覆盖不删除（源里删掉的文件看过残留清单后用 --prune 清理）、逐文件 MD5 校验、先 --dry-run 看目标。改完任何 skill 并自检通过后使用。触发词：分发 skill、同步 skill、skill 改完了、distribute、把 skill 推到其他 agent、其他工具看不到新 skill。"
---

# Skill 分发（distribute-agent-skills）

> 一个 skill 改完、自检通过，**只有当前这个工具看得到**。本机装了多个 agent 工具，
> 各自有独立的 `skills` 目录，不分发 = 换个工具跑的还是旧版，而且**不报错**：
> 旧版照常加载、照常执行，只是执行的是改之前的规则。这是典型的静默失效。

## 什么时候用

**改完任何 skill 的最后一步。** 顺序固定：

```
改 skill → 该 skill 自己的自检（如 workflow 的 validate_step.py --self-check）→ 分发 → 核对输出
```

🔴 **自检没过不要分发** —— 分发是把当前状态复制 N 份，错的东西会被复制 N 份。

## 怎么跑

```bash
cd ~/.claude/skills/distribute-agent-skills
python scripts/distribute.py --dry-run     # ① 先看目标列表，确认数量和路径都对
python scripts/distribute.py               # ② 正式分发，逐文件 MD5 校验
```

分发别的 skill（默认分发两个 workflow + `cdp-drive-real-chrome` + `debugging-systematic-jira` + `pm-sprint-update-jira` + 本 skill 自身，自身放最后）：

```bash
python scripts/distribute.py --skill pacvue-common-utils --skill creativehub-integrating-migration-platform --dry-run
```

| 参数 | 作用 |
|---|---|
| `--skill NAME` | 要分发的 skill，可多次；不传则用默认组（两个 workflow + `cdp-drive-real-chrome` + `debugging-systematic-jira` + `pm-sprint-update-jira` + `distribute-agent-skills`） |
| `--dry-run` | 只列目标和「被别处改过」的冲突，不复制。**第一次跑、或改过排除规则后，必须先跑这个** |
| `--force` | 目标在上次分发后被别处改过也照样覆盖（**先确认那些改动不要了**；新增文件仍不删） |
| `--src DIR` | 源 skills 目录，默认本脚本所在 skill 的上级目录（即 `~/.claude/skills`） |
| `--home DIR` | 搜索根目录，默认用户目录 |
| `--exclude GLOB` | 额外排除的目标目录 glob，可多次 |
| `--prune` | 复制全部成功（MD5 0 不一致）后删除残留文件与清空的目录。**先不带它跑一次看残留清单，确认后再加**（见下方「残留看过清单再清理」） |
| `--include-repos` | 连 `IdeaProjects/` 下各仓库内的 skill 副本一起更新（见下方红线） |
| `--include-skills-repo` / `--no-include-skills-repo` | **默认开**：同步 `IdeaProjects/skills` 本仓库；关掉用 `--no-include-skills-repo`（`skills - Copy` 等备份始终排除） |
| `--commit-skills-repo` | 分发后在 `IdeaProjects/skills` 里**本地 commit** 本次分发的 skill 目录（只提交这些路径，不动仓库里其他改动；MD5 不一致则不提交）。**永不 push**；署名行见下 |

### 提交消息的署名行（不写死）

`--commit-skills-repo` 的提交消息 = `Distribute skills from ~/.claude/skills: <skills>` + 可选署名行。
署名行按 **`SKILLS_COMMIT_TRAILER` 环境变量 → 本 skill 目录的 `.commit-trailer`（本机私有、不参与分发）→ 空** 取值：

```powershell
# 想带署名就配一条（值就是整行）
"Co-Authored-By: 某某 <x@example.com>" | Set-Content ~/.claude/skills/distribute-agent-skills/.commit-trailer -Encoding utf8
```

🔴 **脚本不再写死模型名。** 写死的后果不是"措辞不好看"：模型名随版本变，会把一个**与当前会话不符**的名字
永久写进公开仓库历史（本仓库曾连续 6 次提交都是同一个旧名）。**没配就不加这行 —— 宁可没有署名，也不写假名字。**

> 提交消息正文的规范（type、署名从哪来）以 `commit-with-qa-review` skill 为准；那条规则明确要求
> 「署名照抄当前会话给的那行，模型名会随版本变」—— 与这里不写死是同一个道理。

## 目标是怎么选出来的（别手工拷）

目标 = 用户目录下（深度 ≤ 5）**已经装了任一待分发 skill** 的、名字就叫 `skills` 的目录。

- **「装过的才更新」**：不会往没装过的新 agent 目录里铺
- **按组铺齐**：一个目录只要装了这一组里的任意一个，这组里的其他几个也会补上 ——
  同一工具下两个 workflow 版本不一致比旧版更难查
- 只认目录名为 `skills` 的：`~/.trae-cn/worktrees` 下有同名 git 工作区，不是安装目录

### 排除与例外

| 路径 | 规则 |
|---|---|
| 源目录本身 | 始终排除（自己拷自己） |
| `IdeaProjects/skills`（本仓库） | **默认纳入**；关掉用 `--no-include-skills-repo` |
| `IdeaProjects/skills*` 备份（如 `skills - Copy`） | 始终排除（备份被覆盖就不再是备份） |
| `IdeaProjects/` 下各仓库内的 `.claude/skills` | 默认排除；要同步加 `--include-repos` |
| `ai.opencode.desktop` | 始终排除（未经确认不覆盖） |

## 默认只覆盖；残留看过清单再清理

🔴 **默认不删除目标里的文件。** 源里删掉、目标里还留着的，结尾会列成「残留」，**只提示不动手**：
残留也可能是对方工具在副本里新加的本地文件，盲删就丢了。

**在源里删了 / 改名了文件（脚本、reference、目录），分发后必须清理残留**，否则其他工具里会留着旧文件被继续用：

1. 先不带 `--prune` 正常分发，看结尾的「残留」清单（只显示前 40 条，数量多时按文件名归类核对）
2. 确认清单里都是源里删掉 / 改名的旧文件（如移除的 `scripts/distribute.py`、`__pycache__`），**不是**别的工具自己新加的文件
3. 向用户报告残留数与归类，用户同意后加 `--prune` 重跑：复制全部成功且 MD5 全一致才删，并连带删掉清空的目录
4. 报告真实数字：「已清理残留 N 个，失败 M 个」；失败（权限等）逐条列出

不能确认的残留（看不出来源）不要 `--prune`，单独列给用户。

## 🔴 复制前先查「目标被别处改过」（退出码 3 = 停下问用户）

其他 agent 工具（Cursor 等）的会话可能直接改了它自己目录下的 skill 副本。直接覆盖 = 那边的改动**永久丢失**
（2026-10-14 实际发生：另一个会话在 `~/.cursor/skills/` 的 `creativehub-drive.mjs` 里加了函数，分发用源版本覆盖，无法恢复）。
所以复制前逐个目标检查，命中任一条就**一个文件都不复制**，列清单后退出码 3：

| 类型 | 判定 |
|---|---|
| 改动 | 目标文件内容与源不同（忽略 CRLF / LF），且在**上次分发到该目标之后**被修改过 |
| 新增 | 目标里有、源里没有的文件，且是上次分发之后才出现的 |

- 上次分发时间记在本 skill 的 `.last-distribute.json`（本机状态，不参与分发）；没有记录时「改动」按「目标比源新」判断，「新增」只在结尾列为残留、不拦
- 收到退出码 3：**把清单贴给用户**，问清每个文件要不要 —— 要的先合回源 skill（`~/.claude/skills/<skill>/`）再分发；确认不要才加 `--force`
- 别为了让分发跑通而直接加 `--force`

## 怎么算分发成功

看最后两行，缺一不可：

```
复制 2958 个文件，MD5 不一致 0 个
```

- **MD5 不一致 > 0 → 退出码 1，没分发成功**，别报告「已分发」
- 复制数突然比上次少一大截 → 先查是不是 `--dry-run` 忘删、或者排除规则误伤了目标
- 目标数变了（之前 58 个，这次 3 个）→ 先搞清楚为什么，不要直接跑

🔴 **报告给用户时写真实数字**（目标数 / 文件数 / 不一致数），不要只写「已分发完成」。

## 加一个新 agent 工具怎么办

脚本只更新装过的目录，所以**第一次**要手工把 skill 目录拷过去一次（或让该工具自己装），
之后它就会自动进入目标列表。不要为了「让脚本铺到新目录」去改排除规则 ——
那条规则是防止往备份和仓库里乱写的，不是用来绕的。

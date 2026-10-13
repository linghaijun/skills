---
name: "distribute-agent-skills"
description: "把本机源 skills 目录（~/.claude/skills）里改好的 skill 分发到其他 agent 工具的 skills 目录（Cursor / Trae / opencode / kimchi 等），只覆盖不删除、逐文件 MD5 校验、先 --dry-run 看目标。改完任何 skill 并自检通过后使用。触发词：分发 skill、同步 skill、skill 改完了、distribute、把 skill 推到其他 agent、其他工具看不到新 skill。"
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

分发别的 skill（默认分发两个 workflow skill + `cdp-drive-real-chrome` + 本 skill 自身，自身放最后）：

```bash
python scripts/distribute.py --skill pacvue-common-utils --skill creativehub-integrating-migration-platform --dry-run
```

| 参数 | 作用 |
|---|---|
| `--skill NAME` | 要分发的 skill，可多次；不传则用默认组（两个 workflow skill + `cdp-drive-real-chrome` + `distribute-agent-skills`） |
| `--dry-run` | 只列目标不复制。**第一次跑、或改过排除规则后，必须先跑这个** |
| `--src DIR` | 源 skills 目录，默认本脚本所在 skill 的上级目录（即 `~/.claude/skills`） |
| `--home DIR` | 搜索根目录，默认用户目录 |
| `--exclude GLOB` | 额外排除的目标目录 glob，可多次 |
| `--include-repos` | 连 `IdeaProjects/` 下各仓库内的 skill 副本一起更新（见下方红线） |
| `--include-skills-repo` | 连 `IdeaProjects/skills` 这个 skills 仓库一起更新（只放开这一个；`skills - Copy` 等备份仍排除） |

## 目标是怎么选出来的（别手工拷）

目标 = 用户目录下（深度 ≤ 5）**已经装了任一待分发 skill** 的、名字就叫 `skills` 的目录。

- **「装过的才更新」**：不会往没装过的新 agent 目录里铺
- **按组铺齐**：一个目录只要装了这一组里的任意一个，这组里的其他几个也会补上 ——
  同一工具下两个 workflow 版本不一致比旧版更难查
- 只认目录名为 `skills` 的：`~/.trae-cn/worktrees` 下有同名 git 工作区，不是安装目录

### 始终排除，不接受「这次特殊」

| 排除项 | 为什么 |
|---|---|
| 源目录本身 | 自己拷自己 |
| `IdeaProjects/skills*` | 用户的独立副本 / 备份。**备份被自动覆盖就不再是备份**。唯一例外是 `IdeaProjects/skills` 本仓库，需显式 `--include-skills-repo` |
| `IdeaProjects/` 下各仓库内的 `.claude/skills` | 它们**随仓库提交**，同步 = 产生 git 改动。要不要同步是逐仓决定的事，需要时用户同意后加 `--include-repos` |
| `ai.opencode.desktop` | 只有旧版、从未参与分发，未经用户确认不覆盖 |

## 只覆盖，不删除

🔴 **脚本永远不删除目标里的文件。** 源里删掉、目标里还留着的，结尾会列成「残留」，
**只提示不动手**：删除可能被权限拦，更可能删掉对方工具的本地改动。
看到残留列表自己判断 —— 常见原因是某个 reference / script 被重命名或抽成了独立 skill。

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

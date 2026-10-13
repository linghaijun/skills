# 第十三步：AC ↔ Subtask 匹配与提测

> **时机**：Step12 提交完成之后、经验沉淀之前。
> **目的**：把每条 `AC-NN` 对上 Jira Sub-task；问用户是否提测；确认后改状态 / 转交 QA，或记「无需提测」终态。
> **状态与验证态分开**：不写进 `tests/.verify-state.json`（那是 10.4 实测用的）。本步只用
> `docs/develop/{...}/.handover-state.json`（见 `scripts/handover_state.py`）。

## 提测状态（需求级，与流程验证态独立）

| 状态 | 含义 | 是否终态 |
|---|---|---|
| `待匹配` | 尚未产出完整 AC↔Subtask 表 | 否 |
| `已匹配待确认` | 映射表已落盘，等待用户决定是否提测 | 否 |
| `已提测` | 用户确认提测，且已对匹配到的 subtask 执行 Jira 动作（或动作失败已记入报告并获用户知悉） | **是** |
| `无需提测` | 用户明确说不提测（或本期不交 QA） | **是** |

🔴 **终态只有两个：`已提测` / `无需提测`。** 流程结束前本步状态必须落到其一。
用户说「不要提测 / 跳过提测 / 不用交测」→ 直接 `无需提测`，**禁止**改 Jira。

## 输入

- 父票：`CP-xxxxx`（目录名或 Spec / Checklist 文首）
- `Step 3-Checklist.md` 全量 `AC-NN`（及文首「AC-NN ↔ Jira」映射表，若有）
- Atlassian MCP（或等价 Jira API）已登录

## 动作

### 1. 拉取父票下全部 Sub-task

```
JQL: parent = <父票> AND issuetype in subTaskIssueTypes() ORDER BY key ASC
```

字段至少：`key` / `summary` / `status` / `assignee`。用 Atlassian MCP `searchJiraIssuesUsingJql` 拉全量后，
把 `issues` 数组（或 `{parentIssue, issues:[...]}`）写成 `<develop>/subtasks.json`。

### 2～3. 匹配 + 落盘（用脚本，别手写表）

```bash
python scripts/handover_match.py \
  --dir docs/develop/<需求目录> \
  --parent CP-xxxxx \
  --subtasks docs/develop/<需求目录>/subtasks.json \
  --workflow backend \
  --apply
```

`--apply` = 写出 `Step 13-AC-Subtask映射.md` + `Step 13-mapping.json`，并 `handover_state init` + `set-mapping`
→ 状态变为 **`已匹配待确认`**。不加 `--apply` 只出映射文件。

匹配优先级（脚本内建）：

1. Checklist 文首映射表（`match=frontmap`）
2. summary **以** `AC-NN` 开头（`exact`）
3. summary / description **含** `AC-NN`（`contains`）
4. 标题 Jaccard ≥ 0.55（`fuzzy`）
5. 对不上 → `unmatched`

🔴 **一对一优先**；**禁止臆造 Issue Key**；**不要手搓映射表**。

### 4. 🔴 阻塞：询问是否提测

汇报：映射覆盖率（已匹配 / 未匹配）、未匹配列表、将要操作的 subtask 列表。

问用户（二选一，必须明确）：

> 映射已完成。是否提测？
> - **提测**：将把下列 Sub-task 转到 **Testing**，并转给 **biao.mu@pacvue.com**
> - **不提测**：本需求提测状态记为 **无需提测**（终态，不改 Jira）

未获明确答复前**禁止**改 Jira。

### 5a. 用户确认提测

对映射表里**每一个有 Key 的 subtask**（去重）：

1. `listJiraIssueTransitions` → 选**目标状态名为 Testing**（或站点等价名，如 `Testing` / `测试中`）的 transition；拿不准先列给用户
2. `transitionJiraIssue` 执行该 transition
3. `lookupJiraAccountId`（或 `listJiraIssueAssignableUsers`）解析 `biao.mu@pacvue.com` → `editJiraIssue` 设 `assignee`
4. 每条结果写入 `.handover-state.json` 的 `jiraActions` 与映射报告「提测执行」节

然后：

```bash
python scripts/handover_state.py decide --dir <develop> --status 已提测
```

部分失败：报告里列失败 key + 原因；状态仍可标 `已提测`，但必须注明「部分失败，须人工补」；**不得假装全成功**。

默认转交人：`biao.mu@pacvue.com`。用户当次指定其他人则以当次为准。

### 5b. 用户明确不提测

```bash
python scripts/handover_state.py decide --dir <develop> --status 无需提测 --note "<用户原话摘要>"
```

**禁止** transition / assign。报告写清「用户选择无需提测」。

### 6. 产出物

`Step 13-AC-Subtask映射.md`（含执行结果或「无需提测」）
`.handover-state.json`（`status` ∈ {已提测, 无需提测}）

## 门控

| 节点 | 档位 | 行为 |
|---|---|---|
| 映射完成 → 问是否提测 | 🔴 阻塞 | 暂停等用户明确「提测」或「不提测」 |
| 提测写 Jira | 🔴（写操作） | 仅在用户确认提测后执行 |
| 本步完成 | — | `status` 必须是终态之一，才可进入经验沉淀 |

## 与其它步骤的边界

- **不替代**《测试交接文档》（仍在 Step12 产出；提测时交给 QA）
- **不改** Checklist `[done]` / `.verify-state.json` / 证据终验状态
- Step3 的「同步 AC 进 Jira checklist」仍属 `prd-to-jira-ac`；本步只做 **AC ↔ 已有 Sub-task** 匹配与提测流转
- 父票下没有 Sub-task：映射全员 `unmatched`，仍问是否提测；若提测则说明「无可流转 subtask」，终态可记 `已提测`（动作 0 条）或请用户先建 subtask——**以用户裁决为准**

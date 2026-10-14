---
name: pm-sprint-update-jira
description: 以项目经理视角、基于 Jira（Nova Team 看板 3514）更新当前 Sprint 进度与风险看板：经 Atlassian MCP 读 Story/子任务/Bug，用脚本采集三个仓库的 git 提交与合入，判定风险后写入 docs/pm/<Sprint>/data.json 并重建固定看板 docs/pm/index.html（总览/行动/明细/图表 4 Tab，顶部可切 Sprint）。触发：/pm-sprint-update-jira、更新 sprint 进度、刷新 PM 看板、更新风险、看看这个 sprint 进度、新 sprint 建看板、看板太乱/改看板样式；旧名 pm-sprint-update 同义。
---

# PM Sprint 进度看板更新（Jira）

> 原名 `pm-sprint-update`，已改名为 **`pm-sprint-update-jira`**，强调数据源是 Jira（只读）。旧触发语仍有效。

## 产物与目录

```
docs/pm/
├── _template/dashboard.html   # 看板模板 / 固定入口的外壳（改样式只改这里）
├── scripts/collect_git.py     # 采集 git → 回写 data.json 的 stories[].code / git.daily / git.authors
├── scripts/build.py           # 校验 + 重算 computed + 追加 history + 生成固定入口与 Sprint 清单
├── index.html                 # ★ 固定入口（唯一看板页），由 build.py 生成，禁止手改
├── sprints.json               # Sprint 清单 + 关键指标（给外部工具/脚本用）
├── team.json                  # ★ 团队成员：角色、本组/外部团队、git 别名（跨 Sprint，项目级）
└── <Sprint 目录>/             # 如 26Q3-Sprint6
    └── data.json              # 唯一数据源（不再生成 <Sprint>/index.html）
```

- **看板只有一个固定页面 `docs/pm/index.html`**：顶部下拉切换 Sprint，`?sprint=<目录名>` 直达；默认打开最新（有 `state: active` 时取其中最新的）。
- 页面分 4 个 Tab：**总览 / 行动 / 明细 / 图表**；切 Sprint 一律回到「总览」。
- 看板里 Story 引用**只写编号**，标题挂在 `title` 属性上（模板里的 `refLink()`），悬停才显示；不要把标题内联进清单。
- Sprint 目录名 = Jira sprint 名去掉团队后缀和空格：`26Q3-Sprint6 - Nova` → `26Q3-Sprint6`。
- 字段结构以现有 `docs/pm/26Q3-Sprint6/data.json` 为准，新增 Sprint 时照抄结构。
- **Jira 只读**：本 skill 不改 Jira 任何状态。发现状态滞后只写进看板的建议里。

## 团队与角色（docs/pm/team.json）

项目级，跨 Sprint 共用；新 Sprint 不复制。每个成员：

| 字段 | 含义 |
|---|---|
| `role` | `roles` 里的 key：pm 产品 / fe 前端 / be 后端 / fs 全栈 / data 数据 / algo 算法 / qa 测试 / qaLead 测试负责人 / unknown 待确认 |
| `confirmed` | `false` = 角色是推断的（看板显示虚线框）；用户确认后改 `true` |
| `external` | `true` 外部团队 / `false` Nova 本组 / `null` 待确认；外部的写 `externalTeam`，用户确认过的写 `externalConfirmed: true` |
| `duties` | 角色之外的职责，如 `["Sprint Master"]` |
| `capacity` | `false` = 不承担本项目日常工作（如只偶尔看看的测试负责人），单点负载判断不计入 |
| `aliases` | git 提交名、Jira 显示名的其他写法（「主要提交人」按此合并同一人） |
| `basis` | 推断依据（一句话） |

- **用户明确说过的角色/归属以用户为准**，写 `confirmed` / `externalConfirmed: true`，之后更新不得再按推断改掉。已确认：
  - Lei Yang：全栈，**Sprint Master**——关 Sprint、移 Story、调整验收分工等 Sprint 流程类行动项的负责人写他，不写笼统的「PM」。
  - Martina Peng、Linda Jiang：产品经理。需求/验收口径类问题找她们。
  - Yu Xie：测试负责人，不负责本项目测试，只偶尔看看（`capacity: false`）。本组日常测试只有 Biao Mu。
  - Mingwei Zhu：Nova 本组。
  - Minghui Chen：外部团队（CP-57703、CP-57189 数据层 AC）。
- 顶层 `ignoreAuthors`：多项目共享仓库（platform-provider、vuen-crossretail）里其他项目的开发，用户确认不用管——不展示、不计提交、不再提示登记。用户说某人「是别的项目的、不用管」时，把他连同别名移进这里，从 `members` 删掉。
- 新出现的经办人（`build.py` 会打 `[warn] team.json 未登记的经办人`）：按其 Story/AC/Bug 类型和提交的仓库推断角色，`confirmed: false`、`external: null`，写清 `basis`，汇报时列出来请用户确认。推断参考：只提交 vuen-crossretail → 前端；creative-management / provider → 后端；经办的都在 Acceptance Testing 且无提交 → 测试。
- `data.json` 的 `git.repos[].shared: true` 标记共享仓库：`collect_git.py` 在共享仓库里只统计 team.json 登记成员的提交（Story 代码进度按 key 检索，不受影响）。
- `collect_git.py` 结束时打 `[info] 未登记的提交人`（只看非共享仓库）：同一个人换了名字就补进其 `aliases`；新人按上面的规则登记待确认。
- `excludeAuthors`（正则）排除机器人账号。


## 固定参数

| 项 | 值 |
|---|---|
| cloudId | `401301e8-93bb-4aea-8f73-94870ee8ccd1`（失效时用 `getAccessibleAtlassianResources` 重取） |
| 看板 | Nova Team，boardId `3514`，项目 `CP` |
| 浏览链接前缀 | `https://pacvue-enterprise.atlassian.net/browse/` |
| 「我」 | `snapshot.by` = `Haijun Ling`（看板「我的」筛选用） |

Atlassian MCP（Cursor 下为 `plugin-atlassian-atlassian`）：优先直接调已挂载的 `searchJiraIssuesUsingJql`、`getAccessibleAtlassianResources`；看板 Sprint 用 `discover` → `getJiraBoardSprintData`，再 `executeRead`。未连接时让用户在连接器里连 Atlassian MCP，不要改用浏览器。

## 流程

### 1. 定位 Sprint

`executeRead` → `getJiraBoardSprintData`，inputs `{"boardId": "3514", "includeIssues": false}`，取 `resolvedSprint` 的 id / name / startDate / endDate / state。用户指定别的 Sprint 时传 `sprintName`。

- 目录已存在 → 更新模式，读现有 data.json。`state` 已是 `closed` 的 Sprint 只改 Jira 部分，不再跑 collect_git（脚本会拒绝，除非 `--force`）。
- 目录不存在 → 新 Sprint（`git.repos[].shared` 照抄）：先把上一个 Sprint 收尾（用最后一次数据跑一遍完整流程，`sprint.state` 改 `closed`，重跑 build）；再复制上一个 Sprint 的 data.json 做骨架，清空 `stories / bugs / risks / actions / history / computed`，更新 `sprint` 全部字段；`git.repos[].integration` 的 sprint 分支名要按新 Sprint 重新确认（`git -C <repo> branch -r | grep -i sprint`），找不到就问用户，不要猜。

日期统一写 `YYYY-MM-DD`（Jira 给的是 UTC，结束日按本地日期取）。`snapshot.date` 写今天。

### 2. 读 Jira

JQL 都用 `searchJiraIssuesUsingJql`，`fields` 只要需要的字段，减少返回量。

1. **Story**：`sprint = <id> AND issuetype = Story ORDER BY key`，fields `["summary","status","assignee"]`。
2. **每个 Story 的子任务**：`parent = <KEY>`，fields `["status","assignee"]`，`maxResults: 100`，可并行（逐个查是因为精简视图不返回 `parent` 字段，`parent in (...)` 一次查完无法归属，别改回去）。按下表归桶写入 `subtasks`；`assignee` 不入库，用于第 4 步判断 `blocked` / `unassigned` 和卡在谁身上：

   | 桶 | Jira 状态 |
   |---|---|
   | todo | Open, To Do, Reopen, Backlog |
   | coding | Coding, In Progress |
   | review | In Review |
   | testing | Testing, Acceptance Testing |
   | done | Done, Closed, Close, Resolved |

   遇到新状态名：按语义归桶，并同步补进 `build.py` 的 `PHASES`。没有未完成子任务、只要总数时可用 `searchResultMode: "count"` 加 `statusCategory != Done` 两次计数。
3. **Sprint 条目总量**：`sprint = <id> AND issuetype != Story` 和再加 `AND statusCategory != Done`，都用 count 模式 → `sprintIssues.total / notDone`。
4. **未关闭 Bug**：`sprint = <id> AND issuetype in (Bug, "Dev Bug (Sub-task)") AND statusCategory != Done`，fields `["summary","status","assignee"]` → `bugs`。
5. 需要判断某个子任务挂在哪个 Story 下时，用 `parent = <KEY>` 反查，**不要靠编号连续性推断后直接写成事实**。

### 3. 采集 git

```bash
python docs/pm/scripts/collect_git.py docs/pm/<Sprint>/data.json --fetch
```

输出里有 `[warn] … git fetch 失败` 时，合入进度是按本地旧的远程分支算的，汇报里要说明。

脚本按 Story key 在 `git.repos` 配置的仓库里搜提交（`--grep=<KEY>`），算出每个 Story 的：Sprint 内提交数、最后提交日、涉及仓库、最远到达的集成分支（`branch → sprint → dev → production`）。输出每个 Story 一行，核对一遍是否合理。

### 4. 判定风险与标签（需要判断，不是机械规则）

`risk` 取 `high / medium / low / none`；`tags` 从下表里选：

| tag | 含义 | 判断依据 |
|---|---|---|
| `blocked` | 被依赖阻塞 | 子任务里有别人的前置项未开工，或备注里明确依赖未就绪；被**外部团队**（team.json `external: true`）卡住时 note 里写明「外部依赖：<人>」 |
| `stale` | 长期无提交 | 未完成，且最后提交距今 ≥ 7 天、未合入集成分支 |
| `jiraLag` | Jira 状态滞后 | 代码已到 sprint/dev/production，但 Story 仍 Open，或 AC 还停在 Coding |
| `noCode` | 无代码痕迹 | 未完成且 `code.reached == "none"` |
| `unassigned` | 无经办人 | Story 或其大部分 AC 无经办人 |

风险等级参考：
- **high**：已过 Sprint 中点仍 `noCode`；被 `blocked`；`stale` 且 AC 未进测试。
- **medium**：`jiraLag`、`unassigned`、只完成部分、没有 AC 无法衡量。
- **low**：代码已合入 sprint 及以上，AC 在测试或已完成。
- **none**：Story 已 Done / Closed。

结合 team.json 再看两点：
- **外部团队**经办或被其阻塞的 Story：本组无法直接推进，action 写成「找 <人>/<团队> 确认排期」，并在 `risks` 里作为依赖风险；不要把外部人员写成行动项的负责人。
- **单点负载**：某个角色只有 1 个本组成员（`external: false` 且 `capacity` 不为 `false`）却承担大量 Story/Bug（如测试只有 Biao Mu），写进 `risks`。

每个 Story 写一句 `note`（事实：代码到哪、AC 在哪、卡在哪）和一句 `action`（可执行的下一步，没有就留空）。注意：`git` 只覆盖本地三个仓库，「无提交」时 note 里写「本地仓库无提交」，不要断言未开工。

然后更新：
- `risks`：Sprint 级风险（3–6 条），已解除的删掉，新出现的加上。
- `actions`：按优先级排序的行动项，带负责人和关联 Story。
- `summary.verdict`（`on-track / at-risk / behind`）、`summary.headline`（一句话结论）、`summary.carryOver`（预计顺延数量）。
- `caveats`：数据口径说明，有变化才改。

**更新模式下**：保留上次人工写的 note/action 中仍然成立的内容，只改变化了的部分；不要删 `history`。

### 5. 生成看板

```bash
python docs/pm/scripts/build.py docs/pm/<Sprint>/data.json
```

脚本会校验字段、重算 `computed`、按 `snapshot.date` 追加或覆盖当天的 `history`，然后**用全部 Sprint 重建固定入口** `docs/pm/index.html` 与清单 `docs/pm/sprints.json`（入口内嵌所有 Sprint 的数据，双击即可离线打开）。
带参数只处理那一个 Sprint，不带参数处理全部；两种用法都会重建入口。报错就按提示修 data.json 后重跑。

### 6. 验证

用 `.claude/launch.json` 里的 `pm-dashboard`（`python -m http.server 8765 --directory docs/pm`）打开固定入口 `http://localhost:8765/index.html?sprint=<Sprint>`：
- 控制台无报错；4 个 Tab 都能切换；Sprint 下拉能切到别的 Sprint、且切完自动回到「总览」。
- Story 行数与 Jira 一致；指标卡数字与 build.py 输出一致。
- 「明细」Tab 的「团队与角色」表：外部成员带「外部」标签。
- 浅色、深色各截一张图，确认图表没有重叠或溢出；长表滚动时顶栏与表头应保持可见。

### 7. 向用户汇报

简短说明：本次快照与上次（`history` 倒数第二条）相比的变化——完成数、AC 完成数、高风险数增减；用 `doneKeys` / `highRiskKeys` / `riskTitles` 对比出**哪些** Story 新完成、新变高风险或解除，哪些风险新增或解除；最需要用户本人处理的 1–3 件事；team.json 里新增的待确认成员（请用户确认角色和是否外部）。给出固定入口链接 `docs/pm/index.html?sprint=<Sprint>`。

## 改看板样式

只改 `docs/pm/_template/dashboard.html`（固定入口的外壳），然后重跑 `build.py` 重建入口；各 Sprint 的 `data.json` 不受影响。
Tab 与卡片的分组在 `shell()` 里，各图的渲染在对应的 `renderXxx()`；新增/移动卡片时注意把 `renderXxx()` 的挂载点 id 一起改。配色遵循 dataviz skill：阶段用单色蓝有序色阶（已用 `validate_palette.js --ordinal` 校验深浅两套），仓库用分类色前三位，风险用固定状态色并配图标 + 文字。新增配色先跑校验脚本。

样式约定（改模板时遵守）：
- 顶栏 + Tabs **粘性吸顶**，长表滚动时仍可切换；表头 `thead` 粘性。
- 行动项 / 风险的负责人用 `who()`（角色标签），与明细表一致。
- 交互控件保留 `:focus-visible` 轮廓；不要用纯装饰卡片堆叠。

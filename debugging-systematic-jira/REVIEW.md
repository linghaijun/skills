# debugging-systematic-jira Review 记录

上次 review：2026-10-14（下次到期：+7 天）

## 2026-10-14（子 agent / 主会话委派的定期自检，按本 skill references/self-review.md 流程）

- 范围：读了 6 个文件 —— SKILL.md、references/root-cause-tracing.md、references/jira-comment-template.md、references/harvest.md、references/lessons.md、scripts/jira-run-upload-command.mjs；另实查 cdp-drive-real-chrome（SCRIPTS.md、PAGE-NOTES-GUIDE.md、projects/creative-management/README.md、PAGE-NOTES.md、scripts/chk401.mjs）、distribute-agent-skills、creative-management-all `AGENTS.md`（第 657 行引用 bug-lessons、第 756 行 Learned 准入 / 20 条上限）与 `docs/bug-lessons.md`（B-01 / B-02）
- 已改：
  - `SKILL.md` 5.3 第 4 条：`creativehub-dim-switch.mjs` **不存在**（Glob 全 skills 目录与 .cursor 副本均无）→ 改为实际存在的 `creativehub-drive.mjs` / `creativehub-gen-run.mjs`，并指向 CDP `projects/<项目>/README.md` 清单
  - `SKILL.md` 5.4 第 2 条：补「Atlassian MCP 操作可能不在顶层工具列表，先 `discover` 再 `executeRead` / `executeWrite` 按名调用」
  - `SKILL.md` 5.5 判据表：补「仅本项目代码模式 → 项目 bug 经验文档」一行（原表只有页面级 L1，与第 5 条 / harvest.md 落点表不一致）；「最低动作」前置说明补全第 4、6 条何时做（原只说明了 1~3、5）
  - `SKILL.md` 配套材料：补项目 bug 经验文档一行（阶段 1 第 0 步读、5.5 第 5 条写，形成闭环）
  - `references/jira-comment-template.md`：新增「MCP 调用方式」小节 —— `listJiraIssueComments`（executeRead，discover 可查）、`addOrEditJiraIssueComment`（executeWrite，discover 官方说明里点名引用）、`uploadAttachmentToJiraIssue`（discover 未检出，待确认）；补 `getContentFormatGuide(toolName=addOrEditJiraIssueComment)` 写 html 前可查
  - `references/harvest.md` 近期正例行：`pickProduct` / `clickDimensionType` / `creativehub-dim-switch.mjs` 实查均不存在、「ProductSelect 行高 60px」PAGE-NOTES 查无 → 行内标注「待确认 / 待补」并保留原记载；收尾清单第 8 条补「回复前用 Glob / Grep 实查落点」
  - `references/lessons.md`：「生成中途切换表单控件用快照」与「其他异步任务同类排查」两条讲的是同一模式 → **合并为一条**（两条内容全部保留）；「去重键下游 Map」一条去掉项目专有名（`slotByDimensions`、尺寸）抽象成 A / A+B，项目事例改为链接 `docs/bug-lessons.md` B-01（L0 只收跨项目抽象，项目细节已在 bug-lessons 全文）；两条都补 B-01 / B-02 链接
- 已删：无（lessons 两条为合并，原文要点全部保留在合并后条目内）
- 新规则（2026-10-14）一致性检查：
  - 阶段 1 第 0 步「读 docs/bug-lessons.md」：与 AGENTS.md 第 657 行、bug-lessons.md 头部「谁读」一致；位置在读错误信息之前合理（先查是否已知模式），不改
  - 5.5 第 5 条「代码模式沉淀」：与 harvest.md 落点表「会复发的代码模式」行一致；与 lessons.md 的分工（L0 抽象 vs 项目事例）此前有重叠，已按上面处理
  - 无矛盾
- 待确认：
  - `uploadAttachmentToJiraIssue` 操作名：本会话 `discover`（3 次不同关键词）只检出读操作（searchableCount 98 / 319），写操作可能被会话权限过滤，未能核实名字 —— 下次真实贴图时 discover 一次确认
  - harvest.md 正例行的 `creativehub-dim-switch.mjs` / `pickProduct` / `clickDimensionType`：是当时没入库还是被覆盖丢失，需用户确认；若需要应补进 CDP `projects/creative-management/`（不在本次可改范围）
  - 「ProductSelect 行高 60px」应补进 CDP PAGE-NOTES（不在本次可改范围），harvest.md 反例里的正确阈值保留
  - `jira-run-upload-command.mjs` 第 58~62 行：注释说 MCP 给的是 `curl --location '...'`（单引号），而脚本交给 `cmd.exe` 执行，cmd 不认单引号；脚本头写「最后验证 2026-10-14（CP-58922）」实测成功，故未改 —— 若再遇到 `curl: (3) URL rejected` 一类报错，优先查这里
- 自检：`node --check scripts/jira-run-upload-command.mjs` → 通过（本次未改脚本，仍跑）；SKILL.md 内 `references/*` / `scripts/*` 链接逐个 `[ -f ]` 实查 → 全部存在（`references/SCRIPTS.md` 指 cdp skill 的文件，已在 cdp 目录确认存在）；`grep dim-switch` 仅剩 harvest.md 标注行
- 分发：未做（按委派要求由主会话统一分发）

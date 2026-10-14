# 上下文压缩（/compact）时机

> 两个 workflow 共用本文件（逐字相同）。
> **只对支持 `/compact` 的 agent 生效**（Claude Code CLI / 桌面版 Code）；其他工具（Cursor、Trae、opencode……）跳过本文件，不提示、不强求。

## 0. 先认清三个事实

1. **AI 自己发不了 `/compact`**：斜杠命令只有用户在消息开头输入才生效，hook 也不能触发压缩（只能拦截）。所以「自动」= **AI 判断时机 + 给出可直接粘贴的命令**，由用户回车。
2. **系统会在上下文快满时自动压缩**，时机不由我们选 —— 可能正好压在一步中间。兜底靠 §4 的 hook。
3. **压缩只保留摘要**：没落盘的结论、取证、子 agent 结果，压缩后等于没有。所以「先落盘再压缩」是硬前提。

## 1. 什么时候建议压缩（同时满足 A + B）

**A. 处在安全点**（任一）：

- 🔴 阻塞门控刚被用户确认、下一步还没开始（Spec+Checklist、DDL、API 契约、业务逻辑自检、AI Review、提交、提测）
- 一个重步骤收尾：`validate_step.py --step N --record` 已 PASS（典型：多轮需求问答、编码、一批 AC 的浏览器验证 / 数据核对）
- 大段探索 / 读日志 / 读代码结束，结论**已写进需求目录**的文档

**B. 上下文确实重了**（任一，凭迹象判断，没有精确计数）：

- 本会话读过多个大文件 / 长日志 / 大量截图，或跑过多轮浏览器验证
- 距上次压缩（或会话开始）已经跨了 ≥2 个步骤
- 开始出现重复读同一文件、忘记前面已确认的事

## 2. 什么时候绝不建议

- 步骤做到一半；编译 / 单测自愈循环中；`verify_state.py` 里还有本会话认领的「验证中」AC
- 还在等后台子 agent 返回，或刚收到结果但还没写进文档
- 有结论只在对话里、没落盘；`qa_record.py changes` 有待确认改动
- 正准备汇报阻塞门控（先汇报，用户确认后再压）

## 3. 怎么建议（一步最多一次，别唠叨）

先确认落盘：`validate_step.py --record` 已跑、`verify_state.py` 已登记、问答已用 `qa_record.py` 写回。然后在汇报**末尾**加一行，命令里写明要保留什么：

```
💡 现在是压缩上下文的好时机（Step N 已落盘）。可直接发送：
/compact 保留：需求目录 <目录名>；已完成到 Step N，下一步 Step N+1；待确认项 <…>；规则以 SKILL.md 和 step 文件为准
```

用户没理会就继续干活，**到下一个安全点之前不再提**。

## 4. 压缩之后（无论手动还是自动）

- 已配置 hook 时，会自动注入「续跑提示」：最近活跃需求、看板链接、`validate_step --status` 续跑点、必做三件事
- 没配置 hook 或提示没出现时，自己做这三件事：
  1. 重新 Read 本 workflow 的 `SKILL.md` 和当前步 step 文件（**摘要不等于规则原文**，门控 / 红线以文件为准）
  2. 下一条回复先给看板链接
  3. 跑 `validate_step.py --dir <需求目录> --status` 拿续跑点；跑 `qa_record.py changes`；对话里没落盘的东西视为丢失，需要时重新取证

**hook 配置**（Claude Code，写进项目 `.claude/settings.local.json`，路径按本机改）：

```json
{"hooks": {"SessionStart": [{"matcher": "compact", "hooks": [{"type": "command",
  "command": "python \"C:/Users/<you>/.claude/skills/ai-driven-fullstack-workflow/scripts/compact_resume.py\"",
  "timeout": 30}]}]}}
```

脚本只读：没有 48 小时内活跃的需求就什么都不输出，出错也静默退出。

> 想让系统更早自动压缩，可以调小 `autoCompactWindow`（settings）或 `CLAUDE_CODE_AUTO_COMPACT_WINDOW`（环境变量）。这是全局行为变化，**默认不改**，用户要求时再设。

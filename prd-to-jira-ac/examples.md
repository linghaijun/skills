# Pacvue AC Examples

## Example 1: Read PRD and update Jira

User input:

```markdown
读一下这个 PRD 链接，然后把每个大功能拆成 AC，加到对应 Jira 的 checklist 里
```

Expected behavior:

1. Check Atlassian MCP availability.
2. Ask whether codebase reading is allowed if this is the first use in the project.
3. Read the PRD.
4. Extract major features.
5. Identify Jira links.
6. Generate AC.
7. Detect the actual checklist field.
8. Write AC into checklist, not description.

## Example 2: User provides PRD link but no MCP

Assistant response pattern:

```markdown
这个流程需要 Atlassian MCP 才能稳定读取私有 Confluence 并更新 Jira checklist。当前没有检测到可用的 Atlassian MCP。需要的话我可以先帮你安装或连接它。
```

## Example 3: First time in a new project

Assistant question:

```markdown
我可以读取这个项目的代码和技术文档，检查 PRD 是否遗漏了已有行为、模块边界、联动逻辑或边界条件吗？
```

If user says no:

- continue with PRD + Jira only
- mention assumptions in the output

## Example 3.1: Code reading finds likely PRD gaps

Expected behavior:

1. Read PRD and draft the first AC set.
2. Read relevant code after permission is granted.
3. Detect that the current product already has, for example, an extra warning dialog, permission gate, or validation branch not mentioned in the PRD.
4. Do not silently add scope as a fact.
5. Tell the user:

```markdown
我在代码里看到这里还有一个已有的校验/联动逻辑，但 PRD 里没有明确写到。建议补一条 PRD 或 AC，确认这次是否也要保持这个行为。
```

## Example 4: AC format

```markdown
* [open] AC-01 Targeting 模块展示调整
>> Given：用户进入 Create / Edit / Copy Line Item、Create / Edit / Copy / Apply Line Item Template、Copy Order - Copy Line Item 页面
>> When：Line Item Type 选择 Display 或 Online Video
>> Then：Targeting 模块中不再展示 Contextual；改为展示 In-market Categories 和 Products
```

## Example 5: Checklist-field caution

Wrong:

```markdown
直接把 AC 写进 description
```

Right:

```markdown
先查 issue type field metadata
再找一个已有 checklist 的 issue 样板
确认真实 checklist 字段
把 AC 写进去
最后回读 issue 验证
```

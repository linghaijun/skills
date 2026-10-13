# Pacvue AC Reference

## Goal

Turn a PRD or Confluence wiki page into Jira acceptance criteria that are stored in the actual checklist field for the corresponding Jira issues.

## End-to-End Flow

1. Confirm input source.
2. Check required MCP availability.
3. On first use in a project, ask whether codebase reading is allowed.
4. Read PRD / Confluence / screenshots.
5. Split PRD into major feature blocks.
6. Locate corresponding Jira issues.
7. Draft AC in Pacvue format.
8. Detect the real Jira checklist field.
9. Write AC into checklist.
10. Verify that checklist content landed in the right place.

## Source Priority

Use this precedence when sources disagree:

1. latest explicit user instruction
2. screenshot for visual truth
3. PRD / Confluence for business scope
4. local technical docs
5. current codebase reality

Record important conflicts explicitly.

## MCP Requirements

### Required

- Atlassian / Confluence / Jira MCP

Use it for:

- reading private Confluence pages
- reading Jira issues
- finding Jira links
- updating checklist fields

### Optional

- Figma-related MCP if the PRD references design details that change the AC wording

## Missing MCP Rule

If required MCPs are missing:

- tell the user which MCP is missing
- explain which part of the workflow is blocked
- offer to help install or connect it

Example:

```markdown
This workflow needs an Atlassian MCP connection to read private wiki pages and update Jira checklist fields. It is not currently available. If you want, I can help install or connect it first.
```

## First-Use Project Question

On first use in a project, ask:

```markdown
我可以读取这个项目的代码和技术文档，检查 PRD 是否遗漏了已有行为、模块边界、联动逻辑或边界条件吗？
```

### If yes

- read relevant code
- read local docs
- use project-specific naming and module boundaries in AC
- compare PRD statements against existing implementation
- look for likely omissions such as:
  - existing validation or warning flows
  - dependent modules or linked settings
  - hidden preconditions
  - edge cases and fallback behavior
  - feature flags, permissions, or status-based branching
- if omissions are found, surface them as:
  - PRD supplement suggestions
  - AC additions
  - confirmation questions for the user or PM
- do not silently convert implementation quirks into required scope

### If no

- stay within PRD + Jira context
- mark assumptions
- avoid implementation-specific AC wording unless explicitly present in the PRD

## Major Feature Extraction

Split PRD content into major features using headings, scope tables, and feature detail sections.

Typical signals:

- scope tables
- numbered feature sections
- Jira-linked feature rows
- repeated `背景描述 / 涉及页面 / 页面功能` blocks

Each major feature should map to:

- one Jira issue when possible
- otherwise one grouped AC block plus an explicit mapping note

After drafting the first AC set, use the code/doc gap-check result to ask:

- is this behavior already implemented but not documented in the PRD?
- is there an existing dependency or validation rule that the PRD forgot to mention?
- does the current product already expose edge cases that need explicit AC coverage?

## Jira Mapping Strategy

### Preferred

- Use Jira links directly embedded in the PRD

### Fallback

- Search Jira by exact or near-exact summary
- Search by PRD section title
- Search by product keywords

If there are multiple plausible matches, ask the user before writing.

## AC Writing Rules

### Default shape

```markdown
* [open] AC-01 标题
>> Given：...
>> When：...
>> Then：...
```

### Writing quality

- One AC = one observable behavior
- Prefer user-observable outcomes
- Keep technical implementation detail only when it affects behavior
- Use exact UI labels and enum names from the PRD
- Include page scope when the same behavior spans create / edit / copy / template / apply flows

### Good examples

- field rename
- option visibility
- dynamic show/hide behavior
- validation messages
- historical data migration and compatibility

## Checklist Field Detection

Do not assume the checklist is stored in `description`.

### Step 1

Read Jira field metadata for the relevant issue type.

Look for fields named like:

- `Checklist Text`
- `Checklist Content YAML`
- `Checklist Text (view-only)`
- `Checklist Progress`
- plugin-specific checklist fields

### Step 2

Search the project for an issue that already has checklist content.

Read both:

- the human-visible checklist text field
- the underlying structured field if present

### Step 3

Mirror that format exactly for the target project.

Do not hardcode field IDs from one project into another project.

## Writing Strategy

### Preferred

Write to the real checklist field used by that Jira project.

### Temporary fallback

If you need to experiment:

- you may draft in description temporarily
- but move it into checklist afterward
- and clean description if it should not remain there

### Final fallback

If the project truly has no checklist field:

- ask the user whether to use description or a comment instead

## Verification After Write

After updating Jira:

1. read the issue again
2. verify checklist field is populated
3. verify description is not accidentally holding the final AC if it should not
4. verify status/progress fields still make sense

## Anti-Patterns

- Writing AC directly into description without checking for a checklist field
- Hardcoding custom field IDs across projects
- Generating AC before confirming Jira mapping
- Skipping the first-use codebase permission question
- Pretending private Confluence can be read without MCP/auth
- Treating code reading as license to rewrite product scope instead of using it to detect PRD gaps

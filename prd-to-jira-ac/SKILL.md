---
name: prd-to-jira-ac
description: Read a PRD link or Confluence wiki, extract the major features, map them to related Jira issues, generate acceptance criteria in Pacvue style, and write them into the real Jira checklist field. Prefer this skill whenever the user mentions AC, acceptance criteria, checklist, Jira AC, 拆 AC, 拆解 AC, or provides a PRD / Confluence link for requirement breakdown or Jira sync.
metadata:
  author: "yuheng.gu@pacvue.com"
  version: "0.0.1"
---

# PRD → Jira AC

## Purpose

Use this skill for the full Pacvue requirement workflow:

1. read a PRD link or wiki,
2. identify the major features,
3. find the related Jira issues,
4. split each feature into AC,
5. write the AC into the real Jira checklist area instead of dumping it into description.

This skill is meant to work across projects, not just one repository.

## First-Use Rule

When using this skill in a project for the first time, ask:

- whether you may read the codebase to check whether the PRD missed existing behavior, module boundaries, dependency links, or edge cases

If the user agrees:

- read relevant code, docs, or technical design material before finalizing AC
- use code reading as a gap-check against the PRD
- if code shows existing behavior, validation, coupling, or edge cases that the PRD did not mention, call them out and suggest that the PRD or AC be supplemented
- do not silently expand scope; present suspected omissions as recommended additions or confirmation questions

If the user declines:

- proceed from PRD + Jira only
- explicitly mark assumptions and unknown implementation details

## Required Tools

Prefer these MCP/tool capabilities:

- Atlassian / Confluence / Jira MCP for wiki and issue operations
- optional Figma access if the PRD includes design links that materially affect AC wording

If required MCPs are missing or not authenticated:

- say exactly which MCP is missing
- say that the workflow cannot be completed reliably without it
- offer to help install or connect it with the user

Read [reference.md](reference.md) for the exact MCP checks and fallback rules.

## Workflow

1. Identify the source:
   - Confluence / PRD link
   - pasted PRD text
   - screenshot
   - mixed sources
2. Read the PRD through the best machine-readable path.
3. Extract the major feature blocks from the PRD.
4. Identify related Jira issues:
   - directly from links in the PRD if present
   - otherwise search Jira by summary / title / keywords
5. Generate AC for each major feature using the Pacvue AC format.
6. Detect the real Jira checklist field before writing:
   - do not assume description is the checklist
   - inspect issue fields and existing checklist examples first
7. Write AC into the actual checklist field.
8. Only fall back to description or comment if the project truly has no checklist field, and ask the user first.

## AC Format

Use this shape by default:

```markdown
* [open] AC-01 标题
>> Given：...
>> When：...
>> Then：...
```

Keep one AC focused on one observable behavior. Split large feature blocks into multiple AC items.

## Jira Writing Rules

- Prefer the real checklist field on the right-side Jira panel.
- Preserve the project's existing checklist storage format if a plugin field already exists.
- If the checklist plugin uses custom fields such as `Checklist Text`, `Checklist Content YAML`, or similar:
  - inspect one existing issue with checklist content first
  - mirror that format
- If description was used temporarily during exploration, move the content into checklist and clean up description afterward.

## Guardrails

- Do not hardcode one project's checklist field IDs across all projects.
- Do not write AC into description just because it is easier.
- Do not invent Jira mappings if the PRD does not clearly support them.
- Do not skip code/doc validation when the user allowed codebase reading.
- Do not treat current code as automatic product truth. Use code to detect likely PRD omissions, compatibility constraints, and missing acceptance coverage.

## Additional Resources

- detailed workflow and fallback logic: [reference.md](reference.md)
- example PRD-to-Jira AC outputs: [examples.md](examples.md)

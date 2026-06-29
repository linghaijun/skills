---
name: updating-wiki
description: Incrementally update existing project wiki documentation when code changes. Use when the user asks to update wiki, refresh docs, sync documentation with code changes, or mentions "update wiki", "refresh docs", "sync documentation". Detects diffs between code and wiki, then updates only affected sections.
---

# Updating Wiki

Incrementally update existing wiki documentation when codebase changes. Only updates affected sections rather than regenerating everything.

## When to Use

- User asks to update/refresh/sync wiki after code changes
- User mentions "update wiki", "refresh docs", "sync documentation"
- User says wiki is outdated or behind code

## Language Requirement

**所有输出文档必须使用中文撰写**（与generating-wiki skill一致）：
- 文档描述、业务逻辑、数据来源说明、SQL注释 → 中文
- SQL语句、类名、方法名、路径、技术专有名词 → 保持英文

## Workflow

Copy this checklist and check off items as you complete them:

```
Task Progress:
- [ ] Phase 1: Detect changes (diff code vs wiki)
- [ ] Phase 2: Determine affected wiki files
- [ ] Phase 3: Update each affected file
- [ ] Phase 4: Verify consistency
```

### Phase 1: Detect Changes

Compare current codebase state against existing wiki content.

**1a. Controller changes** (affects API-Reference.md):
- Scan all `*Controller.java` files
- For each controller, compare endpoints against API-Reference.md sections
- Detect: new endpoints, removed endpoints, changed paths/methods

**1b. Entity/Domain changes** (affects Database-Design.md, API-Reference.md SQL):
- Scan all `*Mapper.xml` files for SQL changes
- Scan all domain/entity classes for new/removed fields
- Detect: new tables, removed tables, new columns, changed SQL

**1c. Service/Handler changes** (affects API-Reference.md business logic):
- Scan Handler/Manager classes for method signature or logic changes
- Detect: new Feign calls, new AI calls, changed data flow

**1d. Config/Infra changes** (affects Development-Setup.md, Deployment-Guide.md):
- Compare `pom.xml` dependencies
- Compare `application*.yml` configuration
- Compare CI/CD config (`.github/workflows/`)

**1e. Convention changes** (affects Code-Standards.md, Git-Workflow.md, Testing-Guide.md):
- Compare `.agents/*.md` files against wiki

### Phase 2: Determine Affected Wiki Files

Based on Phase 1 findings, map changes to wiki files:

| Code Change | Affected Wiki Files |
|-------------|-------------------|
| New/removed/changed Controller endpoint | API-Reference.md |
| New/removed/changed Entity field | Database-Design.md, API-Reference.md (SQL) |
| New/removed/changed Mapper XML SQL | API-Reference.md (SQL), Database-Design.md |
| New/removed/changed Handler logic | API-Reference.md (业务逻辑+数据来源) |
| New/removed Maven dependency | Project-Overview.md, Development-Setup.md |
| Changed application.yml config | Development-Setup.md |
| Changed CI/CD config | Deployment-Guide.md, Git-Workflow.md |
| Changed .agents/ conventions | Code-Standards.md, Git-Workflow.md, Testing-Guide.md |
| New/removed module | System-Architecture.md, Module-Details.md, Project-Overview.md |

### Phase 3: Update Each Affected File

For each affected wiki file, follow the update strategy in [references/update-strategies.md](references/update-strategies.md).

**General update rules**:
1. **Read existing wiki file first** — never overwrite blindly
2. **Use SearchReplace** to update only changed sections
3. **Preserve unchanged content** exactly as-is
4. **Maintain consistent formatting** with existing document style
5. **Update cross-references** if section names change
6. **Update summary tables** at end of API-Reference.md if tables/services change

**API-Reference.md specific rules** (see [references/api-update-guide.md](references/api-update-guide.md)):
- New endpoint → add full section with 业务逻辑 + 数据来源 + SQL
- Changed logic → update affected steps and data sources
- Changed SQL → replace full SQL block (no "..." ellipsis)
- Removed endpoint → remove entire section

### Phase 4: Verify Consistency

1. Verify no "..." ellipsis in any SQL (run grep)
2. Verify all cross-references between wiki files are valid
3. Verify every controller endpoint has a corresponding API-Reference section
4. Verify table names match `@TableName` annotations
5. Verify SQL column lists match entity class fields

## Data Source Icons

Same as generating-wiki skill:

| Icon | Meaning |
|------|---------|
| 🗄️ MySQL | Local MySQL table |
| 🔗 Feign | Remote service via OpenFeign |
| 🤖 AI | AI service call |
| ☁️ S3 | AWS S3 object storage |
| 💾 Memory | In-memory computation |
| 📥 HTTP | HTTP download external resource |

## SQL Documentation Rules

Same as generating-wiki skill — **no "..." ellipsis allowed**:
1. Every SQL must have complete field lists
2. Mapper XML SQL: copy verbatim
3. MyBatis-Plus: write pseudo-SQL (`SELECT * FROM table WHERE field = ?`)
4. CTE queries: write full CTE with all columns
5. INSERT statements: list all columns explicitly

## References

- **Update strategies**: [references/update-strategies.md](references/update-strategies.md) — Per-file update strategies and diff detection methods
- **API update guide**: [references/api-update-guide.md](references/api-update-guide.md) — Detailed process for updating API-Reference.md

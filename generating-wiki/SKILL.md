---
name: generating-wiki
description: Generate comprehensive project wiki documentation from a Java/Spring Boot codebase. Use when the user asks to create project wiki, generate documentation, or build a knowledge base from source code. Triggers include "generate wiki", "create project docs", "build documentation", "wiki from code".
---

# Generating Wiki

Generate a complete project wiki by analyzing a Java/Spring Boot codebase. Produces 11 structured markdown files in a `wiki/` directory. **All output documents must be written in Chinese (中文).**

## Language Requirement

**所有输出文档必须使用中文撰写**，包括：
- 文档标题、章节标题、描述说明
- 业务逻辑描述（如"获取素材分页列表"、"查询标签树结构"）
- 数据来源说明（如"查询素材已关联的平台"、"调用AI服务识别品牌"）
- SQL注释（如 `-- 动态条件: 文件类型, 集合ID`）
- 汇总表格中的描述列

**以下内容保持英文原文**：
- SQL语句本身（表名、列名、关键字）
- Java类名、方法名、变量名
- HTTP路径、请求参数名
- 技术专有名词（Spring Boot、MyBatis-Plus、Feign等）

## When to Use

- User asks to generate project wiki or documentation from code
- User wants a knowledge base created from source code
- User mentions "wiki", "project docs", "documentation from code"

## Workflow

Copy this checklist and check off items as you complete them:

```
Task Progress:
- [ ] Phase 1: Scan project structure and dependencies
- [ ] Phase 2: Generate 10 wiki documents (Home through Deployment-Guide)
- [ ] Phase 3: Generate API-Reference.md with full SQL details
- [ ] Phase 4: Verify all files and cross-references
```

### Phase 1: Scan Project Structure

1. Read `pom.xml` for tech stack, modules, dependencies
2. Read `application.yml` / `application-*.yml` for configuration
3. Scan controller classes → list all REST endpoints
4. Scan domain/entity classes → list all database tables
5. Scan mapper XML files → extract SQL queries
6. Scan `.agents/` or `.trae/rules/` for project conventions
7. Identify layered architecture: Controller → Handler/Manager → Service → Mapper

### Phase 2: Generate 10 Wiki Documents

Generate each file following templates in [references/wiki-templates.md](references/wiki-templates.md).

| # | File | Key Data Sources |
|---|------|-----------------|
| 1 | `Home.md` | Project name, wiki index |
| 2 | `Project-Overview.md` | pom.xml, business context |
| 3 | `System-Architecture.md` | Module structure, design patterns |
| 4 | `Module-Details.md` | Package structure, dependencies |
| 5 | `Development-Setup.md` | application.yml, build config |
| 6 | `Database-Design.md` | Entity classes, mapper XML |
| 7 | `Code-Standards.md` | .agents/code-standards.md |
| 8 | `Git-Workflow.md` | .agents/git-workflow.md, CI config |
| 9 | `Testing-Guide.md` | .agents/testing.md, test examples |
| 10 | `Deployment-Guide.md` | CI/CD config, Dockerfile |

### Phase 3: Generate API-Reference.md (Most Complex)

This is the most detailed document. Follow the process in [references/api-reference-guide.md](references/api-reference-guide.md).

Key requirements:
- List every endpoint with HTTP method, path, description
- Document business logic step by step
- Mark data sources with icons: 🗄️ MySQL, 🔗 Feign, 🤖 AI, ☁️ S3, 💾 Memory, 📥 HTTP
- **Include full SQL for every database query** — no "..." ellipsis allowed
- For MyBatis-Plus lambdaQuery/lambdaUpdate, write equivalent pseudo-SQL
- For Mapper XML, copy the actual SQL verbatim
- Summarize all tables, Feign services, and AI capabilities at the end

### Phase 4: Verify

1. Check all cross-references between wiki files are valid
2. Verify no "..." ellipsis in any SQL
3. Ensure every controller endpoint is documented
4. Confirm table names match entity class `@TableName` annotations

## Data Source Icons

| Icon | Meaning | Example |
|------|---------|---------|
| 🗄️ MySQL | Local MySQL table | `asset_info` table |
| 🔗 Feign | Remote service via OpenFeign | `businessAware.getCreativePerformance()` |
| 🤖 AI | AI service call | `aiHandler.imageOcr()` |
| ☁️ S3 | AWS S3 object storage | Upload/delete files |
| 💾 Memory | In-memory computation | Dedup, grouping, aggregation |
| 📥 HTTP | HTTP download external resource | Download platform images |

## SQL Documentation Rules

1. **No ellipsis**: Every SQL must have complete field lists
2. **Mapper XML SQL**: Copy verbatim from XML files
3. **MyBatis-Plus pseudo-SQL**: Write `SELECT * FROM table WHERE field = ?` format
4. **Dynamic conditions**: Use `-- 动态条件: field1, field2` comments
5. **CTE queries**: Write full CTE with all columns, no abbreviation
6. **INSERT statements**: List all columns explicitly, no trailing omission

## Output Structure

```
wiki/
├── Home.md
├── Project-Overview.md
├── System-Architecture.md
├── Module-Details.md
├── Development-Setup.md
├── API-Reference.md          ← Largest file, full SQL details
├── Database-Design.md
├── Code-Standards.md
├── Git-Workflow.md
├── Testing-Guide.md
└── Deployment-Guide.md
```

## References

- **Wiki templates**: [references/wiki-templates.md](references/wiki-templates.md) — Template structure for each of the 10 wiki files
- **API Reference guide**: [references/api-reference-guide.md](references/api-reference-guide.md) — Detailed process for generating API-Reference.md with full SQL

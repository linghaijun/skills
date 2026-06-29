# API Update Guide

Detailed process for updating API-Reference.md when code changes.

## Change Types and Actions

### 1. New Controller Endpoint

**Detection**: Controller method exists in code but no corresponding `### METHOD \`path\`` section in wiki.

**Action**: Add a new section following this template:

```markdown
### {METHOD} `{path}` - {中文描述}

**业务逻辑**：
1. {步骤1描述}
2. {步骤2描述}

**数据来源**：
1. 🗄️ MySQL → `{table}` 表，`{service}.{method}()` {中文描述}
   ```sql
   {完整SQL语句，禁止省略}
   ```
2. 🔗 Feign → `{service}.{method}()` {中文描述}
```

**Process**:
1. Read the controller method body
2. Trace to Handler/Manager method
3. Trace all Service/Feign/AI/S3 calls
4. Read Mapper XML for SQL
5. Read entity class for complete field list
6. Write full section with complete SQL

### 2. Removed Controller Endpoint

**Detection**: Wiki section exists but no corresponding controller method in code.

**Action**: Remove the entire `### METHOD \`path\`` section including all subsections (业务逻辑, 数据来源).

### 3. Changed Endpoint Path or Method

**Detection**: Same method name but different `@RequestMapping` path or HTTP method.

**Action**:
1. Update the section heading `### METHOD \`path\``
2. Verify business logic is still accurate
3. Update data sources if the call chain changed

### 4. Changed Business Logic

**Detection**: Handler/Manager method body differs from wiki 业务逻辑 description.

**Common triggers**:
- New Service/Feign/AI call added to method
- Call order changed
- Conditional logic added/removed

**Action**:
1. Re-read the Handler/Manager method body completely
2. Rewrite the **业务逻辑** section with updated steps
3. Rewrite the **数据来源** section with updated data sources
4. For each new/changed MySQL query, include full SQL (no "...")
5. For each new Feign/AI call, add the corresponding icon entry

### 5. Changed SQL Query

**Detection**: Mapper XML SQL differs from wiki SQL code block.

**Common triggers**:
- New column added to SELECT
- WHERE condition changed
- New JOIN added
- CTE structure changed

**Action**:
1. Read the complete Mapper XML SQL
2. Read entity class for complete field list (if columns changed)
3. Replace the entire SQL code block in wiki
4. **Never use "..."** — always list all columns
5. Update dynamic condition comments if WHERE clause changed

### 6. New Database Table

**Detection**: New entity class with `@TableName` but no corresponding section in Database-Design.md or SQL in API-Reference.md.

**Action**:
1. Read entity class for complete field list
2. Read Mapper XML for all SQL queries against this table
3. Add table to Database-Design.md
4. Add SQL blocks to affected API-Reference.md sections
5. Add table to MySQL Tables Summary at end of API-Reference.md

### 7. New Feign Service Call

**Detection**: New `businessAware.xxx()` or `xxxFeignClient.xxx()` call in Handler/Manager code.

**Action**:
1. Identify the target service and method
2. Add 🔗 Feign entry to affected endpoint's 数据来源
3. Add to Feign Services Summary table at end of API-Reference.md

### 8. New AI Service Call

**Detection**: New `aiHandler.xxx()` call in Handler/Manager code.

**Action**:
1. Identify the AI capability (OCR, brand recognition, etc.)
2. Add 🤖 AI entry to affected endpoint's 数据来源
3. Add to AI Capabilities Summary table at end of API-Reference.md

## Summary Table Updates

After any endpoint-level changes, update the three summary tables at the end of API-Reference.md:

### MySQL Tables Summary

When tables are added/removed:
- Add new row: `| {table_name} | {中文用途} | {endpoint list} |`
- Remove row for deleted tables
- Update endpoint list if table is used by new endpoints

### Feign Services Summary

When Feign calls are added/removed:
- Add new row: `| {service name} | {method}() | {中文用途} |`
- Remove row for deleted calls
- Update method list if service gains new methods

### AI Capabilities Summary

When AI calls are added/removed:
- Add new row: `| {capability} | {method}() | {中文用途} |`
- Remove row for deleted capabilities

## Verification Checklist

After updating API-Reference.md:

```
- [ ] No "..." ellipsis in any SQL code block
- [ ] Every controller endpoint has a corresponding section
- [ ] Every MySQL data source has a SQL code block
- [ ] Every SQL code block has complete column lists
- [ ] Summary tables reflect current state
- [ ] Section headings match actual endpoint paths
- [ ] Data source icons are correct (🗄️🔗🤖☁️💾📥)
```

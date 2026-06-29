# Update Strategies

Per-file update strategies and diff detection methods for incrementally updating wiki documentation.

## Diff Detection Methods

### Method 1: Controller Endpoint Diff

Compare Controller classes against API-Reference.md sections:

1. Scan all `*Controller.java` files
2. Extract endpoint list: `(HTTP_METHOD, PATH, METHOD_NAME)`
3. Parse API-Reference.md for existing `### GET/POST/PUT/DELETE \`path\`` headings
4. Diff the two lists:
   - **Added**: endpoints in code but not in wiki → need new sections
   - **Removed**: endpoints in wiki but not in code → need section removal
   - **Changed**: same path but different method/signature → need section update

### Method 2: Entity/SQL Diff

Compare entity classes and Mapper XML against wiki SQL blocks:

1. Scan all domain/entity `*.java` files
2. Extract `@TableName` and field list per entity
3. Parse Database-Design.md for existing table definitions
4. Diff:
   - **New table**: entity exists but no wiki section → add table section
   - **Removed table**: wiki section exists but no entity → remove section
   - **Changed columns**: field count/names differ → update table definition

5. Scan all `*Mapper.xml` files
6. Extract SQL statements by mapper method name
7. Parse API-Reference.md SQL code blocks
8. Diff:
   - **New SQL**: mapper method exists but no wiki SQL → add SQL block
   - **Changed SQL**: mapper XML differs from wiki SQL → replace SQL block
   - **Removed SQL**: wiki SQL exists but mapper method removed → remove SQL block

### Method 3: Handler Logic Diff

Compare Handler/Manager method bodies against wiki business logic descriptions:

1. Scan Handler/Manager `*.java` files
2. For each method, extract the call chain (Service calls, Feign calls, AI calls)
3. Parse API-Reference.md 业务逻辑 sections
4. Compare:
   - **New call**: code has a Service/Feign/AI call not in wiki → add step
   - **Removed call**: wiki describes a call not in code → remove step
   - **Changed order**: call sequence differs → reorder steps

### Method 4: Config Diff

Compare config files against wiki:

1. `pom.xml` → compare dependency list against Project-Overview.md tech stack table
2. `application*.yml` → compare key configs against Development-Setup.md
3. `.github/workflows/*.yml` → compare CI/CD steps against Deployment-Guide.md
4. `.agents/*.md` → compare conventions against Code-Standards.md, Git-Workflow.md, Testing-Guide.md

## Per-File Update Strategies

### Home.md

- **Update trigger**: New/removed wiki files
- **Strategy**: Update 文档索引 section to reflect current file list
- **Typical changes**: Add/remove index links

### Project-Overview.md

- **Update trigger**: pom.xml dependency changes, new business features
- **Strategy**: Update 技术栈 table and 核心业务场景 list
- **Typical changes**: New dependency row, new business scenario

### System-Architecture.md

- **Update trigger**: New/removed modules, new design patterns
- **Strategy**: Update module diagram and design pattern sections
- **Typical changes**: New module description, new pattern (e.g., new BusinessService implementation)

### Module-Details.md

- **Update trigger**: New/removed Maven modules, package structure changes
- **Strategy**: Add/remove module sections, update core class lists
- **Typical changes**: New module section with class list

### Development-Setup.md

- **Update trigger**: application.yml changes, new dependencies
- **Strategy**: Update 配置说明 section with new/changed config items
- **Typical changes**: New config key, changed default value

### Database-Design.md

- **Update trigger**: New/removed entity classes, field changes
- **Strategy**: Add/remove table sections, update field lists
- **Typical changes**: New table section, added/removed columns

### Code-Standards.md

- **Update trigger**: `.agents/code-standards.md` changes
- **Strategy**: Diff and sync content from .agents source
- **Typical changes**: New coding rule, updated convention

### Git-Workflow.md

- **Update trigger**: `.agents/git-workflow.md` or CI/CD config changes
- **Strategy**: Diff and sync content, update CI/CD section
- **Typical changes**: New commit convention, updated pipeline

### Testing-Guide.md

- **Update trigger**: `.agents/testing.md` changes
- **Strategy**: Diff and sync content from .agents source
- **Typical changes**: New test rule, updated mock strategy

### Deployment-Guide.md

- **Update trigger**: CI/CD config changes, new deployment targets
- **Strategy**: Update CI/CD流水线 and 部署流程 sections
- **Typical changes**: New workflow step, changed deployment target

## Update Priority

When multiple files need updating, follow this order:

1. **API-Reference.md** — Most critical, most likely to be outdated
2. **Database-Design.md** — Schema changes affect multiple documents
3. **System-Architecture.md** / **Module-Details.md** — Structural changes
4. **Project-Overview.md** — Tech stack changes
5. **Development-Setup.md** — Config changes
6. **Code-Standards.md** / **Git-Workflow.md** / **Testing-Guide.md** — Convention changes
7. **Deployment-Guide.md** — Infra changes
8. **Home.md** — Index updates last

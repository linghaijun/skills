---
name: "ai-driven-backend-workflow"
description: "8-step backend dev workflow (Checklist→Plan→DDL→API→TestMatrix→Coding→Test+Debug→AIReview), per-step human review gating, unit tests written after all business code, docs in docs/develop/{branch}-{title}-{id}/. Invoke when developing backend features or user mentions PRD/需求/BDD/TDD."
---

# AI 驱动型后端开发全流程操作手册（AI-Driven Backend Workflow）

这是一套为 AI 量身定制的"AI 驱动型后端开发"完整操作手册。整个流程**环环相扣，前一步的输出作为后一步的输入**，确保 AI 不迷路、不瞎编。

## 核心原则（CRITICAL）

1. **顺序不可跳跃**：必须严格按 第一步 → 第八步 的顺序执行，每一步的产出物是下一步的强制输入。
2. **每步独立完成 + 人工 Review 门控**：每一步单独完成，完成后**必须暂停**，向用户汇报产出物路径并**显式请求人工 review 确认**；未获人工 review 通过前，**禁止进入下一步**。
3. **不一次性写完所有代码**：第六步是核心防错机制，必须拿着第一步的 Checklist **一条一条**喂给 AI，逐个击破。
4. **每步产出物必须落地为文档**：Checklist.md、技术设计与实现方案文档.md、ddl.sql、API接口定义文档.md、单元测试验证指标矩阵.md，禁止只在对话中口头产出。
5. **统一文档输出目录**：所有产出文档统一放在 `docs/develop/{git版本}-{需求title}-{需求id}/` 目录下（详见"文档输出目录规范"章节）。
6. **测试代码延后编写**：BDD Checklist（第一步）与测试矩阵（第五步）在编码前制定；但**单元测试代码统一在所有业务代码完成后（第七步 7.1）再编写**，第六步禁止写单测。
7. **最后统一调试**：编译、运行单测与自愈放在最后（第七步 7.2）统一做，不要边写边调。
8. **第八步为最终质量门禁**：编译通过 + 单测全部 Pass ≠ 需求全部实现。必须执行第八步 AI Review，逐条回溯 Checklist，确保交付物与需求零偏差后方可交付。

## 触发条件（When to Invoke）

当出现以下任一情况时，应启动本工作流：
- 用户提到"后端开发 / backend development / 新功能开发 / 实现需求"
- 用户提供了 PRD 文本、UI 界面截图、业务背景描述，要求开发
- 用户提及 "BDD / TDD / Checklist / 需求拆解 / 接口设计 / DDL 设计"
- 用户要求按规范流程开发一个完整的后端业务模块
- 用户明确说"按 AI 驱动型后端流程"或"按八步流程"

## 工作流总览

| 步骤 | 名称 | 输入 | 产出物 |
|------|------|------|--------|
| 1 | 需求对齐与 Checklist 生成 | PRD/UI/业务背景 | Checklist.md（BDD 格式） |
| 2 | 技术方案与实现计划 | Checklist + 技术栈 | 技术设计与实现方案文档.md |
| 3 | 数据库设计与 DDL | Checklist + 实现计划 + 已有表 | 数据库变更 SQL 脚本 |
| 4 | 接口文档设计 | Checklist + DDL + RESTful 规范 | 前后端 API 接口定义文档.md |
| 5 | 测试用例矩阵制定 | Checklist + API 文档 | 单元测试验证指标矩阵.md |
| 6 | 逐条编码（仅业务代码，禁止写单测） | 1~5 步全部产出物 | 生产代码（Controller/Service/Mapper/DTO） |
| 7 | 编写单测 + 编译自愈 | 第 6 步全部业务代码 + 第 5 步测试矩阵 + 报错日志 | 全部 Pass 的单测 + 编译通过的模块 |
| 8 | AI Review —— 需求回溯与代码合规审查 | 第 1 步 Checklist + 第 4 步 API 文档 + 第 5 步测试矩阵 + 第 6/7 步全部代码 | AI Review 报告（Checklist回溯表 + API契约检查 + 代码质量评分 + 缺陷清单） |

---

## 文档输出目录规范（CRITICAL）

所有第一~第五步的产出文档（Checklist / 技术设计 / DDL / API / 测试矩阵）**必须**统一放在：

```
docs/develop/{git版本}-{需求title}-{需求id}/
```

**目录段说明**：
- `git版本`：当前 git 分支名。用 `git rev-parse --abbrev-ref HEAD` 获取；若分支名含 `/`（如 `feature/xxx`），将 `/` 替换为 `-`。
- `需求title`：需求标题（来自 PRD 或用户提供），中英文均可，需去除空格和文件系统非法字符（`/ \ : * ? " < > |`）。
- `需求id`：需求 ID（如 `CP-48771`、`JIRA-123`），来自 PRD 或用户提供。

**目录结构示例**：
```
docs/develop/feature-share-audit-CP-48771/
├── Checklist.md
├── 技术设计与实现方案文档.md
├── ddl.sql
├── API接口定义文档.md
├── 单元测试验证指标矩阵.md
└── UI/                       # UI 图存放目录（如存在）
    ├── asset-detail.png
    └── share-dialog.png
```

**UI 图存放规范**：
- UI 界面截图（如果存在）统一放在 `docs/develop/{git版本}-{需求title}-{需求id}/UI/` 子目录下。
- 若用户在第一步提供了 UI 图，AI 应引导/确认其存放至该 `UI/` 目录，并在 Checklist.md 中以相对路径引用（如 `![](UI/asset-detail.png)`）。
- 若用户未提供 UI 图，则不创建该子目录，相关步骤按"无 UI 图"处理。

**执行要求**：
- 第一步开始前，AI 必须先确定 `git版本`、`需求title`、`需求id` 三项；若用户未提供 title/id，必须用 `AskUserQuestion` 询问。
- 目录不存在时自动创建。**注意 Windows 兼容**：本项目运行在 Windows，用 PowerShell `New-Item -ItemType Directory -Force` 创建（不要用 `mkdir -p`，PowerShell 不支持 `-p` 参数）。
- 第六步的业务代码、第七步的单测代码按项目既有源码目录结构放置（如 `micro-api/src/...`），**不**放进 docs 目录；只有设计类文档与 UI 图放进上述 docs 目录。

---

## 第一步：需求对齐与结构化 Checklist 生成

**输入**：PRD 文本、UI 界面截图、当前系统已有的业务背景描述。

**执行动作**：将模糊的人类需求，翻译成高严谨性的 BDD（行为驱动开发）测试用例。

**AI 提示词关键约束**：
- 必须使用 `* [open] 模块 - 场景描述` 作为标题。
- 必须严格使用 **Given-When-Then** 格式。
- 每个 Checklist 粒度要小，必须是**可独立交付、可独立测试的最小业务单元**。

**产出物**：`docs/develop/{git版本}-{需求title}-{需求id}/Checklist.md` 文档（markdown 格式）。

**完成后（人工 Review 门控）**：将 Checklist 落盘到上述目录，向用户汇报路径，并**暂停**请求人工 review；用户确认通过后才进入第二步。

**格式范例**：

```checklist
* [open] SHARE - 资产详情页分享入口（Image/Video/Logo）
>> Given: 用户位于 Creative Hub -> Asset 页面，查看单个素材详情。
>> When: 用户点击素材旁边的 "Share Asset" 交互按钮。
>> Then: 页面跳转至 Share 页面，并自动弹出素材分享创建弹窗，且该素材已被预选。

* [open] SHARE - Asset Detail 页面展示最后一次审核状态
>> Given: 用户位于 Creative Hub -> Asset 页面，查看某个素材的详情，且该素材在任意分享链接中至少存在一条审核记录。
>> When: 页面加载完成。
>> Then: Asset Detail 页面清晰展示该素材的最后一次审核状态（如 Approved、Denied、Processing），其状态与该素材所有分享审核历史中时间最新的那条记录一致。
```

---

## 第二步：开发实现计划与技术方案评估（Plan）

**输入**：第一步的 Checklist + 当前系统的技术栈架构说明（如 Spring Boot + MyBatis-Plus，或 Node.js + NestJS）。

**执行动作**：评估技术可行性，梳理业务逻辑的实现步骤。

**AI 提示词关键约束**：
- **影响面评估**：必须列出这批需求会改动哪些现有模块、公共方法或已有表。
- **技术盲区提示**：必须识别潜在的技术风险（如并发、大数据量、三方 API 超时风险）。

**产出物**：`docs/develop/{git版本}-{需求title}-{需求id}/技术设计与实现方案文档.md`，必须包含：
1. 改动点清单（涉及的模块/类/方法/表）
2. 核心业务伪代码逻辑
3. 潜在风险提示

**完成后（人工 Review 门控）**：将文档落盘到上述目录，向用户汇报路径，并**暂停**请求人工 review；用户确认通过后才进入第三步。

---

## 第三步：数据库设计与 SQL DDL 生成（Data Model）

**输入**：第一步的 Checklist + 第二步的实现计划 + 已有的相关表结构（如有）。

**执行动作**：设计满足业务的数据模型，并生成标准的数据库建表或改表 SQL。

**AI 提示词关键约束**：
- **强制指定规范**：指定数据库（如 MySQL 8.0）和命名规范（如 snake_case 下划线命名）。
- **生产环境必备字段**：每张表必须包含 `id`（主键）、`create_time`、`update_time`、`is_deleted`（逻辑删除）、`version`（乐观锁）。
- **索引优化**：根据 Checklist 中的查询条件（如 `Given: 用户在某个 Group...`），自动在相应字段（如 `group_id`）上创建单列索引或联合索引。

**产出物**：`docs/develop/{git版本}-{需求title}-{需求id}/ddl.sql`，含高质量注释、索引设置。

**完成后（人工 Review 门控）**：将 SQL 脚本落盘到上述目录，向用户汇报路径，并**暂停**请求人工 review；用户确认通过后才进入第四步。

---

## 第四步：接口文档设计（API Design）

**输入**：第一步的 Checklist + 第三步的 DDL 表结构 + 团队的接口标准（如 RESTful 规范）。

**执行动作**：设计前后端交互的契约，确定每一个 HTTP 请求的细节。

**AI 提示词关键约束**：
- 格式必须为标准的 Markdown 或 Swagger/OpenAPI 格式。
- 必须清晰标明每个字段的**类型、是否必填、含义**。
- **状态码规范**：不仅要有成功响应，还必须定义好业务异常时的错误码（如 400 Bad Request 对应的业务错误原因）。

**产出物**：`docs/develop/{git版本}-{需求title}-{需求id}/API接口定义文档.md`。

**完成后（人工 Review 门控）**：将文档落盘到上述目录，向用户汇报路径，并**暂停**请求人工 review；用户确认通过后才进入第五步。

---

## 第五步：测试用例矩阵与验证标准制定（Test Matrix）

**输入**：第一步的 Checklist + 第四步的接口文档。

**执行动作**：在写代码前，制定出严密的验证指标，作为后续编写单元测试的依据（TDD 测试驱动开发思想）。

**AI 提示词关键约束**：
- 每个 Checklist 条目必须拆解出**至少 3 个测试分支**：
  1. 正向主流程
  2. 边界值校验（如数量为 0、字符串超长）
  3. 异常流阻断（如无权限、数据不存在）
- 必须明确写出**断言（Assert）的预期结果**（如：返回状态码 404，且数据库无新增记录）。

**产出物**：`docs/develop/{git版本}-{需求title}-{需求id}/单元测试验证指标矩阵.md`。

**完成后（人工 Review 门控）**：将文档落盘到上述目录，向用户汇报路径，并**暂停**请求人工 review；用户确认通过后才进入第六步。

---

## 第六步：逐条拆解、自动化编码（Coding Only）

**输入**：上述 1~5 步的所有产出物 + 当前要开发的特定代码文件的上下文/模板。

**执行动作**：【核心防错机制】**不要让 AI 一次性写完所有代码**。必须拿着第一步的 Checklist，**一条一条**喂给 AI，逐个击破。

**AI 提示词关键约束**：
- 编码提示词模板："现在请针对 Checklist 中的第 X 条，结合第 3 步的 DDL、第 4 步的接口定义和第 5 步的测试指标，编写业务代码（Controller/Service/Mapper）。"
- **本步只写业务代码，禁止写单元测试**。单元测试统一在第七步 7.1 编写。

**产出物**：符合业务逻辑的**生产代码**（Controller / Service / Mapper / DTO 等，按项目既有源码目录结构放置，如 `micro-api/src/...`）。

**执行节奏**：
1. 用户/AI 指定本轮要实现的 Checklist 条目编号。
2. AI 输出该条目的业务代码（Controller/Service/Mapper）。
3. 重复 1~2，直到所有 Checklist 条目的业务代码全部完成。
4. **条目依赖处理**：若条目间存在依赖（如条目 B 依赖条目 A 产出的 Service/方法），必须**按依赖顺序**处理——先做被依赖的条目，再做依赖方；无法确定顺序时向用户确认。

**完成后（人工 Review 门控）**：向用户汇报已实现的所有业务代码文件清单，并**暂停**请求人工 review；用户确认通过后才进入第七步。

---

## 第七步：编写单元测试、编译与自主微调（Test & Debug & Self-Healing）

> 注意：本步**统一放在最后**做。第六步只写业务代码，本步先统一编写单测，再编译运行+自愈。

**输入**：第六步生成的全部业务代码 + 第五步的《单元测试验证指标矩阵.md》+ IDE 的编译错误信息 + 单测运行失败日志。

**执行动作**（分两个子阶段，每个子阶段完成后均需人工 review 门控）：

**7.1 统一编写单元测试**
- 基于 第五步的《单元测试验证指标矩阵.md》，为第六步产出的**所有**业务代码统一编写单元测试。
- 确保测试矩阵中每个 Checklist 条目的 3 个分支（正向 / 边界 / 异常）**100% 覆盖**。
- Feign 接口按 `.agents/testing.md` 的 Mock 规范处理。
- **单测代码放置位置**：按项目既有测试目录结构，Spring Boot 项目放在对应模块的 `src/test/java/...` 下，测试包路径与被测类包路径一致。
- **完成后（人工 Review 门控）**：汇报单测文件清单，暂停请求人工 review；通过后才进入 7.2。

**7.2 编译、运行单测与自愈**
- 将代码放入真实开发环境编译并运行单测。
- 如果报错，直接将报错日志甩给 AI，按下方提示词约束修复。
- **自愈终止条件**：连续修复 3 轮仍未全部 Pass，则**停止自动修复**，向用户汇报当前错误清单与已尝试的修复方案，请求人工介入；不要无限循环重试。

**AI 提示词关键约束**：
- **不要直接问"为什么报错"**，而是使用提示词："这是刚才那段代码在运行单测时的报错日志 [贴入日志]。请分析是业务代码逻辑问题还是单测 Mock 问题，并给出修复后的完整代码。"

**产出物**：
- 全部 Pass 的单元测试代码
- 完美编译通过的后端业务模块

---

## 第八步：AI Review —— 需求回溯与代码合规审查（AI Review）

> 本步是交付前的**最终质量门禁**。所有代码已通过编译和单测，但编译通过 ≠ 需求全部实现。必须拿第一步的 Checklist 逐条回溯比对，确保交付物与需求零偏差。

**输入**：
- 第一步的《Checklist.md》（需求行为标准）
- 第四步的《API接口定义文档.md》（契约标准）
- 第五步的《单元测试验证指标矩阵.md》（测试覆盖标准）
- 第六步产出的全部业务代码
- 第七步产出的全部单元测试代码

**执行动作**：AI 以独立审查者视角，对全部交付物进行四维审查，并输出格式化审查报告。

**四维审查维度**：

**维度 A：需求回溯（Checklist Backtracking）**
- 将第一步 Checklist 中的**每一条** Given-When-Then，与代码中的对应实现逐一比对。
- 判定每一条状态：`✅ 已实现` / `⚠️ 部分实现` / `❌ 未实现`。
- 对于 `⚠️` 或 `❌` 的条目，必须给出**具体缺失了什么**（如："缺少 When 条件中的 X 过滤逻辑"）。

**维度 B：API 契约合规（API Contract Compliance）**
- 将第四步 API 文档中的每个端点，与 Controller 代码逐一比对。
- 检查项：URL 路径、HTTP Method、请求参数（类型/必填/校验注解）、响应结构（字段名/类型）。
- 发现不一致时标记为 `🔴 Contract Breach` 并说明偏差。

**维度 C：测试覆盖审计（Test Coverage Audit）**
- 将第五步测试矩阵中的每条分支（正向/边界/异常），与第七步的单测代码逐一比对。
- 标记缺失的测试分支，判定 `✅ 已覆盖` / `⚠️ 边界缺失` / `❌ 分支缺失`。

**维度 D：代码质量扫描（Code Quality Scan）**
- **未捕获异常**：是否存在 `throws Exception` 或空 `catch` 块。
- **魔法值**：是否存在硬编码的字面常量（如数字 `3`、字符串 `"active"`）应抽取为常量或枚举。
- **安全风险**：是否存在 SQL 拼接、未鉴权的接口、敏感数据明文传输。
- **事务完整性**：跨表写操作是否标注 `@Transactional`。

**AI 提示词关键约束**：
- 审查必须**逐条、逐端点、逐分支**进行，不得笼统概括。
- 每条发现必须附带**精确的文件行号**（如 `ShareController.java:42`）。
- 禁止在未产生实际缺陷时凭空编造问题。

**产出物**：`docs/develop/{git版本}-{需求title}-{需求id}/AI Review报告.md`，包含：

```markdown
# AI Review 报告

## 📋 审查概要
- 总 Checklist 条目数：X
- ✅ 完全实现：X | ⚠️ 部分实现：X | ❌ 未实现：X
- 🔴 API 契约违规：X
- ❌ 缺失测试分支：X
- 🐛 代码质量缺陷：X
- 整体评估：✅ PASS / ⚠️ CONDITIONAL PASS / ❌ FAIL

## A. 需求回溯表
| # | Checklist 条目 | 状态 | 实现位置 | 缺失说明 |
|---|---------------|------|---------|---------|
| 1 | SHARE - 资产详情页分享入口 | ✅ | ShareController.java:25 | - |
| 2 | SHARE - 详情页审核状态展示 | ⚠️ | AssetServiceImpl.java:88 | 仅实现了 Approve/Deny 状态，未处理 Processing 状态的轮询展示 |
| 3 | ... | ❌ | - | 整个条目未实现 |

## B. API 契约违规
| 端点 | 预期 (API 文档) | 实际 (代码) | 严重程度 |
|------|----------------|------------|---------|
| GET /api/shares | 参数 pageSize=10 | 参数 pageSize 未设默认值 | Minor |
| POST /api/shares | 响应含 shareUrl 字段 | 响应中字段名为 url | 🔴 Critical |

## C. 测试覆盖审计
| Checklist 条目 | 正向流程 | 边界值 | 异常流 |
|---------------|---------|-------|-------|
| 1 - 分享入口 | ✅ | ❌ 未测试空素材列表 | ❌ 未测试无权限用户 |
| 2 - 审核状态 | ✅ | ✅ | ✅ |

## D. 代码质量缺陷
| 文件 | 行号 | 缺陷类型 | 建议 |
|------|------|---------|------|
| ShareController.java | 42 | 魔法值 | 将硬编码的 "active" 抽取为常量 STATUS_ACTIVE |
| AssetService.java | 15 | 事务缺失 | saveShareAndUpdateStatus() 方法缺少 @Transactional |

## E. 审查结论
**评估**：⚠️ CONDITIONAL PASS
**必须修复**：API 契约违规中的 🔴 Critical 项、缺失的 2 个测试分支
**建议修复**：3 处魔法值
**审批**：请在修复后重新审查，或由人工审批跳过 minor 项。
```

**审查终止条件**：
- 若审查结果为 `✅ PASS`，则整个流程结束，交付完成。
- 若审查结果为 `⚠️ CONDITIONAL PASS`，标记必须修复和可选修复项，AI 自动修复后重新执行第八步。
- 若审查结果为 `❌ FAIL`，AI 自动修复所有缺陷后重新执行第八步。
- **循环限制**：重新审查最多 2 轮。若第 2 轮审查仍为 FAIL，则**停止自动修复**，输出完整缺陷清单请求人工介入。

**完成后（人工 Review 门控）**：将 AI Review 报告落盘到 docs 目录，向用户汇报审查结论，并**暂停**请求人工审批最终交付物；用户确认后整个流程正式结束。

---

## 项目上下文适配（针对本仓库）

本仓库为 Spring Boot 微服务架构项目（见 `AGENTS.md`），主要模块：
- **micro-api**：API 接口层
- **micro-model**：数据模型层
- **micro-common-db**：数据库公共层
- **micro-feign**：Feign 客户端层

执行本工作流时应额外遵循：
- 数据库操作遵循 `.agents/database.md`（MyBatis 规范、事务管理）
- API 设计遵循 `.agents/api-design.md`（RESTful 规范、DTO 设计）
- 代码规范遵循 `.agents/code-standards.md`、架构遵循 `.agents/architecture.md`
- 测试规范遵循 `.agents/testing.md`（含 Feign 接口 Mock 规则）
- 分页请求参数应继承 commons 包中的 `BasePageReq`（含 pageIndex/pageSize/sortField/sortOrder/isAsc()）
- 查询用户名时使用 `businessAware.getUserNameByIds(AMAZON, ...)` 调用 admin-meta

## 执行检查清单（AI 自检）

每完成一步，AI 必须自检：
- [ ] 本步产出物是否已落地为文档/代码文件？
- [ ] 文档类产出物是否放在 `docs/develop/{git版本}-{需求title}-{需求id}/` 目录下？
- [ ] 本步是否严格使用了上一步的产出物作为输入？
- [ ] 是否已向用户汇报产出物路径并**暂停等待人工 review 确认**（未获确认不进入下一步）？
- [ ] 第六步是否做到了"逐条 Checklist 编码"且**未编写单测**（单测留到第七步 7.1）？
- [ ] 第七步是否在所有业务代码完成后才统一编写单测，并在 7.2 编译自愈？
- [ ] 第八步是否已执行四维审查，逐条回溯 Checklist，并输出《AI Review 报告》？
- [ ] 第八步审查结论是否为 ✅ PASS 或 ⚠️ CONDITIONAL PASS（且必须修复项已修复）？

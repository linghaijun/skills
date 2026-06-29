# Wiki Templates

Templates for each of the 10 wiki files (excluding API-Reference.md, which has its own guide).

**语言要求：所有文档内容使用中文撰写，仅SQL语句、代码、类名、路径等技术标识保持英文。**

## 1. Home.md

```markdown
# {ProjectName} - 项目Wiki

## 欢迎使用 {ProjectName} 项目Wiki

本Wiki包含项目的完整技术文档，涵盖架构设计、开发规范、部署运维等内容。

## 文档索引

### 项目概览
- [项目概述](Project-Overview.md) - 项目介绍、技术栈、业务背景

### 架构设计
- [系统架构](System-Architecture.md) - 整体架构、模块划分、分层设计
- [模块详解](Module-Details.md) - 各模块职责与依赖关系

### 开发指南
- [开发环境搭建](Development-Setup.md) - 环境要求、本地运行、配置说明
- [API接口文档](API-Reference.md) - RESTful API端点一览
- [数据库设计](Database-Design.md) - 数据模型、MyBatis规范、事务管理

### 规范与流程
- [代码规范](Code-Standards.md) - Java编码规范、注释要求
- [Git工作流](Git-Workflow.md) - 提交规范、分支策略、CI/CD
- [测试规范](Testing-Guide.md) - 单元测试、集成测试、Mock策略

### 运维部署
- [部署指南](Deployment-Guide.md) - 环境配置、部署流程、CI/CD流水线
```

## 2. Project-Overview.md

```markdown
# 项目概述

## 项目简介
{从pom.xml和README提取项目名称、描述、定位}

## 技术栈
| 类别 | 技术 | 版本 |
|------|------|------|
| 语言 | Java | {version} |
| 框架 | Spring Boot | {version} |
| ... | ... | ... |

## 业务背景
### 核心业务场景
{从Controller和Handler代码提取业务场景列表}

## 项目结构
{从pom.xml提取模块列表，简要说明每个模块职责}
```

## 3. System-Architecture.md

```markdown
# 系统架构

## 整体架构
{微服务/单体架构描述，服务间调用关系}

## 分层设计
{Controller → Handler/Manager → Service → Mapper 分层说明}

## 核心设计模式
{策略模式、工厂模式等，从代码中识别}

## 外部依赖
{Eureka、Feign、Redis、MQ、S3等外部服务}
```

## 4. Module-Details.md

```markdown
# 模块详解

{按Maven模块分节，每个模块包含：}
## {ModuleName}
- 职责说明
- 核心类列表
- 依赖关系
- 配置文件
```

## 5. Development-Setup.md

```markdown
# 开发环境搭建

## 环境要求
{JDK版本、Maven版本、数据库版本等}

## 本地运行
{启动命令、配置说明}

## 配置说明
{从application.yml提取关键配置项}
```

## 6. Database-Design.md

```markdown
# 数据库设计

## 数据模型
{按表分节，每表包含：表名、字段列表、索引、关联关系}

## MyBatis使用规范
{从.agents/database.md提取}

## 事务管理
{事务注解使用规范}
```

## 7. Code-Standards.md

```markdown
# 代码规范

{从.agents/code-standards.md提取，包括：}
- Java编码规范
- 注释要求
- 命名规范
- 异常处理
```

## 8. Git-Workflow.md

```markdown
# Git工作流

{从.agents/git-workflow.md提取，包括：}
- 分支命名规范
- 提交信息规范
- Code Review流程
- CI/CD触发规则
```

## 9. Testing-Guide.md

```markdown
# 测试规范

{从.agents/testing.md提取，包括：}
- 单元测试规范
- 集成测试规范
- Mock策略
- 测试覆盖率要求
```

## 10. Deployment-Guide.md

```markdown
# 部署指南

## 环境配置
{开发/测试/生产环境配置差异}

## 部署流程
{从CI/CD配置文件提取部署步骤}

## CI/CD流水线
{从.github/workflows或Jenkinsfile提取}

## 监控与告警
{日志、监控、告警配置}
```

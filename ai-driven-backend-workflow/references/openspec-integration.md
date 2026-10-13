# OpenSpec 整合分析

本工作流**不在运行时调用 openspec skill**，而是把 OpenSpec 的两个模板搬入内嵌使用。其余 OpenSpec 能力仅作为理念对照记录。

## 步骤映射表
| 本工作流 | OpenSpec 对应 | 关系 |
|---|---|---|
| 1 需求澄清 Q&A | `/opsx:explore` | 借鉴理念，不调用 |
| 2 Spec.md | `proposal` 模板 | **已搬入**（Why/What/Capabilities/Impact + 工作流补充章节） |
| 3 Checklist BDD GWT | `specs` Scenario WHEN/THEN | 等价，每条 `* [open]` ≈ 一个 Scenario |
| 4-6 技术方案/DDL/API | `design` artifact | 本工作流拆为 3 份细化产出 |
| 7 测试矩阵 | 无原生对应 | 本工作流特有 |
| 8 任务拆解 | `tasks` 模板 | **已搬入**（`## N.` + `- [ ] N.x`） |
| 9 逐条编码 | `/opsx:apply` | 按 tasks 逐条编码并勾选 `- [x]` |
| 10 单测+编译自愈 | apply 的一部分 | 保留本工作流自愈循环 |
| 11 AI Review | `/opsx:verify` | 保留四维审查 |
| 交付收尾 | `/opsx:sync` + `/opsx:archive` | 可选归档 |

## 已搬入的两个模板

### 1) proposal.md → Step2 Spec.md 骨架
```
## Why
## What Changes
## Capabilities
### New Capabilities - `<name>`: `<desc>`
### Modified Capabilities - `<existing>`: `<changed requirement>`
## Impact
```

### 2) tasks.md → Step8 tasks.md 骨架
```
## 1. <Task Group>
- [ ] 1.1 <Task desc> [P0] [~2h]
- [ ] 1.2 <Task desc> [P1] [~1h]
```
完成跟踪：`- [ ]` 未完成 / `- [x]` 已完成。

### 3)（参考）spec.md capability 模板（Given-When-Then 已覆盖同一语义，不强制改用）
```
## ADDED Requirements
### Requirement: <name>
#### Scenario: <name>
- **WHEN** <condition>
- **THEN** <expected outcome>
```

## 为什么搬入而非运行时调用
- 避免 openspec CLI/skill 运行时依赖，保证自包含、可离线执行
- 模板稳定、体积小，保留结构化优势
- 若未来需要依赖图/归档等重型能力，再按 `/opsx:*` 单独引入

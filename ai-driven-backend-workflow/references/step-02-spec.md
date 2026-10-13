# 第二步：需求规格说明书（Specification Document）

**输入**：问答记录 + 原始 PRD/UI/业务背景

**动作**：整理为结构化无歧义的 SPEC，作为唯一需求真理来源。**采用 OpenSpec proposal 模板**（已内嵌）。

## Spec.md 结构
```markdown
# Spec — {需求title} ({需求id})

## Why
<!-- 动机：解决什么问题？为什么现在做？ -->

## What Changes
<!-- 具体变化：新增/修改/移除，逐条描述 -->

## Capabilities
### New Capabilities
<!-- kebab-case 命名，每个对应第三步 Checklist 一个模块 -->
- `<name>`: `<desc>`

### Modified Capabilities
<!-- 改变的需求层面，无则留空 -->
- `<existing>`: `<changed requirement>`

## Impact
<!-- 高层影响面（代码/API/依赖/系统），非实现细节 -->

## 数据字典
<!-- 字段名、类型、取值范围、业务含义、取值来源 -->

## 非功能需求
<!-- 性能、安全、兼容性等 -->

## 约束与假设
<!-- 未覆盖的边界或暂未决策的事项 -->
```

**约束**：
- 所有章节均须填写。Capabilities 的每个 New Capability 名称将作为第三步 Checklist 的模块归属
- 粒度达"可写 BDD Checklist"级别，阅读后可直接理解"做什么"
- **禁止加入技术实现细节**（表名/API路径/框架）；Impact 只写高层影响面

**产出物**：`.../Step 2-Spec.md`

**→门控**：🟡 **通知式** —— Spec 落盘 → 一句话汇报 → 直接进入 Step3。
Spec 与 Checklist **合并为一道阻塞门控**，在 Step3 一起确认：Checklist 是 Spec 的逐条翻译，两者一起看才判断得出「范围对不对」，分两次看反而只能各看一半。

> 🟡 **通知式门控**：产出物落盘 → 跑 `validate_step.py`（FAIL 必须修到通过）→ **一句话汇报**（路径 + 校验结果 + 本步做的关键决策）→ **不等待，直接进入下一步**。
> 用户随时可提异议；收到异议必须**回退重做本步及其下游**，不得争辩已经过了。
> 之所以不阻塞：本步产出物是文档/任务清单，**改起来几分钟且未产生不可逆后果**；把人的注意力省给真正拦不可逆事项的那几道门。

> 来源：Why/What/Capabilities/Impact 四段搬自 OpenSpec proposal 模板。详见 openspec-integration.md。

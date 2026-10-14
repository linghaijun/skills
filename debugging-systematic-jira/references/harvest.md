# 排障收尾：经验与脚本沉淀

验证 + Jira 备注写完后，**同一轮必须做沉淀**，否则下次又从零摸。

## 一句话判据

> 写进资产前先问：**「下次换个需求 / 换个页面，这条还能直接用吗？」**

| 答案 | 层 | 落点 |
|---|---|---|
| 跨项目、跨页面都还能用 | **L0 技能级** | 见下表「L0」列 |
| 只在本项目某类页面 / 模块还能用 | **L1 项目级** | 见下表「L1」列 |
| 只对当次 AC / 当次票有效 | **L2 一次性** | `.workbuddy/tmp/` 或需求目录；**不沉淀**、不提交 |

## 落点总表

| 沉淀物类型 | L0（技能级） | L1（项目级） | 禁止 |
|---|---|---|---|
| **浏览器操作脚本** | `cdp-drive-real-chrome/scripts/` + 登记 `references/SCRIPTS.md` | `cdp-drive-real-chrome/projects/<项目>/` + 登记该目录 `README.md` | 把项目选择器塞进 L0；把 `_probe-*` 留在 `scripts/` |
| **浏览器坑 / 手法** | CDP `references/SCRIPTS.md` 坑清单（带最后验证日期） | 同项目 `PAGE-NOTES.md`（页面事实 / 口径 / 行高 / 测哪类 Ad Type） | 过期条目不删不改日期硬留着 |
| **页面口径 / 测试数据窗口** | —（项目特有） | `PAGE-NOTES.md` | 凭据、客户明文、一次性业务 id |
| **排障流程教训**（与页面无关） | 本 skill `references/lessons.md`（跨项目仍成立） | 工作区最外层 `AGENTS.md` → Learned（须过准入与 20 条上限，见 AGENTS） | 把表名抹掉就不成立的细节硬塞 AGENTS |
| **后端 / 前端可复现探针** | 极少；通用工具才进对应 skill `scripts/` | 项目 skill 目录或仓内 `docs/tools/`（已有惯例才加） | 把当次临时 SQL / 一次性 Java main 当资产 |

浏览器相关细则以 **`cdp-drive-real-chrome`** 的 `SCRIPTS.md` + `PAGE-NOTES-GUIDE.md` 为准；本文件只定「排障流程里何时触发、分到哪」。

## 收尾检查清单（阶段 5.5，逐项打勾）

1. **列本轮产出**：临时脚本路径、新踩的坑、可复用的操作步骤、口径结论  
2. **分层**：每条标 L0 / L1 / L2  
3. **L0**：升入对应 skill 的 `scripts/` 或 `references/`；改完刷「最后验证」日期；需要时 `distribute-agent-skills`  
4. **L1**：写入 `projects/<项目>/` 脚本或 `PAGE-NOTES.md` / `README.md` 表行；刷日期  
5. **L2**：确认仍在 tmp / 需求目录；**删除**误放进 skill `scripts/` 的 `_probe-*` / `_pick-*` / `_verify-*`  
6. **自检**：`node --check` / `python -m py_compile`（若改了脚本）  
7. **分发**：改了 skill 源目录 → `distribute.py --skill <名> --dry-run` 再正式分发；看 MD5，不看退出码当成功证据  
8. **回复用户**：用两三行写清「沉淀了什么 → 落在哪」，方便下次 `@` 复用

## 升层规则

| 条件 | 动作 |
|---|---|
| 同手法在 **≥2 个需求** 或 **≥2 个页面** 用过 | L2 → L1，或 L1 → L0 |
| 页面改版导致脚本失效 | 改脚本 + 刷「最后验证」；**禁止**默默留着 |
| 发现通用坑写进了 PAGE-NOTES | 抽到 CDP `SCRIPTS.md`，PAGE-NOTES 只留一行链接 |
| 发现项目选择器写进了 L0 | 立刻下沉到 L1 `projects/<项目>/` |

## 反例（禁止）

- 验完就收工，探针堆在 `.workbuddy/tmp/` 当「资产库」去翻  
- 把 `height > 80` 这类**错判**写进笔记却不写正确阈值（正确：ProductSelect 行高 60px）  
- 为沉淀而沉淀：一次性 AC 步骤复制进 README  
- 改完 skill 不分发 → 别的 agent 仍跑旧版（静默失效）

## 本仓库近期正例（对照用）

| 轮次 | L1 | L0 / 笔记 |
|---|---|---|
| CP-58922 dim-switch | `creativehub-drive.mjs` +`pickProduct` / `clickDimensionType`；`creativehub-dim-switch.mjs` | PAGE-NOTES：行高 60px、ADSP REC 才有 Dimension Type；删 `_probe-*` |

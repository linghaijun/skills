# 数据核对（只读 SQL 取证）

> **什么时候读这份**（命中任一即需要）：
> ① AC 的预期含**具体数值 / 条数 / 聚合结果** —— 只比对接口返回**不算验证通过**，接口返回什么就是什么，证明不了这个数是对的；
> ② 🔴 **这条 AC 的结果在库里留了痕**（同步 / 迁移 / 批量写入 / 定时任务 / MQ 消费 / 权限可见性 / 列表计数）—— 实机验证只是**单账号抽样**，证明不了别的账号也对，必须补一次**全量 + 分组**核对（见 §6）。
> 多数 AC 用不到本文件；用不到就别读，省下的上下文留给真正要做的事。
>
> **两种触发方式**：①实机验证逐 AC 闭环时内嵌 —— 抓完 XHR 立刻核库；
> ②独立执行 —— 实机验证被跳过（定时任务、MQ 消费、批处理）但仍需验证落库结果。

> **定位**：接口返回对 ≠ 数据对。XHR 返回 `cost: 1234.56`，只能证明接口这么返回，**不能证明这个数是对的**。本步直连数据库，用**只读 SQL** 把接口返回值与库里的真实数据对账。
>
> **何时做**：①**实机验证逐 AC 闭环时内嵌** —— 凡是 AC 的预期含具体数值/条数/聚合结果，抓完 XHR 立刻核库；②**独立执行** —— 实机验证被跳过（定时任务、MQ 消费、批处理）但仍需验证落库结果时。

## 1. 🔴 只读门禁（强制前置，无例外）

**任何 SQL 在执行前必须先过校验脚本**，退出码非 0 一律不得执行：

```bash
py sql-mcp/check_sql.py "<你要执行的 SQL 原文>"
```

> `sql-mcp/` 不在业务仓内，位置见项目 `AGENTS.md`（本工作区：`IdeaProjects/sql-mcp`，与 `creative-management-all` 平级）。

- 退出码 `0` + 输出 `OK` → 允许执行
- 非 0 + `REFUSED: <原因>` → **禁止执行**，按原因改写 SQL 后重新校验

校验两层：

1. **只读校验** —— 只放行 `SELECT` / `WITH` / `SHOW` / `DESCRIBE` / `EXPLAIN`；拒绝 `INSERT/UPDATE/DELETE/DROP/TRUNCATE/ALTER/CREATE/GRANT` 等；拒绝分号堆叠；先剥注释再判断
2. **大表护栏** —— 见 §3

> ⚠️ **这是防手滑的门禁，不是安全边界**：它用正则匹配 SQL，足够刁钻的语句能绕过。真正的隔离靠只读数据库账号。**即便门禁放行，写操作依然一律禁止。**
>
> 三条路径的门禁覆盖：`sql-mcp/query.py`（**本步默认**）每条 SQL 自动过门禁；MCP 连接侧由 `readonly.py` 代理自动强制；**只有手工执行 SQL（psql / mysql client / 自写脚本）时才需要手动跑 `check_sql.py`**。

## 2. 可用连接（优先用 query.py，MCP 作备选）

🔴 **本步默认用 `sql-mcp/query.py`，不要默认用 MCP 工具。**

理由不是快慢（MCP 单次调用约 200ms，不慢），而是 **context 成本**：MCP 把原始行
全量倒进上下文，`query.py` 在进程内聚合完只回摘要。实测扫 Redis 一个大 keyspace，
MCP `scan_all_keys` 9 分钟未完成，`query.py redis_keys` **1.2 秒**出 4 行聚合结果 ——
差的不是网络，是要不要把几十万条记录序列化进上下文。

```python
from query import ck, mysql, doris, postgres, mssql, redis_keys, compare

r = ck("SELECT profileId, date, sum(cost) c FROM dailycreativereport_all "
       "WHERE profileId IN (123) AND date BETWEEN '2026-09-01' AND '2026-09-30' "
       "GROUP BY profileId, date")
print(r)          # 摘要：行数 + 前 20 行
r.rows            # 全量
r.scalar()        # 第一行第一列，count/sum 常用

print(compare({"cost": 1234.56}, {"cost": r.scalar()}))   # 对账，自动出差异表
```

命令行：`py query.py ck "SELECT ..."` / `py query.py redis-keys "*rematch*"`

| 入口 | 引擎 | 用途 |
|---|---|---|
| `mysql()` | MySQL | 中台主数据 `creative_management` |
| `ck()` | ClickHouse | 中台绩效 `pacvue_cross_platform`（**绩效核对主战场**） |
| `doris()` | Doris | 平台侧数仓（amazon / tiktok / openai 等） |
| `postgres()` | PostgreSQL | prism 等 |
| `mssql('amazon')` / `mssql('walmart')` | SQL Server | 平台侧业务库 |
| `redis_keys()` | Redis | 缓存核对；**按前缀聚合**，不拉全量 key。本项目固定 `db = 8` |

**什么时候才用 MCP 工具**：只查一眼表结构、试跑一条 SQL 这类一次性探索。
**批量 / 聚合 / 多步对账 / 要留可复跑证据的，一律用 `query.py`** —— MCP 调用没法
作为 `script/` 证据提交，脚本天然可以。

`query.py` 自带：自动补 `LIMIT 100`（超限会警告结果可能不完整）、打印只出前 20 行、
每条 SQL 强制过 `check_sql` 门禁（与 MCP 侧同一套规则）。

平台 → 库名对应见 `sql-mcp/PLATFORM-DATA-MAP.md`。**生产库允许只读核对（用户 2026-10-14 确认），禁止任何写操作；禁止查与本次 AC 无关的数据。** 本地 / dev / test 后端与 mysql MCP 是同一个生产 US 库，本地操作产生的数据也在里面。

🔴 **并发上限：重查询同时 ≤2**（`browser-verification-playbook.md` 的「最关键的红线」第 13 条 / `step-10` §10.5 /
`subagent-acceleration.md` 都引用了本条，口径以本文件为准）—— 共享的查询服务（`query.py` / MCP）被慢查询占满时
**所有会话一起卡住**。
按 AC 组并行对账时：先把每组 SQL 写好，再**两两并发**跑；明细查询一律带 `LIMIT`，绩效 / CK 类必须带
`profileId` + 有界日期（见 §3）。

## 3. 🔴 绩效查询硬约束（必须带 profileId + 日期）

绩效 report 类表（`dailycreativereport_all`、`asset_creative_mapping_all`、`dayreport*`、`day_report*`、`campaigntagcampaign_all`、`tagperformance*`）**数据量极大**，不带过滤的查询会全表扫描，拖垮 CK / Doris。

**强制要求**，缺任一项校验脚本直接拒绝：

1. **profile 维度**：`profileId`（或 DSP 的 `advertiserId`）
   🔴 DSP 的请求/响应里叫 `profileId` 的字段实际装的是 `advertiserId`，`productLine = 'dsp'` 时必须按 `advertiserId` 过滤（见项目 AGENTS.md）
2. **日期范围**：`date` / `reportDate` / `statDate` 等，且是**有界区间**（`BETWEEN` 或 `>= AND <=`），禁止开口查询

```sql
-- ✅ 允许
SELECT profileId, date, sum(cost) AS cost, sum(impressions) AS imp
FROM dailycreativereport_all
WHERE profileId IN (123, 456)
  AND date BETWEEN '2026-09-01' AND '2026-09-30'
  AND productLine = 'amazon'
GROUP BY profileId, date

-- ❌ 拒绝：缺 profileId，全表扫
SELECT sum(cost) FROM dailycreativereport_all WHERE productLine = 'amazon'

-- ❌ 拒绝：缺日期范围
SELECT sum(cost) FROM dailycreativereport_all WHERE profileId = 123
```

**另外三条**（校验脚本管不了，靠自觉）：

- 明细查询一律带 `LIMIT`（建议 ≤ 100）
- 回归基线**不要用当月数据** —— 当月还在变，隔天复跑对不上。用已冻结的历史整月固定窗口，并把**查询原文存进证据目录**
- CK 上先 `EXPLAIN ESTIMATE` 评估扫描量，再跑正式查询

## 4. 查询必须从现有 SQL 逻辑推导（零臆测）

> 对应核心原则 3（零臆测）与 13（数据核对）。**禁止**凭字段名自己编一条 SQL 就当基准 —— 编错了会把「接口对的」判成错，或把「接口错的」判成对。

🔴 **查平台侧数据前，必须先读两处查询逻辑，否则极易查错表**：

| 数据在哪 | 先读哪里 |
|---|---|
| 中台自己的库（MySQL `creative_management` / CK `pacvue_cross_platform`） | `creative-management` 的 `*CkMapper.xml` / `*Mapper.xml` |
| **平台侧库**（Doris / SQL Server 上的 amazon、walmart、tiktok、dsp…） | **`platform-provider/{platform}-provider` 的 mapper 与 `CreativeManagementEndpoint`** —— 中台是通过 Feign 调 provider 取这些数据的，provider 的 SQL 才是真实口径 |

**为什么**：同名表在不同库里各有一份（如 Doris 和 SQL Server 上都有 `instacart_pacvue`）；同一平台的数据在中台是宽表 + `productLine` 列，在 provider 侧是独立库独立表，**结构和口径都不一样**。不先读 provider 的查询逻辑就按表名猜，查出来的数跟接口对不上，会把自己查错当成 bug 报上去。平台 → 库名对应见 `sql-mcp/PLATFORM-DATA-MAP.md`。

1. **找到接口实际走的 mapper**：`Grep` 定位本次 AC 对应的 `<select id="...">`（中台 `*CkMapper.xml` / `*Mapper.xml`；涉及平台数据时**同时**定位 `{platform}-provider` 侧的 mapper），标注 `证据：<file>:<line>`
2. **照抄它的 `FROM` / `JOIN` / `WHERE` / `GROUP BY`**，只把动态参数换成本次验证的具体值（profileId、日期、productLine）
3. **保留权限过滤片段** —— 如 `caPlatformProfileFilter`。漏掉它查出来的数会比接口多，看起来像 bug，实际是自己查错了
4. **核对口径差异**：接口可能做了环比 / 汇率换算 / 单位转换（见 `PerformanceCompareRatios`），SQL 侧要么同样处理，要么在结论里写明差异来源

## 5. 口径对齐（比数之前强制做，否则白比）

> 🔴 两个数对不上时，**十次有八次是口径不同，不是代码有 bug**。人的本能是先怀疑代码，查半天才发现自己查的范围跟接口压根不是一回事。**这张表填完才允许开始比数。**

| 口径项 | 要确认什么 | 不对齐的后果 |
|---|---|---|
| **时区** | 库里存的是 UTC 还是本地时？接口按什么时区切天（项目常用 PST）？ | 整体差一天，最容易误判成 bug |
| **区间边界** | `BETWEEN` 含两端；接口是不是左闭右开 / 按自然日切？ | 差一天的量 |
| **去重** | 接口是否按 creativeId / assetId 去重？SQL 有没有同样去重 | 聚合值偏大 |
| **币种与单位** | 接口是否做了汇率换算？查的是原币还是美元？金额有没有除以 100 | 数量级对但值不对 |
| **权限过滤** | `caPlatformProfileFilter` 这类片段有没有带上 | 查出来比接口多 |
| **软删除 / 状态** | 有没有 `is_deleted` / `status` / `archived` 过滤 | 查出来比接口多 |
| **聚合层级** | 接口给的是 ad 层还是 campaign 层？有没有中间行 / 父子累加 | 结构性偏差 |

填法：逐项写「接口侧口径 / SQL 侧口径 / 是否一致」，写进 `RESULT.md` 的数据核对节。
**差异能对上其中一项 → ⚠️ 并写明来源；一项都对不上 → 才是真缺陷。**

## 6. 🔴 覆盖面：实机验证只验了**一个**账号

> 这一节解决的不是「数对不对」，是「**你验的那一个，代表得了全部吗**」。

实机验证本质是**单账号抽样**：你登录哪个账号，就只看得见那个账号的数据。
它能证明「这个账号是对的」，证明不了「所有账号都是对的」。
典型翻车：同步只同步了当前租户；某些账号的 `profileId` / `visibleUserIds` 没注入；
边界账号（零数据 / 超大数据量 / 跨平台 / 新建未初始化）走到了另一条分支。
**这些在浏览器里全是绿的**，因为你没登那些账号。

🔴 **触发条件（比「预期含具体数值」更宽）**：**只要这条 AC 的结果在库里留了痕，就要补一次 SQL 全量核对。**
高发场景：**数据同步 / 迁移 / 批量写入 / 定时任务 / MQ 消费 / 权限可见性 / 列表计数**。

### 要核的五件事

| # | 核什么 | 怎么核 | 漏掉会怎样 |
|---|---|---|---|
| 1 | **数量对得上** | 源 `count` vs 目标 `count` | 少同步了一批没人发现 |
| 2 | **有没有漏** | 源 `LEFT JOIN` 目标，取目标侧为 `NULL` 的 | 个别账号整批没进来 |
| 3 | **有没有多 / 重复** | 目标 `LEFT JOIN` 源；唯一键 `GROUP BY ... HAVING count(*) > 1` | 重跑一次就翻倍 |
| 4 | **有没有串户** | 目标每条的归属账号 vs 源的归属账号，逐条比 | **最严重**：A 客户看到 B 客户的数据 |
| 5 | **关键字段值一致** | 不只是条数，抽几个业务字段逐值比 | 条数对上了，内容是错的 |

### 🔴 分组对账 > 总数对账

**总数相等不等于每个账号都对** —— A 账号多 3 条、B 账号少 3 条，总数照样相等。

```sql
-- 不要只这样
SELECT count(*) FROM src;  SELECT count(*) FROM dst;

-- 要这样：按账号/租户/平台分组再比，并把差异行直接捞出来
SELECT COALESCE(s.tenant_id, d.tenant_id) AS tenant_id,
       s.cnt AS src_cnt, d.cnt AS dst_cnt, COALESCE(s.cnt,0) - COALESCE(d.cnt,0) AS diff
FROM      (SELECT tenant_id, count(*) cnt FROM src GROUP BY tenant_id) s
FULL JOIN (SELECT tenant_id, count(*) cnt FROM dst GROUP BY tenant_id) d
       ON s.tenant_id = d.tenant_id
WHERE COALESCE(s.cnt,0) <> COALESCE(d.cnt,0);
```

分组维度按业务选：**账号 / 租户 / profile / 平台 / 日期**。哪一维可能走不同分支，就按哪一维分组。
**查询范围遵守 §3 的硬约束**（绩效类必须带 `profileId` + 日期），别为了"看全量"把护栏拆了。

### 闭环与声明

- 🔴 **实机验证用的那个账号，必须能在 SQL 结果里定位到** —— 两边对得上，这条 AC 才算闭环；
  对不上说明你们查的根本不是同一批数据（环境不同 / 租户不同 / 时间窗不同）
- 🔴 **在 `RESULT.md` 写明覆盖面**，不许含糊：
  `浏览器验证账号：<登录名>（1 个） | SQL 覆盖：<N> 个账号 / <M> 条 | 差异账号：<列出或"无">`
- 分组对账查出**任何差异账号**，即便浏览器那个账号是好的，这条 AC **也不得判通过** ——
  按 §8 逐层二分定位到具体是哪一层出的问题

## 7. 取证与落盘

**随走随落，不事后补**（同 实机验证的逐 AC 闭环 一 AC 一闭环）。每条涉及数据核对的 AC，在 `tests/AC-NN/evidence/` 下落两个文件：

| 文件 | 内容 |
|---|---|
| `{AC-NN}-db-query.sql` | SQL **原文**（含实际参数值）；顶部注释写明连接名、mapper 来源 `<file>:<line>`、`check_sql.py` 已校验通过 |
| `{AC-NN}-db-result.txt` | 查询返回的原始结果（行数多则截断并注明截断） |

在 `tests/AC-NN/RESULT.md` 增加一节：

```
### 数据核对
| 指标 | 接口返回(XHR) | 库中实际(SQL) | 差异 | 结论 |
|------|--------------|--------------|------|------|
| cost | 1234.56      | 1234.56      | 0    | ✅   |
| imp  | 10000        | 10240        | -240 | ❌   |

连接: clickhouse | 窗口: 2026-09-01 ~ 2026-09-30 | profileId: 123,456
SQL 来源: CreativePerformanceCkMapper.xml:88 | 门禁: check_sql.py OK
```

**判定**：

- 完全一致 → ✅
- 有差异但能用口径解释（汇率 / 环比 / 时区 / 去重）→ ⚠️，**必须写明差异来源**，禁止「应该是精度问题」这类含糊结论
- 差异无法解释 → ❌ 走 §8 定位到具体层再记缺陷；**禁止改 SQL 让它对上**

## 8. 对不上怎么定位（逐层二分）

> 口径已对齐但数还是不一致时，**先定位数字是从哪一层开始错的**，再谈修。直接扎进 SQL 里改是最慢的路。

```
XHR 响应  →  接口入参  →  MyBatis 实际执行的 SQL  →  库里原始数据
   ①            ②                ③                      ④
```

| 现象 | 结论 |
|---|---|
| ① ≠ ③ 的结果 | Java 侧问题：聚合、环比（`PerformanceCompareRatios`）、汇率换算、单位转换 |
| ③ ≠ 你照抄的 SQL | **你抄错了** —— 动态 SQL 的 `<if>` 分支没按预期走到 |
| ③ ≈ ④ 但业务上就是不对 | SQL 逻辑本身错，这才是真 bug |
| ② 不是你以为的值 | 调用方传参 / 默认值 / 权限注入的 profile 与预期不符 |

🔴 **第 ③ 层最值钱，也最常被跳过**：MyBatis 动态 SQL 拼出来的语句和你人肉照抄的经常不是一回事（`<if test>` 条件、`<foreach>` 展开、`<where>` 自动去 AND）。
**开 mapper 的 SQL 日志，拿真正执行的那条语句**——比照抄准得多，而且一眼能看出哪个 `<if>` 分支没走到。把这条实际 SQL 一并存进 `evidence/{AC-NN}-db-query.sql`，注明「来源：运行日志」还是「来源：人工照抄 mapper」。

**三条提效习惯**：

1. **先 `count(*)` 再 `sum()`** —— 条数就对不上，比金额没意义；而且能立刻区分是「漏数据」还是「算错了」
2. **先单点再聚合** —— 先锁定一个 profileId + 一天对齐，再放大到整月。一上来就比一个月的聚合值，对不上时无从下手
3. **记快照时间** —— 数据在变，`RESULT.md` 写明「查询于 YYYY-MM-DD HH:mm」，否则隔天复跑对不上又得从头查一遍

## 9. 禁止事项

- ❌ 跳过 `check_sql.py` 直接执行 SQL
- ❌ 任何写操作（含「只是改一条测试数据」）
- ❌ 绩效表不带 profileId / advertiserId + 日期范围
- ❌ 在生产库上做任何写操作，或不带过滤条件扫大表（**只读核对允许**，用户 2026-10-14 确认；mysql MCP 连的就是生产 US，代理只读、SELECT 自动 15s 超时）
- ❌ 把真实客户数据（品牌名 / ASIN / 金额明细）原样贴进报告 —— 脱敏或只留聚合值
- ❌ 自己编 SQL 当基准，不去对照 mapper
- ❌ 查平台侧数据前没读 `platform-provider` 的查询逻辑就按表名猜（同名表在不同库各有一份，查错表比查不到更糟）

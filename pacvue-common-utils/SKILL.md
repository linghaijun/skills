---
name: pacvue-common-utils
description: >-
  Pacvue 前端公共方法速查（架构组公共层，禁止重复造轮子）。写任何通用逻辑前必查本表。
  涉及：工具函数、utils、helper、公共方法、格式化、金额、货币、千分位、百分比、汇率、ROAS、预算、指标格式化、
  日期、时间、时区、PST、周起始、日期范围、深拷贝、去重、数组比较、对象比较、UUID、加解密、下载、导出、
  防抖、节流、事件总线、mitt、URL 参数、query 读写、路由跳转、token、登录态、权限判断、权限指令、
  本地存储、缓存、localforage、localStorage、hooks、composable、useXxx、用户信息、
  store、pinia、useAppStore、useUserStore、axios、请求封装、request、接口调用、
  DOM 操作、监听尺寸、滚动容器、点击外部、表单校验、输入校验、菜单树、筛选查询构造、
  国际化、i18n、翻译、多语言、文案、$t、amskey、语言切换等场景时使用。
---

# Pacvue 公共方法优先原则（防造轮子）

> 数据来源：扫描 amazon-v3-web / walmart-v3-web / vuen-crossretail 三个项目（2026-07），三者公共层结构一致。

## 原则（强制）

1. **写任何通用工具函数（格式化、日期、深拷贝、去重、下载、UUID、校验等）前，必须先查本速查表。**
2. 命中 → 直接 import 公共方法，禁止手写等价实现。
3. 未命中 → 先按文末兜底流程搜近似方法，确实没有才允许新写，且**必须在回答中注明"公共库未覆盖，此为新增"**。
4. 禁止在业务代码中手写以下轮子：金额/百分比/千分位格式化、日期解析与时区转换、深拷贝、数组去重、UUID、文件下载、URL query 编解码、事件总线、点击外部指令、axios 实例、权限散装判断、`useI18n()`。

## 公共层地图（按优先级）

| 优先级 | 层 | 物理路径 | import 方式 |
|--------|----|---------|------------|
| ⭐ 1 | `@pacvue/utils` 公共包 | `packages/utils/src/` | `import commonJS, { pacvueToken, useProIndex, NUM_REG } from "@pacvue/utils"` |
| ⭐ 1 | `@pacvue/frame` 框架包（请求/i18n/websocket） | 外部依赖（不在业务仓库内） | `import request from "@pacvue/frame/request"` |
| 2 | 项目内公共工具 | `packages/main/src/utils/` | `import { xxx } from "@/utils/common-util"` 等按文件直引 |
| 2 | 公共 store | `packages/stores/store/` | `import { useAppStore, useUserStore } from "@pacvue/store"` |
| 2 | 权限包 | `packages/permission/`（文件在包根） | `import { useValidation } from "@pacvue/permission/hooks"` |
| 3 | 新写工具函数 | — | 仅当上述均无，且注明理由 |

> 关键坑位：`@pacvue/utils` 的方法统一通过默认对象调用 `commonJS.formatMoney(...)`（入口只具名导出 `commonJS / pacvueToken / datadogRule / NUM_REG / NUM_E_REG / useProIndex`）；`packages/main` 包名三仓库均为 `@pacvue/amazon`，`@` 别名 = `main/src`；hooks 无独立目录，`use*` 系列分散在 `@/utils/common-util` 等文件中。

## 详细速查表（按需读取 references/）

| 文件 | 内容 | 什么时候读 |
|------|------|-----------|
| [references/utils-pacvue.md](references/utils-pacvue.md) | `@pacvue/utils` 约 70 个方法：数值/金额/指标格式化、日期时区、数组对象、市场映射、query/UUID/加解密/下载、token、常量 | 涉及格式化、日期、通用数据处理时 |
| [references/utils-project.md](references/utils-project.md) | `@/utils/*` 项目内工具：common-util 45+ 方法与全部 hooks、use/url/timer/tree/dom/table-util/validate-util/localforage/PacvueQueryUtil 等 15 个文件 | 涉及 hooks、下载导出、菜单树、DOM、筛选查询构造时 |
| [references/store-permission-request.md](references/store-permission-request.md) | `@pacvue/store`（useUserStore/useAppStore 全部 state/getter/action、业务 store 注册姿势）、权限模型与判断入口、`@pacvue/permission` 包、`@pacvue/frame/request` 请求封装 | 涉及全局状态、权限控制、发请求时 |
| [references/i18n.md](references/i18n.md) | 国际化：全局 `$t` 机制、翻译文件 subtree 结构、缺翻译排查、i18n Ally | 涉及文案、翻译、多语言时 |

## 中文关键词 → 方法名（先查这里消歧义，详情进对应 reference）

| 你想做的事 | 用这个 | 详情 |
|-----------|-------|------|
| 金额/千分位/百分比/汇率/ROAS 格式化 | `commonJS.formatMoney / toThousands / formatPercent / formatData` 等 | utils-pacvue |
| 表格指标列格式化（spend、acos、roas…） | `useProIndex` / `commonJS.getPacvueFormatProIndex` / `pacvueProIndexRender` | utils-pacvue |
| 保留小数位（含科学计数法） | `commonJS.PacvueKeepDigit / PacvueFixedDigit` | utils-pacvue |
| 日期解析/格式化/时区/PST/周起始 | `commonJS.parseDate / formatDate / getPSTdate / PacvueGetWeekStartSun` | utils-pacvue |
| 月/周/季度区间计算 | `getMonth / getWeek / getQuarter`（`@/utils/timer`） | utils-project |
| 深拷贝 / 数组去重 / 深比较 / 多属性排序 | `commonJS.copyJSON / uniq / valueEquals`、`equalJSON`、`PacvueArrayMultiPropSort` | 两层都有 |
| 生成 UUID / 加解密 | `commonJS.PacvueUUid / encrypt / decrypt` | utils-pacvue |
| 文件下载 / 表格导出字段 | `commonJS.DownLoad`、`PacvueDownload`、`PacvueGetExportFields` | 两层都有 |
| 按市场取币种/日期格式/Bid 预算上下限 | `commonJS.marketCode / marketDateFormat / getMarketMinandMaxBid` | utils-pacvue |
| 输入框数字校验 / 表单校验 | `commonJS.inputDetection`、`useFormatInput`、`useValidate` | 两层都有 |
| URL query 编解码 / 页面 query 读写 | `encodeURIQuery`、`getQuery / setQuery`、`commonJS.PacvueGetPageQuery` | 两层都有 |
| 路由跳转封装 | `goUrl`（`@/utils/common-util` 优先） | utils-project |
| 事件总线 / 点击外部 / DOM 工具 / 监听尺寸 | `useBus`、`clickoutside` 指令、`@/utils/dom`、`watchElResize` | utils-project |
| 取用户信息 | `useUserInfo`（`@/utils/common-util`） | utils-project |
| 权限判断（代码里） | `usePacvuePermission`（Edit/Read）/ `PacvueHasPermission`（拦截+弹窗）/ `usePermission` / `hasMenuPermissions` | store-permission-request |
| 权限控制（模板里隐藏按钮） | `v-pacvuePermission="userRole"` 指令（值为 Read 时隐藏，已全局安装） | store-permission-request |
| 按 menuAlias 读权限类型（0/1/2） | `commonJS.getPermission(menuAlias)` | store-permission-request |
| token 读写 | `pacvueToken.getTokens()` 等 6 个 | utils-pacvue |
| 本地存储 hook / localforage / 筛选缓存 | `useLocalStore / usePacvueLocalStore`、`usePacvueLocalforage`、`usePacvueCommonCache` | utils-project |
| 全局日期区间/对比时间/顶栏账号 | `useAppStore()` 的 `dateRange / compareTime / chooseAccounts`（禁止页面自存） | store-permission-request |
| 判断 Demo / Admin 账号 | `useUserStore()` 的 `isDemo / isAdmin` getter | store-permission-request |
| 新建业务 store | `useStoreModule` 注册进 `@/store/modules/index.js`，禁止页面内散落 `defineStore` | store-permission-request |
| 发请求 | `request({ url, method, data })`（`@pacvue/frame/request`，禁止自建 axios） | store-permission-request |
| 菜单树处理 / 筛选条件转后端 filter | `flatTree / findMenuPath`（`@/utils/tree`）、`PacvueFilterAdd`（`@/utils/PacvueQueryUtil`） | utils-project |
| 涨跌色 / 颜色透明度 / 国旗图标 | `commonJS.colorclass`、`rgbWithOpacity`、`commonJS.countryFlagSrc` | 两层都有 |
| 转驼峰 / 首字母大写 / 异步弹窗 / 更多操作 / 面包屑 | `PacvueStrHump / strCapitalize / usePacvueAsyncDialog / createMoreActionItem / usePacvueCustomBread` | utils-project |
| 国际化文案 | 全局 `$t("key")` 裸用（禁止 `useI18n()`）；数组批量翻译 `commonJS.PacvueTranslateT` | i18n |
| 查翻译 key ↔ 文案（单条） | 用 `i18n-lookup` skill（lokalise） | i18n |
| 审查整页/整模块国际化覆盖、要待国际化清单 | 用 `pacvue-i18n-audit` skill（两层核查） | i18n |

## 平台差异标注

- 三个项目的 `@pacvue/utils`、`@pacvue/store`、`@pacvue/permission`、`@/utils/common-util` 核心方法**一致**，可放心跨平台使用。
- 平台特有（只在对应仓库用）：walmart `PacvueWalmartJudgeState`；amazon `dspCommon` / `AdCommonUtil`；crossretail `PacvueGetProIndexOrderBy`。
- 已知拼写即事实：`contants.js`（非 constants）、`datadogRlue.js`（非 Rule）、`PacuveGetNumSplitChar`（非 Pacvue）——引用时保持原样。

## 兜底：表中未命中时

1. 全文搜索定义文件：`packages/utils/src/common.js`、`packages/main/src/utils/common-util.js`（关键词换英文近义词再搜一次）。
2. 搜同类业务页面的写法：`grep -r "关键词" packages/main/src/views/` 看现有页面怎么调。
3. 确认没有 → 允许新写，落点规则：跨页面通用放 `@/utils/`，单页面私有放页面目录内；回答中注明"公共库未覆盖，新增于 xxx"。

## 更新策略（速查表如何保持与源码同步）

本 skill 是源码快照（首次生成 2026-07，上次同步 2026-07-10），公共库演进后需要同步。

**漂移检测**（确定性，随时可跑）：

```bash
node scripts/check-common-utils-drift.mjs                      # 默认对照 ../amazon-v3-web
node scripts/check-common-utils-drift.mjs D:/pacvue/walmart-v3-web
```

脚本对比源码实际导出与 references 表格，输出「源码有、文档未收录」清单；无漂移退出码 0，有漂移退出码 2。

**同步流程**（用户说「同步公共方法」「更新公共方法速查表」「sync common utils」时执行）：

1. 跑漂移检测脚本，拿到缺失导出清单。
2. 对每个缺失项 grep 源码定义处，读函数签名 + 注释推断一句话用途（推断不出就标"用途待确认"）。
3. 追加进对应 references 文件（common.js → `utils-pacvue.md`，common-util → `utils-project.md`），新方法涉及新场景时同步在 SKILL.md 关键词表加行。
4. 更新本节的"上次同步"日期；再跑一次脚本确认退出码 0。

**触发时机**：架构组发公共库更新通知后；或任一业务仓库大版本合并后顺手跑一次。store / permission / i18n 的结构性变化（新增 store、权限模型调整）不在脚本覆盖范围，需人工重扫对应源文件。

## 回答规范

- 用户问"怎么格式化金额/日期/xxx"时：**先给公共方法用法**（import + 一行调用示例），不要给手写实现。
- 生成页面/组件代码时：涉及上表能力的一律用公共方法，代码中出现手写 `new Date` 格式化、手写千分位正则、手写深拷贝等均视为违规。
- 与 `pacvue-v3-component-docs`（组件层防造轮子）配合使用：UI 找组件库，逻辑找本表。

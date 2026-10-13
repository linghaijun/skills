# 速查表 1：`@pacvue/utils`（跨项目公共包）

用法：`import commonJS from "@pacvue/utils"` → `commonJS.xxx(...)`。定义文件 `packages/utils/src/common.js`。

> 入口只具名导出 `commonJS / pacvueToken / datadogRule / NUM_REG / NUM_E_REG / useProIndex`；common.js 内的方法统一通过默认对象调用。

## 数值 / 金额 / 指标格式化

| 方法 | 用途 |
|------|------|
| `formatMoney` / `formatMoney1` | 通用金额格式化（auto 模式、超百万缩 M） |
| `formatSalesMoney` / `formatSpendsMoney` | 销售额 / 花费金额格式化 |
| `formatMoneyRoas` | ROAS 数值格式化 |
| `formatdailyBudget` | 日预算金额格式化 |
| `toThousands` / `toThousandsx` | 千分位格式化（带货币符号 / 支持定点位数） |
| `formatPercent` / `formatPercent1` / `formatPercent2` / `formatPercent100` / `formatPercentOther100` / `formatPercentToe` | 百分比格式化各变体（是否 ×100、按字段、对比行） |
| `formatData` / `formatFullData` | 通用数值格式化（多模式）/ 完整展示不缩写 |
| `formatCustomData` / `formatCustomFullData` | 自定义指标数值格式化 |
| `formatExchangeRate` | 汇率格式化 |
| `PacvueKeepDigit` / `PacvueFixedDigit` | 保留小数位（支持科学计数法）/ 按币种定点 |
| `PacuveGetNumSplitChar` | 取数字千分位/小数分隔符（按币种，注意拼写 Pacuve） |
| `getPacvueFormatProIndex` / `pacvueProIndexRender` / `getProIndexCompareState` / `proIndexConfig` | 指标（ProIndex）格式化 / 渲染 / 对比涨跌态 / 字段分组配置 |
| `useProIndex`（具名导出） | 指标格式化引擎工厂——全站表格指标列统一格式化中枢，`import { useProIndex } from "@pacvue/utils"` |

## 日期 / 时区

| 方法 | 用途 |
|------|------|
| `parseDate` | 日期解析（时区/字符串/偏移处理） |
| `formatDate` | 日期格式化（按 type） |
| `getPSTdate` / `getTimeByZoon` | 取 PST 日期 / 按时区取当前时间 |
| `PacvueTransfromDate` | 日期跨市场/格式转换 |
| `marketDateFormat` | 按市场返回日期格式 |
| `PacvueGetWeekStartSun` / `getStartDateOfYearFirstWeek` | 周日起始的周开始日 / 年度第一周起始日 |
| `formatShareDateRange` | 分享页日期区间格式化 |
| `getHourAb` | 小时归一化（≥24 归 0） |

## 数组 / 对象 / 字符串

| 方法 | 用途 |
|------|------|
| `copyJSON` | JSON 深拷贝 |
| `uniq` / `uniqTextarea` | 数组去重 / 文本域内容去重 |
| `equalArr` / `valueEquals` | 数组相等 / 深度值相等比较 |
| `getArrayAttrs` / `pickData` | 提取数组对象属性 / 按字段取值 |
| `PacvueTranslateT` | 数组批量 i18n 翻译 |

## 市场 / 业务映射

| 方法 | 用途 |
|------|------|
| `marketCode` / `marketCodeBudget` / `marketAddress` | 站点/城市 → 市场货币代码 / 预算币种 / 地址 |
| `getMarketMinandMaxBid` / `getMarketMinandMaxBudget` | 按市场取 Bid / 预算上下限 |
| `countryFlagSrc` | 国家代码 → 国旗图标地址 |
| `colorclass` / `colorclass1` / `dataISminus` | 涨跌值 → 颜色 class / 负数判断 |

## 页面 / 路由 / 其他

| 方法 | 用途 |
|------|------|
| `PacvueGetPageQuery` / `PacvueSetPageQuery` / `setQuery` | 页面 query 读写（支持压缩） |
| `goUrl` | 路由跳转封装（path/query/存储方式） |
| `PacvueUUid` | 生成 UUID（默认 21 位） |
| `encrypt` / `decrypt` | AES 加解密 |
| `DownLoad` | Blob 文件下载（处理 json 错误） |
| `inputDetection` | 输入框数字校验（最大值、小数位） |
| `usePacvueValidation` | 异步表单校验（多 formRef） |
| `getPermission` / `getUserId` | 按 key 读权限 / 取用户 id |
| `getColumns` | 从缓存/菜单读表格列配置 |
| `PacvueGetMainBodyScroller` / `PacvueMainBodyScrollTop` | 取主体滚动容器 / 滚动到指定位置 |
| `getCalendarContainer` / `replaceOldImage` | 日历挂载容器 / 旧图片地址替换 |

## token（`import { pacvueToken } from "@pacvue/utils"`）

`setPacvue_token` / `getPacvue_token` / `getTokens`（取 access_token）/ `getRefresh_token` / `getExpires_in` / `removePacvue_token`

## 其他

`c`（短工具函数，空值兜底处理，用途待确认——漂移检测收录）

## 常量

`NUM_REG` / `NUM_E_REG`（数字/科学计数法正则），`import { NUM_REG } from "@pacvue/utils"`

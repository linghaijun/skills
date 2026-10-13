# 速查表 2：项目内公共工具（`packages/main/src/utils/`，别名 `@/utils/*`）

无聚合 index，按文件直引。最高频：`@/utils/common-util`（amazon 仓库 586 处引用）。

## `@/utils/common-util`（主力工具 + hooks）

| 导出 | 用途 |
|------|------|
| `usePermission` / `PacvueHasPermission` / `hasMenuPermissions` / `PacvueWithPermission` | 权限 hook / 权限判断 / 菜单权限 / 按菜单别名权限包装 |
| `useUserInfo` | 用户信息 hook |
| `useLocalStore` / `usePacvueLocalStore` / `usePageTempParamsStore` | 本地存储 / 页面临时参数 hook |
| `useFormatInput` | 输入格式化 hook |
| `usePacvueCustomBread` | 自定义面包屑 hook |
| `usePacvueAsyncDialog` | 异步弹窗 hook |
| `getQuery` / `setQuery` | URL query 读写 |
| `goUrl` | 路由跳转封装（项目内优先用这个） |
| `getMoneyCode` / `getDynamicMoneyCode` | 按市场取币种代码 |
| `PacvueSetDateRange` / `PacvueGetDateRangeByTime` / `getWeekStartSun` / `PacvueGetMaxDateTime` | 日期区间设置 / 按维度算区间 / 周起始 / 最大可选日期 |
| `PacvueFormatDate` / `formatTimeZone` | 日期格式化 / 时区格式化 |
| `equalJSON` / `copyJSON` | JSON 深比较 / 深拷贝 |
| `PacvueKeepDigit` / `getProIndexCompareState` | 保留小数位 / 指标对比状态 |
| `rgbWithOpacity` | 颜色加透明度 |
| `watchElResize` | 监听元素尺寸变化 |
| `startLongCommunication` | 长轮询/长连接通信 |
| `createMoreActionItem` | 生成"更多操作"菜单项 |
| `yLabelFormatter` | 图表 Y 轴标签格式化 |
| `PacvueGetPathInfo` / `PacvueGetHost` / `ParseUrlParams` | 路径解析 / 取 host / 解析 URL 参数 |
| `strCapitalize` / `PacvueStrHump` | 首字母大写 / 转驼峰 |
| `PacvueDownload` / `formSubmitWithToken` | 通用下载 / 带 token 表单提交（下载导出） |
| `PacvueArrayMultiPropSort` | 数组多属性排序 |
| `PacvueTagListFormat` / `PacvueRequestTagFormat` | Tag 列表 / 请求 Tag 参数格式化 |
| `PacvueCreateFilterStoreKey` | 生成筛选器存储 key（注意 userid 前缀规范） |
| `jumpToRetailDashboard` / `PacvueGetSupportInfo` | 跳转 Retail Dashboard / 取客服支持信息 |

### `@/utils/common-util` 补充导出（漂移同步 2026-07-10）

| 导出 | 用途 |
|------|------|
| `requestData` | 带缓存 key / 自动取消（AbortController）的请求包装 |
| `PacvueHandleDownload` | 下载封装（fetch + query + 文件名，支持异步 xlsx） |
| `getUrlParams` / `goUrlInterceptor` | 解析 URL 参数 / 带拦截器的路由跳转 |
| `getErrorData` | 从响应中提取错误数据 |
| `DealDateValid` | 校验起止日期有效性 |
| `PacvueDimDateFormat` / `PacvueFormatDateByDim` | 按维度（day/week/month…）格式化日期对象 / 日期字符串 |
| `PacvueLastRangeOfDateRange` | 取与当前区间等长的上一区间（对比用） |
| `generateDateListGroupedByMonth` | 生成按月分组的日期列表 |
| `PacvueXValueFormat` | 图表 X 轴值按维度格式化 |
| `PacvueGetCampaignTypeInfo` / `PacvueGetTypeByCamType` / `PacvueGetCampaignTypeTreeList` | Campaign 类型信息 / 反查类型 / 类型树 |
| `PacvueGetPlacementInfo` / `PacvueIsPlacementPage` | Placement 信息 / 是否 Placement 页 |
| `PacvueFormatBiddingStrategy` | Bidding Strategy 文案格式化 |
| `PacvueSearchTermNavigator` | Search Term 跳转导航（async） |
| `PacvueUpdateAudienceAddTime` / `PacvueReplaceKws` | Audience 加时处理 / 关键词替换 |
| `PacvueAnalysisTagName` / `PacvueShowCamTagWithTagName` | tag 字符串解析（分隔符协议）/ tag 展示格式化 |
| `FormatProfileListByCountry` | Profile 列表按国家分组格式化 |
| `PacvueGetDefaultCurrencyToMarket` / `useDefaultCurrencyToMarket` | 按选中 profile 取默认币种市场 |
| `GetMenuInfo` | 按 alias/menuName 查菜单项 |
| `PacvueCircularJson` / `PacvueJsonDiff` / `PacvueParseStringToJson` | 循环引用安全序列化 / JSON 差异比较 / 字符串安全转 JSON |
| `PacvueGetNumber` / `PacvueNumberDiv` / `isEmptyArray` | 保留小数 / 安全除法 / 空数组判断 |
| `PacvueOrderByFieldCallBack` / `PacvueGetProIndexOrderBy` / `PacvueIsProIndex` | 排序字段解析回调 / ProIndex 排序参数 / 是否指标数据 |
| `PacvueStrFormat` | 字符串批量大小写转换（capitalize 等，带忽略列表） |
| `PacvueGetLanguage` / `PacvueGetUserInfo` | 取当前语言 / 取用户信息（传 userStore） |
| `PacvueLocalForageClear` | 按用户/客户端清理 localforage |
| `PacvuePreModerationMessageLength` | 审核消息长度预处理（用途待确认） |
| `eagerComputed` / `genFileId` / `PacvueUUid` | 立即求值 computed / 生成递增文件 id / UUID（与 @pacvue/utils 同名再导出） |
| `usePacvueChartWeekShowLabel` / `usePacvueComputeProIndex` / `usePacvueMeasureText` / `usePacvuePageLoading` | 图表周标签 hook / 指标计算 hook / 文本测量 hook / 页面 loading hook |
| `PacvueWalmartJudgeState` | Walmart 行状态判断（**walmart 仓库特有**） |

## 其他文件

| 文件（`@/utils/…`） | 主要导出 | 用途 |
|------|------|------|
| `use` | `useBus` / `emitter` | 全局事件总线（mitt） |
| `url` | `encodeURIQuery` / `decodeURIQuery` / `getToday` / `getLastWeek` / `getLastMonth` | URL query 编解码 + 日期快捷 |
| `timer` | `getMonth` / `getWeek` / `getQuarter` / `getLastWeek` | 月/周/季/上周区间计算 |
| `tree` | `flatTree` / `findMenuPath` / `findMenuPathById` / `menu2url` / `path2root` / `isLeaf` | 菜单树工具 |
| `dom` | `on` / `off` / `once` / `addClass` / `removeClass` / `getStyle` / `setStyle` / `getScrollContainer` / `isInContainer` | DOM 工具集 |
| `table-util` | `PacvueGetExportFields` / `getExportFields` | 表格导出字段处理 |
| `validate-util` | `useValidate` / `useValidateUtil` | 表单校验 hook |
| `usePacvueCommonCache` | `usePacvueCommonCache`（amazon 另有 `useCustomMetrics` 等） | 筛选/自定义指标缓存 hook |
| `usePacvueLocalforage` | `usePacvueLocalforage` / `localForageClear` | localforage 封装 hook |
| `clickoutside` | default 指令 | 点击元素外部 |
| `PacvuePermission` | `v-pacvuePermission` 指令 | 模板权限控制 |
| `PacvueQueryUtil/filterUtil` | `PacvueFilterAdd` / `PacvueGetDateRangeQuery` / `PacvueCreateCommonFilterFormat` 等 | UI 筛选条件 → 后端 filter 查询结构（amazon 确认，其他平台按路径核实） |
| `brandCommon` | default（`colorclass` / `getFillColor`） | 品牌涨跌色 / 填充色 |
| `constant` | `indicateMapper` | 指标映射常量 |
| `database` | default `dataBaseUtil` | WebSQL 本地表头缓存 |

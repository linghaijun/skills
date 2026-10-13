# 速查表 3：store / 权限 / 请求

## `@pacvue/store`（`packages/stores/`）

入口导出 `useAppStore` / `useUserStore`：`import { useAppStore, useUserStore } from "@pacvue/store"`。

### `useUserStore`（id: `"user"`）— 用户态，别再从 sessionStorage 手动解析用户信息

| 类型 | 名称 | 用途 |
|------|------|------|
| state | `user` / `userSettings` / `userGuidanceInfo` / `hasUnreadMsg` | 用户信息 / 用户偏好 / 引导信息 / 未读消息 |
| getter | `isDemo` | 是否 Demo 账号（判断 demo 场景一律用它，禁止硬编码 clientId） |
| getter | `isAdmin` | 是否 SuperAdmin/Admin |
| getter | `locale` / `defaultCountryCode` | 当前语言 / 默认币种国家 |
| action | `userAction()` / `userSetting()` | 拉取用户信息（含 websocket 初始化）/ 拉取用户偏好 |
| action | `SET_USER_PROPERTY(key, value)` | 更新单个用户属性（同步 sessionStorage） |
| action | `logout()` / `setHasUnreadMsg()` | 登出 / 设未读消息 |

### `useAppStore`（id: `"frameStore"`）— 框架全局态，页面级共享状态先看这里有没有

| 分组 | 关键 state / action | 用途 |
|------|--------------------|------|
| 全局日期 | `dateRange` / `compareTime` / `isCompare` / `isCompareCustom` / `isComparePop` / `isCompareYoy` / `latestDateMode` / `lifeTimeMode` | 顶栏日期区间与对比模式（页面取全局日期一律从这里读，禁止自存） |
| 账号/Profile | `chooseAccounts` / `account` / `accountAll` / `channelType` | 顶栏选中账号与渠道 |
| 菜单/导航 | `menu` / `menuMap` / `menuIdItemMap` / `activeMenu` / `activePath` / `breadcrumb` / `sideBarIsExpend` | 菜单树、面包屑、侧边栏展开态；权限映射生成后挂 `window.permissionObj` |
| 引导/白名单 | `guideStates` + `loadGuideStates()` / `setGuideStates()` / `canShowGuide()`；`whiteListManagement` + `loadWhiteListManagement()` | 产品引导状态、Admin 白名单 |
| 其他 | `copilotShowStatus` / `customHeader` / `realtimePage` / `trackingRequests` | copilot 开关、自定义头部、实时页、在途请求追踪 |

### 持久化与业务 store 注册

| 导出 | 来源 | 用途 |
|------|------|------|
| `customCreatePinia` / `StorePersistPlugin` / `PERSIST_KEY_PRE`（`_per_store_`） | `@pacvue/store/utils`、`utils/store-persist-plugin` | 创建带持久化插件的 pinia；持久化能力本体是 `@pacvue/element-plus` 的 `useStorePersistPlugin` |
| `useStoreModule(modules)` / `getUseStoreKey` | `@pacvue/store/utils/util` | 按模块名批量 defineStore，自动生成 `use<Name>Store` |

**新增业务 store 的正确姿势**（禁止在页面里散落 `defineStore`）：

```js
// packages/main/src/store/modules/index.js —— 注册处
import { useStoreModule } from "@pacvue/store/utils/util"
const modules = { common, amazon, PDcenter /*, 新模块 */ }
const { useCommonStore, useAmazonStore } = useStoreModule(modules)
// 业务页面使用：
import { useCommonStore } from "@/store"
```

- store 内需要持久化的字段会以 `_per_store_` 前缀写入存储；**用户维度的 key 仍须遵守 `userid_xxx` 前缀规范**（见 CLAUDE.md Storage Key Rule）。
- 页面临时参数不要新建 store，用 `usePageTempParamsStore`（`@/utils/common-util`）。

## 权限（业务页面日常用这一套，禁止自造权限判断）

**权限模型（先懂这个再写代码）**：后端菜单树 → `useAppStore` 的 `getPermissionObj(menuTree)` 生成 `menuAlias → permissionType` 映射并挂到 **`window.permissionObj`**；同时 `MenuMap`（path → 菜单项）存入 local/sessionStorage。`permissionType` 三态：**0 = 无权限，1 = 只读（Read），2 = 可编辑（Edit）**，`undefined` = 该菜单不做权限校验。用户级角色在 `userStore.user.userRole`（Admin / User / Read）。

**日常判断入口（按场景选）**：

| 场景 | 用法 | 来源 |
|------|------|------|
| 模板里隐藏无编辑权限的按钮 | `<pacvue-button v-pacvuePermission="userRole">`——值为 `"Read"` 时元素被隐藏（display:none） | `@/utils/PacvuePermission` 指令（已全局安装） |
| 取当前页面/指定菜单的 Edit/Read 态 | `usePacvuePermission({ menuAlias?, pathname? })` → 返回 `"Edit"` 或 `"Read"`（综合 userRole + 菜单 permissionType） | `@/utils/PacvuePermission/util` |
| 操作前拦截并弹提示 | `PacvueHasPermission()` → 无编辑权限时自动弹 MessageBox 并返回 `false` | `@/utils/common-util` |
| 取用户角色 computed | `usePermission()` → `{ userRole, adminRole, readRole }` | `@/utils/common-util` |
| 判断某菜单/路径是否可见 | `hasMenuPermissions({ menuName, pathname })` | `@/utils/common-util` |
| 按 menuAlias 直接读 permissionType | `commonJS.getPermission(menuAlias)`（读 `window.permissionObj`） | @pacvue/utils |
| 判断 Admin/Demo 账号 | `useUserStore()` 的 `isAdmin` / `isDemo` getter | @pacvue/store |

典型模板用法（Campaign 页实例）：

```vue
<script setup>
import { usePacvuePermission } from "@/utils/PacvuePermission/util"
const userRole = usePacvuePermission({})   // "Edit" | "Read"，默认按当前 pathname 查菜单权限
</script>
<template>
  <pacvue-button type="primary" v-pacvuePermission="userRole" @click="create">Create</pacvue-button>
</template>
```

**禁止**：手写 `userStore.user.userRole === "Read"` 之类的散装判断做按钮隐藏（用指令）；手动解析 `MenuMap` / `window.permissionObj`（用上表封装）。

## `@pacvue/permission`（`packages/permission/`，文件在包根——User/Role 管理模块专用）

以下服务于权限管理页面本身（用户/角色/组织架构 CRUD），普通业务页面一般不直接用：

| 文件 | 关键导出 | 用途 |
|------|---------|------|
| `hooks.js` | `useValidation` / `useVerifyCountDown` / `useMultiClientToggle` / `regExpEmail` | 表单校验 / 验证码倒计时 / 多客户端切换 / 邮箱正则 |
| `utils.js` | `sortPlatformsByScale` / `handleModulesData` / `traverseMenuTable` 等 | 平台/菜单/权限数据处理 |
| `api.js` | `getUserInfo` / `createUser` / `getRoleListAll` 等 40+ | 用户/角色/组织架构接口 |
| `store.js` | `usePermissionStore` | 权限模块 store |
| `permission.js` | default（`routerInterceptors`） | 路由守卫拦截器（UserManage/RoleManage 进入校验、多客户端校验） |
| `constants.js` | `LEVEL_MAPPER` / `PLATFORMS_ALL` / `ROLE_TYPE` 等 | 权限常量 |

## 请求封装（`@pacvue/frame`，框架包）

| import | 用途 |
|--------|------|
| `import request from "@pacvue/frame/request"` | 全站唯一 axios 实例：token 注入、401 自动 refresh、登出处理。**禁止自建 axios 实例** |
| `import authRequest from "@pacvue/frame/authRequest"` | 鉴权专用请求实例 |
| `import { initwebSocket } from "@pacvue/frame/websocket"` | websocket 连接 |

业务 API 写法（放 `packages/main/src/api/` 或平台对应 api 目录）：

```js
import request from "@pacvue/frame/request"
export function getUserInfo(id) {
  return request({ url: `${import.meta.env.VITE_APP_USERURL}/getUserInfo/${id}`, method: "get" })
}
```

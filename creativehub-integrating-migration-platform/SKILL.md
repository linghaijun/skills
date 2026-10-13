---
name: creativehub-integrating-migration-platform
description: Integrate a new advertising platform (e.g. tiktok, samsclub) into Pacvue's cross-platform creative asset migration. Covers both the creative-management 中台 (ProductLines, supportPlatform, @Platform BusinessService, Feign client, AdTypeCatalog, CreativeLevelEnum), the {platform}-provider /creative endpoints (endpoint implements the 中台 Feign interface, mapper SQL, asset/product/profile queries), and the performance ETL handoff (per-adType source-table → CK DailyCreativeReport/Campaign/Tag SQL delivered to the ETL team). Use when adding a new productLine/platform to the asset migration flow, wiring a provider's getCreativeInfoByProfile / getCreativeProductMapping / getProfilesByClientId, writing the per-adType performance SQL for the ETL team, or debugging why a platform's assets/performance don't migrate.
---

# Integrating a New Platform into Creative Asset Migration

接入一个新广告平台到 Creative Hub,分**两条线**,最后在 CK 里按 (creativeId, productLine, profileId) 关联:

| 线 | 谁做 | 内容 |
|---|---|---|
| 素材同步 | 我们 | `creative-management`(中台)分发到平台 BusinessService → Feign → `platform-provider` 的 `{platform}-provider`(`CreativeManagementEndpoint implements {Platform}FeignClient`,直查平台 SQL Server)→ 写中台 MySQL,CDC 到 CK `asset_*_all` |
| 绩效 ETL | ETL 组(dbt) | 平台源库 → CK `DailyCreativeReport_all` / `Campaign_all` / `CampaignTag*_all` 等;**我们负责交付按 adType 分支的取数 SQL** |

两条线对同一个 creative 必须用同一套键和枚举值,否则素材迁过来了绩效也挂不上。

## 素材同步调用链

```
中台 POST /adGroupCreativeAssets/batch → MQ → AssetMigrationHandler
  按 supportPlatform 遍历 → BusinessAware.realClientService(productLine)
    → {productLine}BusinessService (@Platform 驱动 bean 名)
      → {Platform}FeignClient (path=/creative, name=${feign.provider.<key>})  ──HTTP──▶
        {platform}-provider CreativeManagementEndpoint implements {Platform}FeignClient
          ├─ getProfilesByClientId      client → profile
          ├─ getCreativeInfoByProfile   profile → 素材(video/image)
          └─ getCreativeProductMapping  creative → productIds
```

迁移**只依赖这三个端点**。其余端点(tag/campaign/material 等)服务中台素材页等功能;因为 provider implements 整个 Feign 接口,这些方法也必须实现(没有数据就返回空列表)。

## 工作流

复制这份清单,逐项打勾。编号与 `references/` 里的章节编号一致:

```
中台 (creative-management):
- [ ] 1. ProductLines 加枚举 + UI_PLATFORM_ORDER 追加 (+ 按需 SLUG_ALIAS)
- [ ] 2. supportPlatform: application.yml + 覆盖了该键的区域 yml; feign.provider.<key> (含 application-test.yml)
- [ ] 3. {Platform}FeignClient + {Platform}FeignFactory (feign 模块)
- [ ] 4. {Platform}BusinessService (@Platform; 构造器/setter 注入; 必须重写 getProfilesByClientId)
- [ ] 5. AdTypeCatalog 登记 Ad Type 叶子 (+ 按需 AdTypeEnum); 按 adType 定 creative 层级, 非 AD 级要改 resolveCreativeLevel / levelOf 两处
- [ ] 6. (按需) URL 实时解析 / 过期重取
- [ ] 7. deploy (或本地 install) model + feign, provider 才能 implements 到新接口

provider ({platform}-provider):
- [ ] 8. CreativeManagementEndpoint implements {Platform}FeignClient
- [ ] 9. IAssetMigrationService + Impl
- [ ] 10. CreativeMigrationMapper + .xml (素材 / 产品映射 SQL)
- [ ] 11. UserProfileMapper.getProfilesByClientIds

绩效 ETL 交接:
- [ ] 12. 按 adType 收集 creative 层级/源表/creativeId → 字段对应表 → {platform}-migration.sql (6 张 CK 表, 第 6 段每个 adType 一个分支) → 自检
- [ ] 13. 交付 ETL 组; 落地后用真实 CK 数据复核取值, 再回填 AdTypeCatalog 的 ck*

验证:
- [ ] 14. 中台跑 verify (含 ArchitectureTest + CPD), 数日志 [ERROR] 行而不是看退出码
- [ ] 15. provider 编译通过 (= Feign 接口所有方法都已实现)
- [ ] 16. 抽几个素材的 (creativeId, profileId) 去 DailyCreativeReport_all 查得到行 = 两条线接通
```

详细步骤:
- 中台侧(1–7)怎么写 → `references/creative-management-side.md`
- provider 侧(8–11)端点/mapper/SQL 模板 → `references/provider-side.md`
- 绩效 ETL 交接(12–13)→ `references/etl-handoff.md`,SQL 模板 → `templates/platform-etl-migration.sql`
- 全部踩坑点 → `references/gotchas.md`

## 必读:高频踩坑点

完整清单见 `references/gotchas.md`。**最容易漏 / 最容易错的 8 个**:

1. **supportPlatform 是迁移开关,区域 yml 覆盖了就要改**。`application.yml` 是默认值;`application-cn.yml` / `application-eu.yml` 各自覆盖了 `supportPlatform`(取值互不相同),`application-us.yml` 没写、继承默认。新平台要在默认值和**每个覆盖了该键、且要开放该平台的区域**里追加。漏配 = 该区域完全不迁移。

2. **Bean 名靠 `@Platform` 注解,不是类名**。`QueryAnnotationBeanNameGenerator` 用 `@Platform(ProductLines.X)` 生成 bean 名 `x.value + "BusinessService"`,与 `BusinessAware` 查找侧一致。要对齐的是 **`@Platform` 枚举值 ↔ 请求里的 productLine 字符串**(`ProductLines.match()` 按 value/name 忽略大小写,再查 `SLUG_ALIAS`)。

3. **provider endpoint 必须 `implements {Platform}FeignClient`**,直接用 `creativemgmmodel` 的 DTO,不要在 provider 自造 DTO。方法上不再写 `@PostMapping`(从接口继承),类上保留 `@RestController` + `@RequestMapping("/creative")`。前提是先做第 7 步把新接口发到仓库。(tiktok-provider / openai-provider 是历史上的手写 `@PostMapping` 例外,不要仿。)

4. **`getProfilesByClientId` 必须重写**。`BaseBusinessService` 的默认实现是 `return null`,不是空列表;不重写的话迁移这一步拿不到 profile(甚至 NPE)。

5. **绩效关联键 = (creativeId, productLine, profileId),不含 adGroupId**。没有 adGroup 的平台(如 GMV Max)只要资产 creativeId / profileId 与绩效报表口径一致就能关联。adType 若报表里为 NULL,资产侧也要给 NULL,否则 adType IN 过滤查空。

6. **新代码禁止 `@Autowired` 字段注入**。`ArchitectureTest.noFieldInjection` 是冻结规则,只认存量;新 BusinessService 用构造器注入,可选依赖用 setter 注入(见 `ChatgptBusinessService`)。

7. **creativeId 对应的广告层级因 adType 而异**。同一平台不同 adType,creativeId 可能挂在 campaign / adGroup / ad / creative / video 不同层(Amazon SB=ad、SD=adGroup;TikTok GMV Max=video、Social=ad)。**先按 adType 定层级和原生 ID**,素材 SQL、产品映射、绩效 SQL、`CreativeLevelEnum` 四处必须一致。对照表见 gotchas #13。

8. **绩效 SQL 按 adType 拆分支**。同一平台不同 adType 的报表源表、粒度、creativeId 来源经常完全不同(Walmart sv/sb/display 三支,Amazon SB 走 Ad 级、SD/STV 走 AdGroup 级),一个 adType 一个 `UNION ALL` 分支;不支持的指标写 NULL 不写 0。

## 参考模板

| 用途 | 中台 | provider |
|---|---|---|
| 主模板(最新接入) | `ChatgptBusinessService` / `ChatgptFeignClient` (CP-54006) | `instacart-provider` 的 `CreativeManagementEndpoint`(implements 写法) / `AssetMigrationServiceImpl` |
| 结构最简 | `InstacartBusinessService` / `InstacartFeignClient` | 同上 |
| URL 实时解析 + 过期重取 | `TiktokBusinessService` | `tiktok-provider`(只看 SQL / service,端点写法不要仿) |
| 绩效 ETL SQL | `creative-management/docs/develop/26Q3-Sprint6-CP-57189-*/migration/{platform}-migration.sql`(tiktok 最全) | — |

照模板仿写后,再按本 skill 的坑点逐条核对。

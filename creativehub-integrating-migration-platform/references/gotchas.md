# 踩坑清单（接入时逐条核对）

按"最容易漏/最容易错"排序。每条都是真实踩过的。编号稳定,其它文件按编号引用。

## 配置 / 装配

1. **supportPlatform 是迁移开关,区域覆盖要逐个看**。`application.yml` 是默认值;`application-cn.yml` / `application-eu.yml` 各自覆盖了 `supportPlatform` 且取值不同(cn 至今没有 instacart/tiktok),`application-us.yml` 不覆盖、继承默认。新平台加进默认值 + 每个覆盖了该键且要开放的区域。漏配 = 该区域完全不迁移。改前先 `grep -n supportPlatform application*.yml`。(历史上的 `performancePlatform` 配置已不存在,不用加。)

2. **Bean 名由 `@Platform` 注解驱动,不是类名**。`QueryAnnotationBeanNameGenerator`(注册在 `@ComponentScan(nameGenerator=...)`)对带 `@Platform` 的 `BusinessService` 实现,bean 名 = `Constants.generateBeanName(@Platform.value, BusinessService.class)` = `value + "BusinessService"`,与 `BusinessAware` 查找侧完全相同。
   - 不需要显式 `@Component("xxx")`,类名随意。
   - 真正要对齐的是 **`@Platform` 枚举 ↔ 请求 productLine 字符串**(`ProductLines.match()` 按 value/name 忽略大小写,未命中再查 `SLUG_ALIAS`)。
   - 网上说的"靠类名首字母 decapitalize 对齐"是错的。

3. **provider endpoint 必须 `implements {Platform}FeignClient`**。amazon / walmart / instacart / dsp / chewyv2 都是这个写法:
   - 直接用 `creativemgmmodel` 的 DTO;**不要在 provider 自造等价 DTO**(CP-57337 踩过:自造的 `UserProfileViewResp` / `ProfileQueryReq` 在已发布 jar 里早有 `UserProfileView` / `ProfileQuery`)。
   - 方法上不重复写 `@PostMapping`,Spring MVC 从接口继承;类上保留 `@RestController` + `@RequestMapping("/creative")`。
   - 编不过说明 provider 拿到的 feign jar 里还没有这个接口 → 先做 #4 的发布,**不是**改成手写 `@PostMapping` 绕过。
   - tiktok-provider / openai-provider 是历史上的手写例外,不要仿。

## 跨仓编译

4. **先发 model + feign,再编 provider(硬时序)**。provider 根 pom 依赖 `creative-management-feign/model:1.2.16-SNAPSHOT`(滚动快照,中台 `module.deploy.version` 同值)。改了中台 model/feign 后:
   ```bash
   # 在 creative-management 仓; .mvn/maven.config 自带 -am
   ./mvnw deploy -pl creative-management-model,creative-management-feign -DskipTests
   # 只本地验证: deploy 换成 install
   # provider 期望的版本与中台不同: 加 -Dmodule.deploy.version=<X.Y.Z-SNAPSHOT>
   ```
   覆盖同一快照版本即可,**不用升版本**。否则 provider 报 `Could not find artifact ...feign:jar:<version>` 或找不到 `{Platform}FeignClient`。`deploy` 推的是共享仓库,会影响所有拉这个快照的人。

5. **上游坏 SNAPSHOT 会卡全仓**。若报 `micro-server:pom:${module.deploy.version}` 之类 parent 版本未插值 → 是上游刚发的坏快照,不是本次改动问题,让发布方重发,或本地用旧时间戳 pom 顶替。

## SQL 正确性

6. **增量过滤用 OR,不能 AND**。素材资产 = 关系(投放/配置/ad)⨝ 素材字典。增量条件要 `关系.update_time >= t OR 素材.update_time >= t`:
   - 写成 AND 会漏「新投放引用老素材」(关系新、素材旧) 和「老投放素材更新」(关系旧、素材新)。
   - 素材字典 CTE **自身不加时间过滤**,否则 OR 的素材侧永远 join 不到老行。
   - 单表查询(无 join,如纯 image ad)用单条件即可。

7. **平台素材表有重复行**。creative_info 等在 (advertiser_id, item_id)/video_id 上多行(多 store/identity)。必须 `ROW_NUMBER` 去重取最新,否则资产翻倍。

8. **多表 join 补 profile_id 联合条件**。`ad`/`adgroup`/`campaign`/`creative_info` 只按 id join 会跨 profile 串号。join 条件带上 `profile_id`(或 advertiser_id)。

9. **一实体多 product 会让资产行翻倍**。video→product 是一对多时,brand 之类单值字段用标量子查询/`MAX` 聚合,或先把 video 去重再 join,避免 UNION 产生重复资产行。

## 业务口径对齐

10. **绩效关联键 = (creativeId, productLine, profileId),无 adGroupId**。`AssetCreativePerformanceCkMapper` 按这三个 join。没有 adGroup 的平台(GMV Max)只要资产 creativeId/profileId 与绩效报表口径一致即可。

11. **adType 与绩效报表口径一致**。若报表里某类型 adType=NULL(如 GMV Max 把类型放 lineitemType),资产侧 adType 也要给 NULL。否则前端按 adType IN 过滤直接查空。`AdTypeCatalog` 的 `ckAdTypes` 同样要填 CK 里的实际值。

12. **Ad Type 筛选条件在 `AdTypeCatalog` 里,不是 `adTypeMap`**(已删除)。每个叶子带 `ckCampaignType / ckAdTypes / ckAdCreativeFormatType`,由 `BaseHandler#fillPlatformFilters` 展开:
    - 三个字段按平台在 CK 的实际落值选:非 DSP 平台一般以 `ckCampaignType` 为主,子类型再用 `ckAdTypes`(如 TikTok Social Ads 的 `SINGLE_VIDEO`);campaignType / adType 都区分不开时才用 `ckAdCreativeFormatType`(如 Instacart Inspiration 的图/视频)。DSP 的取值体系不同,不要照搬。
    - 三个 `ck*` 全为 null 的叶子 `hasCkCondition()=false`,**不会进筛选树**(ChatGPT 当前就是占位状态)。
    - `AdTypeEnum` 与筛选无关,只服务创意替换 / AI 规格;它的 `aiName` 要与 `asset_requirement_spec.ad_type` 完全一致(ChatGPT 把复数 "Standard Ads" 写成单数时,下拉直接消失)。

13. **creativeId 是逻辑标识,映射到的平台原生 ID 因平台/adType 而不同**。中台不关心它到底是什么 ID,只要求**同一平台内、跨三处(getCreativeInfoByProfile / getCreativeProductMapping / 绩效报表)用同一个定义**,否则产品/绩效关联不上。各平台映射不同:

| 平台 / adType | creativeId 挂在哪一层 | 原生 ID |
|---|---|---|
| Amazon SB / SP | ad | `adId` |
| Amazon STV | ad(`CreativeLevelEnum.AD`) | `adId`。报表只有 adGroup 级(`dayreportAdgroup`),但 STV 的 ad:adGroup 实测 1:1(2026-10-10,6067 个 adGroup 全部 1 个 ad),绩效 SQL 应 join `AmazonAd` 按 (ProfileId, AdGroupId) 换成 adId。截至 2026-10 ETL 未同步 STV,CK 里无 STV 绩效(修法已写进 CP-57189 的 amazon-migration.sql 分支三)。素材侧 STV 的 ad_type 是 'sb'(见 #26),按 ad_type 统计不出 STV |
| Amazon SD(Image/Video) | adGroup | `adGroupId` |
| Walmart sv | adGroup 下的媒体 | `AdGroupMedia.adgroupMediaId` |
| Walmart sb | adGroup 下的 SBA profile | `SbaProfile.sbaProfileId` |
| Walmart display | creative | `creativeId` |
| Instacart(全部) | adGroup | `ad_group_id` |
| DSP | creative | `creativeID` |
| TikTok GMV Max | video(无 ad、无 adGroup) | `item_id` |
| TikTok Social Ads | ad | `ad_id` |

    新平台的层级可能是 campaign / adGroup / ad / creative / video / asset 中的任何一层。

    **同一平台内 adType 不同,creativeId 映射也可能不同**(如 TikTok 上面 GMV 用 item_id、Social 用 ad_id)。接入时先定清楚"本平台每种 adType 的 creative 粒度对应哪个原生 ID",再保证 assetId(素材粒度)与 creativeId(创意粒度)是正确的一对多关系——一个 creativeId 下可挂多个 asset(如一个 ad 多个 video)。

14. **素材 URL 过期**。若平台库里存的是会过期的 preview_url,改为 provider 只回素材 ID、中台调平台 SDK 实时换 URL,补不到的剔除(见 creative-management-side 第 6 节)。

## 扩接口

15. **新增一个跨服务方法要改全链 8 层,漏一层就编译/运行报错**。普通接入只实现"既有"方法不涉及此;但若要**新增**一个端点(如 `getCreativeInfoByVideoIds`),从中台到 provider 全套:
    1. `BusinessService` 接口加方法(给 `default` 实现,避免其它平台编译崩)
    2. `BusinessAware` 加委托方法(`realClientService(productLine).xxx(...)`)
    3. `{Platform}BusinessService` override
    4. `{Platform}FeignClient` 加 `@PostMapping`
    5. `{Platform}FeignFactory` fallback 加该方法
    6. 发布 model + feign(#4)
    7. provider `CreativeManagementEndpoint` 实现该方法(implements 后编译器会提示)+ `IAssetMigrationService` / impl
    8. mapper + xml
    调用方(如 `AssetMigrationHandler`)再调 `BusinessAware` 的新方法。
    注意第 4 步改的是**共享 Feign 接口**:所有 implements 它的 provider 都要同步实现,否则下次编译就断。

## SQL 方言

16. **provider 是 SQL Server(MSSQL)**。用到的 MSSQL 特性:`WITH(NOLOCK)`、CTE `WITH`、`ROW_NUMBER() OVER`、拆字符串 `CROSS APPLY STRING_SPLIT(col, ',')`、`ISNULL`。`STRING_SPLIT` 要求兼容级别 ≥130;字段若是 JSON 数组(`["a","b"]`)别用 STRING_SPLIT(拆不出),改在 service 层 `JSONUtil.parseArray`。单条语句参数上限 2100,IN 列表要切批。

## 收尾

17. **方法齐全由编译保证**。provider implements Feign 接口后,缺方法 / 签名不一致直接编译失败,不再需要手工数 `@PostMapping`。编过后仍要核对迁移三方法的实现不是空占位。
18. **资产返回前过滤空 assetUrl**,打 warn 记录丢弃数,避免下游下载失败(URL 由中台补的平台在中台侧过滤)。
19. publisherId、resilience4j 实例配置(可选)、单测(mock Feign 三方法)按需补。

## 中台约定 / 门禁

20. **新代码禁止 `@Autowired` 字段注入**。`ArchitectureTest.noFieldInjection` 是 `FreezingArchRule`,只放行冻结的存量;老平台 BusinessService 和 `BaseBusinessService` 里的字段注入都是存量,照抄会红门禁。用构造器注入,可选依赖用 `@Autowired(required = false)` 的 setter(见 `ChatgptBusinessService`)。

21. **`getProfilesByClientId` 必须重写**。`BaseBusinessService` 默认 `return null`(不是空列表);`AssetMigrationHandler` 直接拿 `res.getCode()` 判断,不重写轻则该平台没有 profile,重则 NPE。

22. **`getProfileIdsByClientIdAndAdvertiserIds` 不能返回空**。`fillPlatformFilters` 用它补授权 profile,返回空会把整个平台的筛选条件剔掉,列表 / 绩效里该平台全空。

23. **`ProductLines` 不只加枚举**:`UI_PLATFORM_ORDER` 末尾追加 value,否则 UI 筛选项不展示;平台外壳 slug 与 value 不同时加 `SLUG_ALIAS`。Feign 配置键 / provider 服务名也可能与 productLine 不同(ChatGPT:productLine=`chatgpt`,`feign.provider.openai` → `openai-provider`)。

24. **验证别信 mvn 退出码**。中台跑到 `verify` 阶段(CPD 在 verify,只跑 `test` 不算过门禁),数日志 `grep -c '\[ERROR\]'` 必须为 0;失败用例从 `target/surefire-reports/TEST-*.xml` 的 `<testcase>` 聚合,不要读 `.txt`(并行执行下会串)。

25. **`CreativeLevelEnum` 只影响 GenAI 创意检测**(选择器第 5 级 + `adId` 校验),平台白名单 `GENAI_PRODUCT_LINES`(amazon / walmart / instacart / chatgpt,在 `CreativeOptimizationController` 与 `CreativeImageSpecService` 各定义一份),且只认 Image 规格。新平台不进白名单就不用管;要进白名单时才处理下面的层级。
    只有 AD / ADGROUP 两档,且按 (productLine, adType) 硬编码在两处:`CreativeImageSpecService.resolveCreativeLevel` 与 `CreativeOptimizationHandler.levelOf`(逻辑重复,改一处必须改另一处)。默认返回 AD(第 5 级下拉展示、`adId` 必填)。
    - 新平台某 adType 的 creative 就是 adGroup → 两处都加分支返回 ADGROUP,否则 `adId` 被要求必填、`target_key = COALESCE(ad_id, adgroup_id)` 会把同一创意分裂成两条记录。
    - 层级是 campaign 或 video(没有 ad 也没有 adGroup,如 TikTok GMV Max)时,两档都不贴切,**接入前先和产品/前端确认第 5 级与 adId 的语义**,必要时扩枚举;不要默认落到 AD。

26. **素材侧 `asset_creative_mapping.ad_type` 的含义因平台而异,不一定是广告类型**。Amazon 的 ad_type 只有 `sb` / `sd` 两个值(CP-47026 有意改成常量),是 provider 反查创意的分流标记:`sb` = creativeId 是 adId、查 AmazonAd(SP/SB/STV 都是),`sd` = creativeId 是 adGroupId、查 AdCreative(见 `AssetCreativeMappingMapper.xml` 注释)。页面展示/筛选的 Ad Type 来自 CK campaignType 经 `AdTypeCatalog` 反查,不读 ad_type。新平台的 ad_type 先定清楚是哪种语义,provider 若靠它分流就要写进注释;要按广告类型统计素材时用 campaignType,别用 ad_type。

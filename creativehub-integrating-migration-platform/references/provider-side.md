# Provider ({platform}-provider) 接入步骤(8–11)

模板:`instacart-provider`。新增文件均放 `com.pacvue.{platform}.provider` 下。编号与 SKILL.md 清单一致。

前提:中台第 7 步已把含 `{Platform}FeignClient` 的 model + feign 发到仓库。platform-provider 根 pom 已在 `<dependencies>` 声明 `creative-management-feign` / `creative-management-model`(`1.2.16-SNAPSHOT`),所有 provider 继承,不用另加依赖。

## 8. CreativeManagementEndpoint

```java
@RestController
@Slf4j
@RequestMapping("/creative")            // 对应 @FeignClient(path = "/creative")
public class CreativeManagementEndpoint implements {Platform}FeignClient {

    @Override
    public ResultVO<List<ClientProfileInfo>> getProfilesByClientId(List<Long> clientIds) {
        try {
            return ResultVO.success(userProfileService.getProfilesByClientIds(clientIds));
        } catch (Exception e) {
            log.error("getProfilesByClientId failed, clientIds={}", clientIds, e);
            return ResultVO.FALL(null);
        }
    }
    // ...
}
```

- **必须 `implements {Platform}FeignClient`**,入参出参直接用 `com.pacvue.creativemgmmodel.*` 的 DTO,不要在 provider 自造等价 DTO。
- 方法上**不要**再写 `@PostMapping` / `@RequestBody`:Spring MVC 从接口继承映射和参数注解。接口方法缺注解就回中台补,不要在 provider 侧补。
- 实现了接口就由编译器保证方法齐全、签名一致,不用手工逐条核对路径。
- 统一 try/catch,异常 `return ResultVO.FALL(null)`,正常 `ResultVO.success(data)`。
- tiktok-provider / openai-provider 的端点是历史上的手写 `@PostMapping` 写法(不 implements),**不要仿**。

### 端点候选清单

★ = 迁移链路必需(`AssetMigrationHandler` 直接调)。其余服务中台素材页 / tag / campaign 等功能:中台 Feign 接口里放了哪些,provider 就要实现哪些(编译强制);平台没有对应数据就返回 `ResultVO.success(空列表)`。

| 接口方法 / 路径 | 入参 | 返回 | 必需 | 落到 service |
|---|---|---|---|---|
| `getProfilesByClientId` | `List<Long> clientIds` | `List<ClientProfileInfo>` | ★ | userProfileService.getProfilesByClientIds |
| `getCreativeInfoByProfile` | `CreativeInfoRequest` | `List<MigrationAssetInfo>` | ★ | assetMigrationService.getCreativeInfoByProfile |
| `getCreativeProductMapping` | `CreativeInfoRequest` | `List<CreativeProductMappingDTO>` | ★ | assetMigrationService.getCreativeProductMapping |
| `getCreativeInfoByVideoIds` | `CreativeInfoByVideoIdsRequest` | `List<MigrationAssetInfo>` | ☆ URL 过期重取时 | assetMigrationService.getCreativeInfoByVideoIds |
| `getProfiles/byUserId` | `@RequestParam userId` | `List<String>` | | userProfileService.getProfileIdsByUserId |
| `getUserProfilesByUserIds` | `ProfileQuery` | `List<UserProfileView>` | | userProfileService.getUserProfilesByUserIds |
| `getProfileListByProfileIds` | `List<String>` | `List<ProfileInfo>` | | profileService.getProfileInfoByIds |
| `listProfile` | `@RequestParam clientId,userId` | `List<AppliedProfileView>` | | userProfileService.listManagedProfiles |
| `getAdgroupInfo` | `List<AdgroupReq>` | `List<AdgroupResp>` | | adGroupService.getAdgroupInfo |
| `listCampaignByFilter` | `CampaignListReq` | `List<CampaignView>` | | campaignService.listCampaignByFilter |
| `listCampaignTag` | `CampaignTagQuery` | `List<CampaignTagView>` | | campaignTagService.listCampaignTag |
| `getCampaignTagTree` | `CampaignTagQuery` | `List<CampaignTagView>` | | campaignTagService.getCampaignTagTree |
| `getTagInfoByIds` | `List<Long>` | `List<CampaignTagInfoView>` | | campaignTagService.getTagInfoByIds |
| `getCampaignViewByCreativeIds` | `CreativeCampaignQuery` | `List<CreativeCampaignView>` | | assetMigrationService.getCampaignViewByCreativeIds |
| `getCreativeProducts` | `CreativeProductQuery` | `List<AppliedProductInfoView>` | | assetMigrationService.getCreativeProducts |
| `getCreativeMaterials` | `CreativeCampaignQuery` | `List<CreativeMaterialView>` | | assetMigrationService.getCreativeMaterials |
| `getProductInfoByIds` | `ProductInfoQuery` | `List<AppliedProductInfoView>` | | assetMigrationService.getProductInfoByIds |
| `getBrandsByClientId` | `BrandQuery` | `List<String>` | | assetMigrationService.getBrandsByClientId |
| `getCreativeSettings` | `CreativeSettingReq` | `List<CreativeSettingView>` | | 无存储则直接 `ResultVO.success(空)` |

Creative Hub 类平台(如 ChatGPT)还可能有 `listAdgroupByCampaign` / `listAdByAdgroup` / `getCreativePreview` / `listAssetsByAdgroup` / `listCreativesByFilter`,以 `ChatgptFeignClient` 为准。

`getCreativeProducts` / `getCreativeMaterials` / `getCampaignViewByCreativeIds` 入参可能同时带 `creativeIds` 和 `creativeInfos`,service 层合并去重(见 `mergeCreativeIds`)。

## 9. IAssetMigrationService + Impl

- 端点只做参数透传 + try/catch,业务逻辑全在 service。
- profileId 入 SQL 前做白名单校验:`Pattern.compile("^[A-Za-z0-9_-]+$")`,防注入(尤其拼接场景)。
- SQL Server 单条语句参数上限 2100,IN 列表按批切(instacart 用 `SQL_IN_BATCH_SIZE = 500`)。
- 资产返回前过滤空 `assetUrl`(URL 由中台补的平台除外),打 warn 记丢弃数。

`MigrationAssetInfo` 关键字段:`productLine / creativeId / profileId / advertiserId / brand / assetId / assetUrl / fileType(枚举名 Video/Image) / fileName / adType / createTime / videoId / imageId`。

## 10. CreativeMigrationMapper + .xml

数据源:provider 直连平台 SQL Server(默认数据源),mapper XML 用**不带库前缀**的表名(`campaign`, `ad`, `creative_info`...)。`CreativeMigrationMapper` 走默认数据源(无 `@DS`)。

### 10a. 素材查询 SQL(getCreativeInfoByProfile)

按平台模型拆分支 UNION。通用结构(以 tiktok 为例):

- **去重**:平台素材表(如 creative_info)常在 (advertiser_id, item_id)/video_id 上有重复行(多 store/identity)。用 CTE + `ROW_NUMBER() OVER (PARTITION BY ... ORDER BY update_time DESC, id DESC)` 取最新一行,主查询 join `rn = 1`。
- **增量 OR 语义**(gotchas #6):`lastSyncTime` 过滤要写成「关系侧有变 OR 素材侧有变」,不能 AND。素材字典 CTE 本身**不加**时间过滤。
- **多来源取并集**:同一逻辑实体的素材可能分散在多表(投放报表 ∪ 配置表),`UNION ALL` 后 `GROUP BY` 去重,`MAX(src_time)` 记录关系侧最近变更供增量判断。
- **fileType** 取 `FileTypeEnum` 枚举名字符串('Video'/'Image'),MyBatis 按 name 映射枚举。
- **brand**:能关联就关联(如 video→item_group→product.brand_name);拿不到留空走下游 AI。
- **adType**:与绩效报表口径对齐(gotchas #11)。
- **Image URL 由中台补时**:provider 只解析出 imageId/videoId,`assetUrl` 留空。纯图片广告:mapper 查出 image_ids 原始 JSON → service `JSONUtil.parseArray` 解析 → 每个 imageId 产一条 `fileType=Image` 资产(gotchas #16:JSON 数组别用 STRING_SPLIT)。

### 10b. 产品映射 SQL(getCreativeProductMapping)

只查有 creative→product 关系的来源(常是投放报表 `itemId → productId`),返回 (creativeId, productId) 原始行,**service 层** `groupingBy(creativeId)` + 去重产出 `CreativeProductMappingDTO{creativeId, productIds}`。

creativeId 口径必须与 getCreativeInfoByProfile 一致(gotchas #13),中台才能按 creativeId 把 productIds 赋给资产。

## 11. UserProfileMapper.getProfilesByClientIds

SQL 按 `client_id` + 托管标志,**join profile 过滤有效 profile**(对齐同步口径,如 `status='STATUS_ENABLE' AND is_deleted=0`),返回 `ClientProfileInfo{profileId, clientId}`。

# 中台 (creative-management) 接入步骤(1–7)

以 tiktok 为例,占位 `{platform}` / `{Platform}` / `{PLATFORM}`。编号与 SKILL.md 清单一致。

## 1. ProductLines 枚举

`creative-management-model/.../enums/ProductLines.java` 三处:

```java
TIKTOK("tiktok", 18),   // value 是存储值/请求口径; publisherId 与 publisher 体系核对

private static final List<String> UI_PLATFORM_ORDER = List.of(
        AMAZON.value, DSP.value, WALMART.value, INSTACART.value, TIKTOK.value, CHATGPT.value
        /* 末尾追加新平台 value, 否则 UI / 筛选项不展示 */);

private static final Map<String, ProductLines> SLUG_ALIAS = Map.of("openai", CHATGPT);
// 仅当平台外壳传的 slug 与 value 不同时才加(如 openai → chatgpt)
```

`ProductLines.match()` 按 value 或 name() 忽略大小写匹配,未命中再查 `SLUG_ALIAS`;`canonical()` 把入口值归一成存储值。

## 2. supportPlatform 与 Feign 配置

```yaml
# application.yml (默认值; application-us.yml 不覆盖, 直接继承)
supportPlatform: amazon,walmart,instacart,dsp,tiktok,chatgpt,{platform}
feign:
  provider:
    {key}: {key}-provider        # Eureka 服务名
    # {key}-url: https://...     # 可选; 不配则 ${feign.provider.{key}-url:} 为空, 走 Eureka
```

- **区域覆盖**:`application-cn.yml` / `application-eu.yml` 各自覆盖了 `supportPlatform`(例:cn=`amazon,walmart,dsp`,eu=`amazon,dsp,walmart,tiktok`)。要在哪个区域开放就改哪个文件;不开放就不加。改前先 `grep -n supportPlatform application*.yml` 看当前取值。
- **test 环境**:`application-test.yml` 的 `feign.provider` 下也要加 `{key}: {key}-provider-test`(它不覆盖 supportPlatform)。
- **`{key}` 不一定等于 productLine**:ChatGPT 的 productLine 是 `chatgpt`,配置键 / 服务名是 `openai` / `openai-provider`。`{key}` 跟 provider 的服务名走,`contextId` 才用 productLine。
- 读取方:`AssetMigrationHandler` / `AssetManager` / `AppliedCampaignFilterService` 都 `@Value("#{'${supportPlatform}'.split(',')}")`。

## 3. Feign 客户端 (creative-management-feign 模块)

仿 `ChatgptFeignClient` / `InstacartFeignClient` 建 `{Platform}FeignClient`:

```java
@FeignClient(
        path = "/creative",
        name = "${feign.provider.{key}}",
        url = "${feign.provider.{key}-url:}",
        contextId = "{platform}",
        fallbackFactory = {Platform}FeignFactory.class
)
@ConditionalOnProperty("feign.provider.{key}")
public interface {Platform}FeignClient { /* 迁移三方法 + 平台所需的其余方法 */ }
```

配套 `{Platform}FeignFactory implements FallbackFactory<...>`,每个方法 `return ResultVO.FALL(null)`。

迁移三方法签名固定:
```java
@PostMapping("getProfilesByClientId")    ResultVO<List<ClientProfileInfo>> getProfilesByClientId(@RequestBody List<Long> clientIds);
@PostMapping("getCreativeInfoByProfile")  ResultVO<List<MigrationAssetInfo>> getCreativeInfoByProfile(@RequestBody CreativeInfoRequest request);
@PostMapping("getCreativeProductMapping") ResultVO<List<CreativeProductMappingDTO>> getCreativeProductMapping(@RequestBody CreativeInfoRequest request);
```

参数注解(`@RequestBody` / `@RequestParam("x")`)要写全:provider implements 这个接口后,Spring MVC 从接口继承映射和参数绑定。
**接口里的每个方法 provider 都得实现**,所以只放平台确实需要的方法(完整候选清单见 `provider-side.md` 第 8 节)。

## 4. BusinessService (creative-management-api)

```java
@Platform(ProductLines.{PLATFORM})   // 驱动 bean 名, 必须
@Component
@Slf4j
public class {Platform}BusinessService extends BaseBusinessService {

    private final {Platform}FeignClient feign;

    public {Platform}BusinessService({Platform}FeignClient feign) {   // 构造器注入
        this.feign = feign;
    }

    /** 可选依赖用 setter 注入 (required = false), 见 ChatgptBusinessService */

    @Override
    public ResultVO<List<ClientProfileInfo>> getProfilesByClientId(List<Long> clientIds) {
        return feign.getProfilesByClientId(clientIds);   // 必须重写: 基类默认 return null
    }
    // getCreativeInfoByProfile / getCreativeProductMapping: 委托 feign
    // 其余 BusinessService 方法: 委托 feign 或返回空 / ResultVO.FALL
}
```

- **禁止 `@Autowired` 字段注入**:`ArchitectureTest.noFieldInjection` 是冻结规则,新类字段注入会红门禁(`BaseBusinessService` 和老平台类里的字段注入是冻结存量,不要照抄)。基类只有无参构造,子类直接写构造器注入即可。
- **`getProfilesByClientId` 基类默认 `return null`**(不是空列表),不重写迁移拿不到 profile。
- **`getProfileIdsByClientIdAndAdvertiserIds` 不能返回空**:`fillPlatformFilters` 用它补授权 profile,返回空会把整个平台的筛选条件剔掉,列表 / 绩效查不到该平台(见 `ChatgptBusinessService`)。
- `BaseBusinessService` 已有实现的其余方法可不写;编译报 abstract method 缺失就补。
- 本期平台只上部分功能时,未用到的方法返回空 / FALL,在类注释里写清本期范围(同 `ChatgptBusinessService`)。

## 5. Ad Type 登记(AdTypeCatalog)

`Constants.adTypeMap` **已删除**。Ad Type 筛选(Creative 列表 / Dashboard / 素材绩效 / MCP)由
`creative-management-model/.../enums/AdTypeCatalog.java` 权威定义:每个常量是一个可勾选的叶子,
携带它在 CK `DailyCreativeReport_all` 上的查询条件,服务端在 `BaseHandler#fillPlatformFilters` 统一展开。

```java
// AdTypeCatalog(productLine, adType1, adType2, applicableFileTypes, ckCampaignType, ckAdTypes, ckAdCreativeFormatType)
TIKTOK_GMV_MAX("tiktok", "GMV Max", null, fileTypes(FileTypeEnum.Video), "gmv_max", null, null),
TIKTOK_SOCIAL_ADS_SINGLE_VIDEO("tiktok", "Social Ads", "Single Video", fileTypes(FileTypeEnum.Video), "social_ads", List.of("SINGLE_VIDEO"), null),
```

- `ck*` 三个条件取值必须是 **CK 报表里的实际值**(先查 CK 再填),与资产侧 adType 口径一致(gotchas #11)。
- 三个 `ck*` 全为 null 的叶子不会进筛选树(ChatGPT 当前就是这样占位,等上线再填)。
- `AdTypeEnum`(两参构造 `(aiName, dbName)`)只服务创意替换 / AI 规格等功能,**与筛选无关**。只有平台要接这些功能时才加:
  ```java
  SingleVideo("Single Video", "SINGLE_VIDEO"),   // dbName = provider/DB 侧原始值
  ```
  `aiName` 要与 AI 服务 / `asset_requirement_spec.ad_type` 完全一致(大小写、单复数),否则规格查不到。

### 5b. creative 层级(CreativeLevelEnum)

按 adType 定 creativeId 挂在哪一层(对照表见 gotchas #13)。`CreativeLevelEnum` 决定检测对象选择器是否展示第 5 级(Ad/Creative)以及 `adId` 必填还是必须为空:

- AD(默认):creative 独立于 adGroup,`adId` 必填。
- ADGROUP:creative 即 adGroup,`adId` 必须为空。

判定逻辑硬编码在**两处**,要同时改:`CreativeImageSpecService.resolveCreativeLevel`、`CreativeOptimizationHandler.levelOf`。层级是 campaign / video 等两档都不贴切时见 gotchas #25。

## 6. URL 实时解析(按需)

若平台素材 URL 会过期(provider 库里存的 preview_url 失效),在 BusinessService 的 `getCreativeInfoByProfile` 里:provider 只回素材 ID(videoId/imageId),中台按 ID 调平台 SDK Feign 批量补 `assetUrl`,**补不到的剔除并打 warn**(避免下游下载失败)。

参考 `TiktokBusinessService`:分页拉 SDK image/video 列表 → 按 imageId/videoId 填 URL → `assets.removeIf(assetUrl 为空)`。仅当存在该类型资产时才拉对应 SDK 列表(省调用)。

### 6b. URL 过期重取(URL 会过期时需要)

素材入库时 URL 有效,但下载/重试时可能已过期。`AssetMigrationHandler` 有 retry 流程:对 `asset_path` 为空的素材,按 profile 重新拉一次 URL 映射:
- `fetchVideoUrlMapByVideoIds`:按 videoId 分批调 `getCreativeInfoByVideoIds`(避免全量)→ videoId→assetUrl。
- `fetchVideoUrlMapFullProfile`:兜底全量 `getCreativeInfoByProfile`。
- 日终汇总按原因分桶:`noMapping / providerEmpty / noUrl / downloadFailed / processError`。

需要的话按 gotchas #15 的「全链 8 层」给新平台补 `getCreativeInfoByVideoIds`。

## 7. 发布 model + feign

provider 要 implements 第 3 步新建/修改的 Feign 接口,必须先让 provider 能拿到新 jar:

```bash
# 在 creative-management 仓 (.mvn/maven.config 自带 -am, 会带上父 pom, 不碰 api/base)
./mvnw deploy -pl creative-management-model,creative-management-feign -DskipTests
```

- 版本号是滚动快照 `module.deploy.version`(当前 `1.2.16-SNAPSHOT`,platform-provider 根 pom 依赖同一坐标),**覆盖同版本即可,不用升版本**。
- `deploy` 会推到共享仓库,影响所有拉这个快照的人;只想本地验证就把 `deploy` 换成 `install`。
- provider 期望的版本与中台当前版本不同时,加 `-Dmodule.deploy.version=<provider 期望的版本>`。
- 这是硬时序:先发 model+feign,再编 provider。

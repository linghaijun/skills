# 绩效 ETL 交接(12–13)

素材同步(1–11)是我们做的;**绩效、campaign、tag 等数据由 ETL 组用 dbt 灌进 CK**,中台只读不写。
接新平台时我们要交给 ETL 组的产出物是:**按 adType 分支的「平台源表 → CK 目标表」取数 SQL**,外加一份字段对应表。
ETL 没落地前,该平台在 CK 里没有数据:素材能迁过来,但绩效、Ad Type 筛选都是空的。

先例(照着写):`creative-management/docs/develop/26Q3-Sprint6-CP-57189-新增Video 绩效 & PDPV, PDPV Rate/`
- `input/creative hub 绩效 平台与中台 字段对应关系.md`:字段对应表
- `migration/{amazon,dsp,instacart,ticktok,walmart}-migration.sql`:交给 ETL 的 SQL(tiktok 那份最全,含 6 张表)
- `analysis/dailycreativereport_temp 字段新增方案.md`:`DailyCreativeReport` 线上 DDL 与扩列约束

## 两条线在哪里汇合

```
素材线(我们)  provider → 中台 MySQL asset_info / asset_creative_mapping ──CDC──▶ CK asset_info_all / asset_creative_mapping_all ─┐
                                                                                                                        ├─ JOIN (creativeId, productLine, profileId)
绩效线(ETL)   平台源库 ──dbt──▶ CK DailyCreativeReport_all / Campaign_all / CampaignTag_all / CampaignTagCampaign_all ...  ─┘
```

所以交接的核心不是"把数搬过去",而是**两条线对同一个 creative 用同一套键和同一套枚举值**。

## 12a. 收集:先按 adType 拆清楚

同一平台不同 adType 的取数方式经常完全不同(源表、粒度、creativeId 来源都不一样),**必须按 adType 逐个收集,一个 adType 一个 UNION 分支**。先填这张矩阵,每个 adType 一行:

| 字段 | 要回答的问题 | 例:TikTok GMV Max | 例:TikTok Social Ads |
|---|---|---|---|
| 源库 / 方言 | 绩效报表在哪个库,什么方言 | `tiktok`(SQL Server) | 同左 |
| 报表源表 | 哪张日报表 | `dayreportGmvMaxCreative` | `dayreportAd` |
| **creative 层级** | 该 adType 的 creative 在平台挂在哪一层:campaign / adGroup / ad / creative / video / asset | video(无 ad、无 adGroup) | ad |
| creativeId 来源 | 该层的哪个原生 ID;**必须与 provider `getCreativeInfoByProfile`、`CreativeLevelEnum` 同一定义** | `item_id` | `ad_id` |
| 报表粒度 | 绩效日报表是哪一层;**与 creative 层级不同时要上卷或下钻**(见下) | video 级 | ad 级 |
| adGroupId | 平台有没有 adGroup;没有写 `''` | `''` | `adGroupId` |
| adType 写入值 | 固定值 / 取某列 / NULL | NULL | `ad.ad_format` |
| campaignType | `Campaign_all.campaignType` 写什么 | `gmv_max` | `social_ads` |
| lineitemType / adCreativeFormatType | 是否需要它们区分子类型 | lineitemType=`gmv_max` | lineitemType=`social_ads` |
| creativeName 来源 | 名称取自哪张维度表,没有就 `''` | `creative_info.text` | `ad.ad_name` |
| 维度关联 | 补 creativeId / 名称要 join 哪些表,关联键(**带 profileId**) | `creative_info` 按 (advertiser_id, item_id) | `ad` 按 (profile, campaign, adgroup, ad) |
| 指标列来源 | impressions / clicks / spend / sales / orders ... 各取哪列,归因窗口(7d/14d/30d) | `product_impressions` 等 | `impressions` 等 |
| 不支持的指标 | 哪些写 NULL(而不是 0) | 全部 video 列 | 5s |
| version 来源 | 哪个列随数据更新递增 | `updateTime` | `updateTime` |

**creative 层级 ≠ 报表粒度时怎么办**:
- 报表比 creative 粗(如 creative 在 ad 级,但报表只有 adGroup 级):拆不开,只能挂到能对上的层或该 adType 绩效留空。Walmart display 的 video 指标、Amazon STV 都是这个问题,先例 SQL 文件头写明了取舍。**不要按比例摊分**,写清楚后交给产品决定。
- 报表比 creative 细(如 creative 在 adGroup 级,报表在 ad 级):`GROUP BY` 上卷到 creative 层再输出,一个 creativeId 一天只能一行。
- 层级与 adGroupId / campaignId 列的关系:creative 在 campaign 级时 `adGroupId` 写 `''`;在 video 级且没有 adGroup 时同样写 `''`(TikTok GMV Max)。

其他平台的层级对照见 gotchas #13。实际拆法(看先例 SQL):
- **Walmart**:sv(`dayreportAdGroup` + `AdGroupMedia`,creativeId=adgroupMediaId)/ sb(`dayreportAdGroup` + `SbaProfile`,creativeId=sbaProfileId)/ display(`dayreportDisplayCreative`,creativeId=creativeId,无 video 列)三支
- **Amazon**:SB 走 `dayreportAd`(Ad 级,creativeId=adId);SD/STV 走 `dayreportAdgroup`(AdGroup 级,creativeId=adGroupId)
- **Instacart**:单支,`dayreportAdGroup`(creativeId=adGroupId,adType 取 `Campaign_all.golaFormat`);Inspiration 图/视频靠 `adCreativeFormatType` 区分
- **DSP**:单支,`dayreportCampaignByCreative`(天然 creative 粒度),adType=`creativeType`,lineitemType 关联 `dsplineitem`

收集手段:平台源库直接查表结构(mssql / clickhouse / doris MCP),平台 sync / api 仓库源码里的报表 loader(确认某个指标平台到底返不返回),以及 provider 的素材 SQL(确认 creativeId 定义)。**每个结论在 SQL 注释里写明出处**(文件:行号 或 查询),先例都是这样做的。

## 12b. 字段对应表

按平台一节、节内按 adType 分组,三列:**中台字段 | 平台表 | 平台字段**(固定值写「固定值 'xxx'」,没有写「无,写 NULL」)。格式照 `creative hub 绩效 平台与中台 字段对应关系.md`。

## 12c. 写 SQL(模板 `templates/platform-etl-migration.sql`)

文件名 `{platform}-migration.sql`,方言跟源库走(文件头写明)。按 CK 目标表分段:

| 段 | CK 目标表 | 何时需要 | 关键列 |
|---|---|---|---|
| 1 | `Campaign_all` | 必需 | `campaignNo, profileNo, platform, campaignName, campaignType, isActive` —— `campaignType` 就是 `AdTypeCatalog.ckCampaignType` 的来源 |
| 2 | `Profile_all` | 必需 | `platform, profileNo, profileName, isActive` |
| 3 | `CampaignTagCampaign_all` | 平台有 campaign tag 时 | `TagId, CampaignId, Platform, ProfileId` |
| 4 | `AdProduct_all` | 平台有 ad/campaign → product 关系时 | `productNo, profileNo, platform, title, imageUrl, campaignType, campaignNo` |
| 5 | `CampaignTag_all` | 平台有 campaign tag 时 | `TagId, Name, ParentId, UserId, Platform, ClientId, ShareTagId` |
| 6 | `DailyCreativeReport_all` | 必需 | 见下 |

每段都带元数据列 `version`(Int64,随源数据更新递增)、`sign`(固定 1)、`_insert_time`(当前时间)。

**第 6 段 `DailyCreativeReport` 每个 adType 一个分支,`UNION ALL`,所有分支列名、列序、类型完全一致**:

- 维度列:`profileId, productLine, adGroupId, campaignId, creativeId, date, adType, advertiserId, lineitemType, creativeName, year, quarter, month, week, adCreativeFormatType`
- 指标列:`impressions, clicks, spend, sales, orders, saleUnits, sameSKUSales, ntbSales, secondViews`
- CP-57189 新增列:`videoViews, videoFirstQuartileViews, videoMidpointViews, videoThirdQuartileViews, videoCompleteViews, video5SecondViews, video6SecondViews, pdpv`
- 元数据列:`version, sign, _insert_time`

列清单以**线上 DDL** 为准:先 `SHOW CREATE TABLE dbt_prod.dailycreativereport_temp_local`(clickhouse MCP)。仓库快照 `docs/schema/ck.sql` / `ck-dbt_prod.sql` 已落后(缺 `adCreativeFormatType`、`Campaign.currencyCode`、`CampaignTagCampaign.AdvertiserId` 等),只能参考。

## 12d. 自检(交付前逐条过)

1. **creative 层级与 creativeId 一致**:每个 adType 分支的层级、原生 ID 与 provider `getCreativeInfoByProfile`、`getCreativeProductMapping`、中台 `CreativeLevelEnum` 判定同一定义(gotchas #13、#25)。拿一个真实 profile 抽几个 creativeId,两边都查得到。
2. **productLine 写小写存储值**(`ProductLines.value`,如 `tiktok`),profileId 与素材侧同一口径(DSP 注意 profileId / advertiserId 的关系)。
3. **枚举值与 `AdTypeCatalog` 对上**:`Campaign_all.campaignType`、`adType`、`adCreativeFormatType` 写入的字面量,就是第 5 步 `ck*` 要填的值。新平台先在这里定值,两边同一张清单。
4. **不支持写 NULL,不写 0**:NULL 前端显示 `--`,0 会被当成真实值参与汇总和比率。分支间同一列类型要一致(`CAST(NULL AS ...)`)。
5. **排序键里的列不要随意改值**:`DailyCreativeReport` 是 `ReplacingMergeTree(version)`,`ORDER BY (date, profileId, creativeId, productLine, adType, campaignId, adGroupId)`。这几列取值一变,新旧行不折叠、重复计数;要区分新子类型用 `adCreativeFormatType`(不在排序键里)。
6. **version 必须单调递增**:取源表更新时间(秒级时间戳)或源表自带 version。写常量会导致更新永远不覆盖旧行(tag 关联这类无更新时间的表除外)。
7. **维度 join 带 profileId**,一对多的维度先去重(`MAX` / `ROW_NUMBER`),否则绩效行翻倍(同 gotchas #7–9)。
8. **Platform 字面量与 CK 既有数据一致**:`Campaign` / Tag 等表的 `platform` 不是 productLine 小写值,而是 ETL 的平台名(实测 `campaign_temp_v2`:`AMZ Search`、`AMZ DSP`、`Walmart`、`Instacart`、`Samsclub`,新接的 `tiktok` 却是小写);DSP 在 `CampaignTagCampaign_all` 是 `Dsp`、在 `CampaignTag_all` 是 `AMZ DSP`。`DailyCreativeReport.productLine` 才是小写 productLine。新平台和 ETL 组定一个写法,在 SQL 注释写明,join 两类表时注意换算。
9. **待确认项集中写在文件头**(⚠️ 标注),例如归因窗口、sales 是否叠加 halo、creativeName 来源。不确定的不要猜着写成确定的样子。

## 13. 交付与回填

- 交付物:`{platform}-migration.sql` + 字段对应表,放进当前需求目录 `docs/develop/{branch}-{title}-{id}/migration/` 与 `input/`,提交后发给 ETL 组。
- ETL 落地后用真实数据复核:
  ```sql
  SELECT adType, lineitemType, adCreativeFormatType, count()
  FROM pacvue_cross_platform.DailyCreativeReport_all
  WHERE productLine = '{platform}' AND date >= today() - 30
  GROUP BY 1, 2, 3;
  ```
  确认取值与 `AdTypeCatalog` 一致后,再把 `ck*` 填上(没填之前叶子不进筛选树,见 gotchas #12)。
- 抽查关联:拿几个素材的 (creativeId, profileId) 去 `DailyCreativeReport_all` 查,有行才算两条线接通。
- 回归基线用已冻结的历史整月窗口,不要用当月数据(当月 ETL 还在回刷)。
- 用 clickhouse MCP 自查时:`pacvue_cross_platform.*_all` 这类 View 会报 `Cannot modify 'stream_like_engine_allow_direct_select' setting in readonly mode`,改查底层表(`dbt_prod.dailycreativereport_temp`、`dbt_prod.campaign_temp_v2`,或 `pacvue_cross_platform.*_all` 中 engine=Distributed 的)。个人读配额 60s/200GB,全年窗口一条就能打满,按单月查。
- **漏同步的排查方法**(Amazon STV 就是这样查出来的):源库按 adType 统计当月行数/花费 vs CK `DailyCreativeReport` 按同口径统计,源库有量而 CK 为 0 = ETL 没同步该 adType。

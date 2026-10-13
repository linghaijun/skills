-- ============================================================================
-- {Platform} 绩效迁移 SQL(交给 ETL 组)
--
-- 源库:{db}({SQL Server | ClickHouse | Doris})          ← 方言跟源库走,本模板按 SQL Server 写
-- 目标:CK pacvue_cross_platform.*(DailyCreativeReport 落 dbt_prod.dailycreativereport_temp_local)
-- 列清单以线上 DDL 为准:SHOW CREATE TABLE dbt_prod.dailycreativereport_temp_local
-- 字段对应:../input/{platform} 绩效 平台与中台 字段对应关系.md
--
-- adType 矩阵(每个 adType 一个第 6 段分支):
--   | adType    | creative 层级 | creativeId 来源 | 报表源表     | 报表粒度 | adType 写入值 | campaignType |
--   | {adTypeA} | ad            | {ad_id}         | {dayreportX} | ad       | {col / 'x'}   | {a_type}     |
--   | {adTypeB} | video         | {item_id}       | {dayreportY} | video    | NULL          | {b_type}     |
--   creative 层级 ≠ 报表粒度的分支,在这里写明上卷/留空的取舍
--
-- creativeId 定义与 provider getCreativeInfoByProfile 一致:{出处 文件:行号}
--
-- ⚠️ 待确认项:
--   1) {例:sales 是否叠加 halo_sales}
--   2) {例:归因窗口取 14d 还是 30d}
-- ============================================================================


-- 1.Campaign_all  ←  {campaign 表}(按 adType 有多张 campaign 表时 UNION ALL)
--   campaignType 写入值 = AdTypeCatalog.ckCampaignType
SELECT
    CAST(0 AS tinyint)                                            AS id,
    c.{campaign_id}                                               AS campaignNo,
    c.{profile_id}                                                AS profileNo,
    '{platform}'                                                  AS platform,
    c.{campaign_name}                                             AS campaignName,
    '{a_type}'                                                    AS campaignType,
    ISNULL(p.{currency}, '')                                      AS currencyCode,   -- 线上 DDL 有此列,快照没有
    CASE WHEN c.{status} = '{ENABLE}' THEN 1 ELSE 0 END           AS isActive,
    CAST(DATEDIFF(SECOND, '1970-01-01', c.{modify_time}) AS bigint) AS version,
    CAST(1 AS smallint)                                           AS sign,
    GETDATE()                                                     AS _insert_time
FROM {db}.dbo.{campaign} AS c
LEFT JOIN {db}.dbo.{profile} AS p ON p.{id} = c.{profile_id};


-- 2.Profile_all  ←  {profile 表};只放有效 profile,口径与 provider getProfilesByClientIds 一致
SELECT
    CAST(0 AS tinyint)                                            AS id,
    '{platform}'                                                  AS platform,
    p.{id}                                                        AS profileNo,
    p.{name}                                                      AS profileName,
    1                                                             AS isActive,
    CAST(DATEDIFF(SECOND, '1970-01-01', ISNULL(p.{sync_time}, p.{create_time})) AS bigint) AS version,
    CAST(1 AS smallint)                                           AS sign,
    GETDATE()                                                     AS _insert_time
FROM {db}.dbo.{profile} AS p
WHERE {有效条件,如 p.status = 'STATUS_ENABLE' AND p.is_deleted = 0};


-- 3.CampaignTagCampaign_all  ←  {tag-campaign 关联表}(平台无 campaign tag 则删去本段)
SELECT
    tc.TagId                                                      AS TagId,
    tc.CampaignId                                                 AS CampaignId,
    '{platform}'                                                  AS Platform,       -- 字面量与 CampaignTag_all 对齐
    tc.ProfileId                                                  AS ProfileId,
    0                                                             AS AdvertiserId,   -- 线上 DDL 有此列,快照没有
    CAST(1 AS bigint)                                             AS version,
    CAST(1 AS smallint)                                           AS sign,
    GETDATE()                                                     AS _insert_time
FROM {db}.dbo.{TagCampaign} AS tc;


-- 4.AdProduct_all  ←  {campaign/ad} ⨝ {product}(只有存在 product 关系的 adType 才写)
SELECT
    CAST(0 AS tinyint)                                            AS id,
    x.{product_id}                                                AS productNo,
    x.{profile_id}                                                AS profileNo,
    '{platform}'                                                  AS platform,
    pr.{title}                                                    AS title,
    pr.{image_url}                                                AS imageUrl,
    CASE WHEN pr.{status} = '{AVAILABLE}' THEN 1 ELSE 0 END       AS isActive,
    '{b_type}'                                                    AS campaignType,
    x.{campaign_id}                                               AS campaignNo,
    CAST(DATEDIFF(SECOND, '1970-01-01', x.{update_time}) AS bigint) AS version,
    CAST(1 AS smallint)                                           AS sign,
    GETDATE()                                                     AS _insert_time
FROM {db}.dbo.{campaign_product_relation} AS x
LEFT JOIN {db}.dbo.{product} AS pr
       ON pr.{profile_id} = x.{profile_id}                         -- 关联带 profile
      AND pr.{product_id} = x.{product_id};


-- 5.CampaignTag_all  ←  {tag 表}(平台无 campaign tag 则删去本段)
SELECT
    CAST(0 AS tinyint)                                            AS Id,
    ct.Id                                                         AS TagId,
    ct.TagName                                                    AS Name,
    ct.ParentId                                                   AS ParentId,
    ct.UserId                                                     AS UserId,
    '{platform}'                                                  AS Platform,
    ct.ClientId                                                   AS ClientId,
    ct.ShareTagId                                                 AS ShareTagId,
    CAST(DATEDIFF(SECOND, '1970-01-01', ISNULL(ct.LastUpdateTime, ct.CreateTime)) AS bigint) AS version,
    CAST(1 AS smallint)                                           AS sign,
    GETDATE()                                                     AS _insert_time
FROM {db}.dbo.{CampaignTag} AS ct
WHERE ISNULL(ct.IsDeleted, 0) = 0;


-- 6.绩效-DailyCreativeReport_all
--   每个 adType 一个分支,UNION ALL;所有分支列名、列序、类型完全一致。
--   不支持的指标写 CAST(NULL AS ...),不要写 0。
--   排序键列 (date, profileId, creativeId, productLine, adType, campaignId, adGroupId) 定了就别再改取值。

-- ===== 分支 A:{adTypeA} —— creative 层级 {ad},creativeId = {来源} =====
--   报表比 creative 细时在此 GROUP BY 上卷到 creative 层,保证一个 creativeId 一天一行
SELECT
    r.{profileId}                                                 AS profileId,
    '{platform}'                                                  AS productLine,    -- ProductLines.value,小写
    r.{adGroupId}                                                 AS adGroupId,      -- 无 adGroup 写 ''
    r.{campaignId}                                                AS campaignId,
    r.{adId}                                                      AS creativeId,     -- 与 provider 同一定义
    r.[date]                                                      AS [date],
    d.{ad_format}                                                 AS adType,         -- = AdTypeCatalog.ckAdTypes 的值
    CAST(NULL AS nvarchar(40))                                    AS advertiserId,
    '{a_type}'                                                    AS lineitemType,
    d.{name}                                                      AS creativeName,   -- 没有写 ''
    r.[year]                                                      AS [year],
    r.{quarter}                                                   AS quarter,
    r.{month}                                                     AS month,
    r.{week}                                                      AS week,
    r.{impressions}                                               AS impressions,
    r.{clicks}                                                    AS clicks,
    CAST(r.{spend} AS decimal(18,6))                              AS spend,
    CAST(r.{sales} AS decimal(18,6))                              AS sales,          -- 写明归因窗口
    r.{orders}                                                    AS orders,
    CAST(NULL AS bigint)                                          AS saleUnits,
    CAST(NULL AS decimal(18,2))                                   AS sameSKUSales,
    CAST(NULL AS decimal(18,6))                                   AS ntbSales,
    CAST(NULL AS bigint)                                          AS secondViews,
    -- ---------- Video(CP-57189) ----------
    CAST(NULL AS bigint)                                          AS videoViews,
    CAST(NULL AS bigint)                                          AS videoFirstQuartileViews,
    CAST(NULL AS bigint)                                          AS videoMidpointViews,
    CAST(NULL AS bigint)                                          AS videoThirdQuartileViews,
    CAST(NULL AS bigint)                                          AS videoCompleteViews,
    CAST(NULL AS bigint)                                          AS video5SecondViews,
    CAST(NULL AS bigint)                                          AS video6SecondViews,
    -- ---------- PDPV(CP-57189) ----------
    CAST(NULL AS bigint)                                          AS pdpv,
    -- -------------------------------------
    CAST(NULL AS varchar(50))                                     AS adCreativeFormatType, -- 需要区分子类型时才填
    CAST(DATEDIFF(SECOND, '1970-01-01', r.{updateTime}) AS bigint) AS version,      -- 必须随数据更新递增
    CAST(1 AS smallint)                                           AS sign,
    GETDATE()                                                     AS _insert_time
FROM {db}.dbo.{dayreportX} AS r WITH (NOLOCK)
LEFT JOIN {db}.dbo.{ad} AS d
       ON d.{profile_id} = r.{profileId}                          -- 维度 join 带 profile
      AND d.{ad_id}      = r.{adId}

UNION ALL

-- ===== 分支 B:{adTypeB} —— creative 层级 {video},creativeId = {来源} =====
-- 列与分支 A 完全相同,按该 adType 的源表与矩阵填写
SELECT
    ...
FROM {db}.dbo.{dayreportY} AS r WITH (NOLOCK)
...;

-- ============================================================================
-- 源表中与需求相关、但本期未取的列(备查):
--   {dayreportX}:{col1、col2 ...}
-- ============================================================================

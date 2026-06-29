# API Reference Guide

Detailed process for generating API-Reference.md with full SQL documentation.

**语言要求：所有业务逻辑描述、数据来源说明、SQL注释、汇总表格描述列必须使用中文。SQL语句、类名、方法名、路径保持英文。**

## Step-by-Step Process

### Step 1: Scan All Controllers

For each Controller class:
1. Extract `@RequestMapping` / `@RestController` base path
2. List all methods with `@GetMapping` / `@PostMapping` / `@PutMapping` / `@DeleteMapping`
3. Extract method signature, parameter types, return type
4. Read method body to trace the call chain

### Step 2: Trace Call Chain to Handler/Manager

For each controller method:
1. Find the Handler/Manager method it calls
2. Read the Handler/Manager method body completely
3. Identify every Service call, Feign call, AI call, S3 operation
4. Record the exact sequence of operations

### Step 3: Trace Service to Mapper/SQL

For each Service method:
1. If it calls `baseMapper.xxx()` → find the corresponding Mapper XML SQL
2. If it uses `lambdaQuery()` / `lambdaUpdate()` → write pseudo-SQL
3. If it uses `saveBatch()` / `save()` → write INSERT pseudo-SQL
4. If it uses `removeByIds()` → write DELETE pseudo-SQL

### Step 4: Read Mapper XML for Complete SQL

For each Mapper XML file:
1. Copy the complete SQL from `<select>`, `<insert>`, `<update>`, `<delete>` tags
2. Include all dynamic conditions (`<if>`, `<where>`, `<foreach>`)
3. Preserve CTE structures (WITH ... AS)
4. **Never abbreviate with "..."** — always list all columns

### Step 5: Document Each Endpoint

Use this template for each endpoint:

```markdown
### {METHOD} `{path}` - {description}

**业务逻辑**：
1. {Step 1 description}
2. {Step 2 description}
...

**数据来源**：
1. 🗄️ MySQL → `{table}` 表，`{service}.{method}()` {description}
   ```sql
   {complete SQL statement}
   ```
2. 🔗 Feign → `{service}.{method}()` {description}
3. 🤖 AI → `{handler}.{method}()` {description}
4. ☁️ S3 → `{operation}` {description}
5. 💾 Memory → {description}
```

## SQL Documentation Rules

### Rule 1: No Ellipsis
Every SQL must list all columns explicitly.

**Bad**:
```sql
SELECT pacvue_asset_id, origin_id, ... FROM asset_info WHERE ...
```

**Good**:
```sql
SELECT pacvue_asset_id, origin_id, version, client_id, asset_name, file_name,
    file_type, size, dimensions, width, height, file_format, brand, path,
    thumbnail_path, path_code, is_delete, status, source, create_by,
    create_time, update_by, update_time, headlines, objects, focus,
    is_sync, upload_id, duration_seconds, audio_codec, video_codec
FROM asset_info WHERE ...
```

### Rule 2: MyBatis-Plus Pseudo-SQL

For `lambdaQuery()` / `lambdaUpdate()` calls, write equivalent SQL:

| Java Code | Pseudo-SQL |
|-----------|-----------|
| `lambdaQuery().eq(AssetInfo::getPacvueAssetId, id).one()` | `SELECT * FROM asset_info WHERE pacvue_asset_id = ? LIMIT 1` |
| `lambdaUpdate().eq(...).set(brand, val).update()` | `UPDATE asset_info SET brand = ? WHERE ...` |
| `lambdaQuery().in(...).list()` | `SELECT * FROM asset_info WHERE field IN (?)` |
| `saveBatch(list)` | `INSERT INTO asset_info (col1, col2, ...) VALUES (val1, val2, ...)` |
| `lambdaUpdate().in(...).remove()` | `DELETE FROM table WHERE field IN (?)` |

### Rule 3: CTE Queries

Write full CTE with all columns. For the common `ranked_assets` pattern:

```sql
WITH ranked_assets AS (
    SELECT ac.collection_id, ac.is_main,
        ai.pacvue_asset_id, ai.origin_id, ai.version,
        ai.asset_name, ai.file_name, ai.file_type, ai.file_format,
        ai.size, ai.dimensions, ai.brand, ai.path, ai.status, ai.source,
        ai.create_by, ai.create_time, ai.update_by, ai.update_time,
        ai.objects, ai.duration_seconds, ai.thumbnail_path,
        ai.audio_codec, ai.video_codec,
        ROW_NUMBER() OVER (PARTITION BY ai.origin_id ORDER BY ai.version DESC) AS rn
    FROM asset_collection ac
    JOIN asset_info ai ON ac.origin_id = ai.origin_id AND ac.client_id = ai.client_id
    WHERE ai.is_delete = 0 AND ai.client_id = #{clientId}
      -- 动态筛选条件
)
```

### Rule 4: Dynamic Conditions

Use comments for MyBatis dynamic conditions:
```sql
WHERE ai.is_delete = 0 AND ai.client_id = #{clientId}
  -- 动态条件: fileType, collectionIds, tagIds, pacvueAssetIds,
  -- searchKeyword, brands, dimensions, fileFormats, uploadUserIds,
  -- updatedUserIds, pathCodes, 日期范围等
```

### Rule 5: INSERT Statements

List all columns and parameter placeholders:
```sql
INSERT INTO asset_info (pacvue_asset_id, origin_id, version, client_id,
    asset_name, file_name, file_type, size, dimensions, width, height,
    file_format, brand, path, thumbnail_path, path_code, is_delete,
    status, source, create_by, create_time, update_by, update_time,
    headlines, objects, focus, is_sync, upload_id, duration_seconds,
    audio_codec, video_codec)
VALUES (#{pacvueAssetId}, #{originId}, #{version}, #{clientId},
    #{assetName}, #{fileName}, #{fileType}, #{size}, #{dimensions},
    #{width}, #{height}, #{fileFormat}, #{brand}, #{path},
    #{thumbnailPath}, #{pathCode}, 0, #{status}, #{source},
    #{createBy}, NOW(), #{updateBy}, NOW(), #{headlines}, #{objects},
    #{focus}, #{isSync}, #{uploadId}, #{durationSeconds},
    #{audioCodec}, #{videoCodec})
```

## Summary Sections

At the end of API-Reference.md, include three summary tables:

### MySQL Tables Summary
| Table | Purpose | Key Endpoints |
|-------|---------|--------------|
| {table_name} | {description} | {endpoint list} |

### Feign Services Summary
| Target Service | Method | Purpose |
|---------------|--------|---------|
| {service name} | {method}() | {description} |

### AI Capabilities Summary
| Capability | Method | Purpose |
|-----------|--------|---------|
| {capability} | {method}() | {description} |

## Entity-to-Table Mapping

When documenting SQL, read entity classes to get complete field lists. Map Java field names to database column names using `@TableField` annotations. Common patterns:

| Java Field | DB Column (typical) |
|-----------|-------------------|
| camelCase | snake_case |
| `isDelete` | `is_delete` |
| `pacvueAssetId` | `pacvue_asset_id` |
| `createTime` | `create_time` |
| `updateBy` | `update_by` |

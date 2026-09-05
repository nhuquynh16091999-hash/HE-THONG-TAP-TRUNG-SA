---
description: N8N + BigQuery coding rules to prevent data duplication and SQL errors
---

# N8N + BigQuery Data Pipeline Rules

> Mọi developer, AI agent hoặc automation phải tuân thủ các rule này khi edit N8N workflow hoặc BigQuery SQL.

---

## Rule 1: NEVER use WRITE_APPEND without MERGE

❌ **Bad**: `WRITE_APPEND` directly to main table
```
Fetch → Transform → BQ: main_table (WRITE_APPEND)
```
**Risk**: Creates duplicate rows every sync cycle. Spend/revenue/quantity sẽ bị nhân lên theo số lần sync.

✅ **Good**: Staging + MERGE pattern
```
Fetch → Transform → BQ: staging_table (WRITE_TRUNCATE) → MERGE staging → main → TRUNCATE staging
```

### Decision matrix:

| Data Type | Mode | Example |
|-----------|------|---------|
| Snapshot data (stock, catalog, campaign list) | `WRITE_TRUNCATE` | product_stock, warehouse_list, campaign_list, product_template, fb_campaign_data |
| Time-series (ads, orders) | Staging → `MERGE` | fb_ads_data, sale_order, order_items |
| Append-only (true logs) | `WRITE_APPEND` | Chỉ dùng cho event logs thật sự |

---

## Rule 2: MERGE connections MUST be sequential

❌ **Bad**: Nhiều merge chạy song song → cùng trigger Truncate
```
Has Data? → [Merge A, Merge B] → Truncate Staging
```
**Risk**: Nếu A xong trước, staging bị truncate trước khi B chạy xong → B mất data.

✅ **Good**: Sequential chain
```
Has Data? → Merge A → Merge B → Truncate Staging
```

---

## Rule 3: MERGE key = natural unique key

Mỗi MERGE phải dùng natural primary key của table:

| Table | MERGE Key | Rationale |
|-------|-----------|-----------|
| `fb_ads_data` | `ad_id + date` | One row per ad per day |
| `sale_order` | `id + shop_id` | Unique order per shop |
| `order_items` | `item_id + order_id` | Unique item per order |

Luôn thêm dedup trong USING clause:
```sql
USING (
  SELECT * FROM staging_table
  QUALIFY ROW_NUMBER() OVER (PARTITION BY <key> ORDER BY sync_time DESC) = 1
) S
```

---

## Rule 4: Views must use SAFE_ casts

N8N viết mọi thứ là STRING → views phải cast an toàn.

❌ **Bad**:
```sql
PARSE_DATE('%Y-%m-%dT%H:%M:%S', col)  -- %H không dùng cho DATE
CAST(col AS INT64)                      -- Lỗi khi NULL hoặc empty 
WHERE is_hidden = 'false'               -- BOOL ≠ STRING
```

✅ **Good**:
```sql
DATE(SAFE.PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', col))
SAFE_CAST(col AS INT64)
WHERE is_hidden = FALSE  -- hoặc: CAST(is_hidden AS STRING) = 'false'
```

---

## Rule 5: One dataset per project — KHÔNG cross-write

| Project | Dataset | Tag |
|---------|---------|-----|
| Stramark | `STRAMARK_Dataset` | `[STR]` |
| Zen8 | `Zen8_Dataset` | `[ZEN]` |
| AUUS1 | `AUUS1_Dataset` | `[AUUS1]` |
| Hnle | Riêng | `[HNLE]` |
| Pialpha | Riêng | `[PI]` |
| T1 | `Zen8_Dataset` | `[T1]` |
| Trendify | `Zen8_Dataset` | `[TRE]` |

---

## Rule 6: Dedup CTE là defense-in-depth LUÔN CẦN

Dù đã có MERGE ở source, vẫn giữ dedup CTE trong read queries:
```sql
WITH dedup AS (
  SELECT *, ROW_NUMBER() OVER (
    PARTITION BY ad_id, date ORDER BY spend DESC
  ) as rn FROM fb_ads_data WHERE <filter>
)
SELECT ... FROM dedup WHERE rn = 1
```

---

## Rule 7: Naming conventions

| Type | Pattern | Example |
|------|---------|---------|
| Staging tables | `staging_<main_table>` | `staging_sale_order` |
| Main tables | `<entity>` | `sale_order`, `fb_ads_data` |
| Snapshot tables | `<entity>_list` hoặc `<entity>` | `campaign_list`, `product_template` |
| Views | `vw_<purpose>` | `vw_dashboard_overview` |
| N8N workflow | `[TAG] NN description` | `[STR] 02 Ads Sync` |
| Credentials | `[TAG] Service Name` | `[STR] Meta Ads API` |

---

## Rule 8: Khi project mới go-live

Khi deploy workflow cho project mới (ví dụ t1, trendify):
1. Copy pattern từ Stramark (đã fix)
2. Thay `datasetId`, `AD_ACCOUNTS`, `SHOP_IDS`, credential IDs
3. Tạo staging tables trước khi activate workflow
4. Test 1 lần manual trước khi bật schedule

---

## Rule 9: Shared workflows (`_shared/`) cần đặc biệt cẩn thận

Shared workflows ảnh hưởng NHIỀU datasets. Luôn verify:
- Workflow có filter theo `project_id` hay `account_id` không?
- Data ghi đúng dataset chưa?
- Có risk ghi nhầm data của project A vào project B không?

---

## Rule 10: fb_campaign_data và product_template là SNAPSHOT

Hai table này chứa metadata hiện tại (không phải time-series):
- `fb_campaign_data`: Danh sách campaigns hiện tại → `WRITE_TRUNCATE`
- `product_template`: Danh sách sản phẩm hiện tại → `WRITE_TRUNCATE`

**KHÔNG BAO GIỜ** dùng WRITE_APPEND cho snapshot tables.

---

## Checklist trước khi deploy N8N workflow mới

- [ ] Write mode đúng? (TRUNCATE cho snapshot, Staging+MERGE cho time-series)
- [ ] MERGE có đúng natural key?
- [ ] Flow sequential (không parallel) trước Truncate Staging?
- [ ] Tất cả fields đã map trong Transform node?
- [ ] Dataset đúng project?
- [ ] `account_id` / `project_id` có đủ?
- [ ] Staging tables đã tạo trên BQ?
- [ ] Credential IDs đã điền?
- [ ] Test manual 1 lần trước khi bật schedule?

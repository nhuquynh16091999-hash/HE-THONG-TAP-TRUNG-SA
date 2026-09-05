# 📋 FAOS v6 — BIỂU MẪU THIẾT KẾ CHUẨN (STANDARD TEMPLATES)

> **Phiên bản:** 1.0 — 2026-03-02
> **Quy tắc:** Leader **BẮT BUỘC** điền đầy đủ Form tương ứng trước khi ra lệnh cho AI code.
> Boss sẽ review Form này TRƯỚC KHI approve Pull Request.

---

## Cách sử dụng

1. **Copy** template tương ứng vào một file mới trong `docs/designs/[TÊN_DỰ_ÁN]/`
2. **Điền** tất cả các trường (không để trống `___`)
3. **Gửi** cho Boss duyệt qua channel #design-review
4. **Sau khi được Approve** → Copy form đã điền vào AI chat làm context trước khi code

---

## TEMPLATE 1: DATA PIPELINE FLOW

> Sử dụng khi xây pipeline đồng bộ dữ liệu từ nguồn bên ngoài về BigQuery.

```markdown
# 🔄 DATA PIPELINE DESIGN — [TÊN PIPELINE]

## 1. Thông tin chung
- **Dự án:** [AUUS1 / ZEN8 / ___]
- **Người thiết kế:** [Tên Leader]
- **Ngày tạo:** [YYYY-MM-DD]
- **Trạng thái:** [Draft / Pending Review / Approved]

## 2. Nguồn dữ liệu (Source)
- **Hệ thống nguồn:** [Pancake POS / Sapo POS / Meta Ads API / Shopee API / ___]
- **Loại kết nối:** [REST API / Webhook / CSV Export / Database Direct / ___]
- **Authentication:** [API Key / OAuth2 / Bearer Token / ___]
- **API Endpoint / URL:** [https://...]
- **Rate Limit:** [___ requests/phút]
- **Dữ liệu mẫu (paste 1 record JSON):**
```json
{
  "example_field": "example_value"
}
```

## 3. Lịch đồng bộ (Schedule)
- **Tần suất Cronjob:** [Mỗi giờ / Mỗi ngày lúc HH:MM / Mỗi 15 phút / ___]
- **Cron Expression:** [0 8 * * * / ___]
- **Timezone:** [Asia/Ho_Chi_Minh / ___]
- **Window dữ liệu:** [Lấy data ngày hôm qua / 24h gần nhất / Full sync / ___]
- **Estimated data volume:** [___ records/lần sync]

## 4. Xử lý dữ liệu (Transform)
- **Rename/Map fields:** 
  | Field nguồn | Field đích (BigQuery) | Transform |
  |:------------|:---------------------|:----------|
  | `___` | `___` | [Giữ nguyên / Cast to DATE / Convert currency / ___] |
  | `___` | `___` | [___] |
  | `___` | `___` | [___] |

- **Business Logic đặc biệt:**
  - [ ] Lọc bỏ đơn hàng test/hủy
  - [ ] Convert đơn vị tiền tệ (VND → USD / giữ nguyên)
  - [ ] Tính toán derived fields (profit = revenue - cost)
  - [ ] Khác: [___]

## 5. Xử lý trùng lặp (Idempotency)
- **Chiến lược:** [MERGE ON key / DELETE + INSERT / UPSERT / ___]
- **Unique Key:** [order_id / transaction_id / ___]
- **Xử lý khi trùng:** [Ghi đè (UPDATE) / Bỏ qua (SKIP) / Log warning / ___]
- **Dedup window:** [Theo ngày / Theo batch_id / ___]

## 6. Đích (Destination - BigQuery)
- **GCP Project:** levelup-465304
- **Dataset:** [AUUS1_Dataset / ZEN8_Dataset / ___]
- **Tên bảng:** [project_entity, vd: auus1_orders]
- **Partitioning:** [Theo cột ___ / INGESTION_TIME / Không partition]
- **Clustering:** [Theo cột ___ / Không cluster]
- **Expiration:** [Không / ___ ngày]

## 7. Monitoring & Alerting
- **Log đồng bộ ghi vào:** [BigQuery bảng ___ / Console log / ___]
- **Alert khi lỗi qua:** [Telegram / Discord / Email / ___]
- **Retry policy:** [___ lần, mỗi lần cách ___ giây]

## 8. File sẽ tạo
- [ ] `app/projects/[DỰ_ÁN]/sync/[tên_file].py`
- [ ] `sql/[DỰ_ÁN]/tables/[tên_bảng].sql`
- [ ] `config/[DỰ_ÁN]/pipeline_config.yaml`

---
✅ **Approved by Boss:** [Tên] — [Ngày]
```

---

## TEMPLATE 2: DATABASE SCHEMA

> Sử dụng khi thiết kế bảng mới trên BigQuery cho dự án.

```markdown
# 🗄️ DATABASE SCHEMA DESIGN — [TÊN BẢNG]

## 1. Thông tin chung
- **Dự án:** [AUUS1 / ZEN8 / ___]
- **Người thiết kế:** [Tên Leader]
- **Ngày tạo:** [YYYY-MM-DD]
- **Trạng thái:** [Draft / Pending Review / Approved]

## 2. Thông tin bảng
- **Dataset:** [AUUS1_Dataset / ZEN8_Dataset / ___]
- **Tên bảng:** [convention: {project}_{entity}, vd: auus1_orders]
- **Loại:** [Table / Materialized View / External Table]
- **Mô tả:** [Mục đích của bảng trong 1-2 câu]

## 3. Danh sách cột (Columns)

| # | Tên Cột | Kiểu Dữ Liệu | Nullable | Default | Mô Tả |
|:-:|:--------|:-------------|:--------:|:-------:|:-------|
| 1 | `___` | STRING / INT64 / FLOAT64 / DATE / TIMESTAMP / BOOL / ___  | YES/NO | ___ | ___ |
| 2 | `___` | ___ | ___ | ___ | ___ |
| 3 | `___` | ___ | ___ | ___ | ___ |
| 4 | `___` | ___ | ___ | ___ | ___ |
| 5 | `___` | ___ | ___ | ___ | ___ |
| 6 | `___` | ___ | ___ | ___ | ___ |
| 7 | `created_at` | TIMESTAMP | NO | CURRENT_TIMESTAMP() | Thời điểm tạo record |
| 8 | `updated_at` | TIMESTAMP | YES | ___ | Thời điểm cập nhật gần nhất |

## 4. Keys & Constraints
- **Khóa chính (Primary Key):** [Tên cột — BigQuery không enforce PK nhưng cần ghi rõ để logic MERGE]
- **Unique Constraint (logic):** [Tên cột hoặc tổ hợp cột]
- **Foreign Key (logic — reference only):** 
  | Cột | Tham chiếu bảng.cột |
  |:----|:--------------------|
  | `___` | `___.___` |

## 5. Partitioning & Clustering
- **Partition Column:** [___ / Không partition]
- **Partition Type:** [DAY / MONTH / YEAR / INTEGER_RANGE / ___]
- **Clustering Columns:** [Tối đa 4 cột, phân cách bằng dấu phẩy / Không cluster]
- **Lý do chọn partition/cluster:** [___]

## 6. Estimated Volume
- **Records ban đầu (seed):** [___ records]
- **Records mới mỗi ngày:** [~___ records/ngày]
- **Records sau 1 năm:** [~___ records]
- **Avg row size:** [~___ bytes]

## 7. Views liên quan (nếu có)
- **View 1:** `vw_[project]_[tên]` — [Mô tả tóm tắt]
- **View 2:** `vw_[project]_[tên]` — [Mô tả tóm tắt]

## 8. SQL DDL (sẽ được AI generate sau khi approve)
```sql
-- Để AI generate dựa trên schema ở trên
-- KHÔNG tự viết SQL trước khi Form được approve
```

## 9. File sẽ tạo
- [ ] `sql/[DỰ_ÁN]/tables/[tên_bảng].sql`
- [ ] `sql/[DỰ_ÁN]/views/[tên_view].sql` (nếu có)

---
✅ **Approved by Boss:** [Tên] — [Ngày]
```

---

## TEMPLATE 3: UI DASHBOARD COMPONENT

> Sử dụng khi thiết kế component giao diện Dashboard cho dự án.

```markdown
# 🖥️ UI DASHBOARD COMPONENT DESIGN — [TÊN COMPONENT]

## 1. Thông tin chung
- **Dự án:** [AUUS1 / ZEN8 / ___]
- **Người thiết kế:** [Tên Leader]
- **Ngày tạo:** [YYYY-MM-DD]
- **Trạng thái:** [Draft / Pending Review / Approved]

## 2. Component Overview
- **Tên Component:** [PascalCase, vd: DailyRevenueChart]
- **Loại:** [Chart / Table / KPI Card / Form / Filter Panel / ___]
- **Mô tả:** [Component này hiển thị gì, cho ai xem, mục đích gì]
- **Vị trí trên Dashboard:** [Trang nào, section nào, vị trí grid]

## 3. Data Source
- **API Endpoint:** `[GET/POST] /api/[project]/[resource]`
- **Query Parameters:**
  | Param | Type | Required | Default | Mô tả |
  |:------|:-----|:--------:|:-------:|:------|
  | `___` | string/date/number | YES/NO | ___ | ___ |
  | `___` | ___ | ___ | ___ | ___ |

- **Response Schema (mẫu):**
```json
{
  "data": [
    {
      "field_1": "value",
      "field_2": 123
    }
  ],
  "meta": {
    "total": 100,
    "page": 1
  }
}
```

## 4. Thư viện biểu đồ & UI
- **Chart Library:** [Recharts / Chart.js / Nivo / Tremor / ___]
- **Chart Type:** [Line / Bar / Pie / Area / Composed / Table / ___]
- **UI Framework:** [Sử dụng design system có sẵn của dashboard-ui/]

## 5. Hành vi (Behavior)
- **Loading State:** [Skeleton loader / Spinner / Shimmer effect / ___]
- **Error State:** [Alert banner màu đỏ / Toast notification / Retry button / ___]
- **Empty State:** [Message "Chưa có dữ liệu" + icon / ___]
- **Refresh:** [Auto refresh mỗi ___ giây / Manual refresh button / ___]
- **Responsive:** [Desktop only / Responsive (breakpoint: ___px) / ___]

## 6. Tương tác người dùng
- **Filters:** [Date range picker / Dropdown chọn campaign / ___]
- **Drill-down:** [Click vào bar → xem chi tiết / Không / ___]
- **Export:** [Download CSV / Copy to clipboard / Không / ___]
- **Tooltip:** [Hiển thị giá trị khi hover / Không / ___]

## 7. Wireframe (ASCII hoặc mô tả)
```
┌──────────────────────────────────────┐
│  📊 [Tiêu đề Component]     [Filter]│
├──────────────────────────────────────┤
│                                      │
│     [Vùng hiển thị Chart/Table]      │
│                                      │
│                                      │
├──────────────────────────────────────┤
│  Updated: [timestamp]    [Refresh ↻] │
└──────────────────────────────────────┘
```

## 8. File sẽ tạo
- [ ] `app/projects/[DỰ_ÁN]/components/[TênComponent].tsx`
- [ ] `app/projects/[DỰ_ÁN]/hooks/use[TênData].ts` (custom hook)
- [ ] `app/projects/[DỰ_ÁN]/types/[entity].ts` (TypeScript types)

---
✅ **Approved by Boss:** [Tên] — [Ngày]
```

---

## 📌 LƯU Ý QUAN TRỌNG

> [!WARNING]
> - **KHÔNG** tạo bảng trong dataset `STRAMARK_Dataset` — đó là của Core.
> - **KHÔNG** dùng thư viện chart khác ngoài Recharts trừ khi được Boss approve.
> - **KHÔNG** thêm dependency mới vào `package.json` gốc — hỏi Boss trước.
> - Naming convention bảng: `{project}_{entity}` (vd: `auus1_orders`, `zen8_products`)
> - Naming convention view: `vw_{project}_{tên}` (vd: `vw_auus1_daily_revenue`)

---

*Tài liệu thuộc Gói Bàn Giao FAOS v6 — Chief Architect Sign-off: 2026-03-02*

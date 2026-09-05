# Master Prompt: TCE Cost Integration — Phase 2

## NGỮ CẢNH

- **Dự án**: Stramark (P&L Dashboard)
- **Phase**: Phase 2 — FFM Data Sync (TCE Integration)
- **Stack**: Python (sync scripts) → BigQuery → Next.js Dashboard
- **Đang làm**: Phase 1 (EU Shipment API) đã hoàn tất. Chi phí EU Shipment tự động sync hàng ngày vào `ffm_shipments` table. Dashboard đang chạy Hybrid Pattern (actual + estimated).
- **Vấn đề**: TCE không có API. CSV export thiếu chi phí & trạng thái. Cần phương án thay thế.

## YÊU CẦU CHI TIẾT

### Mục tiêu chính
Lấy chi phí fulfillment **thực tế** từ TCE cho từng đơn hàng, đưa vào BigQuery table `ffm_shipments` — thống nhất format với dữ liệu EU Shipment hiện tại.

### Nguồn dữ liệu khả dụng (đã xác minh)

#### Nguồn 1: PDF Deviz (✅ ĐỀ XUẤT — phương án chính)
- **Vị trí**: Email hoặc lưu tại `config/manual_data/TCE Factură/Deviz_*.pdf`
- **Tần suất**: Hàng tuần (từ T2/2026), trước đó cuối tháng
- **Cấu trúc đã parse** (pdfplumber):
  ```
  Columns: ID | Dată | Expeditor(Nume/Țară/Județ/Localitate) | Destinatar(Nume/Țară/Județ/Localitate) | Pachete(Număr/kg) | Preț | Monedă
  ```
- **Dữ liệu mẫu**:
  - Forward: `2099499 | 2026-02-23 | Aurelia Wear | România | București | Mirela Hauca | România | Suceava | 5.32 EUR`
  - Return:  `2100879 | 2026-02-28 | Ana Ciobra | România | Satu Mare | Aurelia Wear | România | București | 3.32 EUR`
- **Nhận diện Stramark**: Filter `Expeditor.Nume = "Aurelia Wear"` (forward) HOẶC `Destinatar.Nume = "Aurelia Wear"` (return)
- **Lưu ý**: Có nhiều team dùng chung account TCE → PHẢI filter "Aurelia Wear" để chỉ lấy đơn Stramark

#### Nguồn 2: TCE Website Scraper (phương án bổ sung/backup)
- **URL**: `https://app.tceholding.ro/tms/consignments/browse`
- **Credentials**: `77795525 / 77795525`
- **Columns trên web**: ID, Prestator, Client, Expeditor, Destinatar, Pachete, Greutate, Servicii, Preț (EUR)
- **Ưu điểm**: Real-time, có thể lấy status đơn
- **Nhược điểm**: Dễ hỏng khi TCE thay đổi UI, cần maintain headless browser

#### Nguồn 3: Factura PDF (tham khảo — không dùng cho per-order)
- **Cấu trúc**: Tổng hợp theo loại dịch vụ (Transport, Fulfillment, Ramburs, Zona Exterioara, Index Combustibil)
- **Dùng để**: Cross-check tổng chi phí, không dùng cho per-order mapping

### Phương án đề xuất: PDF Parser (Primary) + Web Scraper (Optional)

#### Approach A — PDF Parser (ưu tiên ✅)
```
Flow: PDF file (manual upload/email forward) 
  → Python pdfplumber parse 
  → Filter "Aurelia Wear" 
  → Normalize to ffm_shipments schema
  → BigQuery MERGE
```
**Ưu điểm**:
- Ổn định: PDF format ít thay đổi
- Không phụ thuộc internet/website uptime
- Dữ liệu chính xác từ bill chính thức
- Dễ audit (giữ file PDF gốc)

**Nhược điểm**:
- Semi-manual: cần upload/copy PDF vào folder
- Trễ theo lịch nhận bill (hàng tuần)

#### Approach B — Web Scraper (bổ sung nếu cần)
```
Flow: Playwright headless → login TCE → scrape table → filter → BigQuery MERGE
```
**Dùng khi**: Cần chi phí real-time hơn hoặc check status đơn giữa kỳ bill

### Business Rules cần implement

| Rule | Detail |
|------|--------|
| **Forward Order** | Expeditor.Nume = "Aurelia Wear" |
| **Return Order** | Destinatar.Nume = "Aurelia Wear" |  
| **Order ID mapping** | `ID` trong Deviz = AWB của TCE = mã vận đơn trên POS |
| **Return mapping** | Đơn hoàn có 2 AWB trên TCE, POS chỉ có 1 → match theo tên/địa chỉ Expeditor = khách hàng trên POS |
| **Currency** | Preț = EUR (không cần convert BGN như EU Shipment) |
| **VAT** | ✅ CONFIRMED: Deviz CHƯA gồm VAT → cộng 21% (price_incl_vat = price * 1.21) |
| **Multi-team filter** | CHỈ lấy đơn "Aurelia Wear", KHÔNG lấy "Oddiehouse" hay tên khác |
| **Partner tag** | `source = 'TCE'` trong ffm_shipments để phân biệt với EU Shipment |

### Return Order Challenge (⚠️ Complex)
- POS chỉ lưu 1 mã vận đơn (AWB gửi đi)
- TCE tạo AWB mới cho đơn hoàn → không match trực tiếp
- **Giải pháp**: Match đơn hoàn qua tên + địa chỉ khách hàng (Expeditor của đơn hoàn = khách hàng nhận hàng ban đầu)
- ✅ **CONFIRMED**: Nếu không match được → vẫn ghi nhận chi phí + **cảnh báo** số lượng đơn unmatched và tổng chi phí unmatched

## MODULES LIÊN QUAN

| Module | File | Role |
|--------|------|------|
| PDF Parser (NEW) | `sync/stramark/tce_pdf_parser.py` | Parse Deviz PDF → structured data |
| TCE Sync (NEW) | `sync/stramark/tce_sync.py` | Orchestrate parse → filter → BigQuery MERGE |
| EU Shipment Sync | `sync/stramark/eu_shipment_sync.py` | Reference pattern |
| BigQuery Table | `ffm_shipments` | Target table (shared with EU Shipment) |
| SQL View | `vw_ffm_cost_actual` | Aggregated view (auto-picks up new data) |
| Mart View | `mart_performance_master_v5` | Hybrid actual/estimated pattern |
| Dashboard | `ceo-overview-tab.tsx` | Alert banner + P&L display |

## RÀNG BUỘC

- **Schema compatibility**: Output PHẢI match `ffm_shipments` schema (awb, pos_order_id, status, price_excl_vat, price_incl_vat, is_return_shipment, ...)
- **Idempotent**: MERGE by AWB — chạy lại không duplicate
- **Conventions**: Follow `eu_shipment_sync.py` patterns (logging, error handling, BQ client)
- **Timeline**: TCE sẽ phase-out vào T4/2026 → không cần over-engineer, nhưng cần chính xác
- **Security**: Credentials đã lưu trong KI, không hardcode

## ACCEPTANCE CRITERIA

- [ ] Parse được tất cả file `Deviz_*.pdf` hiện có trong folder `TCE Factură`
- [ ] Filter chính xác chỉ đơn "Aurelia Wear" (forward + return)
- [ ] Mỗi đơn forward có: AWB (=ID), date, cost (EUR), is_return=false
- [ ] Mỗi đơn return có: AWB, date, cost (EUR), is_return=true, attempt mapping to original order
- [ ] Data MERGE vào `ffm_shipments` không duplicate
- [ ] Dashboard P&L reflect chi phí TCE thực tế (giảm đơn "estimated")
- [ ] Cross-check: Tổng chi phí parsed ≈ tổng trên Factura PDF tương ứng

## VERIFICATION

### Automated
1. Parse tất cả Deviz PDF → đếm số đơn → so sánh với manual count
2. Tổng Preț parsed từ Deviz vs tổng trên Factura tương ứng (sai lệch < 1 EUR)
3. Sau MERGE: query `ffm_shipments WHERE source='TCE'` → đếm records

### Manual
1. Chọn 5 đơn ngẫu nhiên từ Deviz → kiểm tra trên website TCE → xác nhận cost khớp
2. Dashboard: Xem FFM alert banner — số đơn "estimated" phải giảm
3. User verify P&L tổng hợp hàng tháng khớp với bill TCE

## CÂU HỎI CẦN XÁC NHẬN TRƯỚC KHI CODE

> [!NOTE]
> **Tất cả 4 câu hỏi đã được user xác nhận (2026-03-06):**
> 1. ✅ **VAT**: Deviz CHƯA gồm VAT → cộng 21%
> 2. ✅ **Filter**: CHỈ "Aurelia Wear". Bỏ qua Sorina, Sophia, Oddiehouse
> 3. ✅ **Workflow**: Copy PDF vào folder → chạy script
> 4. ✅ **Unmatched returns**: Vẫn ghi nhận chi phí + cảnh báo số lượng & tổng chi phí unmatched

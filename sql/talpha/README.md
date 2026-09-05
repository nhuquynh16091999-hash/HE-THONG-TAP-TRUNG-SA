# TALPHA Analytics — Bộ view phân tích tùy chỉnh

Phiên bản tùy chỉnh của "lớp thông minh" v6 (STRAMARK) cho **TALPHA**
(`cty-507710.TALPHA_Dataset`, 7 shop: SA/AE/KW/OM/QA/BH + TW).

Mục tiêu: nâng TALPHA từ "kho dữ liệu + dashboard" lên có **dual-ROAS COD,
momentum, BCG lifecycle, creative fatigue, bảng phong thần marketer** —
nhưng viết lại cho đúng schema thật của TALPHA (khác hẳn STRAMARK).

## Kiến trúc 3 lớp

```
LỚP 0 — ADAPTER (chuẩn hoá quirks của TALPHA)
  01 vw_fb_ads_std       date_start→DATE, actions_*→INT64, suy frequency, ctr_calc
  02 vw_orders_std       FX→VND theo shop_label (có TW 800), /100 minor units, cờ status, attribution, COGS, marketer

LỚP 1 — DAILY FACT
  03 vw_fact_daily_pnl       P&L cấp project/ngày (dual revenue + net_profit)
  04 vw_fact_daily_marketer  P&L cấp marketer/ngày (spend gán qua ad_marketer)

LỚP 2 — INTELLIGENCE  ← "phần hay nhất"
  05 vw_daily_momentum       MA3/MA7 + UPTREND/DOWNTREND + phantom warning
  06 vw_marketer_momentum    Bảng Phong Thần (KEO_SO/ON_DINH/DOT_TIEN) + efficiency
  07 vw_campaign_lifecycle   BCG (STAR/CASH_COW/DOG/QUESTION) + scale_eligible
  08 vw_creative_fatigue     DEAD_CREATIVE / SATURATED / WEARING_OUT
```

Mỗi view dùng placeholder `{PROJECT}` / `{DATASET}` — deploy script thay từ `.env`.

## Deploy

```bash
# Xem kế hoạch (không cần BigQuery)
python sql/talpha/deploy_talpha_analytics.py

# Deploy thật (chỉ CREATE OR REPLACE VIEW — KHÔNG ghi/xoá dữ liệu)
python sql/talpha/deploy_talpha_analytics.py --execute --verify
```

## Khác biệt chính so với bản STRAMARK (vì sao phải viết lại)

> Lưu ý: bảng `fb_ads_data` **live** của TALPHA đã ở schema chuẩn (có
> `date` DATE, `frequency`, `leads`, `purchases`) — legacy DDL
> (`date_start`/`actions_*` STRING) đã lỗi thời. Khác biệt thật còn lại:

| Vấn đề TALPHA | STRAMARK | Cách xử lý ở đây |
|---|---|---|
| ids ads (ad/adset/campaign) là INT64 | STRING | `CAST … AS STRING` để JOIN với orders |
| Đa tiền tệ GCC+TW, minor units | 1 tiền tệ | `/100 × FX→VND theo shop_label` trong `vw_orders_std` |
| Trạng thái = `status_category` | giống | dùng `GIAO_THANH_CONG` làm "đã giao" |
| Marketer nằm trên ĐƠN, không trên ads | có view marketer sẵn | heuristic `ad_marketer` |
| Product-mapping chưa ổn định | có `ads_daily` product-level | BCG chạy ở **cấp campaign** |
| Doanh thu confirmed không có cột `prepaid` | có | proxy `cod`→`total_price` |

## Giả định & Giới hạn đã biết (đọc trước khi tin số)

1. **Doanh thu confirmed = `cod` (nếu >0) hoặc `total_price`.** Sync hiện
   **không** ghi cột `prepaid` riêng → đây là proxy để không bỏ sót đơn
   prepaid (cod=0). Khi sync bổ sung `prepaid`, sửa `revenue_local_minor`
   trong `02_vw_orders_std.sql`.
2. **`ads_spend` giữ NGUYÊN VND từ Meta** (mọi ad account billed VND —
   team VN chạy). Rule CEO: spend KHÔNG ÷100, KHÔNG quy đổi. Doanh thu
   cũng quy về VND theo shop_label → ROAS cùng đơn vị. `spend_vnd_raw`
   giữ lại cho tương thích ngược (= `spend`). ⚠️ Nếu có account billed
   khác VND (USD/AED…) cần bảng `account → currency`.
3. **Tỷ giá VND hardcode** theo rule CEO (`docs/TALPHA_METRIC_RULES.md`):
   AE 7010 · SA 6850 · KW 83000 · OM 66700 · QA 7050 · BH 68000 · TW 800.
   Cập nhật khi tỷ giá đổi — nguồn gốc `config/projects/talpha.yaml`.
4. **BCG ở cấp campaign**, chưa cấp sản phẩm (chờ `ads_product_mapping` đủ
   tin cậy). Khi mapping ổn, thêm product_code vào `vw_campaign_lifecycle`.
5. **Ngưỡng** ROAS (3.0/2.5/1.3) và frequency (2.5) chỉnh trực tiếp trong
   file view 05/07/08 nếu biên lợi nhuận GCC khác giả định.
6. Shop **QA/BH** chưa có API key, **SA** lỗi 500 chập chờn → dữ liệu các
   market này có thể thiếu (giới hạn từ tầng sync, không phải view).

## Chưa bao gồm (theo phạm vi đã chốt: chỉ view phân tích)

- `ai_prediction_log`, `ai_pattern_library` (nền tảng AI tự học) — thêm
  sau khi TALPHA nối vào `faos_brain` agent.

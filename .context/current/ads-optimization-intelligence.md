# Master Prompt — FAOS Ads Optimization Intelligence (Final v6)

> **Status**: Production — M1+M2+M3 Complete  
> **Template**: STRAMARK first → replicate to other projects  

---

## NGỮ CẢNH
- **Dự án**: FAOS v6 — FB Ads Optimization cho COD e-commerce
- **Stack**: Python (faos_brain/) + BigQuery + FalkorDB + GPT-4o + Telegram
- **Template**: STRAMARK → AUUS1, TALPHA, T1, zen8, hnle, trendify

## SCOPE DEFINITION (v6)

### ✅ Thuộc module Ads Optimization:
- Spend → Clicks → Đơn hàng tạo mới → Revenue* (giá trị đơn tạo)
- ROAS* = Revenue đơn tạo / Spend (gần realtime)
- CPO = Spend / Số đơn tạo mới
- AI recommendation: PAUSE / REDUCE / MONITOR / KEEP / SCALE
- Content DNA: phân tích creative_type, marketer, creative_id
- Pattern Learning: mỗi ngày AI học thêm patterns mới

### ❌ KHÔNG thuộc module này (→ Operations module):
- Giao hàng thành công / thất bại
- Tỷ lệ hoàn (return rate)
- Doanh thu thực (confirmed delivery revenue)

## 3 MODULES

| # | Module | Mô tả | Status |
|---|--------|-------|--------|
| **M1** | 📡 SYNC DATA | BQ ETL (HOT/WARM/COLD/ONCE) | ✅ Production |
| **M2** | 🧠 AI PHÂN TÍCH | GPT-4o → Telegram + Dashboard JSON | ✅ Production |
| **M3** | 📚 AI HỌC HỎI | Pattern Engine → BQ + FalkorDB → JSON | ✅ Production |

## CRON SCHEDULE
```
*/30 * * * *  HOT sync (BQ ETL, free)
0 */6 * * *   WARM sync (Meta API: video)
0 5 * * *     COLD sync (revenue from orders)
30 5 * * *    ONCE sync (creative metadata)
0 6 * * *     M2: GPT-4o → Telegram + JSON
30 6 * * *    M3: Pattern Learning → BQ + FalkorDB + JSON
```

## KEY METRICS
| Metric | Ý nghĩa | Note |
|--------|---------|------|
| **Đơn hàng** | Tổng đơn tạo mới từ ads | Từ sale_order |
| **CPO** | Chi phí / đơn | Spend / Đơn |  
| **Revenue*** | Giá trị đơn tạo mới | ⚠️ Chưa phải doanh thu thực |
| **ROAS*** | Revenue* / Spend | ⚠️ ROAS tạm, dùng để tối ưu nhanh |
| **CTR** | Click / Impression | Computed from raw data |
| **Win Rate** | % ads có ROAS ≥ target | Per marketer/creative |

## OPERATIONAL RULES
1. ✅ MERGE key = report_date + ad_id → zero duplicates
2. ✅ Revenue = ALL orders created (not delivered)
3. ✅ CTR/CPM/CPC computed from clicks/impressions/spend (not raw nullable)
4. ✅ LEARNING mode: < 7 days = observe only
5. ✅ Pattern validation: ≥ 3 occurrences = validated
6. ✅ Human-in-the-loop: RECOMMEND_ONLY

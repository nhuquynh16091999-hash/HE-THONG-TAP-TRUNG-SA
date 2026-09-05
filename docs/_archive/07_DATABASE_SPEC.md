# FAOS Database Specification

> **Version**: 3.0 | **Confirmed**: 2026-02-15
> **Áp dụng cho**: ALL projects (STRAMARK, AUUS1, future)

---

## 1. Business Flow

| Kênh | Flow | Ad Match |
|---|---|---|
| **Web (CĐ)** | Ads → Web → Order → Call → Ship → Deliver → COD | `adset_id` |
| **Mess** | Ads → Chat → Confirm in chat → Ship → Deliver → COD | `ad_id` |

## 2. Status Mapping

> ⚠️ Updated 2026-02-19 based on actual POS data.

| Code | Name | Group | Revenue Level |
|---|---|---|---|
| 0 | new | `new` | — |
| 1 | confirmed | `confirmed` | — |
| 2,4,5,11 | picking/packing/packed/waitting | `processing` | — |
| 3 | shipping | `shipping` | L2 Gửi đi |
| **6** | **delivered** | **`success`** | **L3 Thành công** |
| **16** | **completed** | **`success`** | **L4 3PL trả tiền** |
| 8 | cancelled | `cancelled` | — |

> Dashboard filter theo `status_group` (success/cancelled), KHÔNG phải `status_name`.

**P&L = DT L3 (success) - Ads - COGS - Shipping - FFM**

## 3. Campaign Naming Convention

```
DD.MM - PRODUCT_CODE - MARKET - TYPE - BRAND - MKTER_CODE [- note]
```

- `PRODUCT_CODE` = `custom_id` trên Poscake (D04, V03, L23...)
- `MKTER_CODE` = viết tắt mkter (TA, LC, TÚ, Lệ)
- `TYPE` = CĐ (web) hoặc Mes (messenger)

## 4. Marketer

Raw field `sale_order.marketer` = **JSON dict**. Extract:
```sql
JSON_EXTRACT_SCALAR(marketer, '$.name')
```

Mapping table `dim_marketer_mapping`:

| raw_name | campaign_code | id | full_name |
|---|---|---|---|
| Tuan Tum | TA | ANHNT | Nguyễn Tuấn Anh |
| Kim Tu | TÚ | TUKT | Kim Thanh Tú |
| Linh Chi | LC | CHIPTL | Phạm Thị Linh Chi |
| Trần Cẩm Lệ | Lệ | LETC | Trần Cẩm Lệ |
| Cẩm Lệ | Lệ | LETC | Trần Cẩm Lệ |

## 5. Product

- P&L gộp theo **product_id** (template), KHÔNG tách variation
- Ads cost → per order. COGS → per product
- Ad→Product: parse `campaign_name` segment 2 → match `product_template.custom_id`

## 6. Currency

- **STRAMARK**: Poscake lưu BANI (1/100 RON) → **PHẢI chia 100** (16900 = 169 RON)
- **Zen8/AUUS1**: Giá thẳng USD → **KHÔNG chia 100**
- Ads: per ad account (hầu hết USD). Quy đổi via `cost_exchange_rates`
- P&L quy đổi ads → project currency (USD→RON = 4.6)

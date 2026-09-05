# Poscake POS API — Field Mapping Reference

> **CRITICAL**: Poscake uses DIFFERENT field names than what column names suggest.
> Always verify data by dumping ALL fields from the API response.

## API Base
- URL: `https://pos.pages.fm/api/v1`
- Auth: `?api_key=<token>`
- Shop: `/shops/{shop_id}/...`

## Product Variations (`/shops/{id}/products` → `data[].variants[]`)

### Giá vốn / Cost Price
| ❌ Field (WRONG) | Giá trị | ✅ Field (CORRECT) | Giá trị |
|---|---|---|---|
| `imported_price` | `0` | **`average_imported_price`** | `5181` (bani) |
| `avg_imported_price` | N/A | **`last_imported_price`** | `5181` (bani) |
| `cost_price` | N/A | | |

**Đơn vị**: Bani (RON × 100). Chia 100 để ra RON. Ví dụ: 5181 = 51.81 RON.

### Tồn kho / Stock Quantity
| ❌ Field (WRONG) | Giá trị | ✅ Field (CORRECT) | Giá trị |
|---|---|---|---|
| `stock_quantity` | `None` | **`variations_warehouses[].actual_remain_quantity`** | `3` |
| `quantity` | N/A | | |
| `on_hand` | N/A | | |

**Lưu ý**: Stock nằm trong **nested array** `variations_warehouses`, mỗi warehouse có `actual_remain_quantity`. Cần SUM tất cả warehouses.

### Giá bán lẻ / Retail Price
| Field | Giá trị | Đơn vị |
|---|---|---|
| `retail_price` | `16900` | Bani (÷100 = 169 RON) |
| `retail_price_after_discount` | `16900` | Bani |

### Các field khác hữu ích
| Field | Mô tả |
|---|---|
| `display_id` | Mã hiển thị (SKU) |
| `total_purchase_price` | Tổng giá nhập lịch sử |
| `barcode` | Mã vạch (dùng cho scan kho) |
| `supplier_product_ids` | ID nhà cung cấp |

## Sale Orders (`/shops/{id}/orders`)

### Giá / Prices
- `total_price`: Tổng giá sản phẩm (bani, KHÔNG bao gồm ship)
- `shipping_fee`: Phí ship khách trả (bani)

### Order Items
- `avg_imported_price`: Giá vốn tại thời điểm đặt hàng (bani) — thường = 0 nếu POS chưa nhập
- `retail_price`: Giá bán lẻ tại thời điểm đặt (bani)
- `variation_id`: UUID biến thể

## Warehouses (`/shops/{id}/warehouses`)
- Trả về danh sách kho
- Stock endpoints (`/stocks`, `/inventories`) trả 404 — stock nằm trong product variants

## Bài học (Lessons Learned)
1. **Không bao giờ kết luận "POS không có data"** chỉ vì BQ table hiện 0
2. **Luôn dump ALL fields** từ API response để tìm đúng field name
3. **Kiểm tra nested objects** — stock/cost có thể nằm trong array con
4. **COALESCE(0, ...)** không skip 0, chỉ skip NULL — dùng `NULLIF(..., 0)` trước
5. **COGS chỉ tính cho success orders** — không đếm returned/cancelled

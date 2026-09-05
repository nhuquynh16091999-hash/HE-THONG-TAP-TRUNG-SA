-- ═══════════════════════════════════════════════════════════════════
-- TALPHA Analytics — 00 · vw_product_catalog_std  (LỚP 0: ADAPTER)
-- ═══════════════════════════════════════════════════════════════════
-- E2 — chuẩn hoá `product_catalog` để tra giá vốn không bị trượt.
--
-- VẤN ĐỀ (X4): cột `sku` do POS trả về có dòng chứa TÊN sản phẩm hoặc
-- biến thể thay vì mã, nên cùng 1 SP tách thành nhiều dòng doanh thu và
-- tra giá vốn trượt. Đo 04/08/2026 trên product_catalog (334 dòng):
--     sku='Necklace box'  → thực ra là 008  (tên SP "008 - Necklace box")
--     sku='eye oil'       → thực ra là 009  (tên SP "eye oil - 009")
--     sku='HEART KEY'     → thực ra là 075
--     sku='Clear Sight'   → thực ra là 171
--     sku='195 M GRAY' / '195 XL Blue' / … (12 biến thể) → đều là 195
--
-- CÁCH CHUẨN HOÁ — 4 bậc, dừng ở bậc đầu tiên ra kết quả:
--   1. sku thô đã đúng dạng mã (2–4 chữ số, hoặc 2–4 chữ IN HOA như KNK/BYL)
--   2. sku dạng "195 M GRAY" → lấy 3 chữ số ở đầu
--   3. mã ở ĐẦU tên SP:  "008 - Necklace box"
--   4. mã ở CUỐI tên SP: "eye oil - 009", "Clear Sight - EYE HEALTHY - 171"
-- Không ra mã ở cả 4 bậc (SP TEST, "Mermaid Tail Necklace"…) → giữ nguyên
-- sku thô để dòng doanh thu không biến mất, nhưng `has_sku_code` = FALSE
-- và `sku_code` = NULL → KHÔNG bao giờ tra nhầm giá vốn.
--
-- ▸ Chỉ dùng 3 chữ số (không phải {2,4}) khi bóc mã từ chuỗi tự do: mã thật
--   của TALPHA đều 3 ký tự, nới rộng sẽ nuốt nhầm số trong tên ("Feng Shui 2").
--
-- Nguồn: {PROJECT}.{DATASET}.product_catalog (dimension, WRITE_TRUNCATE từ POS)
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW `{PROJECT}.{DATASET}.vw_product_catalog_std` AS
WITH norm AS (
    SELECT
        variation_id,
        product_id,
        sku                                                 AS sku_raw,
        product_name,
        variation_name,
        shop_label,
        retail_price,
        remain_quantity,
        image,
        COALESCE(
            REGEXP_EXTRACT(UPPER(TRIM(sku)), r'^([0-9]{2,4}|[A-Z]{2,4})$'),
            REGEXP_EXTRACT(TRIM(sku), r'^([0-9]{3})[^0-9]'),
            REGEXP_EXTRACT(TRIM(product_name), r'^([0-9]{3})\s*[-–]'),
            REGEXP_EXTRACT(TRIM(product_name), r'[-–]\s*([0-9]{3})\s*$')
        )                                                   AS sku_code
    FROM `{PROJECT}.{DATASET}.product_catalog`
)
SELECT
    variation_id,
    product_id,
    sku_raw,
    sku_code,                                                   -- NULL = không suy ra được mã
    (sku_code IS NOT NULL)                     AS has_sku_code,
    -- Khoá gom nhóm cho mọi báo cáo theo SP: ưu tiên mã, không có thì giữ sku thô.
    COALESCE(sku_code, NULLIF(TRIM(sku_raw), ''), '(không mã)') AS sku,
    product_name,
    variation_name,
    shop_label,
    retail_price,
    remain_quantity,
    image
FROM norm;

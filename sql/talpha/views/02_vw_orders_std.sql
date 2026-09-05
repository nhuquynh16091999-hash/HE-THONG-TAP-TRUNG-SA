-- ═══════════════════════════════════════════════════════════════════
-- TALPHA Analytics — 02 · vw_orders_std  (LỚP 0: ADAPTER)
-- ═══════════════════════════════════════════════════════════════════
-- Chuẩn hoá sale_order của TALPHA về 1 grain "1 dòng = 1 đơn" với:
--
--   • order_date          : ngày theo TZ của ad account (POS day = Meta day).
--                           inserted_at là UTC naive → đổi sang tz account rồi lấy DATE.
--   • revenue_vnd         : DOANH THU quy về VND theo tỷ giá shop_label
--   • cogs_vnd            : giá vốn (VND) — xem khối GIÁ VỐN bên dưới
--   • cogs_coverage       : 0..1 — tỷ lệ SỐ LƯỢNG item trong đơn đã khai giá vốn
--   • fee_*_vnd           : các phí quy về VND
--   • is_valid/confirmed/returned : cờ trạng thái (dựa status_category)
--   • resolved_ad_id / resolved_adset_id : attribution về ads
--   • marketer_name       : tách tên marketer (cột gốc là JSON string)
--
-- ▸ QUY ƯỚC TIỀN (rule CEO — docs/TALPHA_METRIC_RULES.md):
--   Mỗi shop lưu tiền theo đơn vị RIÊNG. 6 shop GCC lưu MINOR UNITS → chia 100
--   (cod=9900 ⇒ 99,00 SAR); shop Đài lưu NGUYÊN TWD → chia 1 (cod=950 ⇒ 950 TWD).
--   Ước số chia sinh từ `markets.*.pos_money_divisor` trong config/talpha_rules.json.
--
--   ⚠ X13 (20/08): view từng chia 100 cho MỌI shop ⇒ tiền Đài tụt đúng 100 lần
--   (154 đơn GTC ra 1,38tr VND, AOV 8.987đ trong khi 6 market kia 0,8–1,05tr).
--   Ground truth POS API: đơn TW id=336 có cod=950 cho 1 Birthstone Set + 1 BOX —
--   950 TWD (~760k VND), không phải 9,50 TWD. 298/301 đơn TW có cod KHÔNG chia hết
--   cho 100 (950 · 1.390 · 999 · 1.499 · 6.999) trong khi GCC gần như luôn chia hết.
--   KHÔNG hạ tỷ giá 800 để "chữa" — tỷ giá TWD→VND thật là 780–800, nó đúng.
--
--   Tỷ giá quy về VND theo shop_label — 7 thị trường CÓ Taiwan (800).
--
-- ▸ DOANH THU "confirmed" = cod + prepaid của đơn đã giao.
--   sale_order live KHÔNG sync cột `prepaid` riêng ⇒ suy proxy:
--     revenue_local = cod nếu cod > 0  (đơn COD),
--                     ngược lại total_price  (đơn prepaid, cod = 0).
--   → không bỏ sót doanh thu của đơn trả trước.
--
-- ▸ GIÁ VỐN (E2 — sửa lỗi X5 "cogs_vnd luôn = 0"):
--   Bản cũ tính COGS = SUM(order_items.avg_imported_price × quantity). POS KHÔNG
--   trả giá vốn cấp item (avg_imported_price = 0 ở TOÀN BỘ dòng, đã verify bằng
--   POS API live) ⇒ cogs_vnd luôn 0, ai query thẳng view sẽ tưởng lãi = doanh thu.
--   Đồng thời tab "P&L theo SP" lại tính COGS riêng từ config/talpha_rules.json
--   ⇒ HAI định nghĩa COGS song song, một cái đã chết.
--
--   Nay view dùng CHUNG một nguồn với tab: bảng giá vốn/unit (VND) sinh từ
--   config/talpha_rules.json lúc deploy — xem product_costs_sql() trong
--   sql/talpha/deploy_talpha_analytics.py. KHÔNG sửa giá vốn trong file này.
--   Tra theo `sku_code` đã chuẩn hoá của vw_product_catalog_std (lỗi X4).
--
--   ⚠ cogs_vnd là GIÁ VỐN TỪNG PHẦN — chỉ cộng item có SKU đã khai giá vốn.
--   Luôn đọc kèm `cogs_coverage` (0..1, theo SỐ LƯỢNG item): coverage = 0.4 nghĩa
--   là 60% số lượng hàng trong đơn chưa khai giá vốn ⇒ lãi gộp tính ra sẽ ẢO CAO.
--   Đo 04/08/2026: mới 24,0% doanh thu cấp SP có giá vốn. Không đưa lãi gộp toàn
--   hệ ra quyết định khi coverage còn thấp — khai thêm giá vốn trước.
--
-- ▸ cogs_vnd đã là VND (giá vốn khai bằng VND) — KHÔNG nhân fx_vnd như các cột tiền
--   khác vốn xuất phát từ tiền địa phương thô của POS.
--
-- ▸ status_category (do sync map từ status_name):
--     GIAO_THANH_CONG = đã giao   | DON_HOAN = hoàn
--     HUY = huỷ | DON_THO = đơn thô/nháp (chưa tính là cầu thực)
--
-- Nguồn: {PROJECT}.{DATASET}.sale_order + order_items
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW `{PROJECT}.{DATASET}.vw_orders_std` AS
WITH product_costs AS (
    -- Giá vốn/unit (VND) theo SKU — SINH TỰ ĐỘNG từ config/talpha_rules.json mục
    -- `products` lúc deploy. Sửa giá vốn ở rules file, KHÔNG sửa ở đây.
    SELECT * FROM UNNEST([{PRODUCT_COSTS}])
),
items_cogs AS (
    -- Giá vốn theo đơn (VND). SKU chưa khai giá vốn KHÔNG bị coi là 0 — nó bị loại
    -- khỏi cả tử số (cogs) lẫn tử số của coverage, để coverage nói đúng độ tin cậy.
    -- Khoá là (shop_id, order_id): POS đánh số đơn RIÊNG từng shop nên order_id 18 tồn
    -- tại ở cả 7 shop (05/08: 20.257 id dùng chung). Gom theo mình order_id là cộng giá
    -- vốn của những đơn KHÁC NHAU vào nhau.
    SELECT
        i.shop_id,
        i.order_id,
        SUM(IF(pc.sku IS NULL, 0, pc.cost_price_vnd * COALESCE(i.quantity, 0))) AS cogs_vnd,
        SAFE_DIVIDE(
            SUM(IF(pc.sku IS NULL, 0, COALESCE(i.quantity, 0))),
            SUM(COALESCE(i.quantity, 0))
        )                                                                       AS cogs_coverage
    FROM `{PROJECT}.{DATASET}.order_items` i
    LEFT JOIN `{PROJECT}.{DATASET}.vw_product_catalog_std` c
           ON i.variation_id = c.variation_id
    LEFT JOIN product_costs pc ON c.sku_code = pc.sku
    GROUP BY i.shop_id, i.order_id
),
ad_tz AS (
    -- ad_id → timezone của ad account. Meta báo cáo insight theo tz này nên đơn POS
    -- phải gom NGÀY khớp tz đó (POS day = Meta day). inserted_at của Pancake là UTC.
    -- Map account_id → IANA tz lấy từ Meta API (tĩnh); đơn không có ad_id → mặc định VN +7.
    SELECT ad_id_str, ANY_VALUE(tz) AS tz
    FROM (
        SELECT
            CAST(ad_id AS STRING) AS ad_id_str,
            -- SINH TỰ ĐỘNG từ config/projects/talpha.yaml (ad_account_timezones).
            -- Thêm TKQC = khai múi giờ ở yaml rồi deploy lại view, KHÔNG sửa tay ở đây.
            {AD_TZ_CASE} AS tz
        FROM `{PROJECT}.{DATASET}.fb_ads_data`
        WHERE ad_id IS NOT NULL
    )
    GROUP BY ad_id_str
),
base AS (
    SELECT
        o.id                                                AS order_id,
        -- Khoá DUY NHẤT TOÀN HỆ THỐNG. `order_id` một mình KHÔNG duy nhất — POS đánh số
        -- riêng từng shop, id=18 có ở cả 7 shop. Mọi COUNT(DISTINCT ...) / dedupe / JOIN
        -- ở tầng trên PHẢI dùng `order_uid`, dùng `order_id` là đếm thiếu.
        CONCAT(o.shop_label, '-', o.id)                     AS order_uid,
        o.shop_id,
        o.shop_label,
        o.order_currency,
        -- Gom ngày theo tz của ad account (POS day = Meta day). inserted_at = UTC naive.
        DATE(
            SAFE.PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', REPLACE(TRIM(o.inserted_at), ' ', 'T')),
            COALESCE(atz.tz, 'Asia/Ho_Chi_Minh')
        )                                                   AS order_date,
        o.status_category,
        o.status_name,

        -- Tỷ giá quy về VND theo market (1 lần, dùng lại cho mọi cột tiền).
        -- Rule CEO (docs/TALPHA_METRIC_RULES.md) — KHÔNG chia lại /7010.
        -- Tỷ giá SINH TỰ ĐỘNG từ config/talpha_rules.json mục `markets` lúc deploy view.
        -- KHÔNG sửa số ở đây — sửa rules file rồi deploy lại, nếu không Sheet và dashboard
        -- sẽ dùng hai tỷ giá khác nhau mà không ai thấy.
        {FX_CASE}                                           AS fx_vnd,
        -- Số chia đưa cod/phí về ĐƠN VỊ TIỀN THẬT của shop (X13). SINH TỰ ĐỘNG từ
        -- `markets.*.pos_money_divisor` — KHÔNG gõ 100 lại ở bất kỳ đâu trong file này.
        {MONEY_DIV_CASE}                                    AS pos_money_divisor,
        -- Cờ bắt market mới: shop_label rơi vào ELSE ở trên ⇒ tiền đang bị quy sai
        -- tỷ giá mà KHÔNG có tín hiệu nào. Cột này để dashboard/bot phát hiện được.
        {FX_KNOWN} AS is_fx_known,

        -- revenue_local (proxy cod+prepaid): cod nếu >0, ngược lại total_price
        CASE WHEN COALESCE(o.cod, 0) > 0
             THEN o.cod ELSE COALESCE(o.total_price, 0) END AS revenue_local_raw,
        COALESCE(c.cogs_vnd, 0)                             AS cogs_vnd,
        c.cogs_coverage                                     AS cogs_coverage,
        COALESCE(o.shipping_fee, 0)                         AS shipping_fee_raw,
        COALESCE(o.partner_fee, 0)                          AS partner_fee_raw,
        COALESCE(o.return_fee, 0)                           AS return_fee_raw,

        o.p_utm_term, o.p_utm_medium, o.p_utm_campaign,
        o.ad_id, o.adset_id, o.marketer,
        -- Tên marketer tách sẵn ở đây để tầng ngoài dùng được 2 lần (tên + nhóm).
        COALESCE(
            CASE WHEN STARTS_WITH(TRIM(o.marketer), '{')
                 THEN JSON_EXTRACT_SCALAR(o.marketer, '$.name') END,
            NULLIF(NULLIF(o.marketer, ''), 'None'),
            'unknown'
        )                                                   AS _mk_name
    FROM `{PROJECT}.{DATASET}.sale_order` o
    LEFT JOIN items_cogs c ON o.shop_id = c.shop_id AND o.id = c.order_id
    LEFT JOIN ad_tz atz   ON o.ad_id = atz.ad_id_str
    WHERE o.inserted_at IS NOT NULL AND o.inserted_at != ''
)
SELECT
    order_id,
    order_uid,   -- khoá duy nhất toàn hệ thống — đếm/dedupe PHẢI dùng cột này
    shop_id,     -- cần cho JOIN sang order_items: order_id KHÔNG duy nhất (X8)
    shop_label,
    shop_label                                             AS market,
    order_currency,
    order_date,
    status_category,
    status_name,

    -- ─── Cờ trạng thái ───
    (status_category = 'GIAO_THANH_CONG')                  AS is_confirmed,
    (status_category = 'DON_HOAN')                         AS is_returned,
    (status_category NOT IN ('HUY', 'DON_THO'))            AS is_valid,

    -- ─── Tiền quy về VND (đơn vị POS ÷ pos_money_divisor × tỷ giá shop_label) ───
    ROUND((revenue_local_raw / pos_money_divisor) * fx_vnd, 0) AS revenue_vnd,
    -- COGS đã là VND (giá vốn khai bằng VND) — KHÔNG nhân fx_vnd.
    -- Đọc kèm cogs_coverage: NULL = đơn không có dòng order_items nào.
    ROUND(cogs_vnd, 0)                                     AS cogs_vnd,
    ROUND(cogs_coverage, 4)                                AS cogs_coverage,
    ROUND((shipping_fee_raw / pos_money_divisor) * fx_vnd, 0) AS shipping_fee_vnd,
    ROUND((partner_fee_raw / pos_money_divisor) * fx_vnd, 0) AS partner_fee_vnd,
    ROUND((return_fee_raw / pos_money_divisor) * fx_vnd, 0) AS return_fee_vnd,

    -- Tỷ giá đã dùng + cờ market chưa khai tỷ giá (is_fx_known = FALSE ⇒ số tiền
    -- của market đó KHÔNG tin được, phải bổ sung tỷ giá vào view + business_rules.py)
    fx_vnd,
    is_fx_known,
    -- Số chia đã dùng (X13) — để tầng trên/QA đối chiếu được, đừng đoán lại.
    pos_money_divisor,

    -- ─── Attribution ───
    CASE
        WHEN p_utm_term IS NOT NULL
             AND LENGTH(p_utm_term) > 10
             AND REGEXP_CONTAINS(p_utm_term, r'^[0-9]+$') THEN p_utm_term
        WHEN ad_id IS NOT NULL AND TRIM(ad_id) != ''       THEN ad_id
        ELSE NULL
    END                                                    AS resolved_ad_id,
    CASE
        WHEN p_utm_medium IS NOT NULL
             AND LENGTH(p_utm_medium) > 10
             AND REGEXP_CONTAINS(p_utm_medium, r'^[0-9]+$') THEN p_utm_medium
        WHEN adset_id IS NOT NULL AND TRIM(adset_id) != '' THEN adset_id
        ELSE NULL
    END                                                    AS resolved_adset_id,

    -- G2 — CÁCH gán được ad_id, không chỉ kết quả gán.
    -- Trước đây view chỉ trả `resolved_ad_id`, nên khi số nghi ngờ thì không ai
    -- biết đơn đó nối bằng utm hay bằng ô ad_id của POS, và phải bóc tay mỗi lần
    -- (X9 mất 25,8% đơn, phát hiện thủ công). Có cột này thì
    -- vw_attribution_quality đo được ngay tỷ trọng từng bậc.
    --   'utm'      : p_utm_term là id số dài — tin cậy nhất, do pixel ghi
    --   'pos_field': lấy từ ô ad_id POS — người nhập, có thể là adset id (X9)
    --   'none'     : không gán được
    CASE
        WHEN p_utm_term IS NOT NULL
             AND LENGTH(p_utm_term) > 10
             AND REGEXP_CONTAINS(p_utm_term, r'^[0-9]+$')  THEN 'utm'
        WHEN ad_id IS NOT NULL AND TRIM(ad_id) != ''       THEN 'pos_field'
        ELSE 'none'
    END                                                    AS attribution_method,

    -- ─── Marketer (cột gốc: JSON string khi là dict, ngược lại plain text) ───
    _mk_name                                               AS marketer_name,

    -- ─── Nhóm nhân sự: 'team' · 'external' · 'unknown' ───────────────────────
    -- X10: người NGOÀI TEAM (Kính, Thắng, Việt…) chạy chung 14 TKQC và bán chung shop
    -- POS nên đơn của họ nằm lẫn ở đây. Tab tổng lọc `marketer_group != 'external'`
    -- để số của team không bị cộng thêm người ngoài.
    -- CASE này SINH TỰ ĐỘNG từ config/talpha_rules.json (pos_marketer_rules +
    -- pos_external_rules) lúc deploy view — đừng sửa tay, sửa rules file rồi deploy lại.
    {MARKETER_GROUP}                                       AS marketer_group,

    p_utm_campaign
FROM base;

-- ═══════════════════════════════════════════════════════════════════
-- TALPHA Analytics — 09 · vw_pos_by_ad  (LỚP 1: DAILY FACT)
-- ═══════════════════════════════════════════════════════════════════
-- G1 — port từ STRAMARK_AdsOps.vw_pos_by_ad.
-- Gộp đơn POS về từng quảng cáo để tầng trên tính CPO THẬT (theo đơn POS)
-- thay vì CPO theo pixel của Meta.
--
-- ▸ KHOÁ ĐẾM là `order_uid`, KHÔNG phải order_id (lỗi X8: POS đánh số đơn
--   riêng từng shop nên order_id 18 tồn tại ở cả 7 shop). Dùng order_id là
--   đếm thiếu.
-- ▸ `resolved_ad_id` đã qua attribution 2 bậc của vw_orders_std
--   (p_utm_term → ad_id). Đơn không gán được nằm ngoài view này — xem
--   vw_attribution_quality để biết bỏ sót bao nhiêu.
-- ▸ CỬA SỔ 30 NGÀY. first/last_order_date vì thế là "trong 30 ngày gần
--   nhất", không phải toàn bộ đời quảng cáo.
-- ▸ X10 — tách thêm `pos_orders_team`: người NGOÀI TEAM chạy chung 14 TKQC
--   nên đơn của họ cũng nằm trong sale_order. Cột `pos_orders` là TẤT CẢ
--   (đúng để đo hiệu quả quảng cáo); `pos_orders_team` để tab tổng dùng khi
--   cần loại người ngoài. Đừng lẫn hai cột.
-- ▸ Doanh thu: `pos_revenue_confirmed_vnd` chỉ tính đơn GIAO_THANH_CONG
--   (rule CEO). `pos_revenue_all_vnd` gồm mọi đơn hợp lệ — dùng để ước
--   sớm, KHÔNG dùng cho P&L.
--
-- Nguồn: vw_orders_std
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW `{PROJECT}.{DATASET}.vw_pos_by_ad` AS
SELECT
    resolved_ad_id                                              AS ad_id,

    -- ─── Đếm đơn theo cửa sổ (khoá order_uid — X8) ───
    COUNT(DISTINCT order_uid)                                   AS pos_orders_30d,
    COUNT(DISTINCT IF(order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY),
                      order_uid, NULL))                         AS pos_orders_7d,
    COUNT(DISTINCT IF(order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 3 DAY),
                      order_uid, NULL))                         AS pos_orders_3d,
    COUNT(DISTINCT IF(order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY),
                      order_uid, NULL))                         AS pos_orders_1d,

    -- Chỉ đơn của người TRONG team (X10) — tab tổng dùng cột này
    COUNT(DISTINCT IF(marketer_group != 'external', order_uid, NULL)) AS pos_orders_team_30d,

    -- ─── Chất lượng đơn ───
    COUNT(DISTINCT IF(is_confirmed, order_uid, NULL))           AS pos_orders_confirmed_30d,
    COUNT(DISTINCT IF(is_returned,  order_uid, NULL))           AS pos_returned_30d,

    -- ─── Tiền (đã quy VND trong vw_orders_std) ───
    ROUND(SUM(IF(is_confirmed, revenue_vnd, 0)), 0)             AS pos_revenue_confirmed_vnd,
    ROUND(SUM(revenue_vnd), 0)                                  AS pos_revenue_all_vnd,
    ROUND(SUM(IF(order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
                 AND is_confirmed, revenue_vnd, 0)), 0)         AS pos_revenue_confirmed_7d_vnd,

    -- Cờ market chưa khai tỷ giá — nếu TRUE thì mọi cột tiền ở trên không tin được
    LOGICAL_OR(NOT is_fx_known)                                 AS co_market_chua_khai_ty_gia,

    MIN(order_date)                                             AS first_order_date,
    MAX(order_date)                                             AS last_order_date
FROM `{PROJECT}.{DATASET}.vw_orders_std`
WHERE resolved_ad_id IS NOT NULL
  AND is_valid                                   -- loại HUY + DON_THO
  AND order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
GROUP BY resolved_ad_id;

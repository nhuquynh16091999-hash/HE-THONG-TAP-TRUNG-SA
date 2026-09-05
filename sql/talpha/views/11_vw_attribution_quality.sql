-- ═══════════════════════════════════════════════════════════════════
-- TALPHA Analytics — 11 · vw_attribution_quality  (LỚP 2: INTELLIGENCE)
-- ═══════════════════════════════════════════════════════════════════
-- G1 — port từ STRAMARK_SalesOS.vw_attribution_quality (bản rút gọn).
-- Hệ TỰ ĐO chất lượng gán của chính mình, thay vì phải bóc tay mỗi lần
-- nghi ngờ (lỗi X9: 25,8% đơn không nối được campaign, phát hiện thủ công).
--
-- Hai chiều đo, mỗi chiều một mẫu số — ĐỌC KỸ MẪU SỐ trước khi trích số:
--   1. Chiều ĐƠN   : bao nhiêu % đơn hợp lệ gán được về quảng cáo.
--                    Mẫu số = đơn is_valid trong ngày (đã loại HUY/DON_THO).
--   2. Chiều TIỀN  : bao nhiêu % chi tiêu rơi vào quảng cáo CÓ ít nhất 1 đơn
--                    CÙNG NGÀY. Mẫu số = tổng spend trong ngày.
--
-- ▸ Chiều TIỀN thấp KHÔNG có nghĩa là lãng phí. Đơn thường về sau ngày chi
--   (COD, chat-sale kéo dài), nên chi hôm nay chưa có đơn hôm nay là bình
--   thường. Cột này để bắt XU HƯỚNG TỤT, không phải để kết tội một ngày.
--
-- ▸ Cột `don_fx_khong_biet`: đơn thuộc market chưa khai tỷ giá — mọi số tiền
--   của các đơn đó KHÔNG tin được. Bình thường phải bằng 0.
--
-- ▸ Cửa sổ 60 ngày để nhìn được xu hướng chứ không chỉ hiện trạng.
--
-- Nguồn: vw_orders_std + vw_fb_ads_std
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW `{PROJECT}.{DATASET}.vw_attribution_quality` AS
WITH ad_ton_tai AS (
    -- Mọi ad_id từng xuất hiện trong bảng ads, BẤT KỂ ngày. Dùng để tách hai
    -- kiểu "không nối được" vốn hay bị gộp làm một:
    --   • đơn KHÔNG CÓ ad_id                        → chat-sale/organic, bình thường
    --   • đơn CÓ ad_id nhưng ads KHÔNG TRẢ VỀ ad đó → lỗi X9 (ad bị xoá rồi tạo
    --     lại giữ id cũ, hoặc TKQC nằm ngoài roster 14 tài khoản)
    SELECT DISTINCT ad_id FROM `{PROJECT}.{DATASET}.vw_fb_ads_std`
),
don_theo_ngay AS (
    SELECT
        o.order_date                                                        AS report_date,
        COUNT(DISTINCT o.order_uid)                                         AS don_hop_le,
        COUNT(DISTINCT IF(o.resolved_ad_id IS NOT NULL, o.order_uid, NULL)) AS don_co_ad,
        -- X9: có ad_id nhưng bảng ads không hề có ad đó ⇒ vĩnh viễn không nối
        -- được vào chi phí. Khác hẳn đơn không có ad_id.
        COUNT(DISTINCT IF(o.resolved_ad_id IS NOT NULL AND a.ad_id IS NULL,
                          o.order_uid, NULL))                               AS don_ad_khong_tra_ve,
        COUNT(DISTINCT IF(o.marketer_name != 'unknown', o.order_uid, NULL))  AS don_co_marketer,
        COUNT(DISTINCT IF(o.marketer_group = 'external', o.order_uid, NULL)) AS don_nguoi_ngoai,
        COUNT(DISTINCT IF(NOT o.is_fx_known, o.order_uid, NULL))            AS don_fx_khong_biet
    FROM `{PROJECT}.{DATASET}.vw_orders_std` o
    LEFT JOIN ad_ton_tai a ON o.resolved_ad_id = a.ad_id
    WHERE o.is_valid
      AND o.order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 DAY)
    GROUP BY o.order_date
),
don_theo_ad_ngay AS (
    SELECT order_date AS report_date, resolved_ad_id AS ad_id,
           COUNT(DISTINCT order_uid) AS don
    FROM `{PROJECT}.{DATASET}.vw_orders_std`
    WHERE is_valid AND resolved_ad_id IS NOT NULL
      AND order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 DAY)
    GROUP BY 1, 2
),
chi_theo_ad_ngay AS (
    SELECT date AS report_date, ad_id, SUM(spend) AS spend
    FROM `{PROJECT}.{DATASET}.vw_fb_ads_std`
    WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 DAY)
    GROUP BY 1, 2
),
chi_theo_ngay AS (
    SELECT
        c.report_date,
        SUM(c.spend)                                    AS spend_vnd,
        SUM(IF(IFNULL(o.don, 0) > 0, c.spend, 0))       AS spend_co_don_cung_ngay,
        COUNT(DISTINCT c.ad_id)                         AS so_ad_tieu_tien,
        COUNT(DISTINCT IF(IFNULL(o.don, 0) > 0, c.ad_id, NULL)) AS so_ad_co_don
    FROM chi_theo_ad_ngay c
    LEFT JOIN don_theo_ad_ngay o USING (report_date, ad_id)
    GROUP BY c.report_date
)
SELECT
    COALESCE(d.report_date, c.report_date)                  AS report_date,

    -- ─── Chiều ĐƠN (mẫu số: đơn hợp lệ trong ngày) ───
    d.don_hop_le,
    d.don_co_ad,
    ROUND(100 * SAFE_DIVIDE(d.don_co_ad, NULLIF(d.don_hop_le, 0)), 1)      AS pct_don_gan_duoc,
    -- X9 — có ad_id mà bảng ads không có ad đó. Số này >0 nghĩa là đang mất
    -- đơn khỏi mọi phép tính CPO/ROAS theo quảng cáo, im lặng.
    d.don_ad_khong_tra_ve,
    ROUND(100 * SAFE_DIVIDE(d.don_ad_khong_tra_ve, NULLIF(d.don_co_ad, 0)), 1)
                                                            AS pct_ad_khong_tra_ve,
    d.don_co_marketer,
    ROUND(100 * SAFE_DIVIDE(d.don_co_marketer, NULLIF(d.don_hop_le, 0)), 1) AS pct_don_co_marketer,
    d.don_nguoi_ngoai,
    d.don_fx_khong_biet,

    -- ─── Chiều TIỀN (mẫu số: tổng chi trong ngày) ───
    ROUND(c.spend_vnd, 0)                                   AS spend_vnd,
    ROUND(c.spend_co_don_cung_ngay, 0)                      AS spend_co_don_cung_ngay,
    ROUND(100 * SAFE_DIVIDE(c.spend_co_don_cung_ngay, NULLIF(c.spend_vnd, 0)), 1)
                                                            AS pct_chi_co_don_cung_ngay,
    c.so_ad_tieu_tien,
    c.so_ad_co_don
FROM don_theo_ngay d
FULL OUTER JOIN chi_theo_ngay c ON d.report_date = c.report_date
ORDER BY report_date DESC;

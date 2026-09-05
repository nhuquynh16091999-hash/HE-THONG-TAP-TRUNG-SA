-- ═══════════════════════════════════════════════════════════════════
-- TALPHA Analytics — 10 · vw_ad_windows  (LỚP 2: INTELLIGENCE)
-- ═══════════════════════════════════════════════════════════════════
-- G1 — port từ STRAMARK_AdsOps.vw_ad_windows_local.
-- Cửa sổ trượt 1/3/7/30 ngày cho từng quảng cáo, ghép CPO THẬT theo đơn POS.
-- Trả lời: quảng cáo nào đang đốt tiền mà không ra đơn, và quảng cáo nào
-- đang xấu đi so với chính nó tuần trước.
--
-- ▸ KHÁC vw_creative_fatigue: view đó nhìn TÍN HIỆU HIỂN THỊ (CTR, tần suất)
--   để đoán creative chai. View này nhìn TIỀN VÀ ĐƠN. Một quảng cáo có thể
--   CTR đẹp mà vẫn 0 đơn — chỉ view này bắt được.
--
-- ▸ NGƯỠNG TỰ HIỆU CHỈNH, không có số ma:
--     cpo_7d_chung = tổng chi 7 ngày / tổng đơn 7 ngày (đã loại camp test).
--     - NO_ORDERS : chi ≥ cpo_7d_chung mà 0 đơn/7 ngày → lẽ ra phải có ≥1 đơn
--     - CPO_SPIKE : CPO 3 ngày > 1,5× CPO 7 ngày (ngưỡng CEO duyệt 10/08)
--     - CPO_HIGH  : CPO 7 ngày > 2× mức chung
--   Đổi ngưỡng = sửa ở đây rồi deploy lại; đừng chép sang tab.
--
-- ▸ `is_test_campaign` chỉ là CỜ, view KHÔNG tự lọc. Rule test_campaign của
--   rules file miễn trừ market Taiwan, mà ở cấp quảng cáo không biết chắc
--   market → lọc thẳng sẽ giấu mất chi tiêu Taiwan thật. Tab tự quyết định
--   lọc hay không.
--
-- ▸ CTR ở đây là PHÂN SỐ clicks/impressions (0..1), giống vw_creative_fatigue,
--   KHÔNG phải cột ctr % của Meta — để hai view so được với nhau.
--
-- ▸ ⚠ MẪU SỐ — ĐỪNG CỘNG pos_orders_7d RỒI GỌI LÀ "TỔNG ĐƠN". View chỉ giữ
--   quảng cáo CÓ CHI TIÊU trong 7 ngày, nên đơn của quảng cáo đã tắt và đơn
--   có ad_id mà bảng ads không trả về đều nằm NGOÀI. Đo 10/08: 2.480 đơn có
--   ad_id trong 7 ngày → 1.919 lọt vào view, 38 thuộc ad đã ngừng chi, 523
--   thuộc ad không tồn tại trong fb_ads_data (lỗi X9). Muốn biết bỏ sót bao
--   nhiêu, đọc vw_attribution_quality.don_ad_khong_tra_ve.
--
-- Nguồn: vw_fb_ads_std + vw_pos_by_ad
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW `{PROJECT}.{DATASET}.vw_ad_windows` AS
WITH ad_day AS (
    SELECT
        ad_id,
        date,
        ANY_VALUE(ad_name)       AS ad_name,
        ANY_VALUE(adset_id)      AS adset_id,
        ANY_VALUE(adset_name)    AS adset_name,
        ANY_VALUE(campaign_id)   AS campaign_id,
        ANY_VALUE(campaign_name) AS campaign_name,
        ANY_VALUE(account_name)  AS account_name,
        SUM(spend)               AS spend,
        SUM(impressions)         AS impressions,
        SUM(clicks)              AS clicks,
        MAX(frequency)           AS frequency
    FROM `{PROJECT}.{DATASET}.vw_fb_ads_std`
    WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
    GROUP BY ad_id, date
),
w AS (
    SELECT
        ad_id,
        ANY_VALUE(ad_name)       AS ad_name,
        ANY_VALUE(adset_id)      AS adset_id,
        ANY_VALUE(adset_name)    AS adset_name,
        ANY_VALUE(campaign_id)   AS campaign_id,
        ANY_VALUE(campaign_name) AS campaign_name,
        ANY_VALUE(account_name)  AS account_name,

        -- Cờ campaign test (pattern sinh từ config/talpha_rules.json lúc deploy)
        REGEXP_CONTAINS(IFNULL(ANY_VALUE(campaign_name), ''), r'{TEST_CAMPAIGN_RE2}')
                                                            AS is_test_campaign,

        -- ─── Chi tiêu theo cửa sổ (VND — spend đã là VND, rule CEO) ───
        SUM(IF(date >= DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY), spend, 0))  AS spend_1d,
        SUM(IF(date >= DATE_SUB(CURRENT_DATE(), INTERVAL 3 DAY), spend, 0))  AS spend_3d,
        SUM(IF(date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY), spend, 0))  AS spend_7d,
        SUM(spend)                                                          AS spend_30d,

        -- ─── CTR phân số theo cửa sổ ───
        SAFE_DIVIDE(
            SUM(IF(date >= DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY), clicks, 0)),
            NULLIF(SUM(IF(date >= DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY), impressions, 0)), 0)
        )                                                                   AS ctr_1d,
        SAFE_DIVIDE(
            SUM(IF(date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY), clicks, 0)),
            NULLIF(SUM(IF(date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY), impressions, 0)), 0)
        )                                                                   AS ctr_7d,
        MAX(IF(date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY),
               SAFE_DIVIDE(clicks, NULLIF(impressions, 0)), NULL))          AS ctr_peak_7d,

        MAX(IF(date >= DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY), frequency, NULL)) AS frequency_1d,
        SUM(IF(date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY), impressions, 0))  AS impressions_7d,

        MAX(date)                                                           AS last_active_date,
        DATE_DIFF(CURRENT_DATE(), MIN(date), DAY) + 1                       AS ad_age_days
    FROM ad_day
    GROUP BY ad_id
),
joined AS (
    SELECT
        w.*,
        IFNULL(p.pos_orders_7d, 0)                          AS pos_orders_7d,
        IFNULL(p.pos_orders_3d, 0)                          AS pos_orders_3d,
        IFNULL(p.pos_orders_30d, 0)                         AS pos_orders_30d,
        IFNULL(p.pos_revenue_confirmed_7d_vnd, 0)           AS pos_revenue_7d_vnd,
        p.last_order_date,
        SAFE_DIVIDE(w.spend_7d, NULLIF(p.pos_orders_7d, 0)) AS pos_cpo_7d,
        SAFE_DIVIDE(w.spend_3d, NULLIF(p.pos_orders_3d, 0)) AS pos_cpo_3d
    FROM w
    LEFT JOIN `{PROJECT}.{DATASET}.vw_pos_by_ad` p USING (ad_id)
),
overall AS (
    -- Mức chung của 7 ngày, đã loại campaign test. Đây là mốc để so, thay cho
    -- việc gõ tay một con số CPO mục tiêu (CEO chưa chốt — xem G1 mục 3).
    SELECT SAFE_DIVIDE(SUM(spend_7d), NULLIF(SUM(pos_orders_7d), 0)) AS cpo_7d_chung
    FROM joined
    WHERE NOT is_test_campaign
)
SELECT
    j.ad_id, j.ad_name, j.adset_id, j.adset_name,
    j.campaign_id, j.campaign_name, j.account_name,
    j.is_test_campaign,

    -- ─── Tiền & đơn ───
    ROUND(j.spend_1d, 0)                AS spend_1d,
    ROUND(j.spend_3d, 0)                AS spend_3d,
    ROUND(j.spend_7d, 0)                AS spend_7d,
    ROUND(j.spend_30d, 0)               AS spend_30d,
    j.pos_orders_3d, j.pos_orders_7d, j.pos_orders_30d,
    j.pos_revenue_7d_vnd,
    ROUND(j.pos_cpo_3d, 0)              AS pos_cpo_3d,
    ROUND(j.pos_cpo_7d, 0)              AS pos_cpo_7d,
    ROUND(o.cpo_7d_chung, 0)            AS cpo_7d_chung,
    SAFE_DIVIDE(j.pos_revenue_7d_vnd, NULLIF(j.spend_7d, 0)) AS pos_roas_7d,

    -- ─── Tín hiệu hiển thị ───
    ROUND(j.ctr_1d, 5)                  AS ctr_1d,
    ROUND(j.ctr_7d, 5)                  AS ctr_7d,
    ROUND(j.ctr_peak_7d, 5)             AS ctr_peak_7d,
    ROUND(j.frequency_1d, 3)            AS frequency_1d,
    j.impressions_7d,
    j.last_active_date, j.last_order_date, j.ad_age_days,

    -- ─── Xu hướng: CPO 3 ngày so với 7 ngày ───
    (j.pos_cpo_3d IS NOT NULL AND j.pos_cpo_7d IS NOT NULL
     AND j.pos_cpo_3d > j.pos_cpo_7d)   AS cpo_trend_worse,

    -- ─── Phán quyết (ngưỡng tự hiệu chỉnh theo cpo_7d_chung) ───
    CASE
        WHEN j.spend_7d >= o.cpo_7d_chung AND j.pos_orders_7d = 0     THEN 'NO_ORDERS'
        WHEN j.pos_cpo_3d > j.pos_cpo_7d * 1.5                        THEN 'CPO_SPIKE'
        WHEN j.pos_cpo_7d > o.cpo_7d_chung * 2                        THEN 'CPO_HIGH'
        ELSE 'HEALTHY'
    END                                 AS health_status,
    CASE
        WHEN j.spend_7d >= o.cpo_7d_chung AND j.pos_orders_7d = 0     THEN 5
        WHEN j.pos_cpo_3d > j.pos_cpo_7d * 1.5                        THEN 4
        WHEN j.pos_cpo_7d > o.cpo_7d_chung * 2                        THEN 3
        ELSE 1
    END                                 AS health_severity,
    CASE
        WHEN j.spend_7d >= o.cpo_7d_chung AND j.pos_orders_7d = 0     THEN 'KILL_OR_REVIEW'
        WHEN j.pos_cpo_3d > j.pos_cpo_7d * 1.5                        THEN 'REVIEW_NOW'
        WHEN j.pos_cpo_7d > o.cpo_7d_chung * 2                        THEN 'MONITOR_CLOSELY'
        ELSE 'NO_ACTION'
    END                                 AS recommended_action
FROM joined j
CROSS JOIN overall o
WHERE j.spend_7d > 0;

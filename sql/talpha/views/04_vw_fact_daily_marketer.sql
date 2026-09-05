-- ═══════════════════════════════════════════════════════════════════
-- TALPHA Analytics — 04 · vw_fact_daily_marketer  (LỚP 1: DAILY FACT)
-- ═══════════════════════════════════════════════════════════════════
-- P&L cấp MARKETER theo ngày. Nguồn cho vw_marketer_momentum.
--
-- ▸ THÁCH THỨC: fb_ads_data KHÔNG gắn marketer; marketer nằm trên ĐƠN.
--   → Heuristic: suy chủ sở hữu mỗi ad_id = marketer có nhiều đơn nhất
--     gắn với ad_id đó (ad_marketer), rồi quy spend của ad về marketer.
--   Spend của ad không sinh đơn nào sẽ không gán được marketer (bỏ qua
--   khỏi bảng xếp hạng) — chấp nhận được cho leaderboard.
--
-- ▸ G2 — HEURISTIC NAY TỰ KHAI ĐỘ CHẮC. Trước đây dùng APPROX_TOP_COUNT rồi
--   im lặng: một ad mà 51/100 đơn của Mai và 49 của Nhung thì TOÀN BỘ spend
--   về Mai, không dấu vết. Nay `spend_owner_confidence` (0..1, bình quân theo
--   tiền) nói thẳng phần spend đó được suy từ đa số mỏng hay áp đảo.
--   < 0,7 nghĩa là bảng xếp hạng đang đoán nhiều hơn đo.
--
-- ▸ G2 — `marketer_group` mang lên đây (X10). Người NGOÀI TEAM chạy chung 14
--   TKQC nên đơn của họ nằm lẫn trong vw_orders_std; trước G2 view này không
--   phân biệt ⇒ người ngoài lọt vào Bảng Phong Thần của team. View vẫn trả về
--   HỌ (để đối soát tổng chi tiêu), nhưng có cột để tab lọc
--   `marketer_group != 'external'` — giống đúng cách tab tổng đang làm.
--
-- ▸ G2 — spend đã LOẠI campaign test (rule CEO §7), cùng định nghĩa với
--   vw_fact_daily_pnl vì cả hai đọc cờ is_test_campaign của vw_fb_ads_std.
--
-- Nguồn: vw_orders_std + vw_fb_ads_std
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW `{PROJECT}.{DATASET}.vw_fact_daily_marketer` AS
WITH
-- Doanh thu/đơn theo marketer × ngày (từ orders)
marketer_rev AS (
    SELECT
        order_date                                          AS report_date,
        marketer_name,
        -- marketer_group suy từ TÊN qua rules file nên 1 người chỉ thuộc 1 nhóm;
        -- ANY_VALUE ở đây là an toàn, không phải chọn bừa.
        ANY_VALUE(marketer_group)                           AS marketer_group,
        COUNTIF(is_valid)                                   AS total_orders,
        COUNTIF(is_confirmed)                               AS success_orders,
        SUM(IF(is_valid,     revenue_vnd, 0))               AS provisional_revenue,
        SUM(IF(is_confirmed, revenue_vnd, 0))               AS confirmed_revenue
    FROM `{PROJECT}.{DATASET}.vw_orders_std`
    WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
    GROUP BY report_date, marketer_name
),
-- ad_id → marketer (chủ sở hữu = người có nhiều đơn nhất trên ad đó)
-- Đếm CHÍNH XÁC thay vì APPROX_TOP_COUNT để lấy được cả tỷ lệ áp đảo.
ad_marketer AS (
    SELECT ad_id, marketer_name, owner_confidence
    FROM (
        SELECT
            resolved_ad_id                                  AS ad_id,
            marketer_name,
            SAFE_DIVIDE(
                COUNT(*),
                SUM(COUNT(*)) OVER (PARTITION BY resolved_ad_id)
            )                                               AS owner_confidence,
            ROW_NUMBER() OVER (
                PARTITION BY resolved_ad_id ORDER BY COUNT(*) DESC, marketer_name
            )                                               AS rn
        FROM `{PROJECT}.{DATASET}.vw_orders_std`
        WHERE resolved_ad_id IS NOT NULL
          AND marketer_name != 'unknown'
        GROUP BY resolved_ad_id, marketer_name
    )
    WHERE rn = 1
),
-- Spend theo marketer × ngày (qua ánh xạ ad_marketer), ĐÃ LOẠI campaign test
marketer_spend AS (
    SELECT
        a.date                                              AS report_date,
        am.marketer_name,
        SUM(a.spend)                                        AS ads_spend,
        -- Bình quân độ chắc THEO TIỀN: 1 ad tiêu nhiều mà gán mơ hồ kéo cả
        -- chỉ số xuống, đúng như nó phải thế.
        SAFE_DIVIDE(SUM(a.spend * am.owner_confidence), NULLIF(SUM(a.spend), 0))
                                                            AS spend_owner_confidence
    FROM `{PROJECT}.{DATASET}.vw_fb_ads_std` a
    JOIN ad_marketer am ON a.ad_id = am.ad_id
    WHERE a.date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
      AND NOT a.is_test_campaign
    GROUP BY report_date, am.marketer_name
)
SELECT
    COALESCE(r.report_date, s.report_date)                  AS report_date,
    COALESCE(r.marketer_name, s.marketer_name)             AS marketer_name,
    -- X10 — 'team' · 'external' · 'unknown'. Tab tổng phải lọc != 'external',
    -- nếu không số của team bị cộng thêm người ngoài chạy chung TKQC.
    COALESCE(r.marketer_group, 'unknown')                  AS marketer_group,
    COALESCE(s.ads_spend, 0)                                AS ads_spend,
    -- Độ chắc của phép quy spend về người này (0..1) — xem header.
    ROUND(s.spend_owner_confidence, 3)                     AS spend_owner_confidence,
    COALESCE(r.total_orders, 0)                             AS total_orders,
    COALESCE(r.success_orders, 0)                           AS success_orders,
    COALESCE(r.provisional_revenue, 0)                      AS provisional_revenue,
    COALESCE(r.confirmed_revenue, 0)                        AS confirmed_revenue,
    ROUND(SAFE_DIVIDE(r.provisional_revenue, NULLIF(s.ads_spend, 0)), 2) AS provisional_roas,
    ROUND(SAFE_DIVIDE(r.confirmed_revenue,   NULLIF(s.ads_spend, 0)), 2) AS confirmed_roas,
    ROUND(SAFE_DIVIDE(s.ads_spend, NULLIF(r.success_orders, 0)), 2)      AS cpa,
    ROUND(SAFE_DIVIDE(r.success_orders, NULLIF(r.total_orders, 0)) * 100, 1) AS success_rate_pct
FROM marketer_rev r
FULL OUTER JOIN marketer_spend s
    ON  r.report_date = s.report_date
    AND r.marketer_name = s.marketer_name
WHERE COALESCE(r.marketer_name, s.marketer_name) IS NOT NULL;

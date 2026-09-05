-- ═══════════════════════════════════════════════════════════════════
-- TALPHA Analytics — 01 · vw_fb_ads_std  (LỚP 0: ADAPTER)
-- ═══════════════════════════════════════════════════════════════════
-- Chuẩn hoá fb_ads_data của TALPHA về schema thống nhất cho các view bên
-- trên. (Bảng live cty-507710 ĐÃ ở schema chuẩn: date DATE, có
-- frequency/leads/purchases — KHÁC legacy DDL date_start/actions_*.)
--
--   • ids (ad/adset/campaign/account) là INT64 → CAST sang STRING để
--     JOIN được với orders (lưu id dạng STRING).
--   • messages = messaging_conversations_started (tín hiệu chat-sale).
--   • ctr_calc = clicks/impressions (fraction) — ổn định đơn vị cho fatigue.
--   • frequency: dùng cột live, fallback impressions/reach nếu thiếu.
--
-- ▸ HAI CỘT CTR, HAI ĐƠN VỊ — đọc kỹ trước khi cộng:
--     `ctr`      = cột Meta trả về, đơn vị PHẦN TRĂM (6.46 nghĩa là 6,46%)
--     `ctr_calc` = clicks/impressions tự tính, đơn vị PHÂN SỐ (0.0646)
--   Lệch nhau 100 lần. Mọi view lớp trên dùng `ctr_calc` để cùng đơn vị;
--   `ctr` giữ lại cho tab nào cần hiển thị đúng số Meta báo.
--
-- ▸ G2 — `is_test_campaign` đặt Ở ĐÂY, tầng adapter, để CHỈ CÓ MỘT định nghĩa
--   campaign test cho toàn bộ view lớp trên. Trước đó rule này nằm rải trong
--   code consumer (format_all.py, test_files.json) nên mỗi nơi lọc một kiểu,
--   và 4 view lớp 1-2 thì không lọc gì cả — chi tiêu campaign test lọt thẳng
--   vào P&L, bảng marketer, BCG và fatigue.
--   Đây là CỜ, view KHÔNG tự lọc: rule miễn trừ market Taiwan mà ở cấp quảng
--   cáo không biết chắc market, lọc thẳng sẽ giấu mất chi tiêu Taiwan thật.
--   Consumer tự quyết định — nhưng phải quyết định có ý thức.
--
-- Nguồn: {PROJECT}.{DATASET}.fb_ads_data
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW `{PROJECT}.{DATASET}.vw_fb_ads_std` AS
SELECT
    CAST(ad_id AS STRING)                                   AS ad_id,
    ad_name,
    CAST(adset_id AS STRING)                                AS adset_id,
    adset_name,
    CAST(campaign_id AS STRING)                             AS campaign_id,
    campaign_name,
    CAST(account_id AS STRING)                              AS account_id,
    account_name,

    -- Cờ campaign test — pattern SINH TỰ ĐỘNG từ config/talpha_rules.json
    -- (test_campaign.pattern) lúc deploy, đã dịch sang RE2. Đừng gõ regex tay
    -- ở view khác: rule đổi thì chỉ chỗ này đổi theo.
    REGEXP_CONTAINS(IFNULL(campaign_name, ''), r'{TEST_CAMPAIGN_RE2}') AS is_test_campaign,

    date,                                                  -- đã là DATE

    -- ⚠️ SPEND đã là VND (mọi ad account billed VND — team VN chạy). Rule CEO
    -- (docs/TALPHA_METRIC_RULES.md): KHÔNG ÷100, KHÔNG quy đổi. Doanh thu ở
    -- vw_orders_std cũng quy về VND theo shop_label → ROAS cùng đơn vị VND.
    -- Nếu sau này có account billed khác VND, cần bảng account→currency.
    COALESCE(spend, 0)                                      AS spend,
    COALESCE(spend, 0)                                      AS spend_vnd_raw,  -- giữ tương thích ngược (= spend)
    COALESCE(impressions, 0)                                AS impressions,
    COALESCE(reach, 0)                                      AS reach,
    COALESCE(clicks, 0)                                     AS clicks,
    COALESCE(cpm, 0)                                        AS cpm,
    COALESCE(cpc, 0)                                        AS cpc,
    COALESCE(ctr, 0)                                        AS ctr,

    -- frequency live, fallback suy ra nếu 0/null
    COALESCE(NULLIF(frequency, 0), SAFE_DIVIDE(impressions, NULLIF(reach, 0))) AS frequency,

    -- CTR tự tính (fraction) — dùng cho creative fatigue
    SAFE_DIVIDE(clicks, NULLIF(impressions, 0))           AS ctr_calc,

    COALESCE(messaging_conversations_started, 0)           AS messages,
    COALESCE(purchases, 0)                                 AS purchases,
    COALESCE(leads, 0)                                     AS leads,
    COALESCE(purchase_value, 0)                            AS purchase_value,

    sync_time
FROM `{PROJECT}.{DATASET}.fb_ads_data`
WHERE date IS NOT NULL;

// ═══════════════════════════════════════════════════════════════════
// TALPHA — SINH system prompt cho "Hỏi dashboard" (text-to-SQL CEO-ask).
//
// Trước A5 prompt là văn xuôi chép tay trong route.ts → tỷ giá/marketer/rule
// trôi khỏi `config/talpha_rules.json` lúc nào không biết (thiếu Taiwan 800,
// thiếu rule 3 bậc, mô tả order_items sai). Nay MỌI con số & danh sách trong
// prompt đều sinh từ rules file qua `./rules` — sửa rule = sửa JSON, prompt
// tự đổi theo. KHÔNG hard-code lại tỷ giá / tên marketer ở file này.
//
// Xem: docs/TALPHA_METRIC_RULES.md, sql/talpha/views/ (view chuẩn lớp 0).
// ═══════════════════════════════════════════════════════════════════
import { RULES, DISPLAY, UNASSIGNED, PRODUCT_COSTS } from "./rules";
import { sanitizeSqlComment } from "./ceo-ask-sql";

type Ids = { project: string; dataset: string };

const q = (t: Ids, table: string) => `\`${t.project}.${t.dataset}.${table}\``;

/** Bảng thị trường ↔ shop_label ↔ tỷ giá ↔ số chia tiền POS, sinh từ rules.markets. */
function marketTable(): string {
    return Object.entries(RULES.markets)
        .map(([name, m]) => `  ${m.shop_label} = ${name} (${m.currency}) — 1 ${m.currency} = ${m.rate_vnd.toLocaleString("en-US")} VND · cod ÷ ${m.pos_money_divisor}`)
        .join("\n");
}

/** Danh sách marketer trong team (tên hiển thị chuẩn), sinh từ rules.marketers. */
function marketerList(): string {
    return Object.entries(RULES.marketers)
        .map(([, m]) => (m.inactive ? `${m.display} (đã nghỉ)` : m.display))
        .join(" · ");
}

/** Bảng phí 3PL/đơn (tệ địa phương), sinh từ rules.shipping_fees. */
function shippingTable(): string {
    const rows = Object.entries(RULES.shipping_fees)
        .filter(([k]) => !k.startsWith("_"))
        .map(([label, f]) => {
            const fee = f as { partner?: string; packing: number; delivery: number; cod_pct: number; cod_flat: number };
            const parts = [`đóng gói ${fee.packing}`, `giao ${fee.delivery}`];
            if (fee.cod_pct) parts.push(`COD ${(fee.cod_pct * 100).toFixed(0)}% doanh thu`);
            if (fee.cod_flat) parts.push(`COD ${fee.cod_flat}/đơn`);
            return `  ${label} (${fee.partner || "?"}): ${parts.join(" + ")}`;
        });
    const missing = Object.keys(RULES.markets)
        .map((m) => RULES.markets[m].shop_label)
        .filter((l) => !(l in RULES.shipping_fees));
    if (missing.length) rows.push(`  ${missing.join("/")}: CHƯA khai phí → coi như 0, phải nói rõ khi báo cáo`);
    return rows.join("\n");
}

/** SQL CASE: tên tag POS (marketer_name của vw_orders_std) → marketer chuẩn — BẬC 1. */
function posTagCase(col: string): string {
    return RULES.pos_marketer_rules
        .map((r) => `      WHEN UPPER(${col}) LIKE '%${r.contains}%' THEN '${DISPLAY[r.key] || r.key}'`)
        .join("\n");
}

/** SQL CASE: segment campaign ngay sau thị trường → marketer chuẩn — BẬC 2. */
function campTokenCase(expr: string): string {
    const lines = Object.entries(RULES.camp_marketer_tokens)
        .filter(([k]) => !k.startsWith("_"))
        .map(([tok, key]) => `      WHEN '${tok}' THEN '${DISPLAY[key] || key}'`);
    return `    CASE ${expr}\n${lines.join("\n")}\n    END`;
}

/**
 * CTE attribution 3 bậc dịch nguyên rule CEO sang SQL (≡ attributeOrder()
 * trong ./rules và attribute_order() bên Python). Model chỉ việc dán vào WITH.
 */
export function attributionCte(t: Ids): string {
    const marketAlt = RULES.camp_market_tokens.join("|");
    const seg = `REPLACE(REPLACE(REGEXP_EXTRACT(UPPER(campaign_name), r'(?:^|/)\\s*(?:${marketAlt})\\s*/\\s*([^/]*)'), '.', ''), ' ', '')`;
    return `WITH ad_owner AS (          -- BẬC 2: ad_id → marketer chủ campaign
  SELECT ad_id, ANY_VALUE(owner) AS owner FROM (
    SELECT CAST(ad_id AS STRING) AS ad_id,
${campTokenCase(seg)} AS owner
    FROM ${q(t, "vw_fb_ads_std")}
  ) WHERE owner IS NOT NULL GROUP BY ad_id
),
orders_attr AS (            -- 1 dòng = 1 đơn, đã gán marketer theo 3 bậc
  SELECT o.*, COALESCE(
    CASE                    -- BẬC 1: tag marketer trong POS (ưu tiên theo thứ tự)
${posTagCase("o.marketer_name")}
    END,
    w.owner,                -- BẬC 2
    '${UNASSIGNED}'         -- BẬC 3: không gán được
  ) AS marketer
  FROM ${q(t, "vw_orders_std")} o
  LEFT JOIN ad_owner w ON o.resolved_ad_id = w.ad_id
),
ads_attr AS (               -- spend theo marketer (chủ campaign)
  SELECT a.*, COALESCE(w.owner, '${UNASSIGNED}') AS marketer
  FROM ${q(t, "vw_fb_ads_std")} a
  LEFT JOIN ad_owner w ON a.ad_id = w.ad_id
)`;
}

/**
 * CTE bảng giá vốn theo SKU — BigQuery KHÔNG có bảng giá vốn (POS trả
 * avg_imported_price = 0 ở mọi item) nên khối `products` của rules file là nguồn
 * DUY NHẤT. Model dán vào WITH rồi JOIN theo sku; SKU vắng mặt = CHƯA khai giá
 * vốn, phải để NULL chứ không coi là 0.
 */
export function productCostCte(): string {
    const rows = Object.entries(PRODUCT_COSTS);
    const lines = rows.map(([sku, p], i) => {
        const s = sanitizeSqlComment(sku).replace(/ /g, "");
        return `    STRUCT('${s}' AS sku, ${Number(p.cost_price_vnd) || 0} AS cost_price_vnd)${i < rows.length - 1 ? "," : " "}  -- ${sanitizeSqlComment(p.name)}`;
    });
    return `product_cost AS (           -- giá vốn khai tay: ${rows.length} SKU (VND/unit)
  SELECT sku, cost_price_vnd FROM UNNEST([
${lines.join("\n")}
  ])
)`;
}

/** System prompt đầy đủ cho CEO-ask. `from`/`to` = khoảng ngày mặc định (YYYY-MM-DD). */
export function buildSystemPrompt(from: string, to: string, t: Ids): string {
    const gtc = RULES.status.gtc_category;
    const exempt = RULES.test_campaign.exempt_markets;
    const external = (RULES as unknown as { external_team?: string[] }).external_team || [];

    // Mô tả thị trường SINH TỪ rules, không gõ tay: bản cũ ghi cứng "GCC + Đài Loan"
    // và giữ nguyên cả sau khi 6 shop GCC ngừng bán — LLM được mô tả sai về chính
    // doanh nghiệp nó đang phân tích, rồi tự bịa ra so sánh giữa các thị trường
    // không còn dữ liệu.
    const thiTruong = Object.keys(RULES.markets).join(" · ");

    return `Bạn là trợ lý phân tích dữ liệu cho CEO của dự án TALPHA — bán trang sức & mỹ phẩm qua Facebook Ads + chat-sale (Messenger), thu tiền COD. Thị trường đang chạy: ${thiTruong}.

Bạn trả lời câu hỏi của leader bằng cách viết truy vấn BigQuery (chỉ SELECT) qua công cụ run_sql, đọc kết quả, rồi trả lời NGẮN GỌN bằng tiếng Việt cho người quản lý (số liệu cụ thể + 1 nhận định hành động nếu hợp lý). Khoảng ngày mặc định nếu user không nói rõ: ${from} → ${to}.

(Prompt này SINH TỰ ĐỘNG từ config/talpha_rules.json phiên bản ${RULES.version} — mọi con số dưới đây là rule CEO đã duyệt.)

═══ 1. NGUỒN DỮ LIỆU (project.dataset = ${t.project}.${t.dataset}) ═══
ƯU TIÊN VIEW CHUẨN — đã quy VND sẵn và đã gom ngày theo timezone của từng tài khoản quảng cáo. Dùng thẳng, KHÔNG quy đổi lại lần nữa.

${q(t, "vw_orders_std")} — 1 dòng = 1 đơn:
  order_id · shop_label (= market) · order_currency · order_date (DATE, đã theo tz TKQC)
  status_category · status_name · is_confirmed (đơn đã giao) · is_returned · is_valid (không huỷ/không đơn thô)
  revenue_vnd (ĐÃ quy VND) · cogs_vnd · shipping_fee_vnd · partner_fee_vnd · return_fee_vnd
  resolved_ad_id · resolved_adset_id (STRING) · marketer_name (tên tag POS THÔ, có thể 'unknown') · p_utm_campaign

${q(t, "vw_fb_ads_std")} — 1 dòng = 1 quảng cáo × ngày:
  ad_id · ad_name · adset_id · adset_name · campaign_id · campaign_name · account_id · account_name
  date (DATE) · spend (ĐÃ là VND) · impressions · reach · clicks · cpm · cpc · ctr · frequency
  messages (tin nhắn khởi tạo) · purchases · leads · purchase_value

View tổng hợp sẵn (dùng khi hỏi xu hướng nhanh): vw_fact_daily_pnl (P&L theo ngày) · vw_fact_daily_marketer (P&L theo marketer/ngày — CHỈ 30 ngày gần nhất và gán marketer bằng heuristic "ad thuộc người có nhiều đơn nhất", KHÁC rule 3 bậc bên dưới) · vw_daily_momentum · vw_marketer_momentum · vw_campaign_lifecycle · vw_creative_fatigue.

${q(t, "vw_product_pnl")} — doanh thu theo SKU × shop_label, là NGOẠI LỆ của quy tắc trên:
  sku · product_name · shop_label · orders · units · revenue_local
  ⚠ revenue_local là TỆ ĐỊA PHƯƠNG, CHƯA quy VND — phải tự nhân tỷ giá theo shop_label (mục 2).
  ⚠ KHÔNG có cột ngày → luôn là toàn kỳ, không lọc được khoảng thời gian. Cần theo ngày thì tự JOIN order_items × sale_order.
  ⚠ Chỉ gồm đơn GIAO THÀNH CÔNG và chỉ ~61% doanh thu đó có dòng order_items khớp product_catalog → tổng của view LUÔN nhỏ hơn doanh thu thật, đừng dùng làm tổng doanh thu.

Bảng thô (chỉ dùng khi view không đủ cột): sale_order · fb_ads_data · fb_adset_data · fb_campaign_data · order_items · product_catalog · inventory_snapshot · sync_health · sync_health_accounts. Bảng thô lưu tiền dạng minor units (chia 100) và CHƯA quy VND.

⚠ cogs_vnd của ${q(t, "vw_orders_std")} LUÔN = 0 — view tính COGS từ order_items.avg_imported_price mà cột này = 0 ở TOÀN BỘ dòng POS trả về. TUYỆT ĐỐI không dùng cột đó để tính lãi gộp. Giá vốn thật lấy từ khối product_cost ở mục 4.

⚠ product_catalog BẨN: cột sku có dòng chứa TÊN sản phẩm thay vì mã (vd "Necklace box") → cùng 1 sản phẩm tách thành 2 dòng doanh thu và tra giá vốn bị trượt. Khi xếp hạng theo SKU, nói rõ con số có thể bị chia đôi ở vài sản phẩm.

⚠ order_items chỉ có dữ liệu TỪ 04/07/2026 → mọi phân tích cấp sản phẩm không lùi xa hơn mốc này được.

═══ 2. RULE CHỈ SỐ BẮT BUỘC (sai là ra số bậy) ═══
1. DOANH THU = SUM(revenue_vnd) WHERE is_confirmed (status_category = '${gtc}'). Doanh thu ĐẶT (mọi đơn hợp lệ) = SUM(revenue_vnd) WHERE is_valid — nói rõ đang báo loại nào.
2. Tỷ giá quy VND theo shop_label (view đã nhân sẵn; chỉ tự nhân khi buộc phải query bảng thô, công thức: cod ÷ SỐ CHIA CỦA SHOP × tỷ giá). ⚠ X13: SỐ CHIA KHÔNG PHẢI LÚC NÀO CŨNG 100 — shop Đài lưu NGUYÊN TWD nên chia 1; gõ /100 là làm tiền Đài tụt đúng 100 lần:
${marketTable()}
3. SỐ ĐƠN = COUNT(DISTINCT order_uid) — cột order_id KHÔNG duy nhất (POS đánh số riêng từng shop, id 18 có ở cả 7 shop). ROAS = doanh thu VND ÷ spend VND. AOV = doanh thu ÷ số đơn. CPA = spend ÷ số đơn thành công.
4. SPEND đã là VND — KHÔNG chia 100, KHÔNG quy đổi. Lọc ngày: WHERE date BETWEEN '${from}' AND '${to}'.
5. Ghép ads ↔ đơn: ${q(t, "vw_fb_ads_std")}.ad_id = ${q(t, "vw_orders_std")}.resolved_ad_id (cả hai đã là STRING).
6. Campaign TEST: REGEXP_CONTAINS(campaign_name, r'${RULES.test_campaign.pattern}') → tách khỏi mọi báo cáo doanh số${exempt.length ? ` (miễn trừ: ${exempt.join(", ")} — cả thị trường đang test)` : ""}.
7. "Doanh thu đã giao hôm nay ≈ 0" là ĐÚNG, không phải lỗi — COD về chậm vài ngày. Muốn xem sức bán trong ngày thì dùng đơn ĐẶT.
8. PHÍ SHIP 3PL KHÔNG có trong DB — cột shipping_fee_vnd/partner_fee_vnd là số rác từ POS, ĐỪNG báo cáo. Nếu cần ước tính thì nói rõ "theo model phí", mỗi đơn (tệ địa phương, trước khi quy VND):
${shippingTable()}
9. Ngày trong view đã theo timezone của TKQC (có tài khoản chạy giờ Mỹ) → từng ngày lẻ có thể lệch so với báo cáo giờ VN, cả tháng thì khớp. Đừng "chữa" cho khớp từng ngày.
10. LÃI GỘP / GIÁ VỐN: không có trong DB, phải dùng khối product_cost ở mục 4 — xem mục đó trước khi trả lời bất kỳ câu nào về lợi nhuận sản phẩm.

═══ 3. GÁN MARKETER — RULE CEO 3 BẬC ═══
Team hiện tại: ${marketerList()}.
${external.length ? `Tên có tag trong POS nhưng NGOÀI team báo cáo (không tính là marketer, đơn rơi xuống bậc 2): ${external.join(" · ")}.\n` : ""}Thứ tự: (1) tag marketer trong POS → (2) ad_id → marketer chủ campaign → (3) '${UNASSIGNED}'. KHÔNG bỏ đơn lặng lẽ; cột marketer_name thô của view CHƯA áp rule này.

Khi câu hỏi liên quan tới marketer, DÙNG NGUYÊN khối CTE dưới đây (đã chuẩn hoá theo rule, đừng tự chế lại), rồi SELECT tiếp từ orders_attr (đơn/doanh thu) và ads_attr (spend):

${attributionCte(t)}

═══ 4. GIÁ VỐN & LÃI GỘP THEO SẢN PHẨM ═══
Giá vốn KHÔNG nằm trong BigQuery (POS không trả) — chỉ có ${Object.keys(PRODUCT_COSTS).length} SKU được khai tay trong rules file. Muốn tính lãi gộp thì dán NGUYÊN khối CTE dưới đây vào WITH rồi JOIN \`product_catalog.sku = product_cost.sku\`:

${productCostCte()}

Lãi gộp 1 SKU = doanh thu VND − (units × cost_price_vnd). Bắt buộc khi trả lời:
- SKU không có trong product_cost = CHƯA khai giá vốn → để NULL, KHÔNG coi giá vốn = 0 (sẽ ra "lãi 100%" bịa).
- LUÔN nêu độ phủ kèm mẫu số, dạng "x% doanh thu cấp sản phẩm có giá vốn" — tính bằng SUM(doanh thu có cost) ÷ SUM(doanh thu cấp SP), đừng lấy tổng doanh thu toàn hệ làm mẫu số.
- Hiện phần lớn SKU bán chạy CHƯA khai giá vốn → không được kết luận "sản phẩm lãi nhất" cho toàn hệ, chỉ nói trong phạm vi SKU đã có giá vốn.

═══ 5. QUY TẮC TRẢ LỜI ═══
- TUYỆT ĐỐI KHÔNG hỏi lại user xin phép hay xin khoảng thời gian. LUÔN gọi run_sql NGAY; user không nói ngày thì dùng ${from} → ${to}.
- Luôn báo số bằng VND, định dạng gọn (vd 1,7 tỷ / 255 tr).
- Câu hỏi mơ hồ: chọn cách hiểu hợp lý nhất và nêu giả định trong 1 câu.
- Trả lời thẳng đáp án, tối đa ~6 câu hoặc 1 bảng nhỏ.
- KHÔNG bịa số. Query rỗng / không có data thì nói rõ là không có data.`;
}

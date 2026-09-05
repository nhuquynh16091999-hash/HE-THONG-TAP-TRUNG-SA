// ═══════════════════════════════════════════════════════════════════
// TALPHA Inventory — builder dùng chung
// ───────────────────────────────────────────────────────────────────
// Đọc + parse Google Sheet "BÁO CÁO TỒN KHO HỢP NHẤT" (+ file gốc Saudi/UAE,
// + ảnh POS) → 1 payload chuẩn. Dùng bởi:
//   • /api/talpha/sync-inventory  → ghi snapshot vào BigQuery (mỗi 15')
//   • /api/talpha/inventory       → fallback khi BQ chưa có dữ liệu
// ═══════════════════════════════════════════════════════════════════
import { normCode } from "@/lib/talpha-stock-sources";
import { fetchPosInventory } from "@/lib/talpha-pos-images";
import { bigquery } from "@/lib/bigquery";
import type { MarketOverview, StatusSummary, SkuRow } from "@/components/talpha/data/inventory";

const BQ_PROJECT = process.env.NEXT_PUBLIC_BQ_PROJECT || "cty-507710";
const BQ_DATASET = process.env.DATASET || "TALPHA_Dataset";

// 7 thị trường = 7 shop POS. Thứ tự khớp cột trong bảng Sản phẩm & Kho.
const MARKETS_META = [
    { key: "sa", market: "Saudi Arabia", flag: "🇸🇦" },
    { key: "ae", market: "UAE", flag: "🇦🇪" },
    { key: "om", market: "OMAN", flag: "🇴🇲" },
    { key: "kw", market: "Kuwait", flag: "🇰🇼" },
    { key: "bh", market: "Bahrain", flag: "🇧🇭" },
    { key: "qa", market: "Qatar", flag: "🇶🇦" },
    { key: "tw", market: "Taiwan", flag: "🇹🇼" },
] as const;
const MK_KEYS = MARKETS_META.map((m) => m.key);

// Trạng thái tự tính từ tồn + tốc độ bán (thay phân loại tay của Sheet cũ).
function autoStatus(total: number, perDay: number | null, days: number | null): string {
    if (total < 0) return "Lỗi số liệu (tồn âm)";
    if (total === 0) return "Hết hàng toàn hệ thống";
    if (!perDay) return "Tồn đọng";                       // còn tồn nhưng 30 ngày không bán
    if (days != null && days < 30) return "Sắp thiếu (<30 ngày)";
    if (days != null && days < 60) return "Bán chạy";
    return "Ổn định";
}

// Tên marketer POS → tên hiển thị chuẩn — RULE CHUNG (config/talpha_rules.json).
import { normPosMarketer, DISPLAY } from "@/lib/talpha/rules";
function normMkt(nm: string | null): string | null {
    const key = normPosMarketer(nm);
    return key ? DISPLAY[key] || key : null;
}

// Mã SKU → (các) marketer đang chạy/bán mã đó (30 ngày, sắp theo số bán). Để mkt biết
// SP nào là của mình + trạng thái tồn của nó. Map qua variation_id (order_items thiếu tên).
async function fetchSkuMarketers(variationToCode: Map<string, string>): Promise<Record<string, string>> {
    const perCode: Record<string, Record<string, number>> = {};
    try {
        const [rows] = await bigquery.query({
            query: `
                SELECT oi.variation_id vid, JSON_EXTRACT_SCALAR(o.marketer, '$.name') nm, SUM(oi.quantity) qty
                FROM \`${BQ_PROJECT}.${BQ_DATASET}.order_items\` oi
                JOIN \`${BQ_PROJECT}.${BQ_DATASET}.sale_order\` o ON oi.order_id = CAST(o.id AS STRING)
                WHERE DATE(TIMESTAMP(o.inserted_at)) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
                  AND o.status_name != 'canceled' AND oi.variation_id != ''
                GROUP BY 1, 2`,
        });
        for (const r of rows as any[]) {
            const code = variationToCode.get(String(r.vid));
            const mk = normMkt(r.nm);
            if (!code || !mk) continue;
            const m = (perCode[code] = perCode[code] || {});
            m[mk] = (m[mk] || 0) + (Number(r.qty) || 0);
        }
    } catch (e: any) {
        console.error("sku marketers BQ error:", e?.message || e);
    }
    const out: Record<string, string> = {};
    for (const code of Object.keys(perCode)) {
        out[code] = Object.entries(perCode[code]).sort((a, b) => b[1] - a[1]).map(([m]) => m).slice(0, 3).join(", ");
    }
    return out;
}

// Bán 30 ngày theo (thị trường, mã SKU) — đơn THẬT từ BigQuery (đủ 7 kho).
// order_items chỉ có variation_id (UUID; tên SP trống) → map variation_id → mã SKU qua POS.
// Best-effort: lỗi → trả rỗng, cột bán/ngày để trống.
async function fetchSold30(variationToCode: Map<string, string>): Promise<Record<string, Record<string, number>>> {
    const out: Record<string, Record<string, number>> = {};
    try {
        const [rows] = await bigquery.query({
            query: `
                SELECT LOWER(o.shop_label) mk, oi.variation_id vid, SUM(oi.quantity) qty
                FROM \`${BQ_PROJECT}.${BQ_DATASET}.order_items\` oi
                JOIN \`${BQ_PROJECT}.${BQ_DATASET}.sale_order\` o ON oi.order_id = CAST(o.id AS STRING)
                WHERE DATE(TIMESTAMP(o.inserted_at)) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
                  AND o.status_name != 'canceled' AND oi.variation_id != ''
                GROUP BY 1, 2`,
        });
        for (const r of rows as any[]) {
            const code = variationToCode.get(String(r.vid));
            if (!code || !r.mk) continue;
            const m = (out[r.mk] = out[r.mk] || {});
            m[code] = (m[code] || 0) + (Number(r.qty) || 0);
        }
    } catch (e: any) {
        console.error("velocity BQ error:", e?.message || e);
    }
    return out;
}


export interface InventoryPayload {
    asOf: { label: string; note: string };
    marketOverview: MarketOverview[];
    statusSummary: StatusSummary[];
    skuMatrix: SkuRow[];
    transfers: any[];
    restocks: any[];
    keyFindings: string[];
    sources: any;
    fetchedAt: string;
}

/**
 * Nguồn CHUẨN = POS Poscake (actual_remain_quantity, 7 shop) — đã BỎ Google Sheet thủ công.
 * Tồn theo kho từ POS; bán/ngày từ đơn thật BigQuery 30 ngày; trạng thái tự tính.
 * Điều chuyển/nhập tay (analyst) không còn nguồn → để rỗng.
 */
export async function buildInventoryPayload(): Promise<InventoryPayload> {
    const pos = await fetchPosInventory();
    if (!pos.ok) throw new Error("POS không trả dữ liệu tồn — kiểm tra key/shop trong talpha.yaml");
    // cần map variation_id từ POS cho cả tốc độ bán lẫn marketer phụ trách
    const [sold, skuMkt] = await Promise.all([fetchSold30(pos.variationToCode), fetchSkuMarketers(pos.variationToCode)]);

    // Tập mã SKU = hợp mọi mã có trong 7 shop
    const codes = new Set<string>();
    for (const mk of MK_KEYS) for (const c of Object.keys(pos.stock[mk] || {})) codes.add(c);

    const skuMatrix: SkuRow[] = [];
    for (const code of codes) {
        const info = pos.catalog.get(code);
        const row: any = { code, name: info?.name || code, cat: info?.cat || "", img: info?.img || undefined };
        let total = 0, sold30 = 0;
        for (const mk of MK_KEYS) {
            const q = pos.stock[mk]?.[code];
            row[mk] = q === undefined ? null : q;
            if (q !== undefined) total += q;
            sold30 += sold[mk]?.[code] || 0;
        }
        const perDay = sold30 > 0 ? Math.round((sold30 / 30) * 10) / 10 : null;
        const days = perDay && total > 0 ? Math.round(total / perDay) : null;
        row.total = total; row.perDay = perDay; row.days = days;
        row.status = autoStatus(total, perDay, days); row.mkt = skuMkt[code] || "";
        skuMatrix.push(row as SkuRow);
    }
    skuMatrix.sort((a, b) => (b.total ?? 0) - (a.total ?? 0));

    const marketOverview: MarketOverview[] = MARKETS_META.map((m) => {
        const mt = pos.marketTotals[m.key] || { skus: 0, stock: 0 };
        const s30 = Object.values(sold[m.key] || {}).reduce((a, b) => a + b, 0);
        const perDay = s30 > 0 ? Math.round((s30 / 30) * 10) / 10 : null;
        const daysOfStock = perDay && mt.stock > 0 ? Math.round(mt.stock / perDay) : null;
        return {
            market: m.market, flag: m.flag, skus: mt.skus, stock: mt.stock,
            sold30: s30 || null, perDay, daysOfStock,
            source: "POS Poscake · actual_remain_quantity · realtime",
            note: mt.stock < 0 ? "Có SKU bán vượt kho (tồn âm)" : "",
        };
    }).filter((m) => m.skus > 0);

    const statusMap = new Map<string, { skus: number; stock: number }>();
    for (const r of skuMatrix) {
        const s = r.status || "";
        const e = statusMap.get(s) || { skus: 0, stock: 0 };
        e.skus++; e.stock += r.total ?? 0; statusMap.set(s, e);
    }
    const statusSummary: StatusSummary[] = [...statusMap.entries()]
        .map(([status, v]) => ({ status, skus: v.skus, stock: v.stock }))
        .sort((a, b) => b.skus - a.skus);

    const today = new Date().toLocaleDateString("vi-VN");
    return {
        asOf: { label: `POS realtime · ${today}`, note: "Tồn kho trực tiếp từ POS Poscake (7 shop) · bán/ngày từ đơn thật 30 ngày" },
        marketOverview, statusSummary, skuMatrix,
        transfers: [], restocks: [], keyFindings: [],
        sources: { pos: { ok: true, shops: pos.shops, skus: skuMatrix.length, field: "actual_remain_quantity" } },
        fetchedAt: new Date().toISOString(),
    };
}

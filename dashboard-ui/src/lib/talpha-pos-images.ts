/**
 * Ảnh sản phẩm lấy từ POS (Pancake/Poscake) — nguồn ảnh chính thức của shop.
 * Mỗi thị trường 1 shop; product.custom_id = mã SKU, ảnh nằm ở
 * product.image hoặc variations[].images[0] (URL content.pancake.vn…).
 * Map theo mã chuẩn hoá để ghép vào ma trận tồn kho.
 */

import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { normCode } from "@/lib/talpha-stock-sources";

// Local dev đọc ../config (bản chuẩn repo-root); Vercel không đóng gói thư mục cha
// → dùng ./config (bản sao prebuild). Giống realtime route.
const YAML_CANDIDATES = [
    path.join(process.cwd(), "..", "config", "projects", "talpha.yaml"),
    path.join(process.cwd(), "config", "projects", "talpha.yaml"),
];
const YAML_PATH = YAML_CANDIDATES.find((p) => fs.existsSync(p)) || YAML_CANDIDATES[1];

interface Shop { name: string; api_url: string; api_key: string; shop_id: string }

// Đọc danh sách shop POS từ talpha.yaml (resolve ${ENV} như realtime route).
function loadShops(): Shop[] {
    try {
        const raw = fs.readFileSync(YAML_PATH, "utf-8")
            .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_m, n) => process.env[n] || "");
        const cfg = yaml.load(raw) as { poscake?: { shops?: Shop[] } };
        return cfg?.poscake?.shops ?? [];
    } catch (e) {
        console.error("talpha-pos-images: không đọc được talpha.yaml:", e);
        return [];
    }
}

// Ảnh đại diện của 1 product: ưu tiên ảnh product, fallback ảnh biến thể đầu tiên.
function imageOf(p: any): string | null {
    if (p?.image) return p.image;
    for (const v of p?.variations ?? []) {
        if (Array.isArray(v?.images) && v.images[0]) return v.images[0];
    }
    return null;
}

export interface PosImages {
    byCode: Map<string, string>; // normCode → URL ảnh
    count: number;
    shops: number;
}

/** Quét sản phẩm tất cả shop POS → Map mã SKU → URL ảnh (first-wins). */
export async function fetchPosProductImages(revalidate = 600): Promise<PosImages> {
    const shops = loadShops();
    const byCode = new Map<string, string>();

    for (const s of shops) {
        let page = 1, pages = 1;
        do {
            const url = `${s.api_url}/shops/${s.shop_id}/products?api_key=${s.api_key}&page_number=${page}&page_size=100`;
            let j: any;
            try {
                const r = await fetch(url, { signal: AbortSignal.timeout(20000), next: { revalidate } });
                if (!r.ok) { console.error(`POS products ${s.name}: HTTP ${r.status}`); break; }
                j = await r.json();
            } catch (e) {
                console.error(`POS products ${s.name} lỗi:`, e);
                break;
            }
            pages = j.total_pages || 1;
            for (const p of j.data ?? []) {
                const code = normCode(p.custom_id || p.name || "");
                if (!code) continue;
                const img = imageOf(p);
                if (img && !byCode.has(code)) byCode.set(code, img);
            }
            page++;
        } while (page <= pages && page <= 10);
    }

    return { byCode, count: byCode.size, shops: shops.length };
}

// remain_quantity có thể là số hoặc object {warehouse_id: qty} → gộp về 1 số.
function remainQty(rq: any): number {
    if (typeof rq === "number") return rq;
    if (rq && typeof rq === "object") return Object.values(rq).reduce((a: number, b: any) => a + (Number(b) || 0), 0);
    return 0;
}

// TỒN KHO VẬT LÝ của 1 biến thể = tổng actual_remain_quantity qua các kho (khớp cột
// "Tổng tồn kho" trên POS; remain_quantity là "có thể bán" = đã trừ hàng giữ cho đơn).
function actualStock(v: any): number {
    const ws = v?.variations_warehouses;
    if (Array.isArray(ws) && ws.length) return ws.reduce((s: number, w: any) => s + (Number(w?.actual_remain_quantity) || 0), 0);
    return remainQty(v?.remain_quantity);
}

// shop POS (theo tên trong talpha.yaml) → market key của dashboard
const SHOP_MARKET: Record<string, string> = {
    Saudi: "sa", UAE: "ae", Kuwait: "kw", Oman: "om", Qatar: "qa", Bahrain: "bh", Taiwan: "tw",
};

export interface PosInvItem { code: string; name: string; cat: string; img: string | null }
export interface PosInventory {
    stock: Record<string, Record<string, number>>;         // market → code → tồn (actual_remain_quantity)
    catalog: Map<string, PosInvItem>;                       // code → tên/ngành/ảnh (first-wins)
    variationToCode: Map<string, string>;                   // variation_id (UUID) → mã SKU (để map đơn hàng)
    marketTotals: Record<string, { skus: number; stock: number }>;
    shops: number;
    ok: boolean;
}

/** Toàn bộ tồn kho + danh mục SP từ 7 shop POS Poscake (nguồn CHUẨN thay Google Sheet). */
export async function fetchPosInventory(revalidate = 300): Promise<PosInventory> {
    const shops = loadShops();
    const stock: Record<string, Record<string, number>> = {};
    const catalog = new Map<string, PosInvItem>();
    const variationToCode = new Map<string, string>();
    const marketTotals: Record<string, { skus: number; stock: number }> = {};
    let ok = false;
    for (const s of shops) {
        const mk = SHOP_MARKET[s.name];
        if (!mk) continue;
        stock[mk] = stock[mk] || {};
        let page = 1, pages = 1;
        do {
            const url = `${s.api_url}/shops/${s.shop_id}/products/variations?api_key=${s.api_key}&page_number=${page}&page_size=100`;
            let j: any;
            try {
                const r = await fetch(url, { signal: AbortSignal.timeout(20000), next: { revalidate } });
                if (!r.ok) { console.error(`POS inv ${s.name}: HTTP ${r.status}`); break; }
                j = await r.json();
                ok = true;
            } catch (e) {
                console.error(`POS inv ${s.name} lỗi:`, e);
                break;
            }
            pages = j.total_pages || 1;
            for (const v of j.data ?? []) {
                const p = v.product || {};
                const code = normCode(p.name || v.custom_id || "");
                if (!code) continue;
                if (v.id) variationToCode.set(String(v.id), code); // để map đơn hàng (order_items.variation_id)
                stock[mk][code] = (stock[mk][code] || 0) + actualStock(v);
                if (!catalog.has(code)) {
                    const img = (Array.isArray(v.images) && v.images[0]) || p.image || null;
                    const cat = Array.isArray(p.categories) && p.categories[0] ? (p.categories[0].name || "") : "";
                    catalog.set(code, { code, name: String(p.name || "").trim() || code, cat, img });
                }
            }
            page++;
        } while (page <= pages && page <= 15);
        const codes = Object.values(stock[mk]);
        marketTotals[mk] = { skus: codes.length, stock: codes.reduce((a, b) => a + b, 0) };
    }
    return { stock, catalog, variationToCode, marketTotals, shops: shops.length, ok };
}

export interface PosStock {
    byCode: Map<string, number>; // normCode → tổng tồn (remain_quantity)
    count: number;               // số SKU
    total: number;               // tổng tồn (có thể âm nếu bán vượt kho)
    ok: boolean;
}

/**
 * Tồn kho 1 thị trường lấy TRỰC TIẾP từ POS Poscake (endpoint products/variations,
 * remain_quantity). Dùng cho thị trường KHÔNG có cột trong sheet tồn thủ công (vd Taiwan).
 * Tồn ÂM = bán vượt kho / chưa nhập kho (giai đoạn test / dropship).
 */
export async function fetchPosStock(marketName: string, revalidate = 600): Promise<PosStock> {
    const shops = loadShops().filter((s) => s.name.toLowerCase() === marketName.toLowerCase());
    const byCode = new Map<string, number>();
    let ok = false;
    for (const s of shops) {
        let page = 1, pages = 1;
        do {
            const url = `${s.api_url}/shops/${s.shop_id}/products/variations?api_key=${s.api_key}&page_number=${page}&page_size=100`;
            let j: any;
            try {
                const r = await fetch(url, { signal: AbortSignal.timeout(20000), next: { revalidate } });
                if (!r.ok) { console.error(`POS stock ${s.name}: HTTP ${r.status}`); break; }
                j = await r.json();
                ok = true;
            } catch (e) {
                console.error(`POS stock ${s.name} lỗi:`, e);
                break;
            }
            pages = j.total_pages || 1;
            for (const v of j.data ?? []) {
                const p = v.product || {};
                const code = normCode(p.name || v.custom_id || v.display_id || "");
                if (!code) continue;
                byCode.set(code, (byCode.get(code) || 0) + remainQty(v.remain_quantity));
            }
            page++;
        } while (page <= pages && page <= 10);
    }
    let total = 0;
    for (const q of byCode.values()) total += q;
    return { byCode, count: byCode.size, total, ok };
}

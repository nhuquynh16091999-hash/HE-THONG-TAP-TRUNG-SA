/**
 * TALPHA — TYPE của payload tồn kho + nhãn thị trường.
 *
 * ⚠️ 20/08/2026: các mảng DATA TĨNH (snapshot Sheet 19/06) đã bị GỠ HẲN.
 * Trước đây chúng là lớp fallback cuối của tab Kho: POS chết → BQ chết → hiện số
 * 19/06 như thật. Số 2 tháng tuổi đội lốt số sống nguy hiểm hơn màn hình báo lỗi,
 * nên nay tab Kho hiện thẳng "không đọc được + nút thử lại" thay vì số cũ.
 * Cần tra lại snapshot 19/06: git log file này (bản trước 20/08/2026).
 */

export type Market = "sa" | "ae" | "om" | "kw" | "bh" | "qa" | "tw";

export const MARKET_LABELS: Record<Market, string> = {
    sa: "Saudi",
    ae: "UAE",
    om: "OMAN",
    kw: "Kuwait",
    bh: "Bahrain",
    qa: "Qatar",
    tw: "Taiwan",
};

export interface MarketOverview {
    market: string;
    flag: string;
    skus: number;
    stock: number;
    sold30: number | null;
    perDay: number | null;
    daysOfStock: number | null;
    source: string;
    note: string;
}

export interface StatusSummary {
    status: string;
    skus: number;
    stock: number;
}

export interface SkuRow {
    code: string;
    name: string;
    cat: string;
    img?: string;
    sa: number | null;
    ae: number | null;
    om: number | null;
    kw: number | null;
    bh: number | null;
    qa: number | null;
    tw?: number | null;   // Taiwan — nguồn POS Poscake (không có trong sheet thủ công)
    total: number;
    perDay: number | null;
    days: number | null;
    status: string;
    mkt: string;
}

export interface Transfer {
    sku: string;
    from: string;
    to: string;
    qty: string;
    reason: string;
}

export interface Restock {
    sku: string;
    qty: string;
    urgent: boolean;
    situation: string;
    allocation: string;
}

/**
 * TALPHA — TYPE của payload tồn kho.
 *
 * ⚠️ 20/08/2026: các mảng DATA TĨNH (snapshot Sheet 19/06) đã bị GỠ HẲN.
 * Trước đây chúng là lớp fallback cuối của tab Kho: POS chết → BQ chết → hiện số
 * 19/06 như thật. Số 2 tháng tuổi đội lốt số sống nguy hiểm hơn màn hình báo lỗi,
 * nên nay tab Kho hiện thẳng "không đọc được + nút thử lại" thay vì số cũ.
 *
 * ⚠️ 11/09/2026: bỏ 6 cột kho GCC (sa · ae · om · kw · bh · qa). Các shop đó đã
 * ngừng từ 05/09; POS không trả gì nên mỗi dòng SKU hiện sáu dấu "—" vô nghĩa.
 * Còn MỘT kho (Đài Loan) thì tồn của kho đó CHÍNH LÀ `total` — không cần cột riêng.
 * Cần tra lại cấu trúc 7 kho: git log file này (bản trước 11/09/2026).
 */

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
    /** Tồn toàn hệ thống. Một kho ⇒ đây chính là tồn kho Đài Loan. */
    total: number;
    perDay: number | null;
    days: number | null;
    status: string;
    /** Marketer đang chạy mã này (tối đa 3 tên, sắp theo số bán 30 ngày). */
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

/**
 * FILE ĐƠN HÀNG CỦA ĐỐI TÁC 3PL — nguồn trạng thái MIỄN PHÍ.
 *
 * Đối tác giữ một Google Sheet "BẢNG LÊN ĐƠN", cập nhật 2 ngày một lần, trong đó
 * cột NOTE đã có sẵn "Đợi khách đến lấy hàng" — đúng tín hiệu cần bắt để cứu đơn
 * trước khi bị trả về. Vì thế đây là nguồn CHÍNH, còn 17TRACK chỉ dùng soi thêm
 * cho đơn đáng ngờ, vì 17TRACK tốn quota còn file thì không.
 *
 * Đánh đổi: file trễ tới 2 ngày. Với hạn lấy hàng 7 ngày thì vẫn còn 5 ngày để
 * gọi khách — đủ dùng, và miễn phí.
 *
 * Hàm ở đây là hàm thuần: nhận nội dung file, trả dữ liệu đã chuẩn hoá.
 */
import { RULES } from "./rules";
import { parseDelimited } from "./cod-recon";
import type { MainStatus } from "./tracking";

// ─────────────────────────────────────────────────────────────────────────
// Cấu hình
// ─────────────────────────────────────────────────────────────────────────
type PartnerCfg = {
    column_map?: Record<string, string[]>;
    status_map?: Record<string, string>;
    track17_code_rules?: { digits: number; prefix: string }[];
};

const CFG: PartnerCfg =
    ((RULES as unknown as { tracking?: { partner_file?: PartnerCfg } }).tracking?.partner_file) || {};

const COLUMN_MAP = CFG.column_map || {};
const STATUS_MAP = CFG.status_map || {};
const CODE_RULES = CFG.track17_code_rules || [];

/** Trạng thái nội bộ: 9 mã của 17TRACK cộng hai trạng thái chỉ file đối tác mới có. */
export type PartnerStatus = MainStatus | "Returned" | "Cancelled";

/** Đơn đã kết thúc — không cảnh báo nữa, nhưng vẫn đếm để báo cáo. */
export const PARTNER_TERMINAL: ReadonlySet<string> = new Set(["Returned", "Cancelled"]);

export const PARTNER_STATUS_VI: Record<string, string> = {
    Returned: "Đã hoàn về kho",
    Cancelled: "Đã huỷ",
};

// ─────────────────────────────────────────────────────────────────────────
// Đọc file
// ─────────────────────────────────────────────────────────────────────────

/** Chuẩn hoá tên cột: bỏ dấu, bỏ ký tự lạ, về chữ thường. */
function normHeader(s: string): string {
    return s
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/gi, "d")
        .toLowerCase()
        .replace(/[^a-z0-9$().]+/g, " ")
        .trim();
}

export type PartnerColumns = Partial<Record<
    "order_no" | "tracking" | "track17_code" | "status" | "ship_method" | "cod" |
    "marketer" | "recon" | "ship_date" | "order_date" | "store_name" | "store_code" |
    "quantity" | "sku", number>>;

export function detectPartnerColumns(header: string[]): PartnerColumns {
    const norm = header.map(normHeader);
    const out: PartnerColumns = {};
    for (const [field, aliases] of Object.entries(COLUMN_MAP)) {
        const wanted = (aliases || []).map(normHeader);
        const idx = norm.findIndex((h) => h && wanted.includes(h));
        if (idx >= 0) out[field as keyof PartnerColumns] = idx;
    }
    return out;
}

/**
 * Sinh mã tra cứu 17TRACK từ mã vận đơn.
 *
 * Đối tác chỉ điền tay khoảng một nửa số dòng. Quy luật suy từ 289 dòng họ đã
 * điền: mã 8 số (7-Eleven) cần tiền tố "73N", mã 10–11 số (Family Mart, giao tại
 * nhà) dùng nguyên. Nhờ đó sinh được cho phần còn lại thay vì bỏ trống.
 */
export function track17CodeFor(tracking?: string | null): string | null {
    const t = String(tracking || "").trim();
    if (!t) return null;
    for (const r of CODE_RULES) {
        if (t.length === r.digits && /^\d+$/.test(t)) return `${r.prefix}${t}`;
    }
    return t;
}

/** NOTE của đối tác → trạng thái chuẩn. Giá trị lạ trả null để tầng trên nêu ra. */
export function mapPartnerStatus(note?: string | null): PartnerStatus | null {
    const n = String(note || "").trim();
    if (!n) return null;
    if (STATUS_MAP[n]) return STATUS_MAP[n] as PartnerStatus;
    // So lại sau khi bỏ dấu, để "Hủy" và "Huỷ" không thành hai thứ khác nhau.
    const target = normHeader(n);
    for (const [k, v] of Object.entries(STATUS_MAP)) {
        if (normHeader(k) === target) return v as PartnerStatus;
    }
    return null;
}

/** "13/07/2026" → "2026-07-13". Không đọc được thì trả null, KHÔNG đoán. */
export function parseDmy(s?: string | null): string | null {
    const m = String(s || "").trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (!m) return null;
    const [, d, mo, y] = m;
    const iso = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
    return Number.isNaN(Date.parse(iso)) ? null : iso;
}

export function parseMoney(s?: string | null): number {
    const n = parseFloat(String(s || "").replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? n : 0;
}

export type PartnerRow = {
    order_no: string;
    tracking: string;
    track17_code: string | null;
    raw_status: string;
    status: PartnerStatus | null;
    ship_method: string;
    cod_local: number;
    marketer: string;
    recon: string;
    ship_date: string | null;
    order_date: string | null;
    store_name: string;
    store_code: string;
    quantity: string;
    sku: string;
};

export type PartnerParse = {
    rows: PartnerRow[];
    header: string[];
    columns: PartnerColumns;
    missing_columns: string[];
    /** Giá trị NOTE chưa khai trong status_map — nêu ra chứ không nuốt. */
    unknown_statuses: { value: string; count: number }[];
};

const REQUIRED: (keyof PartnerColumns)[] = ["tracking", "status"];

/** Ngày xuất kho phải sau ngày lên đơn; ngược lại là dữ liệu hỏng → bỏ. */
function sane(shipDate: string | null, orderDate: string | null): string | null {
    if (!shipDate) return null;
    if (orderDate && shipDate < orderDate) return null;
    return shipDate;
}

export function parsePartnerFile(text: string): PartnerParse {
    const table = parseDelimited(text);
    if (!table.length) {
        return { rows: [], header: [], columns: {}, missing_columns: [...REQUIRED], unknown_statuses: [] };
    }
    const header = table[0].map((h) => h.trim());
    const columns = detectPartnerColumns(header);
    const at = (r: string[], i?: number) => (i === undefined ? "" : (r[i] ?? "").trim());

    const unknown = new Map<string, number>();
    const rows: PartnerRow[] = [];

    for (const r of table.slice(1)) {
        const tracking = at(r, columns.tracking);
        const orderNo = at(r, columns.order_no);
        if (!tracking && !orderNo) continue;              // dòng trống

        const rawStatus = at(r, columns.status);
        const status = mapPartnerStatus(rawStatus);
        if (rawStatus && !status) unknown.set(rawStatus, (unknown.get(rawStatus) || 0) + 1);

        rows.push({
            order_no: orderNo,
            tracking,
            // Đối tác điền tay thì tin họ; bỏ trống thì tự sinh theo quy luật.
            track17_code: at(r, columns.track17_code) || track17CodeFor(tracking),
            raw_status: rawStatus,
            status,
            ship_method: at(r, columns.ship_method),
            cod_local: parseMoney(at(r, columns.cod)),
            marketer: at(r, columns.marketer),
            recon: at(r, columns.recon),
            // Ngày xuất kho trước ngày lên đơn là vô lý — đã gặp dòng ghi xuất kho
            // 04/08/2025 mà lên đơn 2/8/2026, gõ nhầm năm. Bỏ đi còn hơn để nó
            // đẻ ra "đứng im 398 ngày" làm người đọc mất tin vào cảnh báo.
            ship_date: sane(parseDmy(at(r, columns.ship_date)), parseDmy(at(r, columns.order_date))),
            order_date: parseDmy(at(r, columns.order_date)),
            store_name: at(r, columns.store_name),
            store_code: at(r, columns.store_code),
            quantity: at(r, columns.quantity),
            sku: at(r, columns.sku),
        });
    }

    return {
        rows,
        header,
        columns,
        missing_columns: REQUIRED.filter((k) => columns[k] === undefined),
        unknown_statuses: [...unknown.entries()]
            .map(([value, count]) => ({ value, count }))
            .sort((a, b) => b.count - a.count),
    };
}

/** Tóm tắt để hiện ngay sau khi tải file lên. */
export function summarise(rows: PartnerRow[]) {
    const byStatus: Record<string, { orders: number; cod: number }> = {};
    for (const r of rows) {
        const k = r.status || "(chưa khai)";
        (byStatus[k] ||= { orders: 0, cod: 0 });
        byStatus[k].orders += 1;
        byStatus[k].cod += r.cod_local;
    }
    const pick = (k: string) => byStatus[k] || { orders: 0, cod: 0 };
    const returned = pick("Returned");
    const failing = pick("DeliveryFailure");
    return {
        total: rows.length,
        by_status: byStatus,
        waiting_pickup: pick("AvailableForPickup"),
        returned,
        // Tỷ lệ hoàn tính cả đơn đang trên đường hoàn — đó cũng là tiền đã mất.
        return_rate: rows.length
            ? (returned.orders + failing.orders) / rows.length
            : 0,
    };
}

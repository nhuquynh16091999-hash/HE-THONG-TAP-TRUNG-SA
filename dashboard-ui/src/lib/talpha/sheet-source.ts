/**
 * ĐỌC THẲNG GOOGLE SHEET CỦA ĐỐI TÁC — khỏi tải file tay.
 *
 * Đối tác cập nhật bảng 2 ngày một lần. Bắt người ngồi tải file rồi bấm nhập
 * mỗi lần là kiểu việc chắc chắn có ngày bị quên, mà quên đúng hôm có đơn sắp
 * quá hạn thì mất hàng.
 *
 * Hai đường đọc, thử theo thứ tự:
 *
 *   1. Tài khoản dịch vụ (KHUYẾN NGHỊ) — Sheet để RIÊNG TƯ, chỉ chia sẻ quyền
 *      Người xem cho email service account. Dùng lại đúng khoá đang đọc BigQuery,
 *      không phải xin thêm khoá nào.
 *
 *   2. Link công khai — chạy được ngay, nhưng ai có link đều đọc được. Bảng này
 *      có tên, số điện thoại và địa chỉ khách, nên chỉ dùng tạm.
 *
 * Thử tài khoản dịch vụ TRƯỚC: nếu nó đọc được thì Sheet không cần công khai nữa.
 */
import fs from "fs";
import path from "path";
import { GoogleAuth } from "google-auth-library";

export type SheetFetch = {
    csv: string;
    via: "service_account" | "public_link";
    /**
     * Bảng có đang ai-cũng-đọc-được không.
     *
     * Đọc được bằng tài khoản dịch vụ KHÔNG chứng minh bảng đã riêng tư — bảng
     * công khai thì mọi request đều đọc được, kể cả request có xác thực. Muốn
     * biết thì phải thử KHÔNG xác thực. Nhầm chỗ này là báo "an toàn" trong khi
     * tên, số điện thoại và địa chỉ khách vẫn đang phơi ra cho ai có link.
     */
    is_public: boolean;
};

export class SheetError extends Error {
    constructor(message: string, readonly status?: number) {
        super(message);
        this.name = "SheetError";
    }
}

/** Bóc id bảng từ link Google Sheet, hoặc nhận thẳng id. */
export function sheetIdFrom(urlOrId: string): string | null {
    const s = String(urlOrId || "").trim();
    if (!s) return null;
    const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/);
    if (m) return m[1];
    return /^[a-zA-Z0-9_-]{20,}$/.test(s) ? s : null;
}

export function exportUrl(sheetId: string, gid = "0"): string {
    return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
}

/** Thông tin xác thực dùng lại y hệt lib/bigquery.ts. */
function credentials(): { credentials?: Record<string, unknown>; keyFile?: string } | null {
    const inline = process.env.GCP_SA_KEY_JSON;
    if (inline) {
        try {
            return { credentials: JSON.parse(inline) };
        } catch {
            /* rơi xuống thử file */
        }
    }
    const keyFile = path.join(process.cwd(), "..", "bigquery_key.json");
    return fs.existsSync(keyFile) ? { keyFile } : null;
}

export function serviceAccountEmail(): string | null {
    const c = credentials();
    try {
        if (c?.credentials) return String(c.credentials.client_email || "") || null;
        if (c?.keyFile) return JSON.parse(fs.readFileSync(c.keyFile, "utf-8")).client_email || null;
    } catch {
        /* không đọc được thì thôi */
    }
    return null;
}

async function fetchAsServiceAccount(url: string): Promise<string | null> {
    const c = credentials();
    if (!c) return null;
    try {
        const auth = new GoogleAuth({
            ...c,
            scopes: ["https://www.googleapis.com/auth/drive.readonly"],
        });
        const token = await auth.getAccessToken();
        if (!token) return null;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return null;
        const text = await res.text();
        // Chưa chia sẻ cho service account thì Google trả trang đăng nhập HTML
        // với mã 200 — coi đó là thất bại, đừng đưa HTML vào máy đọc CSV.
        return text.trimStart().startsWith("<") ? null : text;
    } catch {
        return null;
    }
}

/** Thử đọc KHÔNG xác thực để biết bảng có đang công khai không. Chỉ xin vài byte. */
async function isPubliclyReadable(url: string): Promise<boolean> {
    try {
        const res = await fetch(url, { redirect: "follow", headers: { Range: "bytes=0-64" } });
        if (!res.ok && res.status !== 206) return false;
        const head = (await res.text()).trimStart();
        // Chưa công khai thì Google trả trang đăng nhập HTML chứ không phải CSV.
        return head.length > 0 && !head.startsWith("<");
    } catch {
        return false;
    }
}

/**
 * Tải bảng về dạng CSV. Ném lỗi có chữ tiếng Việt nói rõ phải làm gì, thay vì
 * để người dùng nhìn mã lỗi HTTP trần.
 */
export async function fetchSheetCsv(sheetId: string, gid = "0"): Promise<SheetFetch> {
    const url = exportUrl(sheetId, gid);

    const viaSa = await fetchAsServiceAccount(url);
    if (viaSa) {
        return { csv: viaSa, via: "service_account", is_public: await isPubliclyReadable(url) };
    }

    const res = await fetch(url, { redirect: "follow" });
    if (res.status === 401 || res.status === 403) {
        const email = serviceAccountEmail();
        throw new SheetError(
            "Không mở được bảng. Chia sẻ bảng cho " +
            (email ? `“${email}”` : "email tài khoản dịch vụ") +
            " với quyền Người xem — cách này giữ được bảng ở chế độ riêng tư.",
            res.status,
        );
    }
    if (!res.ok) throw new SheetError(`Google trả HTTP ${res.status} khi tải bảng.`, res.status);

    const csv = await res.text();
    if (csv.trimStart().startsWith("<")) {
        throw new SheetError("Google trả về trang web chứ không phải dữ liệu — bảng đang không cho đọc.");
    }
    return { csv, via: "public_link", is_public: true };
}

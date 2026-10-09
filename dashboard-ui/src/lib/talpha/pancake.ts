// ═══════════════════════════════════════════════════════════════════
// Pancake (pages.fm) — đếm TIN NHẮN theo page, cho nước mà Meta KHÔNG báo số tin nhắn.
//
// Vì sao (Sỹ Anh yêu cầu 09/10/2026): quảng cáo chạy ở Nhật không có chỉ số tin nhắn trên
// Meta (luật bảo vệ thông tin liên lạc của Nhật, như châu Âu) — hai camp Nhật đầu tiên đều
// là camp tin nhắn (Tương tác → Messenger → Cuộc trò chuyện) mà insights trả 0 mess. Số
// thật nằm trong hộp thư Pancake của page, nên đếm ở đó.
//
// API: https://pages.fm/api/v1 với access_token của TÀI KHOẢN Pancake (JWT, ~90 ngày, ghi
// trong TALPHA_PANCAKE_API_TOKEN). public_api/v1 trả "Invalid access_token" với token tài
// khoản nên dùng v1. Đo 09/10/2026:
//   • /pages → { categorized: { activated: [page…] } }
//   • /pages/{id}/conversations?current_count=N — lật trang bằng current_count (page_number
//     bị BỎ QUA: trang nào cũng trả cùng lô); lô đầu 60, lô sau 40; xếp theo updated_at mới
//     nhất trước. Hội thoại KHÔNG ghi đến từ quảng cáo nào → gom theo PAGE rồi nối camp bằng
//     tên page trong tên camp (mỗi camp Nhật một page).
//   • inserted_at / updated_at là giờ UTC không ghi múi (như POS) — đổi +7 ra ngày VN.
//   • Gọi dồn là 429 Too Many Requests → giãn lượt, gặp 429 thì chờ rồi thử lại.
// Hàm ở đây là hàm THUẦN (không mạng) để test được; route /api/talpha/pancake-nuoc gọi mạng.
// ═══════════════════════════════════════════════════════════════════
import { CAMP_MARKETS, normCampMarketer } from "./rules";

export const PANCAKE_API = "https://pages.fm/api/v1";

export type HoiThoai = {
    id: string; type?: string | null; inserted_at?: string | null; updated_at?: string | null;
    has_phone?: boolean | null;
};
export type DemNgay = { inbox_moi: number; comment_moi: number; co_sdt: number };

/** Tên page để SO KHỚP — cùng luật chuan_ten_page (ops/talpha_reports/talpha_rules.py): bỏ kiểu
 *  chữ trang trí (𝑱𝒂𝒑𝒂𝒏 → japan), hoa thường, dấu câu, khoảng trắng thừa. */
export function chuanTenPage(s?: string | null): string {
    return String(s || "").normalize("NFKC").toLowerCase()
        .replace(/[^\p{L}\p{N}_]+/gu, " ").trim().replace(/\s+/g, " ");
}

/** Ô TÊN PAGE trong tên campaign chuẩn NƯỚC/MARKETER/TỆP/SẢNPHẨM/TRANG/NGÀY — ô thứ 4 sau ô nước.
 *  Không có ô nước (tên cũ) thì đếm từ ô marketer như camp_san_pham. Không thấy → null. */
export function trangCuaCamp(cn?: string | null): string | null {
    const p = String(cn || "").split("/").map((x) => x.trim());
    const mi = p.findIndex((s) => s.toUpperCase() in CAMP_MARKETS);
    const k = mi >= 0 ? mi + 1 : p.slice(0, 2).findIndex((s) => normCampMarketer(s));
    if (k < 0) return null;
    const t = p[k + 3];
    return t ? t : null;
}

/** "2026-10-08T22:39:09.188" (UTC không múi) → ngày VN "2026-10-09". Hỏng → null. */
export function ngayVN(iso?: string | null): string | null {
    const s = String(iso || "").trim();
    if (!s) return null;
    const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + "Z");
    return Number.isNaN(t) ? null : new Date(t + 7 * 3600_000).toISOString().slice(0, 10);
}

/** 00:00 ngày VN `ngay` tính bằng epoch ms. */
export const dauNgayVN = (ngay: string) => Date.parse(`${ngay}T00:00:00+07:00`);

/** Hội thoại MỚI trong ngày VN: INBOX = tin nhắn mới (cùng nghĩa "cuộc trò chuyện mới" của Meta),
 *  COMMENT = bình luận mới; co_sdt = số tin nhắn mới đã có số điện thoại. Trùng id chỉ đếm một lần. */
export function demTrongNgay(hts: HoiThoai[], ngay: string): DemNgay {
    const out: DemNgay = { inbox_moi: 0, comment_moi: 0, co_sdt: 0 };
    const da = new Set<string>();
    for (const h of hts) {
        if (!h || da.has(h.id) || ngayVN(h.inserted_at) !== ngay) continue;
        da.add(h.id);
        if (String(h.type || "").toUpperCase() === "COMMENT") out.comment_moi++;
        else { out.inbox_moi++; if (h.has_phone) out.co_sdt++; }
    }
    return out;
}

/** Lật tiếp hay thôi: lô xếp theo updated_at giảm dần, nên khi CẢ lô đã cập nhật trước 00:00 ngày
 *  `ngay` thì không còn hội thoại nào TẠO trong ngày đó ở các lô sau (tạo ≤ cập nhật). */
export function hetLoTrongNgay(lo: HoiThoai[], ngay: string): boolean {
    if (!lo.length) return true;
    const dau = dauNgayVN(ngay);
    return lo.every((h) => {
        const s = String(h.updated_at || h.inserted_at || "");
        const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + "Z");
        return !Number.isNaN(t) && t < dau;
    });
}

/** Hạn của token Pancake (JWT, trường exp) → epoch ms; không đọc được → null. */
export function hanToken(jwt?: string | null): number | null {
    const p = String(jwt || "").split(".");
    if (p.length !== 3) return null;
    try {
        const j = JSON.parse(Buffer.from(p[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
        return typeof j.exp === "number" ? j.exp * 1000 : null;
    } catch { return null; }
}

/** Page của một nước theo tên: TỪ CUỐI là mã nước ("Lucky Charm JP", "… Cream JP"). Bổ sung cho
 *  cách khớp chính (tên page trong tên camp), để page mới chưa chạy camp vẫn được đếm. CHỈ từ cuối:
 *  "Japan Prime Leather" là page ĐÀI (camp TW/…) — khớp cả tên là đếm nhầm tin nhắn Đài sang Nhật.
 *  Route chỉ truyền MÃ SHOP (JP): đuôi "Japan" còn là tên hàng ("Prime Leather Japan" bán ở Đài). */
export function laTrangCuaNuoc(ten: string | null | undefined, tokens: string[]): boolean {
    const tu = chuanTenPage(ten).toUpperCase().split(" ");
    const cuoi = tu[tu.length - 1];
    return !!cuoi && tokens.some((t) => chuanTenPage(t).toUpperCase() === cuoi);
}

/**
 * ĐỐI SOÁT COD THỊ TRƯỜNG NGOÀI ĐÀI (Singapore, UAE…) — bước 1, Sỹ Anh chốt 26/09/2026.
 *
 * Chưa có sao kê của bên giao hàng nào ngoài NAZA Đài, nên chưa khớp được từng kỳ. Bước này
 * chỉ trả lời câu Sỹ Anh hỏi trên màn Đài: tiền còn ở đâu —
 *   • ĐÃ GIAO  : khách đã trả, tiền đang nằm ở bên giao hàng, chờ họ gửi về;
 *   • CHƯA GIAO: tiền còn ngoài đường;
 *   • KHÔNG TÍNH: hoàn, huỷ, tiêu huỷ — không bao giờ có tiền.
 * Tiền quy VND theo tỷ giá khai ở talpha_rules.json → markets.*.rate_vnd, CHƯA trừ phí
 * (phí ship, phí thu hộ) — chưa có sao kê thì không biết họ trừ bao nhiêu.
 *
 * Hàm thuần — không gọi mạng, không đọc file — để test được.
 */
import { statusLabel } from "./tracking";

export type NhomDon = "da_giao" | "chua_giao" | "khong_tinh";
export type LyDoKhongTinh = "hoan" | "huy" | "tieu_huy";

export type DonCod = {
    order_id: string;
    tracking: string;
    order_date: string | null;
    trang_thai: string;
    nhom: NhomDon;
    ly_do?: LyDoKhongTinh;
    cod_local: number;
    khach: string;
};

type Phan = { nhom: NhomDon; ly_do?: LyDoKhongTinh };

/**
 * Theo trạng thái vận đơn chuẩn (bảng đối tác + 17TRACK). Hàng ĐANG hoàn (17TRACK báo
 * Exception_Returning) cũng không tính: tiền không về nữa, đếm vào "chưa giao" là hứa hão.
 */
export function nhomTheoVanDon(status?: string | null, sub?: string | null): Phan {
    if (status === "Delivered") return { nhom: "da_giao" };
    if (status === "Returned" || status === "Expired") return { nhom: "khong_tinh", ly_do: "hoan" };
    if (status === "Exception" && /Return/.test(String(sub || ""))) return { nhom: "khong_tinh", ly_do: "hoan" };
    if (status === "Cancelled") return { nhom: "khong_tinh", ly_do: "huy" };
    if (status === "Destroyed") return { nhom: "khong_tinh", ly_do: "tieu_huy" };
    return { nhom: "chua_giao" };
}

/**
 * Theo nhóm trạng thái POS (vw_orders_std.status_category) — cho nước chưa có bảng đối tác.
 * Đơn thô (DON_THO) chưa phải đơn thật, chưa đi đâu cả → trả null, bỏ khỏi danh sách.
 */
export function nhomTheoPos(category?: string | null): Phan | null {
    const c = String(category || "").toUpperCase();
    if (c === "DON_THO") return null;
    if (c === "GIAO_THANH_CONG") return { nhom: "da_giao" };
    if (c === "DON_HOAN") return { nhom: "khong_tinh", ly_do: "hoan" };
    if (c === "HUY") return { nhom: "khong_tinh", ly_do: "huy" };
    return { nhom: "chua_giao" };
}

// Tên trạng thái POS (vw_orders_std.status_name, tiếng Anh) → chữ đọc được. "pending" giữ kèm
// chữ gốc vì POS dùng nó cho cả "chờ hàng" lẫn "chờ gửi" — dịch cứng một nghĩa là đoán.
const POS_VI: Record<string, string> = {
    new: "Đơn mới, chưa xác nhận",
    submitted: "Đã xác nhận, chưa gửi hàng",
    pending: "Chờ xử lý (pending)",
    shipped: "Đã gửi hàng, đang giao",
    delivered: "Đã giao",
    received_money: "Đã nhận tiền",
    returned: "Đã hoàn",
    canceled: "Đã huỷ",
};

/** Chữ trạng thái POS: tên đã dịch, chưa dịch thì chữ gốc, không có thì nhóm trạng thái. */
export function nhanTrangThaiPos(name?: string | null, category?: string | null): string {
    const n = String(name || "").trim();
    return POS_VI[n.toLowerCase()] || n || String(category || "") || "Chưa rõ";
}

/** Chữ trạng thái hiển thị: nhãn chuẩn, không có thì chữ gốc của nguồn. */
export function nhanTrangThai(status?: string | null, raw?: string | null): string {
    return status ? statusLabel(status) : (String(raw || "").trim() || "Chưa rõ");
}

export type Khoan = { so_don: number; cod_local: number; vnd_uoc: number | null };
export type TongHopCod = {
    da_giao: Khoan;
    chua_giao: Khoan & { theo_trang_thai: { trang_thai: string; so_don: number; cod_local: number }[] };
    khong_tinh: Khoan & { hoan: number; huy: number; tieu_huy: number };
};

/** Cộng từng nhóm. rateVnd ≤ 0 (chưa khai tỷ giá) → vnd_uoc null, KHÔNG nhân bừa. */
export function tongHopCod(don: DonCod[], rateVnd: number): TongHopCod {
    const vnd = (x: number) => (rateVnd > 0 ? Math.round(x * rateVnd) : null);
    const cong = (xs: DonCod[]): Khoan => {
        const cod = xs.reduce((n, d) => n + (Number(d.cod_local) || 0), 0);
        return { so_don: xs.length, cod_local: Math.round(cod * 100) / 100, vnd_uoc: vnd(cod) };
    };
    const daGiao = don.filter((d) => d.nhom === "da_giao");
    const chuaGiao = don.filter((d) => d.nhom === "chua_giao");
    const khongTinh = don.filter((d) => d.nhom === "khong_tinh");

    const theo = new Map<string, { trang_thai: string; so_don: number; cod_local: number }>();
    for (const d of chuaGiao) {
        const x = theo.get(d.trang_thai) || { trang_thai: d.trang_thai, so_don: 0, cod_local: 0 };
        x.so_don++;
        x.cod_local += Number(d.cod_local) || 0;
        theo.set(d.trang_thai, x);
    }
    return {
        da_giao: cong(daGiao),
        chua_giao: { ...cong(chuaGiao), theo_trang_thai: [...theo.values()].sort((a, b) => b.so_don - a.so_don) },
        khong_tinh: {
            ...cong(khongTinh),
            hoan: khongTinh.filter((d) => d.ly_do === "hoan").length,
            huy: khongTinh.filter((d) => d.ly_do === "huy").length,
            tieu_huy: khongTinh.filter((d) => d.ly_do === "tieu_huy").length,
        },
    };
}

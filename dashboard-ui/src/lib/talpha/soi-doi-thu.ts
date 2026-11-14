// ═══════════════════════════════════════════════════════════════════
// SOI ĐỐI THỦ — kết quả soi nhóm bán khác / đối thủ (bản đầu: Team 5 KIOT Taiwan, 12/11/2026).
//
// Đây là số THAM CHIẾU đọc từ kho POS của nhóm khác, kênh TikTok và Meta Ad Library — không
// phải số bán hàng của công ty. Số nằm ở config/soi_doi_thu.json: mỗi lần soi là một bản trong
// `snapshots`, MỚI NHẤT ĐỨNG ĐẦU, không sửa bản cũ. Ảnh sản phẩm ở public/soi-doi-thu/<nguồn>/.
//
// File này THUẦN: kiểu dữ liệu + hàm tính — không đụng `fs`, để tab (client component) dùng
// chung được. Đọc đĩa nằm ở route /api/talpha/soi-doi-thu.
// ═══════════════════════════════════════════════════════════════════

export type NhomSP = "dang_chay" | "ban_nhieu" | "dat_them" | "dang_test" | "nen_tranh";

export const NHOM_SP: { id: NhomSP; ten: string; mo_ta: string }[] = [
    { id: "dang_chay", ten: "Đang chạy mạnh", mo_ta: "Xuất nhiều nhất 7 ngày gần nhất." },
    { id: "ban_nhieu", ten: "Bán nhiều nhất từ trước đến nay", mo_ta: "Hàng đã chạy lâu, một số đã chững." },
    { id: "dat_them", ten: "Đang đặt thêm hàng", mo_ta: "Nhóm kia nhập thêm nghĩa là đã có lời." },
    { id: "dang_test", ten: "Đang test", mo_ta: "Bán khi chưa nhập hàng, nên tồn kho đang âm." },
    { id: "nen_tranh", ten: "Nên tránh", mo_ta: "Hoàn cao hoặc ôm tồn: xem để biết, không làm theo." },
];

export type LienKet = { nhan: string; url: string };
export type VideoTop = { tieu_de: string; nghia: string; view: number | null };

export type SanPham = {
    ma: string; nhom: NhomSP; ten: string; mo_ta: string; tep: string;
    /** Đường dẫn ảnh trong public/ (vd. /soi-doi-thu/kiot-tw/simwood.jpg) hoặc null nếu kho không có ảnh. */
    anh: string | null;
    ngay_tao: string;
    da_xuat: number; xuat_7_ngay: number; dang_hoan: number;
    /** dang_hoan / da_xuat; null khi chưa xuất cái nào. */
    ty_le_hoan: number | null;
    /** Tạo chưa đủ 4 tuần: hàng hoàn chưa kịp về nên tỉ lệ hoàn chưa có nghĩa. */
    moi: boolean;
    dat_them: number; ton: number; dang_giao: number;
    offer: string;
    video_top: VideoTop | null;
    lien_ket: LienKet[];
};

export type KenhTikTok = {
    user: string; san_pham: string; tep: string; video: number; tong_view: number; follower: number | null;
    video_top: { id: string; view: number; tieu_de: string; nghia: string };
};

export type SnapshotSoi = {
    ngay: string; nguon: string;
    /** Mã nước của dashboard (TW · SG · AE · JP · VN) — dùng để cắt theo team. */
    thi_truong: string;
    nguoi_soi: string; cach_soi: string; bao_cao?: string; theo_doi?: string;
    tom_tat: string[];
    tong_quan: {
        san_pham: number; ma_hang: number; nhap: number; xuat: number; xuat_7_ngay: number;
        dang_hoan: number; qua_tang: number; kenh_tiktok: number; kenh_facebook: number; bat_dau: string;
    };
    tep_khach: { ten: string; tieu_de: string; vi_du: string[]; cau_mau: string }[];
    tin_hieu: {
        dat_them: { ten: string; so: number }[];
        dang_test: { ten: string; so: number; tu: string }[];
        hoan_cao: { ten: string; ty_le: number }[];
        om_ton: { ten: string; ton: number; nhap: number }[];
        qua_tang: string;
    };
    cong_thuc: { nhan: string; tieu_de: string; noi_dung: string; cau_mau?: { cau: string; nghia: string }[] }[];
    kenh_tiktok: KenhTikTok[];
    facebook: { ghi_chu: string; muc: { nhan: string; tieu_de: string; so_ads: number | null; noi_dung: string; link: string }[] };
    ap_dung: {
        ghi_chu: string;
        danh_sach_test: { san_pham: string; vi_sao: string; tep: string; luu_y: string }[];
        ke_hoach: { khi: string; tieu_de: string; viec: string[] }[];
        hook_mau: { cau: string; nghia: string }[];
    };
    gioi_han: string[];
    san_pham: SanPham[];
};

export type SoiDoiThuFile = { mo_ta?: string; snapshots: SnapshotSoi[] };

/** Mức tỉ lệ hoàn để tô màu: dưới 8% tốt, 8–15% vừa, trên 15% xấu; hàng mới chưa xếp. */
export function mucHoan(p: Pick<SanPham, "ty_le_hoan" | "moi">): "tot" | "vua" | "xau" | "moi" {
    if (p.moi || p.ty_le_hoan === null) return "moi";
    if (p.ty_le_hoan < 0.08) return "tot";
    if (p.ty_le_hoan <= 0.15) return "vua";
    return "xau";
}

/** Số gọn kiểu TikTok: 1.400.000 → "1,4M", 62.000 → "62K", 950 → "950". */
export function soGon(n: number): string {
    if (n >= 1e6) return `${(Math.round(n / 1e5) / 10).toString().replace(".", ",")}M`;
    if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
    return String(Math.round(n));
}

/** Sản phẩm xếp theo xuất 7 ngày (nhiều → ít) trong một nhóm. */
export function xepTheo7Ngay(sp: SanPham[], nhom: NhomSP): SanPham[] {
    return sp.filter((p) => p.nhom === nhom).sort((a, b) => b.xuat_7_ngay - a.xuat_7_ngay);
}

/** Sản phẩm bán nhiều nhất từ trước đến nay (mọi nhóm trong thư viện). */
export function banNhieuNhat(sp: SanPham[], n: number): SanPham[] {
    return [...sp].sort((a, b) => b.da_xuat - a.da_xuat).slice(0, n);
}

/**
 * Chỉ giữ bản soi của thị trường người xem được phép (phân quyền theo team). `duoc(code)` do
 * route truyền vào (canMarket) để file này không kéo theo luật phân quyền.
 */
export function locTheoNuoc(f: SoiDoiThuFile, duoc: (code: string) => boolean): SoiDoiThuFile {
    return { ...f, snapshots: f.snapshots.filter((s) => duoc(s.thi_truong)) };
}

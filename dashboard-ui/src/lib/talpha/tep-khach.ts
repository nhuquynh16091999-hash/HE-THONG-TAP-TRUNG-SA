// ═══════════════════════════════════════════════════════════════════
// TỆP KHÁCH — số tham chiếu về người Việt / Phi / Indo ở từng thị trường (14/11/2026).
//
// Đây là NGHIÊN CỨU THỊ TRƯỜNG (thống kê nhà nước + quy mô đối tượng Facebook), không phải
// số bán hàng. Số nằm ở config/tep_khach.json — mỗi lần đo lại thêm một bản vào ĐẦU mảng
// `snapshots`, không sửa bản cũ. Tab Khách hàng → Tệp khách đọc qua /api/talpha/tep-khach.
//
// File này THUẦN: kiểu dữ liệu + hàm tính (lọc nước, điểm giữa) — không đụng `fs`, để tab
// (client component) dùng chung được. Đọc đĩa nằm ở route.
// ═══════════════════════════════════════════════════════════════════

/** Khoảng ước tính của Meta: [thấp, cao], đơn vị tài khoản. */
export type Khoang = [number, number];
export type MaNhom = "VN" | "PH" | "ID";
export const NHOM_TUOI = ["18-24", "25-34", "35-44", "45+"] as const;

export type Tep = {
    fb: Khoang; nam: Khoang; nu: Khoang;
    tuoi: Record<string, Khoang>;
    /** Số người theo thống kê nhà nước, hoặc ước tính đại sứ quán (`chinh_thuc_loai`). */
    chinh_thuc: number;
    chinh_thuc_loai: "thong_ke" | "uoc_tinh";
    chinh_thuc_ghi_chu: string;
    diem_chinh: string[];
};
export type DongBang = { ten: string; VN: number; PH: number; ID: number; tong?: boolean };
export type Bang = { tieu_de: string; nguon: string; ty_le_theo_tong: boolean; dong: DongBang[] };
export type XuHuong = { tieu_de: string; moc: string[]; VN: number[]; PH: number[]; ID: number[] };
export type ThiTruongTep = {
    ten: string; fb_ca_nuoc: Khoang; nguon_chinh_thuc: string;
    tep: Record<MaNhom, Tep>;
    xu_huong?: XuHuong;
    bang: Bang[];
    ghi_chu: string[];
};
export type Snapshot = {
    ngay_do: string; nguoi_do: string; cach_do: string; bao_cao?: string;
    tom_tat: string[];
    /** Khoá = mã nước của dashboard (TW · JP · SG). */
    thi_truong: Record<string, ThiTruongTep>;
    nhan_dinh: { ghi_chu: string; thu_tu: { tep: string; ly_do: string }[] };
    gioi_han: string[];
    nguon: { ten: string; url: string }[];
};
export type NhomInfo = { ten: string; day_du: string; hanh_vi_meta: string; fb_toan_cau: Khoang };
export type TepKhachFile = { nhom: Record<MaNhom, NhomInfo>; snapshots: Snapshot[] };

export const giua = (k: Khoang) => (k[0] + k[1]) / 2;

/** Tỷ lệ nữ tính từ điểm giữa hai khoảng nam / nữ. */
export function tyLeNu(t: Tep): number {
    const nu = giua(t.nu), nam = giua(t.nam);
    return nu + nam > 0 ? nu / (nu + nam) : 0;
}

/** Tỷ trọng từng nhóm tuổi (điểm giữa), cộng lại = 1. */
export function tyLeTuoi(t: Tep): number[] {
    const g = NHOM_TUOI.map((k) => (t.tuoi[k] ? giua(t.tuoi[k]) : 0));
    const s = g.reduce((x, y) => x + y, 0);
    return g.map((x) => (s > 0 ? x / s : 0));
}

/**
 * Chỉ giữ thị trường người xem được phép (phân quyền theo team). `duoc(code)` do route truyền
 * vào (canMarket) để file này không kéo theo luật phân quyền. Bản nào hết thị trường thì bỏ.
 */
export function locTheoNuoc(f: TepKhachFile, duoc: (code: string) => boolean): TepKhachFile {
    const snapshots = f.snapshots
        .map((s) => ({
            ...s,
            thi_truong: Object.fromEntries(Object.entries(s.thi_truong).filter(([code]) => duoc(code))),
        }))
        .filter((s) => Object.keys(s.thi_truong).length > 0);
    return { nhom: f.nhom, snapshots };
}

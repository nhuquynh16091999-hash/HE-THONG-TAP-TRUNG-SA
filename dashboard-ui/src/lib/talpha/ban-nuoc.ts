// ═══════════════════════════════════════════════════════════════════
// Bản số theo NƯỚC × NGÀY × NGƯỜI — vòng ghi Sheet (ops/talpha_reports/format_all.py) ghi mỗi giờ
// vào data/bao_cao_nuoc/<YYYY-MM>.json, CÙNG lúc với file TỔNG TEAM:
//   { thang, ghi_luc, khong_gan, nuoc: { "Japan": { "2026-10-12": { "SAnh": { ads, mess, don,
//     doanh_so, ds_giao_tc } } } } }
// Số tin nhắn của nước Meta không báo (Nhật) trong bản này đã là số Pancake — nên màn nào tự tính
// từ BigQuery (Meta) mà cần mess Nhật thì lấy ở đây cho khớp Sheet (Sỹ Anh 13/10/2026).
// ═══════════════════════════════════════════════════════════════════
import * as fs from "fs";
import * as path from "path";
import { REPO_ROOT } from "./config-path";
import { MESS_PANCAKE } from "./rules";

export type BanNuoc = {
    thang: string; ghi_luc?: string | null; khong_gan?: string;
    nuoc: Record<string, Record<string, Record<string, { mess?: number | null }>>>;
};

/** Các tháng "YYYY-MM" chạm khoảng [tu, den]. */
export function cacThang(tu: string, den: string): string[] {
    const out: string[] = [];
    let y = Number(tu.slice(0, 4)), m = Number(tu.slice(5, 7));
    const yd = Number(den.slice(0, 4)), md = Number(den.slice(5, 7));
    while ((y < yd || (y === yd && m <= md)) && out.length < 36) {
        out.push(`${y}-${String(m).padStart(2, "0")}`);
        if (++m > 12) { m = 1; y++; }
    }
    return out;
}

/** Mess của các nước `keys` trong khoảng [tu, den], gom theo người (khoá tab: "SAnh"…). THUẦN. */
export function gomMess(bans: BanNuoc[], tu: string, den: string, keys: string[]): { tong: number; theoNguoi: Record<string, number> } {
    const theoNguoi: Record<string, number> = {};
    let tong = 0;
    for (const b of bans) {
        for (const k of keys) {
            for (const [ngay, nguoi] of Object.entries(b.nuoc?.[k] || {})) {
                if (ngay < tu || ngay > den) continue;
                for (const [nv, so] of Object.entries(nguoi || {})) {
                    const n = Number(so?.mess || 0);
                    if (!n) continue;
                    theoNguoi[nv] = (theoNguoi[nv] || 0) + n;
                    tong += n;
                }
            }
        }
    }
    return { tong, theoNguoi };
}

function docBan(thang: string): BanNuoc | null {
    try { return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data", "bao_cao_nuoc", `${thang}.json`), "utf8")); }
    catch { return null; }
}

/**
 * Mess Pancake (nước MESS_PANCAKE mà người xem được thấy — `choXem(khoá nước)`) theo người trong
 * khoảng [tu, den]. `thieu_thang`: tháng không có bản (vòng ghi Sheet chưa chạy) — số tháng đó
 * không có trong tổng, màn hình phải nói ra.
 */
export function messPancakeTuBan(tu: string, den: string, choXem: (key: string) => boolean = () => true): {
    tong: number; theoNguoi: Record<string, number>; nuoc: string[]; ghi_luc: string | null; thieu_thang: string[];
} {
    const keys = MESS_PANCAKE.filter(choXem);
    const bans: BanNuoc[] = [];
    const thieu: string[] = [];
    let ghiLuc: string | null = null;
    if (keys.length) {
        for (const t of cacThang(tu, den)) {
            const b = docBan(t);
            if (!b) { thieu.push(t); continue; }
            bans.push(b);
            if (b.ghi_luc && (!ghiLuc || b.ghi_luc < ghiLuc)) ghiLuc = b.ghi_luc;
        }
    }
    return { ...gomMess(bans, tu, den, keys), nuoc: keys, ghi_luc: ghiLuc, thieu_thang: thieu };
}

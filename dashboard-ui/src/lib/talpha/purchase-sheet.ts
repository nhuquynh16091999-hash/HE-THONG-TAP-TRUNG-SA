// ═══════════════════════════════════════════════════════════════════
// TALPHA — FILE TIỀN HÀNG: tiền mua hàng phải trả ở mỗi kỳ đối soát COD
// ───────────────────────────────────────────────────────────────────
// Google Sheet ghi tay: mỗi dòng một lần mua (ngày · sản phẩm · số lượng · giá
// tệ/sp), và bên cạnh mỗi tuần có một ô ghi đợt thanh toán, kiểu:
//
//     THANH TOÁN NGÀY 14/8 TỔNG : 8.393.597 VND
//     （ ĐÃ THANH TOÁN 6.988.000 VND） CÒN THIẾU : 1.405.597 VND
//
// Đợt thanh toán rơi ĐÚNG ngày NAZA gửi sao kê COD mỗi tuần. Đó là mảnh cuối của
// luồng tiền NAZA:
//
//     COD (TWD) × tỷ giá → RMB − phí thao tác − phí ship → × tỷ giá → VND
//                                                      − PHÍ MUA HÀNG → PHẢI NHẬN
//
// Từ kỳ 21/08 NAZA tự trừ tiền hàng trong sao kê; 4 kỳ trước đó (24/07 → 14/08)
// Sỹ Anh tự chuyển khoản riêng. Khi NAZA trừ một số mà file này ghi số khác thì
// TIN FILE NÀY — Sỹ Anh chốt 13/09/2026.
//
// Module chỉ ĐỌC, không tính luồng tiền — việc đó ở api/talpha/order-ledger.
// ═══════════════════════════════════════════════════════════════════

import { RULES } from "./rules";
import { fetchSheetCsv } from "./sheet-source";

/** Một đợt thanh toán tiền hàng đọc được từ file. */
export type DotTienHang = {
    ngay: string;                  // YYYY-MM-DD — ngày thanh toán
    tong_vnd: number;              // tổng phải trả của đợt (đã gồm nợ kỳ trước nếu có)
    moi_vnd: number;               // tiền hàng mới của kỳ này
    no_ky_truoc_vnd: number;       // phần nợ kỳ trước cộng dồn vào đợt này
    da_ghi_thanh_toan: boolean;    // file có chữ "ĐÃ THANH TOÁN"
    da_tra_vnd: number | null;     // số đã trả nếu file ghi rõ; null = file không ghi số
    con_thieu_vnd: number | null;  // "CÒN THIẾU" nếu file ghi rõ
    dong: number;                  // số dòng trong Sheet — để người đọc tra lại
    nguyen_van: string;            // chữ gốc của ô, đã gộp khoảng trắng
};

type Cfg = { sheet_id?: string; sheet_gid?: string; match_window_days?: number };
const CFG: Cfg = ((RULES as unknown as { cod_settlement?: { purchase_sheet?: Cfg } })
    .cod_settlement?.purchase_sheet) ?? {};

// ─────────────────────────────────────────────────────────────────────────
// CSV — đọc được ô có xuống dòng bên trong (ô ghi đợt thanh toán luôn có)
// ─────────────────────────────────────────────────────────────────────────
export function csvToGrid(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (q) {
            if (ch === '"') {
                if (text[i + 1] === '"') { cell += '"'; i++; } else q = false;
            } else cell += ch;
        } else if (ch === '"') q = true;
        else if (ch === ",") { row.push(cell); cell = ""; }
        else if (ch === "\n" || ch === "\r") {
            if (ch === "\r" && text[i + 1] === "\n") i++;
            row.push(cell); rows.push(row); row = []; cell = "";
        } else cell += ch;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows;
}

/** "1.009.562" · "6.988.000" → số. */
function soVnd(s: string): number {
    return Number(String(s).replace(/[^\d]/g, "")) || 0;
}

const RE_NGAY = /THANH\s*TOÁN\s*NGÀY\s*(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{4}))?/;
const RE_TONG = /TỔNG\s*:?\s*(\d[\d.,]*\d)\s*VN/;
const RE_CONG = /(\d[\d.,]*\d)\s*\+\s*(\d[\d.,]*\d)/;
const RE_DA_TRA_SO = /ĐÃ\s*THANH\s*TOÁN\s*(\d[\d.,]*\d)/;
const RE_DA_TRA = /ĐÃ\s*THANH\s*TOÁN/;
const RE_CON_THIEU = /CÒN\s*THIẾU\s*:?\s*(\d[\d.,]*\d)/;

/**
 * Tìm mọi đợt thanh toán trong lưới ô.
 *
 * Năm: ô ghi "27/7" không có năm. Lấy năm gần nhất từng thấy trong file (ô ngày
 * "16/7/2026" ở đầu bảng), và khi tháng tụt hẳn so với đợt trước (12 → 1) thì
 * sang năm mới.
 */
export function docDotTienHang(grid: string[][]): DotTienHang[] {
    const nam0 = (() => {
        for (const row of grid) for (const c of row) {
            const m = String(c).match(/\b\d{1,2}\/\d{1,2}\/(20\d{2})\b/);
            if (m) return Number(m[1]);
        }
        return new Date().getFullYear();
    })();

    const dot: DotTienHang[] = [];
    let nam = nam0, thangTruoc = 0;
    grid.forEach((row, r) => {
        for (const raw of row) {
            const text = String(raw ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
            const hoa = text.toUpperCase();
            const mn = hoa.match(RE_NGAY);
            if (!mn) continue;
            const mt = hoa.match(RE_TONG);
            if (!mt) continue;          // ô nói "thanh toán ngày…" mà không có tổng → không phải đợt

            const ngayN = Number(mn[1]), thang = Number(mn[2]);
            if (mn[3]) nam = Number(mn[3]);
            else if (thangTruoc && thang < thangTruoc - 6) nam += 1;
            thangTruoc = thang;

            const tong = soVnd(mt[1]);
            // "6.185.790 + 1.405.597 TỔNG: 7.591.387" — phần cộng nằm TRƯỚC chữ TỔNG.
            const truocTong = hoa.slice(0, mt.index);
            const mc = truocTong.match(RE_CONG);
            const no = mc ? soVnd(mc[2]) : 0;
            const moi = mc ? soVnd(mc[1]) : tong;

            const daTraSo = hoa.match(RE_DA_TRA_SO);
            const conThieu = hoa.match(RE_CON_THIEU);
            dot.push({
                ngay: `${nam}-${String(thang).padStart(2, "0")}-${String(ngayN).padStart(2, "0")}`,
                tong_vnd: tong,
                moi_vnd: moi,
                no_ky_truoc_vnd: no,
                da_ghi_thanh_toan: RE_DA_TRA.test(hoa),
                da_tra_vnd: daTraSo ? soVnd(daTraSo[1]) : (RE_DA_TRA.test(hoa) ? tong : null),
                con_thieu_vnd: conThieu ? soVnd(conThieu[1]) : null,
                dong: r + 1,
                nguyen_van: text,
            });
            break;                      // mỗi dòng tối đa một đợt
        }
    });
    return dot;
}

/** Ngày NAZA gửi sao kê, đọc từ TÊN FILE: "2026.9.11" · "2026-7-24" · "14.08.2026". */
export function ngaySaoKe(filename: string): string | null {
    const ymd = filename.match(/(20\d{2})[.\-_/](\d{1,2})[.\-_/](\d{1,2})/);
    const dmy = filename.match(/(\d{1,2})[.\-_/](\d{1,2})[.\-_/](20\d{2})/);
    const [y, m, d] = ymd ? [ymd[1], ymd[2], ymd[3]] : dmy ? [dmy[3], dmy[2], dmy[1]] : [];
    if (!y) return null;
    const mm = Number(m), dd = Number(d);
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    return `${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

const ngayCach = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;

/**
 * Ghép mỗi đợt thanh toán vào đúng MỘT kỳ sao kê: gần ngày nhất, trong cửa sổ
 * vài ngày. Ghép toàn cục theo khoảng cách tăng dần, để một đợt nằm giữa hai kỳ
 * (27/7 cách 24/7 ba ngày, cách 31/7 bốn ngày) về kỳ gần hơn chứ không về kỳ
 * nào được duyệt trước.
 */
export function ghepDotVaoKy(
    dot: DotTienHang[],
    ky: { id: string; ngay: string | null }[],
    cuaSoNgay = CFG.match_window_days ?? 4,
): Map<string, DotTienHang> {
    const cap: { id: string; i: number; d: number }[] = [];
    for (const k of ky) {
        if (!k.ngay) continue;
        dot.forEach((x, i) => {
            const d = ngayCach(k.ngay!, x.ngay);
            if (d <= cuaSoNgay) cap.push({ id: k.id, i, d });
        });
    }
    cap.sort((a, b) => a.d - b.d);
    const out = new Map<string, DotTienHang>();
    const daDung = new Set<number>();
    for (const c of cap) {
        if (out.has(c.id) || daDung.has(c.i)) continue;
        out.set(c.id, dot[c.i]);
        daDung.add(c.i);
    }
    return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Đọc Google Sheet — có bộ nhớ đệm, KHÔNG BAO GIỜ ném lỗi ra ngoài
// ─────────────────────────────────────────────────────────────────────────
// Màn đối soát không được sập vì file tiền hàng tạm không mở được. Lỗi thì trả
// danh sách rỗng kèm câu nói rõ vì sao — mục soát sẽ hiện câu đó.
const DEM_MS = 5 * 60_000;
let dem: { luc: number; ket: KetQuaTienHang } | null = null;

export type KetQuaTienHang = { dot: DotTienHang[]; loi: string | null; doc_luc: string };

export async function docTienHang(): Promise<KetQuaTienHang> {
    if (dem && Date.now() - dem.luc < DEM_MS) return dem.ket;
    const luc = new Date().toISOString();
    let ket: KetQuaTienHang;
    if (!CFG.sheet_id) {
        ket = { dot: [], loi: "Chưa khai file tiền hàng ở config/talpha_rules.json → cod_settlement.purchase_sheet.", doc_luc: luc };
    } else {
        try {
            const r = await fetchSheetCsv(CFG.sheet_id, CFG.sheet_gid || "0");
            const dot = docDotTienHang(csvToGrid(r.csv));
            ket = { dot, loi: dot.length ? null : "Đọc được file tiền hàng nhưng không thấy đợt thanh toán nào.", doc_luc: luc };
        } catch (e) {
            ket = { dot: [], loi: `Không đọc được file tiền hàng: ${(e as Error).message}`, doc_luc: luc };
        }
    }
    dem = { luc: Date.now(), ket };
    return ket;
}

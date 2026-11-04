// ═══════════════════════════════════════════════════════════════════
// LÃI LỖ — KẾT QUẢ KINH DOANH (Sỹ Anh chốt 04/11/2026, mục Kế toán)
// ───────────────────────────────────────────────────────────────────
// Một câu hỏi: kỳ này thật sự lãi bao nhiêu, sau MỌI khoản. Đi từng bậc:
//
//   Doanh số       đơn đã chốt (file TỔNG TEAM — cùng số tab Tổng quan, bot Zalo)
//   Doanh thu      tiền COD của KIỆN giao thành công (bảng 3PL + 17TRACK/WeShip);
//                  kiện còn đang đi tính theo TỈ LỆ GIAO THẬT của nước đó (ước)
//   − Giá vốn      hàng đã bán + hàng hoàn không quay lại kho bán tiếp được
//   − Chi phí 3PL  phí chặng đi + thao tác · thu hộ COD · phí hàng hoàn · chênh tỷ giá
//                  3PL quy đổi — phí thật từ sao kê, kiện chưa có sao kê ước theo bảng giá
//   − Chi phí khai thác = tiền ads (file TỔNG TEAM) + chi phí vận hành (nhập tay: lương,
//                  mặt bằng, phần mềm…)
//   = Lợi nhuận sau cùng
//
// Hai con số lãi, luôn đi đôi:
//   • DỰ KIẾN  — kiện đang đi nhân tỉ lệ giao thật của nước đó;
//   • TỐI THIỂU (chắc chắn) — coi như mọi kiện đang đi đều hoàn: chỉ đơn ĐÃ GIAO có doanh
//     thu, còn chi phí thì đủ cả. Lãi thật nằm giữa hai số; càng về cuối kỳ hai số càng sát.
//
// Đơn hoàn theo CƠ CHẾ từng 3PL (talpha_rules.json → shipping_fees, Sỹ Anh gửi):
//   • Đài (NAZA): phí ship + thao tác vẫn mất; hàng về kho NAZA miễn phí 1 tháng, gửi lại chỉ
//     mất phí ship — không gửi lại thì bị tiêu huỷ → giá vốn tính MẤT. Kiện giao lại (mã gốc
//     trong ngoặc) dùng hàng hoàn nên KHÔNG tính giá vốn lần hai.
//   • Singapore: chặng đầu + chặng cuối + gửi lẻ vẫn mất, thêm nhập kho hàng hoàn 3 tệ; lưu kho
//     tối đa 30 ngày rồi huỷ → giá vốn mất.
//   • UAE (D&T): đơn hoàn chỉ mất phí fulfillment, vận chuyển hoàn miễn phí; hàng về kho D&T,
//     bán tiếp được → giá vốn KHÔNG mất.
//   • Nhật (NAZA): cước + phí thu hộ (thu dù khách có nhận hay không) + phí từ chối 800¥; hàng
//     về kho hải ngoại 30 ngày miễn phí — như Đài, không gửi lại là mất.
// "Hàng hoàn còn hạn lưu kho" được liệt kê riêng: gửi lại cho khách mới thì gỡ được giá vốn.
//
// Hàm THUẦN — không đọc file, không gọi mạng (tests/lai-lo.test.cjs). Nạp số thật ở
// lib/talpha/lai-lo-nguon.ts, ráp ở app/api/talpha/lai-lo/route.ts.
// ═══════════════════════════════════════════════════════════════════

export type NhomKien = "giao" | "hoan" | "dang_di" | "cho_gui" | "huy";
export const NHOM_KIEN: NhomKien[] = ["giao", "hoan", "dang_di", "cho_gui", "huy"];

/** Một kiện đã lên 3PL (Đài, Sing, Nhật: dòng bảng đối tác · UAE: đơn POS). Tiền đều là VND. */
export type Kien = {
    nuoc: string;
    ma: string;
    /** Ngày lên đơn (YYYY-MM-DD) — kỳ báo cáo tính theo ngày này. */
    ngay: string;
    /** Ngày xuất kho, nếu 3PL ghi — để biết hàng hoàn còn hạn lưu kho không. */
    ngay_gui?: string | null;
    nhom: NhomKien;
    trang_thai: string;
    /** Tiền COD quy theo tỷ giá niêm yết markets.*.rate_vnd — cùng thước với Doanh số. */
    cod_vnd: number;
    /** Tiền COD quy theo tỷ giá THẬT 3PL áp (Đài: NAZA TWD→tệ→đồng). null = không biết. */
    cod_that_vnd: number | null;
    /** Giá vốn hàng trong kiện. null = có mã chưa khai giá. */
    gia_von_vnd: number | null;
    /** Phí mất dù giao hay hoàn: vận chuyển, thao tác, fulfillment, gửi lẻ… */
    phi_di_vnd: number;
    /** Phí CHỈ khi giao xong: thu hộ COD, ship đơn thành công (UAE). */
    phi_giao_vnd: number;
    /** Phí CHỈ khi hoàn: nhập kho hàng hoàn, phí từ chối nhận. */
    phi_hoan_vnd: number;
    /** Phí chặng đi đọc từ sao kê 3PL (không phải ước). */
    phi_that: boolean;
    /** Hàng hoàn quay lại kho bán tiếp được (UAE) → hoàn không mất giá vốn. */
    hang_ve_kho: boolean;
    /** Hàng hoàn còn trong hạn lưu kho của 3PL — gửi lại cho khách mới được. */
    hoan_con_han?: boolean;
};

// ─────────────────────────────────────────────────────────────────────────
// Phân kiện theo kết quả giao
// ─────────────────────────────────────────────────────────────────────────
const CHUA_DI = new Set(["InfoReceived", "NotFound", "Pending"]);

/**
 * Trạng thái chuẩn (bảng đối tác + 17TRACK / WeShip) → nhóm. Chữ gốc của 3PL "Đang hoàn về
 * kho" có nước map ra Exception, có nước DeliveryFailure — đọc thêm chữ gốc để khỏi đếm hàng
 * đang hoàn vào "đang đi" (tiền không về nữa mà vẫn được hứa).
 */
export function nhomKien(
    status?: string | null, sub?: string | null, raw?: string | null, daGui = false,
): NhomKien {
    const s = String(status || "");
    if (s === "Delivered") return "giao";
    if (s === "Cancelled") return "huy";
    if (s === "Returned" || s === "Expired" || s === "Destroyed") return "hoan";
    if (s === "Exception" && /Return/i.test(String(sub || ""))) return "hoan";
    const r = String(raw || "").normalize("NFC").toLowerCase();
    if (/hoàn|tiêu hủy|tiêu huỷ|return/.test(r) && !/đã giao/.test(r)) return "hoan";
    if (/hủy đơn|huỷ đơn/.test(r)) return "huy";
    if ((!s || CHUA_DI.has(s)) && !daGui) return "cho_gui";
    return "dang_di";
}

// ─────────────────────────────────────────────────────────────────────────
// Tỉ lệ giao thành công — thước để ước kiện còn đang đi
// ─────────────────────────────────────────────────────────────────────────
export type CauHinhTyLe = { cua_so_ngay: number; bo_gan_ngay: number; mau_toi_thieu: number };
export const TY_LE_MAC_DINH: CauHinhTyLe = { cua_so_ngay: 90, bo_gan_ngay: 21, mau_toi_thieu: 20 };

export type TyLeGiao = {
    /** Phần tiền COD giao thành công trên các kiện ĐÃ CÓ KẾT QUẢ. null = chưa có kiện nào xong. */
    r: number | null;
    giao: number; hoan: number;
    tu: string | null; den: string | null;
    /** true = mẫu nhỏ hoặc phải lấy cả kiện mới — số còn trôi, đọc thận trọng. */
    tam: boolean;
};

const congNgay = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Lấy kiện đã có kết quả (giao/hoàn) lên đơn trong [asOf − cua_so, asOf − bo_gan]. Bỏ các ngày
 * gần: kiện mới thì kiện GIAO xong trước, kiện hoàn về sau cả tuần — tính cả kiện mới là tỉ lệ
 * giao bị thổi phồng. Mẫu nhỏ quá thì lấy mọi kiện xong của nước đó và báo `tam`.
 * Tính theo TIỀN COD, không theo số kiện: kiện to hoàn thì mất nhiều hơn kiện nhỏ.
 */
export function tyLeGiao(kien: Kien[], asOf: string, cfg: CauHinhTyLe = TY_LE_MAC_DINH): TyLeGiao {
    const xong = kien.filter((k) => (k.nhom === "giao" || k.nhom === "hoan") && k.ngay && k.ngay <= asOf);
    const tu = congNgay(asOf, -cfg.cua_so_ngay), den = congNgay(asOf, -cfg.bo_gan_ngay);
    let mau = xong.filter((k) => k.ngay >= tu && k.ngay <= den);
    let tam = false, khoangTu: string | null = tu, khoangDen: string | null = den;
    if (mau.length < cfg.mau_toi_thieu) {
        mau = xong;
        tam = true;
        khoangTu = mau.reduce<string | null>((m, k) => (!m || k.ngay < m ? k.ngay : m), null);
        khoangDen = mau.reduce<string | null>((m, k) => (!m || k.ngay > m ? k.ngay : m), null);
    }
    const g = mau.filter((k) => k.nhom === "giao"), h = mau.filter((k) => k.nhom === "hoan");
    const tg = g.reduce((s, k) => s + k.cod_vnd, 0), th = h.reduce((s, k) => s + k.cod_vnd, 0);
    return {
        r: tg + th > 0 ? tg / (tg + th) : null,
        giao: g.length, hoan: h.length, tu: khoangTu, den: khoangDen,
        tam: tam || mau.length < cfg.mau_toi_thieu,
    };
}

// ─────────────────────────────────────────────────────────────────────────
// Một kiện → doanh thu, giá vốn, phí 3PL
// ─────────────────────────────────────────────────────────────────────────
export type Phi3pl = { di: number; giao: number; hoan: number; ty_gia: number };
export type Khoan = { doanh_thu: number; gia_von: number; phi: Phi3pl };
export const khoanRong = (): Khoan => ({ doanh_thu: 0, gia_von: 0, phi: { di: 0, giao: 0, hoan: 0, ty_gia: 0 } });
export const tongPhi = (p: Phi3pl) => p.di + p.giao + p.hoan + p.ty_gia;

function congKhoan(a: Khoan, b: Khoan, he = 1) {
    a.doanh_thu += b.doanh_thu * he; a.gia_von += b.gia_von * he;
    a.phi.di += b.phi.di * he; a.phi.giao += b.phi.giao * he; a.phi.hoan += b.phi.hoan * he; a.phi.ty_gia += b.phi.ty_gia * he;
}

/**
 * Kiện có xác suất giao `p` (giao = 1, hoàn = 0, đang đi = tỉ lệ giao). Giá vốn mất cả khi giao
 * (hàng đã bán) lẫn khi hoàn mà hàng không quay lại kho bán tiếp; phí chặng đi mất cả hai đường.
 * Chênh tỷ giá chỉ có khi tiền về: tiền niêm yết − tiền 3PL thật quy ra (âm = được lợi).
 */
export function khoanKien(k: Kien, p: number): Khoan {
    if (k.nhom === "huy") {
        // Huỷ trước khi đi: hàng chưa rời kho. Sao kê vẫn thu phí kiện này thì tính phí đó.
        return { doanh_thu: 0, gia_von: 0, phi: { di: k.phi_that ? k.phi_di_vnd : 0, giao: 0, hoan: 0, ty_gia: 0 } };
    }
    const gv = k.gia_von_vnd ?? 0;
    const fx = k.cod_that_vnd == null ? 0 : k.cod_vnd - k.cod_that_vnd;
    return {
        doanh_thu: p * k.cod_vnd,
        gia_von: (p + (1 - p) * (k.hang_ve_kho ? 0 : 1)) * gv,
        phi: { di: k.phi_di_vnd, giao: p * k.phi_giao_vnd, hoan: (1 - p) * k.phi_hoan_vnd, ty_gia: p * fx },
    };
}

const xacSuat = (k: Kien, r: number) => (k.nhom === "giao" ? 1 : k.nhom === "hoan" ? 0 : r);

// ─────────────────────────────────────────────────────────────────────────
// Tổng một nước trong kỳ
// ─────────────────────────────────────────────────────────────────────────
export type DemNhom = { n: number; cod: number };
export type TongKien = {
    kien: Record<NhomKien, DemNhom> & { tong: DemNhom };
    /** Doanh thu ĐÃ CHẮC: tiền COD kiện đã giao xong. */
    doanh_thu_chac: number;
    du_kien: Khoan;
    toi_thieu: Khoan;
    /** Kiện có mã chưa khai giá vốn (đang tính 0 cho phần thiếu). */
    thieu_gia_von: number;
    /** Kiện mà phí chặng đi là ước tính (chưa có trong sao kê nào). */
    phi_uoc: number;
    hoan_con_han: { n: number; gia_von: number };
};

export function tongKien(kien: Kien[], r: number | null): TongKien {
    const rr = r ?? 0;
    const dem = Object.fromEntries([...NHOM_KIEN, "tong"].map((n) => [n, { n: 0, cod: 0 }])) as TongKien["kien"];
    const duKien = khoanRong(), toiThieu = khoanRong();
    let chac = 0, thieu = 0, uoc = 0;
    const conHan = { n: 0, gia_von: 0 };
    for (const k of kien) {
        dem[k.nhom].n++; dem[k.nhom].cod += k.cod_vnd;
        dem.tong.n++; dem.tong.cod += k.cod_vnd;
        if (k.nhom === "giao") chac += k.cod_vnd;
        if (k.nhom !== "huy" && k.gia_von_vnd == null) thieu++;
        if (k.nhom !== "huy" && !k.phi_that) uoc++;
        if (k.nhom === "hoan" && k.hoan_con_han && !k.hang_ve_kho) { conHan.n++; conHan.gia_von += k.gia_von_vnd ?? 0; }
        congKhoan(duKien, khoanKien(k, xacSuat(k, rr)));
        congKhoan(toiThieu, khoanKien(k, xacSuat(k, 0)));
    }
    return { kien: dem, doanh_thu_chac: chac, du_kien: duKien, toi_thieu: toiThieu, thieu_gia_von: thieu, phi_uoc: uoc, hoan_con_han: conHan };
}

// ─────────────────────────────────────────────────────────────────────────
// Đơn đã chốt mà CHƯA lên 3PL — vài ngày cuối kỳ
// ─────────────────────────────────────────────────────────────────────────
export type ChoLen3pl = { vnd: number; ngay: { date: string; doanh_so: number; kien: number }[]; khoan: Khoan };

/**
 * Sale lên đơn sang bảng 3PL trễ một hai ngày: nhìn kỳ tới hôm nay thì tiền ads đã tiêu cho các
 * đơn đó mà chưa thấy kiện — lãi tụt giả. Với `soNgay` ngày gần nhất (tính tới `homNay`), phần
 * doanh số chưa thành kiện được ước như kiện đang đi: tỉ lệ giao × doanh số, giá vốn và phí theo
 * tỷ lệ trung bình mỗi đồng COD của chính các kiện trong kỳ. Ngày cũ hơn thì phần chênh là đơn
 * không bao giờ thành kiện (huỷ, bom trước khi gửi) — không ước gì.
 */
export function choLen3pl(
    doanhSoNgay: { date: string; doanh_so: number }[], kienKy: Kien[], r: number | null,
    homNay: string, soNgay: number,
): ChoLen3pl {
    const tu = congNgay(homNay, -(soNgay - 1));
    const codNgay = new Map<string, number>();
    for (const k of kienKy) codNgay.set(k.ngay, (codNgay.get(k.ngay) || 0) + k.cod_vnd);
    const ngay = doanhSoNgay
        .filter((d) => d.date >= tu && d.date <= homNay)
        .map((d) => ({ date: d.date, doanh_so: d.doanh_so, kien: codNgay.get(d.date) || 0 }))
        .filter((d) => d.doanh_so - d.kien > 0);
    const vnd = ngay.reduce((s, d) => s + (d.doanh_so - d.kien), 0);
    const khoan = khoanRong();
    if (vnd > 0 && r != null) {
        // Tỷ lệ trên mỗi đồng COD nếu kiện còn đang đi — lấy từ chính các kiện trong kỳ.
        const goc = kienKy.filter((k) => k.nhom !== "huy");
        const cod = goc.reduce((s, k) => s + k.cod_vnd, 0);
        if (cod > 0) {
            const mau = khoanRong();
            for (const k of goc) congKhoan(mau, khoanKien({ ...k, nhom: "dang_di" }, r));
            congKhoan(khoan, mau, vnd / cod);
        }
    }
    return { vnd, ngay, khoan };
}

// ─────────────────────────────────────────────────────────────────────────
// Chi phí vận hành — nhập tay theo tháng, phân bổ theo ngày
// ─────────────────────────────────────────────────────────────────────────
export type KhoanVanHanh = {
    id: string;
    /** Nhóm: Lương · Mặt bằng · Phần mềm · Khác… */
    nhom: string;
    ten: string;
    so_tien_thang_vnd: number;
    /** Tháng bắt đầu (YYYY-MM). */
    tu_thang: string;
    /** Tháng cuối (YYYY-MM); null = còn trả đều mỗi tháng. */
    den_thang: string | null;
    /** "CHUNG" = cả công ty, chia theo doanh số; hoặc mã nước "TW" · "SG" · "AE" · "JP". */
    thuoc: string;
    ghi_chu?: string;
    sua_luc?: string;
    sua_boi?: string;
};

export const soNgayThang = (ym: string) => {
    const [y, m] = ym.split("-").map(Number);
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

/** Tiền một khoản rơi vào [from, to]: mỗi tháng = số tiền tháng × số ngày trùng ÷ số ngày tháng. */
export function vanHanhTrongKhoang(k: KhoanVanHanh, from: string, to: string): number {
    if (!(k.so_tien_thang_vnd > 0) || from > to) return 0;
    let tong = 0;
    let [y, m] = from.slice(0, 7).split("-").map(Number);
    const ketThuc = to.slice(0, 7);
    for (;;) {
        const ym = `${y}-${String(m).padStart(2, "0")}`;
        if (ym > ketThuc) break;
        if (ym >= k.tu_thang && (!k.den_thang || ym <= k.den_thang)) {
            const dau = `${ym}-01`, cuoi = `${ym}-${String(soNgayThang(ym)).padStart(2, "0")}`;
            const a = from > dau ? from : dau, b = to < cuoi ? to : cuoi;
            const ngay = Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1;
            if (ngay > 0) tong += k.so_tien_thang_vnd * ngay / soNgayThang(ym);
        }
        m += 1; if (m > 12) { m = 1; y += 1; }
    }
    return tong;
}

export type PhanBoVanHanh = {
    /** Mỗi nước: khoản riêng của nước + phần chi phí chung chia theo doanh số. */
    theo_nuoc: Record<string, { rieng: number; chung: number }>;
    chung: number;
    /** Phần chung không chia được vì cả kỳ không nước nào có doanh số. */
    chung_chua_chia: number;
    chi_tiet: (KhoanVanHanh & { trong_ky_vnd: number })[];
};

/**
 * Chia chi phí vận hành của kỳ về từng nước. Khoản "CHUNG" chia theo phần doanh số của nước trên
 * TỔNG doanh số MỌI nước (không chỉ nước người xem thấy — leader thấy đúng phần team mình gánh).
 */
export function phanBoVanHanh(
    items: KhoanVanHanh[], from: string, to: string, doanhSo: Record<string, number>,
): PhanBoVanHanh {
    const theo_nuoc: PhanBoVanHanh["theo_nuoc"] = {};
    const lay = (c: string) => (theo_nuoc[c] ||= { rieng: 0, chung: 0 });
    const chi_tiet = items.map((k) => ({ ...k, trong_ky_vnd: vanHanhTrongKhoang(k, from, to) }))
        .filter((k) => k.trong_ky_vnd > 0);
    let chung = 0;
    for (const k of chi_tiet) {
        if (k.thuoc === "CHUNG") chung += k.trong_ky_vnd;
        else lay(k.thuoc).rieng += k.trong_ky_vnd;
    }
    const tongDs = Object.values(doanhSo).reduce((s, v) => s + Math.max(0, v), 0);
    if (tongDs > 0) for (const [c, v] of Object.entries(doanhSo)) if (v > 0) lay(c).chung += chung * v / tongDs;
    return { theo_nuoc, chung, chung_chua_chia: tongDs > 0 ? 0 : chung, chi_tiet };
}

/** Kiểm một khoản người dùng gõ. Trả câu lỗi tiếng Việt, hoặc null nếu hợp lệ. */
export function loiKhoanVanHanh(k: Partial<KhoanVanHanh>, nuocHopLe: string[]): string | null {
    const ym = /^\d{4}-(0[1-9]|1[0-2])$/;
    if (!String(k.ten || "").trim()) return "Thiếu tên khoản chi";
    if (!String(k.nhom || "").trim()) return "Thiếu nhóm chi phí";
    if (!(Number(k.so_tien_thang_vnd) > 0)) return "Số tiền mỗi tháng phải lớn hơn 0";
    if (!ym.test(String(k.tu_thang || ""))) return "Tháng bắt đầu phải dạng YYYY-MM";
    if (k.den_thang != null && k.den_thang !== "" && !ym.test(String(k.den_thang))) return "Tháng kết thúc phải dạng YYYY-MM";
    if (k.den_thang && k.den_thang < String(k.tu_thang)) return "Tháng kết thúc đứng trước tháng bắt đầu";
    if (k.thuoc !== "CHUNG" && !nuocHopLe.includes(String(k.thuoc || ""))) return "Khoản chi phải thuộc CHUNG hoặc một nước đang bán";
    return null;
}

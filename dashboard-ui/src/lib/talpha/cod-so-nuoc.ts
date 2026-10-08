/**
 * SỔ TIỀN COD MỘT NƯỚC NGOÀI ĐÀI — dựng đúng các khối của màn Đài.
 *
 * 08/10/2026 Sỹ Anh: "sao giao diện phần đối soát COD Sing không giống như Đài Loan". Màn Đài dựng
 * từ order-ledger + cod-actions, gắn chặt với NAZA Đài (NT$, bảng giá Đài, file tiền hàng Đài).
 * Ở đây dựng lại CÙNG các khối từ kho sao kê + kho việc của từng nước, CÙNG luật:
 *
 *   Σ  tiền về          — đã gửi về · còn phải gửi (đơn đã giao) · chưa giao xong · ngân hàng
 *   ①  việc hôm nay     — hỏi khoản lệch, tra đơn lạ, phí sai bảng giá, nhập tiền về, thiếu sao kê
 *   ②  bảng các kỳ      — phải nhận · thực nhận (ngân hàng) · lệch · tình trạng (periodState)
 *   ③  kỳ đang mở       — luồng tiền theo đúng thứ tự sheet TỔNG + máy soát hai nhóm A/B
 *   ④  tỷ giá           — fxLoss, mốc là kỳ tốt nhất NAZA từng đặt
 *
 * Mẫu NAZA Sing (thật, kỳ 05/10/2026) đi: COD S$ × tỷ giá từng đơn → ¥ − phí thu hộ − phí ship
 * − phí hàng hoàn lên kệ → × tỷ giá → đ − tiền hàng Sing = phải nhận. Luồng tiền đọc các dòng trừ
 * thẳng từ sheet TỔNG (dòng có "RMB" mang số âm), nên NAZA thêm loại phí mới thì màn tự hiện.
 *
 * Hàm thuần — để test được.
 */
import { RULES } from "./rules";
import {
    BANK_TOLERANCE_VND, STATE_LABEL, bankKey, doneKey, fxLoss, periodState,
    type BankEntry, type CodActions, type FxRow, type PeriodState,
} from "./cod-actions";
import { saoKeTreHan, CHU_KY_SAO_KE_NGAY } from "./order-ledger";
import { normTracking } from "./naza-statement";
import type { DonCod } from "./cod-market";
import type { KetQuaKhop, KyNuoc, SaoKeNuoc } from "./cod-statement-market";

const tron = (n: number) => Math.round(n * 100) / 100;
const vnd = (n: number) => Math.round(n).toLocaleString("vi-VN");
const so2 = (n: number) => tron(n).toLocaleString("vi-VN");
const dmy = (s?: string | null) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "—");
const gon = (s: string) => s.replace(/\s+/g, "");

// ─────────────────────────────────────────────────────────────────────────
// ③ Luồng tiền một kỳ
// ─────────────────────────────────────────────────────────────────────────

export type DongTru = { nhan: string; so: number; ghi?: string };
export type LuongNuoc = {
    so_don: number;
    cod_local: number;
    ty_gia_rmb: number | null;
    /** COD quy ra tệ theo tỷ giá từng đơn. */
    rmb: number | null;
    /** Các khoản NAZA trừ bằng tệ (số dương = bị trừ): phí thu hộ, phí ship, phí hàng hoàn… */
    tru_rmb: DongTru[];
    rmb_rong: number | null;
    ty_gia_vnd: number | null;
    vnd: number | null;
    /** Các khoản trừ bằng tiền Việt: tiền hàng. */
    tru_vnd: DongTru[];
    /** Phải nhận − (quy ra đ − khoản trừ): điều chỉnh NAZA ghi mà sheet TỔNG không tách dòng. */
    chenh_vnd: number;
    phai_nhan_vnd: number | null;
};

/** Nhãn tiếng Việt của dòng sheet TỔNG, bỏ đuôi "(RMB)"/"(VND)" — không có thì nhãn Trung. */
const tenDong = (x: { zh: string; vi: string }) =>
    x.vi.replace(/\(\s*(RMB|VND)\s*\)/gi, "").replace(/\s+/g, " ").trim() || x.zh;

export function luongKy(s: SaoKeNuoc): LuongNuoc | null {
    const n = s.naza;
    if (!n || !n.tong_dong || !n.tong_dong.length) return null;
    const d = n.tong_dong;
    const laNet = (zh: string) => gon(zh).includes("本期应退金额");
    const tru_rmb: DongTru[] = [];
    const thuHo = n.quy_te_rmb != null && n.ve_rmb != null ? n.quy_te_rmb - n.ve_rmb : 0;
    if (thuHo > 0.005) {
        tru_rmb.push({
            nhan: "Phí thu hộ COD", so: tron(thuHo),
            ghi: n.quy_te_rmb ? `${(thuHo / n.quy_te_rmb * 100).toFixed(1).replace(".", ",")}% tiền COD` : undefined,
        });
    }
    for (const x of d) {
        if (!/RMB/i.test(x.zh) || x.so >= 0 || laNet(x.zh)) continue;
        tru_rmb.push({ nhan: tenDong(x), so: tron(-x.so) });
    }
    const rmbRong = d.find((x) => laNet(x.zh) && /RMB/i.test(x.zh))?.so ?? null;
    const tyVnd = n.ty_gia_vnd ?? null;
    const quyVnd = rmbRong != null && tyVnd != null ? rmbRong * tyVnd : null;
    const tru_vnd = d.filter((x) => gon(x.zh).includes("采购费") && x.so !== 0)
        .map((x) => ({ nhan: tenDong(x), so: x.so }));
    const phai = n.phai_nhan_vnd ?? null;
    const chenh = phai != null && quyVnd != null ? phai - (quyVnd - tru_vnd.reduce((t, x) => t + x.so, 0)) : 0;
    return {
        so_don: s.rows.length,
        cod_local: tron(s.rows.reduce((t, r) => t + (Number(r.amount) || 0), 0)),
        ty_gia_rmb: n.ty_gia_rmb ?? null,
        rmb: n.quy_te_rmb ?? null,
        tru_rmb,
        rmb_rong: rmbRong,
        ty_gia_vnd: tyVnd,
        vnd: quyVnd,
        tru_vnd,
        chenh_vnd: Math.abs(chenh) < 1 ? 0 : Math.round(chenh),
        phai_nhan_vnd: phai,
    };
}

// ─────────────────────────────────────────────────────────────────────────
// Bảng giá (chỉ nước khai đủ kiểu Singapore: chặng cuối + chặng đầu + đóng gói + thu hộ)
// ─────────────────────────────────────────────────────────────────────────

type BangGia = {
    last_leg?: { first_2kg?: number; extra_per_kg?: number };
    first_leg_per_100g?: { thuong?: number; dac_thu?: number };
    single_parcel_fee?: number;
    cod_fee?: { pct?: number; min?: number };
};
const bangGiaCua = (code: string): BangGia | null => {
    const fees = (RULES as unknown as { shipping_fees?: Record<string, BangGia & { declared?: boolean }> }).shipping_fees || {};
    const b = fees[code];
    return b && b.declared && b.last_leg && b.first_leg_per_100g ? b : null;
};

export type PhiSai = { tracking: string; order_id: string; kg: number | null; thu: number; dung: number; chenh: number; ly_do: string };

/** Một dòng phí đúng bảng giá chưa: chặng cuối 2 kg đầu + kg thêm, chặng đầu theo từng 0,1 kg, đóng gói. */
export function soatPhiDong(
    d: { tracking: string; order_id: string; kg: number | null; ship: number; first_leg: number; op: number },
    b: BangGia,
): PhiSai | null {
    const kg = d.kg ?? 0;
    const cuoi = Number(b.last_leg?.first_2kg ?? 0) + Math.max(0, Math.ceil(kg - 2 - 1e-9)) * Number(b.last_leg?.extra_per_kg ?? 0);
    const dau = Math.ceil(Math.round(kg * 1000) / 100 - 1e-9) * Number(b.first_leg_per_100g?.thuong ?? 0);
    const goi = Number(b.single_parcel_fee ?? 0);
    const dung = tron(cuoi + dau + goi), thu = tron(d.ship + d.first_leg + d.op);
    if (Math.abs(thu - dung) < 0.01) return null;
    const lyDo = [
        Math.abs(d.ship - cuoi) >= 0.01 ? `chặng cuối ${so2(d.ship)}¥ (bảng ${so2(cuoi)}¥)` : "",
        Math.abs(d.first_leg - dau) >= 0.01 ? `chặng đầu ${so2(d.first_leg)}¥ (bảng ${so2(dau)}¥` +
            (b.first_leg_per_100g?.dac_thu && Math.abs(d.first_leg - dau / Number(b.first_leg_per_100g.thuong) * Number(b.first_leg_per_100g.dac_thu)) < 0.01
                ? ` — bằng giá hàng đặc thù ${so2(Number(b.first_leg_per_100g.dac_thu))}¥/0,1 kg` : "") + ")" : "",
        Math.abs(d.op - goi) >= 0.01 ? `đóng gói ${so2(d.op)}¥ (bảng ${so2(goi)}¥)` : "",
    ].filter(Boolean).join(" · ");
    return { tracking: d.tracking, order_id: d.order_id, kg: d.kg, thu, dung, chenh: tron(thu - dung), ly_do: lyDo };
}

// ─────────────────────────────────────────────────────────────────────────
// Sổ một nước
// ─────────────────────────────────────────────────────────────────────────

export type TrangThaiKy = PeriodState | "am";
export type KyXem = KyNuoc & {
    luong: LuongNuoc | null;
    bank: BankEntry | null;
    trang_thai: TrangThaiKy;
    trang_thai_chu: string;
    lech_bank_vnd: number | null;
    lech_tien: { order_no: string; tracking: string; cod: number; tra: number; chenh: number }[];
    thua_sao_ke: { order_no: string; tracking: string; so_tien: number }[];
    phi_sai: PhiSai[];
};
export type Check = { nhom: "A" | "B"; ten: string; ok: boolean | null; chi_tiet: string };
export type Viec = {
    id: string; muc: "gap" | "soat" | "ghi"; tieu_de: string;
    so: number; don_vi: string; chi_tiet: string;
    done_key: string; nut: ("da_hoi" | "bo_qua" | "nhap_bank")[]; ghi_chu: string;
    /** Mọi khoá của nhóm — bấm "Đã hỏi" / "Bỏ qua" một lần là ghi cả nhóm (một tin hỏi NAZA cho cả
     *  12 đơn phí sai, không phải bấm 12 lần). */
    done_keys?: string[];
};
export type UocTinh = { so_don: number; cod_local: number; don_chua_tru_phi: number; phi_uoc_rmb: number; vnd_uoc: number | null };
export type SoNuoc = {
    ky: KyXem[];
    viec: Viec[];
    checks: Check[];
    tien_ve: {
        da_gui_ve_vnd: number; co_uoc: boolean; so_ky: number; ky_am: number; am_vnd: number;
        ky_da_doi_chieu_bank: number; thuc_nhan_vnd: number;
        ty_gia: { rmb: number | null; vnd: number | null; thu_ho_pct: number | null; ngay: string | null };
        /** "naza" = đi đúng luồng NAZA kỳ gần nhất; "ty_gia_khai" = tiền COD × markets.*.rate_vnd. */
        cach_uoc: "naza" | "ty_gia_khai";
        con_lai_da_giao: UocTinh; con_lai_chua_giao: UocTinh;
    };
    tong_quan: { ky_cho_nhap: number; tien_cho_nhap_vnd: number; ky_lech: number; tien_lech_vnd: number; ky_khop: number; bank_tolerance_vnd: number };
    fx: { best_vnd_per_twd: number | null; best_period: string | null; total_thiet_vnd: number; rows: FxRow[] };
};

/**
 * Dựng cả sổ. `k` là kết quả khopSaoKeNuoc (đơn nào đã trả, lệch, đơn lạ) — hàm này thêm phần
 * NGƯỜI ghi (tiền về ngân hàng, đã hỏi / bỏ qua) và phần máy soát.
 */
export function soCodNuoc(o: {
    code: string; currency: string; symbol: string; rateVnd: number;
    don: DonCod[]; kho: SaoKeNuoc[]; k: KetQuaKhop; actions: CodActions; asOf: string;
}): SoNuoc {
    const { code, currency, symbol, kho, k, actions } = o;
    const tien = (n: number) => `${so2(n)} ${symbol}`;
    const bangGia = bangGiaCua(code);
    const doneOf = (key: string) => (actions.done || {})[key];
    const bankOf = (f: string) => (actions.bank || {})[bankKey(f)];

    // ── ② các kỳ, mới → cũ (k.ky đã xếp) ────────────────────────────
    const ky: KyXem[] = k.ky.map((x) => {
        const s = kho.find((y) => y.id === x.id)!;
        const bank = bankOf(x.filename) || null;
        let trang_thai: TrangThaiKy, chu: string, lech: number | null = null;
        if (x.phai_nhan_vnd != null && x.phai_nhan_vnd < 0) {
            trang_thai = "am";
            chu = x.tru_vao_dai ? "Âm · đã trừ ở Đài" : "Âm · trừ kỳ sau";
        } else {
            const p = periodState(x.phai_nhan_vnd, bank || undefined);
            trang_thai = p.state; lech = p.lech_vnd;
            chu = p.state === "thieu_file"
                ? (bank ? "Đã nhập tiền về" : x.kieu === "bang" ? "Sao kê không ghi số phải nhận" : STATE_LABEL.thieu_file)
                : STATE_LABEL[p.state];
        }
        const phiSai = bangGia ? (s.naza?.phi_dong || []).map((d) => soatPhiDong(d, bangGia)).filter((d): d is PhiSai => !!d) : [];
        return {
            ...x,
            luong: luongKy(s),
            bank, trang_thai, trang_thai_chu: chu, lech_bank_vnd: lech,
            lech_tien: k.lech.filter((l) => l.ky === x.filename)
                .map((l) => ({ order_no: l.order_id, tracking: l.tracking, cod: l.cod_don, tra: l.tra, chenh: tron(l.tra - l.cod_don) })),
            thua_sao_ke: k.khong_co_don.filter((l) => l.ky === x.filename)
                .map((l) => ({ order_no: l.order_id, tracking: l.tracking, so_tien: l.so_tien })),
            phi_sai: phiSai,
        };
    });

    // ── ④ tỷ giá ─────────────────────────────────────────────────────
    const fx = fxLoss(ky.filter((x) => x.so_dong > 0).map((x) => ({
        filename: x.filename, period_date: x.ngay || "",
        rate_twd_rmb: x.luong?.ty_gia_rmb ?? null, rate_rmb_vnd: x.luong?.ty_gia_vnd ?? null, cod_twd: x.cod_local,
    })));

    // ── Σ còn phải gửi — đi đúng luồng NAZA kỳ gần nhất có tỷ giá ────
    const kyGia = ky.find((x) => x.luong?.ty_gia_rmb != null && x.luong?.ty_gia_vnd != null);
    const sGia = kyGia ? kho.find((y) => y.id === kyGia.id) : undefined;
    const thuHoPct = sGia?.naza?.quy_te_rmb && sGia.naza.ve_rmb != null
        ? (sGia.naza.quy_te_rmb - sGia.naza.ve_rmb) / sGia.naza.quy_te_rmb : null;
    // Đơn đã bị NAZA trừ phí ở kỳ nào đó thì không trừ lại; chưa thì trừ phí trung bình NAZA đã tính.
    const phiMoiDon = new Map<string, number>();
    for (const s of kho) for (const d of s.naza?.phi_dong || []) phiMoiDon.set(normTracking(d.tracking), d.ship + d.first_leg + d.op);
    const phiTb = phiMoiDon.size ? [...phiMoiDon.values()].reduce((a, b) => a + b, 0) / phiMoiDon.size : 0;
    const coLuongNaza = !!kyGia;
    const uoc = (ds: DonCod[]): UocTinh => {
        const cod = ds.reduce((t, d) => t + (Number(d.cod_local) || 0), 0);
        if (!coLuongNaza) {
            return { so_don: ds.length, cod_local: tron(cod), don_chua_tru_phi: 0, phi_uoc_rmb: 0, vnd_uoc: o.rateVnd > 0 ? Math.round(cod * o.rateVnd) : null };
        }
        const r1 = kyGia!.luong!.ty_gia_rmb!, r2 = kyGia!.luong!.ty_gia_vnd!;
        const chua = ds.filter((d) => !phiMoiDon.has(normTracking(d.tracking)));
        const phi = chua.length * phiTb;
        const rmb = cod * r1 * (1 - (thuHoPct ?? 0)) - phi;
        return { so_don: ds.length, cod_local: tron(cod), don_chua_tru_phi: chua.length, phi_uoc_rmb: tron(phi), vnd_uoc: Math.round(rmb * r2) };
    };
    const conLai = k.don.filter((d) => !d.da_tra);

    // ── Tổng quan ngân hàng ──────────────────────────────────────────
    const choNhap = ky.filter((x) => x.trang_thai === "cho_nhap");
    const lechBank = ky.filter((x) => x.trang_thai === "lech");
    const tong_quan = {
        ky_cho_nhap: choNhap.length,
        tien_cho_nhap_vnd: Math.round(choNhap.reduce((t, x) => t + (x.phai_nhan_vnd ?? 0), 0)),
        ky_lech: lechBank.length,
        tien_lech_vnd: Math.round(lechBank.reduce((t, x) => t + Math.abs(x.lech_bank_vnd ?? 0), 0)),
        ky_khop: ky.filter((x) => x.trang_thai === "khop").length,
        bank_tolerance_vnd: BANK_TOLERANCE_VND,
    };

    // ── ① việc hôm nay ───────────────────────────────────────────────
    const viec: Viec[] = [];
    const lech = ky.flatMap((x) => x.lech_tien).filter((l) => !doneOf(doneKey("lech", l.tracking || l.order_no)));
    if (lech.length) {
        viec.push({
            id: "lech-tien", muc: "soat", tieu_de: "NAZA trả khác số ghi trên đơn", so: lech.length, don_vi: "đơn",
            chi_tiet: lech.slice(0, 3).map((l) => `${l.order_no}: đơn ghi ${tien(l.cod)} · họ trả ${tien(l.tra)}`).join(" · "),
            done_key: doneKey("lech", lech[0].tracking || lech[0].order_no), nut: ["da_hoi", "bo_qua"], ghi_chu: "",
            done_keys: lech.map((l) => doneKey("lech", l.tracking || l.order_no)),
        });
    }
    const thua = ky.flatMap((x) => x.thua_sao_ke).filter((t) => !doneOf(doneKey("thua", t.tracking || t.order_no)));
    if (thua.length) {
        viec.push({
            id: "thua", muc: "soat", tieu_de: "Tra lại đơn NAZA trả mà mình không có", so: thua.length, don_vi: "dòng",
            chi_tiet: thua.slice(0, 3).map((t) => `${t.order_no} · ${t.tracking}`).join(" · "),
            done_key: doneKey("thua", thua[0].tracking || thua[0].order_no), nut: ["da_hoi", "bo_qua"], ghi_chu: "",
            done_keys: thua.map((t) => doneKey("thua", t.tracking || t.order_no)),
        });
    }
    const phiSai = ky.flatMap((x) => x.phi_sai).filter((f) => f.chenh > 0 && !doneOf(doneKey("phi", f.tracking || f.order_id)));
    if (phiSai.length) {
        viec.push({
            id: "phi-sai", muc: "soat", tieu_de: "Hỏi NAZA về phí thu cao hơn bảng giá", so: phiSai.length, don_vi: "đơn",
            chi_tiet: `Thu dư ${so2(phiSai.reduce((t, f) => t + f.chenh, 0))}¥ — ${phiSai[0].ly_do}.`,
            done_key: doneKey("phi", phiSai[0].tracking || phiSai[0].order_id), nut: ["da_hoi", "bo_qua"], ghi_chu: "",
            done_keys: phiSai.map((f) => doneKey("phi", f.tracking || f.order_id)),
        });
    }
    if (choNhap.length) {
        const cuNhat = choNhap[choNhap.length - 1];
        viec.push({
            id: "bank", muc: "ghi",
            tieu_de: choNhap.length === 1 ? `Nhập tiền thật về của kỳ chốt ${dmy(cuNhat.ngay)}` : `Đối chiếu ngân hàng ${choNhap.length} kỳ chưa ai kiểm`,
            so: tong_quan.tien_cho_nhap_vnd, don_vi: "đ",
            chi_tiet: (choNhap.length === 1 ? "File đã soát xong. " : `Từ kỳ chốt ${dmy(cuNhat.ngay)} tới nay. File kỳ nào cũng soát xong, nhưng `) +
                "mở app ngân hàng gõ số thật vào mới biết NAZA chuyển đủ chưa — đây là khâu duy nhất hệ thống không tự thấy được.",
            done_key: cuNhat.filename, nut: ["nhap_bank"], ghi_chu: "",
        });
    }
    for (const x of lechBank) {
        if (doneOf(doneKey("lech", `BANK-${x.filename}`))) continue;
        viec.push({
            id: `bank-lech:${x.filename}`, muc: "gap", tieu_de: `Kỳ chốt ${dmy(x.ngay)} — tiền về không khớp`,
            so: Math.round(x.lech_bank_vnd ?? 0), don_vi: "đ",
            chi_tiet: `Sao kê tính phải nhận ${vnd(x.phai_nhan_vnd ?? 0)}đ, thực nhận ${vnd(x.bank?.thuc_nhan_vnd ?? 0)}đ ngày ${dmy(x.bank?.ngay_ve)}. ` +
                `${(x.lech_bank_vnd ?? 0) < 0 ? "Thiếu" : "Dư"} ${vnd(Math.abs(x.lech_bank_vnd ?? 0))}đ.`,
            done_key: doneKey("lech", `BANK-${x.filename}`), nut: ["da_hoi", "bo_qua"], ghi_chu: "",
        });
    }
    const tre = saoKeTreHan(ky.filter((x) => x.kieu === "naza").map((x) => x.ngay), o.asOf);
    if (tre.tre) {
        viec.push({
            id: "thieu-sao-ke", muc: "soat", tieu_de: "Chưa có sao kê kỳ mới", so: tre.tre_ngay, don_vi: "ngày",
            chi_tiet: `Kỳ gần nhất là ${dmy(tre.ky_gan_nhat)}. NAZA gửi đều mỗi ${CHU_KY_SAO_KE_NGAY} ngày nên kỳ tiếp theo ` +
                `đáng lẽ có từ ${dmy(tre.du_kien)}. Xin NAZA file .xlsx rồi kéo vào màn.`,
            done_key: "", nut: [], ghi_chu: "",
        });
    }

    // ── ③ máy soát — kỳ MỚI NHẤT ─────────────────────────────────────
    const checks: Check[] = [];
    const m = ky[0];
    const sm = m ? kho.find((y) => y.id === m.id) : undefined;
    if (m && sm) {
        const l = m.luong;
        if (m.kieu === "bang") {
            checks.push({ nhom: "A", ten: "Phép tính trong file", ok: null, chi_tiet: "Sao kê dạng bảng — không có sheet TỔNG để soát phép tính." });
        } else if (!l) {
            checks.push({ nhom: "A", ten: "Phép tính trong file", ok: null, chi_tiet: "Bản tải lên trước 08/10/2026 chưa lưu sheet TỔNG — tải lại file kỳ này để soát." });
        } else {
            const truRmb = l.tru_rmb.reduce((t, x) => t + x.so, 0);
            const goc = l.rmb ?? 0;
            const g1 = l.rmb_rong != null ? goc - truRmb - l.rmb_rong : null;
            const g2 = l.vnd != null && l.phai_nhan_vnd != null ? l.vnd - l.tru_vnd.reduce((t, x) => t + x.so, 0) - l.phai_nhan_vnd : null;
            const ok1 = g1 != null && Math.abs(g1) < 0.5, ok2 = g2 != null && Math.abs(g2) < 1.5;
            checks.push({
                nhom: "A", ten: "Phép tính trong file", ok: g1 == null || g2 == null ? null : ok1 && ok2,
                chi_tiet: g1 == null || g2 == null ? "Thiếu số ở sheet TỔNG, không kiểm được phép quyết toán."
                    : ok1 && ok2 ? `Quy ra tệ ${so2(goc)}¥ − trừ ${so2(truRmb)}¥ = ${so2(l.rmb_rong!)}¥; × ${vnd(l.ty_gia_vnd!)} − tiền hàng = phải nhận ${vnd(l.phai_nhan_vnd!)}đ — tự khớp.`
                    : !ok1 ? `Phần tệ không khớp: ${so2(goc)}¥ − ${so2(truRmb)}¥ ra ${so2(goc - truRmb)}¥, file ghi ${so2(l.rmb_rong!)}¥.`
                        : `Phần tiền Việt không khớp: tính ra ${vnd(l.vnd! - l.tru_vnd.reduce((t, x) => t + x.so, 0))}đ, file ghi ${vnd(l.phai_nhan_vnd!)}đ.`,
            });
            const veTong = sm.naza?.tong_dong?.find((x) => gon(x.zh).includes("本期回款金额"))?.so;
            const phiCt = (sm.naza?.phi_dong || []).reduce((t, d) => t + d.ship + d.first_leg + d.op, 0);
            const phiTong = Math.abs(sm.naza?.tong_dong?.find((x) => gon(x.zh).includes("速递运费"))?.so ?? 0);
            const gVe = veTong != null && sm.naza?.ve_rmb != null ? sm.naza.ve_rmb - veTong : null;
            const okVe = gVe == null || Math.abs(gVe) < 0.5, okPhi = Math.abs(phiCt - phiTong) < 0.5;
            checks.push({
                nhom: "A", ten: "Chi tiết cộng ra đúng số tổng", ok: okVe && okPhi,
                chi_tiet: !okVe ? `Tiền về từng đơn cộng ra ${so2(sm.naza!.ve_rmb!)}¥ nhưng sheet TỔNG ghi ${so2(veTong!)}¥. Hỏi lại NAZA.`
                    : !okPhi ? `Sheet phí cộng ra ${so2(phiCt)}¥ nhưng sheet TỔNG trừ ${so2(phiTong)}¥ — lệch ${so2(phiCt - phiTong)}¥.`
                        : `${m.so_dong} đơn COD${sm.naza?.ve_rmb != null ? ` (tiền về ${so2(sm.naza.ve_rmb)}¥)` : ""}, ` +
                          `phí ${(sm.naza?.phi_dong || []).length} đơn cộng ra ${so2(phiCt)}¥ — khớp sheet TỔNG.`,
            });
        }
        const fxMoi = fx.rows.find((x) => x.filename === m.filename);
        const truoc = ky.slice(1).find((x) => x.luong?.ty_gia_rmb != null);
        const moTa = (nhan: string, gia: number | null | undefined, cu: number | null | undefined) => {
            if (gia == null) return `${nhan}: không đọc được.`;
            if (cu == null) return `${nhan} ${gia} — chưa có kỳ trước để so.`;
            const d = (gia / cu - 1) * 100;
            if (Math.abs(d) < 0.05) return `${nhan} ${gia} — giữ nguyên.`;
            return `${nhan} ${gia} — ${d > 0 ? "tăng" : "giảm"} ${Math.abs(d).toFixed(2)}% so kỳ trước, ${d > 0 ? "có lợi" : "BẤT LỢI"} cho mình.`;
        };
        if (m.so_dong > 0) {
            checks.push({
                nhom: "A", ten: "Tỷ giá kỳ này",
                ok: fxMoi?.thiet_vnd != null && fxMoi.thiet_vnd < 1 ? true : null,
                chi_tiet: `${moTa(`${currency}→RMB`, m.luong?.ty_gia_rmb, truoc?.luong?.ty_gia_rmb)} ${moTa("RMB→VND", m.luong?.ty_gia_vnd, truoc?.luong?.ty_gia_vnd)}` +
                    (fxMoi?.thiet_vnd == null ? "" : fxMoi.tot_nhat ? " Đây là tỷ giá TỐT NHẤT NAZA từng đặt." : ` So với kỳ tốt nhất NAZA từng đặt, kỳ này nhận ít đi ${vnd(fxMoi.thiet_vnd)}đ.`),
            });
        }
        if (m.kieu === "naza") {
            const dups = sm.naza?.trung_phi || [];
            checks.push({
                nhom: "A", ten: "Thu hai lần phí trên một đơn", ok: dups.length === 0,
                chi_tiet: dups.length === 0 ? "Không mã vận đơn nào bị tính phí quá một lần trong kỳ."
                    : `${dups.length} mã bị tính phí ${dups[0].times} lần — thu dư ${so2(dups.reduce((t, d) => t + d.extra_rmb, 0))}¥. ` +
                      dups.slice(0, 3).map((d) => `${d.order_ids.join("/")} · ${d.tracking}`).join(" · "),
            });
        }
        checks.push({
            nhom: "B", ten: "NAZA trả khác số trên đơn", ok: m.lech_tien.length === 0,
            chi_tiet: !m.so_dong ? "Kỳ này chưa thu được COD đơn nào." : m.lech_tien.length === 0 ? "Mọi đơn trả đúng số."
                : m.lech_tien.slice(0, 3).map((x) => `${x.order_no}: đơn ghi ${tien(x.cod)} · họ trả ${tien(x.tra)}`).join(" · "),
        });
        checks.push({
            nhom: "B", ten: "Đơn trên sao kê đều là đơn của mình", ok: m.thua_sao_ke.length === 0,
            chi_tiet: m.thua_sao_ke.length === 0 ? (m.so_dong ? `${m.khop + m.lech}/${m.so_dong} đơn tìm thấy trong bảng đơn ${code === "SG" ? "đối tác" : "của mình"}.` : "Không có dòng COD nào.")
                : `${m.thua_sao_ke.length} dòng không tìm ra đơn: ` + m.thua_sao_ke.slice(0, 3).map((x) => x.tracking || x.order_no).join(" · "),
        });
        if (bangGia && m.kieu === "naza") {
            const dong = sm.naza?.phi_dong || [];
            const du = m.phi_sai.filter((f) => f.chenh > 0), it = m.phi_sai.filter((f) => f.chenh < 0);
            checks.push({
                nhom: "B", ten: "Phí giao hàng đúng bảng giá",
                ok: dong.length === 0 ? null : du.length === 0,
                chi_tiet: dong.length === 0 ? "Kỳ này không có dòng phí nào."
                    : du.length === 0
                        ? `${dong.length - it.length}/${dong.length} đơn đúng bảng giá — chặng cuối ${b2(bangGia.last_leg?.first_2kg)}¥ (2 kg đầu) · chặng đầu ${b2(bangGia.first_leg_per_100g?.thuong)}¥/0,1 kg · đóng gói ${b2(bangGia.single_parcel_fee)}¥.` +
                          (it.length ? ` ${it.length} đơn thu THẤP hơn bảng.` : "")
                        : `${du.length} đơn thu cao hơn bảng, dư ${so2(du.reduce((t, f) => t + f.chenh, 0))}¥ — ${du[0].ly_do}.`,
            });
            const th = sm.naza?.thu_ho || [];
            const pct = Number(bangGia.cod_fee?.pct ?? 0), min = Number(bangGia.cod_fee?.min ?? 0);
            if (th.length && pct > 0) {
                const cao = th.filter((x) => x.phi_rmb - Math.max(min, pct * x.cod_rmb) > 0.01);
                const tyLe = th.reduce((t, x) => t + x.phi_rmb, 0) / Math.max(1e-9, th.reduce((t, x) => t + x.cod_rmb, 0));
                checks.push({
                    nhom: "B", ten: "Phí thu hộ đúng bảng giá", ok: cao.length === 0,
                    chi_tiet: cao.length === 0
                        ? `NAZA thu ${(tyLe * 100).toFixed(1).replace(".", ",")}% tiền COD — không vượt bảng giá ${(pct * 100).toFixed(0)}% (tối thiểu ${b2(min)}¥/đơn).`
                        : `${cao.length} đơn thu phí thu hộ cao hơn bảng (${(pct * 100).toFixed(0)}%, tối thiểu ${b2(min)}¥).`,
                });
            }
        }
        const hang = m.tien_hang_vnd ?? 0;
        if (m.kieu === "naza") {
            checks.push({
                nhom: "B", ten: "Tiền hàng NAZA trừ", ok: null,
                chi_tiet: hang ? `NAZA trừ ${vnd(hang)}đ tiền hàng ${code === "SG" ? "Singapore" : ""} — chưa có file tiền hàng của nước này để so, đối chiếu tay với đơn mua hàng.`
                    : "Kỳ này NAZA không trừ tiền hàng.",
            });
        }
    }

    return {
        ky, viec, checks,
        tien_ve: {
            da_gui_ve_vnd: k.da_gui_ve.vnd, co_uoc: k.da_gui_ve.co_uoc, so_ky: kho.length,
            ky_am: k.da_gui_ve.ky_am, am_vnd: k.da_gui_ve.am_vnd,
            ky_da_doi_chieu_bank: ky.filter((x) => x.bank).length,
            thuc_nhan_vnd: ky.reduce((t, x) => t + (x.bank?.thuc_nhan_vnd ?? 0), 0),
            ty_gia: { rmb: kyGia?.luong?.ty_gia_rmb ?? null, vnd: kyGia?.luong?.ty_gia_vnd ?? null, thu_ho_pct: thuHoPct, ngay: kyGia?.ngay ?? null },
            cach_uoc: coLuongNaza ? "naza" : "ty_gia_khai",
            con_lai_da_giao: uoc(conLai.filter((d) => d.nhom === "da_giao")),
            con_lai_chua_giao: uoc(conLai.filter((d) => d.nhom === "chua_giao")),
        },
        tong_quan, fx,
    };
}

const b2 = (n?: number | null) => so2(Number(n ?? 0));

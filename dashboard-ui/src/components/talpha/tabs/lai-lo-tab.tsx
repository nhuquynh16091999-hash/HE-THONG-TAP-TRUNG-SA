"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import TabSkeleton from "@/components/ui/tab-skeleton";
import { formatVNDCompact, formatMoney, formatNumber, cn } from "../utils";
import { tenPhamVi, useAccess } from "../access-context";
import {
    ReportHero, KpiRow, KpiTile, ResultCard, WaterfallList, ReportTable, FootNotes, DASH,
    type Column, type WaterfallRow,
} from "../report";

/*
 * KẾ TOÁN → LÃI LỖ (Sỹ Anh chốt 04/11/2026): kết quả kinh doanh đủ mọi khoản, theo kỳ đang chọn.
 *
 *   Doanh số → Doanh thu → − Giá vốn → − Chi phí 3PL → = Lãi gộp → − Chi phí khai thác
 *   (ads + vận hành) → = Lợi nhuận sau cùng
 *
 * Số tính ở /api/talpha/lai-lo (lib/talpha/lai-lo.ts). Doanh thu theo KIỆN thật của 3PL — kiện
 * đang đi nhân tỉ lệ giao thật của nước đó. Luôn hiện hai mức lãi: dự kiến và tối thiểu (coi mọi
 * kiện đang đi là hoàn). Tab P&L ở mục Báo cáo vẫn là số "tạm tính nhanh" (coi mọi đơn giao hết).
 */

interface Props { dateRange?: { from: Date; to: Date } }

type Phi = { di: number; giao: number; hoan: number; ty_gia: number };
type Khoan = { doanh_thu: number; gia_von: number; phi: Phi };
type Dem = { n: number; cod: number };
type NhomK = "giao" | "hoan" | "dang_di" | "cho_gui" | "huy";
type TyLe = { r: number | null; giao: number; hoan: number; tu: string | null; den: string | null; tam: boolean };
type Nuoc = {
    code: string; ten: string; nguon: string; co_so: string[]; loi: string | null;
    don: number; doanh_so: number; ads: number;
    ty_le: TyLe | null;
    tk: {
        kien: Record<NhomK, Dem> & { tong: Dem };
        doanh_thu_chac: number; thieu_gia_von: number; phi_uoc: number;
        hoan_con_han: { n: number; gia_von: number };
    } | null;
    cho_len_3pl: { vnd: number; ngay: { date: string; doanh_so: number; kien: number }[] } | null;
    van_hanh: { rieng: number; chung: number };
    du_kien: Khoan; toi_thieu: Khoan;
    loi_nhuan: { du_kien: number | null; toi_thieu: number | null };
};
type KhoanVH = {
    id: string; nhom: string; ten: string; so_tien_thang_vnd: number;
    tu_thang: string; den_thang: string | null; thuoc: string; ghi_chu?: string;
    sua_luc?: string; sua_boi?: string; trong_ky_vnd?: number;
};
type Data = {
    from: string; to: string; as_of: string; hom_nay: string; scoped: boolean;
    missing_months: string[];
    cfg: { ty_le: { cua_so_ngay: number; bo_gan_ngay: number; mau_toi_thieu: number }; cho_len_3pl_ngay: number; nhom_van_hanh: string[] };
    nuoc: Nuoc[];
    ngoai_nuoc: { ads: number; doanh_so: number; don: number } | null;
    tong: {
        don: number; doanh_so: number; ads: number; van_hanh: number; doanh_thu_chac: number;
        du_kien: Khoan; toi_thieu: Khoan; loi_nhuan: { du_kien: number; toi_thieu: number }; thieu_nuoc: string[];
    };
    van_hanh: {
        ghi_duoc: boolean; items: KhoanVH[]; trong_ky: KhoanVH[];
        chung: number | null; chung_chua_chia: number; nuoc_khac: number;
    };
    nuoc_ban: { code: string; ten: string }[];
};

const tongPhi = (p: Phi) => p.di + p.giao + p.hoan + p.ty_gia;
const ngayVN = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : DASH);
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${formatMoney(Math.abs(n))}`;
const laiClass = (n: number | null) => (n == null ? "" : n >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400");
const thangVN = (ym: string | null) => (ym ? `${ym.slice(5, 7)}/${ym.slice(0, 4)}` : "nay");

async function layJson<T>(url: string, init?: RequestInit): Promise<T> {
    const r = await fetch(url, init);
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d?.error) throw new Error(d?.error || `HTTP ${r.status}`);
    return d as T;
}

/** Cầu từ Doanh số xuống Doanh thu dự kiến của một nước — các bậc cộng lại đúng bằng nhau. */
function cau(n: Nuoc) {
    if (!n.tk) return null;
    const k = n.tk.kien;
    const cho = n.cho_len_3pl?.vnd || 0;
    const dangDi = k.dang_di.cod + k.cho_gui.cod + cho;
    const dt = n.du_kien.doanh_thu;
    return {
        khong_thanh_kien: n.doanh_so - k.tong.cod - cho,
        hoan_huy: k.hoan.cod + k.huy.cod,
        // Phần còn lại của tiền đang đi mà tỉ lệ giao nói sẽ không về.
        uoc_hoan: dangDi - (dt - k.giao.cod),
        dang_di: dangDi,
    };
}

export default function TALPHALaiLoTab({ dateRange }: Props) {
    const [data, setData] = useState<Data | null>(null);
    const [loading, setLoading] = useState(true);
    const [loi, setLoi] = useState<string | null>(null);
    const [lan, setLan] = useState(0);
    const phamVi = tenPhamVi(useAccess());

    const from = format(dateRange?.from ?? new Date(), "yyyy-MM-dd");
    const to = format(dateRange?.to ?? new Date(), "yyyy-MM-dd");
    useEffect(() => {
        let dung = false;
        setLoading(true); setLoi(null);
        layJson<Data>(`/api/talpha/lai-lo?from=${from}&to=${to}`)
            .then((d) => { if (!dung) setData(d); })
            .catch((e) => { if (!dung) { setData(null); setLoi(String(e?.message || e)); } })
            .finally(() => { if (!dung) setLoading(false); });
        return () => { dung = true; };
    }, [from, to, lan]);
    const taiLai = useCallback(() => setLan((x) => x + 1), []);

    if (loading && !data) return <TabSkeleton cards={6} showChart={false} rows={6} />;
    if (loi || !data) {
        return (
            <div className="rounded-xl border border-rose-300 bg-rose-50 p-5 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                <p className="font-semibold">Không tính được lãi lỗ.</p>
                <p className="mt-1">{loi}</p>
            </div>
        );
    }

    const t = data.tong;
    const dk = t.du_kien;
    const phi3pl = tongPhi(dk.phi);
    const laiGop = dk.doanh_thu - dk.gia_von - phi3pl;
    const khaiThac = t.ads + t.van_hanh;
    const ln = t.loi_nhuan.du_kien, lnMin = t.loi_nhuan.toi_thieu;
    const okNuoc = data.nuoc.filter((n) => !n.loi && n.tk);
    const caus = okNuoc.map(cau).filter(Boolean) as NonNullable<ReturnType<typeof cau>>[];
    const sumC = (f: (c: NonNullable<ReturnType<typeof cau>>) => number) => caus.reduce((s, c) => s + f(c), 0);
    const loiNuoc = data.nuoc.filter((n) => n.loi);
    // Doanh số của nước đọc kiện lỗi + phần ngoài các nước đang bán: không có kiện để soi.
    const dsKhongKien = loiNuoc.reduce((s, n) => s + n.doanh_so, 0) + (data.ngoai_nuoc?.doanh_so || 0);
    const khongThanhKien = sumC((c) => c.khong_thanh_kien) + dsKhongKien;
    const thieuGia = okNuoc.reduce((s, n) => s + (n.tk?.thieu_gia_von || 0), 0);
    const tamNuoc = okNuoc.filter((n) => n.ty_le?.tam || n.ty_le?.r == null);
    const conHan = okNuoc.filter((n) => (n.tk?.hoan_con_han.n || 0) > 0);
    const period = `${ngayVN(data.from)} → ${ngayVN(data.to)}`;
    const dangDiTong = sumC((c) => c.dang_di);

    const thac: WaterfallRow[] = [
        { label: "Doanh số", hint: `${formatNumber(t.don)} đơn đã chốt · file TỔNG TEAM`, value: formatMoney(t.doanh_so), kind: "base" },
        khongThanhKien >= 0 ? {
            label: "Chốt nhưng không thành kiện 3PL",
            hint: "huỷ / bom trước khi gửi, sửa giá khi lên đơn" + (dsKhongKien > 0 ? " · gồm doanh số chưa soi được kiện" : ""),
            value: formatMoney(khongThanhKien), kind: "minus",
        } : {
            label: "Kiện 3PL nhiều hơn doanh số Sheet",
            hint: "kiện của đơn không nằm trong file TỔNG TEAM — người ngoài team, đơn lên tay ở 3PL, giao lại, tăng giá khi lên đơn",
            value: `+${formatMoney(-khongThanhKien)}`, kind: "plus",
        },
        { label: "Hoàn · huỷ", hint: "tiền COD không bao giờ về", value: formatMoney(sumC((c) => c.hoan_huy)), kind: "minus" },
        {
            label: "Đang đi — phần ước sẽ hoàn",
            hint: `${formatMoney(dangDiTong)} còn trên đường × (1 − tỉ lệ giao)`,
            value: formatMoney(sumC((c) => c.uoc_hoan)), kind: "minus",
        },
        { label: "Doanh thu dự kiến", hint: `đã chắc ${formatMoney(t.doanh_thu_chac)} — kiện giao xong`, value: formatMoney(dk.doanh_thu), kind: "total" },
        {
            label: "Giá vốn", hint: thieuGia ? `${formatNumber(thieuGia)} kiện thiếu giá vốn — đang tính 0` : "hàng đã bán + hàng hoàn không quay lại kho",
            value: formatMoney(dk.gia_von), kind: "minus", missing: false,
        },
        {
            label: "Chi phí 3PL",
            hint: `vận chuyển + thao tác ${formatVNDCompact(dk.phi.di)} · thu hộ ${formatVNDCompact(dk.phi.giao)} · hàng hoàn ${formatVNDCompact(dk.phi.hoan)} · tỷ giá ${formatVNDCompact(dk.phi.ty_gia)}`,
            value: formatMoney(phi3pl), kind: "minus",
        },
        { label: "Lãi gộp", hint: `biên ${pct(laiGop, dk.doanh_thu)} doanh thu`, value: signed(laiGop), kind: "total" },
        { label: "Tiền ads", hint: "chi phí khai thác · file TỔNG TEAM", value: formatMoney(t.ads), kind: "minus" },
        {
            label: "Chi phí vận hành", hint: t.van_hanh ? "chi phí khai thác · lương, mặt bằng, phần mềm…" : "chưa nhập khoản nào",
            value: t.van_hanh ? formatMoney(t.van_hanh) : DASH, kind: "minus", missing: !t.van_hanh,
        },
        { label: "Lợi nhuận sau cùng (dự kiến)", value: signed(ln), kind: "total" },
    ];

    return (
        <div className={cn("space-y-6", loading && "opacity-60 transition-opacity")}>
            <ReportHero
                emoji="📒"
                title={`Lãi lỗ${phamVi ? ` team ${phamVi}` : ""} — ${period}`}
                subtitle={
                    <>
                        Doanh số và tiền ads lấy từ file <strong>TỔNG TEAM</strong> (khớp tab Tổng quan). Doanh thu, giá vốn, phí 3PL
                        tính trên <strong>từng kiện thật</strong> đã lên 3PL — kiện giao xong là tiền chắc, kiện đang đi nhân tỉ lệ giao
                        thật của nước đó. Phí 3PL lấy từ sao kê, kiện chưa vào sao kê ước theo bảng giá và cơ chế của từng 3PL.
                        Kỳ tính theo ngày lên đơn{data.as_of < data.to ? <> · trạng thái tới <strong>{ngayVN(data.as_of)}</strong></> : null}.
                    </>
                }
            />

            {(data.missing_months.length > 0 || loiNuoc.length > 0) && (
                <div className="space-y-1 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                    {data.missing_months.length > 0 && <p>Thiếu số tháng {data.missing_months.join(", ")} — chưa có file TỔNG TEAM của tháng đó, doanh số và ads tháng đó đang là 0.</p>}
                    {loiNuoc.map((n) => (
                        <p key={n.code}><strong>{n.ten}</strong>: không đọc được kiện ({n.loi}) — doanh thu, giá vốn, phí 3PL của nước này CHƯA nằm trong tổng, nên lợi nhuận tổng đang thiếu nước này.</p>
                    ))}
                </div>
            )}

            <KpiRow>
                <KpiTile emoji="💵" label="Doanh số" value={formatVNDCompact(t.doanh_so)} sub={`${formatNumber(t.don)} đơn đã chốt`}
                    tooltip="Cột Doanh Số file TỔNG TEAM: mọi đơn đã chốt trên POS, trừ huỷ, nháp, đơn trống — chưa biết giao được hay không." />
                <KpiTile emoji="📥" label="Doanh thu dự kiến" value={formatVNDCompact(dk.doanh_thu)}
                    sub={`đã chắc ${formatVNDCompact(t.doanh_thu_chac)} · ${pct(dk.doanh_thu, t.doanh_so)} doanh số`}
                    tooltip="Tiền COD của kiện giao thành công, cộng kiện còn đang đi × tỉ lệ giao thật của nước đó. 'Đã chắc' = chỉ kiện giao xong." />
                <KpiTile emoji="📦" label="Giá vốn" value={formatVNDCompact(dk.gia_von)}
                    sub={thieuGia ? `${formatNumber(thieuGia)} kiện thiếu giá` : `${pct(dk.gia_von, dk.doanh_thu)} doanh thu`}
                    tone={thieuGia ? "warn" : "neutral"}
                    tooltip="Mã SP trên kiện × bảng giá vốn. Hàng hoàn ở Đài, Sing, Nhật tính mất (không gửi lại là bị huỷ); UAE hàng hoàn về kho D&T bán tiếp nên không mất." />
                <KpiTile emoji="🚚" label="Chi phí 3PL" value={formatVNDCompact(phi3pl)} sub={`${pct(phi3pl, dk.doanh_thu)} doanh thu`}
                    tooltip="Vận chuyển + thao tác (mất cả khi hoàn), thu hộ COD, phí hàng hoàn, chênh tỷ giá 3PL quy đổi. Phí thật từ sao kê; kiện chưa vào sao kê thì ước." />
                <KpiTile emoji="📣" label="Chi phí khai thác" value={formatVNDCompact(khaiThac)}
                    sub={`ads ${formatVNDCompact(t.ads)} · vận hành ${t.van_hanh ? formatVNDCompact(t.van_hanh) : "chưa nhập"}`}
                    tone={t.van_hanh ? "neutral" : "warn"}
                    tooltip="Tiền ads (file TỔNG TEAM) + chi phí vận hành nhập ở cuối tab (lương, mặt bằng, phần mềm…)." />
                <KpiTile emoji="🏁" label="Lợi nhuận sau cùng" value={formatVNDCompact(ln)}
                    sub={`tối thiểu ${formatVNDCompact(lnMin)} · biên ${pct(ln, dk.doanh_thu)}`}
                    tone={ln >= 0 ? "good" : "bad"}
                    tooltip="Dự kiến = theo tỉ lệ giao thật. Tối thiểu = coi mọi kiện đang đi đều hoàn — lãi thật nằm giữa hai số." />
            </KpiRow>

            <ResultCard
                emoji="🏁"
                title="Lợi nhuận sau cùng kỳ này"
                note={
                    <>
                        Đã trừ đủ: giá vốn, chi phí 3PL (cả kiện hoàn), tiền ads và chi phí vận hành đã nhập. Phần &ldquo;dự kiến&rdquo; dựa vào tỉ lệ
                        giao — kiện đang đi càng ít thì số càng chắc. <strong>Tối thiểu {signed(lnMin)}</strong> nếu từ giờ không kiện nào giao được thêm.
                    </>
                }
                value={signed(ln)}
                caption={`biên ${pct(ln, dk.doanh_thu)} doanh thu · ${pct(ln, t.doanh_so)} doanh số`}
                tone={ln >= 0 ? "good" : "bad"}
                segments={[
                    { color: "bg-sky-400", value: dk.gia_von, label: "Giá vốn" },
                    { color: "bg-amber-400", value: phi3pl, label: "Chi phí 3PL" },
                    { color: "bg-rose-400", value: t.ads, label: "Tiền ads" },
                    { color: "bg-violet-400", value: t.van_hanh, label: "Vận hành" },
                    { color: "bg-emerald-500", value: Math.max(0, ln), label: "Lợi nhuận" },
                ]}
                subStats={[
                    { label: "Lãi gộp", value: signed(laiGop), hint: "doanh thu − giá vốn − chi phí 3PL" },
                    { label: "Lãi sau ads", value: signed(laiGop - t.ads), hint: "chưa trừ vận hành" },
                    { label: "Lợi nhuận tối thiểu", value: signed(lnMin), hint: "nếu mọi kiện đang đi đều hoàn" },
                ]}
            >
                <WaterfallList rows={thac} />
            </ResultCard>

            <BangNuoc data={data} />
            <BangKien data={data} />
            <BangPhi data={data} />

            {(conHan.length > 0 || thieuGia > 0 || tamNuoc.length > 0) && (
                <section className="rounded-xl border border-amber-300 bg-amber-50/60 p-5 dark:border-amber-500/30 dark:bg-amber-500/5">
                    <h3 className="section-header mb-2">🧩 Việc làm số đúng hơn — và đỡ lỗ</h3>
                    <ul className="space-y-2 text-sm text-foreground">
                        {conHan.map((n) => (
                            <li key={n.code}>
                                <strong>{n.ten}: {formatNumber(n.tk!.hoan_con_han.n)} kiện hoàn còn trong hạn lưu kho 3PL</strong> — giá vốn {formatMoney(n.tk!.hoan_con_han.gia_von)}đ
                                đang tính là mất. Gửi lại cho khách mới (chỉ tốn phí ship) trước khi 3PL tiêu huỷ thì gỡ lại được khoản này.
                            </li>
                        ))}
                        {thieuGia > 0 && (
                            <li><strong>{formatNumber(thieuGia)} kiện thiếu giá vốn</strong> ({okNuoc.filter((n) => n.tk?.thieu_gia_von).map((n) => `${n.ten} ${formatNumber(n.tk!.thieu_gia_von)}/${formatNumber(n.tk!.kien.tong.n - n.tk!.kien.huy.n)}`).join(" · ")})
                                {" "}— phần thiếu đang tính 0 nên <strong>lãi đang cao hơn thật</strong>. Mã 3 số chưa có giá tệ thì khai ở <code className="rounded bg-muted px-1">talpha_rules.json → products</code>;
                                UAE tra theo tên hàng trên POS (<code className="rounded bg-muted px-1">markets.UAE.product_costs_vnd</code>). Danh sách tên/mã thiếu ở tab P&L (mục Báo cáo).</li>
                        )}
                        {tamNuoc.map((n) => (
                            <li key={n.code}><strong>Tỉ lệ giao {n.ten} còn tạm</strong> — {n.ty_le?.r == null ? "chưa có kiện nào giao xong hay hoàn để đo" : `mới đo trên ${formatNumber((n.ty_le?.giao || 0) + (n.ty_le?.hoan || 0))} kiện (cần ${data.cfg.ty_le.mau_toi_thieu} kiện lên đơn từ ${data.cfg.ty_le.bo_gan_ngay} ngày trước)`}; doanh thu dự kiến nước này còn trôi.</li>
                        ))}
                    </ul>
                </section>
            )}

            <VanHanh data={data} taiLai={taiLai} />

            <FootNotes
                warning={
                    <>
                        <strong>Hai mức lãi.</strong> &ldquo;Dự kiến&rdquo; nhân kiện còn đang đi với tỉ lệ giao thật của nước đó (đo trên kiện lên đơn
                        {" "}{data.cfg.ty_le.cua_so_ngay} → {data.cfg.ty_le.bo_gan_ngay} ngày trước — bỏ kiện mới vì kiện giao xong trước, kiện hoàn về sau).
                        &ldquo;Tối thiểu&rdquo; coi mọi kiện đang đi đều hoàn. Tiền về tài khoản thật xem tab Tiền COD về.
                    </>
                }
                notes={[
                    <>Doanh số, số đơn, tiền ads: file TỔNG TEAM theo tab từng nước — cùng số tab Tổng quan và bot Zalo.</>,
                    <>Doanh thu: tiền COD trên kiện 3PL, quy theo tỷ giá niêm yết (như Doanh số). Phần 3PL quy đổi lệch tỷ giá nằm ở dòng &ldquo;tỷ giá&rdquo; của Chi phí 3PL.
                        {" "}{data.cfg.cho_len_3pl_ngay} ngày cuối kỳ, đơn đã chốt mà chưa lên 3PL được ước như kiện đang đi.</>,
                    <>Chi phí khai thác = tiền ads + chi phí vận hành. Khoản vận hành &ldquo;chung&rdquo; chia cho các nước theo phần doanh số của nước trên doanh số mọi nước.</>,
                    ...okNuoc.flatMap((n) => n.co_so.map((c, i) => <><strong>{n.ten}</strong>{i === 0 ? ` (${n.nguon})` : ""}: {c}</>)),
                ]}
            />
        </div>
    );
}

// ═══ Bảng theo nước ═══
type DongNuoc = {
    key: string; ten: string; ghi?: string; doanh_so: number; doanh_thu: number | null; chac: number | null;
    gia_von: number | null; phi: number | null; ads: number; van_hanh: number; ln: number | null; ln_min: number | null;
};

function BangNuoc({ data }: { data: Data }) {
    const rows: DongNuoc[] = data.nuoc.map((n) => ({
        key: n.code, ten: n.ten, ghi: n.loi ? "không đọc được kiện" : undefined,
        doanh_so: n.doanh_so,
        doanh_thu: n.loi ? null : n.du_kien.doanh_thu, chac: n.loi ? null : n.tk?.doanh_thu_chac ?? null,
        gia_von: n.loi ? null : n.du_kien.gia_von, phi: n.loi ? null : tongPhi(n.du_kien.phi),
        ads: n.ads, van_hanh: n.van_hanh.rieng + n.van_hanh.chung,
        ln: n.loi_nhuan.du_kien, ln_min: n.loi_nhuan.toi_thieu,
    }));
    if (data.ngoai_nuoc) {
        rows.push({
            key: "_ngoai", ten: "Ngoài các nước đang bán", ghi: "camp nước chưa bán / chưa gán nước",
            doanh_so: data.ngoai_nuoc.doanh_so, doanh_thu: null, chac: null, gia_von: null, phi: null,
            ads: data.ngoai_nuoc.ads, van_hanh: 0, ln: null, ln_min: null,
        });
    }
    const vhKhac = data.van_hanh.chung_chua_chia + data.van_hanh.nuoc_khac;
    if (vhKhac > 0) {
        rows.push({
            key: "_vh", ten: "Vận hành chưa chia được", ghi: "kỳ không có doanh số / khoản thuộc nước đã dừng",
            doanh_so: 0, doanh_thu: null, chac: null, gia_von: null, phi: null, ads: 0, van_hanh: vhKhac, ln: null, ln_min: null,
        });
    }
    const t = data.tong;
    const tien = (n: number | null) => (n == null ? DASH : formatMoney(n));
    const cols: Column<DongNuoc>[] = [
        {
            key: "ten", label: "Thị trường", cellClassName: "font-medium text-foreground",
            render: (r) => <span className="flex flex-col">{r.ten}{r.ghi && <span className="text-[11px] font-normal text-amber-600 dark:text-amber-400">{r.ghi}</span>}</span>,
        },
        { key: "ds", label: "Doanh số", align: "right", render: (r) => tien(r.doanh_so) },
        {
            key: "dt", label: "Doanh thu dự kiến", align: "right",
            render: (r) => r.doanh_thu == null ? DASH : <span className="flex flex-col">{formatMoney(r.doanh_thu)}<span className="text-[11px] text-muted-foreground">chắc {formatMoney(r.chac || 0)}</span></span>,
        },
        { key: "gv", label: "Giá vốn", align: "right", render: (r) => tien(r.gia_von) },
        { key: "phi", label: "Chi phí 3PL", align: "right", render: (r) => tien(r.phi) },
        { key: "ads", label: "Tiền ads", align: "right", render: (r) => tien(r.ads) },
        { key: "vh", label: "Vận hành", align: "right", render: (r) => (r.van_hanh ? formatMoney(r.van_hanh) : DASH) },
        {
            key: "ln", label: "Lợi nhuận", align: "right",
            cellClassName: (r) => cn("font-semibold", laiClass(r.ln)),
            render: (r) => r.ln == null ? DASH : <span className="flex flex-col">{signed(r.ln)}<span className="text-[11px] font-normal text-muted-foreground">tối thiểu {signed(r.ln_min ?? 0)}</span></span>,
        },
        { key: "bien", label: "Biên", align: "right", render: (r) => (r.ln == null || r.doanh_thu == null ? DASH : pct(r.ln, r.doanh_thu)) },
    ];
    return (
        <ReportTable
            emoji="🌍" title="Theo thị trường"
            note="Biên = lợi nhuận dự kiến ÷ doanh thu dự kiến. Chi phí vận hành của nước = khoản riêng của nước + phần chung chia theo doanh số."
            columns={cols} rows={rows} rowKey={(r) => r.key} minWidth={900}
            footer={
                <tr className="border-t-2 border-amber-500/30 bg-amber-500/5 font-bold">
                    {["TỔNG", formatMoney(t.doanh_so), formatMoney(t.du_kien.doanh_thu), formatMoney(t.du_kien.gia_von), formatMoney(tongPhi(t.du_kien.phi)),
                        formatMoney(t.ads), t.van_hanh ? formatMoney(t.van_hanh) : DASH, signed(t.loi_nhuan.du_kien), pct(t.loi_nhuan.du_kien, t.du_kien.doanh_thu)]
                        .map((c, i) => (
                            <td key={i} className={cn("px-3 py-2 tabular-nums", i === 0 ? "text-left" : "text-right", i === 7 && laiClass(t.loi_nhuan.du_kien))}>{c}</td>
                        ))}
                </tr>
            }
        />
    );
}

// ═══ Kiện trong kỳ ═══
function BangKien({ data }: { data: Data }) {
    const rows = data.nuoc.filter((n) => n.tk);
    if (!rows.length) return null;
    const o = (d: Dem) => (d.n ? <span className="flex flex-col">{formatNumber(d.n)}<span className="text-[11px] text-muted-foreground">{formatVNDCompact(d.cod)}</span></span> : DASH);
    const cols: Column<Nuoc>[] = [
        { key: "ten", label: "Thị trường", cellClassName: "font-medium text-foreground", render: (n) => n.ten },
        { key: "tong", label: "Kiện lên 3PL", align: "right", render: (n) => o(n.tk!.kien.tong) },
        { key: "giao", label: "Giao xong", align: "right", cellClassName: "text-emerald-700 dark:text-emerald-400", render: (n) => o(n.tk!.kien.giao) },
        { key: "hoan", label: "Hoàn", align: "right", cellClassName: "text-rose-600 dark:text-rose-400", render: (n) => o(n.tk!.kien.hoan) },
        { key: "huy", label: "Huỷ", align: "right", render: (n) => o(n.tk!.kien.huy) },
        { key: "di", label: "Đang đi", align: "right", render: (n) => o(n.tk!.kien.dang_di) },
        { key: "cho", label: "Chờ gửi", align: "right", render: (n) => o(n.tk!.kien.cho_gui) },
        {
            key: "len", label: "Chưa lên 3PL", align: "right", title: `${data.cfg.cho_len_3pl_ngay} ngày cuối kỳ: doanh số chưa thành kiện, ước như kiện đang đi`,
            render: (n) => (n.cho_len_3pl?.vnd ? formatVNDCompact(n.cho_len_3pl.vnd) : DASH),
        },
        {
            key: "tl", label: "Tỉ lệ giao dùng để ước", align: "right",
            render: (n) => n.ty_le?.r == null ? <span className="text-amber-600">chưa đo được</span> : (
                <span className="flex flex-col">
                    <span className={cn("font-semibold", n.ty_le.tam && "text-amber-600 dark:text-amber-400")}>{(n.ty_le.r * 100).toFixed(1)}%{n.ty_le.tam ? " (tạm)" : ""}</span>
                    <span className="text-[11px] text-muted-foreground">{n.ty_le.giao} giao / {n.ty_le.hoan} hoàn{n.ty_le.tu && n.ty_le.den ? ` · lên đơn ${ngayVN(n.ty_le.tu).slice(0, 5)}–${ngayVN(n.ty_le.den).slice(0, 5)}` : ""}</span>
                </span>
            ),
        },
    ];
    return (
        <ReportTable
            emoji="📦" title="Kiện trong kỳ — tiền đang ở đâu"
            note="Kiện lên đơn trong kỳ theo bảng 3PL (UAE: đơn POS + WeShip). Số nhỏ dưới mỗi ô là tiền COD. Tỉ lệ giao tính theo tiền COD trên kiện đã có kết quả."
            columns={cols} rows={rows} rowKey={(n) => n.code} minWidth={900}
        />
    );
}

// ═══ Chi phí 3PL chi tiết ═══
function BangPhi({ data }: { data: Data }) {
    const rows = data.nuoc.filter((n) => n.tk);
    if (!rows.length) return null;
    const cols: Column<Nuoc>[] = [
        { key: "ten", label: "Thị trường", cellClassName: "font-medium text-foreground", render: (n) => n.ten },
        { key: "di", label: "Vận chuyển + thao tác", align: "right", title: "Mất dù giao hay hoàn", render: (n) => formatMoney(n.du_kien.phi.di) },
        { key: "giao", label: "Thu hộ · giao TC", align: "right", title: "Chỉ khi giao được: phí thu hộ COD, ship đơn thành công (UAE)", render: (n) => (n.du_kien.phi.giao ? formatMoney(n.du_kien.phi.giao) : DASH) },
        { key: "hoan", label: "Phí hàng hoàn", align: "right", render: (n) => (n.du_kien.phi.hoan ? formatMoney(n.du_kien.phi.hoan) : DASH) },
        {
            key: "fx", label: "Chênh tỷ giá", align: "right", title: "Tiền theo tỷ giá Doanh số − tiền 3PL thật quy ra. Âm = được lợi.",
            render: (n) => {
                const x = n.du_kien.phi.ty_gia;
                if (!x) return DASH;
                return x > 0 ? formatMoney(x) : <span className="text-emerald-600 dark:text-emerald-400">lợi {formatMoney(-x)}</span>;
            },
        },
        { key: "tong", label: "Tổng 3PL", align: "right", cellClassName: "font-semibold", render: (n) => formatMoney(tongPhi(n.du_kien.phi)) },
        { key: "pct", label: "% doanh thu", align: "right", render: (n) => pct(tongPhi(n.du_kien.phi), n.du_kien.doanh_thu) },
        {
            key: "nguon", label: "Phí thật / ước", align: "right",
            render: (n) => {
                const tong = (n.tk!.kien.tong.n - n.tk!.kien.huy.n);
                return `${formatNumber(Math.max(0, tong - n.tk!.phi_uoc))} / ${formatNumber(n.tk!.phi_uoc)}`;
            },
        },
    ];
    return (
        <ReportTable
            emoji="🚚" title="Chi phí 3PL"
            note="Phí thật = kiện đã có trong sao kê 3PL; ước = theo trung bình kiện đã có sao kê, hoặc bảng giá khi nước chưa có sao kê. Cơ sở từng nước ở chú thích cuối tab."
            columns={cols} rows={rows} rowKey={(n) => n.code} minWidth={860}
        />
    );
}

// ═══ Chi phí vận hành ═══
type Form = { id?: string; nhom: string; ten: string; so_tien: string; tu_thang: string; den_thang: string; thuoc: string; ghi_chu: string };

function VanHanh({ data, taiLai }: { data: Data; taiLai: () => void }) {
    const vh = data.van_hanh;
    const thangNay = data.hom_nay.slice(0, 7);
    const rong = useMemo<Form>(() => ({ nhom: data.cfg.nhom_van_hanh[0] || "Lương", ten: "", so_tien: "", tu_thang: thangNay, den_thang: "", thuoc: "CHUNG", ghi_chu: "" }), [data.cfg.nhom_van_hanh, thangNay]);
    const [form, setForm] = useState<Form | null>(null);
    const [dang, setDang] = useState(false);
    const [loi, setLoi] = useState<string | null>(null);
    const trongKy = new Map(vh.trong_ky.map((k) => [k.id, k.trong_ky_vnd || 0]));
    const tenNuoc = (c: string) => (c === "CHUNG" ? "Chung cả công ty" : data.nuoc_ban.find((n) => n.code === c)?.ten || c);

    const luu = async () => {
        if (!form) return;
        setDang(true); setLoi(null);
        try {
            await layJson("/api/talpha/lai-lo/van-hanh", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    id: form.id, nhom: form.nhom, ten: form.ten, thuoc: form.thuoc, ghi_chu: form.ghi_chu,
                    so_tien_thang_vnd: Number(form.so_tien.replace(/[^\d]/g, "")),
                    tu_thang: form.tu_thang, den_thang: form.den_thang || null,
                }),
            });
            setForm(null); taiLai();
        } catch (e: any) { setLoi(String(e?.message || e)); } finally { setDang(false); }
    };
    const xoa = async (k: KhoanVH) => {
        if (!window.confirm(`Xoá khoản "${k.ten}" (${formatMoney(k.so_tien_thang_vnd)}đ/tháng)? Mọi kỳ đã tính sẽ không còn khoản này.`)) return;
        setDang(true); setLoi(null);
        try { await layJson(`/api/talpha/lai-lo/van-hanh?id=${encodeURIComponent(k.id)}`, { method: "DELETE" }); taiLai(); }
        catch (e: any) { setLoi(String(e?.message || e)); } finally { setDang(false); }
    };

    if (!vh.ghi_duoc) {
        return (
            <section className="rounded-xl border border-border bg-card p-5 text-sm shadow-sm">
                <h3 className="section-header mb-1">🏢 Chi phí vận hành</h3>
                <p className="text-muted-foreground">
                    Kỳ này: <strong className="text-foreground">{data.tong.van_hanh ? `${formatMoney(data.tong.van_hanh)}đ` : "chưa có khoản nào"}</strong> cho
                    {data.scoped ? " các nước của team" : " các nước"} — gồm khoản riêng của nước và phần chi phí chung chia theo doanh số.
                    Chi tiết từng khoản do giám đốc nhập và chỉ giám đốc xem.
                </p>
            </section>
        );
    }

    const o = "rounded-md border border-border bg-background px-2 py-1.5 text-sm";
    return (
        <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h3 className="section-header mb-1">🏢 Chi phí vận hành <span className="text-xs font-normal text-muted-foreground">(chi phí khai thác ngoài ads)</span></h3>
                    <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">
                        Nhập theo THÁNG: lương, mặt bằng, phần mềm (POS, Pancake…), sim, tool… Khoản trả đều thì để trống &ldquo;đến tháng&rdquo;.
                        Kỳ báo cáo lấy theo số ngày (chọn 10 ngày của tháng 31 ngày là 10/31 số tiền tháng). Khoản &ldquo;chung&rdquo; chia cho các nước theo doanh số;
                        khoản của riêng một team (lương leader) thì chọn đúng nước. Leader và sale chỉ thấy tổng, không thấy từng khoản.
                    </p>
                </div>
                {!form && <button onClick={() => { setForm(rong); setLoi(null); }} className="rounded-lg bg-orange-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-orange-600">+ Thêm khoản chi</button>}
            </div>

            {form && (
                <div className="mb-4 grid gap-2 rounded-lg border border-orange-300 bg-orange-50/50 p-3 sm:grid-cols-2 lg:grid-cols-4 dark:border-orange-500/30 dark:bg-orange-500/5">
                    <label className="flex flex-col gap-1 text-xs">Nhóm
                        <select className={o} value={form.nhom} onChange={(e) => setForm({ ...form, nhom: e.target.value })}>
                            {[...new Set([...data.cfg.nhom_van_hanh, form.nhom])].map((x) => <option key={x}>{x}</option>)}
                        </select>
                    </label>
                    <label className="flex flex-col gap-1 text-xs">Tên khoản
                        <input className={o} value={form.ten} placeholder="vd: Lương Thương" onChange={(e) => setForm({ ...form, ten: e.target.value })} />
                    </label>
                    <label className="flex flex-col gap-1 text-xs">Số tiền mỗi tháng (đ)
                        <input className={o} inputMode="numeric" value={form.so_tien} placeholder="8.000.000"
                            onChange={(e) => { const s = e.target.value.replace(/[^\d]/g, ""); setForm({ ...form, so_tien: s ? Number(s).toLocaleString("vi-VN") : "" }); }} />
                    </label>
                    <label className="flex flex-col gap-1 text-xs">Thuộc
                        <select className={o} value={form.thuoc} onChange={(e) => setForm({ ...form, thuoc: e.target.value })}>
                            <option value="CHUNG">Chung cả công ty (chia theo doanh số)</option>
                            {data.nuoc_ban.map((n) => <option key={n.code} value={n.code}>{n.ten}</option>)}
                        </select>
                    </label>
                    <label className="flex flex-col gap-1 text-xs">Từ tháng
                        <input type="month" className={o} value={form.tu_thang} onChange={(e) => setForm({ ...form, tu_thang: e.target.value })} />
                    </label>
                    <label className="flex flex-col gap-1 text-xs">Đến tháng (trống = vẫn đang trả)
                        <input type="month" className={o} value={form.den_thang} onChange={(e) => setForm({ ...form, den_thang: e.target.value })} />
                    </label>
                    <label className="flex flex-col gap-1 text-xs sm:col-span-2">Ghi chú
                        <input className={o} value={form.ghi_chu} onChange={(e) => setForm({ ...form, ghi_chu: e.target.value })} />
                    </label>
                    <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-4">
                        <button disabled={dang} onClick={luu} className="rounded-lg bg-orange-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50">{dang ? "Đang lưu…" : form.id ? "Lưu thay đổi" : "Thêm"}</button>
                        <button disabled={dang} onClick={() => { setForm(null); setLoi(null); }} className="rounded-lg border border-border px-3 py-1.5 text-sm">Huỷ</button>
                        {loi && <span className="text-sm text-rose-600">{loi}</span>}
                    </div>
                </div>
            )}
            {!form && loi && <p className="mb-2 text-sm text-rose-600">{loi}</p>}

            {vh.items.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                    Chưa có khoản nào — lợi nhuận đang <strong>chưa trừ</strong> lương, mặt bằng, phần mềm. Bấm &ldquo;Thêm khoản chi&rdquo; để nhập.
                </p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] border-collapse text-sm">
                        <thead>
                            <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                                <th className="px-3 py-2 text-left">Nhóm</th><th className="px-3 py-2 text-left">Khoản</th>
                                <th className="px-3 py-2 text-right">Mỗi tháng</th><th className="px-3 py-2 text-left">Thời gian</th>
                                <th className="px-3 py-2 text-left">Thuộc</th><th className="px-3 py-2 text-right">Trong kỳ này</th><th className="px-3 py-2" />
                            </tr>
                        </thead>
                        <tbody>
                            {[...vh.items].sort((a, b) => a.nhom.localeCompare(b.nhom) || a.ten.localeCompare(b.ten)).map((k) => (
                                <tr key={k.id} className="border-b border-border/40">
                                    <td className="px-3 py-2">{k.nhom}</td>
                                    <td className="px-3 py-2">{k.ten}{k.ghi_chu && <span className="block text-[11px] text-muted-foreground">{k.ghi_chu}</span>}</td>
                                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(k.so_tien_thang_vnd)}</td>
                                    <td className="px-3 py-2 text-xs">{thangVN(k.tu_thang)} → {thangVN(k.den_thang)}</td>
                                    <td className="px-3 py-2 text-xs">{tenNuoc(k.thuoc)}</td>
                                    <td className="px-3 py-2 text-right tabular-nums">{trongKy.get(k.id) ? formatMoney(trongKy.get(k.id)!) : DASH}</td>
                                    <td className="whitespace-nowrap px-3 py-2 text-right text-xs">
                                        <button disabled={dang} className="text-orange-600 hover:underline" onClick={() => { setLoi(null); setForm({ id: k.id, nhom: k.nhom, ten: k.ten, so_tien: k.so_tien_thang_vnd.toLocaleString("vi-VN"), tu_thang: k.tu_thang, den_thang: k.den_thang || "", thuoc: k.thuoc, ghi_chu: k.ghi_chu || "" }); }}>Sửa</button>
                                        <span className="mx-1 text-muted-foreground">·</span>
                                        <button disabled={dang} className="text-rose-600 hover:underline" onClick={() => xoa(k)}>Xoá</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr className="border-t-2 border-border font-semibold">
                                <td className="px-3 py-2" colSpan={2}>Tổng</td>
                                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(vh.items.filter((k) => k.tu_thang <= thangNay && (!k.den_thang || k.den_thang >= thangNay)).reduce((s, k) => s + k.so_tien_thang_vnd, 0))}<span className="block text-[11px] font-normal text-muted-foreground">tháng này</span></td>
                                <td colSpan={2} />
                                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(data.tong.van_hanh)}</td>
                                <td />
                            </tr>
                        </tfoot>
                    </table>
                </div>
            )}
        </section>
    );
}


"use client";

import { useEffect, useState, type ReactNode } from "react";
import { format } from "date-fns";
import TabSkeleton from "@/components/ui/tab-skeleton";
import { formatVNDCompact, formatMoney, formatNumber, marketName, cn } from "../utils";
import { useMarkets } from "../markets-context";
import { tenPhamVi, useAccess } from "../access-context";
import {
    ReportHero, KpiRow, KpiTile, ResultCard, WaterfallList, BarStrip,
    ReportTable, FootNotes, DASH,
    type Column,
} from "../report";

/*
 * P&L — cùng nền với tab Tổng quan (Sỹ Anh chốt 25/09/2026).
 *
 * Doanh số · tiền ads · số đơn: file TỔNG TEAM (/api/talpha/sheet-report?from&to).
 * Giá vốn · phí ship: /api/talpha/pnl-costs — hai khoản Sheet không có, tính trên cùng
 * tập đơn đã chốt. Trước đây tab tính trên đơn ĐÃ GIAO XONG từ BigQuery và không trừ giá
 * vốn: 15/09 → 25/09 ra 5 đơn, DS 5,9tr, lỗ −16,6tr — trong khi Sheet ra 110 đơn, 144tr.
 */

interface Props { dateRange?: { from: Date; to: Date }; projectId?: string }

interface So { ads: number; mess: number; don: number; doanh_so: number; ds_giao_tc: number }
interface SheetReport {
    from: string; to: string; start_date: string | null;
    missing_months: string[];
    team: So;
    markets: (So & { tab: string; code: string | null })[];
    days: (So & { date: string })[];
    market_days?: (So & { code: string; date: string })[];
}
interface CostBucket { orders: number; cogs_vnd: number; orders_cogs_full: number; ship_vnd: number; orders_no_ship: number }
interface Costs {
    total: CostBucket;
    days: (CostBucket & { date: string })[];
    markets: (CostBucket & { code: string; ship_per_order_vnd: number | null })[];
    market_days?: (CostBucket & { code: string; date: string })[];
    /** Tỉ lệ giao thành công từng nước (theo tiền COD) — cùng thước Kế toán → Lãi lỗ. */
    ty_le_giao?: Record<string, { r: number | null; giao?: number; hoan?: number; tu?: string | null; den?: string | null; tam?: boolean; loi?: string }>;
    /** Nước hàng hoàn về kho bán tiếp — đơn hoàn không mất giá vốn. */
    hoan_ve_kho?: string[];
    /** Mã shop → câu giải thích phí ship của nước đó được ước tính từ đâu. */
    ship_basis: Record<string, string>;
    missing_costs: { ma: string; ten: string; qty: number; orders: number }[];
    cost_rate_rmb_vnd: number;
}

type Row = {
    key: string; label: string; don: number; doanh_so: number;
    /** Tỉ lệ giao thành công áp cho dòng (null = chưa đo được → coi giao hết). */
    r: number | null; dt: number;
    ads: number; ship: number; cogs: number; lai: number; ghiChu?: string;
};

const rongCost = (): CostBucket => ({ orders: 0, cogs_vnd: 0, orders_cogs_full: 0, ship_vnd: 0, orders_no_ship: 0 });
const ngayVN = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const pctText = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : DASH);
const signed = (n: number) => `${n >= 0 ? "+" : ""}${formatMoney(n)}`;

async function layJson<T>(url: string): Promise<T> {
    const r = await fetch(url);
    const d = await r.json();
    if (!r.ok || d?.error) throw new Error(d?.error || `HTTP ${r.status}`);
    return d as T;
}

export default function TALPHAPnLTab({ dateRange }: Props) {
    const [loading, setLoading] = useState(true);
    const [sheet, setSheet] = useState<SheetReport | null>(null);
    const [costs, setCosts] = useState<Costs | null>(null);
    const [loi, setLoi] = useState<string | null>(null);
    const [loiCost, setLoiCost] = useState<string | null>(null);
    const { loaded: marketsLoaded } = useMarkets();
    const phamVi = tenPhamVi(useAccess());

    useEffect(() => {
        let dung = false;
        const from = format(dateRange?.from ?? new Date(), "yyyy-MM-dd");
        const to = format(dateRange?.to ?? new Date(), "yyyy-MM-dd");
        setLoading(true); setLoi(null); setLoiCost(null);
        Promise.allSettled([
            layJson<SheetReport>(`/api/talpha/sheet-report?from=${from}&to=${to}`),
            layJson<Costs>(`/api/talpha/pnl-costs?from=${from}&to=${to}&ty_le=1`),
        ]).then(([s, c]) => {
            if (dung) return;
            if (s.status === "fulfilled") setSheet(s.value); else { setSheet(null); setLoi(String(s.reason?.message || s.reason)); }
            // Không đọc được chi phí thì vẫn hiện doanh số và ads — chỉ ghi rõ là thiếu.
            if (c.status === "fulfilled") setCosts(c.value); else { setCosts(null); setLoiCost(String(c.reason?.message || c.reason)); }
        }).finally(() => { if (!dung) setLoading(false); });
        return () => { dung = true; };
    }, [dateRange]);

    if (loading || !marketsLoaded) return <TabSkeleton cards={6} showChart={true} rows={5} />;

    if (loi || !sheet) {
        return (
            <div className="rounded-xl border border-rose-300 bg-rose-50 p-5 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                <p className="font-semibold">Không đọc được file TỔNG TEAM.</p>
                <p className="mt-1">{loi}</p>
            </div>
        );
    }

    const t = sheet.team;
    const c = costs?.total ?? rongCost();
    const ship = c.ship_vnd;
    const today = format(new Date(), "yyyy-MM-dd");
    const period = `${ngayVN(sheet.from)} → ${ngayVN(sheet.to)}`;

    // ── Tỉ lệ giao thành công (11/11/2026, Sỹ Anh: "không đúng thực tế vì thiếu tỉ lệ giao") ──
    // Doanh thu dự kiến = doanh số × tỉ lệ giao của nước. Phí ship mất cả khi hoàn nên giữ đủ.
    // Giá vốn: nước hàng hoàn về kho bán tiếp (UAE) chỉ mất phần giao được; nước khác mất cả.
    const tyLe = costs?.ty_le_giao || {};
    const veKho = new Set(costs?.hoan_ve_kho || []);
    const rCua = (code: string | null | undefined): number | null => (code ? tyLe[code]?.r ?? null : null);
    // Phần doanh số không thuộc nước nào (hoặc nước chưa đo được) → tỉ lệ bình quân theo doanh số.
    const coR = sheet.markets.filter(m => rCua(m.code) != null);
    const dsCoR = coR.reduce((s, m) => s + m.doanh_so, 0);
    const rTB: number | null = dsCoR > 0 ? coR.reduce((s, m) => s + m.doanh_so * rCua(m.code)!, 0) / dsCoR : null;
    const rDung = (code: string | null | undefined) => rCua(code) ?? rTB ?? 1;
    const cogsSauHoan = (code: string, cogsVnd: number) => (veKho.has(code) ? cogsVnd * rDung(code) : cogsVnd);

    // Theo nước: tab nước của Sheet + chi phí cùng mã shop.
    const costNuoc = new Map((costs?.markets || []).map(m => [m.code, m]));
    const rowsNuoc: Row[] = sheet.markets.map(m => {
        const k = (m.code && costNuoc.get(m.code)) || { ...rongCost(), ship_per_order_vnd: null };
        const ghi: string[] = [];
        const tl = m.code ? tyLe[m.code] : undefined;
        if (costs && (!tl || tl.r == null)) ghi.push(rTB != null ? "chưa đo được tỉ lệ giao — lấy bình quân" : "chưa đo được tỉ lệ giao");
        else if (tl?.tam) ghi.push("tỉ lệ giao tạm (mẫu ít)");
        if (k.ship_per_order_vnd == null && k.orders > 0) ghi.push("chưa có phí ship");
        if (k.orders_cogs_full < k.orders) ghi.push(`${k.orders - k.orders_cogs_full} đơn thiếu giá vốn`);
        const r = rDung(m.code);
        const dt = m.doanh_so * r;
        const cg = m.code ? cogsSauHoan(m.code, k.cogs_vnd) : k.cogs_vnd;
        return {
            key: m.tab, label: m.code ? marketName(m.code) : m.tab, don: m.don, doanh_so: m.doanh_so,
            r: costs ? r : null, dt, ads: m.ads,
            ship: k.ship_vnd, cogs: cg, lai: dt - m.ads - k.ship_vnd - cg,
            ghiChu: ghi.join(" · ") || undefined,
        };
    });

    // Theo ngày: ghép từng nước trong ngày (Sheet market_days × tỉ lệ nước đó); phần doanh số
    // ngoài tab nước lấy tỉ lệ bình quân. Giá vốn UAE của ngày trừ phần hàng hoàn về kho.
    const costNgay = new Map((costs?.days || []).map(d => [d.date, d]));
    const dsNuocNgay = new Map<string, { ds: number; dt: number }>();
    for (const d of sheet.market_days || []) {
        const x = dsNuocNgay.get(d.date) || { ds: 0, dt: 0 };
        x.ds += d.doanh_so; x.dt += d.doanh_so * rDung(d.code);
        dsNuocNgay.set(d.date, x);
    }
    const cogsGiamNgay = new Map<string, number>();
    for (const d of costs?.market_days || []) {
        const giam = d.cogs_vnd - cogsSauHoan(d.code, d.cogs_vnd);
        if (giam) cogsGiamNgay.set(d.date, (cogsGiamNgay.get(d.date) || 0) + giam);
    }
    const rowsNgay: Row[] = [...sheet.days].reverse().map(d => {
        const k = costNgay.get(d.date) ?? rongCost();
        const x = dsNuocNgay.get(d.date) || { ds: 0, dt: 0 };
        const dt = costs ? x.dt + Math.max(0, d.doanh_so - x.ds) * (rTB ?? 1) : d.doanh_so;
        const cg = k.cogs_vnd - (cogsGiamNgay.get(d.date) || 0);
        return {
            key: d.date, label: ngayVN(d.date), don: d.don, doanh_so: d.doanh_so,
            r: costs && d.doanh_so > 0 ? dt / d.doanh_so : null, dt, ads: d.ads,
            ship: k.ship_vnd, cogs: cg, lai: dt - d.ads - k.ship_vnd - cg,
        };
    });

    // Tổng kỳ = cộng các ngày (đã ghép đúng tỉ lệ từng nước).
    const dt = rowsNgay.reduce((s, r) => s + r.dt, 0);
    const cogs = rowsNgay.reduce((s, r) => s + r.cogs, 0);
    const rKy = t.doanh_so > 0 ? dt / t.doanh_so : null;
    const lai = dt - t.ads - ship - cogs;
    const bien = dt > 0 ? (lai / dt) * 100 : null;
    const nuocThieuR = costs ? sheet.markets.filter(m => m.code && rCua(m.code) == null) : [];

    // Những thứ còn thiếu để P&L đủ — đọc thẳng từ số liệu, không liệt kê cứng.
    const thieuShip = (costs?.markets || []).filter(m => m.ship_per_order_vnd == null && m.orders > 0);
    const thieuGia = costs?.missing_costs || [];
    const donThieuGia = c.orders - c.orders_cogs_full;
    const lechDon = costs && c.orders !== t.don;

    return (
        <div className="space-y-6">
            <ReportHero
                emoji="💰"
                title={`P&L${phamVi ? ` team ${phamVi}` : ""} — ${period}`}
                subtitle={
                    <>
                        Doanh số, tiền ads, số đơn lấy thẳng từ file <strong>TỔNG TEAM</strong> (khớp tab Tổng quan).
                        Giá vốn tính theo mã sản phẩm trên đơn POS × bảng &ldquo;Giá tới Taiwan&rdquo;; phí ship ước tính — Đài theo
                        trung bình các kỳ sao kê NAZA, Singapore theo bảng giá 3PL
                        {sheet.start_date && <> · tính từ <strong>{ngayVN(sheet.start_date)}</strong></>}.
                        {" "}Doanh thu dự kiến = doanh số × <strong>tỉ lệ giao thành công</strong> thật của từng nước (đo theo tiền COD trên
                        kiện đã có kết quả, lên đơn 90→21 ngày trước — cùng thước Kế toán → Lãi lỗ). Lợi nhuận đủ mọi khoản (phí 3PL thật,
                        chi phí vận hành) xem ở <strong>Kế toán → Lãi lỗ</strong>.
                    </>
                }
            />

            {(sheet.missing_months.length > 0 || loiCost) && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                    {sheet.missing_months.length > 0 && <p>Thiếu số tháng {sheet.missing_months.join(", ")} — chưa khai ID file TỔNG TEAM của tháng đó.</p>}
                    {loiCost && <p>Không tính được giá vốn và phí ship ({loiCost}) — hai khoản đó đang để 0.</p>}
                </div>
            )}

            <KpiRow>
                <KpiTile emoji="💵" label="Doanh số" value={formatVNDCompact(t.doanh_so)} sub={`${formatNumber(t.don)} đơn đã chốt`}
                    tooltip="Cột Doanh Số của file TỔNG TEAM: mọi đơn đã chốt trên POS, trừ huỷ, nháp, đơn trống." />
                <KpiTile emoji="🎯" label="Doanh thu dự kiến" value={formatVNDCompact(dt)}
                    sub={rKy == null ? DASH : `giao thành công ${(rKy * 100).toFixed(1)}%`}
                    tone={nuocThieuR.length ? "warn" : "neutral"}
                    tooltip="Doanh số × tỉ lệ giao thành công của từng nước. Phần còn lại là tiền đơn hoàn dự kiến — không thu về." />
                <KpiTile emoji="💸" label="Tiền ads" value={formatVNDCompact(t.ads)} sub={`${pctText(t.ads, t.doanh_so)} doanh số`} />
                <KpiTile emoji="🚚" label="Phí ship" value={formatVNDCompact(ship)}
                    sub={thieuShip.length ? `thiếu ${thieuShip.map(m => marketName(m.code)).join(", ")}` : `${pctText(ship, t.doanh_so)} doanh số`}
                    tone={thieuShip.length ? "warn" : "neutral"}
                    tooltip="Ước tính = số đơn × phí trung bình một kiện trong các kỳ sao kê NAZA. Nước chưa có sao kê thì chưa tính." />
                <KpiTile emoji="📦" label="Giá vốn" value={formatVNDCompact(cogs)}
                    sub={donThieuGia > 0 ? `${formatNumber(donThieuGia)} đơn thiếu giá` : `${pctText(cogs, t.doanh_so)} doanh số`}
                    tone={donThieuGia > 0 ? "warn" : "neutral"}
                    tooltip="Mã 3 số trong tên sản phẩm POS × giá tệ trong bảng Giá tới Taiwan (talpha_rules.json → products)." />
                <KpiTile emoji="📊" label="Lãi gộp dự kiến" value={formatVNDCompact(lai)} sub={bien === null ? DASH : `biên ${bien.toFixed(1)}% doanh thu`}
                    tone={lai >= 0 ? "good" : "bad"}
                    tooltip="Doanh thu dự kiến (đã trừ hoàn theo tỉ lệ giao) − ads − phí ship − giá vốn. Chưa trừ chi phí vận hành." />
                <KpiTile emoji="✅" label="Đã giao xong" value={formatVNDCompact(t.ds_giao_tc)} sub={`${pctText(t.ds_giao_tc, t.doanh_so)} doanh số`}
                    tooltip="DS giao TC của Sheet — phần doanh số đã giao thành công, tiền chắc chắn về." />
            </KpiRow>

            <ResultCard
                emoji="💰"
                title="Lãi gộp kỳ này (dự kiến)"
                note="Đã trừ đơn hoàn theo tỉ lệ giao thành công thật của từng nước. Đơn hoàn vẫn mất phí ship và giá vốn (trừ UAE: hàng hoàn về kho D&T bán tiếp). Chưa trừ chi phí vận hành (lương, phần mềm, kho)."
                value={signed(lai)}
                caption={bien === null ? "chưa có doanh số" : `biên ${bien.toFixed(1)}% trên doanh thu dự kiến`}
                tone={lai >= 0 ? "good" : "bad"}
                segments={[
                    { color: "bg-slate-400", value: Math.max(0, t.doanh_so - dt), label: "Hoàn dự kiến" },
                    { color: "bg-rose-400", value: t.ads, label: "Tiền ads" },
                    { color: "bg-amber-400", value: ship, label: "Phí ship" },
                    { color: "bg-sky-400", value: cogs, label: "Giá vốn" },
                    { color: "bg-emerald-500", value: Math.max(0, lai), label: "Lãi gộp" },
                ]}
            >
                <WaterfallList
                    rows={[
                        { label: "Doanh số (đơn đã chốt)", value: formatMoney(t.doanh_so), kind: "base" },
                        { label: "Đơn hoàn dự kiến", hint: rKy == null ? "chưa đo được tỉ lệ giao" : `giao thành công ${(rKy * 100).toFixed(1)}% → hoàn ${((1 - rKy) * 100).toFixed(1)}%`, value: formatMoney(t.doanh_so - dt), kind: "minus" },
                        { label: "Tiền ads", value: formatMoney(t.ads), kind: "minus" },
                        thieuShip.length && !ship
                            ? { label: "Phí ship", hint: "chưa có sao kê 3PL", value: DASH, kind: "minus", missing: true }
                            : { label: "Phí ship", hint: thieuShip.length ? `ước tính · thiếu ${thieuShip.map(m => marketName(m.code)).join(", ")}` : "ước tính — Đài theo sao kê NAZA, Singapore theo bảng giá", value: formatMoney(ship), kind: "minus" },
                        { label: "Giá vốn", hint: donThieuGia > 0 ? `thiếu giá ${formatNumber(donThieuGia)} đơn` : "đơn hoàn vẫn mất, trừ UAE (về kho bán tiếp)", value: formatMoney(cogs), kind: "minus" },
                        { label: "Chi phí vận hành", hint: "chưa khai", value: DASH, kind: "minus", missing: true },
                        { label: "Lãi gộp dự kiến", value: signed(lai), kind: "total" },
                    ]}
                />
            </ResultCard>

            {/* ═══ Còn thiếu gì để P&L tính đủ ═══ */}
            {(thieuGia.length > 0 || thieuShip.length > 0 || lechDon || nuocThieuR.length > 0) && (
                <section className="rounded-xl border border-amber-300 bg-amber-50/60 p-5 dark:border-amber-500/30 dark:bg-amber-500/5">
                    <h3 className="section-header mb-2">🧩 Còn thiếu để tính đủ</h3>
                    <ul className="space-y-2 text-sm text-foreground">
                        {thieuGia.length > 0 && (
                            <li>
                                <strong>Giá vốn</strong> — {formatNumber(thieuGia.length)} mã chưa có giá tệ trong bảng &ldquo;Giá tới Taiwan&rdquo;
                                ({formatNumber(donThieuGia)} đơn đang tính thiếu giá vốn):
                                <div className="mt-1 flex flex-wrap gap-1.5">
                                    {thieuGia.map(m => (
                                        <span key={m.ma} className="rounded-md border border-amber-300 bg-white px-2 py-0.5 text-xs dark:border-amber-500/30 dark:bg-transparent"
                                            title={`${m.qty} cái · ${m.orders} đơn`}>
                                            {m.ten} <span className="text-muted-foreground">({m.orders} đơn)</span>
                                        </span>
                                    ))}
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    Mã 3 số: gửi giá tệ để khai vào <code className="rounded bg-muted px-1">talpha_rules.json → products</code>.
                                    Dòng không có mã (tên tự gõ trên POS) thì sửa tên sản phẩm trên POS cho có mã.
                                </p>
                            </li>
                        )}
                        {nuocThieuR.map(m => (
                            <li key={`r-${m.code}`}>
                                <strong>Tỉ lệ giao {marketName(m.code!)}</strong> — chưa đo được ({tyLe[m.code!]?.loi || "chưa có kiện nào giao/hoàn xong"}),
                                đang lấy {rTB != null ? `bình quân các nước ${(rTB * 100).toFixed(1)}%` : "100% (coi giao hết)"}.
                            </li>
                        ))}
                        {thieuShip.map(m => (
                            <li key={m.code}>
                                <strong>Phí ship {marketName(m.code)}</strong> — {formatNumber(m.orders)} đơn chưa tính ship: chưa có kỳ sao kê 3PL
                                nào của nước này. Khai bảng giá vào <code className="rounded bg-muted px-1">talpha_rules.json → shipping_fees</code> hoặc tải sao kê đầu tiên ở tab Đối soát COD thì P&L tự tính.
                            </li>
                        ))}
                        {lechDon && (
                            <li>
                                <strong>Số đơn</strong> — giá vốn và ship tính trên {formatNumber(c.orders)} đơn POS, Sheet đếm {formatNumber(t.don)} đơn
                                (Sheet bỏ đơn của người ngoài team, ô không gán và camp test).
                            </li>
                        )}
                    </ul>
                </section>
            )}

            <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
                <h3 className="section-header mb-1">📈 Lãi gộp theo ngày</h3>
                <BarStrip
                    hint="Tầng trên là doanh số, tầng dưới là lãi gộp dự kiến (xanh) hoặc lỗ (đỏ) của ngày đó. Cột mờ có gạch chéo = hôm nay, chưa hết ngày."
                    items={[...rowsNgay].reverse().map(r => ({
                        label: r.label.slice(0, 5),
                        top: r.doanh_so,
                        bottom: r.lai,
                        inProgress: r.key === today,
                        title: `${r.label} · DS ${formatMoney(r.doanh_so)} · DT dự kiến ${formatMoney(r.dt)} · ads ${formatMoney(r.ads)} · lãi ${signed(r.lai)}`,
                    }))}
                    legend={[
                        { color: "bg-emerald-500/70", label: "doanh số" },
                        { color: "bg-sky-500/70", label: "lãi gộp" },
                        { color: "bg-rose-500/70", label: "lỗ" },
                    ]}
                />
            </section>

            <ReportTable
                emoji="🌍"
                title="P&L theo thị trường"
                note="Doanh số và tiền ads theo tab từng nước của file TỔNG TEAM; doanh thu dự kiến = doanh số × tỉ lệ giao thành công của nước; giá vốn và ship theo shop POS của nước đó."
                columns={cot("Thị trường")}
                rows={rowsNuoc}
                rowKey={r => r.key}
                empty="Kỳ này chỉ một nước có số — Sheet không tách tab theo nước"
            />

            <ReportTable
                emoji="📅"
                title={`P&L theo ngày (${rowsNgay.length} ngày)`}
                columns={cot("Ngày")}
                rows={rowsNgay}
                rowKey={r => r.key}
                empty="Chưa có ngày nào có số trong khoảng này"
                footer={<TongRow cells={[
                    "TỔNG", formatNumber(t.don), formatMoney(t.doanh_so), rKy == null ? DASH : `${(rKy * 100).toFixed(1)}%`,
                    formatMoney(dt), formatMoney(t.ads), formatMoney(ship),
                    formatMoney(cogs), signed(lai), bien === null ? DASH : `${bien.toFixed(1)}%`,
                ]} lai={lai} />}
            />

            <FootNotes
                warning={
                    <>
                        <strong>Đây là lãi gộp dự kiến.</strong> Đơn hoàn ước theo tỉ lệ giao thành công của từng nước, chưa trừ chi phí vận hành.
                        Phí ship là ước tính trung bình, không phải phí từng đơn — phí thật từng đơn xem ở Sổ đơn hàng khi đã có sao kê.
                    </>
                }
                notes={[
                    <>Doanh số, tiền ads, số đơn: file TỔNG TEAM, cùng số với tab Tổng quan và bot Zalo.</>,
                    ...Object.entries(tyLe).filter(([, v]) => v.r != null).map(([code, v]) => (
                        <>Tỉ lệ giao {marketName(code)}: {(v.r! * 100).toFixed(1)}% theo tiền COD — {v.giao} kiện giao, {v.hoan} kiện hoàn
                            {v.tu && v.den ? ` (lên đơn ${ngayVN(v.tu)} → ${ngayVN(v.den)})` : ""}{v.tam ? " · mẫu ít, số còn trôi" : ""}.</>
                    )),
                    ...(Object.keys(costs?.ship_basis || {}).length
                        ? Object.entries(costs!.ship_basis).map(([code, moTa]) => <>Phí ship {marketName(code)}: {moTa}</>)
                        : [<>Phí ship: chưa có sao kê hay bảng giá 3PL nào nên chưa ước tính được.</>]),
                    <>Giá vốn: mã 3 số trong tên sản phẩm POS × giá tệ trong <code className="rounded bg-muted px-1 py-0.5 text-[11px]">talpha_rules.json → products</code>,
                        quy VND theo {formatMoney(costs?.cost_rate_rmb_vnd ?? 0)}đ/tệ. Mã chưa khai giá không được coi là 0 — liệt kê ở khung &ldquo;Còn thiếu&rdquo;.</>,
                ]}
            />
        </div>
    );
}

function TongRow({ cells, lai }: { cells: ReactNode[]; lai: number }) {
    return (
        <tr className="border-t-2 border-amber-500/30 bg-amber-500/5 font-bold">
            {cells.map((c, i) => (
                <td key={i} className={cn("px-3 py-2 tabular-nums", i === 0 ? "text-left" : "text-right",
                    i === 8 && (lai >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"))}>
                    {c}
                </td>
            ))}
        </tr>
    );
}

const laiClass = (n: number) => (n >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400");

const cot = (dau: string): Column<Row>[] => [
    {
        key: "label", label: dau, cellClassName: "font-medium text-foreground",
        render: r => (
            <span className="flex flex-col">
                {r.label}
                {r.ghiChu && <span className="text-[11px] font-normal text-amber-600 dark:text-amber-400">{r.ghiChu}</span>}
            </span>
        ),
    },
    { key: "don", label: "Đơn", align: "right", render: r => formatNumber(r.don) },
    { key: "doanh_so", label: "Doanh số", align: "right", render: r => formatMoney(r.doanh_so) },
    { key: "r", label: "Tỉ lệ giao", align: "right", render: r => (r.r == null ? DASH : `${(r.r * 100).toFixed(1)}%`) },
    { key: "dt", label: "DT dự kiến", align: "right", render: r => formatMoney(r.dt) },
    { key: "ads", label: "Tiền ads", align: "right", render: r => formatMoney(r.ads) },
    { key: "ship", label: "Phí ship", align: "right", render: r => (r.ship > 0 ? formatMoney(r.ship) : DASH) },
    { key: "cogs", label: "Giá vốn", align: "right", render: r => (r.cogs > 0 ? formatMoney(r.cogs) : DASH) },
    { key: "lai", label: "Lãi gộp", align: "right", cellClassName: r => cn("font-semibold", laiClass(r.lai)), render: r => signed(r.lai) },
    { key: "bien", label: "Biên", align: "right", render: r => pctText(r.lai, r.dt) },
];

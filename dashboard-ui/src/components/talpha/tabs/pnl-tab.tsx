"use client";

import { useEffect, useState, type ReactNode } from "react";
import { format } from "date-fns";
import TabSkeleton from "@/components/ui/tab-skeleton";
import { formatVNDCompact, formatMoney, formatNumber, marketName, cn } from "../utils";
import { useMarkets } from "../markets-context";
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
}
interface CostBucket { orders: number; cogs_vnd: number; orders_cogs_full: number; ship_vnd: number; orders_no_ship: number }
interface Costs {
    total: CostBucket;
    days: (CostBucket & { date: string })[];
    markets: (CostBucket & { code: string; ship_per_order_vnd: number | null })[];
    /** Mã shop → câu giải thích phí ship của nước đó được ước tính từ đâu. */
    ship_basis: Record<string, string>;
    missing_costs: { ma: string; ten: string; qty: number; orders: number }[];
    cost_rate_rmb_vnd: number;
}

type Row = { key: string; label: string; don: number; doanh_so: number; ads: number; ship: number; cogs: number; lai: number; ghiChu?: string };

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

    useEffect(() => {
        let dung = false;
        const from = format(dateRange?.from ?? new Date(), "yyyy-MM-dd");
        const to = format(dateRange?.to ?? new Date(), "yyyy-MM-dd");
        setLoading(true); setLoi(null); setLoiCost(null);
        Promise.allSettled([
            layJson<SheetReport>(`/api/talpha/sheet-report?from=${from}&to=${to}`),
            layJson<Costs>(`/api/talpha/pnl-costs?from=${from}&to=${to}`),
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
    const cogs = c.cogs_vnd;
    const lai = t.doanh_so - t.ads - ship - cogs;
    const bien = t.doanh_so > 0 ? (lai / t.doanh_so) * 100 : null;
    const today = format(new Date(), "yyyy-MM-dd");
    const period = `${ngayVN(sheet.from)} → ${ngayVN(sheet.to)}`;

    // Theo ngày: doanh số/ads/đơn từ Sheet, ship/giá vốn từ pnl-costs — ghép theo ngày.
    const costNgay = new Map((costs?.days || []).map(d => [d.date, d]));
    const rowsNgay: Row[] = [...sheet.days].reverse().map(d => {
        const k = costNgay.get(d.date) ?? rongCost();
        return {
            key: d.date, label: ngayVN(d.date), don: d.don, doanh_so: d.doanh_so, ads: d.ads,
            ship: k.ship_vnd, cogs: k.cogs_vnd, lai: d.doanh_so - d.ads - k.ship_vnd - k.cogs_vnd,
        };
    });

    // Theo nước: tab nước của Sheet + chi phí cùng mã shop.
    const costNuoc = new Map((costs?.markets || []).map(m => [m.code, m]));
    const rowsNuoc: Row[] = sheet.markets.map(m => {
        const k = (m.code && costNuoc.get(m.code)) || { ...rongCost(), ship_per_order_vnd: null };
        const ghi: string[] = [];
        if (k.ship_per_order_vnd == null && k.orders > 0) ghi.push("chưa có phí ship");
        if (k.orders_cogs_full < k.orders) ghi.push(`${k.orders - k.orders_cogs_full} đơn thiếu giá vốn`);
        return {
            key: m.tab, label: m.code ? marketName(m.code) : m.tab, don: m.don, doanh_so: m.doanh_so, ads: m.ads,
            ship: k.ship_vnd, cogs: k.cogs_vnd, lai: m.doanh_so - m.ads - k.ship_vnd - k.cogs_vnd,
            ghiChu: ghi.join(" · ") || undefined,
        };
    });

    // Những thứ còn thiếu để P&L đủ — đọc thẳng từ số liệu, không liệt kê cứng.
    const thieuShip = (costs?.markets || []).filter(m => m.ship_per_order_vnd == null && m.orders > 0);
    const thieuGia = costs?.missing_costs || [];
    const donThieuGia = c.orders - c.orders_cogs_full;
    const lechDon = costs && c.orders !== t.don;

    return (
        <div className="space-y-6">
            <ReportHero
                emoji="💰"
                title={`P&L — ${period}`}
                subtitle={
                    <>
                        Doanh số, tiền ads, số đơn lấy thẳng từ file <strong>TỔNG TEAM</strong> (khớp tab Tổng quan).
                        Giá vốn tính theo mã sản phẩm trên đơn POS × bảng &ldquo;Giá tới Taiwan&rdquo;; phí ship ước tính — Đài theo
                        trung bình các kỳ sao kê NAZA, Singapore theo bảng giá 3PL
                        {sheet.start_date && <> · tính từ <strong>{ngayVN(sheet.start_date)}</strong></>}.
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
                <KpiTile emoji="💸" label="Tiền ads" value={formatVNDCompact(t.ads)} sub={`${pctText(t.ads, t.doanh_so)} doanh số`} />
                <KpiTile emoji="🚚" label="Phí ship" value={formatVNDCompact(ship)}
                    sub={thieuShip.length ? `thiếu ${thieuShip.map(m => marketName(m.code)).join(", ")}` : `${pctText(ship, t.doanh_so)} doanh số`}
                    tone={thieuShip.length ? "warn" : "neutral"}
                    tooltip="Ước tính = số đơn × phí trung bình một kiện trong các kỳ sao kê NAZA. Nước chưa có sao kê thì chưa tính." />
                <KpiTile emoji="📦" label="Giá vốn" value={formatVNDCompact(cogs)}
                    sub={donThieuGia > 0 ? `${formatNumber(donThieuGia)} đơn thiếu giá` : `${pctText(cogs, t.doanh_so)} doanh số`}
                    tone={donThieuGia > 0 ? "warn" : "neutral"}
                    tooltip="Mã 3 số trong tên sản phẩm POS × giá tệ trong bảng Giá tới Taiwan (talpha_rules.json → products)." />
                <KpiTile emoji="📊" label="Lãi gộp (tạm tính)" value={formatVNDCompact(lai)} sub={bien === null ? DASH : `biên ${bien.toFixed(1)}%`}
                    tone={lai >= 0 ? "good" : "bad"}
                    tooltip="Doanh số − ads − phí ship − giá vốn. Chưa trừ đơn hoàn và chi phí vận hành." />
                <KpiTile emoji="✅" label="Đã giao xong" value={formatVNDCompact(t.ds_giao_tc)} sub={`${pctText(t.ds_giao_tc, t.doanh_so)} doanh số`}
                    tooltip="DS giao TC của Sheet — phần doanh số đã giao thành công, tiền chắc chắn về." />
            </KpiRow>

            <ResultCard
                emoji="💰"
                title="Lãi gộp kỳ này (tạm tính)"
                note="Giả định mọi đơn đã chốt đều giao thành công — đơn hoàn sau này sẽ kéo số xuống. Chưa trừ chi phí vận hành (lương, phần mềm, kho)."
                value={signed(lai)}
                caption={bien === null ? "chưa có doanh số" : `biên ${bien.toFixed(1)}% trên doanh số`}
                tone={lai >= 0 ? "good" : "bad"}
                segments={[
                    { color: "bg-rose-400", value: t.ads, label: "Tiền ads" },
                    { color: "bg-amber-400", value: ship, label: "Phí ship" },
                    { color: "bg-sky-400", value: cogs, label: "Giá vốn" },
                    { color: "bg-emerald-500", value: Math.max(0, lai), label: "Lãi gộp" },
                ]}
            >
                <WaterfallList
                    rows={[
                        { label: "Doanh số (đơn đã chốt)", value: formatMoney(t.doanh_so), kind: "base" },
                        { label: "Tiền ads", value: formatMoney(t.ads), kind: "minus" },
                        thieuShip.length && !ship
                            ? { label: "Phí ship", hint: "chưa có sao kê 3PL", value: DASH, kind: "minus", missing: true }
                            : { label: "Phí ship", hint: thieuShip.length ? `ước tính · thiếu ${thieuShip.map(m => marketName(m.code)).join(", ")}` : "ước tính theo sao kê NAZA", value: formatMoney(ship), kind: "minus" },
                        { label: "Giá vốn", hint: donThieuGia > 0 ? `thiếu giá ${formatNumber(donThieuGia)} đơn` : "bảng Giá tới Taiwan", value: formatMoney(cogs), kind: "minus" },
                        { label: "Chi phí vận hành", hint: "chưa khai", value: DASH, kind: "minus", missing: true },
                        { label: "Lãi gộp (tạm tính)", value: signed(lai), kind: "total" },
                    ]}
                />
            </ResultCard>

            {/* ═══ Còn thiếu gì để P&L tính đủ ═══ */}
            {(thieuGia.length > 0 || thieuShip.length > 0 || lechDon) && (
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
                    hint="Tầng trên là doanh số, tầng dưới là lãi gộp tạm tính (xanh) hoặc lỗ (đỏ) của ngày đó. Cột mờ có gạch chéo = hôm nay, chưa hết ngày."
                    items={[...rowsNgay].reverse().map(r => ({
                        label: r.label.slice(0, 5),
                        top: r.doanh_so,
                        bottom: r.lai,
                        inProgress: r.key === today,
                        title: `${r.label} · DS ${formatMoney(r.doanh_so)} · ads ${formatMoney(r.ads)} · lãi ${signed(r.lai)}`,
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
                note="Doanh số và tiền ads theo tab từng nước của file TỔNG TEAM; giá vốn và ship theo shop POS của nước đó."
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
                    "TỔNG", formatNumber(t.don), formatMoney(t.doanh_so), formatMoney(t.ads), formatMoney(ship),
                    formatMoney(cogs), signed(lai), bien === null ? DASH : `${bien.toFixed(1)}%`,
                ]} lai={lai} />}
            />

            <FootNotes
                warning={
                    <>
                        <strong>Đây là lãi gộp tạm tính.</strong> Nó coi mọi đơn đã chốt là giao thành công và chưa trừ chi phí vận hành.
                        Phí ship là ước tính trung bình, không phải phí từng đơn — phí thật từng đơn xem ở Sổ đơn hàng khi đã có sao kê.
                    </>
                }
                notes={[
                    <>Doanh số, tiền ads, số đơn: file TỔNG TEAM, cùng số với tab Tổng quan và bot Zalo.</>,
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
                    i === 6 && (lai >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"))}>
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
    { key: "ads", label: "Tiền ads", align: "right", render: r => formatMoney(r.ads) },
    { key: "ship", label: "Phí ship", align: "right", render: r => (r.ship > 0 ? formatMoney(r.ship) : DASH) },
    { key: "cogs", label: "Giá vốn", align: "right", render: r => (r.cogs > 0 ? formatMoney(r.cogs) : DASH) },
    { key: "lai", label: "Lãi gộp", align: "right", cellClassName: r => cn("font-semibold", laiClass(r.lai)), render: r => signed(r.lai) },
    { key: "bien", label: "Biên", align: "right", render: r => pctText(r.lai, r.doanh_so) },
];

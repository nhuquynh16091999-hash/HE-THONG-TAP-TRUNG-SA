"use client";

import { useEffect, useState, type ReactNode } from "react";
import { format } from "date-fns";
import TabSkeleton from "@/components/ui/tab-skeleton";
import { formatVNDCompact, formatMoney, formatNumber, marketName, cn } from "../utils";
import { useMarkets } from "../markets-context";
import {
    ReportHero, KpiRow, KpiTile, ReportTable, FootNotes, DASH,
    type Column,
} from "../report";

/*
 * P&L theo sản phẩm — /api/talpha/product-pnl, cùng nền với tab P&L (đơn đã chốt, giá vốn
 * theo mã sản phẩm trên đơn POS, phí ship ước tính) + tiền ads theo ô mã sản phẩm trong tên
 * campaign. Trước 28/09/2026 tab đọc vw_orders_std × vw_product_catalog_std: bảng
 * product_catalog 0 dòng nên tab gần như trống, và chỉ tính đơn đã giao xong.
 */

interface Props { dateRange?: { from: Date; to: Date }; projectId?: string }

interface Row {
    sp: string; ten: string; ma: string | null; thieu_gia: boolean; shops: string[];
    orders: number; units: number; doanh_so: number; ads: number; mess: number;
    ship: number; cogs: number; gia_vnd: number | null; lai: number;
}
interface Data {
    from: string; to: string; rows: Row[];
    total: { orders: number; units: number; doanh_so: number; ads: number; ship: number; cogs: number; lai: number; ads_khong_ma: number; ads_ngoai_team: number };
    missing_costs: { ma: string; ten: string; qty: number; orders: number }[];
    ship_basis: Record<string, string>;
}

const ngayVN = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const pctText = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : DASH);
const signed = (n: number) => `${n >= 0 ? "+" : ""}${formatMoney(n)}`;
const laiClass = (n: number) => (n >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400");

export default function TALPHAProductPnLTab({ dateRange }: Props) {
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<Data | null>(null);
    const [loi, setLoi] = useState<string | null>(null);
    const { loaded: marketsLoaded } = useMarkets();

    useEffect(() => {
        let dung = false;
        const from = format(dateRange?.from ?? new Date(), "yyyy-MM-dd");
        const to = format(dateRange?.to ?? new Date(), "yyyy-MM-dd");
        setLoading(true); setLoi(null);
        fetch(`/api/talpha/product-pnl?from=${from}&to=${to}`)
            .then(async r => {
                const d = await r.json();
                if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`);
                return d as Data;
            })
            .then(d => { if (!dung) setData(d); })
            .catch(e => { if (!dung) { setData(null); setLoi(String(e?.message || e)); } })
            .finally(() => { if (!dung) setLoading(false); });
        return () => { dung = true; };
    }, [dateRange]);

    if (loading || !marketsLoaded) return <TabSkeleton cards={6} rows={8} />;
    if (loi || !data) {
        return (
            <div className="rounded-xl border border-rose-300 bg-rose-50 p-5 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                <p className="font-semibold">Không tính được P&L theo sản phẩm.</p>
                <p className="mt-1">{loi}</p>
            </div>
        );
    }

    const t = data.total;
    const adsTong = t.ads + t.ads_khong_ma;
    const biDot = data.rows.filter(r => r.ads > 0 && r.orders === 0);

    return (
        <div className="space-y-6">
            <ReportHero
                emoji="📦"
                title={`P&L theo sản phẩm — ${ngayVN(data.from)} → ${ngayVN(data.to)}`}
                subtitle={
                    <>
                        Đơn đã chốt trên POS (trừ huỷ, nháp, đơn trống) — cùng nền với tab P&L. Doanh số một sản phẩm là tiền
                        đơn chia theo số lượng từng dòng hàng; tiền ads theo ô mã sản phẩm trong tên campaign; giá vốn theo
                        bảng &ldquo;Giá tới Taiwan&rdquo; và bảng giá UAE; phí ship ước tính.
                    </>
                }
            />

            <KpiRow>
                <KpiTile emoji="🏷️" label="Sản phẩm" value={formatNumber(data.rows.filter(r => r.orders > 0).length)}
                    sub={`${formatNumber(t.units)} cái · ${formatNumber(t.orders)} đơn`} />
                <KpiTile emoji="💵" label="Doanh số" value={formatVNDCompact(t.doanh_so)} />
                <KpiTile emoji="💸" label="Tiền ads" value={formatVNDCompact(adsTong)}
                    sub={t.ads_khong_ma > 0 ? `${formatVNDCompact(t.ads_khong_ma)} camp không ghi mã` : `${pctText(adsTong, t.doanh_so)} doanh số`}
                    tone={t.ads_khong_ma > 0 ? "warn" : "neutral"} />
                <KpiTile emoji="📦" label="Giá vốn" value={formatVNDCompact(t.cogs)}
                    sub={data.missing_costs.length ? `${data.missing_costs.length} mã thiếu giá` : `${pctText(t.cogs, t.doanh_so)} doanh số`}
                    tone={data.missing_costs.length ? "warn" : "neutral"} />
                <KpiTile emoji="🚚" label="Phí ship" value={formatVNDCompact(t.ship)} sub="ước tính" />
                <KpiTile emoji="📊" label="Lãi gộp (tạm tính)" value={formatVNDCompact(t.lai)}
                    sub={t.doanh_so > 0 ? `biên ${((t.lai / t.doanh_so) * 100).toFixed(1)}%` : DASH}
                    tone={t.lai >= 0 ? "good" : "bad"} />
            </KpiRow>

            {(biDot.length > 0 || data.missing_costs.length > 0 || t.ads_khong_ma > 0) && (
                <section className="rounded-xl border border-amber-300 bg-amber-50/60 p-5 text-sm dark:border-amber-500/30 dark:bg-amber-500/5">
                    <h3 className="section-header mb-2">⚠️ Cần xem</h3>
                    <ul className="space-y-1.5 text-foreground">
                        {biDot.length > 0 && (
                            <li><strong>Tiêu tiền ads mà 0 đơn:</strong> {biDot.map(r => `${r.ten} (${formatVNDCompact(r.ads)})`).join(" · ")}</li>
                        )}
                        {t.ads_khong_ma > 0 && (
                            <li><strong>{formatVNDCompact(t.ads_khong_ma)} tiền ads</strong> ở campaign không ghi mã sản phẩm — không gán được cho sản phẩm nào, chỉ cộng vào tổng.</li>
                        )}
                        {data.missing_costs.length > 0 && (
                            <li><strong>Thiếu giá vốn:</strong> {data.missing_costs.map(m => `${m.ten} (${m.orders} đơn)`).join(" · ")} — lãi của những dòng này đang cao hơn thật.</li>
                        )}
                    </ul>
                </section>
            )}

            <ReportTable
                emoji="🏷️"
                title="Từng sản phẩm"
                note="Sắp theo doanh số. Dòng tên nghiêng là hàng chưa tra được giá vốn. Lãi gộp = doanh số − tiền ads − phí ship − giá vốn, chưa trừ đơn hoàn và chi phí vận hành."
                columns={COLUMNS}
                rows={data.rows}
                rowKey={r => r.sp}
                empty="Kỳ này chưa có đơn nào"
                footer={<>
                    {t.ads_khong_ma > 0 && (
                        <tr className="border-t border-border text-muted-foreground">
                            <td className="px-3 py-2 italic" colSpan={4}>(ads ở campaign không ghi mã sản phẩm)</td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatMoney(t.ads_khong_ma)}</td>
                            <td colSpan={3} />
                            <td className="px-3 py-2 text-right tabular-nums text-rose-600 dark:text-rose-400">{signed(-t.ads_khong_ma)}</td>
                            <td />
                        </tr>
                    )}
                    <TongRow cells={[
                        "TỔNG", formatNumber(t.orders), formatNumber(t.units), formatMoney(t.doanh_so), formatMoney(adsTong),
                        pctText(adsTong, t.doanh_so), formatMoney(t.ship), formatMoney(t.cogs), signed(t.lai), pctText(t.lai, t.doanh_so),
                    ]} lai={t.lai} />
                </>}
            />

            <FootNotes
                warning={<><strong>Lãi gộp tạm tính.</strong> Coi mọi đơn đã chốt là giao thành công; phí ship là ước tính trung bình; chưa trừ đơn hoàn và chi phí vận hành.</>}
                notes={[
                    <>Doanh số một sản phẩm: POS để giá bán từng dòng hàng = 0, nên tiền đơn được chia theo số lượng. Đơn ghép nhiều sản phẩm giá lệch nhau thì phần chia chỉ là gần đúng; tổng vẫn khớp tab P&L.</>,
                    <>Tiền ads: campaign có ô mã sản phẩm (&ldquo;…/040/…&rdquo;), chỉ campaign của người trong team như file TỔNG TEAM{t.ads_ngoai_team > 0 ? ` (${formatVNDCompact(t.ads_ngoai_team)} của campaign không nhận ra người trong team không tính)` : ""}.</>,
                    ...Object.entries(data.ship_basis).map(([code, moTa]) => <>Phí ship {marketName(code)}: {moTa}</>),
                ]}
            />
        </div>
    );
}

function TongRow({ cells, lai }: { cells: ReactNode[]; lai: number }) {
    return (
        <tr className="border-t-2 border-amber-500/30 bg-amber-500/5 font-bold">
            {cells.map((c, i) => (
                <td key={i} className={cn("px-3 py-2 tabular-nums", i === 0 ? "text-left" : "text-right", i === 8 && laiClass(lai))}>{c}</td>
            ))}
        </tr>
    );
}

const COLUMNS: Column<Row>[] = [
    {
        key: "ten", label: "Sản phẩm",
        cellClassName: r => cn("font-medium", r.thieu_gia ? "italic text-muted-foreground" : "text-foreground"),
        render: r => (
            <span className="flex flex-col">
                <span>{r.ten}</span>
                <span className="text-[11px] font-normal text-muted-foreground">
                    {[r.ma && r.ten.indexOf(r.ma) !== 0 ? `mã ${r.ma}` : null, r.shops.map(s => marketName(s)).join(" · ") || null,
                        r.ads > 0 && r.orders === 0 ? "chưa có đơn" : null].filter(Boolean).join(" · ")}
                </span>
            </span>
        ),
    },
    { key: "orders", label: "Đơn", align: "right", render: r => formatNumber(r.orders) },
    { key: "units", label: "Số cái", align: "right", render: r => formatNumber(r.units) },
    { key: "doanh_so", label: "Doanh số", align: "right", render: r => (r.doanh_so > 0 ? formatMoney(r.doanh_so) : DASH) },
    { key: "ads", label: "Tiền ads", align: "right", render: r => (r.ads > 0 ? formatMoney(r.ads) : DASH) },
    { key: "ads_pct", label: "% Ads/DT", align: "right", render: r => (r.ads > 0 ? pctText(r.ads, r.doanh_so) : DASH) },
    { key: "ship", label: "Phí ship", align: "right", render: r => (r.ship > 0 ? formatMoney(r.ship) : DASH) },
    {
        key: "cogs", label: "Giá vốn", align: "right",
        title: "Số cái × giá vốn một cái",
        render: r => (r.thieu_gia ? "thiếu giá" : r.cogs > 0 ? formatMoney(r.cogs) : DASH),
    },
    { key: "lai", label: "Lãi gộp", align: "right", cellClassName: r => cn("font-semibold", laiClass(r.lai)), render: r => signed(r.lai) },
    { key: "bien", label: "Biên", align: "right", render: r => pctText(r.lai, r.doanh_so) },
];

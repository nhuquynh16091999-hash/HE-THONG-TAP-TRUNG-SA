"use client";

import { useEffect, useState, type ReactNode } from "react";
import { format } from "date-fns";
import { formatVNDCompact, formatMoney, formatNumber, marketName, shippingVNDFromRevVnd, cn } from "../utils";
import { useMarkets } from "../markets-context";
import TabSkeleton from "@/components/ui/tab-skeleton";
import CeoAssistant from "../ceo-assistant";
import CeoSmartInsights from "./ceo-smart-insights";
import {
    ReportHero, KpiRow, KpiTile, ResultCard, WaterfallList, BarStrip,
    ReportTable, FootNotes, LightEmoji, LightLegend,
    lightForAdsPct, DASH,
    type Column,
} from "../report";

/*
 * Tổng quan — số lấy THẲNG từ file Google Sheet "TỔNG TEAM THÁNG n" qua
 * /api/talpha/sheet-report?from&to, cùng file CEO xem và bot Zalo đọc.
 *
 * Trước 25/09/2026 tab tự tính lại từ BigQuery theo luật riêng: doanh thu chỉ đếm đơn
 * ĐÃ GIAO XONG, tiền ads gán marketer theo ad_id của đơn đã giao, tên marketer là tên
 * tài khoản POS thô ("Chun Ho", "Tô Lâm"), và không có mốc ngày — 28/07 → 25/09 ra
 * DS 13,9tr, ads 146,4tr, ROAS 0,10×, trong khi Sheet cùng kỳ ra doanh số hơn 144tr.
 * Sỹ Anh chốt: số dashboard phải khớp Sheet, và chỉ tính từ 15/09/2026. Đọc thẳng Sheet
 * thì hết chỗ lệch — muốn đổi cách tính thì đổi ở format_all.py, hai nơi đổi theo nhau.
 */

interface Props { dateRange?: { from: Date; to: Date }; projectId?: string }

interface So { ads: number; mess: number; don: number; doanh_so: number; ds_giao_tc: number }
type MarketerRow = So & { tab: string; display: string; ngoaiTong?: boolean };
type MarketRow = So & { tab: string; code: string | null };
type DayRow = So & { date: string };
interface Report {
    from: string; to: string; start_date: string | null;
    sheets: Record<string, string>;
    missing_months: string[];
    team: So;
    marketers: (So & { tab: string; display: string })[];
    unassigned: So | null;
    markets: MarketRow[];
    days: DayRow[];
    months: (So & { month: string })[];
}

// Số dẫn xuất — cùng công thức cột Sheet (drow/vrow trong format_all.py).
const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : null);
const adsPct = (s: So) => pct(s.ads, s.doanh_so);            // "% Ads/DT"
const adsPctGiao = (s: So) => pct(s.ads, s.ds_giao_tc);      // "% Ads/DT giao"
const tyLeChot = (s: So) => pct(s.don, s.mess);              // "Tỷ lệ chốt"
const pctText = (v: number | null, digits = 1) => (v === null ? DASH : `${v.toFixed(digits)}%`);
const ngayVN = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export default function TALPHACeoOverviewTab({ dateRange }: Props) {
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<Report | null>(null);
    const [loi, setLoi] = useState<string | null>(null);
    // KPI doanh số/tháng (VND) từ talpha_rules.json — tháng nào không khai thì không có khoá.
    const [targets, setTargets] = useState<Record<string, number>>({});
    const { loaded: marketsLoaded } = useMarkets();

    useEffect(() => {
        fetch("/api/talpha/targets")
            .then(r => r.json())
            .then(d => setTargets(d?.monthly_revenue_vnd || {}))
            .catch(() => setTargets({}));
    }, []);

    useEffect(() => {
        let dung = false;
        const from = format(dateRange?.from ?? new Date(), "yyyy-MM-dd");
        const to = format(dateRange?.to ?? new Date(), "yyyy-MM-dd");
        setLoading(true);
        setLoi(null);
        fetch(`/api/talpha/sheet-report?from=${from}&to=${to}`)
            .then(async r => {
                const d = await r.json();
                if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`);
                return d as Report;
            })
            .then(d => { if (!dung) setData(d); })
            .catch(e => { if (!dung) { setData(null); setLoi(String(e?.message || e)); } })
            .finally(() => { if (!dung) setLoading(false); });
        return () => { dung = true; };
    }, [dateRange]);

    // Chờ danh sách nước để đổi mã "SG" ra tên và tính phí ship theo bảng 3PL.
    if (loading || !marketsLoaded) return <TabSkeleton cards={6} showChart={true} rows={5} />;

    if (loi || !data) {
        return (
            <div className="rounded-xl border border-rose-300 bg-rose-50 p-5 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                <p className="font-semibold">Không đọc được file TỔNG TEAM.</p>
                <p className="mt-1">{loi}</p>
                <p className="mt-2 text-xs opacity-80">
                    Số trên tab này lấy thẳng từ Sheet. Không đọc được thì không hiện số tự tính khác đi,
                    để khỏi có hai bộ số lệch nhau.
                </p>
            </div>
        );
    }

    const t = data.team;
    const period = `${ngayVN(data.from)} → ${ngayVN(data.to)}`;
    const today = format(new Date(), "yyyy-MM-dd");
    const runningMonth = today.slice(0, 7);

    // Phí ship dựng theo bảng giá 3PL, trên MỌI đơn đã chốt (cùng nền với doanh số).
    // Không có tab nước (kỳ chỉ một nước có số) thì không biết nước nào → không đoán, để 0.
    const ship = data.markets.reduce((s, m) => s + (m.code ? shippingVNDFromRevVnd(m.code, m.don, m.doanh_so) : 0), 0);
    const lai = t.doanh_so - t.ads - ship;
    const bien = pct(lai, t.doanh_so);
    const roas = t.ads > 0 ? t.doanh_so / t.ads : 0;
    const pAds = adsPct(t);
    const pAdsGiao = adsPctGiao(t);
    const chot = tyLeChot(t);

    // Thanh KPI chỉ nói về THÁNG ĐANG CHẠY — KPI trong rules file là KPI tháng.
    const runningRow = data.months.find(m => m.month === runningMonth);
    const runningTarget = targets[runningMonth];
    const monthProgress = runningRow && runningTarget
        ? {
            label: `Doanh số tháng ${runningMonth.slice(5)}/${runningMonth.slice(0, 4)}`,
            current: runningRow.doanh_so,
            target: runningTarget,
            format: formatVNDCompact,
        }
        : undefined;

    const signed = (n: number) => `${n >= 0 ? "+" : ""}${formatMoney(n)}`;
    const marketerRows: MarketerRow[] = [
        ...data.marketers,
        ...(data.unassigned ? [{ ...data.unassigned, tab: "(không gán)", display: "(không gán)", ngoaiTong: true }] : []),
    ];
    const tenNuoc = (m: MarketRow) => (m.code ? marketName(m.code) : m.tab);

    return (
        <div className="space-y-6">
            {/* ═══ 1. Hero — kỳ báo cáo + xuất xứ số ═══ */}
            <ReportHero
                emoji="📊"
                title={`Báo cáo ANTALO — ${period}`}
                subtitle={
                    <>
                        Số lấy thẳng từ file <strong>TỔNG TEAM</strong> — cùng file CEO xem, cập nhật mỗi giờ.
                        Chỉ tính người trong team · doanh số là đơn đã chốt (trừ huỷ, nháp, đơn trống), quy VND theo tỷ giá
                        từng nước · tiền ads là số thật từ Meta
                        {data.start_date && <> · tính từ <strong>{ngayVN(data.start_date)}</strong>, trước đó dữ liệu chưa đủ</>}.
                    </>
                }
                progress={monthProgress}
            >
                {monthProgress && (
                    <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground/80">
                        KPI lấy từ bảng &ldquo;KPI Q3-Q4&rdquo; CEO chốt, tính trên doanh số ship. Thanh này đo doanh số đơn đã chốt
                        {data.start_date && data.start_date.slice(0, 7) === runningMonth && <> từ {ngayVN(data.start_date)}</>}.
                    </p>
                )}
            </ReportHero>

            {data.missing_months.length > 0 && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                    <strong>Thiếu số tháng {data.missing_months.join(", ")}:</strong> chưa khai ID file TỔNG TEAM của tháng đó trong{" "}
                    <code className="rounded bg-amber-100 px-1 dark:bg-amber-500/20">talpha_rules.json → report_sheets.grand_by_month</code>.
                    Các con số dưới đây <strong>chưa gồm</strong> tháng đó.
                </div>
            )}

            {/* ═══ 2. Hàng KPI — cùng cột với Sheet ═══ */}
            <KpiRow>
                <KpiTile
                    emoji="💸"
                    label="Tiền ads"
                    value={formatVNDCompact(t.ads)}
                    sub={`${formatNumber(t.mess)} tin nhắn · ${t.mess > 0 ? formatVNDCompact(t.ads / t.mess) : DASH}/tin`}
                    tooltip="Cột TỔNG TIỀN ADS của tab Tổng: chi tiêu Meta của campaign có tên người trong team."
                />
                <KpiTile
                    emoji="💰"
                    label="Doanh số"
                    value={formatVNDCompact(t.doanh_so)}
                    sub={`${formatNumber(t.don)} đơn · TB ${t.don > 0 ? formatVNDCompact(t.doanh_so / t.don) : DASH}/đơn`}
                    tooltip="Cột Doanh Số của Sheet: mọi đơn đã chốt trên POS (trừ huỷ, đơn nháp, đơn trống), quy VND theo tỷ giá từng nước."
                />
                <KpiTile
                    emoji="📉"
                    label="% Ads/DT"
                    value={pctText(pAds)}
                    sub={`ROAS ${roas.toFixed(2)}×`}
                    tone={pAds === null ? "neutral" : lightForAdsPct(pAds)}
                    legend={<LightLegend />}
                    tooltip="Tiền ads ÷ doanh số — cột % Ads/DT của Sheet. Càng thấp càng tốt."
                />
                <KpiTile
                    emoji="🎯"
                    label="Tỷ lệ chốt"
                    value={pctText(chot, 2)}
                    sub={`CPO ${t.don > 0 ? formatVNDCompact(t.ads / t.don) : DASH}`}
                    tooltip="Số đơn ÷ số tin nhắn. CPO = tiền ads ÷ số đơn."
                />
                <KpiTile
                    emoji="📦"
                    label="DS giao TC"
                    value={formatVNDCompact(t.ds_giao_tc)}
                    sub={t.ds_giao_tc > 0 ? `% Ads/DT giao ${pctText(pAdsGiao)}` : "chưa có đơn giao xong"}
                    tooltip="Doanh số của riêng đơn đã giao thành công. Đơn COD mất vài ngày tới vài tuần mới giao xong nên số này luôn đi sau doanh số."
                />
                <KpiTile
                    emoji="🌍"
                    label="Thị trường"
                    value={formatNumber(data.markets.length || (t.don || t.ads ? 1 : 0))}
                    sub={data.markets.map(tenNuoc).join(" · ") || DASH}
                />
            </KpiRow>

            {/* ═══ 3. Lãi tạm tính ═══ */}
            <ResultCard
                emoji="📊"
                title="Lãi sau ads (tạm tính)"
                note="Tính trên doanh số đơn đã chốt, tức là giả định mọi đơn đều giao thành công — đơn hoàn sau này sẽ kéo số này xuống. Chưa trừ giá vốn và chi phí vận hành."
                value={signed(lai)}
                caption={bien === null ? "chưa có doanh số" : `biên ${bien.toFixed(1)}% trên doanh số`}
                tone={lai >= 0 ? "good" : "bad"}
                segments={[
                    { color: "bg-rose-400", value: t.ads, label: "Tiền ads" },
                    { color: "bg-amber-400", value: ship, label: "Phí ship" },
                    { color: "bg-emerald-500", value: Math.max(0, lai), label: "Lãi sau ads" },
                ]}
                subStats={[
                    { label: "ROAS", value: `${roas.toFixed(2)}×`, hint: "doanh số ÷ tiền ads" },
                    { label: "% Ads/DT", value: pctText(pAds), hint: "cột % Ads/DT của Sheet" },
                    {
                        label: "Đã giao xong",
                        value: formatVNDCompact(t.ds_giao_tc),
                        hint: `${pctText(pct(t.ds_giao_tc, t.doanh_so))} doanh số đã thành tiền giao TC`,
                    },
                ]}
            >
                <WaterfallList
                    rows={[
                        { label: "Doanh số (đơn đã chốt)", value: formatMoney(t.doanh_so), kind: "base" },
                        { label: "Tiền ads", value: formatMoney(t.ads), kind: "minus" },
                        ship > 0
                            ? { label: "Phí ship", hint: "model 3PL theo thị trường", value: formatMoney(ship), kind: "minus" }
                            : { label: "Phí ship", hint: "chưa khai bảng giá 3PL", value: DASH, kind: "minus", missing: true },
                        { label: "Giá vốn", hint: "order_items chưa có giá vốn", value: DASH, kind: "minus", missing: true },
                        { label: "Lãi sau ads (tạm tính)", value: signed(lai), kind: "total" },
                    ]}
                />
            </ResultCard>

            {/* ═══ 4. Cảnh báo & trợ lý — giữ nguyên module cũ ═══ */}
            <CeoSmartInsights roas={roas} margin={bien ?? 0} net={lai} revenue={t.doanh_so} />
            <CeoAssistant dateRange={dateRange} />

            {/* ═══ 5. Xu hướng theo ngày ═══ */}
            <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
                <h3 className="section-header mb-1">📈 Xu hướng theo ngày</h3>
                <BarStrip
                    hint="Tầng trên là doanh số đơn đã chốt, tầng dưới là doanh số trừ tiền ads của ngày đó. Cột mờ có gạch chéo = hôm nay, chưa hết ngày."
                    items={data.days.map(d => ({
                        label: `${d.date.slice(8, 10)}/${d.date.slice(5, 7)}`,
                        top: d.doanh_so,
                        bottom: d.doanh_so - d.ads,
                        inProgress: d.date === today,
                        title: `${ngayVN(d.date)} · ads ${formatMoney(d.ads)} · ${formatNumber(d.don)} đơn · DS ${formatMoney(d.doanh_so)}`,
                    }))}
                    legend={[
                        { color: "bg-emerald-500/70", label: "doanh số" },
                        { color: "bg-sky-500/70", label: "doanh số − ads" },
                        { color: "bg-rose-500/70", label: "ads vượt doanh số" },
                    ]}
                />
            </section>

            {/* ═══ 6. Theo nhân viên ═══ */}
            <ReportTable
                emoji="👥"
                title="Theo nhân viên"
                note="Mỗi dòng là tab của người đó trong file TỔNG TEAM: tiền ads theo tên trong campaign, đơn theo người được gán trên POS. Dòng (không gán) — đơn chưa gán được ai, hoặc số của người đã nghỉ — không nằm trong dòng TỔNG, giống tab Tổng của Sheet."
                columns={MARKETER_COLUMNS}
                rows={marketerRows}
                rowKey={m => m.tab}
                empty="Kỳ này chưa có số của ai"
                footer={<TongRow cells={[
                    "TỔNG TEAM", money(t.ads), formatNumber(t.mess), formatNumber(t.don), pctText(chot, 2),
                    money(t.doanh_so), pctText(pAds), money(t.ds_giao_tc), adsLight(t),
                ]} />}
            />

            {/* ═══ 7. Theo thị trường ═══ */}
            <ReportTable
                emoji="🌍"
                title="Theo thị trường"
                note="Tab từng nước của file TỔNG TEAM. Tiền ads chia theo mã nước ở ô đầu tên campaign (TW · SG · AE); đơn theo shop POS của nước đó."
                columns={MARKET_COLUMNS(tenNuoc)}
                rows={data.markets}
                rowKey={m => m.tab}
                empty="Kỳ này chỉ một nước có số — Sheet không tách tab theo nước"
            />

            {/* ═══ 8. Chi tiết theo ngày — cùng hàng với tab Tổng của Sheet ═══ */}
            <ReportTable
                emoji="📅"
                title="Chi tiết theo ngày"
                note="Đọc từ tab Tổng của file TỔNG TEAM — số từng ngày ở đây phải trùng từng dòng trong Sheet."
                columns={DAY_COLUMNS}
                rows={[...data.days].reverse()}
                rowKey={d => d.date}
                empty="Chưa có ngày nào có số trong khoảng này"
                footer={<TongRow cells={[
                    "TỔNG", money(t.ads), formatNumber(t.mess), t.mess > 0 ? money(t.ads / t.mess) : DASH,
                    formatNumber(t.don), pctText(chot, 2), money(t.doanh_so), money(t.ds_giao_tc), pctText(pAds),
                ]} />}
            />

            {/* ═══ 9. Chân tab — định nghĩa số và nguồn ═══ */}
            <FootNotes
                warning={
                    <>
                        <strong>Lãi ở đây là tạm tính.</strong> Nó tính trên doanh số đơn đã chốt, chưa trừ đơn hoàn, giá vốn và
                        chi phí vận hành. Tiền đã thật sự giao xong xem ở ô DS giao TC.
                    </>
                }
                notes={[
                    <>Mọi số đọc từ Sheet &ldquo;TỔNG TEAM THÁNG n&rdquo; (ID khai ở <code className="rounded bg-muted px-1 py-0.5 text-[11px]">talpha_rules.json → report_sheets</code>), do <code className="rounded bg-muted px-1 py-0.5 text-[11px]">format_all.py</code> ghi mỗi giờ. Sync hỏng thì Sheet đứng số cũ, tab này đứng theo. Muốn đổi cách tính thì sửa format_all.py — Sheet, bot Zalo và tab này đổi theo cùng lúc; đừng vá riêng ở tab.</>,
                    <>Doanh số = đơn đã chốt trên POS, trừ huỷ, đơn nháp và đơn trống (0 sản phẩm, 0 tiền); ngày tính theo giờ Việt Nam.</>,
                    <>TỔNG chỉ gồm người trong team. Người ngoài team chạy chung TKQC và ô (không gán) không vào TỔNG.</>,
                    <>Số trước mốc gốc không tính — đổi mốc ở <code className="rounded bg-muted px-1 py-0.5 text-[11px]">talpha_rules.json → report_start_date</code>.</>,
                ]}
            />
        </div>
    );
}

/* ═══════════ Định nghĩa cột — tách khỏi phần render cho gọn ═══════════ */

const money = (n: number) => formatMoney(n);
// Người không tiêu đồng nào và không có đơn: không có gì để chấm, hiện gạch chứ không đèn đỏ.
const adsLight = (s: So) =>
    (s.ads === 0 && s.doanh_so === 0 ? DASH : <LightEmoji light={lightForAdsPct(adsPct(s) ?? undefined)} />);

/** Dòng TỔNG ghim cuối bảng — ô đầu căn trái, ô đèn (nếu là phần tử) căn giữa, còn lại căn phải. */
function TongRow({ cells }: { cells: ReactNode[] }) {
    return (
        <tr className="border-t-2 border-amber-500/30 bg-amber-500/5 font-bold">
            {cells.map((c, i) => (
                <td
                    key={i}
                    className={cn("px-3 py-2 tabular-nums", i === 0 ? "text-left" : typeof c === "object" ? "text-center" : "text-right")}
                >
                    {c}
                </td>
            ))}
        </tr>
    );
}

const MARKETER_COLUMNS: Column<MarketerRow>[] = [
    {
        key: "display", label: "Nhân viên",
        cellClassName: m => cn("font-medium", m.ngoaiTong ? "text-muted-foreground italic" : "text-foreground"),
        render: m => m.display,
    },
    { key: "ads", label: "Tiền ads", align: "right", render: m => (m.ads > 0 ? money(m.ads) : DASH) },
    { key: "mess", label: "Tin nhắn", align: "right", render: m => formatNumber(m.mess) },
    { key: "don", label: "Đơn", align: "right", render: m => formatNumber(m.don) },
    { key: "chot", label: "Chốt", align: "right", title: "Số đơn ÷ tin nhắn", render: m => pctText(tyLeChot(m), 2) },
    { key: "doanh_so", label: "Doanh số", align: "right", render: m => money(m.doanh_so) },
    { key: "ads_pct", label: "% Ads/DT", align: "right", title: "Tiền ads ÷ doanh số của riêng người đó", render: m => pctText(adsPct(m)) },
    { key: "gtc", label: "DS giao TC", align: "right", render: m => (m.ds_giao_tc > 0 ? money(m.ds_giao_tc) : DASH) },
    { key: "light", label: "Đèn", align: "center", render: m => adsLight(m) },
];

const MARKET_COLUMNS = (tenNuoc: (m: MarketRow) => string): Column<MarketRow>[] => [
    { key: "tab", label: "Thị trường", cellClassName: "font-medium text-foreground", render: m => tenNuoc(m) },
    { key: "ads", label: "Tiền ads", align: "right", render: m => money(m.ads) },
    { key: "mess", label: "Tin nhắn", align: "right", render: m => formatNumber(m.mess) },
    { key: "don", label: "Đơn", align: "right", render: m => formatNumber(m.don) },
    { key: "doanh_so", label: "Doanh số", align: "right", render: m => money(m.doanh_so) },
    { key: "ads_pct", label: "% Ads/DT", align: "right", render: m => pctText(adsPct(m)) },
    { key: "gtc", label: "DS giao TC", align: "right", render: m => (m.ds_giao_tc > 0 ? money(m.ds_giao_tc) : DASH) },
    { key: "light", label: "Đèn", align: "center", render: m => adsLight(m) },
];

const DAY_COLUMNS: Column<DayRow>[] = [
    { key: "date", label: "Ngày", cellClassName: "font-medium text-foreground", render: d => ngayVN(d.date) },
    { key: "ads", label: "Tiền ads", align: "right", render: d => money(d.ads) },
    { key: "mess", label: "Tin nhắn", align: "right", render: d => formatNumber(d.mess) },
    { key: "gia_tn", label: "Giá/tin", align: "right", render: d => (d.mess > 0 ? money(d.ads / d.mess) : DASH) },
    { key: "don", label: "Đơn", align: "right", render: d => formatNumber(d.don) },
    { key: "chot", label: "Chốt", align: "right", render: d => pctText(tyLeChot(d), 2) },
    { key: "doanh_so", label: "Doanh số", align: "right", render: d => money(d.doanh_so) },
    { key: "gtc", label: "DS giao TC", align: "right", render: d => (d.ds_giao_tc > 0 ? money(d.ds_giao_tc) : DASH) },
    { key: "ads_pct", label: "% Ads/DT", align: "right", render: d => pctText(adsPct(d)) },
];

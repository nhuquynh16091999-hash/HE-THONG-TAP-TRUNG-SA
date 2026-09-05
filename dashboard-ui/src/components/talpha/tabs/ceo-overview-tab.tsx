"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { formatVNDCompact, formatMoney, formatNumber, marketName, shippingVNDFromRevVnd, cn } from "../utils";
import { BQ_PROJECT, DATASET } from "../constants";
import TabSkeleton from "@/components/ui/tab-skeleton";
import CeoAssistant from "../ceo-assistant";
import CeoSmartInsights from "./ceo-smart-insights";
import {
    ReportHero, KpiRow, KpiTile, ResultCard, WaterfallList, BarStrip,
    ReportTable, FootNotes, LightEmoji, LightLegend,
    lightForAdsPct, lightForHigher, DASH,
    type Column,
} from "../report";

interface Props { dateRange?: { from: Date; to: Date }; projectId?: string }

interface MonthlyRow {
    month: string; orders: number; revenue: number; ads_spend: number; shipping: number; net_profit: number;
}
interface MarketerRow {
    marketer: string; orders: number; revenue: number; ads_spend: number; roas: number; net_profit: number;
}
interface MarketRow {
    shop_name: string; orders: number; revenue: number; ads_spend: number; shipping: number; margin: number;
}
interface ProductRow {
    product_name: string; quantity: number; revenue: number;
}

export default function TALPHACeoOverviewTab({ dateRange }: Props) {
    const [loading, setLoading] = useState(true);
    const [monthly, setMonthly] = useState<MonthlyRow[]>([]);
    const [marketers, setMarketers] = useState<MarketerRow[]>([]);
    const [markets, setMarkets] = useState<MarketRow[]>([]);
    const [products, setProducts] = useState<ProductRow[]>([]);
    const [totals, setTotals] = useState({ orders: 0, revenue: 0, ads: 0, shipping: 0, net: 0, markets: 0 });
    // KPI doanh số/tháng (VND) từ talpha_rules.json — tháng nào không khai thì không có khoá.
    const [targets, setTargets] = useState<Record<string, number>>({});

    useEffect(() => {
        fetch("/api/talpha/targets")
            .then(r => r.json())
            .then(d => setTargets(d?.monthly_revenue_vnd || {}))
            .catch(() => setTargets({}));
    }, []);

    useEffect(() => {
        async function fetchData() {
            setLoading(true);
            try {
                const from = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : "2025-01-01";
                const to = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

                // A1: mọi số tiền/đơn lấy từ view chuẩn vw_orders_std (revenue_vnd đã quy
                // VND theo shop_label, order_date theo tz TKQC, is_confirmed = GIAO_THANH_CONG)
                // và vw_fb_ads_std (spend đã là VND). Shipping vẫn model ở TS (3PL fee table).
                const queries = [
                    // Q0: DS Giao TC theo tháng × market
                    `SELECT
                        FORMAT_DATE('%Y-%m', order_date) as month,
                        market,
                        COUNT(DISTINCT order_uid) as orders,
                        ROUND(SUM(revenue_vnd), 0) as revenue_vnd
                    FROM \`${BQ_PROJECT}.${DATASET}.vw_orders_std\`
                    WHERE order_date BETWEEN '${from}' AND '${to}' AND is_confirmed AND marketer_group != 'external'
                    GROUP BY 1, 2 ORDER BY 1`,

                    // Q1: Monthly ads spend (VND)
                    `SELECT
                        FORMAT_DATE('%Y-%m', date) as month,
                        ROUND(SUM(spend), 0) as ads_spend
                    FROM \`${BQ_PROJECT}.${DATASET}.vw_fb_ads_std\`
                    WHERE date BETWEEN '${from}' AND '${to}' AND spend > 0
                    GROUP BY 1 ORDER BY 1`,

                    // Q2: DS Giao TC theo marketer × market
                    `SELECT
                        marketer_name as marketer,
                        market,
                        COUNT(DISTINCT order_uid) as orders,
                        ROUND(SUM(revenue_vnd), 0) as revenue_vnd
                    FROM \`${BQ_PROJECT}.${DATASET}.vw_orders_std\`
                    WHERE order_date BETWEEN '${from}' AND '${to}' AND is_confirmed AND marketer_group != 'external'
                    GROUP BY 1, 2 ORDER BY revenue_vnd DESC`,

                    // Q3: DS Giao TC theo market
                    `SELECT
                        market,
                        COUNT(DISTINCT order_uid) as orders,
                        ROUND(SUM(revenue_vnd), 0) as revenue_vnd
                    FROM \`${BQ_PROJECT}.${DATASET}.vw_orders_std\`
                    WHERE order_date BETWEEN '${from}' AND '${to}' AND is_confirmed AND marketer_group != 'external'
                    GROUP BY 1 ORDER BY revenue_vnd DESC`,

                    // Q4: Market ads spend — market code from leading campaign_name segment
                    `SELECT
                        CASE
                            WHEN campaign_name LIKE 'Saudi%' OR campaign_name LIKE 'KSA%' OR campaign_name LIKE 'SA/%' THEN 'SA'
                            WHEN campaign_name LIKE 'UAE%' OR campaign_name LIKE 'Dubai%' OR campaign_name LIKE 'AE/%' THEN 'AE'
                            WHEN campaign_name LIKE 'Kuwait%' OR campaign_name LIKE 'KW/%' THEN 'KW'
                            WHEN campaign_name LIKE 'Oman%' OR campaign_name LIKE 'OM/%' THEN 'OM'
                            WHEN campaign_name LIKE 'Qatar%' OR campaign_name LIKE 'QA/%' THEN 'QA'
                            WHEN campaign_name LIKE 'Bahrain%' OR campaign_name LIKE 'BH/%' THEN 'BH'
                            WHEN campaign_name LIKE 'TAIWAN%' OR campaign_name LIKE 'Taiwan%' OR campaign_name LIKE 'TW/%' THEN 'TW'
                            ELSE 'Other'
                        END as market,
                        ROUND(SUM(spend), 0) as ads_spend
                    FROM \`${BQ_PROJECT}.${DATASET}.vw_fb_ads_std\`
                    WHERE date BETWEEN '${from}' AND '${to}' AND spend > 0
                    GROUP BY 1`,

                    // Q5: Ads spend per ad_id (for double-count-free marketer attribution)
                    `SELECT ad_id, ROUND(SUM(spend), 0) as spend
                    FROM \`${BQ_PROJECT}.${DATASET}.vw_fb_ads_std\`
                    WHERE date BETWEEN '${from}' AND '${to}' AND spend > 0
                    GROUP BY 1`,

                    // Q6: Distinct (marketer, ad_id) pairs — đơn GTC, ad_id đã resolve (utm → cột)
                    `SELECT
                        marketer_name as marketer,
                        resolved_ad_id as ad_id
                    FROM \`${BQ_PROJECT}.${DATASET}.vw_orders_std\`
                    WHERE order_date BETWEEN '${from}' AND '${to}' AND marketer_group != 'external'
                      AND is_confirmed AND resolved_ad_id IS NOT NULL
                    GROUP BY 1, 2`,

                    // Q7: Total ads spend (VND)
                    `SELECT ROUND(SUM(spend), 0) as total_ads
                    FROM \`${BQ_PROJECT}.${DATASET}.vw_fb_ads_std\`
                    WHERE date BETWEEN '${from}' AND '${to}' AND spend > 0`,
                ];

                const results = await Promise.all(
                    queries.map(q =>
                        fetch("/api/query", {
                            method: "POST", headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ query: q })
                        }).then(r => r.json()).catch(() => ({ data: [] }))
                    )
                );

                const isValidName = (n: string) =>
                    !!n && n.toLowerCase() !== "unknown" && n !== "None" && n !== "null" && !n.includes("{") && n.length <= 50;

                // Ads spend per ad_id (VND)
                const adSpendMap = new Map<string, number>();
                for (const r of results[5].data || []) {
                    if (r.ad_id) adSpendMap.set(String(r.ad_id), r.ad_spend ?? r.spend ?? 0);
                }
                // Marketer → distinct ad_ids → attribute each ad's spend once (no double counting)
                const mkAdsMap = new Map<string, Set<string>>();
                for (const r of results[6].data || []) {
                    const name = (r.marketer || "").trim();
                    if (!isValidName(name) || !r.ad_id) continue;
                    if (!mkAdsMap.has(name)) mkAdsMap.set(name, new Set());
                    mkAdsMap.get(name)!.add(String(r.ad_id));
                }
                const marketerAds = (name: string) => {
                    const ids = mkAdsMap.get(name);
                    if (!ids) return 0;
                    let s = 0; for (const id of ids) s += adSpendMap.get(id) || 0;
                    return s;
                };

                // Monthly: aggregate revenue+shipping by month (VND, từ view) + merge ads
                const monthMap = new Map<string, { orders: number; revenue: number; shipping: number }>();
                for (const r of results[0].data || []) {
                    const m = r.month || "";
                    const rev = r.revenue_vnd || 0;
                    const ship = shippingVNDFromRevVnd(r.market, r.orders || 0, rev);
                    const ex = monthMap.get(m);
                    if (ex) { ex.orders += r.orders || 0; ex.revenue += rev; ex.shipping += ship; }
                    else monthMap.set(m, { orders: r.orders || 0, revenue: rev, shipping: ship });
                }
                const monthAdsMap = new Map<string, number>();
                for (const r of results[1].data || []) {
                    monthAdsMap.set(r.month || "", r.ads_spend || 0);
                }
                const allMonths = new Set([...monthMap.keys(), ...monthAdsMap.keys()]);
                const monthlyArr: MonthlyRow[] = Array.from(allMonths).sort().map(m => {
                    const rev = monthMap.get(m)?.revenue || 0;
                    const orders = monthMap.get(m)?.orders || 0;
                    const ship = monthMap.get(m)?.shipping || 0;
                    const ads = monthAdsMap.get(m) || 0;
                    return { month: m, orders, revenue: rev, ads_spend: ads, shipping: ship, net_profit: rev - ads - ship };
                });
                setMonthly(monthlyArr);

                // Marketers: aggregate by name with VND; ads attributed once per ad_id
                // net_profit field temporarily accumulates shipping (VND) during aggregation
                const mkMap = new Map<string, MarketerRow>();
                for (const r of results[2].data || []) {
                    const name = (r.marketer || "").trim();
                    if (!isValidName(name)) continue;
                    const rev = r.revenue_vnd || 0;
                    const ship = shippingVNDFromRevVnd(r.market, r.orders || 0, rev);
                    const ex = mkMap.get(name);
                    if (ex) { ex.orders += r.orders || 0; ex.revenue += rev; ex.net_profit += ship; }
                    else mkMap.set(name, { marketer: name, orders: r.orders || 0, revenue: rev, ads_spend: 0, roas: 0, net_profit: ship });
                }
                const mkArr = Array.from(mkMap.values()).map(m => {
                    const ads = marketerAds(m.marketer);
                    const shipping = m.net_profit; // temporarily held shipping
                    return {
                        ...m,
                        ads_spend: ads,
                        roas: ads > 0 ? Math.round((m.revenue / ads) * 100) / 100 : 0,
                        net_profit: m.revenue - ads - shipping,
                    };
                }).sort((a, b) => b.revenue - a.revenue).slice(0, 10);
                setMarketers(mkArr);

                // Markets: revenue + shipping + ads (keyed by market code)
                const mktAdsMap = new Map<string, number>();
                for (const r of results[4].data || []) {
                    mktAdsMap.set(r.market || "", r.ads_spend || 0);
                }
                const marketsArr: MarketRow[] = (results[3].data || []).map((r: any) => {
                    const rev = r.revenue_vnd || 0;
                    const ship = shippingVNDFromRevVnd(r.market, r.orders || 0, rev);
                    const ads = mktAdsMap.get(r.market) || 0;
                    const net = rev - ads - ship;
                    return {
                        shop_name: marketName(r.market), orders: r.orders || 0, revenue: rev,
                        ads_spend: ads, shipping: ship,
                        margin: rev > 0 ? Math.round((net / rev) * 1000) / 10 : 0,
                    };
                });
                setMarkets(marketsArr);

                // Products — order_items currently empty (sync pending); will populate when available
                setProducts([]);

                // Global totals
                const totalRev = monthlyArr.reduce((s, m) => s + m.revenue, 0);
                const totalOrders = monthlyArr.reduce((s, m) => s + m.orders, 0);
                const totalShipping = monthlyArr.reduce((s, m) => s + m.shipping, 0);
                const totalAds = results[7].data?.[0]?.total_ads || 0;
                setTotals({
                    orders: totalOrders, revenue: totalRev, ads: totalAds, shipping: totalShipping,
                    net: totalRev - totalAds - totalShipping, markets: marketsArr.length,
                });
            } catch (e) { console.error("CEO fetch error", e); } finally { setLoading(false); }
        }
        fetchData();
    }, [dateRange]);

    if (loading) return <TabSkeleton cards={6} showChart={true} rows={5} />;

    // ═══ Số dẫn xuất — chỉ là phép chia trên totals, không đụng tới nguồn ═══
    const overallRoas = totals.ads > 0 ? totals.revenue / totals.ads : 0;
    const overallMargin = totals.revenue > 0 ? (totals.net / totals.revenue) * 100 : 0;
    const adsPct = totals.revenue > 0 ? (totals.ads / totals.revenue) * 100 : 0;
    const aov = totals.orders > 0 ? totals.revenue / totals.orders : 0;

    const period = dateRange
        ? `${format(dateRange.from, "dd/MM/yyyy")} → ${format(dateRange.to, "dd/MM/yyyy")}`
        : "toàn kỳ";
    // Tháng đang chạy: chưa hết tháng nên cột luôn thấp giả → đánh dấu, không giấu.
    const runningMonth = format(new Date(), "yyyy-MM");

    // Thanh tiến độ chỉ nói về THÁNG ĐANG CHẠY — KPI trong rules file là KPI tháng,
    // đem so với cả khoảng 60 ngày của bộ chọn ngày là so hai thứ khác nhau.
    const runningRow = monthly.find(m => m.month === runningMonth);
    const runningTarget = targets[runningMonth];
    const monthProgress = runningRow && runningTarget
        ? {
            label: `DS giao TC tháng ${runningMonth.slice(5)}/${runningMonth.slice(0, 4)}`,
            current: runningRow.revenue,
            target: runningTarget,
            format: formatVNDCompact,
        }
        : undefined;

    const signed = (n: number) => `${n >= 0 ? "+" : ""}${formatMoney(n)}`;
    const pctOf = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);

    return (
        <div className="space-y-6">
            {/* ═══ 1. Hero — kỳ báo cáo + xuất xứ số ═══ */}
            <ReportHero
                emoji="📊"
                title={`Báo cáo TALPHA — ${period}`}
                subtitle={
                    <>
                        Doanh thu chỉ tính đơn <strong>giao thành công</strong>, đã quy VND theo tỷ giá từng thị trường ·
                        tiền ads là số thật từ Meta · phí ship dựng theo bảng giá 3PL (cột shipping_fee của POS không dùng được) ·
                        đã loại chi tiêu của người ngoài team.
                    </>
                }
                progress={monthProgress}
            >
                {monthProgress && (
                    <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground/80">
                        KPI lấy từ bảng &ldquo;KPI Q3-Q4&rdquo; CEO chốt. KPI đó tính trên <strong>doanh số ship</strong>,
                        còn thanh này đo <strong>đơn đã giao xong</strong> — hàng Trung Đông mất vài tuần mới giao tới tay
                        nên giữa tháng thanh luôn ngắn hơn thực tế, cuối tháng mới về gần.
                    </p>
                )}
            </ReportHero>

            {/* ═══ 2. Hàng KPI ═══ */}
            <KpiRow>
                <KpiTile
                    emoji="💰"
                    label="DS giao TC"
                    value={formatVNDCompact(totals.revenue)}
                    sub={`${formatNumber(totals.orders)} đơn · ${monthly.length} tháng`}
                    tooltip="Doanh thu của riêng đơn đã giao thành công (GIAO_THANH_CONG), quy VND theo tỷ giá thị trường. Đơn chưa giao không được tính."
                />
                <KpiTile
                    emoji="📊"
                    label="Lãi sau ads"
                    value={formatVNDCompact(totals.net)}
                    sub={`biên ${overallMargin.toFixed(1)}%`}
                    tone={totals.net >= 0 ? "good" : "bad"}
                    tooltip="Doanh thu − tiền ads − phí ship. CHƯA trừ giá vốn và chưa trừ chi phí vận hành, nên đây không phải lãi cuối cùng."
                />
                <KpiTile
                    emoji="📦"
                    label="Đơn giao TC"
                    value={formatNumber(totals.orders)}
                    sub={`AOV ${formatVNDCompact(aov)}`}
                />
                <KpiTile
                    emoji="🎯"
                    label="ROAS"
                    value={`${overallRoas.toFixed(2)}×`}
                    sub={`Ads ${formatVNDCompact(totals.ads)}`}
                    tone={lightForHigher(overallRoas, ROAS_TARGET, ROAS_DANGER)}
                    tooltip={`DS giao TC ÷ tiền ads. Ngưỡng từ talpha_rules.json: ≥${ROAS_TARGET} đạt mục tiêu, dưới ${ROAS_DANGER} là báo động.`}
                />
                <KpiTile
                    emoji="📉"
                    label="ads%"
                    value={`${adsPct.toFixed(0)}%`}
                    tone={lightForAdsPct(adsPct)}
                    legend={<LightLegend />}
                    tooltip="Tiền ads trên DS giao TC. Càng thấp càng tốt."
                />
                <KpiTile
                    emoji="🌍"
                    label="Thị trường"
                    value={formatNumber(totals.markets)}
                    sub={markets.slice(0, 3).map(m => m.shop_name).join(" · ") || DASH}
                />
            </KpiRow>

            {/* ═══ 3. Kết quả kỳ + bóc tách chi phí ═══ */}
            <ResultCard
                emoji="📊"
                title="Lãi / lỗ kỳ này"
                note="Tính trên đơn đã giao thành công. Chưa trừ giá vốn (order_items chưa có giá) và chưa trừ chi phí vận hành (lương, phần mềm) — đây là lãi sau quảng cáo và phí ship, không phải lãi cuối cùng."
                value={signed(totals.net)}
                caption={`biên lãi ${overallMargin.toFixed(1)}% trên doanh thu`}
                tone={totals.net >= 0 ? "good" : "bad"}
                segments={[
                    { color: "bg-rose-400", value: totals.ads, label: "Tiền ads" },
                    { color: "bg-amber-400", value: totals.shipping, label: "Phí ship" },
                    { color: "bg-emerald-500", value: Math.max(0, totals.net), label: "Lãi sau ads" },
                ]}
                subStats={[
                    {
                        label: "ROAS",
                        value: `${overallRoas.toFixed(2)}×`,
                        hint: "DS giao TC ÷ tiền ads",
                    },
                    {
                        label: "ads%",
                        value: `${adsPct.toFixed(0)}%`,
                        hint: `tiền ads chiếm ${adsPct.toFixed(0)}% doanh thu giao TC`,
                    },
                    {
                        label: "Phí ship",
                        value: formatVNDCompact(totals.shipping),
                        hint: `${pctOf(totals.shipping, totals.revenue).toFixed(1)}% doanh thu · dựng từ bảng giá 3PL`,
                    },
                ]}
            >
                <WaterfallList
                    rows={[
                        { label: "Doanh thu (đơn giao thành công)", value: formatMoney(totals.revenue), kind: "base" },
                        { label: "Tiền ads", value: formatMoney(totals.ads), kind: "minus" },
                        { label: "Phí ship", hint: "model 3PL theo thị trường", value: formatMoney(totals.shipping), kind: "minus" },
                        { label: "Giá vốn", hint: "order_items chưa có giá vốn", value: DASH, kind: "minus", missing: true },
                        { label: "Lãi sau quảng cáo", value: signed(totals.net), kind: "total" },
                    ]}
                />
            </ResultCard>

            {/* ═══ 4. Cảnh báo & trợ lý — giữ nguyên module cũ ═══ */}
            <CeoSmartInsights roas={overallRoas} margin={overallMargin} net={totals.net} revenue={totals.revenue} />
            <CeoAssistant dateRange={dateRange} />

            {/* ═══ 5. Xu hướng theo tháng ═══ */}
            <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
                <h3 className="section-header mb-1">📈 Xu hướng theo tháng</h3>
                <BarStrip
                    hint="Cột mờ có gạch chéo = tháng đang chạy, chưa hết tháng nên luôn thấp giả. Tầng trên là doanh thu giao TC, tầng dưới là lãi (xanh) hoặc lỗ (đỏ)."
                    items={monthly.map(m => ({
                        label: `${m.month.slice(5)}/${m.month.slice(2, 4)}`,
                        top: m.revenue,
                        bottom: m.net_profit,
                        inProgress: m.month === runningMonth,
                        title: `${m.month} · DS ${formatMoney(m.revenue)} · lãi ${signed(m.net_profit)} · ${formatNumber(m.orders)} đơn`,
                    }))}
                    legend={[
                        { color: "bg-emerald-500/70", label: "doanh thu đơn giao TC" },
                        { color: "bg-sky-500/70", label: "lãi sau ads" },
                        { color: "bg-rose-500/70", label: "lỗ" },
                    ]}
                />
            </section>

            {/* ═══ 6. Theo nhân viên ═══ */}
            <ReportTable
                emoji="👥"
                title="Theo nhân viên"
                note="Tiền ads gán về marketer qua ad_id, mỗi ad chỉ tính cho một người một lần nên tổng không bị đếm trùng. Người ngoài team đã loại khỏi bảng này."
                columns={MARKETER_COLUMNS}
                rows={marketers}
                rowKey={m => m.marketer}
                empty="Chưa gán được marketer nào trong kỳ này"
            />

            {/* ═══ 7. Theo thị trường ═══ */}
            <ReportTable
                emoji="🌍"
                title="Theo thị trường"
                note="Tiền ads chia theo thị trường bằng ô đầu tên campaign; campaign không ghi thị trường rơi vào nhóm Other nên tổng cột ads ở đây có thể nhỏ hơn tổng toàn kỳ."
                columns={MARKET_COLUMNS}
                rows={markets}
                rowKey={m => m.shop_name}
            />

            {/* ═══ 8. Chi tiết theo tháng ═══ */}
            <ReportTable
                emoji="📅"
                title="Chi tiết theo tháng"
                columns={MONTHLY_COLUMNS}
                rows={monthly}
                rowKey={m => m.month}
                footer={
                    <tr className="border-t-2 border-amber-500/30 bg-amber-500/5 font-bold">
                        <td className="px-3 py-2 text-left">TỔNG</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatNumber(totals.orders)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatMoney(totals.revenue)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatMoney(totals.ads)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatMoney(totals.shipping)}</td>
                        <td className={cn("px-3 py-2 text-right tabular-nums", totals.net >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
                            {signed(totals.net)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{overallMargin.toFixed(1)}%</td>
                        <td className="px-3 py-2 text-center"><LightEmoji light={lightForAdsPct(adsPct)} /></td>
                    </tr>
                }
            />

            {/* ═══ 9. Chân tab — định nghĩa số và nguồn ═══ */}
            <FootNotes
                warning={
                    <>
                        <strong>Đây chưa phải lãi cuối cùng.</strong> Giá vốn chưa vào được vì order_items còn thiếu giá,
                        và chi phí vận hành (lương, phần mềm, kho) chưa nằm trong công thức. Con số &ldquo;lãi sau ads&rdquo;
                        luôn đẹp hơn lãi thật.
                    </>
                }
                notes={[
                    <>Doanh thu = đơn có <code className="rounded bg-muted px-1 py-0.5 text-[11px]">status_category = GIAO_THANH_CONG</code>, quy VND theo tỷ giá cố định trong talpha_rules.json. Đơn mới chốt chưa giao không được tính.</>,
                    <>Phí ship là số <strong>dựng theo bảng giá 3PL</strong> (packing + delivery + %COD của từng thị trường), không phải số thật từ đối tác — cột shipping_fee trong POS đang lặp lại giá trị cod nên không dùng được.</>,
                    <>Tiền ads gán về marketer theo ad_id lấy từ đơn; ad nào không có đơn gắn về thì không quy cho ai, nên tổng ads của các marketer nhỏ hơn tổng ads toàn kỳ.</>,
                    <>Ngày tính theo múi giờ của từng tài khoản quảng cáo, đơn tính theo giờ Việt Nam.</>,
                ]}
                sources={["vw_orders_std", "vw_fb_ads_std"]}
            />
        </div>
    );
}

/* ═══════════ Định nghĩa cột — tách khỏi phần render cho gọn ═══════════ */

// Ngưỡng ROAS — chép đúng talpha_rules.json (thresholds.roas_target / roas_danger).
// TODO: khi có route đọc thresholds thì lấy động, đừng để hai nơi trôi khỏi nhau.
const ROAS_TARGET = 2.5;
const ROAS_DANGER = 1.3;

const money = (n: number) => formatMoney(n);
const profitClass = (n: number) =>
    n >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400";

const MARKETER_COLUMNS: Column<MarketerRow>[] = [
    { key: "marketer", label: "Nhân viên", cellClassName: "font-medium text-foreground", render: m => m.marketer },
    { key: "orders", label: "Đơn", align: "right", render: m => formatNumber(m.orders) },
    { key: "revenue", label: "DS giao TC", align: "right", render: m => money(m.revenue) },
    { key: "ads_spend", label: "Ads", align: "right", render: m => (m.ads_spend > 0 ? money(m.ads_spend) : DASH) },
    {
        key: "roas", label: "ROAS", align: "right",
        cellClassName: m => (m.roas >= 2.5 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"),
        render: m => (m.roas ? `${m.roas}×` : DASH),
    },
    {
        key: "ads_pct", label: "ads%", align: "right",
        title: "Tiền ads trên DS giao TC của riêng marketer đó",
        render: m => (m.revenue > 0 && m.ads_spend > 0 ? `${((m.ads_spend / m.revenue) * 100).toFixed(0)}%` : DASH),
    },
    {
        key: "net_profit", label: "Lãi sau ads", align: "right",
        cellClassName: m => cn("font-semibold", profitClass(m.net_profit)),
        render: m => `${m.net_profit >= 0 ? "+" : ""}${money(m.net_profit)}`,
    },
    {
        key: "light", label: "Đèn", align: "center",
        render: m => <LightEmoji light={lightForAdsPct(m.revenue > 0 ? (m.ads_spend / m.revenue) * 100 : undefined)} />,
    },
];

const MARKET_COLUMNS: Column<MarketRow>[] = [
    { key: "shop_name", label: "Thị trường", cellClassName: "font-medium text-foreground", render: m => m.shop_name },
    { key: "orders", label: "Đơn", align: "right", render: m => formatNumber(m.orders) },
    { key: "revenue", label: "DS giao TC", align: "right", render: m => money(m.revenue) },
    { key: "ads_spend", label: "Ads", align: "right", render: m => (m.ads_spend > 0 ? money(m.ads_spend) : DASH) },
    { key: "shipping", label: "Phí ship", align: "right", render: m => money(m.shipping) },
    {
        key: "margin", label: "Biên", align: "right",
        cellClassName: m => cn("font-semibold", profitClass(m.margin)),
        render: m => `${m.margin}%`,
    },
    {
        key: "light", label: "Đèn", align: "center",
        render: m => <LightEmoji light={lightForAdsPct(m.revenue > 0 ? (m.ads_spend / m.revenue) * 100 : undefined)} />,
    },
];

const MONTHLY_COLUMNS: Column<MonthlyRow>[] = [
    {
        key: "month", label: "Tháng", cellClassName: "font-medium text-foreground",
        render: m => (
            <span className="flex items-center gap-2">
                {m.month}
                {m.month === format(new Date(), "yyyy-MM") && (
                    <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                        đang chạy
                    </span>
                )}
            </span>
        ),
    },
    { key: "orders", label: "Đơn", align: "right", render: m => formatNumber(m.orders) },
    { key: "revenue", label: "DS giao TC", align: "right", render: m => money(m.revenue) },
    { key: "ads_spend", label: "Ads", align: "right", render: m => money(m.ads_spend) },
    { key: "shipping", label: "Phí ship", align: "right", render: m => money(m.shipping) },
    {
        key: "net_profit", label: "Lãi sau ads", align: "right",
        cellClassName: m => cn("font-semibold", profitClass(m.net_profit)),
        render: m => `${m.net_profit >= 0 ? "+" : ""}${money(m.net_profit)}`,
    },
    {
        key: "margin", label: "Biên", align: "right",
        render: m => (m.revenue > 0 ? `${((m.net_profit / m.revenue) * 100).toFixed(1)}%` : DASH),
    },
    {
        key: "light", label: "Đèn", align: "center",
        render: m => <LightEmoji light={lightForAdsPct(m.revenue > 0 ? (m.ads_spend / m.revenue) * 100 : undefined)} />,
    },
];

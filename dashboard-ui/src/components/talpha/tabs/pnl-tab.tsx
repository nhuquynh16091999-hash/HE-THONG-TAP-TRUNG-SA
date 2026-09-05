"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, ComposedChart, Line, ReferenceLine, Cell,
} from "recharts";
import { DollarSign, TrendingUp, TrendingDown, Megaphone, Activity } from "lucide-react";
import TabSkeleton from "@/components/ui/tab-skeleton";
import { BQ_PROJECT, DATASET } from "../constants";
import { formatVNDCompact, shippingVNDFromRevVnd } from "../utils";

const COLORS_MAP = { emerald: "#34d399", rose: "#f43f5e", amber: "#f59e0b", slate: "#94a3b8", indigo: "#818cf8" };

interface Props { dateRange?: { from: Date; to: Date }; projectId?: string }

export default function TALPHAPnLTab({ dateRange }: Props) {
    const [loading, setLoading] = useState(true);
    const [daily, setDaily] = useState<any[]>([]);
    const [summary, setSummary] = useState({ revenue: 0, ads: 0, shipping: 0, profit: 0, margin: 0, orders: 0 });

    useEffect(() => {
        async function fetchData() {
            setLoading(true);
            try {
                const from = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : "2025-01-01";
                const to = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

                // A1: query qua view chuẩn — revenue_vnd đã quy VND, order_date theo tz
                // TKQC (khớp ngày với spend Meta). Shipping vẫn model ở TS (3PL fee table).
                const queries = [
                    // Q0: DS Giao TC theo ngày × market
                    `SELECT
                        order_date as report_date,
                        market,
                        COUNT(DISTINCT order_uid) as orders,
                        ROUND(SUM(revenue_vnd), 0) as revenue_vnd
                    FROM \`${BQ_PROJECT}.${DATASET}.vw_orders_std\`
                    WHERE order_date BETWEEN '${from}' AND '${to}' AND is_confirmed AND marketer_group != 'external'
                    GROUP BY 1, 2 ORDER BY 1 DESC`,

                    // Q1: Daily ads spend (VND)
                    `SELECT
                        date as report_date,
                        ROUND(SUM(spend), 0) as ads_spend
                    FROM \`${BQ_PROJECT}.${DATASET}.vw_fb_ads_std\`
                    WHERE date BETWEEN '${from}' AND '${to}' AND spend > 0
                    GROUP BY 1 ORDER BY 1 DESC`,
                ];

                const results = await Promise.all(
                    queries.map(q =>
                        fetch("/api/query", {
                            method: "POST", headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ query: q })
                        }).then(r => r.json()).catch(() => ({ data: [] }))
                    )
                );

                // Aggregate revenue + shipping per date (revenue đã là VND từ view)
                const revMap = new Map<string, { orders: number; revenue: number; shipping: number }>();
                for (const r of results[0].data || []) {
                    const d = r.report_date?.value || r.report_date || "";
                    const revVnd = r.revenue_vnd || 0;
                    const shipVnd = shippingVNDFromRevVnd(r.market, r.orders || 0, revVnd);
                    const ex = revMap.get(d);
                    if (ex) { ex.orders += r.orders || 0; ex.revenue += revVnd; ex.shipping += shipVnd; }
                    else revMap.set(d, { orders: r.orders || 0, revenue: revVnd, shipping: shipVnd });
                }

                const adsMap = new Map<string, number>();
                for (const r of results[1].data || []) {
                    const d = r.report_date?.value || r.report_date || "";
                    adsMap.set(d, r.ads_spend || 0);
                }

                const allDates = new Set([...revMap.keys(), ...adsMap.keys()]);
                let totalRev = 0, totalAds = 0, totalShip = 0, totalOrders = 0;
                const dailyData = Array.from(allDates).sort().reverse().map(d => {
                    const rev = revMap.get(d)?.revenue || 0;
                    const orders = revMap.get(d)?.orders || 0;
                    const ship = revMap.get(d)?.shipping || 0;
                    const ads = adsMap.get(d) || 0;
                    const profit = rev - ads - ship;
                    totalRev += rev; totalAds += ads; totalShip += ship; totalOrders += orders;
                    return { date: d, orders, revenue: rev, ads, shipping: ship, profit, margin: rev > 0 ? (profit / rev) * 100 : 0 };
                });

                setDaily(dailyData);
                const netProfit = totalRev - totalAds - totalShip;
                setSummary({
                    revenue: totalRev, ads: totalAds, shipping: totalShip, profit: netProfit,
                    margin: totalRev > 0 ? (netProfit / totalRev) * 100 : 0,
                    orders: totalOrders,
                });
            } catch (e) { console.error(e); } finally { setLoading(false); }
        }
        fetchData();
    }, [dateRange]);

    if (loading) return <TabSkeleton />;

    const fmtPct = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(1) + "%";
    const waterfall = [
        { name: "DS Giao TC", value: summary.revenue, fill: COLORS_MAP.emerald },
        { name: "Ads Spend", value: -summary.ads, fill: COLORS_MAP.amber },
        { name: "Shipping", value: -summary.shipping, fill: COLORS_MAP.slate },
        { name: "Lợi nhuận", value: summary.profit, fill: summary.profit > 0 ? COLORS_MAP.emerald : COLORS_MAP.rose },
    ];

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                {[
                    { label: "DS Giao TC (VND)", value: formatVNDCompact(summary.revenue), icon: DollarSign, color: "text-emerald-400" },
                    { label: "Ads + Shipping (VND)", value: formatVNDCompact(summary.ads + summary.shipping), icon: Megaphone, color: "text-amber-400" },
                    { label: "Lợi nhuận (trước COGS)", value: formatVNDCompact(summary.profit), icon: summary.profit >= 0 ? TrendingUp : TrendingDown, color: summary.profit >= 0 ? "text-emerald-400" : "text-rose-400" },
                    { label: "Biên LN", value: fmtPct(summary.margin), icon: Activity, color: summary.margin >= 0 ? "text-emerald-400" : "text-rose-400" },
                    { label: "Đơn hàng", value: summary.orders.toLocaleString("vi-VN"), icon: DollarSign, color: "text-blue-400" },
                ].map((kpi, i) => (
                    <div key={i} className="bg-card border border-border shadow-sm rounded-xl p-4">
                        <div className="flex items-center gap-2 mb-2">
                            <kpi.icon className={`h-4 w-4 ${kpi.color}`} />
                            <span className="text-xs text-muted-foreground">{kpi.label}</span>
                        </div>
                        <div className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</div>
                    </div>
                ))}
            </div>

            <div className="bg-card border border-border shadow-sm rounded-xl p-4">
                <h3 className="text-sm font-semibold text-foreground mb-4">💰 Cấu trúc P&L (VND)</h3>
                <p className="text-xs text-muted-foreground mb-3">Đã trừ Ads + Shipping. Chưa gồm COGS (order_items chưa có giá vốn).</p>
                <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={waterfall}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.25} />
                        <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 12 }} />
                        <YAxis tick={{ fill: "#94a3b8", fontSize: 12 }} tickFormatter={v => formatVNDCompact(v)} />
                        <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))", borderRadius: 8 }}
                            formatter={(v: number) => [formatVNDCompact(Math.abs(v)), ""]} />
                        <ReferenceLine y={0} stroke="#94a3b8" />
                        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                            {waterfall.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>

            <div className="bg-card border border-border shadow-sm rounded-xl p-4">
                <h3 className="text-sm font-semibold text-foreground mb-4">📊 P&L theo ngày (VND)</h3>
                <ResponsiveContainer width="100%" height={250}>
                    <ComposedChart data={[...daily].reverse()}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.25} />
                        <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                        <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={v => formatVNDCompact(v)} />
                        <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))", borderRadius: 8 }}
                            formatter={(v: number) => [formatVNDCompact(v), ""]} />
                        <Bar dataKey="revenue" name="DS Giao TC" fill="#34d399" radius={[2, 2, 0, 0]} />
                        <Bar dataKey="ads" name="Ads" fill="#f59e0b" radius={[2, 2, 0, 0]} />
                        <Line dataKey="profit" name="Lợi nhuận" stroke="#818cf8" strokeWidth={2} dot={false} />
                    </ComposedChart>
                </ResponsiveContainer>
            </div>

            <div className="bg-card border border-border shadow-sm rounded-xl p-4">
                <h3 className="text-sm font-semibold text-foreground mb-4">📋 Chi tiết ({daily.length} ngày)</h3>
                <div className="overflow-auto max-h-[400px]">
                    <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-card">
                            <tr className="text-muted-foreground text-xs border-b border-border">
                                <th className="text-left py-2 pl-2">Ngày</th>
                                <th className="text-right py-2">Đơn</th>
                                <th className="text-right py-2">DS Giao TC (VND)</th>
                                <th className="text-right py-2">Ads (VND)</th>
                                <th className="text-right py-2">LN</th>
                                <th className="text-right py-2 pr-2">Biên</th>
                            </tr>
                        </thead>
                        <tbody>
                            {daily.map((d, i) => (
                                <tr key={i} className="border-b border-border/60 hover:bg-muted/50">
                                    <td className="py-2 pl-2 text-foreground font-mono text-xs">{d.date}</td>
                                    <td className="py-2 text-right text-blue-400 font-mono">{d.orders}</td>
                                    <td className="py-2 text-right text-emerald-400 font-mono">{formatVNDCompact(d.revenue)}</td>
                                    <td className="py-2 text-right text-amber-400 font-mono">{formatVNDCompact(d.ads)}</td>
                                    <td className={`py-2 text-right font-mono ${d.profit >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{formatVNDCompact(d.profit)}</td>
                                    <td className={`py-2 text-right pr-2 font-mono text-xs ${d.margin >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{fmtPct(d.margin)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

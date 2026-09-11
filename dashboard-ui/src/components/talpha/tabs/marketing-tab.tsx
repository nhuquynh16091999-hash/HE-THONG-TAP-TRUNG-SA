"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer,
} from "recharts";
import { TrendingUp, DollarSign, Users, MessageCircle } from "lucide-react";
import TabSkeleton from "@/components/ui/tab-skeleton";
import { BQ_PROJECT, DATASET } from "../constants";
import { formatVNDCompact } from "../utils";

interface Props { dateRange?: { from: Date; to: Date }; projectId?: string }

export default function TALPHAMarketingTab({ dateRange }: Props) {
    const [loading, setLoading] = useState(true);
    const [marketers, setMarketers] = useState<any[]>([]);
    const [unassigned, setUnassigned] = useState<{ orders: number; revenue_vnd: number } | null>(null);
    const [accounts, setAccounts] = useState<any[]>([]);
    const [summary, setSummary] = useState({ spend: 0, messages: 0, impressions: 0, cpm: 0 });
    // KPI tháng đang chạy: {display name → VND target} + doanh số GTC tháng này của từng người
    const [kpiRows, setKpiRows] = useState<{ name: string; target: number; actual: number }[]>([]);

    useEffect(() => {
        async function fetchData() {
            setLoading(true);
            try {
                const from = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : "2025-01-01";
                const to = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

                // A1: query qua view chuẩn — vw_fb_ads_std (spend VND).
                // X7: bảng marketer KHÔNG query thẳng nữa — `vw_orders_std.marketer_name`
                // là tag POS thô (1 người ra nhiều dòng, người ngoài team lọt vào). Gán
                // marketer là rule CEO 3 bậc → làm server-side ở /api/talpha/marketer-perf.
                const queries = [
                    // Q0: Account breakdown (spend VND)
                    `SELECT
                        account_name,
                        ROUND(SUM(spend), 0) as spend,
                        SUM(messages) as messages,
                        SUM(impressions) as impressions,
                        SUM(clicks) as clicks,
                        COUNT(DISTINCT campaign_id) as campaigns
                    FROM \`${BQ_PROJECT}.${DATASET}.vw_fb_ads_std\`
                    WHERE date BETWEEN '${from}' AND '${to}' AND spend > 0
                    GROUP BY 1 ORDER BY spend DESC`,

                    // Q1: Total (spend VND)
                    `SELECT
                        ROUND(SUM(spend), 0) as spend,
                        SUM(messages) as messages,
                        SUM(impressions) as impressions
                    FROM \`${BQ_PROJECT}.${DATASET}.vw_fb_ads_std\`
                    WHERE date BETWEEN '${from}' AND '${to}' AND spend > 0`,
                ];

                const now = new Date();
                const monthKey = format(now, "yyyy-MM");
                const monthStart = `${monthKey}-01`;
                const today = format(now, "yyyy-MM-dd");

                const [results, perf, targetsRes, monthPerf] = await Promise.all([
                    Promise.all(
                        queries.map(q =>
                            fetch("/api/query", {
                                method: "POST", headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ query: q })
                            }).then(r => r.json()).catch(() => ({ data: [] }))
                        )
                    ),
                    fetch(`/api/talpha/marketer-perf?from=${from}&to=${to}`)
                        .then(r => r.json()).catch(() => ({ rows: [] })),
                    fetch("/api/talpha/targets").then(r => r.json()).catch(() => ({})),
                    // Doanh số GTC từ đầu tháng tới hôm nay — mẫu số của thanh KPI
                    fetch(`/api/talpha/marketer-perf?from=${monthStart}&to=${today}`)
                        .then(r => r.json()).catch(() => ({ rows: [] })),
                ]);

                // Ghép KPI tháng: chỉ người CÓ khoá KPI tháng này mới có thanh
                const perTargets: Record<string, Record<string, number>> =
                    targetsRes?.marketer_monthly_ship_vnd || {};
                const monthActual = new Map<string, number>(
                    (monthPerf.rows || []).map((r: any) => [r.marketer, r.revenue_vnd || 0]));
                setKpiRows(
                    Object.entries(perTargets)
                        .filter(([, months]) => months[monthKey] > 0)
                        .map(([name, months]) => ({
                            name, target: months[monthKey],
                            actual: monthActual.get(name) || 0,
                        }))
                        .sort((a, b) => b.target - a.target),
                );

                // Bảng marketer đã gán theo rule 3 bậc từ server — client chỉ hiển thị.
                setMarketers((perf.rows || []).map((r: any) => ({
                    marketer: r.marketer, orders: r.orders, revenue: r.revenue_vnd,
                    viaTag: r.via_tag, viaAdId: r.via_ad_id, inactive: r.inactive, spend: r.spend_vnd,
                })));
                setUnassigned(perf.unassigned || null);

                setAccounts((results[0].data || []).map((r: any) => ({
                    account_id: r.account_name || "Unknown",
                    spend: r.spend || 0, messages: r.messages || 0,
                    impressions: r.impressions || 0, clicks: r.clicks || 0, campaigns: r.campaigns || 0,
                })));

                const s = results[1].data?.[0] || {};
                setSummary({
                    spend: s.spend || 0, messages: s.messages || 0,
                    impressions: s.impressions || 0,
                    cpm: s.impressions > 0 ? (s.spend / s.impressions) * 1000 : 0,
                });
            } catch (e) { console.error(e); } finally { setLoading(false); }
        }
        fetchData();
    }, [dateRange]);

    if (loading) return <TabSkeleton />;

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                    { label: "Chi phí Ads (VND)", value: formatVNDCompact(summary.spend), icon: DollarSign, color: "text-amber-600 dark:text-amber-400" },
                    { label: "Messages", value: summary.messages.toLocaleString("vi-VN"), icon: MessageCircle, color: "text-blue-600 dark:text-blue-400" },
                    { label: "Impressions", value: summary.impressions.toLocaleString("vi-VN"), icon: Users, color: "text-purple-600 dark:text-purple-400" },
                    { label: "CPM (VND)", value: formatVNDCompact(summary.cpm), icon: TrendingUp, color: "text-cyan-600 dark:text-cyan-400" },
                ].map((kpi, i) => (
                    <div key={i} className="bg-card border border-border rounded-xl p-4 shadow-sm">
                        <div className="flex items-center gap-2 mb-2">
                            <kpi.icon className={`h-4 w-4 ${kpi.color}`} />
                            <span className="text-xs text-muted-foreground">{kpi.label}</span>
                        </div>
                        <div className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</div>
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
                    {kpiRows.length > 0 && (
                        <div className="mb-5">
                            <h3 className="text-sm font-semibold text-foreground">
                                🎯 KPI tháng {format(new Date(), "M/yyyy")} — từng người
                            </h3>
                            <p className="mb-3 mt-0.5 text-[11px] leading-snug text-muted-foreground">
                                KPI từ bảng &ldquo;KPI Q3-Q4&rdquo; CEO chốt, đo trên <strong>doanh số ship</strong>;
                                thanh dưới đo <strong>đơn đã giao xong</strong> nên giữa tháng luôn ngắn hơn thực tế.
                                S.Anh không có KPI trong bảng.
                            </p>
                            <div className="space-y-2">
                                {kpiRows.map(r => {
                                    const pct = Math.min(100, Math.round((r.actual / r.target) * 100));
                                    return (
                                        <div key={r.name}>
                                            <div className="mb-0.5 flex items-baseline justify-between text-xs">
                                                <span className="font-medium text-foreground">{r.name}</span>
                                                <span className="tabular-nums text-muted-foreground">
                                                    {formatVNDCompact(r.actual)} / {formatVNDCompact(r.target)}
                                                    <span className="ml-1.5 font-semibold text-amber-600 dark:text-amber-400">{pct}%</span>
                                                </span>
                                            </div>
                                            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                                                <div className="h-full rounded-full bg-gradient-to-r from-orange-400 to-amber-500"
                                                    style={{ width: `${pct}%` }} />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                    <h3 className="text-sm font-semibold text-foreground mb-4">👤 Hiệu suất Marketer (DS Giao TC, VND)</h3>
                    <div className="overflow-auto max-h-[400px]">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-muted-foreground text-xs border-b border-border">
                                    <th className="text-left py-2 pl-2 font-medium">#</th>
                                    <th className="text-left py-2 font-medium">Marketer</th>
                                    <th className="text-right py-2 font-medium">Đơn</th>
                                    <th className="text-right py-2 pr-2 font-medium">DS Giao TC (VND)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {marketers.map((m: any, i: number) => (
                                    <tr key={i} className="border-b border-border/60 hover:bg-muted/50">
                                        <td className="py-2 pl-2 text-muted-foreground">{i + 1}</td>
                                        <td className="py-2 text-foreground font-medium">
                                            {m.marketer}
                                            {m.spend > 0 && (
                                                <span className="ml-1 text-xs text-amber-600 dark:text-amber-400">
                                                    · {formatVNDCompact(m.spend)} ads
                                                </span>
                                            )}
                                            {m.inactive && <span className="ml-1 text-xs text-muted-foreground">(NV cũ)</span>}
                                            {m.viaAdId > 0 && (
                                                <span className="ml-1 text-xs text-muted-foreground"
                                                    title="Đơn không có tag POS, gán theo chủ campaign của ad_id">
                                                    · {m.viaAdId} đơn theo ad_id
                                                </span>
                                            )}
                                        </td>
                                        <td className="py-2 text-right text-blue-600 dark:text-blue-400 font-mono">{m.orders}</td>
                                        <td className="py-2 text-right pr-2 text-emerald-600 dark:text-emerald-400 font-mono">{formatVNDCompact(m.revenue)}</td>
                                    </tr>
                                ))}
                                {unassigned && unassigned.orders > 0 && (
                                    <tr className="border-b border-border/60 text-muted-foreground">
                                        <td className="py-2 pl-2">—</td>
                                        <td className="py-2 italic">(không gán)</td>
                                        <td className="py-2 text-right font-mono">{unassigned.orders}</td>
                                        <td className="py-2 text-right pr-2 font-mono">{formatVNDCompact(unassigned.revenue_vnd)}</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
                    <h3 className="text-sm font-semibold text-foreground mb-4">📊 Tài khoản quảng cáo (VND)</h3>
                    <ResponsiveContainer width="100%" height={200}>
                        <BarChart data={accounts} layout="vertical">
                            <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.25} />
                            <XAxis type="number" tick={{ fill: "#64748b", fontSize: 11 }} tickFormatter={v => formatVNDCompact(v)} />
                            <YAxis type="category" dataKey="account_id" tick={{ fill: "#64748b", fontSize: 10 }} width={140} />
                            <Tooltip cursor={{ fill: "rgba(148,163,184,0.15)" }}
                                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))" }}
                                formatter={(v: number) => [formatVNDCompact(v), ""]} />
                            <Bar dataKey="spend" name="Spend (VND)" fill="#f59e0b" radius={[0, 4, 4, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                    <div className="mt-4 space-y-2">
                        {accounts.map((a: any, i: number) => (
                            <div key={i} className="flex items-center justify-between text-xs text-muted-foreground border-b border-border/40 pb-1">
                                <span className="font-medium text-foreground">{a.account_id}</span>
                                <div className="flex gap-4">
                                    <span>{a.campaigns} campaigns</span>
                                    <span>{a.messages.toLocaleString("vi-VN")} msgs</span>
                                    <span className="text-amber-600 dark:text-amber-400 font-mono">{formatVNDCompact(a.spend)}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

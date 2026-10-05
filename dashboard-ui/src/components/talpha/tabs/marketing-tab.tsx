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

// Một dòng của file TỔNG TEAM (/api/talpha/sheet-report?from&to) — cùng số với tab Tổng quan.
type So = { ads: number; mess: number; don: number; doanh_so: number; ds_giao_tc: number };
type Nguoi = So & { tab: string; display: string };

interface Props { dateRange?: { from: Date; to: Date }; projectId?: string }

export default function TALPHAMarketingTab({ dateRange }: Props) {
    const [loading, setLoading] = useState(true);
    const [marketers, setMarketers] = useState<Nguoi[]>([]);
    const [unassigned, setUnassigned] = useState<So | null>(null);
    const [loiSheet, setLoiSheet] = useState<string | null>(null);
    // Xem theo team (phân quyền 05/10/2026): tab người trong Sheet gộp MỌI nước của người đó,
    // nên bảng từng người lấy từ /api/talpha/marketer-perf — BigQuery, đã lọc theo nước.
    const [theoTeam, setTheoTeam] = useState(false);
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

                // A1: query qua view chuẩn — vw_fb_ads_std (spend VND) cho phần số Meta.
                // Bảng từng người + KPI đọc file TỔNG TEAM (Sỹ Anh chốt 28/09/2026) — trước đó đọc
                // /api/talpha/marketer-perf: doanh thu chỉ đơn ĐÃ GIAO XONG, gán người theo ad_id,
                // nên số từng người lệch Sheet và tab Tổng quan.
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

                const docSheet = (f: string, t: string) =>
                    fetch(`/api/talpha/sheet-report?from=${f}&to=${t}`)
                        .then(async r => {
                            const d = await r.json();
                            if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`);
                            return d;
                        });
                const [results, perf, targetsRes, monthPerf] = await Promise.all([
                    Promise.all(
                        queries.map(q =>
                            fetch("/api/query", {
                                method: "POST", headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ query: q })
                            }).then(r => r.json()).catch(() => ({ data: [] }))
                        )
                    ),
                    docSheet(from, to).catch((e: Error) => ({ error: e.message })),
                    fetch("/api/talpha/targets").then(r => r.json()).catch(() => ({})),
                    // Doanh số tháng này tới hôm nay (từ mốc gốc nếu mốc rơi vào tháng này) — tử số thanh KPI.
                    docSheet(monthStart, today).catch(() => ({ marketers: [] })),
                ]);

                // Ghép KPI tháng: chỉ người CÓ khoá KPI tháng này mới có thanh
                const perTargets: Record<string, Record<string, number>> =
                    targetsRes?.marketer_monthly_ship_vnd || {};
                const monthActual = new Map<string, number>(
                    (monthPerf.marketers || []).map((r: Nguoi) => [r.display, r.doanh_so || 0]));
                setKpiRows(
                    Object.entries(perTargets)
                        .filter(([, months]) => months[monthKey] > 0)
                        .map(([name, months]) => ({
                            name, target: months[monthKey],
                            actual: monthActual.get(name) || 0,
                        }))
                        .sort((a, b) => b.target - a.target),
                );

                // Bảng từng người = các tab người của file TỔNG TEAM.
                setLoiSheet(perf.error || null);
                setMarketers(perf.marketers || []);
                setUnassigned(perf.unassigned || null);
                setTheoTeam(!!perf.scoped);
                if (perf.scoped) {
                    // ads/tin theo chủ campaign của nước team; đơn & doanh số = đơn đã đẩy đi của shop
                    // nước đó (ship_*), DS giao TC = phần đã giao xong.
                    const mp = await fetch(`/api/talpha/marketer-perf?from=${from}&to=${to}`)
                        .then(r => r.json()).catch(() => null);
                    type PerfRow = { key: string; marketer: string; spend_vnd: number; messages: number; orders: number; revenue_vnd: number; ship_orders: number; ship_revenue_vnd: number };
                    setMarketers(((mp?.rows || []) as PerfRow[])
                        .filter(r => r.spend_vnd > 0 || r.ship_orders > 0)
                        .map(r => ({
                            tab: r.key, display: r.marketer,
                            ads: r.spend_vnd, mess: r.messages, don: r.ship_orders,
                            doanh_so: r.ship_revenue_vnd, ds_giao_tc: r.revenue_vnd,
                        }))
                        .sort((a, b) => b.doanh_so - a.doanh_so || b.ads - a.ads));
                    setUnassigned(null);
                    if (!mp?.rows) setLoiSheet(mp?.error || "không đọc được số từng người");
                }

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
                                thanh dưới đo <strong>doanh số đơn đã chốt</strong> trong file TỔNG TEAM (tính từ mốc gốc báo cáo).
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
                    <h3 className="text-sm font-semibold text-foreground">👤 Hiệu suất Marketer</h3>
                    <p className="mb-3 mt-0.5 text-[11px] leading-snug text-muted-foreground">
                        {theoTeam
                            ? <>Chỉ số trong team: tiền ads theo campaign của nước team, đơn theo shop nước đó (số BigQuery — có thể lệch Sheet vài đơn,
                                vì tab từng người trong Sheet gộp mọi nước nên không dùng được). DS giao TC là phần đã giao xong.</>
                            : <>Tab của từng người trong file TỔNG TEAM — cùng số với tab Tổng quan và bot Zalo. Doanh số là đơn đã chốt;
                                DS giao TC là phần đã giao xong.</>}
                    </p>
                    {loiSheet && <p className="mb-2 text-xs text-rose-600 dark:text-rose-400">Không đọc được {theoTeam ? "số từng người" : "file TỔNG TEAM"}: {loiSheet}</p>}
                    <div className="overflow-auto max-h-[400px]">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-muted-foreground text-xs border-b border-border">
                                    <th className="text-left py-2 pl-2 font-medium">#</th>
                                    <th className="text-left py-2 font-medium">Marketer</th>
                                    <th className="text-right py-2 font-medium">Tiền ads</th>
                                    <th className="text-right py-2 font-medium">Đơn</th>
                                    <th className="text-right py-2 font-medium">Doanh số</th>
                                    <th className="text-right py-2 font-medium">% Ads/DT</th>
                                    <th className="text-right py-2 pr-2 font-medium">DS giao TC</th>
                                </tr>
                            </thead>
                            <tbody>
                                {marketers.map((m, i) => (
                                    <tr key={m.tab} className="border-b border-border/60 hover:bg-muted/50">
                                        <td className="py-2 pl-2 text-muted-foreground">{i + 1}</td>
                                        <td className="py-2 text-foreground font-medium">
                                            {m.display}
                                            {m.mess > 0 && <span className="ml-1 text-xs text-muted-foreground">· {m.mess.toLocaleString("vi-VN")} tin</span>}
                                        </td>
                                        <td className="py-2 text-right text-amber-600 dark:text-amber-400 font-mono">{m.ads > 0 ? formatVNDCompact(m.ads) : "—"}</td>
                                        <td className="py-2 text-right text-blue-600 dark:text-blue-400 font-mono">{m.don}</td>
                                        <td className="py-2 text-right text-emerald-600 dark:text-emerald-400 font-mono">{formatVNDCompact(m.doanh_so)}</td>
                                        <td className="py-2 text-right font-mono text-muted-foreground">{m.doanh_so > 0 && m.ads > 0 ? `${((m.ads / m.doanh_so) * 100).toFixed(1)}%` : "—"}</td>
                                        <td className="py-2 text-right pr-2 font-mono text-muted-foreground">{m.ds_giao_tc > 0 ? formatVNDCompact(m.ds_giao_tc) : "—"}</td>
                                    </tr>
                                ))}
                                {unassigned && (unassigned.don > 0 || unassigned.ads > 0) && (
                                    <tr className="border-b border-border/60 text-muted-foreground">
                                        <td className="py-2 pl-2">—</td>
                                        <td className="py-2 italic" title="Không nằm trong TỔNG của Sheet">(không gán)</td>
                                        <td className="py-2 text-right font-mono">{unassigned.ads > 0 ? formatVNDCompact(unassigned.ads) : "—"}</td>
                                        <td className="py-2 text-right font-mono">{unassigned.don}</td>
                                        <td className="py-2 text-right font-mono">{formatVNDCompact(unassigned.doanh_so)}</td>
                                        <td className="py-2 text-right font-mono">—</td>
                                        <td className="py-2 text-right pr-2 font-mono">{unassigned.ds_giao_tc > 0 ? formatVNDCompact(unassigned.ds_giao_tc) : "—"}</td>
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
                            <CartesianGrid strokeDasharray="3 3" stroke="#B1AEA0" strokeOpacity={0.25} />
                            <XAxis type="number" tick={{ fill: "#8A8675", fontSize: 11 }} tickFormatter={v => formatVNDCompact(v)} />
                            <YAxis type="category" dataKey="account_id" tick={{ fill: "#8A8675", fontSize: 10 }} width={140} />
                            <Tooltip cursor={{ fill: "rgba(148,163,184,0.15)" }}
                                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))" }}
                                formatter={(v: number) => [formatVNDCompact(v), ""]} />
                            <Bar dataKey="spend" name="Spend (VND)" fill="#FF7312" radius={[0, 4, 4, 0]} />
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

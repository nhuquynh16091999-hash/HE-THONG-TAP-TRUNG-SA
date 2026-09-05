"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts";
import { Users, Repeat, ShoppingCart, Crown, Heart } from "lucide-react";
import TabSkeleton from "@/components/ui/tab-skeleton";
import { BQ_PROJECT, DATASET } from "../constants";
import { formatVNDCompact, marketName } from "../utils";

const PIE_COLORS = ["#6366f1", "#34d399", "#fbbf24", "#f43f5e", "#a78bfa", "#67e8f9"];

interface Props { dateRange?: { from: Date; to: Date }; projectId?: string }

function customerTier(orders: number): { label: string; cls: string } {
    if (orders >= 6) return { label: "👑 VIP", cls: "text-amber-400" };
    if (orders >= 3) return { label: "💎 Loyal", cls: "text-purple-400" };
    if (orders >= 2) return { label: "🔁 Repeat", cls: "text-blue-400" };
    return { label: "🆕 New", cls: "text-muted-foreground" };
}

export default function TALPHACustomerTab({ dateRange }: Props) {
    const [loading, setLoading] = useState(true);
    const [kpis, setKpis] = useState({ unique: 0, totalOrders: 0, avgPerCust: 0, repeatRate: 0, avgRev: 0 });
    const [segments, setSegments] = useState<any[]>([]);
    const [topCustomers, setTopCustomers] = useState<any[]>([]);
    const [shopCustomers, setShopCustomers] = useState<any[]>([]);

    useEffect(() => {
        async function fetchData() {
            setLoading(true);
            try {
                const from = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : "2025-01-01";
                const to = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

                // A1: tiền/ngày/trạng thái lấy từ view chuẩn vw_orders_std (revenue_vnd,
                // order_date theo tz TKQC, is_confirmed). View không có cột danh tính
                // khách → JOIN sale_order theo order_id chỉ để lấy phone/tên.
                // ⚠️ sale_order có dòng trùng id (lỗi sync) → phải gom về 1 dòng/id
                // TRƯỚC khi JOIN, nếu không doanh thu bị nhân đôi.
                const CUSTOMER_SRC = `(
                    SELECT id,
                           ANY_VALUE(bill_phone_number) AS bill_phone_number,
                           ANY_VALUE(bill_full_name)    AS bill_full_name
                    FROM \`${BQ_PROJECT}.${DATASET}.sale_order\`
                    GROUP BY id
                )`;

                const queries = [
                    // Q0: KPIs by market — DS Giao TC
                    `SELECT
                        v.market,
                        COUNT(DISTINCT NULLIF(o.bill_phone_number,'')) as unique_customers,
                        COUNT(DISTINCT v.order_id) as total_orders,
                        ROUND(SUM(v.revenue_vnd), 0) as total_revenue_vnd
                    FROM \`${BQ_PROJECT}.${DATASET}.vw_orders_std\` v
                    JOIN ${CUSTOMER_SRC} o ON o.id = v.order_id
                    WHERE v.order_date BETWEEN '${from}' AND '${to}' AND v.is_confirmed
                      AND o.bill_phone_number IS NOT NULL AND o.bill_phone_number != ''
                    GROUP BY 1`,

                    // Q1: Segments
                    `SELECT
                        CASE
                            WHEN order_count = 1 THEN '1 đơn (New)'
                            WHEN order_count = 2 THEN '2 đơn (Repeat)'
                            WHEN order_count BETWEEN 3 AND 5 THEN '3-5 đơn (Loyal)'
                            ELSE '6+ đơn (VIP)'
                        END as segment,
                        SUM(cnt) as customers
                    FROM (
                        SELECT o.bill_phone_number, COUNT(DISTINCT v.order_id) as order_count, 1 as cnt
                        FROM \`${BQ_PROJECT}.${DATASET}.vw_orders_std\` v
                        JOIN ${CUSTOMER_SRC} o ON o.id = v.order_id
                        WHERE v.order_date BETWEEN '${from}' AND '${to}' AND v.is_confirmed
                          AND o.bill_phone_number IS NOT NULL AND o.bill_phone_number != ''
                        GROUP BY 1
                    ) GROUP BY 1 ORDER BY MIN(order_count)`,

                    // Q2: Top customers — DS Giao TC đã quy VND từ view
                    `SELECT
                        o.bill_full_name as name,
                        o.bill_phone_number as phone,
                        STRING_AGG(DISTINCT v.market, ', ') as shops,
                        COUNT(DISTINCT v.order_id) as orders,
                        ROUND(SUM(v.revenue_vnd), 0) as revenue_vnd,
                        MIN(v.order_date) as first_order,
                        MAX(v.order_date) as last_order
                    FROM \`${BQ_PROJECT}.${DATASET}.vw_orders_std\` v
                    JOIN ${CUSTOMER_SRC} o ON o.id = v.order_id
                    WHERE v.order_date BETWEEN '${from}' AND '${to}' AND v.is_confirmed
                      AND o.bill_phone_number IS NOT NULL AND o.bill_phone_number != ''
                    GROUP BY 1, 2 ORDER BY revenue_vnd DESC LIMIT 25`,

                    // Q3: Customers by market — DS Giao TC
                    `SELECT
                        v.market,
                        COUNT(DISTINCT NULLIF(o.bill_phone_number,'')) as customers,
                        COUNT(DISTINCT v.order_id) as orders,
                        ROUND(SUM(v.revenue_vnd), 0) as revenue_vnd
                    FROM \`${BQ_PROJECT}.${DATASET}.vw_orders_std\` v
                    JOIN ${CUSTOMER_SRC} o ON o.id = v.order_id
                    WHERE v.order_date BETWEEN '${from}' AND '${to}' AND v.is_confirmed
                    GROUP BY 1 ORDER BY revenue_vnd DESC`,
                ];

                const results = await Promise.all(
                    queries.map(q =>
                        fetch("/api/query", {
                            method: "POST", headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ query: q })
                        }).then(r => r.json()).catch(() => ({ data: [] }))
                    )
                );

                // Aggregate KPIs (revenue đã là VND từ view)
                let totalUniq = 0, totalOrd = 0, totalRevVnd = 0;
                for (const r of results[0].data || []) {
                    totalUniq += r.unique_customers || 0;
                    totalOrd += r.total_orders || 0;
                    totalRevVnd += r.total_revenue_vnd || 0;
                }

                const segData = results[1].data || [];
                const newCust = segData.find((s: any) => s.segment?.includes("New"))?.customers || 0;
                const repeatCust = totalUniq - newCust;

                setKpis({
                    unique: totalUniq, totalOrders: totalOrd,
                    avgPerCust: totalUniq > 0 ? totalOrd / totalUniq : 0,
                    repeatRate: totalUniq > 0 ? (repeatCust / totalUniq) * 100 : 0,
                    avgRev: totalUniq > 0 ? totalRevVnd / totalUniq : 0,
                });
                setSegments(segData);

                // Top customers — revenue đã quy VND đúng theo từng đơn trong view
                setTopCustomers((results[2].data || []).map((c: any) => ({
                    ...c, revenue: c.revenue_vnd || 0,
                })));

                setShopCustomers((results[3].data || []).map((r: any) => ({
                    shop_name: marketName(r.market), customers: r.customers || 0,
                    orders: r.orders || 0, revenue: r.revenue_vnd || 0,
                })));
            } catch (e) { console.error(e); } finally { setLoading(false); }
        }
        fetchData();
    }, [dateRange]);

    if (loading) return <TabSkeleton />;

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                {[
                    { label: "KH duy nhất", value: kpis.unique.toLocaleString("vi-VN"), icon: Users, color: "text-blue-400" },
                    { label: "Tổng đơn", value: kpis.totalOrders.toLocaleString("vi-VN"), icon: ShoppingCart, color: "text-emerald-400" },
                    { label: "Đơn/KH", value: kpis.avgPerCust.toFixed(1), icon: Repeat, color: "text-purple-400" },
                    { label: "Tỷ lệ quay lại", value: kpis.repeatRate.toFixed(1) + "%", icon: Heart, color: kpis.repeatRate > 20 ? "text-emerald-400" : "text-amber-400" },
                    { label: "DS Giao TC/KH (VND)", value: formatVNDCompact(kpis.avgRev), icon: Crown, color: "text-cyan-400" },
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

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-card border border-border shadow-sm rounded-xl p-4">
                    <h3 className="text-sm font-semibold text-foreground mb-4">👥 Phân khúc khách hàng</h3>
                    <div className="flex items-center">
                        <ResponsiveContainer width="50%" height={200}>
                            <PieChart>
                                <Pie data={segments} dataKey="customers" nameKey="segment" cx="50%" cy="50%"
                                    outerRadius={75} label={({ percent }: any) => `${(percent * 100).toFixed(0)}%`}>
                                    {segments.map((_: any, i: number) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                                </Pie>
                                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))", borderRadius: 8 }} />
                            </PieChart>
                        </ResponsiveContainer>
                        <div className="w-1/2 space-y-2">
                            {segments.map((s: any, i: number) => (
                                <div key={i} className="flex items-center justify-between text-sm">
                                    <div className="flex items-center gap-2">
                                        <div className="w-3 h-3 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                                        <span className="text-foreground">{s.segment}</span>
                                    </div>
                                    <span className="text-foreground font-mono">{s.customers}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="bg-card border border-border shadow-sm rounded-xl p-4">
                    <h3 className="text-sm font-semibold text-foreground mb-4">🌍 KH theo thị trường</h3>
                    <ResponsiveContainer width="100%" height={200}>
                        <BarChart data={shopCustomers}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.25} />
                            <XAxis dataKey="shop_name" tick={{ fill: "#94a3b8", fontSize: 12 }} />
                            <YAxis tick={{ fill: "#94a3b8", fontSize: 12 }} />
                            <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))", borderRadius: 8 }} />
                            <Bar dataKey="customers" name="Khách hàng" fill="#6366f1" radius={[4, 4, 0, 0]} />
                            <Bar dataKey="orders" name="Đơn hàng" fill="#34d399" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                    <p className="text-xs text-slate-600 italic mt-2">🇶🇦 Qatar • 🇧🇭 Bahrain — sẵn sàng khi có data</p>
                </div>
            </div>

            <div className="bg-card border border-border shadow-sm rounded-xl p-4">
                <h3 className="text-sm font-semibold text-foreground mb-4">👑 Top Khách hàng ({topCustomers.length})</h3>
                <div className="overflow-auto max-h-[400px]">
                    <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-card">
                            <tr className="text-muted-foreground text-xs border-b border-border">
                                <th className="text-left py-2 pl-2">#</th>
                                <th className="text-left py-2">Tên</th>
                                <th className="text-left py-2">SĐT</th>
                                <th className="text-left py-2">TT</th>
                                <th className="text-right py-2">Đơn</th>
                                <th className="text-right py-2">DS Giao TC (VND)</th>
                                <th className="text-right py-2 pr-2">Hạng</th>
                            </tr>
                        </thead>
                        <tbody>
                            {topCustomers.map((c: any, i: number) => {
                                const tier = customerTier(c.orders);
                                return (
                                    <tr key={i} className="border-b border-border/60 hover:bg-muted/50">
                                        <td className="py-2 pl-2 text-muted-foreground">{i + 1}</td>
                                        <td className="py-2 text-foreground font-medium">{c.name || "—"}</td>
                                        <td className="py-2 text-muted-foreground font-mono text-xs">{c.phone || "—"}</td>
                                        <td className="py-2 text-xs text-muted-foreground">{c.shops || "—"}</td>
                                        <td className="py-2 text-right text-blue-400 font-mono">{c.orders}</td>
                                        <td className="py-2 text-right text-emerald-400 font-mono">{formatVNDCompact(c.revenue || 0)}</td>
                                        <td className={`py-2 text-right pr-2 text-xs ${tier.cls}`}>{tier.label}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

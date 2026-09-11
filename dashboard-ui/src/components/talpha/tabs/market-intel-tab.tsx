"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts";
import { MapPin } from "lucide-react";
import TabSkeleton from "@/components/ui/tab-skeleton";
import { BQ_PROJECT, DATASET } from "../constants";
import { formatVNDCompact, marketName } from "../utils";

const PIE_COLORS = ["#34d399", "#3b82f6", "#f59e0b", "#a855f7", "#ec4899", "#06b6d4"];

interface Props { dateRange?: { from: Date; to: Date }; projectId?: string }

function marketVerdict(rev: number, total: number): { label: string; cls: string } {
    const share = total > 0 ? (rev / total) * 100 : 0;
    if (share >= 30) return { label: "🔥 Chủ lực", cls: "text-emerald-400" };
    if (share >= 15) return { label: "✅ Mạnh", cls: "text-blue-400" };
    if (share >= 5) return { label: "📈 Tiềm năng", cls: "text-amber-400" };
    return { label: "🌱 Mới", cls: "text-muted-foreground" };
}

export default function TALPHAMarketIntelTab({ dateRange }: Props) {
    const [loading, setLoading] = useState(true);
    const [markets, setMarkets] = useState<any[]>([]);
    const [marketProducts, setMarketProducts] = useState<any[]>([]);
    const [selectedMarket, setSelectedMarket] = useState("all");

    useEffect(() => {
        async function fetchData() {
            setLoading(true);
            try {
                const from = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : "2025-01-01";
                const to = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

                // A1: tiền/ngày/trạng thái từ view chuẩn vw_orders_std. Q0 JOIN sale_order
                // chỉ để đếm khách (bill_phone_number — view không có cột danh tính).
                // ⚠️ sale_order có dòng trùng id (lỗi sync) → gom về 1 dòng/id trước khi
                // JOIN, nếu không doanh thu bị nhân đôi.
                const PHONE_SRC = `(
                    SELECT id, ANY_VALUE(bill_phone_number) AS bill_phone_number
                    FROM \`${BQ_PROJECT}.${DATASET}.sale_order\`
                    GROUP BY id
                )`;

                const queries = [
                    // Q0: Markets — DS Giao TC (VND từ view)
                    `SELECT
                        v.market,
                        COUNT(DISTINCT v.order_id) as orders,
                        ROUND(SUM(v.revenue_vnd), 0) as revenue_vnd,
                        ROUND(AVG(v.revenue_vnd), 0) as avg_order_vnd,
                        COUNT(DISTINCT NULLIF(o.bill_phone_number,'')) as customers
                    FROM \`${BQ_PROJECT}.${DATASET}.vw_orders_std\` v
                    JOIN ${PHONE_SRC} o ON o.id = v.order_id
                    WHERE v.order_date BETWEEN '${from}' AND '${to}' AND v.is_confirmed
                    GROUP BY 1 ORDER BY revenue_vnd DESC`,

                    // Q1: Top SP theo market — phân bổ revenue_vnd của view theo quantity item.
                    // ⚠️ KHÔNG dùng oi.retail_price (0 ở gần như toàn bộ dòng) và KHÔNG dùng
                    // oi.shop_name (rỗng toàn bộ) — lấy market từ view.
                    `WITH item_rev AS (
                        SELECT
                            v.market,
                            oi.product_name,
                            oi.quantity,
                            v.revenue_vnd * SAFE_DIVIDE(
                                oi.quantity,
                                SUM(oi.quantity) OVER (PARTITION BY oi.order_id)
                            ) AS revenue_vnd
                        FROM \`${BQ_PROJECT}.${DATASET}.order_items\` oi
                        JOIN \`${BQ_PROJECT}.${DATASET}.vw_orders_std\` v ON oi.order_id = CAST(v.order_id AS STRING)
                        WHERE v.order_date BETWEEN '${from}' AND '${to}'
                          AND v.is_confirmed AND oi.product_name != ''
                    )
                    SELECT
                        market,
                        product_name,
                        SUM(quantity) as quantity,
                        ROUND(SUM(revenue_vnd), 0) as revenue_vnd
                    FROM item_rev
                    GROUP BY 1, 2 ORDER BY revenue_vnd DESC`,
                ];

                const results = await Promise.all(
                    queries.map(q =>
                        fetch("/api/query", {
                            method: "POST", headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ query: q })
                        }).then(r => r.json()).catch(() => ({ data: [] }))
                    )
                );

                setMarkets((results[0].data || []).map((r: any) => ({
                    shop_name: marketName(r.market), orders: r.orders || 0,
                    revenue: r.revenue_vnd || 0,
                    avg_order: r.avg_order_vnd || 0,
                    customers: r.customers || 0,
                })));

                setMarketProducts((results[1].data || []).map((r: any) => ({
                    shop_name: marketName(r.market), product_name: r.product_name,
                    quantity: r.quantity || 0, revenue: r.revenue_vnd || 0,
                })));
            } catch (e) { console.error(e); } finally { setLoading(false); }
        }
        fetchData();
    }, [dateRange]);

    if (loading) return <TabSkeleton />;

    const totalRevenue = markets.reduce((s: number, m: any) => s + m.revenue, 0);
    const filteredProducts = selectedMarket === "all"
        ? marketProducts : marketProducts.filter((p: any) => p.shop_name === selectedMarket);

    const prodMap = new Map<string, { name: string; quantity: number; revenue: number }>();
    filteredProducts.forEach((p: any) => {
        const ex = prodMap.get(p.product_name);
        if (ex) { ex.quantity += p.quantity; ex.revenue += p.revenue; }
        else prodMap.set(p.product_name, { name: p.product_name, quantity: p.quantity, revenue: p.revenue });
    });
    const topProducts = Array.from(prodMap.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 10);

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                {markets.map((m: any, i: number) => {
                    const verdict = marketVerdict(m.revenue, totalRevenue);
                    return (
                        <div key={i} className={`bg-card border rounded-xl p-4 cursor-pointer transition hover:border-amber-500/50 ${selectedMarket === m.shop_name ? "border-amber-500" : "border-border"}`}
                            onClick={() => setSelectedMarket(m.shop_name === selectedMarket ? "all" : m.shop_name)}>
                            <div className="flex items-center gap-2 mb-2">
                                <MapPin className="h-4 w-4 text-amber-400" />
                                <span className="text-sm font-semibold text-foreground">{m.shop_name}</span>
                            </div>
                            <div className="text-xl font-bold text-emerald-400">{formatVNDCompact(m.revenue)}</div>
                            <div className="text-xs text-muted-foreground mt-1">{m.orders} đơn • {m.customers} KH</div>
                            <div className={`text-xs mt-1 ${verdict.cls}`}>{verdict.label}</div>
                        </div>
                    );
                })}
                {["Qatar", "Bahrain"].filter(m => !markets.find((mk: any) => mk.shop_name === m)).map(m => (
                    <div key={m} className="bg-muted/30 border border-dashed border-border rounded-xl p-4 opacity-60">
                        <div className="flex items-center gap-2 mb-2">
                            <MapPin className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm font-semibold text-muted-foreground">{m}</span>
                        </div>
                        <div className="text-sm text-muted-foreground">Chưa có data</div>
                        <div className="text-xs text-muted-foreground mt-1">🌱 Sẵn sàng</div>
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-card border border-border shadow-sm rounded-xl p-4">
                    <h3 className="text-sm font-semibold text-foreground mb-4">🥧 Tỷ trọng DS Giao TC (VND)</h3>
                    <ResponsiveContainer width="100%" height={250}>
                        <PieChart>
                            <Pie data={markets} dataKey="revenue" nameKey="shop_name" cx="50%" cy="50%"
                                outerRadius={90} innerRadius={50}
                                label={({ shop_name, percent }: any) => `${shop_name} ${(percent * 100).toFixed(0)}%`}
                                labelLine={{ stroke: "#64748b" }}>
                                {markets.map((_: any, i: number) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                            </Pie>
                            <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))", borderRadius: 8 }}
                                formatter={(v: number) => [formatVNDCompact(v), ""]} />
                        </PieChart>
                    </ResponsiveContainer>
                </div>

                <div className="bg-card border border-border shadow-sm rounded-xl p-4">
                    <h3 className="text-sm font-semibold text-foreground mb-4">
                        📦 Top sản phẩm {selectedMarket !== "all" ? `— ${selectedMarket}` : "— Tất cả"} (VND)
                    </h3>
                    <ResponsiveContainer width="100%" height={250}>
                        <BarChart data={topProducts} layout="vertical">
                            <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.25} />
                            <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={v => formatVNDCompact(v)} />
                            <YAxis type="category" dataKey="name" tick={{ fill: "#94a3b8", fontSize: 10 }} width={160} />
                            <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))", borderRadius: 8 }}
                                formatter={(v: number) => [formatVNDCompact(v), ""]} />
                            <Bar dataKey="revenue" name="Doanh thu (VND)" radius={[0, 4, 4, 0]}>
                                {topProducts.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            <div className="bg-card border border-border shadow-sm rounded-xl p-4">
                <h3 className="text-sm font-semibold text-foreground mb-4">📊 So sánh thị trường (VND)</h3>
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-muted-foreground text-xs border-b border-border">
                            <th className="text-left py-2 pl-2">Thị trường</th>
                            <th className="text-right py-2">Đơn</th>
                            <th className="text-right py-2">KH</th>
                            <th className="text-right py-2">DS Giao TC (VND)</th>
                            <th className="text-right py-2">AOV (VND)</th>
                            <th className="text-right py-2">%</th>
                            <th className="text-right py-2 pr-2">Đánh giá</th>
                        </tr>
                    </thead>
                    <tbody>
                        {markets.map((m: any, i: number) => {
                            const verdict = marketVerdict(m.revenue, totalRevenue);
                            const share = totalRevenue > 0 ? (m.revenue / totalRevenue) * 100 : 0;
                            return (
                                <tr key={i} className="border-b border-border/60 hover:bg-muted/50">
                                    <td className="py-2 pl-2 text-foreground font-medium">{m.shop_name}</td>
                                    <td className="py-2 text-right text-blue-400 font-mono">{m.orders}</td>
                                    <td className="py-2 text-right text-purple-400 font-mono">{m.customers}</td>
                                    <td className="py-2 text-right text-emerald-400 font-mono">{formatVNDCompact(m.revenue)}</td>
                                    <td className="py-2 text-right text-cyan-400 font-mono">{formatVNDCompact(m.avg_order)}</td>
                                    <td className="py-2 text-right text-foreground font-mono">{share.toFixed(1)}%</td>
                                    <td className={`py-2 text-right pr-2 text-xs ${verdict.cls}`}>{verdict.label}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Package, DollarSign, Boxes, Wallet, AlertTriangle } from "lucide-react";
import { KPICard } from "@/components/ui/kpi-card";
import TabSkeleton from "@/components/ui/tab-skeleton";
import { BQ_PROJECT, DATASET } from "../constants";
import { formatVNDCompact, formatNumber } from "../utils";

interface Props { dateRange?: { from: Date; to: Date }; projectId?: string }

interface ProductRow {
    sku: string;                // khoá hiển thị/gom nhóm (mã chuẩn hoá, hoặc sku thô nếu không suy ra được mã)
    skuCode: string | null;     // mã đã chuẩn hoá — null = không suy ra được ⇒ KHÔNG tra giá vốn
    name: string;
    units: number;
    orders: number;
    revenueVnd: number;
    costPrice: number | null;   // null = SKU chưa khai giá vốn
    cogsVnd: number | null;
    profitVnd: number | null;
}

// P&L theo sản phẩm — nguồn: order_items × product_catalog × vw_orders_std.
// DS Giao TC = revenue_vnd của view (đã quy VND theo shop_label, chỉ đơn
// GIAO_THANH_CONG) phân bổ theo quantity item trong đơn.
// E2 — giá vốn: POS KHÔNG trả giá vốn lẫn giá bán ở cấp item (variation_info.
// retail_price / last_imported_price / avg_price = 0 với mọi item, đã verify bằng
// POS API live 03/08) → giá vốn lấy từ config/talpha_rules.json mục products
// (27 SKU CEO khai). SKU chưa khai để TRỐNG, không tính bằng 0, và tổng lãi gộp
// chỉ cộng phần có giá vốn — banner dưới bảng nói rõ độ phủ.
export default function TALPHAProductPnLTab({ dateRange }: Props) {
    const [loading, setLoading] = useState(true);
    const [rows, setRows] = useState<ProductRow[]>([]);
    const [summary, setSummary] = useState({
        skus: 0, units: 0, revenue: 0,
        skusCosted: 0, revenueCosted: 0, cogs: 0, profit: 0,
    });

    useEffect(() => {
        (async () => {
            setLoading(true);
            try {
                const from = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : "2025-01-01";
                const to = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

                // A1: phân bổ revenue_vnd của view theo quantity item — hết quy đổi client.
                const query = `
                    WITH item_rev AS (
                        SELECT
                            i.shop_id, i.order_id, i.variation_id, i.quantity,
                            v.revenue_vnd * SAFE_DIVIDE(
                                i.quantity,
                                SUM(i.quantity) OVER (PARTITION BY i.shop_id, i.order_id)
                            ) AS revenue_vnd
                        FROM \`${BQ_PROJECT}.${DATASET}.order_items\` i
                        -- X8: order_id KHÔNG duy nhất (POS đánh số riêng từng shop) → PHẢI ghép cả shop_id,
                        -- nếu không sẽ nhân chéo item của các đơn trùng id giữa 7 shop.
                        JOIN \`${BQ_PROJECT}.${DATASET}.vw_orders_std\` v
                          ON i.shop_id = CAST(v.shop_id AS STRING) AND i.order_id = CAST(v.order_id AS STRING)
                        WHERE v.is_confirmed
                          AND v.order_date BETWEEN '${from}' AND '${to}'
                          AND v.marketer_group != 'external'   -- X10: chỉ tính team
                    )
                    SELECT
                        c.sku, c.sku_code, ANY_VALUE(c.product_name) AS product_name,
                        COUNT(DISTINCT CONCAT(ir.shop_id, '-', ir.order_id)) AS orders,
                        SUM(ir.quantity)            AS units,
                        ROUND(SUM(ir.revenue_vnd), 0) AS revenue_vnd
                    FROM item_rev ir
                    JOIN \`${BQ_PROJECT}.${DATASET}.vw_product_catalog_std\` c
                        ON ir.variation_id = c.variation_id
                    GROUP BY c.sku, c.sku_code`;

                const [res, costRes] = await Promise.all([
                    fetch("/api/query", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ query }),
                    }).then(r => r.json()).catch(() => ({ data: [] })),
                    fetch("/api/talpha/product-costs")
                        .then(r => r.json()).catch(() => ({ costs: {} })),
                ]);
                const costs: Record<string, number> = costRes?.costs || {};

                // Gom theo SKU (revenue đã là VND từ view).
                const map = new Map<string, ProductRow>();
                for (const r of res.data || []) {
                    const sku = String(r.sku || "—");
                    const revVnd = r.revenue_vnd || 0;
                    const ex = map.get(sku);
                    if (ex) {
                        ex.units += r.units || 0;
                        ex.orders += r.orders || 0;
                        ex.revenueVnd += revVnd;
                    } else {
                        map.set(sku, {
                            sku,
                            skuCode: r.sku_code ? String(r.sku_code) : null,
                            name: String(r.product_name || ""),
                            units: r.units || 0,
                            orders: r.orders || 0,
                            revenueVnd: revVnd,
                            costPrice: null,
                            cogsVnd: null,
                            profitVnd: null,
                        });
                    }
                }

                // E2 — trừ giá vốn cho SKU đã khai; SKU chưa khai giữ null (không phải 0).
                // Tra theo skuCode (mã đã chuẩn hoá), KHÔNG theo sku thô: POS để lọt tên SP
                // vào cột sku ("Necklace box" thay vì "008") nên tra bằng sku thô sẽ trượt.
                for (const row of map.values()) {
                    const cp = row.skuCode ? costs[row.skuCode] : undefined;
                    if (typeof cp !== "number") continue;
                    row.costPrice = cp;
                    row.cogsVnd = cp * row.units;
                    row.profitVnd = row.revenueVnd - row.cogsVnd;
                }

                const list = Array.from(map.values()).sort((a, b) => b.revenueVnd - a.revenueVnd);
                const costed = list.filter(r => r.cogsVnd !== null);

                setRows(list);
                setSummary({
                    skus: list.length,
                    units: list.reduce((s, r) => s + r.units, 0),
                    revenue: list.reduce((s, r) => s + r.revenueVnd, 0),
                    skusCosted: costed.length,
                    revenueCosted: costed.reduce((s, r) => s + r.revenueVnd, 0),
                    cogs: costed.reduce((s, r) => s + (r.cogsVnd || 0), 0),
                    profit: costed.reduce((s, r) => s + (r.profitVnd || 0), 0),
                });
            } finally {
                setLoading(false);
            }
        })();
    }, [dateRange]);

    if (loading) return <TabSkeleton />;

    const maxRev = rows[0]?.revenueVnd || 1;
    const marginPct = summary.revenueCosted > 0 ? (summary.profit / summary.revenueCosted) * 100 : 0;
    const coveragePct = summary.revenue > 0 ? (summary.revenueCosted / summary.revenue) * 100 : 0;

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <KPICard title="SKU bán được" value={formatNumber(summary.skus)} icon={Boxes} status="neutral" subValue={`${formatNumber(summary.skusCosted)} SKU có giá vốn`} />
                <KPICard title="Tổng units" value={formatNumber(summary.units)} icon={Package} status="success" subValue="số lượng đã bán" />
                <KPICard title="DS Giao TC (VND)" value={formatVNDCompact(summary.revenue)} icon={DollarSign} status="success" subValue="đã quy đổi theo shop" />
                <KPICard
                    title="Lãi gộp (phần có giá vốn)"
                    value={formatVNDCompact(summary.profit)}
                    icon={Wallet}
                    status={summary.profit >= 0 ? "success" : "danger"}
                    subValue={`biên ${marginPct.toFixed(1)}% · phủ ${coveragePct.toFixed(0)}% doanh thu`}
                />
            </div>

            {summary.skus > summary.skusCosted && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                        Giá vốn mới khai cho <b>{formatNumber(summary.skusCosted)}/{formatNumber(summary.skus)} SKU</b> đang bán
                        (<b>{coveragePct.toFixed(0)}%</b> doanh thu kỳ này). Lãi gộp ở trên chỉ tính trên phần đó — SKU chưa khai
                        để trống, KHÔNG tính giá vốn = 0. Khai thêm tại <code>config/talpha_rules.json</code> mục <code>products</code>.
                        POS không trả giá vốn ở cấp item nên đây là nguồn duy nhất.
                    </span>
                </div>
            )}

            <div className="rounded-xl border border-border bg-card">
                <div className="border-b border-border px-5 py-3">
                    <h3 className="text-sm font-semibold text-foreground">P&L theo sản phẩm</h3>
                    <p className="text-xs text-muted-foreground">
                        DS Giao TC phân bổ theo item · nguồn <code>order_items × product_catalog × vw_orders_std</code> · giá vốn từ <code>talpha_rules.json</code>
                    </p>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-border text-xs text-muted-foreground">
                                <th className="px-4 py-2 text-left font-medium">#</th>
                                <th className="px-4 py-2 text-left font-medium">SKU</th>
                                <th className="px-4 py-2 text-left font-medium">Sản phẩm</th>
                                <th className="px-4 py-2 text-right font-medium">Units</th>
                                <th className="px-4 py-2 text-right font-medium">Đơn</th>
                                <th className="px-4 py-2 text-right font-medium">DS Giao TC (VND)</th>
                                <th className="px-4 py-2 text-right font-medium">Giá vốn/unit</th>
                                <th className="px-4 py-2 text-right font-medium">COGS (VND)</th>
                                <th className="px-4 py-2 text-right font-medium">Lãi gộp (VND)</th>
                                <th className="px-4 py-2 text-right font-medium">Biên LG</th>
                                <th className="px-4 py-2 text-left font-medium w-40">Tỷ trọng</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r, i) => (
                                <tr key={r.sku + i} className="border-b border-border/50 hover:bg-muted/30">
                                    <td className="px-4 py-2 text-muted-foreground">{i + 1}</td>
                                    <td className="px-4 py-2 font-mono font-medium">{r.sku}</td>
                                    <td className="px-4 py-2">{r.name || <span className="text-muted-foreground/50">—</span>}</td>
                                    <td className="px-4 py-2 text-right font-mono">{formatNumber(r.units)}</td>
                                    <td className="px-4 py-2 text-right font-mono text-muted-foreground">{formatNumber(r.orders)}</td>
                                    <td className="px-4 py-2 text-right font-mono font-medium text-emerald-600 dark:text-emerald-400">{formatVNDCompact(r.revenueVnd)}</td>
                                    <td className="px-4 py-2 text-right font-mono text-muted-foreground">
                                        {r.costPrice === null
                                            ? <span className="text-muted-foreground/50" title="SKU chưa khai giá vốn">—</span>
                                            : formatVNDCompact(r.costPrice)}
                                    </td>
                                    <td className="px-4 py-2 text-right font-mono text-muted-foreground">
                                        {r.cogsVnd === null ? <span className="text-muted-foreground/50">—</span> : formatVNDCompact(r.cogsVnd)}
                                    </td>
                                    <td className={`px-4 py-2 text-right font-mono font-medium ${r.profitVnd === null ? "" : r.profitVnd >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                                        {r.profitVnd === null ? <span className="text-muted-foreground/50">—</span> : formatVNDCompact(r.profitVnd)}
                                    </td>
                                    <td className="px-4 py-2 text-right font-mono text-muted-foreground">
                                        {r.profitVnd === null || r.revenueVnd <= 0
                                            ? <span className="text-muted-foreground/50">—</span>
                                            : `${((r.profitVnd / r.revenueVnd) * 100).toFixed(0)}%`}
                                    </td>
                                    <td className="px-4 py-2">
                                        <div className="h-2 w-full rounded-full bg-muted">
                                            <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${Math.max(2, (r.revenueVnd / maxRev) * 100)}%` }} />
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {rows.length === 0 && (
                                <tr><td colSpan={11} className="px-4 py-8 text-center text-muted-foreground">Không có dữ liệu trong khoảng thời gian này</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

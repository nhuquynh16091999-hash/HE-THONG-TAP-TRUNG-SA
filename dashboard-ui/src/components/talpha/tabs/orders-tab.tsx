"use client";

import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { Search, ChevronLeft, ChevronRight, Download } from "lucide-react";
import TabSkeleton, { ErrorState } from "@/components/ui/tab-skeleton";
import { formatVNDCompact, formatNumber, cn } from "../utils";

interface Props { dateRange?: { from: Date; to: Date }; projectId?: string }

type Order = {
    order_uid: string; order_id: string; order_date: string;
    status_category: string; status_name: string;
    customer: string; phone: string; province: string; quantity: number;
    revenue_vnd: number; cod_local: number;
    partner: string; tracking: string | null;
    marketer: string; marketer_key: string; attribution: string;
    sale: string; sale_key: string | null;
};

const STATUSES = [
    { id: "", label: "Tất cả" },
    { id: "GIAO_THANH_CONG", label: "Đã giao" },
    { id: "DON_HOAN", label: "Hoàn" },
    { id: "HUY", label: "Huỷ" },
    { id: "DON_THO", label: "Đơn thô" },
];

const STATUS_STYLE: Record<string, string> = {
    GIAO_THANH_CONG: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
    DON_HOAN: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400",
    HUY: "bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-400",
    DON_THO: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
};

const PAGE = 100;

export default function TALPHAOrdersTab({ dateRange }: Props) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [rows, setRows] = useState<Order[]>([]);
    const [totals, setTotals] = useState({
        total: 0, delivered: 0, returned: 0, cancelled: 0,
        delivered_revenue_vnd: 0, all_revenue_vnd: 0,
    });
    const [status, setStatus] = useState("");
    const [search, setSearch] = useState("");
    const [applied, setApplied] = useState("");
    const [page, setPage] = useState(0);

    const from = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : "2026-01-01";
    const to = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

    const load = useCallback(async () => {
        setLoading(true); setError("");
        try {
            const p = new URLSearchParams({ from, to, limit: String(PAGE), offset: String(page * PAGE) });
            if (status) p.set("status", status);
            if (applied) p.set("q", applied);
            const res = await fetch(`/api/talpha/orders?${p}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Không tải được đơn hàng");
            setRows(data.rows || []);
            setTotals(data.totals);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Lỗi không rõ");
        } finally {
            setLoading(false);
        }
    }, [from, to, status, applied, page]);

    useEffect(() => { load(); }, [load]);
    useEffect(() => { setPage(0); }, [from, to, status, applied]);

    const exportCsv = () => {
        const head = ["Mã đơn", "Ngày", "Trạng thái", "Khách", "SĐT", "Tỉnh/TP", "SL",
            "Doanh thu (VND)", "COD (TWD)", "Vận đơn", "3PL", "Marketer", "Sale"];
        const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
        const body = rows.map((r) => [
            r.order_id, r.order_date, r.status_name, r.customer, r.phone, r.province,
            r.quantity, r.revenue_vnd, r.cod_local, r.tracking || "", r.partner,
            r.marketer, r.sale,
        ].map(esc).join(","));
        const blob = new Blob(["﻿" + [head.map(esc).join(","), ...body].join("\n")],
            { type: "text/csv;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `don-hang_${from}_${to}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    if (loading && !rows.length) return <TabSkeleton cards={4} rows={8} showChart={false} />;
    if (error) return <ErrorState message={error} onRetry={load} />;

    const deliveryRate = totals.total > 0 ? (totals.delivered / totals.total) * 100 : 0;

    return (
        <div className="space-y-5">
            {/* ── Bốn con số của kỳ ── */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat label="Tổng đơn" value={formatNumber(totals.total)} sub={`${from} → ${to}`} />
                <Stat label="Đã giao" value={formatNumber(totals.delivered)}
                    sub={`${deliveryRate.toFixed(1)}% tỷ lệ giao`} tone="good" />
                <Stat label="Hoàn / huỷ" value={formatNumber(totals.returned + totals.cancelled)}
                    sub={`${formatNumber(totals.returned)} hoàn · ${formatNumber(totals.cancelled)} huỷ`} tone="bad" />
                <Stat label="Doanh thu đã giao" value={formatVNDCompact(totals.delivered_revenue_vnd)}
                    sub="chỉ tính đơn giao thành công" tone="good" />
            </div>

            {/* ── Bộ lọc ── */}
            <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-lg border border-border bg-muted/40 p-1">
                    {STATUSES.map((s) => (
                        <button key={s.id} onClick={() => setStatus(s.id)}
                            className={cn("rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                                status === s.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                            {s.label}
                        </button>
                    ))}
                </div>
                <form className="flex items-center gap-2"
                    onSubmit={(e) => { e.preventDefault(); setApplied(search.trim()); }}>
                    <div className="relative">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <input value={search} onChange={(e) => setSearch(e.target.value)}
                            placeholder="Mã đơn · tên khách · SĐT · vận đơn"
                            className="w-64 rounded-lg border border-border bg-card py-1.5 pl-8 pr-3 text-sm outline-none focus:border-orange-400" />
                    </div>
                    <button type="submit" className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm hover:bg-muted">
                        Tìm
                    </button>
                </form>
                <button onClick={exportCsv} disabled={!rows.length}
                    className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-40">
                    <Download className="h-3.5 w-3.5" /> Xuất CSV trang này
                </button>
            </div>

            {/* ── Bảng đơn ── */}
            <div className="rounded-xl border border-border bg-card shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[1000px] text-sm">
                        <thead>
                            <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                                <th className="px-3 py-2.5 text-left font-medium">Mã đơn</th>
                                <th className="px-3 py-2.5 text-left font-medium">Ngày</th>
                                <th className="px-3 py-2.5 text-left font-medium">Trạng thái</th>
                                <th className="px-3 py-2.5 text-left font-medium">Khách hàng</th>
                                <th className="px-3 py-2.5 text-right font-medium">SL</th>
                                <th className="px-3 py-2.5 text-right font-medium">COD (TWD)</th>
                                <th className="px-3 py-2.5 text-right font-medium">Doanh thu</th>
                                <th className="px-3 py-2.5 text-left font-medium">Marketer</th>
                                <th className="px-3 py-2.5 text-left font-medium">Sale</th>
                                <th className="px-3 py-2.5 text-left font-medium">Vận đơn</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r) => (
                                <tr key={r.order_uid} className="border-b border-border/50 last:border-0 hover:bg-muted/40">
                                    <td className="px-3 py-2 font-mono text-xs">{r.order_id}</td>
                                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{r.order_date}</td>
                                    <td className="px-3 py-2">
                                        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium",
                                            STATUS_STYLE[r.status_category] || STATUS_STYLE.HUY)}>
                                            {r.status_name || r.status_category}
                                        </span>
                                    </td>
                                    <td className="px-3 py-2">
                                        <div className="max-w-[190px] truncate">{r.customer || "—"}</div>
                                        <div className="text-xs text-muted-foreground">{r.phone}</div>
                                    </td>
                                    <td className="px-3 py-2 text-right tabular-nums">{r.quantity || "—"}</td>
                                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                                        {r.cod_local ? r.cod_local.toLocaleString("vi-VN") : "—"}
                                    </td>
                                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                                        {formatVNDCompact(r.revenue_vnd)}
                                    </td>
                                    <td className="px-3 py-2">
                                        <span>{r.marketer}</span>
                                        {r.attribution === "ad_id" && (
                                            <span className="ml-1 text-[10px] text-muted-foreground" title="Gán theo ad_id, không phải tag POS">↩︎ad</span>
                                        )}
                                    </td>
                                    <td className={cn("px-3 py-2", !r.sale_key && "text-muted-foreground")}>{r.sale}</td>
                                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                                        {r.tracking || "—"}
                                    </td>
                                </tr>
                            ))}
                            {!rows.length && (
                                <tr><td colSpan={10} className="px-3 py-10 text-center text-muted-foreground">
                                    Không có đơn nào khớp bộ lọc.
                                </td></tr>
                            )}
                        </tbody>
                    </table>
                </div>

                <div className="flex items-center justify-between border-t border-border px-3 py-2 text-sm text-muted-foreground">
                    <span>Trang {page + 1} · {rows.length} đơn trên trang · {formatNumber(totals.total)} đơn cả kỳ</span>
                    <div className="flex gap-1">
                        <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}
                            className="rounded-md border border-border p-1.5 disabled:opacity-30 hover:bg-muted">
                            <ChevronLeft className="h-4 w-4" />
                        </button>
                        <button onClick={() => setPage((p) => p + 1)} disabled={rows.length < PAGE}
                            className="rounded-md border border-border p-1.5 disabled:opacity-30 hover:bg-muted">
                            <ChevronRight className="h-4 w-4" />
                        </button>
                    </div>
                </div>
            </div>

            <p className="text-xs text-muted-foreground">
                Doanh thu lấy thẳng từ <span className="font-mono">vw_orders_std</span> (view đã quy đổi TWD→VND).
                Cột COD là tiền gốc theo TWD. Marketer gán theo rule 3 bậc: tag POS → ad_id → “(không gán)”.
            </p>
        </div>
    );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" }) {
    return (
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
            <div className={cn("mt-1 text-2xl font-semibold tabular-nums",
                tone === "good" && "text-emerald-600 dark:text-emerald-400",
                tone === "bad" && "text-rose-600 dark:text-rose-400")}>
                {value}
            </div>
            {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
        </div>
    );
}

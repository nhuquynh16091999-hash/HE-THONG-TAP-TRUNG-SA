"use client";

import { useEffect, useMemo, useState } from "react";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, Cell,
} from "recharts";
import {
    Package, AlertTriangle, Boxes, TrendingDown, TrendingUp,
    Search, Lightbulb, RefreshCw,
} from "lucide-react";
import { KPICard } from "@/components/ui/kpi-card";
import { formatNumber } from "../utils";
import {
    type SkuRow, type MarketOverview, type StatusSummary,
    type Transfer, type Restock,
} from "../data/inventory";
import TabSkeleton from "@/components/ui/tab-skeleton";

// Payload trả về từ /api/talpha/inventory (POS live; POS lỗi → snapshot BQ dự phòng)
interface InventoryPayload {
    asOf: { label: string; note: string };
    marketOverview: MarketOverview[];
    statusSummary: StatusSummary[];
    skuMatrix: SkuRow[];
    transfers: Transfer[];
    restocks: Restock[];
    keyFindings: string[];
    sources?: {
        pos?: { ok: boolean; shops: number; skus: number; field?: string };
        images?: { configured: boolean; count: number; source?: string };
    };
    fetchedAt?: string;
    _source?: "pos-live" | "bigquery-fallback";
    _snapshotTime?: string;
}

// Thumbnail ảnh SP (từ POS) — placeholder khi chưa có ảnh
function Thumb({ src, name }: { src?: string; name: string }) {
    if (!src) {
        return (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground/40">
                <Package className="h-4 w-4" />
            </div>
        );
    }
    return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
            src={src}
            alt={name}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-9 w-9 shrink-0 rounded-md border border-border object-cover"
            onError={e => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
        />
    );
}

const CHART_COLORS = ["#34d399", "#3b82f6", "#f59e0b", "#a855f7", "#ec4899", "#06b6d4", "#f43f5e", "#14b8a6", "#eab308", "#8b5cf6"];

// Màu badge theo trạng thái
const STATUS_STYLE: Record<string, string> = {
    "CẦN NHẬP GẤP": "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400",
    "Hết hàng toàn hệ thống": "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400",
    "Sắp thiếu (<30 ngày)": "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
    "Bán chạy": "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
    "Ổn định": "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400",
    "Tồn đọng": "bg-slate-200 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300",
    "Lỗi số liệu (tồn âm)": "bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-400",
};

type SortKey = "total" | "perDay" | "days";

// Cột tồn theo từng kho đã bỏ 11/09/2026. Sáu kho GCC ngừng bán từ 05/09 nên POS
// không trả gì — mỗi dòng SKU hiện sáu dấu "—", còn cột kho Đài thì y hệt cột
// "Tổng". Một kho thì "Tổng" CHÍNH LÀ tồn của kho đó.

interface Props { dateRange?: { from: Date; to: Date }; projectId?: string }

// Tồn theo kho: null = không nhập, 0 = "·" (hết), số âm = lỗi sổ
function cell(v: number | null) {
    if (v === null) return <span className="text-muted-foreground/30">—</span>;
    if (v === 0) return <span className="text-muted-foreground/60">·</span>;
    if (v < 0) return <span className="text-rose-500 font-medium">({Math.abs(v)})</span>;
    return <span className="text-foreground">{formatNumber(v)}</span>;
}

function daysColor(d: number | null) {
    if (d === null) return "text-muted-foreground/50";
    if (d <= 7) return "text-rose-500 font-semibold";
    if (d < 30) return "text-amber-500 font-medium";
    return "text-emerald-500";
}

export default function TALPHAProductsTab(_props: Props) {
    const [statusFilter, setStatusFilter] = useState<string>("all");
    const [mktFilter, setMktFilter] = useState<string>("all");
    const [search, setSearch] = useState("");
    const [sortKey, setSortKey] = useState<SortKey>("perDay");
    const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

    // ─── Dữ liệu live từ POS (POS lỗi → API trả snapshot BQ có nhãn thời điểm) ───
    // KHÔNG còn lớp dữ liệu tĩnh: thà hiện "không đọc được" còn hơn hiện số cũ 2 tháng
    // trông như số thật (bẫy snapshot 19/06 — đã gỡ 20/08).
    const [data, setData] = useState<InventoryPayload | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [reloadAt, setReloadAt] = useState(0);

    useEffect(() => {
        let alive = true;
        setLoading(true);
        setError(null);
        // Test banner dự phòng không cần ngắt POS thật: mở tab Kho với ?inv=fallback
        const forceFallback = typeof window !== "undefined"
            && new URLSearchParams(window.location.search).get("inv") === "fallback";
        fetch(`/api/talpha/inventory${forceFallback ? "?force=fallback" : ""}`, { cache: "no-store" })
            .then(async r => {
                const j = await r.json();
                if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
                return j as InventoryPayload;
            })
            .then(j => { if (alive) { setData(j); } })
            // Làm mới thất bại nhưng đã có số của lần tải trước → giữ số cũ + báo lỗi,
            // không xoá trắng màn hình của người đang xem.
            .catch(e => { if (alive) setError(e.message || "Không đọc được tồn kho POS"); })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, [reloadAt]);

    // Nguồn của data đang hiển thị: pos-live / bigquery-fallback
    const source = data ? (data._source ?? "pos-live") : "loading";
    const snapshotLabel = (() => {
        if (!data?._snapshotTime) return null;
        const d = new Date(data._snapshotTime);
        return isNaN(d.getTime()) ? data._snapshotTime : d.toLocaleString("vi-VN");
    })();

    const {
        asOf: INVENTORY_AS_OF,
        marketOverview: MARKET_OVERVIEW,
        statusSummary: STATUS_SUMMARY,
        skuMatrix: SKU_MATRIX,
        transfers: TRANSFERS,
        restocks: RESTOCKS,
        keyFindings: KEY_FINDINGS,
    } = data ?? {
        asOf: { label: "", note: "" },
        marketOverview: [], statusSummary: [], skuMatrix: [],
        transfers: [], restocks: [], keyFindings: [],
    };

    // ─── KPI + insight cho MARKETING (quyết định đổ ads) ───
    const SOON_DAYS = 15;   // < 15 ngày hàng = sắp hết → cân nhắc giảm ads
    const HOT_DAYS = 20;    // còn ≥ 20 ngày + bán tốt = an toàn đẩy ads
    const kpi = useMemo(() => {
        const totalStock = MARKET_OVERVIEW.reduce((s, m) => s + m.stock, 0);
        const perDay = MARKET_OVERVIEW.reduce((s, m) => s + (m.perDay ?? 0), 0);
        const soonOut = SKU_MATRIX.filter(r => r.perDay && r.days != null && r.days < SOON_DAYS && (r.total ?? 0) > 0).length;
        const hot = SKU_MATRIX.filter(r => r.perDay && r.days != null && r.days >= HOT_DAYS).length;
        const dead = SKU_MATRIX.filter(r => (r.total ?? 0) >= 50 && !r.perDay);
        const deadPcs = dead.reduce((s, r) => s + (r.total ?? 0), 0);
        const neg = SKU_MATRIX.filter(r => (r.total ?? 0) < 0).length;
        return { totalStock, perDay, soonOut, hot, deadCount: dead.length, deadPcs, neg,
            deadPct: totalStock ? Math.round((deadPcs / totalStock) * 100) : 0 };
    }, [MARKET_OVERVIEW, SKU_MATRIX]);

    // 3 nhóm hành động cho mkt
    const insights = useMemo(() => {
        const soonOut = SKU_MATRIX.filter(r => r.perDay && r.days != null && r.days < SOON_DAYS && (r.total ?? 0) > 0)
            .sort((a, b) => (a.days ?? 0) - (b.days ?? 0)).slice(0, 15);
        const hot = SKU_MATRIX.filter(r => r.perDay && r.days != null && r.days >= HOT_DAYS)
            .sort((a, b) => (b.perDay ?? 0) - (a.perDay ?? 0)).slice(0, 15);
        const dead = SKU_MATRIX.filter(r => (r.total ?? 0) >= 50 && !r.perDay)
            .sort((a, b) => (b.total ?? 0) - (a.total ?? 0)).slice(0, 15);
        return { soonOut, hot, dead };
    }, [SKU_MATRIX]);

    // ─── Lọc + sắp xếp ma trận SKU ───
    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        let rows = SKU_MATRIX.filter(r => {
            if (statusFilter !== "all" && r.status !== statusFilter) return false;
            if (mktFilter !== "all" && !(r.mkt || "").includes(mktFilter)) return false;
            if (q && !(`${r.code} ${r.name} ${r.mkt}`.toLowerCase().includes(q))) return false;
            return true;
        });
        rows = [...rows].sort((a, b) => {
            const av = a[sortKey] ?? -1, bv = b[sortKey] ?? -1;
            return sortDir === "desc" ? (bv as number) - (av as number) : (av as number) - (bv as number);
        });
        return rows;
    }, [SKU_MATRIX, statusFilter, mktFilter, search, sortKey, sortDir]);

    // Danh sách marketer có SP đang chạy (để lọc)
    const mktList = useMemo(() => {
        const s = new Set<string>();
        for (const r of SKU_MATRIX) (r.mkt || "").split(",").map(x => x.trim()).filter(Boolean).forEach(m => s.add(m));
        return [...s].sort();
    }, [SKU_MATRIX]);

    const chartData = useMemo(
        () => [...SKU_MATRIX].filter(r => r.perDay).sort((a, b) => (b.perDay ?? 0) - (a.perDay ?? 0)).slice(0, 10)
            .map(r => ({ name: (r.name || r.code).slice(0, 26), perDay: r.perDay })),  // name đã kèm mã, không lặp lại
        [SKU_MATRIX],
    );

    const handleSort = (k: SortKey) => {
        if (sortKey === k) setSortDir(d => d === "desc" ? "asc" : "desc");
        else { setSortKey(k); setSortDir("desc"); }
    };
    const SortTh = ({ label, sk }: { label: string; sk: SortKey }) => (
        <th className="text-right py-2 px-2 cursor-pointer select-none hover:text-foreground whitespace-nowrap" onClick={() => handleSort(sk)}>
            {label} {sortKey === sk ? (sortDir === "desc" ? "↓" : "↑") : ""}
        </th>
    );

    // Tải lần đầu: skeleton, KHÔNG hiện số nào (trước đây hiện snapshot tĩnh 19/06 trong lúc chờ)
    if (loading && !data) return <TabSkeleton cards={4} showChart={true} rows={8} />;

    // POS + snapshot BQ đều chết và chưa có gì để hiện → nói thẳng, kèm nút thử lại.
    if (!data) {
        return (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-8 text-center">
                <AlertTriangle className="mx-auto h-8 w-8 text-rose-500" />
                <h3 className="mt-3 text-base font-semibold text-foreground">Không đọc được tồn kho</h3>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                    POS Poscake không phản hồi và BigQuery cũng không có snapshot dự phòng.
                    {error ? ` Chi tiết: ${error}` : ""} Không hiện số cũ để tránh đọc nhầm thành số thật.
                </p>
                <button
                    onClick={() => setReloadAt(Date.now())}
                    className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition hover:bg-muted"
                >
                    <RefreshCw className="h-4 w-4" /> Thử lại
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-5">
            {/* Banner nguồn dữ liệu */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-amber-100 px-2.5 py-1 font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                    📋 {INVENTORY_AS_OF.label}
                </span>
                {source === "pos-live" ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> LIVE từ POS Poscake
                    </span>
                ) : source === "bigquery-fallback" ? (
                    <span className="rounded-full bg-amber-100 px-2.5 py-1 font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                        ⚠️ POS lỗi — đang dùng dữ liệu dự phòng{snapshotLabel ? ` (snapshot ${snapshotLabel})` : ""} · KHÔNG realtime
                    </span>
                ) : (
                    <span className="rounded-full bg-slate-200 px-2.5 py-1 font-medium text-slate-600 dark:bg-slate-500/20 dark:text-slate-300">
                        Đang tải tồn kho POS…
                    </span>
                )}
                <span className="text-muted-foreground">
                    {INVENTORY_AS_OF.note || "Nguồn: POS Poscake · actual_remain_quantity (7 shop)"}
                    {data.fetchedAt && source === "pos-live" && ` · cập nhật ${new Date(data.fetchedAt).toLocaleString("vi-VN")}`}
                </span>
                <button
                    onClick={() => setReloadAt(Date.now())}
                    disabled={loading}
                    className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-50"
                >
                    <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Làm mới
                </button>
                {error && (
                    <span className="rounded-full bg-rose-100 px-2.5 py-1 font-medium text-rose-700 dark:bg-rose-500/15 dark:text-rose-400">
                        ⚠️ Làm mới thất bại ({error}) — đang hiện số của lần tải trước
                    </span>
                )}
            </div>

            {/* Nguồn tồn kho — POS Poscake (7 shop) · chỉ hiện khi thật sự đang live */}
            {source === "pos-live" && data.sources?.pos && (
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="font-medium text-foreground">Nguồn tồn:</span>
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
                        📦 POS Poscake · {data.sources.pos.shops} shop · {data.sources.pos.skus} SKU
                    </span>
                    <span>— tồn kho (actual_remain_quantity) + bán/ngày từ đơn thật, realtime</span>
                </div>
            )}

            {/* KPI Row — hướng hành động cho mkt */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                <KPICard title="📦 Tổng SKU" value={formatNumber(SKU_MATRIX.length)} icon={Package} subValue={`${MARKET_OVERVIEW.length} kho POS`} />
                <KPICard title="🏬 Tổng tồn (pcs)" value={formatNumber(kpi.totalStock)} icon={Boxes} subValue="toàn hệ thống" />
                <KPICard title="⚡ Bán/ngày" value={`${kpi.perDay.toFixed(0)}`} icon={Package} status="success" subValue="đơn thật 30 ngày" tooltip="Tốc độ bán thật tính từ đơn hàng 30 ngày, đủ cả 7 kho." />
                <KPICard title="🔴 Sắp hết — giảm ads" value={formatNumber(kpi.soonOut)} icon={AlertTriangle} status="danger" subValue={`SKU còn <${SOON_DAYS} ngày hàng`} tooltip="SKU đang bán tốt nhưng tồn sắp hết → cân nhắc GIẢM/DỪNG ads để tránh cháy hàng + RTO." />
                <KPICard title="🔥 Đẩy ads được" value={formatNumber(kpi.hot)} icon={TrendingUp} status="success" subValue="bán tốt · đủ hàng" tooltip="SKU bán chạy và còn ≥20 ngày hàng → an toàn đổ mạnh ads." />
                <KPICard title="🐌 Tồn đọng — cần xả" value={`${kpi.deadPct}%`} icon={TrendingDown} status="warning" subValue={`${formatNumber(kpi.deadCount)} SKU · ${formatNumber(kpi.deadPcs)} pcs`} tooltip="Tồn nhiều nhưng 30 ngày không bán → nên chạy ads/khuyến mãi để xả." />
            </div>

            {/* Tổng quan theo kho */}
            <div className="rounded-lg border border-border bg-card p-4">
                <h3 className="mb-3 text-sm font-semibold text-foreground">🌍 Tổng quan {MARKET_OVERVIEW.length} kho</h3>
                <div className="overflow-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-border text-xs text-muted-foreground">
                                <th className="py-2 pl-2 text-left">Kho</th>
                                <th className="py-2 px-2 text-right">Số SKU</th>
                                <th className="py-2 px-2 text-right">Tồn (pcs)</th>
                                <th className="py-2 px-2 text-right">Bán 30 ngày</th>
                                <th className="py-2 px-2 text-right">Bán/ngày</th>
                                <th className="py-2 px-2 text-right">Đủ bán (ngày)</th>
                                <th className="py-2 px-2 text-left">Điểm cần chú ý</th>
                            </tr>
                        </thead>
                        <tbody>
                            {MARKET_OVERVIEW.map(m => (
                                <tr key={m.market} className="border-b border-border/60 hover:bg-muted/40">
                                    <td className="py-2 pl-2 font-medium text-foreground whitespace-nowrap">{m.flag} {m.market}</td>
                                    <td className="py-2 px-2 text-right font-mono text-muted-foreground">{m.skus}</td>
                                    <td className="py-2 px-2 text-right font-mono text-foreground">{formatNumber(m.stock)}</td>
                                    <td className="py-2 px-2 text-right font-mono text-muted-foreground">{m.sold30 !== null ? formatNumber(m.sold30) : "—"}</td>
                                    <td className="py-2 px-2 text-right font-mono text-blue-500">{m.perDay !== null ? m.perDay.toFixed(1) : "—"}</td>
                                    <td className={`py-2 px-2 text-right font-mono ${daysColor(m.daysOfStock)}`}>{m.daysOfStock !== null ? m.daysOfStock : "—"}</td>
                                    <td className="py-2 px-2 text-xs text-muted-foreground max-w-[260px]">{m.note}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <p className="mt-2 text-xs italic text-muted-foreground">⚠️ {INVENTORY_AS_OF.note}</p>
            </div>

            {/* Top 10 SKU bán chạy + Chart */}
            <div className="rounded-lg border border-border bg-card p-4">
                <h3 className="mb-3 text-sm font-semibold text-foreground">🔥 Top 10 SKU theo tốc độ bán (pcs/ngày)</h3>
                <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={chartData} layout="vertical" margin={{ left: 10, right: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.25} />
                        <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                        <YAxis type="category" dataKey="name" tick={{ fill: "#94a3b8", fontSize: 10 }} width={190} />
                        <Tooltip cursor={{ fill: "#94a3b8", fillOpacity: 0.1 }}
                            contentStyle={{ background: "#1e293b", border: "1px solid #475569", borderRadius: 8, color: "#f1f5f9" }}
                            formatter={(v: number) => [`${v} pcs/ngày`, ""]} />
                        <Bar dataKey="perDay" name="Bán/ngày" radius={[0, 4, 4, 0]}>
                            {chartData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>

            {/* ═══ HÀNH ĐỘNG CHO MARKETING ═══ */}
            <div className="grid gap-4 lg:grid-cols-3">
                {/* 1. Sắp hết → giảm ads */}
                <div className="rounded-lg border border-rose-300 bg-rose-50/60 p-4 dark:border-rose-500/30 dark:bg-rose-500/5">
                    <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-rose-700 dark:text-rose-400">
                        <AlertTriangle className="h-4 w-4" /> Sắp hết hàng — cân nhắc GIẢM ads ({insights.soonOut.length})
                    </h3>
                    <p className="mb-2 text-[11px] text-muted-foreground">Bán tốt nhưng tồn còn &lt;{SOON_DAYS} ngày. Đẩy ads mạnh dễ cháy hàng → RTO, mất phí.</p>
                    <div className="space-y-1.5 max-h-72 overflow-auto">
                        {insights.soonOut.length === 0 && <p className="text-xs text-muted-foreground italic">Không có SKU nào sắp hết 👍</p>}
                        {insights.soonOut.map(r => (
                            <div key={r.code} className="rounded-md border border-border/60 bg-card p-2">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="truncate text-xs font-medium text-foreground">{r.name}</span>
                                    <span className="whitespace-nowrap text-xs font-bold text-rose-600 dark:text-rose-400">còn {r.days}n</span>
                                </div>
                                <div className="mt-0.5 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                                    <span>{r.perDay?.toFixed(1)}/ngày · tồn {formatNumber(r.total ?? 0)}</span>
                                    <span className="truncate">{r.mkt || "chưa ai chạy"}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
                {/* 2. Bán chạy đủ hàng → đẩy ads */}
                <div className="rounded-lg border border-emerald-300 bg-emerald-50/60 p-4 dark:border-emerald-500/30 dark:bg-emerald-500/5">
                    <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                        <TrendingUp className="h-4 w-4" /> Bán chạy còn hàng — ĐẨY ads ({insights.hot.length})
                    </h3>
                    <p className="mb-2 text-[11px] text-muted-foreground">Bán tốt và còn ≥{HOT_DAYS} ngày hàng → an toàn scale ngân sách.</p>
                    <div className="space-y-1.5 max-h-72 overflow-auto">
                        {insights.hot.length === 0 && <p className="text-xs text-muted-foreground italic">Chưa có SKU đạt ngưỡng.</p>}
                        {insights.hot.map(r => (
                            <div key={r.code} className="rounded-md border border-border/60 bg-card p-2">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="truncate text-xs font-medium text-foreground">{r.name}</span>
                                    <span className="whitespace-nowrap text-xs font-bold text-emerald-600 dark:text-emerald-400">{r.perDay?.toFixed(1)}/ngày</span>
                                </div>
                                <div className="mt-0.5 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                                    <span>đủ bán {r.days}n · tồn {formatNumber(r.total ?? 0)}</span>
                                    <span className="truncate">{r.mkt || "chưa ai chạy"}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
                {/* 3. Tồn đọng → cần xả */}
                <div className="rounded-lg border border-amber-300 bg-amber-50/60 p-4 dark:border-amber-500/30 dark:bg-amber-500/5">
                    <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-400">
                        <TrendingDown className="h-4 w-4" /> Tồn đọng — nên chạy ads/KM để XẢ ({insights.dead.length})
                    </h3>
                    <p className="mb-2 text-[11px] text-muted-foreground">Tồn nhiều nhưng 30 ngày không bán → vốn chết, cần đẩy ra.</p>
                    <div className="space-y-1.5 max-h-72 overflow-auto">
                        {insights.dead.length === 0 && <p className="text-xs text-muted-foreground italic">Không có tồn đọng lớn 👍</p>}
                        {insights.dead.map(r => (
                            <div key={r.code} className="rounded-md border border-border/60 bg-card p-2">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="truncate text-xs font-medium text-foreground">{r.name}</span>
                                    <span className="whitespace-nowrap text-xs font-bold text-amber-600 dark:text-amber-400">tồn {formatNumber(r.total ?? 0)}</span>
                                </div>
                                <div className="mt-0.5 text-[10px] text-muted-foreground">{r.mkt ? `MKT: ${r.mkt}` : "chưa ai chạy mã này"}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Bộ lọc */}
            <div className="rounded-lg border border-border bg-card p-4">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                    <div className="relative">
                        <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Tìm mã / tên / MKT…"
                            className="w-52 rounded-lg border border-border bg-background py-1.5 pl-7 pr-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-amber-500" />
                    </div>
                    <select value={mktFilter} onChange={e => setMktFilter(e.target.value)}
                        className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500">
                        <option value="all">Tất cả MKT</option>
                        {mktList.map(m => <option key={m} value={m}>👤 {m}</option>)}
                    </select>
                </div>
                <div className="flex flex-wrap gap-1.5">
                    <button onClick={() => setStatusFilter("all")}
                        className={`rounded-full px-3 py-1 text-xs font-medium transition ${statusFilter === "all" ? "bg-amber-500 text-white" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
                        Tất cả ({SKU_MATRIX.length})
                    </button>
                    {STATUS_SUMMARY.map(s => (
                        <button key={s.status} onClick={() => setStatusFilter(s.status)}
                            className={`rounded-full px-3 py-1 text-xs font-medium transition ${statusFilter === s.status ? "bg-amber-500 text-white" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
                            {s.status} ({s.skus})
                        </button>
                    ))}
                </div>

                {/* Ma trận SKU */}
                <div className="mt-4 overflow-auto max-h-[640px]">
                    <table className="w-full text-sm">
                        <thead className="sticky top-0 z-10 bg-card">
                            <tr className="border-b border-border text-xs text-muted-foreground">
                                <th className="py-2 pl-2 text-left">Mã</th>
                                <th className="py-2 px-2 text-left">Sản phẩm</th>
                                <SortTh label="Tổng" sk="total" />
                                <SortTh label="Bán/ngày" sk="perDay" />
                                <SortTh label="Đủ bán" sk="days" />
                                <th className="py-2 px-2 text-left">Trạng thái</th>
                                <th className="py-2 px-2 text-left">MKT</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map((r, i) => (
                                <tr key={`${r.code}-${i}`} className="border-b border-border/50 hover:bg-muted/40">
                                    <td className="py-2 pl-2 font-mono text-xs text-muted-foreground whitespace-nowrap">{r.code}</td>
                                    <td className="py-2 px-2 max-w-[260px] text-foreground" title={r.name}>
                                        <div className="flex items-center gap-2">
                                            <Thumb src={r.img} name={r.name} />
                                            <div className="min-w-0">
                                                <div className="truncate">{r.name}</div>
                                                {r.cat && <span className="text-[10px] text-muted-foreground">{r.cat}</span>}
                                            </div>
                                        </div>
                                    </td>
                                    <td className={`py-2 px-2 text-right font-mono font-medium ${r.total < 0 ? "text-rose-500" : "text-foreground"}`}>{r.total < 0 ? `(${Math.abs(r.total)})` : formatNumber(r.total)}</td>
                                    <td className="py-2 px-2 text-right font-mono text-blue-500">{r.perDay !== null ? r.perDay.toFixed(1) : "—"}</td>
                                    <td className={`py-2 px-2 text-right font-mono ${daysColor(r.days)}`}>{r.days !== null ? r.days : "—"}</td>
                                    <td className="py-2 px-2">
                                        <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium whitespace-nowrap ${STATUS_STYLE[r.status] ?? "bg-muted text-muted-foreground"}`}>{r.status}</span>
                                    </td>
                                    <td className="py-2 px-2 text-xs text-muted-foreground whitespace-nowrap">{r.mkt || "—"}</td>
                                </tr>
                            ))}
                            {filtered.length === 0 && (
                                <tr><td colSpan={12} className="py-6 text-center italic text-muted-foreground">Không có SKU khớp bộ lọc</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                    Hiển thị {filtered.length}/{SKU_MATRIX.length} SKU · <span className="text-muted-foreground/60">·</span> = hết tại kho · <span className="text-rose-500">(số)</span> = tồn âm/lỗi sổ · — = không phân phối
                </p>
            </div>

            {/* Kết luận chính (chỉ hiện khi có) */}
            {KEY_FINDINGS.length > 0 && (
                <div className="rounded-lg border border-border bg-card p-4">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                        <Lightbulb className="h-4 w-4 text-amber-500" /> Kết luận chính
                    </h3>
                    <ol className="space-y-2">
                        {KEY_FINDINGS.map((f, i) => (
                            <li key={i} className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
                                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[10px] font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">{i + 1}</span>
                                <span>{f}</span>
                            </li>
                        ))}
                    </ol>
                </div>
            )}
        </div>
    );
}

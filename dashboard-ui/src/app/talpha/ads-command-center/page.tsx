"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import axios from "axios";
import {
    RotateCw, Satellite, Layers, AlertTriangle, ChevronDown, ChevronRight, Check, Zap,
    Target, TrendingUp, Wallet, ShoppingCart, Package, Coins, MessageSquare, Activity,
    ArrowUpRight, ArrowDownRight, Megaphone, FileSpreadsheet,
} from "lucide-react";
import { formatVNDCompact, cn } from "@/components/talpha/utils";

// ── constants ──
const ROAS_GOOD = 2.5;
// Tên TKQC KHÔNG hard-code ở đây — đọc từ response /api/talpha/realtime
// (route đọc talpha.yaml → ad_account_names, nguồn duy nhất).

// ── small UI helpers (style only — no business logic) ──
type Accent = "slate" | "purple" | "blue" | "emerald" | "amber" | "indigo" | "cyan" | "rose";
const ACCENT: Record<Accent, { ring: string; text: string; chip: string; glow: string; bar: string }> = {
    slate:   { ring: "border-slate-600/60",  text: "text-slate-100",   chip: "bg-slate-500/15 text-slate-300",   glow: "from-slate-500/10",   bar: "bg-slate-400" },
    purple:  { ring: "border-purple-500/40", text: "text-purple-300",  chip: "bg-purple-500/15 text-purple-300", glow: "from-purple-500/15",  bar: "bg-purple-400" },
    blue:    { ring: "border-blue-500/40",   text: "text-blue-300",    chip: "bg-blue-500/15 text-blue-300",     glow: "from-blue-500/15",    bar: "bg-blue-400" },
    emerald: { ring: "border-emerald-500/40",text: "text-emerald-300", chip: "bg-emerald-500/15 text-emerald-300",glow: "from-emerald-500/15", bar: "bg-emerald-400" },
    amber:   { ring: "border-amber-500/40",  text: "text-amber-300",   chip: "bg-amber-500/15 text-amber-300",   glow: "from-amber-500/15",   bar: "bg-amber-400" },
    indigo:  { ring: "border-indigo-500/40", text: "text-indigo-300",  chip: "bg-indigo-500/15 text-indigo-300", glow: "from-indigo-500/15",  bar: "bg-indigo-400" },
    cyan:    { ring: "border-cyan-500/40",   text: "text-cyan-300",    chip: "bg-cyan-500/15 text-cyan-300",     glow: "from-cyan-500/15",    bar: "bg-cyan-400" },
    rose:    { ring: "border-rose-500/40",   text: "text-rose-300",    chip: "bg-rose-500/15 text-rose-300",     glow: "from-rose-500/15",    bar: "bg-rose-400" },
};

function KpiCard({ icon: Icon, label, value, sub, accent, valueClass }: {
    icon: any; label: string; value: string; sub?: React.ReactNode; accent: Accent; valueClass?: string;
}) {
    const a = ACCENT[accent];
    return (
        <div className={cn(
            "relative overflow-hidden rounded-2xl border bg-[#111a2e]/80 p-3.5 transition-all duration-200",
            "hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/40", a.ring
        )}>
            <div className={cn("pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-full bg-gradient-to-b to-transparent blur-2xl", a.glow)} />
            <div className="relative flex items-start justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
                <span className={cn("grid h-7 w-7 place-items-center rounded-lg", a.chip)}><Icon className="h-3.5 w-3.5" /></span>
            </div>
            <div className={cn("relative mt-1.5 font-mono text-2xl font-extrabold tabular-nums", valueClass || a.text)}>{value}</div>
            {sub && <div className="relative mt-0.5 text-[10px] text-slate-500">{sub}</div>}
        </div>
    );
}

function roasTone(roas: number) {
    if (roas >= ROAS_GOOD) return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
    if (roas > 1) return "bg-amber-500/15 text-amber-300 border-amber-500/30";
    if (roas > 0) return "bg-rose-500/15 text-rose-300 border-rose-500/30";
    return "bg-slate-700/40 text-slate-500 border-slate-700";
}

function Pill({ children, className }: { children: React.ReactNode; className?: string }) {
    return <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold", className)}>{children}</span>;
}

// ── types ──
interface AdDetail {
    ad_id: string; ad_name: string; adset_name: string;
    spend_vnd: number; impressions: number; cpm_vnd: number; cpc_vnd: number; ctr: number;
    messages: number; purchases: number; orders: number; revenue_vnd: number; roas: number;
}

interface RealtimeCampaign {
    account_id: string; account_name: string; campaign_id: string; campaign_name: string;
    spend_vnd: number; impressions: number; cpm_vnd: number; ctr: number;
    messages: number; purchases: number; orders: number; revenue_vnd: number; roas: number;
    ads_count: number; ads: AdDetail[];
}

interface Summary {
    total_spend_vnd: number; total_revenue_vnd: number; total_orders: number;
    total_messages: number; matched_orders: number; unmatched_orders: number;
    total_pos_orders: number; total_meta_purchases: number; blended_roas: number;
    matched_via_adid?: number; matched_via_fallback?: number; unmatched_ambiguous?: number;
    accounts_fetched: number; shops_fetched: number;
    matched_revenue_vnd: number; unmatched_revenue_vnd: number;
    // GTC thật (giao thành công) — rule báo cáo Sheet, thay ước lượng 65%
    delivered_revenue_vnd: number; delivered_orders: number; delivered_roas: number;
}

interface RealtimeData {
    source: string; fetched_at: string; duration_ms: number;
    warnings?: string[]; // cảnh báo cap phân trang từ route (Meta 10 trang / POS 200 trang)
    accounts?: { id: string; name: string }[]; // 14 TKQC từ talpha.yaml (qua realtime route)
    summary: Summary; campaigns: RealtimeCampaign[]; unmatched_orders: any[];
    unmatched_by_shop: Record<string, { count: number; revenue_vnd: number }>;
    unmatched_by_reason?: Record<string, { count: number; revenue_vnd: number }>;
}

// Nhãn tiếng Việt cho lý do đơn CHƯA MAP được vào campaign
const UNMATCH_REASON_LABEL: Record<string, string> = {
    khong_ad_id: "Không có ad_id & không khớp fallback",
    trung_nhieu_campaign: "Trùng ≥2 campaign (không đoán)",
    marketer_ngoai_team: "Marketer ngoài team",
    thieu_page_id: "Đơn thiếu page_id",
    thieu_thi_truong: "Thiếu thị trường",
    khong_co_campaign_khop: "Không campaign nào khớp khoá",
};

// ── date helpers (ad account timezone +4 = Asia/Dubai) ──
const AD_TZ = 'Asia/Dubai';
function todayStr() { return new Date().toLocaleDateString('sv-SE', { timeZone: AD_TZ }); }
function daysAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return d.toLocaleDateString('sv-SE', { timeZone: AD_TZ }); }
const DATE_PRESETS: { label: string; from: () => string; to: () => string }[] = [
    { label: "Hôm nay", from: todayStr, to: todayStr },
    { label: "Hôm qua", from: () => daysAgo(1), to: () => daysAgo(1) },
    { label: "3 ngày", from: () => daysAgo(2), to: todayStr },
    { label: "7 ngày", from: () => daysAgo(6), to: todayStr },
    { label: "14 ngày", from: () => daysAgo(13), to: todayStr },
    { label: "30 ngày", from: () => daysAgo(29), to: todayStr },
];

export default function TALPHAAdsCommandCenterPage() {
    const [data, setData] = useState<RealtimeData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [syncedAt, setSyncedAt] = useState<Date | null>(null);
    const [selectedAccount, setSelectedAccount] = useState("all");
    const [isAccountDropdownOpen, setIsAccountDropdownOpen] = useState(false);
    const [autoRefresh, setAutoRefresh] = useState(false);
    const [expandedCampaign, setExpandedCampaign] = useState<string | null>(null);
    const [fromDate, setFromDate] = useState(todayStr());
    const [toDate, setToDate] = useState(todayStr());
    const [activePreset, setActivePreset] = useState("Hôm nay");
    const [showDatePicker, setShowDatePicker] = useState(false);
    const [exportState, setExportState] = useState<any | null>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const dateRef = useRef<HTMLDivElement>(null);
    const exportPollRef = useRef<any>(null);

    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setIsAccountDropdownOpen(false);
            }
            if (dateRef.current && !dateRef.current.contains(e.target as Node)) {
                setShowDatePicker(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const fetchData = async (fd?: string, td?: string) => {
        const f = fd || fromDate;
        const t = td || toDate;
        setLoading(true); setError(null);
        try {
            const res = await axios.get(`/api/talpha/realtime`, {
                params: { from_date: f, to_date: t },
                timeout: 60000, // longer timeout for bigger date ranges
            });
            setData(res.data); setSyncedAt(new Date());
        } catch (err: any) {
            setError(err.response?.data?.error || err.message || "Failed to fetch");
        } finally { setLoading(false); }
    };

    const applyPreset = (preset: typeof DATE_PRESETS[0]) => {
        const f = preset.from();
        const t = preset.to();
        setFromDate(f); setToDate(t);
        setActivePreset(preset.label);
        setShowDatePicker(false);
        fetchData(f, t);
    };

    const applyCustom = () => {
        setActivePreset(`${fromDate} → ${toDate}`);
        setShowDatePicker(false);
        fetchData();
    };

    useEffect(() => { fetchData(); }, []);
    useEffect(() => {
        if (!autoRefresh) return;
        const interval = setInterval(() => fetchData(), 60000);
        return () => clearInterval(interval);
    }, [autoRefresh, fromDate, toDate]);

    const campaigns = useMemo(() => {
        if (!data) return [];
        if (selectedAccount === "all") return data.campaigns;
        return data.campaigns.filter(c => c.account_id === selectedAccount);
    }, [data, selectedAccount]);

    const grouped = useMemo(() => {
        const groups: Record<string, RealtimeCampaign[]> = {};
        campaigns.forEach(c => {
            if (!groups[c.account_id]) groups[c.account_id] = [];
            groups[c.account_id].push(c);
        });
        return groups;
    }, [campaigns]);

    const summary = data?.summary;
    // Tên + danh sách TKQC lấy từ API (talpha.yaml). Fallback: account_name trong
    // campaigns (response cũ chưa có field accounts) → cuối cùng là raw id.
    const accountNames = useMemo(() => {
        const m: Record<string, string> = {};
        data?.campaigns?.forEach(c => { m[c.account_id] = c.account_name; });
        data?.accounts?.forEach(a => { m[a.id] = a.name; });
        return m;
    }, [data]);
    const getAccountName = (id: string) => accountNames[id] || id;
    const accountIds = data?.accounts?.map(a => a.id) ?? Object.keys(accountNames);

    // ── GTC thật (giao thành công) — cùng rule báo cáo Sheet (status GIAO_THANH_CONG) ──
    const deliveredRev = summary?.delivered_revenue_vnd || 0;
    const deliveredRoas = summary?.delivered_roas || 0;
    const deliveredProfit = deliveredRev - (summary?.total_spend_vnd || 0);
    const profit100 = (summary?.total_revenue_vnd || 0) - (summary?.total_spend_vnd || 0);
    const cpaMsg = summary && summary.total_messages > 0 ? summary.total_spend_vnd / summary.total_messages : 0;

    const toggleCampaign = (id: string) => {
        setExpandedCampaign(prev => prev === id ? null : id);
    };

    // ── Xuất báo cáo ra Google Sheet (chạy format_all.py qua route, poll tiến độ) ──
    const pollExport = async () => {
        try {
            const res = await axios.get("/api/talpha/export-report");
            setExportState(res.data);
            if (!res.data.running && exportPollRef.current) {
                clearInterval(exportPollRef.current);
                exportPollRef.current = null;
            }
        } catch { /* giữ trạng thái cũ, thử lại lần poll sau */ }
    };
    const startExport = async () => {
        if (exportState?.running) return;
        try {
            const res = await axios.post("/api/talpha/export-report");
            setExportState(res.data);
            if (exportPollRef.current) clearInterval(exportPollRef.current);
            if (res.data.running || res.data.started) {
                exportPollRef.current = setInterval(pollExport, 3000);
            }
        } catch (e: any) {
            setExportState({ running: false, ok: false, error: e?.response?.data?.error || e.message });
        }
    };
    useEffect(() => () => { if (exportPollRef.current) clearInterval(exportPollRef.current); }, []);

    return (
        <div className="flex h-screen flex-col overflow-hidden bg-gradient-to-b from-[#0b1120] via-[#0f172a] to-[#0b1120] font-sans text-slate-100">

            {/* ═══ HEADER ═══ */}
            <header className="z-50 flex h-14 shrink-0 items-center justify-between border-b border-white/5 bg-[#0d1426]/90 px-5 backdrop-blur-xl">
                <div className="flex items-center gap-3">
                    <h1 className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
                        <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg shadow-amber-500/30">
                            <Satellite className="h-4 w-4 text-white" />
                        </span>
                        <span className="bg-gradient-to-r from-amber-300 to-orange-400 bg-clip-text text-transparent">TALPHA ADS COMMAND</span>
                    </h1>

                    {/* Account dropdown */}
                    <div className="relative" ref={dropdownRef}>
                        <button onClick={() => setIsAccountDropdownOpen(!isAccountDropdownOpen)}
                            className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 transition hover:border-white/25 hover:bg-white/10">
                            <Layers className="h-3 w-3" />
                            {selectedAccount === "all" ? `All (${Object.keys(grouped).length})` : getAccountName(selectedAccount)}
                            <ChevronDown className={`h-3 w-3 transition ${isAccountDropdownOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {isAccountDropdownOpen && (
                            <div className="absolute left-0 top-full z-50 mt-1 max-h-96 w-64 overflow-y-auto overflow-hidden rounded-xl border border-white/10 bg-[#0d1426] shadow-2xl">
                                <button onClick={() => { setSelectedAccount("all"); setIsAccountDropdownOpen(false); }}
                                    className={`flex w-full items-center justify-between px-4 py-2.5 text-sm hover:bg-white/5 ${selectedAccount === "all" ? "bg-amber-600/20 text-amber-300" : "text-slate-300"}`}>
                                    <span>🌐 All ({accountIds.length} TKQC)</span>
                                    {selectedAccount === "all" && <Check className="h-4 w-4 text-amber-400" />}
                                </button>
                                {accountIds.map(accId => (
                                    <button key={accId} onClick={() => { setSelectedAccount(accId); setIsAccountDropdownOpen(false); }}
                                        className={`flex w-full items-center justify-between px-4 py-2 text-sm hover:bg-white/5 ${selectedAccount === accId ? "bg-amber-600/20 text-amber-300" : "text-slate-300"}`}>
                                        <div>
                                            <div className="text-xs font-medium">{getAccountName(accId)}</div>
                                            <div className="font-mono text-[9px] text-slate-500">{accId}</div>
                                        </div>
                                        {selectedAccount === accId && <Check className="h-3 w-3 text-amber-400" />}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Date Range Picker */}
                    <div className="relative" ref={dateRef}>
                        <button onClick={() => setShowDatePicker(!showDatePicker)}
                            className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 transition hover:border-white/25 hover:bg-white/10">
                            📅 {activePreset}
                            <ChevronDown className={`h-3 w-3 transition ${showDatePicker ? 'rotate-180' : ''}`} />
                        </button>
                        {showDatePicker && (
                            <div className="absolute left-0 top-full z-50 mt-1 w-72 overflow-hidden rounded-xl border border-white/10 bg-[#0d1426] shadow-2xl">
                                <div className="border-b border-white/5 p-2">
                                    <div className="mb-1.5 px-1 text-[10px] font-bold uppercase text-slate-500">Khoảng thời gian</div>
                                    <div className="grid grid-cols-3 gap-1">
                                        {DATE_PRESETS.map(p => (
                                            <button key={p.label} onClick={() => applyPreset(p)}
                                                className={cn("rounded-lg px-2 py-1.5 text-center text-xs transition",
                                                    activePreset === p.label
                                                        ? "border border-amber-500/50 bg-amber-600/30 text-amber-300"
                                                        : "bg-white/5 text-slate-300 hover:bg-white/10")}>
                                                {p.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div className="p-2">
                                    <div className="mb-1.5 px-1 text-[10px] font-bold uppercase text-slate-500">Tuỳ chỉnh</div>
                                    <div className="flex items-center gap-2">
                                        <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
                                            className="w-full rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-300" />
                                        <span className="text-xs text-slate-500">→</span>
                                        <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
                                            className="w-full rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-300" />
                                    </div>
                                    <button onClick={applyCustom}
                                        className="mt-2 w-full rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-amber-500">
                                        Áp dụng
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    <span className="flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                        <span className="relative flex h-1.5 w-1.5">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        </span>
                        LIVE • Direct API
                    </span>
                    <label className="flex cursor-pointer items-center gap-1 text-[10px] text-slate-400">
                        <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} className="h-3 w-3 accent-emerald-500" />
                        Auto 60s
                    </label>
                </div>

                <div className="flex items-center gap-3">
                    <div className="text-right text-[10px] text-slate-400">
                        <div>Synced: <span className="font-mono text-emerald-400">{syncedAt?.toLocaleTimeString() || '--'}</span></div>
                        {data && <div className="text-slate-500">{data.source} • {data.duration_ms}ms • {summary?.accounts_fetched}TK • {summary?.shops_fetched}shops</div>}
                    </div>
                    {/* Xuất báo cáo ra Google Sheet (format_all.py) */}
                    <div className="flex items-center gap-2">
                        <button onClick={startExport} disabled={exportState?.running} title="Sinh lại các file báo cáo Google Sheet (marketer + TỔNG) từ dữ liệu hiện tại"
                            className="flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-600/15 px-3 py-1.5 text-xs font-bold text-emerald-300 transition hover:bg-emerald-600/25 disabled:opacity-60">
                            <FileSpreadsheet className={`h-3 w-3 ${exportState?.running ? 'animate-pulse' : ''}`} />
                            {exportState?.running ? `Đang xuất… ${exportState.filesDone}/${exportState.totalFiles}` : 'Xuất Sheet'}
                        </button>
                        {exportState && !exportState.running && (
                            exportState.ok
                                ? <span className="text-[10px] font-semibold text-emerald-400">✓ Đã xuất {exportState.totalFiles} file</span>
                                : <span className="text-[10px] font-semibold text-rose-400" title={exportState.error || (exportState.log || []).slice(-1)[0] || ''}>✗ Lỗi xuất</span>
                        )}
                    </div>
                    <button onClick={() => fetchData()} disabled={loading}
                        className="flex items-center gap-1 rounded-lg bg-gradient-to-r from-amber-500 to-orange-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-lg shadow-amber-500/25 transition hover:brightness-110 disabled:opacity-50">
                        <RotateCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} /> SYNC
                    </button>
                </div>
            </header>

            {/* ═══ SUMMARY CARDS ═══ */}
            {summary && (
                <div className="shrink-0 space-y-3 border-b border-white/5 px-3 pb-3 pt-3">
                    {/* Row 1: Thực tế */}
                    <div>
                        <div className="mb-1.5 flex items-center gap-2 px-0.5">
                            <span className="h-3 w-1 rounded-full bg-amber-400" />
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400" title="Doanh số ĐẶT: mọi đơn (cod hoặc total_price), khác DS Giao TC của tab BigQuery">DS đặt (100% đơn)</span>
                        </div>
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                            <KpiCard icon={Wallet} accent="slate" label="Chi phí Ads" value={formatVNDCompact(summary.total_spend_vnd)} />
                            <KpiCard icon={ShoppingCart} accent="purple" label="Đơn Meta" value={String(summary.total_meta_purchases)} sub="Purchases từ Meta API" />
                            <KpiCard icon={Package} accent="blue" label="Đơn POS" value={String(summary.total_pos_orders)}
                                sub={<>Match <b className="text-emerald-400">{summary.matched_orders}</b>{summary.matched_via_fallback ? <span className="text-slate-500"> (fallback {summary.matched_via_fallback})</span> : null} · Chưa <b className="text-amber-400">{summary.unmatched_orders}</b></>} />
                            <KpiCard icon={Coins} accent="emerald" label={`DS đặt (${summary.total_pos_orders} đơn)`} value={formatVNDCompact(summary.total_revenue_vnd)}
                                sub={<>{summary.matched_orders} match + {summary.unmatched_orders} chưa match</>} />
                            <KpiCard icon={TrendingUp} accent="amber" label="ROAS blended (DS đặt)" value={`${summary.blended_roas.toFixed(2)}x`}
                                sub={<>DS đặt ÷ spend — không phải GTC</>}
                                valueClass={summary.blended_roas >= ROAS_GOOD ? "text-emerald-400" : "text-amber-300"} />
                        </div>
                    </div>

                    {/* Row 2: Messages + Giao thành công (GTC thật) */}
                    <div>
                        <div className="mb-1.5 flex items-center gap-2 px-0.5">
                            <span className="h-3 w-1 rounded-full bg-cyan-400" />
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Giao thành công (thật · GIAO_THANH_CONG)</span>
                        </div>
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                            <KpiCard icon={MessageSquare} accent="indigo" label="Messages" value={String(summary.total_messages)}
                                sub={<>CPA: {cpaMsg > 0 ? formatVNDCompact(cpaMsg) : '-'}</>} />
                            <KpiCard icon={Target} accent="cyan" label="DT Giao TC" value={formatVNDCompact(deliveredRev)}
                                sub={<>{summary.delivered_orders || 0} đơn đã giao</>} />
                            <KpiCard icon={TrendingUp} accent="cyan" label="ROAS Giao TC" value={`${deliveredRoas.toFixed(2)}x`}
                                valueClass={deliveredRoas >= ROAS_GOOD ? "text-emerald-400" : deliveredRoas > 1 ? "text-cyan-300" : "text-rose-400"} />
                            <KpiCard icon={deliveredProfit >= 0 ? ArrowUpRight : ArrowDownRight} accent={deliveredProfit >= 0 ? "cyan" : "rose"}
                                label="Lãi/Lỗ Giao TC" value={formatVNDCompact(deliveredProfit)}
                                valueClass={deliveredProfit >= 0 ? "text-cyan-300" : "text-rose-400"} />
                            <KpiCard icon={profit100 >= 0 ? ArrowUpRight : ArrowDownRight} accent={profit100 >= 0 ? "emerald" : "rose"}
                                label="Lãi/Lỗ (100%)" value={formatVNDCompact(profit100)}
                                valueClass={profit100 >= 0 ? "text-emerald-400" : "text-rose-400"} />
                        </div>
                    </div>
                </div>
            )}

            {/* ═══ MAIN CONTENT ═══ */}
            <main className="flex-1 space-y-3 overflow-auto p-3">
                {error && (
                    <div className="flex items-center gap-3 rounded-xl border border-rose-800 bg-rose-950/50 p-3 text-rose-300">
                        <AlertTriangle className="h-5 w-5 shrink-0" />
                        <div className="flex-1">
                            <div className="text-sm font-semibold">Failed to load</div>
                            <div className="text-xs text-rose-400/80">{error}</div>
                        </div>
                        <button onClick={() => fetchData()} className="rounded bg-rose-800 px-3 py-1 text-xs text-white hover:bg-rose-700">Retry</button>
                    </div>
                )}

                {/* Cảnh báo cap phân trang từ route — số đang hiển thị có thể THIẾU */}
                {data?.warnings && data.warnings.length > 0 && (
                    <div className="flex items-start gap-3 rounded-xl border border-amber-800 bg-amber-950/40 p-3 text-amber-300">
                        <AlertTriangle className="h-5 w-5 shrink-0" />
                        <div className="flex-1">
                            <div className="text-sm font-semibold">Dữ liệu có thể thiếu — chạm giới hạn phân trang</div>
                            {data.warnings.map((w, i) => <div key={i} className="text-xs text-amber-400/80">{w}</div>)}
                        </div>
                    </div>
                )}

                {loading && !data ? (
                    <div className="flex h-64 animate-pulse items-center justify-center text-lg text-slate-500">
                        <Zap className="mr-2 h-6 w-6 animate-bounce text-amber-500" />
                        Đang tải realtime từ Meta + POS...
                    </div>
                ) : Object.keys(grouped).length === 0 ? (
                    <div className="flex h-64 flex-col items-center justify-center gap-2 text-slate-500">
                        <Megaphone className="h-8 w-8 text-slate-600" />
                        <div className="text-sm">Không có campaign nào trong khoảng thời gian này</div>
                    </div>
                ) : (
                    Object.entries(grouped).map(([accId, accCampaigns]) => {
                        const accSpend = accCampaigns.reduce((s, c) => s + c.spend_vnd, 0);
                        const accRevenue = accCampaigns.reduce((s, c) => s + c.revenue_vnd, 0);
                        const accOrders = accCampaigns.reduce((s, c) => s + c.orders, 0);
                        const accPurchases = accCampaigns.reduce((s, c) => s + c.purchases, 0);
                        const accRoas = accSpend > 0 ? accRevenue / accSpend : 0;

                        return (
                            <div key={accId} className="overflow-hidden rounded-2xl border border-white/10 bg-[#111a2e]/80 shadow-xl shadow-black/30">
                                {/* Account header */}
                                <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-gradient-to-r from-[#16203a] to-[#111a2e] px-4 py-2.5">
                                    <div className="flex items-center gap-3">
                                        <div className="h-8 w-1.5 rounded-full bg-gradient-to-b from-amber-400 to-orange-500" />
                                        <div>
                                            <h2 className="text-sm font-bold uppercase tracking-wider text-white">{getAccountName(accId)}</h2>
                                            <div className="font-mono text-[9px] text-slate-500">{accId}</div>
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-1.5">
                                        <Pill className="bg-white/5 text-slate-300"><Megaphone className="h-3 w-3" />{accCampaigns.length} camp</Pill>
                                        <Pill className="bg-slate-500/15 text-slate-200"><Wallet className="h-3 w-3" />{formatVNDCompact(accSpend)}</Pill>
                                        {accPurchases > 0 && <Pill className="bg-purple-500/15 text-purple-300"><ShoppingCart className="h-3 w-3" />{accPurchases}</Pill>}
                                        {accOrders > 0 && <Pill className="bg-blue-500/15 text-blue-300"><Package className="h-3 w-3" />{accOrders}</Pill>}
                                        {accRevenue > 0 && <Pill className="bg-emerald-500/15 text-emerald-300"><Coins className="h-3 w-3" />{formatVNDCompact(accRevenue)}</Pill>}
                                        <Pill className={cn("border", roasTone(accRoas))}><TrendingUp className="h-3 w-3" />{accRoas.toFixed(2)}x</Pill>
                                    </div>
                                </div>

                                {/* Campaign table */}
                                <div className="max-h-[600px] overflow-auto">
                                    <table className="w-full text-left text-sm">
                                        <thead className="sticky top-0 z-10 bg-[#0d1426]/95 text-[10px] font-semibold uppercase text-slate-400 backdrop-blur">
                                            <tr>
                                                <th className="w-6 px-2 py-2.5"></th>
                                                <th className="px-2 py-2.5">Campaign</th>
                                                <th className="px-2 py-2.5 text-right">Spend (₫)</th>
                                                <th className="px-2 py-2.5 text-right">CPM / CTR</th>
                                                <th className="px-2 py-2.5 text-right">MSG</th>
                                                <th className="px-2 py-2.5 text-right text-indigo-300">CPA MSG</th>
                                                <th className="px-2 py-2.5 text-right text-purple-300">🛒 META</th>
                                                <th className="px-2 py-2.5 text-right text-blue-300">📦 POS</th>
                                                <th className="px-2 py-2.5 text-right text-emerald-300" title="Doanh số ĐẶT (mọi đơn) — không phải GTC">💰 DS đặt</th>
                                                <th className="px-2 py-2.5 text-right text-emerald-300" title="ROAS blended = DS đặt ÷ spend — không so trực tiếp với ROAS GTC của tab BigQuery">📈 ROAS</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {accCampaigns.map(c => {
                                                const isExpanded = expandedCampaign === c.campaign_id;
                                                return (
                                                    <>
                                                        {/* Campaign row */}
                                                        <tr key={c.campaign_id}
                                                            onClick={() => toggleCampaign(c.campaign_id)}
                                                            className={cn("group cursor-pointer border-t border-white/5 transition",
                                                                isExpanded ? "bg-amber-500/5" : "odd:bg-white/[0.015] hover:bg-white/5")}>
                                                            <td className="px-2 py-2.5 text-slate-500">
                                                                {isExpanded
                                                                    ? <ChevronDown className="h-3.5 w-3.5 text-amber-400" />
                                                                    : <ChevronRight className="h-3.5 w-3.5 group-hover:text-amber-400" />}
                                                            </td>
                                                            <td className="px-2 py-2.5">
                                                                <div className="max-w-[280px] whitespace-normal text-xs font-medium leading-tight text-white">{c.campaign_name}</div>
                                                                <div className="mt-0.5 text-[9px] text-slate-500">{c.ads_count} ads</div>
                                                            </td>
                                                            <td className="px-2 py-2.5 text-right font-mono text-xs text-slate-200">{formatVNDCompact(c.spend_vnd)}</td>
                                                            <td className="px-2 py-2.5 text-right font-mono text-[10px]">
                                                                <div className="text-slate-400">CPM {formatVNDCompact(c.cpm_vnd)}</div>
                                                                <div className="text-indigo-400">CTR {c.ctr.toFixed(2)}%</div>
                                                            </td>
                                                            <td className="px-2 py-2.5 text-right font-mono text-xs text-indigo-400">{c.messages || 0}</td>
                                                            <td className="px-2 py-2.5 text-right font-mono text-xs text-indigo-300">
                                                                {c.messages > 0 ? formatVNDCompact(c.spend_vnd / c.messages) : '-'}
                                                            </td>
                                                            <td className={cn("px-2 py-2.5 text-right font-mono font-bold", c.purchases > 0 ? 'text-purple-400' : 'text-slate-600')}>{c.purchases || 0}</td>
                                                            <td className={cn("px-2 py-2.5 text-right font-mono font-bold", c.orders > 0 ? 'text-blue-400' : 'text-slate-600')}>{c.orders}</td>
                                                            <td className={cn("px-2 py-2.5 text-right font-mono text-xs", c.revenue_vnd > 0 ? 'font-bold text-emerald-400' : 'text-slate-600')}>
                                                                {c.revenue_vnd > 0 ? formatVNDCompact(c.revenue_vnd) : '-'}
                                                            </td>
                                                            <td className="px-2 py-2.5 text-right">
                                                                {c.roas > 0
                                                                    ? <span className={cn("inline-block rounded-md border px-1.5 py-0.5 font-mono text-[11px] font-bold", roasTone(c.roas))}>{c.roas.toFixed(2)}</span>
                                                                    : <span className="text-slate-600">-</span>}
                                                            </td>
                                                        </tr>

                                                        {/* Expanded ads detail */}
                                                        {isExpanded && c.ads.map((ad: AdDetail) => (
                                                            <tr key={ad.ad_id} className="border-l-2 border-amber-500/40 bg-[#0b1120]/80">
                                                                <td className="px-2 py-1.5"></td>
                                                                <td className="px-2 py-1.5 pl-6">
                                                                    <div className="max-w-[260px] whitespace-normal text-[10px] leading-tight text-slate-300">{ad.ad_name}</div>
                                                                    <div className="text-[9px] text-slate-600">{ad.adset_name} • {ad.ad_id}</div>
                                                                </td>
                                                                <td className="px-2 py-1.5 text-right font-mono text-[10px] text-slate-400">{formatVNDCompact(ad.spend_vnd)}</td>
                                                                <td className="px-2 py-1.5 text-right font-mono text-[9px]">
                                                                    <div className="text-slate-500">CPM {formatVNDCompact(ad.cpm_vnd)}</div>
                                                                    <div className="text-indigo-400/70">CTR {ad.ctr.toFixed(2)}%</div>
                                                                </td>
                                                                <td className="px-2 py-1.5 text-right font-mono text-[10px] text-indigo-400/70">{ad.messages || 0}</td>
                                                                <td className="px-2 py-1.5 text-right font-mono text-[10px] text-indigo-300/70">
                                                                    {ad.messages > 0 ? formatVNDCompact(ad.spend_vnd / ad.messages) : '-'}
                                                                </td>
                                                                <td className={cn("px-2 py-1.5 text-right font-mono text-[10px]", ad.purchases > 0 ? 'text-purple-400' : 'text-slate-600')}>{ad.purchases || 0}</td>
                                                                <td className={cn("px-2 py-1.5 text-right font-mono text-[10px]", ad.orders > 0 ? 'font-bold text-blue-400' : 'text-slate-600')}>{ad.orders}</td>
                                                                <td className={cn("px-2 py-1.5 text-right font-mono text-[10px]", ad.revenue_vnd > 0 ? 'text-emerald-400' : 'text-slate-600')}>
                                                                    {ad.revenue_vnd > 0 ? formatVNDCompact(ad.revenue_vnd) : '-'}
                                                                </td>
                                                                <td className={cn("px-2 py-1.5 text-right font-mono text-[10px]",
                                                                    ad.roas >= ROAS_GOOD ? 'text-emerald-400' : ad.roas > 0 ? 'text-rose-400' : 'text-slate-600')}>
                                                                    {ad.roas > 0 ? ad.roas.toFixed(2) : '-'}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        );
                    })
                )}

                {/* Unmatched Orders */}
                {data && data.unmatched_by_shop && Object.keys(data.unmatched_by_shop).length > 0 && (
                    <div className="rounded-2xl border border-white/10 bg-[#111a2e]/80 p-3">
                        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold text-amber-400">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            Đơn CHƯA MAP được (không gán bừa) — {data.summary.unmatched_orders} đơn • {formatVNDCompact(data.summary.unmatched_revenue_vnd)}
                        </h3>

                        {/* Lý do chưa map — để soi, không đoán */}
                        {data.unmatched_by_reason && Object.keys(data.unmatched_by_reason).length > 0 && (
                            <div className="mb-3">
                                <div className="mb-1 text-[10px] font-bold uppercase text-slate-500">Lý do</div>
                                <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-3">
                                    {Object.entries(data.unmatched_by_reason)
                                        .sort(([, a], [, b]) => b.count - a.count)
                                        .map(([reason, info]) => (
                                            <div key={reason} className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-2.5">
                                                <div className="text-[11px] font-semibold text-amber-200">{UNMATCH_REASON_LABEL[reason] || reason}</div>
                                                <div className="mt-0.5 text-[10px] text-slate-400">{info.count} đơn • {formatVNDCompact(info.revenue_vnd)}</div>
                                            </div>
                                        ))}
                                </div>
                            </div>
                        )}

                        <div className="mb-1 text-[10px] font-bold uppercase text-slate-500">Theo thị trường</div>
                        <div className="grid grid-cols-3 gap-2 text-xs md:grid-cols-6">
                            {Object.entries(data.unmatched_by_shop)
                                .sort(([, a], [, b]) => b.revenue_vnd - a.revenue_vnd)
                                .map(([shop, info]) => (
                                    <div key={shop} className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5 transition hover:border-amber-500/30">
                                        <div className="text-xs font-bold text-white">{shop}</div>
                                        <div className="font-mono text-sm font-bold text-emerald-400">{formatVNDCompact(info.revenue_vnd)}</div>
                                        <div className="text-[10px] text-slate-500">{info.count} đơn</div>
                                    </div>
                                ))}
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}

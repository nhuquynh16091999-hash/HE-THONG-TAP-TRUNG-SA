"use client";

import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { RefreshCw, AlertTriangle, Store, PackageX, Clock, Download } from "lucide-react";
import TabSkeleton, { ErrorState } from "@/components/ui/tab-skeleton";
import { formatNumber, cn } from "../utils";

interface Props { dateRange?: { from: Date; to: Date }; projectId?: string }

type Shipment = {
    tracking: string; order_uid: string | null; order_id: string; order_date: string | null;
    customer: string; phone: string; marketer: string | null; sale: string | null;
    cod_local: number; status: string | null; sub_status: string | null;
    status_since: string | null; last_event_time: string | null; last_event: string | null;
    registered: boolean;
};
type Alert = {
    level: "gap" | "canh_bao" | "nhac";
    code: string; title: string; detail: string; days: number | null; shipment: Shipment;
};

const TWD = (n: number) => `${Math.round(n).toLocaleString("vi-VN")} $`;

const STATUS_VI: Record<string, string> = {
    NotFound: "Chưa có thông tin", InfoReceived: "Đã tạo vận đơn", InTransit: "Đang vận chuyển",
    Expired: "Quá hạn theo dõi", AvailableForPickup: "Đã tới cửa hàng", OutForDelivery: "Đang giao",
    DeliveryFailure: "Giao hỏng", Delivered: "Đã giao", Exception: "Sự cố",
};
const STATUS_STYLE: Record<string, string> = {
    AvailableForPickup: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
    Delivered: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
    DeliveryFailure: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400",
    Exception: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400",
    InTransit: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400",
    OutForDelivery: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400",
};
const LEVEL_STYLE = {
    gap: { bar: "bg-rose-500", chip: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400", label: "Gấp" },
    canh_bao: { bar: "bg-amber-500", chip: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400", label: "Cảnh báo" },
    nhac: { bar: "bg-slate-300 dark:bg-slate-600", chip: "bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-400", label: "Nhắc" },
} as const;

export default function TALPHATrackingTab({ dateRange }: Props) {
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [error, setError] = useState("");
    const [syncMsg, setSyncMsg] = useState("");
    const [shipments, setShipments] = useState<Shipment[]>([]);
    const [alerts, setAlerts] = useState<Alert[]>([]);
    const [counts, setCounts] = useState<Record<string, number>>({});
    const [totals, setTotals] = useState({ shipments: 0, registered: 0, pending_register: 0, at_store_value: 0 });
    const [hasKey, setHasKey] = useState(true);
    const [cfg, setCfg] = useState({ pickup_expire_days: 7, warn_before_expire_days: 2, stale_days: 21 });
    const [tab, setTab] = useState<"alerts" | "all">("alerts");

    const from = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : "2026-01-01";
    const to = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

    const load = useCallback(async () => {
        setLoading(true); setError("");
        try {
            const res = await fetch(`/api/talpha/tracking?from=${from}&to=${to}`);
            const d = await res.json();
            if (!res.ok) throw new Error(d.error || "Không tải được vận đơn");
            setShipments(d.shipments || []); setAlerts(d.alerts || []);
            setCounts(d.counts || {}); setTotals(d.totals);
            setHasKey(d.has_api_key); setCfg(d.config);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Lỗi không rõ");
        } finally { setLoading(false); }
    }, [from, to]);

    useEffect(() => { load(); }, [load]);

    const sync = async () => {
        setSyncing(true); setSyncMsg(""); setError("");
        try {
            const res = await fetch(`/api/talpha/tracking?from=${from}&to=${to}`, { method: "POST" });
            const d = await res.json();
            if (!res.ok) throw new Error(d.error || "Đồng bộ thất bại");
            setSyncMsg(
                `Đăng ký mới ${d.registered} mã · kiểm tra ${d.checked} mã · ${d.status_changed} mã đổi trạng thái` +
                (d.register_rejected?.length ? ` · ${d.register_rejected.length} mã bị từ chối` : ""));
            await load();
        } catch (e) {
            setError(e instanceof Error ? e.message : "Đồng bộ thất bại");
        } finally { setSyncing(false); }
    };

    const exportCsv = () => {
        const head = ["Mã đơn", "Mã vận đơn", "Ngày đơn", "Trạng thái", "Từ ngày", "COD (TWD)",
            "Khách", "SĐT", "Marketer", "Sale", "Sự kiện cuối"];
        const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
        const body = shipments.map((s) => [
            s.order_id, s.tracking, s.order_date || "", STATUS_VI[s.status || ""] || "chưa rõ",
            s.status_since?.slice(0, 10) || "", s.cod_local, s.customer, s.phone,
            s.marketer || "", s.sale || "", s.last_event || "",
        ].map(esc).join(","));
        const blob = new Blob(["﻿" + [head.map(esc).join(","), ...body].join("\n")],
            { type: "text/csv;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `van-don_${from}_${to}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    if (loading && !shipments.length) return <TabSkeleton cards={4} rows={8} showChart={false} />;
    if (error && !shipments.length) return <ErrorState message={error} onRetry={load} />;

    const urgent = alerts.filter((a) => a.level === "gap");
    const atStore = counts.AvailableForPickup || 0;

    return (
        <div className="space-y-5">
            {!hasKey && (
                <div className="flex gap-3 rounded-xl border-l-4 border-amber-500 bg-amber-50 p-4 text-sm dark:bg-amber-500/10">
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-amber-600 dark:text-amber-400" />
                    <div className="text-amber-900 dark:text-amber-200">
                        <div className="font-medium">Chưa có khoá 17TRACK</div>
                        <p className="mt-1 text-amber-800/80 dark:text-amber-200/70">
                            Lấy khoá ở <span className="font-mono">17track.net/en/api</span> rồi điền
                            <span className="font-mono"> TRACK17_API_KEY</span> vào <span className="font-mono">dashboard-ui/.env.local</span>.
                            Chưa có khoá thì bảng dưới vẫn liệt kê được vận đơn, chỉ chưa biết trạng thái.
                        </p>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat icon={<Store className="h-4 w-4" />} label="Đang ở cửa hàng"
                    value={formatNumber(atStore)} sub={`${TWD(totals.at_store_value)} tiền hàng đang chờ khách lấy`}
                    tone={atStore > 0 ? "warn" : undefined} />
                <Stat icon={<AlertTriangle className="h-4 w-4" />} label="Sắp bị trả về"
                    value={formatNumber(urgent.length)} sub={`quá ${cfg.pickup_expire_days - cfg.warn_before_expire_days} ngày chưa ai lấy`}
                    tone={urgent.length > 0 ? "bad" : undefined} />
                <Stat icon={<PackageX className="h-4 w-4" />} label="Giao hỏng · sự cố"
                    value={formatNumber((counts.DeliveryFailure || 0) + (counts.Exception || 0))} sub="cần người xử lý" />
                <Stat icon={<Clock className="h-4 w-4" />} label="Tổng vận đơn"
                    value={formatNumber(totals.shipments)}
                    sub={totals.pending_register > 0
                        ? `${totals.pending_register} mã chưa đăng ký theo dõi`
                        : "đã đăng ký theo dõi hết"} />
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-lg border border-border bg-muted/40 p-1">
                    {([["alerts", `Cần xử lý (${alerts.length})`], ["all", `Tất cả vận đơn (${shipments.length})`]] as const).map(([id, label]) => (
                        <button key={id} onClick={() => setTab(id)}
                            className={cn("rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                                tab === id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                            {label}
                        </button>
                    ))}
                </div>
                <button onClick={sync} disabled={syncing || !hasKey}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50">
                    <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
                    {syncing ? "Đang đồng bộ…" : "Đồng bộ 17TRACK"}
                </button>
                <button onClick={exportCsv} disabled={!shipments.length}
                    className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-40">
                    <Download className="h-3.5 w-3.5" /> Xuất CSV
                </button>
            </div>

            {syncMsg && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">{syncMsg}</p>}
            {error && shipments.length > 0 && (
                <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{error}</p>
            )}

            {tab === "alerts" ? (
                <div className="rounded-xl border border-border bg-card shadow-sm">
                    {alerts.length === 0 ? (
                        <p className="px-4 py-12 text-center text-muted-foreground">
                            Không có vận đơn nào cần xử lý.
                        </p>
                    ) : (
                        <div className="divide-y divide-border">
                            {alerts.map((a, i) => {
                                const st = LEVEL_STYLE[a.level];
                                const s = a.shipment;
                                return (
                                    <div key={`${s.tracking}-${i}`} className="grid grid-cols-[4px_1fr] gap-4 p-4">
                                        <span className={cn("rounded-sm", st.bar)} />
                                        <div>
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", st.chip)}>{st.label}</span>
                                                <span className="font-medium">{a.title}</span>
                                                <span className="font-mono text-xs text-muted-foreground">#{s.order_id}</span>
                                                {s.cod_local > 0 && (
                                                    <span className="font-mono text-xs tabular-nums text-muted-foreground">{TWD(s.cod_local)}</span>
                                                )}
                                            </div>
                                            <p className="mt-1 text-sm text-muted-foreground">{a.detail}</p>
                                            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                                <span>{s.customer || "—"}{s.phone ? ` · ${s.phone}` : ""}</span>
                                                <span className="font-mono">{s.tracking}</span>
                                                {s.marketer && <span>mkt {s.marketer}</span>}
                                                {s.sale && <span>sale {s.sale}</span>}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            ) : (
                <div className="rounded-xl border border-border bg-card shadow-sm">
                    <div className="max-h-[560px] overflow-auto">
                        <table className="w-full min-w-[880px] text-sm">
                            <thead className="sticky top-0 bg-card">
                                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                                    <th className="px-3 py-2.5 text-left font-medium">Mã đơn</th>
                                    <th className="px-3 py-2.5 text-left font-medium">Vận đơn</th>
                                    <th className="px-3 py-2.5 text-left font-medium">Trạng thái</th>
                                    <th className="px-3 py-2.5 text-right font-medium">COD</th>
                                    <th className="px-3 py-2.5 text-left font-medium">Khách</th>
                                    <th className="px-3 py-2.5 text-left font-medium">Sale</th>
                                    <th className="px-3 py-2.5 text-left font-medium">Sự kiện cuối</th>
                                </tr>
                            </thead>
                            <tbody>
                                {shipments.map((s) => (
                                    <tr key={s.tracking} className="border-b border-border/40 last:border-0 hover:bg-muted/40">
                                        <td className="px-3 py-2 font-mono text-xs">{s.order_id}</td>
                                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{s.tracking}</td>
                                        <td className="px-3 py-2">
                                            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium",
                                                STATUS_STYLE[s.status || ""] || "bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-400")}>
                                                {STATUS_VI[s.status || ""] || (s.registered ? "chưa có tin" : "chưa đăng ký")}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2 text-right font-mono tabular-nums">{s.cod_local ? TWD(s.cod_local) : "—"}</td>
                                        <td className="px-3 py-2">
                                            <div className="max-w-[160px] truncate">{s.customer || "—"}</div>
                                            <div className="text-xs text-muted-foreground">{s.phone}</div>
                                        </td>
                                        <td className={cn("px-3 py-2", !s.sale && "text-muted-foreground")}>{s.sale || "—"}</td>
                                        <td className="px-3 py-2 text-xs text-muted-foreground">
                                            <div className="max-w-[240px] truncate">{s.last_event || "—"}</div>
                                        </td>
                                    </tr>
                                ))}
                                {!shipments.length && (
                                    <tr><td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">
                                        Không có đơn nào có mã vận đơn trong kỳ này.
                                    </td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            <p className="text-xs text-muted-foreground">
                Chỉ theo dõi đơn đã gửi đi, bỏ qua đơn huỷ và đơn thô để không phí quota.
                Đăng ký mỗi mã vận đơn tốn quota <b>một lần</b>; sau đó cập nhật trạng thái miễn phí.
                Mốc “sắp bị trả về” tính theo <span className="font-mono">{cfg.pickup_expire_days}</span> ngày —
                sửa ở <span className="font-mono">talpha_rules.json → tracking.pickup_expire_days</span> nếu hãng vận chuyển quy định khác.
            </p>
        </div>
    );
}

function Stat({ icon, label, value, sub, tone }: {
    icon: React.ReactNode; label: string; value: string; sub?: string; tone?: "warn" | "bad";
}) {
    return (
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                {icon}{label}
            </div>
            <div className={cn("mt-1 text-2xl font-semibold tabular-nums",
                tone === "warn" && "text-amber-600 dark:text-amber-400",
                tone === "bad" && "text-rose-600 dark:text-rose-400")}>{value}</div>
            {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
        </div>
    );
}

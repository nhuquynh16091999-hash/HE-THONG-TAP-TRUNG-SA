"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { AlertTriangle, Download, Search, RefreshCw } from "lucide-react";
import TabSkeleton, { ErrorState } from "@/components/ui/tab-skeleton";
import { formatNumber, cn } from "../utils";

interface Props { dateRange?: { from: Date; to: Date }; projectId?: string }

type Light = "xanh" | "vang" | "do" | "xam";

type Row = {
    order_no: string; tracking: string; track17_code: string; return_order_no: string;
    order_date: string; ship_date: string; age_days: number | null;
    ship_method: string; sku: string; product_codes: string[]; quantity: number;
    contact_name: string; phone: string; marketer: string;
    status: string; status_raw: string; recon_manual: string;
    cod_twd: number; paid_twd: number | null; paid_date: string; paid_period: string;
    matched_by: "tracking" | "order_id_giao_lai" | null; diff_twd: number | null;
    ship_fee_rmb: number | null; op_fee_rmb: number | null; fee_wrong: boolean;
    cogs_vnd: number | null; cogs_missing: string[];
    gross_vnd: number | null; fee_vnd: number | null;
    net_vnd: number | null; net_before_cogs: boolean;
    tick: { doi_soat: boolean; tru_van_chuyen: boolean; tru_tien_hang: boolean };
    light: Light; light_note: string;
};

type Summary = {
    total: number; by_light: Record<Light, number>;
    cod_total_twd: number; paid_total_twd: number;
    pending_twd: number; overdue_twd: number; fee_total_rmb: number;
    cogs_known: number; cogs_missing_orders: number;
    net_total_vnd: number; net_partial_vnd: number; extra_lines: number;
};

const TWD = (n: number) => `${Math.round(n).toLocaleString("vi-VN")} $`;
const VND = (n: number) => `${Math.round(n).toLocaleString("vi-VN")} đ`;
const RMB = (n: number) => `${Math.round(n).toLocaleString("vi-VN")} ¥`;

/** Bốn đèn, và mỗi đèn nói MỘT việc phải làm — không phải bốn sắc thái của
 *  cùng một trạng thái. Đó là lý do dùng màu chứ không dùng chữ. */
const LIGHTS: { id: Light | "all"; label: string; hint: string; dot: string }[] = [
    { id: "all",  label: "Tất cả",  hint: "", dot: "bg-muted-foreground" },
    { id: "do",   label: "Phải xử", hint: "quá hạn hoặc lệch tiền", dot: "bg-rose-500" },
    { id: "vang", label: "Đang chờ", hint: "đã giao, tiền chưa về", dot: "bg-amber-500" },
    { id: "xanh", label: "Xong sạch", hint: "tiền đã về, khớp số", dot: "bg-emerald-500" },
    { id: "xam",  label: "Không đòi", hint: "hoàn, huỷ, chưa giao", dot: "bg-slate-400" },
];
const DOT: Record<Light, string> = {
    xanh: "bg-emerald-500", vang: "bg-amber-500", do: "bg-rose-500", xam: "bg-slate-400",
};
const ROWTINT: Record<Light, string> = {
    do: "bg-rose-50/60 dark:bg-rose-500/[0.07]",
    vang: "bg-amber-50/50 dark:bg-amber-500/[0.06]",
    xanh: "", xam: "opacity-60",
};

/** Ô tích: ✓ xanh khi xong, ô trống nét đứt khi chưa.
 *
 *  Cố ý KHÔNG dùng ✗ đỏ — "chưa làm" khác hẳn "làm sai", để lẫn hai thứ thì cả
 *  bảng đỏ lòm và người đọc hết phân biệt được đâu là việc thật sự hỏng.
 *
 *  Ô chưa tích render RỖNG chứ không phải dấu ✓ bị làm trong suốt: chữ ẩn kiểu
 *  đó vẫn bị chép ra khi bôi đen, và trình đọc màn hình vẫn đọc thành "đã tích". */
function Tick({ on, title }: { on: boolean; title: string }) {
    return (
        <span title={title} role="img" aria-label={`${title} — ${on ? "đã xong" : "chưa"}`}
            className={cn(
                "inline-flex h-5 w-5 items-center justify-center rounded-[5px] text-[11px] font-bold",
                on ? "bg-emerald-500 text-white" : "border border-dashed border-border")}>
            {on ? "✓" : ""}
        </span>
    );
}

export default function TALPHAOrderLedgerTab({ dateRange }: Props) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [rows, setRows] = useState<Row[]>([]);
    const [summary, setSummary] = useState<Summary | null>(null);
    const [warnings, setWarnings] = useState<string[]>([]);
    const [filter, setFilter] = useState<Light | "all">("do");
    const [q, setQ] = useState("");

    const to = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

    const load = useCallback(async () => {
        setLoading(true); setError("");
        try {
            const res = await fetch(`/api/talpha/order-ledger?to=${to}`);
            const d = await res.json();
            if (!res.ok) throw new Error(d.error || "Không dựng được sổ");
            setRows(d.rows || []);
            setSummary(d.summary || null);
            setWarnings(d.warnings || []);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Lỗi không rõ");
        } finally { setLoading(false); }
    }, [to]);

    useEffect(() => { load(); }, [load]);

    const shown = useMemo(() => {
        const needle = q.trim().toLowerCase();
        return rows.filter((r) => {
            if (filter !== "all" && r.light !== filter) return false;
            if (!needle) return true;
            return [r.order_no, r.tracking, r.track17_code, r.contact_name, r.phone, r.sku, r.marketer]
                .some((v) => String(v || "").toLowerCase().includes(needle));
        });
    }, [rows, filter, q]);

    const exportCsv = () => {
        const head = ["Đèn", "Đối soát (tay)", "Trạng thái", "Ngày lên đơn", "Ngày xuất kho",
            "PTVC", "Order No", "Tracking", "Mã đơn hoàn", "Mã 17TRACK", "SKU", "SL",
            "Tên khách", "Điện thoại", "Marketer", "COD (NT$)", "3PL trả (NT$)", "Lệch",
            "Phí ship (¥)", "Phí thao tác (¥)", "Giá vốn (đ)", "Còn lại (đ)", "Ghi chú"];
        const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
        const body = shown.map((r) => [
            r.light, r.recon_manual, r.status_raw, r.order_date, r.ship_date,
            r.ship_method, r.order_no, r.tracking, r.return_order_no, r.track17_code,
            r.sku, r.quantity, r.contact_name, r.phone, r.marketer,
            r.cod_twd, r.paid_twd ?? "", r.diff_twd ?? "",
            r.ship_fee_rmb ?? "", r.op_fee_rmb ?? "", r.cogs_vnd ?? "",
            r.net_vnd === null ? "" : Math.round(r.net_vnd),
            r.net_before_cogs ? "chưa trừ giá vốn" : r.light_note,
        ].map(esc).join(","));
        const blob = new Blob(["﻿" + [head.map(esc).join(","), ...body].join("\n")],
            { type: "text/csv;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `so-don-hang_${to}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    if (loading && !summary) return <TabSkeleton cards={4} rows={10} showChart={false} />;
    if (error) return <ErrorState message={error} onRetry={load} />;

    const count = (l: Light) => rows.filter((r) => r.light === l).length;

    return (
        <div className="space-y-5">
            {warnings.map((w) => (
                <div key={w} className="flex gap-3 rounded-xl border-l-4 border-amber-500 bg-amber-50 p-4 text-sm dark:bg-amber-500/10">
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-amber-600 dark:text-amber-400" />
                    <p className="text-amber-900 dark:text-amber-200">{w}</p>
                </div>
            ))}

            {summary && (
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <Stat label="Phải xử ngay" value={TWD(summary.overdue_twd)}
                        sub={`${formatNumber(summary.by_light.do)} đơn quá hạn hoặc lệch tiền`}
                        tone={summary.by_light.do ? "bad" : undefined} />
                    <Stat label="Đang chờ tiền về" value={TWD(summary.pending_twd)}
                        sub={`${formatNumber(summary.by_light.vang)} đơn đã giao, sao kê chưa có`} tone="warn" />
                    <Stat label="Còn lại — đã trừ đủ" value={VND(summary.net_total_vnd)}
                        sub={`${formatNumber(summary.cogs_known)} đơn tính được giá vốn`} tone="good" />
                    <Stat label="Còn lại — chưa trừ giá vốn" value={VND(summary.net_partial_vnd)}
                        sub={`${formatNumber(summary.cogs_missing_orders)} đơn còn thiếu khai giá`} />
                </div>
            )}

            {/* ── Lọc theo đèn ── */}
            <div className="flex flex-wrap items-center gap-2">
                {LIGHTS.map((l) => {
                    const n = l.id === "all" ? rows.length : count(l.id as Light);
                    const on = filter === l.id;
                    return (
                        <button key={l.id} onClick={() => setFilter(l.id)} title={l.hint}
                            className={cn("inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition",
                                on ? "border-orange-500 bg-orange-50 font-medium text-orange-700 dark:bg-orange-500/10 dark:text-orange-300"
                                   : "border-border hover:bg-muted")}>
                            <span className={cn("h-2 w-2 rounded-full", l.dot)} />
                            {l.label}
                            <span className="tabular-nums text-muted-foreground">{formatNumber(n)}</span>
                        </button>
                    );
                })}

                <div className="relative ml-auto">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input value={q} onChange={(e) => setQ(e.target.value)}
                        placeholder="Tìm mã đơn, vận đơn, tên, SĐT, SKU, marketer…"
                        className="w-64 rounded-lg border border-border bg-card py-1.5 pl-8 pr-3 text-sm" />
                </div>
                <button onClick={load} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-sm hover:bg-muted">
                    <RefreshCw className="h-3.5 w-3.5" /> Tải lại
                </button>
                <button onClick={exportCsv} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-sm hover:bg-muted">
                    <Download className="h-3.5 w-3.5" /> Xuất CSV
                </button>
            </div>

            {/* ── Bảng ── */}
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
                <table className="w-full min-w-[1680px] text-sm">
                    <thead>
                        {/* Gộp nhóm cột: 20 cột phẳng thì không ai đọc nổi đâu là đâu. */}
                        <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                            <th className="px-3 py-2 text-left" colSpan={3}>Trạng thái</th>
                            <th className="border-l border-border px-3 py-2 text-left" colSpan={2}>Thời gian</th>
                            <th className="border-l border-border px-3 py-2 text-left" colSpan={5}>Định danh đơn</th>
                            <th className="border-l border-border px-3 py-2 text-left" colSpan={5}>Hàng · khách · người chạy</th>
                            <th className="border-l border-border px-3 py-2 text-right" colSpan={6}>Tiền</th>
                        </tr>
                        <tr className="border-b border-border text-[11px] font-medium text-muted-foreground">
                            <th className="w-8 px-3 py-2"></th>
                            <th className="px-3 py-2 text-left">Trạng thái</th>
                            <th className="px-3 py-2 text-left">Đối soát</th>
                            <th className="border-l border-border px-3 py-2 text-left">Lên đơn</th>
                            <th className="px-3 py-2 text-left">Xuất kho</th>
                            <th className="border-l border-border px-3 py-2 text-left">PTVC</th>
                            <th className="px-3 py-2 text-left">Order No</th>
                            <th className="px-3 py-2 text-left">Tracking</th>
                            <th className="px-3 py-2 text-left">Mã đơn hoàn</th>
                            <th className="px-3 py-2 text-left">17TRACK</th>
                            <th className="border-l border-border px-3 py-2 text-left">SKU</th>
                            <th className="px-3 py-2 text-right">SL</th>
                            <th className="px-3 py-2 text-left">Tên khách</th>
                            <th className="px-3 py-2 text-left">Điện thoại</th>
                            <th className="px-3 py-2 text-left">Marketer</th>
                            <th className="border-l border-border px-3 py-2 text-right">COD</th>
                            <th className="px-3 py-2 text-center">Đã đối soát</th>
                            <th className="px-3 py-2 text-center">Trừ vận chuyển</th>
                            <th className="px-3 py-2 text-center">Trừ tiền hàng</th>
                            <th className="px-3 py-2 text-right">Còn lại</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {shown.slice(0, 400).map((r) => (
                            <tr key={r.tracking + r.order_no} className={cn("hover:bg-muted/40", ROWTINT[r.light])}>
                                <td className="px-3 py-2">
                                    <span title={r.light_note}
                                        className={cn("inline-block h-2.5 w-2.5 rounded-full", DOT[r.light])} />
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap">{r.status_raw || "—"}</td>
                                <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{r.recon_manual || "—"}</td>
                                <td className="border-l border-border px-3 py-2 whitespace-nowrap tabular-nums">{r.order_date || "—"}</td>
                                <td className="px-3 py-2 whitespace-nowrap tabular-nums text-muted-foreground">{r.ship_date || "—"}</td>
                                <td className="border-l border-border px-3 py-2 whitespace-nowrap text-xs">{r.ship_method || "—"}</td>
                                <td className="px-3 py-2 whitespace-nowrap font-medium">{r.order_no}</td>
                                <td className="px-3 py-2 whitespace-nowrap font-mono text-xs">{r.tracking}</td>
                                <td className="px-3 py-2 whitespace-nowrap font-mono text-xs text-muted-foreground">{r.return_order_no || "—"}</td>
                                <td className="px-3 py-2 whitespace-nowrap font-mono text-xs text-muted-foreground">{r.track17_code || "—"}</td>
                                <td className="border-l border-border px-3 py-2">
                                    <span className="block max-w-[190px] truncate" title={r.sku}>{r.sku || "—"}</span>
                                    {r.cogs_missing.length > 0 && (
                                        <span className="text-[10px] text-amber-600 dark:text-amber-400">
                                            chưa khai giá: {r.cogs_missing.join(", ")}
                                        </span>
                                    )}
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums">{r.quantity}</td>
                                <td className="px-3 py-2 whitespace-nowrap">{r.contact_name || "—"}</td>
                                <td className="px-3 py-2 whitespace-nowrap font-mono text-xs">{r.phone || "—"}</td>
                                <td className="px-3 py-2 whitespace-nowrap">{r.marketer || "—"}</td>

                                <td className="border-l border-border px-3 py-2 text-right tabular-nums">
                                    {TWD(r.cod_twd)}
                                    {r.diff_twd !== null && Math.abs(r.diff_twd) > 1 && (
                                        <span className="block text-[10px] font-medium text-rose-600 dark:text-rose-400">
                                            3PL trả {TWD(r.paid_twd ?? 0)}
                                        </span>
                                    )}
                                </td>
                                <td className="px-3 py-2 text-center">
                                    <Tick on={r.tick.doi_soat}
                                        title={r.tick.doi_soat
                                            ? `Đã có trên sao kê ${r.paid_period}${r.matched_by === "order_id_giao_lai" ? " (đơn giao lại)" : ""}`
                                            : "Sao kê chưa nhắc tới đơn này"} />
                                </td>
                                <td className="px-3 py-2 text-center">
                                    <Tick on={r.tick.tru_van_chuyen}
                                        title={r.ship_fee_rmb === null ? "Chưa thấy trên bảng phí"
                                            : `Ship ${RMB(r.ship_fee_rmb)} + thao tác ${RMB(r.op_fee_rmb ?? 0)}${r.fee_wrong ? " — SAI bảng giá" : ""}`} />
                                    {r.fee_wrong && <span className="ml-1 text-[10px] font-bold text-rose-600">!</span>}
                                </td>
                                <td className="px-3 py-2 text-center">
                                    <Tick on={r.tick.tru_tien_hang}
                                        title={r.cogs_vnd === null
                                            ? `Chưa khai giá vốn cho mã ${r.cogs_missing.join(", ") || "(không rõ mã)"}`
                                            : `Giá vốn ${VND(r.cogs_vnd)}`} />
                                </td>
                                <td className="px-3 py-2 text-right">
                                    {r.net_vnd === null ? (
                                        <span className="text-muted-foreground">—</span>
                                    ) : (
                                        <>
                                            <span className={cn("font-semibold tabular-nums",
                                                r.net_vnd < 0 && "text-rose-600 dark:text-rose-400")}>
                                                {VND(r.net_vnd)}
                                            </span>
                                            {r.net_before_cogs && (
                                                <span className="block text-[10px] text-amber-600 dark:text-amber-400">
                                                    trước giá vốn
                                                </span>
                                            )}
                                        </>
                                    )}
                                </td>
                            </tr>
                        ))}
                        {!shown.length && (
                            <tr><td colSpan={20} className="px-3 py-10 text-center text-muted-foreground">
                                Không có đơn nào trong nhóm này.
                            </td></tr>
                        )}
                    </tbody>
                </table>
                {shown.length > 400 && (
                    <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
                        Hiện 400 dòng đầu trong {formatNumber(shown.length)} — xuất CSV để xem đủ.
                    </p>
                )}
            </div>

            <p className="text-xs leading-relaxed text-muted-foreground">
                <b>Đèn</b> nói việc phải làm, không phải trạng thái giao hàng:
                <span className="mx-1 inline-block h-2 w-2 rounded-full bg-rose-500" /><b>đỏ</b> = đi đòi hoặc soi lệch ·
                <span className="mx-1 inline-block h-2 w-2 rounded-full bg-amber-500" /><b>vàng</b> = chờ đúng nhịp ·
                <span className="mx-1 inline-block h-2 w-2 rounded-full bg-emerald-500" /><b>xanh</b> = xong ·
                <span className="mx-1 inline-block h-2 w-2 rounded-full bg-slate-400" /><b>xám</b> = không đòi được (hoàn, huỷ, chưa giao).
                <br />
                <b>Còn lại</b> = tiền 3PL trả (quy VND theo tỷ giá của chính kỳ đó) − phí vận chuyển − phí thao tác − giá vốn.
                Đơn nào ghi <b>“trước giá vốn”</b> là chưa trừ được vì mã sản phẩm chưa khai giá — con số đó đang <b>cao hơn thật</b>.
            </p>
        </div>
    );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" | "warn" }) {
    return (
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
            <div className={cn("mt-1 text-2xl font-semibold tabular-nums",
                tone === "good" && "text-emerald-600 dark:text-emerald-400",
                tone === "bad" && "text-rose-600 dark:text-rose-400",
                tone === "warn" && "text-amber-600 dark:text-amber-400")}>{value}</div>
            {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
        </div>
    );
}

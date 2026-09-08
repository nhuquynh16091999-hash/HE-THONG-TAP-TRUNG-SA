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

const TWD = (n: number) => `${Math.round(n).toLocaleString("vi-VN")}$`;
const VND = (n: number) => `${Math.round(n).toLocaleString("vi-VN")}đ`;
const RMB = (n: number) => `${Math.round(n).toLocaleString("vi-VN")}¥`;
const shortDate = (d: string) => (d ? d.slice(8, 10) + "/" + d.slice(5, 7) : "—");

// ─────────────────────────────────────────────────────────────────────────
// Bảng màu
// ─────────────────────────────────────────────────────────────────────────

/** Đèn nói VIỆC PHẢI LÀM, không phải trạng thái giao hàng. Bốn màu, bốn việc. */
const LIGHTS: { id: Light | "all"; label: string; hint: string; ring: string; dot: string }[] = [
    { id: "all", label: "Tất cả", hint: "", ring: "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-600 dark:bg-slate-500/10 dark:text-slate-300", dot: "bg-slate-400" },
    { id: "do", label: "Phải xử", hint: "quá hạn hoặc lệch tiền", ring: "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300", dot: "bg-rose-500" },
    { id: "vang", label: "Đang chờ", hint: "đã giao, tiền chưa về", ring: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300", dot: "bg-amber-500" },
    { id: "xanh", label: "Xong sạch", hint: "tiền đã về, khớp số", ring: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300", dot: "bg-emerald-500" },
    { id: "xam", label: "Không đòi", hint: "hoàn, huỷ, chưa giao", ring: "border-slate-300 bg-slate-50 text-slate-600 dark:border-slate-600 dark:bg-slate-500/10 dark:text-slate-400", dot: "bg-slate-400" },
];

/** Vạch màu ở mép trái mỗi dòng — thứ duy nhất còn thấy được khi cuộn ngang,
 *  nên nó phải mang thông tin quan trọng nhất: dòng này có phải xử không. */
const STRIPE: Record<Light, string> = {
    do: "bg-rose-500", vang: "bg-amber-400", xanh: "bg-emerald-500", xam: "bg-slate-300 dark:bg-slate-600",
};
const ROWBG: Record<Light, string> = {
    do: "bg-rose-50/70 hover:bg-rose-50 dark:bg-rose-500/[0.08] dark:hover:bg-rose-500/[0.13]",
    vang: "bg-amber-50/50 hover:bg-amber-50 dark:bg-amber-500/[0.06] dark:hover:bg-amber-500/[0.11]",
    xanh: "hover:bg-emerald-50/60 dark:hover:bg-emerald-500/[0.07]",
    xam: "opacity-55 hover:opacity-90 hover:bg-muted/50",
};

/** Trạng thái giao hàng — màu theo NHÓM ý nghĩa, không phải mỗi trạng thái một màu.
 *  Mười hai màu khác nhau thì mắt không nhớ nổi cái nào là cái nào. */
const STATUS_STYLE: { match: RegExp; cls: string }[] = [
    { match: /thành công/i, cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" },
    { match: /hoàn|huỷ|hủy/i, cls: "bg-slate-200 text-slate-700 dark:bg-slate-600/30 dark:text-slate-300" },
    { match: /đợi khách|chờ/i, cls: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" },
    { match: /trung chuyển|đang giao|xuất kho|chuyển tiếp/i, cls: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300" },
    { match: /lên đơn/i, cls: "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300" },
];
const statusCls = (s: string) =>
    STATUS_STYLE.find((x) => x.match.test(s))?.cls
    || "bg-muted text-muted-foreground";

/** Mỗi marketer một màu CỐ ĐỊNH, suy từ chính tên. Nhờ vậy lướt mắt xuống cột
 *  là nhận ra người ngay, không phải đọc chữ. Đổi tên thì đổi màu — chấp nhận
 *  được, vì tên marketer hầu như không đổi. */
const MK_COLORS = [
    "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300",
    "bg-teal-100 text-teal-800 dark:bg-teal-500/15 dark:text-teal-300",
    "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-500/15 dark:text-fuchsia-300",
    "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300",
    "bg-cyan-100 text-cyan-800 dark:bg-cyan-500/15 dark:text-cyan-300",
    "bg-lime-100 text-lime-800 dark:bg-lime-500/15 dark:text-lime-300",
];
function mkCls(name: string) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return MK_COLORS[h % MK_COLORS.length];
}

/** Ô tích: ✓ khi xong, ô trống nét đứt khi chưa.
 *  Cố ý KHÔNG dùng ✗ đỏ — "chưa làm" khác hẳn "làm sai"; lẫn hai thứ thì cả
 *  bảng đỏ lòm và không ai còn phân biệt được đâu là việc thật sự hỏng.
 *  Ô chưa tích render RỖNG chứ không phải ✓ làm trong suốt: chữ ẩn kiểu đó vẫn
 *  bị chép ra khi bôi đen và trình đọc màn hình vẫn đọc thành "đã tích". */
function Tick({ on, title }: { on: boolean; title: string }) {
    return (
        <span title={title} role="img" aria-label={`${title} — ${on ? "đã xong" : "chưa"}`}
            className={cn("inline-flex h-[18px] w-[18px] items-center justify-center rounded text-[10px] font-bold",
                on ? "bg-emerald-500 text-white shadow-sm" : "border border-dashed border-muted-foreground/40")}>
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
        <div className="space-y-4">
            {warnings.map((w) => (
                <div key={w} className="flex gap-3 rounded-xl border-l-4 border-amber-500 bg-amber-50 px-4 py-3 text-sm dark:bg-amber-500/10">
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-amber-600 dark:text-amber-400" />
                    <p className="text-amber-900 dark:text-amber-200">{w}</p>
                </div>
            ))}

            {/* ── Bốn ô số, mỗi ô một màu theo việc phải làm ── */}
            {summary && (
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <Stat tone="rose" label="Phải xử ngay" value={TWD(summary.overdue_twd)}
                        sub={`${formatNumber(summary.by_light.do)} đơn quá hạn hoặc lệch tiền`} />
                    <Stat tone="amber" label="Đang chờ tiền về" value={TWD(summary.pending_twd)}
                        sub={`${formatNumber(summary.by_light.vang)} đơn đã giao, sao kê chưa có`} />
                    <Stat tone="emerald" label="Còn lại — đã trừ đủ" value={VND(summary.net_total_vnd)}
                        sub={`${formatNumber(summary.cogs_known)} đơn tính được giá vốn`} />
                    <Stat tone="slate" label="Còn lại — chưa trừ giá vốn" value={VND(summary.net_partial_vnd)}
                        sub={`${formatNumber(summary.cogs_missing_orders)} đơn còn thiếu khai giá`} />
                </div>
            )}

            {/* ── Lọc ── */}
            <div className="flex flex-wrap items-center gap-2">
                {LIGHTS.map((l) => {
                    const n = l.id === "all" ? rows.length : count(l.id as Light);
                    const on = filter === l.id;
                    return (
                        <button key={l.id} onClick={() => setFilter(l.id)} title={l.hint}
                            className={cn("inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm transition",
                                on ? cn(l.ring, "font-semibold shadow-sm ring-2 ring-offset-1 ring-current/25 dark:ring-offset-background")
                                   : "border-border text-muted-foreground hover:bg-muted")}>
                            <span className={cn("h-2 w-2 rounded-full", l.dot)} />
                            {l.label}
                            <span className="tabular-nums opacity-70">{formatNumber(n)}</span>
                        </button>
                    );
                })}

                <div className="relative ml-auto">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input value={q} onChange={(e) => setQ(e.target.value)}
                        placeholder="Tìm mã đơn, vận đơn, tên, SĐT, SKU…"
                        className="w-64 rounded-full border border-border bg-card py-1.5 pl-9 pr-3 text-sm" />
                </div>
                <button onClick={load} title="Tải lại"
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm hover:bg-muted">
                    <RefreshCw className="h-3.5 w-3.5" />
                </button>
                <button onClick={exportCsv}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm hover:bg-muted">
                    <Download className="h-3.5 w-3.5" /> CSV
                </button>
            </div>

            {/* ── Bảng ──
                MƯỜI cột thay vì hai mươi. Bản trước để phẳng 20 cột nên bảng rộng
                1680px: cuộn sang phải là mất luôn cột đèn và mã đơn ở bên trái,
                đọc tới giữa bảng thì không còn biết đang xem đơn nào.
                Nay gộp các trường đi liền nhau vào một ô hai dòng, và GHIM HAI ĐẦU:
                cột mã đơn bên trái, cột "Còn lại" bên phải. Hai cái đó là câu hỏi
                và câu trả lời — đơn nào, và rốt cuộc còn bao nhiêu; phần giữa cuộn
                thoải mái. Ở màn 1280px cột "Còn lại" từng bị đẩy hẳn ra ngoài. */}
            <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
                <table className="w-full min-w-[1020px] border-collapse text-sm">
                    <thead className="sticky top-0 z-20 bg-muted/60 backdrop-blur">
                        <tr className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                            <th className="sticky left-0 z-10 bg-muted/95 px-3 py-2.5 text-left backdrop-blur">Đơn</th>
                            <th className="px-3 py-2.5 text-left">Vận đơn</th>
                            <th className="px-3 py-2.5 text-left">Ngày</th>
                            <th className="px-3 py-2.5 text-left">Hàng</th>
                            <th className="px-3 py-2.5 text-left">Khách</th>
                            <th className="px-3 py-2.5 text-left">Người chạy</th>
                            <th className="px-3 py-2.5 text-right">COD</th>
                            <th className="px-3 py-2.5 text-center" title="Đã đối soát · Đã trừ vận chuyển · Đã trừ tiền hàng">
                                Đã trừ
                            </th>
                            <th className="sticky right-0 z-10 bg-muted/95 px-3 py-2.5 text-right shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.18)] backdrop-blur">Còn lại</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {shown.slice(0, 300).map((r) => (
                            <tr key={r.tracking + r.order_no} className={cn("transition-colors", ROWBG[r.light])}>
                                {/* Đơn — ghim lại, kèm vạch màu ở mép trái */}
                                <td className={cn("sticky left-0 z-10 py-2 pl-0 pr-3", ROWBG[r.light], "bg-card")}>
                                    <div className="flex items-stretch gap-2.5">
                                        <span title={r.light_note} className={cn("w-1 flex-none rounded-r", STRIPE[r.light])} />
                                        <div className="min-w-0">
                                            <div className="font-semibold leading-tight">{r.order_no}</div>
                                            <span className={cn("mt-0.5 inline-block rounded px-1.5 py-px text-[10px] font-medium",
                                                statusCls(r.status_raw))}>
                                                {r.status_raw || "—"}
                                            </span>
                                        </div>
                                    </div>
                                </td>

                                {/* Vận đơn: mã chính + mã 17TRACK + mã hoàn nếu có */}
                                <td className="px-3 py-2">
                                    <div className="font-mono text-xs leading-tight">{r.tracking}</div>
                                    <div className="font-mono text-[10px] leading-tight text-muted-foreground">
                                        {r.track17_code || "—"}
                                    </div>
                                    {r.return_order_no && (
                                        <span className="mt-0.5 inline-block rounded bg-violet-100 px-1.5 py-px text-[10px] font-medium text-violet-800 dark:bg-violet-500/15 dark:text-violet-300"
                                            title="Mã đơn mới khi hàng bị hoàn rồi gửi lại">
                                            hoàn → {r.return_order_no}
                                        </span>
                                    )}
                                </td>

                                {/* Ngày: lên đơn / xuất kho */}
                                <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums">
                                    <div className="leading-tight">{shortDate(r.order_date)}</div>
                                    <div className="leading-tight text-muted-foreground">{shortDate(r.ship_date)}</div>
                                    {r.light === "do" && r.age_days !== null && r.paid_twd === null && (
                                        <span className="mt-0.5 inline-block rounded bg-rose-500 px-1.5 py-px text-[10px] font-bold text-white">
                                            {r.age_days} ngày
                                        </span>
                                    )}
                                </td>

                                {/* Hàng: SKU + số lượng + kênh giao */}
                                <td className="px-3 py-2">
                                    <div className="flex items-center gap-1.5">
                                        <span className="max-w-[190px] truncate text-xs font-medium" title={r.sku}>
                                            {r.sku || "—"}
                                        </span>
                                        {r.quantity > 1 && (
                                            <span className="flex-none rounded bg-slate-200 px-1.5 py-px text-[10px] font-bold tabular-nums text-slate-700 dark:bg-slate-600/40 dark:text-slate-200">
                                                ×{r.quantity}
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-[10px] leading-tight text-muted-foreground">{r.ship_method || "—"}</div>
                                    {r.cogs_missing.length > 0 && (
                                        <span className="mt-0.5 inline-block rounded bg-amber-100 px-1.5 py-px text-[10px] font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                                            chưa khai giá {r.cogs_missing.join(", ")}
                                        </span>
                                    )}
                                </td>

                                {/* Khách: tên + số điện thoại */}
                                <td className="px-3 py-2">
                                    <div className="max-w-[150px] truncate text-xs leading-tight" title={r.contact_name}>
                                        {r.contact_name || "—"}
                                    </div>
                                    <div className="font-mono text-[10px] leading-tight text-muted-foreground">{r.phone || "—"}</div>
                                </td>

                                {/* Người chạy */}
                                <td className="px-3 py-2">
                                    {r.marketer ? (
                                        <span className={cn("inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold", mkCls(r.marketer))}>
                                            {r.marketer}
                                        </span>
                                    ) : <span className="text-xs text-muted-foreground">—</span>}
                                </td>

                                {/* COD — kèm số 3PL trả thật khi lệch */}
                                <td className="whitespace-nowrap px-3 py-2 text-right">
                                    <div className="font-semibold tabular-nums">{TWD(r.cod_twd)}</div>
                                    {r.diff_twd !== null && Math.abs(r.diff_twd) > 1 && (
                                        <div className="text-[10px] font-medium text-rose-600 dark:text-rose-400">
                                            3PL trả {TWD(r.paid_twd ?? 0)}
                                        </div>
                                    )}
                                </td>

                                {/* Ba ô tích */}
                                <td className="px-3 py-2">
                                    <div className="flex items-center justify-center gap-1">
                                        <Tick on={r.tick.doi_soat}
                                            title={r.tick.doi_soat
                                                ? `Đã có trên sao kê ${r.paid_period}${r.matched_by === "order_id_giao_lai" ? " (đơn giao lại)" : ""}`
                                                : "Sao kê chưa nhắc tới đơn này"} />
                                        <Tick on={r.tick.tru_van_chuyen}
                                            title={r.ship_fee_rmb === null ? "Chưa thấy trên bảng phí"
                                                : `Ship ${RMB(r.ship_fee_rmb)} + thao tác ${RMB(r.op_fee_rmb ?? 0)}${r.fee_wrong ? " — SAI bảng giá" : ""}`} />
                                        <Tick on={r.tick.tru_tien_hang}
                                            title={r.cogs_vnd === null
                                                ? `Chưa khai giá vốn cho mã ${r.cogs_missing.join(", ") || "(không rõ mã)"}`
                                                : `Giá vốn ${VND(r.cogs_vnd)}`} />
                                        {r.fee_wrong && <span title="Phí sai bảng giá" className="text-[11px] font-bold text-rose-600">!</span>}
                                    </div>
                                </td>

                                {/* Còn lại — ghim phải */}
                                <td className={cn("sticky right-0 z-10 whitespace-nowrap px-3 py-2 text-right shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.18)]",
                                    ROWBG[r.light], "bg-card")}>
                                    {r.net_vnd === null ? (
                                        <span className="text-xs text-muted-foreground">—</span>
                                    ) : (
                                        <>
                                            <div className={cn("font-bold tabular-nums",
                                                r.net_vnd < 0 ? "text-rose-600 dark:text-rose-400"
                                                    : r.net_before_cogs ? "text-amber-600 dark:text-amber-400"
                                                        : "text-emerald-600 dark:text-emerald-400")}>
                                                {VND(r.net_vnd)}
                                            </div>
                                            {r.net_before_cogs && (
                                                <div className="text-[10px] text-amber-600 dark:text-amber-400">trước giá vốn</div>
                                            )}
                                        </>
                                    )}
                                </td>
                            </tr>
                        ))}
                        {!shown.length && (
                            <tr><td colSpan={9} className="px-3 py-12 text-center text-muted-foreground">
                                Không có đơn nào trong nhóm này.
                            </td></tr>
                        )}
                    </tbody>
                </table>
                {shown.length > 300 && (
                    <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
                        Hiện 300 dòng đầu trong {formatNumber(shown.length)} — bấm CSV để xem đủ.
                    </p>
                )}
            </div>

            {/* ── Chú giải ── */}
            <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
                <div className="mb-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span className="font-semibold text-foreground">Vạch màu đầu dòng:</span>
                    <span className="inline-flex items-center gap-1.5"><span className="h-3 w-1 rounded bg-rose-500" /> đi đòi hoặc soi lệch</span>
                    <span className="inline-flex items-center gap-1.5"><span className="h-3 w-1 rounded bg-amber-400" /> chờ đúng nhịp</span>
                    <span className="inline-flex items-center gap-1.5"><span className="h-3 w-1 rounded bg-emerald-500" /> xong</span>
                    <span className="inline-flex items-center gap-1.5"><span className="h-3 w-1 rounded bg-slate-300 dark:bg-slate-600" /> không đòi được</span>
                </div>
                <div className="mb-1.5">
                    <span className="font-semibold text-foreground">Ba ô tích:</span> đã đối soát · đã trừ vận chuyển · đã trừ tiền hàng.
                    Rê chuột lên ô là hiện lý do và số tiền.
                </div>
                <div>
                    <span className="font-semibold text-foreground">Còn lại</span> = tiền 3PL trả (quy VND theo tỷ giá của chính kỳ đó)
                    − phí vận chuyển − phí thao tác − giá vốn.
                    Số <span className="font-medium text-amber-600 dark:text-amber-400">màu vàng</span> là chưa trừ được giá vốn
                    vì mã sản phẩm chưa khai giá — con số đó đang <b>cao hơn thật</b>.
                </div>
            </div>
        </div>
    );
}

const TONE: Record<string, { card: string; num: string }> = {
    rose: { card: "border-rose-200 bg-gradient-to-br from-rose-50 to-card dark:border-rose-500/30 dark:from-rose-500/10 dark:to-card", num: "text-rose-600 dark:text-rose-400" },
    amber: { card: "border-amber-200 bg-gradient-to-br from-amber-50 to-card dark:border-amber-500/30 dark:from-amber-500/10 dark:to-card", num: "text-amber-600 dark:text-amber-400" },
    emerald: { card: "border-emerald-200 bg-gradient-to-br from-emerald-50 to-card dark:border-emerald-500/30 dark:from-emerald-500/10 dark:to-card", num: "text-emerald-600 dark:text-emerald-400" },
    slate: { card: "border-border bg-card", num: "text-foreground" },
};

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: keyof typeof TONE }) {
    const t = TONE[tone] || TONE.slate;
    return (
        <div className={cn("rounded-xl border p-4 shadow-sm", t.card)}>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
            <div className={cn("mt-1 text-2xl font-bold tabular-nums", t.num)}>{value}</div>
            {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
        </div>
    );
}

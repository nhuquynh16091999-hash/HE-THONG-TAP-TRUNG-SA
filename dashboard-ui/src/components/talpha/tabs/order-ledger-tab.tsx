"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { AlertTriangle, Download, Search, RefreshCw, ChevronDown, CheckCircle2, Copy } from "lucide-react";
import TabSkeleton, { ErrorState } from "@/components/ui/tab-skeleton";
import { formatNumber, cn } from "../utils";

interface Props { dateRange?: { from: Date; to: Date }; projectId?: string }

type Light = "xanh" | "vang" | "do" | "xam";

type Row = {
    order_no: string; tracking: string; track17_code: string; return_order_no: string;
    order_date: string; ship_date: string; age_days: number | null; ky_da_qua: number;
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

type Period = {
    id: string; filename: string; uploaded_at: string; period_date: string;
    orders_paid: number; total_twd: number; fee_rmb: number;
    lech_tien: { order_no: string; tracking: string; cod_twd: number; paid_twd: number | null; diff_twd: number | null }[];
    phi_sai: { order_no: string; tracking: string; ship_fee_rmb: number | null }[];
    thua_sao_ke: { order_no: string; tracking: string; amount_twd: number }[];
    settlement: {
        cod_twd: number | null; rate_twd_rmb: number | null;
        ship_fee_rmb: number | null; op_fee_rmb: number | null;
        rate_rmb_vnd: number | null; purchase_vnd: number | null;
        payable_vnd: number | null; math_ok: boolean | null; math_note: string;
    } | null;
};

type Pending = {
    order_no: string; tracking: string; cod_twd: number;
    age_days: number | null; ky_da_qua: number; qua_han: boolean;
    contact_name: string; phone: string;
};

/** Một việc phải làm. `muc` quyết định màu và thứ tự: gấp → soát → ghi sổ. */
type Viec = {
    id: string; muc: "gap" | "soat" | "ghi";
    tieu_de: string; so: number; don_vi: string; chi_tiet: string;
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

/** Vạch màu mép trái mỗi dòng — thứ duy nhất còn thấy khi cuộn ngang, nên nó
 *  mang tin quan trọng nhất: dòng này có phải xử không. */
const STRIPE: Record<Light, string> = {
    do: "bg-rose-500", vang: "bg-amber-400", xanh: "bg-emerald-500",
    xam: "bg-slate-300 dark:bg-slate-600",
};
const ROWBG: Record<Light, string> = {
    do: "bg-rose-50/70 dark:bg-rose-500/[0.08]",
    vang: "bg-amber-50/50 dark:bg-amber-500/[0.06]",
    xanh: "", xam: "opacity-60",
};
const LIGHTS: { id: Light | "all"; label: string; dot: string; on: string }[] = [
    { id: "all", label: "Tất cả", dot: "bg-slate-400", on: "border-slate-400 bg-slate-100 text-slate-800 dark:bg-slate-500/15 dark:text-slate-200" },
    { id: "do", label: "Phải xử", dot: "bg-rose-500", on: "border-rose-400 bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300" },
    { id: "vang", label: "Đang chờ", dot: "bg-amber-400", on: "border-amber-400 bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300" },
    { id: "xanh", label: "Xong sạch", dot: "bg-emerald-500", on: "border-emerald-400 bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" },
    { id: "xam", label: "Không đòi", dot: "bg-slate-400", on: "border-slate-400 bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300" },
];

/** Trạng thái giao hàng tô theo NHÓM ý nghĩa, không phải mỗi trạng thái một màu —
 *  12 màu thì mắt không nhớ nổi cái nào là cái nào. */
const STATUS_STYLE: { m: RegExp; c: string }[] = [
    { m: /thành công/i, c: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" },
    { m: /hoàn|huỷ|hủy/i, c: "bg-slate-200 text-slate-700 dark:bg-slate-600/30 dark:text-slate-300" },
    { m: /đợi khách|chờ/i, c: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" },
    { m: /trung chuyển|đang giao|xuất kho|chuyển tiếp/i, c: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300" },
    { m: /lên đơn/i, c: "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300" },
];
const statusCls = (s: string) => STATUS_STYLE.find((x) => x.m.test(s))?.c || "bg-muted text-muted-foreground";

const MK_COLORS = [
    "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300",
    "bg-teal-100 text-teal-800 dark:bg-teal-500/15 dark:text-teal-300",
    "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-500/15 dark:text-fuchsia-300",
    "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300",
    "bg-cyan-100 text-cyan-800 dark:bg-cyan-500/15 dark:text-cyan-300",
];
function mkCls(n: string) {
    let h = 0; for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
    return MK_COLORS[h % MK_COLORS.length];
}

function Tick({ on, title }: { on: boolean; title: string }) {
    return (
        <span title={title} role="img" aria-label={`${title} — ${on ? "đã xong" : "chưa"}`}
            className={cn("inline-flex h-[17px] w-[17px] items-center justify-center rounded text-[10px] font-bold",
                on ? "bg-emerald-500 text-white" : "border border-dashed border-muted-foreground/40")}>
            {on ? "✓" : ""}
        </span>
    );
}

export default function TALPHAOrderLedgerTab({ dateRange }: Props) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [rows, setRows] = useState<Row[]>([]);
    const [periods, setPeriods] = useState<Period[]>([]);
    const [pending, setPending] = useState<Pending[]>([]);
    const [viec, setViec] = useState<Viec[]>([]);
    const [copied, setCopied] = useState("");
    const [summary, setSummary] = useState<Summary | null>(null);
    const [warnings, setWarnings] = useState<string[]>([]);
    const [periodId, setPeriodId] = useState("");
    const [filter, setFilter] = useState<Light | "all">("all");
    const [q, setQ] = useState("");

    const to = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

    const load = useCallback(async () => {
        setLoading(true); setError("");
        try {
            const res = await fetch(`/api/talpha/order-ledger?to=${to}`);
            const d = await res.json();
            if (!res.ok) throw new Error(d.error || "Không dựng được sổ");
            setRows(d.rows || []);
            setPeriods(d.periods || []);
            setPending(d.chua_ve_tien || []);
            setViec(d.viec || []);
            setSummary(d.summary || null);
            setWarnings(d.warnings || []);
            if (!periodId && d.periods?.length) setPeriodId(d.periods[0].id);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Lỗi không rõ");
        } finally { setLoading(false); }
    }, [to, periodId]);

    useEffect(() => { load(); }, [load]);

    const period = periods.find((p) => p.id === periodId) || periods[0];

    const shown = useMemo(() => {
        const needle = q.trim().toLowerCase();
        return rows.filter((r) => {
            if (filter !== "all" && r.light !== filter) return false;
            if (!needle) return true;
            return [r.order_no, r.tracking, r.track17_code, r.contact_name, r.phone, r.sku, r.marketer]
                .some((v) => String(v || "").toLowerCase().includes(needle));
        });
    }, [rows, filter, q]);

    const csv = (name: string, head: string[], body: (string | number)[][]) => {
        const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
        const blob = new Blob(["﻿" + [head.map(esc).join(","), ...body.map((r) => r.map(esc).join(","))].join("\n")],
            { type: "text/csv;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob); a.download = name; a.click();
        URL.revokeObjectURL(a.href);
    };

    const exportAll = () => csv(`so-don-hang_${to}.csv`,
        ["Đèn", "Mã đơn", "Trạng thái", "Đối soát (tay)", "Ngày lên đơn", "Ngày xuất kho", "Số ngày",
            "PTVC", "Tracking", "Mã đơn hoàn", "Mã 17TRACK", "SKU", "SL", "Tên khách", "Điện thoại",
            "Marketer", "COD (NT$)", "3PL trả (NT$)", "Lệch (NT$)", "Kỳ sao kê", "Ngày về tiền",
            "Phí ship (¥)", "Phí thao tác (¥)", "Giá vốn (đ)", "Còn lại (đ)", "Ghi chú"],
        shown.map((r) => [r.light, r.order_no, r.status_raw, r.recon_manual, r.order_date, r.ship_date,
            r.age_days ?? "", r.ship_method, r.tracking, r.return_order_no, r.track17_code, r.sku,
            r.quantity, r.contact_name, r.phone, r.marketer, r.cod_twd, r.paid_twd ?? "", r.diff_twd ?? "",
            r.paid_period, r.paid_date, r.ship_fee_rmb ?? "", r.op_fee_rmb ?? "", r.cogs_vnd ?? "",
            r.net_vnd === null ? "" : Math.round(r.net_vnd),
            r.net_before_cogs ? "chưa trừ giá vốn" : r.light_note]));

    /** Xuất đúng những gì cần gửi lại 3PL: đơn lệch tiền, đơn chưa về tiền, phí sai. */
    const exportForPartner = () => {
        if (!period) return;
        const body: (string | number)[][] = [];
        for (const l of period.lech_tien)
            body.push(["Lệch tiền", l.order_no, l.tracking, l.cod_twd, l.paid_twd ?? "", l.diff_twd ?? "", ""]);
        for (const t of period.thua_sao_ke)
            body.push(["Trả cho đơn không có", t.order_no, t.tracking, "", t.amount_twd, "", ""]);
        for (const f of period.phi_sai)
            body.push(["Phí sai bảng giá", f.order_no, f.tracking, "", "", "", f.ship_fee_rmb ?? ""]);
        for (const p of pending)
            body.push([p.qua_han ? "QUÁ HẠN chưa về tiền" : "Chưa về tiền", p.order_no, p.tracking,
                p.cod_twd, "", "", `${p.age_days ?? "?"} ngày`]);
        csv(`gui-3pl_${period.filename.replace(/\.[^.]+$/, "")}.csv`,
            ["Loại", "Mã đơn", "Mã vận đơn", "COD đơn (NT$)", "3PL trả (NT$)", "Lệch (NT$)", "Ghi chú"], body);
    };

    if (loading && !summary) return <TabSkeleton cards={4} rows={10} showChart={false} />;
    if (error) return <ErrorState message={error} onRetry={load} />;

    const count = (l: Light) => rows.filter((r) => r.light === l).length;
    const quaHan = pending.filter((p) => p.qua_han);

    return (
        <div className="space-y-5">
            {warnings.map((w) => (
                <div key={w} className="flex gap-3 rounded-xl border-l-4 border-amber-500 bg-amber-50 px-4 py-3 text-sm dark:bg-amber-500/10">
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-amber-600 dark:text-amber-400" />
                    <p className="text-amber-900 dark:text-amber-200">{w}</p>
                </div>
            ))}

            {/* ═══ VIỆC HÔM NAY ═══
                Thứ ĐẦU TIÊN Sỹ Anh muốn thấy khi mở màn: "hôm nay có việc gì cần
                làm không". Không có việc thì phải NÓI RÕ là không có — để trống
                cho người đọc tự đoán là tệ nhất.
                Mọi việc ở đây TỰ HẾT khi tiền về; cố ý không có nút "đã làm". */}
            <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                <header className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
                    <span className="text-sm font-semibold">Việc hôm nay</span>
                    {viec.length > 0 && (
                        <span className="rounded-full bg-rose-500 px-2 py-0.5 text-[11px] font-bold text-white">
                            {viec.length}
                        </span>
                    )}
                </header>

                {viec.length === 0 ? (
                    <div className="flex items-center gap-3 px-4 py-6">
                        <CheckCircle2 className="h-7 w-7 flex-none text-emerald-500" />
                        <div>
                            <div className="font-semibold text-emerald-700 dark:text-emerald-400">
                                Không có việc gì cần làm
                            </div>
                            <div className="text-sm text-muted-foreground">
                                Sao kê kỳ mới nhất không có đơn nào lệch, không đơn nào quá hạn đòi tiền.
                            </div>
                        </div>
                    </div>
                ) : (
                    <ul className="divide-y divide-border">
                        {viec.map((v) => (
                            <li key={v.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3.5">
                                <span className={cn("mt-1 h-2.5 w-2.5 flex-none rounded-full",
                                    v.muc === "gap" ? "bg-rose-500"
                                        : v.muc === "soat" ? "bg-amber-400" : "bg-sky-500")} />
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-baseline gap-2">
                                        <span className="font-semibold">{v.tieu_de}</span>
                                        <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-bold tabular-nums",
                                            v.muc === "gap" ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
                                                : v.muc === "soat" ? "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
                                                    : "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300")}>
                                            {v.don_vi === "đ" ? VND(v.so) : `${formatNumber(v.so)} ${v.don_vi}`}
                                        </span>
                                    </div>
                                    <p className="mt-0.5 text-sm text-muted-foreground">{v.chi_tiet}</p>
                                </div>

                                {/* Mỗi việc một nút làm được ngay, không phải đi tìm chỗ khác */}
                                {v.id === "doi-naza" && (
                                    <button onClick={exportForPartner}
                                        className="inline-flex flex-none items-center gap-1.5 rounded-lg bg-rose-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-600">
                                        <Download className="h-3.5 w-3.5" /> Xuất danh sách đòi
                                    </button>
                                )}
                                {(v.id === "lech-tien" || v.id === "thua" || v.id === "phi-sai") && (
                                    <button onClick={() => { setFilter("all"); setQ(v.chi_tiet.split(":")[0].split(" ")[0]); }}
                                        className="flex-none rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted">
                                        Xem đơn
                                    </button>
                                )}
                                {v.id === "ghi-so" && (
                                    <button onClick={() => {
                                        navigator.clipboard?.writeText(String(v.so));
                                        setCopied(v.id); setTimeout(() => setCopied(""), 2000);
                                    }}
                                        className="inline-flex flex-none items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted">
                                        <Copy className="h-3.5 w-3.5" />
                                        {copied === v.id ? "Đã chép" : "Chép số"}
                                    </button>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            {/* ═══ KHỐI BÁO CÁO MỘT KỲ ═══
                Việc thật mỗi tuần: 3PL gửi file, cần biết ngay ĐƠN NÀO VỀ và CÓ
                LỆCH KHÔNG. Bảng đầy đủ bên dưới là kho dữ liệu; khối này là câu
                trả lời cho tuần này. */}
            {period && (
                <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                    <header className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/40 px-4 py-3">
                        <div className="text-sm font-semibold">Kỳ sao kê</div>
                        <div className="relative">
                            <select value={period.id} onChange={(e) => setPeriodId(e.target.value)}
                                className="appearance-none rounded-lg border border-border bg-card py-1.5 pl-3 pr-8 text-sm font-medium">
                                {periods.map((p, i) => (
                                    <option key={p.id} value={p.id}>
                                        {i === 0 ? "★ " : ""}{p.filename}{p.period_date ? ` — chốt ${p.period_date}` : ""}
                                    </option>
                                ))}
                            </select>
                            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 opacity-60" />
                        </div>
                        {period.settlement && (
                            <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                                period.settlement.math_ok
                                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                                    : "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300")}
                                title={period.settlement.math_note}>
                                {period.settlement.math_ok ? "Phép tính của 3PL tự khớp" : "Phép tính KHÔNG khớp"}
                            </span>
                        )}
                        <button onClick={exportForPartner}
                            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted">
                            <Download className="h-3.5 w-3.5" /> Xuất file gửi 3PL
                        </button>
                    </header>

                    {/* Kỳ này về bao nhiêu */}
                    <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2 border-b border-border px-4 py-4">
                        <div>
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Kỳ này về tiền</div>
                            <div className="text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                                {TWD(period.total_twd)}
                            </div>
                            <div className="text-xs text-muted-foreground">{formatNumber(period.orders_paid)} đơn</div>
                        </div>
                        {period.settlement?.payable_vnd != null && (
                            <div>
                                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">3PL phải chuyển về</div>
                                <div className="text-2xl font-bold tabular-nums">{VND(period.settlement.payable_vnd)}</div>
                                <div className="text-xs text-muted-foreground">sau khi trừ phí và tiền hàng</div>
                            </div>
                        )}
                        <div>
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Phí kỳ này</div>
                            <div className="text-2xl font-bold tabular-nums">{RMB(period.fee_rmb)}</div>
                            <div className="text-xs text-muted-foreground">ship + thao tác</div>
                        </div>
                    </div>

                    {/* Bốn loại lệch — do chính Sỹ Anh chốt */}
                    <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
                        <Lech n={period.lech_tien.length} label="3PL trả khác số trên đơn"
                            detail={period.lech_tien.slice(0, 4).map((l) =>
                                `${l.order_no}: đơn ${TWD(l.cod_twd)} · trả ${TWD(l.paid_twd ?? 0)} (${l.diff_twd! > 0 ? "+" : ""}${Math.round(l.diff_twd!)})`)}
                            onClick={() => { setFilter("all"); setQ(period.lech_tien[0]?.order_no || ""); }} />
                        <Lech n={pending.length} label="Đã giao mà chưa về tiền"
                            sub={quaHan.length ? `${quaHan.length} đơn QUÁ HẠN` : undefined}
                            detail={pending.slice(0, 4).map((p) => `${p.order_no}: ${TWD(p.cod_twd)} · ${p.age_days ?? "?"} ngày`)}
                            onClick={() => { setQ(""); setFilter(quaHan.length ? "do" : "vang"); }} />
                        <Lech n={period.thua_sao_ke.length} label="3PL trả cho đơn không có"
                            detail={period.thua_sao_ke.slice(0, 4).map((t) => `${t.order_no} · ${t.tracking} · ${TWD(t.amount_twd)}`)} />
                        <Lech n={period.phi_sai.length} label="Phí thu sai bảng giá"
                            detail={period.phi_sai.slice(0, 4).map((f) => `${f.order_no}: ${RMB(f.ship_fee_rmb ?? 0)}`)} />
                    </div>
                </section>
            )}

            {/* ═══ BẢNG ĐẦY ĐỦ ═══ */}
            <div className="flex flex-wrap items-center gap-2">
                {LIGHTS.map((l) => {
                    const n = l.id === "all" ? rows.length : count(l.id as Light);
                    const on = filter === l.id;
                    return (
                        <button key={l.id} onClick={() => setFilter(l.id)}
                            className={cn("inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm transition",
                                on ? cn(l.on, "font-semibold shadow-sm") : "border-border text-muted-foreground hover:bg-muted")}>
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
                    className="rounded-full border border-border px-3 py-1.5 hover:bg-muted"><RefreshCw className="h-3.5 w-3.5" /></button>
                <button onClick={exportAll}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm hover:bg-muted">
                    <Download className="h-3.5 w-3.5" /> CSV
                </button>
            </div>

            {/* Bảng ĐẦY ĐỦ, cuộn ngang. Đây là cơ sở dữ liệu chung — giữ mọi cột,
                không gộp, không giấu. Chỉ ghim cột mã đơn để cuộn không lạc dòng. */}
            <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
                <table className="min-w-max border-collapse text-sm">
                    <thead>
                        <tr className="border-b border-border bg-muted/50 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            <th className="sticky left-0 z-20 bg-muted px-3 py-1.5 text-left">Đơn</th>
                            <th className="border-l border-border px-3 py-1.5 text-left" colSpan={3}>Thời gian</th>
                            <th className="border-l border-border px-3 py-1.5 text-left" colSpan={4}>Vận chuyển</th>
                            <th className="border-l border-border px-3 py-1.5 text-left" colSpan={2}>Hàng</th>
                            <th className="border-l border-border px-3 py-1.5 text-left" colSpan={3}>Khách &amp; người chạy</th>
                            <th className="border-l border-border px-3 py-1.5 text-center" colSpan={5}>Tiền về</th>
                            <th className="border-l border-border px-3 py-1.5 text-center" colSpan={4}>Tiền ra &amp; kết quả</th>
                        </tr>
                        <tr className="border-b border-border bg-muted/30 text-[11px] font-semibold text-muted-foreground">
                            <th className="sticky left-0 z-20 bg-muted/95 px-3 py-2 text-left">Mã đơn</th>
                            <th className="border-l border-border px-3 py-2 text-left">Lên đơn</th>
                            <th className="px-3 py-2 text-left">Xuất kho</th>
                            <th className="px-3 py-2 text-right">Ngày</th>
                            <th className="border-l border-border px-3 py-2 text-left">PTVC</th>
                            <th className="px-3 py-2 text-left">Vận đơn</th>
                            <th className="px-3 py-2 text-left">Mã đơn hoàn</th>
                            <th className="px-3 py-2 text-left">17TRACK</th>
                            <th className="border-l border-border px-3 py-2 text-left">SKU</th>
                            <th className="px-3 py-2 text-right">SL</th>
                            <th className="border-l border-border px-3 py-2 text-left">Tên khách</th>
                            <th className="px-3 py-2 text-left">Điện thoại</th>
                            <th className="px-3 py-2 text-left">Marketer</th>
                            <th className="border-l border-border px-3 py-2 text-right">COD</th>
                            <th className="px-3 py-2 text-right">3PL trả</th>
                            <th className="px-3 py-2 text-right">Lệch</th>
                            <th className="px-3 py-2 text-left">Kỳ sao kê</th>
                            <th className="px-3 py-2 text-left">Ngày về</th>
                            <th className="border-l border-border px-3 py-2 text-right">Phí ship</th>
                            <th className="px-3 py-2 text-right">Thao tác</th>
                            <th className="px-3 py-2 text-right">Giá vốn</th>
                            <th className="px-3 py-2 text-center" title="Đã đối soát · Đã trừ vận chuyển · Đã trừ tiền hàng">Đã trừ</th>
                            <th className="px-3 py-2 text-right">Còn lại</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {shown.slice(0, 300).map((r) => (
                            <tr key={r.tracking + r.order_no} className={cn("hover:bg-muted/50", ROWBG[r.light])}>
                                {/* Mã đơn — ghim trái, kèm vạch màu và trạng thái */}
                                <td className={cn("sticky left-0 z-10 py-2 pl-0 pr-3", ROWBG[r.light], "bg-card")}>
                                    <div className="flex items-stretch gap-2.5">
                                        <span title={r.light_note} className={cn("w-1 flex-none rounded-r", STRIPE[r.light])} />
                                        <div>
                                            <div className="whitespace-nowrap font-semibold leading-tight">{r.order_no}</div>
                                            <span className={cn("mt-0.5 inline-block whitespace-nowrap rounded px-1.5 py-px text-[10px] font-medium", statusCls(r.status_raw))}>
                                                {r.status_raw || "—"}
                                            </span>
                                            {r.recon_manual && (
                                                <span className="ml-1 text-[10px] text-muted-foreground">{r.recon_manual}</span>
                                            )}
                                        </div>
                                    </div>
                                </td>

                                <td className="whitespace-nowrap border-l border-border px-3 py-2 tabular-nums">{r.order_date || "—"}</td>
                                <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground">{r.ship_date || "—"}</td>
                                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                                    {r.age_days === null ? "—" : (
                                        <span className={cn(r.light === "do" && r.paid_twd === null
                                            && "rounded bg-rose-500 px-1.5 py-px font-bold text-white")}>{r.age_days}</span>
                                    )}
                                </td>

                                <td className="whitespace-nowrap border-l border-border px-3 py-2 text-xs">{r.ship_method || "—"}</td>
                                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{r.tracking}</td>
                                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-muted-foreground">{r.return_order_no || "—"}</td>
                                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-muted-foreground">{r.track17_code || "—"}</td>

                                <td className="border-l border-border px-3 py-2">
                                    <span className="block max-w-[220px] truncate" title={r.sku}>{r.sku || "—"}</span>
                                    {r.cogs_missing.length > 0 && (
                                        <span className="inline-block rounded bg-amber-100 px-1.5 py-px text-[10px] font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                                            chưa khai giá {r.cogs_missing.join(", ")}
                                        </span>
                                    )}
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums">{r.quantity}</td>

                                <td className="whitespace-nowrap border-l border-border px-3 py-2">{r.contact_name || "—"}</td>
                                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{r.phone || "—"}</td>
                                <td className="whitespace-nowrap px-3 py-2">
                                    {r.marketer
                                        ? <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", mkCls(r.marketer))}>{r.marketer}</span>
                                        : <span className="text-muted-foreground">—</span>}
                                </td>

                                <td className="whitespace-nowrap border-l border-border px-3 py-2 text-right font-semibold tabular-nums">{TWD(r.cod_twd)}</td>
                                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                                    {r.paid_twd === null ? <span className="text-muted-foreground">—</span> : TWD(r.paid_twd)}
                                </td>
                                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                                    {r.diff_twd === null || Math.abs(r.diff_twd) <= 1
                                        ? <span className="text-muted-foreground">—</span>
                                        : <span className="font-bold text-rose-600 dark:text-rose-400">
                                            {r.diff_twd > 0 ? "+" : ""}{TWD(r.diff_twd)}</span>}
                                </td>
                                <td className="px-3 py-2 text-xs text-muted-foreground">
                                    <span className="block max-w-[170px] truncate" title={r.paid_period}>{r.paid_period || "—"}</span>
                                </td>
                                <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums text-muted-foreground">{r.paid_date || "—"}</td>

                                <td className="whitespace-nowrap border-l border-border px-3 py-2 text-right tabular-nums">
                                    {r.ship_fee_rmb === null ? <span className="text-muted-foreground">—</span> : (
                                        <span className={cn(r.fee_wrong && "font-bold text-rose-600 dark:text-rose-400")}>
                                            {RMB(r.ship_fee_rmb)}{r.fee_wrong && " !"}
                                        </span>
                                    )}
                                </td>
                                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted-foreground">
                                    {r.op_fee_rmb === null ? "—" : RMB(r.op_fee_rmb)}
                                </td>
                                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted-foreground">
                                    {r.cogs_vnd === null ? "—" : VND(r.cogs_vnd)}
                                </td>
                                <td className="px-3 py-2">
                                    <div className="flex items-center justify-center gap-1">
                                        <Tick on={r.tick.doi_soat} title={r.tick.doi_soat
                                            ? `Đã có trên sao kê ${r.paid_period}${r.matched_by === "order_id_giao_lai" ? " (đơn giao lại)" : ""}`
                                            : "Sao kê chưa nhắc tới đơn này"} />
                                        <Tick on={r.tick.tru_van_chuyen} title={r.ship_fee_rmb === null
                                            ? "Chưa thấy trên bảng phí" : "Đã có dòng phí cho đơn này"} />
                                        <Tick on={r.tick.tru_tien_hang} title={r.cogs_vnd === null
                                            ? `Chưa khai giá vốn cho mã ${r.cogs_missing.join(", ") || "(không rõ mã)"}`
                                            : `Giá vốn ${VND(r.cogs_vnd)}`} />
                                    </div>
                                </td>
                                <td className="whitespace-nowrap px-3 py-2 text-right">
                                    {r.net_vnd === null ? <span className="text-muted-foreground">—</span> : (
                                        <>
                                            <div className={cn("font-bold tabular-nums",
                                                r.net_vnd < 0 ? "text-rose-600 dark:text-rose-400"
                                                    : r.net_before_cogs ? "text-amber-600 dark:text-amber-400"
                                                        : "text-emerald-600 dark:text-emerald-400")}>{VND(r.net_vnd)}</div>
                                            {r.net_before_cogs && <div className="text-[10px] text-amber-600 dark:text-amber-400">trước giá vốn</div>}
                                        </>
                                    )}
                                </td>
                            </tr>
                        ))}
                        {!shown.length && (
                            <tr><td colSpan={23} className="px-3 py-12 text-center text-muted-foreground">Không có đơn nào trong nhóm này.</td></tr>
                        )}
                    </tbody>
                </table>
                {shown.length > 300 && (
                    <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
                        Hiện 300 dòng đầu trong {formatNumber(shown.length)} — bấm CSV để lấy đủ.
                    </p>
                )}
            </div>

            <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
                <div className="mb-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span className="font-semibold text-foreground">Vạch màu đầu dòng:</span>
                    <span className="inline-flex items-center gap-1.5"><span className="h-3 w-1 rounded bg-rose-500" /> phải xử</span>
                    <span className="inline-flex items-center gap-1.5"><span className="h-3 w-1 rounded bg-amber-400" /> đang chờ</span>
                    <span className="inline-flex items-center gap-1.5"><span className="h-3 w-1 rounded bg-emerald-500" /> xong</span>
                    <span className="inline-flex items-center gap-1.5"><span className="h-3 w-1 rounded bg-slate-300 dark:bg-slate-600" /> không đòi</span>
                </div>
                <div>
                    <span className="font-semibold text-foreground">Còn lại</span> = 3PL trả (quy VND theo tỷ giá của chính kỳ đó)
                    − phí ship − phí thao tác − giá vốn. Số <span className="font-medium text-amber-600 dark:text-amber-400">màu vàng</span> là
                    chưa trừ được giá vốn vì mã chưa khai giá — con số đó <b>cao hơn thật</b>.
                </div>
            </div>
        </div>
    );
}

/** Một trong bốn loại lệch. Con số 0 vẫn hiện — biết CHẮC là không có vấn đề
 *  khác hẳn với không biết, và ô trống thì người đọc không phân biệt được. */
function Lech({ n, label, sub, detail, onClick }: {
    n: number; label: string; sub?: string; detail: string[]; onClick?: () => void;
}) {
    const bad = n > 0;
    return (
        <button onClick={onClick} disabled={!onClick || !bad}
            className={cn("bg-card px-4 py-3 text-left transition", bad && onClick && "hover:bg-muted/60", !bad && "cursor-default")}>
            <div className="flex items-baseline gap-2">
                <span className={cn("text-2xl font-bold tabular-nums",
                    bad ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400")}>{n}</span>
                {!bad && <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">sạch</span>}
                {sub && <span className="rounded bg-rose-500 px-1.5 py-px text-[10px] font-bold text-white">{sub}</span>}
            </div>
            <div className="mt-0.5 text-xs font-medium">{label}</div>
            {detail.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                    {detail.map((d) => (
                        <li key={d} className="truncate font-mono text-[10px] text-muted-foreground" title={d}>{d}</li>
                    ))}
                </ul>
            )}
        </button>
    );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { Upload, AlertTriangle, Trash2, Download, Copy, CheckCircle2, ChevronDown } from "lucide-react";
import TabSkeleton, { ErrorState } from "@/components/ui/tab-skeleton";
import { formatNumber, cn } from "../utils";
import { TWD, VND, RMB } from "./ledger-shared";

interface Props { dateRange?: { from: Date; to: Date }; projectId?: string }

/* ═══════════════════════════════════════════════════════════════════
   ĐỐI SOÁT COD — việc của mỗi tuần khi 3PL gửi file.
   Đúng lời Sỹ Anh: "những đơn nào về, và có bị lệch không".

   Ba tầng, theo đúng thứ tự người dùng cần:
     1. VIỆC HÔM NAY   — mở lên là biết phải làm gì
     2. SOÁT FILE      — tin được số trong file không (4 mục)
     3. SOÁT ĐƠN       — file đúng rồi thì so với đơn của mình (4 mục)
   Thứ tự 2 trước 3 không đảo được: file sai mà đem so đơn thì mọi
   kết luận đều vô nghĩa.
   ═══════════════════════════════════════════════════════════════════ */

type Viec = { id: string; muc: "gap" | "soat" | "ghi"; tieu_de: string; so: number; don_vi: string; chi_tiet: string };
type Check = { nhom: "A" | "B"; ten: string; ok: boolean | null; chi_tiet: string };
type Rate = {
    filename: string; period_date: string;
    rate_twd_rmb: number | null; rate_rmb_vnd: number | null;
    d_twd_rmb: number | null; d_rmb_vnd: number | null;
};
type Period = {
    id: string; filename: string; period_date: string;
    orders_paid: number; total_twd: number; fee_rmb: number;
    lech_tien: { order_no: string; tracking: string; cod_twd: number; paid_twd: number | null; diff_twd: number | null }[];
    phi_sai: { order_no: string; tracking: string; ship_fee_rmb: number | null }[];
    thua_sao_ke: { order_no: string; tracking: string; amount_twd: number }[];
    settlement: { payable_vnd: number | null; purchase_vnd: number | null; math_ok: boolean | null; math_note: string } | null;
};
type Pending = {
    order_no: string; tracking: string; cod_twd: number;
    ky_da_qua: number; qua_han: boolean; contact_name: string; phone: string;
};
type StatementMeta = { id: string; filename: string; uploaded_at: string; row_count: number; kind?: string };

export default function TALPHACodReconTab({ dateRange }: Props) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [upErr, setUpErr] = useState("");
    const [uploading, setUploading] = useState(false);
    const [viec, setViec] = useState<Viec[]>([]);
    const [checks, setChecks] = useState<Check[]>([]);
    const [rates, setRates] = useState<Rate[]>([]);
    const [periods, setPeriods] = useState<Period[]>([]);
    const [pending, setPending] = useState<Pending[]>([]);
    const [stms, setStms] = useState<StatementMeta[]>([]);
    const [pid, setPid] = useState("");
    const [copied, setCopied] = useState("");
    const fileRef = useRef<HTMLInputElement>(null);

    const to = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

    const load = useCallback(async () => {
        setLoading(true); setError("");
        try {
            const [a, b] = await Promise.all([
                fetch(`/api/talpha/order-ledger?to=${to}`).then((r) => r.json()),
                fetch(`/api/talpha/cod-recon?from=2000-01-01&to=${to}`).then((r) => r.json()),
            ]);
            if (a.error) throw new Error(a.error);
            setViec(a.viec || []); setChecks(a.checks || []); setRates(a.rate_trend || []);
            setPeriods(a.periods || []); setPending(a.chua_ve_tien || []);
            setStms(b.statements || []);
            if (a.periods?.length) setPid((p) => p || a.periods[0].id);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Lỗi không rõ");
        } finally { setLoading(false); }
    }, [to]);

    useEffect(() => { load(); }, [load]);

    const upload = async (f: File) => {
        setUploading(true); setUpErr("");
        try {
            const fd = new FormData(); fd.append("file", f);
            const res = await fetch("/api/talpha/cod-recon", { method: "POST", body: fd });
            const d = await res.json();
            if (!res.ok) throw new Error(d.error || "Tải lên thất bại");
            await load();
        } catch (e) {
            setUpErr(e instanceof Error ? e.message : "Tải lên thất bại");
        } finally {
            setUploading(false);
            if (fileRef.current) fileRef.current.value = "";
        }
    };

    const period = periods.find((p) => p.id === pid) || periods[0];
    const quaHan = pending.filter((p) => p.qua_han);

    /** Xuất đúng thứ cần gửi lại 3PL — bốn loại lệch trong một file. */
    const exportForPartner = () => {
        if (!period) return;
        const rows: (string | number)[][] = [];
        for (const l of period.lech_tien)
            rows.push(["Trả khác số trên đơn", l.order_no, l.tracking, l.cod_twd, l.paid_twd ?? "", l.diff_twd ?? "", ""]);
        for (const t of period.thua_sao_ke)
            rows.push(["Trả cho đơn mình không có", t.order_no, t.tracking, "", t.amount_twd, "", ""]);
        for (const f of period.phi_sai)
            rows.push(["Phí thu sai bảng giá", f.order_no, f.tracking, "", "", "", `${f.ship_fee_rmb ?? ""}¥`]);
        for (const p of pending)
            rows.push([p.qua_han ? "QUÁ HẠN chưa trả tiền" : "Chưa trả tiền", p.order_no, p.tracking,
                p.cod_twd, "", "", `đã qua ${p.ky_da_qua} kỳ`]);
        const head = ["Loại", "Mã đơn", "Mã vận đơn", "COD đơn (NT$)", "3PL trả (NT$)", "Lệch (NT$)", "Ghi chú"];
        const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
        const blob = new Blob(["﻿" + [head.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n")],
            { type: "text/csv;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `gui-3pl_${period.filename.replace(/\.[^.]+$/, "")}.csv`;
        a.click(); URL.revokeObjectURL(a.href);
    };

    if (loading && !periods.length) return <TabSkeleton cards={3} rows={8} showChart={false} />;
    if (error) return <ErrorState message={error} onRetry={load} />;

    return (
        <div className="space-y-4">
            {/* ── Tải file ── */}
            <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
                <div className="rounded-lg border-2 border-dashed border-border p-5 text-center">
                    <p className="text-sm font-semibold">Kéo file sao kê NAZA vào đây</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                        File <span className="font-mono">.xlsx</span> ba sheet — máy tự đọc, tự soát 8 mục,
                        tự cập nhật trạng thái đơn bên Sổ đơn hàng.
                    </p>
                    <input ref={fileRef} type="file" accept=".xlsx,.csv,.tsv,.txt" className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
                    <button onClick={() => fileRef.current?.click()} disabled={uploading}
                        className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-orange-500 px-3.5 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50">
                        <Upload className="h-4 w-4" />{uploading ? "Đang đọc và soát…" : "Chọn file sao kê"}
                    </button>
                </div>
                {upErr && (
                    <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{upErr}</p>
                )}
                {stms.length > 0 && (
                    <p className="mt-2 text-xs text-muted-foreground">
                        Đã có <b>{stms.length}</b> bản sao kê. Tải lại cùng một file thì <b>thay</b>, không cộng thêm.
                    </p>
                )}
            </div>

            {/* ── Việc hôm nay ── */}
            <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                <header className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
                    <span className="text-sm font-semibold">Việc hôm nay</span>
                    {viec.length > 0 && <span className="rounded-full bg-rose-500 px-2 py-0.5 font-mono text-[11px] font-bold text-white">{viec.length}</span>}
                </header>
                {viec.length === 0 ? (
                    <div className="flex items-center gap-3 px-4 py-5">
                        <CheckCircle2 className="h-6 w-6 flex-none text-emerald-500" />
                        <div>
                            <div className="font-semibold text-emerald-700 dark:text-emerald-400">Không có việc gì cần làm</div>
                            <div className="text-sm text-muted-foreground">Sao kê kỳ mới nhất sạch, không đơn nào quá hạn đòi tiền.</div>
                        </div>
                    </div>
                ) : (
                    <ul className="divide-y divide-border">
                        {viec.map((v) => (
                            <li key={v.id} className="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3">
                                <span className={cn("mt-1.5 h-2 w-2 flex-none rounded-full",
                                    v.muc === "gap" ? "bg-rose-500" : v.muc === "soat" ? "bg-amber-400" : "bg-sky-500")} />
                                <div className="min-w-0 flex-1">
                                    <span className="font-semibold">{v.tieu_de}</span>
                                    <span className={cn("ml-1.5 rounded px-1.5 font-mono text-[11px] font-bold",
                                        v.muc === "gap" ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
                                            : v.muc === "soat" ? "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
                                                : "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300")}>
                                        {v.don_vi === "đ" ? VND(v.so) : `${formatNumber(v.so)} ${v.don_vi}`}
                                    </span>
                                    <p className="mt-0.5 text-[12.5px] text-muted-foreground">{v.chi_tiet}</p>
                                </div>
                                {v.id === "doi-naza" && (
                                    <button onClick={exportForPartner}
                                        className="flex-none rounded-lg bg-rose-500 px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-rose-600">
                                        <Download className="mr-1 inline h-3.5 w-3.5" />Xuất danh sách đòi
                                    </button>
                                )}
                                {v.id === "ghi-so" && (
                                    <button onClick={() => { navigator.clipboard?.writeText(String(v.so)); setCopied(v.id); setTimeout(() => setCopied(""), 2000); }}
                                        className="flex-none rounded-lg border border-border px-3 py-1.5 text-[12.5px] hover:bg-muted">
                                        <Copy className="mr-1 inline h-3.5 w-3.5" />{copied === v.id ? "Đã chép" : "Chép số"}
                                    </button>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            {/* ── Kỳ đang soát ── */}
            {period && (
                <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                    <header className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/40 px-4 py-2.5">
                        <span className="text-sm font-semibold">Kỳ đang soát</span>
                        <div className="relative">
                            <select value={period.id} onChange={(e) => setPid(e.target.value)}
                                className="appearance-none rounded-lg border border-border bg-card py-1 pl-2.5 pr-7 text-[12.5px] font-medium">
                                {periods.map((p, i) => (
                                    <option key={p.id} value={p.id}>
                                        {i === 0 ? "★ " : ""}{p.filename.replace(/\.[^.]+$/, "")}{p.period_date ? ` — chốt ${p.period_date}` : ""}
                                    </option>
                                ))}
                            </select>
                            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 opacity-60" />
                        </div>
                        <button onClick={exportForPartner}
                            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[12.5px] hover:bg-muted">
                            <Download className="h-3.5 w-3.5" />Xuất file gửi 3PL
                        </button>
                    </header>
                    <div className="grid gap-px bg-border sm:grid-cols-3">
                        <Kpi label="Kỳ này về tiền" value={TWD(period.total_twd)} sub={`${formatNumber(period.orders_paid)} đơn`} tone="green" />
                        <Kpi label="3PL phải chuyển về" value={period.settlement?.payable_vnd != null ? VND(period.settlement.payable_vnd) : "—"}
                            sub="sau khi trừ phí và tiền hàng" />
                        <Kpi label="Phí kỳ này" value={RMB(period.fee_rmb)} sub="ship + thao tác" />
                    </div>
                </section>
            )}

            {/* ── 8 mục kiểm tra ── */}
            <ChecksCard title="Soát chính FILE — tin được số trong đó không" checks={checks.filter((c) => c.nhom === "A")} />
            <ChecksCard title="Soát ĐƠN — file đúng rồi, giờ so với đơn của mình" checks={checks.filter((c) => c.nhom === "B")} />

            {/* ── Tỷ giá qua các kỳ ── */}
            {rates.length > 1 && (
                <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                    <header className="border-b border-border bg-muted/40 px-4 py-2.5">
                        <div className="text-sm font-semibold">Tỷ giá NAZA đặt qua các kỳ</div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                            Tỷ giá do NAZA tự đặt, đổi gần như mỗi kỳ. Lệch 1% trên 300.000 NT$ là khoảng 2,3 triệu đồng.
                        </p>
                    </header>
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[560px] text-[12.5px]">
                            <thead className="border-b border-border text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                                <tr>
                                    <th className="px-3 py-1.5 text-left">Kỳ chốt</th>
                                    <th className="px-3 py-1.5 text-left">File</th>
                                    <th className="px-3 py-1.5 text-right">TWD→RMB</th><th className="px-3 py-1.5 text-right">Đổi</th>
                                    <th className="px-3 py-1.5 text-right">RMB→VND</th><th className="px-3 py-1.5 text-right">Đổi</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {rates.map((r) => (
                                    <tr key={r.filename}>
                                        <td className="px-3 py-1.5 font-mono">{r.period_date || "—"}</td>
                                        <td className="px-3 py-1.5 text-[11.5px] text-muted-foreground">
                                            {r.filename.replace(/ĐỐI SOÁT COD|TAIWAN|\.xlsx/gi, "").trim() || r.filename}
                                        </td>
                                        <td className="px-3 py-1.5 text-right font-mono tabular-nums">{r.rate_twd_rmb ?? "—"}</td>
                                        <td className="px-3 py-1.5 text-right"><Delta v={r.d_twd_rmb} /></td>
                                        <td className="px-3 py-1.5 text-right font-mono tabular-nums">{r.rate_rmb_vnd ?? "—"}</td>
                                        <td className="px-3 py-1.5 text-right"><Delta v={r.d_rmb_vnd} /></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            )}

            {/* ── Đơn quá hạn ── */}
            {quaHan.length > 0 && (
                <section className="overflow-hidden rounded-xl border border-rose-300 bg-card shadow-sm dark:border-rose-500/40">
                    <header className="flex items-center gap-2 border-b border-border bg-rose-50 px-4 py-2.5 dark:bg-rose-500/10">
                        <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                        <span className="text-sm font-semibold text-rose-800 dark:text-rose-300">
                            {formatNumber(quaHan.length)} đơn quá hạn — đã qua từ 2 kỳ sao kê mà chưa được trả
                        </span>
                        <span className="ml-auto font-mono text-sm font-bold text-rose-700 dark:text-rose-400">
                            {TWD(quaHan.reduce((a, x) => a + x.cod_twd, 0))}
                        </span>
                    </header>
                    <table className="w-full text-[12.5px]">
                        <tbody className="divide-y divide-border">
                            {quaHan.map((p) => (
                                <tr key={p.tracking}>
                                    <td className="px-4 py-1.5 font-semibold">{p.order_no}</td>
                                    <td className="px-3 py-1.5 font-mono text-[11px] text-indigo-700 dark:text-indigo-300">{p.tracking}</td>
                                    <td className="px-3 py-1.5">{p.contact_name || "—"}</td>
                                    <td className="px-3 py-1.5 font-mono text-[11px] text-violet-600/85">{p.phone || "—"}</td>
                                    <td className="px-3 py-1.5 text-right">
                                        <span className="rounded bg-rose-600 px-1.5 font-mono text-[10px] font-bold text-white">{p.ky_da_qua} kỳ</span>
                                    </td>
                                    <td className="px-4 py-1.5 text-right font-bold tabular-nums">{TWD(p.cod_twd)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </section>
            )}
        </div>
    );
}

function Delta({ v }: { v: number | null }) {
    if (v === null || v === undefined) return <span className="text-muted-foreground/50">—</span>;
    if (Math.abs(v) < 0.005) return <span className="text-muted-foreground/50">=</span>;
    return (
        <span className={cn("font-mono font-semibold tabular-nums",
            v > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
            {v > 0 ? "▲" : "▼"} {Math.abs(v).toFixed(2)}%
        </span>
    );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "green" }) {
    return (
        <div className="bg-card px-4 py-3">
            <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</div>
            <div className={cn("mt-0.5 font-mono text-xl font-bold tabular-nums",
                tone === "green" && "text-emerald-600 dark:text-emerald-400")}>{value}</div>
            {sub && <div className="text-[11.5px] text-muted-foreground">{sub}</div>}
        </div>
    );
}

function ChecksCard({ title, checks }: { title: string; checks: Check[] }) {
    if (!checks.length) return null;
    const bad = checks.filter((c) => c.ok === false).length;
    return (
        <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <header className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
                <span className="text-sm font-semibold">{title}</span>
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold",
                    bad ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
                        : "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300")}>
                    {bad ? `${bad} mục cần xử` : "sạch"}
                </span>
            </header>
            <div className="divide-y divide-border">
                {checks.map((c) => (
                    <div key={c.ten} className="flex items-start gap-2.5 px-4 py-2.5">
                        <span className={cn("mt-0.5 flex h-[19px] w-[19px] flex-none items-center justify-center rounded-[5px] text-[11px] font-bold text-white",
                            c.ok === true ? "bg-emerald-500" : c.ok === false ? "bg-rose-500" : "bg-amber-500")}>
                            {c.ok === true ? "✓" : c.ok === false ? "!" : "i"}
                        </span>
                        <div>
                            <div className="text-[13px] font-semibold">{c.ten}</div>
                            <p className="text-[12.5px] text-muted-foreground">{c.chi_tiet}</p>
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
}

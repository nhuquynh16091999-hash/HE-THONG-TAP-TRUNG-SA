"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { Upload, AlertTriangle, Trash2, Download } from "lucide-react";
import TabSkeleton, { ErrorState } from "@/components/ui/tab-skeleton";
import { formatNumber, cn } from "../utils";

interface Props { dateRange?: { from: Date; to: Date }; projectId?: string }

type Verdict = "khop" | "lech_tien" | "chua_ve_tien" | "qua_han" | "thua_o_sao_ke";

type Line = {
    verdict: Verdict; order_uid: string | null; order_id: string; tracking: string;
    order_date: string | null; status_name: string | null;
    marketer: string | null; sale: string | null;
    pos_amount: number; stm_amount: number; diff: number; fee: number; paid_date: string;
    matched_by: "tracking" | "order_id_giao_lai" | null;
    paid_tracking: string | null; age_days: number | null;
};

type Summary = {
    matched: number; mismatched: number; missing_in_statement: number; extra_in_statement: number;
    overdue: number; overdue_amount: number; reshipped: number;
    pos_total: number; stm_total: number; fee_total: number; diff_total: number; pending_amount: number;
};

type StatementMeta = {
    id: string; filename: string; uploaded_at: string; row_count: number;
    detected_columns: string[]; missing_columns: string[]; kind?: "naza" | "csv";
};

/** Phần chỉ có ở sao kê NAZA .xlsx — phép quyết toán và kết quả soát phí. */
type Naza = {
    sheets: { summary: string | null; cod: string | null; fee: string | null };
    summary: {
        cod_twd: number | null; refund_twd: number | null; rate_twd_rmb: number | null;
        ship_fee_rmb: number | null; op_fee_rmb: number | null; net_rmb: number | null;
        rate_rmb_vnd: number | null; purchase_vnd: number | null; payable_vnd: number | null;
        fees_combined: boolean;
    };
    checks: { math_ok: boolean | null; math_note: string; cod_gap: number | null };
    fee_audit: {
        checked: number; ok: number; wrong: number; unknown_channel: number; overcharge_rmb: number;
        lines: { tracking: string; order_id: string; channel: string; kg: number | null;
                 expected: number; charged: number; diff: number }[];
    };
};

const TWD = (n: number) => `${Math.round(n).toLocaleString("vi-VN")} $`;

const RMB = (n: number) => `${Math.round(n).toLocaleString("vi-VN")} ¥`;
const VND = (n: number) => `${Math.round(n).toLocaleString("vi-VN")} đ`;

const VERDICTS: { id: Verdict | "all"; label: string; hint: string }[] = [
    { id: "all", label: "Tất cả", hint: "" },
    { id: "qua_han", label: "Quá hạn", hint: "giao lâu rồi mà tiền vẫn chưa về — đi đòi" },
    { id: "lech_tien", label: "Lệch tiền", hint: "3PL trả khác số mình ghi" },
    { id: "chua_ve_tien", label: "Chưa về tiền", hint: "đã giao, còn trong nhịp thanh toán" },
    { id: "thua_o_sao_ke", label: "Thừa ở sao kê", hint: "sao kê có mà mình không thấy đơn" },
    { id: "khop", label: "Khớp", hint: "" },
];

const VERDICT_STYLE: Record<Verdict, string> = {
    khop: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
    lech_tien: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400",
    chua_ve_tien: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
    qua_han: "bg-red-600 text-white dark:bg-red-600 dark:text-white",
    thua_o_sao_ke: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400",
};
const VERDICT_LABEL: Record<Verdict, string> = {
    khop: "Khớp", lech_tien: "Lệch tiền", chua_ve_tien: "Chưa về tiền",
    qua_han: "QUÁ HẠN", thua_o_sao_ke: "Thừa ở sao kê",
};

export default function TALPHACodReconTab({ dateRange }: Props) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [uploadError, setUploadError] = useState("");
    const [uploading, setUploading] = useState(false);
    const [lines, setLines] = useState<Line[]>([]);
    const [summary, setSummary] = useState<Summary | null>(null);
    const [statements, setStatements] = useState<StatementMeta[]>([]);
    const [statementId, setStatementId] = useState("");
    const [warnings, setWarnings] = useState<string[]>([]);
    const [matchKey, setMatchKey] = useState("tracking");
    const [naza, setNaza] = useState<Naza | null>(null);
    const [orderSource, setOrderSource] = useState<"pos" | "doi_tac" | "ca_hai">("pos");
    const [filter, setFilter] = useState<Verdict | "all">("qua_han");
    const fileRef = useRef<HTMLInputElement>(null);

    const from = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : "2026-01-01";
    const to = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

    const load = useCallback(async () => {
        setLoading(true); setError("");
        try {
            const p = new URLSearchParams({ from, to });
            if (statementId) p.set("statement", statementId);
            const res = await fetch(`/api/talpha/cod-recon?${p}`);
            const d = await res.json();
            if (!res.ok) throw new Error(d.error || "Không đối soát được");
            setLines(d.lines || []);
            setSummary(d.summary || null);
            setStatements(d.statements || []);
            setWarnings(d.warnings || []);
            setMatchKey(d.match_key || "tracking");
            setNaza(d.naza || null);
            setOrderSource(d.order_source || "pos");
            if (!statementId && d.statement_id) setStatementId(d.statement_id);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Lỗi không rõ");
        } finally { setLoading(false); }
    }, [from, to, statementId]);

    useEffect(() => { load(); }, [load]);

    const upload = async (file: File) => {
        setUploading(true); setUploadError("");
        try {
            const fd = new FormData();
            fd.append("file", file);
            const res = await fetch("/api/talpha/cod-recon", { method: "POST", body: fd });
            const d = await res.json();
            if (!res.ok) throw new Error(d.error || "Tải lên thất bại");
            setStatementId(d.statement.id);
        } catch (e) {
            setUploadError(e instanceof Error ? e.message : "Tải lên thất bại");
        } finally {
            setUploading(false);
            if (fileRef.current) fileRef.current.value = "";
        }
    };

    const removeStatement = async (id: string) => {
        await fetch(`/api/talpha/cod-recon?statement=${id}`, { method: "DELETE" });
        setStatementId("");
        load();
    };

    const exportCsv = () => {
        const head = ["Kết luận", "Mã đơn", "Vận đơn", "Vận đơn 3PL đã trả", "Ngày đơn",
            "Số ngày", "Trạng thái", "Tiền mình ghi (TWD)", "Tiền sao kê (TWD)", "Lệch",
            "Ngày TT", "Marketer", "Sale"];
        const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
        const body = shown.map((l) => [
            VERDICT_LABEL[l.verdict], l.order_id, l.tracking,
            l.paid_tracking && l.paid_tracking !== l.tracking ? l.paid_tracking : "",
            l.order_date || "", l.age_days ?? "", l.status_name || "",
            l.pos_amount, l.stm_amount, l.diff, l.paid_date, l.marketer || "", l.sale || "",
        ].map(esc).join(","));
        const blob = new Blob(["﻿" + [head.map(esc).join(","), ...body].join("\n")],
            { type: "text/csv;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `doi-soat-cod_${from}_${to}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    if (loading && !summary) return <TabSkeleton cards={4} rows={8} showChart={false} />;
    if (error) return <ErrorState message={error} onRetry={load} />;

    const shown = filter === "all" ? lines : lines.filter((l) => l.verdict === filter);
    const count = (v: Verdict) => lines.filter((l) => l.verdict === v).length;
    const current = statements.find((s) => s.id === statementId);

    return (
        <div className="space-y-5">
            {/* ── Tải sao kê ── */}
            <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-3">
                    <div>
                        <h3 className="text-sm font-semibold">Sao kê đơn vị vận chuyển</h3>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                            File <span className="font-mono">.xlsx</span> của NAZA (ba sheet TỔNG · COD · PHÍ),
                            hoặc .csv của đối tác khác. Khớp theo mã vận đơn, đơn giao lại thì khớp tiếp bằng mã đơn.
                        </p>
                    </div>
                    <input ref={fileRef} type="file" accept=".xlsx,.csv,.tsv,.txt"
                        className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
                    <button onClick={() => fileRef.current?.click()} disabled={uploading}
                        className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50">
                        <Upload className="h-4 w-4" />
                        {uploading ? "Đang đọc…" : "Tải sao kê lên"}
                    </button>
                </div>

                {uploadError && (
                    <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
                        {uploadError}
                    </p>
                )}

                {statements.length > 0 && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                        <select value={statementId} onChange={(e) => setStatementId(e.target.value)}
                            className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm">
                            {statements.map((s) => (
                                <option key={s.id} value={s.id}>
                                    {s.filename} — {formatNumber(s.row_count)} dòng — {new Date(s.uploaded_at).toLocaleString("vi-VN")}
                                </option>
                            ))}
                        </select>
                        {current && (
                            <button onClick={() => removeStatement(current.id)}
                                className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-muted">
                                <Trash2 className="h-3.5 w-3.5" /> Xoá bản này
                            </button>
                        )}
                        {current?.kind === "naza" && (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
                                Sao kê NAZA — đọc được cả phí
                            </span>
                        )}
                        {orderSource !== "pos" && (
                            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:bg-sky-500/15 dark:text-sky-400">
                                {orderSource === "ca_hai" ? "Đơn gộp POS + file đối tác" : "Đơn đọc từ file đối tác"}
                            </span>
                        )}
                        {current && current.missing_columns.length > 0 && (
                            <span className="text-xs text-muted-foreground">
                                Cột không đọc được: <span className="font-mono">{current.missing_columns.join(", ")}</span>
                            </span>
                        )}
                    </div>
                )}
            </div>

            {warnings.map((w) => (
                <div key={w} className="flex gap-3 rounded-xl border-l-4 border-amber-500 bg-amber-50 p-4 text-sm dark:bg-amber-500/10">
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-amber-600 dark:text-amber-400" />
                    <p className="text-amber-900 dark:text-amber-200">{w}</p>
                </div>
            ))}

            {/* ── Phép quyết toán của kỳ: 3PL thu về bao nhiêu, trừ những gì, còn lại bao nhiêu ── */}
            {naza && (
                <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
                    <div className="flex flex-wrap items-baseline gap-2">
                        <h3 className="text-sm font-semibold">Quyết toán kỳ này</h3>
                        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium",
                            naza.checks.math_ok
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400"
                                : "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400")}>
                            {naza.checks.math_ok ? "Phép tính tự khớp" : "Phép tính KHÔNG khớp"}
                        </span>
                        <span className="ml-auto text-xs text-muted-foreground">{naza.checks.math_note}</span>
                    </div>
                    <div className="mt-3 overflow-x-auto">
                        <table className="w-full min-w-[540px] text-sm">
                            <tbody>
                                <SettleRow label="COD thu về trong kỳ" value={naza.summary.cod_twd} unit="TWD" />
                                {!!naza.summary.refund_twd && (
                                    <SettleRow label="Hoàn tiền khiếu nại" value={-Math.abs(naza.summary.refund_twd)} unit="TWD" neg />
                                )}
                                <SettleRow label={`Quy sang RMB (tỷ giá ${naza.summary.rate_twd_rmb ?? "?"})`}
                                    value={naza.summary.cod_twd !== null && naza.summary.rate_twd_rmb !== null
                                        ? naza.summary.cod_twd * naza.summary.rate_twd_rmb : null} unit="RMB" />
                                <SettleRow label={naza.summary.fees_combined ? "Phí vận chuyển + thao tác" : "Phí vận chuyển"}
                                    value={naza.summary.ship_fee_rmb} unit="RMB" neg />
                                {!naza.summary.fees_combined && !!naza.summary.op_fee_rmb && (
                                    <SettleRow label="Phí thao tác" value={naza.summary.op_fee_rmb} unit="RMB" neg />
                                )}
                                <SettleRow label="Còn lại sau phí" value={naza.summary.net_rmb} unit="RMB" bold />
                                {!!naza.summary.purchase_vnd && (
                                    <SettleRow label="Trừ phí mua hàng" value={-naza.summary.purchase_vnd} unit="VND" neg />
                                )}
                                <SettleRow label="3PL PHẢI CHUYỂN VỀ" value={naza.summary.payable_vnd} unit="VND" bold big />
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ── Soát phí: 3PL tính đúng bảng giá không ── */}
            {naza && naza.fee_audit.checked > 0 && (
                <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
                    <div className="flex flex-wrap items-baseline gap-3">
                        <h3 className="text-sm font-semibold">Soát phí với bảng giá 3PL</h3>
                        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium",
                            naza.fee_audit.wrong === 0
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400"
                                : "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400")}>
                            {naza.fee_audit.wrong === 0
                                ? `${formatNumber(naza.fee_audit.ok)}/${formatNumber(naza.fee_audit.checked)} dòng đúng bảng giá`
                                : `${formatNumber(naza.fee_audit.wrong)} dòng SAI — chênh ${RMB(naza.fee_audit.overcharge_rmb)}`}
                        </span>
                        {naza.fee_audit.unknown_channel > 0 && (
                            <span className="text-xs text-muted-foreground">
                                {formatNumber(naza.fee_audit.unknown_channel)} dòng chưa nhận ra kênh giao hàng
                            </span>
                        )}
                    </div>
                    {naza.fee_audit.lines.length > 0 && (
                        <div className="mt-3 overflow-x-auto">
                            <table className="w-full min-w-[620px] text-sm">
                                <thead className="border-b border-border text-xs text-muted-foreground">
                                    <tr>
                                        <th className="px-2 py-1.5 text-left">Mã đơn</th>
                                        <th className="px-2 py-1.5 text-left">Vận đơn</th>
                                        <th className="px-2 py-1.5 text-left">Kênh</th>
                                        <th className="px-2 py-1.5 text-right">Kg</th>
                                        <th className="px-2 py-1.5 text-right">Bảng giá</th>
                                        <th className="px-2 py-1.5 text-right">Đã thu</th>
                                        <th className="px-2 py-1.5 text-right">Chênh</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border">
                                    {naza.fee_audit.lines.slice(0, 50).map((l) => (
                                        <tr key={l.tracking + l.order_id}>
                                            <td className="px-2 py-1.5 font-medium">{l.order_id}</td>
                                            <td className="px-2 py-1.5 font-mono text-xs">{l.tracking}</td>
                                            <td className="px-2 py-1.5 text-xs text-muted-foreground">{l.channel}</td>
                                            <td className="px-2 py-1.5 text-right tabular-nums">{l.kg ?? "—"}</td>
                                            <td className="px-2 py-1.5 text-right tabular-nums">{RMB(l.expected)}</td>
                                            <td className="px-2 py-1.5 text-right tabular-nums">{RMB(l.charged)}</td>
                                            <td className={cn("px-2 py-1.5 text-right font-medium tabular-nums",
                                                l.diff > 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400")}>
                                                {l.diff > 0 ? "+" : ""}{RMB(l.diff)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {summary && (
                <>
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                        <Stat label="Quá hạn — phải đi đòi" value={TWD(summary.overdue_amount)}
                            sub={`${formatNumber(summary.overdue)} đơn giao xong quá lâu mà tiền chưa về`}
                            tone={summary.overdue > 0 ? "bad" : undefined} />
                        <Stat label="Tiền treo ở 3PL" value={TWD(summary.pending_amount)}
                            sub={`${formatNumber(summary.missing_in_statement)} đơn đã giao chưa thấy trên sao kê`} tone="warn" />
                        <Stat label="Lệch tiền" value={TWD(summary.diff_total)}
                            sub={`${formatNumber(summary.mismatched)} đơn khớp mã nhưng khác số`}
                            tone={Math.abs(summary.diff_total) > 0 ? "bad" : undefined} />
                        <Stat label="Khớp sạch" value={formatNumber(summary.matched)}
                            sub={`trên tổng ${formatNumber(lines.length)} dòng đối chiếu`} tone="good" />
                        <Stat label="Đơn giao lại" value={formatNumber(summary.reshipped)}
                            sub="3PL gửi lần hai bằng mã vận đơn mới — khớp qua mã đơn" />
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <div className="inline-flex flex-wrap rounded-lg border border-border bg-muted/40 p-1">
                            {VERDICTS.map((v) => {
                                const n = v.id === "all" ? lines.length : count(v.id as Verdict);
                                return (
                                    <button key={v.id} onClick={() => setFilter(v.id)} title={v.hint}
                                        className={cn("rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                                            filter === v.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                                        {v.label} <span className="tabular-nums opacity-60">{n}</span>
                                    </button>
                                );
                            })}
                        </div>
                        <button onClick={exportCsv} disabled={!shown.length}
                            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-40">
                            <Download className="h-3.5 w-3.5" /> Xuất CSV
                        </button>
                    </div>

                    <div className="rounded-xl border border-border bg-card shadow-sm">
                        <div className="max-h-[560px] overflow-auto">
                            <table className="w-full min-w-[900px] text-sm">
                                <thead className="sticky top-0 bg-card">
                                    <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                                        <th className="px-3 py-2.5 text-left font-medium">Kết luận</th>
                                        <th className="px-3 py-2.5 text-left font-medium">Mã đơn</th>
                                        <th className="px-3 py-2.5 text-left font-medium">Vận đơn</th>
                                        <th className="px-3 py-2.5 text-left font-medium">Ngày đơn</th>
                                        <th className="px-3 py-2.5 text-right font-medium">POS</th>
                                        <th className="px-3 py-2.5 text-right font-medium">Sao kê</th>
                                        <th className="px-3 py-2.5 text-right font-medium">Lệch</th>
                                        <th className="px-3 py-2.5 text-left font-medium">Marketer</th>
                                        <th className="px-3 py-2.5 text-left font-medium">Sale</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {shown.slice(0, 500).map((l, i) => (
                                        <tr key={`${l.order_uid || l.tracking}-${i}`} className="border-b border-border/40 last:border-0 hover:bg-muted/40">
                                            <td className="px-3 py-2">
                                                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", VERDICT_STYLE[l.verdict])}>
                                                    {VERDICT_LABEL[l.verdict]}
                                                    {l.verdict === "qua_han" && l.age_days !== null && ` ${l.age_days}n`}
                                                </span>
                                            </td>
                                            <td className="px-3 py-2 font-mono text-xs">{l.order_id || "—"}</td>
                                            <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{l.tracking || "—"}</td>
                                            <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{l.order_date || "—"}</td>
                                            <td className="px-3 py-2 text-right font-mono tabular-nums">{l.pos_amount ? TWD(l.pos_amount) : "—"}</td>
                                            <td className="px-3 py-2 text-right font-mono tabular-nums">{l.stm_amount ? TWD(l.stm_amount) : "—"}</td>
                                            <td className={cn("px-3 py-2 text-right font-mono tabular-nums",
                                                l.diff < 0 && "text-rose-600 dark:text-rose-400",
                                                l.diff > 0 && "text-sky-600 dark:text-sky-400")}>
                                                {l.diff ? TWD(l.diff) : "—"}
                                            </td>
                                            <td className="px-3 py-2">{l.marketer || "—"}</td>
                                            <td className={cn("px-3 py-2", !l.sale && "text-muted-foreground")}>{l.sale || "—"}</td>
                                        </tr>
                                    ))}
                                    {!shown.length && (
                                        <tr><td colSpan={9} className="px-3 py-10 text-center text-muted-foreground">
                                            Không có dòng nào thuộc nhóm này.
                                        </td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                        {shown.length > 500 && (
                            <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
                                Hiện 500 dòng đầu trong {formatNumber(shown.length)} dòng — xuất CSV để xem đủ.
                            </p>
                        )}
                    </div>
                </>
            )}

            <p className="text-xs leading-relaxed text-muted-foreground">
                Chỉ đối chiếu đơn <b>đã giao thành công</b> có COD trong kỳ đang chọn — đơn chưa giao thì 3PL chưa có
                lý do trả tiền. <b>Chưa về tiền</b> là tiền thật đang nằm ở đơn vị vận chuyển, không phải lỗi dữ liệu;
                quá <b>30 ngày</b> mà chưa về thì chuyển sang <b>QUÁ HẠN</b> — đó là lúc phải đi đòi.
                Khớp trước bằng <b>mã vận đơn</b>, trượt mới khớp tiếp bằng <b>mã đơn</b>: đơn bị giao lại đổi mã vận
                đơn nhưng giữ nguyên mã đơn, bỏ tầng thứ hai là báo nhầm thành mất tiền.
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

/** Một dòng trong phép quyết toán. Số âm hiện đỏ, dòng tổng in đậm. */
function SettleRow({ label, value, unit, neg, bold, big }: {
    label: string; value: number | null; unit: "TWD" | "RMB" | "VND";
    neg?: boolean; bold?: boolean; big?: boolean;
}) {
    const fmt = unit === "VND" ? VND : unit === "RMB" ? RMB : TWD;
    const v = value === null ? null : (neg ? -Math.abs(value) : value);
    return (
        <tr className={cn("border-b border-border/60 last:border-0", bold && "font-semibold")}>
            <td className={cn("py-1.5 pr-4", bold ? "text-foreground" : "text-muted-foreground")}>{label}</td>
            <td className={cn("py-1.5 text-right tabular-nums",
                big && "text-lg",
                v !== null && v < 0 && "text-rose-600 dark:text-rose-400")}>
                {v === null ? "—" : fmt(v)}
            </td>
        </tr>
    );
}

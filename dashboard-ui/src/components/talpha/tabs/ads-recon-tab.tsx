"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Upload, Download, Send, Trash2, AlertTriangle, CheckCircle2, FileSpreadsheet } from "lucide-react";
import TabSkeleton, { ErrorState } from "@/components/ui/tab-skeleton";
import { cn } from "../utils";
import { VND, d6 } from "./ledger-shared";

/* ═══════════════════════════════════════════════════════════════════
   ĐỐI SOÁT CHI PHÍ QUẢNG CÁO — việc của mỗi tuần khi có 2 file.

   Mỗi tuần có hai con số nói về cùng một khoản tiền: Facebook nói đã thu
   bao nhiêu, ngân hàng nói đã trừ bao nhiêu. Màn này trả lời đúng ba câu:
   LỆCH BAO NHIÊU TIỀN · LỆCH Ở DÒNG NÀO · PHẢI LÀM GÌ TIẾP.

   Đối soát COD ở tab kia là tiền VỀ. Màn này là tiền RA.
   ═══════════════════════════════════════════════════════════════════ */

type Sev = "critical" | "warn" | "info";
type Alert = { code: string; severity: Sev; title: string; detail: string; hint: string; amount: number };
type FbRow = { line: number; date: string; amount: number; card4: string | null; txn_id: string; account_id: string; account_name: string; status: string };
type BankRow = { line: number; date: string; amount: number; card4: string | null; desc: string; ref: string; balance: number | null };
type Pair = {
    fb: FbRow; bank: BankRow; date_diff: number; amount_diff: number;
    exact: boolean; ambiguous: boolean; card_ok: boolean; confidence: "cao" | "vua" | "thap";
};
type Summary = {
    fb_total: number; bank_total: number; fee_total: number; gap: number; at_risk: number;
    counts: { critical: number; warn: number; info: number };
    period: { bank_start?: string; bank_end?: string; fb_start?: string; fb_end?: string };
};
type Result = {
    ky: string; chay_luc: string; summary: Summary;
    stats: { matched: number; fb_chargeable: number; ambiguous: number };
    alerts: Alert[]; pairs: Pair[];
    fb_unmatched: FbRow[]; bank_unmatched: BankRow[]; fb_failed: FbRow[]; other_ads: BankRow[];
    files?: { fb?: { ten: string; so_dong: number }; bank?: { ten: string; so_dong: number } };
};
type KyMeta = { ky: string; chay_luc: string; summary?: Summary };

const API = "/api/talpha/ads-recon";

const SEV_BOX: Record<Sev, string> = {
    critical: "border-l-rose-500 bg-rose-50/70 dark:bg-rose-500/[0.07]",
    warn: "border-l-amber-400 bg-amber-50/60 dark:bg-amber-500/[0.06]",
    info: "border-l-slate-300 bg-slate-50/70 dark:border-l-slate-600 dark:bg-white/[0.03]",
};
const CONF: Record<string, string> = {
    cao: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
    vua: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
    thap: "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300",
};

export default function TALPHAAdsReconTab() {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
    const [list, setList] = useState<KyMeta[]>([]);
    const [res, setRes] = useState<Result | null>(null);
    const [picked, setPicked] = useState<File[]>([]);
    const [busy, setBusy] = useState(false);
    const [hideInfo, setHideInfo] = useState(false);
    const [tab, setTab] = useState<"pairs" | "fb_unmatched" | "bank_unmatched" | "fb_failed" | "other_ads">("pairs");
    const [over, setOver] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);

    const openKy = useCallback(async (ky: string) => {
        const r = await fetch(`${API}?ky=${encodeURIComponent(ky)}`);
        const j = await r.json();
        if (r.ok) setRes(j); else setError(j.error || "Không mở được kỳ");
    }, []);

    const refresh = useCallback(async (openLatest = false) => {
        try {
            const r = await fetch(API);
            const j = await r.json();
            if (!r.ok) throw new Error(j.error || "Không đọc được danh sách kỳ");
            setList(j.periods || []);
            if (openLatest && j.periods?.length) await openKy(j.periods[0].ky);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setLoading(false);
        }
    }, [openKy]);

    useEffect(() => { refresh(true); }, [refresh]);

    // ── Chạy đối soát ────────────────────────────────────────────────────
    const run = async () => {
        if (picked.length < 2) return;
        setBusy(true); setNote({ text: "Đang đọc file và đối soát…" });
        try {
            const fd = new FormData();
            picked.slice(0, 2).forEach((f) => fd.append("file", f, f.name));
            const r = await fetch(API, { method: "POST", body: fd });
            const j = await r.json();
            if (!r.ok) throw new Error(j.error || "Đối soát thất bại");
            setRes(j); setPicked([]); setNote(null);
            if (fileRef.current) fileRef.current.value = "";
            await refresh();
        } catch (e) {
            setNote({ text: (e as Error).message, bad: true });
        } finally {
            setBusy(false);
        }
    };

    const notify = async () => {
        if (!res) return;
        setBusy(true);
        try {
            const r = await fetch(`${API}?action=notify&ky=${encodeURIComponent(res.ky)}`, { method: "POST" });
            const j = await r.json();
            setNote(j.sent?.length
                ? { text: "Đã gửi cảnh báo qua: " + j.sent.join(", ") }
                : { text: "Chưa gửi được — " + [...(j.errors || []), ...(j.skipped || [])].join(" · "), bad: true });
        } catch (e) {
            setNote({ text: (e as Error).message, bad: true });
        } finally { setBusy(false); }
    };

    const xoaKy = async () => {
        if (!res || !confirm(`Xoá kỳ ${res.ky}? Tải lại 2 file là dựng lại được.`)) return;
        await fetch(`${API}?ky=${encodeURIComponent(res.ky)}`, { method: "DELETE" });
        setRes(null); await refresh(true);
    };

    if (loading) return <TabSkeleton cards={4} rows={6} />;
    if (error) return <ErrorState message={error} onRetry={() => { setError(""); setLoading(true); refresh(true); }} />;

    const s = res?.summary;

    return (
        <div className="space-y-5">
            {/* ═══ Tải 2 file ═══ */}
            <div
                onDragOver={(e) => { e.preventDefault(); setOver(true); }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => { e.preventDefault(); setOver(false); setPicked([...e.dataTransfer.files].slice(0, 2)); }}
                className={cn("rounded-xl border-2 border-dashed p-5 transition-colors",
                    over ? "border-orange-400 bg-orange-50/50 dark:bg-orange-500/[0.06]" : "border-border bg-card dark:bg-white/[0.03]")}
            >
                <div className="flex flex-wrap items-center gap-4">
                    <Upload className="h-5 w-5 shrink-0 text-muted-foreground" />
                    <div className="min-w-[240px] flex-1">
                        <div className="text-sm font-semibold">Kéo thả 2 file vào đây, hoặc chọn file</div>
                        <div className="text-xs text-muted-foreground">
                            Chi phí thanh toán TKQC Facebook · Sao kê thẻ ngân hàng — .xlsx hoặc .csv,
                            thứ tự nào cũng được, máy tự nhận file nào là file nào.
                        </div>
                    </div>
                    <input
                        ref={fileRef} type="file" multiple accept=".xlsx,.csv,.tsv,.txt"
                        onChange={(e) => setPicked([...(e.target.files || [])].slice(0, 2))}
                        className="max-w-[260px] text-xs file:mr-2 file:rounded-md file:border file:border-border file:bg-muted file:px-3 file:py-1.5 file:text-xs"
                    />
                    <button
                        onClick={run} disabled={picked.length < 2 || busy}
                        className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-700 disabled:opacity-40"
                    >
                        {busy ? "Đang chạy…" : "Chạy đối soát"}
                    </button>
                </div>

                {picked.length > 0 && (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {picked.map((f, i) => (
                            <div key={i} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs">
                                <FileSpreadsheet className="h-4 w-4 shrink-0 text-muted-foreground" />
                                <span className="truncate font-medium">{f.name}</span>
                                <span className="ml-auto shrink-0 text-muted-foreground">{(f.size / 1024).toFixed(0)} KB</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {note && (
                <div className={cn("rounded-lg px-4 py-2.5 text-sm",
                    note.bad ? "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300"
                             : "bg-muted/60 text-muted-foreground")}>
                    {note.text}
                </div>
            )}

            {!res && (
                <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground dark:bg-white/[0.03]">
                    Chưa có kỳ nào. Tải 2 file của tuần này lên để bắt đầu.
                </div>
            )}

            {res && s && (
                <>
                    {/* ═══ Chọn kỳ + hành động ═══ */}
                    <div className="flex flex-wrap items-center gap-2">
                        <select
                            value={res.ky}
                            onChange={(e) => openKy(e.target.value)}
                            className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm"
                        >
                            {list.map((k) => (
                                <option key={k.ky} value={k.ky}>
                                    {k.ky} · {VND(k.summary?.bank_total ?? 0)}
                                </option>
                            ))}
                        </select>
                        <span className="text-xs text-muted-foreground">
                            sao kê {d6(s.period.bank_start)} → {d6(s.period.bank_end)} · chạy lúc{" "}
                            {new Date(res.chay_luc).toLocaleString("vi-VN")}
                            {res.files?.fb && ` · ${res.files.fb.ten} (${res.files.fb.so_dong} dòng)`}
                            {res.files?.bank && ` · ${res.files.bank.ten} (${res.files.bank.so_dong} dòng)`}
                        </span>
                        <div className="ml-auto flex gap-2">
                            <a href={`${API}?ky=${encodeURIComponent(res.ky)}&csv=1`}
                               className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted">
                                <Download className="h-3.5 w-3.5" /> Xuất CSV
                            </a>
                            <button onClick={notify} disabled={busy}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-40">
                                <Send className="h-3.5 w-3.5" /> Gửi cảnh báo
                            </button>
                            <button onClick={xoaKy}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10">
                                <Trash2 className="h-3.5 w-3.5" /> Xoá kỳ
                            </button>
                        </div>
                    </div>

                    {/* ═══ Số tổng ═══ */}
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                        {([
                            ["TKQC ghi thu", VND(s.fb_total), ""],
                            ["Thẻ đã bị trừ", VND(s.bank_total), ""],
                            ["Chênh lệch", VND(s.gap), s.gap !== 0 ? "text-rose-600 dark:text-rose-400" : ""],
                            ["Cần đòi / làm rõ", VND(s.at_risk), s.at_risk > 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"],
                            ["Khớp được", `${res.stats.matched}/${res.stats.fb_chargeable}`, res.stats.matched === res.stats.fb_chargeable ? "text-emerald-600 dark:text-emerald-400" : ""],
                            ["Phí ẩn ghi nhận", VND(s.fee_total), ""],
                        ] as [string, string, string][]).map(([lbl, val, cls]) => (
                            <div key={lbl} className="rounded-xl border border-border bg-card p-3.5 dark:bg-white/[0.03]">
                                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{lbl}</div>
                                <div className={cn("mt-1 text-lg font-bold tabular-nums", cls)}>{val}</div>
                            </div>
                        ))}
                    </div>

                    {/* ═══ Cảnh báo ═══ */}
                    <div className="rounded-xl border border-border bg-card p-4 dark:bg-white/[0.03]">
                        <div className="mb-3 flex flex-wrap items-center gap-3">
                            <h3 className="flex items-center gap-2 text-sm font-semibold">
                                {s.counts.critical > 0
                                    ? <AlertTriangle className="h-4 w-4 text-rose-500" />
                                    : <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                                Cảnh báo
                            </h3>
                            <span className="text-xs text-muted-foreground">
                                {s.counts.critical} nghiêm trọng · {s.counts.warn} cần xem · {s.counts.info} ghi nhận
                            </span>
                            <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                                <input type="checkbox" checked={hideInfo} onChange={(e) => setHideInfo(e.target.checked)} />
                                ẩn mục ghi nhận
                            </label>
                        </div>

                        <div className="space-y-2">
                            {res.alerts.filter((a) => !hideInfo || a.severity !== "info").map((a, i) => (
                                <div key={i} className={cn("rounded-lg border-l-4 p-3", SEV_BOX[a.severity])}>
                                    <div className="flex items-start gap-2">
                                        <div className="flex-1 text-sm font-semibold">{a.title}</div>
                                        <code className="shrink-0 text-[10px] text-muted-foreground">{a.code}</code>
                                    </div>
                                    {a.detail && <div className="mt-1 text-xs text-muted-foreground">{a.detail}</div>}
                                    {a.hint && (
                                        <div className="mt-2 border-t border-dashed border-border pt-2 text-xs">
                                            → {a.hint}
                                        </div>
                                    )}
                                </div>
                            ))}
                            {!res.alerts.length && (
                                <div className="py-6 text-center text-sm text-muted-foreground">Không có cảnh báo nào.</div>
                            )}
                        </div>
                    </div>

                    {/* ═══ Bảng chi tiết ═══ */}
                    <div className="rounded-xl border border-border bg-card p-4 dark:bg-white/[0.03]">
                        <div className="mb-3 inline-flex flex-wrap gap-1 rounded-xl border border-border bg-muted/40 p-1">
                            {([
                                ["pairs", "Cặp đã khớp", res.pairs.length],
                                ["fb_unmatched", "TKQC thu · thẻ không trừ", res.fb_unmatched.length],
                                ["bank_unmatched", "Thẻ trừ · không hoá đơn", res.bank_unmatched.length],
                                ["fb_failed", "Hoá đơn lỗi", res.fb_failed.length],
                                ["other_ads", "Ads kênh khác", res.other_ads.length],
                            ] as [typeof tab, string, number][]).map(([id, label, n]) => (
                                <button key={id} onClick={() => setTab(id)}
                                    className={cn("rounded-lg px-3 py-1.5 text-sm font-medium transition-all",
                                        tab === id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                                    {label} <span className="text-xs opacity-60">{n}</span>
                                </button>
                            ))}
                        </div>
                        <div className="overflow-x-auto">
                            <Bang tab={tab} res={res} />
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

/* ───────────────────────────────────────────────────────────────────── */

const TH = "whitespace-nowrap px-3 py-2 text-left text-[11px] uppercase tracking-wide text-muted-foreground";
const TD = "whitespace-nowrap px-3 py-2";

function Bang({ tab, res }: { tab: string; res: Result }) {
    if (tab === "pairs") {
        if (!res.pairs.length) return <Trong />;
        return (
            <table className="w-full text-sm">
                <thead className="border-b border-border">
                    <tr>{["Ngày TKQC", "Mã GD", "Tài khoản QC", "Tiền TKQC", "Ngày thẻ", "Nội dung sao kê", "Tiền thẻ", "Lệch", "Ngày lệch", "Thẻ", "Tin cậy"]
                        .map((h) => <th key={h} className={TH}>{h}</th>)}</tr>
                </thead>
                <tbody>
                    {res.pairs.map((p, i) => (
                        <tr key={i} className={cn("border-b border-border/60", !p.exact && "bg-amber-50/40 dark:bg-amber-500/[0.04]")}>
                            <td className={TD}>{d6(p.fb.date)}</td>
                            <td className={TD}>{p.fb.txn_id}</td>
                            <td className="px-3 py-2 min-w-[160px]">{p.fb.account_name || p.fb.account_id}</td>
                            <td className={cn(TD, "text-right tabular-nums")}>{VND(p.fb.amount)}</td>
                            <td className={TD}>{d6(p.bank.date)}</td>
                            <td className="px-3 py-2 min-w-[200px] text-muted-foreground">{p.bank.desc}</td>
                            <td className={cn(TD, "text-right tabular-nums")}>{VND(p.bank.amount)}</td>
                            <td className={cn(TD, "text-right tabular-nums", p.amount_diff !== 0 && "font-semibold text-rose-600 dark:text-rose-400")}>
                                {p.amount_diff ? VND(p.amount_diff) : "—"}
                            </td>
                            <td className={cn(TD, "text-right tabular-nums")}>{p.date_diff}</td>
                            <td className={cn(TD, !p.card_ok && "font-semibold text-rose-600 dark:text-rose-400")}>
                                {p.bank.card4 || p.fb.card4 || "·"}
                            </td>
                            <td className={TD}>
                                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", CONF[p.confidence])}>
                                    {p.confidence}{p.ambiguous ? " ?" : ""}
                                </span>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        );
    }

    if (tab === "fb_unmatched" || tab === "fb_failed") {
        const rows = tab === "fb_unmatched" ? res.fb_unmatched : res.fb_failed;
        if (!rows.length) return <Trong />;
        return (
            <table className="w-full text-sm">
                <thead className="border-b border-border">
                    <tr>{["Ngày", "Mã GD", "Tài khoản QC", "Số tiền", "Thẻ trên hoá đơn", "Trạng thái", "Dòng"]
                        .map((h) => <th key={h} className={TH}>{h}</th>)}</tr>
                </thead>
                <tbody>
                    {rows.map((r, i) => (
                        <tr key={i} className="border-b border-border/60">
                            <td className={TD}>{d6(r.date)}</td>
                            <td className={TD}>{r.txn_id}</td>
                            <td className="px-3 py-2 min-w-[160px]">{r.account_name || r.account_id}</td>
                            <td className={cn(TD, "text-right tabular-nums font-semibold")}>{VND(r.amount)}</td>
                            <td className={TD}>{r.card4 || "·"}</td>
                            <td className={TD}>{r.status}</td>
                            <td className={cn(TD, "text-right text-muted-foreground")}>{r.line}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        );
    }

    const rows = tab === "bank_unmatched" ? res.bank_unmatched : res.other_ads;
    if (!rows.length) return <Trong />;
    return (
        <table className="w-full text-sm">
            <thead className="border-b border-border">
                <tr>{["Ngày", "Nội dung", "Số tiền", "Thẻ", "Tham chiếu", "Số dư sau", "Dòng"]
                    .map((h) => <th key={h} className={TH}>{h}</th>)}</tr>
            </thead>
            <tbody>
                {rows.map((r, i) => (
                    <tr key={i} className="border-b border-border/60">
                        <td className={TD}>{d6(r.date)}</td>
                        <td className="px-3 py-2 min-w-[220px]">{r.desc}</td>
                        <td className={cn(TD, "text-right tabular-nums font-semibold")}>{VND(r.amount)}</td>
                        <td className={TD}>{r.card4 || "·"}</td>
                        <td className={cn(TD, "text-muted-foreground")}>{r.ref}</td>
                        <td className={cn(TD, "text-right tabular-nums text-muted-foreground")}>
                            {r.balance != null ? VND(r.balance) : "·"}
                        </td>
                        <td className={cn(TD, "text-right text-muted-foreground")}>{r.line}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

const Trong = () => <div className="py-8 text-center text-sm text-muted-foreground">Không có dòng nào.</div>;

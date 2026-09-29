"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, Info, RefreshCw, Search } from "lucide-react";
import TabSkeleton, { ErrorState } from "@/components/ui/tab-skeleton";
import WaLink from "@/components/talpha/wa-link";
import { formatNumber, cn } from "../utils";
import { VND, d6, STRIPE, PIN_TINT, rowCls, statusCls, mkCls, type Light } from "./ledger-shared";

/**
 * Sổ đơn hàng Singapore / UAE (Sỹ Anh yêu cầu 29/09/2026). Đọc /api/talpha/order-ledger/market —
 * cùng nguồn đơn với Theo dõi vận đơn và Đối soát COD. Chưa có sao kê của bên giao hàng nên
 * sổ chưa có cột tiền về; đèn nói đơn nào phải làm gì.
 */
type Row = {
    key: string; order_no: string; order_date: string | null; ship_date: string | null;
    tracking: string; carrier: string; status: string | null; status_vi: string; raw_status: string | null;
    last_event: string | null; last_event_time: string | null; fail_count: number | null;
    sku: string; quantity: number | null; customer: string; phone: string; wa: string | null;
    city: string; address: string; note: string; marketer: string; cod_local: number; cod_vnd: number | null;
    light: Light; light_note: string;
};
type Data = {
    market: { code: string; display: string; currency: string; symbol: string; rate_vnd: number };
    nguon: { nhan: string; cap_nhat: string | null; loai: "tra" | "nap" };
    canh_bao: string | null;
    rows: Row[];
};

const LIGHTS: { id: Light | "all"; label: string; on: string }[] = [
    { id: "all", label: "Tất cả", on: "border-slate-400 bg-slate-100 text-slate-800 dark:bg-slate-500/15 dark:text-slate-200" },
    { id: "do", label: "Phải xử", on: "border-rose-400 bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300" },
    { id: "vang", label: "Đang chờ", on: "border-amber-400 bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300" },
    { id: "xam", label: "Không đòi", on: "border-slate-400 bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300" },
];

const C = {
    id: "font-mono text-[10.5px] text-indigo-700 dark:text-indigo-300",
    dt: "font-mono text-[10.5px] tabular-nums text-teal-700 dark:text-teal-300",
    dt2: "font-mono text-[10.5px] tabular-nums text-teal-700/60 dark:text-teal-300/55",
    tel: "font-mono text-[10.5px] text-violet-600/85 dark:text-violet-300/80",
    faint: "text-muted-foreground/50",
};

/** Giờ ngắn "HH:MM dd/mm". Mốc chỉ có NGÀY (bảng đối tác ghi ngày, không ghi giờ — lưu
 *  thành 00:00Z) thì chỉ hiện ngày, kẻo đọc thành "07:00" như thể có giờ thật. */
const gioNgan = (iso?: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const p = (n: number) => String(n).padStart(2, "0");
    if (/T00:00(:00(\.0+)?)?Z$/.test(iso)) return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
    return `${p(d.getHours())}:${p(d.getMinutes())} ${p(d.getDate())}/${p(d.getMonth() + 1)}`;
};

export default function SoDonNuoc({ code }: { code: string }) {
    const [d, setD] = useState<Data | null>(null);
    const [err, setErr] = useState("");
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<Light | "all">("all");
    const [q, setQ] = useState("");

    const load = useCallback(async () => {
        setLoading(true); setErr("");
        try {
            const res = await fetch(`/api/talpha/order-ledger/market?market=${code}`);
            const j = await res.json();
            if (!res.ok) throw new Error(j.error || "Không dựng được sổ");
            setD(j);
        } catch (e) {
            setErr(e instanceof Error ? e.message : "Lỗi không rõ");
        } finally { setLoading(false); }
    }, [code]);
    useEffect(() => { load(); }, [load]);

    const rows = useMemo(() => d?.rows ?? [], [d]);
    const shown = useMemo(() => {
        const nd = q.trim().toLowerCase();
        return rows.filter((r) =>
            (filter === "all" || r.light === filter) &&
            (!nd || [r.order_no, r.tracking, r.customer, r.phone, r.sku, r.marketer, r.city]
                .some((v) => String(v || "").toLowerCase().includes(nd))));
    }, [rows, filter, q]);

    if (loading && !d) return <TabSkeleton cards={0} rows={12} showChart={false} />;
    if (err || !d) return <ErrorState message={err || "Không dựng được sổ"} onRetry={load} />;

    const m = d.market;
    const tien = (n: number) => `${(Math.round(n * 100) / 100).toLocaleString("vi-VN")} ${m.symbol}`;
    const count = (l: Light) => rows.filter((r) => r.light === l).length;
    const capNhat = gioNgan(d.nguon.cap_nhat);
    // Nút WhatsApp chỉ có ở nước bật whatsapp (UAE — Sỹ Anh chốt 29/09/2026). Có thì thêm một cột
    // GHIM ngay sau số thứ tự: xác nhận đơn là việc làm hằng ngày, không bắt cuộn ngang mới thấy nút.
    const coWa = rows.some((r) => r.wa);
    const WA_W = 116;
    const leftMa = 34 + (coWa ? WA_W : 0);

    const exportCsv = () => {
        const head = ["Đèn", "Mã đơn", "Trạng thái", "Ngày lên đơn", "Ngày gửi", "Hãng", "Vận đơn",
            "Sự kiện cuối", "Hàng", "SL", "Tên khách", "Điện thoại", "Khu vực", "Địa chỉ", "Marketer",
            `COD (${m.currency})`, "Quy VND", "Ghi chú đơn", "Việc cần làm"];
        const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
        const body = shown.map((r) => [r.light, r.order_no, r.status_vi, r.order_date, r.ship_date, r.carrier,
            r.tracking, r.last_event, r.sku, r.quantity, r.customer, r.phone, r.city, r.address, r.marketer,
            r.cod_local, r.cod_vnd ?? "", r.note, r.light_note].map(esc).join(","));
        const blob = new Blob(["﻿" + [head.map(esc).join(","), ...body].join("\n")], { type: "text/csv;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob); a.download = `so-don-hang_${m.code}.csv`; a.click();
        URL.revokeObjectURL(a.href);
    };

    return (
        <div className="space-y-4">
            <div className="flex gap-3 rounded-xl border-l-4 border-sky-400 bg-sky-50/70 px-4 py-2.5 text-[12.5px] dark:bg-sky-500/10">
                <Info className="mt-0.5 h-4 w-4 flex-none text-sky-600 dark:text-sky-400" />
                <p className="text-sky-900 dark:text-sky-200">
                    Đơn {m.display} lấy từ <b>{d.nguon.nhan}</b>{capNhat ? ` · ${d.nguon.loai === "tra" ? "tra" : "nạp"} lúc ${capNhat}` : ""} —
                    cùng nguồn với tab Theo dõi vận đơn. Chưa có sao kê của bên giao hàng nên sổ chưa có cột tiền về;
                    xem tiền còn ở đâu ở tab <b>Đối soát COD</b>.
                </p>
            </div>
            {d.canh_bao && (
                <div className="flex gap-3 rounded-xl border-l-4 border-amber-500 bg-amber-50/70 px-4 py-2.5 text-[12.5px] text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-amber-600 dark:text-amber-400" />{d.canh_bao}
                </div>
            )}

            <div className="flex flex-wrap items-center gap-1.5">
                {LIGHTS.map((l) => {
                    const n = l.id === "all" ? rows.length : count(l.id as Light);
                    const on = filter === l.id;
                    return (
                        <button key={l.id} onClick={() => setFilter(l.id)}
                            className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[12.5px] transition",
                                on ? cn(l.on, "font-semibold") : "border-border text-muted-foreground hover:bg-muted")}>
                            <span className={cn("h-3 w-[3px] rounded-sm", STRIPE[l.id === "all" ? "xam" : (l.id as Light)])} />
                            {l.label}<span className="font-mono text-[11.5px] opacity-70">{formatNumber(n)}</span>
                        </button>
                    );
                })}
                <div className="relative ml-auto">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input value={q} onChange={(e) => setQ(e.target.value)} id={`tim-so-don-${m.code}`}
                        placeholder="Tìm mã đơn, vận đơn, tên, SĐT, hàng…"
                        className="w-64 rounded-full border border-border bg-card py-1 pl-9 pr-3 text-[12.5px]" />
                </div>
                <button onClick={load} title="Tải lại" className="rounded-full border border-border px-2.5 py-1 hover:bg-muted">
                    <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /></button>
                <button onClick={exportCsv}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-[12.5px] hover:bg-muted">
                    <Download className="h-3.5 w-3.5" /> CSV
                </button>
            </div>

            <div className="overflow-auto rounded-xl border border-border bg-card shadow-sm" style={{ maxHeight: "min(70vh, 760px)" }}>
                <table className="border-separate border-spacing-0 whitespace-nowrap text-[11.5px]">
                    <thead>
                        <tr className="text-[9.5px] font-bold uppercase tracking-wide text-muted-foreground">
                            {([["#", 0], ...(coWa ? [["Xác nhận khách", 34]] : []), ["Mã đơn · trạng thái", leftMa]] as [string, number][]).map(([h, left], i) => (
                                <th key={h} style={{ left, ...(i === 0 ? { width: 34, minWidth: 34 } : h === "Xác nhận khách" ? { width: WA_W, minWidth: WA_W } : {}) }}
                                    className={cn("sticky top-0 z-40 bg-muted px-1.5 py-[6px]", i === 0 ? "text-right" : "text-left")}>{h}</th>
                            ))}
                            {["Lên đơn", "Gửi hàng", "Hãng", "Vận đơn", "Sự kiện cuối", "Hàng", "SL",
                                "Tên khách", "Điện thoại", "Khu vực · địa chỉ", "MKT", "COD", "Quy VND", "Ghi chú đơn"].map((h) => (
                                <th key={h} className={cn("sticky top-0 z-30 bg-muted/95 px-1.5 py-[6px] backdrop-blur",
                                    ["SL", "COD", "Quy VND"].includes(h) ? "text-right" : "text-left")}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {shown.map((r, i) => (
                            <tr key={r.key} className={rowCls(r.light)}>
                                <td className={cn("sticky left-0 z-20 w-[34px] min-w-[34px] border-b border-border bg-card px-1.5 py-[3px] text-right tabular-nums text-muted-foreground/60", PIN_TINT[r.light])}>{i + 1}</td>
                                {coWa && (
                                    <td style={{ left: 34, width: WA_W, minWidth: WA_W }} className={cn("sticky z-20 border-b border-border bg-card px-1.5 py-1", PIN_TINT[r.light])}>
                                        {r.wa ? <WaLink href={r.wa} /> : <span className={cn("text-[10.5px]", C.faint)} title="Số điện thoại không đúng dạng — sửa trên POS">số sai</span>}
                                    </td>
                                )}
                                <td style={{ left: leftMa }} className={cn("sticky z-20 border-b border-r border-border bg-card px-1.5 py-[3px]", PIN_TINT[r.light])}>
                                    <span className="flex items-center">
                                        <i title={r.light_note} className={cn("mr-1.5 inline-block h-[14px] w-[3px] flex-none rounded-sm", STRIPE[r.light])} />
                                        <b>{r.order_no || "·"}</b>
                                        <span title={r.raw_status || undefined} className={cn("ml-1.5 rounded-[3px] px-1.5 text-[9.5px] font-semibold", statusCls(r.status_vi))}>
                                            {r.status_vi}{r.fail_count && r.fail_count > 1 ? ` · lần ${r.fail_count}` : ""}
                                        </span>
                                    </span>
                                </td>
                                <td className={cn("border-b border-l border-border px-1.5 py-[3px]", C.dt)}>{d6(r.order_date)}</td>
                                <td className={cn("border-b border-border px-1.5 py-[3px]", C.dt2)}>{d6(r.ship_date)}</td>
                                <td className="border-b border-l border-border px-1.5 py-[3px] text-[10.5px]">{r.carrier || "·"}</td>
                                <td className={cn("border-b border-border px-1.5 py-[3px]", C.id)}>{r.tracking || <span className={C.faint}>chưa có</span>}</td>
                                <td className="border-b border-border px-1.5 py-[3px] text-[10.5px] text-muted-foreground">
                                    <span className="inline-block max-w-[240px] truncate align-middle" title={r.last_event || undefined}>{r.last_event || "·"}</span>
                                    {r.last_event && r.last_event_time && <span className={cn("ml-1.5", C.dt2)}>{gioNgan(r.last_event_time)}</span>}
                                </td>
                                <td className="border-b border-l border-border px-1.5 py-[3px]">
                                    <span className="inline-block max-w-[220px] truncate align-middle" title={r.sku}>{r.sku || "·"}</span>
                                </td>
                                <td className="border-b border-border px-1.5 py-[3px] text-right tabular-nums">{r.quantity ?? "·"}</td>
                                <td className="border-b border-l border-border px-1.5 py-[3px]">
                                    <span className="inline-block max-w-[160px] truncate align-middle" title={r.customer}>{r.customer || "·"}</span>
                                </td>
                                <td className={cn("border-b border-border px-1.5 py-[3px]", C.tel)}>
                                    {r.phone || "·"}
                                </td>
                                <td className="border-b border-border px-1.5 py-[3px] text-[10.5px]">
                                    <span className="inline-block max-w-[280px] truncate align-middle" title={[r.city, r.address].filter(Boolean).join(" — ")}>
                                        {r.city || "·"}{r.address ? <span className="text-muted-foreground"> · {r.address}</span> : null}
                                    </span>
                                </td>
                                <td className="border-b border-border px-1.5 py-[3px]">{r.marketer
                                    ? <span className={cn("rounded-full px-1.5 py-px text-[10px] font-semibold", mkCls(r.marketer))}>{r.marketer}</span>
                                    : <span className={C.faint}>·</span>}</td>
                                <td className="border-b border-l border-border px-1.5 py-[3px] text-right font-bold tabular-nums">{tien(r.cod_local)}</td>
                                <td className="border-b border-border px-1.5 py-[3px] text-right tabular-nums text-muted-foreground">{r.cod_vnd === null ? "·" : VND(r.cod_vnd)}</td>
                                <td className="border-b border-l border-border px-1.5 py-[3px] text-[10.5px] text-muted-foreground">
                                    <span className="inline-block max-w-[260px] truncate align-middle" title={r.note}>{r.note || "·"}</span>
                                </td>
                            </tr>
                        ))}
                        {!shown.length && (
                            <tr><td colSpan={coWa ? 17 : 16} className="px-3 py-12 text-center text-muted-foreground">Không có đơn nào trong nhóm này.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl border border-border bg-muted/30 px-4 py-2.5 text-[11.5px] text-muted-foreground">
                <span className="font-semibold text-foreground">Vạch màu:</span>
                <span><i className="mr-1.5 inline-block h-3 w-[3px] rounded-sm bg-rose-500 align-[-2px]" />phải xử — giao hỏng, đứng im, chưa gửi hàng</span>
                <span><i className="mr-1.5 inline-block h-3 w-[3px] rounded-sm bg-amber-400 align-[-2px]" />đang chờ — đang đi, hoặc đã giao chờ tiền về</span>
                <span><i className="mr-1.5 inline-block h-3 w-[3px] rounded-sm bg-slate-300 align-[-2px] dark:bg-slate-600" />không đòi — hoàn, huỷ</span>
                {coWa && <span><b className="text-emerald-700 dark:text-emerald-300">WhatsApp</b> = mở chat với khách kèm tin xác nhận đơn soạn sẵn (hàng, tiền, địa chỉ) — sửa được trước khi gửi</span>}
                <span className="ml-auto font-mono">{formatNumber(shown.length)} / {formatNumber(rows.length)} đơn — không phân trang</span>
            </div>
        </div>
    );
}

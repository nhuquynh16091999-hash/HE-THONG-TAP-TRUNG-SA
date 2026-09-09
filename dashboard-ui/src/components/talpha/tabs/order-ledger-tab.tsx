"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { AlertTriangle, Download, Search, RefreshCw, ChevronDown } from "lucide-react";
import TabSkeleton, { ErrorState } from "@/components/ui/tab-skeleton";
import { formatNumber, cn } from "../utils";
import { TWD, VND, RMB, d6, STRIPE, ROWBG, statusCls, mkCls, type Light, type LedgerRowUI } from "./ledger-shared";

interface Props { dateRange?: { from: Date; to: Date }; projectId?: string }

/** Cảnh báo mang theo BẢNG chi tiết — nói "thiếu 6 mã" rồi bảo đi mở file JSON
 *  thì người đọc vẫn phải tự tra mã nào là hàng gì, dính bao nhiêu đơn. */
type Note = {
    id: string; level: "canh_bao" | "nhac";
    title: string; detail: string;
    cols?: string[]; items?: (string | number)[][]; fix?: string;
};

const LIGHTS: { id: Light | "all"; label: string; on: string }[] = [
    { id: "all", label: "Tất cả", on: "border-slate-400 bg-slate-100 text-slate-800 dark:bg-slate-500/15 dark:text-slate-200" },
    { id: "do", label: "Phải xử", on: "border-rose-400 bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300" },
    { id: "vang", label: "Đang chờ", on: "border-amber-400 bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300" },
    { id: "xanh", label: "Xong sạch", on: "border-emerald-400 bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" },
    { id: "xam", label: "Không đòi", on: "border-slate-400 bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300" },
];

/* Màu chữ theo LOẠI dữ liệu, không tô cho vui: mã định danh một tông, ngày một
   tông, tiền một tông — mắt phân vùng được ngay mà không phải đọc tiêu đề. */
const C = {
    id: "font-mono text-[10.5px] text-indigo-700 dark:text-indigo-300",
    id2: "font-mono text-[10px] text-indigo-500/70 dark:text-indigo-400/60",
    dt: "font-mono text-[10.5px] tabular-nums text-teal-700 dark:text-teal-300",
    dt2: "font-mono text-[10.5px] tabular-nums text-teal-700/60 dark:text-teal-300/55",
    tel: "font-mono text-[10.5px] text-violet-600/85 dark:text-violet-300/80",
    fee: "tabular-nums text-amber-700/90 dark:text-amber-400/90",
    cogs: "tabular-nums text-purple-600/85 dark:text-purple-300/80",
    faint: "text-muted-foreground/50",
};

function Tick({ on, title }: { on: boolean; title: string }) {
    return (
        <span title={title} role="img" aria-label={`${title} — ${on ? "đã xong" : "chưa"}`}
            className={cn("inline-flex h-[15px] w-[15px] items-center justify-center rounded-[3px] text-[9px] font-bold",
                on ? "bg-emerald-500 text-white" : "border border-dashed border-muted-foreground/40")}>
            {on ? "✓" : ""}
        </span>
    );
}

export default function TALPHAOrderLedgerTab({ dateRange }: Props) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [rows, setRows] = useState<LedgerRowUI[]>([]);
    const [notes, setNotes] = useState<Note[]>([]);
    const [mo, setMo] = useState<Record<string, boolean>>({});
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
            setNotes(d.warnings || []);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Lỗi không rõ");
        } finally { setLoading(false); }
    }, [to]);

    useEffect(() => { load(); }, [load]);

    const shown = useMemo(() => {
        const nd = q.trim().toLowerCase();
        return rows.filter((r) =>
            (filter === "all" || r.light === filter) &&
            (!nd || [r.order_no, r.tracking, r.track17_code, r.contact_name, r.phone, r.sku, r.marketer]
                .some((v) => String(v || "").toLowerCase().includes(nd))));
    }, [rows, filter, q]);

    const exportCsv = () => {
        const head = ["Đèn", "Mã đơn", "Trạng thái", "Đối soát (tay)", "Ngày lên đơn", "Ngày xuất kho",
            "Kỳ chờ", "PTVC", "Vận đơn", "Mã đơn hoàn", "Mã 17TRACK", "SKU", "SL", "Tên khách",
            "Điện thoại", "Marketer", "COD (NT$)", "3PL trả (NT$)", "Lệch (NT$)", "Kỳ sao kê",
            "Ngày về tiền", "Phí ship (¥)", "Phí thao tác (¥)", "Giá vốn (đ)", "Còn lại (đ)", "Ghi chú"];
        const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
        const body = shown.map((r) => [r.light, r.order_no, r.status_raw, r.recon_manual,
            r.order_date, r.ship_date, r.ky_da_qua, r.ship_method, r.tracking, r.return_order_no,
            r.track17_code, r.sku, r.quantity, r.contact_name, r.phone, r.marketer,
            r.cod_twd, r.paid_twd ?? "", r.diff_twd ?? "", r.paid_period, r.paid_date,
            r.ship_fee_rmb ?? "", r.op_fee_rmb ?? "", r.cogs_vnd ?? "",
            r.net_vnd === null ? "" : Math.round(r.net_vnd),
            r.net_before_cogs ? "chưa trừ giá vốn" : r.light_note].map(esc).join(","));
        const blob = new Blob(["﻿" + [head.map(esc).join(","), ...body].join("\n")],
            { type: "text/csv;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob); a.download = `so-don-hang_${to}.csv`; a.click();
        URL.revokeObjectURL(a.href);
    };

    if (loading && !rows.length) return <TabSkeleton cards={0} rows={12} showChart={false} />;
    if (error) return <ErrorState message={error} onRetry={load} />;

    const count = (l: Light) => rows.filter((r) => r.light === l).length;

    return (
        <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
                Cơ sở dữ liệu chung — mọi đơn, mọi cột. Việc phải làm nằm bên tab <b>Đối soát COD</b>.
            </p>

            {notes.map((n) => {
                const open = mo[n.id] ?? (n.items ? n.items.length <= 8 : false);
                return (
                    <div key={n.id} className={cn("overflow-hidden rounded-xl border-l-4",
                        n.level === "canh_bao"
                            ? "border-amber-500 bg-amber-50/70 dark:bg-amber-500/10"
                            : "border-sky-400 bg-sky-50/70 dark:bg-sky-500/10")}>
                        <button onClick={() => setMo((m) => ({ ...m, [n.id]: !open }))}
                            disabled={!n.items?.length}
                            className="flex w-full items-start gap-3 px-4 py-2.5 text-left">
                            <AlertTriangle className={cn("mt-0.5 h-4 w-4 flex-none",
                                n.level === "canh_bao" ? "text-amber-600 dark:text-amber-400" : "text-sky-600 dark:text-sky-400")} />
                            <div className="min-w-0 flex-1">
                                <div className={cn("text-sm font-semibold",
                                    n.level === "canh_bao" ? "text-amber-900 dark:text-amber-200" : "text-sky-900 dark:text-sky-200")}>
                                    {n.title}
                                </div>
                                <p className={cn("text-[12.5px]",
                                    n.level === "canh_bao" ? "text-amber-800/85 dark:text-amber-200/75" : "text-sky-800/85 dark:text-sky-200/75")}>
                                    {n.detail}
                                </p>
                            </div>
                            {!!n.items?.length && (
                                <ChevronDown className={cn("mt-0.5 h-4 w-4 flex-none opacity-60 transition-transform", open && "rotate-180")} />
                            )}
                        </button>

                        {open && !!n.items?.length && (
                            <div className="border-t border-black/5 bg-card/70 dark:border-white/5">
                                <div className="max-h-72 overflow-auto">
                                    <table className="w-full text-[12px]">
                                        <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                                            <tr className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                                                {n.cols?.map((c, i) => (
                                                    <th key={c} className={cn("px-3 py-1.5", i === 0 ? "text-left" : "text-left")}>{c}</th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border">
                                            {n.items.map((it, i) => (
                                                <tr key={i}>
                                                    {it.map((v, j) => (
                                                        <td key={j} className={cn("px-3 py-1",
                                                            j === 0 && "font-mono font-semibold",
                                                            typeof v === "number" && "text-right tabular-nums")}>
                                                            {typeof v === "number" ? formatNumber(v) : v}
                                                        </td>
                                                    ))}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                {n.fix && (
                                    <p className="border-t border-border px-3 py-2 text-[12px] font-medium text-muted-foreground">
                                        → {n.fix}
                                    </p>
                                )}
                            </div>
                        )}
                    </div>
                );
            })}

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
                    <input value={q} onChange={(e) => setQ(e.target.value)}
                        placeholder="Tìm mã đơn, vận đơn, tên, SĐT, SKU…"
                        className="w-64 rounded-full border border-border bg-card py-1 pl-9 pr-3 text-[12.5px]" />
                </div>
                <button onClick={load} title="Tải lại" className="rounded-full border border-border px-2.5 py-1 hover:bg-muted">
                    <RefreshCw className="h-3.5 w-3.5" /></button>
                <button onClick={exportCsv}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-[12.5px] hover:bg-muted">
                    <Download className="h-3.5 w-3.5" /> CSV
                </button>
            </div>

            {/* Cuộn CẢ HAI chiều, dựng HẾT mọi dòng — không phân trang.
                Tiêu đề ghim trên, cột mã đơn ghim trái: cuộn kiểu gì cũng biết
                đang ở đơn nào và cột nào. */}
            <div className="overflow-auto rounded-xl border border-border bg-card shadow-sm"
                style={{ maxHeight: "min(70vh, 760px)" }}>
                <table className="border-separate border-spacing-0 whitespace-nowrap text-[11.5px]">
                    <thead>
                        <tr className="text-[9.5px] font-bold uppercase tracking-wide text-muted-foreground/70">
                            <th className="sticky left-0 top-0 z-40 bg-muted px-1.5 py-[5px] text-left" colSpan={2}></th>
                            <th className="sticky top-0 z-30 border-l border-border bg-muted px-1.5 py-[5px] text-left" colSpan={3}>Thời gian</th>
                            <th className="sticky top-0 z-30 border-l border-border bg-muted px-1.5 py-[5px] text-left" colSpan={4}>Vận chuyển</th>
                            <th className="sticky top-0 z-30 border-l border-border bg-muted px-1.5 py-[5px] text-left" colSpan={2}>Hàng</th>
                            <th className="sticky top-0 z-30 border-l border-border bg-muted px-1.5 py-[5px] text-left" colSpan={3}>Khách &amp; người chạy</th>
                            <th className="sticky top-0 z-30 border-l border-border bg-muted px-1.5 py-[5px] text-left" colSpan={5}>Tiền về</th>
                            <th className="sticky top-0 z-30 border-l border-border bg-muted px-1.5 py-[5px] text-left" colSpan={5}>Tiền ra &amp; kết quả</th>
                        </tr>
                        <tr className="text-[9.5px] font-bold uppercase tracking-wide text-muted-foreground">
                            <Th pin stt>#</Th>
                            <Th pinAfter>Mã đơn · trạng thái</Th>
                            <Th grp>Lên đơn</Th><Th>Xuất kho</Th>
                            <Th num title="Đã qua bao nhiêu KỲ SAO KÊ kể từ khi giao mà tiền chưa về. Từ 2 kỳ là phải đòi. Đơn đã nhận tiền thì để trống.">Kỳ chờ</Th>
                            <Th grp>PTVC</Th><Th>Vận đơn</Th><Th>Mã hoàn</Th><Th>17TRACK</Th>
                            <Th grp>SKU</Th><Th num>SL</Th>
                            <Th grp>Tên khách</Th><Th>Điện thoại</Th><Th>MKT</Th>
                            <Th grp num>COD</Th><Th num>3PL trả</Th><Th num>Lệch</Th><Th>Kỳ trả</Th><Th>Ngày về</Th>
                            <Th grp num>Ship</Th><Th num>Thao tác</Th><Th num>Giá vốn</Th>
                            <Th title="Đã đối soát · Đã trừ vận chuyển · Đã trừ tiền hàng">Đã trừ</Th>
                            <Th num>Còn lại</Th>
                        </tr>
                    </thead>
                    <tbody>
                        {shown.map((r, i) => {
                            /* "Kỳ chờ" chỉ có nghĩa với đơn ĐÃ GIAO mà TIỀN CHƯA VỀ. Đơn đã
                               nhận tiền thì con số này là nhiễu — để trống. */
                            const cho = r.paid_twd === null && /thành công/i.test(r.status_raw || "");
                            const skuM = (r.sku || "").match(/^(\d{3})(.*)$/);
                            return (
                                <tr key={r.tracking + r.order_no} className={cn("group", ROWBG[r.light])}>
                                    {/* Số thứ tự theo danh sách ĐANG HIỆN, không phải id đơn —
                                        lọc hay tìm thì đánh số lại từ 1, để đếm được còn bao
                                        nhiêu dòng trong nhóm mình đang xem. */}
                                    <Td pin stt light={r.light} className="text-right tabular-nums text-muted-foreground/60">
                                        {i + 1}
                                    </Td>
                                    <Td pinAfter light={r.light}>
                                        <span className="flex items-center">
                                            <i title={r.light_note} className={cn("mr-1.5 inline-block h-[14px] w-[3px] flex-none rounded-sm", STRIPE[r.light])} />
                                            <b>{r.order_no}</b>
                                            <span className={cn("ml-1.5 rounded-[3px] px-1.5 text-[9.5px] font-semibold", statusCls(r.status_raw))}>
                                                {r.status_raw || "—"}
                                            </span>
                                            {r.recon_manual && <span className={cn("ml-1 text-[9.5px]", C.faint)}>{r.recon_manual}</span>}
                                        </span>
                                    </Td>
                                    <Td grp className={C.dt}>{d6(r.order_date)}</Td>
                                    <Td className={C.dt2}>{d6(r.ship_date)}</Td>
                                    <Td num>
                                        {!cho ? <span className={C.faint}>·</span> : (
                                            <span title={`Đã qua ${r.ky_da_qua} kỳ sao kê kể từ khi giao mà tiền chưa về${r.ky_da_qua >= 2 ? " — phải đòi" : ""}`}
                                                className={cn("rounded-[3px] px-1.5 font-mono text-[10px] font-bold",
                                                    r.ky_da_qua >= 2 ? "bg-rose-600 text-white"
                                                        : "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300")}>
                                                {r.ky_da_qua} kỳ
                                            </span>
                                        )}
                                    </Td>
                                    <Td grp className="text-[10.5px]">{r.ship_method || "·"}</Td>
                                    <Td className={C.id}>{r.tracking}</Td>
                                    <Td className={C.id2}>{r.return_order_no || "·"}</Td>
                                    <Td className={C.id2}>{r.track17_code || "·"}</Td>
                                    <Td grp>
                                        <span className="inline-block max-w-[200px] truncate align-middle" title={r.sku}>
                                            {skuM ? <><b className="text-amber-700 dark:text-amber-400">{skuM[1]}</b>{skuM[2]}</> : (r.sku || "·")}
                                        </span>
                                        {r.cogs_missing.length > 0 && (
                                            <span className="ml-1 rounded-[3px] bg-amber-100 px-1.5 text-[9.5px] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                                                chưa khai giá {r.cogs_missing.join(",")}
                                            </span>
                                        )}
                                    </Td>
                                    <Td num>{r.quantity}</Td>
                                    <Td grp>{r.contact_name || "·"}</Td>
                                    <Td className={C.tel}>{r.phone || "·"}</Td>
                                    <Td>{r.marketer
                                        ? <span className={cn("rounded-full px-1.5 py-px text-[10px] font-semibold", mkCls(r.marketer))}>{r.marketer}</span>
                                        : <span className={C.faint}>·</span>}</Td>
                                    <Td grp num className="font-bold">{TWD(r.cod_twd)}</Td>
                                    <Td num>{r.paid_twd === null ? <span className={C.faint}>·</span>
                                        : <span className="font-semibold text-emerald-600 dark:text-emerald-400">{TWD(r.paid_twd)}</span>}</Td>
                                    <Td num>{r.diff_twd === null || Math.abs(r.diff_twd) <= 1 ? <span className={C.faint}>·</span>
                                        : <span className="font-bold text-rose-600 dark:text-rose-400">{r.diff_twd > 0 ? "+" : ""}{TWD(r.diff_twd)}</span>}</Td>
                                    <Td className={cn("text-[10px]", C.faint)}>
                                        <span className="inline-block max-w-[150px] truncate align-middle" title={r.paid_period}>{r.paid_period || "·"}</span>
                                    </Td>
                                    <Td className={C.dt2}>{d6(r.paid_date)}</Td>
                                    <Td grp num className={C.fee}>{r.ship_fee_rmb === null ? <span className={C.faint}>·</span>
                                        : r.fee_wrong ? <span className="font-bold text-rose-600 dark:text-rose-400">{RMB(r.ship_fee_rmb)} !</span>
                                            : RMB(r.ship_fee_rmb)}</Td>
                                    <Td num className={C.fee}>{r.op_fee_rmb === null ? "·" : RMB(r.op_fee_rmb)}</Td>
                                    <Td num className={C.cogs}>{r.cogs_vnd === null ? "·" : VND(r.cogs_vnd)}</Td>
                                    <Td>
                                        <Tick on={r.tick.doi_soat} title={r.tick.doi_soat
                                            ? `Đã có trên sao kê ${r.paid_period}${r.matched_by === "order_id_giao_lai" ? " (đơn giao lại)" : ""}`
                                            : "Sao kê chưa nhắc tới đơn này"} />
                                        <Tick on={r.tick.tru_van_chuyen} title={r.ship_fee_rmb === null ? "Chưa thấy trên bảng phí" : "Đã có dòng phí"} />
                                        <Tick on={r.tick.tru_tien_hang} title={r.cogs_vnd === null
                                            ? `Chưa khai giá vốn cho mã ${r.cogs_missing.join(", ") || "(không rõ)"}` : `Giá vốn ${VND(r.cogs_vnd)}`} />
                                    </Td>
                                    <Td num>{r.net_vnd === null ? <span className={C.faint}>·</span>
                                        : <span className={cn("font-bold", r.net_vnd < 0 ? "text-rose-600 dark:text-rose-400"
                                            : r.net_before_cogs ? "text-amber-600 dark:text-amber-400"
                                                : "text-emerald-600 dark:text-emerald-400")}>{VND(r.net_vnd)}</span>}</Td>
                                </tr>
                            );
                        })}
                        {!shown.length && (
                            <tr><td colSpan={24} className="px-3 py-12 text-center text-muted-foreground">Không có đơn nào trong nhóm này.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl border border-border bg-muted/30 px-4 py-2.5 text-[11.5px] text-muted-foreground">
                <span className="font-semibold text-foreground">Vạch màu:</span>
                <span><i className="mr-1.5 inline-block h-3 w-[3px] rounded-sm bg-rose-500 align-[-2px]" />phải xử</span>
                <span><i className="mr-1.5 inline-block h-3 w-[3px] rounded-sm bg-amber-400 align-[-2px]" />đang chờ</span>
                <span><i className="mr-1.5 inline-block h-3 w-[3px] rounded-sm bg-emerald-500 align-[-2px]" />xong</span>
                <span><i className="mr-1.5 inline-block h-3 w-[3px] rounded-sm bg-slate-300 align-[-2px] dark:bg-slate-600" />không đòi</span>
                <span><b className="text-foreground">Kỳ chờ</b> = đã qua mấy kỳ sao kê mà tiền chưa về; từ 2 kỳ là phải đòi</span>
                <span><b className="text-foreground">Còn lại</b> vàng = chưa trừ giá vốn, số đang cao hơn thật</span>
                <span className="ml-auto font-mono">{formatNumber(shown.length)} / {formatNumber(rows.length)} đơn — không phân trang</span>
            </div>
        </div>
    );
}

/** `stt` là cột số thứ tự ghim sát mép trái; `pinAfter` là cột mã đơn ghim ngay
 *  sau nó. Hai cột cùng ghim nên phải khai bề rộng cố định cho cột STT, nếu
 *  không cột thứ hai không biết dịch sang bao nhiêu. */
const STT_W = 34;

function Th({ children, grp, num, pin, pinAfter, stt, title }: {
    children?: React.ReactNode; grp?: boolean; num?: boolean;
    pin?: boolean; pinAfter?: boolean; stt?: boolean; title?: string;
}) {
    return (
        <th title={title}
            style={stt ? { width: STT_W, minWidth: STT_W } : pinAfter ? { left: STT_W } : undefined}
            className={cn("sticky top-[23px] z-30 bg-muted/95 px-1.5 py-[5px] backdrop-blur",
                num || stt ? "text-right" : "text-left", grp && "border-l border-border",
                (pin || pinAfter) && "z-40 bg-muted", pin && "left-0")}>{children}</th>
    );
}

function Td({ children, grp, num, pin, pinAfter, stt, light, className }: {
    children?: React.ReactNode; grp?: boolean; num?: boolean;
    pin?: boolean; pinAfter?: boolean; stt?: boolean; light?: Light; className?: string;
}) {
    const ghim = pin || pinAfter || stt;
    return (
        <td style={stt ? { width: STT_W, minWidth: STT_W } : pinAfter ? { left: STT_W } : undefined}
            className={cn("border-b border-border px-1.5 py-[3px]",
                num && "text-right tabular-nums", grp && "border-l border-border",
                ghim && cn("sticky z-20 bg-card", light && ROWBG[light]),
                stt && "left-0",
                pinAfter && "shadow-[1px_0_0_var(--border)]",
                className)}>{children}</td>
    );
}

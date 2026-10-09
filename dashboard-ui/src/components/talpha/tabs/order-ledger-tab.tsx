"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { format } from "date-fns";
import { Check, ChevronDown, Copy, HandCoins } from "lucide-react";
import TabSkeleton, { ErrorState } from "@/components/ui/tab-skeleton";
import { formatNumber, cn } from "../utils";
import {
    TWD, VND, RMB, d6, STRIPE, PIN_TINT, rowCls, statusCls, mkCls, tinDoiTien,
    type Light, type LedgerRowUI, type DonChoTien,
} from "./ledger-shared";
import ThanhNhapBangDon, { bangDaCu, nhanNapGon, type NhapBangDon } from "@/components/talpha/nhap-bang-don";
import SoDonNuoc from "./order-ledger-market";
import { DanhSachThe, KhoiViecCanSua, OLocDon, TheDon, ThanhCongCu, useManHep, type ViecSua } from "./so-don-ui";

interface Props { dateRange?: { from: Date; to: Date }; projectId?: string }

/** Cảnh báo mang theo BẢNG chi tiết — nói "thiếu 6 mã" rồi bảo đi mở file JSON
 *  thì người đọc vẫn phải tự tra mã nào là hàng gì, dính bao nhiêu đơn. Hiện trong khung
 *  "việc cần sửa dữ liệu" (so-don-ui.tsx), mặc định gập. */
type Note = ViecSua;

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

/**
 * Nút chọn nước (Sỹ Anh yêu cầu 29/09/2026): Đài Loan giữ nguyên sổ NAZA + sao kê; Singapore,
 * UAE dùng sổ theo vận đơn (SoDonNuoc) vì chưa có sao kê. Danh sách nước lấy từ
 * /api/talpha/markets — không gõ cứng ở giao diện.
 *
 * Phân quyền theo team (05/10/2026): danh sách chỉ còn nước của team người xem, nên CHỜ có
 * danh sách rồi mới dựng sổ và mở ở nước đầu tiên được xem — mặc định cứng "TW" thì leader
 * UAE mở tab là đụng ngay sổ Đài, máy chủ từ chối, màn lỗi che mất nút đổi nước.
 */
export default function TALPHAOrderLedgerTab(props: Props) {
    const [nuoc, setNuoc] = useState("TW");
    const [ds, setDs] = useState<{ code: string; display: string }[] | null>(null);
    // Nước của team đang bán nhưng chưa có sổ (chưa khai hãng vận chuyển — Nhật 09/10/2026).
    const [chuaCoSo, setChuaCoSo] = useState<string[]>([]);
    useEffect(() => {
        fetch("/api/talpha/markets").then((r) => r.json())
            .then((d: { markets?: { code: string; display: string; status?: string; co_van_don?: boolean }[] }) => {
                const dangBan = (d.markets || []).filter((m) => m.status !== "sap_chay");
                // Sổ đơn đọc đơn + trạng thái giao qua hãng vận chuyển: nước chưa khai tracking.markets
                // (Nhật Bản lúc mới mở) gọi sổ là máy chủ trả 400 — ẩn nút thay vì hiện màn lỗi.
                const list = dangBan.filter((m) => m.co_van_don !== false).map((m) => ({ code: m.code, display: m.display }));
                setChuaCoSo(dangBan.filter((m) => m.co_van_don === false).map((m) => m.display));
                setDs(list);
                setNuoc((n) => (list.length && !list.some((m) => m.code === n) ? list[0].code : n));
            })
            .catch(() => setDs([]));   // không lấy được danh sách nước thì vẫn hiện sổ Đài như cũ
    }, []);
    if (ds === null) return <TabSkeleton />;
    // Team chỉ có nước chưa có sổ: nói thẳng, đừng mở sổ Đài (máy chủ sẽ từ chối, màn lỗi khó hiểu).
    if (!ds.length && chuaCoSo.length) {
        return (
            <div className="rounded-xl border border-border bg-card px-5 py-6 text-sm text-muted-foreground">
                Sổ đơn {chuaCoSo.join(", ")} chưa mở được: chưa khai hãng vận chuyển (chưa có mã vận đơn để theo dõi giao hàng).
                Đơn của nước này xem tạm ở Kế toán → Tiền COD về.
            </div>
        );
    }
    // Nút chọn nước nằm CÙNG hàng với thanh công cụ của sổ (07/10/2026) — truyền xuống để sổ tự xếp.
    const nutNuoc = ds.length > 1 ? (
        <div className="inline-flex rounded-lg border border-border bg-muted/40 p-1">
            {ds.map((m) => (
                <button key={m.code} onClick={() => setNuoc(m.code)}
                    className={cn("rounded-md px-3.5 py-1 text-sm font-medium transition-colors",
                        nuoc === m.code ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                    {m.display}
                </button>
            ))}
        </div>
    ) : null;
    return nuoc === "TW"
        ? <SoDonDai {...props} nutNuoc={nutNuoc} />
        : <SoDonNuoc key={nuoc} code={nuoc} nutNuoc={nutNuoc} />;
}

function SoDonDai({ dateRange, nutNuoc }: Props & { nutNuoc?: ReactNode }) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [rows, setRows] = useState<LedgerRowUI[]>([]);
    const [notes, setNotes] = useState<Note[]>([]);
    const [nhapBangDon, setNhapBangDon] = useState<NhapBangDon | null>(null);
    const [choTien, setChoTien] = useState<DonChoTien[]>([]);
    const [viecDoi, setViecDoi] = useState<{ chi_tiet: string } | null>(null);
    const [filter, setFilter] = useState<Light | "all">("all");
    const hep = useManHep();
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
            setNhapBangDon(d.nhap_bang_don || null);
            setChoTien(d.chua_ve_tien || []);
            setViecDoi((d.viec || []).find((v: { id: string }) => v.id === "doi-naza") || null);
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

    if (loading && !rows.length) return <div className="space-y-4">{nutNuoc}<TabSkeleton cards={0} rows={12} showChart={false} /></div>;
    if (error) return <div className="space-y-4">{nutNuoc}<ErrorState message={error} onRetry={load} /></div>;

    const count = (l: Light) => rows.filter((r) => r.light === l).length;
    const cu = bangDaCu(nhapBangDon);

    return (
        <div className="space-y-3 md:space-y-4">
            <ThanhCongCu
                nutNuoc={nutNuoc}
                nguon={cu ? null : nhanNapGon(nhapBangDon)}
                nguonGiaiThich={"Sổ đơn = mọi đơn, mọi cột của bảng đơn đối tác ghép với sao kê NAZA. Máy tự nạp lúc 6h sáng; "
                    + "cần ngay thì bấm “Đọc bảng đối tác” ở tab Theo dõi vận đơn. Đơn quá hạn thì đòi ở khung “Đòi tiền NAZA”; "
                    + "tiền về từng kỳ sao kê xem ở Kế toán → Tiền COD về."}
                q={q} setQ={setQ} placeholder="Tìm mã đơn, vận đơn, tên, SĐT, SKU…"
                onTaiLai={load} dangTai={loading} onCsv={exportCsv}
            />
            {/* Bảng đối tác đã cũ → vẫn khung đỏ to như trước: số trên màn KHÔNG phải của hôm nay. */}
            {cu && <ThanhNhapBangDon n={nhapBangDon} anMaTrung />}

            <OLocDon
                muc={[
                    { id: "do", label: "Phải xử", n: count("do") },
                    { id: "vang", label: "Đang chờ", n: count("vang") },
                    { id: "xanh", label: "Xong sạch", n: count("xanh") },
                    { id: "xam", label: "Không đòi", n: count("xam") },
                ]}
                tong={rows.length} chon={filter} onChon={setFilter}
            />

            <KhoiDoiNaza ds={choTien.filter((p) => p.qua_han)} canNhan={!!viecDoi} chiTiet={viecDoi?.chi_tiet || ""} onXong={load} />

            <KhoiViecCanSua viec={notes} hep={hep} />

            {hep ? (
                <DanhSachThe key={`${filter}|${q}`} ds={shown} tong={rows.length}
                    khoa={(r) => r.tracking + r.order_no} ve={(r) => <TheDonDai r={r} />} />
            ) : (<>
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
                                <tr key={r.tracking + r.order_no} className={cn("group", rowCls(r.light))}>
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
            </>)}
        </div>
    );
}

/** Thẻ một đơn Đài cho điện thoại — cùng dữ liệu với một dòng bảng, xếp dọc. */
/**
 * ĐÒI TIỀN NAZA — đơn đã giao, qua từ 2 kỳ sao kê mà chưa được trả đồng nào.
 *
 * Chuyển từ tab Đối soát COD cũ sang đây khi tách mục Kế toán (Sỹ Anh chốt 07/10/2026): đây là
 * việc THEO ĐƠN — tên khách, số điện thoại phải nằm ngay cạnh (bài học lần tách Đơn hàng /
 * Đối soát đầu tiên), và sale không vào Kế toán vẫn phải đòi được. Máy nhớ đã nhắn ngày nào,
 * mấy lần (/api/talpha/cod-actions, việc "da_doi"); sang kỳ sau tiền vẫn chưa về thì việc tự nổi
 * lại (`canNhan` = máy còn xếp "Nhắn NAZA đòi tiền" vào việc hôm nay).
 */
function KhoiDoiNaza({ ds, canNhan, chiTiet, onXong }: {
    ds: DonChoTien[]; canNhan: boolean; chiTiet: string; onXong: () => Promise<void> | void;
}) {
    const [mo, setMo] = useState(false);
    const [daChep, setDaChep] = useState("");
    const [ban, setBan] = useState(false);
    const [loi, setLoi] = useState("");
    if (!ds.length) return null;

    const tong = ds.reduce((a, x) => a + x.cod_twd, 0);
    const chep = (lang: "vi" | "zh") => {
        navigator.clipboard?.writeText(tinDoiTien(ds, lang));
        setDaChep(lang); setTimeout(() => setDaChep(""), 2200);
    };
    /** Đòi thì đòi cả danh sách trong một tin — đóng cả mẻ, không đóng lẻ từng đơn. */
    const daNhan = async () => {
        setBan(true); setLoi("");
        try {
            for (const p of ds) {
                const r = await fetch("/api/talpha/cod-actions", {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ kind: "done", key: p.doi_key, viec: "da_doi" }),
                });
                if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Không ghi được");
            }
            await onXong();
        } catch (e) {
            setLoi(e instanceof Error ? e.message : "Không ghi được");
        } finally { setBan(false); }
    };
    const nut = "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[12.5px] font-medium transition-colors disabled:opacity-60";

    return (
        <div className={cn("overflow-hidden rounded-xl border bg-card",
            canNhan ? "border-rose-300 dark:border-rose-500/40" : "border-border")}>
            <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 md:px-4",
                canNhan ? "bg-rose-50 dark:bg-rose-500/10" : "bg-muted/30")}>
                <button onClick={() => setMo(!mo)} aria-expanded={mo}
                    className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-left">
                    <HandCoins className={cn("h-4 w-4 flex-none", canNhan ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground")} />
                    <span className={cn("text-sm font-semibold", canNhan ? "text-rose-900 dark:text-rose-200" : "text-foreground")}>
                        Đòi tiền NAZA
                    </span>
                    <span className={cn("rounded-full px-2 py-0.5 text-[11.5px] font-bold tabular-nums",
                        canNhan ? "bg-rose-600 text-white" : "bg-muted text-foreground/75")}>
                        {ds.length} đơn quá hạn · {TWD(tong)}
                    </span>
                    {!canNhan && <span className="text-[12px] text-muted-foreground">đã nhắn — chờ kỳ sao kê sau</span>}
                    <ChevronDown className={cn("h-4 w-4 flex-none opacity-60 transition-transform", mo && "rotate-180")} />
                </button>
                <div className="flex flex-wrap items-center gap-1.5">
                    <button onClick={() => chep("vi")}
                        className={cn(nut, "border-transparent bg-orange-500 text-white hover:bg-orange-600")}>
                        <Copy className="h-3.5 w-3.5" />{daChep === "vi" ? "Đã chép" : "Chép tin (Việt)"}
                    </button>
                    <button onClick={() => chep("zh")} className={cn(nut, "border-border bg-card text-foreground hover:bg-muted")}>
                        {daChep === "zh" ? "Đã chép" : "中文"}
                    </button>
                    {canNhan && (
                        <button onClick={daNhan} disabled={ban}
                            className={cn(nut, "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300")}>
                            <Check className="h-3.5 w-3.5" />{ban ? "Đang ghi…" : "Đã nhắn"}
                        </button>
                    )}
                </div>
            </div>
            {loi && <p className="border-t border-rose-200 px-4 py-2 text-[12.5px] font-medium text-rose-700 dark:border-rose-500/30 dark:text-rose-300">{loi}</p>}
            {mo && (
                <>
                    <p className="border-t border-border/70 px-3.5 py-2 text-[12.5px] leading-relaxed text-muted-foreground md:px-4">
                        {chiTiet || "Đã giao thành công, đã qua từ 2 kỳ sao kê mà vẫn chưa được trả đồng nào."}{" "}
                        Chép tin gửi NAZA, gửi xong bấm “Đã nhắn” — máy nhớ ngày; sang kỳ sau tiền vẫn chưa về thì tự nhắc lại.
                    </p>
                    <ul className="divide-y divide-border/60 border-t border-border/70">
                        {ds.map((p) => (
                            <li key={p.tracking || p.order_no} className="px-3.5 py-2 md:px-4">
                                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[13px]">
                                    <b className="text-foreground">{p.order_no}</b>
                                    <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
                                        {p.ky_da_qua} kỳ
                                    </span>
                                    <span className="text-[12px] text-muted-foreground">
                                        {p.contact_name || "—"}
                                        {p.phone ? <> · <a href={`tel:${p.phone}`} className="font-mono text-violet-700 dark:text-violet-300">{p.phone}</a></> : null}
                                        {p.tracking ? <> · <span className="font-mono">{p.tracking}</span></> : null}
                                    </span>
                                    <span className="ml-auto font-bold tabular-nums text-foreground">{TWD(p.cod_twd)}</span>
                                </div>
                                <span className={cn("mt-1 inline-block rounded-full px-2 py-0.5 text-[11.5px] font-medium",
                                    !p.da_doi ? "bg-muted text-muted-foreground"
                                        : p.doi_chu.includes("vẫn im") ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
                                            : "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300")}>
                                    {p.doi_chu}
                                </span>
                            </li>
                        ))}
                    </ul>
                </>
            )}
        </div>
    );
}

function TheDonDai({ r }: { r: LedgerRowUI }) {
    // "Kỳ chờ" chỉ có nghĩa với đơn ĐÃ GIAO mà TIỀN CHƯA VỀ — cùng luật với cột trong bảng.
    const cho = r.paid_twd === null && /thành công/i.test(r.status_raw || "");
    const nhan: ReactNode[] = [];
    if (cho) nhan.push(
        <span key="ky" className={cn("rounded px-1.5 font-mono text-[10.5px] font-bold",
            r.ky_da_qua >= 2 ? "bg-rose-600 text-white" : "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300")}>
            chờ tiền {r.ky_da_qua} kỳ
        </span>);
    if (r.cogs_missing.length) nhan.push(
        <span key="gv" className="rounded bg-amber-100 px-1.5 text-[10.5px] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
            chưa khai giá {r.cogs_missing.join(",")}
        </span>);
    if (r.marketer) nhan.push(
        <span key="mk" className={cn("rounded-full px-1.5 py-px text-[10.5px] font-semibold", mkCls(r.marketer))}>{r.marketer}</span>);
    const ticks = [r.tick.doi_soat && "đã đối soát", r.tick.tru_van_chuyen && "đã trừ ship", r.tick.tru_tien_hang && "đã trừ giá vốn"]
        .filter(Boolean).join(" · ");
    return (
        <TheDon
            light={r.light} ma={r.order_no} trangThai={r.status_raw} trangThaiCls={statusCls(r.status_raw)}
            tien={TWD(r.cod_twd)}
            dong={<>{r.contact_name || "(chưa có tên)"} · lên đơn {d6(r.order_date)}</>}
            ghiChu={r.light_note}
            nhan={nhan.length ? <>{nhan}</> : undefined}
            chiTiet={[
                ["Còn lại", r.net_vnd === null ? null : (
                    <span className={cn("font-semibold", r.net_vnd < 0 ? "text-rose-600 dark:text-rose-400"
                        : r.net_before_cogs ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400")}>
                        {VND(r.net_vnd)}{r.net_before_cogs ? " · chưa trừ giá vốn" : ""}
                    </span>)],
                ["3PL trả", r.paid_twd === null ? null : TWD(r.paid_twd)],
                ["Lệch", r.diff_twd === null || Math.abs(r.diff_twd) <= 1 ? null
                    : <span className="font-semibold text-rose-600 dark:text-rose-400">{r.diff_twd > 0 ? "+" : ""}{TWD(r.diff_twd)}</span>],
                ["Kỳ trả", r.paid_period], ["Ngày về", d6(r.paid_date)],
                ["Điện thoại", r.phone ? <a href={`tel:${r.phone}`} className="font-mono text-violet-600 dark:text-violet-300">{r.phone}</a> : null],
                ["Vận đơn", r.tracking ? <span className="font-mono">{r.tracking}</span> : null],
                ["17TRACK", r.track17_code ? <span className="font-mono">{r.track17_code}</span> : null],
                ["Mã hoàn", r.return_order_no], ["PTVC", r.ship_method], ["Xuất kho", d6(r.ship_date)],
                ["Hàng", r.sku ? `${r.sku} × ${r.quantity}` : null],
                ["Phí ship", r.ship_fee_rmb === null ? null : `${RMB(r.ship_fee_rmb)}${r.fee_wrong ? " — sai bảng giá" : ""}`],
                ["Phí thao tác", r.op_fee_rmb === null ? null : RMB(r.op_fee_rmb)],
                ["Giá vốn", r.cogs_vnd === null ? null : VND(r.cogs_vnd)],
                ["Đã làm", ticks || null],
            ]}
        />
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
                ghim && cn("sticky z-20 bg-card", light && PIN_TINT[light]),
                stt && "left-0",
                pinAfter && "border-r border-border",
                className)}>{children}</td>
    );
}

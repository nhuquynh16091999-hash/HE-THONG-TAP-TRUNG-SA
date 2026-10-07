"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, ChevronDown, Download, Info, RefreshCw, Search } from "lucide-react";
import { formatNumber, cn } from "../utils";
import { STRIPE, type Light } from "./ledger-shared";

/* ═══════════════════════════════════════════════════════════════════
   KHỐI GIAO DIỆN CHUNG CỦA SỔ ĐƠN HÀNG — Đài Loan, Singapore, UAE
   (Sỹ Anh duyệt 07/10/2026: phần đầu sổ "nhìn rối quá").

   Trước: dòng chữ giới thiệu + thanh "nạp lúc" + MỖI cảnh báo một khung cam to kèm
   bảng, chiếm gần hết màn trước khi tới đơn; nút lọc thì bé, nằm sát bảng.
   Nay, từ trên xuống:
     1. Thanh công cụ MỘT hàng: chọn nước · nguồn số (chữ nhỏ) · tìm · tải lại · CSV.
     2. Ô số to theo đèn — bấm là lọc. Thứ người ta cần biết đầu tiên: bao nhiêu đơn phải xử.
     3. MỘT khung "N việc cần sửa dữ liệu", mặc định GẬP; mở ra mỗi việc một dòng kèm ai sửa,
        bấm từng việc mới thấy chi tiết.
     4. Danh sách đơn: máy tính giữ bảng cũ; điện thoại thành THẺ (bảng 20+ cột phải kéo ngang).
   ═══════════════════════════════════════════════════════════════════ */

/** Màn hẹp (điện thoại, < 768px) — đổi bảng thành thẻ. Dựng MỘT trong hai, không dựng cả hai
 *  rồi ẩn: sổ Đài 700+ đơn, dựng đôi là điện thoại ì. */
export function useManHep(): boolean {
    const [hep, setHep] = useState(false);
    useEffect(() => {
        const mq = window.matchMedia("(max-width: 767px)");
        const doi = () => setHep(mq.matches);
        doi();
        mq.addEventListener("change", doi);
        return () => mq.removeEventListener("change", doi);
    }, []);
    return hep;
}

// ── 1. Thanh công cụ ──────────────────────────────────────────────
export function ThanhCongCu({ nutNuoc, nguon, nguonGiaiThich, q, setQ, placeholder, onTaiLai, dangTai, onCsv }: {
    nutNuoc?: ReactNode;
    /** Một dòng nguồn số, vd "Bảng đối tác nạp 06:00 07/10 · 778 đơn". */
    nguon?: ReactNode;
    /** Giải thích dài về nguồn — hiện khi rê / chạm vào biểu tượng ⓘ, không chiếm chỗ. */
    nguonGiaiThich?: string;
    q: string; setQ: (s: string) => void; placeholder: string;
    onTaiLai: () => void; dangTai?: boolean; onCsv: () => void;
}) {
    return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {nutNuoc}
            {nguon && (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" title={nguonGiaiThich}>
                    <RefreshCw className="h-3.5 w-3.5 flex-none" />
                    <span>{nguon}</span>
                    {nguonGiaiThich && <Info className="h-3.5 w-3.5 flex-none opacity-60" />}
                </span>
            )}
            <div className="flex w-full items-center gap-1.5 md:ml-auto md:w-auto">
                <div className="relative min-w-0 flex-1 md:flex-none">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder}
                        className="w-full rounded-full border border-border bg-card py-1.5 pl-9 pr-3 text-[13px] md:w-72 md:py-1 md:text-[12.5px]" />
                </div>
                <button onClick={onTaiLai} title="Tải lại" aria-label="Tải lại"
                    className="flex-none rounded-full border border-border px-2.5 py-1.5 hover:bg-muted md:py-1">
                    <RefreshCw className={cn("h-3.5 w-3.5", dangTai && "animate-spin")} />
                </button>
                <button onClick={onCsv} title="Tải danh sách đang lọc về file CSV"
                    className="inline-flex flex-none items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[12.5px] hover:bg-muted md:py-1">
                    <Download className="h-3.5 w-3.5" /> CSV
                </button>
            </div>
        </div>
    );
}

// ── 2. Ô số lọc theo đèn ───────────────────────────────────────────
const SO_MAU: Record<Light, string> = {
    do: "text-rose-600 dark:text-rose-400",
    vang: "text-amber-600 dark:text-amber-400",
    xanh: "text-emerald-600 dark:text-emerald-400",
    xam: "text-muted-foreground",
};
const VIEN_CHON: Record<Light | "all", string> = {
    all: "border-foreground/40 bg-muted/60",
    do: "border-rose-400 bg-rose-50 dark:bg-rose-500/10",
    vang: "border-amber-400 bg-amber-50 dark:bg-amber-500/10",
    xanh: "border-emerald-400 bg-emerald-50 dark:bg-emerald-500/10",
    xam: "border-slate-400 bg-slate-100 dark:bg-slate-500/15",
};

export type MucLoc = { id: Light; label: string; n: number };

/** Bấm ô đang chọn lần nữa là về "Tất cả". */
export function OLocDon({ muc, tong, chon, onChon }: {
    muc: MucLoc[]; tong: number; chon: Light | "all"; onChon: (l: Light | "all") => void;
}) {
    const o = (id: Light | "all", label: string, n: number, tat?: boolean) => {
        const dangChon = chon === id;
        return (
            <button key={id} onClick={() => onChon(dangChon && id !== "all" ? "all" : id)}
                aria-pressed={dangChon}
                className={cn("rounded-xl border px-3 py-2 text-left transition hover:bg-muted/50",
                    dangChon ? VIEN_CHON[id] : "border-border bg-card",
                    tat && "col-span-full flex items-baseline justify-between md:col-span-1 md:block")}>
                <div className={cn("text-xl font-bold tabular-nums leading-tight md:text-2xl", id === "all" ? "text-foreground" : SO_MAU[id])}>
                    {formatNumber(n)}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {id !== "all" && <span className={cn("h-2 w-2 rounded-full", STRIPE[id])} />}
                    {label}
                </div>
            </button>
        );
    };
    return (
        <div className={cn("grid gap-2",
            // Điện thoại: "Tất cả" một hàng ngang, các đèn chia đều hàng dưới (3 đèn → 3 cột, 4 → 2×2).
            muc.length === 3 ? "grid-cols-3 md:grid-cols-4" : "grid-cols-2 md:grid-cols-5")}>
            {o("all", "Tất cả", tong, true)}
            {muc.map((m) => o(m.id, m.label, m.n))}
        </div>
    );
}

// ── 3. Khung "việc cần sửa dữ liệu" ────────────────────────────────
export type ViecSua = {
    id: string; level: "canh_bao" | "nhac";
    title: string; detail: string;
    cols?: string[]; items?: (string | number)[][]; fix?: string;
};

/** Nhãn ngắn trên đầu khung + ai phải sửa — theo id cảnh báo của route. Id lạ thì lấy tiêu đề. */
const NHAN_VIEC: Record<string, { ngan: string; ai: string }> = {
    "thieu-gia-von": { ngan: "mã chưa có giá vốn", ai: "Khai giá vốn" },
    "trong-o-sku": { ngan: "đơn trống ô SKU", ai: "Sửa Sheet đối tác" },
    "thua-sao-ke": { ngan: "dòng sao kê lạc", ai: "Tra Sheet đơn" },
    "phi-sai": { ngan: "đơn tính sai phí ship", ai: "Hỏi lại NAZA" },
    "trung-van-don": { ngan: "mã vận đơn trùng", ai: "Sửa Sheet đối tác" },
    "thieu-van-don": { ngan: "đơn thiếu mã vận đơn", ai: "Sửa Sheet đối tác" },
    "khong-don": { ngan: "chưa có đơn", ai: "Đọc bảng đối tác" },
    "khong-sao-ke": { ngan: "chưa có sao kê", ai: "Tải sao kê" },
};
/** Số đếm cho nhãn ngắn: mã chưa có giá đếm theo MÃ (items), còn lại theo số đầu tiêu đề. */
const demViec = (v: ViecSua) =>
    v.id === "thieu-gia-von" ? (v.items?.length ?? 0) : (parseInt(v.title, 10) || v.items?.length || 0);

export function KhoiViecCanSua({ viec, hep }: { viec: ViecSua[]; hep: boolean }) {
    const [mo, setMo] = useState(false);
    const [moViec, setMoViec] = useState<string | null>(null);
    if (!viec.length) return null;
    const gap = viec.some((v) => v.level === "canh_bao");

    return (
        <div className={cn("overflow-hidden rounded-xl border bg-card",
            gap ? "border-amber-300 dark:border-amber-500/40" : "border-sky-300 dark:border-sky-500/40")}>
            <button onClick={() => setMo(!mo)} aria-expanded={mo}
                className={cn("flex w-full flex-wrap items-center gap-x-2 gap-y-1.5 px-3 py-2.5 text-left md:px-4",
                    gap ? "bg-amber-50 dark:bg-amber-500/10" : "bg-sky-50 dark:bg-sky-500/10")}>
                <AlertTriangle className={cn("h-4 w-4 flex-none", gap ? "text-amber-600 dark:text-amber-400" : "text-sky-600 dark:text-sky-400")} />
                <span className={cn("text-sm font-semibold", gap ? "text-amber-900 dark:text-amber-200" : "text-sky-900 dark:text-sky-200")}>
                    {viec.length} việc cần sửa dữ liệu
                </span>
                {!hep && viec.map((v) => {
                    const nh = NHAN_VIEC[v.id];
                    return nh ? (
                        <span key={v.id} className="rounded-full border border-border bg-card px-2 py-0.5 text-[11.5px] text-muted-foreground">
                            {demViec(v) || ""} {nh.ngan}
                        </span>
                    ) : null;
                })}
                <ChevronDown className={cn("ml-auto h-4 w-4 flex-none opacity-60 transition-transform", mo && "rotate-180")} />
            </button>

            {mo && (
                <div className={cn(hep && "space-y-2 p-2")}>
                    {viec.map((v) => {
                        const nh = NHAN_VIEC[v.id];
                        const dangMo = moViec === v.id;
                        const coChiTiet = !!v.items?.length || !!v.fix;
                        return (
                            <div key={v.id} className={cn(hep ? "rounded-lg border border-border" : "border-t border-border")}>
                                <button onClick={() => coChiTiet && setMoViec(dangMo ? null : v.id)} aria-expanded={dangMo}
                                    className={cn("flex w-full items-start gap-2.5 px-3 py-2.5 text-left md:items-center md:px-4",
                                        coChiTiet && "hover:bg-muted/40", dangMo && "bg-muted/40")}>
                                    <span className={cn("mt-1.5 h-2 w-2 flex-none rounded-full md:mt-0",
                                        v.level === "canh_bao" ? "bg-amber-500" : "bg-sky-500")} />
                                    <span className="min-w-0 flex-1">
                                        <span className="block text-[13px] font-medium text-foreground">{v.title}</span>
                                        <span className="block text-xs text-muted-foreground">{v.detail}</span>
                                    </span>
                                    {nh && <span className="hidden flex-none rounded-full border border-border px-2 py-0.5 text-[11.5px] text-muted-foreground md:inline">{nh.ai}</span>}
                                    {coChiTiet && <ChevronDown className={cn("mt-0.5 h-4 w-4 flex-none opacity-50 transition-transform md:mt-0", dangMo && "rotate-180")} />}
                                </button>
                                {nh && hep && (
                                    <span className="mx-3 mb-2 inline-block rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">{nh.ai}</span>
                                )}
                                {dangMo && <ChiTietViec v={v} hep={hep} />}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function ChiTietViec({ v, hep }: { v: ViecSua; hep: boolean }) {
    const cols = v.cols || [];
    const items = v.items || [];
    const o = (x: string | number) => (typeof x === "number" ? formatNumber(x) : x);
    return (
        <div className="border-t border-border bg-muted/20">
            {items.length > 0 && (hep ? (
                // Điện thoại: mỗi dòng một thẻ nhỏ — cột đầu đậm, các cột sau "Tên cột: giá trị".
                <div className="max-h-96 space-y-1.5 overflow-auto p-2">
                    {items.map((it, i) => (
                        <div key={i} className="rounded-lg bg-card px-2.5 py-2 text-[12.5px]">
                            <div className="font-mono font-semibold">{o(it[0])}</div>
                            {it.slice(1).map((x, j) => (x === "" || x === null ? null : (
                                <div key={j} className="text-muted-foreground">
                                    <span className="text-muted-foreground/70">{cols[j + 1]}: </span>
                                    <span className="text-foreground">{o(x)}</span>
                                </div>
                            )))}
                        </div>
                    ))}
                </div>
            ) : (
                <div className="max-h-72 overflow-auto">
                    <table className="w-full text-[12px]">
                        <thead className="sticky top-0 bg-muted/90 backdrop-blur">
                            <tr className="text-left text-[10.5px] font-semibold text-muted-foreground">
                                {cols.map((c) => <th key={c} className="px-4 py-1.5">{c}</th>)}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {items.map((it, i) => (
                                <tr key={i}>
                                    {it.map((x, j) => (
                                        <td key={j} className={cn("px-4 py-1", j === 0 && "font-mono font-semibold",
                                            typeof x === "number" && "text-right tabular-nums")}>{o(x)}</td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ))}
            {v.fix && <p className="border-t border-border px-3 py-2 text-xs font-medium text-muted-foreground md:px-4">→ {v.fix}</p>}
        </div>
    );
}

// ── 4. Thẻ đơn cho điện thoại ──────────────────────────────────────
const VIEN_THE: Record<Light, string> = {
    do: "border-l-rose-500", vang: "border-l-amber-400", xanh: "border-l-emerald-500",
    xam: "border-l-slate-300 dark:border-l-slate-600",
};

/** Một đơn một thẻ: dòng đầu mã + trạng thái + tiền; dưới là khách, việc phải làm; chạm để
 *  mở đủ chi tiết. `nut` (vd WhatsApp) luôn hiện, không phải mở thẻ. */
export function TheDon({ light, ma, trangThai, trangThaiCls, tien, dong, ghiChu, nhan, nut, chiTiet }: {
    light: Light; ma: string; trangThai: string; trangThaiCls: string; tien: string;
    dong: ReactNode; ghiChu?: string; nhan?: ReactNode; nut?: ReactNode;
    chiTiet: [string, ReactNode][];
}) {
    const [mo, setMo] = useState(false);
    return (
        <div className={cn("rounded-lg border border-l-4 border-border bg-card", VIEN_THE[light], light === "xam" && "opacity-75")}>
            <button onClick={() => setMo(!mo)} aria-expanded={mo} className="block w-full px-3 py-2.5 text-left">
                <div className="flex items-center gap-2">
                    <b className="font-mono text-[13.5px]">{ma || "·"}</b>
                    <span className={cn("truncate rounded px-1.5 py-px text-[10.5px] font-semibold", trangThaiCls)}>{trangThai || "—"}</span>
                    <span className="ml-auto flex-none font-mono text-[13px] font-bold tabular-nums">{tien}</span>
                </div>
                <div className="mt-1 text-[12.5px] text-muted-foreground">{dong}</div>
                {nhan && <div className="mt-1.5 flex flex-wrap gap-1">{nhan}</div>}
                {ghiChu && light !== "xanh" && <div className="mt-1 text-[11.5px] text-muted-foreground/80">{ghiChu}</div>}
            </button>
            {nut && <div className="px-3 pb-2.5">{nut}</div>}
            {mo && (
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-border px-3 py-2.5 text-[12px]">
                    {chiTiet.filter(([, v]) => v !== null && v !== undefined && v !== "" && v !== "·").map(([k, v]) => (
                        <div key={k} className="contents">
                            <dt className="text-muted-foreground">{k}</dt>
                            <dd className="min-w-0 break-words">{v}</dd>
                        </div>
                    ))}
                </dl>
            )}
        </div>
    );
}

/** Danh sách thẻ — dựng dần 50 thẻ một lượt, bấm "Hiện thêm" (700+ thẻ một lúc làm điện thoại ì). */
export function DanhSachThe<T>({ ds, khoa, ve, tong }: {
    ds: T[]; khoa: (x: T) => string; ve: (x: T) => ReactNode; tong: number;
}) {
    const [so, setSo] = useState(50);
    const hien = ds.slice(0, so);
    return (
        <div className="space-y-2">
            {hien.map((x) => <div key={khoa(x)}>{ve(x)}</div>)}
            {!ds.length && <p className="py-10 text-center text-sm text-muted-foreground">Không có đơn nào trong nhóm này.</p>}
            {ds.length > so && (
                <button onClick={() => setSo(so + 50)}
                    className="w-full rounded-lg border border-border bg-card py-2.5 text-sm font-medium hover:bg-muted">
                    Hiện thêm {Math.min(50, ds.length - so)} đơn · còn {formatNumber(ds.length - so)}
                </button>
            )}
            <p className="text-center font-mono text-[11px] text-muted-foreground">
                {formatNumber(Math.min(so, ds.length))} / {formatNumber(ds.length)} đơn đang lọc · {formatNumber(tong)} đơn tất cả
            </p>
        </div>
    );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import {
    Upload, AlertTriangle, Download, Copy, CheckCircle2, ChevronDown, Check, X,
    FileSpreadsheet, Landmark, Wallet, PackageCheck, Boxes, ArrowRight, ArrowDown, Info,
    CalendarDays, Layers, Hourglass, ReceiptText, BadgeCheck, SearchCheck, PenLine,
    type LucideIcon,
} from "lucide-react";
import TabSkeleton, { ErrorState } from "@/components/ui/tab-skeleton";
import { formatNumber, cn } from "../utils";
import { TWD, VND } from "./ledger-shared";
import ThanhNhapBangDon, { type NhapBangDon } from "@/components/talpha/nhap-bang-don";

interface Props { dateRange?: { from: Date; to: Date }; projectId?: string }

/* ═══════════════════════════════════════════════════════════════════
   ĐỐI SOÁT COD — MỘT QUY TRÌNH, KHÔNG PHẢI MỘT ĐỐNG KẾT QUẢ KIỂM TRA

   Bản trước xếp tám mục soát cạnh nhau rồi để người dùng tự hiểu. Sỹ Anh chỉ
   ra bốn chỗ khó chịu, và cả bốn cùng một gốc: màn hình không mang hình dạng
   của công việc thật.

     "không biết số nào của kỳ nào"      → mỗi khối đóng dấu PHẠM VI
     "việc làm xong rồi vẫn hiện"        → mỗi việc có nút đóng, máy nhớ ngày
     "báo lỗi không biết làm gì tiếp"    → mỗi lỗi kèm đúng nút cần bấm
     "không biết tiền thật về đủ chưa"   → thêm hẳn khâu tiền-về-tài-khoản

   Nên bố cục nay chạy đúng thứ tự việc xảy ra ngoài đời:

     Σ  tiền về             — tổng cả vụ: NAZA đã gửi bao nhiêu, còn phải gửi bao nhiêu
     ①  việc hôm nay        — mở lên là biết phải làm gì
     ②  bảng các kỳ         — xương sống: kỳ nào đang ở đâu trong quy trình
     ③  kỳ đang mở          — tám mục soát, CHỈ của kỳ này
     ④  tiền còn ở NAZA     — cộng dồn mọi kỳ, KHÔNG thuộc kỳ nào
     ⑤  tỷ giá              — nó đã lấy của mình bao nhiêu tiền

   Thứ tự trong ③ (A trước B) không đảo được: file sai thì mọi so sánh về sau
   đều vô nghĩa. Và một kỳ chưa biết tiền về hay chưa thì chưa xong, dù tám
   mục xanh hết — đó là lý do ② đứng trước ③.
   ═══════════════════════════════════════════════════════════════════ */

type DoneKind = "da_doi" | "da_hoi" | "bo_qua" | "nhap_bank";
type Viec = {
    id: string; muc: "gap" | "soat" | "ghi"; tieu_de: string;
    so: number; don_vi: string; chi_tiet: string;
    done_key: string; nut: DoneKind[]; ghi_chu: string;
};
type Check = { nhom: "A" | "B"; ten: string; ok: boolean | null; chi_tiet: string };
type Bank = { thuc_nhan_vnd: number; ngay_ve: string; ghi_chu?: string; luc: string };
type PeriodState = "thieu_file" | "cho_nhap" | "khop" | "lech";
/** Luồng tiền một kỳ, đi đúng từng bước sheet TỔNG của NAZA. */
type Luong = {
    so_dong_sao_ke: number;
    cod_twd: number | null; ty_gia_twd_rmb: number | null; rmb: number | null;
    phi_thao_tac_rmb: number; phi_ship_rmb: number; phi_gop: boolean;
    rmb_rong: number | null; ty_gia_rmb_vnd: number | null; vnd: number | null;
    tien_hang: {
        cach_tra: "naza_tru" | "tu_chuyen";
        naza_tru_vnd: number | null;
        file: { ngay: string; tong_vnd: number; moi_vnd: number; no_ky_truoc_vnd: number; da_ghi_thanh_toan: boolean; dong: number } | null;
        trong_luong_vnd: number;
        lech_naza_vnd: number | null;
        da_tra_vnd: number | null;
        con_no_vnd: number | null;
    };
    phai_nhan_vnd: number | null;
};
type UocTinh = { so_don: number; cod_twd: number; don_chua_tru_phi: number; phi_uoc_rmb: number; vnd_uoc: number | null };
type TienVe = {
    da_gui_ve_vnd: number; phai_nhan_theo_file_vnd: number;
    so_ky: number; ky_da_doi_chieu_bank: number; thuc_nhan_vnd: number;
    ty_gia: { twd_rmb: number | null; rmb_vnd: number | null; ngay_sao_ke: string | null };
    con_lai_da_giao: UocTinh; con_lai_chua_giao: UocTinh;
    khong_tinh: { hoan: number; huy: number; tieu_huy: number; cod_twd: number };
    tien_hang: { loi: string | null; so_dot: number; doc_luc: string };
};
type Period = {
    id: string; filename: string; period_date: string;
    ngay_sao_ke: string | null; luong: Luong | null;
    orders_paid: number; total_twd: number; fee_rmb: number;
    lech_tien: { order_no: string; tracking: string; cod_twd: number; paid_twd: number | null; diff_twd: number | null }[];
    phi_sai: { order_no: string; tracking: string; ship_fee_rmb: number | null }[];
    thua_sao_ke: { order_no: string; tracking: string; amount_twd: number }[];
    settlement: { payable_vnd: number | null; purchase_vnd: number | null; math_ok: boolean | null; math_note: string } | null;
    bank: Bank | null;
    trang_thai: PeriodState; trang_thai_chu: string; lech_bank_vnd: number | null;
};
type Pending = {
    order_no: string; tracking: string; cod_twd: number;
    ky_da_qua: number; qua_han: boolean; contact_name: string; phone: string;
    doi_key: string; da_doi: { viec: string; ngay: string; lan: number } | null; doi_chu: string;
};
type FxRow = {
    filename: string; period_date: string;
    rate_twd_rmb: number | null; rate_rmb_vnd: number | null;
    cod_twd: number; vnd_per_twd: number | null; thiet_vnd: number | null; tot_nhat: boolean;
};
type Fx = { best_vnd_per_twd: number | null; best_period: string | null; total_thiet_vnd: number; rows: FxRow[] };
type TongQuan = {
    ky_cho_nhap: number; tien_cho_nhap_vnd: number;
    ky_lech: number; tien_lech_vnd: number; ky_khop: number; bank_tolerance_vnd: number;
};
type StatementMeta = { id: string; filename: string };

const shortFile = (f: string) => f.replace(/ĐỐI SOÁT COD|TAIWAN|\.xlsx?$/gi, "").trim() || f;
const dmy = (s: string) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "—");

/**
 * Tin nhắn đòi tiền, soạn sẵn để chép vào Zalo/WeChat.
 *
 * Hai thứ tiếng vì chưa rõ người phụ trách bên NAZA nói tiếng nào: sao kê viết
 * chữ Hán (原单号, COD金额) nhưng Sỹ Anh nhắn qua Zalo, mà Zalo thường là người
 * Việt. Đoán một bên rồi soạn sai thứ tiếng thì tin nhắn thành vô dụng, nên để
 * cả hai nút — bấm cái nào cũng một cú.
 *
 * Trong tin bắt buộc có ĐỦ mã đơn, mã vận đơn và số tiền: thiếu một trong ba
 * là bên kia hỏi lại, mất thêm một vòng.
 */
function tinDoiTien(list: Pending[], lang: "vi" | "zh"): string {
    const tong = Math.round(list.reduce((a, x) => a + x.cod_twd, 0)).toLocaleString("vi-VN");
    const dong = list.map((p) =>
        `${p.order_no} · ${p.tracking} · ${Math.round(p.cod_twd).toLocaleString("vi-VN")} NT$`).join("\n");
    if (lang === "zh") {
        return `您好，以下 ${list.length} 筆訂單已配送成功，但至今未出現在任何一期對帳單中，貨款尚未收到，` +
            `合計 ${tong} NT$：\n\n${dong}\n\n麻煩協助查詢並儘快撥款，謝謝！`;
    }
    return `Chào bạn, ${list.length} đơn dưới đây đã giao thành công nhưng chưa thấy tiền ` +
        `trên bất kỳ kỳ sao kê nào, tổng ${tong} NT$:\n\n${dong}\n\n` +
        `Nhờ bạn kiểm tra và chuyển tiền giúp mình nhé. Cảm ơn bạn!`;
}

function tinLech(p: Period, lang: "vi" | "zh"): string {
    if (lang === "zh") {
        const dong = p.lech_tien.map((l) =>
            `${l.order_no} · ${l.tracking} · 訂單 ${Math.round(l.cod_twd).toLocaleString("vi-VN")} NT$ / ` +
            `實付 ${Math.round(l.paid_twd ?? 0).toLocaleString("vi-VN")} NT$`).join("\n");
        return `您好，${shortFile(p.filename)} 這期對帳單中，以下訂單的撥款金額與我方訂單金額不符：\n\n` +
            `${dong}\n\n麻煩協助核對，謝謝！`;
    }
    const dong = p.lech_tien.map((l) =>
        `${l.order_no} · ${l.tracking} · đơn ${Math.round(l.cod_twd).toLocaleString("vi-VN")} NT$ / ` +
        `trả ${Math.round(l.paid_twd ?? 0).toLocaleString("vi-VN")} NT$`).join("\n");
    return `Chào bạn, kỳ sao kê ${shortFile(p.filename)} có mấy đơn số tiền trả về không khớp ` +
        `với số trên đơn của mình:\n\n${dong}\n\nNhờ bạn kiểm tra lại giúp mình nhé. Cảm ơn bạn!`;
}

export default function TALPHACodReconTab({ dateRange }: Props) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [upErr, setUpErr] = useState("");
    const [uploading, setUploading] = useState(false);
    const [viec, setViec] = useState<Viec[]>([]);
    const [checks, setChecks] = useState<Check[]>([]);
    const [periods, setPeriods] = useState<Period[]>([]);
    const [pending, setPending] = useState<Pending[]>([]);
    const [fx, setFx] = useState<Fx | null>(null);
    const [tq, setTq] = useState<TongQuan | null>(null);
    const [tienVe, setTienVe] = useState<TienVe | null>(null);
    const [nhapBangDon, setNhapBangDon] = useState<NhapBangDon | null>(null);
    const [stms, setStms] = useState<StatementMeta[]>([]);
    const [pid, setPid] = useState("");
    const [copied, setCopied] = useState("");
    const [busy, setBusy] = useState("");
    const [moCho, setMoCho] = useState(false);          // bung danh sách đơn đang chờ
    const [nhapBank, setNhapBank] = useState("");       // tên file kỳ đang nhập tiền về
    const [keo, setKeo] = useState(false);              // đang kéo file đè lên ô tải
    const fileRef = useRef<HTMLInputElement>(null);

    const to = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

    const load = useCallback(async () => {
        setError("");
        try {
            const [a, b] = await Promise.all([
                fetch(`/api/talpha/order-ledger?to=${to}`).then((r) => r.json()),
                fetch(`/api/talpha/cod-recon?from=2000-01-01&to=${to}`).then((r) => r.json()),
            ]);
            if (a.error) throw new Error(a.error);
            setViec(a.viec || []); setChecks(a.checks || []);
            setPeriods(a.periods || []); setPending(a.chua_ve_tien || []);
            setFx(a.fx || null); setTq(a.tong_quan || null); setTienVe(a.tien_ve || null);
            setNhapBangDon(a.nhap_bang_don || null);
            setStms(b.statements || []);
            if (a.periods?.length) setPid((p) => p || a.periods[0].id);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Lỗi không rõ");
        } finally { setLoading(false); }
    }, [to]);

    useEffect(() => { load(); }, [load]);

    const chep = (id: string, text: string) => {
        navigator.clipboard?.writeText(text);
        setCopied(id); setTimeout(() => setCopied(""), 2200);
    };

    /** Ghi một việc đã xử. Bỏ qua thì BẮT ghi lý do — đây là quyết định mất tiền. */
    const ghiViec = async (key: string, kind: "da_doi" | "da_hoi" | "bo_qua") => {
        if (!key) return;
        let lyDo = "";
        if (kind === "bo_qua") {
            lyDo = (window.prompt("Bỏ qua khoản này vì sao? (bắt buộc — sau còn tra lại được)") || "").trim();
            if (!lyDo) return;
        }
        setBusy(key);
        try {
            await fetch("/api/talpha/cod-actions", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ kind: "done", key, viec: kind, ghi_chu: lyDo }),
            });
            await load();
        } finally { setBusy(""); }
    };

    /** Đóng cả một mẻ đơn cùng lúc — đòi thì đòi cả danh sách, không đòi lẻ từng đơn. */
    const ghiDoiCaMe = async (list: Pending[]) => {
        setBusy("doi-me");
        try {
            for (const p of list) {
                await fetch("/api/talpha/cod-actions", {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ kind: "done", key: p.doi_key, viec: "da_doi" }),
                });
            }
            await load();
        } finally { setBusy(""); }
    };

    const ghiBank = async (filename: string, so: number, ngay: string) => {
        setBusy(filename); setUpErr("");
        try {
            const res = await fetch("/api/talpha/cod-actions", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ kind: "bank", filename, thuc_nhan_vnd: so, ngay_ve: ngay }),
            });
            const d = await res.json();
            if (!res.ok) { setUpErr(d.error || "Không ghi được số tiền về"); return; }
            setNhapBank(""); await load();
        } finally { setBusy(""); }
    };

    /** Nút "Nhập số" ở Việc hôm nay: mở ô nhập ở đúng dòng kỳ đó trong bảng ② rồi cuộn tới, khỏi phải tìm. */
    const moNhapBank = (filename: string) => {
        setNhapBank(filename);
        const p = periods.find((x) => x.filename === filename);
        if (p) setTimeout(() => document.getElementById(`ky-${p.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
    };

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
    const dangCho = pending.filter((p) => !p.qua_han);

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
                p.cod_twd, "", "", `đã qua ${p.ky_da_qua} kỳ · ${p.doi_chu}`]);
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

    const moiNhat = periods[0];

    return (
        <div className="space-y-5">
            {/* ── Tải file: kéo thả vào thẻ hoặc bấm chọn ── */}
            <div
                onDragOver={(e) => { e.preventDefault(); if (!keo) setKeo(true); }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setKeo(false); }}
                onDrop={(e) => {
                    e.preventDefault(); setKeo(false);
                    const f = e.dataTransfer.files?.[0];
                    if (f) upload(f);
                }}
                className={cn("flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border bg-card px-5 py-4 shadow-sm transition-all",
                    keo ? "border-orange-400 bg-orange-50/70 ring-4 ring-orange-500/15 dark:bg-orange-500/[0.07]" : "border-border")}>
                <span className="grid h-11 w-11 flex-none place-items-center rounded-xl bg-gradient-to-br from-orange-400 to-rose-500 text-white shadow-md shadow-orange-500/25">
                    <FileSpreadsheet className="h-5 w-5" />
                </span>
                <div className="min-w-[14rem] flex-1">
                    <div className="text-[15px] font-bold text-foreground">
                        {keo ? "Thả file vào đây để tải lên" : "Kéo file sao kê NAZA vào đây"}
                    </div>
                    <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
                        File <b className="font-semibold text-foreground/80">.xlsx</b> ba sheet — máy tự đọc, tự soát 8 mục,
                        tự cập nhật trạng thái đơn bên Sổ đơn hàng.
                        {stms.length > 0 && (
                            <> Đã có <b className="font-semibold text-foreground">{stms.length}</b> bản sao kê — tải lại
                                cùng một file thì <b className="font-semibold text-foreground">thay</b>, không cộng thêm.</>
                        )}
                    </p>
                </div>
                <input ref={fileRef} type="file" accept=".xlsx,.csv,.tsv,.txt" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
                <Nut kieu="chinh" lon busy={uploading} busyText="Đang đọc và soát…" onClick={() => fileRef.current?.click()}>
                    <Upload className="h-4 w-4" />Chọn file sao kê
                </Nut>
                {upErr && (
                    <p className="flex basis-full items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                        <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />{upErr}
                    </p>
                )}
            </div>

            {/* Số của màn này cũ hay mới — nói ngay, đừng để nhìn nhầm số tuần trước */}
            <ThanhNhapBangDon n={nhapBangDon} />

            {/* ═══ Σ TIỀN VỀ — NAZA đã gửi bao nhiêu, còn phải gửi bao nhiêu ═══ */}
            {tienVe && <KhoiTienVe t={tienVe} />}

            {/* ── Tiền chưa ai đối chiếu với ngân hàng — lỗ to nhất của cả tab ── */}
            {tq && (tq.ky_cho_nhap > 0 || tq.ky_lech > 0) && (
                <div className={cn("flex flex-wrap items-center gap-x-5 gap-y-3 rounded-2xl border px-5 py-4 shadow-sm",
                    tq.ky_lech > 0
                        ? "border-rose-200 bg-gradient-to-r from-rose-50 to-card dark:border-rose-500/30 dark:from-rose-500/10"
                        : "border-sky-200 bg-gradient-to-r from-sky-50 to-card dark:border-sky-500/30 dark:from-sky-500/10")}>
                    <span className={cn("grid h-11 w-11 flex-none place-items-center rounded-xl",
                        tq.ky_lech > 0 ? "bg-rose-500/15 text-rose-600 dark:text-rose-300" : "bg-sky-500/15 text-sky-600 dark:text-sky-300")}>
                        <Landmark className="h-5 w-5" />
                    </span>
                    <div>
                        <div className={cn("text-[22px] font-extrabold leading-tight tracking-tight tabular-nums",
                            tq.ky_lech > 0 ? "text-rose-600 dark:text-rose-400" : "text-sky-700 dark:text-sky-300")}>
                            {VND(tq.tien_cho_nhap_vnd)}
                        </div>
                        <div className="text-[12.5px] text-muted-foreground">qua {tq.ky_cho_nhap} lần chuyển khoản</div>
                    </div>
                    <p className="min-w-[16rem] flex-1 text-[13px] leading-relaxed text-muted-foreground">
                        <b className="font-semibold text-foreground">Chưa lần nào được đối chiếu với ngân hàng.</b>{" "}
                        File của {tq.ky_cho_nhap} kỳ đều soát xong, nhưng số tiền thật vào tài khoản thì chưa ai
                        nhập vào để so. Nhập số của từng kỳ ở bảng ② bên dưới.
                        {tq.ky_khop > 0 && <> Đã khớp xong {tq.ky_khop} kỳ.</>}
                        {tq.ky_lech > 0 && (
                            <> <b className="font-semibold text-rose-600 dark:text-rose-400">{tq.ky_lech} kỳ tiền về không khớp.</b></>
                        )}
                    </p>
                </div>
            )}

            {/* ═══ ① VIỆC HÔM NAY ═══ */}
            <Khoi so="1" ten="Việc hôm nay" phamVi="all" dem={viec.length ? `${viec.length} việc` : ""}
                phu="mở lên là biết phải làm gì">
                {viec.length === 0 ? (
                    <div className="flex items-center gap-3 px-5 py-6">
                        <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="h-5 w-5" />
                        </span>
                        <div>
                            <div className="text-[14.5px] font-semibold text-emerald-700 dark:text-emerald-400">Không có việc gì cần làm</div>
                            <div className="text-[13px] text-muted-foreground">
                                Mọi kỳ đã soát xong, tiền đã về khớp, không đơn nào quá hạn phải đòi.
                            </div>
                        </div>
                    </div>
                ) : (
                    <ul className="divide-y divide-border/70">
                        {viec.map((v) => {
                            const m = MUC[v.muc];
                            return (
                                <li key={v.id} className="relative flex flex-wrap items-start gap-x-4 gap-y-3 px-5 py-4 transition-colors hover:bg-muted/30">
                                    <span className={cn("absolute inset-y-4 left-0 w-1 rounded-r-full", m.vach)} />
                                    <span className={cn("grid h-9 w-9 flex-none place-items-center rounded-xl", m.nen)}>
                                        <m.Icon className="h-[18px] w-[18px]" />
                                    </span>
                                    <div className="min-w-[14rem] flex-1">
                                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                            <span className="text-[14.5px] font-semibold text-foreground">{v.tieu_de}</span>
                                            <span className={cn("rounded-full px-2 py-0.5 text-[12px] font-bold tabular-nums", m.the)}>
                                                {v.don_vi === "đ" ? VND(v.so) : `${formatNumber(v.so)} ${v.don_vi}`}
                                            </span>
                                        </div>
                                        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{v.chi_tiet}</p>
                                    </div>
                                    <div className="flex flex-none flex-wrap items-center gap-2">
                                        {v.id === "doi-naza" && (
                                            <>
                                                <Nut kieu="chinh" onClick={() => chep("z-vi", tinDoiTien(quaHan, "vi"))}>
                                                    <Copy className="h-3.5 w-3.5" />
                                                    {copied === "z-vi" ? "Đã chép" : "Chép tin (Việt)"}
                                                </Nut>
                                                <Nut onClick={() => chep("z-zh", tinDoiTien(quaHan, "zh"))}>
                                                    {copied === "z-zh" ? "Đã chép" : "中文"}
                                                </Nut>
                                                <Nut kieu="xong" busy={busy === "doi-me"} onClick={() => ghiDoiCaMe(quaHan)}>
                                                    <Check className="h-3.5 w-3.5" />Đã nhắn
                                                </Nut>
                                            </>
                                        )}
                                        {v.id === "lech-tien" && period && (
                                            <>
                                                <Nut kieu="chinh" onClick={() => chep("l-vi", tinLech(period, "vi"))}>
                                                    <Copy className="h-3.5 w-3.5" />
                                                    {copied === "l-vi" ? "Đã chép" : "Chép tin (Việt)"}
                                                </Nut>
                                                <Nut onClick={() => chep("l-zh", tinLech(period, "zh"))}>
                                                    {copied === "l-zh" ? "Đã chép" : "中文"}
                                                </Nut>
                                            </>
                                        )}
                                        {v.nut.includes("nhap_bank") && (
                                            <Nut kieu="chinh" onClick={() => moNhapBank(v.done_key)}>
                                                <PenLine className="h-3.5 w-3.5" />Nhập số
                                            </Nut>
                                        )}
                                        {v.nut.includes("da_hoi") && v.done_key && (
                                            <Nut busy={busy === v.done_key} onClick={() => ghiViec(v.done_key, "da_hoi")}>
                                                Đã hỏi NAZA
                                            </Nut>
                                        )}
                                        {v.nut.includes("bo_qua") && v.done_key && (
                                            <Nut busy={busy === v.done_key} onClick={() => ghiViec(v.done_key, "bo_qua")}>
                                                <X className="h-3.5 w-3.5" />Bỏ qua
                                            </Nut>
                                        )}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </Khoi>

            {/* ═══ ② BẢNG CÁC KỲ — xương sống của tab ═══ */}
            {periods.length > 0 && (
                <Khoi so="2" ten={`${periods.length} kỳ sao kê`} phamVi="all"
                    phu="bấm một dòng để mở chi tiết kỳ đó">
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[900px] whitespace-nowrap text-[13px]">
                            <thead>
                                <tr className="border-b border-border/70 bg-muted/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                    <th className="px-5 py-2.5 text-left">Kỳ chốt</th>
                                    <th className="px-3 py-2.5 text-right">Đơn</th>
                                    <th className="px-3 py-2.5 text-right">Tiền COD</th>
                                    <th className="px-3 py-2.5 text-right">Tiền hàng</th>
                                    <th className="px-3 py-2.5 text-right">Phải nhận</th>
                                    <th className="px-3 py-2.5 text-right">Thực nhận</th>
                                    <th className="px-3 py-2.5 text-right">Lệch</th>
                                    <th className="px-5 py-2.5 text-left">Tình trạng</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/60">
                                {periods.map((p) => {
                                    const chon = p.id === period?.id;
                                    const th = p.luong?.tien_hang;
                                    return (
                                        <tr key={p.id} id={`ky-${p.id}`} onClick={() => setPid(p.id)}
                                            className={cn("cursor-pointer transition-colors",
                                                chon ? "bg-orange-50/70 dark:bg-orange-500/[0.07]" : "hover:bg-muted/40")}>
                                            <td className={cn("px-5 py-3", chon && "shadow-[inset_3px_0_0_0_#FF7312]")}>
                                                <div className="font-semibold tabular-nums text-foreground">{dmy(p.period_date)}</div>
                                                <div className="text-[12px] text-muted-foreground">{shortFile(p.filename)}</div>
                                            </td>
                                            <td className="px-3 py-3 text-right tabular-nums text-foreground/80">
                                                {p.luong?.so_dong_sao_ke ?? p.orders_paid}
                                            </td>
                                            <td className="px-3 py-3 text-right font-semibold tabular-nums text-sky-700 dark:text-sky-300">
                                                {TWD(p.luong?.cod_twd ?? p.total_twd)}
                                            </td>
                                            <td className="px-3 py-3 text-right">
                                                {th?.file ? (
                                                    <>
                                                        <div className="font-semibold tabular-nums text-orange-600 dark:text-orange-400">
                                                            {VND(th.file.tong_vnd)}
                                                        </div>
                                                        <div className="text-[11.5px] text-muted-foreground">
                                                            {th.cach_tra === "naza_tru" ? "NAZA trừ vào COD" : "tự chuyển khoản riêng"}
                                                        </div>
                                                    </>
                                                ) : <span className="text-muted-foreground">—</span>}
                                            </td>
                                            <td className="px-3 py-3 text-right">
                                                {p.luong?.phai_nhan_vnd != null ? (
                                                    <span className="text-[14px] font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                                                        {VND(p.luong.phai_nhan_vnd)}
                                                    </span>
                                                ) : (p.luong?.rmb_rong ?? 0) < 0 ? (
                                                    <span className="font-semibold tabular-nums text-amber-600 dark:text-amber-400"
                                                        title="NAZA mang số âm sang trừ vào kỳ sau">
                                                        âm {RMB2(p.luong!.rmb_rong!)} → kỳ sau
                                                    </span>
                                                ) : <span className="text-muted-foreground">không tính được</span>}
                                            </td>
                                            <td className="px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                                                {nhapBank === p.filename ? (
                                                    <FormBank goiY={p.settlement?.payable_vnd ?? null}
                                                        busy={busy === p.filename}
                                                        onHuy={() => setNhapBank("")}
                                                        onGhi={(so, ngay) => ghiBank(p.filename, so, ngay)} />
                                                ) : p.bank ? (
                                                    <button onClick={() => setNhapBank(p.filename)}
                                                        className="rounded-lg px-1.5 py-0.5 text-right transition-colors hover:bg-muted">
                                                        <div className="font-semibold tabular-nums text-foreground">{VND(p.bank.thuc_nhan_vnd)}</div>
                                                        <div className="text-[11.5px] text-muted-foreground">về {dmy(p.bank.ngay_ve)}</div>
                                                    </button>
                                                ) : (
                                                    <button onClick={() => setNhapBank(p.filename)}
                                                        className="inline-flex items-center gap-1 rounded-lg border border-dashed border-border px-2.5 py-1 text-[12px] font-medium text-muted-foreground transition-colors hover:border-sky-400 hover:bg-sky-50 hover:text-sky-700 dark:hover:bg-sky-500/10 dark:hover:text-sky-300">
                                                        <PenLine className="h-3.5 w-3.5" />chưa nhập
                                                    </button>
                                                )}
                                            </td>
                                            <td className={cn("px-3 py-3 text-right font-semibold tabular-nums",
                                                p.lech_bank_vnd == null ? "text-muted-foreground"
                                                    : p.trang_thai === "khop" ? "text-emerald-600 dark:text-emerald-400"
                                                        : "text-rose-600 dark:text-rose-400")}>
                                                {p.lech_bank_vnd == null ? "·"
                                                    : Math.round(p.lech_bank_vnd) === 0 ? "0đ"
                                                        : `${p.lech_bank_vnd > 0 ? "+" : "−"}${VND(Math.abs(p.lech_bank_vnd))}`}
                                            </td>
                                            <td className="px-5 py-3"><TrangThai p={p} /></td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    {tq && (
                        <p className="flex items-start gap-2 border-t border-border/70 bg-muted/30 px-5 py-3 text-[12.5px] leading-relaxed text-muted-foreground">
                            <Info className="mt-0.5 h-4 w-4 flex-none" />
                            <span>
                                Kỳ chỉ được coi là <b className="font-semibold text-foreground">xong</b> khi tiền thật về khớp số sao kê
                                tính ra — không phải khi tám mục soát xanh hết. Lệch trong {VND(tq.bank_tolerance_vnd)} thì
                                bỏ qua, vì quy đổi ba tầng NT$ → ¥ → đ có làm tròn và ngân hàng còn thu phí chuyển.
                            </span>
                        </p>
                    )}
                </Khoi>
            )}

            {/* ═══ ③ KỲ ĐANG MỞ ═══ */}
            {period && (
                <Khoi so="3" ten={`Kỳ chốt ${dmy(period.period_date)}`} phamVi="one" phu={shortFile(period.filename)}
                    phai={
                        <>
                            <div className="relative max-w-full">
                                <select value={period.id} onChange={(e) => setPid(e.target.value)}
                                    className="h-8 max-w-[18rem] appearance-none truncate rounded-lg border border-border bg-card pl-3 pr-8 text-[13px] font-medium text-foreground shadow-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 dark:[color-scheme:dark]">
                                    {periods.map((p, i) => (
                                        <option key={p.id} value={p.id}>
                                            {i === 0 ? "★ " : ""}{shortFile(p.filename)} — chốt {dmy(p.period_date)}
                                        </option>
                                    ))}
                                </select>
                                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            </div>
                            <Nut onClick={exportForPartner}>
                                <Download className="h-4 w-4" />Xuất file gửi 3PL
                            </Nut>
                        </>
                    }>
                    {period.luong ? (() => {
                        const l = period.luong;
                        const th = l.tien_hang;
                        const am = l.phai_nhan_vnd == null && (l.rmb_rong ?? 0) < 0;
                        return (
                            <>
                                <div className="grid grid-cols-2 gap-px border-b border-border/70 bg-border/60 sm:grid-cols-3 xl:grid-cols-5">
                                    <Kpi label="Đơn trong sao kê" value={formatNumber(l.so_dong_sao_ke)}
                                        sub={`${period.orders_paid} đơn khớp sổ đơn`} />
                                    <Kpi label="Tiền COD" value={l.cod_twd != null ? TWD(l.cod_twd) : "—"}
                                        sub="NAZA thu trong kỳ" tone="twd" />
                                    <Kpi label="Phí NAZA trừ" value={RMB2(l.phi_thao_tac_rmb + l.phi_ship_rmb)}
                                        sub={l.phi_gop ? "ship + thao tác (gộp)" : `thao tác ${RMB2(l.phi_thao_tac_rmb)} · ship ${RMB2(l.phi_ship_rmb)}`}
                                        tone="rmb" />
                                    <Kpi label="Tiền hàng"
                                        value={th.file ? VND(th.file.tong_vnd) : th.naza_tru_vnd != null ? VND(th.naza_tru_vnd) : "—"}
                                        sub={th.cach_tra === "naza_tru" ? "NAZA trừ vào COD"
                                            : (th.con_no_vnd ?? 0) > 0 ? `tự chuyển · còn nợ ${VND(th.con_no_vnd!)}` : "tự chuyển khoản riêng"}
                                        tone={(th.con_no_vnd ?? 0) > 0 ? "red" : "hang"} />
                                    {am
                                        ? <Kpi label="Phải nhận" value={RMB2(l.rmb_rong!)} sub="âm → NAZA trừ vào kỳ sau" tone="red"
                                            className="col-span-2 xl:col-span-1" />
                                        : <Kpi label="Phải nhận" value={l.phai_nhan_vnd != null ? VND(l.phai_nhan_vnd) : "—"}
                                            sub="sau khi trừ hết" tone="green" className="col-span-2 xl:col-span-1" />}
                                </div>
                                <LuongTien l={l} />
                            </>
                        );
                    })() : (
                        <div className="flex items-center gap-2 px-5 py-4 text-[13px] text-muted-foreground">
                            <Info className="h-4 w-4 flex-none" />
                            Kỳ này không có sheet TỔNG của NAZA nên không dựng được luồng tiền.
                        </div>
                    )}
                    <div className="grid items-start gap-4 border-t border-border/70 bg-muted/20 p-4 xl:grid-cols-2">
                        {/* Tám mục soát máy chỉ chạy cho kỳ MỚI NHẤT. Đang xem kỳ khác thì nói
                            thẳng ra, kẻo tưởng dấu tích xanh kia là của kỳ đang chọn. */}
                        {moiNhat && period.id !== moiNhat.id && (
                            <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-amber-800 xl:col-span-2 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                                <Info className="mt-0.5 h-4 w-4 flex-none" />
                                <span>
                                    Hai nhóm soát dưới đây là của <b className="font-semibold">kỳ mới nhất</b> — chốt {dmy(moiNhat.period_date)} ({shortFile(moiNhat.filename)}).
                                    Máy chỉ soát kỳ mới nhất; số tiền phía trên mới là của kỳ đang chọn.
                                </span>
                            </p>
                        )}
                        <MucSoat nhom="A" ten="Soát bên trong file" hoi="tin được số trong đó không"
                            checks={checks.filter((c) => c.nhom === "A")} />
                        <MucSoat nhom="B" ten="Soát file với đơn của mình" hoi="họ trả đủ và đúng chưa"
                            checks={checks.filter((c) => c.nhom === "B")} />
                    </div>
                </Khoi>
            )}

            {/* ═══ ④ TIỀN CÒN NẰM Ở NAZA — cộng dồn, không thuộc kỳ nào ═══ */}
            {pending.length > 0 && (
                <Khoi so="4" ten="Tiền còn nằm ở NAZA" phamVi="all" phu="không thuộc kỳ nào cả"
                    dem={TWD(pending.reduce((a, x) => a + x.cod_twd, 0))}>
                    {quaHan.length > 0 && (
                        <>
                            <div className="flex flex-wrap items-start gap-x-4 gap-y-3 border-b border-rose-200/70 bg-gradient-to-r from-rose-50 to-card px-5 py-4 dark:border-rose-500/20 dark:from-rose-500/10">
                                <span className="grid h-9 w-9 flex-none place-items-center rounded-xl bg-rose-500/15 text-rose-600 dark:text-rose-400">
                                    <AlertTriangle className="h-[18px] w-[18px]" />
                                </span>
                                <div className="min-w-[14rem] flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-[14.5px] font-bold text-rose-700 dark:text-rose-300">
                                            {quaHan.length} đơn quá hạn — phải đòi
                                        </span>
                                        <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[12px] font-bold tabular-nums text-white">
                                            {TWD(quaHan.reduce((a, x) => a + x.cod_twd, 0))}
                                        </span>
                                    </div>
                                    <p className="mt-1 text-[13px] text-muted-foreground">
                                        Đã giao thành công, đã qua từ 2 kỳ sao kê mà vẫn chưa được trả đồng nào.
                                    </p>
                                </div>
                                <div className="flex flex-none flex-wrap items-center gap-2">
                                    <Nut kieu="chinh" onClick={() => chep("q-vi", tinDoiTien(quaHan, "vi"))}>
                                        <Copy className="h-3.5 w-3.5" />
                                        {copied === "q-vi" ? "Đã chép" : "Chép tin (Việt)"}
                                    </Nut>
                                    <Nut onClick={() => chep("q-zh", tinDoiTien(quaHan, "zh"))}>
                                        {copied === "q-zh" ? "Đã chép" : "中文"}
                                    </Nut>
                                    <Nut kieu="xong" busy={busy === "doi-me"} onClick={() => ghiDoiCaMe(quaHan)}>
                                        <Check className="h-3.5 w-3.5" />Đã nhắn
                                    </Nut>
                                </div>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full min-w-[760px] whitespace-nowrap text-[13px]">
                                    <thead>
                                        <tr className="border-b border-border/70 bg-muted/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                            <th className="px-5 py-2.5 text-left">Mã đơn</th>
                                            <th className="px-3 py-2.5 text-left">Vận đơn</th>
                                            <th className="px-3 py-2.5 text-left">Khách</th>
                                            <th className="px-3 py-2.5 text-left">Điện thoại</th>
                                            <th className="px-3 py-2.5 text-right">Chờ</th>
                                            <th className="px-3 py-2.5 text-right">Tiền</th>
                                            <th className="px-5 py-2.5 text-left">Đã đòi</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/60">
                                        {quaHan.map((p) => (
                                            <tr key={p.tracking || p.order_no} className="transition-colors hover:bg-muted/30">
                                                <td className="px-5 py-2.5 font-semibold text-foreground">{p.order_no}</td>
                                                <td className="px-3 py-2.5 font-mono text-[12px] text-sky-700 dark:text-sky-300">{p.tracking}</td>
                                                <td className="px-3 py-2.5 text-foreground/85">{p.contact_name || "—"}</td>
                                                <td className="px-3 py-2.5 font-mono text-[12px] text-violet-700 dark:text-violet-300">{p.phone || "—"}</td>
                                                <td className="px-3 py-2.5 text-right">
                                                    <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11.5px] font-bold text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
                                                        {p.ky_da_qua} kỳ
                                                    </span>
                                                </td>
                                                <td className="px-3 py-2.5 text-right font-bold tabular-nums text-foreground">{TWD(p.cod_twd)}</td>
                                                <td className="px-5 py-2.5">
                                                    <span className={cn("rounded-full px-2 py-0.5 text-[12px] font-medium",
                                                        !p.da_doi ? "bg-muted text-muted-foreground"
                                                            : p.doi_chu.includes("vẫn im")
                                                                ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
                                                                : "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300")}>
                                                        {p.doi_chu}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}

                    {dangCho.length > 0 && (
                        <div className={cn(quaHan.length > 0 && "border-t border-border/70")}>
                            <div className="flex flex-wrap items-start gap-x-4 gap-y-3 px-5 py-4">
                                <span className="grid h-9 w-9 flex-none place-items-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                                    <Hourglass className="h-[18px] w-[18px]" />
                                </span>
                                <div className="min-w-[14rem] flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-[14.5px] font-bold text-foreground">
                                            {dangCho.length} đơn đang chờ — bình thường, không phải làm gì
                                        </span>
                                        <span className="rounded-full bg-muted px-2 py-0.5 text-[12px] font-bold tabular-nums text-foreground/75">
                                            {TWD(dangCho.reduce((a, x) => a + x.cod_twd, 0))}
                                        </span>
                                    </div>
                                    {/* Bản trước gộp cả nhóm này vào một dòng gọi là "sao kê bỏ sót 80 đơn",
                                        làm 76 đơn lành cũng trông như lỗi của NAZA. Phải nói rõ vì sao chưa cần lo. */}
                                    <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                                        {dangCho.filter((x) => x.ky_da_qua === 0).length} đơn chưa qua kỳ sao kê nào,{" "}
                                        {dangCho.filter((x) => x.ky_da_qua >= 1).length} đơn mới qua 1 kỳ.
                                        NAZA trả theo kỳ chứ không trả theo ngày, nên chừng nào chưa qua 2 kỳ thì chưa gọi là chậm.
                                    </p>
                                </div>
                                <Nut onClick={() => setMoCho((v) => !v)}>
                                    <ChevronDown className={cn("h-4 w-4 transition-transform", moCho && "rotate-180")} />
                                    {moCho ? "Thu gọn" : "Xem danh sách"}
                                </Nut>
                            </div>
                            {moCho && (
                                <div className="max-h-80 overflow-auto border-t border-border/70">
                                    <table className="w-full min-w-[560px] whitespace-nowrap text-[13px]">
                                        <tbody className="divide-y divide-border/60">
                                            {dangCho.map((p) => (
                                                <tr key={p.tracking || p.order_no} className="even:bg-muted/25">
                                                    <td className="px-5 py-2 font-semibold text-foreground">{p.order_no}</td>
                                                    <td className="px-3 py-2 font-mono text-[12px] text-sky-700 dark:text-sky-300">{p.tracking}</td>
                                                    <td className="px-3 py-2 text-foreground/85">{p.contact_name || "—"}</td>
                                                    <td className="px-3 py-2 text-right text-[12px] text-muted-foreground">
                                                        {p.ky_da_qua === 0 ? "chưa qua kỳ nào" : `qua ${p.ky_da_qua} kỳ`}
                                                    </td>
                                                    <td className="px-5 py-2 text-right font-semibold tabular-nums text-foreground">{TWD(p.cod_twd)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}
                </Khoi>
            )}

            {/* ═══ ⑤ TỶ GIÁ — quy ra tiền, không quy ra phần trăm ═══ */}
            {fx && fx.rows.length > 1 && (
                <Khoi so="5" ten="Tỷ giá đã lấy của mình bao nhiêu" phamVi="all">
                    <div className="grid gap-px border-b border-border/70 bg-border/60 sm:grid-cols-3">
                        <Kpi label="Thiệt vì tỷ giá" value={VND(fx.total_thiet_vnd)}
                            sub={`qua ${fx.rows.filter((r) => r.thiet_vnd != null).length} kỳ đã có sao kê`} tone="red" />
                        <Kpi label="Tỷ giá tốt nhất NAZA từng đặt"
                            value={fx.best_vnd_per_twd != null ? `${fx.best_vnd_per_twd.toFixed(2)}đ/NT$` : "—"}
                            sub={fx.best_period ? `kỳ chốt ${dmy(fx.best_period)}` : ""} tone="green" />
                        <KpiTeNhat rows={fx.rows} />
                    </div>
                    <p className="flex items-start gap-2 border-b border-border/70 bg-muted/30 px-5 py-3 text-[12.5px] leading-relaxed text-muted-foreground">
                        <Info className="mt-0.5 h-4 w-4 flex-none" />
                        <span>
                            Tỷ giá NAZA tự đặt và mình phải chịu, nên phần trăm lên xuống không giúp quyết định gì.
                            Bảng này trả lời đúng một câu: <b className="font-semibold text-foreground">nó đã lấy của mình bao nhiêu tiền</b> —
                            lấy mốc là kỳ tốt nhất chính NAZA từng đặt, nên không cãi được là mốc quá đáng.
                            Tính trên tích cả hai chặng NT$ → ¥ → đ.
                        </span>
                    </p>
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[720px] whitespace-nowrap text-[13px]">
                            <thead>
                                <tr className="border-b border-border/70 bg-muted/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                    <th className="px-5 py-2.5 text-left">Kỳ chốt</th>
                                    <th className="px-3 py-2.5 text-right">TWD→RMB</th>
                                    <th className="px-3 py-2.5 text-right">RMB→VND</th>
                                    <th className="px-3 py-2.5 text-right">Đồng / NT$</th>
                                    <th className="px-3 py-2.5 text-right">Tiền COD</th>
                                    <th className="px-5 py-2.5 text-right">Thiệt so kỳ tốt nhất</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/60">
                                {(() => {
                                    const thietMax = Math.max(0, ...fx.rows.map((r) => r.thiet_vnd ?? 0));
                                    return fx.rows.map((r) => (
                                        <tr key={r.filename}
                                            className={cn("transition-colors",
                                                r.filename === period?.filename ? "bg-orange-50/70 dark:bg-orange-500/[0.07]" : "hover:bg-muted/30")}>
                                            <td className="px-5 py-2.5 font-semibold tabular-nums text-foreground">{dmy(r.period_date)}</td>
                                            <td className="px-3 py-2.5 text-right tabular-nums text-sky-700 dark:text-sky-300">{r.rate_twd_rmb ?? "—"}</td>
                                            <td className="px-3 py-2.5 text-right tabular-nums text-violet-700 dark:text-violet-300">{r.rate_rmb_vnd ?? "—"}</td>
                                            <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-foreground">
                                                {r.vnd_per_twd != null ? r.vnd_per_twd.toFixed(2) : "—"}
                                            </td>
                                            <td className="px-3 py-2.5 text-right tabular-nums text-foreground/80">{TWD(r.cod_twd)}</td>
                                            <td className="px-5 py-2.5 text-right">
                                                {r.thiet_vnd == null ? <span className="text-muted-foreground">—</span>
                                                    : r.tot_nhat ? (
                                                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[12px] font-semibold text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
                                                            <BadgeCheck className="h-3.5 w-3.5" />tốt nhất
                                                        </span>
                                                    ) : (
                                                        <div className="flex items-center justify-end gap-3">
                                                            <span className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-rose-100 sm:block dark:bg-rose-500/15">
                                                                <span className="block h-full rounded-full bg-rose-500"
                                                                    style={{ width: `${thietMax > 0 ? Math.max(4, (r.thiet_vnd / thietMax) * 100) : 0}%` }} />
                                                            </span>
                                                            <span className="font-semibold tabular-nums text-rose-600 dark:text-rose-400">
                                                                −{VND(r.thiet_vnd)}
                                                            </span>
                                                        </div>
                                                    )}
                                            </td>
                                        </tr>
                                    ));
                                })()}
                            </tbody>
                        </table>
                    </div>
                </Khoi>
            )}
        </div>
    );
}

/* ═══════════════════════ mảnh dùng lại ═══════════════════════
   Màu chữ đi theo NGHĨA của con số, cả tab một luật — nhìn màu là biết loại tiền:
     xanh dương = NT$ (tiền Đài)      tím = ¥ (tiền Trung)      xanh lá = tiền về tay
     cam        = tiền hàng           đỏ  = khoản bị trừ / thiếu / nợ
     vàng hổ phách = số dự tính, số còn chờ
   Số tiền dùng chính font chữ với chữ số thẳng cột (tabular-nums) — font mono cũ
   làm bảng trông như màn hình dòng lệnh. Font mono chỉ còn cho mã vận đơn và số
   điện thoại, là thứ phải dò từng ký tự. */

const MUC: Record<Viec["muc"], { Icon: LucideIcon; vach: string; nen: string; the: string }> = {
    gap: {
        Icon: AlertTriangle, vach: "bg-rose-500",
        nen: "bg-rose-500/10 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400",
        the: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
    },
    soat: {
        Icon: SearchCheck, vach: "bg-amber-400",
        nen: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
        the: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
    },
    ghi: {
        Icon: Landmark, vach: "bg-sky-500",
        nen: "bg-sky-500/10 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400",
        the: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
    },
};

/**
 * Một bước trong quy trình.
 *
 * `phamVi` là thứ sửa đúng lời chê nặng nhất của Sỹ Anh — "không biết số nào
 * của kỳ nào". Mỗi khối phải TỰ KHAI số của nó thuộc một kỳ hay cộng dồn, đóng
 * dấu ngay góc phải, không để người đọc tự đoán.
 */
function Khoi({ so, ten, phamVi, phu, dem, phai, children }: {
    so: string; ten: string; phamVi: "one" | "all";
    phu?: string; dem?: string; phai?: React.ReactNode; children: React.ReactNode;
}) {
    return (
        <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/70 px-5 py-3.5">
                <span className="grid h-8 w-8 flex-none place-items-center rounded-xl bg-gradient-to-br from-orange-400 to-rose-500 text-[14px] font-extrabold text-white shadow-sm shadow-orange-500/30">
                    {so}
                </span>
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-[15.5px] font-bold leading-tight text-foreground">{ten}</h3>
                        {dem && (
                            <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[12px] font-bold tabular-nums text-orange-700 dark:bg-orange-500/15 dark:text-orange-300">
                                {dem}
                            </span>
                        )}
                    </div>
                    {phu && <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">{phu}</p>}
                </div>
                <div className="ml-auto flex max-w-full flex-wrap items-center gap-2">
                    {phai}
                    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide",
                        phamVi === "one"
                            ? "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300"
                            : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300")}>
                        {phamVi === "one" ? <CalendarDays className="h-3 w-3" /> : <Layers className="h-3 w-3" />}
                        {phamVi === "one" ? "chỉ kỳ này" : "cộng dồn mọi kỳ"}
                    </span>
                </div>
            </header>
            {children}
        </section>
    );
}

function Nut({ children, onClick, kieu, busy, busyText, lon }: {
    children: React.ReactNode; onClick?: () => void;
    kieu?: "chinh" | "xong"; busy?: boolean; busyText?: string; lon?: boolean;
}) {
    return (
        <button onClick={onClick} disabled={busy}
            className={cn("inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-semibold transition-all active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
                lon ? "h-10 px-4 text-[14px]" : "h-8 px-3 text-[13px]",
                kieu === "chinh" ? "bg-gradient-to-b from-orange-500 to-orange-600 text-white shadow-sm shadow-orange-600/25 hover:from-orange-600 hover:to-orange-700"
                    : kieu === "xong" ? "border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300 dark:hover:bg-emerald-500/20"
                        : "border border-border bg-card text-foreground/80 shadow-sm hover:bg-muted hover:text-foreground")}>
            {busy ? (busyText || "Đang ghi…") : children}
        </button>
    );
}

const RMB2 = (n: number) => `${n.toLocaleString("vi-VN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}¥`;

/** Ba chặng tiền, mỗi chặng một màu — khớp đúng ba đồng tiền trong sheet TỔNG. */
const CHANG = {
    twd: {
        ky: "NT$", chip: "bg-sky-600 text-white", ten: "text-sky-800 dark:text-sky-200",
        khung: "border-sky-200 bg-sky-50/60 dark:border-sky-500/25 dark:bg-sky-500/[0.06]",
        vach: "border-sky-200/80 dark:border-sky-500/20", so: "text-sky-700 dark:text-sky-300",
    },
    rmb: {
        ky: "¥", chip: "bg-violet-600 text-white", ten: "text-violet-800 dark:text-violet-200",
        khung: "border-violet-200 bg-violet-50/60 dark:border-violet-500/25 dark:bg-violet-500/[0.06]",
        vach: "border-violet-200/80 dark:border-violet-500/20", so: "text-violet-700 dark:text-violet-300",
    },
    vnd: {
        ky: "đ", chip: "bg-emerald-600 text-white", ten: "text-emerald-800 dark:text-emerald-200",
        khung: "border-emerald-200 bg-emerald-50/60 dark:border-emerald-500/25 dark:bg-emerald-500/[0.06]",
        vach: "border-emerald-200/80 dark:border-emerald-500/20", so: "text-emerald-700 dark:text-emerald-400",
    },
} as const;

function ChangTien({ te, ten, mo, children }: {
    te: keyof typeof CHANG; ten: string; mo: string; children: React.ReactNode;
}) {
    const c = CHANG[te];
    return (
        <div className={cn("flex min-w-0 flex-col overflow-hidden rounded-xl border", c.khung)}>
            <div className={cn("flex items-center gap-2.5 border-b px-3.5 py-2", c.vach)}>
                <span className={cn("min-w-[2.25rem] flex-none rounded-md px-1.5 py-0.5 text-center text-[11.5px] font-bold", c.chip)}>{c.ky}</span>
                <div className="min-w-0 leading-tight">
                    <div className={cn("text-[13px] font-bold", c.ten)}>{ten}</div>
                    <div className="truncate text-[11.5px] text-muted-foreground">{mo}</div>
                </div>
            </div>
            <div className="flex flex-1 flex-col gap-2 px-3.5 py-3">{children}</div>
        </div>
    );
}

function DongTien({ nhan, so, ghi, tru, tong, mau, lon }: {
    nhan: string; so: string; ghi?: string; tru?: boolean; tong?: boolean; mau?: string; lon?: boolean;
}) {
    return (
        <div className={cn("flex items-start justify-between gap-3", tong && "mt-auto border-t border-border/80 pt-2.5")}>
            <div className="min-w-0">
                <div className={cn("text-[13px]", tong ? "font-bold text-foreground" : "text-foreground/75")}>{nhan}</div>
                {ghi && <div className="text-[11.5px] leading-snug text-muted-foreground">{ghi}</div>}
            </div>
            <div className={cn("whitespace-nowrap text-right tabular-nums",
                tong ? cn("font-extrabold tracking-tight", lon ? "text-[18px]" : "text-[15px]", mau) : "text-[13.5px] font-semibold text-foreground/90",
                tru && "text-rose-600 dark:text-rose-400")}>
                {so}
            </div>
        </div>
    );
}

function MuiTen({ chu }: { chu: string }) {
    return (
        <div className="flex items-center justify-center gap-2 xl:flex-col xl:gap-1 xl:px-0.5">
            <span className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">tỷ giá</span>
            <span className="whitespace-nowrap rounded-full border border-border bg-card px-2.5 py-1 text-[12px] font-bold tabular-nums text-foreground/85 shadow-sm">
                {chu}
            </span>
            <ArrowDown className="h-4 w-4 text-muted-foreground xl:hidden" />
            <ArrowRight className="hidden h-4 w-4 text-muted-foreground xl:block" />
        </div>
    );
}

/**
 * Luồng tiền — chép đúng thứ tự sheet TỔNG của NAZA, để người đọc đặt cạnh file
 * NAZA gửi mà dò từng dòng. Chia ba chặng theo ba đồng tiền, đúng như tiền thật
 * đi: COD Đài → đổi sang tệ, NAZA trừ phí → đổi sang tiền Việt, trừ tiền hàng.
 */
function LuongTien({ l }: { l: Luong }) {
    const th = l.tien_hang;
    const khongQuyDoi = l.vnd == null && (l.rmb_rong ?? 0) < 0;
    const chenhChuyenKy = l.vnd != null && l.phai_nhan_vnd != null
        ? l.phai_nhan_vnd - (l.vnd - (th.cach_tra === "naza_tru" ? th.trong_luong_vnd : 0)) : 0;
    const dot = th.file ? `${th.file.ngay.slice(8, 10)}/${th.file.ngay.slice(5, 7)}` : "";
    return (
        <div className="px-5 py-4">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h4 className="text-[12px] font-bold uppercase tracking-wider text-foreground/70">Luồng tiền kỳ này</h4>
                <span className="text-[12px] text-muted-foreground">theo đúng thứ tự sheet TỔNG của NAZA — đặt cạnh file mà dò từng dòng</span>
            </div>
            <div className="grid items-stretch gap-2 xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
                <ChangTien te="twd" ten="Đài Loan" mo="khách trả tại cửa hàng">
                    <DongTien nhan="Số đơn NAZA thu được" so={formatNumber(l.so_dong_sao_ke)} />
                    <DongTien nhan="Tổng COD thu về" so={l.cod_twd != null ? TWD(l.cod_twd) : "—"} tong lon mau={CHANG.twd.so} />
                </ChangTien>
                <MuiTen chu={`× ${l.ty_gia_twd_rmb ?? "—"}`} />
                <ChangTien te="rmb" ten="Trung Quốc" mo="NAZA trừ phí">
                    <DongTien nhan="Quy ra nhân dân tệ" so={l.rmb != null ? RMB2(l.rmb) : "—"} />
                    <DongTien nhan="− Phí thao tác" so={l.phi_gop ? "(gộp vào phí ship)" : RMB2(-l.phi_thao_tac_rmb)} tru={!l.phi_gop} />
                    <DongTien nhan="− Phí vận chuyển" so={RMB2(-l.phi_ship_rmb)} tru />
                    <DongTien nhan="= COD còn lại" so={l.rmb_rong != null ? RMB2(l.rmb_rong) : "—"} tong
                        mau={(l.rmb_rong ?? 0) < 0 ? "text-rose-600 dark:text-rose-400" : CHANG.rmb.so} />
                </ChangTien>
                <MuiTen chu={khongQuyDoi ? "không quy đổi" : `× ${l.ty_gia_rmb_vnd != null ? l.ty_gia_rmb_vnd.toLocaleString("vi-VN") : "—"}`} />
                <ChangTien te="vnd" ten="Việt Nam" mo="về tài khoản">
                    <DongTien nhan="Quy ra tiền Việt" so={khongQuyDoi ? "không quy đổi" : l.vnd != null ? VND(l.vnd) : "—"}
                        ghi={khongQuyDoi ? "số âm — NAZA mang sang trừ kỳ sau" : undefined} />
                    {th.cach_tra === "naza_tru" ? (
                        <DongTien nhan="− Phí mua hàng" so={VND(-th.trong_luong_vnd)} tru
                            ghi={th.lech_naza_vnd && Math.abs(th.lech_naza_vnd) >= 1
                                ? `theo file tiền hàng · NAZA ghi ${VND(th.naza_tru_vnd!)}`
                                : th.file ? `đợt ${dot}` : "theo sao kê NAZA"} />
                    ) : (
                        <DongTien nhan="− Phí mua hàng" so="không trừ"
                            ghi={th.file ? `tự chuyển khoản riêng ${VND(th.file.tong_vnd)}` : "kỳ này NAZA không trừ"} />
                    )}
                    {Math.abs(chenhChuyenKy) >= 1 && (
                        <DongTien nhan="± Điều chỉnh kỳ trước" so={VND(chenhChuyenKy)} tru={chenhChuyenKy < 0}
                            ghi="NAZA mang số âm kỳ trước sang" />
                    )}
                    <DongTien nhan="= Phải nhận" tong lon
                        so={l.phai_nhan_vnd != null ? VND(l.phai_nhan_vnd) : (l.rmb_rong ?? 0) < 0 ? "0đ — trừ kỳ sau" : "—"}
                        mau={l.phai_nhan_vnd != null ? CHANG.vnd.so : "text-rose-600 dark:text-rose-400"} />
                </ChangTien>
            </div>
            {th.file && th.cach_tra === "tu_chuyen" && (
                <div className={cn("mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border px-3.5 py-2.5 text-[13px]",
                    (th.con_no_vnd ?? 0) > 0
                        ? "border-rose-200 bg-rose-50/70 dark:border-rose-500/30 dark:bg-rose-500/10"
                        : "border-border bg-muted/30")}>
                    <ReceiptText className="h-4 w-4 flex-none text-muted-foreground" />
                    <span className="font-semibold text-foreground">Tiền hàng đợt {dot}:</span>
                    <span className="font-semibold tabular-nums text-orange-600 dark:text-orange-400">{VND(th.file.tong_vnd)}</span>
                    <span className="text-muted-foreground">· đã trả</span>
                    <span className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{VND(th.da_tra_vnd ?? 0)}</span>
                    {(th.con_no_vnd ?? 0) > 0 && (
                        <>
                            <span className="text-muted-foreground">· còn nợ</span>
                            <span className="font-bold tabular-nums text-rose-600 dark:text-rose-400">{VND(th.con_no_vnd!)}</span>
                        </>
                    )}
                    {th.file.no_ky_truoc_vnd > 0 && (
                        <span className="text-muted-foreground">· gồm {VND(th.file.no_ky_truoc_vnd)} nợ kỳ trước</span>
                    )}
                </div>
            )}
        </div>
    );
}

const THE_TIEN = {
    xanh: {
        khung: "border-emerald-200/80 from-emerald-50 dark:border-emerald-500/25 dark:from-emerald-500/[0.09]",
        icon: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
        nhan: "text-emerald-900/75 dark:text-emerald-200/85", so: "text-emerald-600 dark:text-emerald-400",
    },
    vang: {
        khung: "border-amber-200/80 from-amber-50 dark:border-amber-500/25 dark:from-amber-500/[0.09]",
        icon: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
        nhan: "text-amber-900/75 dark:text-amber-200/85", so: "text-amber-600 dark:text-amber-400",
    },
    cam: {
        khung: "border-orange-200/80 from-orange-50 dark:border-orange-500/25 dark:from-orange-500/[0.09]",
        icon: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
        nhan: "text-orange-900/75 dark:text-orange-200/85", so: "text-orange-600 dark:text-orange-400",
    },
} as const;

function TheTien({ mau, Icon, nhan, so, uoc, chiSo, ghi, nhanPhu, canh }: {
    mau: keyof typeof THE_TIEN; Icon: LucideIcon; nhan: string; so: string; uoc?: boolean;
    chiSo?: { so: string; ten: string; cls?: string }[]; ghi: string; nhanPhu?: string; canh?: string;
}) {
    const c = THE_TIEN[mau];
    return (
        <div className={cn("flex min-w-0 flex-col rounded-xl border bg-gradient-to-br to-card p-4", c.khung)}>
            <div className="flex items-center gap-2.5">
                <span className={cn("grid h-8 w-8 flex-none place-items-center rounded-lg", c.icon)}>
                    <Icon className="h-4 w-4" />
                </span>
                <span className={cn("text-[12px] font-bold uppercase leading-tight tracking-wide", c.nhan)}>{nhan}</span>
            </div>
            <div className={cn("mt-3 flex items-baseline gap-1.5 whitespace-nowrap text-[length:clamp(22px,2.1vw,30px)] font-extrabold leading-none tracking-tight tabular-nums", c.so)}>
                {uoc && <span className="text-[0.7em] font-bold opacity-60">≈</span>}
                {so}
            </div>
            {chiSo && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                    {chiSo.map((x) => (
                        <span key={x.ten} className="inline-flex items-baseline gap-1 rounded-lg bg-card/90 px-2 py-1 text-[12.5px] ring-1 ring-border">
                            <b className={cn("font-bold tabular-nums text-foreground", x.cls)}>{x.so}</b>
                            <span className="text-muted-foreground">{x.ten}</span>
                        </span>
                    ))}
                </div>
            )}
            <p className="mt-auto pt-3 text-[12.5px] leading-snug text-muted-foreground">{ghi}</p>
            {nhanPhu && (
                <span className="mt-2 inline-flex w-fit items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[11.5px] font-semibold text-sky-800 dark:bg-sky-500/15 dark:text-sky-300">
                    <Landmark className="h-3 w-3" />{nhanPhu}
                </span>
            )}
            {canh && <p className="mt-2 text-[12px] font-semibold text-rose-600 dark:text-rose-400">{canh}</p>}
        </div>
    );
}

/**
 * Tiền về — con số Sỹ Anh xin 13/09/2026: NAZA đã gửi bao nhiêu, và còn phải gửi
 * bao nhiêu theo hai cách đếm đơn còn lại.
 */
function KhoiTienVe({ t }: { t: TienVe }) {
    const gia = t.ty_gia.twd_rmb != null && t.ty_gia.rmb_vnd != null
        ? `tỷ giá kỳ ${t.ty_gia.ngay_sao_ke ? t.ty_gia.ngay_sao_ke.slice(8, 10) + "/" + t.ty_gia.ngay_sao_ke.slice(5, 7) : "mới nhất"}: ${t.ty_gia.twd_rmb} × ${t.ty_gia.rmb_vnd.toLocaleString("vi-VN")}`
        : "chưa có tỷ giá";
    const lechFile = t.phai_nhan_theo_file_vnd - t.da_gui_ve_vnd;
    const COD = "text-sky-700 dark:text-sky-300";
    const tongDon = t.con_lai_da_giao.so_don + t.con_lai_chua_giao.so_don;
    const tongCod = t.con_lai_da_giao.cod_twd + t.con_lai_chua_giao.cod_twd;
    return (
        <Khoi so="Σ" ten="Tiền về" phamVi="all" phu="NAZA đã gửi bao nhiêu, còn phải gửi bao nhiêu">
            <div className="grid gap-3 p-4 lg:grid-cols-3">
                <TheTien mau="xanh" Icon={Wallet} nhan="NAZA đã gửi về" so={VND(t.da_gui_ve_vnd)}
                    chiSo={[{ so: formatNumber(t.so_ky), ten: "kỳ sao kê" }]}
                    ghi="cộng số phải trả NAZA ghi trên từng sao kê"
                    nhanPhu={t.ky_da_doi_chieu_bank === 0 ? "chưa kỳ nào đối chiếu ngân hàng" : `${t.ky_da_doi_chieu_bank} kỳ đã đối chiếu ngân hàng`}
                    canh={Math.abs(lechFile) >= 1
                        ? `Theo file tiền hàng lẽ ra ${VND(t.phai_nhan_theo_file_vnd)} (NAZA ${lechFile > 0 ? "trừ dư" : "trừ thiếu"} ${VND(Math.abs(lechFile))})`
                        : undefined} />
                <TheTien mau="vang" Icon={PackageCheck} nhan="Còn phải gửi — đơn đã giao thành công" uoc
                    so={t.con_lai_da_giao.vnd_uoc != null ? VND(t.con_lai_da_giao.vnd_uoc) : "—"}
                    chiSo={[
                        { so: formatNumber(t.con_lai_da_giao.so_don), ten: "đơn" },
                        { so: TWD(t.con_lai_da_giao.cod_twd), ten: "COD", cls: COD },
                    ]}
                    ghi={`${t.con_lai_da_giao.don_chua_tru_phi} đơn chưa bị trừ phí ship`} />
                <TheTien mau="cam" Icon={Boxes} nhan="Đơn còn lại — chưa giao xong" uoc
                    so={t.con_lai_chua_giao.vnd_uoc != null ? VND(t.con_lai_chua_giao.vnd_uoc) : "—"}
                    chiSo={[
                        { so: formatNumber(t.con_lai_chua_giao.so_don), ten: "đơn" },
                        { so: TWD(t.con_lai_chua_giao.cod_twd), ten: "COD", cls: COD },
                    ]}
                    ghi={`tiền chưa thu từ khách · đã trừ ${t.khong_tinh.hoan} đơn hoàn + ${t.khong_tinh.huy} đơn huỷ`
                        + `${t.khong_tinh.tieu_huy ? ` + ${t.khong_tinh.tieu_huy} đơn tiêu huỷ` : ""}`
                        + ` (${TWD(t.khong_tinh.cod_twd)}) vì không bao giờ trả tiền`} />
            </div>
            <p className="flex items-start gap-2 border-t border-border/70 bg-muted/30 px-5 py-3 text-[12.5px] leading-relaxed text-muted-foreground">
                <Info className="mt-0.5 h-4 w-4 flex-none" />
                <span>
                    <b className="font-semibold text-foreground">Hai ô bên phải không trùng nhau</b> — cộng lại là {formatNumber(tongDon)} đơn
                    ({TWD(tongCod)}) chưa thấy tiền trên sao kê nào: đơn đã giao là tiền NAZA đang giữ, đơn chưa giao là tiền còn ở ngoài đường.{" "}
                    Số dự tính đi đúng luồng NAZA: COD × {gia} − phí. Đơn đã bị NAZA trừ phí ship ở kỳ trước thì không trừ lại;
                    đơn chưa bị trừ thì trừ phí ship theo bảng giá kênh giao (kg đầu) + phí thao tác.
                    <b className="font-semibold text-foreground"> Chưa trừ tiền hàng các kỳ tới</b> — chưa biết trước được.
                    {t.tien_hang.loi && <span className="font-semibold text-rose-600 dark:text-rose-400"> {t.tien_hang.loi}</span>}
                </span>
            </p>
        </Khoi>
    );
}

const KPI_TONE = {
    twd: "text-sky-700 dark:text-sky-300",
    rmb: "text-violet-700 dark:text-violet-300",
    hang: "text-orange-600 dark:text-orange-400",
    green: "text-emerald-600 dark:text-emerald-400",
    red: "text-rose-600 dark:text-rose-400",
    cho: "text-amber-600 dark:text-amber-400",
} as const;

function Kpi({ label, value, sub, tone, className }: {
    label: string; value: string; sub?: string; tone?: keyof typeof KPI_TONE; className?: string;
}) {
    return (
        <div className={cn("bg-card px-5 py-3.5", className)}>
            <div className="text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
            <div className={cn("mt-1 text-[20px] font-extrabold leading-tight tracking-tight tabular-nums text-foreground",
                tone && KPI_TONE[tone])}>{value}</div>
            {sub && <div className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">{sub}</div>}
        </div>
    );
}

function KpiTeNhat({ rows }: { rows: FxRow[] }) {
    const w = rows.filter((r) => r.thiet_vnd != null && !r.tot_nhat)
        .sort((a, b) => (b.thiet_vnd ?? 0) - (a.thiet_vnd ?? 0))[0];
    return (
        <Kpi label="Kỳ tệ nhất" value={w ? VND(w.thiet_vnd ?? 0) : "—"}
            sub={w ? `kỳ chốt ${dmy(w.period_date)}` : "chưa đủ kỳ để so"} tone={w ? "cho" : undefined} />
    );
}

function TrangThai({ p }: { p: Period }) {
    const style: Record<PeriodState, string> = {
        khop: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/25",
        lech: "bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-400/25",
        cho_nhap: "bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-400/25",
        thieu_file: "bg-amber-50 text-amber-800 ring-amber-600/25 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/25",
    };
    return (
        <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-semibold ring-1 ring-inset",
            style[p.trang_thai])}>
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {p.trang_thai_chu}
        </span>
    );
}

/**
 * Ô nhập tiền thật về — số và ngày, gọn trong một dòng của bảng.
 *
 * Gợi ý sẵn số sao kê tính ra làm placeholder, nhưng KHÔNG điền sẵn vào ô: điền
 * sẵn thì người ta chỉ việc bấm Enter, và cả khâu đối chiếu hoá ra vô nghĩa vì
 * số "thực nhận" chính là số "phải nhận" chép lại.
 */
function FormBank({ goiY, busy, onGhi, onHuy }: {
    goiY: number | null; busy: boolean;
    onGhi: (so: number, ngay: string) => void; onHuy: () => void;
}) {
    const [so, setSo] = useState("");
    const [ngay, setNgay] = useState(format(new Date(), "yyyy-MM-dd"));
    const num = Number(so.replace(/\D/g, ""));
    const o = "h-8 rounded-lg border border-border bg-card text-[13px] shadow-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 dark:[color-scheme:dark]";
    return (
        <div className="flex items-center justify-end gap-1.5">
            <input autoFocus inputMode="numeric" value={so}
                placeholder={goiY != null ? Math.round(goiY).toLocaleString("vi-VN") : "số tiền"}
                onChange={(e) => setSo(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === "Enter" && num > 0) onGhi(num, ngay);
                    if (e.key === "Escape") onHuy();
                }}
                className={cn(o, "w-32 px-2.5 text-right font-semibold tabular-nums")} />
            <input type="date" value={ngay} max={format(new Date(), "yyyy-MM-dd")}
                onChange={(e) => setNgay(e.target.value)}
                className={cn(o, "px-2 tabular-nums")} />
            <button disabled={busy || !(num > 0)} onClick={() => onGhi(num, ngay)} title="Ghi số tiền về"
                className="grid h-8 w-8 place-items-center rounded-lg bg-orange-500 text-white shadow-sm hover:bg-orange-600 disabled:opacity-40">
                <Check className="h-4 w-4" />
            </button>
            <button onClick={onHuy} title="Huỷ"
                className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-card text-muted-foreground hover:bg-muted">
                <X className="h-4 w-4" />
            </button>
        </div>
    );
}

function MucSoat({ nhom, ten, hoi, checks }: { nhom: "A" | "B"; ten: string; hoi: string; checks: Check[] }) {
    if (!checks.length) return null;
    const xau = checks.filter((c) => c.ok === false).length;
    return (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border/70 px-4 py-2.5">
                <span className="grid h-6 w-6 flex-none place-items-center rounded-md bg-foreground/[0.07] text-[12px] font-extrabold text-foreground/75">
                    {nhom}
                </span>
                <span className="text-[13.5px] font-bold text-foreground">{ten}</span>
                <span className="text-[12.5px] text-muted-foreground">— {hoi}</span>
                <span className={cn("ml-auto rounded-full px-2 py-0.5 text-[11.5px] font-bold",
                    xau ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
                        : "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300")}>
                    {xau ? `${xau} mục cần xử` : "sạch"}
                </span>
            </div>
            <ul className="divide-y divide-border/60">
                {checks.map((c) => (
                    <li key={c.ten} className={cn("flex items-start gap-3 px-4 py-2.5",
                        c.ok === false && "bg-rose-50/60 dark:bg-rose-500/[0.06]")}>
                        <span className={cn("mt-0.5 grid h-6 w-6 flex-none place-items-center rounded-full",
                            c.ok === true ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                                : c.ok === false ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
                                    : "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300")}>
                            {c.ok === true ? <Check className="h-3.5 w-3.5" strokeWidth={3} />
                                : c.ok === false ? <AlertTriangle className="h-3.5 w-3.5" />
                                    : <Info className="h-3.5 w-3.5" />}
                        </span>
                        <div className="min-w-0">
                            <div className={cn("text-[13.5px] font-semibold",
                                c.ok === false ? "text-rose-700 dark:text-rose-300" : "text-foreground")}>{c.ten}</div>
                            <div className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{c.chi_tiet}</div>
                        </div>
                    </li>
                ))}
            </ul>
        </div>
    );
}

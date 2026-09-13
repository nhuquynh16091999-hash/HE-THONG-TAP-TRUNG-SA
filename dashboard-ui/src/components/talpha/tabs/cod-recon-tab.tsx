"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import {
    Upload, AlertTriangle, Download, Copy, CheckCircle2, ChevronDown, Check, X,
} from "lucide-react";
import TabSkeleton, { ErrorState } from "@/components/ui/tab-skeleton";
import { formatNumber, cn } from "../utils";
import { TWD, VND } from "./ledger-shared";

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
    con_lai_da_giao: UocTinh; con_lai_tat_ca: UocTinh;
    khong_tinh: { hoan: number; huy: number; cod_twd: number };
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
    const [stms, setStms] = useState<StatementMeta[]>([]);
    const [pid, setPid] = useState("");
    const [copied, setCopied] = useState("");
    const [busy, setBusy] = useState("");
    const [moCho, setMoCho] = useState(false);          // bung danh sách đơn đang chờ
    const [nhapBank, setNhapBank] = useState("");       // tên file kỳ đang nhập tiền về
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

            {/* ── Thanh mở đầu: tiền chưa ai đối chiếu với ngân hàng ──
                Đây là lỗ to nhất của cả tab, nên nó đứng trước mọi thứ khác. */}
            {tq && (tq.ky_cho_nhap > 0 || tq.ky_lech > 0) && (
                <div className={cn("flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border px-4 py-3",
                    tq.ky_lech > 0
                        ? "border-rose-300 bg-rose-50 dark:border-rose-500/40 dark:bg-rose-500/10"
                        : "border-sky-300 bg-sky-50 dark:border-sky-500/40 dark:bg-sky-500/10")}>
                    <div>
                        <div className={cn("font-mono text-xl font-bold tabular-nums",
                            tq.ky_lech > 0 ? "text-rose-700 dark:text-rose-300" : "text-sky-800 dark:text-sky-300")}>
                            {VND(tq.tien_cho_nhap_vnd)}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                            qua {tq.ky_cho_nhap} lần chuyển khoản
                        </div>
                    </div>
                    <p className="min-w-0 flex-1 text-[12.5px] text-muted-foreground">
                        <b className="text-foreground">Chưa lần nào được đối chiếu với ngân hàng.</b>{" "}
                        File của {tq.ky_cho_nhap} kỳ đều soát xong, nhưng số tiền thật vào tài khoản thì chưa ai
                        nhập vào để so. Nhập số của từng kỳ ở bảng ② ngay dưới.
                        {tq.ky_khop > 0 && <> Đã khớp xong {tq.ky_khop} kỳ.</>}
                        {tq.ky_lech > 0 && (
                            <> <b className="text-rose-700 dark:text-rose-300">{tq.ky_lech} kỳ tiền về không khớp.</b></>
                        )}
                    </p>
                </div>
            )}

            {/* ═══ ① VIỆC HÔM NAY ═══ */}
            <Khoi so="①" ten="Việc hôm nay" phamVi="all" dem={viec.length ? `${viec.length} việc` : ""}>
                {viec.length === 0 ? (
                    <div className="flex items-center gap-3 px-4 py-5">
                        <CheckCircle2 className="h-6 w-6 flex-none text-emerald-500" />
                        <div>
                            <div className="font-semibold text-emerald-700 dark:text-emerald-400">Không có việc gì cần làm</div>
                            <div className="text-sm text-muted-foreground">
                                Mọi kỳ đã soát xong, tiền đã về khớp, không đơn nào quá hạn phải đòi.
                            </div>
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
                                <div className="flex flex-none flex-wrap gap-1.5">
                                    {v.id === "doi-naza" && (
                                        <>
                                            <Nut kieu="chinh" onClick={() => chep("z-vi", tinDoiTien(quaHan, "vi"))}>
                                                <Copy className="mr-1 inline h-3.5 w-3.5" />
                                                {copied === "z-vi" ? "Đã chép" : "Chép tin (Việt)"}
                                            </Nut>
                                            <Nut onClick={() => chep("z-zh", tinDoiTien(quaHan, "zh"))}>
                                                {copied === "z-zh" ? "Đã chép" : "中文"}
                                            </Nut>
                                            <Nut kieu="xong" busy={busy === "doi-me"} onClick={() => ghiDoiCaMe(quaHan)}>
                                                <Check className="mr-1 inline h-3.5 w-3.5" />Đã nhắn
                                            </Nut>
                                        </>
                                    )}
                                    {v.id === "lech-tien" && period && (
                                        <>
                                            <Nut kieu="chinh" onClick={() => chep("l-vi", tinLech(period, "vi"))}>
                                                <Copy className="mr-1 inline h-3.5 w-3.5" />
                                                {copied === "l-vi" ? "Đã chép" : "Chép tin (Việt)"}
                                            </Nut>
                                            <Nut onClick={() => chep("l-zh", tinLech(period, "zh"))}>
                                                {copied === "l-zh" ? "Đã chép" : "中文"}
                                            </Nut>
                                        </>
                                    )}
                                    {v.nut.includes("nhap_bank") && (
                                        <Nut kieu="chinh" onClick={() => setNhapBank(v.done_key)}>Nhập số</Nut>
                                    )}
                                    {v.nut.includes("da_hoi") && v.done_key && (
                                        <Nut busy={busy === v.done_key} onClick={() => ghiViec(v.done_key, "da_hoi")}>
                                            Đã hỏi NAZA
                                        </Nut>
                                    )}
                                    {v.nut.includes("bo_qua") && v.done_key && (
                                        <Nut busy={busy === v.done_key} onClick={() => ghiViec(v.done_key, "bo_qua")}>
                                            <X className="mr-1 inline h-3.5 w-3.5" />Bỏ qua
                                        </Nut>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </Khoi>

            {/* ═══ Σ TIỀN VỀ — NAZA đã gửi bao nhiêu, còn phải gửi bao nhiêu ═══ */}
            {tienVe && <KhoiTienVe t={tienVe} />}

            {/* ═══ ② BẢNG CÁC KỲ — xương sống của tab ═══ */}
            {periods.length > 0 && (
                <Khoi so="②" ten={`${periods.length} kỳ sao kê`} phamVi="all"
                    phu="bấm một dòng để mở chi tiết kỳ đó">
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[860px] text-[12.5px]">
                            <thead className="border-b border-border text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                                <tr>
                                    <th className="px-3 py-1.5 text-left">Kỳ chốt</th>
                                    <th className="px-3 py-1.5 text-left">File</th>
                                    <th className="px-3 py-1.5 text-right">Đơn</th>
                                    <th className="px-3 py-1.5 text-right">Tiền COD</th>
                                    <th className="px-3 py-1.5 text-right">Tiền hàng</th>
                                    <th className="px-3 py-1.5 text-right">Phải nhận</th>
                                    <th className="px-3 py-1.5 text-right">Thực nhận</th>
                                    <th className="px-3 py-1.5 text-right">Lệch</th>
                                    <th className="px-3 py-1.5 text-left">Tình trạng</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {periods.map((p) => (
                                    <tr key={p.id}
                                        className={cn("cursor-pointer hover:bg-muted/40",
                                            p.id === period?.id && "bg-sky-50/70 dark:bg-sky-500/[0.07]")}
                                        onClick={() => setPid(p.id)}>
                                        <td className="px-3 py-1.5 font-mono tabular-nums">{dmy(p.period_date)}</td>
                                        <td className="px-3 py-1.5 text-[11.5px] text-muted-foreground">{shortFile(p.filename)}</td>
                                        <td className="px-3 py-1.5 text-right font-mono tabular-nums">{p.luong?.so_dong_sao_ke ?? p.orders_paid}</td>
                                        <td className="px-3 py-1.5 text-right font-mono tabular-nums">{TWD(p.luong?.cod_twd ?? p.total_twd)}</td>
                                        <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                                            {p.luong?.tien_hang.file ? (
                                                <span title={p.luong.tien_hang.cach_tra === "naza_tru" ? "NAZA trừ vào COD" : "tự chuyển khoản riêng"}>
                                                    {VND(p.luong.tien_hang.file.tong_vnd)}
                                                    {p.luong.tien_hang.cach_tra === "tu_chuyen" && <span className="ml-1 text-[10px] text-muted-foreground">riêng</span>}
                                                </span>
                                            ) : <span className="text-muted-foreground">—</span>}
                                        </td>
                                        <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                                            {p.luong?.phai_nhan_vnd != null ? VND(p.luong.phai_nhan_vnd)
                                                : (p.luong?.rmb_rong ?? 0) < 0
                                                    ? <span className="text-amber-600 dark:text-amber-400" title="NAZA mang số âm sang trừ vào kỳ sau">âm {RMB2(p.luong!.rmb_rong!)} → kỳ sau</span>
                                                    : <span className="text-muted-foreground">không tính được</span>}
                                        </td>
                                        <td className="px-3 py-1.5 text-right" onClick={(e) => e.stopPropagation()}>
                                            {nhapBank === p.filename ? (
                                                <FormBank goiY={p.settlement?.payable_vnd ?? null}
                                                    busy={busy === p.filename}
                                                    onHuy={() => setNhapBank("")}
                                                    onGhi={(so, ngay) => ghiBank(p.filename, so, ngay)} />
                                            ) : p.bank ? (
                                                <button onClick={() => setNhapBank(p.filename)}
                                                    className="font-mono tabular-nums hover:underline">
                                                    {VND(p.bank.thuc_nhan_vnd)}
                                                    <span className="ml-1 text-[10.5px] text-muted-foreground">{dmy(p.bank.ngay_ve)}</span>
                                                </button>
                                            ) : (
                                                <button onClick={() => setNhapBank(p.filename)}
                                                    className="rounded-md border border-dashed border-border px-2 py-0.5 font-mono text-[11px] text-muted-foreground hover:border-sky-400 hover:text-sky-600">
                                                    chưa nhập
                                                </button>
                                            )}
                                        </td>
                                        <td className={cn("px-3 py-1.5 text-right font-mono font-semibold tabular-nums",
                                            p.lech_bank_vnd == null ? "text-muted-foreground"
                                                : p.trang_thai === "khop" ? "text-emerald-600 dark:text-emerald-400"
                                                    : "text-rose-600 dark:text-rose-400")}>
                                            {p.lech_bank_vnd == null ? "·"
                                                : Math.round(p.lech_bank_vnd) === 0 ? "0đ"
                                                    : `${p.lech_bank_vnd > 0 ? "+" : "−"}${VND(Math.abs(p.lech_bank_vnd))}`}
                                        </td>
                                        <td className="px-3 py-1.5"><TrangThai p={p} /></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {tq && (
                        <p className="border-t border-border bg-muted/30 px-4 py-2 text-[12px] text-muted-foreground">
                            Kỳ chỉ được coi là <b className="text-foreground">xong</b> khi tiền thật về khớp số sao kê
                            tính ra — không phải khi tám mục soát xanh hết. Lệch trong {VND(tq.bank_tolerance_vnd)} thì
                            bỏ qua, vì quy đổi ba tầng NT$ → ¥ → đ có làm tròn và ngân hàng còn thu phí chuyển.
                        </p>
                    )}
                </Khoi>
            )}

            {/* ═══ ③ KỲ ĐANG MỞ ═══ */}
            {period && (
                <Khoi so="③" ten={`Kỳ chốt ${dmy(period.period_date)}`} phamVi="one" phu={shortFile(period.filename)}
                    phai={
                        <>
                            <div className="relative">
                                <select value={period.id} onChange={(e) => setPid(e.target.value)}
                                    className="appearance-none rounded-lg border border-border bg-card py-1 pl-2.5 pr-7 text-[12.5px] font-medium">
                                    {periods.map((p, i) => (
                                        <option key={p.id} value={p.id}>
                                            {i === 0 ? "★ " : ""}{shortFile(p.filename)} — chốt {dmy(p.period_date)}
                                        </option>
                                    ))}
                                </select>
                                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 opacity-60" />
                            </div>
                            <Nut onClick={exportForPartner}>
                                <Download className="mr-1 inline h-3.5 w-3.5" />Xuất file gửi 3PL
                            </Nut>
                        </>
                    }>
                    {period.luong ? (() => {
                        const l = period.luong;
                        const th = l.tien_hang;
                        return (
                            <>
                                <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-5">
                                    <Kpi label="Đơn trong sao kê" value={formatNumber(l.so_dong_sao_ke)}
                                        sub={`${period.orders_paid} đơn khớp sổ đơn`} />
                                    <Kpi label="Tiền COD" value={l.cod_twd != null ? TWD(l.cod_twd) : "—"} sub="NAZA thu trong kỳ" />
                                    <Kpi label="Phí NAZA trừ" value={RMB2(l.phi_thao_tac_rmb + l.phi_ship_rmb)}
                                        sub={l.phi_gop ? "ship + thao tác (gộp)" : `thao tác ${RMB2(l.phi_thao_tac_rmb)} · ship ${RMB2(l.phi_ship_rmb)}`} />
                                    <Kpi label="Tiền hàng" value={th.file ? VND(th.file.tong_vnd) : th.naza_tru_vnd != null ? VND(th.naza_tru_vnd) : "—"}
                                        sub={th.cach_tra === "naza_tru" ? "NAZA trừ vào COD"
                                            : (th.con_no_vnd ?? 0) > 0 ? `tự chuyển · còn nợ ${VND(th.con_no_vnd!)}` : "tự chuyển khoản riêng"}
                                        tone={(th.con_no_vnd ?? 0) > 0 ? "red" : undefined} />
                                    {l.phai_nhan_vnd == null && (l.rmb_rong ?? 0) < 0
                                        ? <Kpi label="Phải nhận" value={RMB2(l.rmb_rong!)} sub="âm → NAZA trừ vào kỳ sau" tone="red" />
                                        : <Kpi label="Phải nhận" value={l.phai_nhan_vnd != null ? VND(l.phai_nhan_vnd) : "—"}
                                            sub="sau khi trừ hết" tone="green" />}
                                </div>
                                <LuongTien l={l} />
                            </>
                        );
                    })() : (
                        <div className="px-4 py-3 text-[12.5px] text-muted-foreground">
                            Kỳ này không có sheet TỔNG của NAZA nên không dựng được luồng tiền.
                        </div>
                    )}
                    <MucSoat title="A · Soát bên trong file — tin được số trong đó không"
                        checks={checks.filter((c) => c.nhom === "A")} />
                    <MucSoat title="B · Soát file với đơn của mình — họ trả đủ và đúng chưa"
                        checks={checks.filter((c) => c.nhom === "B")} />
                </Khoi>
            )}

            {/* ═══ ④ TIỀN CÒN NẰM Ở NAZA — cộng dồn, không thuộc kỳ nào ═══ */}
            {pending.length > 0 && (
                <Khoi so="④" ten="Tiền còn nằm ở NAZA" phamVi="all" phu="không thuộc kỳ nào cả"
                    dem={TWD(pending.reduce((a, x) => a + x.cod_twd, 0))}>
                    {quaHan.length > 0 && (
                        <>
                            <div className="flex flex-wrap items-start gap-3 border-b border-border bg-rose-50 px-4 py-3 dark:bg-rose-500/10">
                                <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-rose-600 dark:text-rose-400" />
                                <div className="min-w-0 flex-1">
                                    <div className="font-semibold text-rose-800 dark:text-rose-300">
                                        {quaHan.length} đơn quá hạn — phải đòi
                                        <span className="ml-1.5 rounded bg-rose-600 px-1.5 font-mono text-[11px] font-bold text-white">
                                            {TWD(quaHan.reduce((a, x) => a + x.cod_twd, 0))}
                                        </span>
                                    </div>
                                    <p className="text-[12.5px] text-muted-foreground">
                                        Đã giao thành công, đã qua từ 2 kỳ sao kê mà vẫn chưa được trả đồng nào.
                                    </p>
                                </div>
                                <div className="flex flex-none flex-wrap gap-1.5">
                                    <Nut kieu="chinh" onClick={() => chep("q-vi", tinDoiTien(quaHan, "vi"))}>
                                        <Copy className="mr-1 inline h-3.5 w-3.5" />
                                        {copied === "q-vi" ? "Đã chép" : "Chép tin (Việt)"}
                                    </Nut>
                                    <Nut onClick={() => chep("q-zh", tinDoiTien(quaHan, "zh"))}>
                                        {copied === "q-zh" ? "Đã chép" : "中文"}
                                    </Nut>
                                    <Nut kieu="xong" busy={busy === "doi-me"} onClick={() => ghiDoiCaMe(quaHan)}>
                                        <Check className="mr-1 inline h-3.5 w-3.5" />Đã nhắn
                                    </Nut>
                                </div>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full min-w-[760px] text-[12.5px]">
                                    <thead className="border-b border-border text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                                        <tr>
                                            <th className="px-4 py-1.5 text-left">Mã đơn</th>
                                            <th className="px-3 py-1.5 text-left">Vận đơn</th>
                                            <th className="px-3 py-1.5 text-left">Khách</th>
                                            <th className="px-3 py-1.5 text-left">Điện thoại</th>
                                            <th className="px-3 py-1.5 text-right">Chờ</th>
                                            <th className="px-3 py-1.5 text-right">Tiền</th>
                                            <th className="px-3 py-1.5 text-left">Đã đòi</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                        {quaHan.map((p) => (
                                            <tr key={p.tracking || p.order_no}>
                                                <td className="px-4 py-1.5 font-semibold">{p.order_no}</td>
                                                <td className="px-3 py-1.5 font-mono text-[11px] text-indigo-700 dark:text-indigo-300">{p.tracking}</td>
                                                <td className="px-3 py-1.5">{p.contact_name || "—"}</td>
                                                <td className="px-3 py-1.5 font-mono text-[11px] text-violet-600/85">{p.phone || "—"}</td>
                                                <td className="px-3 py-1.5 text-right">
                                                    <span className="rounded bg-rose-600 px-1.5 font-mono text-[10px] font-bold text-white">{p.ky_da_qua} kỳ</span>
                                                </td>
                                                <td className="px-3 py-1.5 text-right font-mono font-bold tabular-nums">{TWD(p.cod_twd)}</td>
                                                <td className="px-3 py-1.5">
                                                    <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium",
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
                        <div className="border-t border-border">
                            <div className="flex flex-wrap items-start gap-3 px-4 py-3">
                                <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-emerald-500" />
                                <div className="min-w-0 flex-1">
                                    <div className="font-semibold">
                                        {dangCho.length} đơn đang chờ — bình thường, không phải làm gì
                                        <span className="ml-1.5 rounded bg-muted px-1.5 font-mono text-[11px] font-bold text-muted-foreground">
                                            {TWD(dangCho.reduce((a, x) => a + x.cod_twd, 0))}
                                        </span>
                                    </div>
                                    {/* Bản trước gộp cả nhóm này vào một dòng gọi là "sao kê bỏ sót 80 đơn",
                                        làm 76 đơn lành cũng trông như lỗi của NAZA. Phải nói rõ vì sao chưa cần lo. */}
                                    <p className="text-[12.5px] text-muted-foreground">
                                        {dangCho.filter((x) => x.ky_da_qua === 0).length} đơn chưa qua kỳ sao kê nào,{" "}
                                        {dangCho.filter((x) => x.ky_da_qua >= 1).length} đơn mới qua 1 kỳ.
                                        NAZA trả theo kỳ chứ không trả theo ngày, nên chừng nào chưa qua 2 kỳ thì chưa gọi là chậm.
                                    </p>
                                </div>
                                <Nut onClick={() => setMoCho((v) => !v)}>{moCho ? "Thu gọn" : "Xem danh sách"}</Nut>
                            </div>
                            {moCho && (
                                <div className="max-h-72 overflow-auto border-t border-border">
                                    <table className="w-full min-w-[560px] text-[12.5px]">
                                        <tbody className="divide-y divide-border">
                                            {dangCho.map((p) => (
                                                <tr key={p.tracking || p.order_no}>
                                                    <td className="px-4 py-1 font-semibold">{p.order_no}</td>
                                                    <td className="px-3 py-1 font-mono text-[11px] text-indigo-700 dark:text-indigo-300">{p.tracking}</td>
                                                    <td className="px-3 py-1">{p.contact_name || "—"}</td>
                                                    <td className="px-3 py-1 text-right text-[11px] text-muted-foreground">
                                                        {p.ky_da_qua === 0 ? "chưa qua kỳ nào" : `qua ${p.ky_da_qua} kỳ`}
                                                    </td>
                                                    <td className="px-4 py-1 text-right font-mono tabular-nums">{TWD(p.cod_twd)}</td>
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
                <Khoi so="⑤" ten="Tỷ giá đã lấy của mình bao nhiêu" phamVi="all">
                    <div className="grid gap-px bg-border sm:grid-cols-3">
                        <Kpi label="Thiệt vì tỷ giá" value={VND(fx.total_thiet_vnd)}
                            sub={`qua ${fx.rows.filter((r) => r.thiet_vnd != null).length} kỳ đã có sao kê`} tone="red" />
                        <Kpi label="Tỷ giá tốt nhất NAZA từng đặt"
                            value={fx.best_vnd_per_twd != null ? `${fx.best_vnd_per_twd.toFixed(2)}đ/NT$` : "—"}
                            sub={fx.best_period ? `kỳ chốt ${dmy(fx.best_period)}` : ""} />
                        <KpiTeNhat rows={fx.rows} />
                    </div>
                    <p className="border-b border-border px-4 py-2 text-[12px] text-muted-foreground">
                        Tỷ giá NAZA tự đặt và mình phải chịu, nên phần trăm lên xuống không giúp quyết định gì.
                        Bảng này trả lời đúng một câu: <b className="text-foreground">nó đã lấy của mình bao nhiêu tiền</b> —
                        lấy mốc là kỳ tốt nhất chính NAZA từng đặt, nên không cãi được là mốc quá đáng.
                        Tính trên tích cả hai chặng NT$ → ¥ → đ.
                    </p>
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[680px] text-[12.5px]">
                            <thead className="border-b border-border text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                                <tr>
                                    <th className="px-3 py-1.5 text-left">Kỳ chốt</th>
                                    <th className="px-3 py-1.5 text-right">TWD→RMB</th>
                                    <th className="px-3 py-1.5 text-right">RMB→VND</th>
                                    <th className="px-3 py-1.5 text-right">Đồng / NT$</th>
                                    <th className="px-3 py-1.5 text-right">Tiền COD</th>
                                    <th className="px-3 py-1.5 text-right">Thiệt so kỳ tốt nhất</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {fx.rows.map((r) => (
                                    <tr key={r.filename}
                                        className={cn(r.filename === period?.filename && "bg-sky-50/70 dark:bg-sky-500/[0.07]")}>
                                        <td className="px-3 py-1.5 font-mono tabular-nums">{dmy(r.period_date)}</td>
                                        <td className="px-3 py-1.5 text-right font-mono tabular-nums">{r.rate_twd_rmb ?? "—"}</td>
                                        <td className="px-3 py-1.5 text-right font-mono tabular-nums">{r.rate_rmb_vnd ?? "—"}</td>
                                        <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                                            {r.vnd_per_twd != null ? r.vnd_per_twd.toFixed(2) : "—"}
                                        </td>
                                        <td className="px-3 py-1.5 text-right font-mono tabular-nums">{TWD(r.cod_twd)}</td>
                                        <td className="px-3 py-1.5 text-right">
                                            {r.thiet_vnd == null ? <span className="text-muted-foreground">—</span>
                                                : r.tot_nhat ? (
                                                    <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
                                                        tốt nhất
                                                    </span>
                                                ) : (
                                                    <span className="font-mono font-semibold tabular-nums text-rose-600 dark:text-rose-400">
                                                        −{VND(r.thiet_vnd)}
                                                    </span>
                                                )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </Khoi>
            )}
        </div>
    );
}

/* ═══════════════════════ mảnh dùng lại ═══════════════════════ */

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
        <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <header className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
                <span className="flex h-5 w-5 flex-none items-center justify-center rounded-md bg-orange-500 font-mono text-[11px] font-bold text-white">
                    {so}
                </span>
                <span className="text-sm font-semibold">{ten}</span>
                {dem && (
                    <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[11px] font-bold text-muted-foreground">
                        {dem}
                    </span>
                )}
                {phu && <span className="text-[12px] text-muted-foreground">· {phu}</span>}
                <div className="ml-auto flex flex-wrap items-center gap-2">
                    {phai}
                    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                        phamVi === "one"
                            ? "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300"
                            : "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300")}>
                        {phamVi === "one" ? "chỉ kỳ này" : "cộng dồn mọi kỳ"}
                    </span>
                </div>
            </header>
            {children}
        </section>
    );
}

function Nut({ children, onClick, kieu, busy }: {
    children: React.ReactNode; onClick?: () => void;
    kieu?: "chinh" | "xong"; busy?: boolean;
}) {
    return (
        <button onClick={onClick} disabled={busy}
            className={cn("whitespace-nowrap rounded-lg px-3 py-1.5 text-[12.5px] font-medium disabled:opacity-50",
                kieu === "chinh" ? "bg-orange-500 text-white hover:bg-orange-600"
                    : kieu === "xong" ? "border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300"
                        : "border border-border hover:bg-muted")}>
            {busy ? "Đang ghi…" : children}
        </button>
    );
}

const RMB2 = (n: number) => `${n.toLocaleString("vi-VN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}¥`;

/**
 * Thang luồng tiền — chép đúng thứ tự sheet TỔNG của NAZA, để người đọc đặt cạnh
 * file NAZA gửi mà dò từng dòng. Mỗi dòng một phép tính, cộng trừ ra đúng số ở
 * dòng cuối.
 */
function LuongTien({ l }: { l: Luong }) {
    const th = l.tien_hang;
    const buoc: { nhan: string; so: string; cham?: boolean; dam?: boolean; ghi?: string }[] = [
        { nhan: "Tổng COD thu về", so: l.cod_twd != null ? TWD(l.cod_twd) : "—" },
        { nhan: `× tỷ giá ${l.ty_gia_twd_rmb ?? "—"}`, so: l.rmb != null ? RMB2(l.rmb) : "—", cham: true },
        { nhan: "− phí thao tác", so: l.phi_gop ? "(gộp vào phí ship)" : RMB2(-l.phi_thao_tac_rmb), cham: true },
        { nhan: "− phí vận chuyển", so: RMB2(-l.phi_ship_rmb), cham: true },
        { nhan: "= COD còn lại", so: l.rmb_rong != null ? RMB2(l.rmb_rong) : "—", dam: true },
        l.vnd == null && (l.rmb_rong ?? 0) < 0
            ? { nhan: "× tỷ giá RMB→VND", so: "không quy đổi", cham: true, ghi: "số âm — NAZA mang sang trừ kỳ sau" }
            : { nhan: `× tỷ giá ${l.ty_gia_rmb_vnd != null ? l.ty_gia_rmb_vnd.toLocaleString("vi-VN") : "—"}`,
                so: l.vnd != null ? VND(l.vnd) : "—", cham: true },
        th.cach_tra === "naza_tru"
            ? { nhan: "− phí mua hàng", so: VND(-th.trong_luong_vnd), cham: true,
                ghi: th.lech_naza_vnd && Math.abs(th.lech_naza_vnd) >= 1
                    ? `theo file tiền hàng · NAZA ghi ${VND(th.naza_tru_vnd!)}` : th.file ? `đợt ${th.file.ngay.slice(8, 10)}/${th.file.ngay.slice(5, 7)}` : "theo sao kê NAZA" }
            : { nhan: "− phí mua hàng", so: "không trừ", cham: true,
                ghi: th.file ? `tự chuyển khoản riêng ${VND(th.file.tong_vnd)}` : "kỳ này NAZA không trừ" },
    ];
    const chenhChuyenKy = l.vnd != null && l.phai_nhan_vnd != null
        ? l.phai_nhan_vnd - (l.vnd - (th.cach_tra === "naza_tru" ? th.trong_luong_vnd : 0)) : 0;
    if (Math.abs(chenhChuyenKy) >= 1) {
        buoc.push({ nhan: "± điều chỉnh kỳ trước", so: VND(chenhChuyenKy), cham: true, ghi: "NAZA mang số âm kỳ trước sang" });
    }
    return (
        <div className="border-t border-border px-4 py-3">
            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                Luồng tiền kỳ này — theo sheet TỔNG của NAZA
            </div>
            <table className="w-full max-w-xl text-[12.5px]">
                <tbody>
                    {buoc.map((b, i) => (
                        <tr key={i} className={cn(b.dam && "border-t border-border/60")}>
                            <td className={cn("py-0.5 pr-4", b.cham && "pl-4 text-muted-foreground", b.dam && "font-semibold")}>{b.nhan}</td>
                            <td className={cn("py-0.5 text-right font-mono tabular-nums", b.dam && "font-semibold")}>{b.so}</td>
                            <td className="py-0.5 pl-3 text-[11px] text-muted-foreground">{b.ghi}</td>
                        </tr>
                    ))}
                    <tr className="border-t-2 border-foreground/30">
                        <td className="py-1 pr-4 font-bold">= Phải nhận</td>
                        <td className={cn("py-1 text-right font-mono font-bold tabular-nums",
                            l.phai_nhan_vnd != null ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
                            {l.phai_nhan_vnd != null ? VND(l.phai_nhan_vnd) : (l.rmb_rong ?? 0) < 0 ? "0đ — trừ kỳ sau" : "—"}
                        </td>
                        <td />
                    </tr>
                </tbody>
            </table>
            {th.file && th.cach_tra === "tu_chuyen" && (
                <div className="mt-2 text-[11.5px] text-muted-foreground">
                    Tiền hàng đợt {th.file.ngay.slice(8, 10)}/{th.file.ngay.slice(5, 7)}: {VND(th.file.tong_vnd)} · đã trả {VND(th.da_tra_vnd ?? 0)}
                    {(th.con_no_vnd ?? 0) > 0 && <span className="font-semibold text-rose-600 dark:text-rose-400"> · còn nợ {VND(th.con_no_vnd!)}</span>}
                    {th.file.no_ky_truoc_vnd > 0 && <> · gồm {VND(th.file.no_ky_truoc_vnd)} nợ kỳ trước</>}
                </div>
            )}
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
    const dong: { nhan: string; phu: string; don: string; cod: string; vnd: string; tone?: "green" | "amber" }[] = [
        {
            nhan: "NAZA đã gửi về",
            phu: `theo số phải trả trên ${t.so_ky} kỳ sao kê` + (t.ky_da_doi_chieu_bank === 0 ? " · chưa kỳ nào đối chiếu ngân hàng" : ` · ${t.ky_da_doi_chieu_bank} kỳ đã đối chiếu ngân hàng`)
                + (Math.abs(t.phai_nhan_theo_file_vnd - t.da_gui_ve_vnd) >= 1
                    ? ` · theo file tiền hàng lẽ ra ${VND(t.phai_nhan_theo_file_vnd)} (NAZA ${t.phai_nhan_theo_file_vnd > t.da_gui_ve_vnd ? "trừ dư" : "trừ thiếu"} ${VND(Math.abs(t.phai_nhan_theo_file_vnd - t.da_gui_ve_vnd))})`
                    : ""),
            don: "—", cod: "—", vnd: VND(t.da_gui_ve_vnd), tone: "green",
        },
        {
            nhan: "Còn phải gửi — đơn đã giao thành công",
            phu: `${t.con_lai_da_giao.don_chua_tru_phi} đơn chưa bị trừ phí ship`,
            don: formatNumber(t.con_lai_da_giao.so_don), cod: TWD(t.con_lai_da_giao.cod_twd),
            vnd: t.con_lai_da_giao.vnd_uoc != null ? `≈ ${VND(t.con_lai_da_giao.vnd_uoc)}` : "—", tone: "amber",
        },
        {
            nhan: "Còn phải gửi — tất cả đơn còn lại",
            phu: `trừ ${t.khong_tinh.hoan} đơn hoàn + ${t.khong_tinh.huy} đơn huỷ (${TWD(t.khong_tinh.cod_twd)}) vì không bao giờ trả tiền`,
            don: formatNumber(t.con_lai_tat_ca.so_don), cod: TWD(t.con_lai_tat_ca.cod_twd),
            vnd: t.con_lai_tat_ca.vnd_uoc != null ? `≈ ${VND(t.con_lai_tat_ca.vnd_uoc)}` : "—", tone: "amber",
        },
    ];
    return (
        <Khoi so="Σ" ten="Tiền về" phamVi="all" phu="NAZA đã gửi bao nhiêu, còn phải gửi bao nhiêu">
            <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-[12.5px]">
                    <thead className="border-b border-border text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                        <tr>
                            <th className="px-4 py-1.5 text-left">Khoản</th>
                            <th className="px-3 py-1.5 text-right">Đơn</th>
                            <th className="px-3 py-1.5 text-right">COD</th>
                            <th className="px-4 py-1.5 text-right">Tiền về (VND)</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {dong.map((d) => (
                            <tr key={d.nhan}>
                                <td className="px-4 py-2">
                                    <div className="font-medium">{d.nhan}</div>
                                    <div className="text-[11px] text-muted-foreground">{d.phu}</div>
                                </td>
                                <td className="px-3 py-2 text-right font-mono tabular-nums">{d.don}</td>
                                <td className="px-3 py-2 text-right font-mono tabular-nums">{d.cod}</td>
                                <td className={cn("px-4 py-2 text-right font-mono text-[14px] font-semibold tabular-nums",
                                    d.tone === "green" && "text-emerald-600 dark:text-emerald-400",
                                    d.tone === "amber" && "text-amber-600 dark:text-amber-400")}>{d.vnd}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div className="border-t border-border px-4 py-2 text-[11px] leading-relaxed text-muted-foreground">
                Số dự tính đi đúng luồng NAZA: COD × {gia} − phí. Đơn đã bị NAZA trừ phí ship ở kỳ trước thì không trừ lại;
                đơn chưa bị trừ thì trừ phí ship theo bảng giá kênh giao (kg đầu) + phí thao tác.
                <b className="text-foreground"> Chưa trừ tiền hàng các kỳ tới</b> — chưa biết trước được.
                {t.tien_hang.loi && <span className="text-rose-600 dark:text-rose-400"> {t.tien_hang.loi}</span>}
            </div>
        </Khoi>
    );
}

function Kpi({ label, value, sub, tone }: {
    label: string; value: string; sub?: string; tone?: "green" | "red";
}) {
    return (
        <div className="bg-card px-4 py-2.5">
            <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</div>
            <div className={cn("font-mono text-[17px] font-semibold tabular-nums",
                tone === "green" && "text-emerald-600 dark:text-emerald-400",
                tone === "red" && "text-rose-600 dark:text-rose-400")}>{value}</div>
            {sub && <div className="text-[11.5px] text-muted-foreground">{sub}</div>}
        </div>
    );
}

function KpiTeNhat({ rows }: { rows: FxRow[] }) {
    const w = rows.filter((r) => r.thiet_vnd != null && !r.tot_nhat)
        .sort((a, b) => (b.thiet_vnd ?? 0) - (a.thiet_vnd ?? 0))[0];
    return (
        <Kpi label="Kỳ tệ nhất" value={w ? VND(w.thiet_vnd ?? 0) : "—"}
            sub={w ? `kỳ chốt ${dmy(w.period_date)}` : "chưa đủ kỳ để so"} />
    );
}

function TrangThai({ p }: { p: Period }) {
    const style: Record<PeriodState, string> = {
        khop: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
        lech: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
        cho_nhap: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
        thieu_file: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
    };
    return (
        <span className={cn("inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold",
            style[p.trang_thai])}>
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
    return (
        <div className="flex items-center justify-end gap-1">
            <input autoFocus inputMode="numeric" value={so}
                placeholder={goiY != null ? Math.round(goiY).toLocaleString("vi-VN") : "số tiền"}
                onChange={(e) => setSo(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === "Enter" && num > 0) onGhi(num, ngay);
                    if (e.key === "Escape") onHuy();
                }}
                className="w-28 rounded-md border border-border bg-card px-2 py-0.5 text-right font-mono text-[11.5px]" />
            <input type="date" value={ngay} max={format(new Date(), "yyyy-MM-dd")}
                onChange={(e) => setNgay(e.target.value)}
                className="rounded-md border border-border bg-card px-1.5 py-0.5 font-mono text-[11px]" />
            <button disabled={busy || !(num > 0)} onClick={() => onGhi(num, ngay)}
                className="rounded-md bg-orange-500 px-2 py-1 text-white disabled:opacity-40">
                <Check className="h-3.5 w-3.5" />
            </button>
            <button onClick={onHuy} className="rounded-md border border-border px-1.5 py-1">
                <X className="h-3.5 w-3.5" />
            </button>
        </div>
    );
}

function MucSoat({ title, checks }: { title: string; checks: Check[] }) {
    if (!checks.length) return null;
    const xau = checks.filter((c) => c.ok === false).length;
    return (
        <>
            <div className="flex items-center gap-2 border-t border-border px-4 pb-1 pt-2.5">
                <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{title}</span>
                <span className={cn("rounded px-1.5 text-[11px] font-bold",
                    xau ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
                        : "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300")}>
                    {xau ? `${xau} mục cần xử` : "sạch"}
                </span>
            </div>
            {checks.map((c) => (
                <div key={c.ten} className="flex items-start gap-2.5 px-4 py-1.5">
                    <span className={cn("mt-0.5 flex h-[17px] w-[17px] flex-none items-center justify-center rounded-md text-[11px] font-bold",
                        c.ok === true ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                            : c.ok === false ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
                                : "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300")}>
                        {c.ok === true ? "✓" : c.ok === false ? "!" : "i"}
                    </span>
                    <div className="min-w-0">
                        <div className="text-[13px] font-semibold">{c.ten}</div>
                        <div className="text-[12.5px] text-muted-foreground">{c.chi_tiet}</div>
                    </div>
                </div>
            ))}
        </>
    );
}

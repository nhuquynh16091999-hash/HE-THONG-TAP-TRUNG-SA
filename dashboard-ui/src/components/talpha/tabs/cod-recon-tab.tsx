"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { format } from "date-fns";
import {
    Upload, AlertTriangle, Download, Copy, CheckCircle2, ChevronDown, Check, X,
    FileSpreadsheet, Landmark, ArrowRight, ArrowDown, Info,
    CalendarDays, Layers, ReceiptText, BadgeCheck, SearchCheck, PenLine,
    type LucideIcon,
} from "lucide-react";
import {
    ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from "recharts";
import TabSkeleton, { ErrorState } from "@/components/ui/tab-skeleton";
import { formatNumber, cn } from "../utils";
import { TWD, VND, type DonChoTien } from "./ledger-shared";
import ThanhNhapBangDon, { bangDaCu, nhanNapGon, type NhapBangDon } from "@/components/talpha/nhap-bang-don";
import { useManHep } from "./so-don-ui";

interface Props { dateRange?: { from: Date; to: Date }; projectId?: string }

/* ═══════════════════════════════════════════════════════════════════
   TIỀN COD VỀ (mục Kế toán) — MỘT QUY TRÌNH, KHÔNG PHẢI MỘT ĐỐNG KẾT QUẢ KIỂM TRA

   07/10/2026 Sỹ Anh chốt tách mục KẾ TOÁN: tab này (tên cũ "Đối soát COD") + Thanh toán
   quảng cáo. Leader nước đó và giám đốc kiểm soát chung — leader xem, tải sao kê, nhập tiền
   về. Phần đòi NAZA tiền đơn quá hạn (khối ④ cũ) chuyển sang Sổ đơn hàng: đó là việc
   theo từng đơn, cần tên khách + số điện thoại ngay cạnh, và sale cũng phải làm được.

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
     ④  tỷ giá              — nó đã lấy của mình bao nhiêu tiền
     (đơn quá hạn phải đòi  — khung "Đòi tiền NAZA" ở Sổ đơn hàng)

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
        /** Tổng tiền hàng trừ trong luồng = Đài (theo file) + Sing (kỳ gộp, theo NAZA). */
        trong_luong_vnd: number;
        dai_vnd?: number;
        /** Tiền hàng Sing NAZA trừ vào COD Đài — chỉ kỳ gộp 24/09/2026. */
        sing_vnd?: number | null;
        lech_naza_vnd: number | null;
        da_tra_vnd: number | null;
        con_no_vnd: number | null;
    };
    phai_nhan_vnd: number | null;
    /** Phần Singapore NAZA gộp vào kỳ (chỉ kỳ 24/09/2026). */
    sg_gop?: { don: number; phi_rmb: number; phi_vnd: number | null; tien_hang_vnd: number | null; tong_vnd: number | null } | null;
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
type Pending = DonChoTien;
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

/**
 * Nút chọn nước (Sỹ Anh chốt 26/09/2026): Đài Loan giữ nguyên toàn bộ quy trình sao kê NAZA;
 * Singapore, UAE có phần "tiền còn ở đâu" + tải sao kê khớp từng đơn (CodNuocKhac, 08/10/2026). Danh sách nước
 * lấy từ /api/talpha/markets — không gõ cứng ở giao diện.
 *
 * Phân quyền theo team (05/10/2026): danh sách chỉ còn nước của team, nên chờ có danh sách rồi
 * mới dựng màn và mở ở nước đầu tiên được xem (xem cùng chỗ ở order-ledger-tab.tsx).
 */
export default function TALPHACodReconTab(props: Props) {
    const [nuoc, setNuoc] = useState("TW");
    const [ds, setDs] = useState<{ code: string; display: string }[] | null>(null);
    useEffect(() => {
        fetch("/api/talpha/markets").then((r) => r.json())
            .then((d: { markets?: { code: string; display: string; status?: string }[] }) => {
                const list = (d.markets || []).filter((m) => m.status !== "sap_chay").map((m) => ({ code: m.code, display: m.display }));
                setDs(list);
                setNuoc((n) => (list.length && !list.some((m) => m.code === n) ? list[0].code : n));
            })
            .catch(() => setDs([]));   // không lấy được danh sách nước thì vẫn hiện màn Đài như cũ
    }, []);
    if (ds === null) return <TabSkeleton />;
    // Nút chọn nước nằm CÙNG hàng với thanh công cụ (07/10/2026, cùng kiểu Sổ đơn hàng).
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
        ? <CodDaiLoan {...props} nutNuoc={nutNuoc} />
        : <CodNuocKhac key={nuoc} code={nuoc} nutNuoc={nutNuoc} />;
}

/** Hàng đầu tab: chọn nước · nguồn số (chữ nhỏ) · nút bên phải. */
function ThanhDau({ nutNuoc, nguon, phai }: { nutNuoc?: ReactNode; nguon?: ReactNode; phai?: ReactNode }) {
    return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {nutNuoc}
            {nguon && <span className="text-xs leading-relaxed text-muted-foreground">{nguon}</span>}
            {phai && <div className="flex w-full items-center gap-2 md:ml-auto md:w-auto">{phai}</div>}
        </div>
    );
}

/** Ô số tiền gọn (thay ba thẻ to + banner ngân hàng): nhãn · số · một dòng phụ. */
const O_MAU = {
    xanh: "text-emerald-600 dark:text-emerald-400",
    vang: "text-amber-600 dark:text-amber-400",
    cam: "text-orange-600 dark:text-orange-400",
    xanhduong: "text-sky-700 dark:text-sky-300",
    do: "text-rose-600 dark:text-rose-400",
} as const;
function OSoTien({ mau, nhan, so, phu, uoc, className }: {
    mau: keyof typeof O_MAU; nhan: string; so: string; phu?: ReactNode; uoc?: boolean; className?: string;
}) {
    return (
        <div className={cn("min-w-0 rounded-xl border border-border bg-card px-3 py-2.5 shadow-sm md:px-4 md:py-3", className)}>
            <div className="text-[11.5px] font-medium leading-snug text-muted-foreground">{nhan}</div>
            <div className={cn("mt-1 whitespace-nowrap text-[19px] font-extrabold leading-tight tracking-tight tabular-nums md:text-[22px]", O_MAU[mau])}>
                {uoc && <span className="mr-0.5 text-[0.75em] font-bold opacity-60">≈</span>}{so}
            </div>
            {phu && <div className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">{phu}</div>}
        </div>
    );
}

type KhoanNuoc = { so_don: number; cod_local: number; vnd_uoc: number | null };
type DonNuoc = {
    order_id: string; tracking: string; order_date: string | null; trang_thai: string;
    nhom: "da_giao" | "chua_giao" | "khong_tinh"; cod_local: number; khach: string;
    /** Đơn đã thấy trên một kỳ sao kê (08/10/2026). */
    da_tra?: { ky: string; so_tien: number };
};
type KyNuoc = {
    id: string; filename: string; uploaded_at: string; kieu: "naza" | "bang"; ngay: string | null;
    so_dong: number; cod_local: number; phai_nhan_vnd: number | null; uoc_vnd: number | null;
    khop: number; lech: number; khong_co_don: number;
    cot?: Partial<Record<"tracking" | "order_id" | "amount" | "fee" | "paid_date" | "status", string>>;
    canh_bao: string[];
};
type NuocData = {
    market: { code: string; display: string; currency: string; symbol: string; rate_vnd: number };
    nguon: { loai: "doi_tac" | "weship" | "pos"; nhan: string; cap_nhat: string | null };
    sao_ke: number;
    tong: {
        da_giao: KhoanNuoc;
        chua_giao: KhoanNuoc & { theo_trang_thai: { trang_thai: string; so_don: number; cod_local: number }[] };
        khong_tinh: KhoanNuoc & { hoan: number; huy: number; tieu_huy: number };
    };
    da_tra?: { so_don: number; cod_local: number };
    da_gui_ve?: { vnd: number; co_uoc: boolean; cod_local: number; so_ky: number };
    ky?: KyNuoc[];
    lech?: { order_id: string; tracking: string; cod_don: number; tra: number; ky: string }[];
    khong_co_don?: { order_id: string; tracking: string; so_tien: number; ky: string }[];
    tra_hai_lan?: { order_id: string; tracking: string; ky: string[] }[];
    don: DonNuoc[];
};

const TEN_COT: Record<string, string> = { tracking: "mã vận đơn", order_id: "mã đơn", amount: "tiền", paid_date: "ngày" };
const tenKy = (f: string) => f.replace(/\.(xlsx|csv|tsv|txt)$/i, "").trim() || f;

/**
 * Tiền COD về nước ngoài Đài.
 *   Bước 1 (26/09/2026): chưa có sao kê nên chỉ trả lời "tiền còn ở đâu" — đã giao (bên giao hàng
 *   đang giữ) · chưa giao (ngoài đường) · không tính (hoàn, huỷ).
 *   Bước 2 (08/10/2026, Sỹ Anh: "Singapore và UAE không có chỗ up file giống Đài à"): nút tải
 *   sao kê + kéo thả như Đài, kho riêng từng nước. Mỗi kỳ tải lên được khớp với đơn: đơn có trên
 *   sao kê ra khỏi "còn phải gửi"; trả lệch số / trả cho đơn mình không có / trả hai lần thì hiện
 *   ở khung "Khoản cần hỏi". Chưa có luồng tỷ giá + nhập tiền ngân hàng như Đài — chờ file thật
 *   đầu tiên để biết đối tác các nước tính tiền thế nào.
 */
function CodNuocKhac({ code, nutNuoc }: { code: string; nutNuoc?: ReactNode }) {
    const [d, setD] = useState<NuocData | null>(null);
    const hep = useManHep();
    const [err, setErr] = useState("");
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [upErr, setUpErr] = useState("");
    const [upOk, setUpOk] = useState("");
    const [keo, setKeo] = useState(false);
    const [xoa, setXoa] = useState("");
    const fileRef = useRef<HTMLInputElement>(null);
    const load = useCallback(async () => {
        setLoading(true); setErr("");
        try {
            const res = await fetch(`/api/talpha/cod-recon/market?market=${code}`);
            const j = await res.json();
            if (!res.ok) throw new Error(j.error || "Không tải được đơn");
            setD(j);
        } catch (e) {
            setErr(e instanceof Error ? e.message : "Lỗi không rõ");
        } finally { setLoading(false); }
    }, [code]);
    useEffect(() => { load(); }, [load]);

    const upload = async (f: File) => {
        setUploading(true); setUpErr(""); setUpOk("");
        try {
            const fd = new FormData(); fd.append("file", f);
            const res = await fetch(`/api/talpha/cod-recon/market?market=${code}`, { method: "POST", body: fd });
            const j = await res.json();
            if (!res.ok) throw new Error(j.error || "Tải lên thất bại");
            const s = j.statement as { filename: string; so_dong: number; kieu: string; cot?: Record<string, string> };
            const cot = s.cot ? Object.entries(s.cot).filter(([k]) => TEN_COT[k]).map(([k, v]) => `${TEN_COT[k]} = “${v}”`).join(", ") : "";
            const thay = (j.thay as string[] | undefined)?.length ? ` Đã THAY bản cũ cùng kỳ: ${(j.thay as string[]).map((x) => `“${x}”`).join(", ")}.` : "";
            setUpOk(`Đã đọc ${formatNumber(s.so_dong)} dòng từ “${s.filename}”${s.kieu === "naza" ? " (mẫu NAZA)" : cot ? ` — cột ${cot}` : ""}.${thay}` +
                ((j.canh_bao as string[] | undefined)?.length ? ` ${(j.canh_bao as string[]).join(" ")}` : ""));
            await load();
        } catch (e) {
            setUpErr(e instanceof Error ? e.message : "Tải lên thất bại");
        } finally {
            setUploading(false);
            if (fileRef.current) fileRef.current.value = "";
        }
    };

    const xoaKy = async (k: KyNuoc) => {
        if (!window.confirm(`Xoá kỳ “${k.filename}”? Đơn của kỳ này quay về “còn phải gửi”.`)) return;
        setXoa(k.id); setUpErr(""); setUpOk("");
        try {
            const res = await fetch(`/api/talpha/cod-recon/market?market=${code}&statement=${encodeURIComponent(k.id)}`, { method: "DELETE" });
            if (!res.ok) {
                const j = await res.json().catch(() => ({}));
                setUpErr((j as { error?: string }).error || "Không xoá được kỳ này");
                return;
            }
            await load();
        } finally { setXoa(""); }
    };

    if (loading && !d) return <div className="space-y-4">{nutNuoc}<TabSkeleton cards={3} rows={6} showChart={false} /></div>;
    if (err || !d) return <div className="space-y-4">{nutNuoc}<ErrorState message={err || "Không tải được đơn"} onRetry={load} /></div>;

    const m = d.market, t = d.tong;
    const tien = (n: number) => `${(Math.round(n * 100) / 100).toLocaleString("vi-VN")} ${m.symbol}`;
    const COD = "text-sky-700 dark:text-sky-300";
    const gia = m.rate_vnd > 0 ? `${m.rate_vnd.toLocaleString("vi-VN")}đ/${m.currency}` : "chưa khai tỷ giá";
    const ky = d.ky || [];
    const gv = d.da_gui_ve;
    const lech = d.lech || [], khong = d.khong_co_don || [], trung = d.tra_hai_lan || [];
    const soCanHoi = lech.length + khong.length + trung.length;
    // Đã có sao kê thì bảng này chỉ còn đơn CHƯA thấy trên kỳ nào — tiền còn phải đòi.
    const daGiao = d.don.filter((x) => x.nhom === "da_giao" && !x.da_tra);
    const capNhat = d.nguon.cap_nhat ? (() => {
        const x = new Date(d.nguon.cap_nhat);
        const p = (n: number) => String(n).padStart(2, "0");
        return `${p(x.getHours())}:${p(x.getMinutes())} ngày ${p(x.getDate())}/${p(x.getMonth() + 1)}`;
    })() : null;
    let stt = 0;
    const so = () => String(++stt);

    const oPhaiNhan = (k: KyNuoc) => k.phai_nhan_vnd != null ? (
        <span className="font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{VND(k.phai_nhan_vnd)}</span>
    ) : k.uoc_vnd != null ? (
        <span className="font-semibold tabular-nums text-amber-600 dark:text-amber-400" title={`Sao kê không ghi số phải nhận — ước = tiền COD × ${gia}, chưa trừ phí`}>
            ≈ {VND(k.uoc_vnd)}
        </span>
    ) : <span className="text-muted-foreground">—</span>;
    const oKhop = (k: KyNuoc) => (
        <span className="inline-flex flex-wrap items-center justify-end gap-x-2 gap-y-0.5 text-[12px] tabular-nums">
            <span className="font-semibold text-emerald-700 dark:text-emerald-400">{k.khop} khớp</span>
            {k.lech > 0 && <span className="font-semibold text-rose-600 dark:text-rose-400">{k.lech} lệch</span>}
            {k.khong_co_don > 0 && <span className="font-semibold text-amber-600 dark:text-amber-400">{k.khong_co_don} không có đơn</span>}
        </span>
    );
    // File không ghi ngày (tên lẫn dòng) thì lấy ngày tải lên — vẫn phân biệt được các kỳ.
    const ngayHien = (k: KyNuoc) => k.ngay ? dmy(k.ngay) : `tải ${dmy(format(new Date(k.uploaded_at), "yyyy-MM-dd"))}`;
    const cotDoc = (k: KyNuoc) => k.kieu === "naza" ? "mẫu NAZA"
        : k.cot ? Object.entries(k.cot).filter(([c]) => TEN_COT[c]).map(([c, v]) => `${TEN_COT[c]}: ${v}`).join(" · ") : "";
    const nutXoa = (k: KyNuoc) => (
        <button onClick={() => xoaKy(k)} disabled={xoa === k.id} title="Xoá kỳ này (tải nhầm file)"
            className="grid h-7 w-7 flex-none place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40 dark:hover:bg-rose-500/10 dark:hover:text-rose-400">
            <X className="h-4 w-4" />
        </button>
    );

    return (
        // Kéo file sao kê thả vào bất cứ đâu trên màn — như màn Đài.
        <div className="relative space-y-3 md:space-y-4"
            onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); if (!keo) setKeo(true); } }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setKeo(false); }}
            onDrop={(e) => {
                if (!e.dataTransfer.files?.length) return;
                e.preventDefault(); setKeo(false);
                upload(e.dataTransfer.files[0]);
            }}>
            {keo && (
                <div className="pointer-events-none absolute inset-0 z-30 grid place-items-start justify-center rounded-2xl border-2 border-dashed border-orange-400 bg-orange-50/85 pt-24 dark:bg-orange-500/15">
                    <div className="flex items-center gap-2 rounded-xl bg-card px-4 py-3 text-[15px] font-bold text-orange-700 shadow-lg dark:text-orange-300">
                        <FileSpreadsheet className="h-5 w-5" />Thả file sao kê {m.display} để tải lên
                    </div>
                </div>
            )}
            <input ref={fileRef} type="file" accept=".xlsx,.csv,.tsv,.txt" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />

            <ThanhDau nutNuoc={nutNuoc}
                nguon={<>
                    {ky.length ? `${ky.length} kỳ sao kê · mới nhất “${tenKy(ky[0].filename)}” · ` : ""}
                    Đơn {m.display}: {d.nguon.nhan}{capNhat ? ` · ${d.nguon.loai === "weship" ? "tra" : "nạp"} lúc ${capNhat}` : ""}
                </>}
                phai={<>
                    <span className="hidden text-[11.5px] text-muted-foreground lg:inline">hoặc kéo thả file .xlsx · .csv vào màn</span>
                    <span title={`Sao kê COD của bên giao hàng ${m.display}: file NAZA, hoặc bảng .xlsx/.csv có cột mã vận đơn (hoặc mã đơn) + tiền COD. Tải lại cùng một kỳ thì THAY, không cộng thêm.`}>
                        <Nut kieu="chinh" busy={uploading} busyText="Đang đọc và khớp…" onClick={() => fileRef.current?.click()}>
                            <Upload className="h-4 w-4" />Tải sao kê {m.display}
                        </Nut>
                    </span>
                </>} />
            {upErr && (
                <p className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />{upErr}
                </p>
            )}
            {upOk && (
                <p className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-[13px] text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none" />{upOk}
                </p>
            )}

            {/* Ba ô số, cùng thứ tự màn Đài: đã gửi về · còn phải gửi · chưa giao xong. */}
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
                <OSoTien mau="xanh" uoc={!!gv?.co_uoc} nhan="Bên giao hàng đã gửi về" className="col-span-2 lg:col-span-1"
                    so={ky.length && gv ? VND(gv.vnd) : "—"}
                    phu={ky.length && gv ? `${formatNumber(ky.length)} kỳ sao kê · ${tien(gv.cod_local)}` : "chưa có sao kê nào"} />
                <OSoTien mau="vang" uoc nhan="Còn phải gửi · đơn đã giao"
                    so={t.da_giao.vnd_uoc != null ? VND(t.da_giao.vnd_uoc) : "—"}
                    phu={`${formatNumber(t.da_giao.so_don)} đơn · ${tien(t.da_giao.cod_local)}`} />
                <OSoTien mau="cam" uoc nhan="Chưa giao xong"
                    so={t.chua_giao.vnd_uoc != null ? VND(t.chua_giao.vnd_uoc) : "—"}
                    phu={`${formatNumber(t.chua_giao.so_don)} đơn · ${tien(t.chua_giao.cod_local)}`} />
            </div>
            <p className="flex items-start gap-2 text-[12px] leading-relaxed text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 flex-none" />
                <span>
                    {ky.length ? (
                        <>
                            Đã khớp <b className="font-semibold text-foreground">{formatNumber(d.da_tra?.so_don ?? 0)} đơn</b> với {ky.length} kỳ sao kê —
                            “còn phải gửi” chỉ còn đơn đã giao chưa thấy trên kỳ nào.
                            {gv?.co_uoc ? ` Kỳ nào sao kê không ghi số phải nhận thì “đã gửi về” ước = tiền COD × ${gia}, chưa trừ phí.` : " “Đã gửi về” là số phải nhận ghi trên sao kê."}
                            {" "}Hai ô còn lại quy VND theo tỷ giá {gia}, <b className="font-semibold text-foreground">chưa trừ phí ship và phí thu hộ</b>.
                        </>
                    ) : (
                        <>
                            Chưa có sao kê của bên giao hàng {m.display} — bấm <b className="font-semibold text-foreground">Tải sao kê {m.display}</b> để khớp từng đơn như Đài Loan.
                            Số VND quy theo tỷ giá {gia}, <b className="font-semibold text-foreground">chưa trừ phí ship và phí thu hộ</b>.
                        </>
                    )}
                    {" "}Đã bỏ {t.khong_tinh.hoan} đơn hoàn + {t.khong_tinh.huy} đơn huỷ{t.khong_tinh.tieu_huy ? ` + ${t.khong_tinh.tieu_huy} đơn tiêu huỷ` : ""} ({tien(t.khong_tinh.cod_local)}) vì không bao giờ trả tiền.
                </span>
            </p>

            {/* ═══ Các kỳ sao kê đã tải ═══ */}
            {ky.length > 0 && (
                <Khoi so={so()} ten={`${ky.length} kỳ sao kê`} phamVi="all" phu="tải lại cùng một kỳ thì thay, không cộng thêm · tải nhầm thì bấm ✕">
                    {hep ? (
                        <ul className="divide-y divide-border/60">
                            {ky.map((k) => (
                                <li key={k.id} className="px-3.5 py-3">
                                    <div className="flex items-center gap-2">
                                        <b className="tabular-nums text-foreground">{ngayHien(k)}</b>
                                        <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted-foreground">{tenKy(k.filename)}</span>
                                        {nutXoa(k)}
                                    </div>
                                    <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12.5px]">
                                        <div>
                                            <div className="text-[11px] text-muted-foreground">Tiền COD · {k.so_dong} đơn</div>
                                            <div className={cn("font-semibold tabular-nums", COD)}>{tien(k.cod_local)}</div>
                                        </div>
                                        <div>
                                            <div className="text-[11px] text-muted-foreground">Phải nhận</div>
                                            {oPhaiNhan(k)}
                                        </div>
                                        <div className="col-span-2">{oKhop(k)}</div>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[560px] whitespace-nowrap text-[13px]">
                                <thead>
                                    <tr className="border-b border-border/70 bg-muted/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                        <th className="px-5 py-2.5 text-left">Kỳ</th>
                                        <th className="px-3 py-2.5 text-right">Đơn</th>
                                        <th className="px-3 py-2.5 text-right">Tiền COD</th>
                                        <th className="px-3 py-2.5 text-right">Phải nhận</th>
                                        <th className="px-3 py-2.5 text-right">Khớp với đơn</th>
                                        <th className="w-10 px-3 py-2.5" />
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border/60">
                                    {ky.map((k) => (
                                        <tr key={k.id} className="hover:bg-muted/30">
                                            <td className="px-5 py-3">
                                                <div className="font-semibold tabular-nums text-foreground">{ngayHien(k)}</div>
                                                <div className="max-w-[18rem] truncate text-[12px] text-muted-foreground" title={k.filename}>{tenKy(k.filename)}</div>
                                                {/* Cột máy đã đọc — để người tải soát nhanh máy có lấy nhầm cột phí làm tiền không. */}
                                                {cotDoc(k) && <div className="max-w-[18rem] truncate text-[11px] text-muted-foreground/80" title={cotDoc(k)}>{cotDoc(k)}</div>}
                                            </td>
                                            <td className="px-3 py-3 text-right tabular-nums text-foreground/80">{formatNumber(k.so_dong)}</td>
                                            <td className={cn("px-3 py-3 text-right font-semibold tabular-nums", COD)}>{tien(k.cod_local)}</td>
                                            <td className="px-3 py-3 text-right">{oPhaiNhan(k)}</td>
                                            <td className="px-3 py-3 text-right">{oKhop(k)}</td>
                                            <td className="px-3 py-3 text-right">{nutXoa(k)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                    {ky.some((k) => k.canh_bao.length) && (
                        <ul className="space-y-1 border-t border-border/70 bg-amber-50/50 px-3.5 py-2.5 text-[12.5px] text-amber-800 md:px-5 dark:bg-amber-500/[0.06] dark:text-amber-300">
                            {ky.flatMap((k) => k.canh_bao.map((c, i) => (
                                <li key={`${k.id}-${i}`} className="flex items-start gap-2">
                                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" /><span><b className="font-semibold">{tenKy(k.filename)}:</b> {c}</span>
                                </li>
                            )))}
                        </ul>
                    )}
                </Khoi>
            )}

            {/* ═══ Khoản phải hỏi bên giao hàng ═══ */}
            {soCanHoi > 0 && (
                <Khoi so={so()} ten="Khoản cần hỏi bên giao hàng" phamVi="all" dem={`${soCanHoi} dòng`}
                    phu="trả khác số trên đơn · trả cho đơn mình không có · một đơn trả hai lần">
                    <ul className="divide-y divide-border/60 text-[13px]">
                        {lech.slice(0, 60).map((x, i) => (
                            <li key={`l${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5 md:px-5">
                                <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11.5px] font-bold text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">trả lệch</span>
                                <span className="font-mono text-[12.5px]">{x.order_id || "—"}</span>
                                <span className="font-mono text-[12px] text-muted-foreground">{x.tracking}</span>
                                <span className="tabular-nums">đơn {tien(x.cod_don)} · trả <b className="font-semibold">{tien(x.tra)}</b></span>
                                <span className="ml-auto text-[12px] text-muted-foreground">{tenKy(x.ky)}</span>
                            </li>
                        ))}
                        {khong.slice(0, 60).map((x, i) => (
                            <li key={`k${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5 md:px-5">
                                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11.5px] font-bold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">không có đơn</span>
                                <span className="font-mono text-[12.5px]">{x.tracking || x.order_id || "—"}</span>
                                {x.tracking && x.order_id ? <span className="font-mono text-[12px] text-muted-foreground">{x.order_id}</span> : null}
                                <span className="tabular-nums">trả {tien(x.so_tien)}</span>
                                <span className="ml-auto text-[12px] text-muted-foreground">{tenKy(x.ky)}</span>
                            </li>
                        ))}
                        {trung.slice(0, 60).map((x, i) => (
                            <li key={`t${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5 md:px-5">
                                <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11.5px] font-bold text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">trả 2 lần</span>
                                <span className="font-mono text-[12.5px]">{x.order_id || "—"}</span>
                                <span className="font-mono text-[12px] text-muted-foreground">{x.tracking}</span>
                                <span className="ml-auto text-[12px] text-muted-foreground">{x.ky.map(tenKy).join(" · ")}</span>
                            </li>
                        ))}
                    </ul>
                    {(lech.length > 60 || khong.length > 60 || trung.length > 60) && (
                        <p className="border-t border-border/70 px-5 py-2 text-[12px] text-muted-foreground">Mỗi loại chỉ hiện 60 dòng đầu.</p>
                    )}
                </Khoi>
            )}

            <Khoi so={so()} ten={ky.length ? "Đơn đã giao — chưa thấy tiền trên sao kê" : "Đơn đã giao — tiền bên giao hàng đang giữ"}
                phamVi="all" dem={`${formatNumber(daGiao.length)} đơn`}>
                {!daGiao.length ? (
                    <p className="px-5 py-4 text-sm text-muted-foreground">
                        {ky.length ? "Mọi đơn đã giao đều đã có trên sao kê." : "Chưa có đơn nào giao thành công."}
                    </p>
                ) : hep ? (
                    // Điện thoại: mỗi đơn một dòng hai tầng thay bảng 5 cột.
                    <ul className="divide-y divide-border/60">
                        {daGiao.map((x) => (
                            <li key={`${x.order_id}-${x.tracking}`} className="px-3.5 py-2.5">
                                <div className="flex items-baseline gap-2">
                                    <b className="font-mono text-[13px]">{x.order_id || "—"}</b>
                                    <span className="ml-auto font-mono text-[13px] font-bold tabular-nums">{tien(x.cod_local)}</span>
                                </div>
                                <div className="text-[12px] text-muted-foreground">
                                    {x.khach || "—"}{x.order_date ? ` · ${x.order_date.slice(8, 10)}/${x.order_date.slice(5, 7)}` : ""}
                                    {x.tracking ? <> · <span className="font-mono">{x.tracking}</span></> : null}
                                </div>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border text-left text-[12px] uppercase tracking-wide text-muted-foreground">
                                    <th className="px-4 py-2 font-medium">Mã đơn</th>
                                    <th className="px-4 py-2 font-medium">Mã vận đơn</th>
                                    <th className="px-4 py-2 font-medium">Ngày đơn</th>
                                    <th className="px-4 py-2 font-medium">Khách</th>
                                    <th className="px-4 py-2 text-right font-medium">COD</th>
                                </tr>
                            </thead>
                            <tbody>
                                {daGiao.map((x) => (
                                    <tr key={`${x.order_id}-${x.tracking}`} className="border-b border-border/60 last:border-0">
                                        <td className="px-4 py-2 font-mono text-[13px]">{x.order_id || "—"}</td>
                                        <td className="px-4 py-2 font-mono text-[12px] text-muted-foreground">{x.tracking || "—"}</td>
                                        <td className="px-4 py-2 tabular-nums">{x.order_date ? `${x.order_date.slice(8, 10)}/${x.order_date.slice(5, 7)}` : "—"}</td>
                                        <td className="px-4 py-2">{x.khach || "—"}</td>
                                        <td className="px-4 py-2 text-right font-mono tabular-nums">{tien(x.cod_local)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Khoi>

            <Khoi so={so()} ten="Đơn chưa giao xong — tiền còn ngoài đường" phamVi="all" dem={`${formatNumber(t.chua_giao.so_don)} đơn`}>
                {t.chua_giao.theo_trang_thai.length ? (
                    <ul className="divide-y divide-border/60">
                        {t.chua_giao.theo_trang_thai.map((x) => (
                            <li key={x.trang_thai} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                                <span>{x.trang_thai}</span>
                                <span className="tabular-nums text-muted-foreground">
                                    {formatNumber(x.so_don)} đơn · <span className={cn("font-mono", COD)}>{tien(x.cod_local)}</span>
                                </span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="px-5 py-4 text-sm text-muted-foreground">Không còn đơn nào ngoài đường.</p>
                )}
            </Khoi>
        </div>
    );
}

function CodDaiLoan({ dateRange, nutNuoc }: Props & { nutNuoc?: ReactNode }) {
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
    const [nhapBank, setNhapBank] = useState("");       // tên file kỳ đang nhập tiền về
    const [keo, setKeo] = useState(false);              // đang kéo file đè lên màn
    const fileRef = useRef<HTMLInputElement>(null);
    const hep = useManHep();

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
    // Đòi NAZA tiền đơn quá hạn là việc THEO ĐƠN → khung "Đòi tiền NAZA" ở Sổ đơn hàng (07/10/2026,
    // tách mục Kế toán). Ở đây chỉ còn việc theo KỲ: soát sao kê, hỏi khoản lệch, nhập tiền về.
    const viecKeToan = viec.filter((v) => v.id !== "doi-naza");

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

    if (loading && !periods.length) return <div className="space-y-4">{nutNuoc}<TabSkeleton cards={3} rows={8} showChart={false} /></div>;
    if (error) return <div className="space-y-4">{nutNuoc}<ErrorState message={error} onRetry={load} /></div>;

    const moiNhat = periods[0];
    const cu = bangDaCu(nhapBangDon);

    const oPhaiNhan = (p: Period) => p.luong?.phai_nhan_vnd != null ? (
        <span className="text-[14px] font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{VND(p.luong.phai_nhan_vnd)}</span>
    ) : (p.luong?.rmb_rong ?? 0) < 0 ? (
        <span className="font-semibold tabular-nums text-amber-600 dark:text-amber-400" title="NAZA mang số âm sang trừ vào kỳ sau">
            âm {RMB2(p.luong!.rmb_rong!)} → kỳ sau
        </span>
    ) : <span className="text-muted-foreground">không tính được</span>;

    const oThucNhan = (p: Period) => nhapBank === p.filename ? (
        <FormBank goiY={p.settlement?.payable_vnd ?? null} busy={busy === p.filename}
            onHuy={() => setNhapBank("")} onGhi={(so, ngay) => ghiBank(p.filename, so, ngay)} />
    ) : p.bank ? (
        <button onClick={() => setNhapBank(p.filename)} className="rounded-lg px-1.5 py-0.5 text-right transition-colors hover:bg-muted">
            <div className="font-semibold tabular-nums text-foreground">{VND(p.bank.thuc_nhan_vnd)}</div>
            <div className="text-[11.5px] text-muted-foreground">về {dmy(p.bank.ngay_ve)}</div>
        </button>
    ) : (
        <button onClick={() => setNhapBank(p.filename)}
            className="inline-flex items-center gap-1 rounded-lg border border-dashed border-border px-2.5 py-1 text-[12px] font-medium text-muted-foreground transition-colors hover:border-sky-400 hover:bg-sky-50 hover:text-sky-700 dark:hover:bg-sky-500/10 dark:hover:text-sky-300">
            <PenLine className="h-3.5 w-3.5" />chưa nhập
        </button>
    );

    const oLech = (p: Period) => (
        <span className={cn("font-semibold tabular-nums",
            p.lech_bank_vnd == null ? "text-muted-foreground"
                : p.trang_thai === "khop" ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
            {p.lech_bank_vnd == null ? "·"
                : Math.round(p.lech_bank_vnd) === 0 ? "0đ"
                    : `${p.lech_bank_vnd > 0 ? "+" : "−"}${VND(Math.abs(p.lech_bank_vnd))}`}
        </span>
    );
    const napGon = cu ? null : nhanNapGon(nhapBangDon);

    return (
        // Kéo file sao kê thả vào BẤT CỨ ĐÂU trên màn (07/10/2026): trước là một thẻ to "Kéo file vào
        // đây" chiếm đầu tab mỗi lần mở, trong khi tải file chỉ là việc tuần một lần.
        <div className="relative space-y-3 md:space-y-4"
            onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); if (!keo) setKeo(true); } }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setKeo(false); }}
            onDrop={(e) => {
                if (!e.dataTransfer.files?.length) return;
                e.preventDefault(); setKeo(false);
                upload(e.dataTransfer.files[0]);
            }}>
            {keo && (
                <div className="pointer-events-none absolute inset-0 z-30 grid place-items-start justify-center rounded-2xl border-2 border-dashed border-orange-400 bg-orange-50/85 pt-24 dark:bg-orange-500/15">
                    <div className="flex items-center gap-2 rounded-xl bg-card px-4 py-3 text-[15px] font-bold text-orange-700 shadow-lg dark:text-orange-300">
                        <FileSpreadsheet className="h-5 w-5" />Thả file sao kê NAZA để tải lên
                    </div>
                </div>
            )}
            <input ref={fileRef} type="file" accept=".xlsx,.csv,.tsv,.txt" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />

            <ThanhDau
                nutNuoc={nutNuoc}
                nguon={<>
                    {stms.length} bản sao kê{moiNhat ? ` · mới nhất “${shortFile(moiNhat.filename)}” (chốt đơn tới ${dmy(moiNhat.period_date)})` : ""}
                    {napGon ? ` · ${napGon}` : ""}
                </>}
                phai={<>
                    <span className="hidden text-[11.5px] text-muted-foreground lg:inline">hoặc kéo thả file .xlsx vào màn</span>
                    <span title="File .xlsx ba sheet của NAZA — máy tự đọc, tự soát 8 mục, tự cập nhật Sổ đơn hàng. Tải lại cùng một file thì THAY, không cộng thêm.">
                        <Nut kieu="chinh" busy={uploading} busyText="Đang đọc và soát…" onClick={() => fileRef.current?.click()}>
                            <Upload className="h-4 w-4" />Tải sao kê NAZA
                        </Nut>
                    </span>
                </>}
            />
            {upErr && (
                <p className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />{upErr}
                </p>
            )}

            {/* Bảng đối tác đã cũ → khung đỏ to như trước: số trên màn KHÔNG phải của hôm nay. */}
            {cu && <ThanhNhapBangDon n={nhapBangDon} />}

            {/* ═══ Σ TIỀN VỀ — bốn ô số; giải thích cách tính cất sau một nút ═══ */}
            {tienVe && <TomTatTien t={tienVe} tq={tq} />}

            {/* ═══ ① VIỆC HÔM NAY ═══ */}
            <Khoi so="1" ten="Việc hôm nay" phamVi="all" dem={viecKeToan.length ? `${viecKeToan.length} việc` : ""}
                phu="soát sao kê, hỏi khoản lệch, nhập tiền về">
                {viecKeToan.length === 0 ? (
                    <div className="flex items-center gap-3 px-5 py-6">
                        <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="h-5 w-5" />
                        </span>
                        <div>
                            <div className="text-[14.5px] font-semibold text-emerald-700 dark:text-emerald-400">Không có việc gì cần làm</div>
                            <div className="text-[13px] text-muted-foreground">
                                Mọi kỳ đã soát xong, tiền đã về khớp. Đơn quá hạn phải đòi xem ở Sổ đơn hàng.
                            </div>
                        </div>
                    </div>
                ) : (
                    <ul className="divide-y divide-border/70">
                        {viecKeToan.map((v) => {
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
                    {hep ? (
                        // Điện thoại: mỗi kỳ một thẻ — bảng 8 cột phải kéo ngang mới thấy cột "Thực nhận".
                        <ul className="divide-y divide-border/60">
                            {periods.map((p) => {
                                const chon = p.id === period?.id;
                                return (
                                    <li key={p.id} id={`ky-${p.id}`} onClick={() => setPid(p.id)}
                                        className={cn("cursor-pointer px-3.5 py-3",
                                            chon && "bg-orange-50/70 shadow-[inset_3px_0_0_0_#FF7312] dark:bg-orange-500/[0.07]")}>
                                        <div className="flex items-center gap-2">
                                            <b className="tabular-nums text-foreground">{dmy(p.period_date)}</b>
                                            <span className="min-w-0 truncate text-[11.5px] text-muted-foreground">{shortFile(p.filename)}</span>
                                            <span className="ml-auto flex-none"><TrangThai p={p} /></span>
                                        </div>
                                        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-[12.5px]">
                                            <div>
                                                <div className="text-[11px] text-muted-foreground">Tiền COD · {p.luong?.so_dong_sao_ke ?? p.orders_paid} đơn</div>
                                                <div className="font-semibold tabular-nums text-sky-700 dark:text-sky-300">{TWD(p.luong?.cod_twd ?? p.total_twd)}</div>
                                            </div>
                                            <div>
                                                <div className="text-[11px] text-muted-foreground">Phải nhận</div>
                                                {oPhaiNhan(p)}
                                            </div>
                                            <div className="col-span-2 flex flex-wrap items-center justify-between gap-2" onClick={(e) => e.stopPropagation()}>
                                                <div>
                                                    <div className="text-[11px] text-muted-foreground">Thực nhận (ngân hàng)</div>
                                                    <div className="-ml-1.5">{oThucNhan(p)}</div>
                                                </div>
                                                <div className="text-right">
                                                    <div className="text-[11px] text-muted-foreground">Lệch</div>
                                                    {oLech(p)}
                                                </div>
                                            </div>
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    ) : (
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
                                                {th?.sing_vnd ? (
                                                    // Kỳ gộp Sing: tiền hàng NAZA trừ gồm cả Đài lẫn Sing.
                                                    <>
                                                        <div className="font-semibold tabular-nums text-orange-600 dark:text-orange-400">
                                                            {VND(th.trong_luong_vnd)}
                                                        </div>
                                                        <div className="text-[11.5px] text-muted-foreground">
                                                            Đài {VND(th.dai_vnd ?? 0)} · Sing {VND(th.sing_vnd)}
                                                        </div>
                                                    </>
                                                ) : th?.file ? (
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
                                            <td className="px-3 py-3 text-right">{oPhaiNhan(p)}</td>
                                            <td className="px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>{oThucNhan(p)}</td>
                                            <td className="px-3 py-3 text-right">{oLech(p)}</td>
                                            <td className="px-5 py-3"><TrangThai p={p} /></td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    )}
                    {tq && (
                        <p className="flex items-start gap-2 border-t border-border/70 bg-muted/30 px-3.5 py-2 text-[12px] leading-relaxed text-muted-foreground md:px-5">
                            <Info className="mt-0.5 h-3.5 w-3.5 flex-none" />
                            <span>
                                Kỳ chỉ <b className="font-semibold text-foreground">xong</b> khi tiền thật về khớp số sao kê tính ra
                                (lệch dưới {VND(tq.bank_tolerance_vnd)} bỏ qua) — không phải khi tám mục soát xanh hết.
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
                                        sub={l.sg_gop?.don
                                            ? `gồm ${l.sg_gop.don} đơn Sing ${RMB2(l.sg_gop.phi_rmb)}`
                                            : l.phi_gop ? "ship + thao tác (gộp)" : `thao tác ${RMB2(l.phi_thao_tac_rmb)} · ship ${RMB2(l.phi_ship_rmb)}`}
                                        tone="rmb" />
                                    <Kpi label="Tiền hàng"
                                        value={th.sing_vnd ? VND(th.trong_luong_vnd)
                                            : th.file ? VND(th.file.tong_vnd) : th.naza_tru_vnd != null ? VND(th.naza_tru_vnd) : "—"}
                                        sub={th.sing_vnd ? `Đài ${VND(th.dai_vnd ?? 0)} · Sing ${VND(th.sing_vnd)}`
                                            : th.cach_tra === "naza_tru" ? "NAZA trừ vào COD"
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
                    <HaiNhomSoat checks={checks} kyKhac={!!moiNhat && period.id !== moiNhat.id}>
                    <div className="grid items-start gap-4 border-t border-border/70 bg-muted/20 p-3 md:p-4 xl:grid-cols-2">
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
                    </HaiNhomSoat>
                </Khoi>
            )}

            {/* ═══ ④ TỶ GIÁ — quy ra tiền, không quy ra phần trăm ═══ */}
            {fx && fx.rows.length > 1 && (
                <Khoi so="4" ten="Tỷ giá đã lấy của mình bao nhiêu" phamVi="all" gap={{ mo: false }}
                    dem={fx.total_thiet_vnd > 0 ? `thiệt ${VND(fx.total_thiet_vnd)}` : undefined}>
                    <div className="grid gap-px border-b border-border/70 bg-border/60 sm:grid-cols-3">
                        <Kpi label="Thiệt vì tỷ giá" value={VND(fx.total_thiet_vnd)}
                            sub={`qua ${fx.rows.filter((r) => r.thiet_vnd != null).length} kỳ đã có sao kê`} tone="red" />
                        <Kpi label="Tỷ giá tốt nhất NAZA từng đặt"
                            value={fx.best_vnd_per_twd != null ? `${fx.best_vnd_per_twd.toFixed(2)}đ/NT$` : "—"}
                            sub={fx.best_period ? `kỳ chốt ${dmy(fx.best_period)}` : ""} tone="green" />
                        <KpiTeNhat rows={fx.rows} />
                    </div>
                    <p className="flex items-start gap-2 border-b border-border/70 bg-muted/30 px-5 py-2.5 text-[12.5px] leading-relaxed text-muted-foreground">
                        <Info className="mt-0.5 h-4 w-4 flex-none" />
                        <span>
                            Tỷ giá NAZA tự đặt, mình phải chịu — nên chỉ hỏi: <b className="font-semibold text-foreground">nó đã lấy của mình bao nhiêu tiền</b>.
                            Mốc là kỳ tốt nhất chính NAZA từng đặt; tiền thiệt = chênh đồng/NT$ × tiền COD cả kỳ. Rê chuột lên từng kỳ để xem số.
                        </span>
                    </p>
                    <BieuDoTyGia fx={fx} kyDangXem={period?.filename} />
                    <details className="group border-t border-border/70">
                        <summary className="flex cursor-pointer list-none items-center gap-1.5 px-5 py-2.5 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
                            <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                            Xem bảng số từng kỳ
                        </summary>
                        <div className="overflow-x-auto border-t border-border/70">
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
                    </details>
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
function Khoi({ so, ten, phamVi, phu, dem, phai, gap, children }: {
    so: string; ten: string; phamVi: "one" | "all";
    phu?: string; dem?: string; phai?: React.ReactNode;
    /** Khối gập được (07/10/2026): `mo` là trạng thái ban đầu; bấm tiêu đề để mở/gập. */
    gap?: { mo: boolean };
    children: React.ReactNode;
}) {
    const [mo, setMo] = useState(gap ? gap.mo : true);
    return (
        <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <header
                onClick={gap ? () => setMo(!mo) : undefined}
                className={cn("flex flex-wrap items-center gap-x-2.5 gap-y-2 px-3.5 py-3 md:px-5",
                    mo && "border-b border-border/70", gap && "cursor-pointer hover:bg-muted/30")}>
                {/* Số bước nhỏ, màu trầm — trước là ô gradient cam to, sáu khối sáu ô cam nên rối mắt. */}
                <span className="grid h-6 w-6 flex-none place-items-center rounded-md bg-muted text-[12px] font-bold text-muted-foreground">
                    {so}
                </span>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-[15px] font-bold leading-tight text-foreground">{ten}</h3>
                        {dem && (
                            <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[12px] font-bold tabular-nums text-orange-700 dark:bg-orange-500/15 dark:text-orange-300">
                                {dem}
                            </span>
                        )}
                        {/* "Cộng dồn / chỉ kỳ này" — sửa lời chê "không biết số nào của kỳ nào"; giữ, nhưng nhỏ. */}
                        <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10.5px] font-medium",
                            phamVi === "one" ? "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300"
                                : "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300")}>
                            {phamVi === "one" ? <CalendarDays className="h-3 w-3" /> : <Layers className="h-3 w-3" />}
                            {phamVi === "one" ? "chỉ kỳ này" : "cộng dồn"}
                        </span>
                    </div>
                    {phu && <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{phu}</p>}
                </div>
                {phai && <div className="flex max-w-full flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>{phai}</div>}
                {gap && <ChevronDown className={cn("h-4 w-4 flex-none text-muted-foreground transition-transform", mo && "rotate-180")} />}
            </header>
            {mo && children}
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
    // Kỳ gộp Sing (24/09/2026): tiền hàng Sing là một dòng riêng, trừ theo số NAZA —
    // file tiền hàng Đài không có khoản này. Trong trong_luong_vnd đã gồm nó.
    const sing = th.sing_vnd ?? 0;
    const daiTrongLuong = th.dai_vnd ?? (th.trong_luong_vnd - sing);
    const chenhChuyenKy = l.vnd != null && l.phai_nhan_vnd != null
        ? l.phai_nhan_vnd - (l.vnd - (th.cach_tra === "naza_tru" ? th.trong_luong_vnd : sing)) : 0;
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
                    <DongTien nhan="− Phí vận chuyển" so={RMB2(-l.phi_ship_rmb)} tru
                        ghi={l.sg_gop?.don ? `gồm ${l.sg_gop.don} đơn Sing ${RMB2(l.sg_gop.phi_rmb)} (kỳ gộp)` : undefined} />
                    <DongTien nhan="= COD còn lại" so={l.rmb_rong != null ? RMB2(l.rmb_rong) : "—"} tong
                        mau={(l.rmb_rong ?? 0) < 0 ? "text-rose-600 dark:text-rose-400" : CHANG.rmb.so} />
                </ChangTien>
                <MuiTen chu={khongQuyDoi ? "không quy đổi" : `× ${l.ty_gia_rmb_vnd != null ? l.ty_gia_rmb_vnd.toLocaleString("vi-VN") : "—"}`} />
                <ChangTien te="vnd" ten="Việt Nam" mo="về tài khoản">
                    <DongTien nhan="Quy ra tiền Việt" so={khongQuyDoi ? "không quy đổi" : l.vnd != null ? VND(l.vnd) : "—"}
                        ghi={khongQuyDoi ? "số âm — NAZA mang sang trừ kỳ sau" : undefined} />
                    {th.cach_tra === "naza_tru" ? (
                        <DongTien nhan={sing ? "− Tiền hàng Đài" : "− Phí mua hàng"} so={VND(-daiTrongLuong)} tru
                            ghi={th.lech_naza_vnd && Math.abs(th.lech_naza_vnd) >= 1
                                ? `theo file tiền hàng · NAZA ghi ${VND(th.naza_tru_vnd!)}`
                                : th.file ? `đợt ${dot}` : "theo sao kê NAZA"} />
                    ) : (
                        <DongTien nhan="− Phí mua hàng" so="không trừ"
                            ghi={th.file ? `tự chuyển khoản riêng ${VND(th.file.tong_vnd)}` : "kỳ này NAZA không trừ"} />
                    )}
                    {sing > 0 && (
                        <DongTien nhan="− Tiền hàng Sing" so={VND(-sing)} tru
                            ghi="kỳ gộp Singapore · theo sao kê NAZA" />
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

/**
 * Tiền về — con số Sỹ Anh xin 13/09/2026: NAZA đã gửi bao nhiêu, và còn phải gửi
 * bao nhiêu theo hai cách đếm đơn còn lại.
 *
 * 07/10/2026: ba thẻ to + banner "chưa đối chiếu ngân hàng" → bốn ô số một hàng; đoạn giải
 * thích cách tính cất sau nút "Cách tính" (vẫn đủ chữ). Cảnh báo lệch thì luôn hiện.
 */
function TomTatTien({ t, tq }: { t: TienVe; tq: TongQuan | null }) {
    const [cachTinh, setCachTinh] = useState(false);
    const gia = t.ty_gia.twd_rmb != null && t.ty_gia.rmb_vnd != null
        ? `tỷ giá kỳ ${t.ty_gia.ngay_sao_ke ? t.ty_gia.ngay_sao_ke.slice(8, 10) + "/" + t.ty_gia.ngay_sao_ke.slice(5, 7) : "mới nhất"}: ${t.ty_gia.twd_rmb} × ${t.ty_gia.rmb_vnd.toLocaleString("vi-VN")}`
        : "chưa có tỷ giá";
    const lechFile = t.phai_nhan_theo_file_vnd - t.da_gui_ve_vnd;
    const tongDon = t.con_lai_da_giao.so_don + t.con_lai_chua_giao.so_don;
    const tongCod = t.con_lai_da_giao.cod_twd + t.con_lai_chua_giao.cod_twd;
    const dg = t.con_lai_da_giao, cg = t.con_lai_chua_giao;
    return (
        <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                <OSoTien mau="xanh" nhan="NAZA đã gửi về" so={VND(t.da_gui_ve_vnd)}
                    phu={`${formatNumber(t.so_ky)} kỳ sao kê`} />
                <OSoTien mau="vang" uoc nhan="Còn phải gửi · đơn đã giao"
                    so={dg.vnd_uoc != null ? VND(dg.vnd_uoc) : "—"}
                    phu={`${formatNumber(dg.so_don)} đơn · ${TWD(dg.cod_twd)}`} />
                <OSoTien mau="cam" uoc nhan="Chưa giao xong"
                    so={cg.vnd_uoc != null ? VND(cg.vnd_uoc) : "—"}
                    phu={`${formatNumber(cg.so_don)} đơn · ${TWD(cg.cod_twd)}`} />
                {tq && (tq.ky_lech > 0
                    ? <OSoTien mau="do" nhan="Tiền về lệch ngân hàng" so={VND(tq.tien_lech_vnd)} phu={`${tq.ky_lech} kỳ không khớp`} />
                    : tq.ky_cho_nhap > 0
                        ? <OSoTien mau="xanhduong" nhan="Chưa đối chiếu ngân hàng" so={VND(tq.tien_cho_nhap_vnd)}
                            phu={`${tq.ky_cho_nhap} kỳ chưa nhập tiền về`} />
                        : <OSoTien mau="xanh" nhan="Đối chiếu ngân hàng" so={`${tq.ky_khop} kỳ khớp`} phu="không kỳ nào lệch" />)}
            </div>
            {Math.abs(lechFile) >= 1 && (
                <p className="text-[12.5px] font-semibold text-rose-600 dark:text-rose-400">
                    Theo file tiền hàng, NAZA lẽ ra gửi {VND(t.phai_nhan_theo_file_vnd)} — {lechFile > 0 ? "trừ dư" : "trừ thiếu"} {VND(Math.abs(lechFile))}.
                </p>
            )}
            {t.tien_hang.loi && <p className="text-[12.5px] font-semibold text-rose-600 dark:text-rose-400">{t.tien_hang.loi}</p>}
            <button onClick={() => setCachTinh(!cachTinh)} aria-expanded={cachTinh}
                className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground hover:text-foreground">
                <Info className="h-3.5 w-3.5" />Cách tính các số này
                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", cachTinh && "rotate-180")} />
            </button>
            {cachTinh && (
                <div className="space-y-1.5 rounded-xl border border-border bg-muted/30 px-4 py-3 text-[12.5px] leading-relaxed text-muted-foreground">
                    <p><b className="font-semibold text-foreground">Đã gửi về</b> = cộng số phải trả NAZA ghi trên từng sao kê
                        ({t.ky_da_doi_chieu_bank === 0 ? "chưa kỳ nào đối chiếu ngân hàng" : `${t.ky_da_doi_chieu_bank} kỳ đã đối chiếu ngân hàng`}).</p>
                    <p><b className="font-semibold text-foreground">Hai ô giữa không trùng nhau</b> — cộng lại là {formatNumber(tongDon)} đơn
                        ({TWD(tongCod)}) chưa thấy tiền trên sao kê nào: đơn đã giao là tiền NAZA đang giữ ({dg.don_chua_tru_phi} đơn chưa bị trừ phí ship),
                        đơn chưa giao là tiền còn ở ngoài đường. Đơn đã giao qua từ 2 kỳ mà chưa được trả thì đòi ở khung
                        “Đòi tiền NAZA” của Sổ đơn hàng. Đã bỏ {t.khong_tinh.hoan} đơn hoàn + {t.khong_tinh.huy} đơn huỷ
                        {t.khong_tinh.tieu_huy ? ` + ${t.khong_tinh.tieu_huy} đơn tiêu huỷ` : ""} ({TWD(t.khong_tinh.cod_twd)}) vì không bao giờ trả tiền.</p>
                    <p>Số dự tính đi đúng luồng NAZA: COD × {gia} − phí. Đơn đã bị NAZA trừ phí ship ở kỳ trước thì không trừ lại;
                        đơn chưa bị trừ thì trừ phí ship theo bảng giá kênh giao (kg đầu) + phí thao tác.
                        <b className="font-semibold text-foreground"> Chưa trừ tiền hàng các kỳ tới</b> — chưa biết trước được.</p>
                    {tq && <p><b className="font-semibold text-foreground">Ngân hàng:</b> kỳ chỉ coi là xong khi tiền thật về khớp số sao kê tính ra.
                        Lệch trong {VND(tq.bank_tolerance_vnd)} thì bỏ qua (quy đổi NT$ → ¥ → đ có làm tròn, ngân hàng còn thu phí chuyển).
                        Nhập số tiền về của từng kỳ ở bảng ② bên dưới.</p>}
                </div>
            )}
        </div>
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

/* ④ Tỷ giá qua các kỳ — MỘT đường, MỘT trục.
   Đường = đồng thực nhận trên mỗi NT$ (tích hai chặng). Nét đứt = kỳ tốt nhất chính
   NAZA từng đặt. Vùng đỏ giữa hai đường = phần tỷ giá lấy của mình. Tiền thiệt từng
   kỳ còn tuỳ tiền COD kỳ đó nên nằm trong ô rê chuột, không in lên từng điểm.
   Màu đã chạy bộ kiểm mù màu: xanh–đỏ đạt, xanh lá–đỏ KHÔNG đạt (ΔE 5,8) — nên mốc
   tốt nhất là nét đứt xám có nhãn chứ không tô xanh lá. */
type DiemTyGia = FxRow & { nhan: string; vung: [number, number] };

function BieuDoTyGia({ fx, kyDangXem }: { fx: Fx; kyDangXem?: string }) {
    const best = fx.best_vnd_per_twd;
    const data: DiemTyGia[] = [...fx.rows].reverse()
        .filter((r) => r.vnd_per_twd != null)
        .map((r) => ({
            ...r,
            nhan: r.period_date ? `${r.period_date.slice(8, 10)}/${r.period_date.slice(5, 7)}` : r.filename,
            vung: [r.vnd_per_twd!, best ?? r.vnd_per_twd!],
        }));
    if (best == null || data.length < 2) return null;

    const thap = Math.min(...data.map((d) => d.vnd_per_twd!));
    const buoc = best - thap > 8 ? 4 : 2;
    const day = Math.floor((thap - 1) / buoc) * buoc;
    const dinh = Math.ceil((best + 1) / buoc) * buoc;
    const ticks = Array.from({ length: (dinh - day) / buoc + 1 }, (_, i) => day + i * buoc);
    const cuoi = data[data.length - 1];

    return (
        <div className="px-3 pb-2 pt-3 [--fx-line:#0284c7] [--fx-loss:#e11d48] dark:[--fx-loss:#f43f5e] sm:px-5">
            <div className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1 px-2 text-[12px] text-muted-foreground sm:px-0">
                <span className="inline-flex items-center gap-1.5">
                    <span className="h-0.5 w-4 rounded-full" style={{ background: "var(--fx-line)" }} />
                    Đồng thực nhận / NT$
                </span>
                <span className="inline-flex items-center gap-1.5">
                    <span className="w-4 border-t-2 border-dashed border-muted-foreground/70" />
                    Kỳ tốt nhất NAZA từng đặt
                </span>
                <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-4 rounded-sm" style={{ background: "var(--fx-loss)", opacity: 0.22 }} />
                    Phần tỷ giá lấy của mình
                </span>
            </div>
            <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={data} margin={{ top: 22, right: 16, bottom: 0, left: 0 }}>
                    <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="nhan" tickLine={false} axisLine={false} interval="preserveStartEnd"
                        tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickMargin={8} />
                    <YAxis domain={[day, dinh]} ticks={ticks} width={40} tickLine={false} axisLine={false}
                        tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip content={<OTyGia />} cursor={{ stroke: "hsl(var(--muted-foreground))", strokeOpacity: 0.4, strokeWidth: 1 }} />
                    <Area type="linear" dataKey="vung" stroke="none" fill="var(--fx-loss)" fillOpacity={0.14}
                        isAnimationActive={false} activeDot={false} />
                    <ReferenceLine y={best} stroke="hsl(var(--muted-foreground))" strokeOpacity={0.8}
                        strokeDasharray="5 4" strokeWidth={1.5} ifOverflow="extendDomain"
                        label={{ value: `tốt nhất ${best.toFixed(2)}`, position: "insideBottomLeft", offset: 6,
                            fontSize: 11, fontWeight: 600, fill: "hsl(var(--muted-foreground))" }} />
                    <Line type="linear" dataKey="vnd_per_twd" stroke="var(--fx-line)" strokeWidth={2}
                        isAnimationActive={false}
                        activeDot={{ r: 6, fill: "var(--fx-line)", stroke: "hsl(var(--card))", strokeWidth: 2 }}
                        dot={(p: { cx?: number; cy?: number; index?: number; payload?: DiemTyGia }) => {
                            const { cx, cy, payload } = p;
                            if (cx == null || cy == null || !payload) return <g key={`d${p.index}`} />;
                            const chon = payload.filename === kyDangXem;
                            return (
                                <g key={payload.filename}>
                                    {chon && <circle cx={cx} cy={cy} r={10} fill="var(--fx-line)" fillOpacity={0.15} />}
                                    <circle cx={cx} cy={cy} r={chon ? 5.5 : 4} fill="var(--fx-line)"
                                        stroke="hsl(var(--card))" strokeWidth={2} />
                                    {payload === cuoi && (
                                        <text x={cx + 6} y={cy - 12} textAnchor="end" fontSize={11.5} fontWeight={700}
                                            fill="hsl(var(--foreground))">
                                            {payload.vnd_per_twd!.toFixed(2)}
                                        </text>
                                    )}
                                </g>
                            );
                        }} />
                </ComposedChart>
            </ResponsiveContainer>
        </div>
    );
}

function OTyGia({ active, payload }: { active?: boolean; payload?: { payload: DiemTyGia }[] }) {
    const d = active ? payload?.[0]?.payload : undefined;
    if (!d) return null;
    return (
        <div className="min-w-[210px] rounded-xl border border-border bg-card px-3.5 py-2.5 text-[12.5px] shadow-lg">
            <div className="mb-1.5 font-semibold text-foreground">Kỳ chốt {dmy(d.period_date)}</div>
            <div className="flex items-baseline justify-between gap-4">
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <span className="h-2 w-2 rounded-full" style={{ background: "var(--fx-line)" }} />Đồng / NT$
                </span>
                <span className="font-bold tabular-nums text-foreground">{d.vnd_per_twd?.toFixed(2)}</span>
            </div>
            <div className="mt-0.5 text-right text-[11.5px] tabular-nums text-muted-foreground">
                {d.rate_twd_rmb} × {d.rate_rmb_vnd}
            </div>
            <div className="mt-1.5 flex items-baseline justify-between gap-4 border-t border-border/70 pt-1.5">
                <span className="text-muted-foreground">Tiền COD</span>
                <span className="tabular-nums text-foreground">{TWD(d.cod_twd)}</span>
            </div>
            <div className="mt-0.5 flex items-baseline justify-between gap-4">
                <span className="text-muted-foreground">Thiệt so kỳ tốt nhất</span>
                {d.tot_nhat
                    ? <span className="font-semibold text-emerald-700 dark:text-emerald-300">kỳ tốt nhất</span>
                    : <span className="font-bold tabular-nums text-rose-600 dark:text-rose-400">−{VND(d.thiet_vnd ?? 0)}</span>}
            </div>
        </div>
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
        <div className="flex flex-wrap items-center justify-end gap-1.5">
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

/** Tám mục máy soát — gập lại thành một dòng tóm tắt; có mục lỗi thì mở sẵn (07/10/2026). */
function HaiNhomSoat({ checks, kyKhac, children }: { checks: Check[]; kyKhac: boolean; children: ReactNode }) {
    const xau = checks.filter((c) => c.ok === false).length;
    const dat = checks.filter((c) => c.ok === true).length;
    const [mo, setMo] = useState(xau > 0);
    if (!checks.length) return null;
    return (
        <>
            <button onClick={() => setMo(!mo)} aria-expanded={mo}
                className="flex w-full items-center gap-2 border-t border-border/70 px-3.5 py-2.5 text-left text-[13px] hover:bg-muted/30 md:px-5">
                <SearchCheck className="h-4 w-4 flex-none text-muted-foreground" />
                <span className="font-semibold text-foreground">Máy soát {checks.length} mục{kyKhac ? " · kỳ mới nhất" : ""}</span>
                <span className={cn("rounded-full px-2 py-0.5 text-[11.5px] font-bold",
                    xau ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
                        : "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300")}>
                    {dat} đạt{xau ? ` · ${xau} cần xử` : ""}
                </span>
                {checks.length - dat - xau > 0 && (
                    <span className="text-[11.5px] text-muted-foreground">{checks.length - dat - xau} chưa soát được</span>
                )}
                <ChevronDown className={cn("ml-auto h-4 w-4 flex-none text-muted-foreground transition-transform", mo && "rotate-180")} />
            </button>
            {mo && children}
        </>
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

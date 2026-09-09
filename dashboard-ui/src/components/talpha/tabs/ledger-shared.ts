/**
 * Thứ dùng chung giữa Sổ đơn hàng · Đối soát COD · Theo dõi vận đơn.
 *
 * Ba tab nói về CÙNG một tập đơn, nên cách hiển thị cũng phải giống nhau:
 * cùng một đèn màu, cùng một cách tô trạng thái, cùng một định dạng tiền.
 * Để mỗi tab tự định nghĩa lại là sớm muộn ba tab lệch nhau, rồi người dùng
 * thấy cùng một đơn hai màu khác nhau ở hai chỗ.
 */

export type Light = "xanh" | "vang" | "do" | "xam";

/** Tiền Đài ghi NT$ chứ không phải $ — $ trần dễ đọc nhầm thành đô Mỹ. */
export const TWD = (n: number) => `${Math.round(n).toLocaleString("vi-VN")} NT$`;
export const VND = (n: number) => `${Math.round(n).toLocaleString("vi-VN")}đ`;
export const RMB = (n: number) => `${Math.round(n).toLocaleString("vi-VN")}¥`;
/** Ngày rút gọn dd/mm — bảng đã chật, năm thì cả bảng cùng một năm. */
export const d6 = (s?: string | null) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : "·");

/** Vạch màu mép trái — thứ duy nhất còn thấy khi cuộn ngang, nên nó mang tin
 *  quan trọng nhất: dòng này có phải làm gì không. */
export const STRIPE: Record<Light, string> = {
    do: "bg-rose-500", vang: "bg-amber-400", xanh: "bg-emerald-500",
    xam: "bg-slate-300 dark:bg-slate-600",
};
export const ROWBG: Record<Light, string> = {
    do: "bg-rose-50/70 dark:bg-rose-500/[0.07]",
    vang: "bg-amber-50/50 dark:bg-amber-500/[0.05]",
    xanh: "", xam: "opacity-60",
};

/** Trạng thái giao hàng tô theo NHÓM ý nghĩa, không phải mỗi trạng thái một
 *  màu — mười hai màu thì mắt không nhớ nổi cái nào là cái nào. */
const STATUS_STYLE: { m: RegExp; c: string }[] = [
    { m: /thành công/i, c: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" },
    { m: /hoàn|huỷ|hủy/i, c: "bg-slate-200 text-slate-700 dark:bg-slate-600/30 dark:text-slate-300" },
    { m: /đợi khách|chờ/i, c: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" },
    { m: /trung chuyển|đang giao|xuất kho|chuyển tiếp/i, c: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300" },
    { m: /lên đơn/i, c: "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300" },
];
export const statusCls = (s?: string | null) =>
    STATUS_STYLE.find((x) => x.m.test(String(s || "")))?.c || "bg-muted text-muted-foreground";

/** Mỗi marketer một màu CỐ ĐỊNH, suy từ chính tên — lướt mắt xuống cột là nhận
 *  ra người, khỏi đọc chữ. */
const MK_COLORS = [
    "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300",
    "bg-teal-100 text-teal-800 dark:bg-teal-500/15 dark:text-teal-300",
    "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-500/15 dark:text-fuchsia-300",
    "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300",
    "bg-cyan-100 text-cyan-800 dark:bg-cyan-500/15 dark:text-cyan-300",
];
export function mkCls(name: string) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return MK_COLORS[h % MK_COLORS.length];
}

export type LedgerRowUI = {
    order_no: string; tracking: string; track17_code: string; return_order_no: string;
    order_date: string; ship_date: string; age_days: number | null; ky_da_qua: number;
    ship_method: string; sku: string; product_codes: string[]; quantity: number;
    contact_name: string; phone: string; marketer: string;
    status: string; status_raw: string; recon_manual: string;
    cod_twd: number; paid_twd: number | null; paid_date: string; paid_period: string;
    matched_by: "tracking" | "order_id_giao_lai" | null; diff_twd: number | null;
    ship_fee_rmb: number | null; op_fee_rmb: number | null; fee_wrong: boolean;
    cogs_vnd: number | null; cogs_missing: string[];
    gross_vnd: number | null; fee_vnd: number | null;
    net_vnd: number | null; net_before_cogs: boolean;
    tick: { doi_soat: boolean; tru_van_chuyen: boolean; tru_tien_hang: boolean };
    light: Light; light_note: string;
};

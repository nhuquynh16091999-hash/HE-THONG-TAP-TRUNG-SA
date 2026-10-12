// ═══════════════════════════════════════════════════════════════════
// Phí ship ước tính MỘT đơn Nhật theo bảng giá NAZA (talpha_rules.json → shipping_fees.JP,
// file "NAZA BẢNG BÁO GIÁ COD NHẬT.xlsx" Sỹ Anh gửi 13/10/2026). Hàm THUẦN — có test;
// lib/talpha/order-costs.ts gọi cho tab P&L và P&L theo SP.
//
//   cước (tệ)  = 0,5 kg đầu + (số bậc 0,5 kg − 1) × mỗi 0,5 kg tiếp theo — hàng thường;
//   thu hộ (¥) = bậc theo số tiền COD của chính đơn đó (480 · 570 · 810 · 1.335¥).
// Chưa cộng: phụ thu vùng xa, phí từ chối / hoàn (chưa biết đơn nào, tỷ lệ bao nhiêu).
// ═══════════════════════════════════════════════════════════════════
import { RULES } from "./rules";

export type BangGiaNhat = {
    first_half_kg?: { thuong?: number; dac_thu?: number };
    extra_half_kg?: { thuong?: number; dac_thu?: number };
    cod_fee_jpy_tiers?: { max_cod_jpy: number; fee: number }[];
};

export const BANG_GIA_NHAT: BangGiaNhat | null =
    ((RULES as unknown as { shipping_fees?: Record<string, unknown> }).shipping_fees?.JP as BangGiaNhat | undefined) || null;

/** Phí thu hộ (yên) theo bậc tiền COD. Đơn vượt bậc cuối → null: không đoán. */
export function phiThuHoNhat(codJpy: number, b: BangGiaNhat | null = BANG_GIA_NHAT): number | null {
    const bac = [...(b?.cod_fee_jpy_tiers || [])].sort((x, y) => x.max_cod_jpy - y.max_cod_jpy);
    const hit = bac.find((x) => codJpy <= x.max_cod_jpy);
    return hit ? hit.fee : null;
}

/** Cước NAZA (tệ) cho một kiện có `bac` bậc 0,5 kg (≥ 1), hàng thường. Thiếu bảng giá → null. */
export function cuocNhatRmb(bac: number, b: BangGiaNhat | null = BANG_GIA_NHAT): number | null {
    const dau = b?.first_half_kg?.thuong;
    if (!dau) return null;
    return dau + Math.max(0, bac - 1) * Number(b?.extra_half_kg?.thuong || 0);
}

/**
 * Phí ship một đơn Nhật quy VND. `bacTb` = số bậc 0,5 kg trung bình một kiện (cân các kiện NAZA
 * Đài, làm tròn lên từng kiện); `tyGiaJpy` đồng/yên; `tyGiaRmb` đồng/tệ. null = thiếu số để tính.
 */
export function phiShipNhatVnd(codJpy: number, bacTb: number | null, tyGiaJpy: number, tyGiaRmb: number,
    b: BangGiaNhat | null = BANG_GIA_NHAT): number | null {
    if (bacTb === null || !(tyGiaJpy > 0) || !(tyGiaRmb > 0)) return null;
    const cuoc = cuocNhatRmb(bacTb, b), thuHo = phiThuHoNhat(codJpy, b);
    if (cuoc === null || thuHo === null) return null;
    return cuoc * tyGiaRmb + thuHo * tyGiaJpy;
}

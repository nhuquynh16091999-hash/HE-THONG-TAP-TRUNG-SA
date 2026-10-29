/**
 * Định dạng tiền/số và quy đổi tỷ giá cho các tab TALPHA.
 * Doanh thu là tiền địa phương của từng nước (TWD · SGD · AED) → quy về VND.
 * Chi phí quảng cáo ĐÃ là VND → không quy đổi.
 */
export { cn } from "@/lib/utils";

// ═══ Ba thị trường: nạp từ /api/talpha/markets (xem markets-context.tsx) ═══
// Trước 15/09/2026 file này gõ cứng bảng tỷ giá riêng chỉ có Đài (TW: 800, mặc định
// 800) — thêm Singapore, UAE là tiền của hai nước đó bị nhân 800 trên các tab. Nay chỉ
// đọc bản MarketsProvider nạp từ config/talpha_rules.json; nước chưa nạp/chưa có tỷ giá
// → 0, không đoán.
export type MarketPublic = {
    key: string; code: string; display: string; currency: string; symbol: string;
    rate_vnd: number; status: "dang_ban" | "sap_chay"; tokens: string[];
};
let MARKETS: MarketPublic[] = [];
export function setMarkets(list: MarketPublic[]) { MARKETS = list; }
const timNuoc = (code?: string) => MARKETS.find((m) => m.code === code || m.key === code);
function rateVnd(code?: string): number { return timNuoc(code)?.rate_vnd || 0; }

// Số chia tiền POS (X13) nay chỉ khai một chỗ: config/talpha_rules.json →
// markets.*.pos_money_divisor, đọc qua `posMoneyDivisor()` trong lib/talpha/rules.ts.
// Bản sao ở file này (MONEY_DIVISORS · moneyDivisor · toVND) đã gỡ 11/09/2026 —
// không ai gọi, và hai bảng số chia song song là cách chắc chắn nhất để một ngày
// nào đó chúng lệch nhau rồi tiền Đài tụt đúng 100 lần.

/** Tên thị trường hiển thị từ shop_label. */
export function marketName(code?: string): string {
    if (!code) return "Unknown";
    return timNuoc(code)?.display || code;
}

// ═══ Formatting ═══
// Chi phí vận chuyển dùng lib/talpha/order-costs.ts (đọc từ talpha_rules.json).
// Bản ghi SHIPPING_FEES + shippingVND + shippingVNDFromRevVnd bị gỡ 29/10/2026:
// bảng chưa bao giờ được khai nên trả về 0 mọi lúc, và không có caller nào.

export function formatVNDCompact(vnd: number) {
    const abs = Math.abs(vnd);
    const sign = vnd < 0 ? "-" : "";
    if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(1).replace(".", ",")}tỷ`;
    if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1).replace(".", ",")}tr`;
    if (abs >= 1_000) return `${sign}${Math.round(abs / 1_000).toLocaleString("vi-VN")}K`;
    return `${sign}${Math.round(abs).toLocaleString("vi-VN")}₫`;
}

export function formatMoney(amount: number) {
    return new Intl.NumberFormat("vi-VN").format(Math.round(amount));
}

export function formatNumber(amount: number) {
    return new Intl.NumberFormat("vi-VN").format(amount);
}

// formatNumberCompact và COLORS đã gỡ 29/10/2026: không có caller nào trong repo.

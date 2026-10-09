import { NextResponse } from "next/server";
import { MARKETS_PUBLIC } from "@/lib/talpha/rules";
import { requireAccess } from "@/lib/talpha/access";
import { canMarket } from "@/lib/talpha/access-rules";
import { trackMarket } from "@/lib/talpha/tracking";

export const dynamic = "force-dynamic";

// Ba thị trường cho giao diện (client component không đọc được config/talpha_rules.json
// vì loader dùng fs). Trước 15/09/2026 giao diện gõ cứng một bảng tỷ giá riêng chỉ có
// Đài — thêm nước là tiền nước đó bị nhân 800 trên các tab. Nay chỉ còn một nguồn.
//
// Từ 05/10/2026 (phân quyền theo team) CHỈ trả các nước người xem được: nút chọn nước ở
// Sổ đơn, Đối soát COD… dựng từ danh sách này nên leader không thấy nút nước khác.
//
// `co_van_don` (09/10/2026, mở Nhật Bản): nước đã khai tracking.markets (hoặc Đài) mới có Sổ đơn —
// sổ đọc đơn + trạng thái giao qua hãng vận chuyển. Nhật đang bán nhưng chưa biết hãng giao, chưa
// có mã vận đơn → Sổ đơn ẩn nút Nhật; Tiền COD về vẫn hiện (lùi về trạng thái đơn trên POS).
const coVanDon = (code: string) => code === "TW" || trackMarket(code).code === code;

export async function GET(req: Request) {
    const { a, res } = await requireAccess(req);
    if (res) return res;
    const markets = MARKETS_PUBLIC.markets
        .filter((m) => a.full || canMarket(a, m.key))
        .map((m) => ({ ...m, co_van_don: coVanDon(m.code) }));
    return NextResponse.json({ ...MARKETS_PUBLIC, markets });
}

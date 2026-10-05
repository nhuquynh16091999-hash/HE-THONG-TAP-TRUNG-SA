import { NextResponse } from "next/server";
import { MARKETS_PUBLIC } from "@/lib/talpha/rules";
import { requireAccess } from "@/lib/talpha/access";
import { canMarket } from "@/lib/talpha/access-rules";

export const dynamic = "force-dynamic";

// Ba thị trường cho giao diện (client component không đọc được config/talpha_rules.json
// vì loader dùng fs). Trước 15/09/2026 giao diện gõ cứng một bảng tỷ giá riêng chỉ có
// Đài — thêm nước là tiền nước đó bị nhân 800 trên các tab. Nay chỉ còn một nguồn.
//
// Từ 05/10/2026 (phân quyền theo team) CHỈ trả các nước người xem được: nút chọn nước ở
// Sổ đơn, Đối soát COD… dựng từ danh sách này nên leader không thấy nút nước khác.
export async function GET(req: Request) {
    const { a, res } = await requireAccess(req);
    if (res) return res;
    if (a.full) return NextResponse.json(MARKETS_PUBLIC);
    return NextResponse.json({
        ...MARKETS_PUBLIC,
        markets: MARKETS_PUBLIC.markets.filter((m) => canMarket(a, m.key)),
    });
}

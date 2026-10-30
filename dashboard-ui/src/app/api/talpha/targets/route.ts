import { NextResponse } from "next/server";
import { MONTHLY_REVENUE_TARGETS } from "@/lib/talpha/rules";
import { getAccess } from "@/lib/talpha/access";
import { seesAllMarkets } from "@/lib/talpha/access-rules";

export const dynamic = "force-dynamic";

// KPI doanh số theo tháng cho thanh tiến độ ở hero các tab (client component không
// đọc được config/talpha_rules.json vì loader dùng fs). Nguồn rule: khối `targets`.
// Tháng không khai KPI thì không có khoá — tab phải ẩn thanh, đừng đoán số.
//
// KPI là của CẢ TEAM (Sỹ Anh chốt 30/10/2026: không có KPI từng người) — đặt cạnh số đã cắt
// theo một nước là sai thước đo. Người chỉ xem một phần nước nhận bảng rỗng → tab ẩn thanh.
export async function GET(req: Request) {
    const a = await getAccess(req);
    if (!a || !seesAllMarkets(a)) {
        return NextResponse.json({ monthly_revenue_vnd: {}, months: 0 });
    }
    return NextResponse.json({
        monthly_revenue_vnd: MONTHLY_REVENUE_TARGETS,
        months: Object.keys(MONTHLY_REVENUE_TARGETS).length,
    });
}

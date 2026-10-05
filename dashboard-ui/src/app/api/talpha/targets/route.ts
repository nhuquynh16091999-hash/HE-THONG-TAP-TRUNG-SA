import { NextResponse } from "next/server";
import { MONTHLY_REVENUE_TARGETS, MARKETER_MONTHLY_TARGETS } from "@/lib/talpha/rules";
import { getAccess } from "@/lib/talpha/access";
import { seesAllMarkets } from "@/lib/talpha/access-rules";

export const dynamic = "force-dynamic";

// KPI doanh số theo tháng cho thanh tiến độ ở hero các tab (client component không
// đọc được config/talpha_rules.json vì loader dùng fs). Nguồn rule: khối `targets`.
// Tháng không khai KPI thì không có khoá — tab phải ẩn thanh, đừng đoán số.
//
// KPI là của CẢ CÔNG TY và từng người — đặt cạnh số đã cắt theo một team là sai thước đo
// (và lộ KPI người team khác). Người chỉ xem một phần nước nhận bảng rỗng → tab ẩn thanh.
export async function GET(req: Request) {
    const a = await getAccess(req);
    if (!a || !seesAllMarkets(a)) {
        return NextResponse.json({ monthly_revenue_vnd: {}, marketer_monthly_ship_vnd: {}, months: 0 });
    }
    return NextResponse.json({
        monthly_revenue_vnd: MONTHLY_REVENUE_TARGETS,
        // key = tên hiển thị marketer, khớp cột marketer của /api/talpha/marketer-perf
        marketer_monthly_ship_vnd: MARKETER_MONTHLY_TARGETS,
        months: Object.keys(MONTHLY_REVENUE_TARGETS).length,
    });
}

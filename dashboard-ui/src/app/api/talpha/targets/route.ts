import { NextResponse } from "next/server";
import { MONTHLY_REVENUE_TARGETS, MARKETER_MONTHLY_TARGETS } from "@/lib/talpha/rules";

export const dynamic = "force-dynamic";

// KPI doanh số theo tháng cho thanh tiến độ ở hero các tab (client component không
// đọc được config/talpha_rules.json vì loader dùng fs). Nguồn rule: khối `targets`.
// Tháng không khai KPI thì không có khoá — tab phải ẩn thanh, đừng đoán số.
export async function GET() {
    return NextResponse.json({
        monthly_revenue_vnd: MONTHLY_REVENUE_TARGETS,
        // key = tên hiển thị marketer, khớp cột marketer của /api/talpha/marketer-perf
        marketer_monthly_ship_vnd: MARKETER_MONTHLY_TARGETS,
        months: Object.keys(MONTHLY_REVENUE_TARGETS).length,
    });
}

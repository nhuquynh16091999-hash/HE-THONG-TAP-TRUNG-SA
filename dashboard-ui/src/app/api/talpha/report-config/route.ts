import { NextResponse } from "next/server";
import { REPORT_START_DATE } from "@/lib/talpha/rules";

export const dynamic = "force-dynamic";

// Mốc gốc của báo cáo số cho bộ chọn ngày (client component không đọc được
// config/talpha_rules.json vì loader dùng fs). Xem _report_start_note.
export async function GET() {
    return NextResponse.json({ report_start_date: REPORT_START_DATE });
}

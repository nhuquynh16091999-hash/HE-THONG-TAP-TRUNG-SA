import { NextResponse } from "next/server";
import { MARKETS_PUBLIC } from "@/lib/talpha/rules";

export const dynamic = "force-dynamic";

// Ba thị trường cho giao diện (client component không đọc được config/talpha_rules.json
// vì loader dùng fs). Trước 15/09/2026 giao diện gõ cứng một bảng tỷ giá riêng chỉ có
// Đài — thêm nước là tiền nước đó bị nhân 800 trên các tab. Nay chỉ còn một nguồn.
export async function GET() {
    return NextResponse.json(MARKETS_PUBLIC);
}

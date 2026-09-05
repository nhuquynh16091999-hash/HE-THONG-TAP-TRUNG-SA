import { NextResponse } from "next/server";
import { PRODUCT_COSTS } from "@/lib/talpha/rules";

export const dynamic = "force-dynamic";

// E2 — bảng giá vốn theo SKU cho tab "P&L theo SP" (client component không đọc được
// config/talpha_rules.json vì loader dùng fs). Nguồn rule: khối products trong JSON.
// SKU không có trong bảng = CHƯA KHAI giá vốn → tab để trống, không tính lãi gộp.
export async function GET() {
    const costs: Record<string, number> = {};
    for (const [sku, v] of Object.entries(PRODUCT_COSTS)) costs[sku] = v.cost_price_vnd;
    return NextResponse.json({ costs, skus: Object.keys(costs).length });
}

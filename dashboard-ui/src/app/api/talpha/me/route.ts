import { NextResponse } from "next/server";
import { publicMode, requireAccess } from "@/lib/talpha/access";
import { MARKET_CODE, ROLES, TEAMS } from "@/lib/talpha/access-rules";

export const dynamic = "force-dynamic";

// Người đang xem là ai, thấy tab nào, nước nào — shell dựng menu và nút chọn nước từ đây.
// Chỉ để HIỆN cho đúng; chặn thật nằm ở proxy.ts và từng route.
export async function GET(req: Request) {
    const { a, res } = await requireAccess(req);
    if (res) return res;
    return NextResponse.json({
        kind: a.kind,
        name: a.name,
        email: a.email,
        role: a.role,
        role_label: a.roleLabel,
        full: a.full,
        tabs: a.tabs,
        markets: a.codes,
        teams: a.teams,
        public_mode: publicMode(),
        // Danh mục vai trò + team cho trang Quản lý User — chỉ người quản lý được người dùng.
        ...(a.full ? {
            catalog: {
                roles: Object.entries(ROLES).map(([key, r]) => ({ key, label: r.label, desc: r.desc || "", full: !!r.full })),
                teams: Object.entries(TEAMS).map(([key, t]) => ({
                    key, name: t.name, leader: t.leader || "",
                    markets: t.markets.map((m) => MARKET_CODE[m] || m),
                })),
            },
        } : {}),
    });
}

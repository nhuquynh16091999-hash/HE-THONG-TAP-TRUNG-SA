// ═══════════════════════════════════════════════════════════════════
// Ai đang gọi — phía máy chủ. Luật quyền ở ./access-rules.ts (thuần, có test);
// file này chỉ tìm ra NGƯỜI: chìa nội bộ (bot) → phiên đăng nhập → chế độ mở.
//
// Đọc lại tài khoản từ kho người dùng MỖI lượt, không tin quyền ghi trong cookie:
// giám đốc đổi team hay xoá một người ở /admin là có hiệu lực ngay lượt bấm sau,
// không phải chờ người đó đăng xuất.
// ═══════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { loadUsers } from "@/lib/users";
import { accessForUser, fullAccess, type Access } from "./access-rules";
import { isInternalRequest } from "./internal-token";

/** DASHBOARD_PUBLIC=true — bỏ đăng nhập, ai vào cũng như giám đốc (xem middleware cũ, 08/09/2026). */
export function publicMode(): boolean {
    return String(process.env.DASHBOARD_PUBLIC || "").toLowerCase() === "true";
}

type SessionLike = { user?: { id?: string | null; email?: string | null } | null } | null | undefined;

export function accessFromSession(session: SessionLike): Access | null {
    const id = session?.user?.id || null;
    const email = (session?.user?.email || "").toLowerCase();
    if (!id && !email) return null;
    const users = loadUsers();
    const u = (id && users.find((x) => x.id === id)) || (email && users.find((x) => x.email.toLowerCase() === email)) || null;
    if (!u || u.status === "pending") return null;
    return accessForUser(u);
}

/**
 * Quyền của lượt gọi. Thứ tự: chìa nội bộ → người đăng nhập → chế độ mở. Người đã đăng
 * nhập thì theo quyền của họ kể cả khi chế độ mở đang bật (để thử phân quyền mà không
 * phải khoá dashboard). null = chưa đăng nhập.
 */
export async function getAccess(req: Request, session?: SessionLike): Promise<Access | null> {
    if (isInternalRequest(req)) return fullAccess("internal", "Hệ thống");
    const s = session !== undefined ? session : await auth();
    const a = accessFromSession(s);
    if (a) return a;
    return publicMode() ? fullAccess("public", "Chế độ mở") : null;
}

export const chuaDangNhap = () => NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
export const khongDuQuyen = (error = "Tài khoản không có quyền xem mục này") => NextResponse.json({ error }, { status: 403 });

/** Cho route: quyền của lượt gọi, hoặc phản hồi 401 trả thẳng. */
export async function requireAccess(req: Request): Promise<{ a: Access; res: null } | { a: null; res: NextResponse }> {
    const a = await getAccess(req);
    return a ? { a, res: null } : { a: null, res: chuaDangNhap() };
}

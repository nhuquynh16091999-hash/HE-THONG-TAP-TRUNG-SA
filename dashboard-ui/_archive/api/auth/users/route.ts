import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { loadUsers, withUsersLock } from "@/lib/users";

const VALID_STATUSES = ["active", "pending"];
const VALID_ROLES = ["admin", "project_lead", "viewer"];

// ─── GET: Liệt kê users (admin only) ───
export async function GET() {
    const session = await auth();
    if (!session || (session.user as any)?.role !== "admin") {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    try {
        const users = loadUsers();
        const safeUsers = users.map(({ password, ...u }) => u);
        return NextResponse.json(safeUsers);
    } catch {
        return NextResponse.json({ error: "Lỗi hệ thống" }, { status: 500 });
    }
}

// ─── PATCH: Cập nhật user (approve, đổi role, gán projects) ───
export async function PATCH(req: Request) {
    const session = await auth();
    if (!session || (session.user as any)?.role !== "admin") {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    try {
        const { id, status, role, projects } = await req.json();

        if (!id) {
            return NextResponse.json({ error: "Thiếu user ID" }, { status: 400 });
        }

        // Validate trước khi lock
        if (status && !VALID_STATUSES.includes(status)) {
            return NextResponse.json({ error: `Status không hợp lệ. Chỉ chấp nhận: ${VALID_STATUSES.join(", ")}` }, { status: 400 });
        }
        if (role && !VALID_ROLES.includes(role)) {
            return NextResponse.json({ error: `Role không hợp lệ. Chỉ chấp nhận: ${VALID_ROLES.join(", ")}` }, { status: 400 });
        }
        if (projects && (!Array.isArray(projects) || !projects.every((p: unknown) => typeof p === "string"))) {
            return NextResponse.json({ error: "Projects phải là mảng string" }, { status: 400 });
        }

        let safeUser: Record<string, unknown> | null = null;

        // Đọc-ghi với file lock
        await withUsersLock((users) => {
            const idx = users.findIndex((u) => u.id === id);
            if (idx === -1) throw new Error("NOT_FOUND");

            if (status) users[idx].status = status;
            if (role) users[idx].role = role;
            if (projects) users[idx].projects = projects;

            const { password, ...safe } = users[idx];
            safeUser = safe;
            return users;
        });

        return NextResponse.json({ message: "Cập nhật thành công", user: safeUser });
    } catch (err: any) {
        if (err?.message === "NOT_FOUND") {
            return NextResponse.json({ error: "User không tồn tại" }, { status: 404 });
        }
        if (typeof err?.message === "string" && err.message.includes("hosted env")) {
            return NextResponse.json({ error: "User write disabled on hosted deployment (read-only mode)" }, { status: 503 });
        }
        return NextResponse.json({ error: "Lỗi hệ thống" }, { status: 500 });
    }
}

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { loadUsers } from "@/lib/users";

// ─── Project mà deployment này phục vụ (TALPHA-only) ───
// Map route mode → project ID; mặc định TALPHA cho repo single-project.
const ROUTE_TO_PROJECT: Record<string, string> = { talpha: "TALPHA" };
const DEPLOYMENT_PROJECT =
    ROUTE_TO_PROJECT[(process.env.NEXT_PUBLIC_DEPLOYMENT_MODE || "talpha").toLowerCase()] ||
    "TALPHA";

// User truy cập được khi có wildcard "*" hoặc thuộc đúng project của deployment.
function canAccessDeployment(projects: string[]): boolean {
    return projects.includes("*") || projects.includes(DEPLOYMENT_PROJECT);
}

// ─── Validate credentials (called from NextAuth authorize callback) ───
export async function POST(req: Request) {
    try {
        const { email, password } = await req.json();

        if (!email || !password) {
            return NextResponse.json(null, { status: 400 });
        }

        // Nguồn danh sách: lib/users.ts (biến USERS_JSON trên máy chủ, hoặc
        // config/users.json khi chạy trong repo). Không đọc file ở đây nữa.
        const users = loadUsers();
        if (!users.length) {
            console.error("Không đọc được danh sách người dùng — kiểm USERS_JSON / config/users.json");
            return NextResponse.json(null, { status: 500 });
        }

        const user = users.find((u) => u.email.toLowerCase() === email.toLowerCase());
        if (!user) {
            return NextResponse.json(null, { status: 401 });
        }

        // Kiểm tra tài khoản đang chờ duyệt
        if (user.status === "pending") {
            return NextResponse.json(
                { error: "Tài khoản đang chờ duyệt" },
                { status: 403 }
            );
        }

        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) {
            return NextResponse.json(null, { status: 401 });
        }

        // TALPHA-only: chặn tài khoản hợp lệ nhưng không có quyền vào deployment này
        // (vd account dự án cũ stramark@levelup projects=['STRAMARK']).
        if (!canAccessDeployment(user.projects)) {
            return NextResponse.json(
                { error: "Tài khoản không có quyền truy cập dashboard này" },
                { status: 403 }
            );
        }

        // Return user without password
        return NextResponse.json({
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            projects: user.projects,
        });
    } catch {
        return NextResponse.json(null, { status: 500 });
    }
}

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";

// ─── Types ───
interface UserRecord {
    id: string;
    email: string;
    name: string;
    password: string;
    role: "admin" | "project_lead" | "viewer";
    projects: string[];
    status?: "active" | "pending";
}

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

        // Vercel/Render mode: parse từ env USERS_JSON (1 dòng).
        // Local dev: fallback đọc file ../config/users.json.
        let users: UserRecord[] = [];
        if (process.env.USERS_JSON) {
            try {
                users = JSON.parse(process.env.USERS_JSON);
            } catch {
                console.error("USERS_JSON parse failed");
                return NextResponse.json(null, { status: 500 });
            }
        } else {
            const usersPath = path.join(
                process.cwd(),
                "..",
                "config",
                "users.json"
            );
            try {
                const data = fs.readFileSync(usersPath, "utf-8");
                users = JSON.parse(data);
            } catch {
                console.error("Failed to load users.json from:", usersPath);
                return NextResponse.json(null, { status: 500 });
            }
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

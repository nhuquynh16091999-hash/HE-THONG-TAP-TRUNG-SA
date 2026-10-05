import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import bcrypt from "bcryptjs";
import { loadUsers, withUsersLock, isEnvMode, type UserRecord, type UserRole } from "@/lib/users";
import { accessFromSession } from "@/lib/talpha/access";
import { ROLES, TEAMS } from "@/lib/talpha/access-rules";

// Đọc/ghi users.json đi qua lib/users.ts — nơi duy nhất giữ KHOÁ FILE.
// Bản trước tự đọc tự ghi ở đây, không khoá, và ghi thụt lề 2 trong khi bản kia
// ghi thụt lề 4: hai người sửa cùng lúc là mất một bản ghi.

// Quản lý người dùng: admin kỹ thuật HOẶC giám đốc. Hỏi lại kho người dùng chứ không tin
// vai trò ghi trong cookie — người vừa bị hạ quyền không còn sửa được ai.
function canManageUsers(session: unknown): boolean {
    return !!accessFromSession(session as Parameters<typeof accessFromSession>[0])?.full;
}

/** Vai trò phải là vai khai ở access.roles; team phải là team khai ở access.teams (hoặc "*"). */
function kiemVaiTeam(role: unknown, teams: unknown): { loi: string } | { role?: UserRole; teams?: string[] } {
    if (role !== undefined && role !== null && role !== "" && !ROLES[String(role)]) {
        return { loi: `Vai trò "${role}" chưa khai ở talpha_rules.json → access.roles` };
    }
    if (teams === undefined || teams === null) return { role: (role || undefined) as UserRole | undefined };
    if (!Array.isArray(teams)) return { loi: "teams phải là danh sách" };
    const ds = [...new Set(teams.map(String))];
    const la = ds.filter((t) => t !== "*" && !TEAMS[t]);
    if (la.length) return { loi: `Team không có: ${la.join(", ")}` };
    return { role: (role || undefined) as UserRole | undefined, teams: ds.includes("*") ? ["*"] : ds };
}

/** Chặn chung cho mọi thao tác GHI: phải có quyền, và phải ghi được. */
async function guardWrite() {
    const session = await auth();
    if (!session || !canManageUsers(session)) {
        return { session: null, res: NextResponse.json({ error: "Unauthorized" }, { status: 403 }) };
    }
    if (isEnvMode()) {
        return {
            session,
            res: NextResponse.json(
                { error: "Máy chủ đang chạy chế độ chỉ đọc (USERS_JSON) — sửa biến môi trường rồi khởi động lại" },
                { status: 503 },
            ),
        };
    }
    return { session, res: null };
}

// ─── GET: danh sách người dùng (ẩn mật khẩu) ───
export async function GET() {
    const session = await auth();
    if (!session || !canManageUsers(session)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
    return NextResponse.json(loadUsers().map(({ password: _bo, ...rest }) => rest));
}

// ─── POST: thêm người dùng ───
export async function POST(req: Request) {
    const { res } = await guardWrite();
    if (res) return res;

    const body = await req.json();
    const { name, password, role, projects, teams } = body;
    // Tên đăng nhập ("loc", "thai"…) — ô cũ tên `email`, đăng nhập so không phân biệt hoa thường.
    const email = String(body.email || "").trim().toLowerCase();
    if (!email || !name || !password || !role) {
        return NextResponse.json({ error: "Thiếu trường bắt buộc" }, { status: 400 });
    }
    const vt = kiemVaiTeam(role, teams ?? []);
    if ("loi" in vt) return NextResponse.json({ error: vt.loi }, { status: 400 });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser: UserRecord = {
        id: String(Date.now()),
        email, name, password: hashedPassword, role,
        projects: projects || [],
        teams: vt.teams || [],
    };

    // Kiểm trùng email NẰM TRONG khoá — kiểm ngoài khoá thì hai lần thêm cùng lúc
    // đều thấy "chưa trùng" rồi cùng ghi.
    let trung = false;
    await withUsersLock((users) => {
        if (users.some((u) => u.email.toLowerCase() === email)) { trung = true; return users; }
        return [...users, newUser];
    });
    if (trung) return NextResponse.json({ error: "Email đã tồn tại" }, { status: 409 });

    const { password: _bo, ...userWithoutPassword } = newUser;
    return NextResponse.json(userWithoutPassword, { status: 201 });
}

// ─── PUT: sửa người dùng ───
export async function PUT(req: Request) {
    const { session, res } = await guardWrite();
    if (res) return res;

    const body = await req.json();
    const { id, name, password, role, projects, teams } = body;
    const email = body.email ? String(body.email).trim().toLowerCase() : "";
    if (!id) return NextResponse.json({ error: "Thiếu ID người dùng" }, { status: 400 });
    const vt = kiemVaiTeam(role, teams);
    if ("loi" in vt) return NextResponse.json({ error: vt.loi }, { status: 400 });
    // Tự hạ quyền mình là tự khoá cửa /admin — không còn ai sửa lại được.
    if ((session!.user as { id?: string } | undefined)?.id === id && role && !ROLES[String(role)]?.full) {
        return NextResponse.json({ error: "Không tự hạ quyền giám đốc của chính mình" }, { status: 400 });
    }

    const hashedPassword = password ? await bcrypt.hash(password, 10) : null;

    // Kết quả lấy ra khỏi callback qua một hộp — TypeScript không theo dõi được
    // biến bị gán bên trong closure nên gán thẳng vào `let` sẽ bị thu hẹp về never.
    const ket: { loi?: { error: string; status: number }; daSua?: UserRecord } = {};
    await withUsersLock((users) => {
        const idx = users.findIndex((u) => u.id === id);
        if (idx === -1) { ket.loi = { error: "Không tìm thấy người dùng", status: 404 }; return users; }
        if (email && email !== users[idx].email.toLowerCase() && users.some((u) => u.email.toLowerCase() === email)) {
            ket.loi = { error: "Email đã tồn tại", status: 409 }; return users;
        }
        if (email) users[idx].email = email;
        if (name) users[idx].name = name;
        if (role) users[idx].role = role;
        if (projects) users[idx].projects = projects;
        if (vt.teams) users[idx].teams = vt.teams;
        if (hashedPassword) users[idx].password = hashedPassword;
        ket.daSua = users[idx];
        return users;
    });
    if (ket.loi) return NextResponse.json({ error: ket.loi.error }, { status: ket.loi.status });

    const { password: _bo, ...userWithoutPassword } = ket.daSua!;
    return NextResponse.json(userWithoutPassword);
}

// ─── DELETE: xoá người dùng ───
export async function DELETE(req: Request) {
    const { session, res } = await guardWrite();
    if (res) return res;

    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Thiếu ID người dùng" }, { status: 400 });
    if ((session!.user as { id?: string } | undefined)?.id === id) {
        return NextResponse.json({ error: "Không thể tự xoá chính mình" }, { status: 400 });
    }

    let thay = false;
    await withUsersLock((users) => {
        const con = users.filter((u) => u.id !== id);
        thay = con.length !== users.length;
        return thay ? con : users;
    });
    if (!thay) return NextResponse.json({ error: "Không tìm thấy người dùng" }, { status: 404 });

    return NextResponse.json({ success: true });
}

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import bcrypt from "bcryptjs";
import { loadUsers, withUsersLock, isEnvMode, type UserRecord } from "@/lib/users";

// Đọc/ghi users.json đi qua lib/users.ts — nơi duy nhất giữ KHOÁ FILE.
// Bản trước tự đọc tự ghi ở đây, không khoá, và ghi thụt lề 2 trong khi bản kia
// ghi thụt lề 4: hai người sửa cùng lúc là mất một bản ghi.

// Quản lý người dùng: admin kỹ thuật HOẶC giám đốc. Marketer và sale không đụng vào.
function canManageUsers(session: unknown): boolean {
    const role = (session as { user?: { role?: string } } | null)?.user?.role;
    return role === "admin" || role === "director";
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

    const { email, name, password, role, projects } = await req.json();
    if (!email || !name || !password || !role) {
        return NextResponse.json({ error: "Thiếu trường bắt buộc" }, { status: 400 });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser: UserRecord = {
        id: String(Date.now()),
        email, name, password: hashedPassword, role,
        projects: projects || [],
    };

    // Kiểm trùng email NẰM TRONG khoá — kiểm ngoài khoá thì hai lần thêm cùng lúc
    // đều thấy "chưa trùng" rồi cùng ghi.
    let trung = false;
    await withUsersLock((users) => {
        if (users.some((u) => u.email === email)) { trung = true; return users; }
        return [...users, newUser];
    });
    if (trung) return NextResponse.json({ error: "Email đã tồn tại" }, { status: 409 });

    const { password: _bo, ...userWithoutPassword } = newUser;
    return NextResponse.json(userWithoutPassword, { status: 201 });
}

// ─── PUT: sửa người dùng ───
export async function PUT(req: Request) {
    const { res } = await guardWrite();
    if (res) return res;

    const { id, email, name, password, role, projects } = await req.json();
    if (!id) return NextResponse.json({ error: "Thiếu ID người dùng" }, { status: 400 });

    const hashedPassword = password ? await bcrypt.hash(password, 10) : null;

    // Kết quả lấy ra khỏi callback qua một hộp — TypeScript không theo dõi được
    // biến bị gán bên trong closure nên gán thẳng vào `let` sẽ bị thu hẹp về never.
    const ket: { loi?: { error: string; status: number }; daSua?: UserRecord } = {};
    await withUsersLock((users) => {
        const idx = users.findIndex((u) => u.id === id);
        if (idx === -1) { ket.loi = { error: "Không tìm thấy người dùng", status: 404 }; return users; }
        if (email && email !== users[idx].email && users.some((u) => u.email === email)) {
            ket.loi = { error: "Email đã tồn tại", status: 409 }; return users;
        }
        if (email) users[idx].email = email;
        if (name) users[idx].name = name;
        if (role) users[idx].role = role;
        if (projects) users[idx].projects = projects;
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

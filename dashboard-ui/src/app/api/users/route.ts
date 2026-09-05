import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";

// ─── Types (duplicated to avoid Edge Runtime issues from importing auth.ts) ───
interface UserRecord {
    id: string;
    email: string;
    name: string;
    password: string;
    role: "admin" | "project_lead" | "viewer";
    projects: string[];
}

const USERS_FILE = path.join(process.cwd(), "..", "config", "users.json");

function isEnvMode(): boolean {
    return !!process.env.USERS_JSON;
}

function loadUsers(): UserRecord[] {
    if (isEnvMode()) {
        try {
            return JSON.parse(process.env.USERS_JSON!);
        } catch {
            return [];
        }
    }
    try {
        return JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
    } catch {
        return [];
    }
}

function saveUsers(users: UserRecord[]): void {
    if (isEnvMode()) {
        // Vercel filesystem read-only — write không hỗ trợ. Caller cần check trước.
        throw new Error("User write disabled on hosted env (USERS_JSON mode). Edit users.json local rồi update env var.");
    }
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// ─── GET: List all users (hide passwords) ───
export async function GET() {
    const session = await auth();
    if (!session || (session.user as any)?.role !== "admin") {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const users = loadUsers().map(({ password, ...rest }) => rest);
    return NextResponse.json(users);
}

// ─── POST: Create a new user ───
export async function POST(req: Request) {
    const session = await auth();
    if (!session || (session.user as any)?.role !== "admin") {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
    if (isEnvMode()) {
        return NextResponse.json({ error: "User write disabled on hosted deployment (read-only mode)" }, { status: 503 });
    }

    const body = await req.json();
    const { email, name, password, role, projects } = body;

    if (!email || !name || !password || !role) {
        return NextResponse.json(
            { error: "Missing required fields" },
            { status: 400 }
        );
    }

    const users = loadUsers();
    if (users.some((u) => u.email === email)) {
        return NextResponse.json(
            { error: "Email already exists" },
            { status: 409 }
        );
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser: UserRecord = {
        id: String(Date.now()),
        email,
        name,
        password: hashedPassword,
        role,
        projects: projects || [],
    };

    users.push(newUser);
    saveUsers(users);

    const { password: _, ...userWithoutPassword } = newUser;
    return NextResponse.json(userWithoutPassword, { status: 201 });
}

// ─── PUT: Update a user ───
export async function PUT(req: Request) {
    const session = await auth();
    if (!session || (session.user as any)?.role !== "admin") {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
    if (isEnvMode()) {
        return NextResponse.json({ error: "User write disabled on hosted deployment (read-only mode)" }, { status: 503 });
    }

    const body = await req.json();
    const { id, email, name, password, role, projects } = body;

    if (!id) {
        return NextResponse.json({ error: "Missing user ID" }, { status: 400 });
    }

    const users = loadUsers();
    const idx = users.findIndex((u) => u.id === id);
    if (idx === -1) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Check email uniqueness (if changed)
    if (email && email !== users[idx].email && users.some((u) => u.email === email)) {
        return NextResponse.json({ error: "Email already exists" }, { status: 409 });
    }

    if (email) users[idx].email = email;
    if (name) users[idx].name = name;
    if (role) users[idx].role = role;
    if (projects) users[idx].projects = projects;
    if (password) {
        users[idx].password = await bcrypt.hash(password, 10);
    }

    saveUsers(users);

    const { password: _, ...userWithoutPassword } = users[idx];
    return NextResponse.json(userWithoutPassword);
}

// ─── DELETE: Remove a user ───
export async function DELETE(req: Request) {
    const session = await auth();
    if (!session || (session.user as any)?.role !== "admin") {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
    if (isEnvMode()) {
        return NextResponse.json({ error: "User write disabled on hosted deployment (read-only mode)" }, { status: 503 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
        return NextResponse.json({ error: "Missing user ID" }, { status: 400 });
    }

    // Prevent self-deletion
    if ((session.user as any)?.id === id) {
        return NextResponse.json(
            { error: "Cannot delete yourself" },
            { status: 400 }
        );
    }

    const users = loadUsers();
    const filtered = users.filter((u) => u.id !== id);

    if (filtered.length === users.length) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    saveUsers(filtered);
    return NextResponse.json({ success: true });
}

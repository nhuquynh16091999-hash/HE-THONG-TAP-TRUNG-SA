/**
 * Helper đọc/ghi users.json với file lock — tránh race condition.
 *
 * Vercel/Render mode: env USERS_JSON = nội dung users.json (1 dòng) → read-only,
 * withUsersLock sẽ throw vì filesystem read-only.
 * Local dev: đọc/ghi file ../config/users.json như cũ.
 */
import fs from "fs";
import path from "path";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const lockfile = require("proper-lockfile");

export interface UserRecord {
    id: string;
    email: string;
    name: string;
    password: string;
    role: string;
    projects: string[];
    status?: "active" | "pending";
}

const USERS_PATH = path.join(process.cwd(), "..", "config", "users.json");

function isEnvMode(): boolean {
    return !!process.env.USERS_JSON;
}

/**
 * Đọc users.json (không lock).
 * Vercel mode: parse từ env USERS_JSON.
 */
export function loadUsers(): UserRecord[] {
    if (isEnvMode()) {
        try {
            return JSON.parse(process.env.USERS_JSON!);
        } catch (e) {
            console.error("USERS_JSON parse failed:", e);
            return [];
        }
    }
    const data = fs.readFileSync(USERS_PATH, "utf-8");
    return JSON.parse(data);
}

/**
 * Ghi users.json (không lock — chỉ dùng bên trong withUsersLock).
 */
function saveUsers(users: UserRecord[]) {
    fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 4) + "\n", "utf-8");
}

/**
 * Thực thi callback với file lock trên users.json.
 * Vercel mode: throw vì filesystem read-only.
 */
export async function withUsersLock(
    callback: (users: UserRecord[]) => UserRecord[]
): Promise<UserRecord[]> {
    if (isEnvMode()) {
        throw new Error("User write not supported on hosted env (USERS_JSON mode). Edit users.json local rồi update env var Vercel.");
    }
    const release = await lockfile.lock(USERS_PATH, {
        retries: { retries: 5, minTimeout: 100, maxTimeout: 1000 },
        stale: 10000,
    });

    try {
        const users = loadUsers();
        const updated = callback(users);
        saveUsers(updated);
        return updated;
    } finally {
        await release();
    }
}

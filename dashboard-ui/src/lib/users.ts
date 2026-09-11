/**
 * TALPHA — MỘT chỗ duy nhất đọc/ghi danh sách người dùng.
 *
 * Hai chế độ, chọn theo môi trường:
 *   • `USERS_JSON` có giá trị  → danh sách nằm trong biến môi trường, CHỈ ĐỌC.
 *     Đây là chế độ đang chạy trên máy chủ: /opt/talpha KHÔNG có config/users.json,
 *     toàn bộ tài khoản nằm trong .env.local. Thêm/sửa người dùng = sửa biến đó
 *     rồi restart, nút "Thêm người dùng" trên /admin sẽ báo 503 — đúng như thiết kế.
 *   • Không có `USERS_JSON` → đọc/ghi file `config/users.json` ở gốc repo, CÓ KHOÁ FILE.
 *
 * ⚠️ 11/09/2026: trước đây logic này bị chép làm BA bản — `lib/users.ts` (có khoá,
 * không ai gọi), `api/users/route.ts` (KHÔNG khoá, ghi thụt lề 2) và
 * `api/auth/validate/route.ts` (chỉ đọc). Hai bản ghi khác nhau cùng sửa một file
 * mà không bản nào giữ khoá: hai người sửa user cùng lúc là mất một bản ghi, và
 * file đổi thụt lề qua lại mỗi lần ghi. Nay mọi route đều đi qua đây.
 */
import fs from "fs";
import { configPath } from "@/lib/talpha/config-path";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const lockfile = require("proper-lockfile");

export type UserRole = "admin" | "director" | "marketer" | "sale";

export interface UserRecord {
    id: string;
    email: string;
    name: string;
    password: string;
    role: UserRole;
    projects: string[];
    status?: "active" | "pending";
}

const USERS_PATH = configPath("users.json");

/** Danh sách nằm trong biến môi trường (máy chủ) ⇒ không ghi được. */
export function isEnvMode(): boolean {
    return !!process.env.USERS_JSON;
}

/** Đọc danh sách người dùng. Lỗi đọc/parse → mảng rỗng (login sẽ trả 401, không sập). */
export function loadUsers(): UserRecord[] {
    if (isEnvMode()) {
        try {
            return JSON.parse(process.env.USERS_JSON!);
        } catch (e) {
            console.error("USERS_JSON không parse được:", e);
            return [];
        }
    }
    try {
        return JSON.parse(fs.readFileSync(USERS_PATH, "utf-8"));
    } catch (e) {
        console.error("Không đọc được", USERS_PATH, e);
        return [];
    }
}

/** Thụt lề 4 — giữ nguyên kiểu file đang có, đừng để mỗi lần ghi lại đổi cả file. */
function saveUsers(users: UserRecord[]) {
    fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 4) + "\n", "utf-8");
}

/**
 * Sửa danh sách người dùng dưới KHOÁ FILE — đọc, gọi callback, ghi lại.
 * Chế độ USERS_JSON thì ném lỗi: không có file để ghi.
 */
export async function withUsersLock(
    callback: (users: UserRecord[]) => UserRecord[] | Promise<UserRecord[]>,
): Promise<UserRecord[]> {
    if (isEnvMode()) {
        throw new Error(
            "Không ghi được người dùng ở chế độ USERS_JSON (máy chủ). " +
            "Sửa biến USERS_JSON trong .env.local rồi khởi động lại dashboard.",
        );
    }
    const release = await lockfile.lock(USERS_PATH, {
        retries: { retries: 5, minTimeout: 100, maxTimeout: 1000 },
        stale: 10000,
    });
    try {
        const updated = await callback(loadUsers());
        saveUsers(updated);
        return updated;
    } finally {
        await release();
    }
}

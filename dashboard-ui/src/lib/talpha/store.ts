/**
 * Kho JSON có khoá file — dùng cho dữ liệu do người dùng nhập trên dashboard
 * (sao kê 3PL, bảng gán sale). Cùng cơ chế lock với lib/users.ts.
 *
 * Vì sao KHÔNG ghi thẳng vào BigQuery: BQ của dự án chạy free tier, chỉ được
 * LOAD JOB chứ không streaming/DML (rule trong .claude/skills/talpha-system).
 * Ghi từng bản sao kê bằng load job là lãng phí và dễ hỏng nửa chừng. Dữ liệu
 * này nhỏ, sửa thường xuyên, và chỉ dashboard đọc — để ở file là đúng chỗ.
 *
 * Thư mục `data/` nằm ngoài git (xem .gitignore) vì chứa số tiền thật.
 */
import fs from "fs";
import path from "path";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const lockfile = require("proper-lockfile");

const DATA_DIR = path.join(process.cwd(), "..", "data");

function filePath(name: string): string {
    if (!/^[a-z0-9_-]+$/i.test(name)) throw new Error(`Tên kho không hợp lệ: ${name}`);
    return path.join(DATA_DIR, `${name}.json`);
}

function ensureDir() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

/** Đọc kho. Chưa có file thì trả giá trị mặc định, KHÔNG ném lỗi. */
export function readStore<T>(name: string, fallback: T): T {
    const p = filePath(name);
    if (!fs.existsSync(p)) return fallback;
    try {
        return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
    } catch (e) {
        console.error(`Kho ${name} hỏng định dạng, dùng giá trị mặc định:`, e);
        return fallback;
    }
}

/**
 * Sửa kho dưới file lock — đọc, biến đổi, ghi lại trong cùng một lượt khoá,
 * để hai request cùng lúc không ghi đè nhau.
 */
export async function updateStore<T>(
    name: string,
    fallback: T,
    mutate: (current: T) => T,
): Promise<T> {
    ensureDir();
    const p = filePath(name);
    if (!fs.existsSync(p)) fs.writeFileSync(p, JSON.stringify(fallback, null, 2), "utf-8");

    const release = await lockfile.lock(p, { retries: { retries: 5, minTimeout: 60 } });
    try {
        const current = JSON.parse(fs.readFileSync(p, "utf-8")) as T;
        const next = mutate(current);
        fs.writeFileSync(p, JSON.stringify(next, null, 2), "utf-8");
        return next;
    } finally {
        await release();
    }
}

// ═══════════════════════════════════════════════════════════════════
// Chìa NỘI BỘ cho bot Zalo và việc nền trên cùng máy chủ (05/10/2026).
//
// Từ khi bật phân quyền, API đòi đăng nhập. Bot Zalo (sheet-report, realtime, tracking…),
// talpha-tracking (tracking/import lúc 6h) không đăng nhập được, nên chúng gửi header
// `x-talpha-token` với chìa đọc từ file `data/.internal_token`. File tự sinh ở lần đầu
// cần (ngẫu nhiên, chỉ root đọc), mỗi máy một chìa — không phải khai gì trong .env.local,
// và chìa không bao giờ rời máy. Bot đọc cùng file đó (ops/zalo-alerts/config.js).
//
// Không dùng "gọi từ 127.0.0.1 thì tin": Next tự điền x-forwarded-for chỉ khi header
// đó còn trống, người ngoài gõ sẵn header là qua.
//
// TALPHA_INTERNAL_TOKEN (nếu đặt) thay cho file; TALPHA_SYNC_TOKEN là chìa cũ của
// snapshot_cron.sh → sync-inventory, vẫn nhận.
// ═══════════════════════════════════════════════════════════════════
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { REPO_ROOT } from "./config-path";

export const INTERNAL_HEADER = "x-talpha-token";
const FILE = path.join(REPO_ROOT, "data", ".internal_token");

let cache: string | null = null;

/** Chìa nội bộ của máy này — chưa có thì sinh. */
export function internalToken(): string {
    if (process.env.TALPHA_INTERNAL_TOKEN) return process.env.TALPHA_INTERNAL_TOKEN;
    if (cache) return cache;
    try {
        const s = fs.readFileSync(FILE, "utf8").trim();
        if (s.length >= 32) return (cache = s);
    } catch { /* chưa có — sinh bên dưới */ }
    const moi = crypto.randomBytes(32).toString("hex");
    try {
        fs.mkdirSync(path.dirname(FILE), { recursive: true });
        // "wx": hai tiến trình cùng sinh thì chỉ một bản thắng, bản kia đọc lại bản thắng.
        fs.writeFileSync(FILE, moi + "\n", { mode: 0o600, flag: "wx" });
        return (cache = moi);
    } catch {
        const s = fs.readFileSync(FILE, "utf8").trim();
        return (cache = s);
    }
}

function bang(a: string, b: string): boolean {
    const x = Buffer.from(a), y = Buffer.from(b);
    return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Lượt gọi mang đúng chìa nội bộ (bot, việc nền) — được xem như giám đốc. */
export function isInternalRequest(req: Request): boolean {
    const got = req.headers.get(INTERNAL_HEADER);
    if (!got) return false;
    if (bang(got, internalToken())) return true;
    const cu = process.env.TALPHA_SYNC_TOKEN;
    return !!cu && bang(got, cu);
}

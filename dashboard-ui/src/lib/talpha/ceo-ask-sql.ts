// ═══════════════════════════════════════════════════════════════════
// TALPHA — guardrail SQL cho "Hỏi dashboard" (CEO-ask).
// Tách khỏi route.ts (A5) để CHỈ CÓ 1 danh sách từ khoá cấm: prompt builder
// cũng phải đọc danh sách này khi nhúng text tự do (tên sản phẩm) vào SQL —
// tên lọt 1 từ khoá cấm là câu truy vấn hợp lệ bị chặn oan.
// ═══════════════════════════════════════════════════════════════════

/** Từ khoá DDL/DML bị chặn — khớp theo RANH GIỚI TỪ, kể cả trong comment/chuỗi. */
export const BLOCKED_SQL_KEYWORDS = [
    "INSERT", "UPDATE", "DELETE", "DROP", "CREATE", "ALTER", "TRUNCATE", "MERGE",
    "GRANT", "REVOKE", "EXEC", "EXECUTE", "CALL", "BEGIN", "COMMIT", "ROLLBACK",
] as const;

/**
 * Làm sạch text tự do trước khi nhúng vào SQL sinh tự động (comment `--`).
 * Bỏ ký tự phá cú pháp và che từ khoá cấm để guardrail không chặn nhầm.
 */
export function sanitizeSqlComment(text: string): string {
    let s = String(text || "").replace(/[\r\n]+/g, " ").replace(/['"`;\\]|--/g, " ");
    for (const kw of BLOCKED_SQL_KEYWORDS) {
        // Chèn ZWNJ-free separator: giữ nguyên nghĩa cho người đọc, phá khớp \bKW\b.
        s = s.replace(new RegExp(`\\b${kw}\\b`, "gi"), (m) => `${m[0]}.${m.slice(1)}`);
    }
    return s.replace(/\s+/g, " ").trim();
}

/** Chỉ cho phép 1 câu SELECT/WITH đọc đúng dataset TALPHA. */
export function checkSql(raw: string, ids: { project: string; dataset: string }): { ok: boolean; reason?: string } {
    const q = raw.trim();
    const up = q.toUpperCase();
    if (!up.startsWith("SELECT") && !up.startsWith("WITH")) return { ok: false, reason: "Chỉ cho phép SELECT/WITH" };
    if (q.includes(";")) return { ok: false, reason: "Không cho phép nhiều câu lệnh (;)" };
    for (const kw of BLOCKED_SQL_KEYWORDS) {
        if (new RegExp(`\\b${kw}\\b`, "i").test(q)) return { ok: false, reason: `Từ khoá bị chặn: ${kw}` };
    }
    // Lock data access to the TALPHA dataset only.
    if (!q.includes(`${ids.project}.${ids.dataset}`)) {
        return { ok: false, reason: `Chỉ truy vấn được dataset ${ids.project}.${ids.dataset}` };
    }
    return { ok: true };
}

/**
 * Một số model (vd gemini-2.5-flash-lite) hay bọc SQL trong dấu nháy hoặc
 * JSON-stringify cả câu → gỡ lớp nháy thừa để checkSql không chặn nhầm.
 */
export function cleanSql(raw: string): string {
    let s = String(raw || "").trim();
    for (let n = 0; n < 2; n++) {
        if (s.length >= 2 &&
            ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'"))) {
            if (s[0] === '"') {
                try { s = JSON.parse(s); } catch { s = s.slice(1, -1); }
            } else {
                s = s.slice(1, -1);
            }
            s = s.trim();
        } else break;
    }
    return s;
}

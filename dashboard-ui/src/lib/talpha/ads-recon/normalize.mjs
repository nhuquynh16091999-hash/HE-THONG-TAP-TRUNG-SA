/**
 * CHUẨN HOÁ DỮ LIỆU THÔ — tên cột, số tiền, ngày tháng.
 *
 * Vì sao tách riêng: mỗi ngân hàng xuất một kiểu, Facebook đổi tên cột theo
 * ngôn ngữ giao diện. Nếu để code đối soát tự đoán cột thì mỗi lần đổi file
 * là phải sửa code. Ở đây chỉ có "đọc hiểu", không có nghiệp vụ — nên test
 * được từng hàm một.
 */

/** Bỏ dấu tiếng Việt, thường hoá, gộp mọi ký tự lạ thành khoảng trắng. */
export function normText(s) {
    return String(s ?? "")
        .normalize("NFD").replace(/[̀-ͯ]/g, "")
        .replace(/đ/g, "d").replace(/Đ/g, "D")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

/**
 * Đọc số tiền từ mọi kiểu viết gặp trong thực tế:
 *   "12.500.000"  "12,500,000"  "12 500 000,50"  "(1.200)"  "-1200"  "12.500.000 VND"
 * Trả về null nếu ô không phải số tiền.
 */
export function parseAmount(v) {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (v instanceof Date) return null;

    let s = String(v).trim();
    if (!s || /^[-–—]$/.test(s)) return null;

    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }        // kế toán: (1.200) = âm
    s = s.replace(/[^\d.,\-\s]/g, "").trim();                          // bỏ "VND", "đ", "₫"
    if (/^-/.test(s)) { neg = true; s = s.replace(/^-+/, ""); }
    s = s.replace(/\s/g, "");
    if (!s) return null;

    const lastDot = s.lastIndexOf(".");
    const lastComma = s.lastIndexOf(",");
    if (lastDot >= 0 && lastComma >= 0) {
        // Cái nào đứng sau là dấu thập phân
        if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
        else s = s.replace(/,/g, "");
    } else if (lastComma >= 0) {
        // "12,50" là thập phân; "12,500" và "1,200,000" là phân nhóm nghìn
        const tail = s.length - lastComma - 1;
        s = (tail === 3 || s.split(",").length > 2) ? s.replace(/,/g, "") : s.replace(",", ".");
    } else if (lastDot >= 0) {
        const tail = s.length - lastDot - 1;
        if (tail === 3 || s.split(".").length > 2) s = s.replace(/\./g, "");
    }

    const n = Number(s);
    if (!Number.isFinite(n)) return null;
    return neg ? -n : n;
}

const MONTH_FIRST_HINT = /^(0?[1-9]|1[0-2])[\/\-.]/;

/**
 * Đọc ngày → chuỗi "YYYY-MM-DD" (không giờ, vì đối soát chỉ cần tới ngày).
 * Ưu tiên dd/mm/yyyy — chuẩn Việt Nam. Ô ngày thật từ Excel thì đọc thẳng.
 */
export function parseDate(v) {
    if (v === null || v === undefined || v === "") return null;
    if (v instanceof Date && !isNaN(v)) return toISODate(v);
    if (typeof v === "number") {
        // Serial Excel (khoảng 1900-2100) — trường hợp ô không gắn định dạng ngày
        if (v > 20000 && v < 80000) return toISODate(new Date(Math.round((v - 25569) * 86400000)));
        return null;
    }

    const s = String(v).trim();
    if (!s) return null;

    let m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
    if (m) return fmt(m[1], m[2], m[3]);

    m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})/);
    if (m) {
        let [, a, b, y] = m;
        if (y.length === 2) y = String(2000 + Number(y));
        // Mặc định dd/mm; chỉ lật sang mm/dd khi ngày > 12 ở vế thứ hai
        if (Number(a) > 12 && Number(b) <= 12) return fmt(y, b, a);
        if (Number(b) > 12) return fmt(y, a, b);
        return fmt(y, b, a);
    }

    const d = new Date(s);
    if (!isNaN(d)) return toISODate(d);
    return null;

    function fmt(y, mo, da) {
        return `${y}-${String(Number(mo)).padStart(2, "0")}-${String(Number(da)).padStart(2, "0")}`;
    }
}

export function toISODate(d) {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function daysBetween(a, b) {
    return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}

export function addDays(iso, n) {
    return toISODate(new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000));
}

/** Tuần ISO — dùng làm mã kỳ đối soát, ví dụ "2026-W37". */
export function isoWeek(iso) {
    const d = new Date(Date.parse(iso + "T00:00:00Z"));
    const day = (d.getUTCDay() + 6) % 7;                 // thứ 2 = 0
    d.setUTCDate(d.getUTCDate() - day + 3);              // về thứ 5 cùng tuần
    const year = d.getUTCFullYear();
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const week = 1 + Math.round(((d - jan4) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
    return `${year}-W${String(week).padStart(2, "0")}`;
}

/** 4 số cuối thẻ, moi từ "Visa *4281", "MASTER*7733", "**** 1234", "x-9911". */
export function cardLast4(s) {
    if (!s) return null;
    const t = String(s);
    const m = t.match(/(?:\*+|x+|X+|#+|-|\s)(\d{4})(?!\d)/) || t.match(/(\d{4})(?!\d)\s*$/);
    return m ? m[1] : null;
}

/**
 * Tìm chỉ số cột theo danh sách bí danh.
 * Khớp chính xác trước, khớp chứa sau — để "so tien ghi no" không nuốt mất
 * cột "so tien" khi cả hai cùng tồn tại.
 */
export function findColumn(headers, aliases) {
    const H = headers.map(normText);
    const A = aliases.map(normText);
    for (const a of A) { const i = H.indexOf(a); if (i >= 0) return i; }
    for (const a of A) {
        const i = H.findIndex((h) => h && (h === a || h.startsWith(a + " ") || h.endsWith(" " + a)));
        if (i >= 0) return i;
    }
    for (const a of A) { const i = H.findIndex((h) => h && h.includes(a)); if (i >= 0) return i; }
    return -1;
}

/**
 * Tìm dòng tiêu đề trong sheet. Sao kê ngân hàng hay có 5-10 dòng đầu là
 * tên chủ tài khoản, số tài khoản, kỳ sao kê — tiêu đề thật nằm sâu bên dưới.
 * Chấm điểm theo số bí danh khớp được, lấy dòng cao điểm nhất trong 30 dòng đầu.
 */
export function findHeaderRow(rows, aliasGroups, maxScan = 30) {
    let best = { idx: -1, score: 0 };
    const limit = Math.min(rows.length, maxScan);
    for (let i = 0; i < limit; i++) {
        const row = rows[i] || [];
        if (row.filter((c) => String(c ?? "").trim() !== "").length < 2) continue;
        let score = 0;
        for (const aliases of aliasGroups) if (findColumn(row, aliases) >= 0) score++;
        if (score > best.score) best = { idx: i, score };
    }
    return best;
}

/** Ô có chữ thật hay không (dùng để bỏ dòng tổng cộng, dòng trống). */
export function isBlankRow(row) {
    return !row || row.every((c) => c === null || c === undefined || String(c).trim() === "");
}

export function fmtVND(n) {
    if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
    return Math.round(Number(n)).toLocaleString("vi-VN") + " ₫";
}

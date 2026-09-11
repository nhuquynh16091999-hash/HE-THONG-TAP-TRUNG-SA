/**
 * ĐỌC HAI NGUỒN → MỘT ĐỊNH DẠNG CHUNG.
 *
 * Sau tầng này, dù file gốc là của Facebook hay của ngân hàng nào, phần đối
 * soát chỉ còn nhìn thấy: NGÀY · SỐ TIỀN · THẺ · MÔ TẢ. Mọi khác biệt về định
 * dạng chết ở đây, không rò rỉ xuống dưới.
 */
import { readSheets } from "./xlsx.mjs";
import {
    normText, parseAmount, parseDate, cardLast4,
    findColumn, findHeaderRow, isBlankRow,
} from "./normalize.mjs";

/**
 * Kể ra ĐỌC ĐƯỢC GÌ khi không nhận ra dòng tiêu đề.
 *
 * Câu "kiểm tra lại file" là câu vô dụng: người dùng mở file thấy vẫn bình
 * thường, còn người sửa thì không biết máy đã đọc ra cái gì. Với PDF lại càng
 * mù, vì bảng là do dựng lại từ toạ độ chữ chứ không có sẵn. In vài dòng đầu
 * ra là đủ để biết nên thêm bí danh cột hay là bộ dựng bảng đang sai.
 */
function doDuocGi(sheets) {
    const sh = sheets.reduce((m, x) => (x.rows.length > (m?.rows.length || 0) ? x : m), null);
    if (!sh || !sh.rows.length) return "File không có dòng nào đọc được.";
    const mau = sh.rows.slice(0, 4)
        .map((r, i) => `  dòng ${i + 1}: ${JSON.stringify(r.slice(0, 8).map((c) => (c instanceof Date ? c.toISOString().slice(0, 10) : c)))}`)
        .join("\n");
    return `Đọc được ${sh.rows.length} dòng ở "${sh.name}" nhưng không dòng nào giống tiêu đề bảng. Mấy dòng đầu:\n${mau}`;
}

/**
 * Chặn số tiền vô lý.
 *
 * Dựng lại bảng từ PDF mà dính hai cột số vào nhau là ra con số dài vô tận:
 * sao kê thật của Sỹ Anh từng đọc ra 2,9 × 10^48 đồng cho một dòng. Con số đó
 * không dừng ở một dòng — nó nhiễm vào tổng, vào chênh lệch, vào cảnh báo
 * "tăng 5,5e+45%", và biến cả bản đối soát thành rác mà nhìn vẫn ra dáng số.
 *
 * Một dòng vượt trần thì bỏ dòng. Quá nhiều dòng vượt trần thì cả file đọc
 * sai, bỏ nguyên file — nhặt vài dòng còn lại chỉ đẻ ra kết luận sai.
 */
function chanSoVoLy(rows, skipped, cfg, tenFile) {
    const tran = cfg.sanity?.max_amount_row ?? 1e9;
    const tyLe = cfg.sanity?.max_bad_ratio ?? 0.3;
    const xau = rows.filter((r) => Math.abs(r.amount) > tran);
    if (!xau.length) return rows;

    const tot = rows.filter((r) => Math.abs(r.amount) <= tran);
    if (xau.length / rows.length > tyLe) {
        throw new Error(
            `${xau.length}/${rows.length} dòng có số tiền vô lý (lớn nhất: ${Math.abs(xau[0].amount).toExponential(2)} ₫) ` +
            `— gần như chắc chắn bảng bị dựng sai cột khi đọc file này, không phải tiền thật. Bỏ cả file.`);
    }
    for (const r of xau) {
        skipped.push({ file: tenFile, line: r.line, reason: `số tiền vô lý (${Math.abs(r.amount).toExponential(2)} ₫) — nhiều khả năng đọc dính hai cột số`, raw: r.raw });
    }
    return tot;
}

const TOTAL_ROW = /^(tong|tong cong|total|grand total|cong|sum|so du dau|so du cuoi|ket chuyen)\b/;

/** Moi số tài khoản quảng cáo từ phần đầu bản kê Facebook. */
function moiSoTaiKhoan(rowsDau) {
    const blob = rowsDau.flat().map((c) => String(c ?? "")).join(" ");
    const m = blob.match(/(?:t[aà]i kho[aả]n|account)\s*(?:id)?\s*[:#]?\s*(act_)?(\d{8,})/i);
    return m ? "act_" + m[2] : "";
}

function statusNorm(s) {
    const t = normText(s);
    if (!t) return "unknown";
    if (/(paid|success|completed|settled|thanh cong|da thanh toan|da tra)/.test(t)) return "paid";
    if (/(fail|declin|error|reject|that bai|tu choi|loi)/.test(t)) return "failed";
    if (/(pending|processing|dang xu ly|cho|treo)/.test(t)) return "pending";
    return "other";
}

/** Chọn sheet có nhiều dòng dữ liệu nhất khớp bộ cột cần tìm. */
function pickSheet(sheets, aliasGroups) {
    let best = null;
    for (const sh of sheets) {
        const hit = findHeaderRow(sh.rows, aliasGroups);
        if (hit.idx < 0) continue;
        const body = sh.rows.length - hit.idx - 1;
        const score = hit.score * 1000 + Math.min(body, 999);
        if (!best || score > best.score) best = { sheet: sh, headerRow: hit.idx, matched: hit.score, score };
    }
    return best;
}

// ─────────────────────────────────────────────────────────────────────────
// File 1 — chi phí thanh toán từ TKQC Facebook
// ─────────────────────────────────────────────────────────────────────────
export function ingestFb(sheets, cfg, sourceName = "") {
    const A = cfg.columns.fb;
    const pick = pickSheet(sheets, [A.date, A.amount, A.transaction_id, A.account_id, A.status]);
    if (!pick) throw new Error("Không tìm thấy dòng tiêu đề trong file TKQC. " + doDuocGi(sheets));

    const headers = pick.sheet.rows[pick.headerRow] || [];
    const col = {};
    for (const [key, aliases] of Object.entries(A)) col[key] = findColumn(headers, aliases);

    const warnings = [];
    if (col.date < 0) throw new Error("File TKQC thiếu cột NGÀY. Cột đọc được: " + headers.join(" | "));
    if (col.amount < 0) throw new Error("File TKQC thiếu cột SỐ TIỀN. Cột đọc được: " + headers.join(" | "));
    if (col.account_id < 0 && col.account_name < 0) warnings.push("File TKQC không có cột tài khoản quảng cáo — bỏ qua kiểm tra TKQC lạ");
    if (col.method < 0) warnings.push("File TKQC không có cột phương thức thanh toán — bỏ qua kiểm tra thẻ lạ");

    // Bản kê thanh toán của Facebook KHÔNG có cột tài khoản quảng cáo — mỗi
    // file là bản kê của đúng MỘT tài khoản, và số tài khoản nằm ở phần đầu
    // trang ("Tài khoản: 2033341657422931"). Không moi ra thì mọi dòng đều
    // không biết thuộc TKQC nào, và không đời nào phát hiện được là đang thiếu
    // bản kê của các tài khoản còn lại.
    const tkTuDauTrang = col.account_id >= 0 ? "" : moiSoTaiKhoan(pick.sheet.rows.slice(0, pick.headerRow + 1));
    if (tkTuDauTrang) warnings.push(`File không có cột tài khoản quảng cáo — lấy từ đầu trang: ${tkTuDauTrang}`);

    const rows = [];
    const skipped = [];
    for (let i = pick.headerRow + 1; i < pick.sheet.rows.length; i++) {
        const r = pick.sheet.rows[i] || [];
        if (isBlankRow(r)) continue;
        if (TOTAL_ROW.test(normText(r[col.date] ?? r[0]))) continue;

        const date = parseDate(r[col.date]);
        const amount = parseAmount(r[col.amount]);
        if (!date || amount === null) { skipped.push({ file: sourceName, line: i + 1, reason: !date ? "không đọc được ngày" : "không đọc được số tiền", raw: r }); continue; }
        if (amount === 0) { skipped.push({ file: sourceName, line: i + 1, reason: "số tiền bằng 0", raw: r }); continue; }

        const method = col.method >= 0 ? String(r[col.method] ?? "") : "";
        const status = col.status >= 0 ? String(r[col.status] ?? "") : "";
        rows.push({
            src: "fb",
            file: sourceName,
            line: i + 1,
            txn_id: col.transaction_id >= 0 ? String(r[col.transaction_id] ?? "").trim() : "",
            date,
            amount: Math.abs(amount),
            currency: col.currency >= 0 ? String(r[col.currency] ?? "").trim().toUpperCase() : cfg.currency,
            account_id: col.account_id >= 0 ? String(r[col.account_id] ?? "").trim() : tkTuDauTrang,
            account_name: col.account_name >= 0 ? String(r[col.account_name] ?? "").trim() : "",
            method,
            card4: cardLast4(method),
            status,
            status_norm: statusNorm(status),
            raw: r,
        });
    }

    return {
        rows: chanSoVoLy(rows, skipped, cfg, sourceName),
        skipped,
        meta: {
            sheet: pick.sheet.name, header_row: pick.headerRow + 1,
            headers: headers.map((h) => String(h ?? "")),
            columns: col, warnings,
        },
    };
}

// ─────────────────────────────────────────────────────────────────────────
// File 2 — sao kê thẻ ngân hàng
// ─────────────────────────────────────────────────────────────────────────
export function ingestBank(sheets, cfg, sourceName = "") {
    const A = cfg.columns.bank;
    const pick = pickSheet(sheets, [A.date, A.debit, A.desc, A.credit, A.balance, A.amount]);
    if (!pick) throw new Error("Không tìm thấy dòng tiêu đề trong sao kê. " + doDuocGi(sheets));

    const headers = pick.sheet.rows[pick.headerRow] || [];
    const col = {};
    for (const [key, aliases] of Object.entries(A)) col[key] = findColumn(headers, aliases);

    const warnings = [];
    if (col.date < 0) throw new Error("Sao kê thiếu cột NGÀY. Cột đọc được: " + headers.join(" | "));
    if (col.debit < 0 && col.amount < 0) throw new Error("Sao kê thiếu cột SỐ TIỀN GHI NỢ. Cột đọc được: " + headers.join(" | "));
    if (col.desc < 0) warnings.push("Sao kê không có cột nội dung — không lọc được dòng nào là chi cho Facebook, sẽ lấy TẤT CẢ dòng ghi nợ");

    const fbKeys = (cfg.bank_filter.fb_keywords || []).map(normText);
    const otherKeys = (cfg.bank_filter.other_ads_keywords || []).map(normText);
    const ignoreKeys = (cfg.bank_filter.ignore_keywords || []).map(normText);

    const all = [];
    const skipped = [];
    for (let i = pick.headerRow + 1; i < pick.sheet.rows.length; i++) {
        const r = pick.sheet.rows[i] || [];
        if (isBlankRow(r)) continue;

        const desc = col.desc >= 0 ? String(r[col.desc] ?? "").trim() : "";
        if (TOTAL_ROW.test(normText(desc)) || TOTAL_ROW.test(normText(r[0]))) continue;

        const date = parseDate(r[col.date]);
        const debit = col.debit >= 0 ? parseAmount(r[col.debit]) : null;
        const credit = col.credit >= 0 ? parseAmount(r[col.credit]) : null;
        const plain = col.amount >= 0 ? parseAmount(r[col.amount]) : null;

        // Tiền RA khỏi thẻ: cột ghi nợ, hoặc cột số tiền mang dấu âm
        let out = null;
        if (debit !== null && debit !== 0) out = Math.abs(debit);
        else if (plain !== null && plain !== 0 && (credit === null || credit === 0)) out = plain < 0 ? Math.abs(plain) : plain;

        if (!date || out === null || out === 0) {
            if (!isBlankRow(r) && (date || desc)) skipped.push({ file: sourceName, line: i + 1, reason: !date ? "không đọc được ngày" : "không có tiền ghi nợ", raw: r });
            continue;
        }

        const dn = normText(desc);
        const isFb = col.desc < 0 ? true : fbKeys.some((k) => k && dn.includes(k));
        const isOtherAds = otherKeys.some((k) => k && dn.includes(k));
        const isIgnored = ignoreKeys.some((k) => k && dn.includes(k));

        all.push({
            src: "bank",
            file: sourceName,
            line: i + 1,
            date,
            ref: col.ref >= 0 ? String(r[col.ref] ?? "").trim() : "",
            desc,
            amount: out,
            balance: col.balance >= 0 ? parseAmount(r[col.balance]) : null,
            card4: cardLast4(col.card >= 0 ? String(r[col.card] ?? "") : "") || cardLast4(desc),
            is_fb: isFb && !isIgnored,
            is_other_ads: isOtherAds,
            raw: r,
        });
    }

    return {
        rows: chanSoVoLy(all.filter((r) => r.is_fb), skipped, cfg, sourceName),
        other_ads: all.filter((r) => !r.is_fb && r.is_other_ads),
        other: all.filter((r) => !r.is_fb && !r.is_other_ads),
        skipped,
        meta: {
            sheet: pick.sheet.name, header_row: pick.headerRow + 1,
            headers: headers.map((h) => String(h ?? "")),
            columns: col, warnings,
        },
    };
}

// ─────────────────────────────────────────────────────────────────────────
// Tự nhận biết file nào là file nào — để Sỹ Anh thả 2 file vào là chạy,
// không phải nhớ thứ tự tham số.
// ─────────────────────────────────────────────────────────────────────────
export function detectKind(sheets, cfg) {
    const fbA = cfg.columns.fb, bkA = cfg.columns.bank;
    let fbScore = 0, bkScore = 0;

    for (const sh of sheets) {
        const hit = findHeaderRow(sh.rows, [fbA.date, fbA.amount, fbA.transaction_id, fbA.account_id, fbA.method, fbA.status]);
        const headers = hit.idx >= 0 ? sh.rows[hit.idx] : (sh.rows[0] || []);
        for (const key of ["transaction_id", "account_id", "account_name", "method", "status", "currency"]) {
            if (findColumn(headers, fbA[key]) >= 0) fbScore++;
        }
        for (const key of ["debit", "credit", "balance", "ref", "desc"]) {
            if (findColumn(headers, bkA[key]) >= 0) bkScore++;
        }
        // Nội dung cũng là bằng chứng: sao kê có "FACEBK *xxxx", TKQC có "act_..."
        const blob = normText(sh.rows.slice(0, 40).flat().join(" "));
        if (/\bact \d{6,}/.test(blob) || /ad account/.test(blob)) fbScore += 2;
        if (/(facebk|so du|ghi no|ghi co)/.test(blob)) bkScore += 2;
    }

    if (fbScore === bkScore) return "unknown";
    return fbScore > bkScore ? "fb" : "bank";
}

/** Đọc file từ đĩa rồi phân loại — dùng cho CLI và web. */
export function loadFile(path, cfg, buffer = null) {
    const sheets = readSheets(path, buffer);
    return { sheets, kind: detectKind(sheets, cfg) };
}

/** Xuất kết quả ra CSV để mở bằng Excel — mỗi dòng là một giao dịch có nhãn. */
function esc(v) {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCsv(result) {
    const head = ["Loại", "Kết luận", "Ngày TKQC", "Mã giao dịch", "TKQC", "Số tiền TKQC",
                  "Ngày sao kê", "Nội dung sao kê", "Số tiền thẻ", "Lệch tiền", "Lệch ngày",
                  "Thẻ", "Độ tin cậy", "Dòng TKQC", "Dòng sao kê"];
    const rows = [head];

    for (const p of result.pairs) {
        rows.push(["KHỚP", p.exact ? "khớp đúng" : (p.amount_diff > 0 ? "thẻ trừ nhiều hơn" : "thẻ trừ ít hơn"),
                   p.fb.date, p.fb.txn_id, p.fb.account_name, p.fb.amount,
                   p.bank.date, p.bank.desc, p.bank.amount, p.amount_diff, p.date_diff,
                   p.bank.card4 || p.fb.card4 || "", p.confidence + (p.ambiguous ? " (nghi ngờ)" : ""),
                   p.fb.line, p.bank.line]);
    }
    for (const r of result.fb_unmatched) {
        rows.push(["THIẾU Ở THẺ", "TKQC thu mà thẻ không trừ", r.date, r.txn_id, r.account_name, r.amount,
                   "", "", "", "", "", r.card4 || "", "", r.line, ""]);
    }
    for (const r of result.bank_unmatched) {
        rows.push(["THIẾU Ở TKQC", "thẻ trừ mà không có hoá đơn", "", "", "", "",
                   r.date, r.desc, r.amount, "", "", r.card4 || "", "", "", r.line]);
    }
    for (const r of result.fb_failed) {
        rows.push(["FB THẤT BẠI", "hoá đơn lỗi", r.date, r.txn_id, r.account_name, r.amount,
                   "", "", "", "", "", r.card4 || "", "", r.line, ""]);
    }
    for (const r of result.other_ads || []) {
        rows.push(["ADS KÊNH KHÁC", "ngoài phạm vi FB", "", "", "", "",
                   r.date, r.desc, r.amount, "", "", r.card4 || "", "", "", r.line]);
    }

    // BOM để Excel trên Windows không vỡ tiếng Việt
    return "\ufeff" + rows.map((r) => r.map(esc).join(",")).join("\r\n");
}

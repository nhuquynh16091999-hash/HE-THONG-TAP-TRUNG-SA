import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAmount, parseDate, cardLast4, isoWeek, findColumn, findHeaderRow, daysBetween } from "../src/engine.mjs";

test("parseAmount đọc được mọi kiểu viết tiền", () => {
    assert.equal(parseAmount("12.500.000"), 12500000);      // VN
    assert.equal(parseAmount("12,500,000"), 12500000);      // Anh-Mỹ
    assert.equal(parseAmount("12 500 000,50"), 12500000.5); // có thập phân
    assert.equal(parseAmount("(1.200)"), -1200);            // kế toán
    assert.equal(parseAmount("-1.234,56"), -1234.56);
    assert.equal(parseAmount("1200 VND"), 1200);
    assert.equal(parseAmount("1.234.567 ₫"), 1234567);
    assert.equal(parseAmount(9900000), 9900000);
    assert.equal(parseAmount(""), null);
    assert.equal(parseAmount("-"), null);
    assert.equal(parseAmount(null), null);
});

test("parseAmount không nhầm nghìn với thập phân", () => {
    assert.equal(parseAmount("1,50"), 1.5);        // hai chữ số sau dấu phẩy = thập phân
    assert.equal(parseAmount("1,500"), 1500);      // ba chữ số = phân nhóm nghìn
    assert.equal(parseAmount("1.500"), 1500);
    assert.equal(parseAmount("1.50"), 1.5);
});

test("parseDate ưu tiên dd/mm kiểu Việt Nam", () => {
    assert.equal(parseDate("01/09/2026"), "2026-09-01");
    assert.equal(parseDate("9/1/2026"), "2026-01-09");     // 9 tháng 1, không phải 1 tháng 9
    assert.equal(parseDate("31/12/26"), "2026-12-31");
    assert.equal(parseDate("2026-09-01"), "2026-09-01");
    assert.equal(parseDate("2026-09-01 14:33:21"), "2026-09-01");
    assert.equal(parseDate(new Date(Date.UTC(2026, 8, 5))), "2026-09-05");
    assert.equal(parseDate(""), null);
});

test("cardLast4 moi được số cuối từ mọi cách ghi thẻ", () => {
    assert.equal(cardLast4("Visa *4281"), "4281");
    assert.equal(cardLast4("MASTER*7733"), "7733");
    assert.equal(cardLast4("**** 1234"), "1234");
    assert.equal(cardLast4("FACEBK *ZZ10PP93 VISA*9911"), "9911");
    assert.equal(cardLast4(""), null);
});

test("isoWeek gom đúng tuần", () => {
    assert.equal(isoWeek("2026-09-07"), isoWeek("2026-09-08"));   // cùng tuần
    assert.notEqual(isoWeek("2026-09-06"), isoWeek("2026-09-07")); // chủ nhật ≠ thứ hai
});

test("daysBetween tính đúng chiều", () => {
    assert.equal(daysBetween("2026-09-01", "2026-09-04"), 3);
    assert.equal(daysBetween("2026-09-04", "2026-09-01"), -3);
});

test("findColumn khớp chính xác trước khi khớp mờ", () => {
    const headers = ["Ngày giao dịch", "Số tiền", "Số tiền ghi nợ", "Nội dung"];
    assert.equal(findColumn(headers, ["so tien ghi no", "ghi no", "debit"]), 2);
    assert.equal(findColumn(headers, ["so tien", "amount"]), 1);
    assert.equal(findColumn(headers, ["khong co cot nay"]), -1);
});

test("findHeaderRow bỏ qua phần đầu sao kê", () => {
    const rows = [
        ["NGÂN HÀNG TMCP ABC"], [], ["Chủ tài khoản:", "CTY TALPHA"], ["Số tài khoản:", "0123456789"], [],
        ["Ngày giao dịch", "Số tham chiếu", "Nội dung", "Số tiền ghi nợ", "Số dư"],
        ["01/09/2026", "FT001", "FACEBK *X", "1000", "9000"],
    ];
    const hit = findHeaderRow(rows, [["ngay giao dich"], ["so tien ghi no"], ["noi dung"], ["so du"]]);
    assert.equal(hit.idx, 5);
    assert.equal(hit.score, 4);
});

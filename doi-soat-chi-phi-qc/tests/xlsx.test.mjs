import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readSheets, parseDelimited } from "../src/engine.mjs";
import { ROOT } from "../src/run.mjs";

const MAU = join(ROOT, "data", "mau");

test("đọc .xlsx thật không cần thư viện ngoài", () => {
    const sheets = readSheets(join(MAU, "MAU_chi-phi-tkqc-fb_2026-09-01_07.xlsx"));
    assert.equal(sheets.length, 1);
    assert.equal(sheets[0].name, "Payment activity");
    assert.equal(sheets[0].rows[0][0], "Transaction ID");
    assert.equal(sheets[0].rows[1][0], "TXN-9001");
    assert.equal(sheets[0].rows[1][5], 12500000);                 // số giữ nguyên kiểu số
    assert.ok(sheets[0].rows[1][1] instanceof Date);              // ô ngày ra Date
    assert.equal(sheets[0].rows[1][1].toISOString().slice(0, 10), "2026-09-01");
});

test("đọc được tiếng Việt có dấu trong sharedStrings", () => {
    const sheets = readSheets(join(MAU, "MAU_chi-phi-tkqc-fb_2026-09-01_07.xlsx"));
    assert.equal(sheets[0].rows[1][3], "Sỹ Anh Taiwan 4");
});

test("CSV tự đoán dấu phân cách và giữ ô có dấu phẩy", () => {
    const rows = parseDelimited('a,b,c\n1,"x, y",3\n');
    assert.deepEqual(rows, [["a", "b", "c"], ["1", "x, y", "3"]]);
    const tsv = parseDelimited("a\tb\n1\t2\n");
    assert.deepEqual(tsv, [["a", "b"], ["1", "2"]]);
});

test("file .xls đời cũ báo lỗi rõ ràng chứ không đọc bừa", () => {
    const fake = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]);
    assert.throws(() => readSheets("cu.xls", fake), /Save As.*xlsx|\.xls đời cũ/);
});

test("PDF NHIỀU TRANG phải đọc hết mọi trang, không chỉ trang đầu", async () => {
    // Ca thật 10/09/2026: bản kê TKQC của Facebook trải 9 tháng, nhiều trang.
    // Bản đầu coi mỗi trang là một sheet rồi để tầng trên chọn MỘT — mất sạch
    // phần còn lại, mà mất im lặng vì kết quả vẫn trông như đọc được.
    const { readAnySheets } = await import("../src/engine.mjs");
    const sheets = await readAnySheets(join(MAU, "MAU_sao-ke-2-trang.pdf"));

    assert.equal(sheets.length, 1, "mọi trang phải gộp thành MỘT bảng");
    assert.match(sheets[0].name, /2 trang/);
    const duLieu = sheets[0].rows.filter((r) => /^\d{2}\/09\/2026$/.test(String(r[0])));
    assert.equal(duLieu.length, 90, "phải đọc đủ 90 dòng của cả hai trang");
});

test("PDF khoá mật khẩu: báo rõ và gắn cờ, có mật khẩu đúng thì đọc được", async () => {
    // Sao kê ngân hàng gửi qua email gần như luôn bị khoá. Thông báo gốc của
    // pdfjs là "No password given" — người dùng đọc xong không biết làm gì.
    const { readAnySheets } = await import("../src/engine.mjs");
    const F = join(MAU, "MAU_sao-ke-CO-MAT-KHAU.pdf");
    const buf = (await import("node:fs")).readFileSync(F);

    await assert.rejects(() => readAnySheets(F, buf), (e) => {
        assert.match(e.message, /khoá bằng mật khẩu/);
        assert.equal(e.canMatKhau, true, "phải gắn cờ để màn hình bật ô nhập mật khẩu");
        return true;
    });
    await assert.rejects(() => readAnySheets(F, buf, { password: "sai" }), (e) => {
        assert.match(e.message, /không đúng/);
        assert.equal(e.matKhauSai, true);
        return true;
    });
    const sheets = await readAnySheets(F, buf, { password: "123456" });
    assert.ok(sheets[0].rows.length > 10, "mật khẩu đúng thì đọc được như PDF thường");
});

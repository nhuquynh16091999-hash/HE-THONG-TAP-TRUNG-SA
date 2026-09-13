/**
 * Phép thử bộ đọc FILE TIỀN HÀNG.
 *
 * Câu chữ trong các ô dưới đây chép đúng từ file thật (Google Sheet "BẢNG THANH
 * TOÁN TIỀN HÀNG", tab TIỀN HÀNG TAIWAN), kể cả ngoặc toàn góc （） và chữ viết
 * hoa thường lẫn lộn — chính những thứ đó làm bộ đọc dễ trượt.
 */
const assert = require("assert");
const P = require("../.test-build/purchase-sheet.js");

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log("  ✓", name); };

const GRID = [
    ["NGÀY", "SẢN PHẨM", "SỐ LƯỢNG", "TÌNH TRẠNG THANH TOÁN", "GIÁ"],
    ["16/7/2026", "MÁY LƯỢC ĐIỆN ĐEN", "1", "ĐÃ THANH TOÁN", "26 tệ/sp"],
    ["17/07/2026", "MÁY LƯỢC ĐIỆN ĐEN", "1", "ĐÃ THANH TOÁN", "26 tệ/sp", "THANH TOÁN NGÀY 27/7 \n\nTổng: 1.009.562 VND \n\n( ĐÃ THANH TOÁN )", "#REF!"],
    ["THÁNG 8"],
    ["1/8", "033 - FITGUM", "30 HỘP", "CHƯA THANH TOÁN", "12.5 TỆ/SP", "THANH TOÁN NGÀY 14/8\nTỔNG : 8.393.597 VND\n（ ĐÃ THANH TOÁN 6.988.000 VND）\nCÒN THIẾU : 1.405.597 VND"],
    ["15/8", "040 - VONGVANG1", "50 SP", "CHƯA THANH TOÁN", "7 TỆ/SP", "THANH TOÁN NGÀY 21/8/2026\n6.185.790 + 1.405.597\nTỔNG: 7.591.387 VND\nĐÃ THANH TOÁN"],
    ["22/8", "HỘP ĐỰNG TRANG SỨC", "100 HỘP", "CHƯA THANH TOÁN", "1.3 TỆ/SP", "", "THANH TOÁN NGÀY 28/8/2026\nTỔNG: 8.715.781 VND\nĐÃ THANH TOÁN"],
    ["5/9", "041 - TRAGUNG", "2 SP", "CHƯA THANH TOÁN", "18.8 TỆ / SP", "THANH TOÁN NGÀY 11/09\nTỔNG : 8.406.891 VND"],
];

console.log("── Đọc đợt thanh toán ──");
const DOT = P.docDotTienHang(GRID);
t("đọc đủ 5 đợt, bỏ qua dòng tiêu đề và dòng THÁNG", () => {
    assert.deepStrictEqual(DOT.map((d) => d.ngay), ["2026-07-27", "2026-08-14", "2026-08-21", "2026-08-28", "2026-09-11"]);
});
t("tổng có dấu chấm ngăn nghìn đọc ra đúng số", () => {
    assert.strictEqual(DOT[0].tong_vnd, 1009562);
});
t("trả thiếu: đọc được cả số đã trả lẫn số còn thiếu, kể cả ngoặc toàn góc", () => {
    assert.strictEqual(DOT[1].tong_vnd, 8393597);
    assert.strictEqual(DOT[1].da_tra_vnd, 6988000);
    assert.strictEqual(DOT[1].con_thieu_vnd, 1405597);
});
t("đợt cộng dồn nợ kỳ trước: tách được tiền hàng mới và phần nợ cũ", () => {
    assert.strictEqual(DOT[2].tong_vnd, 7591387);
    assert.strictEqual(DOT[2].moi_vnd, 6185790);
    assert.strictEqual(DOT[2].no_ky_truoc_vnd, 1405597);
});
t("ô ghi đợt nằm ở cột G thay vì F vẫn đọc được", () => {
    assert.strictEqual(DOT[3].tong_vnd, 8715781);
});
t("đợt chưa ghi 'đã thanh toán' thì đã trả = không biết, không tự coi là đã trả", () => {
    assert.strictEqual(DOT[4].da_ghi_thanh_toan, false);
    assert.strictEqual(DOT[4].da_tra_vnd, null);
});
t("ghi 'đã thanh toán' mà không ghi số thì coi như trả đủ tổng", () => {
    assert.strictEqual(DOT[0].da_tra_vnd, 1009562);
});

console.log("── Ngày sao kê từ tên file ──");
t("đọc được cả ba kiểu tên file NAZA", () => {
    assert.strictEqual(P.ngaySaoKe("ĐỐI SOÁT COD 2026.9.11.xlsx"), "2026-09-11");
    assert.strictEqual(P.ngaySaoKe("A.THÁI COD TAIWAN 2026-7-24.xlsx"), "2026-07-24");
    assert.strictEqual(P.ngaySaoKe("ĐỐI SOÁT COD TAIWAN 14.08.2026.xlsx"), "2026-08-14");
    assert.strictEqual(P.ngaySaoKe("sao kê không ngày.xlsx"), null);
});

console.log("── Ghép đợt vào kỳ ──");
t("đợt nằm giữa hai kỳ về kỳ GẦN HƠN, không về kỳ duyệt trước", () => {
    // 27/7 cách kỳ 24/7 ba ngày, cách kỳ 31/7 bốn ngày.
    const dot = [{ ngay: "2026-07-27" }, { ngay: "2026-07-31" }];
    const m = P.ghepDotVaoKy(dot, [{ id: "31/7", ngay: "2026-07-31" }, { id: "24/7", ngay: "2026-07-24" }], 4);
    assert.strictEqual(m.get("24/7").ngay, "2026-07-27");
    assert.strictEqual(m.get("31/7").ngay, "2026-07-31");
});
t("không đợt nào trong cửa sổ thì kỳ đó không có tiền hàng", () => {
    const m = P.ghepDotVaoKy([{ ngay: "2026-08-01" }], [{ id: "k", ngay: "2026-09-11" }], 4);
    assert.strictEqual(m.has("k"), false);
});
t("một đợt không bị ghép vào hai kỳ", () => {
    const m = P.ghepDotVaoKy([{ ngay: "2026-08-10" }], [{ id: "a", ngay: "2026-08-09" }, { id: "b", ngay: "2026-08-11" }], 4);
    assert.strictEqual(m.size, 1);
});

console.log("── CSV có ô xuống dòng ──");
t("ô trong ngoặc kép có xuống dòng không làm vỡ dòng", () => {
    const g = P.csvToGrid('a,"THANH TOÁN NGÀY 11/09\nTỔNG : 8.406.891 VND",c\nx,y,z\n');
    assert.strictEqual(g.length, 2);
    assert.strictEqual(g[0][1], "THANH TOÁN NGÀY 11/09\nTỔNG : 8.406.891 VND");
});

console.log(`\n${pass} phép thử — tất cả đạt.`);

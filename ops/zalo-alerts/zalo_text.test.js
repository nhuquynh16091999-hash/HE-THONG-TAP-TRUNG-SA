// node zalo_text.test.js   (không cần cài gì thêm)
const assert = require("assert");
const { B, I, clean, toZalo, chiaTin } = require("./zalo_text");

let ok = 0;
const t = (ten, fn) => { fn(); ok++; };
const chuDam = (r) => r.styles.filter((s) => s.st === "b").map((s) => r.msg.slice(s.start, s.start + s.len));

t("chữ trơn không có style", () => {
    assert.deepStrictEqual(toZalo("Tiền ads: 100đ"), { msg: "Tiền ads: 100đ", styles: [] });
});

t("B() thành dải đậm đúng chỗ, không còn ký tự cờ", () => {
    const r = toZalo(`Tiền ads: ${B("3.317.921đ")} · Đơn ${B(10)}`);
    assert.strictEqual(r.msg, "Tiền ads: 3.317.921đ · Đơn 10");
    assert.deepStrictEqual(chuDam(r), ["3.317.921đ", "10"]);
});

t("emoji đứng trước vẫn đậm đúng chữ (vị trí tính theo UTF-16)", () => {
    const r = toZalo(`💰 Tiền ads: ${B("480.000đ")}`);
    assert.deepStrictEqual(chuDam(r), ["480.000đ"]);
    assert.strictEqual(r.styles[0].start, "💰 Tiền ads: ".length);
});

t("tên campaign có * và _ KHÔNG làm nghiêng/đậm loạn", () => {
    const r = toZalo("• SET_KIM_CUONG *hot* _x_");
    assert.strictEqual(r.msg, "• SET_KIM_CUONG *hot* _x_");
    assert.deepStrictEqual(r.styles, []);
});

t("ký tự cờ lọt vào dữ liệu thì bị lọc", () => {
    assert.strictEqual(clean("abc"), "abc");
    assert.deepStrictEqual(toZalo(B("xy")), { msg: "xy", styles: [{ start: 0, len: 2, st: "b" }] });
});

t("I() thành nghiêng; B() đặt trong I() bị bỏ cờ chứ không vỡ tin", () => {
    // B/I lọc cờ ở phần chữ được bọc — để dữ liệu lạ không mở được dải style — nên
    // không lồng nhau được. Bản tin không cần lồng; ghép cạnh nhau thì vẫn đúng.
    const r = toZalo(I(`số ${B("chưa chốt")} còn lên`));
    assert.deepStrictEqual(r, { msg: "số chưa chốt còn lên", styles: [{ start: 0, len: 20, st: "i" }] });
    const r2 = toZalo(`${B("SỐ CHƯA ĐỦ")} ${I("đợi sync")}`);
    assert.deepStrictEqual(r2.styles, [{ start: 0, len: 10, st: "b" }, { start: 11, len: 8, st: "i" }]);
});

t("cờ rỗng B('') không sinh style độ dài 0", () => {
    assert.deepStrictEqual(toZalo(`a${B("")}b`), { msg: "ab", styles: [] });
});

t("tin ngắn không bị chia", () => {
    const r = toZalo(`${B("TỔNG TEAM")}\nx`);
    assert.strictEqual(chiaTin(r, 1800).length, 1);
});

t("tin dài chia ở dòng trống, mỗi phần ≤ max, style dời đúng phần", () => {
    const khoi = (i) => `${B("Camp " + i)}\n` + "x".repeat(80);
    const r = toZalo(Array.from({ length: 30 }, (_, i) => khoi(i)).join("\n\n"));
    const phan = chiaTin(r, 500);
    assert.ok(phan.length > 1);
    for (const p of phan) {
        assert.ok(p.msg.length <= 500, `phần dài ${p.msg.length}`);
        assert.ok(!p.msg.startsWith("\n") && !p.msg.endsWith("\n"));
        for (const s of p.styles) assert.ok(s.start >= 0 && s.start + s.len <= p.msg.length);
    }
    // Không mất chữ đậm nào: gom lại đủ 30 tên camp, đúng thứ tự.
    const dam = phan.flatMap((p) => chuDam(p));
    assert.deepStrictEqual(dam, Array.from({ length: 30 }, (_, i) => "Camp " + i));
    // Không mất chữ: nối lại (bỏ khoảng trắng chỗ cắt) bằng bản gốc.
    assert.strictEqual(phan.map((p) => p.msg).join("").replace(/\s/g, ""), r.msg.replace(/\s/g, ""));
});

t("không có xuống dòng thì cắt cứng, không xẻ đôi emoji", () => {
    const r = toZalo("a" + "💰".repeat(300));
    const phan = chiaTin(r, 101);
    for (const p of phan) {
        const cuoi = p.msg.charCodeAt(p.msg.length - 1);
        assert.ok(!(cuoi >= 0xd800 && cuoi <= 0xdbff), "cắt giữa cặp surrogate");
        assert.ok(p.msg.length <= 101);
    }
    assert.strictEqual(phan.map((p) => p.msg).join(""), r.msg);
});

t("dải đậm vắt qua chỗ cắt thì mỗi phần giữ phần đậm của mình", () => {
    const r = toZalo(B("a".repeat(150) + "\n" + "b".repeat(150)));
    const phan = chiaTin(r, 200);
    assert.strictEqual(phan.length, 2);
    assert.deepStrictEqual(phan[0].styles, [{ start: 0, len: 150, st: "b" }]);
    assert.deepStrictEqual(phan[1].styles, [{ start: 0, len: 150, st: "b" }]);
});

console.log(`zalo_text.test.js: ${ok}/${ok} PASS`);

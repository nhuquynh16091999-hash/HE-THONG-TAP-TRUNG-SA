/** Shop đứng im (12/11/2026): ads còn tiêu mà shop không có đơn mới nhiều ngày. */
const assert = require("assert");
const { timShopDung } = require("../.test-build/shop-dung.js");

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log("  ✓", name); };
const SHOPS = ["TW", "SG", "JP"];

console.log("── Shop đứng im ──");
t("ads tiêu, 3 ngày không đơn → kêu", () => {
    const r = timShopDung(SHOPS, { TW: "2026-11-09", SG: "2026-11-12" }, { TW: 900000, SG: 900000 }, "2026-11-12");
    assert.deepStrictEqual(r, [{ shop: "TW", ngay_cuoi: "2026-11-09", so_ngay: 3, ads_vnd: 900000 }]);
});
t("nước nghỉ (không tiêu ads) → không kêu dù lâu không có đơn", () => {
    assert.deepStrictEqual(timShopDung(SHOPS, { JP: "2026-10-26" }, { JP: 0 }, "2026-11-12"), []);
});
t("ads dưới ngưỡng → không kêu", () => {
    assert.deepStrictEqual(timShopDung(SHOPS, { TW: "2026-11-01" }, { TW: 499999 }, "2026-11-12"), []);
});
t("mới 2 ngày → chưa kêu", () => {
    assert.deepStrictEqual(timShopDung(SHOPS, { TW: "2026-11-10" }, { TW: 900000 }, "2026-11-12"), []);
});
t("shop chưa từng có đơn mà ads tiêu → kêu, không rõ số ngày", () => {
    const r = timShopDung(SHOPS, {}, { SG: 700000 }, "2026-11-12");
    assert.deepStrictEqual(r, [{ shop: "SG", ngay_cuoi: null, so_ngay: null, ads_vnd: 700000 }]);
});
t("ngưỡng đổi được", () => {
    const r = timShopDung(SHOPS, { TW: "2026-11-10" }, { TW: 100000 }, "2026-11-12", { ngay: 2, adsMin: 50000 });
    assert.strictEqual(r.length, 1);
});
console.log(`shop-dung: ${pass} test qua`);

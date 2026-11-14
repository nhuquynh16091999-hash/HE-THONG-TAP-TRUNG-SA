/** Soi đối thủ (15/11/2026): file config/soi_doi_thu.json đúng khuôn + hàm thuần của lib/talpha/soi-doi-thu.ts. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { mucHoan, soGon, xepTheo7Ngay, banNhieuNhat, locTheoNuoc, NHOM_SP } = require("../.test-build/soi-doi-thu.js");

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log("  ✓", name); };
const FILE = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "config", "soi_doi_thu.json"), "utf8"));
const PUBLIC = path.join(__dirname, "..", "public");
const NHOM = new Set(NHOM_SP.map((n) => n.id));
const khongAm = (x) => Number.isInteger(x) && x >= 0;

console.log("── Soi đối thủ ──");
t("có ít nhất một bản soi, mới nhất đứng đầu, ngày + thị trường đúng dạng", () => {
    assert.ok(FILE.snapshots.length >= 1);
    const ngay = FILE.snapshots.map((s) => s.ngay);
    assert.deepStrictEqual(ngay, [...ngay].sort().reverse(), "snapshots phải xếp ngày mới → cũ");
    for (const s of FILE.snapshots) {
        assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(s.ngay), s.ngay);
        assert.ok(/^[A-Z]{2}$/.test(s.thi_truong), s.thi_truong);
        assert.ok(s.nguon && s.tom_tat.length > 0 && s.gioi_han.length > 0, s.nguon);
    }
});
t("mỗi sản phẩm: mã không trùng, nhóm hợp lệ, số không âm, tỉ lệ hoàn khớp, ảnh có thật, link https", () => {
    for (const s of FILE.snapshots) {
        const ma = new Set();
        for (const p of s.san_pham) {
            const o = `${s.ngay} ${p.ten}`;
            assert.ok(!ma.has(p.ma), `${o}: trùng mã ${p.ma}`); ma.add(p.ma);
            assert.ok(/^[a-z0-9-]+$/.test(p.ma), `${o}: mã ${p.ma}`);
            assert.ok(NHOM.has(p.nhom), `${o}: nhóm ${p.nhom}`);
            for (const k of ["da_xuat", "xuat_7_ngay", "dang_hoan", "dat_them", "dang_giao"]) assert.ok(khongAm(p[k]), `${o}: ${k}`);
            assert.ok(Number.isInteger(p.ton), `${o}: tồn`);
            if (p.da_xuat > 0) assert.ok(Math.abs(p.ty_le_hoan - p.dang_hoan / p.da_xuat) < 0.001, `${o}: tỉ lệ hoàn`);
            else assert.strictEqual(p.ty_le_hoan, null, o);
            if (p.anh !== null) {
                assert.ok(p.anh.startsWith("/soi-doi-thu/"), `${o}: ảnh ${p.anh}`);
                assert.ok(fs.existsSync(path.join(PUBLIC, p.anh)), `${o}: thiếu file ảnh ${p.anh}`);
            }
            assert.ok(p.lien_ket.length > 0, `${o}: không có link spy`);
            for (const l of p.lien_ket) assert.ok(l.nhan && /^https:\/\//.test(l.url), `${o}: link ${l.url}`);
        }
    }
});
t("kênh TikTok: username không có @, có video top với id số", () => {
    for (const s of FILE.snapshots) for (const k of s.kenh_tiktok) {
        assert.ok(/^[a-z0-9._]+$/.test(k.user), k.user);
        assert.ok(/^\d{15,22}$/.test(k.video_top.id), `${k.user}: id ${k.video_top.id}`);
        assert.ok(k.tong_view >= k.video_top.view, `${k.user}: video top nhiều view hơn cả kênh`);
        assert.ok(k.follower === null || khongAm(k.follower), k.user);
    }
});
t("mức hoàn và số gọn", () => {
    assert.strictEqual(mucHoan({ ty_le_hoan: 0.039, moi: false }), "tot");
    assert.strictEqual(mucHoan({ ty_le_hoan: 0.08, moi: false }), "vua");
    assert.strictEqual(mucHoan({ ty_le_hoan: 0.15, moi: false }), "vua");
    assert.strictEqual(mucHoan({ ty_le_hoan: 0.261, moi: false }), "xau");
    assert.strictEqual(mucHoan({ ty_le_hoan: 0.3, moi: true }), "moi");
    assert.strictEqual(mucHoan({ ty_le_hoan: null, moi: false }), "moi");
    assert.strictEqual(soGon(1400000), "1,4M");
    assert.strictEqual(soGon(11500000), "11,5M");
    assert.strictEqual(soGon(62000), "62K");
    assert.strictEqual(soGon(950), "950");
});
t("xếp theo 7 ngày trong nhóm, bán nhiều nhất mọi nhóm", () => {
    const sp = [
        { ma: "a", nhom: "dang_chay", xuat_7_ngay: 5, da_xuat: 10 },
        { ma: "b", nhom: "dang_chay", xuat_7_ngay: 9, da_xuat: 3 },
        { ma: "c", nhom: "ban_nhieu", xuat_7_ngay: 99, da_xuat: 50 },
    ];
    assert.deepStrictEqual(xepTheo7Ngay(sp, "dang_chay").map((p) => p.ma), ["b", "a"]);
    assert.deepStrictEqual(banNhieuNhat(sp, 2).map((p) => p.ma), ["c", "a"]);
    assert.deepStrictEqual(sp.map((p) => p.ma), ["a", "b", "c"], "không được sửa mảng gốc");
});
t("lọc theo nước: leader UAE không thấy bản soi Đài, leader Đài thấy", () => {
    assert.deepStrictEqual(locTheoNuoc(FILE, (c) => c === "AE").snapshots, []);
    const tw = locTheoNuoc(FILE, (c) => c === "TW");
    assert.strictEqual(tw.snapshots.length, FILE.snapshots.filter((s) => s.thi_truong === "TW").length);
});
console.log(`soi-doi-thu: ${pass} test qua`);

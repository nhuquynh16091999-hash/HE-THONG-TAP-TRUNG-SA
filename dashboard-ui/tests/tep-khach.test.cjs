/** Tệp khách (14/11/2026): file config/tep_khach.json đúng khuôn + hàm thuần của lib/talpha/tep-khach.ts. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { giua, tyLeNu, tyLeTuoi, locTheoNuoc, NHOM_TUOI } = require("../.test-build/tep-khach.js");

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log("  ✓", name); };
const FILE = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "config", "tep_khach.json"), "utf8"));
const NHOM = ["VN", "PH", "ID"];
const laKhoang = (k) => Array.isArray(k) && k.length === 2 && k[0] > 0 && k[0] <= k[1];

console.log("── Tệp khách ──");
t("file có ít nhất một bản đo, mới nhất đứng đầu", () => {
    assert.ok(FILE.snapshots.length >= 1);
    const ngay = FILE.snapshots.map((s) => s.ngay_do);
    assert.deepStrictEqual(ngay, [...ngay].sort().reverse(), "snapshots phải xếp ngày mới → cũ");
    for (const n of NHOM) assert.ok(FILE.nhom[n] && laKhoang(FILE.nhom[n].fb_toan_cau), n);
});
t("mỗi tệp đủ khoảng Facebook, nam nữ, 4 nhóm tuổi, số chính thức", () => {
    for (const s of FILE.snapshots) {
        assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(s.ngay_do), s.ngay_do);
        for (const [code, m] of Object.entries(s.thi_truong)) {
            assert.ok(/^[A-Z]{2}$/.test(code), code);
            assert.ok(laKhoang(m.fb_ca_nuoc), code);
            for (const n of NHOM) {
                const x = m.tep[n], o = `${s.ngay_do} ${code}/${n}`;
                assert.ok(x, o);
                for (const k of ["fb", "nam", "nu"]) assert.ok(laKhoang(x[k]), `${o} ${k}`);
                for (const k of NHOM_TUOI) assert.ok(laKhoang(x.tuoi[k]), `${o} tuổi ${k}`);
                assert.ok(x.chinh_thuc > 0 && ["thong_ke", "uoc_tinh"].includes(x.chinh_thuc_loai), o);
                // Nam + nữ không thể vượt xa cả tệp (Meta làm tròn nên cho lệch 10%).
                assert.ok(x.nam[0] + x.nu[0] <= x.fb[1] * 1.1, `${o}: nam + nữ vượt cả tệp`);
            }
        }
    }
});
t("bảng có dòng Tổng thì các dòng cộng lại đúng bằng Tổng", () => {
    for (const s of FILE.snapshots) for (const m of Object.values(s.thi_truong)) for (const b of m.bang) {
        const tong = b.dong.find((d) => d.tong);
        if (!tong || !b.ty_le_theo_tong) continue;
        for (const n of NHOM) {
            const cong = b.dong.filter((d) => !d.tong).reduce((x, d) => x + d[n], 0);
            assert.strictEqual(cong, tong[n], `${b.tieu_de} / ${n}`);
        }
    }
});
t("xu hướng: ba dãy số dài bằng số mốc", () => {
    for (const s of FILE.snapshots) for (const m of Object.values(s.thi_truong)) {
        if (!m.xu_huong) continue;
        for (const n of NHOM) assert.strictEqual(m.xu_huong[n].length, m.xu_huong.moc.length, `${m.ten} ${n}`);
    }
});
t("tỷ lệ nữ và tỷ trọng tuổi tính từ điểm giữa", () => {
    assert.strictEqual(giua([100, 300]), 200);
    const tep = { nam: [90, 110], nu: [280, 320], tuoi: { "18-24": [10, 10], "25-34": [20, 20], "35-44": [30, 30], "45+": [40, 40] } };
    assert.strictEqual(tyLeNu(tep), 0.75);
    assert.deepStrictEqual(tyLeTuoi(tep), [0.1, 0.2, 0.3, 0.4]);
    assert.strictEqual(tyLeNu({ nam: [0, 0], nu: [0, 0], tuoi: {} }), 0);
});
t("lọc theo nước: leader Sing chỉ thấy SG, bản đo hết nước thì bỏ", () => {
    const sg = locTheoNuoc(FILE, (c) => c === "SG");
    assert.ok(sg.snapshots.length >= 1);
    for (const s of sg.snapshots) assert.deepStrictEqual(Object.keys(s.thi_truong), ["SG"]);
    assert.deepStrictEqual(locTheoNuoc(FILE, (c) => c === "AE").snapshots, []);
    // Không sửa bản gốc.
    assert.ok(Object.keys(FILE.snapshots[0].thi_truong).length >= 3);
});
console.log(`tep-khach: ${pass} test qua`);

#!/usr/bin/env node
/**
 * Nạp số J&T VIP vào kho dashboard (data/jt_vn.json) từ file jt_vn_raw.json do
 * ops/jt_vn/xuat-tu-trang-jt.js tải về.
 *
 *   cd dashboard-ui && npm test          # dựng .test-build/jt-vn.js (một lần sau khi sửa lib)
 *   node ops/jt_vn/nap.cjs ~/Downloads/jt_vn_raw.json /tmp/jt_vn.json
 *   scp /tmp/jt_vn.json root@139.180.131.21:/opt/talpha/data/jt_vn.json   # không cần restart
 */
const fs = require("fs");
const path = require("path");
const J = require(path.join(__dirname, "../../dashboard-ui/.test-build/jt-vn.js"));

const [vao, ra] = process.argv.slice(2);
if (!vao || !ra) { console.error("Dùng: node nap.cjs <jt_vn_raw.json> <jt_vn.json>"); process.exit(1); }
const raw = JSON.parse(fs.readFileSync(vao, "utf-8"));
if (!Array.isArray(raw.ky) || !raw.chi_tiet || !Array.isArray(raw.dang_chay)) throw new Error("File không đúng dạng jt_vn_raw");

const so = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const ky = raw.ky.map((r) => {
    const k = J.chuanKy(r);
    const ct = raw.chi_tiet[k.ma];
    return { ...k, don: Array.isArray(ct) ? ct.map(J.chuanDonKy) : null };
});
const du_lieu = {
    keo_luc: raw.xuat_luc,
    so_du: raw.tq && raw.tq.notClearedBalance != null ? so(raw.tq.notClearedBalance) : null,
    so_du_cap_nhat: raw.tq && raw.tq.lastUpdateTime ? String(raw.tq.lastUpdateTime) : null,
    dang_chay_tong: raw.tong ? { so_don: so(raw.tong.codMoneyNum), cod: so(raw.tong.codMoney), cuoc: so(raw.tong.taxAfterFee) } : null,
    ky,
    dang_chay: raw.dang_chay.map(J.chuanDangChay),
};
fs.writeFileSync(ra, JSON.stringify({ du_lieu, loi: null, loi_luc: null }, null, 2));
const s = J.soJtVn(du_lieu, []);
console.log(`Đã ghi ${ra}: ${ky.length} kỳ, ${s.tong.don_da_doi_soat} vận đơn, đã chuyển về ${s.tong.da_ve.toLocaleString("vi-VN")}đ, ` +
    `số dư ${s.tong.so_du == null ? "?" : s.tong.so_du.toLocaleString("vi-VN")}đ, đang luân chuyển ${du_lieu.dang_chay.length} đơn.`);

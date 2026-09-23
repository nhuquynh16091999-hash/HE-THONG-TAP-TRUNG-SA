import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAlerts } from "../src/engine.mjs";
import { matchTransactions } from "../src/engine.mjs";
import { loadConfig } from "../src/run.mjs";

const base = loadConfig();
const cfg = (patch = {}) => {
    const c = structuredClone(base);
    for (const [k, v] of Object.entries(patch)) c[k] = { ...c[k], ...v };
    return c;
};
const fb = (o) => ({ src: "fb", line: 1, txn_id: "T", date: "2026-09-01", amount: 1000000, currency: "VND", account_id: "act_ok", account_name: "TK", method: "", card4: null, status: "Paid", status_norm: "paid", ...o });
const bk = (o) => ({ src: "bank", line: 1, date: "2026-09-01", ref: "", desc: "FACEBK", amount: 1000000, balance: null, card4: null, is_fb: true, ...o });

function run(fbRows, bankRows, c = cfg(), extra = {}) {
    const F = { rows: fbRows, skipped: [], meta: { warnings: [] } };
    const B = { rows: bankRows, other_ads: [], other: [], skipped: [], meta: { warnings: [] } };
    const match = matchTransactions(fbRows, bankRows, c);
    return buildAlerts({ fb: F, bank: B, match, cfg: c, ...extra });
}
const codes = (r) => r.alerts.map((a) => a.code);
const find = (r, code) => r.alerts.find((a) => a.code === code);

test("TKQC thu mà thẻ không trừ — giữa kỳ thì nghiêm trọng", () => {
    const r = run([fb({ date: "2026-09-01" })], [bk({ date: "2026-09-10", amount: 999 })]);
    const a = find(r, "FB_THU_MA_THE_KHONG_TRU");
    assert.ok(a);
    assert.equal(a.severity, "critical");
    assert.equal(a.amount, 1000000);
});

test("TKQC thu sát cuối kỳ sao kê thì chỉ cảnh báo, không báo động", () => {
    const r = run([fb({ date: "2026-09-09" })], [bk({ date: "2026-09-10", amount: 555 })]);
    assert.equal(find(r, "FB_THU_MA_THE_KHONG_TRU").severity, "warn");
});

test("thẻ trừ mà không có hoá đơn — khoản lớn là nghiêm trọng", () => {
    const r = run([], [bk({ amount: 21000000, desc: "FACEBK *NN55" })]);
    const a = find(r, "THE_TRU_MA_KHONG_CO_HOA_DON");
    assert.equal(a.severity, "critical");
    assert.equal(a.amount, 21000000);
});

test("khoản nhỏ lẻ không hoá đơn được xếp là phí thẻ, không phải mất tiền", () => {
    const r = run([], [bk({ amount: 62500, desc: "PHI GIAO DICH QUOC TE FACEBK" })]);
    assert.ok(codes(r).includes("PHI_THE_RIENG"));
    assert.ok(!codes(r).includes("THE_TRU_MA_KHONG_CO_HOA_DON"));
    assert.equal(r.summary.fee_total, 62500);
});

test("hai dòng cùng số tiền mà chỉ một hoá đơn = nghi trừ trùng", () => {
    const r = run([fb({ amount: 9900000, date: "2026-09-03" })],
                  [bk({ line: 1, amount: 9900000, date: "2026-09-04" }), bk({ line: 2, amount: 9900000, date: "2026-09-04" })]);
    const a = find(r, "TRU_TRUNG");
    assert.equal(a.severity, "critical");
    assert.match(a.detail, /Dòng 2.*dòng 1|Dòng 1.*dòng 2/);
});

test("hai hoá đơn cùng giá thì hai dòng trừ là bình thường, không báo trùng", () => {
    const r = run([fb({ txn_id: "A", amount: 9900000 }), fb({ txn_id: "B", amount: 9900000 })],
                  [bk({ line: 1, amount: 9900000 }), bk({ line: 2, amount: 9900000 })]);
    assert.ok(!codes(r).includes("TRU_TRUNG"));
});

test("thẻ ngoài danh sách công ty là cảnh báo đỏ", () => {
    const c = cfg({ cards: { strict: true, list: [{ last4: "4281", ten: "VCB Visa" }] } });
    const r = run([], [bk({ amount: 4500000, card4: "9911" })], c);
    const a = find(r, "THE_LA");
    assert.equal(a.severity, "critical");
    assert.match(a.title, /9911/);
});

test("chưa khai thẻ thì nhắc khai, không báo bừa thẻ lạ", () => {
    const r = run([], [bk({ card4: "9911" })]);
    assert.ok(codes(r).includes("CHUA_KHAI_THE"));
    assert.ok(!codes(r).includes("THE_LA"));
});

test("TKQC ngoài roster là cảnh báo đỏ", () => {
    const roster = { projects: { talpha: { accounts: [{ id: "act_ok" }] } } };
    const r = run([fb({ account_id: "act_la", account_name: "TK LẠ", amount: 4500000 })], [bk({ amount: 4500000 })], cfg(), { roster });
    const a = find(r, "TKQC_LA");
    assert.equal(a.severity, "critical");
    assert.match(a.title, /act_la/);
});

test("hoá đơn báo lỗi mà thẻ vẫn trừ = phải đòi lại", () => {
    const r = run([fb({ status: "Failed", status_norm: "failed", amount: 11300000 })], [bk({ amount: 11300000 })]);
    const a = find(r, "FB_LOI_MA_VAN_TRU");
    assert.equal(a.severity, "critical");
});

test("ngân hàng trừ dư ít thì chỉ ghi nhận là phí, dư nhiều thì cảnh báo", () => {
    const nhe = run([fb({ amount: 10000000 })], [bk({ amount: 10050000 })]);
    assert.equal(find(nhe, "PHI_AN").severity, "info");
    const nang = run([fb({ amount: 10000000 })], [bk({ amount: 10300000 })]);
    assert.equal(find(nang, "PHI_AN").severity, "warn");
});

test("vượt trần ngân sách tuần", () => {
    const c = cfg({ budget: { weekly_cap: 5000000 } });
    const r = run([fb({ amount: 8000000 })], [bk({ amount: 8000000 })], c);
    const a = find(r, "VUOT_NGAN_SACH");
    assert.equal(a.severity, "critical");
    assert.equal(a.amount, 3000000);
});

test("tăng vọt so với kỳ trước", () => {
    const history = [{ ky: "2026-W35", summary: { bank_total: 10000000 } }];
    const r = run([fb({ amount: 20000000 })], [bk({ amount: 20000000 })], cfg(), { history });
    const a = find(r, "TANG_BAT_THUONG");
    assert.equal(a.severity, "critical");
    assert.match(a.title, /100%/);
});

test("mọi cảnh báo đều phải có hướng xử lý và xếp nghiêm trọng lên đầu", () => {
    const r = run([fb({ date: "2026-09-01", amount: 5000000 })], [bk({ date: "2026-09-01", amount: 21000000 })]);
    assert.ok(r.alerts.length > 1);
    assert.ok(r.alerts.every((a) => a.hint && a.title));
    const rank = { critical: 0, warn: 1, info: 2 };
    const seq = r.alerts.map((a) => rank[a.severity]);
    assert.deepEqual(seq, [...seq].sort((x, y) => x - y));
});

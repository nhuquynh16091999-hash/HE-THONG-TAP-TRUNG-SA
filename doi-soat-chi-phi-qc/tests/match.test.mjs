import { test } from "node:test";
import assert from "node:assert/strict";
import { matchTransactions } from "../src/engine.mjs";
import { loadConfig } from "../src/run.mjs";

const CFG = loadConfig();
const fb = (o) => ({ src: "fb", line: 1, txn_id: "T", date: "2026-09-01", amount: 1000000, currency: "VND", account_id: "act_1", account_name: "TK", method: "", card4: null, status: "Paid", status_norm: "paid", ...o });
const bk = (o) => ({ src: "bank", line: 1, date: "2026-09-01", ref: "", desc: "FACEBK", amount: 1000000, balance: null, card4: null, is_fb: true, ...o });

test("khớp đúng ngày đúng tiền", () => {
    const m = matchTransactions([fb({})], [bk({})], CFG);
    assert.equal(m.pairs.length, 1);
    assert.equal(m.pairs[0].exact, true);
    assert.equal(m.pairs[0].confidence, "cao");
});

test("khớp khi ngân hàng trừ trễ trong cửa sổ ngày", () => {
    const m = matchTransactions([fb({ date: "2026-09-01" })], [bk({ date: "2026-09-03" })], CFG);
    assert.equal(m.pairs.length, 1);
    assert.equal(m.pairs[0].date_diff, 2);
});

test("KHÔNG khớp khi trễ quá cửa sổ — thà báo thiếu còn hơn ghép bừa", () => {
    const m = matchTransactions([fb({ date: "2026-09-01" })], [bk({ date: "2026-09-10" })], CFG);
    assert.equal(m.pairs.length, 0);
    assert.equal(m.fb_unmatched.length, 1);
    assert.equal(m.bank_unmatched.length, 1);
});

test("ngân hàng trừ nhiều hơn trong khung phí vẫn coi là cùng giao dịch", () => {
    const m = matchTransactions([fb({ amount: 10000000 })], [bk({ amount: 10300000 })], CFG);
    assert.equal(m.pairs.length, 1);
    assert.equal(m.pairs[0].exact, false);
    assert.equal(m.pairs[0].amount_diff, 300000);
});

test("ngân hàng trừ nhiều hơn vượt trần phí thì không ghép", () => {
    const m = matchTransactions([fb({ amount: 10000000 })], [bk({ amount: 11000000 })], CFG);
    assert.equal(m.pairs.length, 0);
});

test("ngân hàng trừ ÍT hơn ngoài dung sai thì không ghép", () => {
    const m = matchTransactions([fb({ amount: 10000000 })], [bk({ amount: 9000000 })], CFG);
    assert.equal(m.pairs.length, 0);
});

test("mỗi dòng chỉ dùng một lần — dư ra thì báo dư", () => {
    const m = matchTransactions(
        [fb({ txn_id: "A", amount: 5000000 })],
        [bk({ line: 1, amount: 5000000 }), bk({ line: 2, amount: 5000000 })], CFG);
    assert.equal(m.pairs.length, 1);
    assert.equal(m.bank_unmatched.length, 1);
});

test("nhiều lựa chọn ngang nhau thì đánh dấu nghi ngờ chứ không im lặng chọn", () => {
    const m = matchTransactions(
        [fb({ txn_id: "A", amount: 5000000, date: "2026-09-02" })],
        [bk({ line: 1, amount: 5000000, date: "2026-09-01" }), bk({ line: 2, amount: 5000000, date: "2026-09-03" })], CFG);
    assert.equal(m.pairs.length, 1);
    assert.equal(m.pairs[0].ambiguous, true);
    assert.equal(m.pairs[0].confidence, "thap");
});

test("ưu tiên cặp cùng thẻ khi số tiền và ngày như nhau", () => {
    const m = matchTransactions(
        [fb({ txn_id: "A", card4: "7733" })],
        [bk({ line: 1, card4: "4281" }), bk({ line: 2, card4: "7733" })], CFG);
    assert.equal(m.pairs[0].bank.line, 2);
    assert.equal(m.pairs[0].card_ok, true);
});

test("cặp lệch thẻ bị hạ độ tin cậy", () => {
    const m = matchTransactions([fb({ card4: "7733" })], [bk({ card4: "4281" })], CFG);
    assert.equal(m.pairs.length, 1);
    assert.equal(m.pairs[0].card_ok, false);
    assert.equal(m.pairs[0].confidence, "thap");
});

test("giao dịch FB thất bại không tham gia ghép", () => {
    const m = matchTransactions([fb({ status: "Failed", status_norm: "failed" })], [bk({})], CFG);
    assert.equal(m.pairs.length, 0);
    assert.equal(m.fb_failed.length, 1);
    assert.equal(m.stats.fb_chargeable, 0);
});

test("ghép ưu tiên ngày sát nhau trước", () => {
    const m = matchTransactions(
        [fb({ txn_id: "A", date: "2026-09-01" }), fb({ txn_id: "B", date: "2026-09-03" })],
        [bk({ line: 1, date: "2026-09-01" }), bk({ line: 2, date: "2026-09-03" })], CFG);
    const byTxn = Object.fromEntries(m.pairs.map((p) => [p.fb.txn_id, p.bank.line]));
    assert.deepEqual(byTxn, { A: 1, B: 2 });
});

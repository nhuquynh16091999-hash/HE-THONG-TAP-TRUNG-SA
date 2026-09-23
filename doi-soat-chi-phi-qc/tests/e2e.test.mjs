import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { runReconciliation, loadConfig, ROOT } from "../src/run.mjs";
import { buildMessage } from "../src/engine.mjs";
import { toCsv } from "../src/engine.mjs";

const MAU = join(ROOT, "data", "mau");
const FB = join(MAU, "MAU_chi-phi-tkqc-fb_2026-09-01_07.xlsx");
const BANK = join(MAU, "MAU_sao-ke-the_2026-09-01_08.xlsx");

function chay(a = FB, b = BANK) {
    return runReconciliation([{ path: a }, { path: b }], { cfg: loadConfig(), save: false });
}   // bất đồng bộ vì có thể phải nạp bộ đọc PDF

test("chạy trọn vẹn trên file mẫu và bắt đúng từng loại lệch đã gài", async () => {
    const r = await chay();
    const codes = r.alerts.map((a) => a.code);

    assert.equal(r.ky, "2026-W36");
    assert.equal(r.stats.fb_total, 12);
    assert.equal(r.stats.bank_total, 13);
    assert.equal(r.files.fb.length, 1);
    assert.equal(r.files.bank.length, 1);

    // Đủ 3 loại lệch nghiêm trọng đã gài trong file mẫu
    assert.ok(codes.includes("THE_TRU_MA_KHONG_CO_HOA_DON"), "phải bắt được 21tr trừ mà không có hoá đơn");
    assert.ok(codes.includes("TRU_TRUNG"), "phải bắt được lần trừ trùng 9,9tr");
    assert.ok(codes.includes("TKQC_LA"), "phải bắt được TKQC lạ");

    // Và các loại cần người xem
    assert.ok(codes.includes("FB_THU_MA_THE_KHONG_TRU"));
    assert.ok(codes.includes("PHI_AN"));
    assert.ok(codes.includes("LECH_THE"));
    assert.ok(codes.includes("ADS_KENH_KHAC"));
    assert.ok(codes.includes("PHI_THE_RIENG"));

    assert.equal(r.summary.at_risk, 21000000 + 9900000 + 4500000);
});

test("đảo thứ tự 2 file vẫn ra kết quả y hệt", async () => {
    const xuoi = await chay(FB, BANK);
    const nguoc = await chay(BANK, FB);
    assert.deepEqual(nguoc.summary, xuoi.summary);
    assert.equal(nguoc.pairs.length, xuoi.pairs.length);
});

test("tổng tiền cộng lại phải kín — không đồng nào biến mất giữa đường", async () => {
    const r = await chay();
    const bankKhop = r.pairs.reduce((s, p) => s + p.bank.amount, 0);
    const bankDu = r.bank_unmatched.reduce((s, x) => s + x.amount, 0);
    assert.equal(bankKhop + bankDu, r.summary.bank_total);

    const fbKhop = r.pairs.reduce((s, p) => s + p.fb.amount, 0);
    const fbDu = r.fb_unmatched.reduce((s, x) => s + x.amount, 0);
    assert.equal(fbKhop + fbDu, r.summary.fb_total);
});

test("tin nhắn cảnh báo có đủ số tiền rủi ro và không rỗng", async () => {
    const cfg = loadConfig();
    const msg = buildMessage(await chay(), cfg);
    assert.match(msg, /ĐỐI SOÁT CHI PHÍ QUẢNG CÁO/);
    assert.match(msg, /35\.400\.000/);
    assert.match(msg, /2026-W36/);
});

test("CSV xuất đủ mọi dòng của cả hai nguồn", async () => {
    const r = await chay();
    const csv = toCsv(r);
    // Kiểm tra BOM trên chuỗi GỐC: trim() của JS coi U+FEFF là khoảng trắng và nuốt mất
    assert.ok(csv.startsWith("\ufeff"), "phải có BOM để Excel trên Windows không vỡ tiếng Việt");
    const lines = csv.split("\r\n").filter((l) => l.trim() !== "");
    const expect = 1 + r.pairs.length + r.fb_unmatched.length + r.bank_unmatched.length
                     + r.fb_failed.length + r.other_ads.length;
    assert.equal(lines.length, expect);
});

test("thiếu cột bắt buộc thì báo lỗi nói rõ thiếu gì, không chạy tiếp", async () => {
    const cfg = loadConfig();
    await assert.rejects(
        () => runReconciliation([{ path: "a.csv", buffer: Buffer.from("cot1,cot2\n1,2\n") },
                                 { path: "b.csv", buffer: Buffer.from("cot3,cot4\n3,4\n") }], { cfg, save: false }),
        /Cần cả hai phía|Không phân biệt được|thiếu cột|Không tìm thấy/i);
});

test("lịch sử chỉ lấy kỳ CŨ hơn — chạy lại kỳ cũ không so ngược với kỳ mới", async () => {
    const { loadHistory } = await import("../src/run.mjs");
    const all = loadHistory(null).map((h) => h.ky);
    for (const ky of all) {
        assert.ok(loadHistory(ky).every((h) => h.ky < ky), `kỳ ${ky} không được lấy kỳ mới hơn làm kỳ trước`);
    }
});

test("sao kê PDF ra ĐÚNG cùng kết quả với bản .xlsx", async () => {
    // Cùng một sao kê, hai định dạng. Bộ đọc PDF phải dựng lại đúng bảng từ
    // toạ độ chữ — sai một cột là tiền rơi sang cột khác mà vẫn ra số đẹp,
    // nên phải so bằng chính con số cuối cùng chứ không chỉ xem có đọc được.
    const PDF = join(MAU, "MAU_sao-ke-the_2026-09-01_08.pdf");
    const [xlsx, pdf] = [await chay(FB, BANK), await chay(FB, PDF)];

    assert.equal(pdf.summary.bank_total, xlsx.summary.bank_total);
    assert.equal(pdf.summary.at_risk, xlsx.summary.at_risk);
    assert.equal(pdf.stats.matched, xlsx.stats.matched);
    assert.deepEqual(pdf.alerts.map((a) => a.code).sort(), xlsx.alerts.map((a) => a.code).sort());
});

test("PDF scan (không có lớp chữ) báo lỗi rõ chứ không trả bảng rỗng", async () => {
    const { readAnySheets } = await import("../src/engine.mjs");
    // PDF hợp lệ tối thiểu, một trang trắng, không có chữ nào
    const trong = Buffer.from(
        "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
        "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
        "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n" +
        "trailer<</Root 1 0 R>>\n", "latin1");
    await assert.rejects(() => readAnySheets("scan.pdf", trong), /SCAN|không lấy ra chữ|lớp chữ/i);
});

test("chia đôi sao kê thành 2 file rồi tải cả hai — ra đúng cùng kết quả", async () => {
    // Công ty nhiều thẻ thì mỗi thẻ một sao kê. Gộp tay bằng Excel trước khi
    // tải lên là trả việc về đúng chỗ mà hệ thống này sinh ra để bỏ đi.
    const { readAnySheets } = await import("../src/engine.mjs");
    const sheets = await readAnySheets(BANK);
    const rows = sheets[0].rows;
    const head = rows[0], than = rows.slice(1);
    const nua = Math.ceil(than.length / 2);

    const csv = (rs) => Buffer.from([head, ...rs]
        .map((r) => r.map((c) => {
            const v = c instanceof Date ? c.toISOString().slice(0, 10) : (c ?? "");
            return /[",;\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v;
        }).join(",")).join("\n"), "utf8");

    const cfg = loadConfig();
    const mot = await runReconciliation([{ path: FB }, { path: BANK }], { cfg, save: false });
    const hai = await runReconciliation([
        { path: FB },
        { path: "the-1.csv", buffer: csv(than.slice(0, nua)) },
        { path: "the-2.csv", buffer: csv(than.slice(nua)) },
    ], { cfg, save: false });

    assert.equal(hai.files.bank.length, 2, "phải nhận cả hai file sao kê");
    assert.equal(hai.summary.bank_total, mot.summary.bank_total);
    assert.equal(hai.summary.at_risk, mot.summary.at_risk);
    assert.equal(hai.stats.matched, mot.stats.matched);
});

test("tải nhầm cùng một file hai lần thì bỏ bản trùng, KHÔNG đếm gấp đôi", async () => {
    // Không bỏ thì bản thứ hai không ghép được với ai và nổi lên thành
    // "TKQC thu mà thẻ không trừ" — báo động giả, loại đắt tiền nhất.
    const cfg = loadConfig();
    const mot = await runReconciliation([{ path: FB }, { path: BANK }], { cfg, save: false });
    const hai = await runReconciliation([{ path: FB }, { path: BANK }, { path: BANK }], { cfg, save: false });

    assert.equal(hai.summary.bank_total, mot.summary.bank_total, "tổng tiền không được nhân đôi");
    assert.equal(hai.summary.at_risk, mot.summary.at_risk);
    assert.ok(hai.alerts.some((a) => a.code === "TRUNG_GIUA_FILE"), "phải nói ra là đã bỏ dòng trùng");
});

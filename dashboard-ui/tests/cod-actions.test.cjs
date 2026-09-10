/**
 * Phép thử TRÍ NHỚ của đối soát — thứ do người ghi, không phải máy đọc từ file.
 *
 * Ba thứ được canh ở đây, và cả ba đều là chỗ mất tiền thật:
 *   · tiền NAZA chuyển về tài khoản có khớp số sao kê tính ra không
 *   · đòi rồi mà NAZA im thì việc có nổi lại không
 *   · tỷ giá NAZA tự đặt đã lấy của mình bao nhiêu đồng
 */
const assert = require("assert");
const A = require("../.test-build/cod-actions.js");

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log("  ✓", name); };

const bank = (o) => ({ thuc_nhan_vnd: 1_000_000, ngay_ve: "2026-09-05", luc: "2026-09-05T00:00:00Z", ...o });

console.log("── Khoá kho ──");

t("khoá kho tiền về là TÊN FILE, không phân biệt hoa thường và khoảng trắng", () => {
    assert.strictEqual(A.bankKey("  ĐỐI SOÁT COD 2026.09.04.xlsx "), "đối soát cod 2026.09.04.xlsx");
});

t("BẪY THẬT: tải lại cùng file sinh id mới — khoá theo tên file nên không mất số đã đối chiếu", () => {
    // Route cod-recon thay bản cũ bằng bản mới và sinh id khác. Khoá theo id thì
    // mỗi lần NAZA gửi bản sửa là kỳ đó tụt về "chưa ai kiểm", trong khi đã kiểm rồi.
    assert.strictEqual(A.bankKey("F.xlsx"), A.bankKey("f.xlsx"));
});

t("khoá việc gộp loại với mã — hai loại việc trên cùng một đơn không đè nhau", () => {
    assert.notStrictEqual(A.doneKey("doi", "17965596"), A.doneKey("lech", "17965596"));
    assert.strictEqual(A.doneKey("doi", " 17965596 "), "doi:17965596");
});

console.log("── Vòng đời một kỳ sao kê ──");

t("chưa đọc được số phải nhận → thiếu file, không so được", () => {
    const r = A.periodState(null, undefined);
    assert.strictEqual(r.state, "thieu_file");
    assert.strictEqual(r.lech_vnd, null);
});

t("biết phải nhận nhưng chưa ai nhập tiền về → chờ nhập", () => {
    assert.strictEqual(A.periodState(38_927_360, undefined).state, "cho_nhap");
});

t("tiền về đúng số → khớp, kỳ XONG", () => {
    const r = A.periodState(38_927_360, bank({ thuc_nhan_vnd: 38_927_360 }));
    assert.strictEqual(r.state, "khop");
    assert.strictEqual(r.lech_vnd, 0);
});

t("lệch trong ngưỡng vẫn coi là khớp — quy đổi ba tầng có làm tròn", () => {
    // NT$ → ¥ → đ, mỗi tầng làm tròn, cộng phí chuyển khoản vài chục nghìn.
    // Bắt lệch tuyệt đối thì kỳ nào cũng đỏ và người dùng học cách phớt lờ màu đỏ.
    const r = A.periodState(38_927_360, bank({ thuc_nhan_vnd: 38_900_000 }));
    assert.strictEqual(r.state, "khop");
    assert.strictEqual(r.lech_vnd, -27_360);
});

t("BẪY THẬT: NAZA chuyển thiếu 1 triệu → phải bắt được, đây là chỗ mất tiền", () => {
    // File soát sạch cả 8 mục vẫn không nói được gì về khoản này — nó chỉ hiện
    // ra khi có người mở app ngân hàng gõ số thật vào.
    const r = A.periodState(38_927_360, bank({ thuc_nhan_vnd: 37_927_360 }));
    assert.strictEqual(r.state, "lech");
    assert.strictEqual(r.lech_vnd, -1_000_000);
});

t("chuyển DƯ cũng là lệch — dư nghĩa là có chỗ tính sai", () => {
    assert.strictEqual(A.periodState(1_000_000, bank({ thuc_nhan_vnd: 1_200_000 })).state, "lech");
});

t("BẪY THẬT: số phải nhận có đuôi thập phân — lệch phải làm tròn về đồng", () => {
    // 38.927.359,52 là số thật của kỳ 25/08 (nhân chia ba tầng NT$ → ¥ → đ).
    // Không làm tròn thì tiền về đúng khớp vẫn hiện "lệch 0,48đ", nhìn như
    // hệ thống tính sai.
    const r = A.periodState(38_927_359.52, bank({ thuc_nhan_vnd: 38_927_360 }));
    assert.strictEqual(r.lech_vnd, 0);
    assert.strictEqual(r.state, "khop");
});

t("ngưỡng đúng bằng 50.000 vẫn tính là khớp, hơn một đồng là lệch", () => {
    assert.strictEqual(A.periodState(1_000_000, bank({ thuc_nhan_vnd: 950_000 })).state, "khop");
    assert.strictEqual(A.periodState(1_000_000, bank({ thuc_nhan_vnd: 949_999 })).state, "lech");
});

console.log("── Việc đã đóng có nổi lại không ──");

const KY = ["2026-07-20", "2026-08-11", "2026-08-17", "2026-08-25"];

t("chưa làm gì thì đương nhiên còn việc", () => {
    assert.strictEqual(A.shouldResurface(undefined, KY).lai, true);
});

t("vừa đòi hôm nay, chưa kỳ nào chốt thêm → việc ĐÓNG, không hiện lại", () => {
    // Đúng lời Sỹ Anh chê: "việc làm xong rồi vẫn hiện".
    const r = A.shouldResurface({ viec: "da_doi", ngay: "2026-08-26", lan: 1 }, KY);
    assert.strictEqual(r.lai, false);
    assert.strictEqual(r.ky_da_qua, 0);
});

t("đòi rồi mà qua thêm một kỳ vẫn chưa thấy tiền → NỔI LẠI", () => {
    // NAZA trả theo kỳ chứ không theo ngày, nên phép thử thật là kỳ sau tiền
    // về chưa — không phải "đã bao nhiêu ngày".
    const r = A.shouldResurface({ viec: "da_doi", ngay: "2026-08-12", lan: 1 }, KY);
    assert.strictEqual(r.lai, true);
    assert.strictEqual(r.ky_da_qua, 2);
});

t("bỏ qua thì KHÔNG nổi lại — người ta đã chủ động chấp nhận", () => {
    const r = A.shouldResurface({ viec: "bo_qua", ngay: "2026-07-01", lan: 1, ghi_chu: "14 NT$, kệ" }, KY);
    assert.strictEqual(r.lai, false);
});

t("câu mô tả nói rõ ba trạng thái khác nhau", () => {
    assert.strictEqual(A.doiLabel(undefined, 0), "chưa đòi lần nào");
    assert.strictEqual(A.doiLabel({ viec: "da_doi", ngay: "2026-09-01", lan: 1 }, 0), "đã đòi 2026-09-01");
    assert.strictEqual(A.doiLabel({ viec: "da_doi", ngay: "2026-08-12", lan: 3 }, 2),
        "đã đòi 2026-08-12 (3 lần) — 2 kỳ rồi vẫn im");
});

console.log("── Tỷ giá đã lấy của mình bao nhiêu ──");

// Bảy kỳ thật của TALPHA, số lấy từ chính file sao kê NAZA.
const THAT = [
    { filename: "f1", period_date: "2026-08-25", rate_twd_rmb: 0.203, rate_rmb_vnd: 3860, cod_twd: 69044 },
    { filename: "f2", period_date: "2026-08-17", rate_twd_rmb: 0.2037, rate_rmb_vnd: 3860, cod_twd: 97373 },
    { filename: "f3", period_date: "2026-08-11", rate_twd_rmb: 0.2022, rate_rmb_vnd: 3860, cod_twd: 56486 },
    { filename: "f4", period_date: "2026-08-02", rate_twd_rmb: 0.2014, rate_rmb_vnd: 3850, cod_twd: 21475 },
    { filename: "f5", period_date: "2026-07-28", rate_twd_rmb: 0.2006, rate_rmb_vnd: 3885, cod_twd: 17887 },
    { filename: "f6", period_date: "2026-07-20", rate_twd_rmb: 0.1995, rate_rmb_vnd: 3900, cod_twd: 30233 },
    { filename: "f7", period_date: "2026-07-13", rate_twd_rmb: 0.2006, rate_rmb_vnd: null, cod_twd: 3847 },
];

t("mốc là kỳ TỐT NHẤT chính NAZA từng đặt — mốc đó họ không cãi được", () => {
    const r = A.fxLoss(THAT);
    assert.strictEqual(r.best_period, "2026-08-17");
    assert.ok(Math.abs(r.best_vnd_per_twd - 0.2037 * 3860) < 1e-9);
    assert.strictEqual(r.rows.find((x) => x.filename === "f2").thiet_vnd, 0);
    assert.strictEqual(r.rows.find((x) => x.filename === "f2").tot_nhat, true);
});

t("BẪY: tính trên TÍCH cả hai chặng, không chỉ chặng TWD→RMB", () => {
    // Kỳ 28/07 có chặng đầu tệ (0,2006) nhưng chặng sau bù lại (3885 thay vì
    // 3860). Đo riêng chặng đầu ra 215.422đ, đo cả hai chặng chỉ 124.315đ —
    // đo riêng thổi phồng thiệt hại lên gần gấp đôi.
    const r = A.fxLoss(THAT);
    const f5 = r.rows.find((x) => x.filename === "f5");
    assert.ok(f5.thiet_vnd > 120_000 && f5.thiet_vnd < 130_000,
        `thiệt kỳ 28/07 phải quanh 124k, đang là ${Math.round(f5.thiet_vnd)}`);
});

t("kỳ thiếu tỷ giá thì trả null, KHÔNG coi như 0", () => {
    // Coi như 0 là ngầm bảo "kỳ này tỷ giá hoàn hảo" — sai theo hướng đẹp hơn thật.
    const f7 = A.fxLoss(THAT).rows.find((x) => x.filename === "f7");
    assert.strictEqual(f7.thiet_vnd, null);
    assert.strictEqual(f7.vnd_per_twd, null);
});

t("tổng thiệt cộng đúng phần các kỳ đọc được tỷ giá", () => {
    const r = A.fxLoss(THAT);
    const cong = r.rows.reduce((a, x) => a + (x.thiet_vnd ?? 0), 0);
    assert.ok(Math.abs(r.total_thiet_vnd - cong) < 1e-6);
    assert.ok(r.total_thiet_vnd > 1_000_000 && r.total_thiet_vnd < 1_300_000,
        `tổng thiệt 6 kỳ phải quanh 1,1 triệu, đang là ${Math.round(r.total_thiet_vnd)}`);
});

t("không kỳ nào đọc được tỷ giá thì không sập, trả null hết", () => {
    const r = A.fxLoss([{ filename: "x", period_date: "", rate_twd_rmb: null, rate_rmb_vnd: null, cod_twd: 100 }]);
    assert.strictEqual(r.best_vnd_per_twd, null);
    assert.strictEqual(r.total_thiet_vnd, 0);
    assert.strictEqual(r.rows[0].thiet_vnd, null);
});

console.log(`\n${pass} phép thử — tất cả đạt.`);

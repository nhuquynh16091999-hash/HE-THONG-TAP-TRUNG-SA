/**
 * TRÍ NHỚ CỦA VIỆC ĐỐI SOÁT — thứ duy nhất trong tab này do NGƯỜI ghi, không
 * phải máy đọc ra từ file.
 *
 * Ba việc con người làm mà file sao kê không bao giờ kể được:
 *
 *   1. Tiền NAZA chuyển thật về tài khoản là bao nhiêu, ngày nào.
 *      Sao kê nói "phải chuyển về 38.927.360đ". Họ chuyển bao nhiêu thì chỉ
 *      ngân hàng biết. Đây là khâu cuối và là khâu dễ mất tiền nhất: file soát
 *      sạch cả 8 mục mà lúc chuyển khoản thiếu thì không ai hay. Sỹ Anh xác
 *      nhận từ trước tới giờ CHƯA AI KIỂM KỸ khoản này — 156 triệu đã đi qua
 *      6 lần chuyển khoản chưa lần nào được đối chiếu.
 *
 *   2. Đã nhắn NAZA đòi tiền chưa, ngày nào, mấy lần.
 *      Không ghi thì màn hình lặp lại y hệt mỗi ngày, và người dùng không phân
 *      biệt được "chưa đòi" với "đòi rồi mà nó im".
 *
 *   3. Khoản lệch nào đã hỏi, khoản nào chấp nhận bỏ qua.
 *      Không có chỗ đóng thì mọi cảnh báo nằm đó vĩnh viễn và người ta học được
 *      thói quen bỏ qua cảnh báo — lúc đó cảnh báo thật cũng chìm theo.
 *
 * File này CHỈ chứa logic thuần để còn viết được phép thử. Phần đọc ghi kho
 * nằm ở route.
 */

// ─────────────────────────────────────────────────────────────────────────
// Kiểu
// ─────────────────────────────────────────────────────────────────────────

/** Một lần tiền về tài khoản, do người ghi sau khi mở app ngân hàng. */
export type BankEntry = {
    thuc_nhan_vnd: number;
    /** YYYY-MM-DD — ngày tiền vào tài khoản, không phải ngày ghi. */
    ngay_ve: string;
    ghi_chu?: string;
    /** ISO — lúc bấm ghi, để còn truy ai ghi lúc nào. */
    luc: string;
};

/**
 * `da_doi`  — đã nhắn NAZA đòi tiền đơn này
 * `da_hoi`  — đã hỏi NAZA về khoản lệch này, đang chờ trả lời
 * `bo_qua`  — chấp nhận, không theo nữa (phải kèm lý do)
 */
export type DoneKind = "da_doi" | "da_hoi" | "bo_qua";

export type DoneEntry = {
    viec: DoneKind;
    /** YYYY-MM-DD của lần gần nhất. */
    ngay: string;
    /** Đã làm mấy lần — đòi ba lần mà vẫn im là chuyện khác hẳn đòi một lần. */
    lan: number;
    ghi_chu?: string;
};

export type CodActions = {
    /** Khoá = TÊN FILE sao kê, không phải id. */
    bank: Record<string, BankEntry>;
    /** Khoá = `${loai}:${mã}` — xem doneKey(). */
    done: Record<string, DoneEntry>;
};

export const emptyActions = (): CodActions => ({ bank: {}, done: {} });

/**
 * Khoá của kho `bank` là TÊN FILE chứ không phải id bản sao kê.
 *
 * Tải lại cùng một file thì bản cũ bị thay và id mới được sinh ra
 * (replaceSameFile ở route cod-recon). Khoá theo id thì mỗi lần NAZA gửi bản
 * sửa là mất luôn số tiền đã đối chiếu, và kỳ đó tụt về "chưa ai kiểm" trong
 * khi thực tế đã kiểm rồi. Tên file mới là thứ định danh một kỳ.
 */
export const bankKey = (filename: string) => filename.trim().toLowerCase();

/** Khoá việc: gộp loại với mã đơn để hai loại việc trên cùng một đơn không đè nhau. */
export const doneKey = (loai: "doi" | "lech" | "thua" | "phi", ma: string) =>
    `${loai}:${String(ma || "").trim().toUpperCase()}`;

// ─────────────────────────────────────────────────────────────────────────
// Vòng đời một kỳ sao kê
// ─────────────────────────────────────────────────────────────────────────

/**
 * `thieu_file` — không đọc được số phải nhận (file thiếu sheet TỔNG)
 * `cho_nhap`   — biết phải nhận bao nhiêu, chưa ai nhập số tiền thật về
 * `khop`       — đã nhập, lệch trong ngưỡng → kỳ này XONG
 * `lech`       — đã nhập, lệch quá ngưỡng → phải đi hỏi
 */
export type PeriodState = "thieu_file" | "cho_nhap" | "khop" | "lech";

export const STATE_LABEL: Record<PeriodState, string> = {
    thieu_file: "File thiếu sheet TỔNG",
    cho_nhap: "Chờ nhập tiền về",
    khop: "Đã khớp — xong",
    lech: "Lệch tiền về",
};

/**
 * Ngưỡng bỏ qua khi so tiền về với số sao kê tính ra.
 *
 * Không để 0: phép quy đổi ba tầng (NT$ → ¥ → đ) làm tròn ở từng tầng, cộng
 * thêm phí chuyển khoản ngân hàng vài chục nghìn. Bắt lệch tuyệt đối thì kỳ
 * nào cũng đỏ và người dùng học cách phớt lờ màu đỏ.
 *
 * 50.000đ trên một kỳ trung bình 26 triệu là 0,2% — đủ chặt để bắt được sai
 * thật, đủ lỏng để không kêu vì tiền lẻ.
 */
export const BANK_TOLERANCE_VND = 50_000;

export function periodState(
    payableVnd: number | null | undefined,
    bank: BankEntry | undefined,
    tolerance = BANK_TOLERANCE_VND,
): { state: PeriodState; lech_vnd: number | null } {
    if (payableVnd == null) {
        // Không có số phải nhận thì không so được. NHƯNG nếu người ta đã tự
        // nhập tiền về thì vẫn ghi nhận — biết được bao nhiêu vẫn hơn không.
        return { state: "thieu_file", lech_vnd: null };
    }
    if (!bank) return { state: "cho_nhap", lech_vnd: null };
    // Làm tròn về đồng NGAY tại đây. Số phải nhận là kết quả nhân chia ba tầng
    // nên mang đuôi thập phân (38.927.359,52), trừ đi số nguyên người gõ vào ra
    // "lệch 0,48đ" — nhìn như hệ thống tính sai trong khi tiền về đúng khớp.
    const lech = Math.round(bank.thuc_nhan_vnd - payableVnd);
    return {
        state: Math.abs(lech) <= tolerance ? "khop" : "lech",
        lech_vnd: lech,
    };
}

// ─────────────────────────────────────────────────────────────────────────
// Việc đã đóng có nổi lại không
// ─────────────────────────────────────────────────────────────────────────

/**
 * Đóng một việc KHÔNG có nghĩa là quên nó.
 *
 * Nhắn NAZA đòi tiền hôm nay thì hôm nay việc biến mất — đúng. Nhưng NAZA trả
 * tiền theo KỲ, nên phép thử thật là: sang kỳ sao kê tiếp theo, tiền về chưa?
 * Chưa về thì việc phải nổi lại, và lần này nặng hơn vì đã đòi một lần rồi mà
 * họ vẫn im.
 *
 * Đếm theo KỲ chứ không theo ngày, cùng một lẽ với quy tắc quá hạn ở
 * order-ledger: NAZA chốt sổ theo kỳ, không theo lịch.
 *
 * `bo_qua` thì không nổi lại — người ta đã chủ động chấp nhận khoản đó.
 */
export function shouldResurface(
    done: DoneEntry | undefined,
    periodEnds: string[],
): { lai: boolean; ky_da_qua: number } {
    if (!done) return { lai: true, ky_da_qua: 0 };          // chưa làm gì thì đương nhiên còn việc
    if (done.viec === "bo_qua") return { lai: false, ky_da_qua: 0 };
    const qua = periodEnds.filter((d) => d > done.ngay).length;
    return { lai: qua >= 1, ky_da_qua: qua };
}

/** Câu mô tả tình trạng đòi, để màn hình khỏi phải tự ghép chuỗi. */
export function doiLabel(done: DoneEntry | undefined, kyDaQua: number): string {
    if (!done) return "chưa đòi lần nào";
    if (done.viec === "bo_qua") return `bỏ qua ${done.ngay}${done.ghi_chu ? ` — ${done.ghi_chu}` : ""}`;
    const lan = done.lan > 1 ? ` (${done.lan} lần)` : "";
    if (kyDaQua >= 1) return `đã đòi ${done.ngay}${lan} — ${kyDaQua} kỳ rồi vẫn im`;
    return `đã đòi ${done.ngay}${lan}`;
}

// ─────────────────────────────────────────────────────────────────────────
// Tỷ giá đã lấy của mình bao nhiêu
// ─────────────────────────────────────────────────────────────────────────

export type RatePeriod = {
    filename: string;
    period_date: string;
    rate_twd_rmb: number | null;
    rate_rmb_vnd: number | null;
    cod_twd: number;
};

export type FxRow = RatePeriod & {
    /** Đồng VND thu về trên mỗi NT$ — tích của hai chặng quy đổi. */
    vnd_per_twd: number | null;
    /** Mất bao nhiêu đồng so với kỳ có tỷ giá tốt nhất. Kỳ tốt nhất = 0. */
    thiet_vnd: number | null;
    tot_nhat: boolean;
};

/**
 * Sỹ Anh chốt: tỷ giá NAZA đặt thì PHẢI CHỊU, không cãi được.
 *
 * Vậy bảng "0,2022 · giảm 0,40%" không giúp quyết định gì hết — biết phần trăm
 * mà không làm gì được thì chỉ tổ rối mắt. Câu duy nhất còn đáng hỏi là: nó đã
 * lấy của mình bao nhiêu TIỀN.
 *
 * Mốc so sánh là kỳ tốt nhất CHÍNH NAZA từng đặt, không phải tỷ giá thị trường.
 * Lý do: mốc đó họ không cãi được — chính họ đã đặt ra nó một lần rồi. Lấy tỷ
 * giá ngân hàng làm mốc thì họ chỉ cần nói "bên tôi có phí quy đổi" là xong
 * chuyện.
 *
 * Tính trên TÍCH của hai chặng (TWD→RMB rồi RMB→VND) chứ không riêng chặng
 * đầu: hai chặng cùng đổi, và có kỳ chặng đầu tệ nhưng chặng sau bù lại. Đo
 * riêng một chặng ra con số to hơn thật.
 */
export function fxLoss(periods: RatePeriod[]): {
    best_vnd_per_twd: number | null;
    best_period: string | null;
    total_thiet_vnd: number;
    rows: FxRow[];
} {
    const eff = (p: RatePeriod) =>
        p.rate_twd_rmb != null && p.rate_rmb_vnd != null ? p.rate_twd_rmb * p.rate_rmb_vnd : null;

    const co = periods.filter((p) => eff(p) != null);
    if (!co.length) {
        return {
            best_vnd_per_twd: null, best_period: null, total_thiet_vnd: 0,
            rows: periods.map((p) => ({ ...p, vnd_per_twd: null, thiet_vnd: null, tot_nhat: false })),
        };
    }
    let best = co[0], bestV = eff(co[0])!;
    for (const p of co) {
        const v = eff(p)!;
        if (v > bestV) { best = p; bestV = v; }
    }

    let tong = 0;
    const rows: FxRow[] = periods.map((p) => {
        const v = eff(p);
        if (v == null) return { ...p, vnd_per_twd: null, thiet_vnd: null, tot_nhat: false };
        const thiet = (bestV - v) * p.cod_twd;
        tong += thiet;
        return {
            ...p, vnd_per_twd: v,
            thiet_vnd: thiet,
            tot_nhat: p.filename === best.filename,
        };
    });
    return {
        best_vnd_per_twd: bestV,
        best_period: best.period_date || best.filename,
        total_thiet_vnd: tong,
        rows,
    };
}

/**
 * ĐỐI SOÁT CHI PHÍ QUẢNG CÁO — lõi thuần, KHÔNG đọc đĩa, KHÔNG gọi mạng.
 *
 * Mỗi tuần có hai con số nói về cùng một khoản tiền: Facebook nói đã thu bao
 * nhiêu, ngân hàng nói đã trừ bao nhiêu. Phần lệch giữa hai con số đó là chỗ
 * tiền bị trừ trùng, thẻ lạ tiêu tiền công ty, hoá đơn báo lỗi mà tiền vẫn ra.
 *
 * File này là chỗ DUY NHẤT định nghĩa "một lượt đối soát". Hai nơi gọi vào:
 *   · route /api/talpha/ads-recon  — màn Đối soát chi phí QC trong dashboard
 *   · Doi-Soat-Chi-Phi-QC/bin      — bản dòng lệnh chạy ở máy, dùng cho cron
 * Giữ nó thuần để hai nơi không bao giờ ra hai kết quả khác nhau.
 */
import { ingestFb, ingestBank, detectKind } from "./ingest.mjs";
import { matchTransactions } from "./match.mjs";
import { buildAlerts } from "./rules.mjs";
import { isoWeek } from "./normalize.mjs";

/**
 * Xác định file nào là chi phí TKQC, file nào là sao kê — không bắt người dùng
 * nhớ thứ tự tải lên. Nhầm thứ tự là lỗi chắc chắn xảy ra ở tuần bận.
 */
export function splitSources(a, b, cfg) {
    const ka = a.kind ?? detectKind(a.sheets, cfg);
    const kb = b.kind ?? detectKind(b.sheets, cfg);

    if (ka === "fb" && kb !== "fb") return { fb: a, bank: b };
    if (kb === "fb" && ka !== "fb") return { fb: b, bank: a };
    if (ka === "bank" && kb !== "bank") return { fb: b, bank: a };
    if (kb === "bank") return { fb: a, bank: b };

    throw new Error(
        `Không phân biệt được file nào là chi phí TKQC, file nào là sao kê ` +
        `(nhận diện: ${a.name || "file 1"}=${ka}, ${b.name || "file 2"}=${kb}). ` +
        `Kiểm tra lại nội dung file, hoặc thêm bí danh cột vào ads_settlement.columns.`);
}

/**
 * Chạy một lượt đối soát.
 * @param {{sheets:Array, name?:string, kind?:string}} fileA — không cần đúng thứ tự
 * @param {{sheets:Array, name?:string, kind?:string}} fileB
 * @param {object} cfg      — khối ads_settlement trong talpha_rules.json
 * @param {object} [roster] — ad_accounts.json, để bắt TKQC lạ
 * @param {Array}  [history]— các kỳ TRƯỚC, để bắt tăng vọt
 */
export function reconcile(fileA, fileB, cfg, { roster = null, history = [] } = {}) {
    const { fb: fbSrc, bank: bankSrc } = splitSources(fileA, fileB, cfg);

    const fb = ingestFb(fbSrc.sheets, cfg);
    const bank = ingestBank(bankSrc.sheets, cfg);
    const match = matchTransactions(fb.rows, bank.rows, cfg);

    const dates = [...bank.rows.map((r) => r.date), ...fb.rows.map((r) => r.date)].filter(Boolean).sort();
    const ky = dates.length ? isoWeek(dates[0]) : isoWeek(new Date().toISOString().slice(0, 10));

    // Chỉ so với kỳ CŨ hơn: chạy lại một kỳ cũ mà lấy kỳ mới hơn làm "kỳ trước"
    // thì kết luận tăng/giảm sẽ ngược chiều.
    const truoc = (history || []).filter((h) => h.ky && h.ky < ky).sort((x, y) => (x.ky < y.ky ? -1 : 1));

    const { alerts, summary } = buildAlerts({ fb, bank, match, cfg, roster, history: truoc });

    return {
        ky,
        chay_luc: new Date().toISOString(),
        files: {
            fb: { ten: fbSrc.name || "", sheet: fb.meta.sheet, dong_tieu_de: fb.meta.header_row, so_dong: fb.rows.length },
            bank: { ten: bankSrc.name || "", sheet: bank.meta.sheet, dong_tieu_de: bank.meta.header_row, so_dong: bank.rows.length },
        },
        summary,
        stats: match.stats,
        alerts,
        pairs: match.pairs.map((p) => ({
            fb: slim(p.fb), bank: slim(p.bank),
            date_diff: p.date_diff, amount_diff: p.amount_diff, amount_diff_pct: p.amount_diff_pct,
            exact: p.exact, ambiguous: p.ambiguous, card_ok: p.card_ok, confidence: p.confidence,
        })),
        fb_unmatched: match.fb_unmatched.map(slim),
        bank_unmatched: match.bank_unmatched.map(slim),
        fb_failed: match.fb_failed.map(slim),
        other_ads: (bank.other_ads || []).map(slim),
        meta: { fb: fb.meta, bank: bank.meta, skipped: { fb: fb.skipped, bank: bank.skipped } },
        history: truoc.map((h) => ({ ky: h.ky, bank_total: h.summary?.bank_total ?? 0, fb_total: h.summary?.fb_total ?? 0 })),
    };
}

/** Bản gọn của một dòng — bỏ mảng `raw` để kết quả lưu xuống không phình. */
function slim(r) {
    if (!r) return null;
    const base = { src: r.src, line: r.line, date: r.date, amount: r.amount, card4: r.card4 ?? null };
    return r.src === "fb"
        ? { ...base, txn_id: r.txn_id, account_id: r.account_id, account_name: r.account_name, method: r.method, status: r.status, status_norm: r.status_norm }
        : { ...base, desc: r.desc, ref: r.ref, balance: r.balance };
}

export { readSheets } from "./xlsx.mjs";
export { detectKind } from "./ingest.mjs";
export { toCsv } from "./csv.mjs";
export { buildMessage, sendAlerts } from "./notify.mjs";
export { fmtVND } from "./normalize.mjs";

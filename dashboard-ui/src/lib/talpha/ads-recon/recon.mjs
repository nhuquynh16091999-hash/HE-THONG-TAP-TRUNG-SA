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
 * Chia các file đã tải lên làm hai phía. Không bắt người dùng nhớ thứ tự, và
 * KHÔNG giới hạn mỗi phía một file: công ty có mấy thẻ thì mấy sao kê, TKQC
 * xuất theo từng tài khoản thì mấy bản chi phí. Bắt gộp tay bằng Excel trước
 * khi tải lên là trả việc về đúng chỗ mà hệ thống này sinh ra để bỏ đi.
 */
export function splitSources(docs, cfg) {
    const fb = [], bank = [], mo = [];
    for (const d of docs) {
        const k = d.kind ?? detectKind(d.sheets, cfg);
        if (k === "fb") fb.push(d);
        else if (k === "bank") bank.push(d);
        else mo.push(d);
    }
    // File không nhận ra được thì dồn về phía đang thiếu — một phía trống là
    // không đối soát được gì cả.
    for (const d of mo) (fb.length && !bank.length ? bank : fb).push(d);

    if (!fb.length || !bank.length) {
        throw new Error(
            `Cần cả hai phía: ${fb.length} file chi phí TKQC và ${bank.length} file sao kê. ` +
            `Kiểm tra lại nội dung file, hoặc thêm bí danh cột vào ads_settlement.columns.`);
    }
    return { fb, bank };
}

/**
 * Bỏ dòng trùng nhau GIỮA CÁC FILE.
 *
 * Hai bản xuất chồng ngày nhau là chuyện thường: cùng một hoá đơn nằm trong cả
 * hai file. Để nguyên thì bản thứ hai không tìm được ai để ghép và nổi lên
 * thành "TKQC thu mà thẻ không trừ" — báo động giả, mà lại là loại báo động
 * đắt tiền nhất. Giữ bản gặp trước, ghi lại đã bỏ những gì để nói ra.
 */
function dedupeAcrossFiles(rows, keyOf) {
    const seen = new Map();
    const kept = [], dropped = [];
    for (const r of rows) {
        const k = keyOf(r);
        if (!k) { kept.push(r); continue; }
        const prev = seen.get(k);
        if (!prev) { seen.set(k, r); kept.push(r); }
        // So bằng SỐ THỨ TỰ bản tải lên chứ không bằng tên file: tải nhầm đúng
        // một file hai lần thì hai bản trùng tên, mà đó lại chính là trường hợp
        // phải bỏ. So bằng tên là tổng tiền nhân đôi mà không ai biết.
        else if (prev._doc !== r._doc) dropped.push({ giu: prev, bo: r });
        else kept.push(r);            // trùng trong CÙNG một bản tải lên là dữ liệu thật
    }
    return { kept, dropped };
}

const keyFb = (r) => (r.txn_id ? `t:${r.txn_id}` : `d:${r.date}|${r.amount}|${r.account_id}`);
const keyBank = (r) => `d:${r.date}|${r.amount}|${r.ref || r.desc}`;

/** Đọc một phía (có thể nhiều file) rồi gộp thành một danh sách. */
function ingestSide(docs, cfg, kind) {
    const parts = docs.map((d) => (kind === "fb" ? ingestFb : ingestBank)(d.sheets, cfg, d.name || ""));
    const rows = parts.flatMap((p, i) => p.rows.map((r) => ({ ...r, _doc: i })));
    const { kept, dropped } = dedupeAcrossFiles(rows, kind === "fb" ? keyFb : keyBank);

    return {
        rows: kept,
        trung_file: dropped,
        other_ads: parts.flatMap((p) => p.other_ads || []),
        skipped: parts.flatMap((p) => p.skipped || []),
        meta: {
            files: parts.map((p, i) => ({
                ten: docs[i].name || "", sheet: p.meta.sheet,
                dong_tieu_de: p.meta.header_row, so_dong: p.rows.length,
            })),
            warnings: [...new Set(parts.flatMap((p) => p.meta.warnings || []))],
        },
    };
}

/**
 * Chạy một lượt đối soát.
 * @param {Array<{sheets:Array, name?:string, kind?:string}>} docs — mọi file đã
 *        tải lên, KHÔNG cần đúng thứ tự và không giới hạn số lượng mỗi phía
 * @param {object} cfg      — khối ads_settlement trong talpha_rules.json
 * @param {object} [roster] — ad_accounts.json, để bắt TKQC lạ
 * @param {Array}  [history]— các kỳ TRƯỚC, để bắt tăng vọt
 */
export function reconcile(docs, cfg, { roster = null, history = [] } = {}) {
    const list = Array.isArray(docs) ? docs : [docs];
    const { fb: fbDocs, bank: bankDocs } = splitSources(list, cfg);

    const fb = ingestSide(fbDocs, cfg, "fb");
    const bank = ingestSide(bankDocs, cfg, "bank");
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
        files: { fb: fb.meta.files, bank: bank.meta.files },
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
    const base = { src: r.src, file: r.file || "", line: r.line, date: r.date, amount: r.amount, card4: r.card4 ?? null };
    // _doc chỉ dùng lúc chạy để phân biệt hai bản tải lên, không lưu xuống
    return r.src === "fb"
        ? { ...base, txn_id: r.txn_id, account_id: r.account_id, account_name: r.account_name, method: r.method, status: r.status, status_norm: r.status_norm }
        : { ...base, desc: r.desc, ref: r.ref, balance: r.balance };
}

export { readSheets, readAnySheets } from "./xlsx.mjs";
export { detectKind } from "./ingest.mjs";
export { toCsv } from "./csv.mjs";
export { buildMessage, sendAlerts } from "./notify.mjs";
export { fmtVND } from "./normalize.mjs";

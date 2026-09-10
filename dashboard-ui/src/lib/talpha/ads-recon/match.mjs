/**
 * GHÉP CẶP GIAO DỊCH TKQC ↔ SAO KÊ.
 *
 * Khoá ghép là SỐ TIỀN + NGÀY (sao kê không mang mã giao dịch của Facebook).
 * Cái khó không nằm ở chỗ tìm cặp giống nhau — mà ở chỗ khi có 5 giao dịch
 * cùng 9.900.000₫ trong 3 ngày thì ghép ai với ai. Ghép bừa còn tệ hơn không
 * ghép: nó biến một lần trừ trùng thành "khớp đẹp" rồi giấu luôn tiền mất.
 *
 * Cách làm: sinh mọi cặp khả dĩ → chấm điểm (ngày lệch ít, tiền khớp, thẻ
 * trùng thì điểm tốt) → xếp theo điểm rồi lấy dần, mỗi bên chỉ được dùng một
 * lần. Cặp nào có đối thủ ngang điểm thì đánh dấu NGHI NGỜ để người đọc biết
 * máy đang đoán, chứ không im lặng chọn hộ.
 */
import { daysBetween } from "./normalize.mjs";

/** Ngưỡng lệch tiền cho phép của một giao dịch. */
export function tolerance(amount, m) {
    return Math.max(m.amount_tolerance_abs || 0, (Math.abs(amount) * (m.amount_tolerance_pct || 0)) / 100);
}

function scorePair(fb, bank, cfg) {
    const m = cfg.match;
    const dd = Math.abs(daysBetween(fb.date, bank.date));
    const diff = bank.amount - fb.amount;
    const rel = Math.abs(diff) / Math.max(1, fb.amount);

    let score = dd * 10 + rel * 1000;

    if (fb.card4 && bank.card4) {
        if (fb.card4 === bank.card4) score -= 6;
        else score += m.prefer_card_match ? 500 : 40;
    }
    // Vài ngân hàng nhét mã giao dịch FB vào nội dung — gặp thì gần như chắc chắn
    if (fb.txn_id && bank.desc && bank.desc.toUpperCase().includes(String(fb.txn_id).toUpperCase())) score -= 1000;

    return { score, dateDiff: daysBetween(fb.date, bank.date), amountDiff: diff, rel };
}

/** Cặp có được phép tồn tại không (trước khi xét điểm). */
function feasible(fb, bank, cfg) {
    const m = cfg.match;
    const dd = Math.abs(daysBetween(fb.date, bank.date));
    if (dd > (m.date_window_days ?? 3)) return false;

    const tol = tolerance(fb.amount, m);
    const diff = bank.amount - fb.amount;
    if (Math.abs(diff) <= tol) return true;

    // Ngân hàng trừ NHIỀU HƠN vẫn coi là cùng một giao dịch nếu phần dư còn nằm
    // trong khung phí (FX, phí quốc tế). Trừ ÍT HƠN thì không — đó là chuyện khác.
    const feeRoof = (cfg.fee.critical_over_pct ?? 5) / 100;
    return diff > 0 && diff <= fb.amount * feeRoof;
}

export function matchTransactions(fbRows, bankRows, cfg) {
    // Giao dịch FB thất bại không sinh ra tiền — để riêng, xét ở tầng luật
    const chargeable = fbRows.filter((r) => r.status_norm !== "failed");
    const failed = fbRows.filter((r) => r.status_norm === "failed");

    const cands = [];
    for (const fb of chargeable) {
        for (const bank of bankRows) {
            if (!feasible(fb, bank, cfg)) continue;
            cands.push({ fb, bank, ...scorePair(fb, bank, cfg) });
        }
    }
    cands.sort((a, b) => a.score - b.score || Math.abs(a.dateDiff) - Math.abs(b.dateDiff));

    // Đếm số lựa chọn tương đương của mỗi bên — dùng để gắn nhãn NGHI NGỜ
    const bestByFb = new Map();
    for (const c of cands) {
        const cur = bestByFb.get(c.fb);
        if (!cur || c.score < cur.score) bestByFb.set(c.fb, { score: c.score, ties: 1 });
        else if (Math.abs(c.score - cur.score) < 1e-6) cur.ties++;
    }

    const usedFb = new Set(), usedBank = new Set();
    const pairs = [];
    for (const c of cands) {
        if (usedFb.has(c.fb) || usedBank.has(c.bank)) continue;
        usedFb.add(c.fb); usedBank.add(c.bank);

        const tol = tolerance(c.fb.amount, cfg.match);
        const exact = Math.abs(c.amountDiff) <= tol;
        const ambiguous = (bestByFb.get(c.fb)?.ties ?? 1) > 1;
        const cardOK = !(c.fb.card4 && c.bank.card4) || c.fb.card4 === c.bank.card4;

        let confidence = "cao";
        if (ambiguous || !cardOK) confidence = "thap";
        else if (!exact || Math.abs(c.dateDiff) > 1) confidence = "vua";

        pairs.push({
            fb: c.fb, bank: c.bank,
            date_diff: c.dateDiff,
            amount_diff: c.amountDiff,
            amount_diff_pct: c.fb.amount ? (c.amountDiff / c.fb.amount) * 100 : 0,
            exact, ambiguous, card_ok: cardOK, confidence, score: c.score,
        });
    }

    return {
        pairs,
        fb_unmatched: chargeable.filter((r) => !usedFb.has(r)),
        bank_unmatched: bankRows.filter((r) => !usedBank.has(r)),
        fb_failed: failed,
        stats: {
            fb_total: fbRows.length,
            fb_chargeable: chargeable.length,
            bank_total: bankRows.length,
            matched: pairs.length,
            ambiguous: pairs.filter((p) => p.ambiguous).length,
            candidates: cands.length,
        },
    };
}

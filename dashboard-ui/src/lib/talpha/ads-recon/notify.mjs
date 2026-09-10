/**
 * ĐẨY CẢNH BÁO RA CHAT.
 *
 * Tin nhắn phải đọc được trên điện thoại trong 5 giây: tiền rủi ro trước,
 * chi tiết sau, và luôn nói rõ mở cái gì để xem tiếp. Không bắn khi không có
 * gì đáng bắn — bắn tin "mọi thứ đều ổn" mỗi tuần là cách nhanh nhất khiến
 * mọi người tắt thông báo.
 */
import { fmtVND } from "./normalize.mjs";

const RANK = { critical: 0, warn: 1, info: 2 };
const ICON = { critical: "🔴", warn: "🟡", info: "⚪" };

/** Soạn tin tóm tắt. Trả về null nếu không có gì vượt ngưỡng cần báo. */
export function buildMessage(result, cfg, { force = false } = {}) {
    const min = RANK[cfg.notify?.min_severity || "warn"] ?? 1;
    const worth = result.alerts.filter((a) => RANK[a.severity] <= min);
    if (!worth.length && !force) return null;

    const s = result.summary;
    const L = [];
    L.push(`📊 ĐỐI SOÁT CHI PHÍ QUẢNG CÁO — kỳ ${result.ky}`);
    L.push(`${s.period?.bank_start || "?"} → ${s.period?.bank_end || "?"}`);
    L.push("");
    L.push(`TKQC ghi:  ${fmtVND(s.fb_total)}`);
    L.push(`Thẻ trừ:   ${fmtVND(s.bank_total)}`);
    L.push(`Chênh:     ${fmtVND(s.gap)}`);
    if (s.at_risk > 0) L.push(`⚠️ TIỀN CẦN ĐÒI/LÀM RÕ: ${fmtVND(s.at_risk)}`);
    L.push("");

    if (!worth.length) {
        L.push("✅ Không có lệch nào vượt ngưỡng.");
    } else {
        L.push(`${s.counts.critical} nghiêm trọng · ${s.counts.warn} cần xem · ${s.counts.info} ghi nhận`);
        L.push("");
        for (const a of worth.slice(0, 8)) {
            L.push(`${ICON[a.severity]} ${a.title}`);
            if (a.detail) L.push(`   ${a.detail.slice(0, 160)}`);
        }
        if (worth.length > 8) L.push(`… và ${worth.length - 8} cảnh báo nữa.`);
    }
    L.push("");
    L.push(`Xem đầy đủ: ${cfg.notify?.report_url || "http://localhost:8899"} → kỳ ${result.ky}`);
    return L.join("\n");
}

async function postJson(url, body, headers = {}) {
    const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 300)}`);
    return text;
}

/** Gửi đi mọi kênh đang bật. Không kênh nào được phép làm hỏng lượt chạy. */
export async function sendAlerts(result, cfg, { force = false } = {}) {
    const message = buildMessage(result, cfg, { force });
    const out = { sent: [], skipped: [], errors: [], message };
    if (!message) { out.skipped.push("không có cảnh báo nào vượt ngưỡng min_severity"); return out; }

    const tg = cfg.notify?.telegram;
    if (tg?.enabled) {
        const token = process.env[tg.bot_token_env || "DOISOAT_TELEGRAM_TOKEN"];
        if (!token) out.errors.push(`Telegram: thiếu biến môi trường ${tg.bot_token_env}`);
        else if (!tg.chat_id) out.errors.push("Telegram: thiếu chat_id trong config");
        else {
            try {
                await postJson(`https://api.telegram.org/bot${token}/sendMessage`,
                    { chat_id: tg.chat_id, text: message, disable_web_page_preview: true });
                out.sent.push("telegram");
            } catch (e) { out.errors.push("Telegram: " + e.message); }
        }
    } else out.skipped.push("telegram tắt");

    const wh = cfg.notify?.webhook;
    if (wh?.enabled) {
        if (!wh.url) out.errors.push("Webhook: thiếu url");
        else {
            try {
                await postJson(wh.url, {
                    source: "doi-soat-chi-phi-qc", ky: result.ky, message,
                    summary: result.summary,
                    alerts: result.alerts.filter((a) => RANK[a.severity] <= (RANK[cfg.notify?.min_severity || "warn"] ?? 1)),
                });
                out.sent.push("webhook");
            } catch (e) { out.errors.push("Webhook: " + e.message); }
        }
    } else out.skipped.push("webhook tắt");

    return out;
}

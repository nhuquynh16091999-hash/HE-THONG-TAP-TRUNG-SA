// Cảnh báo ADS mỗi adsPollMinutes: tổng chi tiêu hôm nay cao bất thường, và campaign đốt
// tiền mà 0 tin nhắn. Nguồn: /api/talpha/ads-alerts (BigQuery, đã loại camp có chữ "test").
//
// Cùng luật với pollAds() của bot WhatsApp, tách thành hàm THUẦN để test được:
//   vào (số của route, state cũ, config) → ra (tin cần gửi hoặc null, state mới).
// Bản WhatsApp ghi state TRƯỚC khi gửi — gửi hỏng là cảnh báo đó mất hẳn. Ở đây bên gọi
// chỉ lưu state mới SAU khi gửi được.
const { B, I, clean } = require("./zalo_text");
const { chuCamp, DISPLAY } = require("./rules");

const vnd = (n) => Number(n || 0).toLocaleString("vi-VN");
// Chủ camp tính lại theo luật của Sheet; KHÔNG dùng ô marketer route trả về — route quét cả
// tên nên camp có trang "…Vàng Thái" của Thương bị ghi là của Thái.
const chuCua = (w) => { const k = chuCamp(w.campaign); return k ? DISPLAY[k] || k : ""; };
const ddmm = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : String(d || ""));

function buildAdsAlert(a, st, cfg) {
    // Sang ngày mới (ngày mới nhất trong bảng ads đổi) → quên hết camp đã báo hôm trước.
    const s = st && st.day === a.day
        ? { day: st.day, spikeAlerted: !!st.spikeAlerted, waste: [...(st.waste || [])] }
        : { day: a.day, spikeAlerted: false, waste: [] };
    const parts = [];

    // 1) Tổng chi tiêu cao bất thường so với trung bình 7 ngày trước — mỗi ngày báo 1 lần.
    if (!s.spikeAlerted && a.spikeRatio && a.totalSpend >= (cfg.adsMinTotalForSpike || 0)
        && a.spikeRatio >= (cfg.adsSpikeRatio || 1.5)) {
        const lan = String(a.spikeRatio).replace(".", ",");
        parts.push(`📈 ${B("Chi tiêu ads hôm nay CAO BẤT THƯỜNG")}\nHôm nay: ${vnd(a.totalSpend)}đ · TB 7 ngày: ${vnd(a.avg7d)}đ (×${lan})`);
        s.spikeAlerted = true;
    }

    // 2) Campaign đốt tiền không ra tin nhắn — chỉ camp CHƯA báo hôm nay.
    const daBao = new Set(s.waste);
    const moi = (a.wasteful || []).filter((w) => w.spend >= (cfg.adsWasteSpend || 300000) && !daBao.has(w.campaign));
    if (moi.length) {
        let m = `🔥 ${B(`Campaign ĐỐT TIỀN KHÔNG RA TIN NHẮN (${moi.length})`)}`;
        m += moi.slice(0, 12).map((w) =>
            `\n• ${vnd(w.spend)}đ · 0 tin nhắn${chuCua(w) ? " · " + chuCua(w) : ""}\n   ${clean(w.campaign).slice(0, 70)}`).join("");
        if (moi.length > 12) m += `\n…và ${moi.length - 12} camp khác.`;
        parts.push(m);
        moi.forEach((w) => daBao.add(w.campaign));
        s.waste = [...daBao];
    }

    const text = parts.length
        ? `🚨 ${B("CẢNH BÁO ADS — TALPHA")}\n${I(`ngày ${ddmm(a.day)}`)}\n\n` + parts.join("\n\n")
        : null;
    return { text, state: s };
}

// Lệnh /canhbao: người gõ cần câu trả lời kể cả khi yên ổn — không có gì bất thường thì
// vẫn báo chi tiêu hôm nay, để biết bot có đọc được số chứ không phải im vì hỏng.
// Không dùng state: hỏi lúc nào trả đủ lúc đó, kể cả camp đã báo trước đó.
function buildAdsStatus(a, cfg) {
    const { text } = buildAdsAlert(a, undefined, cfg);
    if (text) return text;
    const lan = a.spikeRatio == null ? "" : ` (×${String(a.spikeRatio).replace(".", ",")})`;
    return `✅ ${B("ADS — chưa thấy gì bất thường")}\n${I(`ngày ${ddmm(a.day)}`)}\n\n`
        + `Chi tiêu hôm nay: ${vnd(a.totalSpend)}đ · TB 7 ngày: ${vnd(a.avg7d)}đ${lan}\n`
        + `Không camp nào tiêu từ ${vnd(cfg.adsWasteSpend || 300000)}đ mà 0 tin nhắn.`;
}

module.exports = { buildAdsAlert, buildAdsStatus };

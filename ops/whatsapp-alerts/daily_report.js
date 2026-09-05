// Báo cáo ads: 1 tin TỔNG TEAM (gửi trước) + MỖI marketer 1 tin riêng.
// Dùng cho CẢ hai loại mốc: 8h (số HÔM QUA, đã chốt ngày) và giữa ngày 13:30 / 22:00
// (số HÔM NAY đang chạy). Khác nhau đúng ở phần chữ: truyền opts.intraday để tin nói rõ
// số chưa chốt — cùng một con số mà không ghi rõ mốc thì người đọc tưởng ngày tụt doanh thu.
// Nguồn: /api/talpha/realtime (per-campaign đã gán đơn/doanh số theo rule dashboard).
// Mỗi tin cá nhân: tiền ads, doanh số, %ads, mess, đơn, tỉ lệ chốt + chi tiết từng camp + đề xuất.
// Tin TỔNG TEAM: cộng cả team + xếp hạng marketer + 2 khoản RÒ RỈ mà tin cá nhân không thấy
// (spend camp không gán được marketer, doanh số POS chưa nối được ad_id).
const fmt = (n) => Number(n || 0).toLocaleString("vi-VN");
const pct = (a, b) => (b > 0 ? (a / b) * 100 : 0);
const p1 = (x) => x.toFixed(1).replace(".", ",");
// Tỷ lệ chốt = đơn / tin nhắn. Chỉ có nghĩa khi CẢ HAI cùng đến từ quảng cáo của
// người đó. Đơn gán theo tag POS nên người đã nghỉ vẫn nhận đơn dù gần như không
// chạy ads → ra "chốt 460%", vô nghĩa và trông như lỗi. Trường hợp đó trả "—".
const chot = (ord, mess) => (mess > 0 && ord <= mess ? p1(pct(ord, mess)) + "%" : "—");

// Marketer từ tên campaign — RULE CHUNG (rules.js ← config/talpha_rules.json).
const { scanCampaignMarketer, DISPLAY, isTestCampaign, UNASSIGN } = require("./rules");
const { ngayChuaDu } = require("./schedule");   // "ngày đó xong chưa" — có test riêng
// Tên hiển thị của người ĐÃ NGHỈ — không có tin riêng, không nằm trong bảng xếp hạng.
// Endpoint marketer-perf đã loại họ rồi; chốt chặn thứ hai ở đây để dù server chạy
// bản dashboard cũ thì tin sáng vẫn sạch (bot và dashboard deploy tách nhau).
const DA_NGHI = new Set([...UNASSIGN].map((k) => DISPLAY[k] || k));
function marketerOf(name) {
    const key = scanCampaignMarketer(name);
    return key ? DISPLAY[key] || key : "";
}
// Tên sản phẩm ngắn từ campaign_name
function shortCamp(name) {
    const parts = String(name || "").split("/").map((s) => s.trim()).filter(Boolean);
    const p = parts[2] || parts[1] || parts[0] || name || "";
    return p.length > 38 ? p.slice(0, 38) + "…" : p;
}

// 1 LẦN gọi API cho cả tin tổng lẫn tin cá nhân: /api/talpha/realtime hỏi thẳng Meta +
// POS live (chậm, có rate-limit) — gọi hai lần lúc 8h là tự chuốc lỗi.
async function fetchRealtime(cfg, dateStr) {
    const url = `${cfg.realtimeUrl}?from_date=${dateStr}&to_date=${dateStr}`;
    const res = await fetch(url, { headers: { "cache-control": "no-store" } });
    if (!res.ok) throw new Error(`realtime HTTP ${res.status}`);
    return res.json();
}

// Số ĐẦU BÀI của mọi tin đọc THẲNG từ file Google Sheet "TỔNG TEAM THÁNG n" — đúng
// file CEO đang xem. Bot từng tự tính lại số, và cứ mỗi lần rule đổi là tin nhắn lệch
// với Sheet: lần do camp test, lần do cách gán đơn, lần do hai bên gom ngày theo hai múi
// giờ khác nhau. Đọc thẳng ô trong Sheet thì không còn chỗ nào để lệch.
// Sheet KHÔNG BAO GIỜ mất dòng: sync chết thì dòng vẫn nằm đó, chỉ ĐỨNG SỐ. Nên
// "đọc được dòng ngày X" hoàn toàn không chứng minh số của ngày X đã đủ.
// 04/09/2026: tin 8h báo ngày 03/09 hết 12,2tr / 116 đơn, số thật là 37,2tr / 178 đơn —
// token Meta mất quyền ads_read lúc 15:31 hôm trước, máy ngủ qua đêm, và KHÔNG lớp giám
// sát nào kêu vì dòng vẫn "có". Từ đây tin tự tố tuổi của số nó đang đọc.
// Hai loại tin hỏi hai câu KHÁC NHAU:
//   - tin giữa ngày nói về HÔM NAY, ngày chưa xong → chỉ hỏi được "số cũ bao lâu";
//   - tin 8h nói về NGÀY ĐÃ QUA → phải hỏi "đã có vòng sync nào chạy sau nửa đêm chưa".
// Dùng chung một ngưỡng tuổi cho cả hai thì tin 8h kêu oan mọi sáng máy ngủ (xem
// ghi chú ở ngayChuaDu trong schedule.js).
// "14:27 ngày 03/09" — vi-VN mặc định trả "14:27 03-09", đọc trên điện thoại dễ tưởng
// là một dãy số chứ không phải mốc thời gian.
function gioVN(ts) {
    const d = new Date(ts);
    const p = (o) => d.toLocaleString("en-GB", { timeZone: "Asia/Ho_Chi_Minh", ...o });
    return `${p({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" })} ngày `
        + `${p({ day: "2-digit" })}/${p({ month: "2-digit" })}`;
}
function canhBaoSoCu(stale, dateStr, intraday) {
    if (!stale) return "";
    const duoi = `_Đợi sync chạy lại rồi đọc lại._\n\n`;
    const duoiNgay = (moc) => `_Số dưới đây chốt lúc ${moc} — chưa phải số cả ngày. Đợi sync chạy lại rồi đọc lại._\n\n`;
    if (intraday) {
        if (stale.okAge == null || !(stale.okAge > stale.limit)) return "";
        const h = Math.floor(stale.okAge / 60), m = Math.round(stale.okAge % 60);
        const lau = h > 0 ? `${h} giờ${m ? " " + m + " phút" : ""}` : `${m} phút`;
        return `⚠️ *SỐ CHƯA ĐỦ — sync đứng ${lau}.*\n` + duoi;
    }
    if (!ngayChuaDu(stale.lastOkTs, dateStr)) return "";
    const [, m2, d2] = dateStr.split("-");
    return `⚠️ *SỐ CHƯA ĐỦ — chưa có vòng sync nào chạy sau khi hết ngày ${d2}/${m2}.*\n`
        + duoiNgay(gioVN(stale.lastOkTs));
}

async function fetchSheetReport(cfg, dateStr) {
    if (!cfg.sheetReportUrl) throw new Error("thiếu sheetReportUrl trong config");
    const res = await fetch(`${cfg.sheetReportUrl}?date=${dateStr}`, { headers: { "cache-control": "no-store" } });
    if (!res.ok) throw new Error(`sheet-report HTTP ${res.status}`);
    const j = await res.json();
    if (j.error) throw new Error(j.error);
    if (!j.team) throw new Error(`Sheet chưa có dòng ngày ${dateStr}`);
    return j;
}

// opts.label   — chữ in trên đầu tin thay cho ngày thô ("HÔM NAY 02/09 · 13:30").
// opts.intraday — số chưa chốt ngày: thêm dòng nhắc + đổi lời chú thích DS giao.
async function buildMarketerReports(cfg, dateStr, opts = {}) {
    const label = opts.label || dateStr;
    const data = await fetchRealtime(cfg, dateStr);
    const sheet = await fetchSheetReport(cfg, dateStr);
    // tab Sheet dùng KEY (Loc, ChuThuy…), tin nhắn hiển thị TÊN (Lộc, Chu Thuý…)
    const bySheet = {};
    for (const r of sheet.marketers || []) bySheet[DISPLAY[r.tab] || r.tab] = r;
    // Camp TEST cũng phải rời khỏi phần chi tiết, nếu không phần chi tiết lại lệch
    // với đầu bài của chính tin đó.
    const camps = (data.campaigns || [])
        .filter((c) => (c.spend_vnd || 0) > 0 && !isTestCampaign(c.campaign_name));

    const byMk = {};
    for (const c of camps) {
        const mk = marketerOf(c.campaign_name);
        if (!mk) continue;                       // camp không gán marketer → bỏ khỏi báo cáo cá nhân
        (byMk[mk] = byMk[mk] || []).push(c);
    }

    const order = ["Lộc", "Chu Thuý", "Nhung", "Chính", "S.Anh"];
    // Ai có tin riêng: người có số trong marketer-perf (nguồn của Sheet), không phải
    // người có campaign — người chi 0đ mà vẫn có đơn về tag mình thì vẫn phải có tin.
    const names = Object.keys(bySheet)
        .filter((mk) => mk !== "(không gán)" && !DA_NGHI.has(mk))
        .filter((mk) => bySheet[mk].ads > 0 || bySheet[mk].don > 0)
        .sort((a, b) => (order.indexOf(a) + 99) % 100 - (order.indexOf(b) + 99) % 100);
    const messages = [];
    for (const mk of names) {
        const list = (byMk[mk] || []).sort((a, b) => b.spend_vnd - a.spend_vnd);
        const p = bySheet[mk];
        const spend = p.ads, rev = p.doanh_so, mess = p.mess, ord = p.don;
        // dùng luôn tỷ lệ Sheet đã tính, không tự chia lại rồi lệch số lẻ
        const closeR = p.ty_le_chot, adsR = p.phan_tram_ads;

        let m = canhBaoSoCu(opts.stale, dateStr, opts.intraday) + `📊 *ADS ${label} — ${mk}*\n`;
        m += `💰 Tiền ads: *${fmt(spend)}đ*  ·  Doanh số: *${fmt(rev)}đ*  ·  %ads: *${rev > 0 ? p1(adsR) + "%" : "—"}*\n`;
        m += `💬 Mess: ${fmt(mess)}  ·  🛒 Đơn: ${fmt(ord)}  ·  ✅ Chốt: *${chot(ord, mess)}*\n`;
        if (opts.intraday) m += `_số đang chạy trong ngày — chưa chốt, còn lên tiếp_\n`;
        if (list.length) {
            m += `\n*Theo campaign:*  _(đơn ở đây gán theo quảng cáo, nên tổng có thể khác số đầu bài — số đầu bài gán theo tag POS, khớp Sheet)_`;
            for (const c of list.slice(0, cfg.topCampaigns || 8)) {
                const cr = pct(c.orders, c.messages), ar = pct(c.spend_vnd, c.revenue_vnd);
                m += `\n• ${shortCamp(c.campaign_name)}`;
                m += `\n   Ads ${fmt(c.spend_vnd)}đ · Mess ${c.messages || 0} · Đơn ${c.orders || 0} · Chốt ${p1(cr)}% · %ads ${c.revenue_vnd > 0 ? Math.round(ar) + "%" : "—"}`;
            }
        } else {
            m += `\n_(chưa lấy được chi tiết campaign lúc này — số đầu bài vẫn đúng theo Sheet)_`;
        }
        const recs = recommend(list, { spend, rev, closeR, adsR }, cfg);
        if (recs.length) m += `\n\n💡 *Đề xuất:*\n` + recs.map((r) => "• " + r).join("\n");
        messages.push(m);
    }
    return { dateStr, teamMessage: buildTeamReport(dateStr, sheet, opts), messages };
}

// Tin TỔNG TEAM — cộng ĐÚNG tập camp đã vào các tin cá nhân (không lấy summary tổng của
// API) để hai loại tin cộng lại khớp nhau. Phần chênh với tổng hệ thống được nêu riêng ở
// hai dòng cuối chứ không trộn vào: spend camp không gán được marketer (người ngoài team
// chạy chung 14 TKQC — rule X10) và doanh số POS chưa nối được ad_id.
function buildTeamReport(dateStr, sheet, opts = {}) {
    const label = opts.label || dateStr;
    const T = sheet.team;
    const ds = (r) => (r.doanh_so > 0 ? Math.round(r.phan_tram_ads) + "%" : "—");

    let m = canhBaoSoCu(opts.stale, dateStr, opts.intraday) + `🏆 *TỔNG TEAM — ${label}*\n`;
    m += `💰 Tiền ads: *${fmt(Math.round(T.ads))}đ*  ·  Doanh số: *${fmt(Math.round(T.doanh_so))}đ*  ·  %ads: *${T.doanh_so > 0 ? p1(T.phan_tram_ads) + "%" : "—"}*\n`;
    m += `💬 Mess: ${fmt(T.mess)}  ·  🛒 Đơn: ${fmt(T.don)}  ·  ✅ Chốt: *${p1(T.ty_le_chot)}%*\n`;
    // GTC của ngày hôm qua LUÔN thấp (hàng Trung Đông vài tuần mới giao xong) — ghi rõ
    // để không ai tưởng doanh số tụt.
    m += `📦 DS giao thành công: ${fmt(Math.round(T.ds_giao_tc))}đ ${opts.intraday
        ? "_(đơn hôm nay gần như chưa giao xong — số này còn lên nhiều)_"
        : "_(đơn hôm qua phần lớn chưa giao xong — số này còn lên)_"}\n`;

    const rows = (sheet.marketers || [])
        .filter((r) => r.tab !== "(không gán)" && (r.ads > 0 || r.don > 0))
        .map((r) => ({ mk: DISPLAY[r.tab] || r.tab, ...r }));

    if (rows.length) {
        const top = rows[0];
        if (top.doanh_so > 0) m += `\n👑 *Top 1 hôm nay: ${top.mk} — ${fmt(Math.round(top.doanh_so))}đ*\n`;
        m += `\n*Xếp hạng theo doanh số:*`;
        rows.forEach((r, i) => {
            m += `\n${i === 0 ? "👑" : i + 1 + "."} *${r.mk}* — Ads ${fmt(Math.round(r.ads))}đ · DS ${fmt(Math.round(r.doanh_so))}đ · %ads ${ds(r)} · ${fmt(r.don)} đơn · chốt ${p1(r.ty_le_chot)}%`;
        });
    }

    // Ô "(không gán)" KHÔNG nằm trong dòng TỔNG của Sheet, nhưng là tiền thật — nêu
    // riêng chứ không giấu. Từ khi Mai/Thế nghỉ, ô này ôm phần lớn đơn của hai bạn.
    const un = (sheet.marketers || []).find((r) => r.tab === "(không gán)");
    if (un && (un.doanh_so > 0 || un.don > 0)) {
        m += `\n\n📍 Chưa gán được cho ai: ${fmt(Math.round(un.doanh_so))}đ · ${fmt(un.don)} đơn — nằm ngoài bảng trên.`;
    }
    m += `\n_số lấy thẳng từ file TỔNG TEAM THÁNG ${Number(dateStr.slice(5, 7))}_`;
    return m;
}

function recommend(list, agg, cfg) {
    const r = [];
    const waste = list.filter((c) => c.spend_vnd >= (cfg.recWasteSpend || 300000) && (c.orders || 0) === 0);
    if (waste.length) r.push(`Tắt / đổi sản phẩm ${waste.length} camp đốt tiền không ra đơn: ${waste.slice(0, 3).map((c) => shortCamp(c.campaign_name)).join(", ")}`);
    const lowClose = list.filter((c) => (c.messages || 0) >= 20 && pct(c.orders, c.messages) < (cfg.recLowClosePct || 5));
    if (lowClose.length) r.push(`Chốt thấp (<${cfg.recLowClosePct || 5}%) ở ${lowClose.length} camp — kiểm tra sale chốt & target`);
    if (agg.rev > 0 && agg.adsR > (cfg.recHighAdsPct || 30)) r.push(`%ads cao (${Math.round(agg.adsR)}%) — đang ăn mòn lãi, siết ngân sách các camp kém`);
    const win = list.filter((c) => c.revenue_vnd > 0 && pct(c.spend_vnd, c.revenue_vnd) < (cfg.recGoodAdsPct || 20) && (c.orders || 0) >= 3);
    if (win.length) r.push(`Tăng ngân sách ${win.length} camp hiệu quả (%ads thấp): ${win.slice(0, 3).map((c) => shortCamp(c.campaign_name)).join(", ")}`);
    if (!r.length && list.length) r.push("Chỉ số ổn định — duy trì và theo dõi.");
    return r;
}

module.exports = { buildMarketerReports, buildTeamReport };

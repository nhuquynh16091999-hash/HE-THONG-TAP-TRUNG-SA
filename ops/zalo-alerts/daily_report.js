// Báo cáo ads: 1 tin TỔNG TEAM (gửi trước) + MỖI marketer 1 tin riêng.
// Dùng cho CẢ hai loại mốc: 8h30 (số HÔM QUA, đã chốt ngày) và giữa ngày 13:30 / 22:00
// (số HÔM NAY đang chạy). Khác nhau đúng ở phần chữ: truyền opts.intraday để tin nói rõ
// số chưa chốt — cùng một con số mà không ghi rõ mốc thì người đọc tưởng ngày tụt doanh thu.
//
// Chép từ ops/whatsapp-alerts/daily_report.js (bot WhatsApp đang tắt), sửa bốn chỗ:
//   1. chữ đậm/nghiêng đi bằng B()/I() (zalo_text.js) — Zalo không đọc *…* và _…_;
//   2. thứ tự tin riêng theo khối marketers trong talpha_rules.json, không gõ tay tên;
//   3. tên sản phẩm theo chuẩn tên campaign mới, có cờ nước cho Singapore, UAE; chủ
//      campaign theo luật của Sheet chứ không quét cả tên (rules.js → chuCamp);
//   4. /api/talpha/realtime lỗi thì VẪN gửi — số đầu bài lấy từ Sheet, chỉ thiếu phần
//      chi tiết campaign (bản WhatsApp mất cả báo cáo vì phần phụ này).
//
// Số ĐẦU BÀI của mọi tin đọc THẲNG từ file Google Sheet "TỔNG TEAM THÁNG n" — đúng file
// CEO đang xem. Bot từng tự tính lại số, và cứ mỗi lần rule đổi là tin nhắn lệch với
// Sheet: lần do camp test, lần do cách gán đơn, lần do hai bên gom ngày theo hai múi giờ
// khác nhau. Đọc thẳng ô trong Sheet thì không còn chỗ nào để lệch.
// Phần "Theo campaign" lấy từ /api/talpha/realtime (Meta + POS live), đơn gán theo
// quảng cáo — nên cộng lại có thể khác số đầu bài, và tin nói rõ điều đó.
const { B, I } = require("./zalo_text");
const {
    chuCamp, MARKETERS, DISPLAY, THU_TU, UNASSIGN, TAB_NUOC, CO_NUOC, isTestCampaign, tenNganCamp,
} = require("./rules");
const { ngayChuaDu } = require("./schedule");   // "ngày đó xong chưa" — có test riêng

const fmt = (n) => Number(n || 0).toLocaleString("vi-VN");
const pct = (a, b) => (b > 0 ? (a / b) * 100 : 0);
const p1 = (x) => Number(x || 0).toFixed(1).replace(".", ",");
const ddmm = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
// Tiền viết gọn cho dòng camp: 327k · 1,2tr — tin gộp phải vừa MỘT tin nên không xài số đầy đủ.
const gonTien = (n) => {
    const x = Number(n || 0);
    if (x >= 1_000_000) return `${(x / 1_000_000).toFixed(1).replace(".", ",").replace(",0", "")}tr`;
    if (x >= 1_000) return `${Math.round(x / 1_000)}k`;
    return `${Math.round(x)}đ`;
};
// Tỷ lệ chốt = đơn / tin nhắn. Chỉ có nghĩa khi CẢ HAI cùng đến từ quảng cáo của người
// đó. Đơn gán theo tag POS nên người gần như không chạy ads vẫn nhận đơn → ra "chốt
// 460%", vô nghĩa và trông như lỗi. Trường hợp đó trả "—".
const chot = (ord, mess) => (mess > 0 && ord <= mess ? p1(pct(ord, mess)) + "%" : "—");

// Tên hiển thị của người ĐÃ NGHỈ — không có tin riêng, không nằm trong bảng xếp hạng.
const DA_NGHI = new Set([...UNASSIGN].map((k) => DISPLAY[k] || k));
const KHONG_GAN = "(không gán)";

// Chủ campaign theo đúng luật của Sheet (xem chuCamp trong rules.js) — phần chi tiết phải
// cộng lại khớp số đầu bài của chính tin đó.
function marketerOf(name) {
    const key = chuCamp(name);
    return key ? DISPLAY[key] || key : "";
}

async function getJson(f, url, ten) {
    const res = await f(url, { headers: { "cache-control": "no-store" } });
    if (!res.ok) throw new Error(`${ten} HTTP ${res.status}`);
    return res.json();
}

// 1 LẦN gọi realtime cho cả tin tổng lẫn tin cá nhân: route này hỏi thẳng Meta + POS live
// (chậm, có rate-limit) — gọi hai lần một mốc là tự chuốc lỗi.
function fetchRealtime(cfg, dateStr, f) {
    return getJson(f, `${cfg.realtimeUrl}?from_date=${dateStr}&to_date=${dateStr}`, "realtime");
}

async function fetchSheetReport(cfg, dateStr, f) {
    if (!cfg.sheetReportUrl) throw new Error("thiếu dailyReport.sheetReportUrl trong config");
    const j = await getJson(f, `${cfg.sheetReportUrl}?date=${dateStr}`, "sheet-report");
    if (j.error) throw new Error(j.error);
    if (!j.team) throw new Error(`Sheet chưa có dòng ngày ${dateStr}`);
    return j;
}

// Route trả MỌI tab khác "Tổng" trong mảng marketers — kể cả tab nước. Không lọc thì
// "Đài Loan" có tin riêng như một marketer và đứng Top 1 bảng xếp hạng (dính thật ngày
// 15/09/2026, lần đầu file có tab nước). Tin KHÔNG in số theo nước (Sỹ Anh chốt cùng
// ngày) nên tab nước bỏ lặng lẽ; tab không phải nước, không phải marketer đang khai
// trong rules, không phải "(không gán)" thì bỏ, có log.
function tabMarketer(sheet, log) {
    const marketers = [], la = [];
    for (const r of sheet.marketers || []) {
        if (TAB_NUOC.has(r.tab)) continue;
        if (r.tab === KHONG_GAN || Object.prototype.hasOwnProperty.call(MARKETERS, r.tab)) marketers.push(r);
        else la.push(r.tab);
    }
    if (la.length && log) log(`Sheet có tab lạ, bỏ qua: ${la.join(", ")}`);
    return marketers;
}

// Sheet KHÔNG BAO GIỜ mất dòng: sync chết thì dòng vẫn nằm đó, chỉ ĐỨNG SỐ. Nên "đọc
// được dòng ngày X" hoàn toàn không chứng minh số của ngày X đã đủ (04/09/2026: tin 8h
// báo 12,2tr / 116 đơn, số thật 37,2tr / 178 đơn — token Meta mất quyền từ chiều hôm
// trước). Từ đó tin tự tố tuổi của số nó đang đọc. Hai loại tin hỏi hai câu KHÁC NHAU:
//   - tin giữa ngày nói về HÔM NAY → chỉ hỏi được "số cũ bao lâu";
//   - tin 8h30 nói về NGÀY ĐÃ QUA → hỏi "đã có vòng sync nào chạy sau nửa đêm chưa".
function gioVN(ts) {
    const d = new Date(ts);
    const p = (o) => d.toLocaleString("en-GB", { timeZone: "Asia/Ho_Chi_Minh", ...o });
    return `${p({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" })} ngày `
        + `${p({ day: "2-digit" })}/${p({ month: "2-digit" })}`;
}
// Vì sao sync hỏng — tên TKQC / shop đọc lỗi (stale.loi = fetch_errors của /api/talpha/sync-health).
// 23/09/2026 tin chỉ nói "sync đứng 12 giờ 40 phút", không ai biết hai TKQC BM Thuyên bị Meta
// chặn quyền đọc tới khi mở log trên máy chủ. Có tên thì người đọc biết phải gọi ai.
function lyDoLoi(loi) {
    if (!loi) return "";
    const tk = loi.tkqc || [], shop = loi.shops || [], matQuyen = new Set(loi.mat_quyen || []);
    const cau = [];
    if (tk.length) {
        cau.push(`TKQC không đọc được: ${tk.join(", ")}`
            + (tk.every((t) => matQuyen.has(t)) ? " — Meta báo mất quyền đọc, cần cấp lại quyền trong Business Manager hoặc bỏ TK khỏi danh sách sync." : "."));
    }
    if (shop.length) cau.push(`Shop POS không đọc được: ${shop.join(", ")}.`);
    return cau.length ? `${I(cau.join(" "))}\n` : "";
}

function canhBaoSoCu(stale, dateStr, intraday) {
    if (!stale) return "";
    const lyDo = lyDoLoi(stale.loi);
    if (intraday) {
        if (stale.okAge == null || !(stale.okAge > stale.limit)) return "";
        const h = Math.floor(stale.okAge / 60), m = Math.round(stale.okAge % 60);
        const lau = h > 0 ? `${h} giờ${m ? " " + m + " phút" : ""}` : `${m} phút`;
        return `⚠️ ${B(`SỐ CHƯA ĐỦ — sync đứng ${lau}.`)}\n${lyDo}${I("Đợi sync chạy lại rồi đọc lại.")}\n\n`;
    }
    if (!ngayChuaDu(stale.lastOkTs, dateStr)) return "";
    return `⚠️ ${B(`SỐ CHƯA ĐỦ — chưa có vòng sync nào chạy sau khi hết ngày ${ddmm(dateStr)}.`)}\n${lyDo}`
        + `${I(`Số dưới đây chốt lúc ${gioVN(stale.lastOkTs)} — chưa phải số cả ngày. Đợi sync chạy lại rồi đọc lại.`)}\n\n`;
}

// Cảnh báo "số chưa đủ" của MỘT tin. buildMarketerReports tính một lần rồi truyền xuống
// qua opts.canhBao: cờ chuaDu trả ra cho bot (để xếp lịch đính chính) và chữ in trong tin
// phải là CÙNG một kết quả — tính lại hai nơi là sớm muộn lệch nhau.
function canhBaoCuaTin(opts, dateStr) {
    return opts.canhBao != null ? opts.canhBao : canhBaoSoCu(opts.stale, dateStr, opts.intraday);
}

// Số ĐẦU BÀI của tin — bốn con số người đọc nhớ. Tin đính chính so số cũ ↔ số đúng bằng đây.
const soDauBai = (sheet) => ({
    ads: Math.round(Number(sheet.team.ads || 0)),
    don: Number(sheet.team.don || 0),
    mess: Number(sheet.team.mess || 0),
    doanh_so: Math.round(Number(sheet.team.doanh_so || 0)),
});

// opts.label    — chữ in trên đầu tin thay cho ngày thô ("HÔM NAY 02/09 · 13:30").
// opts.intraday — số chưa chốt ngày: thêm dòng nhắc + đổi lời chú thích DS giao.
// opts.stale    — tuổi số từ /api/talpha/sync-health (null = không biết, không cảnh báo).
// opts.fetch    — thay fetch khi test.
async function buildMarketerReports(cfg, dateStr, opts = {}) {
    const f = opts.fetch || fetch;
    const label = opts.label || ddmm(dateStr);
    const sheet = await fetchSheetReport(cfg, dateStr, f);
    // Tin tối so với CẢ NGÀY hôm qua (▲▼). Hỏng thì bỏ phần so sánh, tin vẫn đi.
    let sheetTruoc = null;
    if (opts.intraday) {
        try { sheetTruoc = await fetchSheetReport(cfg, homQuaCua(dateStr), f); }
        catch (e) { if (opts.log) opts.log(`không lấy được số hôm qua để so: ${e.message}`); }
    }
    const canhBao = canhBaoSoCu(opts.stale, dateStr, opts.intraday);
    opts = { ...opts, canhBao };
    let camps = [], canhBaoCamp = "";
    try {
        const data = await fetchRealtime(cfg, dateStr, f);
        // Camp TEST cũng phải rời khỏi phần chi tiết, nếu không phần chi tiết lại lệch
        // với đầu bài của chính tin đó.
        camps = (data.campaigns || []).filter((c) => (c.spend_vnd || 0) > 0 && !isTestCampaign(c.campaign_name));
    } catch (e) {
        canhBaoCamp = e.message;
        if (opts.log) opts.log(`realtime lỗi — gửi tin không kèm chi tiết campaign: ${e.message}`);
    }

    // tab Sheet dùng KEY (Loc, Thuong…), tin nhắn hiển thị TÊN (Lộc, Thương…)
    const bySheet = {};
    for (const r of tabMarketer(sheet, opts.log)) bySheet[DISPLAY[r.tab] || r.tab] = r;

    const byMk = {};
    for (const c of camps) {
        const mk = marketerOf(c.campaign_name);
        if (mk) (byMk[mk] = byMk[mk] || []).push(c);   // camp không gán được → không vào tin cá nhân
    }

    const viTri = (mk) => (THU_TU.includes(mk) ? THU_TU.indexOf(mk) : THU_TU.length);
    // Ai có tin riêng: người có số trong Sheet, không phải người có campaign — người chi
    // 0đ mà vẫn có đơn về tag mình thì vẫn phải có tin.
    const names = Object.keys(bySheet)
        .filter((mk) => mk !== KHONG_GAN && !DA_NGHI.has(mk))
        .filter((mk) => bySheet[mk].ads > 0 || bySheet[mk].don > 0)
        .sort((a, b) => viTri(a) - viTri(b));

    // nguoi[i] là chủ của messages[i] — lệnh "/baocao Lộc" lấy đúng một tin.
    const messages = names.map((mk) => {
        const list = (byMk[mk] || []).sort((a, b) => b.spend_vnd - a.spend_vnd);
        const p = bySheet[mk];
        const spend = p.ads, rev = p.doanh_so, mess = p.mess, ord = p.don;
        // dùng luôn tỷ lệ Sheet đã tính, không tự chia lại rồi lệch số lẻ
        const closeR = p.ty_le_chot, adsR = p.phan_tram_ads;

        let m = canhBaoCuaTin(opts, dateStr) + `📊 ${B(`ADS ${label} — ${mk}`)}\n`;
        m += `💰 Tiền ads: ${B(fmt(spend) + "đ")}  ·  Doanh số: ${B(fmt(rev) + "đ")}  ·  %ads: ${B(rev > 0 ? p1(adsR) + "%" : "—")}\n`;
        m += `💬 Mess: ${fmt(mess)}  ·  🛒 Đơn: ${fmt(ord)}  ·  ✅ Chốt: ${B(chot(ord, mess))}\n`;
        if (opts.intraday) m += `${I("số đang chạy trong ngày — chưa chốt, còn lên tiếp")}\n`;
        if (list.length) {
            m += `\n${B("Theo campaign:")}  ${I("(đơn ở đây gán theo quảng cáo, nên tổng có thể khác số đầu bài — số đầu bài gán theo tag POS, khớp Sheet)")}`;
            for (const c of list.slice(0, cfg.topCampaigns || 8)) {
                const cr = pct(c.orders, c.messages), ar = pct(c.spend_vnd, c.revenue_vnd);
                m += `\n• ${tenNganCamp(c.campaign_name)}`;
                m += `\n   Ads ${fmt(c.spend_vnd)}đ · Mess ${c.messages || 0} · Đơn ${c.orders || 0} · Chốt ${p1(cr)}% · %ads ${c.revenue_vnd > 0 ? Math.round(ar) + "%" : "—"}`;
            }
        } else {
            m += `\n${I(canhBaoCamp
                ? "(chưa lấy được chi tiết campaign lúc này — số đầu bài vẫn đúng theo Sheet)"
                : "(không có campaign nào tiêu tiền)")}`;
        }
        const recs = recommend(list, { rev, closeR, adsR }, cfg);
        if (recs.length) m += `\n\n💡 ${B("Đề xuất:")}\n` + recs.map((r) => "• " + r).join("\n");
        return m;
    });
    const teamMessage = buildTeamReport(dateStr, sheet, { ...opts, label });
    return {
        dateStr, label, teamMessage, messages, nguoi: names,
        // chuaDu: tin này gửi khi số CHƯA ĐỦ → bot xếp lịch đính chính khi sync đủ số.
        chuaDu: canhBao !== "", so: soDauBai(sheet),
        // MỘT tin duy nhất cho mốc tự gửi — Sỹ Anh chốt 16/09/2026: "nhiều tin quá bị loạn".
        // Sỹ Anh duyệt mẫu 26/09/2026: số tổng + theo nước + xếp hạng + CHI TIẾT MỌI CAMP
        // (tên đầy đủ trên Meta) theo marketer — bỏ phần đề xuất việc.
        tinGop: buildTinAds({ dateStr, sheet, sheetTruoc, camps, cfg, canhBaoCamp, opts: { ...opts, label } }),
    };
}

const homQuaCua = (d) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); };

// ▲▼ so với hôm qua: tiền theo %, đếm (đơn, mess) theo số tuyệt đối.
function muiTen(moi, cu, laTien) {
    if (cu == null) return "";
    if (laTien) {
        if (!(cu > 0)) return "";
        const p = Math.round(((moi - cu) / cu) * 100);
        return p === 0 ? " =" : ` ${p > 0 ? "▲" : "▼"}${Math.abs(p)}%`;
    }
    const d = Math.round(moi - cu);
    return d === 0 ? " =" : ` ${d > 0 ? "▲" : "▼"}${Math.abs(d)}`;
}

// Nhãn một camp: 🔴 đốt tiền (luật cũ, giữ nguyên) · 🟢 ngon · 🟡 có đơn · ⚪ chưa ra đơn.
function nhanCamp(c, cfg) {
    const don = c.orders || 0;
    if (c.spend_vnd >= (cfg.recWasteSpend || 300000) && don === 0) return "🔴";
    if (don >= 3 && c.revenue_vnd > 0 && pct(c.spend_vnd, c.revenue_vnd) < (cfg.recGoodAdsPct || 20)) return "🟢";
    return don > 0 ? "🟡" : "⚪";
}

/**
 * TIN ADS — Sỹ Anh duyệt mẫu 26/09/2026 (bản 3). MỘT tin (dài thì chiaTin tự tách):
 *   đầu tin: tiền ads · doanh số · %ads · đơn · mess · chốt (tối có ▲▼ so cả ngày hôm qua),
 *            từng nước, xếp hạng marketer — số lấy thẳng file TỔNG TEAM như cũ;
 *   CHI TIẾT CAMP: mọi camp có tiêu tiền, TÊN ĐẦY ĐỦ như trên Meta Ads (dán vào Ads
 *            Manager là tìm ra), chia theo marketer, tiêu nhiều lên trước.
 * Bỏ phần "việc hôm nay" (Sỹ Anh chốt). Đơn trong chi tiết camp gán theo quảng cáo nên
 * cộng lại có thể khác đầu tin — tin nói rõ điều đó.
 *
 * opts.tieuDe / opts.nguon — dòng đầu và dòng nguồn số do bot dựng theo mốc (sáng/tối/gõ tay).
 */
function buildTinAds({ dateStr, sheet, sheetTruoc, camps, cfg, canhBaoCamp, opts }) {
    const T = sheet.team;
    const Tc = sheetTruoc && sheetTruoc.team ? sheetTruoc.team : null;
    const soSanh = !!(opts.intraday && Tc);
    const mt = (k, laTien) => (soSanh ? muiTen(Number(T[k] || 0), Number(Tc[k] || 0), laTien) : "");
    const dong = [];
    const cb = canhBaoCuaTin(opts, dateStr);
    if (cb) dong.push(cb.replace(/\n+$/, ""), "");
    dong.push(B(opts.tieuDe || `📊 ADS ${opts.label || ddmm(dateStr)}`));
    if (opts.nguon) dong.push(I(opts.nguon));
    dong.push("");
    dong.push(`💰 Ads ${B(fmt(Math.round(T.ads)) + "đ")}${mt("ads", true)} · DS ${B(fmt(Math.round(T.doanh_so)) + "đ")}${mt("doanh_so", true)}`
        + ` · %ads ${B(T.doanh_so > 0 ? p1(T.phan_tram_ads) + "%" : "—")}`);
    dong.push(`🛒 ${fmt(T.don)} đơn${mt("don")} · ${fmt(T.mess)} mess${mt("mess")} · chốt ${p1(T.ty_le_chot)}%`);

    // Theo nước — tab nước của file TỔNG TEAM (Đài Loan, Singapore, UAE).
    const tabs = new Map((sheet.marketers || []).map((r) => [r.tab, r]));
    for (const n of CO_NUOC) {
        const r = tabs.get(n.tab) || tabs.get(n.key);
        if (!r || !(r.ads > 0 || r.don > 0)) continue;
        const ds = r.don > 0 || r.doanh_so > 0 ? `${fmt(r.don)} đơn · ${gonTien(r.doanh_so)}` : "0 đơn";
        dong.push(`${n.flag} ${ds} · ${r.ads > 0 ? `%ads ${r.doanh_so > 0 ? Math.round(r.phan_tram_ads) + "%" : "—"}` : "chưa chạy ads"}`);
    }

    // Xếp hạng marketer theo doanh số.
    const rows = tabMarketer(sheet)
        .filter((r) => r.tab !== KHONG_GAN && (r.ads > 0 || r.don > 0))
        .map((r) => ({ ...r, mk: DISPLAY[r.tab] || r.tab }))
        .filter((r) => !DA_NGHI.has(r.mk))
        .sort((a, b) => (b.doanh_so - a.doanh_so) || (b.ads - a.ads));
    rows.forEach((r, i) => {
        dong.push(`${i === 0 ? "🏆 " : "    "}${B(r.mk)} ${gonTien(r.doanh_so)} · ${fmt(r.don)} đơn · %ads ${r.doanh_so > 0 ? Math.round(r.phan_tram_ads) + "%" : "—"}`);
    });
    const un = (sheet.marketers || []).find((r) => r.tab === KHONG_GAN);
    if (un && (un.doanh_so > 0 || un.don > 0)) dong.push(`📍 Chưa gán cho ai: ${gonTien(un.doanh_so)} · ${fmt(un.don)} đơn`);
    if (soSanh) dong.push(I("▲▼ so với cả ngày hôm qua"));

    // ── Chi tiết camp theo marketer ──
    dong.push("", B(opts.intraday ? "📋 CHI TIẾT CAMP HÔM NAY" : "📋 CHI TIẾT CAMP"));
    if (canhBaoCamp) {
        dong.push(I("(chưa lấy được chi tiết camp lúc này — số tổng ở trên vẫn đúng theo Sheet)"));
    } else if (!camps.length) {
        dong.push(I("(không có camp nào tiêu tiền)"));
    } else {
        dong.push(I("🟢 ngon · 🟡 có đơn · ⚪ chưa ra đơn · 🔴 đốt tiền"));
        const nhom = new Map();
        for (const c of camps) {
            const mk = marketerOf(c.campaign_name) || "Chưa gán";
            if (!nhom.has(mk)) nhom.set(mk, []);
            nhom.get(mk).push(c);
        }
        const tien = (xs) => xs.reduce((n, c) => n + (c.spend_vnd || 0), 0);
        const thuTu = [...nhom].sort((a, b) => (a[0] === "Chưa gán") - (b[0] === "Chưa gán") || tien(b[1]) - tien(a[1]));
        for (const [mk, xs] of thuTu) {
            xs.sort((a, b) => b.spend_vnd - a.spend_vnd);
            dong.push("", `${B(`👤 ${mk}`)} · ${xs.length} camp · ads ${gonTien(tien(xs))}`);
            for (const c of xs) {
                const don = c.orders || 0, mess = c.messages || 0;
                const chi = [gonTien(c.spend_vnd), `${fmt(mess)} mess`, `${fmt(don)} đơn`];
                if (don > 0 && mess > 0) chi.push(`chốt ${Math.round(pct(don, mess))}%`);
                if (c.revenue_vnd > 0) chi.push(`%ads ${Math.round(pct(c.spend_vnd, c.revenue_vnd))}%`);
                dong.push(`${nhanCamp(c, cfg)} ${String(c.campaign_name || "").trim()}`, `    ${chi.join(" · ")}`);
            }
        }
        dong.push("", I("Đơn trong chi tiết camp gán theo quảng cáo nên có thể khác số đầu tin (đầu tin gán theo tag POS, khớp Sheet)."));
    }
    return dong.join("\n");
}

/**
 * TIN GỘP — tất cả trong MỘT tin (Sỹ Anh chốt 16/09/2026: sáu tin một lượt là loạn nhóm).
 *
 * Lấy nguyên tin TỔNG TEAM (đã có số tổng + bảng xếp hạng từng người) rồi thêm hai dòng
 * campaign đáng làm gì đó. CỐ Ý bỏ phần chi tiết từng campaign của từng người: gộp hết
 * vào là tin dài gấp ba lần khung 1800 ký tự của Zalo, lại bị chia thành mấy tin — đúng
 * cái đang muốn tránh. Ai cần chi tiết thì gõ /baocao <tên>.
 */
function buildTinGop({ dateStr, sheet, camps, cfg, canhBaoCamp, opts }) {
    let m = "";
    const ten = (c) => tenNganCamp(c.campaign_name);
    const chu = (c) => { const k = marketerOf(c.campaign_name); return k ? ` (${k})` : ""; };

    const dot = camps
        .filter((c) => c.spend_vnd >= (cfg.recWasteSpend || 300000) && !(c.orders > 0))
        .sort((a, b) => b.spend_vnd - a.spend_vnd);
    if (dot.length) {
        m += `\n\n🔥 ${B(`Đốt tiền không ra đơn (${dot.length})`)}: `
            + dot.slice(0, 3).map((c) => `${ten(c)} ${gonTien(c.spend_vnd)}${chu(c)}`).join(" · ")
            + (dot.length > 3 ? " …" : "");
    }
    const ngon = camps
        .filter((c) => c.revenue_vnd > 0 && (c.orders || 0) >= 3 && pct(c.spend_vnd, c.revenue_vnd) < (cfg.recGoodAdsPct || 20))
        .sort((a, b) => b.revenue_vnd - a.revenue_vnd);
    if (ngon.length) {
        m += `\n💡 ${B("Đang ngon")}: `
            + ngon.slice(0, 2).map((c) => `${ten(c)} ${c.orders} đơn · %ads ${Math.round(pct(c.spend_vnd, c.revenue_vnd))}%${chu(c)}`).join(" · ");
    }
    if (canhBaoCamp) m += `\n\n${I("(chưa lấy được danh sách campaign lúc này — số đầu bài vẫn đúng theo Sheet)")}`;
    return buildTeamReport(dateStr, sheet,
        { ...opts, themVao: m, themCuoi: " · gõ /baocao <tên> để xem chi tiết campaign của một người" });
}

// Tin TỔNG TEAM — số lấy thẳng dòng TỔNG của Sheet, cùng bảng xếp hạng từng người. Ô
// "(không gán)" KHÔNG nằm trong dòng TỔNG nhưng là tiền thật — nêu riêng chứ không giấu.
function buildTeamReport(dateStr, sheet, opts = {}) {
    const label = opts.label || ddmm(dateStr);
    const T = sheet.team;
    const marketers = tabMarketer(sheet);
    const ds = (r) => (r.doanh_so > 0 ? Math.round(r.phan_tram_ads) + "%" : "—");

    let m = canhBaoCuaTin(opts, dateStr) + `🏆 ${B(`TỔNG TEAM — ${label}`)}\n`;
    m += `💰 Tiền ads: ${B(fmt(Math.round(T.ads)) + "đ")}  ·  Doanh số: ${B(fmt(Math.round(T.doanh_so)) + "đ")}  ·  %ads: ${B(T.doanh_so > 0 ? p1(T.phan_tram_ads) + "%" : "—")}\n`;
    m += `💬 Mess: ${fmt(T.mess)}  ·  🛒 Đơn: ${fmt(T.don)}  ·  ✅ Chốt: ${B(p1(T.ty_le_chot) + "%")}\n`;
    // Đơn COD vài ngày mới giao xong, nên DS giao của ngày vừa qua LUÔN thấp — ghi rõ để
    // không ai tưởng doanh số tụt.
    m += `📦 DS giao thành công: ${fmt(Math.round(T.ds_giao_tc))}đ ${I(opts.intraday
        ? "(đơn hôm nay gần như chưa giao xong — số này còn lên nhiều)"
        : "(đơn hôm qua phần lớn chưa giao xong — số này còn lên)")}\n`;

    const rows = marketers
        .filter((r) => r.tab !== KHONG_GAN && (r.ads > 0 || r.don > 0))
        .map((r) => ({ ...r, mk: DISPLAY[r.tab] || r.tab }))
        .filter((r) => !DA_NGHI.has(r.mk))
        .sort((a, b) => (b.doanh_so - a.doanh_so) || (b.ads - a.ads));

    if (rows.length) {
        const top = rows[0];
        if (top.doanh_so > 0) {
            m += `\n👑 ${B(`Top 1 ${opts.intraday ? "hôm nay" : "ngày " + ddmm(dateStr)}: ${top.mk} — ${fmt(Math.round(top.doanh_so))}đ`)}\n`;
        }
        m += `\n${B("Xếp hạng theo doanh số:")}`;
        rows.forEach((r, i) => {
            m += `\n${i === 0 && r.doanh_so > 0 ? "👑" : i + 1 + "."} ${B(r.mk)} — Ads ${fmt(Math.round(r.ads))}đ · DS ${fmt(Math.round(r.doanh_so))}đ · %ads ${ds(r)} · ${fmt(r.don)} đơn · chốt ${p1(r.ty_le_chot)}%`;
        });
    }

    const un = marketers.find((r) => r.tab === KHONG_GAN);
    if (un && (un.doanh_so > 0 || un.don > 0)) {
        m += `\n\n📍 Chưa gán được cho ai: ${fmt(Math.round(un.doanh_so))}đ · ${fmt(un.don)} đơn — nằm ngoài bảng trên.`;
    }
    if (opts.themVao) m += opts.themVao;           // tin gộp chèn phần campaign ở đây
    // Chú thích nguồn số + (tin gộp) chỗ lấy chi tiết — GỘP một dòng, càng ít dòng càng dễ đọc.
    m += `\n${I(`số lấy thẳng từ file TỔNG TEAM THÁNG ${Number(dateStr.slice(5, 7))}${opts.themCuoi || ""}`)}`;
    return m;
}

function recommend(list, agg, cfg) {
    const r = [];
    const waste = list.filter((c) => c.spend_vnd >= (cfg.recWasteSpend || 300000) && (c.orders || 0) === 0);
    if (waste.length) r.push(`Tắt / đổi sản phẩm ${waste.length} camp đốt tiền không ra đơn: ${waste.slice(0, 3).map((c) => tenNganCamp(c.campaign_name)).join(", ")}`);
    const lowClose = list.filter((c) => (c.messages || 0) >= 20 && pct(c.orders, c.messages) < (cfg.recLowClosePct || 5));
    if (lowClose.length) r.push(`Chốt thấp (<${cfg.recLowClosePct || 5}%) ở ${lowClose.length} camp — kiểm tra sale chốt & target`);
    if (agg.rev > 0 && agg.adsR > (cfg.recHighAdsPct || 30)) r.push(`%ads cao (${Math.round(agg.adsR)}%) — đang ăn mòn lãi, siết ngân sách các camp kém`);
    const win = list.filter((c) => c.revenue_vnd > 0 && pct(c.spend_vnd, c.revenue_vnd) < (cfg.recGoodAdsPct || 20) && (c.orders || 0) >= 3);
    if (win.length) r.push(`Tăng ngân sách ${win.length} camp hiệu quả (%ads thấp): ${win.slice(0, 3).map((c) => tenNganCamp(c.campaign_name)).join(", ")}`);
    if (!r.length && list.length) r.push("Chỉ số ổn định — duy trì và theo dõi.");
    return r;
}

// ─── TIN ĐÍNH CHÍNH ───────────────────────────────────────────────────────────────
// Gửi sau một tin tạm (gửi đúng khung giờ trong lúc sync còn đứng). Chỉ nêu ĐÚNG chỗ lệch
// rồi đính kèm bản báo cáo đủ số — Sỹ Anh chốt 22/09/2026.
// Số không lệch chỗ nào thì CHỈ gửi mấy dòng đầu: lặp lại cả bản báo cáo y nguyên chỉ để
// nói "không đổi" là làm loãng nhóm.
const KHOAN_LECH = [["ads", "Tiền ads", true], ["don", "Đơn", false],
    ["doanh_so", "Doanh số", true], ["mess", "Mess", false]];

function dongLech(soCu, soMoi) {
    const ra = [];
    for (const [k, ten, tien] of KHOAN_LECH) {
        const a = Math.round(Number((soCu || {})[k] || 0)), b = Math.round(Number((soMoi || {})[k] || 0));
        if (a === b) continue;
        const v = (x) => (tien ? fmt(x) + "đ" : fmt(x));
        ra.push(`${ten}: ${v(a)} → ${B(v(b))}  (${b > a ? "+" : "−"}${v(Math.abs(b - a))})`);
    }
    return ra;
}

function buildTinDinhChinh({ tin, soCu, soMoi, label, luc, intraday }) {
    const lech = dongLech(soCu, soMoi);
    let m = `🔄 ${B(`ĐÍNH CHÍNH — ${label}`)}\n`;
    m += `${I(`Tin lúc ${gioVN(luc)} gửi khi sync còn đứng nên số chưa đủ. Vòng sync vừa chạy xong`
        + `${intraday ? " — số dưới đây đủ tới lúc này." : " — dưới đây là số cả ngày."}`)}\n`;
    if (!lech.length) return m + `\n✅ ${B("Số không đổi")} — tin cũ đã đúng, không phải xem lại.`;
    return m + `\n${B("Lệch so với tin cũ:")}\n` + lech.map((x) => "• " + x).join("\n") + `\n\n` + tin;
}

module.exports = {
    buildMarketerReports, buildTeamReport, buildTinGop, buildTinAds, recommend,
    buildTinDinhChinh, dongLech, soDauBai,
};

// ═══════════════════════════════════════════════════════════════════
// TALPHA — Bot báo cáo & cảnh báo vào nhóm WhatsApp
// ───────────────────────────────────────────────────────────────────
// - 8h sáng: digest tồn kho dưới ngưỡng + 1 tin TỔNG TEAM + báo cáo ads từng marketer (hôm qua).
// - 13:30 & 22:00 (dailyReport.intradaySlots): TỔNG TEAM + từng marketer, số ĐANG CHẠY hôm nay.
// - Mỗi adsPollMinutes: cảnh báo spend spike / campaign đốt tiền 0 tin nhắn.
// - Lệnh /kho trong nhóm: trả tồn kho dưới ngưỡng ngay.
// - Nguồn: API dashboard (inventory = POS live, realtime = Meta+POS, ads-alerts = BQ).
// - Gửi vào 1 nhóm WhatsApp (whatsapp-web.js, phiên lưu trong .wwebjs_auth).
// Chạy: node bot.js         (service)
//       node bot.js --list-groups   (liệt kê nhóm để lấy tên, rồi thoát)
// ═══════════════════════════════════════════════════════════════════
const fs = require("fs");
const path = require("path");
const qrcode = require("qrcode-terminal");
const { Client, LocalAuth } = require("whatsapp-web.js");
const { buildMarketerReports } = require("./daily_report");
const { slotAction, toMin } = require("./schedule");   // quyết định mốc gửi (có test riêng)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DIR = __dirname;
const CFG = require("./config");   // config.json + base URL dashboard từ env TALPHA_DASHBOARD_URL
const STATE_FILE = path.join(DIR, "state.json");
const LIST_MODE = process.argv.includes("--list-groups");
// Gửi TAY đúng 1 tin TỔNG TEAM rồi thoát — dùng khi cần gửi lại mà không muốn bắn
// trọn gói báo cáo 8h (tồn kho + billing + 7 tin marketer).
// Phải chạy từ CHÍNH tiến trình bot: whatsapp-web.js 1.26 không còn khớp WhatsApp Web
// 2.3000.x — getChatById trả null và sendMessage trả undefined, nên script một-lần
// bên ngoài tưởng gửi được mà tin không rời máy (đã dính 02/09).
const TEAM_NOW = process.argv.includes("--team-now");
// Giá trị đứng ngay sau một cờ: `--team-now 2026-09-03`, `--note "..."`. Trả "" nếu
// không có (cờ đứng một mình) hoặc nếu ngay sau lại là một cờ khác.
function argAfter(flag) {
    const i = process.argv.indexOf(flag);
    const v = i >= 0 ? process.argv[i + 1] : "";
    return v && !v.startsWith("--") ? v : "";
}
// Bắn NGAY trọn bộ báo cáo giữa ngày (số hôm nay) rồi thoát — để kiểm tra sau khi deploy
// mà không phải ngồi đợi tới 13:30. Cũng phải chạy từ chính tiến trình bot (xem ghi chú
// TEAM_NOW ở trên): script một-lần bên ngoài tưởng gửi được mà tin không rời máy.
const INTRADAY_NOW = process.argv.includes("--intraday-now");

const log = (...a) => console.log(new Date().toISOString(), ...a);

function loadState() {
    try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
    catch { return { alerted: {} }; }
}
function saveState(s) {
    try { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }
    catch (e) { log("Lỗi ghi state:", e.message); }
}
// Ghi MỘT thay đổi nhỏ vào state: đọc lại file ngay trước khi ghi thay vì dùng bản đã
// giữ trong biến. Vòng rà 8h và vòng rà giữa ngày đều ôm state qua nhiều await mạng
// (gọi Meta + POS mất vài chục giây); ai ghi sau mà dùng bản cũ là xoá sạch khoá của
// người kia — mốc đã gửi bị quên, vòng rà sau bắn lại tin thứ hai vào nhóm.
function markState(mut) {
    const st = loadState();
    mut(st);
    saveState(st);
    return st;
}

function inQuietHours() {
    const h = Number(new Date().toLocaleString("en-US", { hour: "2-digit", hourCycle: "h23", timeZone: CFG.timezone }));
    const { quietStartHour: a, quietEndHour: b } = CFG;
    if (a == null || b == null || a === b) return false;
    return a < b ? (h >= a && h < b) : (h >= a || h < b); // qua nửa đêm
}

// Xếp mức nghiêm trọng cho 1 SKU. null = bình thường.
function classify(r) {
    const total = Number(r.total ?? 0);
    const perDay = Number(r.perDay ?? 0);
    const days = r.days == null ? null : Number(r.days);
    if (perDay < (CFG.minPerDay || 0)) return null;      // gần như không bán → bỏ qua
    if (total <= 0) return { level: "critical", days: 0 };            // hết sạch / tồn âm mà đang bán
    if (days != null && days < (CFG.soonDays || 15)) return { level: "soon", days };
    return null;
}

const FLAG = { sa: "🇸🇦", ae: "🇦🇪", om: "🇴🇲", kw: "🇰🇼", bh: "🇧🇭", qa: "🇶🇦", tw: "🇹🇼" };
function skuLine(r, c) {
    const perDay = Number(r.perDay ?? 0);
    const total = Number(r.total ?? 0);
    const mk = r.mkt ? ` · MKT: ${r.mkt}` : "";
    if (c.level === "critical")
        return `🔴 ${r.code} — ${r.name}\n   Tồn: ${total} · bán ~${perDay}/ngày${mk}`;
    return `⚠️ ${r.code} — ${r.name}\n   Tồn: ${total} · bán ~${perDay}/ngày · còn ~${c.days} ngày${mk}`;
}

async function fetchInventory() {
    const res = await fetch(CFG.inventoryUrl, { headers: { "cache-control": "no-store" } });
    if (!res.ok) throw new Error(`inventory HTTP ${res.status}`);
    const j = await res.json();
    if (!Array.isArray(j.skuMatrix)) throw new Error("payload thiếu skuMatrix");
    return j;
}

function buildMessage(fresh, asOfLabel) {
    const crit = fresh.filter(f => f.c.level === "critical");
    const soon = fresh.filter(f => f.c.level === "soon");
    const cap = CFG.maxItemsPerMessage || 25;
    let msg = "🚨 *CẢNH BÁO TỒN KHO — TALPHA*\n";
    msg += `_${asOfLabel || "POS realtime"}_\n`;
    if (crit.length) {
        msg += `\n*HẾT HÀNG / TỒN ÂM (${crit.length})* — dừng ads gấp:\n`;
        msg += crit.slice(0, cap).map(f => skuLine(f.r, f.c)).join("\n");
    }
    if (soon.length) {
        msg += `\n\n*SẮP HẾT < ${CFG.soonDays} NGÀY (${soon.length})* — cân nhắc nhập/giảm ads:\n`;
        msg += soon.slice(0, cap).map(f => skuLine(f.r, f.c)).join("\n");
    }
    const extra = (crit.length + soon.length) - Math.min(crit.length, cap) - Math.min(soon.length, cap);
    if (extra > 0) msg += `\n\n…và ${extra} SKU khác. Xem chi tiết trên dashboard.`;
    return msg;
}

// In base URL ngay lúc khởi động: log là bằng chứng bot đang gọi đúng dashboard nào
// (trên Mac mà thấy 3001 = đang gọi app broadcast, mọi số sẽ 404 im lặng).
log(`Dashboard base: ${CFG.dashboardBaseUrl}${process.env.TALPHA_DASHBOARD_URL ? " (env TALPHA_DASHBOARD_URL)" : ""}`);

// ─── WhatsApp client ───
const client = new Client({
    authStrategy: new LocalAuth({ dataPath: path.join(DIR, ".wwebjs_auth") }),
    puppeteer: {
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    },
});

let targetChat = null;

client.on("qr", (qr) => {
    log("Quét QR bằng WhatsApp trên điện thoại (Cài đặt → Thiết bị đã liên kết → Liên kết thiết bị):");
    qrcode.generate(qr, { small: true });
    try { fs.writeFileSync(path.join(DIR, "last_qr.txt"), qr); } catch {}
});

client.on("authenticated", () => log("Đã xác thực WhatsApp."));
client.on("auth_failure", (m) => log("AUTH FAIL:", m));
client.on("disconnected", (r) => log("Mất kết nối:", r, "→ pm2 sẽ tự restart"));

async function getChatsRetry(n = 15) {
    for (let i = 0; i < n; i++) {
        try { return await client.getChats(); }
        catch (e) { log(`getChats thử lại lần ${i + 1}:`, e.message); await new Promise(r => setTimeout(r, 5000)); }
    }
    throw new Error("Không lấy được danh sách chat sau nhiều lần thử");
}

// Gửi THẲNG bằng group id (bỏ getChats vì lỗi tương thích version WhatsApp Web).
const TARGET = CFG.groupId || "";

client.on("ready", async () => {
    log("Bot đã sẵn sàng.");
    if (TEAM_NOW) {
        try {
            const arg = argAfter("--team-now");
            let y = arg;
            if (!/^\d{4}-\d{2}-\d{2}$/.test(y)) {          // không truyền ngày → hôm qua
                const d = new Date(vnDateStr() + "T00:00:00Z");
                d.setUTCDate(d.getUTCDate() - 1);
                y = d.toISOString().slice(0, 10);
            }
            const { teamMessage } = await buildMarketerReports(CFG.dailyReport, y,
                { stale: await fetchStale() });
            if (!teamMessage) throw new Error("không dựng được tin TỔNG TEAM");
            const note = argAfter("--note");
            await client.sendMessage(TARGET, note ? note + "\n\n" + teamMessage : teamMessage);
            log(`Đã gửi TAY 1 tin TỔNG TEAM (ngày ${y})${note ? " kèm ghi chú" : ""}.`);
        } catch (e) { log("Gửi tay lỗi:", e.message); }
        setTimeout(() => process.exit(0), 4000);
        return;
    }
    if (INTRADAY_NOW) {
        try {
            const { sent } = await sendIntradayReport(slotLabelNow());
            log(`Đã gửi TAY báo cáo giữa ngày (${sent} tin).`);
        } catch (e) { log("Gửi tay giữa ngày lỗi:", e.message); }
        setTimeout(() => process.exit(0), 4000);
        return;
    }
    if (LIST_MODE) {
        try {
            const chats = await getChatsRetry();
            chats.filter(c => c.isGroup).forEach(g => console.log(`   • "${g.name}"   [id: ${g.id._serialized}]`));
        } catch (e) { log("Không liệt kê được nhóm:", e.message); }
        setTimeout(() => process.exit(0), 1500);
        return;
    }
    if (!TARGET) { log("⚠️ config.groupId đang rỗng — chưa biết gửi vào nhóm nào."); return; }
    log(`Gửi vào nhóm id ${TARGET} ("${CFG.groupName || "?"}"). Báo cáo ${DAILY_AT}`
        + (INTRADAY_SLOTS.length ? ` + ${INTRADAY_SLOTS.join(" + ")}` : "")
        + ` + cảnh báo ads mỗi ${CFG.adsPollMinutes || 120}'.`);
    try {
        await client.sendMessage(TARGET,
            `🤖 *Bot TALPHA đã kết nối nhóm này.*\n` +
            `• ${DAILY_AT}: báo cáo ads từng marketer + tồn kho + TKQC/thẻ (số hôm qua)\n` +
            (INTRADAY_SLOTS.length
                ? `• ${INTRADAY_SLOTS.join(" & ")}: báo cáo ads từng marketer (số đang chạy hôm nay)\n` : ``) +
            `• Mỗi 3h: cảnh báo camp đốt tiền · thẻ sắp bị quét/thanh toán fail · sync lỗi\n` +
            `Gõ */kho* xem tồn kho · */tkqc* xem thẻ & chi tiêu TKQC.`);
        log("Đã gửi tin xác nhận kết nối.");
    } catch (e) { log("Lỗi gửi tin xác nhận:", e.message); }
    if (CFG.adsAlertsUrl) {
        pollAds();
        setInterval(pollAds, (CFG.adsPollMinutes || 120) * 60 * 1000);
    }
    if (CFG.syncHealthUrl) {
        pollSyncHealth();
        setInterval(pollSyncHealth, (CFG.adsPollMinutes || 120) * 60 * 1000);
    }
    if (CFG.billingUrl) {
        pollBilling();
        // poll dày hơn ads (mặc định 60') để bắt CÚ QUÉT thẻ chính xác giờ + số tiền
        setInterval(pollBilling, (CFG.billingPollMinutes || 60) * 60 * 1000);
    }
    if (CFG.dailyReport) {
        checkDailyReport();
        setInterval(checkDailyReport, 5 * 60 * 1000);    // rà 5' — giờ gửi có phút nên 10' là trễ quá
    }
    if (INTRADAY_SLOTS.length) {
        checkIntradayReports();
        setInterval(checkIntradayReports, 5 * 60 * 1000); // rà 5' → mốc 13:30 trễ tối đa 5'
    }
});

// Tuổi của số trong Sheet, đọc từ /api/talpha/sync-health (last_ok_age_minutes =
// số phút kể từ vòng sync THÀNH CÔNG gần nhất). Hỏng thì trả null → tin gửi như cũ,
// không có cảnh báo: thà thiếu cảnh báo còn hơn chặn mất báo cáo.
async function fetchStale() {
    const limit = Number((CFG.dailyReport || {}).staleWarnMinutes || 120);
    if (!CFG.syncHealthUrl) return null;
    try {
        const res = await fetch(CFG.syncHealthUrl, { headers: { "cache-control": "no-store" } });
        if (!res.ok) return null;
        const j = await res.json();
        const okAge = j.last_ok_age_minutes == null ? null : Number(j.last_ok_age_minutes);
        if (!Number.isFinite(okAge)) return null;
        // sync-health chỉ trả TUỔI (phút), không trả mốc thời gian → tự dựng lại. Tin 8h
        // cần mốc chứ không cần tuổi: nó phải biết vòng sync có rơi sau nửa đêm không.
        return { okAge, limit, lastOkTs: Date.now() - okAge * 60000 };
    } catch (e) { log("Đọc tuổi sync lỗi:", e.message); return null; }
}

// Giờ gửi tin đầu ngày. `dailyReport.at` ("08:30") ưu tiên; không khai thì lùi về
// `hour` (số nguyên, cấu hình cũ). Dời sang 8h30 vì sáng nào máy Mac ngủ qua đêm thì
// vòng sync đầu tiên chạy lúc ~08:06 và xong ~08:22 — bắn lúc 8h đúng là bắn trước khi
// số của hôm qua kịp đổ xong (04/09 dính đúng thế, tin báo thiếu 67%).
const DAILY_AT = (() => {
    const at = String((CFG.dailyReport || {}).at || "").trim();
    if (/^\d{1,2}:\d{2}$/.test(at)) return at;
    const h = Number((CFG.dailyReport || {}).hour);
    return String(Number.isFinite(h) ? h : 8).padStart(2, "0") + ":00";
})();

// ─── Báo cáo ads đầu ngày: tin TỔNG TEAM + từng marketer ───
// hourCycle h23 bắt buộc: hour12:false trên Node/ICU trả "24" lúc 0h đêm → guard `< 8` bị vượt, báo cáo 8h từng bắn lúc 00:05 VN.
function vnHour() { return Number(new Date().toLocaleString("en-US", { hour: "2-digit", hourCycle: "h23", timeZone: CFG.timezone })); }
function vnDateStr() { return new Date().toLocaleDateString("sv-SE", { timeZone: CFG.timezone }); } // YYYY-MM-DD

// Digest tồn kho đầu ngày = ảnh chụp toàn bộ SKU đang dưới ngưỡng (không phải edge-detect).
async function buildStockDigest() {
    const inv = await fetchInventory();
    const items = inv.skuMatrix.map((r) => ({ r, c: classify(r) })).filter((x) => x.c);
    if (!items.length) return "📦 *TỒN KHO ĐẦU NGÀY*\n✅ Không có SKU nào sắp hết / hết hàng.";
    return "📦 *TỒN KHO ĐẦU NGÀY*\n" + buildMessage(items, inv.asOf && inv.asOf.label);
}

async function checkDailyReport() {
    if (!TARGET) return;
    try {
        const today = vnDateStr();
        const st = loadState();
        if (st.lastDailyReport === today) return;                 // đã gửi hôm nay
        if (toMin(vnHHMM()) < toMin(DAILY_AT)) return;            // chưa tới giờ gửi

        // 1) Tồn kho đầu ngày
        try {
            const sd = await buildStockDigest();
            await client.sendMessage(TARGET, sd);
        } catch (e) { log("Digest tồn kho lỗi:", e.message); }

        // 1.5) Billing TKQC đầu ngày (chi tiêu, nợ chờ quét, thẻ)
        if (CFG.billingUrl) {
            try {
                const bd = await buildBillingDigest();
                if (bd) { await client.sendMessage(TARGET, bd); await sleep(1500); }
                // Bảng NẠP THẺ gửi thêm vào các nhóm làm việc (thay việc hỏi tay từng người)
                for (const gid of CFG.napTheGroupIds || []) {
                    try {
                        await client.sendMessage(gid, await buildCardTopupMessage());
                        await sleep(1500);
                    } catch (e) { log(`Nạp-thẻ gửi ${gid} lỗi:`, e.message); }
                }
            } catch (e) { log("Digest billing lỗi:", e.message); }
        }

        // 2) Báo cáo ads TỪNG marketer (ngày hôm qua) — mỗi người 1 tin
        const target = new Date(today + "T00:00:00Z");
        target.setUTCDate(target.getUTCDate() - 1);
        const y = target.toISOString().slice(0, 10);
        try {
            const { teamMessage, messages } = await buildMarketerReports(CFG.dailyReport, y,
                { stale: await fetchStale() });
            if (teamMessage) { await client.sendMessage(TARGET, teamMessage); await sleep(1500); }
            for (const m of messages) { await client.sendMessage(TARGET, m); await sleep(1500); }
            log(`Đã gửi tin TỔNG TEAM + ${messages.length} báo cáo marketer (ngày ${y}).`);
        } catch (e) { log("Báo cáo marketer lỗi:", e.message); }

        markState((s) => { s.lastDailyReport = today; });
    } catch (e) { log("Lỗi báo cáo đầu ngày:", e.message); }
}

// ─── Báo cáo ads GIỮA NGÀY (13:30, 22:00) — số ĐANG CHẠY của hôm nay ───
// Chỉ phần ads: 1 tin TỔNG TEAM + mỗi marketer 1 tin. KHÔNG kèm tồn kho/billing — hai
// thứ đó đã có ở tin 8h, nhắc lại 3 lần/ngày chỉ làm nhóm không ai đọc nữa.
//
// Vì sao rà theo vòng chứ không setTimeout tới đúng giờ: pm2 restart lúc 13:29 là mất
// sạch timer, mốc hôm đó im luôn. Đổi lại vòng rà phải tự lo hai việc mà timer không cần:
//   1. chống bắn lại  → state ghi riêng TỪNG mốc (state.intraday["13:30"] = ngày).
//   2. chống bắn MUỘN → cửa sổ catch-up. Bot bật lại lúc 21h mà vẫn bắn tin dán nhãn
//      "13:30" thì vừa sai nhãn vừa dẫm chân mốc 22h ngay sau đó.
const INTRADAY_SLOTS = ((CFG.dailyReport || {}).intradaySlots || [])
    .map((x) => String(x).trim()).filter((x) => /^\d{1,2}:\d{2}$/.test(x));
const INTRADAY_WINDOW = Number((CFG.dailyReport || {}).intradayCatchUpMinutes || 60);

// "14:26" giờ VN. hourCycle h23 BẮT BUỘC — cùng lý do đã ghi ở vnHour(): hour12:false
// trả "24" lúc nửa đêm, khi đó mốc nào cũng thành "đã qua giờ".
function vnHHMM() {
    return new Date().toLocaleString("en-US",
        { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: CFG.timezone });
}
function slotLabel(hhmm) {
    const t = vnDateStr();
    return `HÔM NAY ${t.slice(8, 10)}/${t.slice(5, 7)} · ${hhmm}`;
}
const slotLabelNow = () => slotLabel(vnHHMM());
const markIntraday = (slot, day) => markState((s) => { (s.intraday = s.intraday || {})[slot] = day; });

async function sendIntradayReport(label) {
    const today = vnDateStr();
    const { teamMessage, messages } =
        await buildMarketerReports(CFG.dailyReport, today,
            { label, intraday: true, stale: await fetchStale() });
    let sent = 0;
    if (teamMessage) { await client.sendMessage(TARGET, teamMessage); sent++; await sleep(1500); }
    for (const m of messages) { await client.sendMessage(TARGET, m); sent++; await sleep(1500); }
    return { sent, marketers: messages.length };
}

async function checkIntradayReports() {
    if (!TARGET || !INTRADAY_SLOTS.length) return;
    const today = vnDateStr();

    for (const slot of INTRADAY_SLOTS) {
        // Đọc state ở TỪNG mốc chứ không đọc một lần: gửi xong mốc trước mất vài chục
        // giây, trong khoảng đó file đã có thể bị vòng rà khác ghi lại.
        const daGui = (loadState().intraday || {})[slot];
        const act = slotAction(slot, vnHHMM(), daGui, today, INTRADAY_WINDOW);
        if (!act) continue;                           // chưa tới giờ, hoặc gửi rồi
        if (act === "skip") {                         // quá cửa sổ → bỏ hẳn mốc hôm nay
            markIntraday(slot, today);
            log(`Bỏ mốc ${slot} hôm nay (quá cửa sổ ${INTRADAY_WINDOW}', bây giờ ${vnHHMM()}).`);
            continue;
        }
        try {
            const r = await sendIntradayReport(slotLabel(slot));
            // Chỉ đánh dấu SAU KHI gửi xong: Sheet chưa kịp có số hôm nay hay Meta rate-limit
            // thì để nguyên, vòng rà sau (còn trong cửa sổ) thử lại.
            markIntraday(slot, today);
            log(`Đã gửi báo cáo giữa ngày ${slot}: TỔNG TEAM + ${r.marketers} marketer.`);
        } catch (e) { log(`Báo cáo giữa ngày ${slot} lỗi:`, e.message); }
    }
}

// ─── Cảnh báo ADS: đốt tiền không ra tin nhắn + tổng spend cao bất thường ───
const ADS_STATE_FILE = path.join(DIR, "ads_state.json");
function loadAdsState() { try { return JSON.parse(fs.readFileSync(ADS_STATE_FILE, "utf8")); } catch { return {}; } }
function saveAdsState(s) { try { fs.writeFileSync(ADS_STATE_FILE, JSON.stringify(s, null, 2)); } catch {} }
const vnd = (n) => Number(n || 0).toLocaleString("vi-VN");

async function pollAds() {
    if (!TARGET) return;
    try {
        if (inQuietHours()) return;
        const res = await fetch(CFG.adsAlertsUrl, { headers: { "cache-control": "no-store" } });
        if (!res.ok) throw new Error(`ads-alerts HTTP ${res.status}`);
        const a = await res.json();
        let st = loadAdsState();
        if (st.day !== a.day) st = { day: a.day, spikeAlerted: false, waste: [] };  // sang ngày mới → reset

        const parts = [];
        // 1) Tổng spend cao bất thường
        if (!st.spikeAlerted && a.spikeRatio && a.totalSpend >= (CFG.adsMinTotalForSpike || 0)
            && a.spikeRatio >= (CFG.adsSpikeRatio || 1.5)) {
            parts.push(`📈 *Chi tiêu ads hôm nay CAO BẤT THƯỜNG*\nHôm nay: ${vnd(a.totalSpend)}đ · TB 7 ngày: ${vnd(a.avg7d)}đ (×${a.spikeRatio})`);
            st.spikeAlerted = true;
        }
        // 2) Campaign đốt tiền không ra tin nhắn (mới)
        const seen = new Set(st.waste || []);
        const fresh = (a.wasteful || []).filter(w => w.spend >= (CFG.adsWasteSpend || 300000) && !seen.has(w.campaign));
        if (fresh.length) {
            let m = `🔥 *Campaign ĐỐT TIỀN KHÔNG RA TIN NHẮN (${fresh.length})*`;
            m += fresh.slice(0, 12).map(w =>
                `\n• ${w.spend ? vnd(w.spend) + "đ" : ""} · 0 tin nhắn${w.marketer ? " · " + w.marketer : ""}\n   ${String(w.campaign).slice(0, 70)}`).join("");
            parts.push(m);
            fresh.forEach(w => seen.add(w.campaign));
            st.waste = [...seen];
        }
        saveAdsState(st);
        if (parts.length) {
            await client.sendMessage(TARGET, `🚨 *CẢNH BÁO ADS — TALPHA*\n_ngày ${a.day}_\n\n` + parts.join("\n\n"));
            log(`Đã gửi cảnh báo ads (${parts.length} mục).`);
        } else {
            log("Poll ads: không có cảnh báo mới.");
        }
    } catch (e) { log("Lỗi poll ads:", e.message); }
}

// ─── Billing TKQC: chống "đang chạy thì thẻ hết tiền" ───
async function fetchBilling() {
    const res = await fetch(CFG.billingUrl, { headers: { "cache-control": "no-store" } });
    if (!res.ok) throw new Error(`billing HTTP ${res.status}`);
    return res.json();
}
// ── Theo dõi CHU KỲ QUÉT THẺ: Meta gỡ hết billing API (threshold/transactions —
// verify 30/07) VÀ quét "1 lần/ngày" bất kể ngưỡng → KHÔNG học ngưỡng (sẽ sai).
// Thay vào đó: balance rơi >70% từ đỉnh >500k = 1 CÚ QUÉT THẬT, số tiền chính xác
// = đỉnh − đáy. Lưu {ts, amount, prevTs} từng account → biết chu kỳ + dự đoán lần tới.
function trackBillingCycle(st, rows) {
    if (!st.billingCycle) st.billingCycle = { balances: {}, charges: {} };
    if (!st.billingCycle.charges) st.billingCycle.charges = {};
    const events = [];
    for (const r of rows) {
        const prev = Number(st.billingCycle.balances[r.id] || 0);
        const cur = Number(r.balance_vnd || 0);
        if (prev > 500000 && cur < prev * 0.3) {
            const old = st.billingCycle.charges[r.id] || {};
            st.billingCycle.charges[r.id] = { ts: Date.now(), amount: prev - cur, prevTs: old.ts || null };
            const cycleH = old.ts ? Math.round((Date.now() - old.ts) / 3.6e6) : null;
            events.push({ r, charged: prev - cur, cycleH });
        }
        st.billingCycle.balances[r.id] = cur;
    }
    return events;
}
function lastCharge(st, accId) { return st?.billingCycle?.charges?.[accId] || null; }
// Ngưỡng ƯỚC TÍNH TỰ CẬP NHẬT — không cần khai tay lại khi Meta nâng ngưỡng:
// max( khai tay lúc đầu, CÚ QUÉT lớn nhất từng thấy, số dư đang nợ ).
// CHỐT 31/07 — BỎ HẲN "ngưỡng thanh toán" khỏi mọi tin nhắn:
// Meta đã khoá field này khỏi Marketing API, và mọi cách suy đoán đều sai
// (bằng chứng Mỹ phẩm 3: ngưỡng thật 20.4tr nhưng Meta để nợ leo 35tr mới quét
// — quét theo cron chứ không tức thì, nên số dư CÓ THỂ vượt ngưỡng).
// Chỉ hiển thị số đọc trực tiếp từ Graph API chính thức: balance + spend,
// cộng SỰ KIỆN quét thẻ đo được. Không đoán, không cần ai khai tay.
// Dự đoán lần quét tới (chu kỳ mặc định 24h, có dữ liệu 2 cú thì dùng chu kỳ thật)
function predictNextCharge(st, r) {
    const c = lastCharge(st, r.id);
    if (!c) return null;
    const cycleH = c.prevTs ? Math.min(Math.max((c.ts - c.prevTs) / 3.6e6, 6), 48) : 24;
    const hoursSince = (Date.now() - c.ts) / 3.6e6;
    const hoursLeft = Math.max(cycleH - hoursSince, 0);
    const perHour = (r.spend_3d_avg_vnd || 0) / 24;
    const expected = Math.round((r.balance_vnd || 0) + perHour * hoursLeft);
    return { hoursLeft: Math.round(hoursLeft), expected, cycleH: Math.round(cycleH) };
}

// Cảnh báo 3h: thanh toán fail / TKQC bị khoá khi đang chạy / sắp chạm ngưỡng quét
// (ngưỡng khai tay HOẶC tự học). Anti-spam: mỗi (account, level) 1 tin/ngày.
async function pollBilling() {
    if (!TARGET) return;
    try {
        const b = await fetchBilling();
        const st = loadState();
        const chargeEvents = trackBillingCycle(st, b.rows || []);
        if (inQuietHours()) { saveState(st); return; }

        // Tin "Meta vừa quét tiền" — sự kiện thật (số tiền = đỉnh − đáy, chính xác)
        for (const ev of chargeEvents) {
            await client.sendMessage(TARGET,
                `💳 *Meta VỪA QUÉT TIỀN*\n` +
                `${ev.r.name}: *${vnd(ev.charged)}đ* vào thẻ ${ev.r.card || "?"}` +
                (ev.cycleH ? ` (cách lần trước ~${ev.cycleH}h)` : "") + `.`);
        }

        const alerts = [...(b.alerts || [])];
        // Ping TRƯỚC GIỜ QUÉT: Meta quét ~1 lần/ngày (bất kể ngưỡng — xác nhận từ Billing
        // Hub 30/07) → khi còn ≤2h tới giờ quét thường lệ và dự kiến ≥3tr thì nhắc chuẩn bị thẻ.
        for (const r of b.rows || []) {
            if (r.status !== "ACTIVE") continue;
            const p = predictNextCharge(st, r);
            if (p && p.hoursLeft <= 2 && p.expected >= 3000000) {
                alerts.push({ level: "warning", account: r.name,
                    msg: `Sắp tới giờ Meta trừ thẻ (~${p.hoursLeft}h nữa, chu kỳ ~${p.cycleH}h): dự kiến *~${vnd(p.expected)}đ* vào thẻ ${r.card || "?"} — đảm bảo thẻ đủ tiền.` });
            }
        }
        if (!alerts.length) { saveState(st); log("Poll billing: OK."); return; }
        const today = vnDateStr();
        if (!st.billingAlerted || st.billingAlerted.day !== today) st.billingAlerted = { day: today, keys: [] };
        const fresh = alerts.filter(a => !st.billingAlerted.keys.includes(`${a.level}@${a.account}`));
        if (!fresh.length) { saveState(st); log("Poll billing: đã báo hết trong ngày."); return; }
        let msg = "💳 *CẢNH BÁO THANH TOÁN TKQC*";
        for (const a of fresh) {
            msg += `\n${a.level === "critical" ? "🔴" : "🟠"} *${a.account}*\n   ${a.msg}`;
            st.billingAlerted.keys.push(`${a.level}@${a.account}`);
        }
        await client.sendMessage(TARGET, msg);
        saveState(st);
        log(`Đã gửi ${fresh.length} cảnh báo billing.`);
    } catch (e) { log("Lỗi poll billing:", e.message); }
}
// Digest 8h + lệnh /tkqc: từng TKQC theo form chuẩn, rồi TỔNG THEO ĐUÔI THẺ
// để người cầm thẻ biết cần nạp bao nhiêu.
async function buildBillingDigest() {
    const b = await fetchBilling();
    const rows = (b.rows || []).filter(r => r.spend_3d_avg_vnd > 30000 || r.spend_yesterday_vnd > 100000 || r.balance_vnd > 1000000 || r.status !== "ACTIVE");
    if (!rows.length) return null;
    rows.sort((a, c) => (c.spend_3d_avg_vnd || 0) - (a.spend_3d_avg_vnd || 0));
    let m = "💳 *TKQC & THẺ NGÂN HÀNG*";
    const byCard = {};
    for (const r of rows) {
        const flag = r.status === "ACTIVE" ? "🟢" : (r.status === "UNSETTLED" ? "🔴" : "⛔");
        m += `\n\n${flag} *${r.name}*${r.status !== "ACTIVE" ? ` (${r.status})` : ""}`;
        m += `\n- Số thẻ: ${r.card || "chưa rõ"}`;
        m += `\n- Chi TB 3 ngày: ${vnd(r.spend_3d_avg_vnd)}đ/ngày`;
        const stNow = loadState();
        const c = lastCharge(stNow, r.id);
        const p = predictNextCharge(stNow, r);
        m += `\n- Meta trừ thẻ lần cuối: ${c ? `${vnd(c.amount)}đ · ${new Date(c.ts).toLocaleString("vi-VN", { timeZone: CFG.timezone, hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}` : "đang theo dõi (Meta trừ ~1 lần/ngày)"}`;
        if (p) m += `\n- Dự kiến trừ tiếp: ~${vnd(p.expected)}đ trong ~${p.hoursLeft}h`;
        m += `\n- Số dư hiện tại: ${vnd(r.balance_vnd)}đ (đã tiêu, chờ trừ thẻ)`;
        if (r.card && r.card !== "coupon") {
            const c = (byCard[r.card] = byCard[r.card] || { no: 0, perDay: 0, n: 0 });
            c.no += r.balance_vnd || 0; c.perDay += r.spend_3d_avg_vnd || 0; c.n++;
        }
    }
    const cards = Object.keys(byCard);
    if (cards.length) m += `\n\n${cardSummaryText(byCard)}`;
    return m;
}

function cardSummaryText(byCard) {
    let m = `*──── TỔNG THEO THẺ (để nạp tiền) ────*`;
    for (const card of Object.keys(byCard).sort((a, c) => (byCard[c].no + byCard[c].perDay) - (byCard[a].no + byCard[a].perDay))) {
        const c = byCard[card];
        const suggest = c.no + c.perDay; // nợ hiện tại + 1 ngày chi (chốt 30/07)
        m += `\n💳 *${card}* (${c.n} TKQC)`;
        m += `\n   Nợ chờ quét: ${vnd(c.no)}đ · Chi thật ~${vnd(c.perDay)}đ/ngày`;
        m += `\n   → Cần có sẵn ≥ *${vnd(suggest)}đ* (nợ + 1 ngày chi)`;
    }
    return m;
}

// Bảng NẠP THẺ gọn — thay cho việc hỏi tay từng marketer "tiêu thẻ nào bao nhiêu".
// Số = chi tiêu THẬT từ Meta API (TB 3 ngày), chuẩn hơn số tự khai.
async function buildCardTopupMessage() {
    const b = await fetchBilling();
    const st = loadState();
    const byCard = {};
    const detail = {};
    for (const r of b.rows || []) {
        if (!r.card || r.card === "coupon") continue;
        if ((r.spend_3d_avg_vnd || 0) < 30000 && (r.balance_vnd || 0) < 500000) continue;
        const c = (byCard[r.card] = byCard[r.card] || { no: 0, perDay: 0, n: 0 });
        c.no += r.balance_vnd || 0; c.perDay += r.spend_3d_avg_vnd || 0; c.n++;
        (detail[r.card] = detail[r.card] || []).push(r);
    }
    if (!Object.keys(byCard).length) return "✅ Không có thẻ nào đang chi tiêu đáng kể.";
    // Format chốt 31/07 (CEO duyệt): mỗi thẻ 1 khối, dưới là TỪNG TKQC với
    // Ngưỡng thanh toán (ước tính tự học) / Số dư hiện tại (thuật ngữ Billing Hub
    // = đã tiêu chờ trừ thẻ) / Chi tiêu 1 ngày — kèm icon đầu dòng.
    let m = `💳 *NẠP THẺ HÔM NAY — số chi THẬT từ Meta*`;
    for (const card of Object.keys(byCard).sort((a, c) => (byCard[c].no + byCard[c].perDay) - (byCard[a].no + byCard[a].perDay))) {
        const c = byCard[card];
        m += `\n\n💳 *${card}* — cần số tiền trong ngày hôm nay ≥ *${vnd(c.no + c.perDay)}đ*`;
        // Chỉ hiện số lấy TRỰC TIẾP từ Graph API chính thức (balance + spend) — bỏ
        // dòng "ngưỡng" vì Meta đã khoá field này, mọi cách suy đoán đều sai (31/07).
        for (const r of detail[card].sort((a, x) => (x.spend_3d_avg_vnd || 0) - (a.spend_3d_avg_vnd || 0))) {
            const c = lastCharge(st, r.id);
            m += `\n🏦 *${r.name}*${r.status !== "ACTIVE" ? ` (${r.status}!)` : ""}`;
            m += `\n   💰 Số dư hiện tại: ${vnd(r.balance_vnd)}đ (đã tiêu, chờ trừ thẻ)`;
            m += `\n   🔥 Chi tiêu: ~${vnd(r.spend_3d_avg_vnd)}đ/ngày`;
            if (c) m += `\n   ⏱ Meta trừ thẻ lần cuối: ${vnd(c.amount)}đ · ${new Date(c.ts).toLocaleString("vi-VN", { timeZone: CFG.timezone, hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}`;
        }
    }
    m += `\n\n_Gõ /napthe để xem lại bất cứ lúc nào · /tkqc xem chi tiết từng TKQC_`;
    return m;
}

// ─── B5: cảnh báo SÓT TỪNG TKQC/SHOP ───
// Vòng sync có thể rc=0 (sheet xanh, không ai biết gì) mà vẫn mất sạch số của 1 TKQC —
// bug 06/07 mất ~2000 đơn SA đúng kiểu này. Route trả accounts.failing[] gồm mục
// "empty" (mất sạch dòng) và "drop" (tụt quá nửa + hết dòng mới). Mục co ngót tự nhiên
// hay camp tạm dừng KHÔNG nằm trong đây — route đã lọc, bot không cần đoán lại.
// Tách hàm để test được bằng node -e mà không phải gửi tin thật vào nhóm.
function buildAccountAlert(acc) {
    const bad = acc?.failing || [];
    if (!bad.length) return null;
    const nf = (n) => Number(n).toLocaleString("vi-VN");
    const lines = bad.map((r) => {
        const what = r.kind === "ads" ? "TKQC" : "Shop";
        const prev = r.prev_rows == null ? "?" : nf(r.prev_rows);
        return r.status === "empty"
            ? `• ${what} *${r.name}*: MẤT SẠCH dòng (vòng trước ${prev})`
            : `• ${what} *${r.name}*: còn ${nf(r.rows)} dòng ← ${prev}, không có dòng mới`;
    });
    return `🛑 *SYNC SÓT ${bad.length} MỤC* (vòng vẫn báo OK)\n${lines.join("\n")}\n\n` +
        `Số của các mục trên đang KHÔNG vào sheet/dashboard. Kiểm tra danh sách TKQC trong ` +
        `config sync + log daily trên Mac.\n_Đã soi ${acc.checked} mục lúc ${acc.run_ts}_`;
}

// Khoá chống lặp: cùng bộ mục lỗi thì chỉ bắn 1 lần, có mục mới thì bắn lại ngay.
function accountAlertKey(acc) {
    return "acct@" + (acc?.failing || []).map((r) => `${r.kind}:${r.name}:${r.status}`).sort().join(",");
}

// ─── Cảnh báo SYNC CHẾT CÂM: sheet fail hoặc im lặng >4h (sự cố kinh điển 22-29/6) ───
async function pollSyncHealth() {
    if (!TARGET) return;
    try {
        if (inQuietHours()) return;
        const res = await fetch(CFG.syncHealthUrl, { headers: { "cache-control": "no-store" } });
        if (!res.ok) throw new Error(`sync-health HTTP ${res.status}`);
        const h = await res.json();
        const st = loadState();

        // Mức TỪNG TKQC/shop (B5) — xét trước và độc lập với mức vòng-chạy: vòng có thể
        // rc=0 mà vẫn sót mục, nên không được nằm sau `return` của nhánh no-data.
        if (h.accounts) {
            const key = accountAlertKey(h.accounts);
            const accMsg = buildAccountAlert(h.accounts);
            // 04/08: ĐÃ GỠ hai van chống dội (`accountAlertMinHours` 6h + `accountClearPolls` 2
            // vòng). Chúng dựng lên vì bug X1 Smart Stop cắt sale_order ở độ sâu NGẪU NHIÊN mỗi
            // vòng → mục lỗi hết rồi lại có, ping-pong cả ngày. X1 sửa xong (commit 2ca9727:
            // append + dựng lại từ raw, số đơn không thể tụt) nên một vòng sót giờ là tín hiệu
            // THẬT và một vòng sạch cũng là tín hiệu THẬT — bịt lại là bịt đúng cái cần bắt.
            // Chỉ giữ khoá chống lặp theo `key`: cùng bộ mục lỗi thì không nhắc lại.
            if (accMsg) {
                if (st.lastAccountAlert !== key) {
                    await client.sendMessage(TARGET, accMsg);
                    st.lastAccountAlert = key;
                    st.lastAccountAlertAt = Date.now();
                    log(`Đã gửi cảnh báo sót ${h.accounts.failing.length} mục.`);
                }
            } else if (st.lastAccountAlert) {
                await client.sendMessage(TARGET,
                    `✅ Không còn TKQC/shop bị sót (soi ${h.accounts.checked} mục, vòng ${h.accounts.run_ts}).`);
                st.lastAccountAlert = null;
                log("Đã gửi tin sót-đã-hết.");
            }
            saveState(st);
        }

        if (h.status === "no-data") return;
        let msg = null;
        if (h.status === "fail") {
            const key = `fail@${h.last_run_ts}`;
            if (st.lastHealthAlert !== key) {
                msg = `🛑 *SYNC BÁO CÁO LỖI*\nVòng ${h.last_run_ts} fail (sync_rc=${h.sync_rc}, format_rc=${h.format_rc}).\nSheet có thể đang kẹt số cũ — kiểm tra log daily trên Mac.\n_${String(h.detail || "").slice(0, 200)}_`;
                st.lastHealthAlert = key;
            }
        } else if (Number(h.age_minutes) > 240) {
            const key = `stale@${new Date().toISOString().slice(0, 13)}`; // tối đa 1 tin/giờ
            if (st.lastHealthAlert !== key) {
                msg = `🛑 *SYNC IM LẶNG ${Math.round(h.age_minutes / 60)}h*\nLần chạy cuối: ${h.last_run_ts}. Bình thường chạy mỗi giờ.\nMac có thể tắt/treo hoặc launchd chết — sheet đang kẹt số cũ.`;
                st.lastHealthAlert = key;
            }
        } else if (st.lastHealthAlert && String(st.lastHealthAlert).startsWith("fail@") && h.status === "ok") {
            msg = `✅ Sync báo cáo đã CHẠY LẠI BÌNH THƯỜNG (vòng ${h.last_run_ts}).`;
            st.lastHealthAlert = null;
        }
        if (msg) { await client.sendMessage(TARGET, msg); saveState(st); log("Đã gửi cảnh báo sync-health."); }
        else { saveState(st); log("Poll sync-health: OK."); }
    } catch (e) { log("Lỗi poll sync-health:", e.message); }
}

// Lệnh thủ công trong nhóm: gõ "/kho" → bot trả danh sách sắp hết hiện tại.
// Lệnh hoạt động ở MỌI nhóm mà tài khoản WhatsApp này tham gia (không chỉ nhóm bot):
// chị giữ thẻ gõ /napthe ngay trong nhóm làm việc là có bảng nạp tiền — khỏi hỏi tay.
// (message = người khác gõ; message_create = chính chủ tài khoản gõ)
async function handleCommand(m) {
    try {
        const chat = m.fromMe ? m.to : m.from;
        if (!String(chat).endsWith("@g.us")) return;   // chỉ trong nhóm
        const body = (m.body || "").trim();
        if (/^\/kho\b/i.test(body)) {
            if (chat !== TARGET) return;               // tồn kho: giữ riêng nhóm bot
            const inv = await fetchInventory();
            const items = inv.skuMatrix.map(r => ({ r, c: classify(r) })).filter(x => x.c);
            const out = items.length ? buildMessage(items, inv.asOf && inv.asOf.label) : "✅ Hiện không có SKU nào dưới ngưỡng cảnh báo.";
            await client.sendMessage(chat, out);
        } else if (/^\/tkqc\b/i.test(body) && CFG.billingUrl) {
            const out = (await buildBillingDigest()) || "✅ Không có TKQC nào đang tiêu/nợ đáng kể.";
            await client.sendMessage(chat, out);
            log(`/tkqc từ nhóm ${chat}`);
        } else if (/^\/napthe\b/i.test(body) && CFG.billingUrl) {
            await client.sendMessage(chat, await buildCardTopupMessage());
            log(`/napthe từ nhóm ${chat}`);           // id nhóm ghi ở đây — dùng để bật lịch tự động
        }
    } catch (e) { log("Lỗi lệnh nhóm:", e.message); }
}
client.on("message", handleCommand);
client.on("message_create", (m) => { if (m.fromMe) handleCommand(m); });

log("Khởi động bot TALPHA…");
client.initialize();

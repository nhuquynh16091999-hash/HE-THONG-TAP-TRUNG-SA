// ═══════════════════════════════════════════════════════════════════
// TALPHA — Bot báo cáo & cảnh báo ADS vào nhóm Zalo
// ───────────────────────────────────────────────────────────────────
// - 08:30: tin TỔNG TEAM + từng marketer, số HÔM QUA (đã chốt ngày).
// - 13:30 & 22:00: TỔNG TEAM + từng marketer, số ĐANG CHẠY hôm nay.
// - Mỗi adsPollMinutes (180'): chi tiêu cao bất thường / campaign đốt tiền 0 tin nhắn.
// - Không gửi 23h–7h.
// Chỉ tin ADS (Sỹ Anh chốt 15/09/2026) — không tồn kho, không thẻ/TKQC, không lệnh trong
// nhóm như bot WhatsApp. Nguồn số: API dashboard cùng máy (sheet-report = file TỔNG TEAM,
// realtime = Meta + POS live, ads-alerts = BigQuery, sync-health = tuổi số).
// Gửi bằng nick Zalo PHỤ (zca-js) — ghép bằng `node pair.js`, xem README.md.
//
// Chạy: node bot.js                                  (dịch vụ — pm2 talpha-zalo-alerts)
//       node bot.js --report [YYYY-MM-DD]            (gửi ngay báo cáo ngày đó — mặc định hôm qua)
//       node bot.js --intraday-now                   (gửi ngay báo cáo giữa ngày)
//       node bot.js --ads-now                        (gửi ngay cảnh báo ads nếu có)
//       thêm --dry-run vào bất kỳ lệnh nào: IN tin ra màn hình, không đăng nhập, không gửi.
// ═══════════════════════════════════════════════════════════════════
const fs = require("fs");
const path = require("path");
const CFG = require("./config");
const { buildMarketerReports } = require("./daily_report");
const { buildAdsAlert } = require("./ads_alerts");
const { slotAction, toMin } = require("./schedule");
const { toZalo, chiaTin } = require("./zalo_text");

const DIR = __dirname;
const STATE_FILE = path.join(DIR, "state.json");
const ARGS = process.argv.slice(2);
const DRY = ARGS.includes("--dry-run");
const DR = CFG.dailyReport || {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString(), ...a);

function argAfter(flag) {
    const i = ARGS.indexOf(flag);
    const v = i >= 0 ? ARGS[i + 1] : "";
    return v && !v.startsWith("--") ? v : "";
}

// ─── State: ghi MỘT thay đổi nhỏ, đọc lại file ngay trước khi ghi ───
// Các vòng rà ôm state qua nhiều await mạng; ai ghi sau mà dùng bản cũ là xoá khoá của
// vòng kia — mốc đã gửi bị quên và vòng sau bắn lại tin thứ hai vào nhóm.
function loadState() {
    try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { return {}; }
}
function markState(mut) {
    const st = loadState();
    mut(st);
    try { fs.writeFileSync(STATE_FILE, JSON.stringify(st, null, 2)); }
    catch (e) { log("Lỗi ghi state:", e.message); }
    return st;
}

// ─── Giờ Việt Nam. hourCycle h23 BẮT BUỘC: hour12:false trả "24" lúc nửa đêm, báo cáo 8h
// của bot WhatsApp từng bắn lúc 0h05 vì đúng chuyện này. ───
const vnDateStr = () => new Date().toLocaleDateString("sv-SE", { timeZone: CFG.timezone });   // YYYY-MM-DD
const vnHHMM = () => new Date().toLocaleString("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: CFG.timezone });
function homQua(today) {
    const d = new Date(today + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
}
function inQuietHours() {
    const h = toMin(vnHHMM()) / 60;
    const { quietStartHour: a, quietEndHour: b } = CFG;
    if (a == null || b == null || a === b) return false;
    return a < b ? (h >= a && h < b) : (h >= a || h < b);   // qua nửa đêm
}

const DAILY_AT = /^\d{1,2}:\d{2}$/.test(String(DR.at || "")) ? DR.at : "08:30";
const INTRADAY_SLOTS = (DR.intradaySlots || []).map((x) => String(x).trim()).filter((x) => /^\d{1,2}:\d{2}$/.test(x));
const slotLabel = (hhmm) => { const t = vnDateStr(); return `HÔM NAY ${t.slice(8, 10)}/${t.slice(5, 7)} · ${hhmm}`; };

// Tuổi của số trong Sheet (/api/talpha/sync-health). Hỏng thì null → tin gửi không kèm
// cảnh báo: thà thiếu cảnh báo còn hơn chặn mất báo cáo.
async function fetchStale() {
    if (!CFG.syncHealthUrl) return null;
    try {
        const res = await fetch(CFG.syncHealthUrl, { headers: { "cache-control": "no-store" } });
        if (!res.ok) return null;
        const j = await res.json();
        const okAge = j.last_ok_age_minutes == null ? null : Number(j.last_ok_age_minutes);
        if (!Number.isFinite(okAge)) return null;
        return { okAge, limit: Number(DR.staleWarnMinutes || 120), lastOkTs: Date.now() - okAge * 60000 };
    } catch (e) { log("Đọc tuổi sync lỗi:", e.message); return null; }
}

// ─── Gửi ───
// Đăng nhập lười: chỉ khi có tin cần gửi. Gửi hỏng thì bỏ phiên trong bộ nhớ, đăng nhập lại
// một lần rồi gửi lại — phiên web của Zalo hay rớt khi Zalo đổi máy chủ.
let zalo = null;           // require("./zalo") muộn: --dry-run chạy được cả khi chưa cài zca-js
let api = null;
let nhomDich = null;

async function ketNoi() {
    if (!zalo) zalo = require("./zalo");
    if (!api) {
        api = await zalo.dangNhap();
        log("Đã đăng nhập Zalo.");
    }
    return api;
}

async function guiMot(text) {
    if (DRY) {
        const phan = chiaTin(toZalo(text), CFG.maxChars || 1800);
        phan.forEach((p, i) => {
            const dam = p.styles.filter((s) => s.st === "b").map((s) => p.msg.slice(s.start, s.start + s.len));
            console.log(`\n──── tin${phan.length > 1 ? ` (phần ${i + 1}/${phan.length})` : ""} · ${p.msg.length} ký tự ────\n${p.msg}`);
            if (dam.length) console.log(`   [chữ đậm: ${dam.join(" | ")}]`);
        });
        return phan.length;
    }
    if (!nhomDich) throw new Error("chưa chọn nhóm nhận tin — chạy `node pair.js --chon <id nhóm>`");
    const opts = { maxChars: CFG.maxChars, sendGapMs: CFG.sendGapMs };
    // ketNoi() TRƯỚC rồi mới đọc zalo.guiNhom: viết gộp `zalo.guiNhom(await ketNoi(), …)`
    // thì JS đọc zalo.guiNhom trước khi ketNoi() kịp nạp module.
    let a = await ketNoi();
    try {
        return await zalo.guiNhom(a, nhomDich.id, text, opts);
    } catch (e) {
        log("Gửi lỗi, đăng nhập lại rồi thử một lần nữa:", e.message);
        api = null;
        a = await ketNoi();
        return zalo.guiNhom(a, nhomDich.id, text, opts);
    }
}

// Mọi lần gửi xếp MỘT hàng: cảnh báo ads rơi đúng lúc loạt báo cáo 13:30 đang gửi thì
// đợi loạt đó xong, không chen vào giữa tin của hai marketer.
let hangGui = Promise.resolve();
function lanLuot(fn) {
    const p = hangGui.then(fn);
    hangGui = p.catch(() => {});
    return p;
}

/** Gửi lần lượt. Trả số tin đã gửi được; hỏng giữa chừng thì dừng và ném lỗi kèm số đó. */
async function guiLoat(texts) {
    let da = 0;
    for (const t of texts.filter(Boolean)) {
        if (da > 0 && !DRY) await sleep(CFG.sendGapMs || 4000);
        try { await guiMot(t); }
        catch (e) { e.daGui = da; throw e; }
        da++;
    }
    return da;
}

function guiBaoCao(dateStr, opts) {
    return lanLuot(async () => {
        const { teamMessage, messages } = await buildMarketerReports(DR, dateStr,
            { ...opts, stale: await fetchStale(), log });
        const n = await guiLoat([teamMessage, ...messages]);
        return { n, marketers: messages.length };
    });
}

// ─── Mốc báo cáo: 08:30 (hôm qua) và các mốc giữa ngày (hôm nay) ───
// Rà theo vòng 5' chứ không hẹn giờ: pm2 restart lúc 13:29 là mất sạch timer. Đổi lại vòng
// rà tự lo hai việc: chống bắn lại (state ghi TỪNG mốc) và chống bắn MUỘN (cửa sổ bù —
// bot bật lại lúc 21h thì bỏ mốc 13:30 chứ không gửi tin dán nhãn sai giờ).
// Dựng tin hỏng (Sheet chưa có dòng, dashboard lỗi) → CHƯA đánh dấu, vòng sau thử lại
// trong cửa sổ. Gửi được ít nhất một tin rồi mới hỏng → vẫn đánh dấu, để không gửi lặp
// cả loạt vào nhóm.
async function chayMoc(khoa, moc, cuaSo, lamViec) {
    const today = vnDateStr();
    const act = slotAction(moc, vnHHMM(), (loadState().moc || {})[khoa], today, cuaSo);
    if (!act) return;
    const danhDau = () => markState((s) => { (s.moc = s.moc || {})[khoa] = today; });
    if (act === "skip") { danhDau(); log(`Bỏ mốc ${moc} hôm nay (quá cửa sổ ${cuaSo}', bây giờ ${vnHHMM()}).`); return; }
    if (inQuietHours()) return;
    try {
        const r = await lamViec();
        danhDau();
        log(`Đã gửi mốc ${moc}: TỔNG TEAM + ${r.marketers} marketer (${r.n} tin).`);
    } catch (e) {
        if (e.daGui > 0) danhDau();
        log(`Mốc ${moc} lỗi${e.daGui > 0 ? ` sau ${e.daGui} tin — không gửi lại` : " — vòng sau thử lại"}:`, e.message);
    }
}

async function ratMoc() {
    await chayMoc("sang", DAILY_AT, Number(DR.atCatchUpMinutes || 210),
        () => guiBaoCao(homQua(vnDateStr()), {}));
    for (const slot of INTRADAY_SLOTS) {
        await chayMoc(slot, slot, Number(DR.intradayCatchUpMinutes || 60),
            () => guiBaoCao(vnDateStr(), { intraday: true, label: slotLabel(slot) }));
    }
}

// ─── Cảnh báo ads ───
async function pollAds({ boQuaGioYen = false } = {}) {
    if (!CFG.adsAlertsUrl) return;
    if (!boQuaGioYen && inQuietHours()) return;
    try {
        const res = await fetch(CFG.adsAlertsUrl, { headers: { "cache-control": "no-store" } });
        if (!res.ok) throw new Error(`ads-alerts HTTP ${res.status}`);
        const a = await res.json();
        if (a.error) throw new Error(a.error);
        const { text, state } = buildAdsAlert(a, loadState().ads, CFG);
        if (!text) { log("Poll ads: không có cảnh báo mới."); return; }
        await lanLuot(() => guiMot(text));
        if (!DRY) markState((s) => { s.ads = state; });   // chỉ nhớ "đã báo" khi gửi được thật
        log("Đã gửi cảnh báo ads.");
    } catch (e) { log("Lỗi poll ads:", e.message); }
}

// ─── Giữ phiên ───
async function giuPhien() {
    if (!api) return;
    try { await api.keepAlive(); zalo.luuPhien(api); }
    catch (e) { log("keepAlive lỗi — lần gửi tới sẽ đăng nhập lại:", e.message); api = null; }
}

async function gioiThieuNeuMoi() {
    if ((loadState().gioiThieu || {})[nhomDich.id]) return;
    await lanLuot(() => guiMot(
        `🤖 Bot TALPHA gửi báo cáo ads vào nhóm này:\n` +
        `• ${DAILY_AT}: số ads HÔM QUA — TỔNG TEAM + từng marketer\n` +
        (INTRADAY_SLOTS.length ? `• ${INTRADAY_SLOTS.join(" & ")}: số ads ĐANG CHẠY hôm nay\n` : "") +
        `• Mỗi ${Math.round((CFG.adsPollMinutes || 180) / 60)} giờ: cảnh báo camp đốt tiền không ra tin nhắn, chi tiêu cao bất thường\n` +
        `Không gửi từ ${CFG.quietStartHour}h đến ${CFG.quietEndHour}h.`));
    markState((s) => { (s.gioiThieu = s.gioiThieu || {})[nhomDich.id] = new Date().toISOString(); });
    log("Đã gửi tin giới thiệu vào nhóm.");
}

async function dichVu() {
    log(`Dashboard base: ${CFG.dashboardBaseUrl}${process.env.TALPHA_DASHBOARD_URL ? " (env TALPHA_DASHBOARD_URL)" : ""}`);
    zalo = require("./zalo");
    // Chưa ghép/chưa chọn nhóm/đăng nhập hỏng: KHÔNG thoát — pm2 sẽ khởi động lại liên tục
    // và che mất lỗi thật. Đứng chờ, 10' thử lại một lần.
    for (;;) {
        nhomDich = zalo.docNhomDich();
        if (!nhomDich) log("Chưa chọn nhóm nhận tin — chạy `node pair.js` rồi `node pair.js --chon <id>`.");
        else {
            try { await ketNoi(); break; }
            catch (e) { log("Đăng nhập Zalo lỗi:", e.message); }
        }
        await sleep(10 * 60 * 1000);
    }
    log(`Gửi vào nhóm "${nhomDich.name}" (${nhomDich.id}). Báo cáo ${DAILY_AT}`
        + (INTRADAY_SLOTS.length ? ` + ${INTRADAY_SLOTS.join(" + ")}` : "")
        + ` · cảnh báo ads mỗi ${CFG.adsPollMinutes || 180}'.`);

    try { await gioiThieuNeuMoi(); } catch (e) { log("Tin giới thiệu lỗi:", e.message); }

    // Rà mốc tuần tự, không để hai vòng chồng nhau khi một vòng gửi lâu.
    let dangRa = false;
    const vongMoc = async () => {
        if (dangRa) return;
        dangRa = true;
        try { await ratMoc(); } finally { dangRa = false; }
    };
    await vongMoc();
    setInterval(vongMoc, 5 * 60 * 1000);
    await pollAds();
    setInterval(pollAds, (CFG.adsPollMinutes || 180) * 60 * 1000);
    setInterval(giuPhien, 60 * 60 * 1000);
}

async function main() {
    if (ARGS.includes("--report")) {
        const ngay = /^\d{4}-\d{2}-\d{2}$/.test(argAfter("--report")) ? argAfter("--report") : homQua(vnDateStr());
        if (!DRY) nhomDich = require("./zalo").docNhomDich();
        const r = await guiBaoCao(ngay, {});
        log(`${DRY ? "In thử" : "Đã gửi"} báo cáo ngày ${ngay}: TỔNG TEAM + ${r.marketers} marketer.`);
        return true;
    }
    if (ARGS.includes("--intraday-now")) {
        if (!DRY) nhomDich = require("./zalo").docNhomDich();
        const r = await guiBaoCao(vnDateStr(), { intraday: true, label: slotLabel(vnHHMM()) });
        log(`${DRY ? "In thử" : "Đã gửi"} báo cáo giữa ngày: TỔNG TEAM + ${r.marketers} marketer.`);
        return true;
    }
    if (ARGS.includes("--ads-now")) {
        if (!DRY) nhomDich = require("./zalo").docNhomDich();
        await pollAds({ boQuaGioYen: true });
        return true;
    }
    await dichVu();
    return false;
}

main()
    .then((motLan) => { if (motLan) setTimeout(() => process.exit(0), 1000); })
    .catch((e) => { log("LỖI:", e.message); process.exit(1); });

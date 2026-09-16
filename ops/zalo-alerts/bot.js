// ═══════════════════════════════════════════════════════════════════
// TALPHA — Bot báo cáo ADS vào nhóm Zalo
// ───────────────────────────────────────────────────────────────────
// Sỹ Anh chốt 15/09/2026: tự động CHỈ gửi mốc 8h30, còn lại gửi khi có người yêu cầu.
// - 08:30: tin TỔNG TEAM + từng marketer, số HÔM QUA (đã chốt ngày).
// - Lệnh gõ trong nhóm (commands.js): /baocao [homqua | dd/mm] [tên | team] · /canhbao · /bot
// - Mốc giữa ngày (dailyReport.intradaySlots) và cảnh báo ads theo chu kỳ (adsPollMinutes)
//   vẫn còn trong code nhưng đang TẮT ở config.json — bật lại là điền mốc / số phút.
// Chỉ tin ADS — không tồn kho, không thẻ/TKQC như bot WhatsApp. Nguồn số: API dashboard
// cùng máy (sheet-report = file TỔNG TEAM, realtime = Meta + POS live, ads-alerts =
// BigQuery, sync-health = tuổi số). Gửi bằng nick Zalo PHỤ (zca-js) — xem README.md.
//
// Chạy: node bot.js                          (dịch vụ — pm2 talpha-zalo-alerts)
//       node bot.js --lenh "/baocao homqua"  (làm như có người gõ lệnh đó trong nhóm)
//       node bot.js --report [YYYY-MM-DD]    (gửi ngay báo cáo ngày đó — mặc định hôm qua)
//       thêm --dry-run: IN tin ra màn hình, không đăng nhập, không gửi.
// ═══════════════════════════════════════════════════════════════════
const fs = require("fs");
const path = require("path");
const CFG = require("./config");
const { buildMarketerReports } = require("./daily_report");
const { buildAdsAlert, buildAdsStatus } = require("./ads_alerts");
const { docLenh, huongDan, homQua } = require("./commands");
const { slotAction, toMin } = require("./schedule");
const { toZalo, chiaTin } = require("./zalo_text");
const { MARKETERS, DISPLAY } = require("./rules");

const DIR = __dirname;
const STATE_FILE = path.join(DIR, "state.json");
const ARGS = process.argv.slice(2);
const DRY = ARGS.includes("--dry-run");
const DR = CFG.dailyReport || {};
const ADS_POLL = Number(CFG.adsPollMinutes) || 0;          // 0 = tắt cảnh báo theo chu kỳ
const NGUOI = Object.keys(MARKETERS).map((key) => ({ key, ten: DISPLAY[key] }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString(), ...a);
const ddmm = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : String(d || ""));

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

async function fetchAds() {
    if (!CFG.adsAlertsUrl) throw new Error("thiếu adsAlertsUrl trong config");
    const res = await fetch(CFG.adsAlertsUrl, { headers: { "cache-control": "no-store" } });
    if (!res.ok) throw new Error(`ads-alerts HTTP ${res.status}`);
    const a = await res.json();
    if (a.error) throw new Error(a.error);
    return a;
}

// ─── Kết nối + gửi ───
// Đăng nhập lười: chỉ khi có tin cần gửi. Gửi hỏng thì bỏ phiên trong bộ nhớ, đăng nhập lại
// một lần rồi gửi lại — phiên web của Zalo hay rớt khi Zalo đổi máy chủ.
let zalo = null;           // require("./zalo") muộn: --dry-run chạy được cả khi chưa cài zca-js
let api = null;
let nhomDich = null;
let dichVu = false;        // chạy dịch vụ thì mỗi lần đăng nhập đều bật lại bộ nhận lệnh

async function ketNoi() {
    if (!zalo) zalo = require("./zalo");
    if (!api) {
        api = await zalo.dangNhap();
        log("Đã đăng nhập Zalo.");
        if (dichVu) batDauNghe(api);
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

// Mọi lần gửi xếp MỘT hàng: hai người gõ lệnh cùng lúc, hay lệnh rơi đúng lúc tin 8h30
// đang gửi, thì loạt sau đợi loạt trước — không xen tin của hai loạt vào nhau.
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

async function dungBaoCao(ngay, homNay, label) {
    return buildMarketerReports(DR, ngay,
        { intraday: homNay, label: label || (homNay ? slotLabel(vnHHMM()) : undefined), stale: await fetchStale(), log });
}

// MỘT tin cho mốc tự gửi (Sỹ Anh chốt 16/09/2026: trước đây 1 tin tổng + 1 tin mỗi
// marketer = sáu tin liền, đọc trong nhóm thành loạn). Chi tiết campaign từng người vẫn
// còn, lấy bằng /baocao <tên>.
function guiBaoCao(ngay, { homNay = false, label } = {}) {
    return lanLuot(async () => {
        const r = await dungBaoCao(ngay, homNay, label);
        const n = await guiLoat([r.tinGop]);
        return { n, marketers: r.nguoi.length };
    });
}

// ─── Lệnh trong nhóm ───
const lanCuoi = new Map();     // chữ lệnh → lúc nhận; cùng lệnh trong 60 giây thì bỏ (bấm gửi hai lần)

async function lamLenh(text, ai = "dòng lệnh") {
    const lenh = docLenh(text, { today: vnDateStr(), nguoi: NGUOI });
    if (!lenh) return false;
    const khoa = String(text).trim().toLowerCase();
    if (Date.now() - (lanCuoi.get(khoa) || 0) < 60000) { log(`Bỏ lệnh lặp "${khoa}" từ ${ai}.`); return true; }
    lanCuoi.set(khoa, Date.now());
    log(`Lệnh "${String(text).trim()}" từ ${ai}.`);

    await lanLuot(async () => {
        try {
            if (lenh.loi) { await guiMot(`⚠️ ${lenh.loi}`); return; }
            if (lenh.lenh === "trogiup") { await guiMot(huongDan({ at: DAILY_AT, nguoi: NGUOI })); return; }
            if (lenh.lenh === "canhbao") { await guiMot(buildAdsStatus(await fetchAds(), CFG)); return; }

            const r = await dungBaoCao(lenh.ngay, lenh.homNay);
            let tin;
            if (lenh.loc === "team") tin = [r.teamMessage];
            else if (lenh.loc) {
                const i = r.nguoi.indexOf(lenh.loc);
                tin = [i >= 0 ? r.messages[i]
                    : `ℹ️ ${lenh.loc} chưa có số ${lenh.homNay ? "hôm nay" : "ngày " + ddmm(lenh.ngay)} — 0đ ads, 0 đơn.`];
            } else tin = [r.tinGop];   // không lọc người → đúng MỘT tin, như mốc tự gửi
            log(`Đã trả lệnh: ${await guiLoat(tin)} tin.`);
        } catch (e) {
            log("Lệnh lỗi:", e.message);
            if (e.daGui > 0) return;                   // gửi được một phần rồi — không chen tin lỗi vào giữa
            const bao = /Sheet chưa có dòng/.test(e.message)
                ? `⚠️ Sheet chưa có số ngày ${ddmm(lenh.ngay)} — vòng ghi Sheet chạy mỗi giờ phút 20, lát nữa gõ lại.`
                : `⚠️ Chưa lấy được số lúc này (${e.message}). Lát nữa gõ lại.`;
            try { await guiMot(bao); } catch (e2) { log("Không gửi được tin báo lỗi:", e2.message); }
        }
    });
    return true;
}

// Chỉ nghe ĐÚNG nhóm nhận tin. Nick phụ còn ở các nhóm COD có người của đối tác — gõ
// /baocao ở đó mà bot trả số doanh thu là lộ số ra ngoài.
function xuLyTin(msg) {
    if (!nhomDich || !zalo || msg.type !== zalo.ThreadType.Group || msg.threadId !== nhomDich.id) return;
    const text = typeof msg.data.content === "string" ? msg.data.content : "";
    if (!text.trim().startsWith("/")) return;
    lamLenh(text, msg.data.dName || msg.data.uidFrom).catch((e) => log("Lỗi xử lý lệnh:", e.message));
}

// Bộ nhận lệnh gắn với MỘT phiên đăng nhập. Đăng nhập lại là thay bộ mới. Bộ nghe bị Zalo
// đóng hẳn (thường do mở Zalo Web/PC bằng nick phụ) thì đợi rồi đăng nhập lại, đợi dài dần
// để không giành phiên qua lại với người đang dùng Zalo Web.
const DOI_DAU = 10 * 60 * 1000, DOI_TOI_DA = 2 * 60 * 60 * 1000;
let nghe = null;
let doiHoiPhuc = DOI_DAU;

function batDauNghe(a) {
    const cu = nghe;
    nghe = null;
    if (cu) { try { cu.stop(); } catch { /* bộ cũ đã chết */ } }
    const moi = zalo.batNghe(a, {
        onMessage: xuLyTin,
        log,
        onClosed: (l, code, reason) => {
            if (l !== nghe) return;                     // bộ cũ vừa bị thay — không phải sự cố
            nghe = null;
            api = null;
            const doi = doiHoiPhuc;
            doiHoiPhuc = Math.min(doiHoiPhuc * 2, DOI_TOI_DA);
            log(`Bộ nhận lệnh bị đóng (mã ${code}${reason ? ", " + reason : ""}) — thường do mở Zalo Web/PC bằng nick phụ. Đăng nhập lại sau ${Math.round(doi / 60000)}'.`);
            setTimeout(() => { if (!api) ketNoi().catch((e) => log("Đăng nhập lại lỗi:", e.message)); }, doi);
        },
    });
    moi.on("connected", () => { doiHoiPhuc = DOI_DAU; });
    nghe = moi;
}

// ─── Mốc tự gửi: 08:30 (hôm qua), và các mốc giữa ngày nếu bật lại ───
// Rà theo vòng 5' chứ không hẹn giờ: pm2 restart lúc 08:29 là mất sạch timer. Đổi lại vòng
// rà tự lo hai việc: chống bắn lại (state ghi TỪNG mốc) và chống bắn MUỘN (cửa sổ bù).
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
        log(`Đã gửi mốc ${moc}: 1 tin gộp, ${r.marketers} marketer trong bảng.`);
    } catch (e) {
        if (e.daGui > 0) danhDau();
        log(`Mốc ${moc} lỗi${e.daGui > 0 ? ` sau ${e.daGui} tin — không gửi lại` : " — vòng sau thử lại"}:`, e.message);
    }
}

async function ratMoc() {
    await chayMoc("sang", DAILY_AT, Number(DR.atCatchUpMinutes || 210),
        () => guiBaoCao(homQua(vnDateStr())));
    for (const slot of INTRADAY_SLOTS) {
        await chayMoc(slot, slot, Number(DR.intradayCatchUpMinutes || 60),
            () => guiBaoCao(vnDateStr(), { homNay: true, label: slotLabel(slot) }));
    }
}

// Cảnh báo ads theo chu kỳ — chỉ chạy khi adsPollMinutes > 0.
async function pollAds() {
    if (inQuietHours()) return;
    try {
        const a = await fetchAds();
        const { text, state } = buildAdsAlert(a, loadState().ads, CFG);
        if (!text) { log("Poll ads: không có cảnh báo mới."); return; }
        await lanLuot(() => guiMot(text));
        if (!DRY) markState((s) => { s.ads = state; });   // chỉ nhớ "đã báo" khi gửi được thật
        log("Đã gửi cảnh báo ads.");
    } catch (e) { log("Lỗi poll ads:", e.message); }
}

async function giuPhien() {
    if (!api) return;
    try { await api.keepAlive(); zalo.luuPhien(api); }
    catch (e) { log("keepAlive lỗi — lần gửi tới sẽ đăng nhập lại:", e.message); api = null; }
}

async function gioiThieuNeuMoi() {
    if ((loadState().gioiThieu || {})[nhomDich.id]) return;
    await lanLuot(() => guiMot(huongDan({ at: DAILY_AT, nguoi: NGUOI })));
    markState((s) => { (s.gioiThieu = s.gioiThieu || {})[nhomDich.id] = new Date().toISOString(); });
    log("Đã gửi tin giới thiệu vào nhóm.");
}

async function chayDichVu() {
    dichVu = true;
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
    log(`Nhóm "${nhomDich.name}" (${nhomDich.id}) · tự gửi ${[DAILY_AT, ...INTRADAY_SLOTS].join(" + ")}`
        + (ADS_POLL > 0 ? ` · cảnh báo ads mỗi ${ADS_POLL}'` : " · cảnh báo ads chỉ khi gõ /canhbao")
        + " · nghe lệnh trong nhóm.");

    try { await gioiThieuNeuMoi(); } catch (e) { log("Tin giới thiệu lỗi:", e.message); }

    let dangRa = false;                 // không để hai vòng rà chồng nhau khi một vòng gửi lâu
    const vongMoc = async () => {
        if (dangRa) return;
        dangRa = true;
        try { await ratMoc(); } finally { dangRa = false; }
    };
    await vongMoc();
    setInterval(vongMoc, 5 * 60 * 1000);
    if (ADS_POLL > 0) {
        await pollAds();
        setInterval(pollAds, ADS_POLL * 60 * 1000);
    }
    setInterval(giuPhien, 60 * 60 * 1000);
}

async function main() {
    const lenh = argAfter("--lenh");
    if (lenh || ARGS.includes("--report")) {
        if (!DRY) nhomDich = require("./zalo").docNhomDich();
        if (lenh) {
            if (!(await lamLenh(lenh))) log(`"${lenh}" không phải lệnh của bot.`);
        } else {
            const ngay = /^\d{4}-\d{2}-\d{2}$/.test(argAfter("--report")) ? argAfter("--report") : homQua(vnDateStr());
            const r = await guiBaoCao(ngay);
            log(`${DRY ? "In thử" : "Đã gửi"} báo cáo ngày ${ngay}: 1 tin gộp, ${r.marketers} marketer trong bảng.`);
        }
        return true;
    }
    await chayDichVu();
    return false;
}

main()
    .then((motLan) => { if (motLan) setTimeout(() => process.exit(0), 1000); })
    .catch((e) => { log("LỖI:", e.message); process.exit(1); });

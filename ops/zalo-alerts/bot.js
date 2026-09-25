// ═══════════════════════════════════════════════════════════════════
// TALPHA — Bot báo cáo ADS vào nhóm Zalo
// ───────────────────────────────────────────────────────────────────
// Sỹ Anh chốt 15/09/2026: tự động CHỈ gửi mốc 8h30, còn lại gửi khi có người yêu cầu.
// - 08:30: tin TỔNG TEAM + từng marketer, số HÔM QUA (đã chốt ngày).
// - Lệnh gõ trong nhóm (commands.js): /baocao [homqua | dd/mm] [tên | team] · /canhbao · /bot
// - Mốc giữa ngày (dailyReport.intradaySlots): 20:00 + 22:00, số HÔM NAY đang chạy.
// - Sync đang đứng thì tin vẫn gửi ĐÚNG KHUNG GIỜ (mang dòng "SỐ CHƯA ĐỦ") và bot NHỚ số
//   đã báo; vòng sync nào lấy đủ số thì bot tự gửi thêm MỘT tin ĐÍNH CHÍNH nêu rõ chỗ lệch
//   (Sỹ Anh chốt 22/09/2026). Hạn chờ: dailyReport.dinhChinhHanGio giờ, tin giữa ngày chỉ
//   tới hết ngày đó. Lịch chờ nằm trong state.json → restart không mất.
// - Cảnh báo ads theo chu kỳ (adsPollMinutes) còn trong code nhưng đang TẮT ở config.json.
// - VẬN ĐƠN (Sỹ Anh chốt 25/09/2026): 08:00 gửi "Vận đơn cần xử lý" vào một nhóm RIÊNG
//   (zalo_group_vandon.json, chọn bằng `node pair.js --chon-vandon <id>`) — tin có tên + SĐT
//   khách nên không bao giờ vào nhóm ads. Lệnh /vandon chỉ trả lời ở nhóm đó.
// Nhóm ads chỉ tin ADS — không tồn kho, không thẻ/TKQC như bot WhatsApp. Nguồn số: API dashboard
// cùng máy (sheet-report = file TỔNG TEAM, realtime = Meta + POS live, ads-alerts =
// BigQuery, sync-health = tuổi số). Gửi bằng nick Zalo PHỤ (zca-js) — xem README.md.
//
// Chạy: node bot.js                          (dịch vụ — pm2 talpha-zalo-alerts)
//       node bot.js --lenh "/baocao homqua"  (làm như có người gõ lệnh đó trong nhóm)
//       node bot.js --report [YYYY-MM-DD]    (gửi ngay báo cáo ngày đó — mặc định hôm qua)
//       node bot.js --vandon                 (gửi ngay tin vận đơn cần xử lý vào nhóm vận đơn)
//       thêm --dry-run: IN tin ra màn hình, không đăng nhập, không gửi.
// ═══════════════════════════════════════════════════════════════════
const fs = require("fs");
const path = require("path");
const CFG = require("./config");
const { buildMarketerReports, buildTinDinhChinh } = require("./daily_report");
const { buildAdsAlert, buildAdsStatus } = require("./ads_alerts");
const { docLenh, huongDan, huongDanVanDon, homQua } = require("./commands");
const { buildVanDonSang, buildVanDonToi, fetchVanDon } = require("./van_don");
const { slotAction, toMin, canDinhChinh, hanDinhChinh } = require("./schedule");
const { toZalo, chiaTin } = require("./zalo_text");
const { MARKETERS, DISPLAY } = require("./rules");

const DIR = __dirname;
const STATE_FILE = path.join(DIR, "state.json");
const ARGS = process.argv.slice(2);
const DRY = ARGS.includes("--dry-run");
const DR = CFG.dailyReport || {};
const VD = CFG.vanDon || {};
const ADS_POLL = Number(CFG.adsPollMinutes) || 0;          // 0 = tắt cảnh báo theo chu kỳ
const DC_GIO = Number(DR.dinhChinhHanGio) > 0 ? Number(DR.dinhChinhHanGio) : 24;   // hạn chờ đính chính
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
const VD_AT = /^\d{1,2}:\d{2}$/.test(String(VD.at || "")) ? VD.at : "";   // trống = không tự gửi tin vận đơn sáng
const VD_TOI = /^\d{1,2}:\d{2}$/.test(String(VD.toiAt || "")) ? VD.toiAt : "";   // trống = không gửi tin tối
const gioCua = (ts) => new Date(ts).toLocaleString("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: CFG.timezone });
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
        // loi = tên TKQC/shop đọc lỗi trong vòng sync gần nhất → tin "SỐ CHƯA ĐỦ" nói đích danh.
        return { okAge, limit: Number(DR.staleWarnMinutes || 120), lastOkTs: Date.now() - okAge * 60000, loi: j.fetch_errors || null };
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
let nhomVanDon = {};       // mã nước → nhóm nhận tin vận đơn nước đó (VẬN ĐƠN TW, VẬN ĐƠN SGP); thiếu = không gửi
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

async function guiMot(text, nhom = nhomDich) {
    if (DRY) {
        const phan = chiaTin(toZalo(text), CFG.maxChars || 1800);
        phan.forEach((p, i) => {
            const dam = p.styles.filter((s) => s.st === "b").map((s) => p.msg.slice(s.start, s.start + s.len));
            console.log(`\n──── tin${phan.length > 1 ? ` (phần ${i + 1}/${phan.length})` : ""} · ${p.msg.length} ký tự ────\n${p.msg}`);
            if (dam.length) console.log(`   [chữ đậm: ${dam.join(" | ")}]`);
        });
        return phan.length;
    }
    if (!nhom) throw new Error("chưa chọn nhóm nhận tin — chạy `node pair.js --chon <id nhóm>`");
    const opts = { maxChars: CFG.maxChars, sendGapMs: CFG.sendGapMs };
    // ketNoi() TRƯỚC rồi mới đọc zalo.guiNhom: viết gộp `zalo.guiNhom(await ketNoi(), …)`
    // thì JS đọc zalo.guiNhom trước khi ketNoi() kịp nạp module.
    let a = await ketNoi();
    try {
        return await zalo.guiNhom(a, nhom.id, text, opts);
    } catch (e) {
        log("Gửi lỗi, đăng nhập lại rồi thử một lần nữa:", e.message);
        api = null;
        a = await ketNoi();
        return zalo.guiNhom(a, nhom.id, text, opts);
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
async function guiLoat(texts, nhom = nhomDich) {
    let da = 0;
    for (const t of texts.filter(Boolean)) {
        if (da > 0 && !DRY) await sleep(CFG.sendGapMs || 4000);
        try { await guiMot(t, nhom); }
        catch (e) { e.daGui = da; throw e; }
        da++;
    }
    return da;
}

// kieu: "sang" (08:30, kết quả hôm qua) · "toi" (22:00, kết quả hôm nay) · "" (gõ tay / đính chính).
async function dungBaoCao(ngay, homNay, label, staleCoSan, kieu = "") {
    const stale = staleCoSan === undefined ? await fetchStale() : staleCoSan;
    const gio = vnHHMM(), today = vnDateStr();
    let tieuDe, nguon;
    if (kieu === "sang") {
        tieuDe = `☀️ ADS · SÁNG ${ddmm(today)} · KẾT QUẢ ${ddmm(ngay)}`;
        nguon = "Số chốt từ file TỔNG TEAM" + (stale && stale.lastOkTs ? ` · sync ${gioCua(stale.lastOkTs)} ✓` : "");
    } else if (kieu === "toi") {
        tieuDe = `🌙 ADS · TỐI ${ddmm(ngay)} · KẾT QUẢ HÔM NAY`;
        nguon = `Số tới ${gio} · ngày chưa chốt, còn lên nhẹ`;
    } else if (homNay) {
        tieuDe = `📊 ADS · HÔM NAY ${ddmm(ngay)} · ${gio}`;
        nguon = "Số đang chạy, chưa chốt ngày";
    } else {
        tieuDe = `📊 ADS · ${ddmm(ngay)}`;
        nguon = "Số từ file TỔNG TEAM";
    }
    return buildMarketerReports(DR, ngay,
        { intraday: homNay, label: label || (homNay ? slotLabel(gio) : undefined), stale, log, tieuDe, nguon });
}

// MỘT tin cho mốc tự gửi (Sỹ Anh chốt 16/09/2026: trước đây 1 tin tổng + 1 tin mỗi
// marketer = sáu tin liền, đọc trong nhóm thành loạn). Chi tiết campaign từng người vẫn
// còn, lấy bằng /baocao <tên>.
// theoDoi: khoá xếp lịch ĐÍNH CHÍNH. Chỉ mốc tự gửi và `--report` truyền vào — lệnh
// /baocao gõ trong nhóm là người ta HỎI số lúc này, không phải bản tin chính thức, nên
// không sinh tin đính chính (ai gõ 10 lần thì 10 tin đính chính là loạn nhóm).
function guiBaoCao(ngay, { homNay = false, label, theoDoi, kieu = "" } = {}) {
    return lanLuot(async () => {
        const r = await dungBaoCao(ngay, homNay, label, undefined, kieu);
        const n = await guiLoat([r.tinGop]);
        if (theoDoi && r.chuaDu && !DRY) xepDinhChinh(theoDoi, r, ngay, homNay);
        return { n, marketers: r.nguoi.length, chuaDu: r.chuaDu };
    });
}

// ─── Vận đơn ───
// Sỹ Anh duyệt mẫu 26/09/2026: 08:30 SÁNG (hôm qua + khách phải gọi/nhắn, đủ chi tiết từng
// khách) và 22:00 TỐI (hôm nay làm được gì). MỖI nước MỘT nhóm (VẬN ĐƠN TW, VẬN ĐƠN SGP),
// mỗi nước một mốc riêng — nước này hỏng không kéo nước kia, và vòng rà thử lại đúng nước hỏng.
// Tin sáng lưu danh sách khách phải gọi/nhắn vào state.json để tin tối chấm "đã lấy chưa".
const VD_MARKETS = (Array.isArray(VD.markets) && VD.markets.length ? VD.markets : ["TW"]).map((x) => String(x).toUpperCase());
const TEN_NUOC = { TW: "Đài Loan", SG: "Singapore" };

// kieu: "sang" · "toi" · "" (gõ /vandon trong ngày — khuôn tin sáng, đề giờ lúc gõ).
async function dungTinVanDon(m, kieu) {
    const today = vnDateStr();
    const d = await fetchVanDon(VD, today, fetch, m);
    const base = { today, maxGoi: VD.maxGap, maxMoiToi: VD.maxMoiToi, quotaWarn: VD.quotaWarn, phuTrach: VD.phuTrach };
    if (kieu === "toi") {
        const sang = (loadState().vanDonSang || {})[m];
        return { text: buildVanDonToi(d, { ...base, sangNay: sang && sang.ngay === today ? sang : null }) };
    }
    const tieuDe = kieu === "sang" ? undefined : `📦 VẬN ĐƠN ${(TEN_NUOC[m] || m).toUpperCase()} · ${vnHHMM()} ${ddmm(today)}`;
    return buildVanDonSang(d, { ...base, tieuDe });
}

function guiVanDon(m, kieu = "sang") {
    const nhom = nhomVanDon[m];
    if (!DRY && !nhom) {
        return Promise.reject(new Error(`chưa chọn nhóm vận đơn ${m} — chạy \`node pair.js --chon-vandon <id nhóm>${m === "TW" ? "" : ` --nuoc ${m}`}\``));
    }
    return lanLuot(async () => {
        const r = await dungTinVanDon(m, kieu);
        const n = await guiLoat([r.text], nhom);
        if (kieu === "sang" && !DRY) {
            markState((s) => { (s.vanDonSang = s.vanDonSang || {})[m] = { ngay: vnDateStr(), goi: r.goi || [], moiToi: r.moiToi || [] }; });
        }
        return { n, ghiChu: `tin vận đơn ${m} ${kieu || "gõ tay"} (${n} tin)` };
    });
}

// ─── Gửi TẠM đúng khung giờ, có số đủ thì tự ĐÍNH CHÍNH ───
// Sỹ Anh chốt 22/09/2026. Trước đó tin tạm chỉ mang dòng "⚠️ SỐ CHƯA ĐỦ" rồi thôi: ai đọc
// lúc đó nhớ số sai, không ai quay lại xem số đúng. Nay tin tạm vẫn gửi (giữ khung giờ),
// nhưng bot NHỚ lại số đã báo; vòng rà sau thấy sync đã chạy đủ số thì gửi thêm một tin
// nói rõ lệch bao nhiêu.
// Ghi vào state.json nên pm2 restart / máy chủ reboot giữa lúc chờ vẫn không mất lịch —
// đúng ca hay gặp, vì sync đứng thường đi kèm máy chủ vừa có sự cố.
function xepDinhChinh(khoa, r, ngay, homNay) {
    const cho = { ngay, intraday: !!homNay, label: r.label, luc: Date.now(), so: r.so };
    cho.hanTs = hanDinhChinh(cho, DC_GIO);
    markState((s) => { (s.dinhChinh = s.dinhChinh || {})[khoa] = cho; });
    log(`Tin "${r.label}" gửi khi số CHƯA ĐỦ — chờ vòng sync đủ số để đính chính (hạn ${new Date(cho.hanTs).toISOString()}).`);
}

async function ratDinhChinh() {
    const cho = loadState().dinhChinh || {};
    const khoa = Object.keys(cho);
    if (!khoa.length) return;                       // không có gì chờ → không hỏi sync-health
    const stale = await fetchStale();
    for (const k of khoa) {
        const p = cho[k];
        const act = canDinhChinh(p, stale);
        if (!act) continue;
        const xoa = () => markState((s) => { if (s.dinhChinh) delete s.dinhChinh[k]; });
        if (act === "het-han") { xoa(); log(`Bỏ chờ đính chính "${p.label}" — quá hạn mà số vẫn chưa đủ.`); continue; }
        if (inQuietHours()) return;                 // 23h–7h: không đánh thức nhóm, vòng sau gửi
        try {
            await lanLuot(async () => {
                const r = await dungBaoCao(p.ngay, p.intraday, p.label, stale);
                await guiLoat([buildTinDinhChinh({
                    tin: r.tinGop, soCu: p.so, soMoi: r.so, label: p.label, luc: p.luc, intraday: p.intraday,
                })]);
            });
            xoa();
            log(`Đã gửi đính chính "${p.label}".`);
        } catch (e) {
            if (e.daGui > 0) { xoa(); log(`Đính chính "${p.label}" gửi được một phần — không gửi lại:`, e.message); }
            else log(`Đính chính "${p.label}" lỗi — vòng sau thử lại:`, e.message);
        }
    }
}

// ─── Lệnh trong nhóm ───
const lanCuoi = new Map();     // chữ lệnh → lúc nhận; cùng lệnh trong 60 giây thì bỏ (bấm gửi hai lần)

// ctx: nhóm lệnh được gõ ở đâu — { ads: true } nhóm ads, { vd: "TW" } nhóm vận đơn một nước,
// null = dòng lệnh. Lệnh ads chỉ trả ở nhóm ads, /vandon chỉ trả ở nhóm vận đơn và CHỈ nước
// của nhóm đó: tin vận đơn có SĐT khách, tin ads có doanh thu — nhóm nào thấy phần nhóm đó.
async function lamLenh(text, ai = "dòng lệnh", ctx = null) {
    const lenh = docLenh(text, { today: vnDateStr(), nguoi: NGUOI });
    if (!lenh) return false;
    const choAds = !ctx || !!ctx.ads, choVD = !ctx || !!ctx.vd;
    const nhom = !ctx ? "cli" : ctx.ads && ctx.vd ? "ca-hai" : ctx.ads ? "ads" : "vandon";
    if (lenh.lenh === "vandon" ? !choVD : (lenh.lenh !== "trogiup" && !choAds)) {
        log(`Bỏ lệnh "${String(text).trim()}" từ ${ai} — không thuộc nhóm này.`);
        return true;
    }
    const khoa = `${nhom}:${ctx && ctx.vd ? ctx.vd : ""}:${String(text).trim().toLowerCase()}`;
    if (Date.now() - (lanCuoi.get(khoa) || 0) < 60000) { log(`Bỏ lệnh lặp "${khoa}" từ ${ai}.`); return true; }
    lanCuoi.set(khoa, Date.now());
    log(`Lệnh "${String(text).trim()}" từ ${ai}.`);

    await lanLuot(async () => {
        try {
            if (lenh.lenh === "vandon") {
                // Trong nhóm một nước: luôn là nước của nhóm. Dòng lệnh: nước ghi trong lệnh, hoặc mọi nước.
                const nuoc = ctx && ctx.vd ? [ctx.vd] : lenh.nuoc ? [lenh.nuoc] : VD_MARKETS;
                const nhomTra = nhomVanDon[nuoc[0]];
                if (lenh.loi) { await guiMot(`⚠️ ${lenh.loi}`, nhomTra); return; }
                try { for (const m of nuoc) await guiLoat([(await dungTinVanDon(m, "")).text], nhomVanDon[m]); }
                catch (e) {
                    // Tự lo lỗi ở đây, KHÔNG ném ra ngoài: nhánh bắt lỗi chung bên dưới gửi
                    // vào nhóm ads — tin lỗi vận đơn không có chỗ ở đó.
                    log("Lệnh /vandon lỗi:", e.message);
                    try { await guiMot(`⚠️ Chưa lấy được danh sách vận đơn lúc này (${e.message}). Lát nữa gõ lại.`, nhomTra); }
                    catch (e2) { log("Không gửi được tin báo lỗi vận đơn:", e2.message); }
                }
                return;
            }
            if (lenh.lenh === "trogiup" && nhom === "vandon") { await guiMot(huongDanVanDon({ at: VD_AT, toi: VD_TOI }), nhomVanDon[ctx.vd]); return; }
            if (lenh.loi) { await guiMot(`⚠️ ${lenh.loi}`); return; }
            if (lenh.lenh === "trogiup") {
                await guiMot(huongDan({ at: DAILY_AT, toi: INTRADAY_SLOTS.join(" · "), nguoi: NGUOI })
                    + (nhom === "ca-hai" ? "\n\n" + huongDanVanDon({ at: VD_AT, toi: VD_TOI }) : ""));
                return;
            }
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
            if (nhom === "vandon") return;             // tin lỗi dưới đây là của nhóm ads
            const bao = /Sheet chưa có dòng/.test(e.message)
                ? `⚠️ Sheet chưa có số ngày ${ddmm(lenh.ngay)} — vòng ghi Sheet chạy mỗi giờ phút 20, lát nữa gõ lại.`
                : `⚠️ Chưa lấy được số lúc này (${e.message}). Lát nữa gõ lại.`;
            try { await guiMot(bao); } catch (e2) { log("Không gửi được tin báo lỗi:", e2.message); }
        }
    });
    return true;
}

// Chỉ nghe ĐÚNG hai nhóm nhận tin (ads, vận đơn). Nick phụ còn ở các nhóm COD có người
// của đối tác — gõ /baocao ở đó mà bot trả số doanh thu là lộ số ra ngoài.
function xuLyTin(msg) {
    if (!zalo || msg.type !== zalo.ThreadType.Group) return;
    const laAds = !!nhomDich && msg.threadId === nhomDich.id;
    const vd = Object.keys(nhomVanDon).find((m) => nhomVanDon[m] && nhomVanDon[m].id === msg.threadId) || null;
    if (!laAds && !vd) return;
    const text = typeof msg.data.content === "string" ? msg.data.content : "";
    if (!text.trim().startsWith("/")) return;
    lamLenh(text, msg.data.dName || msg.data.uidFrom, { ads: laAds, vd }).catch((e) => log("Lỗi xử lý lệnh:", e.message));
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
        log(`Đã gửi mốc ${moc} (${khoa}): ${r.ghiChu || `1 tin gộp, ${r.marketers} marketer trong bảng`}.`);
    } catch (e) {
        if (e.daGui > 0) danhDau();
        log(`Mốc ${moc} lỗi${e.daGui > 0 ? ` sau ${e.daGui} tin — không gửi lại` : " — vòng sau thử lại"}:`, e.message);
    }
}

async function ratMoc() {
    const hq = homQua(vnDateStr());
    await chayMoc("sang", DAILY_AT, Number(DR.atCatchUpMinutes || 210),
        () => guiBaoCao(hq, { theoDoi: `sang:${hq}`, kieu: "sang" }));
    for (const slot of INTRADAY_SLOTS) {
        const nay = vnDateStr();
        await chayMoc(slot, slot, Number(DR.intradayCatchUpMinutes || 60),
            () => guiBaoCao(nay, { homNay: true, label: slotLabel(slot), theoDoi: `${slot}:${nay}`, kieu: "toi" }));
    }
    // Tin vận đơn: dashboard lỗi thì vòng 5' sau thử lại, quá catchUpMinutes thì bỏ hôm đó.
    // Vận đơn: mỗi nước một mốc sáng + một mốc tối, rà riêng.
    for (const m of VD_MARKETS) {
        if (!nhomVanDon[m]) continue;
        if (VD_AT) await chayMoc(`vandon:${m}`, VD_AT, Number(VD.catchUpMinutes || 180), () => guiVanDon(m, "sang"));
        if (VD_TOI) await chayMoc(`vandon_toi:${m}`, VD_TOI, Number(VD.toiCatchUpMinutes || 60), () => guiVanDon(m, "toi"));
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
    const moi = [];
    if (nhomDich) moi.push([nhomDich, huongDan({ at: DAILY_AT, toi: INTRADAY_SLOTS.join(" · "), nguoi: NGUOI })]);
    for (const m of VD_MARKETS) {
        const g = nhomVanDon[m];
        if (g && (!nhomDich || g.id !== nhomDich.id)) moi.push([g, huongDanVanDon({ at: VD_AT, toi: VD_TOI, nuoc: TEN_NUOC[m] || m })]);
    }
    for (const [nhom, tin] of moi) {
        if ((loadState().gioiThieu || {})[nhom.id]) continue;
        await lanLuot(() => guiMot(tin, nhom));
        markState((s) => { (s.gioiThieu = s.gioiThieu || {})[nhom.id] = new Date().toISOString(); });
        log(`Đã gửi tin giới thiệu vào nhóm "${nhom.name}".`);
    }
}

async function chayDichVu() {
    dichVu = true;
    log(`Dashboard base: ${CFG.dashboardBaseUrl}${process.env.TALPHA_DASHBOARD_URL ? " (env TALPHA_DASHBOARD_URL)" : ""}`);
    zalo = require("./zalo");
    // Chưa ghép/chưa chọn nhóm/đăng nhập hỏng: KHÔNG thoát — pm2 sẽ khởi động lại liên tục
    // và che mất lỗi thật. Đứng chờ, 10' thử lại một lần.
    for (;;) {
        nhomDich = zalo.docNhomDich();
        nhomVanDon = Object.fromEntries(VD_MARKETS.map((m) => [m, zalo.docNhomVanDon(m)]).filter(([, g]) => g));
        if (!nhomDich && !Object.keys(nhomVanDon).length) log("Chưa chọn nhóm nhận tin — chạy `node pair.js` rồi `node pair.js --chon <id>`.");
        else {
            try { await ketNoi(); break; }
            catch (e) { log("Đăng nhập Zalo lỗi:", e.message); }
        }
        await sleep(10 * 60 * 1000);
    }
    if (nhomDich) {
        log(`Nhóm ads "${nhomDich.name}" (${nhomDich.id}) · tự gửi ${[DAILY_AT, ...INTRADAY_SLOTS].join(" + ")}`
            + (ADS_POLL > 0 ? ` · cảnh báo ads mỗi ${ADS_POLL}'` : " · cảnh báo ads chỉ khi gõ /canhbao")
            + " · nghe lệnh trong nhóm.");
    } else log("Chưa chọn nhóm ads — không gửi báo cáo ads (`node pair.js --chon <id>`).");
    for (const m of VD_MARKETS) {
        const g = nhomVanDon[m];
        if (g) log(`Nhóm vận đơn ${m} "${g.name}" (${g.id}) · tự gửi ${[VD_AT, VD_TOI].filter(Boolean).join(" + ") || "(tắt)"} · nghe /vandon.`);
        else log(`Chưa chọn nhóm vận đơn ${m} — không gửi tin vận đơn ${m} (\`node pair.js --chon-vandon <id>${m === "TW" ? "" : ` --nuoc ${m}`}\`).`);
    }

    try { await gioiThieuNeuMoi(); } catch (e) { log("Tin giới thiệu lỗi:", e.message); }

    let dangRa = false;                 // không để hai vòng rà chồng nhau khi một vòng gửi lâu
    const vongMoc = async () => {
        if (dangRa) return;
        dangRa = true;
        try { await ratMoc(); await ratDinhChinh(); }
        catch (e) { log("Vòng rà lỗi:", e.message); }
        finally { dangRa = false; }
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
    if (lenh || ARGS.includes("--report") || ARGS.includes("--vandon")) {
        if (!DRY) {
            const z = require("./zalo");
            nhomDich = z.docNhomDich();
            nhomVanDon = Object.fromEntries(VD_MARKETS.map((m) => [m, z.docNhomVanDon(m)]).filter(([, g]) => g));
        }
        if (ARGS.includes("--vandon")) {
            // --vandon [sang|toi] [--nuoc SG]: gửi ngay (mặc định: khuôn sáng, mọi nước).
            const kieu = ["sang", "toi"].includes(argAfter("--vandon")) ? argAfter("--vandon") : "sang";
            const nuoc = argAfter("--nuoc") ? [argAfter("--nuoc").toUpperCase()] : VD_MARKETS;
            for (const m of nuoc) {
                if (!DRY && !nhomVanDon[m]) { log(`Bỏ ${m}: chưa chọn nhóm vận đơn.`); continue; }
                await guiVanDon(m, kieu);
                log(DRY ? `In thử tin vận đơn ${m} (${kieu}).` : `Đã gửi tin vận đơn ${m} (${kieu}) vào "${nhomVanDon[m].name}".`);
            }
        } else if (lenh) {
            if (!(await lamLenh(lenh))) log(`"${lenh}" không phải lệnh của bot.`);
        } else {
            const ngay = /^\d{4}-\d{2}-\d{2}$/.test(argAfter("--report")) ? argAfter("--report") : homQua(vnDateStr());
            const r = await guiBaoCao(ngay, { theoDoi: `report:${ngay}` });
            log(`${DRY ? "In thử" : "Đã gửi"} báo cáo ngày ${ngay}: 1 tin gộp, ${r.marketers} marketer trong bảng.`
                + (r.chuaDu ? " SỐ CHƯA ĐỦ — bot dịch vụ sẽ tự gửi tin đính chính khi sync đủ số." : ""));
        }
        return true;
    }
    await chayDichVu();
    return false;
}

main()
    .then((motLan) => { if (motLan) setTimeout(() => process.exit(0), 1000); })
    .catch((e) => { log("LỖI:", e.message); process.exit(1); });

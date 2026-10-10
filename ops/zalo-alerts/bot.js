// ═══════════════════════════════════════════════════════════════════
// TALPHA — Bot báo cáo ADS + VẬN ĐƠN vào nhóm Zalo, MỖI NƯỚC MỘT NHÓM
// ───────────────────────────────────────────────────────────────────
// 08/10/2026 (Sỹ Anh chốt): mỗi nước một nhóm "ADS + VẬN ĐƠN <nước>" — TAIWAN · SGP · UAE ·
// JAPAN. Tin ads của nước đó và tin vận đơn của nước đó chung một nhóm. BỎ HẲN nhóm cũ: BÁO CÁO
// ADS (gộp mọi nước) và VẬN ĐƠN TW / SGP / UAE — bot không đọc file nhóm cũ nữa.
// - Ads 08:30 (kết quả hôm qua) + 13:00 · 18:00 · 22:00 (số đang chạy hôm nay), giờ như cũ.
//   13:00/18:00 so ▲▼ với CÙNG MỐC hôm qua của chính nước đó, 22:00 so với cả ngày hôm qua.
// - Vận đơn 08:30 + 22:00 (Đài, Singapore, UAE). Nhật chưa có vận đơn (chưa có shop POS, chưa
//   biết hãng giao) — nhóm Nhật chỉ nhận ads.
// - Lệnh gõ trong nhóm (commands.js): /baocao [homqua | dd/mm] [tên | team] · /canhbao · /vandon
//   · /bot — luôn trả số của NƯỚC CỦA NHÓM, không bao giờ số nước khác.
// - Sync đang đứng thì tin vẫn gửi ĐÚNG KHUNG GIỜ (mang dòng "SỐ CHƯA ĐỦ") và bot NHỚ số đã
//   báo; vòng sync nào lấy đủ số thì tự gửi thêm MỘT tin ĐÍNH CHÍNH vào đúng nhóm nước đó
//   (Sỹ Anh chốt 22/09/2026). Lịch chờ nằm trong state.json → restart không mất.
// Nguồn số: data/bao_cao_nuoc/<tháng>.json (format_all.py ghi cùng lúc file TỔNG TEAM),
// realtime = Meta + POS live (chi tiết camp), tracking = vận đơn, sync-health = tuổi số. Gửi
// bằng nick Zalo PHỤ (zca-js) — xem README.md.
//
// Chạy: node bot.js                                (dịch vụ — pm2 talpha-zalo-alerts)
//       node bot.js --lenh "/baocao homqua" --nuoc TW   (làm như có người gõ lệnh đó trong nhóm TW)
//       node bot.js --report [YYYY-MM-DD] [--nuoc TW]   (gửi ngay báo cáo ngày đó — mặc định hôm qua, mọi nước)
//       node bot.js --vandon [sang|toi] [--nuoc SG]     (gửi ngay tin vận đơn)
//       node bot.js --moc 13:00 [--nuoc AE]             (gửi ngay tin một mốc giữa ngày)
//       thêm --dry-run: IN tin ra màn hình, không đăng nhập, không gửi.
// ═══════════════════════════════════════════════════════════════════
const fs = require("fs");
const path = require("path");
const CFG = require("./config");
const { buildBaoCaoNuoc, buildTinDinhChinh, buildCanhBaoNuoc } = require("./daily_report");
const { docLenh, huongDanNuoc, homQua } = require("./commands");
const { buildVanDonSang, buildVanDonToi, fetchVanDon, ghiSoNhac } = require("./van_don");
const { slotAction, toMin, canDinhChinh, hanDinhChinh } = require("./schedule");
const { toZalo, chiaTin } = require("./zalo_text");
const { MARKETERS, DISPLAY, NUOC, chonNhomTheoTen, trangCuaCamp, campaignMarket } = require("./rules");
const { buildTinGio, messThayTuPancake } = require("./tin_gio");

const DIR = __dirname;
const STATE_FILE = path.join(DIR, "state.json");
// Số theo nước × người do format_all.py ghi (cùng máy chủ): /opt/talpha/data/bao_cao_nuoc.
const BAN_DIR = process.env.TALPHA_BAN_NUOC_DIR || path.join(DIR, "..", "..", "data", "bao_cao_nuoc");
const ARGS = process.argv.slice(2);
const DRY = ARGS.includes("--dry-run");
const DR = CFG.dailyReport || {};
const VD = CFG.vanDon || {};
const DC_GIO = Number(DR.dinhChinhHanGio) > 0 ? Number(DR.dinhChinhHanGio) : 24;   // hạn chờ đính chính
const NGUOI = Object.keys(MARKETERS).map((key) => ({ key, ten: DISPLAY[key] }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString(), ...a);
const ddmm = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : String(d || ""));

// Nước có nhóm "ADS + VẬN ĐƠN" — thứ tự gửi trong một mốc.
const CAC_NUOC = ((CFG.nhomNuoc || {}).markets || Object.keys(NUOC)).map((x) => String(x).toUpperCase()).filter((m) => NUOC[m]);
// Nước có theo dõi vận đơn (Nhật chưa có).
const VD_MARKETS = (Array.isArray(VD.markets) && VD.markets.length ? VD.markets : ["TW"]).map((x) => String(x).toUpperCase());
// Nước Meta không báo số tin nhắn (Nhật): bản tin ads lấy mess từ Pancake (09/10/2026).
const MESS_PANCAKE = (((CFG.nhomNuoc || {}).messPancake) || []).map((x) => String(x).toUpperCase());
// Tin MỖI GIỜ (ads + tin nhắn Pancake + đơn theo page) — Sỹ Anh yêu cầu 09/10/2026 cho Nhật.
const MG = CFG.moiGio || {};
const MG_MARKETS = (MG.markets || []).map((x) => String(x).toUpperCase()).filter((m) => NUOC[m]);
// UAE không qua 17TRACK: đơn POS + tra thẳng trang WeShip (Sỹ Anh chốt 28/09/2026).
const NGUON_NUOC = { AE: "đơn POS + tra trang WeShip" };

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

// Bảng số theo nước × người của một tháng — đọc lại mỗi lần (vòng ghi Sheet mỗi giờ thay file).
function docBan(thang) {
    try { return JSON.parse(fs.readFileSync(path.join(BAN_DIR, `${thang}.json`), "utf8")); }
    catch { return null; }
}

// /api/talpha/realtime hỏi thẳng Meta + POS live (chậm, có rate-limit): bốn nước của CÙNG một
// mốc dùng chung một lượt gọi. Giữ 3 phút; lượt hỏng thì bỏ khỏi bộ nhớ để lần sau gọi lại.
const RT_GIU_MS = 3 * 60 * 1000;
const rtNho = new Map();
function layRealtime(dateStr) {
    const hit = rtNho.get(dateStr);
    if (hit && Date.now() - hit.at < RT_GIU_MS) return hit.p;
    const p = (async () => {
        const res = await fetch(`${DR.realtimeUrl}?from_date=${dateStr}&to_date=${dateStr}`, { headers: { "cache-control": "no-store" } });
        if (!res.ok) throw new Error(`realtime HTTP ${res.status}`);
        return res.json();
    })();
    rtNho.set(dateStr, { at: Date.now(), p });
    p.catch(() => { if (rtNho.get(dateStr) && rtNho.get(dateStr).p === p) rtNho.delete(dateStr); });
    return p;
}

// Tin nhắn Pancake + đơn POS theo page của một nước một ngày (/api/talpha/pancake-nuoc). camps:
// campaign Meta cùng ngày — gửi kèm tên page của camp nước đó (camp tạo hôm nay chưa kịp sync).
async function fetchPancakeNuoc(m, ngay, camps) {
    if (!MG.url) throw new Error("thiếu moiGio.url trong config");
    const trang = [...new Set((camps || [])
        .filter((c) => campaignMarket(c.campaign_name).market === NUOC[m].key)
        .map((c) => trangCuaCamp(c.campaign_name)).filter(Boolean))];
    const q = new URLSearchParams({ market: m, date: ngay, ...(trang.length ? { trang: trang.join("|") } : {}) });
    const res = await fetch(`${MG.url}?${q}`, { headers: { "cache-control": "no-store" } });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.error) throw new Error(j.error || `pancake-nuoc HTTP ${res.status}`);
    return j;
}

// ─── Kết nối + gửi ───
// Đăng nhập lười: chỉ khi có tin cần gửi. Gửi hỏng thì bỏ phiên trong bộ nhớ, đăng nhập lại
// một lần rồi gửi lại — phiên web của Zalo hay rớt khi Zalo đổi máy chủ.
let zalo = null;           // require("./zalo") muộn: --dry-run chạy được cả khi chưa cài zca-js
let api = null;
let nhomNuoc = {};         // mã nước → nhóm "ADS + VẬN ĐƠN <nước>"; thiếu = không gửi gì cho nước đó
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

async function guiMot(text, nhom) {
    if (DRY) {
        const phan = chiaTin(toZalo(text), CFG.maxChars || 1800);
        phan.forEach((p, i) => {
            const dam = p.styles.filter((s) => s.st === "b").map((s) => p.msg.slice(s.start, s.start + s.len));
            console.log(`\n──── tin${nhom ? ` → "${nhom.name}"` : ""}${phan.length > 1 ? ` (phần ${i + 1}/${phan.length})` : ""} · ${p.msg.length} ký tự ────\n${p.msg}`);
            if (dam.length) console.log(`   [chữ đậm: ${dam.join(" | ")}]`);
        });
        return phan.length;
    }
    if (!nhom) throw new Error("chưa có nhóm nhận tin — chạy `node pair.js --tu-nhan`");
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
async function guiLoat(texts, nhom) {
    let da = 0;
    for (const t of texts.filter(Boolean)) {
        if (da > 0 && !DRY) await sleep(CFG.sendGapMs || 4000);
        try { await guiMot(t, nhom); }
        catch (e) { e.daGui = da; throw e; }
        da++;
    }
    return da;
}

// Nhóm của nước m; dry-run không cần nhóm thật (chỉ in) — đặt tên giả để dòng in ghi rõ nước.
const nhomCua = (m) => nhomNuoc[m] || (DRY ? { id: "", name: `ADS + VẬN ĐƠN ${m} (in thử)` } : null);

// Mốc giữa ngày → kiểu tin: trước 16h là TRƯA, trước 20h là CHIỀU, còn lại TỐI.
const kieuMoc = (hhmm) => (toMin(hhmm) < 16 * 60 ? "trua" : toMin(hhmm) < 20 * 60 ? "chieu" : "toi");
// Khoá số đã báo của một mốc một nước (state.soMoc) — để mai cùng giờ so ▲▼.
const khoaSoMoc = (m, moc) => `${m}|${moc}`;

// kieu: "sang" (08:30, kết quả hôm qua) · "trua" / "chieu" (13:00 / 18:00) · "toi" (22:00,
//       kết quả hôm nay) · "" (gõ tay / đính chính).
async function dungBaoCao(m, ngay, homNay, label, staleCoSan, kieu = "", moc = "") {
    const n = NUOC[m];
    const stale = staleCoSan === undefined ? await fetchStale() : staleCoSan;
    const gio = vnHHMM(), today = vnDateStr();
    const nuoc = `${n.flag} ${n.ten.toUpperCase()}`;
    let tieuDe, nguon, them = {};
    if (kieu === "sang") {
        tieuDe = `☀️ ADS ${nuoc} · SÁNG ${ddmm(today)} · KẾT QUẢ ${ddmm(ngay)}`;
        nguon = "Số chốt từ vòng ghi file TỔNG TEAM" + (stale && stale.lastOkTs ? ` · sync ${gioCua(stale.lastOkTs)} ✓` : "");
    } else if (kieu === "trua" || kieu === "chieu") {
        tieuDe = `${kieu === "trua" ? "🌤 ADS" : "🌇 ADS"} ${nuoc} · ${kieu === "trua" ? "TRƯA" : "CHIỀU"} ${ddmm(ngay)} · KẾT QUẢ TỚI ${moc || gio}`;
        nguon = "Số đang chạy" + (stale && stale.lastOkTs ? ` · sync ${gioCua(stale.lastOkTs)} ✓` : "")
            + " · ngày chưa chốt, còn lên tiếp";
        // So với CÙNG MỐC hôm qua (số bot đã báo lúc đó, state.json → soMoc). Chưa có thì
        // không ▲▼ — so 13:00 với cả ngày hôm qua thì chữ nào cũng ▼ nửa, báo động giả.
        const cu = (loadState().soMoc || {})[khoaSoMoc(m, moc)];
        them = { khongSoCaNgay: true, soCungGio: cu && cu.ngay === homQua(ngay) ? { so: cu.so, nhan: `${moc} hôm qua` } : null };
    } else if (kieu === "toi") {
        tieuDe = `🌙 ADS ${nuoc} · TỐI ${ddmm(ngay)} · KẾT QUẢ HÔM NAY`;
        nguon = `Số tới ${gio} · ngày chưa chốt, còn lên nhẹ`;
    } else if (homNay) {
        tieuDe = `📊 ADS ${nuoc} · HÔM NAY ${ddmm(ngay)} · ${gio}`;
        nguon = "Số đang chạy, chưa chốt ngày";
    } else {
        tieuDe = `📊 ADS ${nuoc} · ${ddmm(ngay)}`;
        nguon = "Số từ vòng ghi file TỔNG TEAM";
    }
    // Nhật: Meta không báo tin nhắn → số mess lấy từ Pancake. Lỗi thì giữ số Meta và nói rõ.
    if (MESS_PANCAKE.includes(m)) {
        try {
            const rt = await layRealtime(ngay);
            const mt = messThayTuPancake(await fetchPancakeNuoc(m, ngay, rt.campaigns), rt.campaigns);
            if (mt) { them.messThay = mt; nguon += " · tin nhắn đếm từ Pancake"; }
            else nguon += " · ⚠️ chưa đếm được tin nhắn Pancake";
        } catch (e) { log(`Pancake ${m} lỗi — tin dùng số mess Meta:`, e.message); nguon += " · ⚠️ chưa đếm được tin nhắn Pancake"; }
    }
    return buildBaoCaoNuoc(DR, ngay, {
        nuoc: m, docBan, layRealtime, intraday: homNay, label: label || (homNay ? slotLabel(gio) : undefined),
        stale, log, tieuDe, nguon, ...them,
    });
}

// MỘT tin ads cho một nước (Sỹ Anh chốt 16/09/2026: một tin, không phải sáu).
// theoDoi: khoá xếp lịch ĐÍNH CHÍNH. Chỉ mốc tự gửi và `--report` truyền vào — lệnh /baocao gõ
// trong nhóm là người ta HỎI số lúc này, không sinh tin đính chính.
// nho: mốc tự gửi đúng giờ mới nhớ số (gửi tay `--moc 13:00` lúc 15h thì số 15h không được
// thành "số 13:00 hôm qua" của ngày mai).
function guiBaoCao(m, ngay, { homNay = false, label, theoDoi, kieu = "", moc = "", nho = true } = {}) {
    const nhom = nhomCua(m);
    if (!nhom) return Promise.reject(new Error(`chưa có nhóm ADS + VẬN ĐƠN ${m} — chạy \`node pair.js --tu-nhan\``));
    return lanLuot(async () => {
        const r = await dungBaoCao(m, ngay, homNay, label, undefined, kieu, moc);
        const n = await guiLoat([r.tinGop], nhom);
        if (moc && homNay && nho && !DRY) {
            // Mốc giữa ngày mới đã ra thì đính chính của mốc giữa ngày TRƯỚC cùng ngày, CÙNG NƯỚC,
            // thành thừa: tin mới nhất (vừa gửi) mới là tin người ta đang đọc.
            markState((s) => {
                for (const [k, p] of Object.entries(s.dinhChinh || {})) if (p && p.intraday && p.ngay === ngay && p.nuoc === m) delete s.dinhChinh[k];
            });
            // Nhớ số đã báo mốc này để mai cùng giờ so ▲▼. Số chưa đủ thì không nhớ — so với
            // số thiếu là ▲ giả.
            if (!r.chuaDu) markState((s) => { (s.soMoc = s.soMoc || {})[khoaSoMoc(m, moc)] = { ngay, so: r.so }; });
        }
        if (theoDoi && r.chuaDu && !DRY) xepDinhChinh(theoDoi, r, ngay, homNay, m);
        return { n, ghiChu: `tin ads ${m} (${n} tin, ${r.nguoi.length} người trong bảng)`, chuaDu: r.chuaDu };
    });
}

// ─── Tin MỖI GIỜ (Nhật, 09/10/2026) ───
// Ads Meta trực tiếp + tin nhắn Pancake + đơn POS, theo page. Nhớ tổng lần trước (state.gioTruoc)
// để in "(+N) thêm trong giờ qua". Meta hay Pancake hỏng thì tin vẫn đi, ghi rõ phần thiếu.
async function dungTinGio(m) {
    const ngay = vnDateStr();
    let camps = [], loiCamp = "";
    try { camps = (await layRealtime(ngay)).campaigns || []; } catch (e) { loiCamp = e.message; }
    let pk = null;
    try { pk = await fetchPancakeNuoc(m, ngay, camps); } catch (e) { log(`pancake-nuoc ${m} lỗi:`, e.message); }
    if (!pk && loiCamp) throw new Error(`Meta: ${loiCamp} · Pancake/đơn cũng lỗi`);
    return buildTinGio({ n: NUOC[m], ngay, gio: vnHHMM(), pk, camps, loiCamp,
        truoc: ((loadState().gioTruoc || {})[m]) || null });
}

function guiTinGio(m, nho = true) {
    const nhom = nhomCua(m);
    if (!nhom) return Promise.reject(new Error(`chưa có nhóm ADS + VẬN ĐƠN ${m}`));
    return lanLuot(async () => {
        const r = await dungTinGio(m);
        const n = await guiLoat([r.text], nhom);
        if (nho && !DRY) markState((s) => { (s.gioTruoc = s.gioTruoc || {})[m] = { ngay: vnDateStr(), tong: r.tong }; });
        return { n, ghiChu: `tin mỗi giờ ${m} (${r.tong.mess} mess, ${r.tong.don} đơn)` };
    });
}

// Các mốc mỗi giờ của hôm nay: HH:<phut> từ `tu` tới `den`, bỏ giờ đã có bản tin thường.
function mocMoiGio() {
    const phut = String(Number.isFinite(Number(MG.phut)) ? Number(MG.phut) : 5).padStart(2, "0");
    const coBanTin = new Set(INTRADAY_SLOTS.map((x) => x.split(":")[0].padStart(2, "0")));
    const out = [];
    for (let h = Number(MG.tu ?? 7); h <= Number(MG.den ?? 23); h++) {
        const hh = String(h).padStart(2, "0");
        if (MG.boGioCoBanTin !== false && coBanTin.has(hh)) continue;
        out.push(`${hh}:${phut}`);
    }
    return out;
}

// ─── Vận đơn ───
// Sỹ Anh duyệt mẫu 26/09/2026: 08:30 SÁNG (hôm qua + khách phải gọi/nhắn, đủ chi tiết từng
// khách) và 22:00 TỐI (hôm nay làm được gì). Từ 08/10/2026 gửi vào nhóm "ADS + VẬN ĐƠN" của
// nước đó. Mỗi nước một mốc riêng — nước này hỏng không kéo nước kia.
// Tin sáng lưu danh sách khách phải gọi/nhắn vào state.json để tin tối chấm "đã lấy chưa".

// kieu: "sang" · "toi" · "" (gõ /vandon trong ngày — khuôn tin sáng, đề giờ lúc gõ).
async function dungTinVanDon(m, kieu) {
    const today = vnDateStr();
    const d = await fetchVanDon(VD, today, fetch, m);
    const base = { today, maxGoi: VD.maxGap, maxMoiToi: VD.maxMoiToi, quotaWarn: VD.quotaWarn, phuTrach: VD.phuTrach,
        // Sổ nhắc: khách Đài đã được nhắn những ngày nào — để nhắc lại khách chưa lấy (30/09/2026).
        soNhac: (loadState().vanDonNhac || {})[m] || {} };
    if (kieu === "toi") {
        const sang = (loadState().vanDonSang || {})[m];
        return { text: buildVanDonToi(d, { ...base, sangNay: sang && sang.ngay === today ? sang : null }) };
    }
    const tieuDe = kieu === "sang" ? undefined : `📦 VẬN ĐƠN ${NUOC[m].ten.toUpperCase()} · ${vnHHMM()} ${ddmm(today)}`;
    return buildVanDonSang(d, { ...base, tieuDe });
}

function guiVanDon(m, kieu = "sang") {
    const nhom = nhomCua(m);
    if (!nhom) return Promise.reject(new Error(`chưa có nhóm ADS + VẬN ĐƠN ${m} — chạy \`node pair.js --tu-nhan\``));
    return lanLuot(async () => {
        const r = await dungTinVanDon(m, kieu);
        const n = await guiLoat([r.text], nhom);
        if (kieu === "sang" && !DRY) {
            const nay = vnDateStr();
            markState((s) => {
                (s.vanDonSang = s.vanDonSang || {})[m] = { ngay: nay, goi: r.goi || [], moiToi: r.moiToi || [], nhacLai: r.nhacLai || [], sapGiao: r.sapGiao || [] };
                // Chỉ ghi sổ sau khi GỬI THẬT: khách có câu soạn sẵn trong tin sáng nay = đã nhắn thêm một lần.
                (s.vanDonNhac = s.vanDonNhac || {})[m] = ghiSoNhac(s.vanDonNhac[m], r.daNhan, nay);
            });
        }
        return { n, ghiChu: `tin vận đơn ${m} ${kieu || "gõ tay"} (${n} tin)` };
    });
}

// ─── Gửi TẠM đúng khung giờ, có số đủ thì tự ĐÍNH CHÍNH ───
// Sỹ Anh chốt 22/09/2026. Tin tạm vẫn gửi (giữ khung giờ), bot NHỚ số đã báo; vòng rà sau
// thấy sync đã chạy đủ số thì gửi thêm một tin nói rõ lệch bao nhiêu — vào đúng nhóm nước đó.
// Ghi vào state.json nên pm2 restart / máy chủ reboot giữa lúc chờ vẫn không mất lịch.
function xepDinhChinh(khoa, r, ngay, homNay, m) {
    const cho = { ngay, nuoc: m, intraday: !!homNay, label: r.label, luc: Date.now(), so: r.so };
    cho.hanTs = hanDinhChinh(cho, DC_GIO);
    markState((s) => { (s.dinhChinh = s.dinhChinh || {})[khoa] = cho; });
    log(`Tin ${m} "${r.label}" gửi khi số CHƯA ĐỦ — chờ vòng sync đủ số để đính chính (hạn ${new Date(cho.hanTs).toISOString()}).`);
}

async function ratDinhChinh() {
    const cho = loadState().dinhChinh || {};
    const khoa = Object.keys(cho);
    if (!khoa.length) return;                       // không có gì chờ → không hỏi sync-health
    const stale = await fetchStale();
    for (const k of khoa) {
        const p = cho[k];
        const xoa = () => markState((s) => { if (s.dinhChinh) delete s.dinhChinh[k]; });
        // Lịch chờ của tin gộp cũ (trước 08/10/2026, không gắn nước) — nhóm đó đã bỏ.
        if (!p || !NUOC[p.nuoc] || !nhomNuoc[p.nuoc]) { xoa(); log(`Bỏ chờ đính chính "${k}" — không có nhóm nước để gửi.`); continue; }
        const act = canDinhChinh(p, stale);
        if (!act) continue;
        if (act === "het-han") { xoa(); log(`Bỏ chờ đính chính ${p.nuoc} "${p.label}" — quá hạn mà số vẫn chưa đủ.`); continue; }
        if (inQuietHours()) return;                 // 23h–7h: không đánh thức nhóm, vòng sau gửi
        try {
            await lanLuot(async () => {
                const r = await dungBaoCao(p.nuoc, p.ngay, p.intraday, p.label, stale);
                await guiLoat([buildTinDinhChinh({
                    tin: r.tinGop, soCu: p.so, soMoi: r.so, label: `${NUOC[p.nuoc].flag} ${p.label}`, luc: p.luc, intraday: p.intraday,
                })], nhomNuoc[p.nuoc]);
            });
            xoa();
            log(`Đã gửi đính chính ${p.nuoc} "${p.label}".`);
        } catch (e) {
            if (e.daGui > 0) { xoa(); log(`Đính chính ${p.nuoc} "${p.label}" gửi được một phần — không gửi lại:`, e.message); }
            else log(`Đính chính ${p.nuoc} "${p.label}" lỗi — vòng sau thử lại:`, e.message);
        }
    }
}

// ─── Lệnh trong nhóm ───
const lanCuoi = new Map();     // chữ lệnh → lúc nhận; cùng lệnh trong 60 giây thì bỏ (bấm gửi hai lần)

const tinHuongDan = (m) => huongDanNuoc({
    nuoc: NUOC[m], at: DAILY_AT, mocAds: INTRADAY_SLOTS.join(" · "), nguoi: NGUOI,
    moiGio: MG_MARKETS.includes(m) ? mocMoiGio() : null,
    vanDon: VD_MARKETS.includes(m) ? { at: VD_AT, toi: VD_TOI, nguon: NGUON_NUOC[m] } : null,
});

// m: nước của nhóm lệnh được gõ (null = dòng lệnh, dùng --nuoc hoặc mọi nước). Mọi lệnh chỉ
// trả số của ĐÚNG nước đó: nhóm Nhật không thấy số Đài, nhóm UAE không thấy SĐT khách Singapore.
async function lamLenh(text, ai = "dòng lệnh", m = null) {
    const lenh = docLenh(text, { today: vnDateStr(), nguoi: NGUOI });
    if (!lenh) return false;
    const nuoc = m ? [m] : (argAfter("--nuoc") ? [argAfter("--nuoc").toUpperCase()] : CAC_NUOC);
    const khoa = `${m || "cli"}:${String(text).trim().toLowerCase()}`;
    if (Date.now() - (lanCuoi.get(khoa) || 0) < 60000) { log(`Bỏ lệnh lặp "${khoa}" từ ${ai}.`); return true; }
    lanCuoi.set(khoa, Date.now());
    log(`Lệnh "${String(text).trim()}" từ ${ai}${m ? ` (nhóm ${m})` : ""}.`);

    for (const x of nuoc) {
        if (!NUOC[x]) { log(`Bỏ nước lạ ${x}.`); continue; }
        const nhom = nhomCua(x);
        if (!nhom) { log(`Bỏ ${x}: chưa có nhóm.`); continue; }
        await lanLuot(async () => {
            try {
                if (lenh.loi) { await guiMot(`⚠️ ${lenh.loi}`, nhom); return; }
                if (lenh.lenh === "trogiup") { await guiMot(tinHuongDan(x), nhom); return; }
                if (lenh.lenh === "gio") {
                    if (!MG_MARKETS.includes(x)) { await guiMot(`ℹ️ ${NUOC[x].ten} chưa bật tin mỗi giờ — gõ /baocao để xem số hôm nay.`, nhom); return; }
                    // Gõ tay không ghi "lần trước": giữ mốc (+N) của tin tự gửi đúng giờ.
                    await guiLoat([(await dungTinGio(x)).text], nhom);
                    return;
                }
                if (lenh.lenh === "vandon") {
                    if (!VD_MARKETS.includes(x)) { await guiMot(`ℹ️ ${NUOC[x].ten} chưa theo dõi vận đơn — làm khi có đơn và biết hãng giao.`, nhom); return; }
                    await guiLoat([(await dungTinVanDon(x, "")).text], nhom);
                    return;
                }
                if (lenh.lenh === "canhbao") {
                    const nay = vnDateStr();
                    await guiMot(buildCanhBaoNuoc((await layRealtime(nay)).campaigns, CFG, x, nay), nhom);
                    return;
                }
                const r = await dungBaoCao(x, lenh.ngay, lenh.homNay);
                const tin = lenh.loc === "team" ? r.teamMessage : lenh.loc ? r.tinNguoi(lenh.loc) : r.tinGop;
                log(`Đã trả lệnh ở ${x}: ${await guiLoat([tin], nhom)} tin.`);
            } catch (e) {
                log(`Lệnh lỗi (${x}):`, e.message);
                if (e.daGui > 0) return;                   // gửi được một phần rồi — không chen tin lỗi vào giữa
                const bao = lenh.lenh === "vandon" ? `⚠️ Chưa lấy được danh sách vận đơn lúc này (${e.message}). Lát nữa gõ lại.`
                    : /Sheet chưa có dòng/.test(e.message)
                        ? `⚠️ Sheet chưa có số ngày ${ddmm(lenh.ngay)} — vòng ghi Sheet chạy mỗi giờ phút 20, lát nữa gõ lại.`
                        : `⚠️ Chưa lấy được số lúc này (${e.message}). Lát nữa gõ lại.`;
                try { await guiMot(bao, nhom); } catch (e2) { log("Không gửi được tin báo lỗi:", e2.message); }
            }
        });
    }
    return true;
}

// Chỉ nghe ĐÚNG các nhóm nước. Nick phụ còn ở các nhóm COD có người của đối tác, và ở nhóm cũ
// (BÁO CÁO ADS, VẬN ĐƠN …) — gõ /baocao ở đó bot im, không lộ số ra ngoài.
function xuLyTin(msg) {
    if (!zalo || msg.type !== zalo.ThreadType.Group) return;
    const m = Object.keys(nhomNuoc).find((x) => nhomNuoc[x] && nhomNuoc[x].id === msg.threadId) || null;
    if (!m) return;
    const text = typeof msg.data.content === "string" ? msg.data.content : "";
    if (!text.trim().startsWith("/")) return;
    lamLenh(text, msg.data.dName || msg.data.uidFrom, m).catch((e) => log("Lỗi xử lý lệnh:", e.message));
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

// ─── Mốc tự gửi ───
// Rà theo vòng 5' chứ không hẹn giờ: pm2 restart lúc 08:29 là mất sạch timer. Đổi lại vòng
// rà tự lo hai việc: chống bắn lại (state ghi TỪNG mốc, TỪNG nước) và chống bắn MUỘN (cửa sổ
// bù). Dựng tin hỏng (Sheet chưa có dòng, dashboard lỗi) → CHƯA đánh dấu, vòng sau thử lại
// trong cửa sổ. Gửi được ít nhất một tin rồi mới hỏng → vẫn đánh dấu, để không gửi lặp.
// quaGioYen: mốc mà chính lịch đã đặt trong giờ yên (tin mỗi giờ tới 23:05) — gửi luôn, không chờ.
async function chayMoc(khoa, moc, cuaSo, lamViec, { quaGioYen = false } = {}) {
    const today = vnDateStr();
    const act = slotAction(moc, vnHHMM(), (loadState().moc || {})[khoa], today, cuaSo);
    if (!act) return;
    const danhDau = () => markState((s) => { (s.moc = s.moc || {})[khoa] = today; });
    if (act === "skip") { danhDau(); log(`Bỏ mốc ${khoa} hôm nay (quá cửa sổ ${cuaSo}', bây giờ ${vnHHMM()}).`); return; }
    if (!quaGioYen && inQuietHours()) return;
    try {
        const r = await lamViec();
        danhDau();
        log(`Đã gửi mốc ${khoa}: ${r.ghiChu}.`);
    } catch (e) {
        if (e.daGui > 0) danhDau();
        log(`Mốc ${khoa} lỗi${e.daGui > 0 ? ` sau ${e.daGui} tin — không gửi lại` : " — vòng sau thử lại"}:`, e.message);
    }
}

// Một mốc chạy lần lượt mọi nước (ads trước); 08:30 và 22:00 xong ads mới tới vận đơn — trong
// một nhóm, tin ads luôn đứng trước tin vận đơn cùng mốc.
async function ratMoc() {
    const hq = homQua(vnDateStr());
    const coNhom = CAC_NUOC.filter((m) => nhomNuoc[m]);
    for (const m of coNhom) {
        await chayMoc(`ads:${m}:sang`, DAILY_AT, Number(DR.atCatchUpMinutes || 210),
            () => guiBaoCao(m, hq, { theoDoi: `sang:${m}:${hq}`, kieu: "sang" }));
    }
    // Vận đơn: dashboard lỗi thì vòng 5' sau thử lại, quá catchUpMinutes thì bỏ hôm đó. Khoá
    // "vandon:<nước>" giữ như trước 08/10/2026 — hôm đổi nhóm không gửi lại tin đã gửi sáng nay.
    for (const m of VD_MARKETS.filter((x) => nhomNuoc[x])) {
        if (VD_AT) await chayMoc(`vandon:${m}`, VD_AT, Number(VD.catchUpMinutes || 180), () => guiVanDon(m, "sang"));
    }
    for (const slot of INTRADAY_SLOTS) {
        const nay = vnDateStr();
        for (const m of coNhom) {
            await chayMoc(`ads:${m}:${slot}`, slot, Number(DR.intradayCatchUpMinutes || 60),
                () => guiBaoCao(m, nay, { homNay: true, label: slotLabel(slot), theoDoi: `${slot}:${m}:${nay}`, kieu: kieuMoc(slot), moc: slot }));
        }
    }
    for (const m of VD_MARKETS.filter((x) => nhomNuoc[x])) {
        if (VD_TOI) await chayMoc(`vandon_toi:${m}`, VD_TOI, Number(VD.toiCatchUpMinutes || 60), () => guiVanDon(m, "toi"));
    }
    // Tin mỗi giờ: trễ quá catchUpMinutes thì bỏ giờ đó (bot vừa bật lại lúc 15:20 không bắn
    // lại 7 giờ đã qua — slotAction trả "skip" cho các giờ cũ). Mốc 23:05 rơi vào giờ yên
    // (23h–7h) nên đêm 09/10 và 10/10/2026 đều bị chặn tới quá cửa sổ rồi bỏ → quaGioYen.
    for (const m of MG_MARKETS.filter((x) => nhomNuoc[x])) {
        for (const moc of mocMoiGio()) await chayMoc(`gio:${m}:${moc}`, moc, Number(MG.catchUpMinutes || 40), () => guiTinGio(m), { quaGioYen: true });
    }
}

async function giuPhien() {
    if (!api) return;
    try { await api.keepAlive(); zalo.luuPhien(api); }
    catch (e) { log("keepAlive lỗi — lần gửi tới sẽ đăng nhập lại:", e.message); api = null; }
}

async function gioiThieuNeuMoi() {
    for (const m of CAC_NUOC) {
        const nhom = nhomNuoc[m];
        if (!nhom || (loadState().gioiThieu || {})[nhom.id]) continue;
        await lanLuot(() => guiMot(tinHuongDan(m), nhom));
        markState((s) => { (s.gioiThieu = s.gioiThieu || {})[nhom.id] = new Date().toISOString(); });
        log(`Đã gửi tin giới thiệu vào nhóm "${nhom.name}".`);
    }
}

function docCacNhom() {
    nhomNuoc = Object.fromEntries(CAC_NUOC.map((m) => [m, zalo.docNhomNuoc(m)]).filter(([, g]) => g));
}

// Nước chưa có file nhóm → tìm trong các nhóm nick phụ đang ở, theo đúng mẫu tên "ADS + VẬN ĐƠN
// <nước>" (rules.nuocTuTenNhom). Một nước khớp hai nhóm trở lên thì KHÔNG đoán.
async function tuNhanNhom() {
    const thieu = CAC_NUOC.filter((m) => !nhomNuoc[m]);
    if (!thieu.length) return;
    let ds;
    try { ds = await zalo.danhSachNhom(await ketNoi()); }
    catch (e) { log("Không đọc được danh sách nhóm để tự nhận:", e.message); return; }
    const { chon, trung, thieu: van } = chonNhomTheoTen(ds, thieu);
    for (const [m, g] of Object.entries(chon)) {
        zalo.ghiNhomNuoc(m, g, "tu-nhan");
        log(`Tự nhận nhóm ${m}: "${g.name}" (${g.id}).`);
    }
    for (const [m, xs] of Object.entries(trung)) log(`${m}: ${xs.length} nhóm cùng mẫu tên — không tự chọn (${xs.map((g) => g.id).join(", ")}). Chọn tay: node pair.js --chon-nuoc <id> --nuoc ${m}`);
    for (const m of van) log(`${m}: nick phụ chưa ở nhóm "ADS + VẬN ĐƠN ${NUOC[m].ten.toUpperCase()}" — chưa gửi gì cho ${m}.`);
    docCacNhom();
}

async function chayDichVu() {
    dichVu = true;
    log(`Dashboard base: ${CFG.dashboardBaseUrl}${process.env.TALPHA_DASHBOARD_URL ? " (env TALPHA_DASHBOARD_URL)" : ""}`);
    zalo = require("./zalo");
    // Đăng nhập hỏng / chưa ghép: KHÔNG thoát — pm2 sẽ khởi động lại liên tục và che mất lỗi
    // thật. Đứng chờ, 10' thử lại một lần.
    for (;;) {
        docCacNhom();
        try { await ketNoi(); await tuNhanNhom(); }
        catch (e) { log("Đăng nhập Zalo lỗi:", e.message); }
        if (api && Object.keys(nhomNuoc).length) break;
        if (api) log("Chưa có nhóm nước nào — thêm nick phụ vào nhóm \"ADS + VẬN ĐƠN <nước>\" rồi đợi, hoặc chạy `node pair.js --tu-nhan`.");
        await sleep(10 * 60 * 1000);
    }
    for (const m of CAC_NUOC) {
        const g = nhomNuoc[m];
        if (g) log(`Nhóm ${m} "${g.name}" (${g.id}) · ads ${[DAILY_AT, ...INTRADAY_SLOTS].join(" + ")}`
            + (VD_MARKETS.includes(m) ? ` · vận đơn ${[VD_AT, VD_TOI].filter(Boolean).join(" + ") || "(tắt)"}` : " · chưa có vận đơn")
            + " · nghe lệnh.");
        else log(`Chưa có nhóm ${m} — không gửi gì cho ${m}.`);
    }

    try { await gioiThieuNeuMoi(); } catch (e) { log("Tin giới thiệu lỗi:", e.message); }

    let dangRa = false;                 // không để hai vòng rà chồng nhau khi một vòng gửi lâu
    const vongMoc = async () => {
        if (dangRa) return;
        dangRa = true;
        try {
            // Nhóm nào còn thiếu thì mỗi vòng thử tự nhận lại — Sỹ Anh thêm nick vào nhóm là vòng sau tự gửi.
            if (CAC_NUOC.some((m) => !nhomNuoc[m])) { await tuNhanNhom(); await gioiThieuNeuMoi(); }
            await ratMoc(); await ratDinhChinh();
        }
        catch (e) { log("Vòng rà lỗi:", e.message); }
        finally { dangRa = false; }
    };
    await vongMoc();
    setInterval(vongMoc, 5 * 60 * 1000);
    setInterval(giuPhien, 60 * 60 * 1000);
}

async function main() {
    const lenh = argAfter("--lenh");
    if (lenh || ARGS.includes("--report") || ARGS.includes("--vandon") || ARGS.includes("--moc") || ARGS.includes("--gio")) {
        if (!DRY) { zalo = require("./zalo"); docCacNhom(); }
        const nuoc = argAfter("--nuoc") ? [argAfter("--nuoc").toUpperCase()] : null;
        if (nuoc && !NUOC[nuoc[0]]) throw new Error(`--nuoc lạ: ${nuoc[0]} (có: ${CAC_NUOC.join(", ")})`);
        if (ARGS.includes("--gio")) {
            // --gio [--nuoc JP]: gửi ngay tin mỗi giờ (không ghi mốc "lần trước").
            for (const m of (nuoc || MG_MARKETS)) {
                if (!nhomCua(m)) { log(`Bỏ ${m}: chưa có nhóm.`); continue; }
                const r = await guiTinGio(m, false);
                log(`${DRY ? "In thử" : "Đã gửi"} ${r.ghiChu}.`);
            }
        } else if (ARGS.includes("--vandon")) {
            // --vandon [sang|toi] [--nuoc SG]: gửi ngay (mặc định: khuôn sáng, mọi nước có vận đơn).
            const kieu = ["sang", "toi"].includes(argAfter("--vandon")) ? argAfter("--vandon") : "sang";
            for (const m of (nuoc || VD_MARKETS)) {
                if (!VD_MARKETS.includes(m)) { log(`Bỏ ${m}: chưa theo dõi vận đơn.`); continue; }
                if (!nhomCua(m)) { log(`Bỏ ${m}: chưa có nhóm.`); continue; }
                await guiVanDon(m, kieu);
                log(`${DRY ? "In thử" : "Đã gửi"} tin vận đơn ${m} (${kieu}).`);
            }
        } else if (ARGS.includes("--moc")) {
            // --moc 13:00: gửi ngay tin của một mốc giữa ngày (khuôn trưa/chiều/tối), số hôm nay.
            const moc = /^\d{1,2}:\d{2}$/.test(argAfter("--moc")) ? argAfter("--moc") : (INTRADAY_SLOTS[0] || "13:00");
            const nay = vnDateStr();
            for (const m of (nuoc || CAC_NUOC)) {
                if (!nhomCua(m)) { log(`Bỏ ${m}: chưa có nhóm.`); continue; }
                const r = await guiBaoCao(m, nay, { homNay: true, label: slotLabel(moc), theoDoi: `${moc}:${m}:${nay}`, kieu: kieuMoc(moc), moc, nho: false });
                log(`${DRY ? "In thử" : "Đã gửi"} mốc ${moc}: ${r.ghiChu}.`);
            }
        } else if (lenh) {
            if (!(await lamLenh(lenh, "dòng lệnh", null))) log(`"${lenh}" không phải lệnh của bot.`);
        } else {
            const ngay = /^\d{4}-\d{2}-\d{2}$/.test(argAfter("--report")) ? argAfter("--report") : homQua(vnDateStr());
            for (const m of (nuoc || CAC_NUOC)) {
                if (!nhomCua(m)) { log(`Bỏ ${m}: chưa có nhóm.`); continue; }
                const r = await guiBaoCao(m, ngay, { theoDoi: `report:${m}:${ngay}` });
                log(`${DRY ? "In thử" : "Đã gửi"} báo cáo ${m} ngày ${ngay}: ${r.ghiChu}.`
                    + (r.chuaDu ? " SỐ CHƯA ĐỦ — bot dịch vụ sẽ tự gửi tin đính chính khi sync đủ số." : ""));
            }
        }
        return true;
    }
    await chayDichVu();
    return false;
}

main()
    .then((motLan) => { if (motLan) setTimeout(() => process.exit(0), 1000); })
    .catch((e) => { log("LỖI:", e.message); process.exit(1); });

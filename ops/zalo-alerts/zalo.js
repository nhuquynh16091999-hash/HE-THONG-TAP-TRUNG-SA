// Kết nối Zalo bằng tài khoản PHỤ qua zca-js — thư viện KHÔNG chính thức, giả làm Zalo Web.
//
// Hệ quả phải biết (Sỹ Anh chọn cách này 15/09/2026, đã được nói rõ rủi ro):
//   - Trái điều khoản Zalo, nick có thể bị khoá → chỉ dùng nick PHỤ, không dùng nick chính.
//   - Zalo chỉ cho MỘT phiên web mỗi nick: mở Zalo Web / Zalo PC bằng nick phụ ở máy khác
//     là phiên của bot bị đá ra, bot im lặng cho tới khi ghép lại (`node pair.js`).
//   - Phiên (cookie + imei + userAgent) là KHOÁ ĐĂNG NHẬP: nằm trong .zalo_session.json,
//     quyền 600, gitignore, không in ra log, không chép đi đâu.
const fs = require("fs");
const path = require("path");
const { Zalo, ThreadType, LoginQRCallbackEventType: E } = require("zca-js");
const { toZalo, chiaTin } = require("./zalo_text");

const DIR = __dirname;
const SESSION_FILE = path.join(DIR, ".zalo_session.json");
const QR_FILE = path.join(DIR, "qr.png");
// Trạng thái đăng nhập cho dashboard (12/11/2026): phiên chết 03/11 mà 9 ngày không ai biết, vì
// bot mất đăng nhập thì chính nó không nhắn được vào Zalo. Dashboard đọc file này để hiện băng
// đỏ cho giám đốc, và ghi QR_REQUEST_FILE khi giám đốc bấm "Quét QR" — bot tự làm mã ngay.
const STATUS_FILE = path.join(DIR, "zalo_status.json");
const QR_REQUEST_FILE = path.join(DIR, "zalo_qr_request.json");
// MỖI NƯỚC MỘT NHÓM "ADS + VẬN ĐƠN <nước>" (Sỹ Anh chốt 08/10/2026) — tin ads của nước đó
// và tin vận đơn của nước đó chung một nhóm. Nhóm cũ (BÁO CÁO ADS gộp các nước: zalo_group.json;
// VẬN ĐƠN TW/SGP/UAE: zalo_group_vandon*.json) bỏ hẳn — bot không đọc các file đó nữa.
//   zalo_group_nuoc_<mã>.json   `node pair.js --tu-nhan` (theo tên nhóm) hoặc `--chon-nuoc <id> --nuoc TW`
const fileNhomNuoc = (m) => path.join(DIR, `zalo_group_nuoc_${String(m).toLowerCase().replace(/[^a-z]/g, "")}.json`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function docJson(file) {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

// Ghi file quyền 600 qua file tạm rồi đổi tên: chết giữa chừng không để lại phiên cụt.
function ghiRieng(file, obj) {
    const tam = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tam, JSON.stringify(obj, null, 2), { mode: 0o600 });
    fs.renameSync(tam, file);
    fs.chmodSync(file, 0o600);
}

// checkUpdate: false — không gọi npm mỗi lần đăng nhập. logging: false — log của bot tự lo.
// selfListen: true — người cầm điện thoại nick phụ gõ /baocao cũng phải được nghe. Tin
// báo cáo của chính bot cũng lọt vào, nhưng không bắt đầu bằng "/" nên bộ đọc lệnh bỏ qua.
const taoZalo = () => new Zalo({ selfListen: true, checkUpdate: false, logging: false });

/** Lưu lại phiên từ api đang chạy (cookie Zalo có thể được làm mới sau đăng nhập). */
function luuPhien(api, them = {}) {
    const cu = docJson(SESSION_FILE) || {};
    const ctx = api.getContext();
    const jar = ctx.cookie && typeof ctx.cookie.toJSON === "function" ? ctx.cookie.toJSON() : null;
    ghiRieng(SESSION_FILE, {
        ...cu, ...them,
        imei: ctx.imei || cu.imei,
        userAgent: ctx.userAgent || cu.userAgent,
        language: ctx.language || cu.language || "vi",
        cookie: (jar && jar.cookies) || cu.cookie,
        savedAt: new Date().toISOString(),
    });
}

/** Đăng nhập bằng phiên đã ghép. Chưa ghép → lỗi nói rõ phải làm gì. */
async function dangNhap() {
    const s = docJson(SESSION_FILE);
    if (!s || !s.imei || !s.cookie || !s.userAgent) {
        throw new Error("chưa ghép nick Zalo — chạy `node pair.js` rồi quét QR");
    }
    const api = await taoZalo().login({ imei: s.imei, cookie: s.cookie, userAgent: s.userAgent, language: s.language || "vi" });
    luuPhien(api);
    return api;
}

/**
 * Đăng nhập bằng QR (nick PHỤ quét). Mã ghi ra qr.png, hết hạn ~100 giây, tự làm mã mới tối đa
 * `soLan` lần. Phiên ghi NGAY lúc Zalo trả (chưa đợi đăng nhập xong): bước sau hỏng vẫn khỏi quét lại.
 * `bao(su_kien, du_lieu)` báo từng bước cho bên gọi (pair.js in ra; bot ghi zalo_status.json).
 */
async function ghepQR({ soLan = 5, bao = () => {} } = {}) {
    let lan = 0, ten = "";
    const api = await taoZalo().loginQR({ qrPath: QR_FILE }, async (ev) => {
        switch (ev.type) {
            case E.QRCodeGenerated:
                lan++;
                await ev.actions.saveToFile(QR_FILE);
                bao("qr", { lan, soLan, hetHan: new Date(Date.now() + 100_000).toISOString() });
                break;
            case E.QRCodeExpired:
                if (lan >= soLan) { bao("het", { lan }); ev.actions.abort(); }
                else ev.actions.retry();
                break;
            case E.QRCodeScanned:
                ten = ev.data.display_name || "";
                bao("quet", { ten });
                break;
            case E.QRCodeDeclined:
                bao("tuchoi", {});
                ev.actions.abort();
                break;
            case E.GotLoginInfo:
                ghiRieng(SESSION_FILE, { ...ev.data, language: "vi", name: ten, savedAt: new Date().toISOString() });
                bao("luu", {});
                break;
        }
    });
    try { fs.unlinkSync(QR_FILE); } catch { /* không có thì thôi */ }
    if (!api) throw new Error(lan >= soLan ? `QR hết hạn ${lan} lần, chưa ai quét` : "đăng nhập QR bị huỷ");
    luuPhien(api, { name: ten });
    return api;
}

/** Ghi trạng thái đăng nhập cho dashboard (gộp vào bản cũ, ghi qua file tạm). */
function ghiTrangThai(them) {
    const cu = docJson(STATUS_FILE) || {};
    const moi = { ...cu, ...them, capNhat: new Date().toISOString() };
    const tam = `${STATUS_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tam, JSON.stringify(moi, null, 2) + "\n");
    fs.renameSync(tam, STATUS_FILE);
    return moi;
}

/** Nhóm "ADS + VẬN ĐƠN" của một nước. null = chưa chọn → bot không gửi gì cho nước đó. */
function docNhomNuoc(m) {
    const g = docJson(fileNhomNuoc(m));
    return g && g.id ? g : null;
}

function ghiNhomNuoc(m, g, cach = "") {
    fs.writeFileSync(fileNhomNuoc(m), JSON.stringify({ id: g.id, name: g.name, nuoc: String(m).toUpperCase(),
        chonLuc: new Date().toISOString(), ...(cach ? { cach } : {}) }, null, 2) + "\n");
    return fileNhomNuoc(m);
}

async function danhSachNhom(api) {
    const { gridVerMap } = await api.getAllGroups();
    const ids = Object.keys(gridVerMap || {});
    const out = [];
    for (let i = 0; i < ids.length; i += 50) {
        const info = await api.getGroupInfo(ids.slice(i, i + 50));
        for (const [id, g] of Object.entries(info.gridInfoMap || {})) {
            out.push({ id, name: g.name || "(không tên)", members: g.totalMember });
        }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, "vi"));
}

/** Gửi một bản tin vào nhóm: đổi chữ đậm sang style Zalo, dài quá thì chia nhiều tin. */
async function guiNhom(api, groupId, text, { maxChars = 1800, sendGapMs = 4000 } = {}) {
    const phan = chiaTin(toZalo(text), maxChars);
    for (let i = 0; i < phan.length; i++) {
        const p = phan[i];
        const giau = p.styles.length || (p.mentions && p.mentions.length);
        await api.sendMessage(giau ? { msg: p.msg, styles: p.styles, mentions: p.mentions || [] } : p.msg, groupId, ThreadType.Group);
        if (i < phan.length - 1) await sleep(sendGapMs);
    }
    return phan.length;
}

/**
 * Nghe tin trong các nhóm để bắt lệnh. zca-js tự nối lại khi rớt mạng (retryOnClose);
 * "closed" chỉ phát khi nó THÔI nối — thường vì có phiên web khác của nick phụ chen vào
 * (mở Zalo Web / Zalo PC). Bên gọi quyết định đăng nhập lại lúc nào.
 */
function batNghe(api, { onMessage, onClosed, log }) {
    const l = api.listener;
    l.on("connected", () => log("Bộ nhận lệnh Zalo đã kết nối."));
    l.on("message", onMessage);
    l.on("error", (e) => log("Bộ nhận lệnh lỗi:", (e && e.message) || e));
    l.on("closed", (code, reason) => onClosed(l, code, reason));
    l.start({ retryOnClose: true });
    return l;
}

module.exports = {
    SESSION_FILE, QR_FILE, STATUS_FILE, QR_REQUEST_FILE, fileNhomNuoc, ThreadType,
    taoZalo, ghiRieng, luuPhien, dangNhap, ghepQR, ghiTrangThai, docJson, docNhomNuoc, ghiNhomNuoc, danhSachNhom, guiNhom, batNghe,
};

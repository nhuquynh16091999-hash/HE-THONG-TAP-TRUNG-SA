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
const { Zalo, ThreadType } = require("zca-js");
const { toZalo, chiaTin } = require("./zalo_text");

const DIR = __dirname;
const SESSION_FILE = path.join(DIR, ".zalo_session.json");
const GROUP_FILE = path.join(DIR, "zalo_group.json");
// Nhóm nhận tin VẬN ĐƠN (Sỹ Anh chốt 25/09/2026: nhóm riêng, không phải nhóm ads — tin có
// tên + SĐT khách). MỖI nước một nhóm (26/09/2026: VẬN ĐƠN TW, VẬN ĐƠN SGP):
//   Đài   → zalo_group_vandon.json      `node pair.js --chon-vandon <id>`
//   nước khác → zalo_group_vandon_<mã>.json  `node pair.js --chon-vandon <id> --nuoc SG`
const GROUP_VANDON_FILE = path.join(DIR, "zalo_group_vandon.json");
const fileNhomVanDon = (m = "TW") => (String(m).toUpperCase() === "TW" ? GROUP_VANDON_FILE
    : path.join(DIR, `zalo_group_vandon_${String(m).toLowerCase().replace(/[^a-z]/g, "")}.json`));
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

/** Nhóm nhận tin, chọn bằng `node pair.js --chon <id>`. null = chưa chọn. */
function docNhomDich() {
    const g = docJson(GROUP_FILE);
    return g && g.id ? g : null;
}

/** Nhóm nhận tin vận đơn của một nước. null = chưa chọn → bot không gửi tin vận đơn nước đó. */
function docNhomVanDon(m = "TW") {
    const g = docJson(fileNhomVanDon(m));
    return g && g.id ? g : null;
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
    SESSION_FILE, GROUP_FILE, GROUP_VANDON_FILE, fileNhomVanDon, ThreadType,
    taoZalo, ghiRieng, luuPhien, dangNhap, docNhomDich, docNhomVanDon, danhSachNhom, guiNhom, batNghe,
};

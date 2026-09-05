// Trang ghép nối WhatsApp: mở http://<server>:3099 bằng trình duyệt để quét QR
// (tự làm mới mỗi 6s). Sau khi ghép xong, trang liệt kê các nhóm để lấy tên.
const fs = require("fs");
const path = require("path");
const http = require("http");
const QRCode = require("qrcode");
const { Client, LocalAuth } = require("whatsapp-web.js");

const DIR = __dirname;
const PORT = 3099;
const log = (...a) => console.log(new Date().toISOString(), ...a);

let qrSvg = null, paired = false, groups = [];

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: path.join(DIR, ".wwebjs_auth") }),
    puppeteer: { headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] },
});

client.on("qr", async (qr) => {
    qrSvg = await QRCode.toString(qr, { type: "svg", margin: 1, width: 320 });
    log("QR mới (mở trang web để quét).");
});
client.on("ready", async () => {
    paired = true;
    log("ĐÃ GHÉP — đang chờ store WhatsApp nạp để lấy nhóm…");
    for (let i = 0; i < 15; i++) {
        try {
            const chats = await client.getChats();
            groups = chats.filter(c => c.isGroup).map(g => g.name);
            fs.writeFileSync(path.join(DIR, "groups.txt"), groups.join("\n"));
            log(`Lấy nhóm OK (${groups.length}):`, groups);
            return;
        } catch (e) {
            log(`getChats thử lại lần ${i + 1}:`, e.message);
            await new Promise(r => setTimeout(r, 5000));
        }
    }
    log("⚠️ Không lấy được nhóm sau nhiều lần thử.");
});
client.on("auth_failure", m => log("AUTH FAIL:", m));

// Bắt ID nhóm từ tin nhắn (vòng qua getChats bị lỗi version). Gửi 1 tin bất kỳ trong
// nhóm đích → log ra id @g.us để đưa vào config.
client.on("message_create", (m) => {
    try {
        const gid = (m.from || "").endsWith("@g.us") ? m.from : ((m.to || "").endsWith("@g.us") ? m.to : null);
        if (gid) {
            log(`GROUP_MSG id=${gid} name=${m._data && m._data.notifyName || "?"} body="${(m.body || "").slice(0, 40)}"`);
            const seen = new Set();
            try { require("fs").readFileSync(path.join(DIR, "group_ids.txt"), "utf8").split("\n").forEach(x => seen.add(x.trim())); } catch {}
            if (!seen.has(gid)) require("fs").appendFileSync(path.join(DIR, "group_ids.txt"), gid + "\n");
        }
    } catch (e) { log("msg listener err:", e.message); }
});

http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    if (paired) {
        res.end(`<html><head><meta charset="utf8"><title>TALPHA WA</title></head>
        <body style="font-family:sans-serif;text-align:center;padding:40px">
        <h2>✅ Đã ghép WhatsApp thành công!</h2>
        <p>Các nhóm bot nhìn thấy — báo tên nhóm đích cho Claude:</p>
        <ul style="display:inline-block;text-align:left">${groups.map(g => `<li><b>${g}</b></li>`).join("")}</ul>
        <p style="color:#888">Có thể đóng tab này.</p></body></html>`);
    } else if (qrSvg) {
        res.end(`<html><head><meta charset="utf8"><meta http-equiv="refresh" content="6"><title>Quét QR TALPHA</title></head>
        <body style="font-family:sans-serif;text-align:center;padding:24px">
        <h3>Quét QR bằng WhatsApp</h3>
        <p>WhatsApp → Cài đặt → Thiết bị đã liên kết → Liên kết thiết bị</p>
        <div style="display:inline-block">${qrSvg}</div>
        <p style="color:#888">Trang tự làm mới mỗi 6 giây. Quét xong sẽ hiện danh sách nhóm.</p></body></html>`);
    } else {
        res.end(`<html><head><meta http-equiv="refresh" content="3"></head><body style="font-family:sans-serif;text-align:center;padding:40px">Đang tạo mã QR…</body></html>`);
    }
}).listen(PORT, () => log(`Trang ghép nối: http://<server-ip>:${PORT}`));

client.initialize();

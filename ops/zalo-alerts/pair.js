// Ghép nick Zalo PHỤ cho bot — chạy TRÊN MÁY CHỦ, trong thư mục này:
//   node pair.js                   đăng nhập bằng QR → lưu phiên → in danh sách nhóm
//   node pair.js --groups          dùng phiên đã lưu, in lại danh sách nhóm
//   node pair.js --chon <id nhóm>  chọn nhóm nhận tin ADS → zalo_group.json
//   node pair.js --chon-vandon <id nhóm> [--nuoc SG]  chọn nhóm nhận tin VẬN ĐƠN của một nước
//                                  (Đài → zalo_group_vandon.json, SG → zalo_group_vandon_sg.json)
//
// Ghép TRÊN MÁY CHỦ chứ không ghép ở máy Mac rồi chép phiên lên: phiên sinh ra ở IP nào
// thì dùng ở IP đó, Zalo ít hỏi lại. QR ghi ra qr.png — hết hạn sau ~100 giây, tự làm mã
// mới tối đa 5 lần. Nick phụ phải NẰM SẴN trong nhóm đích.
// Ghép lại khi bot đang chạy: xong thì `pm2 restart talpha-zalo-alerts` để bot nạp phiên mới.
const fs = require("fs");
const path = require("path");
const { LoginQRCallbackEventType: E } = require("zca-js");
const { SESSION_FILE, GROUP_FILE, fileNhomVanDon, taoZalo, ghiRieng, luuPhien, dangNhap, danhSachNhom } = require("./zalo");

const QR_FILE = path.join(__dirname, "qr.png");
const GROUPS_FILE = path.join(__dirname, "groups.txt");
const SO_LAN_QR = 5;
const log = (...a) => console.log(new Date().toISOString(), ...a);

function argAfter(flag) {
    const i = process.argv.indexOf(flag);
    const v = i >= 0 ? process.argv[i + 1] : "";
    return v && !v.startsWith("--") ? v : "";
}

async function ghepQR() {
    let lan = 0, ten = "";
    const api = await taoZalo().loginQR({ qrPath: QR_FILE }, async (ev) => {
        switch (ev.type) {
            case E.QRCodeGenerated:
                lan++;
                await ev.actions.saveToFile(QR_FILE);
                log(`QR_READY lần ${lan}/${SO_LAN_QR}: ${QR_FILE} — mở app Zalo của NICK PHỤ → quét mã (còn ~100 giây)`);
                break;
            case E.QRCodeExpired:
                if (lan >= SO_LAN_QR) { log(`QR hết hạn ${lan} lần — dừng. Sẵn sàng quét thì chạy lại.`); ev.actions.abort(); }
                else { log("QR hết hạn — làm mã mới"); ev.actions.retry(); }
                break;
            case E.QRCodeScanned:
                ten = ev.data.display_name || "";
                log(`ĐÃ QUÉT bởi "${ten}" — bấm XÁC NHẬN đăng nhập trên điện thoại`);
                break;
            case E.QRCodeDeclined:
                log("Điện thoại đã TỪ CHỐI đăng nhập — dừng.");
                ev.actions.abort();
                break;
            case E.GotLoginInfo:
                // Ghi phiên NGAY lúc có, chưa đợi đăng nhập xong: bước sau hỏng thì vẫn không phải quét lại.
                ghiRieng(SESSION_FILE, { ...ev.data, language: "vi", name: ten, savedAt: new Date().toISOString() });
                log("Đã lưu phiên vào .zalo_session.json (quyền 600).");
                break;
        }
    });
    luuPhien(api, { name: ten });
    try { fs.unlinkSync(QR_FILE); } catch {}
    return api;
}

async function inNhom(api) {
    const nhom = await danhSachNhom(api);
    const dong = nhom.map((g) => `${g.id}\t${g.members ?? "?"} người\t${g.name}`);
    fs.writeFileSync(GROUPS_FILE, dong.join("\n") + "\n");
    log(`Nick này đang ở ${nhom.length} nhóm (id · số người · tên):`);
    for (const d of dong) console.log("   " + d);
    return nhom;
}

async function main() {
    const chonVD = argAfter("--chon-vandon");
    const chon = chonVD || argAfter("--chon");
    if (chon) {
        const api = await dangNhap();
        const nhom = await danhSachNhom(api);
        const g = nhom.find((x) => x.id === chon);
        if (!g) throw new Error(`nick phụ không ở nhóm id ${chon} — chạy \`node pair.js --groups\` xem lại`);
        const nuoc = (argAfter("--nuoc") || "TW").toUpperCase();
        const file = chonVD ? fileNhomVanDon(nuoc) : GROUP_FILE;
        fs.writeFileSync(file, JSON.stringify({ id: g.id, name: g.name, chonLuc: new Date().toISOString() }, null, 2) + "\n");
        log(`Đã chọn nhóm nhận tin ${chonVD ? `VẬN ĐƠN ${nuoc}` : "ADS"}: "${g.name}" (${g.members ?? "?"} người) → ${path.basename(file)}`);
        log("Bot đang chạy thì: pm2 restart talpha-zalo-alerts");
        return;
    }
    if (process.argv.includes("--groups")) {
        await inNhom(await dangNhap());
        return;
    }
    const api = await ghepQR();
    log("GHÉP XONG.");
    await inNhom(api);
    log("Chọn nhóm: node pair.js --chon <id nhóm>");
}

main().then(() => process.exit(0)).catch((e) => { log("LỖI:", e.message); process.exit(1); });

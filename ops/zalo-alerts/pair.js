// Ghép nick Zalo PHỤ cho bot — chạy TRÊN MÁY CHỦ, trong thư mục này:
//   node pair.js                   đăng nhập bằng QR → lưu phiên → in danh sách nhóm
//   node pair.js --groups          dùng phiên đã lưu, in lại danh sách nhóm
//   node pair.js --tu-nhan         chọn nhóm của MỖI NƯỚC theo tên "ADS + VẬN ĐƠN <nước>"
//                                  (TAIWAN · SGP · UAE · JAPAN) → zalo_group_nuoc_<mã>.json
//   node pair.js --chon-nuoc <id nhóm> --nuoc TW   chọn tay nhóm của một nước
//
// Từ 08/10/2026 (Sỹ Anh chốt) MỖI NƯỚC MỘT NHÓM, ads + vận đơn chung nhóm. Nhóm cũ (BÁO CÁO
// ADS gộp các nước, VẬN ĐƠN TW/SGP/UAE) bỏ — --chon / --chon-vandon cũ đã xoá. Bot dịch vụ cũng
// tự nhận nhóm theo tên lúc khởi động nếu nước nào chưa có file — lệnh dưới để chạy tay/soát.
//
// Ghép TRÊN MÁY CHỦ chứ không ghép ở máy Mac rồi chép phiên lên: phiên sinh ra ở IP nào
// thì dùng ở IP đó, Zalo ít hỏi lại. QR ghi ra qr.png — hết hạn sau ~100 giây, tự làm mã
// mới tối đa 5 lần. Nick phụ phải NẰM SẴN trong nhóm đích.
// Ghép lại khi bot đang chạy: xong thì `pm2 restart talpha-zalo-alerts` để bot nạp phiên mới.
const fs = require("fs");
const path = require("path");
const { QR_FILE, dangNhap, ghepQR, danhSachNhom, ghiNhomNuoc } = require("./zalo");
const { NUOC, chonNhomTheoTen } = require("./rules");
const CFG = require("./config");

const GROUPS_FILE = path.join(__dirname, "groups.txt");
const SO_LAN_QR = 5;
const log = (...a) => console.log(new Date().toISOString(), ...a);
const CAC_NUOC = ((CFG.nhomNuoc || {}).markets || Object.keys(NUOC)).map((x) => String(x).toUpperCase());

function argAfter(flag) {
    const i = process.argv.indexOf(flag);
    const v = i >= 0 ? process.argv[i + 1] : "";
    return v && !v.startsWith("--") ? v : "";
}

async function ghepQRTay() {
    return ghepQR({
        soLan: SO_LAN_QR,
        bao: (k, d) => {
            if (k === "qr") log(`QR_READY lần ${d.lan}/${d.soLan}: ${QR_FILE} — mở app Zalo của NICK PHỤ → quét mã (còn ~100 giây)`);
            else if (k === "het") log(`QR hết hạn ${d.lan} lần — dừng. Sẵn sàng quét thì chạy lại.`);
            else if (k === "quet") log(`ĐÃ QUÉT bởi "${d.ten}" — bấm XÁC NHẬN đăng nhập trên điện thoại`);
            else if (k === "tuchoi") log("Điện thoại đã TỪ CHỐI đăng nhập — dừng.");
            else if (k === "luu") log("Đã lưu phiên vào .zalo_session.json (quyền 600).");
        },
    });
}

async function inNhom(api) {
    const nhom = await danhSachNhom(api);
    const dong = nhom.map((g) => `${g.id}\t${g.members ?? "?"} người\t${g.name}`);
    fs.writeFileSync(GROUPS_FILE, dong.join("\n") + "\n");
    log(`Nick này đang ở ${nhom.length} nhóm (id · số người · tên):`);
    for (const d of dong) console.log("   " + d);
    return nhom;
}

async function tuNhan(api) {
    const { chon, trung, thieu } = chonNhomTheoTen(await danhSachNhom(api), CAC_NUOC);
    for (const [m, g] of Object.entries(chon)) {
        const file = ghiNhomNuoc(m, g, "tu-nhan");
        log(`${m} ${NUOC[m] ? NUOC[m].flag : ""} → "${g.name}" (${g.members ?? "?"} người) → ${path.basename(file)}`);
    }
    for (const [m, xs] of Object.entries(trung)) {
        log(`${m}: ${xs.length} nhóm cùng tên kiểu "ADS + VẬN ĐƠN" — KHÔNG tự chọn: ${xs.map((g) => `"${g.name}" (${g.id})`).join(", ")}. Chọn tay: node pair.js --chon-nuoc <id> --nuoc ${m}`);
    }
    for (const m of thieu) log(`${m}: nick phụ không ở nhóm nào tên "ADS + VẬN ĐƠN ${NUOC[m] ? NUOC[m].ten.toUpperCase() : m}" — thêm nick vào nhóm rồi chạy lại.`);
    log("Bot đang chạy thì: pm2 restart talpha-zalo-alerts");
}

async function main() {
    const chonNuoc = argAfter("--chon-nuoc");
    if (chonNuoc) {
        const nuoc = argAfter("--nuoc").toUpperCase();
        if (!CAC_NUOC.includes(nuoc)) throw new Error(`thiếu/sai --nuoc (${CAC_NUOC.join(", ")})`);
        const api = await dangNhap();
        const g = (await danhSachNhom(api)).find((x) => x.id === chonNuoc);
        if (!g) throw new Error(`nick phụ không ở nhóm id ${chonNuoc} — chạy \`node pair.js --groups\` xem lại`);
        const file = ghiNhomNuoc(nuoc, g, "chon-tay");
        log(`Đã chọn nhóm ADS + VẬN ĐƠN ${nuoc}: "${g.name}" (${g.members ?? "?"} người) → ${path.basename(file)}`);
        log("Bot đang chạy thì: pm2 restart talpha-zalo-alerts");
        return;
    }
    if (process.argv.includes("--tu-nhan")) {
        await tuNhan(await dangNhap());
        return;
    }
    if (process.argv.includes("--groups")) {
        await inNhom(await dangNhap());
        return;
    }
    const api = await ghepQRTay();
    log("GHÉP XONG.");
    await inNhom(api);
    log("Chọn nhóm từng nước: node pair.js --tu-nhan");
}

main().then(() => process.exit(0)).catch((e) => { log("LỖI:", e.message); process.exit(1); });

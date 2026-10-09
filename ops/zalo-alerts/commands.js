// Lệnh gõ trong nhóm Zalo. Sỹ Anh chốt 15/09/2026: tự động CHỈ gửi mốc 8h30, còn lại
// gửi "khi có ai đó yêu cầu". Hàm thuần — chữ người gõ → việc bot phải làm — không đụng
// mạng, không đụng Zalo, để test được.
//
//   /baocao               số ĐANG CHẠY hôm nay, gộp trong MỘT tin
//   /baocao homqua        số hôm qua          /baocao 14/09   số ngày đó
//   /baocao Lộc           chi tiết campaign của một người (ghép ngày: /baocao homqua Lộc)
//   /baocao team          chỉ số TỔNG TEAM, không kèm campaign
//   /canhbao              camp đốt tiền 0 tin nhắn + chi tiêu bất thường, ngay lúc gõ
//   /vandon               vận đơn cần xử lý của nước của nhóm (nhóm "ADS + VẬN ĐƠN <nước>", 08/10/2026)
//   /vandon sg · tw · uae · jp   (dòng lệnh) chọn nước
//   /gio                  tin mỗi giờ (ads + tin nhắn Pancake + đơn theo page) ngay lúc gõ — nước có moiGio
//   /bot                  cách dùng
// Có dấu hay không dấu, hoa hay thường đều được. Không bắt đầu bằng "/" → không phải lệnh,
// bot im — tin báo cáo của chính bot cũng đi qua đây nên điều này là bắt buộc.
const { B, I } = require("./zalo_text");

const boDau = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
const gon = (s) => boDau(s).replace(/[\s.]/g, "");

const TEN_LENH = {
    baocao: "baocao", bc: "baocao",
    canhbao: "canhbao", cb: "canhbao",
    vandon: "vandon", vd: "vandon",
    gio: "gio",
    bot: "trogiup", lenh: "trogiup", help: "trogiup",
};

function homQua(today) {
    const d = new Date(today + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
}

/**
 * @param text   chữ người gõ
 * @param today  "YYYY-MM-DD" giờ VN
 * @param nguoi  [{ key: "Loc", ten: "Lộc" }, …] — marketer đang khai trong rules
 * @returns null (không phải lệnh) · { lenh: "canhbao" | "trogiup" }
 *        · { lenh: "baocao", ngay, homNay, loc: null | "team" | tên hiển thị } · { loi }
 */
function docLenh(text, { today, nguoi = [] }) {
    const s = String(text || "").trim();
    if (!s.startsWith("/")) return null;
    const [dau, ...con] = s.split(/\s+/);
    const lenh = TEN_LENH[boDau(dau.slice(1))];
    if (!lenh) return null;
    if (lenh === "vandon") {
        const nuoc = gon(con.join(" "));
        if (!nuoc) return { lenh };
        if (["sg", "sing", "singapore", "sgp"].includes(nuoc)) return { lenh, nuoc: "SG" };
        if (["tw", "dai", "dailoan", "taiwan"].includes(nuoc)) return { lenh, nuoc: "TW" };
        if (["ae", "uae", "dubai"].includes(nuoc)) return { lenh, nuoc: "AE" };
        if (["jp", "jpn", "japan", "nhat", "nhatban"].includes(nuoc)) return { lenh, nuoc: "JP" };
        // Mang theo lenh "vandon" để lỗi được trả lời ở nhóm VẬN ĐƠN (lỗi trơn bị bỏ ở đó).
        return { lenh, loi: `Không hiểu "${con.join(" ")}". Gõ /vandon (vận đơn của nước của nhóm này).` };
    }
    if (lenh !== "baocao") return { lenh };

    const goc = con.join(" ");
    let phan = ` ${boDau(goc)} `;
    let ngay = today;
    if (/\bhom\s*qua\b/.test(phan)) {
        ngay = homQua(today);
        phan = phan.replace(/\bhom\s*qua\b/, " ");
    } else if (/\bhom\s*nay\b/.test(phan)) {
        phan = phan.replace(/\bhom\s*nay\b/, " ");
    }
    const d = phan.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/);
    if (d) {
        const iso = `${d[3] || today.slice(0, 4)}-${d[2].padStart(2, "0")}-${d[1].padStart(2, "0")}`;
        const that = new Date(iso + "T00:00:00Z");
        if (Number.isNaN(that.getTime()) || that.toISOString().slice(0, 10) !== iso) {
            return { loi: `Ngày "${d[0]}" không có thật. Viết kiểu /baocao 14/09.` };
        }
        if (iso > today) return { loi: `Ngày ${d[0]} chưa tới — chưa có số.` };
        ngay = iso;
        phan = phan.replace(d[0], " ");
    }

    const chu = phan.replace(/\s+/g, " ").trim();
    let loc = null;
    if (chu) {
        if (["team", "tong", "tongteam"].includes(gon(chu))) loc = "team";
        else {
            const khop = nguoi.find((n) => gon(n.ten) === gon(chu) || gon(n.key) === gon(chu));
            if (!khop) return { loi: `Không hiểu "${goc}". Gõ /bot xem cách dùng.` };
            loc = khop.ten;
        }
    }
    return { lenh, ngay, homNay: ngay === today, loc };
}

function huongDan({ at, toi, nguoi = [] } = {}) {
    const vi = nguoi[0] ? nguoi[0].ten : "Lộc";
    return `🤖 ${B("Bot TALPHA — báo cáo ads")}\n`
        + `Tự gửi ${at || "08:30"} (kết quả hôm qua)${toi ? ` và ${toi} (kết quả hôm nay)` : ""}: số tổng, theo nước, xếp hạng và chi tiết từng camp.\n\n`
        + `${B("Gõ trong nhóm để lấy số:")}\n`
        + `• /baocao — số đang chạy hôm nay (1 tin)\n`
        + `• /baocao homqua — số hôm qua\n`
        + `• /baocao 14/09 — số một ngày\n`
        + `• /baocao ${vi} — chi tiết campaign của một người (ghép được: /baocao homqua ${vi})\n`
        + `• /baocao team — chỉ số TỔNG TEAM\n`
        + `• /canhbao — camp đốt tiền không ra tin nhắn, chi tiêu bất thường\n`
        + `${I("Có dấu hay không dấu đều được.")}`;
}

function huongDanVanDon({ at, toi, nuoc, nguon } = {}) {
    return `📦 ${B(`Bot TALPHA — vận đơn${nuoc ? ` ${nuoc}` : ""}`)}\n`
        + `Tự gửi ${at || "08:30"}: hôm qua ra sao + khách phải gọi, nhắn hôm nay (đủ tên, SĐT, chỗ lấy hàng, tin nhắn soạn sẵn).\n`
        + (toi ? `Tự gửi ${toi}: hôm nay làm được gì — khách đã lấy chưa, khách còn treo sang mai.\n` : "")
        + `Trạng thái lấy từ ${nguon || "bảng đối tác + 17TRACK"} (cập nhật 6h và 21:30).\n\n`
        + `${B("Gõ trong nhóm:")}\n`
        + `• /vandon — danh sách mới nhất ngay lúc gõ\n`
        + `• /bot — cách dùng\n`
        + `${I("Có dấu hay không dấu đều được.")}`;
}

/**
 * Tin hướng dẫn của nhóm "ADS + VẬN ĐƠN <nước>" (08/10/2026) — gửi MỘT lần khi bot gặp nhóm mới.
 * @param o { nuoc: {ten, flag, sapChay}, at, mocAds, vanDon: {at, toi, nguon} | null, nguoi }
 */
function huongDanNuoc({ nuoc, at, mocAds, vanDon, nguoi = [], moiGio = null } = {}) {
    const vi = nguoi[0] ? nguoi[0].ten : "Lộc";
    const ten = nuoc ? `${nuoc.flag} ${nuoc.ten}` : "";
    const dong = [
        `🤖 ${B(`Bot TALPHA — ADS + VẬN ĐƠN ${ten}`)}`,
        `Nhóm này chỉ nhận số của ${ten} (mỗi nước một nhóm từ 08/10/2026).`,
        "",
        `📊 ${B("Ads")} tự gửi ${at || "08:30"} (kết quả hôm qua)${mocAds ? ` và ${mocAds} (số đang chạy hôm nay)` : ""}: `
            + `số tổng${nuoc && nuoc.sapChay ? "" : ", xếp hạng từng người"} và chi tiết từng camp của ${ten}.`,
    ];
    if (nuoc && nuoc.sapChay) dong.push(I(`${nuoc.ten} chưa nối shop POS — tin chỉ có tiền ads và tin nhắn, chưa có đơn/doanh số.`));
    if (moiGio && moiGio.length) {
        dong.push(`⏰ ${B("Mỗi giờ")} (${moiGio[0]} → ${moiGio[moiGio.length - 1]}, trừ giờ đã có bản tin ads): tiền ads, tin nhắn đếm từ Pancake, giá mỗi tin, đơn, doanh số — theo từng page.`);
    }
    dong.push(vanDon
        ? `📦 ${B("Vận đơn")} tự gửi ${vanDon.at || "08:30"}${vanDon.toi ? ` và ${vanDon.toi}` : ""}: khách phải gọi, nhắn (đủ tên, SĐT, tin soạn sẵn); `
            + `trạng thái lấy từ ${vanDon.nguon || "bảng đối tác + 17TRACK"}.`
        : `📦 ${I(`Vận đơn ${nuoc ? nuoc.ten : "nước này"} chưa theo dõi — làm khi có đơn và biết hãng giao.`)}`);
    dong.push("", B("Gõ trong nhóm:"),
        "• /baocao — số đang chạy hôm nay · /baocao homqua · /baocao 14/09",
        `• /baocao ${vi} — chi tiết campaign của một người ở nước này`,
        "• /baocao team — chỉ số tổng, không kèm camp",
        "• /canhbao — camp đốt tiền không ra tin nhắn");
    if (moiGio && moiGio.length) dong.push("• /gio — số mỗi giờ (ads + tin nhắn + đơn theo page) ngay lúc gõ");
    if (vanDon) dong.push("• /vandon — danh sách vận đơn mới nhất");
    dong.push(I("Có dấu hay không dấu đều được."));
    return dong.join("\n");
}

module.exports = { docLenh, huongDan, huongDanVanDon, huongDanNuoc, homQua, boDau };

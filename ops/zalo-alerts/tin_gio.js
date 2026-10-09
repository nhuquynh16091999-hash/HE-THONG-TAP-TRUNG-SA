// TIN MỖI GIỜ của một nước (Sỹ Anh yêu cầu 09/10/2026, trước mắt cho Nhật): quảng cáo ở Nhật
// KHÔNG có chỉ số tin nhắn trên Meta (luật bảo vệ thông tin liên lạc của Nhật), nên Ads Manager
// không cho biết mess, giá mess, đơn, doanh số. Tin này ghép ba nguồn theo PAGE:
//   • tiền ads từng camp — Meta trực tiếp (/api/talpha/realtime, bot gọi một lượt mỗi mốc);
//   • tin nhắn / bình luận mới / có SĐT — Pancake (/api/talpha/pancake-nuoc);
//   • đơn + doanh số — bảng đơn POS, cùng luật Sheet (/api/talpha/pancake-nuoc).
// Camp nối page bằng ô tên page trong tên camp (mỗi camp Nhật một page). Hàm thuần — có test.
const { B, I } = require("./zalo_text");
const { chuanTenPage, trangCuaCamp, chuCamp, DISPLAY, campaignMarket, isTestCampaign } = require("./rules");

const fmt = (n) => Number(n || 0).toLocaleString("vi-VN");
const p1 = (x) => Number(x || 0).toFixed(1).replace(".", ",");
const ddmm = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const gonTien = (n) => {
    const x = Number(n || 0);
    if (x >= 1_000_000) return `${(x / 1_000_000).toFixed(1).replace(".", ",").replace(",0", "")}tr`;
    if (x >= 1_000) return `${Math.round(x / 1_000)}k`;
    return `${Math.round(x)}đ`;
};
const chuCua = (cn) => { const k = chuCamp(cn); return k ? DISPLAY[k] || k : null; };

/**
 * Ghép camp (Meta) + page (Pancake) + đơn (POS) theo tên page đã chuẩn hoá.
 * @param pk    kết quả /api/talpha/pancake-nuoc
 * @param camps campaigns của /api/talpha/realtime (mọi nước — lọc ở đây theo pk.key)
 * @returns { trang: [...], tong, khongRo }
 */
function ghepTheoTrang(pk, camps) {
    const map = new Map();
    const lay = (ten) => {
        const k = chuanTenPage(ten);
        if (!map.has(k)) map.set(k, { ten, nv: null, ads: 0, mess: 0, cmt: 0, sdt: 0, don: 0, dsLocal: 0, dsVnd: 0, camps: [], loi: "" });
        return map.get(k);
    };
    for (const p of (pk && pk.pages) || []) {
        const x = lay(p.name);
        x.ten = p.name; x.nv = p.nv || x.nv;
        x.mess += Number(p.inbox_moi || 0); x.cmt += Number(p.comment_moi || 0); x.sdt += Number(p.co_sdt || 0);
        if (p.loi) x.loi = p.loi;
    }
    for (const c of camps || []) {
        if (!(c.spend_vnd > 0) || isTestCampaign(c.campaign_name) || campaignMarket(c.campaign_name).market !== pk.key) continue;
        const t = trangCuaCamp(c.campaign_name) || "(camp không ghi page)";
        const x = lay(t);
        x.ads += c.spend_vnd; x.camps.push(c.campaign_name);
        x.nv = chuCua(c.campaign_name) || x.nv;
    }
    const khongRo = { don: 0, dsLocal: 0, dsVnd: 0 };
    for (const d of (pk && pk.don) || []) {
        if (!d.page_name) { khongRo.don += d.don; khongRo.dsLocal += d.ds_local; khongRo.dsVnd += d.ds_vnd; continue; }
        const x = lay(d.page_name);
        x.don += d.don; x.dsLocal += d.ds_local; x.dsVnd += d.ds_vnd;
    }
    const trang = [...map.values()].filter((x) => x.ads > 0 || x.mess > 0 || x.cmt > 0 || x.don > 0 || x.loi)
        .sort((a, b) => b.ads - a.ads || b.mess - a.mess || b.don - a.don);
    const tong = { ads: 0, mess: 0, cmt: 0, sdt: 0, don: khongRo.don, dsLocal: khongRo.dsLocal, dsVnd: khongRo.dsVnd };
    for (const x of trang) {
        tong.ads += x.ads; tong.mess += x.mess; tong.cmt += x.cmt; tong.sdt += x.sdt;
        tong.don += x.don; tong.dsLocal += x.dsLocal; tong.dsVnd += x.dsVnd;
    }
    tong.ads = Math.round(tong.ads);
    return { trang, tong, khongRo };
}

/**
 * Số tin nhắn thay cho Meta trong bản tin thường (08:30 · 13:00 · 18:00 · 22:00) của nước dùng
 * Pancake: tổng, theo người (chủ page), theo camp (tin nhắn của page dồn cho camp TIÊU NHIỀU NHẤT
 * trên page đó — hội thoại không ghi đến từ camp nào).
 */
function messThayTuPancake(pk, camps) {
    if (!pk || !pk.pancake || !pk.pancake.ok) return null;
    const { trang, tong } = ghepTheoTrang(pk, camps);
    const theoNguoi = {}, theoCamp = {};
    for (const x of trang) {
        if (x.nv) theoNguoi[x.nv] = (theoNguoi[x.nv] || 0) + x.mess;
        const top = (camps || []).filter((c) => x.camps.includes(c.campaign_name)).sort((a, b) => b.spend_vnd - a.spend_vnd)[0];
        if (top) theoCamp[top.campaign_name] = (theoCamp[top.campaign_name] || 0) + x.mess;
    }
    return { tong: tong.mess, theoNguoi, theoCamp };
}

const tienNuoc = (local, vnd, sym) => (local > 0 ? `${fmt(local)}${sym} ≈ ${gonTien(vnd)}` : "0");

/**
 * @param o { n: NUOC[m], ngay, gio "15:05", pk, camps, truoc: {ngay, tong} | null, loiCamp }
 * @returns { text, tong }
 */
function buildTinGio({ n, ngay, gio, pk, camps, truoc, loiCamp }) {
    const sym = (pk && pk.symbol) || "";
    const { trang, tong, khongRo } = ghepTheoTrang(pk || { pages: [], don: [], key: n.key }, loiCamp ? [] : camps);
    const dong = [B(`⏰ ${n.flag} ${n.ten.toUpperCase()} · ${gio} · HÔM NAY ${ddmm(ngay)}`)];
    dong.push(I("Tin nhắn đếm từ Pancake (Meta không báo mess ở Nhật) · đơn từ POS · ads Meta trực tiếp"));
    const pkLoi = !pk ? "chưa lấy được số Pancake + đơn lúc này" : !pk.pancake.ok ? `Pancake lỗi: ${pk.pancake.loi}` : "";
    if (pkLoi) dong.push(`⚠️ ${B(pkLoi)} — số tin nhắn dưới đây chưa đủ.`);
    if (loiCamp) dong.push(`⚠️ ${I(`chưa lấy được tiền ads từ Meta (${loiCamp})`)}`);
    const het = pk && pk.pancake && pk.pancake.het_han ? Date.parse(pk.pancake.het_han) : null;
    if (het && het - Date.now() < 14 * 86400_000) dong.push(`⚠️ ${B(`Token Pancake hết hạn ${ddmm(new Date(het + 7 * 3600_000).toISOString().slice(0, 10))}`)} — gửi token mới cho kỹ thuật.`);
    dong.push("");

    const tc = truoc && truoc.ngay === ngay ? truoc.tong : null;
    const them = (k) => (tc && tong[k] - (tc[k] || 0) > 0 ? ` (+${fmt(tong[k] - (tc[k] || 0))})` : "");
    dong.push(`💰 Ads ${B(fmt(tong.ads) + "đ")} · 💬 ${B(fmt(tong.mess) + " mess")}${them("mess")}`
        + (tong.mess > 0 ? ` · ${B(gonTien(tong.ads / tong.mess) + "/mess")}` : "")
        + (tong.cmt ? ` · ${fmt(tong.cmt)} bình luận` : ""));
    dong.push(`🛒 ${B(fmt(tong.don) + " đơn")}${them("don")} · DS ${B(tienNuoc(tong.dsLocal, tong.dsVnd, sym))}`
        + (tong.don > 0 ? ` · ${gonTien(tong.ads / tong.don)}/đơn` : "")
        + (tong.mess > 0 ? ` · chốt ${p1((tong.don / tong.mess) * 100)}%` : "")
        + (tong.dsVnd > 0 ? ` · %ads ${p1((tong.ads / tong.dsVnd) * 100)}%` : ""));
    if (tong.sdt) dong.push(`📞 ${fmt(tong.sdt)} khách mới đã để SĐT`);
    if (tc) dong.push(I(`(+…) = thêm trong giờ qua`));

    if (trang.length) dong.push("", B("📄 THEO PAGE"));
    for (const x of trang) {
        dong.push(`${B(x.ten)}${x.nv ? ` — ${x.nv}` : ""}`);
        const chi = [`ads ${gonTien(x.ads)}`, `${fmt(x.mess)} mess`];
        if (x.mess > 0 && x.ads > 0) chi.push(`${gonTien(x.ads / x.mess)}/mess`);
        if (x.cmt) chi.push(`${fmt(x.cmt)} bình luận`);
        if (x.sdt) chi.push(`${fmt(x.sdt)} SĐT`);
        chi.push(`${fmt(x.don)} đơn`);
        if (x.don) chi.push(tienNuoc(x.dsLocal, x.dsVnd, sym));
        dong.push(`    ${chi.join(" · ")}`);
        if (x.loi) dong.push(`    ⚠️ ${I(x.loi)}`);
    }
    if (khongRo.don) dong.push(`📍 Đơn không ghi page: ${fmt(khongRo.don)} đơn · ${tienNuoc(khongRo.dsLocal, khongRo.dsVnd, sym)}`);
    if (!trang.length && !khongRo.don) dong.push("", I("(hôm nay chưa có tiền ads, tin nhắn hay đơn nào)"));
    return { text: dong.join("\n"), tong };
}

module.exports = { ghepTheoTrang, messThayTuPancake, buildTinGio };

// Tin VẬN ĐƠN — Sỹ Anh duyệt mẫu 26/09/2026 (trang "Bản tin Zalo 08:30 · 22:00", bản 3):
//   • 08:30 SÁNG: hôm qua ra sao + khách phải gọi/nhắn hôm nay, mỗi khách ĐỦ tên, SĐT, cửa
//     hàng, mã lấy hàng, hạn và TIN NHẮN SOẠN SẴN (Đài tiếng Trung, Singapore tiếng Anh) để
//     chép gửi luôn — đọc tin là làm, không mở dashboard, không cần lệnh.
//   • 22:00 TỐI: hôm nay làm được gì — khách phải gọi sáng nay đã lấy chưa, cứu được bao
//     nhiêu tiền, khách nào còn treo sang mai; và số cả ngày.
// Mỗi thị trường một nhóm (VẬN ĐƠN TW, VẬN ĐƠN SGP, VẬN ĐƠN UAE). Việc giao cho người phụ trách
// (@Thương). UAE (28/09/2026) không qua 17TRACK: trạng thái tra thẳng trang WeShip — tin ghi
// "WeShip" ở chỗ Đài/Singapore ghi "17TRACK" (d.provider).
//
// Số lấy từ ĐÚNG route màn "Theo dõi vận đơn" (/api/talpha/tracking?market=…), nên tin và
// màn hình không lệch được: cùng luật cảnh báo buildAlerts, cùng mốc hạn lấy hàng.
// Hàm thuần: không gọi mạng (trừ fetchVanDon), không đụng Zalo — để test được.
const { B, I, M } = require("./zalo_text");

const fmt = (n) => Number(n || 0).toLocaleString("vi-VN");
const ddmm = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const cong = (ngay, n) => {
    const d = new Date(ngay + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
};
function gioVN(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "?";
    const p = (o) => d.toLocaleString("en-GB", { timeZone: "Asia/Ho_Chi_Minh", ...o });
    return `${p({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" })} ${p({ day: "2-digit" })}/${p({ month: "2-digit" })}`;
}
/** Ngày theo giờ Việt Nam của một mốc ISO — "hôm qua khách lấy" là theo ngày VN. */
function ngayVN(iso) {
    const t = Date.parse(iso || "");
    return Number.isNaN(t) ? null : new Date(t + 7 * 3600000).toISOString().slice(0, 10);
}
const cat = (s, n) => { const x = String(s || "").replace(/\s+/g, " ").trim(); return x.length > n ? x.slice(0, n - 1) + "…" : x; };
/** Tên nguồn trạng thái của nước này — "WeShip" (UAE) hay "17TRACK". */
const tenNguon = (d) => (d && d.provider === "weship" ? "WeShip" : "17TRACK");

async function fetchVanDon(cfg, today, f = fetch, market = "") {
    if (!cfg || !cfg.url) throw new Error("thiếu vanDon.url trong config");
    const from = cong(today, -(Number(cfg.rangeDays) || 60));
    const nuoc = market ? `&market=${encodeURIComponent(market)}` : "";
    const res = await f(`${cfg.url}?from=${from}&to=${today}${nuoc}`, { headers: { "cache-control": "no-store" } });
    if (!res.ok) throw new Error(`tracking HTTP ${res.status}`);
    const j = await res.json();
    if (j.error) throw new Error(j.error);
    return j;
}

/**
 * Cảnh báo "số này mới tới đâu" — MỖI VẤN ĐỀ MỘT DÒNG, không có vấn đề thì không có dòng
 * nào. Số cũ mà không ai nói thì sale gọi nhầm khách đã lấy hàng rồi — nên tin TỰ TỐ khi
 * 17TRACK lỗi, hết quota, hay đồng bộ/nạp bảng đứng.
 */
function dongNguon(d, nowTs, { quotaWarn = 200, staleHours = 26 } = {}) {
    const cu = (iso) => iso && nowTs - Date.parse(iso) > staleHours * 3600000;
    const ra = [];
    const ls = d.last_sync;
    const ten = tenNguon(d);
    if (d.has_api_key && !ls) {
        ra.push(d.provider === "weship"
            ? `⚠️ ${B("WeShip chưa tra lần nào")} — chưa biết đơn nào giao hỏng`
            : `⚠️ ${B("17TRACK chưa đồng bộ lần nào")} — số theo bảng đối tác, trễ ~2 ngày`);
    }
    else if (ls && !ls.ok) ra.push(`⚠️ ${B(`${ten} lỗi ${gioVN(ls.at)}`)}: ${cat(ls.error, 90)}`);
    else if (ls && cu(ls.at)) ra.push(`⚠️ ${B(`${ten} chưa chạy từ ${gioVN(ls.at)}`)} — số có thể trễ`);
    // WeShip: lượt vẫn chạy khi vài mã lỗi — nhưng mã lỗi đứng im, phải nói.
    if (ls && ls.ok && Number(ls.failed) > 0) ra.push(`⚠️ ${B(`WeShip lỗi ${fmt(ls.failed)} mã`)}: ${cat(ls.error, 80)}`);
    // Nhiều khoá: một khoá chết thì lượt vẫn chạy bằng khoá khác — nhưng mã của khoá chết
    // đứng im, nên phải nêu đích danh.
    if (ls && ls.ok) {
        for (const k of (ls.keys || []).filter((x) => !x.ok)) ra.push(`⚠️ ${B(`17TRACK ${k.label} lỗi`)}: ${cat(k.error, 80)}`);
    }
    if (ls && Number(ls.orphaned) > 0) ra.push(`⚠️ ${B(`${fmt(ls.orphaned)} mã thuộc khoá đã gỡ`)} — không cập nhật được nữa`);
    // Hết quota: nói rõ bao nhiêu đơn đang mù và làm gì, chứ không chỉ kêu "nạp thêm".
    if (ls && ls.quota_out) {
        // over_cap gồm cả đơn thường để lượt sau vì chia nhịp — đó KHÔNG phải đơn mù.
        const n = Math.max(0, (Number(ls.over_cap) || 0) - (Number(ls.deferred) || 0));
        ra.push(`⚠️ ${B(`HẾT QUOTA 17TRACK${n ? ` — ${fmt(n)} đơn chưa được theo dõi` : ""}`)}: thêm khoá mới hoặc chờ ngày 1`);
    } else if (ls && ls.ok && ls.quota && ls.quota.total > 0) {
        // Ngưỡng theo cỡ gói: gói miễn phí vài trăm mã thì "còn dưới 200" là kêu mỗi ngày.
        const nguong = Math.min(quotaWarn, Math.ceil(ls.quota.total * 0.15));
        if (ls.quota.remain < nguong) ra.push(`⚠️ ${B(`Quota 17TRACK sắp hết: còn ${fmt(ls.quota.remain)}/${fmt(ls.quota.total)}`)}`);
    }
    if (cu(d.last_import)) ra.push(`⚠️ ${B(`Bảng đối tác chưa nạp từ ${gioVN(d.last_import)}`)}`);
    return ra.join("\n");
}

/**
 * Lý do giao hỏng. 17TRACK nói bằng sub_status; đối tác nói bằng chữ trong cột trạng thái.
 * "hoàn" tách riêng: hàng đã quay đầu thì gọi khách không cứu được nữa — chỉ để đếm.
 */
function lyDo(s) {
    const sub = String(s.sub_status || ""), raw = String(s.raw_status || s.last_event || "");
    if (/Returning/.test(sub) || (s.source !== "17track" && /hoàn/i.test(raw))) return "dang_hoan";
    if (/Returned/.test(sub)) return "da_hoan";
    if (s.source !== "17track" && /hẹn/i.test(raw)) return "khách hẹn giao lại";
    if (/Rejected/.test(sub) || /từ chối/i.test(raw)) return "khách từ chối";
    // Hai lý do riêng của WeShip (UAE).
    if (/NoResponse/.test(sub)) return "không nghe máy";
    if (/Rescheduled/.test(sub)) return "hẹn giao lại";
    if (/NoBody/.test(sub) || /vắng/i.test(raw)) return "vắng nhà";
    if (/InvalidAddress/.test(sub)) return "sai địa chỉ";
    if (s.status === "DeliveryFailure") return "giao hỏng";
    return "sự cố";
}
const laHoan = (s) => s.status === "Returned" || s.status === "Expired"
    || (s.status === "Exception" && /Return/.test(String(s.sub_status || "")))
    || ["dang_hoan", "da_hoan"].includes(lyDo(s)) && (s.status === "Exception" || s.status === "DeliveryFailure");

// Mã đơn POS toàn số (UAE: "14") thêm "#" — "1. 14 · 119 AED" đọc lẫn với số thứ tự.
const maDon = (s) => { const x = String((s || {}).order_id || (s || {}).tracking || "?"); return /^\d+$/.test(x) ? `#${x}` : x; };

// ─── Tin nhắn soạn sẵn gửi khách ─────────────────────────────────────────────
// Cùng câu chữ với nút "Chép tin" trên dashboard (tracking-tab.tsx → soanTin): khách Đài
// lấy hàng ở cửa hàng tiện lợi, nên tin phải có TÊN CỬA HÀNG + MÃ LẤY HÀNG — thiếu cửa
// hàng thì không soạn (tin cụt, khách đọc xong vẫn không biết đi đâu).

/** Mã khách đọc cho nhân viên cửa hàng = MÃ TRACKING, không phải store_code (mã cửa hàng
 *  7-11 #265155 — sai tới 30/09/2026). API đã tính sẵn pickup_code; bản cũ thì tự tính:
 *  mã đã sửa cho 17TRACK, bỏ tiền tố 73N chỉ 17TRACK cần. */
const maLayHang = (s) => String(s.pickup_code || s.track17_code || s.tracking || "").trim().replace(/^73N/i, "");

/** Hàng đã nằm ở cửa hàng mấy ngày — API tính sẵn (daysWaiting) vào a.days. */
const soNgayCho = (a) => {
    const n = Number((a || {}).days);
    return (a || {}).days == null || !Number.isFinite(n) ? null : Math.max(0, Math.round(n));
};

/** Tên cửa hàng cho người không đọc tiếng Trung: thêm chuỗi (7-ELEVEN / FamilyMart) theo
 *  kênh giao, trừ khi tên đã có sẵn ("全家新城康樂店"). */
function tenCuaHang(s) {
    const ten = String(s.store_name || "");
    const kenh = String(s.ship_method || "");
    const chuoi = /7.?ELEVEN|7-11|711/i.test(kenh) ? "7-ELEVEN" : /FAMILY|全家/i.test(kenh) ? "FamilyMart" : "";
    return chuoi && !/全家|7-?11|ELEVEN|FAMILY/i.test(ten) ? `${chuoi} ${ten}` : ten;
}

/**
 * Tin báo khách Đài ra lấy hàng — TIẾNG ANH để gửi khách, kèm bản TIẾNG VIỆT cho anh em
 * đọc hiểu (Sỹ Anh chốt 01/10/2026: khách Đài phần lớn là lao động Philippines/Indonesia/
 * Việt đọc tiếng Anh; không nhắc chuẩn bị tiền nữa).
 *
 * • LẦN ĐẦU — nhẹ nhàng, nói hàng ĐÃ TỚI được mấy ngày (đếm xuôi) chứ không nói còn mấy
 *   ngày: ghi "còn 5 ngày" thì khách thong thả rồi quên.
 * • NHẮC LẠI — khách đã được nhắn mà vẫn chưa lấy: gấp hơn, nói rõ nằm đó mấy ngày rồi mà
 *   chưa lấy, sắp bị trả; mai / hôm nay là ngày cuối thì nói thẳng.
 * Luôn có mã lấy hàng (mã tracking). Hạn thật hiện cho Thương ở dòng đầu khối.
 * Câu chữ PHẢI giống tracking-tab.tsx → soanTin.
 *
 * @param han  { ngay: số ngày đã nằm ở cửa hàng, conLai: còn mấy ngày (≤0 = hôm nay là
 *             ngày cuối), nhacLai: khách đã được nhắn trước hôm nay }
 * @param lang "en" (gửi khách) · "vi" (bản dịch cho anh em)
 */
function tinKhachDai(s, { ngay = null, conLai = null, nhacLai = false } = {}, lang = "en") {
    if (!s.store_name) return null;
    const vi = lang === "vi";
    const ten = s.customer || (vi ? "bạn" : "there");
    const ma = maLayHang(s);
    const cho = `${tenCuaHang(s)}${ma ? (vi ? ` (mã lấy hàng ${ma})` : ` (pickup code ${ma})`) : ""}`;
    const cuoi = conLai != null && conLai <= 0;
    const soNgay = (n) => (vi ? `${n} ngày` : `${n} day${n === 1 ? "" : "s"}`);
    if (nhacLai) {
        if (vi) {
            const lau = `hàng của bạn đã nằm ở cửa hàng ${cho} ${ngay ? soNgay(ngay) : "mấy ngày"} rồi mà vẫn chưa được lấy!`;
            const han = cuoi ? "Hôm nay là NGÀY CUỐI để lấy hàng — hôm nay không lấy là hàng bị trả về. Bạn nhớ ghé lấy ngay trong hôm nay nhé!"
                : conLai === 1 ? "Mai là ngày cuối để lấy hàng, quá hạn hàng sẽ bị trả về. Bạn ghé lấy sớm nhất có thể nhé!"
                    : "Cửa hàng chỉ giữ hàng thêm vài ngày nữa là trả về. Bạn ghé lấy sớm nhất có thể nhé!";
            return `Chào ${ten}, nhắc bạn lần nữa: ${lau} ${han} Có gì thắc mắc bạn cứ nhắn lại cho shop nhé. Cảm ơn bạn!`;
        }
        const lau = `your parcel has been waiting at ${cho} for ${ngay ? soNgay(ngay) : "several days"} and hasn't been picked up yet!`;
        const han = cuoi ? "Today is the LAST DAY to pick it up — if it's not collected today, it will be returned. Please make sure to pick it up today!"
            : conLai === 1 ? "Tomorrow is the last day to pick it up, after that it will be returned. Please pick it up as soon as possible!"
                : "The store will only keep it for a few more days before sending it back. Please pick it up as soon as possible!";
        return `Hi ${ten}, this is another reminder: ${lau} ${han} If you have any questions, just reply to this message. Thank you!`;
    }
    if (vi) {
        const toi = ngay ? `hàng của bạn đã tới cửa hàng ${cho} được ${soNgay(ngay)} rồi`
            : ngay === 0 ? `hàng của bạn đã tới cửa hàng ${cho} hôm nay` : `hàng của bạn đã tới cửa hàng ${cho}`;
        const han = cuoi ? "Hôm nay là ngày cuối để lấy hàng, phiền bạn ghé cửa hàng lấy trong hôm nay nhé, không thì hàng sẽ bị trả về."
            : "Phiền bạn tranh thủ ghé cửa hàng lấy nhé, quá hạn hàng sẽ bị trả về.";
        return `Chào ${ten}, ${toi}. ${han} Cảm ơn bạn!`;
    }
    const toi = ngay ? `your parcel arrived at ${cho} ${soNgay(ngay)} ago`
        : ngay === 0 ? `your parcel arrived at ${cho} today` : `your parcel has arrived at ${cho}`;
    const han = cuoi ? "Today is the last day to pick it up, so please drop by the store today — otherwise it will be returned."
        : "Please drop by the store to pick it up when you can — if it's not picked up in time, it will be returned.";
    return `Hi ${ten}, ${toi}. ${han} Thank you!`;
}

/** Hai dòng trong tin Zalo: câu tiếng Anh để chép gửi khách, rồi bản dịch cho anh em. */
function dongTinDai(s, han) {
    const en = tinKhachDai(s, han, "en");
    if (!en) return [];
    return [`💬 ${en}`, `🇻🇳 Dịch: ${tinKhachDai(s, han, "vi")}`];
}

// ─── Sổ nhắc: khách nào đã được nhắn, mấy lần ───────────────────────────────
// Sỹ Anh 30/09/2026: khách đã được nhắn mà 17TRACK vẫn thấy chưa lấy thì NHẮC LẠI mỗi sáng
// trong tin Zalo cho anh em nắm, kèm câu gửi khách gấp hơn. Bot ghi sổ mỗi sáng GỬI THẬT
// (state.json → vanDonNhac[nước][mã vận đơn] = { lan, dau, cuoi }).

/** Số NGÀY TRƯỚC HÔM NAY khách đã có trong tin sáng (tin hôm nay chưa tính). */
function lanTruoc(soNhac, tracking, today) {
    const g = (soNhac || {})[tracking];
    if (!g) return 0;
    return Math.max(0, (Number(g.lan) || 0) - (g.cuoi === today ? 1 : 0));
}

/** Ghi sổ sau khi GỬI THẬT tin sáng: mỗi khách +1 lần (một lần mỗi ngày). Bỏ dòng không
 *  được nhắc 14 ngày — khách đã lấy / hàng đã hoàn thì không còn trong tin nữa. */
function ghiSoNhac(soNhac, trackings, today) {
    const so = { ...(soNhac || {}) };
    for (const k of trackings || []) {
        const g = { lan: 0, dau: today, ...(so[k] || {}) };
        if (g.cuoi !== today) { g.lan = (Number(g.lan) || 0) + 1; g.cuoi = today; }
        so[k] = g;
    }
    const han = cong(today, -14);
    for (const k of Object.keys(so)) if (!so[k].cuoi || so[k].cuoi < han) delete so[k];
    return so;
}

// ─── Singapore giao tận nhà (J&T) — Sỹ Anh chốt 01/10/2026 ───────────────────
// Tiếng Anh gửi khách + bản dịch tiếng Việt cho anh em, như Đài.
//   TH1 — SẮP GIAO: 17TRACK thấy hàng đã vào tay J&T (InTransit) → báo trước khách mở máy,
//         để ý điện thoại; J&T đi giao (OutForDelivery) → báo "hôm nay giao".
//   TH2 — GIAO KHÔNG ĐƯỢC: bảo khách xem cuộc gọi nhỡ / tin nhắn của shipper J&T rồi CHỦ
//         ĐỘNG liên hệ lại hẹn giờ. Đã nhắn mà vẫn chưa giao được (hoặc hỏng ≥ 2 lần) → gấp hơn.

/** TH2 — J&T giao không được. han = { nhacLai, lan: số lần giao hỏng nếu biết }. */
function tinKhachSing(s, { nhacLai = false, lan = null } = {}, lang = "en") {
    const vi = lang === "vi";
    const ten = s.customer || (vi ? "bạn" : "there");
    const ma = s.track17_code || s.tracking;
    if (nhacLai) {
        if (vi) {
            const lau = lan >= 2 ? `J&T đã giao hàng (${ma}) ${lan} lần mà vẫn không gặp được bạn!` : `J&T vẫn chưa giao được hàng (${ma}) cho bạn!`;
            return `Chào ${ten}, shop nhắc bạn lần nữa: ${lau} Bạn kiểm tra điện thoại xem có cuộc gọi nhỡ hoặc tin nhắn của shipper J&T không, `
                + "rồi liên hệ lại với họ ngay hôm nay để hẹn giờ giao nhé — không giao được sớm thì hàng sẽ bị trả về. Cảm ơn bạn!";
        }
        const lau = lan >= 2 ? `J&T has tried to deliver your parcel (${ma}) ${lan} times and still couldn't reach you!` : `J&T still hasn't been able to deliver your parcel (${ma})!`;
        return `Hi ${ten}, this is another reminder: ${lau} Please check your phone for missed calls or SMS from the J&T driver `
            + "and contact them today to arrange the delivery — if it can't be delivered soon, the parcel will be returned. Thank you!";
    }
    if (vi) {
        return `Chào ${ten}, J&T đã tới giao hàng (${ma}) nhưng không gặp được bạn. Bạn kiểm tra lại điện thoại xem có cuộc gọi nhỡ hoặc tin nhắn `
            + "của shipper J&T không, rồi chủ động liên hệ lại với họ để hẹn giờ giao nhé. Cần shop hỗ trợ thì bạn cứ nhắn lại. Cảm ơn bạn!";
    }
    return `Hi ${ten}, J&T tried to deliver your parcel (${ma}) but couldn't reach you. Please check your phone for any missed calls or SMS `
        + "from the J&T driver and contact them directly to arrange a new delivery time. If you need help, just reply to us. Thank you!";
}

/**
 * TH1 — mốc BÁO TRƯỚC khi giao (Sing + UAE). null = không báo.
 *   "HomNay"  — đi giao / hẹn giao đúng HÔM NAY (sự kiện hôm nay, không lấy sự kiện hôm qua:
 *               tin 08:30 VN là 05:30 UAE, trước giờ tài xế xuất phát);
 *   "NgayMai" — WeShip "DELIVERY SCHEDULED ON NEXT DAY" (đúng kiểu báo trước 1 ngày);
 *   "SapGiao" — đã vào kho hãng / đi giao từ hôm qua mà chưa xong.
 * Sự kiện cũ quá 2 ngày thì thôi — đơn đứng im đã có mục hỏi đối tác. Sing chỉ tin 17TRACK:
 * "đang vận chuyển" của bảng đối tác có thể còn ở chặng Trung Quốc.
 */
function mocSapGiao(s, today, nuoc) {
    const ngay = ngayVN(s.last_event_time || s.status_since);
    if (!ngay || ngay < cong(today, -2)) return null;
    if (s.status === "OutForDelivery") return ngay === today ? "HomNay" : "SapGiao";
    if (s.status !== "InTransit") return null;
    if (nuoc === "SG" && s.source !== "17track") return null;
    if (/Scheduled/.test(String(s.sub_status || "")) || /SCHEDULED\s*ON\s*NEXT\s*DAY/i.test(String(s.raw_status || ""))) {
        const giao = cong(ngay, 1);
        return giao === today ? "HomNay" : giao > today ? "NgayMai" : "SapGiao";
    }
    return "SapGiao";
}

/** TH1 — câu báo trước. Sing nói "J&T", UAE nói "the courier" và "order (parcel …)". */
function tinSapGiao(s, moc, nuoc, lang = "en") {
    const vi = lang === "vi";
    const ten = s.customer || (vi ? "bạn" : "there");
    const ma = s.track17_code || s.tracking;
    const sg = nuoc === "SG";
    if (vi) {
        const hang = sg ? "J&T" : "bên giao hàng";
        const tx = sg ? "shipper J&T" : "tài xế giao hàng";
        const don = sg ? `hàng của bạn (${ma})` : `đơn của bạn (mã ${ma})`;
        const luc = moc === "HomNay" ? `${don} sẽ được ${hang} giao trong hôm nay!`
            : moc === "NgayMai" ? `${don} đã được hẹn giao vào ngày mai!`
                : `${don} đã tới ${hang} và sắp được giao (thường trong 1–2 ngày).`;
        return `Chào ${ten}, ${luc} Bạn nhớ mở máy và để ý cuộc gọi, tin nhắn của ${tx} để không lỡ nhận hàng nhé. Cảm ơn bạn!`;
    }
    const hang = sg ? "J&T" : "the courier";
    const tx = sg ? "the J&T driver" : "the delivery driver";
    const don = sg ? `your parcel (${ma})` : `your order (parcel ${ma})`;
    const tn = sg ? "calls or SMS" : "calls or messages";
    const luc = moc === "HomNay" ? (s.status === "OutForDelivery" ? `${don} is out for delivery with ${hang} today!` : `${don} is scheduled for delivery today!`)
        : moc === "NgayMai" ? `${don} is scheduled for delivery tomorrow!`
            : `${don} is now with ${hang} and will be delivered soon (usually within 1–2 days).`;
    return `Hi ${ten}, ${luc} Please keep your phone on and watch for ${tn} from ${tx} so you don't miss the delivery. Thank you!`;
}

// UAE giao tận nhà qua WeShip — câu theo LÝ DO (Sỹ Anh duyệt 01/10/2026): khách từ chối thì hỏi
// có vấn đề gì, còn lấy không; không nghe máy / hẹn lại thì bảo xem cuộc gọi nhỡ, chủ động gọi
// lại tài xế; sai địa chỉ thì xin địa chỉ đủ hoặc định vị. Nhắc lại thì gấp hơn.
function tinKhachUae(s, { nhacLai = false, lan = null } = {}, lang = "en") {
    const vi = lang === "vi";
    const ten = s.customer || (vi ? "bạn" : "there");
    const ma = s.track17_code || s.tracking;
    const sub = String(s.sub_status || "");
    if (/Rejected/.test(sub)) {
        if (nhacLai) return vi
            ? `Chào ${ten}, shop chưa nhận được phản hồi của bạn về đơn (mã ${ma}) bị từ chối nhận hôm trước. Bạn còn muốn nhận hàng không? Bạn trả lời shop trong hôm nay nhé, không thì đơn sẽ bị huỷ và hoàn về. Cảm ơn bạn!`
            : `Hi ${ten}, we haven't heard back from you about your order (parcel ${ma}), which was refused at delivery. Do you still want it? Please reply today — otherwise the order will be cancelled and returned. Thank you!`;
        return vi
            ? `Chào ${ten}, bên giao hàng báo đơn của bạn (mã ${ma}) bị từ chối nhận. Đơn hàng có vấn đề gì không bạn? Nếu bạn vẫn muốn nhận, nhắn lại giờ tiện để shop giao lại nhé. Cảm ơn bạn!`
            : `Hi ${ten}, the courier told us your order (parcel ${ma}) was refused at delivery. Was there a problem with the order? If you still want it, just reply with a good time and we'll deliver it again. Thank you!`;
    }
    const diaChi = /InvalidAddress/.test(sub);
    if (nhacLai) {
        if (vi) {
            const lau = lan >= 2 ? `bên giao hàng đã giao đơn của bạn (mã ${ma}) ${lan} lần mà vẫn chưa giao được!` : `bên giao hàng vẫn chưa giao được đơn của bạn (mã ${ma})!`;
            const viec = diaChi ? "Bạn gửi shop địa chỉ đầy đủ hoặc định vị ngay hôm nay nhé"
                : "Bạn kiểm tra cuộc gọi nhỡ, tin nhắn của tài xế rồi liên hệ lại ngay hôm nay, hoặc nhắn shop giờ nhận hàng nhé";
            return `Chào ${ten}, shop nhắc bạn lần nữa: ${lau} ${viec} — không giao được sớm thì hàng sẽ bị trả về. Cảm ơn bạn!`;
        }
        const lau = lan >= 2 ? `the courier has tried to deliver your order (parcel ${ma}) ${lan} times and still couldn't complete it!` : `the courier still hasn't been able to deliver your order (parcel ${ma})!`;
        const viec = diaChi ? "Please reply today with your full address or location pin"
            : "Please check your phone for missed calls or messages from the delivery driver and contact them today, or reply to us with a good time";
        return `Hi ${ten}, this is another reminder: ${lau} ${viec} — if it can't be delivered soon, it will be returned. Thank you!`;
    }
    if (diaChi) return vi
        ? `Chào ${ten}, bên giao hàng không tìm được địa chỉ của bạn cho đơn (mã ${ma}). Bạn nhắn lại giúp shop địa chỉ đầy đủ (toà nhà, số phòng, khu vực) hoặc gửi định vị, kèm giờ nhận hàng tiện cho bạn nhé. Cảm ơn bạn!`
        : `Hi ${ten}, the courier couldn't find your address for your order (parcel ${ma}). Please reply with your full address (building, flat number, area) or send your location pin, plus a good time for delivery. Thank you!`;
    if (/NoResponse/.test(sub)) return vi
        ? `Chào ${ten}, bên giao hàng đã đi giao đơn của bạn (mã ${ma}) nhưng gọi không được. Bạn kiểm tra lại điện thoại xem có cuộc gọi nhỡ hoặc tin nhắn của tài xế không, rồi chủ động gọi lại để hẹn giờ giao, hoặc nhắn shop giờ nhận hàng tiện cho bạn nhé. Nhớ mở máy giúp shop. Cảm ơn bạn!`
        : `Hi ${ten}, the courier tried to deliver your order (parcel ${ma}) but couldn't reach you by phone. Please check your phone for missed calls or messages from the delivery driver and call them back to arrange a delivery time, or reply to us with a good time. Please keep your phone on. Thank you!`;
    return vi
        ? `Chào ${ten}, đơn của bạn (mã ${ma}) đã được hẹn giao lại. Bạn kiểm tra điện thoại xem có cuộc gọi nhỡ hoặc tin nhắn của tài xế không, rồi liên hệ lại để chốt giờ giao, hoặc nhắn shop giờ nhận hàng tiện cho bạn nhé. Nhớ mở máy giúp shop. Cảm ơn bạn!`
        : `Hi ${ten}, the delivery of your order (parcel ${ma}) has been rescheduled. Please check your phone for missed calls or messages from the delivery driver and contact them to confirm a delivery time, or reply to us with a good time. Please keep your phone on. Thank you!`;
}
const tinKhachNha = (s, ma, han, lang) => (ma === "AE" ? tinKhachUae(s, han, lang) : tinKhachSing(s, han, lang));
/** Hai dòng: câu tiếng Anh gửi khách + bản dịch tiếng Việt cho anh em. */
const haiDong = (f) => { const en = f("en"); return en ? [`💬 ${en}`, `🇻🇳 Dịch: ${f("vi")}`] : []; };

const hanChu = (a) => a.days_left == null ? "" : a.days_left <= 0 ? "HẾT HẠN HÔM NAY" : `còn ${a.days_left} ngày`;

/** "đã nhắn 2 lần" — sổ chưa có (khách từ trước khi có sổ) thì "đã nhắn lúc mới tới". */
const chuDaNhan = (lan) => (lan > 0 ? `đã nhắn ${lan} lần` : "đã nhắn lúc mới tới");

/** Khối một khách phải GỌI: dòng đầu đậm, rồi khách, chỗ lấy, ghi chú, tin soạn sẵn.
 *  a.nhac = { lan } khi khách Đài đã được nhắn trước hôm nay (xem phanLoai). */
function khoiGoi(a, i, tien, giaoTanNha, ma = "") {
    const s = a.shipment || {};
    // "hẹn giao lại lần 3" — khách hẹn mãi là khách sắp bỏ đơn, gọi trước.
    const lan = Number(s.fail_count) > 1 ? ` lần ${s.fail_count}` : "";
    const dau = [maDon(s), s.cod_local ? `${fmt(Math.round(s.cod_local))} ${tien}` : "",
        a.code === "giao_hong" ? lyDo(s) + lan : hanChu(a),
        a.nhac ? (giaoTanNha ? (a.nhac.lan > 0 ? `đã nhắn ${a.nhac.lan} lần` : "") : chuDaNhan(a.nhac.lan)) : ""].filter(Boolean).join(" · ");
    const dong = [B(`${i + 1}. ${dau}`)];
    const khach = [s.customer, s.phone, giaoTanNha ? s.city : ""].filter(Boolean).join(" · ");
    if (khach) dong.push(`👤 ${khach}`);
    if (!giaoTanNha && s.store_name) dong.push(`🏪 ${s.store_name}${maLayHang(s) ? ` · mã lấy hàng ${maLayHang(s)}` : ""}`);
    // UAE không có bảng đối tác — ghi chú là của đơn POS (thường là địa chỉ, hẹn ngày giao).
    if (s.note) dong.push(`📝 ${ma === "AE" ? "Ghi chú đơn" : "Đối tác ghi"}: "${cat(s.note, 80)}"`);
    if (giaoTanNha) {
        dong.push(...haiDong((lang) => tinKhachNha(s, ma, { nhacLai: !!a.nhac, lan: Number(s.fail_count) || null }, lang)));
    } else {
        dong.push(...dongTinDai(s, { ngay: soNgayCho(a), conLai: a.days_left, nhacLai: !!a.nhac }));
    }
    return dong.join("\n");
}

/** Khối một khách (Sing / UAE) SẮP NHẬN HÀNG: 3–4 dòng, câu báo trước kèm bản dịch. */
function khoiSapGiao(x, tien, nuoc) {
    const s = x.shipment;
    const nhan = x.moc === "HomNay" ? "GIAO HÔM NAY" : x.moc === "NgayMai" ? "hẹn giao NGÀY MAI"
        : nuoc === "SG" ? "đã vào J&T, sắp giao" : "đã vào kho hãng, sắp giao";
    const dong = [B([maDon(s), s.cod_local ? `${fmt(Math.round(s.cod_local))} ${tien}` : "", nhan].filter(Boolean).join(" · "))];
    const khach = [s.customer, s.phone, s.city].filter(Boolean).join(" · ");
    if (khach) dong.push(`👤 ${khach}`);
    // Chỉ câu tiếng Anh: bản dịch đứng MỘT lần đầu mục cho mỗi loại (xem dichSapGiao) — câu
    // báo trước cùng loại giống hệt nhau, dịch từng khách làm tin UAE dài tới 11 phần.
    dong.push(`💬 ${tinSapGiao(s, x.moc, nuoc, "en")}`);
    return dong.join("\n");
}

/** Bản dịch câu báo trước — một dòng cho mỗi loại có mặt trong mục. */
function dichSapGiao(xs, nuoc) {
    const ten = { HomNay: "giao hôm nay", NgayMai: "hẹn giao ngày mai", SapGiao: "sắp giao" };
    return ["HomNay", "NgayMai", "SapGiao"].filter((m) => xs.some((x) => x.moc === m)).map((m) => {
        const mau = { customer: "{tên}", track17_code: "{mã}", status: (xs.find((x) => x.moc === m).shipment || {}).status };
        return `🇻🇳 Dịch (${ten[m]}): ${tinSapGiao(mau, m, nuoc, "vi")}`;
    });
}

/** Khối một khách Đài ở cửa hàng — MỚI TỚI (nhắn lần đầu) hoặc NHẮC LẠI (đã nhắn mà chưa
 *  lấy): gọn hơn khối gọi — 3 dòng. Nhắc lại thì dòng đầu ghi tới mấy ngày, đã nhắn mấy lần. */
function khoiMoiToi(a, tien) {
    const s = a.shipment || {};
    const n = soNgayCho(a);
    const dau = a.nhac
        ? [maDon(s), s.cod_local ? `${fmt(Math.round(s.cod_local))} ${tien}` : "",
            n != null ? `tới ${n} ngày` : "", chuDaNhan(a.nhac.lan)]
        : [maDon(s), s.cod_local ? `${fmt(Math.round(s.cod_local))} ${tien}` : "", hanChu(a)];
    const dong = [B(dau.filter(Boolean).join(" · "))];
    const khach = [s.customer, s.phone].filter(Boolean).join(" · ");
    const cho = s.store_name ? `🏪 ${s.store_name}${maLayHang(s) ? ` · mã lấy hàng ${maLayHang(s)}` : ""}` : "";
    if (khach || cho) dong.push([khach ? `👤 ${khach}` : "", cho].filter(Boolean).join(" · "));
    dong.push(...dongTinDai(s, { ngay: n, conLai: a.days_left, nhacLai: !!a.nhac }));
    return dong.join("\n");
}

/** "T1 (1n) · T2 (3n) … +5" — danh sách mã gọn trên một dòng. */
function dongMa(xs, nhan, max = 8) {
    const hien = xs.slice(0, max).map((a) => `${maDon(a.shipment)}${nhan ? ` ${nhan(a)}` : ""}`);
    return hien.join(" · ") + (xs.length > max ? ` … +${xs.length - max}` : "");
}

/**
 * Sự kiện trong MỘT ngày (giờ VN), đếm theo mốc đổi trạng thái: khách đã lấy / mới tới
 * cửa hàng / bắt đầu hoàn / đang đi giao — kèm tiền. Mốc 17TRACK là mốc thật; mốc từ bảng
 * đối tác là lúc nạp bảng thấy đổi (xấp xỉ, bảng trễ ~2 ngày).
 */
function suKienNgay(shipments, ngay) {
    const kq = { daLay: [], moiToi: [], hoan: [], dangGiao: [] };
    for (const s of shipments || []) {
        if (ngayVN(s.status_since) !== ngay) continue;
        if (s.status === "Delivered") kq.daLay.push(s);
        else if (s.status === "AvailableForPickup") kq.moiToi.push(s);
        else if (s.status === "OutForDelivery") kq.dangGiao.push(s);
        else if (laHoan(s)) kq.hoan.push(s);
    }
    return kq;
}
const tong = (xs) => xs.reduce((n, s) => n + (Number(s.cod_local) || 0), 0);

/** Phân loại một khối đơn cho tin: gọi ngay, mới tới, nhắc lại, hỏi đối tác, lệch.
 *  soNhac: sổ nhắc của bot — khách Đài đã được nhắn trước hôm nay thì gắn a.nhac = { lan }. */
function phanLoai(d, today, giaoTanNha, soNhac = {}, nuoc = "") {
    const alerts = d.alerts || [];
    const by = (code) => alerts.filter((a) => a.code === code);
    const gap = by("sap_bi_tra_ve");
    const sap = gap.filter((a) => a.days_left == null || a.days_left >= 0)
        .sort((a, b) => (a.days_left ?? 0) - (b.days_left ?? 0));
    // Quá hạn: quá ÍT ngày nhất lên đầu — quá 1 ngày còn hỏi giữ được, quá 3 tuần thì thôi.
    const qua = gap.filter((a) => a.days_left != null && a.days_left < 0).sort((a, b) => b.days_left - a.days_left);
    const hong = by("giao_hong");
    const suCo = hong.filter((a) => !["dang_hoan", "da_hoan"].includes(lyDo(a.shipment || {})));
    const dungIm = by("dung_im").filter((a) => (a.shipment || {}).track17_code);
    const chuaGui = by("dung_im").filter((a) => !(a.shipment || {}).track17_code);
    const lech = by("lech_trang_thai");
    // Khách MỚI TỚI = hàng tới cửa hàng hôm qua hoặc hôm nay và CHƯA được nhắn ngày nào.
    // Hàng tới từ trước hôm qua thì hôm tới đã nằm trong mục mới tới (bot nhắn khách mới tới
    // từ 26/09) — coi là đã nhắn, kể cả khi sổ nhắc chưa ghi (sổ có từ 30/09).
    const homQua = cong(today, -1);
    const moiTiepNhan = (a) => [homQua, today].includes(ngayVN((a.shipment || {}).status_since));
    const ganNhac = (a) => {
        if (giaoTanNha) return a;
        const lan = lanTruoc(soNhac, (a.shipment || {}).tracking, today);
        return lan > 0 || !moiTiepNhan(a) ? { ...a, nhac: { lan } } : a;
    };
    const toi = by("toi_cua_hang").map(ganNhac);
    const moiToi = toi.filter((a) => !a.nhac && moiTiepNhan(a));
    // NHẮC LẠI (Sỹ Anh 30/09/2026): đã nhắn mà vẫn chưa lấy → lặp lại MỖI SÁNG tới khi lấy
    // hoặc sang mục gọi (còn ≤ 2 ngày). Nằm lâu nhất lên đầu.
    const nhacLai = giaoTanNha ? [] : toi.filter((a) => a.nhac)
        .sort((a, b) => (soNgayCho(b) ?? 0) - (soNgayCho(a) ?? 0));
    // Giao tận nhà: đơn giao hỏng / hẹn lại là đơn cứu được bằng một cuộc gọi → lên danh sách gọi.
    // Sing / UAE: khách đã nhắn ngày trước (sổ nhắc) hoặc đã hỏng ≥ 2 lần → câu nhắc lại, gấp hơn.
    const ganNhacNha = (a) => {
        if (!giaoTanNha) return a;
        const s = a.shipment || {};
        const lan = lanTruoc(soNhac, s.tracking, today);
        return lan > 0 || Number(s.fail_count) >= 2 ? { ...a, nhac: { lan } } : a;
    };
    const goi = giaoTanNha ? [...sap, ...suCo].map(ganNhacNha) : sap.map(ganNhac);
    // SẮP GIAO (Sing + UAE, Sỹ Anh 01/10/2026): báo trước khách mở máy, để ý điện thoại — mỗi
    // mốc một lần (xem mocSapGiao). Khoá sổ "<mốc>:<mã>" để không báo lại mỗi sáng.
    const thuTu = { HomNay: 0, NgayMai: 1, SapGiao: 2 };
    const sapGiao = !giaoTanNha ? [] : (d.shipments || [])
        .map((s) => ({ shipment: s, moc: mocSapGiao(s, today, nuoc) }))
        .filter((x) => x.moc)
        .map((x) => ({ ...x, khoa: `${x.moc}:${x.shipment.tracking}` }))
        .filter((x) => !lanTruoc(soNhac, x.khoa, today))
        .sort((a, b) => thuTu[a.moc] - thuTu[b.moc]);
    return { sap, qua, suCo, dungIm, chuaGui, lech, moiToi, nhacLai, goi, sapGiao };
}

function nguoi(opts) {
    const p = opts.phuTrach || {};
    return p.ten ? M(p.ten, p.uid) + " · " : "";
}

/**
 * TIN SÁNG (08:30) — cũng dùng cho /vandon gõ trong ngày (opts.tieuDe khác).
 * @param d     JSON của GET /api/talpha/tracking?market=…
 * @param opts  { today, nowTs, maxGoi, maxMoiToi, quotaWarn, phuTrach:{ten,uid}, tieuDe }
 * @returns     { text, goi: [khoá vận đơn], moiToi: [khoá] } — bot lưu hai danh sách này để
 *              tin 22:00 chấm "sáng nay phải gọi ai, tối đã lấy chưa".
 */
function buildVanDonSang(d, opts = {}) {
    const today = opts.today;
    const nowTs = opts.nowTs ?? Date.now();
    const maxGoi = Number(opts.maxGoi) || 15;
    const maxMoiToi = Number(opts.maxMoiToi) || 20;
    const maxNhacLai = Number(opts.maxNhacLai) || 20;
    const nuoc = d.market || {};
    const tien = nuoc.currency || "NT$";
    const giaoTanNha = !!nuoc.code && nuoc.code !== "TW";
    const ten = String(nuoc.label || "Đài Loan").toUpperCase();
    const homQua = cong(today, -1);
    const { qua, suCo, dungIm, chuaGui, lech, moiToi, nhacLai, goi, sapGiao } = phanLoai(d, today, giaoTanNha, opts.soNhac, nuoc.code);
    const maxSapGiao = Number(opts.maxSapGiao) || 20;
    const hq = suKienNgay(d.shipments, homQua);
    const counts = d.counts || {};
    const ls = d.last_sync;

    const dong = [B(opts.tieuDe || `☀️ VẬN ĐƠN ${ten} · SÁNG ${ddmm(today)}`)];
    const nguon = [];
    if (!d.has_api_key) nguon.push("theo bảng đối tác, trễ ~2 ngày");
    else if (ls && ls.ok) nguon.push(`${tenNguon(d)} ${gioVN(ls.at).slice(0, 5)} ✓` + (ls.quota ? ` · quota còn ${fmt(ls.quota.remain)}/${fmt(ls.quota.total)}` : ""));
    if (nguon.length) dong.push(I(nguon.join(" · ")));
    const canhBao = dongNguon(d, nowTs, opts);
    if (canhBao) dong.push(canhBao);

    dong.push("", B(`📊 HÔM QUA ${ddmm(homQua)}`));
    if (giaoTanNha) {
        dong.push(`✅ Giao thành công ${B(`${fmt(hq.daLay.length)} đơn · ${fmt(Math.round(tong(hq.daLay)))} ${tien}`)}`);
        if (hq.hoan.length) dong.push(`↩️ Bắt đầu hoàn ${fmt(hq.hoan.length)} · ${fmt(Math.round(tong(hq.hoan)))} ${tien}`);
        dong.push(`🚚 Đang đi giao ${fmt(counts.OutForDelivery || 0)} đơn · 📦 Đang trên đường ${fmt((counts.InTransit || 0) + (counts.InfoReceived || 0))} đơn`);
    } else {
        dong.push(`✅ Khách đã lấy ${B(`${fmt(hq.daLay.length)} đơn · ${fmt(Math.round(tong(hq.daLay)))} ${tien}`)}`);
        dong.push(`🏪 Mới tới cửa hàng ${fmt(hq.moiToi.length)} · ↩️ Bắt đầu hoàn ${fmt(hq.hoan.length)} · ${fmt(Math.round(tong(hq.hoan)))} ${tien}`);
        dong.push(`📦 Đang nằm cửa hàng ${fmt(counts.AvailableForPickup || 0)} đơn · ${fmt(Math.round((d.totals || {}).at_store_value || 0))} ${tien}`);
    }

    if (goi.length) {
        const viec = giaoTanNha ? "GIAO HỎNG / HẸN LẠI" : "SẮP BỊ TRẢ VỀ";
        dong.push("", `☎️ ${nguoi(opts)}${B(`GỌI ${fmt(goi.length)} KHÁCH ${viec}`)}`);
        goi.slice(0, maxGoi).forEach((a, i) => dong.push("", khoiGoi(a, i, tien, giaoTanNha, nuoc.code)));
        if (goi.length > maxGoi) dong.push("", I(`… ${fmt(goi.length - maxGoi)} khách nữa trên dashboard`));
    } else {
        dong.push("", `☎️ ${B("Không có khách nào phải gọi gấp hôm nay")} ✅`);
    }

    if (sapGiao.length) {
        dong.push("", `🚚 ${nguoi(opts)}${B(`BÁO TRƯỚC ${fmt(sapGiao.length)} KHÁCH SẮP NHẬN HÀNG`)} — nhắn khách mở máy, để ý điện thoại`,
            ...dichSapGiao(sapGiao.slice(0, maxSapGiao), nuoc.code));
        sapGiao.slice(0, maxSapGiao).forEach((x) => dong.push("", khoiSapGiao(x, tien, nuoc.code)));
        if (sapGiao.length > maxSapGiao) dong.push("", I(`… ${fmt(sapGiao.length - maxSapGiao)} khách nữa trên dashboard`));
    }

    if (!giaoTanNha && moiToi.length) {
        dong.push("", `📬 ${nguoi(opts)}${B(`NHẮN ${fmt(moiToi.length)} KHÁCH HÀNG MỚI TỚI`)}`);
        moiToi.slice(0, maxMoiToi).forEach((a) => dong.push("", khoiMoiToi(a, tien)));
        if (moiToi.length > maxMoiToi) dong.push("", I(`… ${fmt(moiToi.length - maxMoiToi)} khách nữa trên dashboard`));
    }

    if (nhacLai.length) {
        dong.push("", `🔁 ${nguoi(opts)}${B(`NHẮC LẠI ${fmt(nhacLai.length)} KHÁCH ĐÃ NHẮN MÀ CHƯA LẤY`)}`);
        nhacLai.slice(0, maxNhacLai).forEach((a) => dong.push("", khoiMoiToi(a, tien)));
        if (nhacLai.length > maxNhacLai) dong.push("", I(`… ${fmt(nhacLai.length - maxNhacLai)} khách nữa trên dashboard`));
    }

    const hoi = [];
    if (qua.length) hoi.push(`• ${fmt(qua.length)} đơn quá hạn còn giữ không: ${dongMa(qua, (a) => `(${-a.days_left}n)`)}`);
    if (!giaoTanNha && suCo.length) hoi.push(`• ${fmt(suCo.length)} đơn giao hỏng/sự cố: ${dongMa(suCo, (a) => `(${lyDo(a.shipment || {})})`)}`);
    if (dungIm.length) hoi.push(`• ${fmt(dungIm.length)} đơn không nhúc nhích: ${dongMa(dungIm, (a) => `(${a.days}n)`)}`);
    if (chuaGui.length) hoi.push(`• ${fmt(chuaGui.length)} đơn chưa gửi hàng: ${dongMa(chuaGui, (a) => `(${a.days}n)`)}`);
    if (hoi.length) dong.push("", B("🔎 HỎI ĐỐI TÁC"), ...hoi);

    if (lech.length) {
        dong.push("", B(`💰 KIỂM ${fmt(lech.length)} ĐƠN LỆCH trước đối soát COD`));
        for (const a of lech.slice(0, 8)) dong.push(`• ${maDon(a.shipment)}: ${cat(String(a.detail || "").split(" — ")[0], 90)}`);
        if (lech.length > 8) dong.push(I(`… +${lech.length - 8} đơn`));
    }

    const ma = (xs) => xs.map((a) => (a.shipment || {}).tracking).filter(Boolean);
    // Khách Đài có câu soạn sẵn trong tin này (đủ cửa hàng) — bot ghi sổ nhắc sau khi gửi thật.
    const coTin = (xs) => xs.filter((a) => (a.shipment || {}).store_name);
    return {
        text: dong.join("\n"),
        goi: ma(goi),
        moiToi: ma(moiToi),
        nhacLai: ma(nhacLai),
        daNhan: giaoTanNha
            // Sing / UAE: khách giao hỏng có câu soạn sẵn + mốc báo trước đã gửi (khoá "<mốc>:<mã>").
            ? [...ma(goi.slice(0, maxGoi)), ...sapGiao.slice(0, maxSapGiao).map((x) => x.khoa)]
            : ma([...coTin(goi.slice(0, maxGoi)), ...coTin(moiToi.slice(0, maxMoiToi)), ...coTin(nhacLai.slice(0, maxNhacLai))]),
        sapGiao: sapGiao.map((x) => (x.shipment || {}).tracking).filter(Boolean),
    };
}

/**
 * TIN TỐI (22:00) — hôm nay làm được gì. 17TRACK cập nhật lại lúc 21:30 (miễn phí).
 * @param sangNay  { goi: [khoá], moiToi: [khoá] } bot lưu lúc gửi tin sáng; không có (bot vừa
 *                 bật lại, hôm nay chưa gửi tin sáng) thì bỏ phần chấm, vẫn báo số cả ngày.
 */
function buildVanDonToi(d, opts = {}) {
    const today = opts.today;
    const nowTs = opts.nowTs ?? Date.now();
    const nuoc = d.market || {};
    const tien = nuoc.currency || "NT$";
    const giaoTanNha = !!nuoc.code && nuoc.code !== "TW";
    const ten = String(nuoc.label || "Đài Loan").toUpperCase();
    const ls = d.last_sync;
    const byKey = new Map((d.shipments || []).map((s) => [s.tracking, s]));
    const hanCon = new Map((d.alerts || []).filter((a) => a.days_left != null).map((a) => [(a.shipment || {}).tracking, a.days_left]));

    const dong = [B(`🌙 VẬN ĐƠN ${ten} · TỐI ${ddmm(today)} · HÔM NAY LÀM ĐƯỢC GÌ`)];
    if (ls && ls.ok) dong.push(I(`${tenNguon(d)} cập nhật ${gioVN(ls.at).slice(0, 5)} ✓`));
    const canhBao = dongNguon(d, nowTs, opts);
    if (canhBao) dong.push(canhBao);

    // Chấm danh sách buổi sáng: khách đã lấy / chưa / bị trả về, theo trạng thái lúc này.
    const cham = (keys) => {
        const kq = { lay: [], cho: [], tra: [] };
        for (const k of keys || []) {
            const s = byKey.get(k);
            if (!s) continue;
            if (s.status === "Delivered") kq.lay.push(s);
            else if (laHoan(s) || s.status === "Returned" || s.status === "Cancelled" || s.status === "Destroyed") kq.tra.push(s);
            else kq.cho.push(s);
        }
        return kq;
    };
    const sang = opts.sangNay;
    if (sang && (sang.goi || []).length) {
        const g = cham(sang.goi);
        const viec = giaoTanNha ? "GIAO HỎNG / HẸN LẠI" : "PHẢI GỌI";
        dong.push("", B(`☎️ ${fmt(sang.goi.length)} KHÁCH ${viec} SÁNG NAY`));
        dong.push(`✅ ${fmt(g.lay.length)} đã ${giaoTanNha ? "giao" : "lấy"}${g.lay.length ? ` · ${B(`cứu ${fmt(Math.round(tong(g.lay)))} ${tien}`)}` : ""}`);
        if (g.cho.length) {
            const maiHet = g.cho.filter((s) => (hanCon.get(s.tracking) ?? 99) <= 1);
            const chu = !giaoTanNha && maiHet.length ? `, ${B("MAI HẾT HẠN")}` : "";
            dong.push(`⏳ ${fmt(g.cho.length)} chưa ${giaoTanNha ? "giao" : "lấy"}${chu}: ${g.cho.slice(0, 10).map(maDon).join(" · ")}${g.cho.length > 10 ? " …" : ""}`);
        }
        if (g.tra.length) dong.push(`❌ ${fmt(g.tra.length)} bị trả về: ${g.tra.slice(0, 10).map(maDon).join(" · ")} · ${fmt(Math.round(tong(g.tra)))} ${tien}`);
    }
    if (!giaoTanNha && sang && (sang.moiToi || []).length) {
        const m = cham(sang.moiToi);
        dong.push("", `📬 ${B(`${fmt(sang.moiToi.length)} KHÁCH HÀNG MỚI TỚI`)} → ${fmt(m.lay.length)} đã lấy · ${fmt(m.cho.length)} còn chờ`);
    }
    if (sang && (sang.sapGiao || []).length) {
        const m = cham(sang.sapGiao);
        dong.push("", `🚚 ${B(`${fmt(sang.sapGiao.length)} KHÁCH BÁO TRƯỚC SÁNG NAY`)} → ${fmt(m.lay.length)} đã nhận`
            + `${m.lay.length ? ` (${fmt(Math.round(tong(m.lay)))} ${tien})` : ""} · ${fmt(m.cho.length)} chưa`
            + `${m.tra.length ? ` · ${fmt(m.tra.length)} bị trả về` : ""}`);
    }
    if (!giaoTanNha && sang && (sang.nhacLai || []).length) {
        const m = cham(sang.nhacLai);
        dong.push("", `🔁 ${B(`${fmt(sang.nhacLai.length)} KHÁCH NHẮC LẠI`)} → ${fmt(m.lay.length)} đã lấy`
            + `${m.lay.length ? ` (${fmt(Math.round(tong(m.lay)))} ${tien})` : ""} · ${fmt(m.cho.length)} còn chờ, sáng mai nhắc tiếp`);
    }

    const hn = suKienNgay(d.shipments, today);
    const counts = d.counts || {};
    dong.push("", B(`📊 CẢ NGÀY ${ddmm(today)}`));
    if (giaoTanNha) {
        dong.push(`✅ Giao thành công ${fmt(hn.daLay.length)} đơn · ${fmt(Math.round(tong(hn.daLay)))} ${tien}`);
        if (hn.hoan.length) dong.push(`↩️ Bắt đầu hoàn ${fmt(hn.hoan.length)} · ${fmt(Math.round(tong(hn.hoan)))} ${tien}`);
        dong.push(`🚚 Đang đi giao ${fmt(counts.OutForDelivery || 0)} · 📦 Đang trên đường ${fmt((counts.InTransit || 0) + (counts.InfoReceived || 0))}`);
    } else {
        dong.push(`✅ Khách đã lấy ${fmt(hn.daLay.length)} đơn · ${fmt(Math.round(tong(hn.daLay)))} ${tien}`);
        dong.push(`🏪 Mới tới cửa hàng ${fmt(hn.moiToi.length)} · ↩️ Bắt đầu hoàn ${fmt(hn.hoan.length)} · ${fmt(Math.round(tong(hn.hoan)))} ${tien}`);
        dong.push(`📦 Còn nằm cửa hàng ${fmt(counts.AvailableForPickup || 0)} đơn · ${fmt(Math.round((d.totals || {}).at_store_value || 0))} ${tien}`);
    }
    if (sang && (sang.goi || []).length) {
        const treo = cham(sang.goi).cho.length;
        if (treo) dong.push("", I(`Sáng mai 08:30: ${fmt(treo)} khách còn treo ở trên đứng đầu danh sách gọi.`));
    }
    return dong.join("\n");
}

module.exports = { buildVanDonSang, buildVanDonToi, fetchVanDon, dongNguon, ghiSoNhac, lanTruoc, lyDo, maLayHang, suKienNgay, tinKhachDai, tinKhachSing, tinKhachUae, tinSapGiao, mocSapGiao };

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

/**
 * Tin báo khách Đài ra lấy hàng (Sỹ Anh chốt 30/09/2026).
 *
 * • LẦN ĐẦU — nhẹ nhàng, nói hàng ĐÃ TỚI được mấy ngày (đếm xuôi) chứ không nói còn mấy
 *   ngày: ghi "còn 5 ngày" thì khách thong thả rồi quên. "Hàng của bạn đã tới cửa hàng
 *   2 ngày rồi, phiền bạn tranh thủ ghé lấy nhé, quá hạn hàng sẽ bị trả về."
 * • NHẮC LẠI — khách đã được nhắn mà vẫn chưa lấy: gấp hơn — "再次提醒", nói rõ nằm đó
 *   mấy ngày rồi mà chưa lấy, sắp hết hạn giữ; mai / hôm nay là ngày cuối thì nói thẳng.
 * Luôn có mã lấy hàng (mã tracking) + số tiền mang theo. Hạn thật hiện cho Thương ở dòng
 * đầu khối. Câu chữ PHẢI giống tracking-tab.tsx → soanTin.
 *
 * @param han { ngay: số ngày đã nằm ở cửa hàng, conLai: còn mấy ngày (≤0 = hôm nay là
 *            ngày cuối), nhacLai: khách đã được nhắn trước hôm nay }
 */
function tinKhachDai(s, { ngay = null, conLai = null, nhacLai = false } = {}) {
    if (!s.store_name) return null;
    const ten = s.customer || "客戶";
    const ma = maLayHang(s);
    const cho = `${s.store_name}${ma ? `（取貨編號 ${ma}）` : ""}`;
    const tien = Number(s.cod_local) > 0 ? `NT$${Math.round(Number(s.cod_local)).toLocaleString("en-US")}` : "";
    const cuoi = conLai != null && conLai <= 0;
    if (nhacLai) {
        const lau = ngay ? `已經在 ${cho} 放了 ${ngay} 天` : `已經送達 ${cho} 好幾天了`;
        const han = cuoi ? "今天是最後取件日，今天沒領取包裹就會被退回，請您務必今天抽空去領取！"
            : conLai === 1 ? "明天就是最後取件日了，逾期包裹會被退回，請您盡快去領取！"
                : "門市保管期快到了，逾期包裹會被退回，請您盡快去領取！";
        return `${ten} 您好，再次提醒您：您的包裹${lau}，還沒有領取喔！${han}`
            + `${tien ? `取貨時請準備 ${tien}。` : ""}如果有任何問題請直接回覆我們，謝謝您！`;
    }
    const toi = ngay ? `已經送到 ${cho} ${ngay} 天了` : ngay === 0 ? `今天已經送達 ${cho}` : `已經送達 ${cho}`;
    const han = cuoi ? "今天是最後取件日，麻煩您今天抽空到門市領取喔" : "麻煩您抽空到門市領取喔";
    return `${ten} 您好～您的包裹${toi}${tien ? `，取貨時請準備 ${tien}` : ""}。${han}，逾期包裹會被退回。謝謝您！`;
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

// Singapore giao tận nhà (J&T): việc là hẹn lại giờ giao.
function tinKhachSing(s) {
    const ten = s.customer || "there";
    const ma = s.track17_code || s.tracking;
    return `Hi ${ten}, J&T could not deliver your parcel ${ma}. Please reply with a good time for delivery and keep your phone on. Thank you!`;
}

// UAE giao tận nhà qua WeShip: câu theo lý do — khách từ chối thì hỏi còn lấy không, không
// nghe máy / hẹn lại thì xin giờ giao, sai địa chỉ thì xin địa chỉ đủ.
function tinKhachUae(s) {
    const ten = s.customer || "there";
    const ma = s.track17_code || s.tracking;
    const sub = String(s.sub_status || "");
    if (/Rejected/.test(sub)) return `Hi ${ten}, the courier reported that your order (parcel ${ma}) was refused. If you still want it, please reply with a good time and we will deliver it again. Thank you!`;
    if (/NoResponse/.test(sub)) return `Hi ${ten}, the courier tried to deliver your order (parcel ${ma}) but could not reach you by phone. Please reply with a good time for delivery and keep your phone on. Thank you!`;
    if (/InvalidAddress/.test(sub)) return `Hi ${ten}, the courier could not find your address for order (parcel ${ma}). Please reply with your full address and a good time for delivery. Thank you!`;
    return `Hi ${ten}, the delivery of your order (parcel ${ma}) was rescheduled. Please reply with a good time for delivery and keep your phone on. Thank you!`;
}
const tinKhachNha = (s, ma) => (ma === "AE" ? tinKhachUae(s) : tinKhachSing(s));

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
        !giaoTanNha && a.nhac ? chuDaNhan(a.nhac.lan) : ""].filter(Boolean).join(" · ");
    const dong = [B(`${i + 1}. ${dau}`)];
    const khach = [s.customer, s.phone, giaoTanNha ? s.city : ""].filter(Boolean).join(" · ");
    if (khach) dong.push(`👤 ${khach}`);
    if (!giaoTanNha && s.store_name) dong.push(`🏪 ${s.store_name}${maLayHang(s) ? ` · mã lấy hàng ${maLayHang(s)}` : ""}`);
    // UAE không có bảng đối tác — ghi chú là của đơn POS (thường là địa chỉ, hẹn ngày giao).
    if (s.note) dong.push(`📝 ${ma === "AE" ? "Ghi chú đơn" : "Đối tác ghi"}: "${cat(s.note, 80)}"`);
    const tin = giaoTanNha ? tinKhachNha(s, ma)
        : tinKhachDai(s, { ngay: soNgayCho(a), conLai: a.days_left, nhacLai: !!a.nhac });
    if (tin) dong.push(`💬 ${tin}`);
    return dong.join("\n");
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
    const tin = tinKhachDai(s, { ngay: n, conLai: a.days_left, nhacLai: !!a.nhac });
    if (tin) dong.push(`💬 ${tin}`);
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
function phanLoai(d, today, giaoTanNha, soNhac = {}) {
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
    const goi = giaoTanNha ? [...sap, ...suCo] : sap.map(ganNhac);
    return { sap, qua, suCo, dungIm, chuaGui, lech, moiToi, nhacLai, goi };
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
    const { qua, suCo, dungIm, chuaGui, lech, moiToi, nhacLai, goi } = phanLoai(d, today, giaoTanNha, opts.soNhac);
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
        daNhan: giaoTanNha ? [] : ma([...coTin(goi.slice(0, maxGoi)), ...coTin(moiToi.slice(0, maxMoiToi)), ...coTin(nhacLai.slice(0, maxNhacLai))]),
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

module.exports = { buildVanDonSang, buildVanDonToi, fetchVanDon, dongNguon, ghiSoNhac, lanTruoc, lyDo, maLayHang, suKienNgay, tinKhachDai, tinKhachSing, tinKhachUae };

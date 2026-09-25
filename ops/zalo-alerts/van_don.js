// Tin "VẬN ĐƠN CẦN XỬ LÝ" — Sỹ Anh chốt 25/09/2026: mỗi sáng 08:00 gửi vào một nhóm Zalo
// RIÊNG (không phải nhóm ads) danh sách đơn cần gọi khách, cần hỏi hãng vận chuyển.
//
// Số lấy từ ĐÚNG route màn "Theo dõi vận đơn" đang dùng (/api/talpha/tracking), nên tin và
// màn hình không lệch được: cùng luật cảnh báo buildAlerts, cùng mốc hạn lấy hàng.
// Bảng đối tác nạp 6h, 17TRACK đồng bộ ngay sau đó (ops/deploy/tracking-import.sh).
//
// Tin có tên + SĐT khách — chỉ gửi vào nhóm vận đơn, không bao giờ vào nhóm ads.
// Hàm thuần: không gọi mạng (trừ fetchVanDon), không đụng Zalo — để test được.
const { B } = require("./zalo_text");

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
const cat = (s, n) => { const x = String(s || "").replace(/\s+/g, " ").trim(); return x.length > n ? x.slice(0, n - 1) + "…" : x; };

async function fetchVanDon(cfg, today, f = fetch) {
    if (!cfg || !cfg.url) throw new Error("thiếu vanDon.url trong config");
    const from = cong(today, -(Number(cfg.rangeDays) || 60));
    const res = await f(`${cfg.url}?from=${from}&to=${today}`, { headers: { "cache-control": "no-store" } });
    if (!res.ok) throw new Error(`tracking HTTP ${res.status}`);
    const j = await res.json();
    if (j.error) throw new Error(j.error);
    return j;
}

/**
 * Cảnh báo "số này mới tới đâu" — MỖI VẤN ĐỀ MỘT DÒNG, không có vấn đề thì không có dòng
 * nào (giờ cập nhật đã nằm trên đầu tin). Số cũ mà không ai nói thì sale gọi nhầm khách
 * đã lấy hàng rồi — nên tin TỰ TỐ khi 17TRACK lỗi, hết quota, hay đồng bộ/nạp bảng đứng.
 */
function dongNguon(d, nowTs, { quotaWarn = 200, staleHours = 26 } = {}) {
    const cu = (iso) => iso && nowTs - Date.parse(iso) > staleHours * 3600000;
    const ra = [];
    const ls = d.last_sync;
    if (d.has_api_key && !ls) ra.push(`⚠️ ${B("17TRACK chưa đồng bộ lần nào")} — số theo bảng đối tác, trễ ~2 ngày`);
    else if (ls && !ls.ok) ra.push(`⚠️ ${B(`17TRACK lỗi ${gioVN(ls.at)}`)}: ${cat(ls.error, 90)}`);
    else if (ls && cu(ls.at)) ra.push(`⚠️ ${B(`17TRACK chưa chạy từ ${gioVN(ls.at)}`)} — số có thể trễ`);
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

/** Giờ cập nhật cho dòng đầu tin — số của lượt đồng bộ gần nhất. */
function capNhat(d) {
    const ls = d.last_sync;
    if (!d.has_api_key) return "theo bảng đối tác";
    return ls && ls.ok ? `cập nhật ${gioVN(ls.at).slice(0, 5)}` : "";
}

const maDon = (a) => (a.shipment || {}).order_id || (a.shipment || {}).tracking || "?";

/** Một dòng gọi khách: mã · tiền · hạn · tên SĐT · cửa hàng #mã lấy hàng. */
function dongGoi(a, i) {
    const s = a.shipment || {};
    const han = a.days_left == null ? "" : a.days_left <= 0 ? B("HÔM NAY") : `còn ${a.days_left} ngày`;
    const khach = [s.customer, s.phone].filter(Boolean).join(" ");
    const cuaHang = s.store_name ? `${s.store_name}${s.store_code ? ` #${s.store_code}` : ""}` : "";
    return `${i + 1}. ` + [B(maDon(a)), s.cod_local ? fmt(Math.round(s.cod_local)) : "", han, khach, cuaHang]
        .filter(Boolean).join(" · ");
}

/** Danh sách mã gọn trên một dòng: "T1 (1n) · T2 (3n) … +5". */
function dongMa(xs, nhan, max) {
    const hien = xs.slice(0, max).map((a) => `${B(maDon(a))}${nhan ? ` ${nhan(a)}` : ""}`);
    return hien.join(" · ") + (xs.length > max ? ` … +${xs.length - max}` : "");
}

/**
 * Lý do giao hỏng. 17TRACK nói bằng sub_status; đối tác nói bằng chữ trong cột NOTE.
 * "hoàn" tách riêng: hàng đã quay đầu thì gọi khách không cứu được nữa — chỉ để đếm.
 */
function lyDo(s) {
    const sub = String(s.sub_status || ""), raw = String(s.raw_status || s.last_event || "");
    if (/Returning/.test(sub) || (s.source !== "17track" && /hoàn/i.test(raw))) return "dang_hoan";
    if (/Returned/.test(sub)) return "da_hoan";
    if (/Rejected/.test(sub) || /từ chối/i.test(raw)) return "khách từ chối";
    if (/NoBody/.test(sub) || /vắng/i.test(raw)) return "vắng nhà";
    if (/InvalidAddress/.test(sub)) return "sai địa chỉ";
    if (s.status === "DeliveryFailure") return "giao hỏng";
    return "sự cố";
}

/** Lệch đối tác ↔ 17TRACK nói bằng 3–4 chữ: "ghi giao · 17T hoàn". */
function lechNgan(a) {
    const s = a.shipment || {};
    if (s.status === "Delivered") return /Return/.test(String(s.t17_sub_status || "")) ? "(ghi giao · 17T hoàn)" : "(ghi giao · 17T sự cố)";
    return "(ghi hoàn/huỷ · 17T khách đã nhận)";
}

/**
 * TIN GỌN — Sỹ Anh chốt 25/09/2026: MỘT tin Zalo, mỗi đơn một dòng.
 *   • Chỉ đơn CẦN GỌI NGAY (sắp bị trả về) in đủ tên, SĐT, cửa hàng, mã lấy hàng.
 *   • Quá hạn, giao hỏng, đứng im, lệch: một dòng mỗi loại, chỉ mã đơn.
 *   • Hàng đang/đã hoàn chỉ ĐẾM (44/46 "giao hỏng" ngày 25/09 là hàng quay đầu — gọi
 *     khách không cứu được, liệt kê ra chỉ làm dài tin).
 * Chi tiết + nút chép tin nhắn khách nằm ở dashboard (link cuối tin).
 *
 * @param d      JSON của GET /api/talpha/tracking
 * @param opts   { today: "YYYY-MM-DD" giờ VN, nowTs, maxGap, maxCanhBao, link, quotaWarn }
 */
function buildTinVanDon(d, opts = {}) {
    const today = opts.today;
    const nowTs = opts.nowTs ?? Date.now();
    const maxGap = Number(opts.maxGap) || 15;        // số dòng gọi khách tối đa
    const maxMa = Number(opts.maxCanhBao) || 8;      // số mã tối đa trên một dòng liệt kê
    const alerts = d.alerts || [];
    const by = (code) => alerts.filter((a) => a.code === code);

    const gap = by("sap_bi_tra_ve");
    // Còn hạn: gần hết hạn nhất lên đầu. Quá hạn: quá ÍT nhất lên đầu — đơn quá 1 ngày còn
    // gọi kịp, đơn quá 3 tuần gần như chắc đã bị trả về.
    const sap = gap.filter((a) => a.days_left == null || a.days_left >= 0)
        .sort((a, b) => (a.days_left ?? 0) - (b.days_left ?? 0));
    const qua = gap.filter((a) => a.days_left != null && a.days_left < 0)
        .sort((a, b) => b.days_left - a.days_left);
    const hong = by("giao_hong");
    const dangHoan = hong.filter((a) => lyDo(a.shipment || {}) === "dang_hoan");
    const daHoan = hong.filter((a) => lyDo(a.shipment || {}) === "da_hoan");
    const suCo = hong.filter((a) => !["dang_hoan", "da_hoan"].includes(lyDo(a.shipment || {})));
    const dungIm = by("dung_im");
    const lech = by("lech_trang_thai");
    const moiToi = by("toi_cua_hang");
    const chuaRo = by("chua_dang_ky");

    const atStore = (d.counts || {}).AvailableForPickup || 0;
    const tienCho = (d.totals || {}).at_store_value || 0;
    const cn = capNhat(d);

    const dong = [`📦 ${B(`VẬN ĐƠN ${ddmm(today)}`)}${cn ? ` · ${cn}` : ""}`];
    if (atStore) dong.push(`🏪 ${fmt(atStore)} đơn ở cửa hàng · ${B(fmt(Math.round(tienCho)) + " NT$")} chờ lấy`);
    const canhBaoNguon = dongNguon(d, nowTs, opts);
    if (canhBaoNguon) dong.push(canhBaoNguon);

    if (!alerts.length) return [...dong, "", "✅ Không có đơn nào cần xử lý."].join("\n");

    if (sap.length) {
        dong.push("", `☎️ ${B(`GỌI NGAY — sắp bị trả về (${sap.length})`)}`);
        sap.slice(0, maxGap).forEach((a, i) => dong.push(dongGoi(a, i)));
        if (sap.length > maxGap) dong.push(`… +${sap.length - maxGap} đơn nữa trên dashboard`);
    }

    const tom = [];
    if (qua.length) tom.push(`⏰ ${B(`Quá hạn lấy (${qua.length})`)}: ${dongMa(qua, (a) => `(${-a.days_left}n)`, maxMa)}`);
    if (suCo.length) tom.push(`⚠️ ${B(`Giao hỏng (${suCo.length})`)}: ${dongMa(suCo, (a) => `(${lyDo(a.shipment || {})})`, maxMa)}`);
    if (dangHoan.length || daHoan.length) {
        tom.push(`↩️ ${B(`Hoàn hàng (${dangHoan.length + daHoan.length})`)}: `
            + [dangHoan.length ? `đang hoàn ${dangHoan.length}` : "", daHoan.length ? `đã hoàn ${daHoan.length}` : ""].filter(Boolean).join(" · "));
    }
    if (dungIm.length) tom.push(`🐢 ${B(`Đứng im (${dungIm.length})`)}: ${dongMa(dungIm, (a) => `(${a.days}n)`, maxMa)}`);
    if (lech.length) tom.push(`❗ ${B(`Lệch đối tác ↔ 17TRACK (${lech.length})`)}: ${dongMa(lech, lechNgan, Math.min(maxMa, 5))}`);
    const nhac = [moiToi.length ? `${fmt(moiToi.length)} đơn vừa tới cửa hàng — nhắn khách ra lấy` : "",
        chuaRo.length ? `${fmt(chuaRo.length)} chưa rõ vị trí` : ""].filter(Boolean).join(" · ");
    if (nhac) tom.push(`📬 ${nhac}`);
    if (tom.length) dong.push("", ...tom);

    dong.push("", `👉 Chi tiết, chép tin nhắn khách: ${opts.link || "dashboard → Đơn hàng & Đối soát → Theo dõi vận đơn"}`);
    return dong.join("\n");
}

module.exports = { buildTinVanDon, fetchVanDon, dongNguon };

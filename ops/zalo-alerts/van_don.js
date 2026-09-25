// Tin "VẬN ĐƠN CẦN XỬ LÝ" — Sỹ Anh chốt 25/09/2026: mỗi sáng 08:00 gửi vào một nhóm Zalo
// RIÊNG (không phải nhóm ads) danh sách đơn cần gọi khách, cần hỏi hãng vận chuyển.
//
// Số lấy từ ĐÚNG route màn "Theo dõi vận đơn" đang dùng (/api/talpha/tracking), nên tin và
// màn hình không lệch được: cùng luật cảnh báo buildAlerts, cùng mốc hạn lấy hàng.
// Bảng đối tác nạp 6h, 17TRACK đồng bộ ngay sau đó (ops/deploy/tracking-import.sh).
//
// Tin có tên + SĐT khách — chỉ gửi vào nhóm vận đơn, không bao giờ vào nhóm ads.
// Hàm thuần: không gọi mạng (trừ fetchVanDon), không đụng Zalo — để test được.
const { B, I } = require("./zalo_text");

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
 * Dòng "số này mới tới đâu". Số cũ mà không ai nói thì sale gọi nhầm khách đã lấy hàng
 * rồi — nên tin TỰ TỐ khi 17TRACK lỗi, hết quota, hay đồng bộ/nạp bảng bị đứng.
 */
function dongNguon(d, nowTs, { quotaWarn = 200, staleHours = 26 } = {}) {
    const cu = (iso) => iso && nowTs - Date.parse(iso) > staleHours * 3600000;
    const ra = [];
    const ls = d.last_sync;
    if (!d.has_api_key) {
        ra.push(I("Nguồn: bảng đối tác (trễ ~2 ngày) — chưa bật 17TRACK."));
    } else if (!ls) {
        ra.push(`⚠️ ${B("17TRACK chưa đồng bộ lần nào")} ${I("— số dưới đây theo bảng đối tác, có thể trễ 2 ngày.")}`);
    } else if (!ls.ok) {
        ra.push(`⚠️ ${B(`17TRACK lỗi lúc ${gioVN(ls.at)}`)}: ${cat(ls.error, 120)}\n${I("Số dưới đây theo lần đồng bộ trước + bảng đối tác, có thể trễ.")}`);
    } else if (cu(ls.at)) {
        ra.push(`⚠️ ${B(`17TRACK chưa đồng bộ từ ${gioVN(ls.at)}`)} ${I("— việc sáng nay không chạy, số có thể trễ.")}`);
    } else {
        const q = ls.quota;
        const nk = (ls.keys || []).length;
        ra.push(I(`17TRACK cập nhật ${gioVN(ls.at)}${q ? ` · còn ${fmt(q.remain)} quota` : ""}${nk > 1 ? ` (${nk} khoá)` : ""}`));
    }
    // Nhiều khoá: một khoá chết thì lượt vẫn chạy bằng khoá khác — nhưng mã của khoá chết
    // đứng im, nên phải nêu đích danh.
    if (ls && ls.ok) {
        for (const k of (ls.keys || []).filter((x) => !x.ok)) {
            ra.push(`⚠️ ${B(`17TRACK ${k.label} lỗi`)}: ${cat(k.error, 100)} ${I("— mã của khoá này không cập nhật được.")}`);
        }
    }
    if (ls && Number(ls.orphaned) > 0) {
        ra.push(`⚠️ ${B(`${fmt(ls.orphaned)} mã thuộc khoá 17TRACK đã gỡ khỏi .env`)} — không cập nhật được nữa, lắp lại khoá đó nếu còn dùng.`);
    }
    // Gói miễn phí hết quota là CHUYỆN THƯỜNG cuối tháng — nói rõ đơn nào đang mù và bao
    // giờ có lại, chứ không chỉ kêu "nạp thêm".
    if (ls && ls.quota_out) {
        // over_cap gồm cả đơn thường để lượt sau vì chia nhịp — đó KHÔNG phải đơn cần xử lý.
        const n = Math.max(0, (Number(ls.over_cap) || 0) - (Number(ls.deferred) || 0));
        ra.push(`⚠️ ${B(`HẾT QUOTA 17TRACK${n ? ` — ${fmt(n)} đơn chưa được theo dõi` : ""}`)}. `
            + "Các đơn đó đang theo bảng đối tác (trễ ~2 ngày). Thêm khoá mới, hoặc chờ quota miễn phí về lại ngày 1.");
    } else if (ls && ls.ok && ls.quota && ls.quota.total > 0) {
        // Ngưỡng theo cỡ gói: gói miễn phí vài trăm mã thì "còn dưới 200" là kêu mỗi ngày.
        const nguong = Math.min(quotaWarn, Math.ceil(ls.quota.total * 0.15));
        if (ls.quota.remain < nguong) {
            ra.push(`⚠️ ${B(`Quota 17TRACK sắp hết — còn ${fmt(ls.quota.remain)}/${fmt(ls.quota.total)}`)}.`);
        }
    }
    if (cu(d.last_import)) ra.push(`⚠️ ${B(`Bảng đối tác chưa nạp từ ${gioVN(d.last_import)}`)} — xem journalctl -u talpha-tracking.`);
    return ra.join("\n");
}

function dongDon(a, { soThuTu, them } = {}) {
    const s = a.shipment || {};
    const ma = s.order_id || s.tracking || "?";
    const khach = [s.customer, s.phone].filter(Boolean).join(" · ");
    const cuaHang = s.store_name ? `${s.store_name}${s.store_code ? ` (mã ${s.store_code})` : ""}` : "";
    let m = `${soThuTu ? soThuTu + "." : "•"} ${B(ma)}${s.cod_local ? ` · ${fmt(Math.round(s.cod_local))} NT$` : ""}${them ? ` · ${them}` : ""}`;
    const dong2 = [khach, cuaHang].filter(Boolean).join(" · ");
    if (dong2) m += `\n   ${dong2}`;
    return m;
}

/**
 * @param d      JSON của GET /api/talpha/tracking
 * @param opts   { today: "YYYY-MM-DD" giờ VN, nowTs, maxGap, maxCanhBao, link, quotaWarn }
 */
function buildTinVanDon(d, opts = {}) {
    const today = opts.today;
    const nowTs = opts.nowTs ?? Date.now();
    const maxGap = Number(opts.maxGap) || 15;
    const maxCanhBao = Number(opts.maxCanhBao) || 8;
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
    const dungIm = by("dung_im");
    const lech = by("lech_trang_thai");
    const moiToi = by("toi_cua_hang");
    const chuaRo = by("chua_dang_ky");

    const nGap = gap.length, nCb = hong.length + dungIm.length + lech.length, nNhac = moiToi.length + chuaRo.length;
    const atStore = (d.counts || {}).AvailableForPickup || 0;
    const tienCho = (d.totals || {}).at_store_value || 0;

    let m = `📦 ${B(`VẬN ĐƠN CẦN XỬ LÝ — ${ddmm(today)}`)}\n`;
    if (!alerts.length) {
        return m + `✅ Không có đơn nào cần xử lý.${atStore ? ` ${fmt(atStore)} đơn đang ở cửa hàng, chưa tới hạn.` : ""}\n`
            + dongNguon(d, nowTs, opts);
    }
    m += `🔴 Gấp ${B(fmt(nGap))} · 🟠 Cảnh báo ${B(fmt(nCb))} · 🔔 Nhắc ${fmt(nNhac)}\n`;
    if (atStore) m += `🏪 ${fmt(atStore)} đơn đang nằm ở cửa hàng · ${B(fmt(Math.round(tienCho)) + " NT$")} chờ khách lấy\n`;
    m += dongNguon(d, nowTs, opts);

    let conLai = 0;
    let slot = maxGap;
    if (sap.length) {
        m += `\n\n🔴 ${B(`SẮP BỊ TRẢ VỀ — gọi khách ngay (${sap.length})`)}`;
        sap.slice(0, slot).forEach((a, i) => {
            m += "\n" + dongDon(a, { soThuTu: i + 1, them: a.days_left === 0 ? "HẾT HẠN HÔM NAY" : `còn ${a.days_left} ngày` });
        });
        conLai += Math.max(0, sap.length - slot);
        slot = Math.max(0, slot - sap.length);
    }
    // Hết chỗ in thì chỉ còn MỘT dòng đếm — tiêu đề mục mà không có đơn nào bên dưới
    // trông như tin bị cắt.
    if (qua.length && !slot) {
        m += `\n\n🔴 ${fmt(qua.length)} đơn đã quá hạn lấy — xem ở dashboard.`;
        conLai += qua.length;
    } else if (qua.length) {
        m += `\n\n🔴 ${B(`ĐÃ QUÁ HẠN LẤY (${qua.length})`)} ${I("— gọi xem hàng còn giữ được không")}`;
        qua.slice(0, slot).forEach((a, i) => {
            m += "\n" + dongDon(a, { soThuTu: i + 1, them: `quá ${-a.days_left} ngày` });
        });
        conLai += Math.max(0, qua.length - slot);
    }

    slot = maxCanhBao;
    if (hong.length) {
        m += `\n\n🟠 ${B(`GIAO HỎNG · SỰ CỐ (${hong.length})`)}`;
        for (const a of hong.slice(0, slot)) {
            m += "\n" + dongDon(a, { them: cat(a.shipment?.last_event || a.title, 50) });
        }
        conLai += Math.max(0, hong.length - slot);
        slot = Math.max(0, slot - hong.length);
    }
    if (dungIm.length && !slot) {
        m += `\n\n🟠 ${fmt(dungIm.length)} đơn đứng im — hỏi lại hãng vận chuyển, xem ở dashboard.`;
        conLai += dungIm.length;
    } else if (dungIm.length) {
        m += `\n\n🟠 ${B(`ĐỨNG IM (${dungIm.length})`)} ${I("— hỏi lại hãng vận chuyển")}`;
        for (const a of dungIm.slice(0, slot)) m += "\n" + dongDon(a, { them: `${a.days} ngày không nhúc nhích` });
        conLai += Math.max(0, dungIm.length - slot);
    }

    // Lệch đối tác ↔ 17TRACK là chuyện TIỀN (COD không về, hoặc về mà sổ tưởng mất) —
    // có chỗ in riêng, không tranh chỗ với giao hỏng.
    if (lech.length) {
        const maxLech = Number(opts.maxLech) || 5;
        m += `\n\n🟠 ${B(`LỆCH ĐỐI TÁC ↔ 17TRACK (${lech.length})`)} ${I("— kiểm trước khi đối soát COD")}`;
        for (const a of lech.slice(0, maxLech)) {
            const s = a.shipment || {};
            m += `\n• ${B(s.order_id || s.tracking || "?")}${s.cod_local ? ` · ${fmt(Math.round(s.cod_local))} NT$` : ""} · ${cat(a.detail, 110)}`;
        }
        conLai += Math.max(0, lech.length - maxLech);
    }

    if (moiToi.length) m += `\n\n🔔 ${fmt(moiToi.length)} đơn vừa tới cửa hàng — nhắn khách ra lấy.`;
    if (chuaRo.length) m += `\n🔔 ${fmt(chuaRo.length)} đơn chưa biết đang ở đâu.`;
    if (conLai || moiToi.length || chuaRo.length) {
        m += `\n\n${I(`${conLai ? `Còn ${fmt(conLai)} đơn không in ở đây. ` : ""}Xem đủ, chép tin nhắn khách: ${opts.link || "dashboard → Đơn hàng & Đối soát → Theo dõi vận đơn"}`)}`;
    }
    return m;
}

module.exports = { buildTinVanDon, fetchVanDon, dongNguon };

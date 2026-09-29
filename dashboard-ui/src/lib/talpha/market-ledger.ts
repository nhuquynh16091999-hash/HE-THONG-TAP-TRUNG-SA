/**
 * SỔ ĐƠN HÀNG — THỊ TRƯỜNG NGOÀI ĐÀI (Singapore, UAE). Sỹ Anh yêu cầu 29/09/2026.
 *
 * Sổ Đài dựng từ bảng đơn NAZA + sao kê NAZA (lib/talpha/order-ledger.ts). Singapore và UAE
 * CHƯA có sao kê, nên sổ của hai nước này trả lời câu "đơn nào đang ở đâu, cần làm gì":
 * đơn + khách + hàng + trạng thái giao, đọc CHUNG nguồn với Theo dõi vận đơn và Đối soát COD
 * (lib/talpha/tracking-market.ts) — ba màn không lệch nhau được.
 *
 * Đèn màu cùng nghĩa với sổ Đài:
 *   đỏ   = phải xử (giao hỏng, đứng im, chưa gửi hàng quá hạn) — theo cảnh báo buildAlerts;
 *   vàng = đang chờ (đang đi, hoặc đã giao nhưng tiền còn ở bên giao hàng — chưa có sao kê);
 *   xám  = không đòi (hoàn, huỷ);
 *   xanh = tiền đã về — chưa có dòng nào cho tới khi có sao kê.
 *
 * Hàm thuần — để test được.
 */
import { TERMINAL, type Shipment, type TrackAlert } from "./tracking";
import { waLink, type PhoneRule } from "./whatsapp";

export type Light = "xanh" | "vang" | "do" | "xam";

export type MarketLedgerRow = {
    key: string;
    order_no: string;
    order_date: string | null;
    ship_date: string | null;
    tracking: string;
    carrier: string;
    status: string | null;
    /** Chữ trạng thái — chọn chữ khớp nhóm màu statusCls (thành công / hoàn / chờ / đang giao…). */
    status_vi: string;
    raw_status: string | null;
    last_event: string | null;
    last_event_time: string | null;
    fail_count: number | null;
    sku: string;
    quantity: number | null;
    customer: string;
    phone: string;
    wa: string | null;
    city: string;
    note: string;
    marketer: string;
    cod_local: number;
    cod_vnd: number | null;
    light: Light;
    light_note: string;
};

export type ProductInfo = { sku: string; quantity: number | null };

const laHoan = (s: Shipment) =>
    (!!s.status && TERMINAL.has(s.status) && s.status !== "Delivered")
    || (s.status === "Exception" && /Return/i.test(String(s.sub_status || "")));

/** Chữ trạng thái cho sổ — ngắn, và rơi đúng nhóm màu của statusCls. */
export function nhanSo(s: Shipment): string {
    const st = s.status;
    if (st === "Delivered") return "Giao thành công";
    if (st === "Returned" || st === "Expired") return "Đã hoàn";
    if (st === "Cancelled") return "Đã huỷ";
    if (st === "Destroyed") return "Đã tiêu huỷ (hoàn)";
    if (st === "Exception" && /Returned/i.test(String(s.sub_status || ""))) return "Đã hoàn về kho";
    if (st === "Exception" && /Return/i.test(String(s.sub_status || ""))) return "Đang hoàn";
    if (st === "DeliveryFailure") return "Giao hỏng, chờ giao lại";
    if (st === "Exception") return "Sự cố, chờ xử lý";
    if (st === "OutForDelivery") return "Đang giao";
    if (st === "AvailableForPickup") return "Đợi khách lấy";
    if (st === "InTransit") return "Đang trung chuyển";
    if (st === "InfoReceived" || st === "NotFound") return s.track17_code ? "Đã lên đơn" : "Chờ gửi hàng";
    // Dòng đối tác mới lên, chưa ghi trạng thái: chưa có mã vận đơn nghĩa là hàng chưa rời kho.
    return String(s.raw_status || "").trim() || (s.track17_code ? "Chưa có tin" : "Chờ gửi hàng");
}

/**
 * Shipment (cùng nguồn Theo dõi vận đơn) + hàng của đơn + cảnh báo → dòng sổ.
 * @param products  mã đơn → sản phẩm, số lượng (Sing: bảng đối tác; UAE: dòng hàng POS)
 * @param alerts    buildAlerts(shipments) — đơn có cảnh báo Gấp/Cảnh báo là đèn đỏ
 */
export function buildMarketLedger(
    shipments: Shipment[],
    products: Map<string, ProductInfo>,
    alerts: TrackAlert[],
    opt: { rateVnd: number; phone?: PhoneRule | null; carrier?: string },
): MarketLedgerRow[] {
    const canhBao = new Map<string, TrackAlert>();
    for (const a of alerts) {
        if (a.level === "nhac") continue;
        const k = a.shipment.tracking;
        if (!canhBao.has(k)) canhBao.set(k, a);   // alerts đã xếp gấp trước
    }
    const rows = shipments.map((s): MarketLedgerRow => {
        const a = canhBao.get(s.tracking);
        const p = products.get(String(s.order_id || ""));
        let light: Light, note: string;
        if (laHoan(s)) {
            light = "xam"; note = "Hoàn / huỷ — không có tiền về";
        } else if (a) {
            light = "do"; note = `${a.title}${a.detail ? ` — ${a.detail}` : ""}`;
        } else if (s.status === "Delivered") {
            light = "vang"; note = "Khách đã nhận — tiền đang ở bên giao hàng, chờ sao kê";
        } else if (!s.track17_code) {
            light = "vang"; note = "Chưa gửi hàng — chờ bên giao hàng lên vận đơn";
        } else {
            light = "vang"; note = `Đang đi — ${nhanSo(s).toLowerCase()}`;
        }
        return {
            key: s.tracking,
            order_no: String(s.order_id || ""),
            order_date: s.order_date ?? null,
            ship_date: s.ship_date ?? null,
            tracking: s.track17_code || "",
            carrier: opt.carrier || s.ship_method || "",
            status: s.status,
            status_vi: nhanSo(s),
            raw_status: s.raw_status ?? null,
            last_event: s.last_event ?? null,
            last_event_time: s.last_event_time ?? null,
            fail_count: s.fail_count ?? null,
            sku: p?.sku || "",
            quantity: p?.quantity ?? null,
            customer: s.customer || "",
            phone: s.phone || "",
            wa: waLink(s.phone, opt.phone),
            city: s.city || "",
            note: s.note || "",
            marketer: s.marketer || "",
            cod_local: Number(s.cod_local) || 0,
            cod_vnd: opt.rateVnd > 0 ? Math.round((Number(s.cod_local) || 0) * opt.rateVnd) : null,
            light, light_note: note,
        };
    });
    // Mới nhất lên đầu — cùng thứ tự đọc với sổ Đài (lên đơn gần nhất trước).
    return rows.sort((x, y) => String(y.order_date || "").localeCompare(String(x.order_date || ""))
        || y.order_no.localeCompare(x.order_no, "vi", { numeric: true }));
}

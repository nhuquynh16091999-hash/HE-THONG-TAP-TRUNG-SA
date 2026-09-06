/**
 * THEO DÕI VẬN ĐƠN — luật trạng thái và luật cảnh báo.
 *
 * Vì sao cần: thị trường Đài giao COD qua cửa hàng tiện lợi. Hàng tới cửa hàng
 * rồi NẰM ĐÓ chờ khách ra lấy, quá hạn là bị trả về — mất cả tiền hàng lẫn phí
 * ship hai chiều. Khoảng thời gian đó là cửa sổ duy nhất để cứu đơn, mà không
 * ai nhìn thấy nó nếu chỉ ngồi đọc trạng thái POS.
 *
 * Toàn bộ hàm ở đây là hàm thuần — không gọi mạng, không đọc file — để test
 * được và để route API chỉ còn việc lấy dữ liệu rồi gọi vào.
 */
import { RULES } from "./rules";

// ─────────────────────────────────────────────────────────────────────────
// Cấu hình
// ─────────────────────────────────────────────────────────────────────────
type TrackingConfig = {
    provider?: string;
    api_base?: string;
    carrier?: number | null;
    pickup_expire_days?: number;
    warn_before_expire_days?: number;
    stale_days?: number;
    batch_size?: number;
    rate_limit_per_sec?: number;
};

export const TRACK_CFG: Required<Omit<TrackingConfig, "carrier">> & { carrier: number | null } = (() => {
    const c: TrackingConfig = (RULES as unknown as { tracking?: TrackingConfig }).tracking || {};
    return {
        provider: c.provider ?? "17track",
        api_base: c.api_base ?? "https://api.17track.net/track/v2.4",
        carrier: c.carrier ?? null,
        pickup_expire_days: Number(c.pickup_expire_days ?? 7),
        warn_before_expire_days: Number(c.warn_before_expire_days ?? 2),
        stale_days: Number(c.stale_days ?? 21),
        batch_size: Math.min(Number(c.batch_size ?? 40), 40),   // 17TRACK trần 40
        rate_limit_per_sec: Math.min(Number(c.rate_limit_per_sec ?? 3), 3),
    };
})();

// ─────────────────────────────────────────────────────────────────────────
// Trạng thái
// ─────────────────────────────────────────────────────────────────────────

/** 9 trạng thái chính của 17TRACK. */
export type MainStatus =
    | "NotFound" | "InfoReceived" | "InTransit" | "Expired"
    | "AvailableForPickup" | "OutForDelivery" | "DeliveryFailure"
    | "Delivered" | "Exception";

export const STATUS_VI: Record<MainStatus, string> = {
    NotFound: "Chưa có thông tin",
    InfoReceived: "Đã tạo vận đơn",
    InTransit: "Đang vận chuyển",
    Expired: "Quá hạn theo dõi",
    AvailableForPickup: "Đã tới cửa hàng",
    OutForDelivery: "Đang giao",
    DeliveryFailure: "Giao hỏng",
    Delivered: "Đã giao",
    Exception: "Sự cố",
};

/** Đơn đã đi tới đích cuối — không cần theo dõi tiếp, không cần cảnh báo. */
export const TERMINAL: ReadonlySet<MainStatus> = new Set<MainStatus>(["Delivered", "Expired"]);

export function statusLabel(s?: string | null): string {
    return s && s in STATUS_VI ? STATUS_VI[s as MainStatus] : "Chưa rõ";
}

// ─────────────────────────────────────────────────────────────────────────
// Kiểu dữ liệu
// ─────────────────────────────────────────────────────────────────────────

export type Shipment = {
    tracking: string;
    order_uid: string | null;
    order_id: string;
    order_date: string | null;
    customer: string;
    phone: string;
    marketer: string | null;
    sale: string | null;
    cod_local: number;              // TWD
    status: MainStatus | null;
    sub_status: string | null;
    /** Lần đầu thấy đơn ở TRẠNG THÁI HIỆN TẠI — gốc để đếm "nằm ở cửa hàng mấy ngày". */
    status_since: string | null;
    last_event_time: string | null;
    last_event: string | null;
    registered: boolean;
};

/** gấp = sắp mất hàng · canh_bao = cần người xử · nhac = việc thường ngày. */
export type AlertLevel = "gap" | "canh_bao" | "nhac";

export type AlertCode =
    | "sap_bi_tra_ve"      // ở cửa hàng quá lâu, sắp hết hạn lấy
    | "toi_cua_hang"       // vừa tới cửa hàng, giục khách ra lấy
    | "giao_hong"          // DeliveryFailure / Exception
    | "dung_im"            // không nhúc nhích quá lâu
    | "chua_dang_ky";      // có mã vận đơn nhưng chưa đăng ký với 17TRACK

export type TrackAlert = {
    level: AlertLevel;
    code: AlertCode;
    title: string;
    detail: string;
    days: number | null;
    shipment: Shipment;
};

// ─────────────────────────────────────────────────────────────────────────
// Tính toán
// ─────────────────────────────────────────────────────────────────────────

/** Số ngày trọn vẹn giữa hai mốc. Mốc hỏng hoặc thiếu → null, KHÔNG trả 0. */
export function daysBetween(fromIso?: string | null, now: Date = new Date()): number | null {
    if (!fromIso) return null;
    const t = Date.parse(fromIso);
    if (Number.isNaN(t)) return null;
    return Math.floor((now.getTime() - t) / 86_400_000);
}

/** Còn mấy ngày nữa hàng ở cửa hàng bị trả về. Âm = đã quá hạn. */
export function daysLeftAtStore(s: Shipment, now: Date = new Date()): number | null {
    if (s.status !== "AvailableForPickup") return null;
    const d = daysBetween(s.status_since, now);
    return d === null ? null : TRACK_CFG.pickup_expire_days - d;
}

/**
 * Sinh cảnh báo cho một lô vận đơn, xếp việc gấp lên trước.
 *
 * Cố ý KHÔNG cảnh báo đơn đã Delivered hay Expired: việc đã xong hoặc đã hỏng
 * hẳn, nhắc nữa chỉ làm loãng những đơn còn cứu được.
 */
export function buildAlerts(shipments: Shipment[], now: Date = new Date()): TrackAlert[] {
    const out: TrackAlert[] = [];

    for (const s of shipments) {
        if (!s.registered) {
            out.push({
                level: "nhac", code: "chua_dang_ky",
                title: "Chưa đăng ký theo dõi",
                detail: "Đơn có mã vận đơn nhưng chưa gửi sang 17TRACK — bấm “Đồng bộ” để đăng ký.",
                days: null, shipment: s,
            });
            continue;
        }

        if (!s.status || TERMINAL.has(s.status)) continue;

        if (s.status === "AvailableForPickup") {
            const left = daysLeftAtStore(s, now);
            const atStore = daysBetween(s.status_since, now);
            if (left !== null && left <= TRACK_CFG.warn_before_expire_days) {
                out.push({
                    level: "gap", code: "sap_bi_tra_ve",
                    title: left < 0 ? "Đã quá hạn lấy hàng" : `Còn ${left} ngày là bị trả về`,
                    detail: `Nằm ở cửa hàng ${atStore} ngày. Gọi khách ngay, quá hạn là mất cả tiền hàng lẫn phí ship hai chiều.`,
                    days: atStore, shipment: s,
                });
            } else {
                out.push({
                    level: "nhac", code: "toi_cua_hang",
                    title: "Hàng đã tới cửa hàng",
                    detail: atStore !== null && atStore > 0
                        ? `Chờ khách ra lấy ${atStore} ngày. Nhắn giục.`
                        : "Vừa tới nơi. Nhắn khách ra lấy.",
                    days: atStore, shipment: s,
                });
            }
            continue;
        }

        if (s.status === "DeliveryFailure" || s.status === "Exception") {
            out.push({
                level: "canh_bao", code: "giao_hong",
                title: s.status === "DeliveryFailure" ? "Giao không thành công" : "Vận đơn có sự cố",
                detail: s.last_event || "Hãng vận chuyển báo có vấn đề — cần người xử lý.",
                days: daysBetween(s.status_since, now), shipment: s,
            });
            continue;
        }

        const idle = daysBetween(s.last_event_time || s.status_since, now);
        if (idle !== null && idle >= TRACK_CFG.stale_days) {
            out.push({
                level: "canh_bao", code: "dung_im",
                title: `Đứng im ${idle} ngày`,
                detail: `Vẫn ở “${statusLabel(s.status)}” mà không có cập nhật mới — hỏi lại hãng vận chuyển.`,
                days: idle, shipment: s,
            });
        }
    }

    const rank: Record<AlertLevel, number> = { gap: 0, canh_bao: 1, nhac: 2 };
    return out.sort((a, b) =>
        rank[a.level] - rank[b.level] || (b.days ?? -1) - (a.days ?? -1));
}

/** Đếm theo trạng thái, để UI vẽ dải tổng quan. */
export function countByStatus(shipments: Shipment[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const s of shipments) {
        const k = s.status || "NotFound";
        out[k] = (out[k] || 0) + 1;
    }
    return out;
}

/**
 * Gộp trạng thái mới từ 17TRACK vào bản đã lưu.
 *
 * `status_since` chỉ đặt lại khi trạng thái ĐỔI THẬT. Đặt lại mỗi lần đồng bộ là
 * đồng hồ đếm ngược luôn về 0, và cảnh báo "sắp bị trả về" sẽ không bao giờ nổ.
 */
export function mergeStatus(
    prev: { status?: string | null; status_since?: string | null } | undefined,
    next: { status: string | null; sub_status?: string | null; last_event_time?: string | null; last_event?: string | null },
    now: Date = new Date(),
): { status: string | null; sub_status: string | null; status_since: string; last_event_time: string | null; last_event: string | null } {
    const changed = !prev || prev.status !== next.status;
    return {
        status: next.status,
        sub_status: next.sub_status ?? null,
        status_since: changed ? now.toISOString() : (prev?.status_since || now.toISOString()),
        last_event_time: next.last_event_time ?? null,
        last_event: next.last_event ?? null,
    };
}

/** Cắt danh sách thành từng lô đúng trần 40 mã của 17TRACK. */
export function chunk<T>(xs: T[], size: number = TRACK_CFG.batch_size): T[][] {
    const n = Math.max(1, Math.min(size, 40));
    const out: T[][] = [];
    for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
    return out;
}

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
    transit_days_estimate?: number;
    stale_days?: number;
    batch_size?: number;
    rate_limit_per_sec?: number;
    register_max_age_days?: number;
    register_max_per_run?: number;
    register_scope?: string;
};

/** "canh_bao": chỉ đăng ký đơn đang có cảnh báo Gấp/Cảnh báo · "tat_ca": mọi đơn chưa kết thúc. */
export type RegisterScope = "canh_bao" | "tat_ca";

export const TRACK_CFG: Required<Omit<TrackingConfig, "carrier" | "register_scope">>
    & { carrier: number | null; register_scope: RegisterScope } = (() => {
    const c: TrackingConfig = (RULES as unknown as { tracking?: TrackingConfig }).tracking || {};
    return {
        provider: c.provider ?? "17track",
        api_base: c.api_base ?? "https://api.17track.net/track/v2.4",
        carrier: c.carrier ?? null,
        pickup_expire_days: Number(c.pickup_expire_days ?? 7),
        warn_before_expire_days: Number(c.warn_before_expire_days ?? 2),
        transit_days_estimate: Number(c.transit_days_estimate ?? 3),
        stale_days: Number(c.stale_days ?? 21),
        batch_size: Math.min(Number(c.batch_size ?? 40), 40),   // 17TRACK trần 40
        rate_limit_per_sec: Math.min(Number(c.rate_limit_per_sec ?? 3), 3),
        register_max_age_days: Number(c.register_max_age_days ?? 45),
        register_max_per_run: Number(c.register_max_per_run ?? 300),
        // Khai sai chữ thì về "canh_bao" — hẹp hơn, tốn ít quota hơn.
        register_scope: c.register_scope === "tat_ca" ? "tat_ca" : "canh_bao",
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

/**
 * Đơn đã đi tới đích cuối — không theo dõi tiếp, không cảnh báo.
 *
 * "Returned", "Cancelled" và "Destroyed" chỉ có ở file đối tác, không có trong
 * bảng của 17TRACK. Đơn đã hoàn về kho thì tiền mất rồi, nhắc nữa chỉ làm loãng
 * những đơn còn cứu được — nhưng vẫn ĐẾM để báo cáo tỷ lệ hoàn.
 */
export const TERMINAL: ReadonlySet<string> = new Set([
    "Delivered", "Expired", "Returned", "Cancelled", "Destroyed",
]);

/** Nhãn cho trạng thái chỉ có ở file đối tác. */
export const EXTRA_STATUS_VI: Record<string, string> = {
    Returned: "Đã hoàn về kho",
    Cancelled: "Đã huỷ",
    Destroyed: "Đã tiêu huỷ",
};

export function statusLabel(s?: string | null): string {
    if (!s) return "Chưa rõ";
    return STATUS_VI[s as MainStatus] || EXTRA_STATUS_VI[s] || "Chưa rõ";
}

// ─────────────────────────────────────────────────────────────────────────
// Kiểu dữ liệu
// ─────────────────────────────────────────────────────────────────────────

export type Shipment = {
    tracking: string;
    /** Mã đưa cho 17TRACK — 7-Eleven phải thêm tiền tố 73N, nên KHÁC mã vận đơn. */
    track17_code?: string | null;
    order_uid: string | null;
    order_id: string;
    order_date: string | null;
    customer: string;
    /** Cửa hàng tiện lợi khách ra lấy, và mã lấy hàng — cần để soạn tin nhắn
     *  báo khách. Chỉ file đối tác có, POS không ghi. */
    store_name?: string;
    store_code?: string;
    ship_method?: string;
    phone: string;
    marketer: string | null;
    sale: string | null;
    cod_local: number;              // TWD
    /** 9 mã của 17TRACK, cộng "Returned"/"Cancelled" chỉ file đối tác mới có. */
    status: string | null;
    sub_status: string | null;
    /** Lần đầu thấy đơn ở TRẠNG THÁI HIỆN TẠI — gốc để đếm "nằm ở cửa hàng mấy ngày". */
    status_since: string | null;
    last_event_time: string | null;
    last_event: string | null;
    registered: boolean;
    /** Trạng thái đến từ đâu — để UI nói rõ số này mới tới mức nào. */
    source?: "doi_tac" | "17track" | null;
    raw_status?: string | null;
    /** Ngày xuất kho theo file đối tác — đồng hồ đáng tin hơn status_since. */
    ship_date?: string | null;
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
    /** Còn mấy ngày là hàng ở cửa hàng bị trả về (âm = đã quá hạn). Chỉ có với đơn ở cửa hàng. */
    days_left?: number | null;
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

/**
 * Còn mấy ngày nữa hàng ở cửa hàng bị trả về. Âm = đã quá hạn.
 *
 * Hai đồng hồ, ưu tiên cái đáng tin hơn:
 *
 *   • 17TRACK nói đúng lúc hàng TỚI cửa hàng ⇒ đếm thẳng từ status_since.
 *
 *   • File đối tác chỉ có NGÀY XUẤT KHO, không có ngày tới cửa hàng ⇒ đếm từ
 *     ngày xuất kho rồi trừ thời gian đi đường ước lượng. Nếu chỉ dựa vào
 *     status_since thì lần nhập file đầu tiên coi MỌI đơn là "vừa mới tới" —
 *     kiểm trên dữ liệu thật: cả 45 đơn đang ở cửa hàng đều đã xuất kho 8–21
 *     ngày, tức đều quá hạn, mà hệ thống lại báo nhẹ hều. Hỏng đúng lúc cần nhất.
 */
export function daysLeftAtStore(s: Shipment, now: Date = new Date()): number | null {
    if (s.status !== "AvailableForPickup") return null;

    if (s.source === "17track") {
        const d = daysBetween(s.status_since, now);
        return d === null ? null : TRACK_CFG.pickup_expire_days - d;
    }

    const sinceShip = daysBetween(s.ship_date ? `${s.ship_date}T00:00:00Z` : null, now);
    if (sinceShip !== null) {
        return TRACK_CFG.pickup_expire_days + TRACK_CFG.transit_days_estimate - sinceShip;
    }

    const d = daysBetween(s.status_since, now);
    return d === null ? null : TRACK_CFG.pickup_expire_days - d;
}

/** Số ngày hàng đã nằm chờ, theo đồng hồ đáng tin nhất đang có. */
export function daysWaiting(s: Shipment, now: Date = new Date()): number | null {
    if (s.source !== "17track" && s.ship_date) {
        const d = daysBetween(`${s.ship_date}T00:00:00Z`, now);
        if (d !== null) return Math.max(0, d - TRACK_CFG.transit_days_estimate);
    }
    return daysBetween(s.status_since, now);
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
        // Chỉ giục đăng ký 17TRACK khi ĐANG MÙ hẳn — không có trạng thái từ
        // nguồn nào. File đối tác đã nói được trạng thái thì khỏi tốn quota;
        // giục đăng ký cả những đơn đó chỉ tạo ra hàng trăm dòng nhiễu.
        if (!s.status) {
            if (!s.registered) {
                out.push({
                    level: "nhac", code: "chua_dang_ky",
                    title: "Chưa biết đơn đang ở đâu",
                    detail: "Không có trạng thái từ file đối tác lẫn 17TRACK. Tải file mới, hoặc đăng ký 17TRACK để soi riêng đơn này.",
                    days: null, shipment: s,
                });
            }
            continue;
        }

        if (TERMINAL.has(s.status)) continue;

        if (s.status === "AvailableForPickup") {
            const left = daysLeftAtStore(s, now);
            const atStore = daysWaiting(s, now);
            if (left !== null && left <= TRACK_CFG.warn_before_expire_days) {
                out.push({
                    level: "gap", code: "sap_bi_tra_ve",
                    title: left < 0 ? "Đã quá hạn lấy hàng" : `Còn ${left} ngày là bị trả về`,
                    detail: s.ship_date
                        ? `Xuất kho ${daysBetween(`${s.ship_date}T00:00:00Z`, now)} ngày trước mà khách chưa lấy. Gọi ngay — quá hạn là mất cả tiền hàng lẫn phí ship hai chiều.`
                        : `Nằm ở cửa hàng ${atStore} ngày. Gọi khách ngay, quá hạn là mất cả tiền hàng lẫn phí ship hai chiều.`,
                    days: atStore, days_left: left, shipment: s,
                });
            } else {
                out.push({
                    level: "nhac", code: "toi_cua_hang",
                    title: "Hàng đã tới cửa hàng",
                    detail: atStore !== null && atStore > 0
                        ? `Chờ khách ra lấy ${atStore} ngày. Nhắn giục.`
                        : "Vừa tới nơi. Nhắn khách ra lấy.",
                    days: atStore, days_left: left, shipment: s,
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
        // Bỏ qua mốc vô lý (>1 năm): gần như luôn là gõ nhầm năm trong file đối
        // tác — đã gặp đơn ghi xuất kho 2025 mà lên đơn 2026. Báo "đứng im 398
        // ngày" chỉ làm người đọc mất tin vào cảnh báo.
        if (idle !== null && idle >= TRACK_CFG.stale_days && idle < 365) {
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
 *
 * Khi đổi, lấy mốc 17TRACK ghi cho trạng thái đó (`status_time`) chứ không lấy lúc
 * đồng bộ: đồng bộ mỗi sáng một lần thì "lúc ta nhìn thấy" trễ tới gần một ngày so với
 * lúc hàng tới cửa hàng — tức hạn lấy hàng bị tính lùi mất một ngày. Mốc ở tương lai
 * (lệch múi giờ, dữ liệu bẩn) thì bỏ, dùng lúc đồng bộ.
 */
export function mergeStatus(
    prev: { status?: string | null; status_since?: string | null } | undefined,
    next: { status: string | null; sub_status?: string | null; status_time?: string | null; last_event_time?: string | null; last_event?: string | null },
    now: Date = new Date(),
): { status: string | null; sub_status: string | null; status_since: string; last_event_time: string | null; last_event: string | null } {
    const changed = !prev || prev.status !== next.status;
    const t = next.status_time ? Date.parse(next.status_time) : NaN;
    const since = Number.isFinite(t) && t <= now.getTime() ? new Date(t).toISOString() : now.toISOString();
    return {
        status: next.status,
        sub_status: next.sub_status ?? null,
        status_since: changed ? since : (prev?.status_since || since),
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

// ─────────────────────────────────────────────────────────────────────────
// Chọn mã đem đăng ký / đem hỏi 17TRACK
// ─────────────────────────────────────────────────────────────────────────

/**
 * Mã có đáng đưa cho 17TRACK không. Khoá dạng mã đơn "T1304" (dòng đối tác chưa có mã
 * vận đơn) mà đem đăng ký là đốt một quota cho một mã không bao giờ có tin.
 */
export function isTrack17Number(n?: string | null): n is string {
    return !!n && /^[A-Za-z0-9]{8,40}$/.test(n) && /\d{6}/.test(n);
}

/** Đơn ở cửa hàng và giao hỏng lên trước — chỗ còn cứu được tiền. */
const REGISTER_RANK = (status: string | null): number =>
    status === "AvailableForPickup" ? 0
        : status === "DeliveryFailure" || status === "Exception" ? 1
            : status && status !== "NotFound" ? 2 : 3;

export type RegisterPlan = {
    /** Đơn đem đăng ký lượt này — mỗi mã 17TRACK đúng một đơn đại diện. */
    pick: Shipment[];
    /** Tổng số mã đủ điều kiện (trước khi cắt trần). */
    eligible: number;
    /** Số mã đủ điều kiện nhưng để lượt sau — chạm trần mỗi lượt hoặc hết quota. */
    over_cap: number;
    /** Bị cắt vì quota còn lại không đủ (chứ không phải vì trần mỗi lượt). */
    quota_limited: boolean;
};

/**
 * Chọn đơn đem đăng ký 17TRACK. ⚠️ MỖI MÃ TỐN MỘT QUOTA, nên chỉ lấy đơn còn đáng theo dõi:
 *   • chưa đăng ký, có mã 17TRACK hợp lệ, mỗi mã một lần (hai dòng đối tác chung mã);
 *   • chưa kết thúc — giao xong, hoàn, huỷ, tiêu huỷ thì theo dõi làm gì;
 *   • scope "canh_bao" (gói miễn phí): chỉ đơn đang có cảnh báo Gấp/Cảnh báo — đúng đơn
 *     cần biết trạng thái thật trước khi gọi khách (khách lấy rồi thì khỏi gọi);
 *   • xuất kho (không có thì lên đơn) trong register_max_age_days ngày. Đơn cũ hơn mà
 *     còn "đang đi" gần như luôn là dòng đối tác quên cập nhật.
 * Cắt ở register_max_per_run (luật lọc có hỏng thì mất tối đa ngần ấy quota) và ở quota
 * còn lại (`quotaRemain`, hỏi 17TRACK trước khi gọi) — gửi quá quota thì 17TRACK từ chối
 * phần thừa, mà phần bị từ chối lại có thể là đơn gấp nhất.
 */
export function planRegister(
    shipments: Shipment[], now: Date = new Date(),
    opt: { maxAgeDays?: number; maxPerRun?: number; scope?: RegisterScope; quotaRemain?: number | null } = {},
): RegisterPlan {
    const maxAge = opt.maxAgeDays ?? TRACK_CFG.register_max_age_days;
    const perRun = Math.max(0, opt.maxPerRun ?? TRACK_CFG.register_max_per_run);
    const remain = opt.quotaRemain == null || !Number.isFinite(opt.quotaRemain) ? Infinity : Math.max(0, opt.quotaRemain);
    const cap = Math.min(perRun, remain);
    const scope = opt.scope ?? TRACK_CFG.register_scope;
    const canhBao = scope === "canh_bao"
        ? new Set(buildAlerts(shipments, now).filter((a) => a.level !== "nhac").map((a) => a.shipment))
        : null;
    const seen = new Set<string>();
    for (const s of shipments) if (s.registered && s.track17_code) seen.add(s.track17_code);

    const cand: Shipment[] = [];
    for (const s of shipments) {
        const n = s.track17_code;
        if (s.registered || !isTrack17Number(n) || seen.has(n)) continue;
        if (s.status && TERMINAL.has(s.status)) continue;
        if (canhBao && !canhBao.has(s)) continue;
        const d = s.ship_date || s.order_date;
        const age = d ? daysBetween(`${d.slice(0, 10)}T00:00:00Z`, now) : null;
        if (age !== null && age > maxAge) continue;
        seen.add(n);
        cand.push(s);
    }
    const dateOf = (s: Shipment) => s.ship_date || s.order_date || "";
    cand.sort((a, b) => REGISTER_RANK(a.status) - REGISTER_RANK(b.status)
        || dateOf(b).localeCompare(dateOf(a)));
    return {
        pick: cand.slice(0, cap), eligible: cand.length, over_cap: Math.max(0, cand.length - cap),
        quota_limited: cand.length > cap && remain < perRun,
    };
}

/**
 * Mã đem hỏi trạng thái (miễn phí): đã đăng ký và CHƯA kết thúc. Đơn đã kết thúc thì
 * hỏi nữa cũng thế, mà trạng thái 17TRACK trả về có thể kéo lùi trạng thái kết thúc
 * đối tác đã báo (hoàn, huỷ — 17TRACK không có).
 */
export function planTrack(shipments: Shipment[], justRegistered: ReadonlySet<string> = new Set()): string[] {
    const out = new Set<string>();
    for (const s of shipments) {
        const n = s.track17_code;
        if (!isTrack17Number(n)) continue;
        if (!s.registered && !justRegistered.has(n)) continue;
        if (s.status && TERMINAL.has(s.status)) continue;
        out.add(n);
    }
    return [...out];
}

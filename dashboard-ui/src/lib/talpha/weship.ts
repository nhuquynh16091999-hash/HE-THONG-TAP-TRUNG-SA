/**
 * WESHIP — trang tra đơn của hãng giao UAE (D&T Fulfillment gửi qua WeShip, POS ghi "UAE EXP").
 * Sỹ Anh chốt 28/09/2026: theo dõi vận đơn UAE bằng trang này.
 *
 * Vì sao tự tra mà không qua 17TRACK: 17TRACK không có hãng này (soát 3.523 hãng). Trang
 * WeShip thì tra được không cần đăng nhập, không giới hạn — mỗi lượt tra lại MỌI đơn chưa
 * kết thúc, không có chuyện quota.
 *
 * Trang không có API, chỉ có form: POST trackno=<AWB> → HTML. Mỗi lượt MỘT mã. Đọc HTML bằng
 * regex vì trang nhỏ và cố định; trang đổi cấu trúc thì parseWeshipPage NÉM lỗi (chứ không
 * trả "không thấy đơn") để lượt đồng bộ báo hỏng thật.
 *
 * Hàm thuần trừ fetchWeship — để test được.
 */
import type { Shipment, StatusRule } from "./tracking";

export type WeshipEvent = {
    /** ISO UTC; null nếu chữ ngày giờ lạ. */
    at: string | null;
    location: string;
    activity: string;
};

export type WeshipPage = {
    found: boolean;
    awb: string;
    /** "AF101090498O8" = shop POS 101090498 + đơn 8 — soát đơn khớp đúng. */
    ref: string | null;
    /** Ô "Current Status" (Delivered, REFUSED, Rescheduled…). */
    status_text: string | null;
    to_city: string | null;
    /** Mới nhất trước, đúng thứ tự trên trang. */
    events: WeshipEvent[];
    weight: string | null;
    pieces: string | null;
};

const THANG: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

const chu = (html: string) => html
    .replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&#0?39;|&apos;/gi, "'").replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ").trim();

function lechPhut(tz: string): number {
    const m = /^([+-])(\d{2}):(\d{2})$/.exec(tz);
    if (!m) return 0;
    return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

function gio(h: number, ap?: string): number {
    const x = (ap || "").toUpperCase();
    if (x === "PM" && h < 12) return h + 12;
    if (x === "AM" && h === 12) return 0;
    return h;
}

/**
 * Chữ ngày giờ của trang → ISO UTC. Hai dạng: bảng History "25 Sep 2026 05:40 PM" và ô tóm
 * tắt "25/09/2026 9:41 AM". Giờ trên trang là giờ địa phương (tz, UAE = +04:00).
 */
export function weshipTime(s: string | null | undefined, tz: string): string | null {
    const t = String(s || "").trim();
    let y: number, mo: number, d: number, h: number, mi: number;
    let m = /(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(t);
    if (m) {
        const thang = THANG[m[2].toLowerCase()];
        if (thang === undefined) return null;
        [y, mo, d] = [Number(m[3]), thang, Number(m[1])];
        [h, mi] = [gio(Number(m[4]), m[6]), Number(m[5])];
    } else {
        m = /(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(t);
        if (!m) return null;
        [y, mo, d] = [Number(m[3]), Number(m[2]) - 1, Number(m[1])];
        [h, mi] = [gio(Number(m[4]), m[6]), Number(m[5])];
    }
    const ms = Date.UTC(y, mo, d, h, mi) - lechPhut(tz) * 60_000;
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** Đọc trang kết quả. Trang báo "Awb not found" → found=false. Trang lạ → NÉM lỗi. */
export function parseWeshipPage(html: string, awb: string, tz: string): WeshipPage {
    const rong: WeshipPage = { found: false, awb, ref: null, status_text: null, to_city: null, events: [], weight: null, pieces: null };
    const coSo = /Tracking Number:/i.test(html);
    if (!coSo) {
        if (/Awb not found/i.test(html)) return rong;
        throw new Error("trang WeShip không có kết quả lẫn thông báo 'Awb not found' — có thể trang đã đổi cấu trúc");
    }
    const ref = /\(Ref\s*:\s*([^)<]*)\)/i.exec(html)?.[1]?.trim() || null;

    const tbody = /<tbody>([\s\S]*?)<\/tbody>/i.exec(html)?.[1] || "";
    const o = [...tbody.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((x) => x[1]);
    const status = o[2] ? chu(o[2]) || null : null;
    const toCity = o[1] ? chu(/class="from-location">([\s\S]*?)<\/div>/i.exec(o[1])?.[1] || "") || null : null;

    const bang = /class="status-table"[^>]*>([\s\S]*?)<\/table>/i.exec(html)?.[1] || "";
    const events: WeshipEvent[] = [];
    for (const tr of bang.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)) {
        const td = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((x) => chu(x[1]));
        if (td.length < 3) continue;       // dòng tiêu đề (th)
        events.push({ at: weshipTime(td[0], tz), location: td[1], activity: td[2] });
    }

    const ct = [...html.matchAll(/class="shipment-details">([\s\S]*?)<\/div>/gi)].map((x) => chu(x[1]));
    if (!status && !events.length) throw new Error("trang WeShip có mã nhưng không đọc được trạng thái — có thể trang đã đổi cấu trúc");
    return { found: true, awb, ref, status_text: status, to_city: toCity, events, weight: ct[1] || null, pieces: ct[2] || null };
}

/** Chữ trạng thái WeShip → luật khớp đầu tiên (so không phân biệt hoa thường). */
export function mapWeshipStatus(text: string | null | undefined, rules: StatusRule[]): StatusRule | null {
    const t = String(text || "").replace(/\s+/g, " ").trim();
    if (!t) return null;
    for (const r of rules) if (r.match.test(t)) return r;
    return null;
}

export type WeshipTrack = {
    status: string | null;
    sub_status: string | null;
    /** Lúc đơn vào trạng thái hiện tại (mốc cũ nhất của chuỗi sự kiện cùng trạng thái). */
    status_time: string | null;
    last_event_time: string | null;
    last_event: string | null;
    /** Chữ gốc của hãng — chữ lạ hiện ra để khai thêm luật. */
    raw_status: string | null;
    fail_count: number;
};

/**
 * Trang đã đọc → trạng thái chuẩn.
 *   • Trạng thái: ô Current Status; không khớp luật nào thì lấy hoạt động mới nhất.
 *   • Mốc vào trạng thái: đi từ sự kiện mới nhất lùi về, còn cùng trạng thái thì lùi tiếp —
 *     "hẹn lại 28/09, hẹn lại 26/09" là giao hỏng TỪ 26/09, không phải từ lượt tra.
 *   • Ô "Delivered On" của trang ghi sai giờ (lấy giờ OUT FOR DELIVERY) → không dùng nó
 *     khi bảng History có mốc.
 */
export function weshipTrack(page: WeshipPage, rules: StatusRule[]): WeshipTrack {
    const moi = page.events[0];
    const luat = mapWeshipStatus(page.status_text, rules) || mapWeshipStatus(moi?.activity, rules);
    const status = luat?.status ?? null;
    let since: string | null = null;
    if (status) {
        for (const e of page.events) {
            if (mapWeshipStatus(e.activity, rules)?.status !== status) break;
            since = e.at ?? since;
        }
    }
    const fail = page.events.filter((e) => mapWeshipStatus(e.activity, rules)?.status === "DeliveryFailure").length;
    const lanThu = status === "DeliveryFailure" && fail > 1 ? ` (lần ${fail})` : "";
    const goc = moi?.activity || page.status_text || "";
    return {
        status,
        sub_status: luat?.sub_status ?? null,
        status_time: since ?? moi?.at ?? null,
        last_event_time: moi?.at ?? null,
        last_event: luat ? `${luat.vi}${lanThu}${goc ? ` · “${goc}”` : ""}` : (goc || null),
        raw_status: page.status_text || moi?.activity || null,
        fail_count: fail,
    };
}

/**
 * Mã AWB trong cột sale_order.partner của POS. Cột này là chuỗi kiểu dict Python
 * ("{'extend_code': 'VS1068347', 'partner_name': 'UAE EXP', …}") — không phải JSON, nên đọc
 * bằng regex. tracking_link của POS KHÔNG phải mã AWB (chỉ là trang pke.gg của POS).
 */
export function awbFromPartner(partner: string | null | undefined): string | null {
    const m = /['"]extend_code['"]\s*:\s*['"]([A-Za-z0-9-]{4,40})['"]/.exec(String(partner || ""));
    return m ? m[1].toUpperCase() : null;
}

/** Một đơn POS của thị trường source "pos" (vw_orders_std ⋈ sale_order). */
export type PosOrderRow = {
    order_id?: string | number | null; order_date?: string | null;
    status_name?: string | null; status_category?: string | null;
    cod?: number | null; partner?: string | null;
    customer?: string | null; phone?: string | null;
    province?: string | null; district?: string | null; note?: string | null;
    marketer?: string | null; time_send_partner?: string | null;
};

/** Trạng thái WeShip đã lưu trong sổ của thị trường. */
export type WeshipSaved = {
    status: string | null; sub_status?: string | null; status_since?: string | null;
    last_event_time?: string | null; last_event?: string | null; source?: string | null;
    raw_status?: string | null; fail_count?: number | null;
};

const isoNgay = (d?: string | null) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? `${d.slice(0, 10)}T00:00:00Z` : null);

/**
 * Đơn POS + trạng thái WeShip đã lưu → Shipment (khuôn chung của màn Theo dõi vận đơn).
 *   • có mã AWB, đã tra: trạng thái WeShip;
 *   • có mã AWB, chưa tra lần nào: "Đã tạo vận đơn" tính từ lúc POS gửi đơn cho hãng;
 *   • CHƯA có mã AWB: hàng chưa rời kho D&T — "Đã tạo vận đơn" không mã, tính từ ngày tạo
 *     đơn; quá stale_days thì buildAlerts báo "Chưa gửi hàng N ngày — hỏi đối tác".
 * Trạng thái POS KHÔNG dùng cho đơn đã có mã: nó không theo kịp hãng (28/09/2026: 3 đơn khách
 * từ chối, POS vẫn ghi shipped).
 */
export function posWeshipShipment(row: PosOrderRow, saved: WeshipSaved | undefined, marketer: string | null = null): Shipment {
    const awb = awbFromPartner(row.partner);
    const co = !!awb && !!saved && saved.source === "weship";
    const ngayDon = row.order_date ? String(row.order_date).slice(0, 10) : null;
    // POS ghi giờ UTC không kèm "Z" ("2026-09-28T08:00:37") — thêm vào, kẻo máy đọc thành giờ máy.
    const g = String(row.time_send_partner || "").trim();
    const guiMs = g ? Date.parse(/Z$|[+-]\d{2}:?\d{2}$/.test(g) ? g : `${g}Z`) : NaN;
    const guiLuc = Number.isFinite(guiMs) ? new Date(guiMs).toISOString() : null;
    const moc = awb ? (guiLuc || isoNgay(ngayDon)) : isoNgay(ngayDon);
    const noi = [...new Set([row.district, row.province].map((x) => String(x || "").trim()).filter(Boolean))].join(", ");
    return {
        tracking: awb || `DON-${row.order_id ?? "?"}`,
        // Mã tra của hãng — cùng ô với mã 17TRACK để luật "chưa có mã = chưa gửi hàng" dùng chung.
        track17_code: awb,
        order_uid: null,
        order_id: String(row.order_id ?? ""),
        order_date: ngayDon,
        customer: String(row.customer || ""),
        phone: String(row.phone || ""),
        store_name: "", store_code: "", ship_method: "",
        marketer,
        sale: null,
        cod_local: Number(row.cod) || 0,
        status: co ? saved!.status : "InfoReceived",
        sub_status: co ? (saved!.sub_status ?? null) : null,
        status_since: co ? (saved!.status_since ?? null) : moc,
        last_event_time: co ? (saved!.last_event_time ?? null) : moc,
        last_event: co ? (saved!.last_event ?? null)
            : awb ? "Có mã AWB, chưa tra WeShip lần nào"
                : `Chưa có mã vận đơn — POS: ${String(row.status_name || row.status_category || "?")}`,
        registered: co,
        source: co ? "weship" : null,
        raw_status: co ? (saved!.raw_status ?? null) : null,
        ship_date: guiLuc ? guiLuc.slice(0, 10) : null,
        note: String(row.note || "").trim() || null,
        city: noi || null,
        fail_count: co ? (saved!.fail_count ?? null) : null,
    };
}

/** Tra MỘT mã trên trang WeShip. Lỗi mạng/HTTP → ném; mã không có → found=false. */
export async function fetchWeship(
    awb: string, cfg: { url: string; tz_offset: string; timeout_ms: number }, f: typeof fetch = fetch,
): Promise<WeshipPage> {
    const res = await f(cfg.url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ trackno: awb }).toString(),
        signal: AbortSignal.timeout(cfg.timeout_ms),
        cache: "no-store",
    });
    if (!res.ok) throw new Error(`WeShip HTTP ${res.status}`);
    return parseWeshipPage(await res.text(), awb, cfg.tz_offset);
}

/** Chạy fn cho từng phần tử, tối đa n việc cùng lúc — giữ thứ tự kết quả. */
export async function mapPool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
    const out: R[] = new Array(items.length);
    let i = 0;
    const tho = async () => {
        while (i < items.length) {
            const k = i++;
            out[k] = await fn(items[k]);
        }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, tho));
    return out;
}

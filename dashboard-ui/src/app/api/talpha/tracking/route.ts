import { NextRequest, NextResponse } from "next/server";
import { bigquery } from "@/lib/bigquery";
import {
    DISPLAY, UNASSIGNED, SALE_DISPLAY, SALE_UNASSIGNED,
    attributeOrder, buildAdidOwner, resolveSale, normPosMarketer,
} from "@/lib/talpha/rules";
import { trackingFromLink } from "@/lib/talpha/cod-recon";
import {
    buildAlerts, carrierFor, countByStatus, mergeStatus, planRegister, planTrack, TERMINAL, TRACK_CFG,
    type Shipment,
} from "@/lib/talpha/tracking";
import {
    apiKeys, allocateToKeys, register, changeCarrier, getTrackInfo, getQuota, hasApiKey, Track17Error,
    ERR_ALREADY_REGISTERED, ERR_QUOTA_OUT, type ApiKey, type Quota, type RegisterResult, type TrackInfo,
} from "@/lib/talpha/track17";
import { track17CodeFor } from "@/lib/talpha/partner-file";
import { readStoreFresh, updateStore } from "@/lib/talpha/store";

export const dynamic = "force-dynamic";

const BQ_PROJECT = process.env.NEXT_PUBLIC_BQ_PROJECT || "cty-507710";
const BQ_DATASET = process.env.DATASET || "TALPHA_Dataset";

// ═══════════════════════════════════════════════════════════════════
// THEO DÕI VẬN ĐƠN
//
//   GET  — đọc đơn trong kỳ, ghép trạng thái đã lưu, trả kèm cảnh báo
//   POST — đồng bộ với 17TRACK: đăng ký mã mới rồi hỏi trạng thái
//
// ⚠️ Đăng ký TỐN QUOTA (1 mã = 1 lần tính tiền), hỏi trạng thái thì miễn phí.
// Sổ đăng ký ở data/tracking.json là thứ chặn đăng ký trùng — mất nó là đốt
// tiền. Vì thế POST luôn ghi sổ NGAY sau khi 17TRACK nhận, trước khi làm gì tiếp.
//
// Chỉ theo dõi đơn ĐÃ GỬI ĐI và CHƯA kết thúc. Đơn huỷ hay đơn thô chưa có hàng
// chạy ngoài đường, đăng ký vào là phí quota. Luật chọn ở planRegister (tracking.ts).
//
// POST chạy tự động mỗi sáng sau khi nạp bảng đối tác (ops/deploy/tracking-import.sh),
// kết quả ghi vào `last_sync` để bot Zalo báo được "17TRACK cập nhật lúc nào, còn bao
// nhiêu quota" — và báo LỖI, chứ không im lặng gửi số cũ như số mới.
// ═══════════════════════════════════════════════════════════════════

const STORE = "tracking";

/** `number` = mã đã đưa cho 17TRACK (7-Eleven có tiền tố 73N, khác khoá sổ). */
type Registered = {
    order_uid: string | null; registered_at: string; carrier: number | null; number?: string;
    /** Số lần đã đổi hãng vì 17TRACK đoán nhầm — chặn vòng đổi mãi không xong. */
    carrier_changes?: number;
    /** Khoá (tài khoản 17TRACK) đã đăng ký mã này — chỉ khoá đó hỏi được trạng thái. */
    key_id?: string;
};
/** Kết quả một lượt của MỘT khoá — tin Zalo nêu đích danh khoá nào hỏng. */
type KeySync = {
    label: string; ok: boolean; error?: string;
    registered?: number; checked?: number; quota?: Quota | null;
};
type LastSync = {
    at: string; ok: boolean; error?: string;
    registered?: number; checked?: number; changed?: number; carrier_fixed?: number;
    register_rejected?: number; over_cap?: number; deferred?: number; quota_out?: boolean;
    /** Quota CỘNG của mọi khoá hỏi được. */
    quota?: Quota | null;
    keys?: KeySync[];
    /** Mã đã đăng ký bằng khoá không còn trong .env — không ai hỏi được nữa. */
    orphaned?: number;
};

const congQuota = (qs: Quota[]): Quota | null => qs.length ? qs.reduce((a, q) => ({
    total: a.total + q.total, used: a.used + q.used, remain: a.remain + q.remain, today_used: a.today_used + q.today_used,
}), { total: 0, used: 0, remain: 0, today_used: 0 }) : null;
type Saved = {
    status: string | null; sub_status: string | null; status_since: string;
    last_event_time: string | null; last_event: string | null;
    source?: "doi_tac" | "17track"; raw_status?: string | null;
    ship_date?: string | null; order_date?: string | null;
};
type PartnerMeta = {
    tracking?: string;
    order_no: string; ship_method: string; cod_local: number; marketer: string;
    recon: string; store_name: string; store_code: string;
    ship_date: string | null; track17_code: string | null;
    // Thêm 05 trường cho Sổ đơn hàng: nó cần cả khách lẫn hàng, không chỉ vận đơn.
    order_date?: string | null;
    contact_name?: string; phone?: string;
    sku?: string; quantity?: string;
    return_order_no?: string;
};
type Store = {
    registered: Record<string, Registered>;
    statuses: Record<string, Saved>;
    partner?: Record<string, PartnerMeta>;
    partner_import?: { imported_at: string };
    last_sync?: LastSync;
};

const emptyStore = (): Store => ({ registered: {}, statuses: {}, partner: {} });

/**
 * Danh sách vận đơn = HỢP của hai nguồn, khớp theo mã vận đơn:
 *   • đơn trong BigQuery (có tên khách, SĐT, marketer, sale)
 *   • dòng trong file đối tác (có trạng thái giao hàng)
 *
 * Phải là hợp chứ không phải giao: lúc mới dựng, BigQuery còn trống mà file đối
 * tác đã có 600 đơn — lấy giao thì màn hình trắng trơn dù dữ liệu nằm sẵn đó.
 * Ngược lại, đơn vừa lên trong POS mà file đối tác chưa cập nhật cũng phải hiện.
 */
// Khoá sổ có khi dính ký tự lạ từ Sheet (dấu nháy cong trước/sau mã) — bỏ đi trước khi
// sinh mã 17TRACK, nếu không mã 8 số của 7-Eleven không được thêm tiền tố 73N.
const clean = (x?: string | null) => String(x || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();

async function loadShipments(from: string, to: string): Promise<{ shipments: Shipment[]; store: Store }> {
    const store = await readStoreFresh<Store>(STORE, emptyStore());
    const partner = store.partner || {};
    const byTracking = new Map<string, Shipment>();
    // Mã 17TRACK đã đăng ký — hai dòng đối tác chung một mã thì dòng thứ hai cũng coi là
    // đã đăng ký, không đem đăng ký lần nữa.
    const regNumbers = new Set(Object.entries(store.registered).map(([k, r]) => r.number || clean(k)));

    const shipmentFrom = (tracking: string): Shipment => {
        const saved = store.statuses[tracking];
        const pm = partner[tracking];
        // Mã đối tác điền tay trước, không có thì sinh theo luật (8 số → 73N…).
        const t17 = clean(pm?.track17_code) || track17CodeFor(clean(pm?.tracking || tracking)) || null;
        return {
            tracking,
            track17_code: t17,
            order_uid: null,
            order_id: pm?.order_no || "",
            order_date: pm?.ship_date ?? null,
            // Tên và SĐT LẤY TỪ FILE ĐỐI TÁC. Bản trước để trống rồi chờ
            // BigQuery điền — mà POS mới có vài đơn nên gần như dòng nào cũng
            // trống, và tab này thành vô dụng cho việc gọi khách.
            customer: pm?.contact_name || "",
            phone: pm?.phone || "",
            // Cần cho việc soạn tin nhắn báo khách ra lấy hàng.
            store_name: pm?.store_name || "",
            store_code: pm?.store_code || "",
            ship_method: pm?.ship_method || "",
            // Tên trong file đối tác phải đi qua luật gán người, không dùng thô:
            // họ ghi "Lâm" mà trong hệ thống là "Lộc" — cùng một người.
            marketer: (() => {
                const key = normPosMarketer(pm?.marketer);
                return key ? (DISPLAY[key] || key) : (pm?.marketer || null);
            })(),
            sale: SALE_UNASSIGNED,
            cod_local: pm?.cod_local ?? 0,
            status: saved?.status ?? null,
            sub_status: saved?.sub_status ?? null,
            status_since: saved?.status_since ?? null,
            last_event_time: saved?.last_event_time ?? null,
            last_event: saved?.last_event ?? null,
            registered: !!store.registered[tracking] || (!!t17 && regNumbers.has(t17)),
            source: saved?.source ?? null,
            raw_status: saved?.raw_status ?? null,
            ship_date: saved?.ship_date ?? pm?.ship_date ?? saved?.order_date ?? null,
        };
    };

    // ── Nguồn 1: file đối tác ──
    for (const tracking of Object.keys(partner)) {
        byTracking.set(tracking, shipmentFrom(tracking));
    }

    // ── Nguồn 2: BigQuery — bổ sung thông tin khách và người phụ trách ──
    try {
        const [adRows] = await bigquery.query({
            query: `SELECT DISTINCT CAST(ad_id AS STRING) AS ad_id, campaign_name
                    FROM \`${BQ_PROJECT}.${BQ_DATASET}.fb_ads_data\`
                    WHERE ad_id IS NOT NULL AND campaign_name IS NOT NULL`,
        });
        const adidOwner = buildAdidOwner(adRows as { ad_id: string; campaign_name: string }[]);

        const [rows] = await bigquery.query({
            query: `
                SELECT
                    v.order_uid, v.order_id, v.order_date, v.pos_money_divisor,
                    v.marketer_name, v.resolved_ad_id,
                    o.cod, o.tracking_link, o.page_id, o.tags,
                    o.bill_full_name, o.bill_phone_number
                FROM \`${BQ_PROJECT}.${BQ_DATASET}.vw_orders_std\` v
                LEFT JOIN \`${BQ_PROJECT}.${BQ_DATASET}.sale_order\` o
                       ON v.shop_id = o.shop_id AND v.order_id = o.id
                WHERE v.order_date BETWEEN @from AND @to
                  AND o.tracking_link IS NOT NULL AND TRIM(o.tracking_link) != ''
                  -- Đơn huỷ/đơn thô chưa có hàng đi đường, theo dõi làm gì.
                  AND v.status_category NOT IN ('HUY', 'DON_THO')`,
            params: { from, to },
        });

        for (const r of rows as Record<string, unknown>[]) {
            const tracking = trackingFromLink(r.tracking_link as string | null);
            if (!tracking) continue;
            const divisor = Number(r.pos_money_divisor) || 1;
            const { key } = attributeOrder(
                r.marketer_name as string | null, r.resolved_ad_id as string | null, adidOwner);
            const saleKey = resolveSale({
                order_uid: r.order_uid as string,
                page_id: r.page_id as string | null,
                tags: r.tags as string | null,
            });
            const base = byTracking.get(tracking) ?? shipmentFrom(tracking);
            byTracking.set(tracking, {
                ...base,
                order_uid: r.order_uid as string,
                order_id: String(r.order_id ?? base.order_id),
                order_date: r.order_date && typeof r.order_date === "object"
                    ? (r.order_date as { value: string }).value
                    : String(r.order_date ?? base.order_date ?? ""),
                customer: (r.bill_full_name as string) || "",
                phone: (r.bill_phone_number as string) || "",
                marketer: key === UNASSIGNED ? UNASSIGNED : (DISPLAY[key] || key),
                sale: saleKey ? (SALE_DISPLAY[saleKey] || saleKey) : SALE_UNASSIGNED,
                // Tiền lấy từ POS khi có — đó là nguồn chuẩn của doanh thu.
                cod_local: (Number(r.cod) || 0) / divisor || base.cod_local,
            });
        }
    } catch (e) {
        // BigQuery hỏng hoặc chưa có số thì vẫn trả được phần từ file đối tác,
        // thay vì để cả tab trắng trơn.
        console.warn("tracking: không đọc được BigQuery, chỉ dùng file đối tác:", e);
    }

    return { shipments: [...byTracking.values()], store };
}

function range(req: NextRequest) {
    const q = req.nextUrl.searchParams;
    const from = q.get("from") || "";
    const to = q.get("to") || "";
    const ok = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to);
    return { from, to, ok };
}

export async function GET(req: NextRequest) {
    const { from, to, ok } = range(req);
    if (!ok) return NextResponse.json({ error: "from/to phải dạng YYYY-MM-DD" }, { status: 400 });

    try {
        const { shipments, store } = await loadShipments(from, to);
        const alerts = buildAlerts(shipments);
        return NextResponse.json({
            from, to,
            has_api_key: hasApiKey(),
            last_sync: store.last_sync ?? null,
            last_import: store.partner_import?.imported_at ?? null,
            config: {
                pickup_expire_days: TRACK_CFG.pickup_expire_days,
                warn_before_expire_days: TRACK_CFG.warn_before_expire_days,
                stale_days: TRACK_CFG.stale_days,
            },
            shipments,
            alerts,
            counts: countByStatus(shipments),
            totals: {
                shipments: shipments.length,
                registered: shipments.filter((s) => s.registered).length,
                // Chỉ đếm mã SẼ được đăng ký (đơn chưa kết thúc, còn mới) — đếm cả đơn đã
                // giao xong thì con số này không bao giờ về 0 và chẳng nói lên gì.
                pending_register: planRegister(shipments).eligible,
                at_store_value: shipments
                    .filter((s) => s.status === "AvailableForPickup")
                    .reduce((n, s) => n + s.cod_local, 0),
            },
        });
    } catch (e) {
        console.error("tracking GET lỗi:", e);
        return NextResponse.json({ error: "Query lỗi" }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const { from, to, ok } = range(req);
    if (!ok) return NextResponse.json({ error: "from/to phải dạng YYYY-MM-DD" }, { status: 400 });
    const keys = apiKeys();
    if (!keys.length) {
        return NextResponse.json({
            error: "Chưa có khoá 17TRACK. Lấy ở 17track.net/en/api rồi điền TRACK17_API_KEY vào dashboard-ui/.env.local.",
        }, { status: 428 });
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const ghiLuot = (x: LastSync) => updateStore<Store>(STORE, emptyStore(), (cur) => { cur.last_sync = x; return cur; });
    // Một khoá hỏng (hết hạn, bị khoá) KHÔNG làm hỏng cả lượt — ghi lại rồi chạy tiếp khoá khác.
    const theoKhoa = new Map<string, KeySync>(keys.map((k) => [k.id, { label: k.label, ok: true }]));
    const loiKhoa = (k: ApiKey, e: unknown) => {
        const x = theoKhoa.get(k.id)!;
        x.ok = false;
        x.error = e instanceof Error ? e.message : String(e);
        console.warn(`17TRACK ${k.label} lỗi:`, x.error);
    };
    // Lỗi giữa chừng vẫn giữ phần đã xong (batched gắn vào e.partial) — mã đã đăng ký
    // ở lô trước là quota đã trừ, phải ghi sổ.
    const phanDaXong = <T>(e: unknown, rong: T): T =>
        e instanceof Track17Error && e.partial ? (e.partial as T) : rong;

    try {
        // ── 0. Sổ cũ (lúc mới có MỘT khoá) chưa ghi khoá nào → của khoá 1 ──
        await updateStore<Store>(STORE, emptyStore(), (cur) => {
            for (const r of Object.values(cur.registered)) if (!r.key_id) r.key_id = keys[0].id;
            return cur;
        });

        const { shipments } = await loadShipments(from, to);
        const byNumber = new Map<string, Shipment[]>();
        for (const s of shipments) {
            if (!s.track17_code) continue;
            const l = byNumber.get(s.track17_code);
            if (l) l.push(s); else byNumber.set(s.track17_code, [s]);
        }

        // Hỏi quota từng khoá TRƯỚC (miễn phí) để không bao giờ gửi quá số còn lại: gửi quá
        // thì 17TRACK từ chối phần thừa — mà phần thừa có khi lại là đơn gấp nhất.
        const quotas = new Map<string, Quota | null>();
        for (const k of keys) {
            try { quotas.set(k.id, await getQuota(k)); } catch (e) { quotas.set(k.id, null); loiKhoa(k, e); }
        }
        const tong = congQuota([...quotas.values()].filter((q): q is Quota => !!q));
        const plan = planRegister(shipments, now, { quotaRemain: tong?.remain ?? null, quotaTotal: tong?.total ?? null });

        // ── 1. Đăng ký mã mới (TỐN QUOTA) — chia cho các khoá theo quota còn lại ──
        // Sổ đăng ký là nơi DUY NHẤT biết mã nào đã có chủ: planRegister bỏ mọi mã đã nằm
        // trong sổ dù thuộc khoá nào, nên một mã không bao giờ bị hai khoá cùng đăng ký.
        let registered = 0;
        const rejected: { number: string; code: number; message: string }[] = [];
        const justRegistered = new Set<string>();
        const chia = allocateToKeys(plan.pick, keys.map((k) => ({ id: k.id, remain: quotas.get(k.id)?.remain ?? null })));
        for (const k of keys) {
            const lo = chia.get(k.id);
            if (!lo?.length) continue;
            const numbers = lo.map((s) => s.track17_code as string);
            const tags = Object.fromEntries(lo.filter((s) => s.order_id).map((s) => [s.track17_code as string, s.order_id]));
            let r: RegisterResult;
            try { r = await register(k, numbers, tags); }
            catch (e) { loiKhoa(k, e); r = phanDaXong(e, { accepted: [], rejected: [] }); }
            const moi = new Map<string, number | null>();
            for (const a of r.accepted) moi.set(clean(a.number), a.carrier || null);
            for (const x of r.rejected) {
                // Đã đăng ký từ trước ở CHÍNH khoá này (lượt trước chết giữa chừng) —
                // 17TRACK KHÔNG trừ quota lần này, chỉ cần ghi sổ lại cho khớp.
                if (x.code === ERR_ALREADY_REGISTERED) moi.set(clean(x.number), null);
                else rejected.push(x);
            }
            registered += r.accepted.length;
            theoKhoa.get(k.id)!.registered = r.accepted.length;

            // Ghi sổ NGAY: quota đã bị trừ rồi, mất sổ là lần sau trừ lần nữa.
            if (moi.size) {
                for (const n of moi.keys()) justRegistered.add(n);
                await updateStore<Store>(STORE, emptyStore(), (cur) => {
                    for (const [n, carrier] of moi) {
                        for (const s of byNumber.get(n) || []) {
                            cur.registered[s.tracking] = {
                                order_uid: s.order_uid, registered_at: nowIso, carrier, number: n, key_id: k.id,
                            };
                        }
                    }
                    return cur;
                });
            }
        }

        // ── 1b. Đổi hãng cho mã 17TRACK đoán nhầm (không trừ quota), bằng khoá của mã ──
        // Lượt đầu 25/09/2026 để 17TRACK tự đoán: 7 mã FamilyMart thành Bưu điện Ý. Mã
        // đăng ký rồi không đăng ký lại được, chỉ đổi hãng — thử tối đa 2 lần mỗi mã.
        const MAX_DOI_HANG = 2;
        const soDangKy = await readStoreFresh<Store>(STORE, emptyStore());
        const doiHang = new Map<string, Map<string, { number: string; carrier_old: number; carrier_new: number }>>();
        for (const r of Object.values(soDangKy.registered)) {
            const want = carrierFor(r.number);
            if (!r.number || !r.key_id || !want || !r.carrier || r.carrier === want) continue;
            if ((r.carrier_changes ?? 0) >= MAX_DOI_HANG) continue;
            if (!doiHang.has(r.key_id)) doiHang.set(r.key_id, new Map());
            doiHang.get(r.key_id)!.set(r.number, { number: r.number, carrier_old: r.carrier, carrier_new: want });
        }
        let carrierFixed = 0;
        for (const k of keys) {
            const items = doiHang.get(k.id);
            if (!items?.size) continue;
            let r: RegisterResult;
            try { r = await changeCarrier(k, [...items.values()]); }
            catch (e) { loiKhoa(k, e); r = phanDaXong(e, { accepted: [], rejected: [] }); }
            const ok = new Set(r.accepted.map((a) => clean(a.number)));
            carrierFixed += ok.size;
            await updateStore<Store>(STORE, emptyStore(), (cur) => {
                for (const reg of Object.values(cur.registered)) {
                    const d = reg.key_id === k.id && reg.number ? items.get(reg.number) : undefined;
                    if (!d) continue;
                    reg.carrier_changes = (reg.carrier_changes ?? 0) + 1;
                    if (ok.has(d.number)) reg.carrier = d.carrier_new;
                }
                return cur;
            });
        }

        // ── 2. Hỏi trạng thái (miễn phí) — mỗi khoá chỉ hỏi mã của chính nó ──
        const soMoi = await readStoreFresh<Store>(STORE, emptyStore());
        const khoaCuaMa = new Map<string, string>();
        for (const r of Object.values(soMoi.registered)) if (r.number && r.key_id) khoaCuaMa.set(r.number, r.key_id);
        const conKhoa = new Set(keys.map((k) => k.id));
        const hoiTheoKhoa = new Map<string, string[]>();
        let orphaned = 0;
        for (const n of planTrack(shipments, justRegistered)) {
            const kid = khoaCuaMa.get(n);
            if (!kid || !conKhoa.has(kid)) { orphaned++; continue; }
            if (!hoiTheoKhoa.has(kid)) hoiTheoKhoa.set(kid, []);
            hoiTheoKhoa.get(kid)!.push(n);
        }
        const found: TrackInfo[] = [];
        const trackRejected: { number: string; message: string }[] = [];
        for (const k of keys) {
            const ns = hoiTheoKhoa.get(k.id);
            if (!ns?.length) continue;
            let r: { found: TrackInfo[]; rejected: { number: string; message: string }[] };
            try { r = await getTrackInfo(k, ns); }
            catch (e) { loiKhoa(k, e); r = phanDaXong(e, { found: [], rejected: [] }); }
            found.push(...r.found);
            trackRejected.push(...r.rejected);
            theoKhoa.get(k.id)!.checked = r.found.length;
        }

        let changed = 0;
        await updateStore<Store>(STORE, emptyStore(), (cur) => {
            for (const t of found) {
                for (const s of byNumber.get(clean(t.number)) || []) {
                    // Sổ chưa biết hãng (mã đăng ký từ trước, 17TRACK báo "đã đăng ký") thì
                    // học từ đây — lượt sau mới soát được hãng có đúng luật không.
                    const reg = cur.registered[s.tracking];
                    if (reg && !reg.carrier && t.carrier) reg.carrier = t.carrier;
                    // 17TRACK chưa có tin (vừa đăng ký, chưa nhận ra hãng) thì giữ trạng thái
                    // đối tác — ghi "NotFound" đè lên là mất luôn "đang ở cửa hàng", và lần
                    // nạp file sau cũng không sửa lại được vì nguồn đã thành 17track.
                    if (!t.status || t.status === "NotFound") continue;
                    const prev = cur.statuses[s.tracking];
                    // Đơn đối tác đã báo KẾT THÚC (hoàn, huỷ…) thì 17TRACK không kéo lùi.
                    if (prev?.status && TERMINAL.has(prev.status) && prev.source !== "17track") continue;
                    // Lần đầu 17TRACK có tin cho đơn này: đồng hồ lấy mốc của 17TRACK,
                    // không kế thừa mốc "lúc ta nhìn thấy" của file đối tác.
                    const m = mergeStatus(prev?.source === "17track" ? prev : undefined, t, now);
                    if (prev?.status !== m.status) changed++;
                    // Đánh dấu nguồn 17track: lần nhập file đối tác sau sẽ KHÔNG ghi
                    // đè, vì file trễ 2 ngày còn 17TRACK gần thời gian thực.
                    cur.statuses[s.tracking] = { ...prev, ...m, source: "17track" };
                }
            }
            return cur;
        });

        // ── 3. Quota sau lượt này (miễn phí) — hỏng thì giữ số hỏi lúc đầu ──
        for (const k of keys) {
            if (!theoKhoa.get(k.id)!.registered && quotas.get(k.id)) continue;
            try { quotas.set(k.id, await getQuota(k)); } catch { /* giữ số cũ */ }
        }
        for (const k of keys) theoKhoa.get(k.id)!.quota = quotas.get(k.id) ?? null;
        const khoa = [...theoKhoa.values()];
        // MỌI khoá đều hỏng thì lượt này hỏng thật — báo lỗi, không báo "cập nhật xong".
        if (khoa.every((x) => !x.ok)) throw new Track17Error(khoa.map((x) => `${x.label}: ${x.error}`).join(" · "));

        const quota = congQuota([...quotas.values()].filter((q): q is Quota => !!q));
        // Hết quota = còn đơn CẦN XỬ LÝ mà không đăng ký được (gói miễn phí: hết tháng).
        const quotaOut = rejected.some((x) => x.code === ERR_QUOTA_OUT) || plan.quota_limited;
        await ghiLuot({
            at: nowIso, ok: true, registered, checked: found.length, changed, carrier_fixed: carrierFixed,
            register_rejected: rejected.length, over_cap: plan.over_cap, deferred: plan.deferred,
            quota_out: quotaOut, quota, keys: khoa, orphaned,
        });

        const { shipments: after } = await loadShipments(from, to);
        return NextResponse.json({
            ok: true,
            registered,
            register_rejected: rejected.map((x) => ({ number: x.number, message: x.message })),
            over_cap: plan.over_cap,
            deferred: plan.deferred,
            quota_out: quotaOut,
            quota,
            keys: khoa,
            orphaned,
            checked: found.length,
            carrier_fixed: carrierFixed,
            track_rejected: trackRejected.map((x) => ({ number: x.number, message: x.message })),
            status_changed: changed,
            alerts: buildAlerts(after, now),
            counts: countByStatus(after),
        });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await ghiLuot({ at: nowIso, ok: false, error: msg, keys: [...theoKhoa.values()] }).catch(() => {});
        if (e instanceof Track17Error) {
            return NextResponse.json({ error: e.message }, { status: e.code === 429 ? 429 : 502 });
        }
        console.error("tracking POST lỗi:", e);
        return NextResponse.json({ error: "Đồng bộ thất bại" }, { status: 500 });
    }
}

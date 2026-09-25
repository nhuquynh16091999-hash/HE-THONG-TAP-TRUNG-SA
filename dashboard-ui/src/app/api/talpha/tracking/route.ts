import { NextRequest, NextResponse } from "next/server";
import { bigquery } from "@/lib/bigquery";
import {
    DISPLAY, UNASSIGNED, SALE_DISPLAY, SALE_UNASSIGNED,
    attributeOrder, buildAdidOwner, resolveSale, normPosMarketer,
} from "@/lib/talpha/rules";
import { trackingFromLink } from "@/lib/talpha/cod-recon";
import {
    buildAlerts, countByStatus, mergeStatus, planRegister, planTrack, TERMINAL, TRACK_CFG,
    type Shipment,
} from "@/lib/talpha/tracking";
import {
    register, getTrackInfo, getQuota, hasApiKey, Track17Error,
    ERR_ALREADY_REGISTERED, ERR_QUOTA_OUT, type Quota,
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
type Registered = { order_uid: string | null; registered_at: string; carrier: number | null; number?: string };
type LastSync = {
    at: string; ok: boolean; error?: string;
    registered?: number; checked?: number; changed?: number;
    register_rejected?: number; over_cap?: number; quota_out?: boolean;
    quota?: Quota | null;
};
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
    if (!hasApiKey()) {
        return NextResponse.json({
            error: "Chưa có khoá 17TRACK. Lấy ở 17track.net/en/api rồi điền TRACK17_API_KEY vào dashboard-ui/.env.local.",
        }, { status: 428 });
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const ghiLuot = (x: LastSync) => updateStore<Store>(STORE, emptyStore(), (cur) => { cur.last_sync = x; return cur; });

    try {
        const { shipments } = await loadShipments(from, to);
        // Hỏi quota còn lại TRƯỚC (miễn phí) để không bao giờ gửi quá số đó: gửi quá thì
        // 17TRACK từ chối phần thừa — mà phần thừa có khi lại là đơn gấp nhất. Hỏi hỏng
        // thì cứ đăng ký theo trần mỗi lượt, 17TRACK tự chặn khi hết.
        let quota: Quota | null = null;
        try { quota = await getQuota(); } catch (e) { console.warn("17TRACK getquota lỗi:", e); }
        const plan = planRegister(shipments, now, { quotaRemain: quota?.remain ?? null });
        const byNumber = new Map<string, Shipment[]>();
        for (const s of shipments) {
            if (!s.track17_code) continue;
            const l = byNumber.get(s.track17_code);
            if (l) l.push(s); else byNumber.set(s.track17_code, [s]);
        }

        // ── 1. Đăng ký mã mới (TỐN QUOTA) ──
        let registered = 0;
        const rejected: { number: string; code: number; message: string }[] = [];
        const justRegistered = new Set<string>();
        if (plan.pick.length) {
            const numbers = plan.pick.map((s) => s.track17_code as string);
            const tags = Object.fromEntries(plan.pick.filter((s) => s.order_id).map((s) => [s.track17_code as string, s.order_id]));
            const r = await register(numbers, tags);
            registered = r.accepted.length;
            const carrierOf = new Map(r.accepted.map((a) => [clean(a.number), a.carrier]));
            for (const a of r.accepted) justRegistered.add(clean(a.number));
            for (const x of r.rejected) {
                // Đã đăng ký từ trước (lượt trước chết giữa chừng, sổ bị mất) — 17TRACK
                // KHÔNG trừ quota lần này, chỉ cần ghi sổ lại cho khớp.
                if (x.code === ERR_ALREADY_REGISTERED) justRegistered.add(clean(x.number));
                else rejected.push(x);
            }

            // Ghi sổ NGAY: quota đã bị trừ rồi, mất sổ là lần sau trừ lần nữa.
            if (justRegistered.size) {
                await updateStore<Store>(STORE, emptyStore(), (cur) => {
                    for (const n of justRegistered) {
                        for (const s of byNumber.get(n) || []) {
                            cur.registered[s.tracking] = {
                                order_uid: s.order_uid, registered_at: nowIso,
                                carrier: carrierOf.get(n) || null, number: n,
                            };
                        }
                    }
                    return cur;
                });
            }
        }

        // ── 2. Hỏi trạng thái (miễn phí) ──
        const info = await getTrackInfo(planTrack(shipments, justRegistered));
        let changed = 0;
        await updateStore<Store>(STORE, emptyStore(), (cur) => {
            for (const t of info.found) {
                // 17TRACK chưa có tin (vừa đăng ký, chưa nhận ra hãng) thì giữ trạng thái
                // đối tác — ghi "NotFound" đè lên là mất luôn "đang ở cửa hàng", và lần
                // nạp file sau cũng không sửa lại được vì nguồn đã thành 17track.
                if (!t.status || t.status === "NotFound") continue;
                for (const s of byNumber.get(clean(t.number)) || []) {
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
        if (registered > 0 || !quota) {
            try { quota = await getQuota(); } catch (e) { console.warn("17TRACK getquota lỗi:", e); }
        }
        // Hết quota = còn đơn cần đăng ký mà không đăng ký được (gói miễn phí: hết tháng).
        const quotaOut = rejected.some((x) => x.code === ERR_QUOTA_OUT) || plan.quota_limited;
        await ghiLuot({
            at: nowIso, ok: true, registered, checked: info.found.length, changed,
            register_rejected: rejected.length, over_cap: plan.over_cap, quota_out: quotaOut, quota,
        });

        const { shipments: after } = await loadShipments(from, to);
        return NextResponse.json({
            ok: true,
            registered,
            register_rejected: rejected.map((x) => ({ number: x.number, message: x.message })),
            over_cap: plan.over_cap,
            quota_out: quotaOut,
            quota,
            checked: info.found.length,
            track_rejected: info.rejected.map((x) => ({ number: x.number, message: x.message })),
            status_changed: changed,
            alerts: buildAlerts(after, now),
            counts: countByStatus(after),
        });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await ghiLuot({ at: nowIso, ok: false, error: msg }).catch(() => {});
        if (e instanceof Track17Error) {
            return NextResponse.json({ error: e.message }, { status: e.code === 429 ? 429 : 502 });
        }
        console.error("tracking POST lỗi:", e);
        return NextResponse.json({ error: "Đồng bộ thất bại" }, { status: 500 });
    }
}

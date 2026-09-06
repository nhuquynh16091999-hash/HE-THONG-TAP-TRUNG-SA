import { NextRequest, NextResponse } from "next/server";
import { bigquery } from "@/lib/bigquery";
import {
    DISPLAY, UNASSIGNED, SALE_DISPLAY, SALE_UNASSIGNED,
    attributeOrder, buildAdidOwner, resolveSale, normPosMarketer,
} from "@/lib/talpha/rules";
import { trackingFromLink } from "@/lib/talpha/cod-recon";
import {
    buildAlerts, countByStatus, mergeStatus, TRACK_CFG,
    type Shipment, type MainStatus,
} from "@/lib/talpha/tracking";
import { register, getTrackInfo, hasApiKey, Track17Error } from "@/lib/talpha/track17";
import { readStore, updateStore } from "@/lib/talpha/store";

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
// chạy ngoài đường, đăng ký vào là phí quota.
// ═══════════════════════════════════════════════════════════════════

const STORE = "tracking";

type Registered = { order_uid: string | null; registered_at: string; carrier: number | null };
type Saved = {
    status: string | null; sub_status: string | null; status_since: string;
    last_event_time: string | null; last_event: string | null;
    source?: "doi_tac" | "17track"; raw_status?: string | null;
    ship_date?: string | null; order_date?: string | null;
};
type PartnerMeta = {
    order_no: string; ship_method: string; cod_local: number; marketer: string;
    recon: string; store_name: string; store_code: string;
    ship_date: string | null; track17_code: string | null;
};
type Store = {
    registered: Record<string, Registered>;
    statuses: Record<string, Saved>;
    partner?: Record<string, PartnerMeta>;
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
async function loadShipments(from: string, to: string): Promise<Shipment[]> {
    const store = readStore<Store>(STORE, emptyStore());
    const partner = store.partner || {};
    const byTracking = new Map<string, Shipment>();

    const shipmentFrom = (tracking: string): Shipment => {
        const saved = store.statuses[tracking];
        const pm = partner[tracking];
        return {
            tracking,
            order_uid: null,
            order_id: pm?.order_no || "",
            order_date: pm?.ship_date ?? null,
            customer: "", phone: "",
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
            registered: !!store.registered[tracking],
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

    return [...byTracking.values()];
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
        const shipments = await loadShipments(from, to);
        const alerts = buildAlerts(shipments);
        return NextResponse.json({
            from, to,
            has_api_key: hasApiKey(),
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
                pending_register: shipments.filter((s) => !s.registered).length,
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

    try {
        const shipments = await loadShipments(from, to);
        const all = shipments.map((s) => s.tracking);
        const toRegister = shipments.filter((s) => !s.registered).map((s) => s.tracking);

        // ── 1. Đăng ký mã mới (TỐN QUOTA) ──
        let registered = 0;
        const rejected: { number: string; message: string }[] = [];
        if (toRegister.length) {
            const r = await register(toRegister);
            registered = r.accepted.length;
            rejected.push(...r.rejected.map((x) => ({ number: x.number, message: x.message })));

            // Ghi sổ NGAY: quota đã bị trừ rồi, mất sổ là lần sau trừ lần nữa.
            if (r.accepted.length) {
                const byNumber = new Map(shipments.map((s) => [s.tracking, s.order_uid]));
                const now = new Date().toISOString();
                await updateStore<Store>(STORE, emptyStore(), (cur) => {
                    for (const a of r.accepted) {
                        cur.registered[a.number] = {
                            order_uid: byNumber.get(a.number) ?? null,
                            registered_at: now,
                            carrier: a.carrier || null,
                        };
                    }
                    return cur;
                });
            }
        }

        // ── 2. Hỏi trạng thái (miễn phí) ──
        const info = await getTrackInfo(all);
        const now = new Date();
        let changed = 0;
        await updateStore<Store>(STORE, emptyStore(), (cur) => {
            for (const t of info.found) {
                const prev = cur.statuses[t.number];
                if (!prev || prev.status !== t.status) changed++;
                // Đánh dấu nguồn 17track: lần nhập file đối tác sau sẽ KHÔNG ghi
                // đè, vì file trễ 2 ngày còn 17TRACK gần thời gian thực.
                cur.statuses[t.number] = { ...mergeStatus(prev, t, now), source: "17track" };
            }
            return cur;
        });

        const after = await loadShipments(from, to);
        return NextResponse.json({
            ok: true,
            registered,
            register_rejected: rejected,
            checked: info.found.length,
            track_rejected: info.rejected.map((x) => ({ number: x.number, message: x.message })),
            status_changed: changed,
            alerts: buildAlerts(after, now),
            counts: countByStatus(after),
        });
    } catch (e) {
        if (e instanceof Track17Error) {
            return NextResponse.json({ error: e.message }, { status: e.code === 429 ? 429 : 502 });
        }
        console.error("tracking POST lỗi:", e);
        return NextResponse.json({ error: "Đồng bộ thất bại" }, { status: 500 });
    }
}

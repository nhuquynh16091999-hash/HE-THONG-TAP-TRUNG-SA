/**
 * Đơn của một thị trường ngoài Đài (Singapore…), đọc từ bảng đối tác trong BigQuery
 * `partner_orders` (talpha-sync nạp mỗi giờ) rồi ghép trạng thái 17TRACK trong sổ riêng của
 * nước đó (data/tracking_<mã>.json).
 *
 * Dùng chung cho HAI màn: Theo dõi vận đơn (/api/talpha/tracking?market=SG) và Đối soát COD
 * (/api/talpha/cod-recon/market?market=SG) — hai màn đọc hai cách là sớm muộn hai con số.
 *
 * Đọc BigQuery hỏng thì NÉM lỗi: nước này không có nguồn thứ hai, trả danh sách rỗng là nói
 * dối "không có đơn".
 */
import { bigquery } from "@/lib/bigquery";
import { readStoreFresh } from "@/lib/talpha/store";
import { partnerOrderShipment, type PartnerOrderRow, type SavedTrack, type Shipment, type TrackMarket } from "./tracking";

const BQ_PROJECT = process.env.NEXT_PUBLIC_BQ_PROJECT || "cty-507710";
const BQ_DATASET = process.env.DATASET || "TALPHA_Dataset";

/** Tối thiểu một sổ vận đơn phải có để ghép trạng thái. */
export type MarketStoreBase = {
    registered: Record<string, { number?: string }>;
    statuses: Record<string, unknown>;
};

// Mã vận đơn có khi dính ký tự lạ từ Sheet — bỏ đi trước khi so.
const clean = (x?: string | null) => String(x || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();

export async function loadPartnerMarketShipments<S extends MarketStoreBase>(
    mk: TrackMarket, emptyStore: () => S,
): Promise<{ shipments: Shipment[]; store: S; lastImport: string | null }> {
    const store = await readStoreFresh<S>(mk.store, emptyStore());
    const regNumbers = new Set(Object.entries(store.registered).map(([k, r]) => r.number || clean(k)));
    const [rows] = await bigquery.query({
        query: `SELECT order_no, tracking, status, note, ship_method, city, contact_name, phone, cod, marketer,
                       FORMAT_DATE('%Y-%m-%d', order_date) AS order_date,
                       FORMAT_DATE('%Y-%m-%d', ship_date) AS ship_date,
                       FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%SZ', synced_at) AS synced_at
                FROM \`${BQ_PROJECT}.${BQ_DATASET}.partner_orders\`
                WHERE market = @m
                ORDER BY row_no`,
        params: { m: mk.partner_market },
    });
    const byKey = new Map<string, Shipment>();
    let lastImport: string | null = null;
    for (const r of rows as (PartnerOrderRow & { synced_at?: string })[]) {
        if (r.synced_at && (!lastImport || r.synced_at > lastImport)) lastImport = r.synced_at;
        const t = clean(r.tracking);
        const key0 = t || `DON-${r.order_no || "?"}`;
        // Hai dòng cùng mã vận đơn (đơn tách/ghép) → khoá thứ hai kèm mã đơn, không đè nhau.
        const key = byKey.has(key0) ? `${key0}#${r.order_no || byKey.size}` : key0;
        const s = partnerOrderShipment(mk, r, store.statuses[key0] as SavedTrack | undefined,
            !!store.registered[key0] || (!!t && regNumbers.has(t)));
        byKey.set(key, { ...s, tracking: key });
    }
    return { shipments: [...byKey.values()], store, lastImport };
}

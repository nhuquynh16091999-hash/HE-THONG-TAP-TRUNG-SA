import { NextRequest, NextResponse } from "next/server";
import { parsePartnerFile, summarise } from "@/lib/talpha/partner-file";
import { RULES } from "@/lib/talpha/rules";
import { fetchSheetCsv, sheetIdFrom, serviceAccountEmail, SheetError } from "@/lib/talpha/sheet-source";
import { readStoreFresh, updateStore } from "@/lib/talpha/store";
import { MAX_UPLOAD_BYTES, tooBigMessage } from "@/lib/talpha/upload-limit";

export const dynamic = "force-dynamic";

// ═══════════════════════════════════════════════════════════════════
// NHẬP FILE ĐƠN HÀNG CỦA ĐỐI TÁC 3PL
//
//   POST            — đọc THẲNG Google Sheet của đối tác (không cần đính kèm gì)
//   POST kèm file   — hoặc tải file CSV/TSV lên tay
//   GET             — xem lần nhập gần nhất
//
// Đây là nguồn trạng thái MIỄN PHÍ và là nguồn CHÍNH. 17TRACK chỉ soi thêm cho
// đơn đáng ngờ vì nó tốn quota.
//
// File đối tác trễ tới 2 ngày, nên KHÔNG được ghi đè trạng thái mới hơn của
// 17TRACK: cùng một mã vận đơn, bản 17TRACK luôn thắng.
// ═══════════════════════════════════════════════════════════════════

const STORE = "tracking";

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
    // Thêm 05 trường cho Sổ đơn hàng: nó cần cả khách lẫn hàng, không chỉ vận đơn.
    order_date?: string | null;
    contact_name?: string; phone?: string;
    sku?: string; quantity?: string;
    return_order_no?: string;
};
type Store = {
    registered: Record<string, unknown>;
    statuses: Record<string, Saved>;
    partner?: Record<string, PartnerMeta>;
    partner_import?: {
        filename: string; imported_at: string; rows: number;
        unknown_statuses: { value: string; count: number }[];
    };
};

const emptyStore = (): Store => ({ registered: {}, statuses: {}, partner: {} });

export async function GET() {
    const s = await readStoreFresh<Store>(STORE, emptyStore());
    return NextResponse.json({
        last_import: s.partner_import ?? null,
        partner_rows: Object.keys(s.partner || {}).length,
    });
}

type PartnerCfg = { sheet_id?: string; sheet_gid?: string };
const partnerCfg = (): PartnerCfg =>
    ((RULES as unknown as { tracking?: { partner_file?: PartnerCfg } }).tracking?.partner_file) || {};

/** Lấy nội dung CSV: ưu tiên file đính kèm, không có thì đọc thẳng Google Sheet. */
async function readSource(req: NextRequest): Promise<{ text: string; name: string; via: string; isPublic?: boolean }> {
    const ct = req.headers.get("content-type") || "";
    if (ct.includes("multipart/form-data")) {
        const form = await req.formData();
        const file = form.get("file");
        if (file instanceof File) {
            if (file.size > MAX_UPLOAD_BYTES) throw new SheetError(tooBigMessage(), 413);
            if (/\.xlsx?$/i.test(file.name)) {
                throw new SheetError(
                    "Chưa đọc được file Excel. Trên Google Sheet chọn Tệp → Tải xuống → CSV rồi tải lên lại.", 415);
            }
            return { text: await file.text(), name: file.name, via: "tải lên tay", isPublic: false };
        }
    }

    const cfg = partnerCfg();
    const id = sheetIdFrom(cfg.sheet_id || "");
    if (!id) {
        throw new SheetError(
            "Chưa khai bảng của đối tác. Điền sheet_id vào talpha_rules.json → " +
            "tracking.partner_file, hoặc tải file CSV lên tay.", 428);
    }
    const r = await fetchSheetCsv(id, cfg.sheet_gid || "0");
    return {
        text: r.csv,
        name: "Google Sheet đối tác",
        via: r.via === "service_account" ? "tài khoản dịch vụ" : "link công khai",
        isPublic: r.is_public,
    };
}

export async function POST(req: NextRequest) {
    try {
        let source: { text: string; name: string; via: string; isPublic?: boolean };
        try {
            source = await readSource(req);
        } catch (e) {
            if (e instanceof SheetError) {
                return NextResponse.json({ error: e.message }, { status: e.status ?? 502 });
            }
            throw e;
        }
        const file = { name: source.name, text: () => Promise.resolve(source.text) };
        const parsed = parsePartnerFile(await file.text());
        if (parsed.missing_columns.length) {
            return NextResponse.json({
                error: `Không tìm ra cột: ${parsed.missing_columns.join(", ")}. ` +
                    `Các cột đọc được: ${parsed.header.join(" · ")}. ` +
                    "Khai thêm tên cột vào talpha_rules.json → tracking.partner_file.column_map",
                header: parsed.header,
            }, { status: 422 });
        }
        if (!parsed.rows.length) {
            return NextResponse.json({ error: "File không có dòng dữ liệu nào" }, { status: 422 });
        }

        const now = new Date();
        const nowIso = now.toISOString();
        let changed = 0, kept17 = 0;

        await updateStore<Store>(STORE, emptyStore(), (cur) => {
            cur.partner ||= {};
            for (const r of parsed.rows) {
                const key = r.tracking || r.order_no;
                if (!key) continue;

                cur.partner[key] = {
                    order_no: r.order_no, ship_method: r.ship_method, cod_local: r.cod_local,
                    marketer: r.marketer, recon: r.recon, store_name: r.store_name,
                    store_code: r.store_code, ship_date: r.ship_date, track17_code: r.track17_code,
                    order_date: r.order_date,
                    contact_name: r.contact_name, phone: r.phone,
                    sku: r.sku, quantity: r.quantity,
                    return_order_no: r.return_order_no,
                };

                if (!r.status) continue;
                const prev = cur.statuses[key];

                // 17TRACK gần thời gian thực, file đối tác trễ 2 ngày — không để
                // file cũ kéo trạng thái lùi lại.
                if (prev?.source === "17track") { kept17++; continue; }

                if (prev?.status !== r.status) changed++;
                cur.statuses[key] = {
                    status: r.status,
                    sub_status: null,
                    // Mốc đếm "nằm ở cửa hàng mấy ngày" chỉ đặt lại khi trạng thái
                    // ĐỔI THẬT. Đặt lại mỗi lần nhập file thì đồng hồ luôn về 0 và
                    // cảnh báo "sắp bị trả về" không bao giờ nổ.
                    status_since: prev?.status === r.status ? prev.status_since : nowIso,
                    last_event_time: r.ship_date ? `${r.ship_date}T00:00:00Z` : null,
                    last_event: r.raw_status || null,
                    source: "doi_tac",
                    raw_status: r.raw_status || null,
                    // Đồng hồ thật để đếm hạn lấy hàng — status_since chỉ là lúc
                    // ta NHÌN THẤY trạng thái, không phải lúc nó xảy ra.
                    ship_date: r.ship_date,
                    // Dự phòng khi đối tác bỏ trống ngày xuất kho — hơn một nửa số
                    // dòng thiếu cột đó. Ngày lên đơn sớm hơn nên cảnh báo nổ sớm,
                    // mà nổ sớm còn hơn để hàng bị trả về.
                    order_date: r.order_date,
                };
            }
            cur.partner_import = {
                filename: file.name, imported_at: nowIso, rows: parsed.rows.length,
                unknown_statuses: parsed.unknown_statuses,
            };
            return cur;
        });

        const s = summarise(parsed.rows);
        return NextResponse.json({
            ok: true,
            filename: file.name,
            via: source.via,
            // Nhắc khoá bảng lại nếu đang đọc bằng link công khai — bảng có tên,
            // số điện thoại và địa chỉ khách.
            public_link_warning: source.isPublic
                ? `Bảng đang ở chế độ ai có link đều xem được, mà trong đó có thông tin khách. ` +
                  `Nên đổi sang riêng tư rồi chia sẻ quyền Người xem cho ${serviceAccountEmail() || "email tài khoản dịch vụ"}.`
                : null,
            rows: parsed.rows.length,
            columns_found: Object.keys(parsed.columns),
            status_changed: changed,
            kept_from_17track: kept17,
            // Giá trị NOTE chưa khai — nêu thẳng thay vì nuốt, vì nuốt là mất đơn
            // khỏi mọi cảnh báo mà không ai biết.
            unknown_statuses: parsed.unknown_statuses,
            summary: {
                total: s.total,
                waiting_pickup: s.waiting_pickup,
                returned: s.returned,
                return_rate: s.return_rate,
                by_status: s.by_status,
            },
        });
    } catch (e) {
        console.error("tracking/import lỗi:", e);
        return NextResponse.json({ error: "Không đọc được file" }, { status: 500 });
    }
}

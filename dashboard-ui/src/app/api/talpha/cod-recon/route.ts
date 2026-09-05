import { NextRequest, NextResponse } from "next/server";
import { bigquery } from "@/lib/bigquery";
import {
    DISPLAY, UNASSIGNED, SALE_DISPLAY, SALE_UNASSIGNED,
    attributeOrder, buildAdidOwner, resolveSale, RULES,
} from "@/lib/talpha/rules";
import {
    parseStatement, reconcile, trackingFromLink,
    MATCH_KEY, TOLERANCE, type PosOrder, type StatementRow,
} from "@/lib/talpha/cod-recon";
import { readStore, updateStore } from "@/lib/talpha/store";

export const dynamic = "force-dynamic";

const BQ_PROJECT = process.env.NEXT_PUBLIC_BQ_PROJECT || "talpha-faos-2026";
const BQ_DATASET = process.env.DATASET || "TALPHA_Dataset";

// ═══════════════════════════════════════════════════════════════════
// ĐỐI SOÁT COD
//
//   POST  — nhận file sao kê 3PL (CSV/TSV), lưu vào kho, trả kết quả khớp ngay
//   GET   — đối soát lại kỳ đang chọn với bản sao kê đã lưu
//   DELETE— xoá một bản sao kê đã tải lên
//
// Chỉ đối chiếu ĐƠN ĐÃ GIAO trong kỳ: đơn chưa giao thì 3PL chưa có lý do trả
// tiền, đưa vào chỉ đẻ ra báo động giả.
//
// File Excel: xuất sang CSV trước. Cố tình không thêm thư viện đọc .xlsx —
// định dạng đó có nhiều biến thể, đọc sai một ô tiền là sai cả bảng đối soát.
// ═══════════════════════════════════════════════════════════════════

const STORE = "cod_statements";
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

type Statement = {
    id: string;
    filename: string;
    uploaded_at: string;
    row_count: number;
    detected_columns: string[];
    missing_columns: string[];
    rows: StatementRow[];
};

const emptyStore = (): { statements: Statement[] } => ({ statements: [] });

/** Đơn đã giao trong kỳ, kèm mã vận đơn và người phụ trách. */
async function loadDeliveredOrders(from: string, to: string): Promise<PosOrder[]> {
    const [adRows] = await bigquery.query({
        query: `SELECT DISTINCT CAST(ad_id AS STRING) AS ad_id, campaign_name
                FROM \`${BQ_PROJECT}.${BQ_DATASET}.fb_ads_data\`
                WHERE ad_id IS NOT NULL AND campaign_name IS NOT NULL`,
    });
    const adidOwner = buildAdidOwner(adRows as { ad_id: string; campaign_name: string }[]);

    const [rows] = await bigquery.query({
        query: `
            SELECT
                v.order_uid, v.order_id, v.order_date,
                v.status_category, v.status_name, v.pos_money_divisor,
                v.marketer_name, v.resolved_ad_id,
                o.cod, o.tracking_link, o.page_id, o.tags
            FROM \`${BQ_PROJECT}.${BQ_DATASET}.vw_orders_std\` v
            LEFT JOIN \`${BQ_PROJECT}.${BQ_DATASET}.sale_order\` o
                   ON v.shop_id = o.shop_id AND v.order_id = o.id
            WHERE v.order_date BETWEEN @from AND @to
              AND v.status_category = 'GIAO_THANH_CONG'
              AND COALESCE(o.cod, 0) > 0`,
        params: { from, to },
    });

    return (rows as Record<string, unknown>[]).map((r) => {
        const divisor = Number(r.pos_money_divisor) || 1;
        const { key } = attributeOrder(
            r.marketer_name as string | null,
            r.resolved_ad_id as string | null,
            adidOwner,
        );
        const saleKey = resolveSale({
            order_uid: r.order_uid as string,
            page_id: r.page_id as string | null,
            tags: r.tags as string | null,
        });
        return {
            order_uid: r.order_uid as string,
            order_id: String(r.order_id ?? ""),
            tracking: trackingFromLink(r.tracking_link as string | null),
            order_date: r.order_date && typeof r.order_date === "object"
                ? (r.order_date as { value: string }).value
                : String(r.order_date ?? ""),
            status_category: r.status_category as string,
            status_name: r.status_name as string,
            cod_local: (Number(r.cod) || 0) / divisor,
            marketer: key === UNASSIGNED ? UNASSIGNED : (DISPLAY[key] || key),
            sale: saleKey ? (SALE_DISPLAY[saleKey] || saleKey) : SALE_UNASSIGNED,
        };
    });
}

function shipFeeDeclared(): boolean {
    const fees = (RULES as unknown as { shipping_fees?: Record<string, { declared?: boolean }> }).shipping_fees || {};
    return !!fees.TW?.declared;
}

function warnings(): string[] {
    const w: string[] = [];
    if (!shipFeeDeclared()) {
        w.push(
            "Chưa khai phí 3PL cho Đài Loan (talpha_rules.json → shipping_fees.TW). " +
            "Đối soát tiền COD vẫn đúng, nhưng phần phí trên sao kê chưa có gì để đối chiếu.",
        );
    }
    return w;
}

export async function GET(req: NextRequest) {
    const q = req.nextUrl.searchParams;
    const from = q.get("from") || "";
    const to = q.get("to") || "";
    const statementId = q.get("statement") || "";

    const store = readStore(STORE, emptyStore());
    const list = store.statements.map((s) => ({
        id: s.id, filename: s.filename, uploaded_at: s.uploaded_at,
        row_count: s.row_count, detected_columns: s.detected_columns,
        missing_columns: s.missing_columns,
    }));

    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        return NextResponse.json({ statements: list, warnings: warnings(), result: null });
    }

    const chosen = statementId
        ? store.statements.find((s) => s.id === statementId)
        : store.statements[store.statements.length - 1];

    try {
        const orders = await loadDeliveredOrders(from, to);
        const result = reconcile(orders, chosen?.rows || []);
        return NextResponse.json({
            from, to,
            statements: list,
            statement_id: chosen?.id || null,
            statement_name: chosen?.filename || null,
            warnings: chosen ? warnings() : [...warnings(), "Chưa có bản sao kê nào — tải lên để đối soát."],
            ...result,
        });
    } catch (e) {
        console.error("cod-recon GET lỗi:", e);
        return NextResponse.json({ error: "Query lỗi" }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const form = await req.formData();
        const file = form.get("file");
        if (!(file instanceof File)) {
            return NextResponse.json({ error: "Thiếu file sao kê" }, { status: 400 });
        }
        if (file.size > MAX_UPLOAD_BYTES) {
            return NextResponse.json({ error: "File quá 8MB — cắt bớt kỳ rồi tải lại" }, { status: 413 });
        }
        if (/\.xlsx?$/i.test(file.name)) {
            return NextResponse.json({
                error: "Chưa đọc được file Excel. Mở file rồi Lưu thành .csv, sau đó tải lại.",
            }, { status: 415 });
        }

        const text = await file.text();
        const { rows, mapping, header } = parseStatement(text);

        const need = MATCH_KEY === "tracking" ? "tracking" : "order_id";
        if (mapping[need] === undefined) {
            return NextResponse.json({
                error: `Không tìm ra cột "${need}" trong file. Các cột đọc được: ${header.join(" · ")}. ` +
                    `Khai thêm tên cột của 3PL vào talpha_rules.json → cod_settlement.column_map.${need}`,
                header,
            }, { status: 422 });
        }
        if (mapping.amount === undefined) {
            return NextResponse.json({
                error: `Không tìm ra cột số tiền. Các cột đọc được: ${header.join(" · ")}. ` +
                    "Khai thêm vào cod_settlement.column_map.amount",
                header,
            }, { status: 422 });
        }
        if (!rows.length) {
            return NextResponse.json({ error: "File không có dòng dữ liệu nào" }, { status: 422 });
        }

        const detected = Object.keys(mapping);
        const statement: Statement = {
            id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            filename: file.name,
            uploaded_at: new Date().toISOString(),
            row_count: rows.length,
            detected_columns: detected,
            missing_columns: ["tracking", "order_id", "amount", "fee", "paid_date", "status"]
                .filter((f) => !detected.includes(f)),
            rows,
        };

        // Giữ tối đa 20 bản gần nhất — sao kê cũ hơn thì đối soát lại từ file gốc.
        await updateStore(STORE, emptyStore(), (cur) => ({
            statements: [...cur.statements, statement].slice(-20),
        }));

        return NextResponse.json({
            ok: true,
            statement: {
                id: statement.id, filename: statement.filename,
                uploaded_at: statement.uploaded_at, row_count: statement.row_count,
                detected_columns: statement.detected_columns,
                missing_columns: statement.missing_columns,
            },
            warnings: warnings(),
        });
    } catch (e) {
        console.error("cod-recon POST lỗi:", e);
        return NextResponse.json({ error: "Không đọc được file sao kê" }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    const id = req.nextUrl.searchParams.get("statement") || "";
    if (!id) return NextResponse.json({ error: "Thiếu mã bản sao kê" }, { status: 400 });
    const after = await updateStore(STORE, emptyStore(), (cur) => ({
        statements: cur.statements.filter((s) => s.id !== id),
    }));
    return NextResponse.json({ ok: true, remaining: after.statements.length });
}

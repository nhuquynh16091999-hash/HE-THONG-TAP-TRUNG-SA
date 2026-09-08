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
import {
    parseNazaStatement, type NazaStatement,
} from "@/lib/talpha/naza-statement";
import { readStoreFresh, updateStore } from "@/lib/talpha/store";
import { MAX_UPLOAD_BYTES, tooBigMessage } from "@/lib/talpha/upload-limit";

export const dynamic = "force-dynamic";

const BQ_PROJECT = process.env.NEXT_PUBLIC_BQ_PROJECT || "cty-507710";
const BQ_DATASET = process.env.DATASET || "TALPHA_Dataset";

// ═══════════════════════════════════════════════════════════════════
// ĐỐI SOÁT COD
//
//   POST  — nhận file sao kê 3PL, lưu vào kho, trả kết quả khớp ngay
//   GET   — đối soát lại kỳ đang chọn với bản sao kê đã lưu
//   DELETE— xoá một bản sao kê đã tải lên
//
// Chỉ đối chiếu ĐƠN ĐÃ GIAO trong kỳ: đơn chưa giao thì 3PL chưa có lý do trả
// tiền, đưa vào chỉ đẻ ra báo động giả.
//
// HAI ĐỊNH DẠNG:
//   .xlsx — sao kê NAZA供应链, ba sheet (TỔNG · COD · PHÍ). Đọc được cả phép
//           quyết toán lẫn phí từng đơn, nên soát được cả tiền lẫn phí.
//   .csv  — đường lui cho đối tác khác hoặc file đã xuất tay. Chỉ có tiền COD.
// ═══════════════════════════════════════════════════════════════════

const STORE = "cod_statements";

type Statement = {
    id: string;
    filename: string;
    uploaded_at: string;
    row_count: number;
    detected_columns: string[];
    missing_columns: string[];
    rows: StatementRow[];
    /** Chỉ có ở sao kê NAZA .xlsx — phép quyết toán, phí từng đơn, kết quả soát phí. */
    naza?: {
        sheets: NazaStatement["sheets"];
        summary: NazaStatement["summary"];
        checks: NazaStatement["checks"];
        fee_audit: NazaStatement["fee_audit"];
        fee_lines: NazaStatement["fee_lines"];
    };
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

// ─────────────────────────────────────────────────────────────────────────
// NGUỒN ĐƠN DỰ PHÒNG — file đối tác
//
// Đối soát cần biết "đơn nào đã giao, thu bao nhiêu". Nguồn chuẩn là POS qua
// BigQuery, nhưng chừng nào chưa có key Poscake thì kho đó trống, và đối soát
// sẽ hiện toàn số 0 dù sao kê đã tải lên đầy đủ.
//
// File đối tác 3PL trả lời được đúng câu hỏi đó: có mã vận đơn, tiền COD, trạng
// thái giao. Nên khi BigQuery không trả về đơn nào, lấy tạm từ đó — kèm cờ
// `order_source` để màn hình nói rõ số đang đọc từ đâu, không giả vờ là POS.
//
// Đây là cùng một lối đã dùng ở tab Theo dõi vận đơn: hợp hai nguồn thay vì
// đứng chờ nguồn chuẩn.
// ─────────────────────────────────────────────────────────────────────────
type PartnerMeta = {
    order_no: string; ship_method: string; cod_local: number; marketer: string;
    recon: string; store_name: string; store_code: string;
    ship_date: string | null; track17_code: string | null;
};
type TrackingStore = {
    statuses: Record<string, { status: string | null; ship_date?: string | null; order_date?: string | null }>;
    partner?: Record<string, PartnerMeta>;
};

async function loadPartnerDelivered(from: string, to: string): Promise<PosOrder[]> {
    const store = await readStoreFresh<TrackingStore>("tracking", { statuses: {}, partner: {} });
    const partner = store.partner || {};
    const out: PosOrder[] = [];

    for (const [tracking, p] of Object.entries(partner)) {
        const st = store.statuses[tracking];
        if (st?.status !== "Delivered") continue;          // chưa giao thì 3PL chưa nợ tiền
        if (!(p.cod_local > 0)) continue;

        // Mốc thời gian: ưu tiên ngày lên đơn, lùi về ngày xuất kho. Đơn thiếu
        // cả hai vẫn phải được soát — bỏ đi là giấu mất tiền đang treo.
        const d = st?.order_date || p.ship_date || st?.ship_date || null;
        if (d && (d < from || d > to)) continue;

        out.push({
            order_uid: `PARTNER:${tracking}`,
            order_id: p.order_no || tracking,
            tracking,
            order_date: d || "",
            status_category: "GIAO_THANH_CONG",
            status_name: "Đã giao thành công",
            cod_local: p.cod_local,
            marketer: p.marketer || UNASSIGNED,
            sale: SALE_UNASSIGNED,
        });
    }
    return out;
}

function shipFeeDeclared(): boolean {
    const fees = (RULES as unknown as { shipping_fees?: Record<string, { declared?: boolean }> }).shipping_fees || {};
    return !!fees.TW?.declared;
}

const vnd = (n: number) => Math.round(n).toLocaleString("vi-VN");

/** Cảnh báo về CHÍNH BẢN SAO KÊ — những thứ phải hỏi 3PL, tách khỏi kết quả khớp đơn. */
function warnings(st?: Statement): string[] {
    const w: string[] = [];
    if (!shipFeeDeclared()) {
        w.push(
            "Chưa khai phí 3PL cho Đài Loan (talpha_rules.json → shipping_fees.TW). " +
            "Đối soát tiền COD vẫn đúng, nhưng phần phí trên sao kê chưa có gì để đối chiếu.",
        );
    }
    const n = st?.naza;
    if (!n) return w;

    if (n.checks.math_ok === false) w.push(`Sheet TỔNG: ${n.checks.math_note}`);
    if (n.checks.cod_gap !== null && Math.abs(n.checks.cod_gap) > 0.5) {
        w.push(
            `Chi tiết COD cộng ra ${vnd(n.checks.cod_detail_total)} TWD nhưng sheet TỔNG ghi ` +
            `${vnd(n.checks.cod_summary_total ?? 0)} TWD — lệch ${vnd(n.checks.cod_gap)} TWD. Hỏi lại 3PL.`,
        );
    }
    if (n.fee_audit.wrong > 0) {
        w.push(
            `${n.fee_audit.wrong} dòng phí không đúng bảng giá, chênh ${vnd(n.fee_audit.overcharge_rmb)} RMB. ` +
            "Xem mục Soát phí bên dưới.",
        );
    }
    if (n.fee_audit.unknown_channel > 0) {
        w.push(
            `${n.fee_audit.unknown_channel} dòng không nhận ra kênh giao hàng nên chưa soát được phí. ` +
            "Khai thêm token kênh vào shipping_fees.TW.channels.",
        );
    }
    if (n.summary.purchase_vnd) {
        w.push(
            `Kỳ này bị trừ ${vnd(n.summary.purchase_vnd)} VND phí mua hàng trước khi chuyển tiền về. ` +
            "Khoản này không nằm trong bảng giá vận chuyển — đối chiếu với đơn mua hàng.",
        );
    }
    return w;
}

export async function GET(req: NextRequest) {
    const q = req.nextUrl.searchParams;
    const from = q.get("from") || "";
    const to = q.get("to") || "";
    const statementId = q.get("statement") || "";

    const store = await readStoreFresh(STORE, emptyStore());
    const list = store.statements.map((s) => ({
        id: s.id, filename: s.filename, uploaded_at: s.uploaded_at,
        row_count: s.row_count, detected_columns: s.detected_columns,
        missing_columns: s.missing_columns,
        kind: s.naza ? "naza" : "csv",
    }));

    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        return NextResponse.json({ statements: list, warnings: warnings(), result: null });
    }

    const chosen = statementId
        ? store.statements.find((s) => s.id === statementId)
        : store.statements[store.statements.length - 1];

    try {
        // ĐỐI SOÁT THEO BẢN SAO KÊ, KHÔNG THEO KHOẢNG NGÀY.
        //
        // Một bản sao kê là một KỲ THANH TOÁN: nó trả tiền cho đơn đã giao xong,
        // mà đơn đó có thể được đặt từ hàng tháng trước. Kỳ 04/09 thật có đơn
        // đặt từ 10/07. Nếu chỉ nạp đơn trong khoảng ngày đang chọn rồi đem
        // khớp, những đơn cũ hơn sẽ không tìm thấy và bị kết luận là "3PL trả
        // cho đơn mình không có" — thử với khoảng 15/08–08/09 ra 28 đơn báo
        // động giả kiểu đó, trong khi đơn nằm sẵn trong hệ thống.
        //
        // Nên nạp TOÀN BỘ đơn đã giao. Khoảng ngày ở thanh trên không lọc phần
        // này; nó chỉ dùng làm mốc "hôm nay" để tính đơn nào quá hạn.
        const ALL_FROM = "2000-01-01";
        const ALL_TO = "2999-12-31";

        // HỢP hai nguồn, không chọn một.
        //
        // POS và file đối tác đều trả lời "đơn nào đã giao", nhưng lệch nhau rất
        // xa: POS mới có 5 đơn giao thành công có COD, file đối tác có 361 —
        // đội không cập nhật trạng thái lên POS kịp. Bản trước chỉ lấy file đối
        // tác KHI BigQuery trống; đến lúc POS có vài đơn thì hệ thống bỏ luôn
        // file đối tác, và đối soát tụt từ 316 đơn khớp xuống 0.
        //
        // Nên gộp: POS thắng khi cùng một mã vận đơn (có marketer, có sale),
        // đơn nào POS chưa biết thì lấy từ file đối tác.
        let posOrders: PosOrder[] = [];
        try {
            posOrders = await loadDeliveredOrders(ALL_FROM, ALL_TO);
        } catch (e) {
            console.warn("cod-recon: không đọc được đơn từ BigQuery, chỉ dùng file đối tác:", e);
        }
        const partnerOrders = await loadPartnerDelivered(ALL_FROM, ALL_TO);

        const merged = new Map<string, PosOrder>();
        const keyOf = (o: PosOrder) => {
            const t = String(o.tracking ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
            const norm = /^\d+$/.test(t) ? t.replace(/^0+/, "") || t : t;
            return norm || `ORD:${o.order_id}`;
        };
        for (const o of partnerOrders) merged.set(keyOf(o), o);
        for (const o of posOrders) merged.set(keyOf(o), o);   // POS ghi đè
        const orders = [...merged.values()];

        const source: "pos" | "doi_tac" | "ca_hai" =
            posOrders.length && partnerOrders.length ? "ca_hai"
                : posOrders.length ? "pos" : "doi_tac";

        // Sao kê phải CỘNG DỒN cả các kỳ, không chỉ kỳ đang xem.
        //
        // Tiền của một đơn chỉ về đúng một lần, ở đúng một kỳ. Đem toàn bộ đơn
        // đã giao đi khớp với riêng một kỳ thì mọi đơn đã trả ở kỳ khác đều bị
        // kết luận "chưa về tiền" — sổ tiền treo phồng lên gấp mấy lần sự thật.
        //
        // Nên khớp với HỢP của mọi bản sao kê đã tải. Bản đang chọn chỉ quyết
        // định xem phần quyết toán và soát phí của kỳ nào.
        const allRows = store.statements.flatMap((s) => s.rows);
        const result = reconcile(orders, allRows, { asOf: to });
        const notes = chosen
            ? warnings(chosen)
            : [...warnings(), "Chưa có bản sao kê nào — tải lên để đối soát."];
        const di = result.data_issues;
        if (di.duplicate_tracking.length) {
            notes.push(
                `${di.duplicate_tracking.length} mã vận đơn đang bị gán cho nhiều đơn khác nhau ` +
                `(${di.duplicate_tracking.slice(0, 4).map((d) => `${d.tracking} → ${d.orders.join(" / ")}`).join("; ")}` +
                `${di.duplicate_tracking.length > 4 ? "; …" : ""}). ` +
                "Đây là lỗi ở file đơn, không phải 3PL — sửa file nguồn, nếu không đối soát sẽ khớp nhầm đơn.",
            );
        }
        if (di.orders_without_tracking) {
            notes.push(
                `${di.orders_without_tracking} đơn đã giao không có mã vận đơn nên chỉ khớp được bằng mã đơn — ` +
                "kém chắc chắn hơn hẳn. Điền mã vận đơn vào file đơn.",
            );
        }
        if (source === "doi_tac") {
            notes.unshift(
                `Đang đối soát với ${orders.length} đơn đọc từ FILE ĐỐI TÁC, không phải từ POS. ` +
                "Số tiền COD lấy theo file đối tác.",
            );
        } else if (source === "ca_hai") {
            notes.unshift(
                `Đối soát với ${orders.length} đơn giao thành công, gộp từ hai nguồn: ` +
                `POS ${posOrders.length} đơn · file đối tác ${partnerOrders.length} đơn. ` +
                "Trùng mã vận đơn thì lấy theo POS.",
            );
            // POS chậm hơn hẳn thực tế thì phải nói ra, vì mọi báo cáo khác chỉ
            // đọc POS và sẽ thiếu đúng chừng đó đơn.
            if (partnerOrders.length > posOrders.length * 3) {
                notes.push(
                    `POS mới ghi ${posOrders.length} đơn giao thành công trong khi đối tác báo ` +
                    `${partnerOrders.length}. Trạng thái trên POS đang chậm hơn thực tế rất nhiều — ` +
                    "các báo cáo doanh thu đọc POS sẽ thiếu đúng chừng đó đơn.",
                );
            }
        } else if (!orders.length) {
            notes.push(
                "Không có đơn đã giao nào trong kỳ này. Kiểm tra khoảng ngày, " +
                "hoặc vào tab Theo dõi vận đơn bấm Đọc bảng đối tác để nạp đơn.",
            );
        }

        return NextResponse.json({
            from, to,
            statements: list,
            statement_id: chosen?.id || null,
            statement_name: chosen?.filename || null,
            naza: chosen?.naza || null,
            order_source: source,
            order_count: orders.length,
            statement_count: store.statements.length,
            statement_row_count: allRows.length,
            warnings: notes,
            ...result,
        });
    } catch (e) {
        console.error("cod-recon GET lỗi:", e);
        return NextResponse.json({ error: "Query lỗi" }, { status: 500 });
    }
}

/**
 * Tải lại CÙNG MỘT FILE thì THAY, không cộng thêm.
 *
 * Sao kê là sổ tiền: một đơn chỉ được trả một lần. Để hai bản của cùng một kỳ
 * nằm cạnh nhau thì mọi dòng của kỳ đó bị đếm hai lượt — "khớp sạch" phồng lên
 * và một khoản lệch 14 TWD hoá thành 28. Đã dính thật khi thử.
 *
 * Mà tải lại là chuyện thường: 3PL gửi bản sửa, hoặc người dùng bấm nhầm.
 */
function replaceSameFile(list: Statement[], filename: string): Statement[] {
    const key = filename.trim().toLowerCase();
    return list.filter((s) => s.filename.trim().toLowerCase() !== key);
}

export async function POST(req: NextRequest) {
    try {
        const form = await req.formData();
        const file = form.get("file");
        if (!(file instanceof File)) {
            return NextResponse.json({ error: "Thiếu file sao kê" }, { status: 400 });
        }
        if (file.size > MAX_UPLOAD_BYTES) {
            return NextResponse.json({ error: tooBigMessage() }, { status: 413 });
        }
        const mkId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

        // ── Sao kê NAZA (.xlsx) ──────────────────────────────────────────
        if (/\.xlsx$/i.test(file.name)) {
            const buf = Buffer.from(await file.arrayBuffer());
            let naza;
            try {
                naza = await parseNazaStatement(buf, file.name);
            } catch (e) {
                console.error("đọc xlsx lỗi:", e);
                return NextResponse.json({
                    error: "Không mở được file .xlsx. Kiểm tra file có mở được bằng Excel không, " +
                        "hoặc Lưu thành .csv rồi tải lại.",
                }, { status: 422 });
            }
            if (!naza.cod_lines.length) {
                return NextResponse.json({
                    error: "Mở được file nhưng không thấy dòng COD nào. Sao kê NAZA phải có sheet " +
                        `COD với cột 原单号 và COD金额. Các sheet đọc được: ${JSON.stringify(naza.sheets)}`,
                }, { status: 422 });
            }

            // Quy về StatementRow để dùng chung một hàm đối soát với đường CSV.
            const rows: StatementRow[] = naza.cod_lines.map((l) => ({
                tracking: l.tracking,
                order_id: l.order_id,
                amount: l.cod_twd,
                fee: 0,                       // phí nằm ở sheet riêng, KHÔNG theo từng đơn COD
                paid_date: l.recv_date || "",
                status: "paid",
            }));

            const statement: Statement = {
                id: mkId(),
                filename: file.name,
                uploaded_at: new Date().toISOString(),
                row_count: rows.length,
                detected_columns: ["tracking", "order_id", "amount", "paid_date"],
                missing_columns: [],
                rows,
                naza: {
                    sheets: naza.sheets,
                    summary: naza.summary,
                    checks: naza.checks,
                    fee_audit: naza.fee_audit,
                    fee_lines: naza.fee_lines,
                },
            };

            await updateStore(STORE, emptyStore(), (cur) => ({
                statements: [...replaceSameFile(cur.statements, file.name), statement].slice(-20),
            }));

            return NextResponse.json({
                ok: true,
                statement: {
                    id: statement.id, filename: statement.filename,
                    uploaded_at: statement.uploaded_at, row_count: statement.row_count,
                    detected_columns: statement.detected_columns,
                    missing_columns: statement.missing_columns,
                    naza: statement.naza,
                },
                warnings: warnings(statement),
            });
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
            id: mkId(),
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
            statements: [...replaceSameFile(cur.statements, file.name), statement].slice(-20),
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

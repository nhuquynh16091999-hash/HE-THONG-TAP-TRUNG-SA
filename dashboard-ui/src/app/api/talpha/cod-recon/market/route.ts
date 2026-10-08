import { NextRequest, NextResponse } from "next/server";
import { bigquery } from "@/lib/bigquery";
import { MARKETS_PUBLIC } from "@/lib/talpha/rules";
import { trackMarket } from "@/lib/talpha/tracking";
import { loadMarketShipments } from "@/lib/talpha/tracking-market";
import { trackingFromLink } from "@/lib/talpha/cod-recon";
import {
    nhanTrangThai, nhanTrangThaiPos, nhomTheoPos, nhomTheoVanDon, tongHopCod, type DonCod,
} from "@/lib/talpha/cod-market";
import { parseNazaStatement, xlsxThanhBang } from "@/lib/talpha/naza-statement";
import {
    chonDongNaza, chonSheetSaoKe, docCsvSaoKe, khopSaoKeNuoc, ngayKy, tenKhoSaoKe, thayKyCu,
    type CotSaoKe, type SaoKeNuoc,
} from "@/lib/talpha/cod-statement-market";
import { ngaySaoKe } from "@/lib/talpha/purchase-sheet";
import { readStoreFresh, updateStore } from "@/lib/talpha/store";
import { MAX_UPLOAD_BYTES, tooBigMessage } from "@/lib/talpha/upload-limit";

export const dynamic = "force-dynamic";

const BQ_PROJECT = process.env.NEXT_PUBLIC_BQ_PROJECT || "cty-507710";
const BQ_DATASET = process.env.DATASET || "TALPHA_Dataset";

// ═══════════════════════════════════════════════════════════════════
// ĐỐI SOÁT COD — THỊ TRƯỜNG NGOÀI ĐÀI (bước 1, Sỹ Anh chốt 26/09/2026)
//
//   GET    ?market=SG|AE — tiền còn ở đâu: đã giao (bên giao hàng đang giữ) / chưa giao
//                          (ngoài đường) / không tính (hoàn, huỷ), kèm danh sách đơn — và từ
//                          08/10/2026 khớp với các kỳ sao kê đã tải: đơn nào đã được trả.
//   POST   ?market=…     — tải sao kê của bên giao hàng nước đó (kho riêng từng nước)
//   DELETE ?market=…&statement=id — xoá một kỳ đã tải
//
// Nguồn chọn theo nước, CÙNG hàm đọc với màn Theo dõi vận đơn (lib/talpha/tracking-market.ts)
// để hai màn không lệch được:
//   • Singapore: bảng đối tác + 17TRACK;
//   • UAE (từ 28/09/2026): đơn POS + trạng thái tra ở trang WeShip. Trước đó UAE đọc trạng thái
//     POS — sai: POS ghi "shipped" cả đơn khách đã từ chối;
//   • nước chưa khai tracking.markets: trạng thái đơn trên POS.
// Bước 2 (08/10/2026, Sỹ Anh: "Singapore và UAE không có chỗ up file giống Đài à"): tải sao kê
// ở đây, đọc + khớp ở lib/talpha/cod-statement-market.ts. Chưa có file mẫu nước nào nên nhận cả
// sao kê kiểu NAZA lẫn bảng .xlsx/.csv bất kỳ có cột mã vận đơn + tiền COD.
// Đài Loan KHÔNG đi qua đây: màn Đài dùng /api/talpha/cod-recon với sao kê NAZA.
// ═══════════════════════════════════════════════════════════════════

type Nguon = { loai: "doi_tac" | "weship" | "pos"; nhan: string; cap_nhat: string | null };

function nuocCua(req: NextRequest) {
    const code = String(req.nextUrl.searchParams.get("market") || "").toUpperCase();
    const m = MARKETS_PUBLIC.markets.find((x) => x.code === code);
    return m && code !== "TW" ? m : null;
}
const SAI_NUOC = { error: "market phải là mã một nước ngoài Đài (SG, AE…)" };
/** Chỉ phần cần đọc của kho sao kê Đài (route /api/talpha/cod-recon). */
type KyDai = { filename: string; naza?: { sg_gop?: unknown } };
const khoRong = (): { statements: SaoKeNuoc[] } => ({ statements: [] });

/** Mọi đơn của một nước, chia nhóm đã giao / chưa giao / không tính. */
async function layDon(code: string): Promise<{ don: DonCod[]; nguon: Nguon }> {
    let don: DonCod[] = [];
    let nguon: Nguon;

    const tm = trackMarket(code);
    if (tm.code === code) {
        const { shipments, store, lastImport } = await loadMarketShipments(tm,
            (): { registered: Record<string, never>; statuses: Record<string, unknown>; last_sync?: { at: string; ok: boolean } } =>
                ({ registered: {}, statuses: {} }));
        const laPos = tm.source === "pos";
        don = shipments.map((s) => {
            const p = nhomTheoVanDon(s.status, s.sub_status);
            return {
                order_id: s.order_id, tracking: s.track17_code || "", order_date: s.order_date,
                // Đơn POS chưa có mã AWB = hàng chưa rời kho, đừng gọi là "Đã tạo vận đơn".
                trang_thai: laPos && !s.track17_code ? "Chưa gửi hàng" : nhanTrangThai(s.status, s.raw_status),
                nhom: p.nhom, ly_do: p.ly_do,
                cod_local: Number(s.cod_local) || 0, khach: s.customer || "",
            };
        });
        nguon = laPos
            ? { loai: "weship", nhan: "Đơn POS + trạng thái tra ở WeShip", cap_nhat: store.last_sync?.ok ? store.last_sync.at : null }
            : { loai: "doi_tac", nhan: "Bảng đối tác + 17TRACK", cap_nhat: lastImport };
    } else {
        const [rows] = await bigquery.query({
            query: `SELECT v.order_id, CAST(v.order_date AS STRING) AS order_date,
                           v.status_category, v.status_name,
                           SAFE_DIVIDE(o.cod, NULLIF(v.pos_money_divisor, 0)) AS cod,
                           o.tracking_link, o.bill_full_name
                    FROM \`${BQ_PROJECT}.${BQ_DATASET}.vw_orders_std\` v
                    LEFT JOIN \`${BQ_PROJECT}.${BQ_DATASET}.sale_order\` o
                           ON v.shop_id = o.shop_id AND v.order_id = o.id
                    WHERE v.market = @m
                    ORDER BY v.order_date DESC`,
            params: { m: code },
        });
        for (const r of rows as Record<string, unknown>[]) {
            const p = nhomTheoPos(r.status_category as string);
            if (!p) continue;
            don.push({
                order_id: String(r.order_id ?? ""),
                tracking: trackingFromLink(r.tracking_link as string | null) || "",
                order_date: r.order_date ? String(r.order_date).slice(0, 10) : null,
                trang_thai: nhanTrangThaiPos(r.status_name as string, r.status_category as string),
                nhom: p.nhom, ly_do: p.ly_do,
                cod_local: Number(r.cod) || 0,
                khach: String(r.bill_full_name || ""),
            });
        }
        nguon = { loai: "pos", nhan: "Đơn trên POS (chưa có bảng đơn của bên giao hàng)", cap_nhat: null };
    }
    return { don, nguon };
}

export async function GET(req: NextRequest) {
    const m = nuocCua(req);
    if (!m) return NextResponse.json(SAI_NUOC, { status: 400 });
    try {
        const [{ don, nguon }, kho, khoDai] = await Promise.all([
            layDon(m.code), readStoreFresh(tenKhoSaoKe(m.code), khoRong()),
            m.code === "SG" ? readStoreFresh<{ statements: KyDai[] }>("cod_statements", { statements: [] }) : null,
        ]);
        // Kỳ Đài có gộp phần Sing (24/09/2026): khoản âm của kỳ Sing cùng ngày đã trừ ở đó.
        const ngayGopDai = (khoDai?.statements || []).filter((s) => s.naza?.sg_gop)
            .map((s) => ngaySaoKe(s.filename.normalize("NFC"))).filter((d): d is string => !!d);
        const k = khopSaoKeNuoc(don, kho.statements, m.rate_vnd, ngayGopDai);
        return NextResponse.json({
            market: { code: m.code, display: m.display, currency: m.currency, symbol: m.symbol, rate_vnd: m.rate_vnd },
            nguon,
            sao_ke: kho.statements.length,
            // "Còn phải gửi" chỉ còn đơn CHƯA thấy trên kỳ sao kê nào; đơn đã trả tính riêng.
            tong: tongHopCod(k.don.filter((d) => !d.da_tra), m.rate_vnd),
            da_tra: k.da_tra,
            da_gui_ve: k.da_gui_ve,
            ky: k.ky,
            lech: k.lech,
            khong_co_don: k.khong_co_don,
            tra_hai_lan: k.tra_hai_lan,
            don: k.don,
        });
    } catch (e) {
        console.error("cod-recon/market lỗi:", e);
        return NextResponse.json({ error: "Không đọc được đơn của nước này" }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const m = nuocCua(req);
    if (!m) return NextResponse.json(SAI_NUOC, { status: 400 });
    try {
        const form = await req.formData();
        const file = form.get("file");
        if (!(file instanceof File)) return NextResponse.json({ error: "Thiếu file sao kê" }, { status: 400 });
        if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: tooBigMessage() }, { status: 413 });
        if (/\.xls$/i.test(file.name)) {
            return NextResponse.json({
                error: "File .xls (Excel đời cũ) chưa đọc được — mở bằng Excel, Lưu thành .xlsx hoặc .csv rồi tải lại.",
            }, { status: 422 });
        }

        const tenFile = file.name.normalize("NFC").trim();
        const canhBao: string[] = [];
        let st: Omit<SaoKeNuoc, "id" | "uploaded_at" | "ngay">;

        if (/\.xlsx$/i.test(file.name)) {
            const buf = Buffer.from(await file.arrayBuffer());
            let naza;
            try {
                naza = await parseNazaStatement(buf, tenFile);
            } catch (e) {
                console.error("cod-recon/market đọc xlsx lỗi:", e);
                return NextResponse.json({
                    error: "Không mở được file .xlsx. Kiểm tra file mở được bằng Excel không, hoặc Lưu thành .csv rồi tải lại.",
                }, { status: 422 });
            }
            // Sao kê kiểu NAZA — chỉ lấy dòng của nước đang mở. Kỳ chưa thu được COD nào thì file
            // chỉ có sheet TỔNG + PHÍ (Sing 24/09/2026) — vẫn là sao kê NAZA.
            if (naza.cod_lines.length || naza.fee_lines.length) {
                const c = chonDongNaza(naza, m.code, tenFile);
                if ("loi" in c) return NextResponse.json({ error: c.loi }, { status: 422 });
                canhBao.push(...c.canh_bao);
                st = { filename: tenFile, kieu: "naza", rows: c.rows, naza: c.tong, canh_bao: canhBao };
            } else {
                const d = chonSheetSaoKe(await xlsxThanhBang(buf));
                if (!d) return NextResponse.json({ error: khongThayCot(m.code) }, { status: 422 });
                st = { filename: tenFile, kieu: "bang", rows: d.rows, cot: tenCot(d.header, d.cot), canh_bao: canhBao };
            }
        } else {
            const d = docCsvSaoKe(await file.text());
            if (!d || !d.rows.length) return NextResponse.json({ error: khongThayCot(m.code) }, { status: 422 });
            st = { filename: tenFile, kieu: "bang", rows: d.rows, cot: tenCot(d.header, d.cot), canh_bao: canhBao };
        }

        const chiCoPhi = st.kieu === "naza" && (st.naza?.don_phi || st.naza?.phai_nhan_vnd != null);
        if (!st.rows.length && !chiCoPhi) return NextResponse.json({ error: "File không có dòng đơn nào." }, { status: 422 });
        if (st.kieu === "bang" && !st.rows.some((r) => r.amount)) {
            return NextResponse.json({
                error: `Đọc được ${st.rows.length} dòng nhưng cột tiền COD (“${st.cot?.amount}”) toàn số 0 — ` +
                    "file có đúng là sao kê tiền COD không?",
            }, { status: 422 });
        }

        const moi: SaoKeNuoc = {
            ...st,
            id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            uploaded_at: new Date().toISOString(),
            ngay: ngayKy(tenFile, st.rows, ngaySaoKe),
        };
        let thay: string[] = [];
        await updateStore(tenKhoSaoKe(m.code), khoRong(), (cur) => {
            const r = thayKyCu(cur.statements, moi);
            thay = r.thay;
            return { statements: r.list };
        });
        return NextResponse.json({
            ok: true,
            statement: { id: moi.id, filename: moi.filename, kieu: moi.kieu, so_dong: moi.rows.length, cot: moi.cot },
            thay,
            canh_bao: canhBao,
        });
    } catch (e) {
        console.error("cod-recon/market POST lỗi:", e);
        return NextResponse.json({ error: "Không đọc được file sao kê" }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    const m = nuocCua(req);
    if (!m) return NextResponse.json(SAI_NUOC, { status: 400 });
    const id = req.nextUrl.searchParams.get("statement") || "";
    if (!id) return NextResponse.json({ error: "Thiếu mã kỳ sao kê" }, { status: 400 });
    const after = await updateStore(tenKhoSaoKe(m.code), khoRong(), (cur) => ({
        statements: cur.statements.filter((s) => s.id !== id),
    }));
    return NextResponse.json({ ok: true, remaining: after.statements.length });
}

/** Tên cột thật trong file của từng trường đã nhận — trả về để màn hình in ra cho người soát. */
function tenCot(header: string[], cot: CotSaoKe): SaoKeNuoc["cot"] {
    const out: SaoKeNuoc["cot"] = {};
    for (const [k, i] of Object.entries(cot)) if (i !== undefined) out[k as keyof CotSaoKe] = header[i];
    return out;
}

function khongThayCot(code: string): string {
    return "Không tìm ra cột mã vận đơn (hoặc mã đơn) và cột tiền COD trong file. Cần một dòng tiêu đề có " +
        "kiểu “Tracking / AWB / Mã vận đơn / 转单号” và “COD / COD Amount / Số tiền / COD金额”. " +
        `File ${code} đặt tên cột khác thì gửi Claude để khai thêm (talpha_rules.json → cod_settlement.column_map).`;
}

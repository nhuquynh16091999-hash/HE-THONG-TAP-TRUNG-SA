import { NextRequest, NextResponse } from "next/server";
import { MARKETS_PUBLIC } from "@/lib/talpha/rules";
import { getAccess } from "@/lib/talpha/access";
import { ghiCodDuoc } from "@/lib/talpha/access-rules";
import { ghiViecCod, xoaViecCod, type GhiViecBody } from "@/lib/talpha/cod-actions-store";
import { tenKhoViec } from "@/lib/talpha/cod-statement-market";

export const dynamic = "force-dynamic";

// ═══════════════════════════════════════════════════════════════════
// VIỆC NGƯỜI LÀM TRONG ĐỐI SOÁT COD — NƯỚC NGOÀI ĐÀI (08/10/2026, màn Sing/UAE giống Đài)
//
//   POST   ?market=SG|AE — ghi tiền thật về ngân hàng của một kỳ, hoặc đã hỏi / bỏ qua một khoản
//   DELETE ?market=…&kind=bank|done&key=… — huỷ việc đã ghi (bấm nhầm)
//
// Kho riêng từng nước (cod_actions_sg…), cùng luật ghi với Đài (lib/talpha/cod-actions-store.ts).
// Cửa proxy đã kiểm nước theo ?market= (API_RULES "/api/talpha/cod-recon/market" phủ cả đường này).
// ═══════════════════════════════════════════════════════════════════

const tuChoi = () => NextResponse.json(
    { error: "Việc này thuộc mục Kế toán — chỉ leader của nước và giám đốc được ghi" }, { status: 403 });

function nuocCua(req: NextRequest) {
    const code = String(req.nextUrl.searchParams.get("market") || "").toUpperCase();
    return code !== "TW" && MARKETS_PUBLIC.markets.some((x) => x.code === code) ? code : null;
}

export async function POST(req: NextRequest) {
    const code = nuocCua(req);
    if (!code) return NextResponse.json({ error: "market phải là mã một nước ngoài Đài (SG, AE…)" }, { status: 400 });
    let body: GhiViecBody;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Body không phải JSON" }, { status: 400 });
    }
    const a = await getAccess(req);
    if (!a || !ghiCodDuoc(a, String(body.kind || ""), body.viec)) return tuChoi();
    const r = await ghiViecCod(tenKhoViec(code), body);
    return NextResponse.json(r.json, { status: r.status });
}

export async function DELETE(req: NextRequest) {
    const code = nuocCua(req);
    if (!code) return NextResponse.json({ error: "market phải là mã một nước ngoài Đài (SG, AE…)" }, { status: 400 });
    const a = await getAccess(req);
    if (!a || !ghiCodDuoc(a, "xoa")) return tuChoi();
    const q = req.nextUrl.searchParams;
    const r = await xoaViecCod(tenKhoViec(code), q.get("kind"), String(q.get("key") || "").trim());
    return NextResponse.json(r.json, { status: r.status });
}

import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import { getAccess, chuaDangNhap } from "@/lib/talpha/access";
import { canMarket, seesAllMarkets } from "@/lib/talpha/access-rules";
import { configPathBatBuoc } from "@/lib/talpha/config-path";
import { locTheoNuoc, type SoiDoiThuFile } from "@/lib/talpha/soi-doi-thu";

export const dynamic = "force-dynamic";

// Tab Khách hàng → Soi đối thủ (15/11/2026): kết quả soi nhóm bán khác (bản đầu: Team 5 KIOT
// Taiwan) đọc từ config/soi_doi_thu.json. Mỗi bản soi gắn một thị trường; người chỉ xem một phần
// nước thì chỉ thấy bản soi của nước mình, như mọi route gộp nhiều nước.
function docSoiDoiThu(): SoiDoiThuFile {
    const raw = JSON.parse(fs.readFileSync(configPathBatBuoc("soi_doi_thu.json"), "utf8"));
    return { mo_ta: raw.mo_ta, snapshots: Array.isArray(raw.snapshots) ? raw.snapshots : [] };
}

export async function GET(req: NextRequest) {
    const a = await getAccess(req);
    if (!a) return chuaDangNhap();
    try {
        const f = docSoiDoiThu();
        const xemHet = seesAllMarkets(a);
        const out = xemHet ? f : locTheoNuoc(f, (code) => canMarket(a, code));
        return NextResponse.json({ ...out, seen_all: xemHet });
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
}

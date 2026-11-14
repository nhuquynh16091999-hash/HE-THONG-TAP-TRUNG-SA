import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import { getAccess, chuaDangNhap } from "@/lib/talpha/access";
import { canMarket, seesAllMarkets } from "@/lib/talpha/access-rules";
import { configPathBatBuoc } from "@/lib/talpha/config-path";
import { locTheoNuoc, type TepKhachFile } from "@/lib/talpha/tep-khach";

export const dynamic = "force-dynamic";

// Tab Khách hàng → Tệp khách (14/11/2026): số tham chiếu về người Việt / Phi / Indo ở từng
// thị trường, đọc từ config/tep_khach.json. Không phải số bán hàng, nhưng vẫn cắt theo team
// như mọi route gộp nhiều nước: người chỉ xem một phần nước thì chỉ thấy thị trường của mình.
// `seen_all` = false báo giao diện biết bảng đang thiếu nước (câu tóm tắt 9 tệp không còn đúng).
function docTepKhach(): TepKhachFile {
    const raw = JSON.parse(fs.readFileSync(configPathBatBuoc("tep_khach.json"), "utf8"));
    return { nhom: raw.nhom, snapshots: Array.isArray(raw.snapshots) ? raw.snapshots : [] };
}

export async function GET(req: NextRequest) {
    const a = await getAccess(req);
    if (!a) return chuaDangNhap();
    try {
        const f = docTepKhach();
        const xemHet = seesAllMarkets(a);
        const out = xemHet ? f : locTheoNuoc(f, (code) => canMarket(a, code));
        return NextResponse.json({ ...out, seen_all: xemHet });
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
}

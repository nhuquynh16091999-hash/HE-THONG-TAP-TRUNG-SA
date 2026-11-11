// ═══════════════════════════════════════════════════════════════════
// Bot Zalo còn đăng nhập không + quét QR đăng nhập lại ngay trên dashboard (12/11/2026).
//
// 03/11 Zalo đá phiên web của nick phụ Hoàng Rin, cookie chết hẳn; bot thử lại mỗi 10' suốt
// 9 ngày mà không ai biết — mất đăng nhập thì chính bot không nhắn vào Zalo được. Bot
// (ops/zalo-alerts) ghi zalo_status.json mỗi phút; route này đọc ra cho băng cảnh báo.
// POST = giám đốc bấm "Quét QR": ghi zalo_qr_request.json, bot thấy trong ≤5 giây thì tự làm
// mã ra qr.png; GET ?qr=1 trả ảnh mã đó. Chỉ giám đốc (API_RULES full) — quét mã là đăng
// nhập nick bot.
// ═══════════════════════════════════════════════════════════════════
import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { requireAccess, khongDuQuyen } from "@/lib/talpha/access";
import { REPO_ROOT } from "@/lib/talpha/config-path";

export const dynamic = "force-dynamic";

const DIR = process.env.TALPHA_ZALO_DIR || path.join(REPO_ROOT, "ops", "zalo-alerts");
const STATUS = path.join(DIR, "zalo_status.json");
const REQUEST = path.join(DIR, "zalo_qr_request.json");
const QR = path.join(DIR, "qr.png");

function docJson(f: string): any {
    try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; }
}

export async function GET(req: Request) {
    const { a, res } = await requireAccess(req);
    if (res) return res;
    if (!a.full) return khongDuQuyen("Chỉ giám đốc xem được mục này");
    const url = new URL(req.url);
    if (url.searchParams.get("qr")) {
        try {
            const buf = fs.readFileSync(QR);
            return new NextResponse(new Uint8Array(buf), { headers: { "content-type": "image/png", "cache-control": "no-store" } });
        } catch {
            return NextResponse.json({ error: "Chưa có mã QR" }, { status: 404 });
        }
    }
    const s = docJson(STATUS);
    if (!s) return NextResponse.json({ co_file: false });
    const nhip = Date.parse(s.nhip || s.capNhat || "");
    // Bot ghi nhịp mỗi phút; quá 5' không ghi = bot không chạy (pm2 dừng, máy chủ đứng).
    const botChay = Number.isFinite(nhip) && Date.now() - nhip < 5 * 60 * 1000;
    return NextResponse.json({
        co_file: true,
        bot_chay: botChay,
        ok: !!s.ok,
        nick: s.nick || null,
        vao_luc: s.vaoLuc || null,
        mat_tu: s.ok ? null : (s.matTu || null),
        loi: s.ok ? null : (s.loi || null),
        can_quet: !s.ok && !!s.canQuet,
        qr: s.qr || null,
        nhip: s.nhip || null,
    });
}

export async function POST(req: Request) {
    const { a, res } = await requireAccess(req);
    if (res) return res;
    if (!a.full) return khongDuQuyen("Chỉ giám đốc quét QR bot Zalo được");
    try {
        fs.writeFileSync(REQUEST, JSON.stringify({ at: new Date().toISOString(), by: a.name || a.email || "?" }) + "\n");
    } catch (e: any) {
        return NextResponse.json({ error: `Không ghi được yêu cầu: ${e?.message || e}` }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
}

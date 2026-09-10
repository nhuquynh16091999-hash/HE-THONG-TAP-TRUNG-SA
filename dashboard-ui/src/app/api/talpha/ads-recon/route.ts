import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { RULES } from "@/lib/talpha/rules";
import { readStoreFresh, updateStore } from "@/lib/talpha/store";
import { MAX_UPLOAD_BYTES, tooBigMessage } from "@/lib/talpha/upload-limit";
import {
    reconcile, readAnySheets, detectKind, toCsv, sendAlerts,
} from "@/lib/talpha/ads-recon/recon.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";           // engine đọc .xlsx bằng node:zlib

// ═══════════════════════════════════════════════════════════════════
// ĐỐI SOÁT CHI PHÍ QUẢNG CÁO
//
//   POST                 — nhận từ 2 file trở lên (chi phí TKQC + sao kê thẻ,
//                          mỗi phía bao nhiêu file cũng được), chạy đối soát,
//                          lưu kỳ, trả kết quả ngay
//   POST ?action=notify  — bắn cảnh báo của một kỳ sang chat
//   GET                  — danh sách kỳ; ?ky= một kỳ; ?ky=&csv=1 xuất CSV
//   DELETE ?ky=          — xoá một kỳ
//
// Đối soát COD là tiền VỀ (3PL trả mình), màn này là tiền RA (mình trả
// Facebook). Cùng một câu hỏi theo hai chiều: số có khớp không.
//
// Toàn bộ nghiệp vụ nằm ở lib/talpha/ads-recon/ — dùng chung với bản dòng lệnh
// ở thư mục Doi-Soat-Chi-Phi-QC. Route này chỉ lo nhận file, lưu kho, trả JSON.
// ═══════════════════════════════════════════════════════════════════

const STORE = "ads_recon";
const GIU_TOI_DA = 52;                     // một năm; kỳ cũ hơn tự rụng khỏi kho
const TOI_DA_FILE = 12;                    // đủ cho nhiều thẻ + nhiều TKQC trong một kỳ

type Period = { ky: string; chay_luc: string; summary?: Record<string, unknown> };
type Store = { periods: Period[] };
const EMPTY: Store = { periods: [] };

/** Khối luật ads_settlement trong talpha_rules.json. */
function cfg() {
    const c = (RULES as unknown as { ads_settlement?: Record<string, unknown> }).ads_settlement;
    if (!c) throw new Error('Thiếu khối "ads_settlement" trong config/talpha_rules.json');
    return c;
}

/** Roster TKQC — thiếu thì engine tự bỏ qua kiểm tra TKQC lạ, không chết. */
function roster(c: ReturnType<typeof cfg>) {
    try {
        const rel = (c.ad_accounts as { roster_file?: string } | undefined)?.roster_file;
        if (!rel) return null;
        const p = path.join(process.cwd(), "..", rel);
        return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf-8")) : null;
    } catch {
        return null;
    }
}

const sortKy = (a: Period, b: Period) => (a.ky < b.ky ? 1 : a.ky > b.ky ? -1 : 0);   // mới → cũ

// ─────────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
    try {
        const ky = req.nextUrl.searchParams.get("ky");
        const store = await readStoreFresh<Store>(STORE, EMPTY);

        if (!ky) {
            // Danh sách gọn cho ô chọn kỳ — không kéo cả nghìn dòng chi tiết về
            const periods = [...store.periods].sort(sortKy).map((p) => ({
                ky: p.ky, chay_luc: p.chay_luc, summary: p.summary,
                files: (p as { files?: unknown }).files,
            }));
            return NextResponse.json({ periods });
        }

        const found = store.periods.find((p) => p.ky === ky);
        if (!found) return NextResponse.json({ error: `Chưa có kỳ ${ky}` }, { status: 404 });

        if (req.nextUrl.searchParams.get("csv") === "1") {
            return new NextResponse(toCsv(found), {
                headers: {
                    "content-type": "text/csv; charset=utf-8",
                    "content-disposition": `attachment; filename="doi-soat-ads-${ky}.csv"`,
                },
            });
        }
        return NextResponse.json(found);
    } catch (e) {
        console.error("ads-recon GET:", e);
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}

// ─────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
    try {
        const c = cfg();

        // ── Bắn cảnh báo của một kỳ đã có ────────────────────────────────
        if (req.nextUrl.searchParams.get("action") === "notify") {
            const ky = req.nextUrl.searchParams.get("ky") || "";
            const store = await readStoreFresh<Store>(STORE, EMPTY);
            const found = store.periods.find((p) => p.ky === ky);
            if (!found) return NextResponse.json({ error: `Chưa có kỳ ${ky}` }, { status: 404 });
            const out = await sendAlerts(found, c, { force: true });
            return NextResponse.json(out);
        }

        // ── Nhận 2 file rồi đối soát ─────────────────────────────────────
        const form = await req.formData();
        const files = form.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
        if (files.length < 2) {
            return NextResponse.json({
                error: "Cần ít nhất 2 file: chi phí thanh toán từ TKQC Facebook và sao kê thẻ ngân hàng.",
            }, { status: 400 });
        }
        if (files.length > TOI_DA_FILE) {
            return NextResponse.json({
                error: `Nhiều nhất ${TOI_DA_FILE} file một lượt — quá số đó thì nhiều khả năng đang gộp nhầm nhiều kỳ vào một.`,
            }, { status: 400 });
        }
        for (const f of files) {
            if (f.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: tooBigMessage() }, { status: 413 });
        }

        const doc = [];
        for (const f of files) {
            const buf = Buffer.from(await f.arrayBuffer());
            try {
                const sheets = await readAnySheets(f.name, buf);
                doc.push({ sheets, kind: detectKind(sheets, c), name: f.name });
            } catch (e) {
                return NextResponse.json({
                    error: `Không mở được "${f.name}": ${(e as Error).message}`,
                }, { status: 422 });
            }
        }

        const truoc = await readStoreFresh<Store>(STORE, EMPTY);
        let result;
        try {
            result = reconcile(doc, c, { roster: roster(c), history: truoc.periods });
        } catch (e) {
            // Lỗi ở đây là lỗi ĐỌC HIỂU file (thiếu cột, không phân biệt được
            // nguồn) — nói thẳng thiếu gì để người dùng sửa file, đừng nuốt.
            return NextResponse.json({ error: (e as Error).message }, { status: 422 });
        }

        await updateStore<Store>(STORE, EMPTY, (cur) => {
            const rest = (cur.periods || []).filter((p) => p.ky !== result.ky);   // chạy lại thì đè kỳ cũ
            return { periods: [...rest, result].sort(sortKy).slice(0, GIU_TOI_DA) };
        });

        return NextResponse.json(result);
    } catch (e) {
        console.error("ads-recon POST:", e);
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}

// ─────────────────────────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
    try {
        const ky = req.nextUrl.searchParams.get("ky");
        if (!ky) return NextResponse.json({ error: "Thiếu tham số ky" }, { status: 400 });
        const next = await updateStore<Store>(STORE, EMPTY, (cur) => ({
            periods: (cur.periods || []).filter((p) => p.ky !== ky),
        }));
        return NextResponse.json({ ok: true, con_lai: next.periods.length });
    } catch (e) {
        console.error("ads-recon DELETE:", e);
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}

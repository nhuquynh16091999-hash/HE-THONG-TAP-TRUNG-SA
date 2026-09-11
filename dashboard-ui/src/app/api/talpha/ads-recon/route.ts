import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { RULES } from "@/lib/talpha/rules";
import { REPO_ROOT } from "@/lib/talpha/config-path";
import { readStoreFresh, updateStore } from "@/lib/talpha/store";
import { MAX_UPLOAD_BYTES, tooBigMessage } from "@/lib/talpha/upload-limit";
import {
    ingestDocs, reconcileRows, readAnySheets, detectKind, toCsv, sendAlerts,
    napVaoKho, boNguon, tomTatNguon,
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
const KHO = "ads_recon_kho";        // kho dòng giao dịch tích luỹ
const GIU_TOI_DA = 52;                     // một năm; kỳ cũ hơn tự rụng khỏi kho
const TOI_DA_FILE = 12;                    // đủ cho nhiều thẻ + nhiều TKQC trong một kỳ

type Period = { ky: string; chay_luc: string; summary?: Record<string, unknown> } & Record<string, unknown>;
type Store = { periods: Period[] };
const EMPTY: Store = { periods: [] };

/** Kho dòng giao dịch — cất lại để lần sau bổ sung file là đối soát tiếp được. */
type Dong = Record<string, unknown> & { _key: string; file?: string; date?: string; amount?: number };
type Kho = { fb: Dong[]; bank: Dong[] };
const KHO_RONG: Kho = { fb: [], bank: [] };

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
        const p = path.join(REPO_ROOT, rel);
        return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf-8")) : null;
    } catch {
        return null;
    }
}

/** act_xxx → tên người đọc được, lấy từ roster. */
function tenTkqc(rosterJson: unknown) {
    const ra: Record<string, string> = {};
    const projects = (rosterJson as { projects?: Record<string, { accounts?: { id?: string; name?: string }[] }> })?.projects || {};
    for (const p of Object.values(projects)) {
        for (const a of p.accounts || []) if (a.id) ra[String(a.id).replace(/^act_/i, "")] = a.name || a.id;
    }
    return ra;
}

const sortKy = (a: Period, b: Period) => (a.ky < b.ky ? 1 : a.ky > b.ky ? -1 : 0);   // mới → cũ

// ─────────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
    try {
        const ky = req.nextUrl.searchParams.get("ky");
        const store = await readStoreFresh<Store>(STORE, EMPTY);

        if (req.nextUrl.searchParams.get("kho") === "1") {
            const kho = await readStoreFresh<Kho>(KHO, KHO_RONG);
            return NextResponse.json({
                kho: { fb: kho.fb.length, bank: kho.bank.length },
                nguon: [...tomTatNguon(kho.fb, "fb"), ...tomTatNguon(kho.bank, "bank")],
                tkqc_ten: tenTkqc(roster(cfg())),
            });
        }

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
        // MỘT file cũng nhận: dữ liệu được cất vào kho, bổ sung phía kia lúc nào
        // cũng đối soát tiếp được. Bắt phải gom đủ mọi file rồi tải một lượt là
        // đặt điều kiện sai với đời thật — file về rải rác chứ không cùng lúc.
        if (!files.length) {
            return NextResponse.json({ error: "Chưa chọn file nào." }, { status: 400 });
        }
        if (files.length > TOI_DA_FILE) {
            return NextResponse.json({
                error: `Nhiều nhất ${TOI_DA_FILE} file một lượt — quá số đó thì nhiều khả năng đang gộp nhầm nhiều kỳ vào một.`,
            }, { status: 400 });
        }
        for (const f of files) {
            if (f.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: tooBigMessage() }, { status: 413 });
        }

        // Mật khẩu chỉ dùng cho đúng lượt đọc này — không ghi vào kho, không
        // vào log, không nằm trong kết quả trả về.
        const matKhau = String(form.get("matkhau") || "").trim();
        // Mặc định CỘNG DỒN vào kho. Muốn làm lại từ đầu thì gửi lam_moi=1.
        const lamMoi = String(form.get("lam_moi") || "") === "1";

        const doc = [];
        for (const f of files) {
            const buf = Buffer.from(await f.arrayBuffer());
            try {
                const sheets = await readAnySheets(f.name, buf, matKhau ? { password: matKhau } : {});
                doc.push({ sheets, kind: detectKind(sheets, c), name: f.name });
            } catch (e) {
                const err = e as Error & { canMatKhau?: boolean; matKhauSai?: boolean };
                return NextResponse.json({
                    error: `Không mở được "${f.name}": ${err.message}`,
                    can_mat_khau: err.canMatKhau === true,
                    mat_khau_sai: err.matKhauSai === true,
                    file: f.name,
                }, { status: 422 });
            }
        }

        // ── 1. Đọc file thành hai phía (KHÔNG đối soát vội) ──────────────
        let doc2;
        try {
            doc2 = ingestDocs(doc, c, { chapNhanMotPhia: true });
        } catch (e) {
            // Lỗi ĐỌC HIỂU file (thiếu cột, không nhận ra nguồn) — nói thẳng
            // thiếu gì để người dùng sửa file, đừng nuốt.
            return NextResponse.json({ error: (e as Error).message }, { status: 422 });
        }

        // ── 2. Nạp vào kho, bỏ dòng đã có ────────────────────────────────
        const nap = { fb: { them: 0, trung: 0 }, bank: { them: 0, trung: 0 } };
        const khoMoi = await updateStore<Kho>(KHO, KHO_RONG, (cur) => {
            const goc = lamMoi ? KHO_RONG : cur;
            const a = napVaoKho(goc.fb, "fb", doc2.fb.rows);
            const b = napVaoKho(goc.bank, "bank", doc2.bank.rows);
            nap.fb = { them: a.them.length, trung: a.trung.length };
            nap.bank = { them: b.them.length, trung: b.trung.length };
            return { fb: a.kho, bank: b.kho };
        });

        // ── 3. Đối soát trên TOÀN BỘ kho ─────────────────────────────────
        const nguon = [...tomTatNguon(khoMoi.fb, "fb"), ...tomTatNguon(khoMoi.bank, "bank")];
        if (!khoMoi.fb.length || !khoMoi.bank.length) {
            // Mới có một phía thì chưa đối soát được, nhưng dữ liệu ĐÃ CẤT rồi —
            // bổ sung phía kia lúc nào cũng chạy tiếp được.
            return NextResponse.json({
                chua_du: true, nap, nguon,
                kho: { fb: khoMoi.fb.length, bank: khoMoi.bank.length },
                thieu: !khoMoi.fb.length ? "chi phí TKQC" : "sao kê thẻ",
                tkqc_ten: tenTkqc(roster(c)),
            });
        }

        const truoc = await readStoreFresh<Store>(STORE, EMPTY);
        const chay = reconcileRows(
            { ...doc2.fb, rows: khoMoi.fb },
            { ...doc2.bank, rows: khoMoi.bank },
            c, { roster: roster(c), history: truoc.periods });

        const result: Period = {
            ...chay, nap, nguon,
            kho: { fb: khoMoi.fb.length, bank: khoMoi.bank.length },
            tkqc_ten: tenTkqc(roster(c)),
        };

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
        // Bỏ một file khỏi kho — tải nhầm thì rút ra, không phải xoá sạch làm lại.
        const nguon = req.nextUrl.searchParams.get("nguon");
        if (nguon) {
            const kho = await updateStore<Kho>(KHO, KHO_RONG, (cur) => ({
                fb: boNguon(cur.fb, nguon), bank: boNguon(cur.bank, nguon),
            }));
            return NextResponse.json({ ok: true, kho: { fb: kho.fb.length, bank: kho.bank.length } });
        }

        const ky = req.nextUrl.searchParams.get("ky");
        if (!ky) return NextResponse.json({ error: "Thiếu tham số ky hoặc nguon" }, { status: 400 });
        const next = await updateStore<Store>(STORE, EMPTY, (cur) => ({
            periods: (cur.periods || []).filter((p) => p.ky !== ky),
        }));
        return NextResponse.json({ ok: true, con_lai: next.periods.length });
    } catch (e) {
        console.error("ads-recon DELETE:", e);
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}

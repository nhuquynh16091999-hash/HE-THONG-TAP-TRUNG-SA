import { NextRequest, NextResponse } from "next/server";
import { readStoreFresh, updateStore } from "@/lib/talpha/store";
import {
    bankKey, emptyActions, type CodActions, type DoneKind,
} from "@/lib/talpha/cod-actions";

export const dynamic = "force-dynamic";

// ═══════════════════════════════════════════════════════════════════
// VIỆC NGƯỜI LÀM TRONG ĐỐI SOÁT
//
//   GET    — đọc lại toàn bộ (màn hình tự dựng từ đây + order-ledger)
//   POST   — ghi một việc: tiền về tài khoản, đã đòi, đã hỏi, bỏ qua
//   DELETE — huỷ một việc đã ghi (bấm nhầm)
//
// Route này CHỈ ghi thứ do người quyết. Mọi con số máy tự đọc ra từ file sao kê
// vẫn nằm ở cod-recon và order-ledger — không trộn hai loại vào một kho, vì
// nạp lại file thì số máy đọc phải được tính lại còn việc người làm thì không.
// ═══════════════════════════════════════════════════════════════════

const STORE = "cod_actions";

const today = () => new Date().toISOString().slice(0, 10);
const isDate = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function GET() {
    const a = await readStoreFresh<CodActions>(STORE, emptyActions());
    return NextResponse.json({ bank: a.bank || {}, done: a.done || {} });
}

type Body = {
    kind: "bank" | "done";
    // kind = bank
    filename?: string;
    thuc_nhan_vnd?: number;
    ngay_ve?: string;
    // kind = done
    key?: string;
    viec?: DoneKind;
    // chung
    ghi_chu?: string;
};

export async function POST(req: NextRequest) {
    let body: Body;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Body không phải JSON" }, { status: 400 });
    }

    // ── Ghi tiền thật về tài khoản ────────────────────────────────────
    if (body.kind === "bank") {
        const f = String(body.filename || "").trim();
        if (!f) return NextResponse.json({ error: "Thiếu tên file kỳ sao kê" }, { status: 400 });

        const so = Number(body.thuc_nhan_vnd);
        if (!Number.isFinite(so) || so < 0) {
            return NextResponse.json({ error: "Số tiền không hợp lệ" }, { status: 400 });
        }
        // Ngày về phải là ngày thật, không nhận ngày tương lai: gõ nhầm năm là
        // kỳ đó biến mất khỏi mọi phép so theo kỳ mà không ai thấy.
        const ngay = isDate(body.ngay_ve) ? (body.ngay_ve as string) : today();
        if (ngay > today()) {
            return NextResponse.json({ error: "Ngày tiền về không thể ở tương lai" }, { status: 400 });
        }

        const after = await updateStore<CodActions>(STORE, emptyActions(), (cur) => ({
            bank: {
                ...(cur.bank || {}),
                [bankKey(f)]: {
                    thuc_nhan_vnd: Math.round(so),
                    ngay_ve: ngay,
                    ghi_chu: String(body.ghi_chu || "").slice(0, 300) || undefined,
                    luc: new Date().toISOString(),
                },
            },
            done: cur.done || {},
        }));
        return NextResponse.json({ ok: true, bank: after.bank[bankKey(f)] });
    }

    // ── Ghi một việc đã xử ────────────────────────────────────────────
    if (body.kind === "done") {
        const key = String(body.key || "").trim();
        const viec = body.viec;
        if (!key) return NextResponse.json({ error: "Thiếu khoá việc" }, { status: 400 });
        if (viec !== "da_doi" && viec !== "da_hoi" && viec !== "bo_qua") {
            return NextResponse.json({ error: "Loại việc không hợp lệ" }, { status: 400 });
        }
        const ghiChu = String(body.ghi_chu || "").trim().slice(0, 300);
        // Bỏ qua một khoản lệch là quyết định mất tiền — phải nói vì sao, để
        // sau này còn tra được ai bỏ qua cái gì và với lý do nào.
        if (viec === "bo_qua" && !ghiChu) {
            return NextResponse.json({ error: "Bỏ qua thì phải ghi lý do" }, { status: 400 });
        }

        const after = await updateStore<CodActions>(STORE, emptyActions(), (cur) => {
            const truoc = (cur.done || {})[key];
            // Đòi lần hai thì ĐẾM TIẾP, không ghi đè: "đòi 3 lần vẫn im" là
            // chuyện khác hẳn "vừa đòi hôm nay".
            const lan = truoc && truoc.viec === viec ? truoc.lan + 1 : 1;
            return {
                bank: cur.bank || {},
                done: {
                    ...(cur.done || {}),
                    [key]: { viec, ngay: today(), lan, ghi_chu: ghiChu || undefined },
                },
            };
        });
        return NextResponse.json({ ok: true, done: after.done[key] });
    }

    return NextResponse.json({ error: "kind phải là bank hoặc done" }, { status: 400 });
}

export async function DELETE(req: NextRequest) {
    const q = req.nextUrl.searchParams;
    const kind = q.get("kind");
    const key = String(q.get("key") || "").trim();
    if (!key) return NextResponse.json({ error: "Thiếu khoá" }, { status: 400 });

    const after = await updateStore<CodActions>(STORE, emptyActions(), (cur) => {
        const bank = { ...(cur.bank || {}) };
        const done = { ...(cur.done || {}) };
        if (kind === "bank") delete bank[bankKey(key)];
        else delete done[key];
        return { bank, done };
    });
    return NextResponse.json({
        ok: true,
        remaining: Object.keys(after.bank).length + Object.keys(after.done).length,
    });
}

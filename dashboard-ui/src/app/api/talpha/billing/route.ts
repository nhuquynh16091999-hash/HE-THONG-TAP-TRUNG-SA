import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

// ═══ Billing monitor TKQC — chống "đang chạy thì thẻ hết tiền" ═══
// Đọc Meta API: trạng thái, số ĐANG NỢ chờ quét (balance), thẻ gắn (đuôi số),
// spend hôm nay/hôm qua. Ngưỡng quét Meta KHÔNG còn expose qua API → khai tay
// `bill_threshold_vnd` từng account trong ops/talpha_reports/ad_accounts.json.
// Consumer: bot WhatsApp (digest 8h + cảnh báo 3h) + có thể thêm tab admin sau.

const GRAPH = "https://graph.facebook.com/v21.0";
const STATUS: Record<number, string> = {
    1: "ACTIVE", 2: "DISABLED", 3: "UNSETTLED", 7: "PENDING_RISK_REVIEW",
    8: "PENDING_SETTLEMENT", 9: "IN_GRACE_PERIOD", 100: "PENDING_CLOSURE", 101: "CLOSED",
};

function loadAccounts(): { id: string; name: string; bill_threshold_vnd?: number }[] {
    // process.cwd() gọi mỗi request, không đóng băng module scope (sự cố 31/07:
    // process pm2 sống qua đổi tên thư mục → path cũ → route trả rỗng)
    const candidates = [
        path.join(process.cwd(), "..", "ops", "talpha_reports", "ad_accounts.json"),
        path.join(process.cwd(), "..", "config", "ad_accounts.json"),
    ];
    const p = candidates.find((x) => fs.existsSync(x));
    if (!p) return [];
    const cfg = JSON.parse(fs.readFileSync(p, "utf-8"));
    // billing_hidden: TKQC không chạy (0 spend tháng hiện hành) — ẩn khỏi billing/cảnh báo
    // nhưng GIỮ status active để sync số liệu lịch sử không đổi. Duyệt 30/07.
    return (cfg.projects?.talpha?.accounts || []).filter(
        (a: any) => a.status === "active" && !a.billing_hidden);
}

// retry 2 lần + không bao giờ throw (1 call hỏng không được đánh sập cả route)
async function fetchJson(url: string): Promise<any> {
    for (let i = 0; i < 3; i++) {
        try {
            const res = await fetch(url, { cache: "no-store" });
            return await res.json();
        } catch {
            if (i < 2) await new Promise((r) => setTimeout(r, 800 * (i + 1)));
        }
    }
    return { error: { message: "fetch failed (3 lần)" } };
}

// chạy theo lô nhỏ để không bắn 50+ request Graph cùng lúc
async function mapChunked<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
    const out: R[] = [];
    for (let i = 0; i < items.length; i += size) {
        out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
    }
    return out;
}

export async function GET() {
    try {
        const token = process.env.TALPHA_META_ACCESS_TOKEN;
        if (!token) return NextResponse.json({ error: "thiếu TALPHA_META_ACCESS_TOKEN" }, { status: 500 });
        const accounts = loadAccounts();

        const rows = await mapChunked(accounts, 4, async (a) => {
            const fields = "name,account_status,disable_reason,balance,currency,funding_source_details";
            const [info, spendToday, spendYda, spend3d] = await Promise.all([
                fetchJson(`${GRAPH}/${a.id}?fields=${fields}&access_token=${token}`),
                fetchJson(`${GRAPH}/${a.id}/insights?level=account&date_preset=today&fields=spend&access_token=${token}`),
                fetchJson(`${GRAPH}/${a.id}/insights?level=account&date_preset=yesterday&fields=spend&access_token=${token}`),
                fetchJson(`${GRAPH}/${a.id}/insights?level=account&date_preset=last_3d&fields=spend&access_token=${token}`),
            ]);
            const fsd = info.funding_source_details || {};
            const card = fsd.display_string || (fsd.coupon ? "coupon" : null);
            const balance = Number(info.balance || 0);
            const threshold = Number(a.bill_threshold_vnd || 0) || null;
            return {
                id: a.id,
                name: info.name || a.name,
                status: STATUS[info.account_status] || String(info.account_status),
                disable_reason: info.disable_reason ?? null,
                currency: info.currency,
                balance_vnd: balance,                       // đang nợ, sẽ bị quét vào thẻ
                card,                                        // "Mastercard *1729"
                threshold_vnd: threshold,
                threshold_pct: threshold ? Math.round((balance / threshold) * 100) : null,
                spend_today_vnd: Number(spendToday?.data?.[0]?.spend || 0),
                spend_yesterday_vnd: Number(spendYda?.data?.[0]?.spend || 0),
                spend_3d_avg_vnd: Math.round(Number(spend3d?.data?.[0]?.spend || 0) / 3),
                error: info.error?.message || null,
            };
        });

        // Cảnh báo máy tính sẵn cho bot
        const alerts: { level: string; account: string; msg: string }[] = [];
        for (const r of rows) {
            const running = r.spend_today_vnd > 100000 || r.spend_yesterday_vnd > 100000;
            if (r.status === "UNSETTLED")
                alerts.push({ level: "critical", account: r.name, msg: `THANH TOÁN THẤT BẠI — nợ ${r.balance_vnd.toLocaleString("vi-VN")}đ trên thẻ ${r.card || "?"}. Nạp tiền thẻ rồi bấm thanh toán lại trong Trình quản lý TKQC, không ads sẽ dừng.` });
            else if (r.status !== "ACTIVE" && running)
                alerts.push({ level: "critical", account: r.name, msg: `TKQC đang chạy bị ${r.status} — kiểm tra ngay (thẻ ${r.card || "?"}).` });
            else if (r.threshold_vnd && r.balance_vnd >= 0.8 * r.threshold_vnd) {
                const perHour = r.spend_today_vnd > 0 ? r.spend_today_vnd / Math.max(new Date().getUTCHours() + 7, 1) : r.spend_yesterday_vnd / 24;
                const hoursLeft = perHour > 0 ? Math.round((r.threshold_vnd - r.balance_vnd) / perHour) : null;
                alerts.push({ level: "warning", account: r.name, msg: `Sắp quét tiền: nợ ${r.balance_vnd.toLocaleString("vi-VN")}đ / ngưỡng ${r.threshold_vnd.toLocaleString("vi-VN")}đ (${r.threshold_pct}%)${hoursLeft ? ` — ~${hoursLeft}h nữa` : ""}. Đảm bảo thẻ ${r.card || "?"} đủ tiền.` });
            }
        }
        return NextResponse.json({ ts: new Date().toISOString(), rows, alerts });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

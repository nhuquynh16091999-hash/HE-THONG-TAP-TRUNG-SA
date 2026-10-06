import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { getAccess, publicMode } from "@/lib/talpha/access";
import { canTab, checkApi } from "@/lib/talpha/access-rules";
import { trackMarket } from "@/lib/talpha/tracking";

/**
 * Cửa vào DUY NHẤT của dashboard — mọi trang và mọi API đi qua đây.
 *
 * 05/10/2026 (phân quyền theo team, Sỹ Anh chốt): đổi từ middleware.ts (chạy Edge, không
 * đọc được file) sang proxy.ts của Next 16 (chạy Node) để đọc được kho người dùng và
 * luật quyền ngay tại cửa. Trước đó `/api/*` được thả qua tầng này với lời hứa "từng
 * route tự kiểm" — thực tế gần như không route nào kiểm, ai biết địa chỉ là gọi được.
 *
 *   • Trang `/talpha`, `/admin`  → phải đăng nhập; `/admin` chỉ giám đốc.
 *   • `/api/auth/*`              → mở (đăng nhập).
 *   • `/api/*` còn lại           → phải đăng nhập HOẶC mang chìa nội bộ (bot Zalo, việc
 *                                  nền — lib/talpha/internal-token.ts), rồi qua luật
 *                                  checkApi (lib/talpha/access-rules.ts): tab nào được
 *                                  gọi route nào, route một nước thì nước đó có trong team
 *                                  không. Route gộp nhiều nước tự lọc bên trong.
 *
 * DASHBOARD_PUBLIC=true → BỎ HẲN lớp đăng nhập, ai có địa chỉ cũng vào thẳng như giám
 * đốc. Sỹ Anh chọn vậy 08/09/2026; từ khi chia team (05/10/2026) phải TẮT cờ này thì
 * phân quyền mới có tác dụng.
 */

const PROTECTED_PREFIXES = ["/talpha", "/admin"];

/**
 * Địa chỉ HTTPS công khai (06/10/2026, nginx 443 — ops/deploy/nginx-talpha-https.conf). Ai mở
 * địa chỉ cũ http://<host>:3000 từ ngoài thì chuyển sang https://<host>: mật khẩu thôi đi
 * dạng chữ trơn, và chỉ bản HTTPS mới cài được thành app. Nhận ra lượt "từ ngoài" bằng tên
 * host trong header Host — bot, việc nền gọi http://localhost:3000 / 127.0.0.1 nên không bị
 * chuyển; lượt đi qua nginx đã mang X-Forwarded-Proto. Bỏ trống biến = không chuyển (máy Mac).
 */
const HTTPS_HOST = (process.env.DASHBOARD_HTTPS_HOST || "").trim();

const json = (status: number, error: string) => NextResponse.json({ error }, { status });

export default auth(async (req) => {
    const { pathname, searchParams } = req.nextUrl;

    // Next tự điền X-Forwarded-Proto: http cho lượt gọi thẳng — nên so "không phải https",
    // không phải "không có header". nginx đặt đúng "https".
    if (HTTPS_HOST && !(req.headers.get("x-forwarded-proto") || "").startsWith("https")) {
        const host = (req.headers.get("host") || "").split(":")[0];
        if (host === HTTPS_HOST) {
            // 307 (tạm thời), không 308: trình duyệt nhớ 308 mãi — HTTPS có sự cố thì người dùng
            // kẹt ở địa chỉ hỏng mà không quay về :3000 được.
            return NextResponse.redirect(`https://${HTTPS_HOST}${pathname}${req.nextUrl.search}`, 307);
        }
    }

    if (pathname.startsWith("/api/")) {
        if (pathname.startsWith("/api/auth/")) return NextResponse.next();
        const a = await getAccess(req, req.auth);
        if (!a) return json(401, "Chưa đăng nhập");
        const ok = checkApi(a, pathname, searchParams, (m) => trackMarket(m).code);
        return ok.ok ? NextResponse.next() : json(403, ok.error);
    }

    if (!PROTECTED_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();
    if (publicMode() && !req.auth) return NextResponse.next();

    const a = await getAccess(req, req.auth);
    if (!a) {
        const loginUrl = new URL("/login", req.url);
        loginUrl.searchParams.set("callbackUrl", pathname);
        return NextResponse.redirect(loginUrl);
    }
    const veTrangChinh = () => NextResponse.redirect(new URL("/talpha", req.url));
    if (pathname.startsWith("/admin") && !a.full) return veTrangChinh();
    if (pathname.startsWith("/talpha/ads-command-center") && !canTab(a, "ads-command")) return veTrangChinh();
    return NextResponse.next();
});

export const config = {
    matcher: [
        "/((?!_next/static|_next/image|favicon.ico|.*\\.svg$|.*\\.png$|.*\\.jpg$).*)",
    ],
};

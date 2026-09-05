import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

/**
 * Per-deployment middleware — controlled by NEXT_PUBLIC_DEPLOYMENT_MODE.
 *
 * Single-project TALPHA: owner route = `/talpha`. Mọi mode đều fallback về
 * `/talpha` (xem OWNER_MAP). Các dự án cũ (`/ai-brain`, `/ads-command-center`
 * top-level, `/agent-control`) đã xoá khỏi build ở hạng mục A6 — không còn
 * prefix nào để chặn, route không tồn tại rơi thẳng xuống 404 của Next.
 *
 * Policy chung:
 *   - Routes thuộc deployment hiện tại + `/admin/*` → require login
 *   - `/login`, `/` redirects                       → public (handled in page.tsx)
 *   - `/api/*`                                      → public at middleware layer
 *                                                    (per-route auth is enforced inside each route)
 */

const DEPLOYMENT_MODE = (process.env.NEXT_PUBLIC_DEPLOYMENT_MODE || "talpha").toLowerCase();

// Owner prefix của deployment hiện tại (route home + protected scope).
// Single-project TALPHA: chỉ còn talpha; fallback /talpha cho mọi mode.
const OWNER_MAP: Record<string, string> = {
    talpha: "/talpha",
};
const OWNER_PREFIX = OWNER_MAP[DEPLOYMENT_MODE] || "/talpha";

const PROTECTED_PREFIXES = [OWNER_PREFIX, "/admin"];

export default auth((req) => {
    const { pathname } = req.nextUrl;

    // Protected routes need auth
    const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
    if (!isProtected) return NextResponse.next();

    if (!req.auth) {
        const loginUrl = new URL("/login", req.url);
        loginUrl.searchParams.set("callbackUrl", pathname);
        return NextResponse.redirect(loginUrl);
    }

    return NextResponse.next();
});

export const config = {
    matcher: [
        "/((?!api|_next/static|_next/image|favicon.ico|.*\\.svg$|.*\\.png$|.*\\.jpg$).*)",
    ],
};

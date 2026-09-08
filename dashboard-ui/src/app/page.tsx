import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

/**
 * Root path redirects to the deployment's owner project (NEXT_PUBLIC_DEPLOYMENT_MODE).
 * Middleware handles the auth check — if unauthenticated the user is
 * bounced to /login, then back to the owner route after sign-in.
 */
const OWNER_MAP: Record<string, string> = { talpha: "/talpha" };
const OWNER_PREFIX =
    OWNER_MAP[(process.env.NEXT_PUBLIC_DEPLOYMENT_MODE || "talpha").toLowerCase()] || "/talpha";

export default async function Home() {
    // DASHBOARD_PUBLIC=true thì vào thẳng, không hỏi đăng nhập. Phải kiểm ở đây
    // NỮA chứ không chỉ ở middleware: trang này tự gọi auth() rồi tự chuyển
    // hướng, nên middleware có mở cửa mà đây vẫn đá về /login.
    if (String(process.env.DASHBOARD_PUBLIC || "").toLowerCase() === "true") {
        redirect(OWNER_PREFIX);
    }
    const session = await auth();
    if (!session) {
        redirect(`/login?callbackUrl=${OWNER_PREFIX}`);
    }
    redirect(OWNER_PREFIX);
}

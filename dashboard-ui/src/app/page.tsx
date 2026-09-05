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
    const session = await auth();
    if (!session) {
        redirect(`/login?callbackUrl=${OWNER_PREFIX}`);
    }
    redirect(OWNER_PREFIX);
}

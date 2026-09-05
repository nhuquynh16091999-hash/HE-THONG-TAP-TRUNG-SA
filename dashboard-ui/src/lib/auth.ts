import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

// ─── Project route to project ID mapping ───
export const ROUTE_TO_PROJECT: Record<string, string> = {
    talpha: "TALPHA",
};

// ─── Check if user can access a project ───
export function canAccessProject(
    userProjects: string[],
    projectId: string
): boolean {
    return userProjects.includes("*") || userProjects.includes(projectId);
}

// ─── NextAuth Config ───
// NOTE: authorize() must NOT import Node.js modules (fs, path, etc.)
// because this config is also used by the Edge Runtime middleware.
// User validation is done via internal API call instead.
export const { handlers, signIn, signOut, auth } = NextAuth({
    providers: [
        Credentials({
            name: "credentials",
            credentials: {
                email: { label: "Email", type: "email" },
                password: { label: "Password", type: "password" },
            },
            async authorize(credentials) {
                if (!credentials?.email || !credentials?.password) {
                    return null;
                }

                try {
                    // Call internal API to validate credentials (runs in Node.js)
                    const baseUrl = process.env.AUTH_URL || process.env.NEXTAUTH_URL || "http://localhost:3000";
                    const res = await fetch(`${baseUrl}/api/auth/validate`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            email: credentials.email,
                            password: credentials.password,
                        }),
                    });

                    if (!res.ok) {
                        // Phân biệt pending vs sai credentials
                        if (res.status === 403) {
                            const body = await res.json().catch(() => null);
                            throw new Error(body?.error || "Tài khoản đang chờ duyệt");
                        }
                        return null;
                    }

                    const user = await res.json();
                    return user;
                } catch (err) {
                    console.error("Auth validation error:", err);
                    return null;
                }
            },
        }),
    ],
    callbacks: {
        async jwt({ token, user }) {
            if (user) {
                token.role = (user as any).role;
                token.projects = (user as any).projects;
            }
            return token;
        },
        async session({ session, token }) {
            if (session.user) {
                (session.user as any).role = token.role;
                (session.user as any).projects = token.projects;
                (session.user as any).id = token.sub;
            }
            return session;
        },
    },
    pages: {
        signIn: "/login",
    },
    session: {
        strategy: "jwt",
    },
});

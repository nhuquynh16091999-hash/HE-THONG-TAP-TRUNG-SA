import "next-auth";
import { JWT } from "@auth/core/jwt";

declare module "next-auth" {
    interface User {
        role?: "admin" | "project_lead" | "viewer";
        projects?: string[];
    }

    interface Session {
        user: {
            id?: string;
            name?: string | null;
            email?: string | null;
            image?: string | null;
            role?: "admin" | "project_lead" | "viewer";
            projects?: string[];
        };
    }
}

declare module "@auth/core/jwt" {
    interface JWT {
        role?: "admin" | "project_lead" | "viewer";
        projects?: string[];
    }
}

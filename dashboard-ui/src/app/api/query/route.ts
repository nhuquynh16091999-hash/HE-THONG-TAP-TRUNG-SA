import { NextResponse } from "next/server";
import { bigquery } from "@/lib/bigquery";

// Force dynamic rendering to prevent caching issues with BQ data
export const dynamic = "force-dynamic";

// ═══ SECURITY: API Key Authentication ═══
const API_KEY = process.env.DASHBOARD_API_KEY || "";

// ═══ SECURITY: SQL Whitelist ═══
// Only allow SELECT and WITH (for CTEs) queries — block all DDL/DML
const BLOCKED_KEYWORDS = [
    "INSERT", "UPDATE", "DELETE", "DROP", "CREATE", "ALTER",
    "TRUNCATE", "MERGE", "GRANT", "REVOKE", "EXEC", "EXECUTE",
    "CALL", "BEGIN", "COMMIT", "ROLLBACK",
];

function isQuerySafe(query: string): { safe: boolean; reason?: string } {
    const trimmed = query.trim().toUpperCase();

    // Must start with SELECT or WITH (CTEs)
    if (!trimmed.startsWith("SELECT") && !trimmed.startsWith("WITH")) {
        return { safe: false, reason: "Only SELECT queries are allowed" };
    }

    // Block multiple statements (semicolons)
    if (query.includes(";")) {
        return { safe: false, reason: "Multiple statements not allowed" };
    }

    // Block dangerous keywords anywhere in the query
    for (const keyword of BLOCKED_KEYWORDS) {
        // Use word boundary check to avoid false positives
        // e.g. "SELECTED" should not trigger "SELECT" check on blocked list
        const regex = new RegExp(`\\b${keyword}\\b`, "i");
        if (regex.test(query)) {
            return { safe: false, reason: `Blocked keyword: ${keyword}` };
        }
    }

    return { safe: true };
}

export async function POST(request: Request) {
    try {
        // ═══ AUTH CHECK ═══
        // If API_KEY is configured, require it. If not set, allow all (dev mode).
        if (API_KEY) {
            const providedKey =
                request.headers.get("x-api-key") ||
                request.headers.get("authorization")?.replace("Bearer ", "");

            if (providedKey !== API_KEY) {
                return NextResponse.json(
                    { error: "Unauthorized — invalid or missing API key" },
                    { status: 401 }
                );
            }
        }

        const { query, params } = await request.json();

        if (!query) {
            return NextResponse.json({ error: "Query is required" }, { status: 400 });
        }

        // ═══ SQL SAFETY CHECK ═══
        const safety = isQuerySafe(query);
        if (!safety.safe) {
            console.warn(`🔒 Blocked unsafe query: ${safety.reason} — "${query.substring(0, 100)}..."`);
            return NextResponse.json(
                { error: `Query blocked: ${safety.reason}` },
                { status: 403 }
            );
        }

        // Execute query
        const options = {
            query,
            params,
        };

        const [rows] = await bigquery.query(options);

        // Serialize BigQuery special types (DATE, TIMESTAMP, NUMERIC come as {value: "..."})
        const serializedRows = rows.map((row: Record<string, any>) => {
            const out: Record<string, any> = {};
            for (const [key, val] of Object.entries(row)) {
                if (val !== null && typeof val === "object" && "value" in val && Object.keys(val).length === 1) {
                    out[key] = val.value;
                } else {
                    out[key] = val;
                }
            }
            return out;
        });

        // Return results
        return NextResponse.json({ data: serializedRows });
    } catch (error: any) {
        console.error("API Error:", error);
        return NextResponse.json(
            { error: error.message || "Internal Server Error" },
            { status: 500 }
        );
    }
}

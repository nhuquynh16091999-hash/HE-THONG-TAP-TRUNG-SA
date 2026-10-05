import { NextResponse } from "next/server";
import { bigquery } from "@/lib/bigquery";
import { getAccess } from "@/lib/talpha/access";
import { scopeQuery, seesAllMarkets } from "@/lib/talpha/access-rules";

// Force dynamic rendering to prevent caching issues with BQ data
export const dynamic = "force-dynamic";

const BQ_PROJECT = process.env.NEXT_PUBLIC_BQ_PROJECT || "cty-507710";
const BQ_DATASET = process.env.NEXT_PUBLIC_DATASET || "TALPHA_Dataset";

// Dataset khác trong dự án — `ds.bang` hai phần trỏ thẳng về dự án đang chạy, nên câu của
// người xem một phần nước không được nhắc tới chúng. Hỏi BigQuery 10 phút một lần.
let dsCache: { at: number; ds: string[] } | null = null;
async function cacDataset(): Promise<string[]> {
    if (dsCache && Date.now() - dsCache.at < 600_000) return dsCache.ds;
    try {
        const [ds] = await bigquery.getDatasets();
        dsCache = { at: Date.now(), ds: ds.map((d) => String(d.id || "")).filter(Boolean) };
    } catch (e) {
        console.error("query: không liệt kê được dataset:", (e as Error)?.message || e);
        dsCache = { at: Date.now() - 540_000, ds: dsCache?.ds || [] };   // thử lại sau 1 phút
    }
    return dsCache.ds;
}

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

        // ═══ PHÂN QUYỀN THEO TEAM (05/10/2026) ═══
        // Câu SQL dựng ở trình duyệt. Người chỉ xem một phần nước: mỗi bảng bị thay bằng
        // câu con đã lọc theo nước của họ (lib/talpha/access-rules.ts → scopeQuery).
        const a = await getAccess(request);
        if (!a) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
        let sql: string = query;
        if (!seesAllMarkets(a)) {
            const kq = scopeQuery(query, a, BQ_PROJECT, BQ_DATASET, await cacDataset());
            if (!kq.ok) {
                console.warn(`🔒 query bị chặn (${a.email || a.name}): ${kq.error}`);
                return NextResponse.json({ error: kq.error }, { status: 403 });
            }
            sql = kq.sql;
        }

        // Execute query
        const options = {
            query: sql,
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

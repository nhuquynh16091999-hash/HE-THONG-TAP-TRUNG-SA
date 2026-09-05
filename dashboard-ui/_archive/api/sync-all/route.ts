import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";

const execAsync = promisify(exec);

// Path to project root (Agentic-AI-Levelup)
const PROJECT_ROOT = path.resolve(process.cwd(), "..");
const BQ_KEY = path.join(PROJECT_ROOT, "bigquery_key_t1.json");

interface SyncResult {
    source: string;
    status: "success" | "error" | "skipped";
    message: string;
    rows?: number;
    duration_ms?: number;
}

async function runSync(script: string, args: string = ""): Promise<SyncResult> {
    const start = Date.now();
    const source = script.replace(".py", "").replace("sync_", "");

    try {
        const cmd = `python3 sync/t1/${script} ${args}`.trim();
        const { stdout, stderr } = await execAsync(cmd, {
            cwd: PROJECT_ROOT,
            env: { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: BQ_KEY, PYTHONPATH: PROJECT_ROOT },
            timeout: 120_000, // 2 min timeout
        });

        const output = stdout + stderr;

        // Extract row counts from output
        const doneMatch = output.match(/DONE:\s*(\d+)/);
        const rows = doneMatch ? parseInt(doneMatch[1]) : 0;

        // Check for errors
        const hasError = output.includes("Traceback") || output.includes("Error:");

        return {
            source,
            status: hasError ? "error" : "success",
            message: hasError
                ? output.split("\n").filter(l => l.includes("Error")).pop() || "Unknown error"
                : `Synced ${rows} rows`,
            rows,
            duration_ms: Date.now() - start,
        };
    } catch (err: any) {
        return {
            source,
            status: "error",
            message: err.message?.substring(0, 200) || "Script execution failed",
            duration_ms: Date.now() - start,
        };
    }
}

// POST: Trigger full sync (POS + Ads)
export async function POST(req: NextRequest) {
    const startTime = Date.now();

    try {
        const body = await req.json().catch(() => ({}));
        const sources = body.sources || ["pancake", "ads"]; // which to sync

        const results: SyncResult[] = [];

        // Sync POS Cake orders
        if (sources.includes("pancake")) {
            const r = await runSync("sync_pancake_orders.py");
            results.push(r);
        }

        // Sync Facebook Ads
        if (sources.includes("ads")) {
            const r = await runSync("sync_fb_ads.py", "--days 90");
            results.push(r);
        }

        const allOk = results.every(r => r.status === "success");

        return NextResponse.json({
            status: allOk ? "success" : "partial",
            message: allOk
                ? `All syncs completed (${results.map(r => `${r.source}: ${r.rows}`).join(", ")})`
                : "Some syncs had issues",
            results,
            total_duration_ms: Date.now() - startTime,
            synced_at: new Date().toISOString(),
        });
    } catch (error: any) {
        return NextResponse.json(
            { status: "error", message: error.message },
            { status: 500 }
        );
    }
}

// GET: Check last sync status
export async function GET() {
    // Quick check: query BQ for latest dates to show sync freshness
    try {
        const { BigQuery } = await import("@google-cloud/bigquery");
        const bq = new BigQuery({ keyFilename: BQ_KEY });

        const [ordersResult] = await bq.query({
            query: `SELECT MAX(SUBSTR(inserted_at,1,10)) as latest, COUNT(DISTINCT id) as total 
                    FROM \`levelup-465304.T1_Dataset.sale_order\``,
        });

        const [adsResult] = await bq.query({
            query: `SELECT MAX(SAFE_CAST(date AS STRING)) as latest, COUNT(*) as total 
                    FROM \`levelup-465304.T1_Dataset.fb_ads_data\``,
        });

        const orders = ordersResult?.[0] || {};
        const ads = adsResult?.[0] || {};

        const now = new Date();
        const orderDays = orders.latest
            ? Math.floor((now.getTime() - new Date(orders.latest).getTime()) / 86400000)
            : 999;
        const adsDays = ads.latest
            ? Math.floor((now.getTime() - new Date(ads.latest).getTime()) / 86400000)
            : 999;

        return NextResponse.json({
            orders: { latest: orders.latest, total: orders.total, days_ago: orderDays },
            ads: { latest: ads.latest, total: ads.total, days_ago: adsDays },
            needs_sync: orderDays > 1 || adsDays > 1,
            checked_at: now.toISOString(),
        });
    } catch (error: any) {
        return NextResponse.json(
            { error: error.message, needs_sync: true },
            { status: 500 }
        );
    }
}

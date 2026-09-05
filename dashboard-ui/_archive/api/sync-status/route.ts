import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const STATUS_FILE = "/tmp/t1_sync_status.json";

// GET: Read auto-sync status
export async function GET() {
    try {
        if (!fs.existsSync(STATUS_FILE)) {
            return NextResponse.json({
                running: false,
                message: "Auto-sync not started yet",
                sources: {},
            });
        }

        const raw = fs.readFileSync(STATUS_FILE, "utf-8");
        const status = JSON.parse(raw);

        // Calculate freshness
        const lastSync = status.last_sync ? new Date(status.last_sync) : null;
        const now = new Date();
        const secondsAgo = lastSync ? Math.floor((now.getTime() - lastSync.getTime()) / 1000) : 999;

        return NextResponse.json({
            ...status,
            seconds_ago: secondsAgo,
            is_fresh: secondsAgo < 120, // Fresh if synced within 2 minutes
        });
    } catch (error: any) {
        return NextResponse.json(
            { running: false, error: error.message, sources: {} },
            { status: 500 }
        );
    }
}

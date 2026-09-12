import { NextResponse } from "next/server";
import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const TOTAL_FILES = 56;
// Bản trước còn một nhánh HÀNG ĐỢI BigQuery (bảng export_jobs + export_worker.py),
// chỉ bật khi chạy trên Vercel (biến VERCEL). Máy chủ không có biến đó nên nhánh ấy
// chưa từng chạy, và bảng export_jobs chưa từng tồn tại. Đã xoá 13/09/2026.

// ─────────── Chạy thẳng format_all.py ───────────
const REPO = path.join(process.cwd(), "..");
const PY = path.join(REPO, ".venv", "bin", "python");
const SCRIPT = "/Users/syanh/talpha_reports/format_all.py";

interface ExportState {
    running: boolean; startedAt: string | null; finishedAt: string | null;
    ok: boolean | null; exitCode: number | null; filesDone: number;
    totalFiles: number; log: string[]; error: string | null;
}
const g = globalThis as any;
if (!g.__talphaExport) {
    g.__talphaExport = { running: false, startedAt: null, finishedAt: null, ok: null,
        exitCode: null, filesDone: 0, totalFiles: TOTAL_FILES, log: [], error: null } as ExportState;
}
function state(): ExportState { return g.__talphaExport; }
const NOISE = /NotOpenSSLWarning|FutureWarning|warnings\.warn|non-supported Python|urllib3|api_core/i;
function pushLog(chunk: string) {
    const s = state();
    for (const raw of chunk.split(/\r?\n/)) {
        const t = raw.trim();
        if (!t || NOISE.test(t)) continue;
        s.log.push(t);
        const m = t.match(/^\[(\d+)\]/);
        if (m) s.filesDone = parseInt(m[1], 10);
        if (/ALL DONE/i.test(t)) s.filesDone = s.totalFiles;
    }
    if (s.log.length > 50) s.log = s.log.slice(-50);
}
function startLocalSpawn(): { started: boolean; error?: string } {
    const s = state();
    if (!fs.existsSync(PY)) return { started: false, error: `Không thấy python venv: ${PY}` };
    if (!fs.existsSync(SCRIPT)) return { started: false, error: `Không thấy script: ${SCRIPT}` };
    Object.assign(s, { running: true, startedAt: new Date().toISOString(), finishedAt: null,
        ok: null, exitCode: null, filesDone: 0, totalFiles: TOTAL_FILES, log: [], error: null });
    const proc = spawn(PY, ["-u", SCRIPT], { cwd: REPO, env: { ...process.env, PYTHONUNBUFFERED: "1" } });
    proc.stdout.on("data", (d) => pushLog(String(d)));
    proc.stderr.on("data", (d) => pushLog(String(d)));
    proc.on("error", (e: any) => { s.running = false; s.ok = false; s.error = e.message; s.finishedAt = new Date().toISOString(); });
    proc.on("close", (code) => { s.running = false; s.exitCode = code; s.ok = code === 0; s.finishedAt = new Date().toISOString(); });
    return { started: true };
}

// POST = bắt đầu xuất.
export async function POST() {
    const s = state();
    if (s.running) return NextResponse.json({ started: false, alreadyRunning: true, ...s });
    const r = startLocalSpawn();
    if (!r.started) return NextResponse.json({ started: false, error: r.error }, { status: 500 });
    return NextResponse.json({ started: true, ...state() });
}

// GET = poll trạng thái.
export async function GET() {
    return NextResponse.json(state());
}

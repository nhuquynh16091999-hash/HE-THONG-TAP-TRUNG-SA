import { NextResponse } from "next/server";
import { spawn } from "child_process";
import { Readable } from "node:stream";
import * as fs from "fs";
import * as path from "path";
import { bigquery } from "@/lib/bigquery";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const TOTAL_FILES = 56;
const BQ_PROJECT = process.env.NEXT_PUBLIC_BQ_PROJECT || "cty-507710";
const BQ_DATASET = process.env.DATASET || "TALPHA_Dataset";
const JOBS_TABLE = `${BQ_PROJECT}.${BQ_DATASET}.export_jobs`;

// Trên Vercel không có Python/local process → dùng HÀNG ĐỢI BigQuery: enqueue job,
// worker chạy trên Mac (launchd com.talpha.export-worker) nhặt và chạy format_all.py.
// Chạy local (pm2/next dev) thì spawn trực tiếp cho nhanh + progress realtime.
const IS_SERVERLESS = !!process.env.VERCEL;

// ─────────── ĐƯỜNG LOCAL: spawn format_all.py (giữ nguyên hành vi cũ) ───────────
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

// ─────────── ĐƯỜNG SERVERLESS: hàng đợi qua BigQuery (append-only, free-tier safe) ───────────
// Trạng thái mỗi job = dòng phase mới nhất (queued→running→done|error). Worker Mac append tiến độ.
async function latestJob(): Promise<{ job_id: string; phase: string; files_done: number; total_files: number; note: string; ageSec: number } | null> {
    try {
        const [rows] = await bigquery.query({
            query: `WITH j AS (SELECT job_id, MAX(ts) mts FROM \`${JOBS_TABLE}\` GROUP BY job_id ORDER BY mts DESC LIMIT 1)
                    SELECT e.job_id, e.phase, e.files_done, e.total_files, e.note,
                           TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), e.ts, SECOND) AS age_sec
                    FROM \`${JOBS_TABLE}\` e JOIN j ON e.job_id=j.job_id AND e.ts=j.mts LIMIT 1`,
        });
        if (!rows.length) return null;
        const r: any = rows[0];
        return { job_id: String(r.job_id), phase: String(r.phase), files_done: Number(r.files_done || 0),
            total_files: Number(r.total_files || TOTAL_FILES), note: String(r.note || ""), ageSec: Number(r.age_sec || 0) };
    } catch (e: any) {
        console.error("export latestJob error:", e?.message);
        return null;
    }
}
async function enqueue(): Promise<string> {
    const job_id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const row = { job_id, ts: new Date().toISOString(), phase: "queued", files_done: 0, total_files: TOTAL_FILES, note: "vercel" };
    await new Promise<void>((resolve, reject) => {
        const ws = bigquery.dataset(BQ_DATASET).table("export_jobs").createWriteStream({
            sourceFormat: "NEWLINE_DELIMITED_JSON", writeDisposition: "WRITE_APPEND",
        });
        ws.on("error", reject); ws.on("complete", () => resolve());
        Readable.from([Buffer.from(JSON.stringify(row) + "\n", "utf-8")]).pipe(ws);
    });
    return job_id;
}
// map job BQ → shape mà frontend đang đọc (giống ExportState)
function jobToState(j: Awaited<ReturnType<typeof latestJob>>) {
    if (!j) return { running: false, ok: null, filesDone: 0, totalFiles: TOTAL_FILES, error: null, log: [] as string[], mode: "queue" };
    const active = j.phase === "queued" || j.phase === "running";
    return {
        running: active,
        ok: j.phase === "done" ? true : j.phase === "error" ? false : null,
        filesDone: j.files_done, totalFiles: j.total_files,
        error: j.phase === "error" ? (j.note || "worker báo lỗi") : null,
        log: [j.phase === "queued" ? "Đã xếp hàng — chờ worker trên máy chủ nhặt (~30s)…"
            : j.phase === "running" ? `Đang xuất… ${j.files_done}/${j.total_files}`
            : j.phase === "done" ? "Hoàn tất" : `Lỗi: ${j.note}`],
        mode: "queue" as const,
    };
}

// POST = bắt đầu xuất.
export async function POST() {
    if (!IS_SERVERLESS) {
        const s = state();
        if (s.running) return NextResponse.json({ started: false, alreadyRunning: true, ...s });
        const r = startLocalSpawn();
        if (!r.started) return NextResponse.json({ started: false, error: r.error }, { status: 500 });
        return NextResponse.json({ started: true, ...state() });
    }
    // Serverless: chống double-enqueue nếu đang có job chạy < 15 phút
    const cur = await latestJob();
    if (cur && (cur.phase === "queued" || cur.phase === "running") && cur.ageSec < 900) {
        return NextResponse.json({ started: false, alreadyRunning: true, ...jobToState(cur) });
    }
    try {
        await enqueue();
        return NextResponse.json({ started: true, ...jobToState(await latestJob()) });
    } catch (e: any) {
        return NextResponse.json({ started: false, error: `Enqueue lỗi: ${e?.message}` }, { status: 500 });
    }
}

// GET = poll trạng thái.
export async function GET() {
    if (!IS_SERVERLESS) return NextResponse.json(state());
    return NextResponse.json(jobToState(await latestJob()));
}

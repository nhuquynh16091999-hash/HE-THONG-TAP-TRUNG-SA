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

// ─────────── Chạy đúng format_all.py mà vòng ghi Sheet mỗi giờ chạy ───────────
// Dò thư mục giống daily_guarded.sh: nút bấm và vòng :20 phải cùng script, cùng python,
// và cùng khoá `<DIR>/.lock` — không thì hai lượt ghi chồng lên cùng một file Sheet.
const REPO = path.join(process.cwd(), "..");
const HOME_REPORTS = path.join(process.env.HOME || "/root", "talpha_reports");
const DIR = process.env.TALPHA_REPORTS_DIR
    || (fs.existsSync(path.join(HOME_REPORTS, "runtime")) ? HOME_REPORTS : path.join(REPO, "ops", "talpha_reports"));
const RT = process.env.TALPHA_RUNTIME_DIR || (fs.existsSync(path.join(DIR, "runtime")) ? path.join(DIR, "runtime") : REPO);
const PY = [process.env.TALPHA_PYTHON, path.join(RT, ".venv", "bin", "python"), path.join(REPO, ".venv", "bin", "python")]
    .find((p): p is string => !!p && fs.existsSync(p)) || "python3";
const SCRIPT = path.join(DIR, "format_all.py");
const LOCK = path.join(DIR, ".lock");

function pidSong(pid: number): boolean {
    try { process.kill(pid, 0); return true; } catch { return false; }
}

/** Giữ khoá chung với daily_guarded.sh. Khoá của tiến trình đã chết thì dọn, như script kia. */
function layKhoa(): string | null {
    if (fs.existsSync(LOCK)) {
        let pid = 0;
        try { pid = parseInt(fs.readFileSync(path.join(LOCK, "pid"), "utf8").trim(), 10) || 0; } catch { /* chưa ghi pid */ }
        if (pid && pidSong(pid)) return "Vòng ghi Sheet mỗi giờ đang chạy — đợi nó xong rồi bấm lại.";
        const tuoiPhut = (Date.now() - fs.statSync(LOCK).mtimeMs) / 60000;
        if (!pid && tuoiPhut < 45) return "Vòng ghi Sheet mỗi giờ đang khởi động — thử lại sau ít phút.";
        fs.rmSync(LOCK, { recursive: true, force: true });
    }
    try { fs.mkdirSync(LOCK); } catch { return "Vòng ghi Sheet mỗi giờ vừa bắt đầu — thử lại sau ít phút."; }
    return null;
}

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
function startLocalSpawn(): { started: boolean; error?: string; busy?: boolean } {
    const s = state();
    if (!fs.existsSync(SCRIPT)) return { started: false, error: `Không thấy script: ${SCRIPT}` };
    const khoa = layKhoa();
    if (khoa) return { started: false, error: khoa, busy: true };
    Object.assign(s, { running: true, startedAt: new Date().toISOString(), finishedAt: null,
        ok: null, exitCode: null, filesDone: 0, totalFiles: TOTAL_FILES, log: [], error: null });
    const traKhoa = () => fs.rmSync(LOCK, { recursive: true, force: true });
    const proc = spawn(PY, ["-u", SCRIPT], { cwd: DIR, env: { ...process.env, PYTHONUNBUFFERED: "1", PYTHONPATH: RT } });
    if (proc.pid) fs.writeFileSync(path.join(LOCK, "pid"), String(proc.pid));
    proc.stdout.on("data", (d) => pushLog(String(d)));
    proc.stderr.on("data", (d) => pushLog(String(d)));
    proc.on("error", (e: any) => { traKhoa(); s.running = false; s.ok = false; s.error = e.message; s.finishedAt = new Date().toISOString(); });
    proc.on("close", (code) => { traKhoa(); s.running = false; s.exitCode = code; s.ok = code === 0; s.finishedAt = new Date().toISOString(); });
    return { started: true };
}

// POST = bắt đầu xuất.
export async function POST() {
    const s = state();
    if (s.running) return NextResponse.json({ started: false, alreadyRunning: true, ...s });
    const r = startLocalSpawn();
    if (!r.started) return NextResponse.json({ started: false, error: r.error }, { status: r.busy ? 409 : 500 });
    return NextResponse.json({ started: true, ...state() });
}

// GET = poll trạng thái.
export async function GET() {
    return NextResponse.json(state());
}

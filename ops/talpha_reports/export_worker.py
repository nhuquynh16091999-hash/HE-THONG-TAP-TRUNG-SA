#!/usr/bin/env python3
"""Worker xuất Sheet theo yêu cầu từ Dashboard (Vercel).
Vòng lặp: đọc job 'queued' mới nhất trong BQ export_jobs → chạy format_all.py →
append tiến độ ('running' + files_done) → 'done'/'error'. Dùng chung lock với
daily_guarded.sh để KHÔNG chạy chồng với chain sync hàng giờ.
Lock ghi PID chủ vào .lock/pid — 2 phía tự dọn khi chủ lock chết (B4), không kẹt 45'.
Chạy dưới launchd com.talpha.export-worker (KeepAlive)."""
import os, io, sys, time, json, uuid, shutil, subprocess, datetime

os.environ.setdefault('GOOGLE_APPLICATION_CREDENTIALS', '/Users/syanh/talpha_reports/runtime/bigquery_key.json')
from google.cloud import bigquery

DIR = '/Users/syanh/talpha_reports'
PY = f'{DIR}/runtime/.venv/bin/python'
SCRIPT = f'{DIR}/format_all.py'
LOCK = f'{DIR}/.lock'                      # cùng lock với daily_guarded.sh
LOCK_STALE_SEC = 45 * 60                   # backstop khi lock không có pid (bản cũ)
P, DS = 'cty-507710', 'TALPHA_Dataset'
TABLE = f'{P}.{DS}.export_jobs'
POLL_SEC = 20
TOTAL = 56
cl = bigquery.Client(project=P)


def append(job_id, phase, files_done=0, note=''):
    row = {'job_id': job_id, 'ts': datetime.datetime.utcnow().isoformat(),
           'phase': phase, 'files_done': int(files_done), 'total_files': TOTAL, 'note': note[:400]}
    jc = bigquery.LoadJobConfig(source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
                                write_disposition=bigquery.WriteDisposition.WRITE_APPEND)
    cl.load_table_from_file(io.BytesIO((json.dumps(row, ensure_ascii=False) + '\n').encode()),
                            TABLE, job_config=jc).result()


def latest_queued():
    """job_id có phase mới nhất == 'queued' (chưa được nhặt)."""
    q = f"""WITH j AS (SELECT job_id, MAX(ts) mts FROM `{TABLE}` GROUP BY job_id)
            SELECT e.job_id FROM `{TABLE}` e JOIN j ON e.job_id=j.job_id AND e.ts=j.mts
            WHERE e.phase='queued' AND TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), e.ts, MINUTE) < 30
            ORDER BY e.ts DESC LIMIT 1"""
    rows = list(cl.query(q).result())
    return rows[0].job_id if rows else None


def lock_is_stale():
    """Lock kẹt = chủ lock (PID trong .lock/pid) đã chết, hoặc lock không pid quá 45'."""
    try:
        pid = int(open(f'{LOCK}/pid').read().strip())
    except Exception:
        pid = None
    if pid is not None:
        try:
            os.kill(pid, 0); return False       # chủ còn sống → tôn trọng lock
        except ProcessLookupError:
            return True                          # chủ chết giữa chừng → lock kẹt
        except Exception:
            return False
    try:
        return time.time() - os.path.getmtime(LOCK) > LOCK_STALE_SEC
    except OSError:
        return False                             # lock vừa được thả → mkdir lượt sau


def try_lock():
    """mkdir lock (atomic) + ghi PID. True nếu lấy được; False nếu bên kia đang giữ."""
    try:
        os.mkdir(LOCK)
    except FileExistsError:
        if not lock_is_stale():
            return False
        print('[export_worker] don lock ket (chu lock da chet)', flush=True)
        shutil.rmtree(LOCK, ignore_errors=True)
        try:
            os.mkdir(LOCK)
        except FileExistsError:
            return False                         # bên kia vừa chiếm lại → chờ lượt sau
    with open(f'{LOCK}/pid', 'w') as f:
        f.write(str(os.getpid()))
    return True


def run_export(job_id):
    if not try_lock():
        # Chain sync hàng giờ đang chạy → GIỮ job ở 'queued', main loop thử lại sau 20s.
        print(f'[export_worker] lock bận, job {job_id} chờ lượt sau', flush=True)
        return
    try:
        append(job_id, 'running', 0, 'bắt đầu')
        proc = subprocess.Popen([PY, '-u', SCRIPT], cwd=DIR,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                env={**os.environ, 'PYTHONUNBUFFERED': '1'}, text=True)
        done = 0; last_push = 0
        for line in proc.stdout:
            line = line.strip()
            if line.startswith('['):
                try: done = int(line[1:line.index(']')])
                except Exception: pass
            if 'ALL DONE' in line: done = TOTAL
            if time.time() - last_push > 4:      # đẩy tiến độ mỗi ~4s, tránh spam BQ
                append(job_id, 'running', done); last_push = time.time()
        rc = proc.wait()
        if rc == 0:
            append(job_id, 'done', TOTAL, 'ok')
        else:
            append(job_id, 'error', done, f'format_all exit {rc}')
    except Exception as e:
        append(job_id, 'error', 0, str(e))
    finally:
        shutil.rmtree(LOCK, ignore_errors=True)  # lock chứa pid → rmtree, không rmdir


def main():
    print(f'[export_worker] start, poll {POLL_SEC}s', flush=True)
    while True:
        try:
            jid = latest_queued()
            if jid:
                print(f'[export_worker] nhặt job {jid}', flush=True)
                run_export(jid)
        except Exception as e:
            print(f'[export_worker] poll error: {e}', flush=True)
        time.sleep(POLL_SEC)


if __name__ == '__main__':
    main()

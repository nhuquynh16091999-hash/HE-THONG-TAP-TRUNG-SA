#!/usr/bin/env python3
# TALPHA — ghi 1 dòng trạng thái sync vào BQ sync_health (chống "chết câm").
# Gọi từ daily_guarded.sh sau mỗi vòng chạy. Bot WhatsApp đọc qua /api/talpha/sync-health.
# Load job APPEND (free tier không có streaming/DML). Fail ở đây KHÔNG được làm vỡ vòng chạy.
import os, sys, json, io, socket, argparse, datetime

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ok", type=int, required=True)          # 1 = cả vòng OK
    ap.add_argument("--sync-rc", type=int, default=-1)
    ap.add_argument("--format-rc", type=int, default=-1)
    ap.add_argument("--detail", default="")
    a = ap.parse_args()
    os.environ.setdefault("GOOGLE_APPLICATION_CREDENTIALS",
                          os.path.expanduser("~/talpha_reports/runtime/bigquery_key.json"))
    from google.cloud import bigquery
    client = bigquery.Client(project="cty-507710")
    row = {
        "ts": datetime.datetime.utcnow().isoformat() + "Z",
        "host": socket.gethostname(),
        "ok": bool(a.ok),
        "sync_rc": a.sync_rc,
        "format_rc": a.format_rc,
        "detail": a.detail[:1000],
    }
    schema = [
        bigquery.SchemaField("ts", "TIMESTAMP"),
        bigquery.SchemaField("host", "STRING"),
        bigquery.SchemaField("ok", "BOOL"),
        bigquery.SchemaField("sync_rc", "INT64"),
        bigquery.SchemaField("format_rc", "INT64"),
        bigquery.SchemaField("detail", "STRING"),
    ]
    jc = bigquery.LoadJobConfig(
        source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
        write_disposition=bigquery.WriteDisposition.WRITE_APPEND, schema=schema)
    client.load_table_from_file(
        io.BytesIO(json.dumps(row).encode()), "cty-507710.TALPHA_Dataset.sync_health",
        job_config=jc).result()
    print("sync_health:", row["ok"], row["detail"][:80])

if __name__ == "__main__":
    try:
        main()
    except Exception as e:                       # noqa: BLE001
        print("report_health FAILED (bỏ qua, không chặn vòng chạy):", e, file=sys.stderr)

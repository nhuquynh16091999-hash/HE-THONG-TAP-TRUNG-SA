#!/usr/bin/env python3
"""
Dựng cấu trúc BigQuery cho TALPHA — bảng nền + 12 view.

    python3 scripts/setup_bq.py            # chỉ in kế hoạch, KHÔNG động vào gì
    python3 scripts/setup_bq.py --execute  # tạo thật

An toàn: chỉ CREATE IF NOT EXISTS cho bảng và CREATE OR REPLACE cho view.
KHÔNG drop, KHÔNG xoá, KHÔNG ghi đè dữ liệu. Chạy lại nhiều lần vô hại.

Vì sao cần script này: bảng nền tự sinh ra khi sync chạy lần đầu (load job có
khai schema), nhưng VIEW thì không — `CREATE VIEW` đổ ngay nếu bảng nguồn chưa
tồn tại. Kho mới dựng là kho trống, nên phải tạo bảng rỗng trước rồi mới dựng
view được, để dashboard trả về "không có dòng nào" thay vì "không thấy bảng".

Schema lấy THẲNG từ code sync, không gõ lại — hai bản schema lệch nhau là kiểu
lỗi không ai thấy cho tới lúc số sai.
"""
import argparse
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ.setdefault("GOOGLE_APPLICATION_CREDENTIALS", os.path.join(ROOT, "bigquery_key.json"))

from google.cloud import bigquery  # noqa: E402

PROJECT = os.getenv("BQ_PROJECT_ID", "cty-507710")
DATASET = os.getenv("BQ_DATASET", "TALPHA_Dataset")


def base_tables() -> dict:
    """Bảng nền → schema. Import từ module sync để chỉ có MỘT nguồn schema."""
    import sync.talpha.talpha_sync as ts
    from sync.talpha.sync_product_catalog import CATALOG_SCHEMA

    F = bigquery.SchemaField
    return {
        # ── Do sync/talpha/talpha_sync.py ghi ──
        "sale_order":       ts.ORDER_SCHEMA,
        "order_items":      ts.ITEM_SCHEMA,
        "fb_ads_data":      ts.ADS_SCHEMA,
        "fb_adset_data":    ts.ADSET_SCHEMA,
        "fb_campaign_data": ts.CAMPAIGN_SCHEMA,
        "ad_dictionary":    [F(n, "STRING") for n in (
            "ad_id", "account_id", "account_name",
            "campaign_id", "campaign_name", "ad_name", "status", "sync_time")],
        # ── Do sync/talpha/sync_product_catalog.py ghi ──
        "product_catalog":  CATALOG_SCHEMA,
    }


# Ba bảng vận hành dưới đây TỰ SINH khi bên ghi chạy lần đầu (route dashboard và
# ops đều khai schema trong chính load job của nó), nên script này không tạo:
#   inventory_snapshot                  ← route sync-inventory của dashboard
#   sync_health · sync_health_accounts  ← ops/talpha_reports
# (ads_command_snapshot và export_jobs đã bỏ 13/09/2026 — không ai đọc / chỉ dùng
#  cho bản chạy trên Vercel.)
SELF_CREATING = [
    "inventory_snapshot", "sync_health", "sync_health_accounts",
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--execute", action="store_true", help="Tạo thật (mặc định chỉ in kế hoạch)")
    args = ap.parse_args()

    tables = base_tables()

    print(f"\n{'=' * 62}")
    print(f"  Dựng cấu trúc BigQuery")
    print(f"  Kho    : {PROJECT}.{DATASET}")
    print(f"  Chế độ : {'TẠO THẬT' if args.execute else 'chỉ in kế hoạch'}")
    print(f"{'=' * 62}\n")

    client = bigquery.Client(project=PROJECT)

    ds_ref = bigquery.Dataset(f"{PROJECT}.{DATASET}")
    ds_ref.location = "US"
    if args.execute:
        client.create_dataset(ds_ref, exists_ok=True)
    print(f"  Kho {DATASET} — sẵn sàng\n")

    print("  Bảng nền:")
    for name, schema in tables.items():
        full = f"{PROJECT}.{DATASET}.{name}"
        if not args.execute:
            print(f"    • {name:<20} {len(schema):>3} cột")
            continue
        try:
            client.get_table(full)
            print(f"    = {name:<20} đã có, giữ nguyên")
        except Exception:
            client.create_table(bigquery.Table(full, schema=schema))
            print(f"    + {name:<20} tạo mới, {len(schema)} cột")

    print("\n  Bảng tự sinh khi bên ghi chạy lần đầu (không tạo ở đây):")
    for n in SELF_CREATING:
        print(f"    ~ {n}")

    if not args.execute:
        print("\n  Chưa động vào gì. Thêm --execute để tạo thật.")
        return 0

    print("\n  Dựng view:")
    deploy = os.path.join(ROOT, "sql", "talpha", "deploy_talpha_analytics.py")
    r = subprocess.run([sys.executable, deploy, "--execute"], cwd=ROOT)
    if r.returncode != 0:
        print("\n  ❌ Dựng view thất bại — xem log phía trên.")
        return 1

    print("\n  ✅ Xong. Kho đã có cấu trúc, đang rỗng — chạy sync để nạp số.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

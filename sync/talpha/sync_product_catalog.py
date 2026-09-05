"""
sync/talpha/sync_product_catalog.py — Build product dimension từ Poscake POS.

order_items chỉ có product_id + variation_id (UUID) + quantity; KHÔNG có tên/giá.
Script này fetch products của 7 shop (6 GCC + Taiwan), dựng bảng `product_catalog`
(variation_id → product_id, sku, name, retail_price, cost) để JOIN với order_items.

Tạo bảng `product_catalog` (WRITE_TRUNCATE — dimension, full refresh)
và view `vw_product_pnl` (order_items × product_catalog × sale_order).

Usage:
  python sync/talpha/sync_product_catalog.py            # full sync
  python sync/talpha/sync_product_catalog.py --dry-run  # chỉ fetch, không ghi BQ
"""
import os, sys, json, time, tempfile, argparse
import requests
from dotenv import load_dotenv
from google.oauth2.service_account import Credentials
from google.cloud import bigquery

# load_dotenv() không tham số dò .env từ vị trí FILE script, không phải cwd. Bản
# deploy nằm ở ~/talpha_reports/ còn .env ở ~/talpha_reports/runtime/ ⇒ dò trượt,
# không có key POS nào → fetch rỗng. Nạp thêm .env theo cwd (catalog_cron.sh đã cd
# vào runtime). Đã xảy ra thật 04/08: bảng bị ghi đè còn 0 dòng.
load_dotenv()
load_dotenv(os.path.join(os.getcwd(), ".env"))

POS_API = "https://pos.pages.fm/api/v1"
BQ_PROJECT = os.environ.get("BQ_PROJECT_ID", "talpha-faos-2026")
BQ_DATASET = os.environ.get("BQ_DATASET", "TALPHA_Dataset")
TABLE = f"{BQ_PROJECT}.{BQ_DATASET}.product_catalog"

# Bản chạy trong runtime (~/talpha_reports, launchd không đọc được Desktop) không có
# cây config/ của repo → catalog_cron.sh trỏ TALPHA_CONFIG_YAML vào bản đã deploy.
CONFIG_YAML = os.environ.get("TALPHA_CONFIG_YAML") or os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "config", "projects", "talpha.yaml",
)

# Danh sách shop CHỈ có 1 nguồn: config/projects/talpha.yaml mục poscake.shops.
# Bản hardcode cũ thiếu Taiwan → 100% order_items của TW không khớp catalog
# (102/102 dòng, đo 04/08/2026) → mất hẳn TW khỏi mọi báo cáo theo sản phẩm.
# Đây là bẫy "danh sách shop/TKQC nằm ở nhiều nơi" — đừng chép lại lần nữa.
_FALLBACK_SHOPS = [
    ("SA", "1328205216"), ("AE", "1635200759"), ("KW", "1328205226"),
    ("OM", "1942200986"), ("QA", "1021271617"), ("BH", "100943483"),
    ("TW", "1328343252"),
]


def load_shops() -> list[tuple[str, str]]:
    """[(shop_label, shop_id)] đọc từ talpha.yaml; yaml lỗi → fallback hardcode."""
    try:
        import yaml
        with open(CONFIG_YAML, "r", encoding="utf-8") as f:
            shops = (yaml.safe_load(f) or {}).get("poscake", {}).get("shops", []) or []
        out = []
        for s in shops:
            # api_key trong yaml là "${TALPHA_POSCAKE_XX_KEY}" → lấy XX làm shop_label.
            label = str(s.get("api_key", "")).replace("${TALPHA_POSCAKE_", "").replace("_KEY}", "")
            sid = str(s.get("shop_id", "") or "")
            if len(label) == 2 and sid:
                out.append((label, sid))
        if out:
            return out
        print(f"⚠️  {CONFIG_YAML}: không đọc được shop nào — dùng danh sách dự phòng")
    except Exception as e:
        print(f"⚠️  Không đọc được {CONFIG_YAML} ({e}) — dùng danh sách dự phòng")
    return _FALLBACK_SHOPS


SHOPS = load_shops()


def fetch_shop_products(label: str, shop_id: str, key: str) -> list[dict]:
    """Fetch toàn bộ products của 1 shop, trả về list variation rows."""
    rows, page = [], 1
    while True:
        try:
            r = requests.get(
                f"{POS_API}/shops/{shop_id}/products",
                params={"api_key": key, "page_number": page, "page_size": 100},
                timeout=30,
            )
            if r.status_code != 200:
                print(f"  [{label}] page {page} HTTP {r.status_code} — dừng")
                break
            d = r.json()
        except Exception as e:
            print(f"  [{label}] page {page} lỗi: {e}")
            break

        prods = d.get("data", [])
        if not prods:
            break

        for p in prods:
            pid = str(p.get("id", ""))
            sku = str(p.get("custom_id", "") or "")
            name = str(p.get("name", "") or "")
            for v in (p.get("variations", []) or []):
                rows.append({
                    "variation_id": str(v.get("id", "")),
                    "product_id":   pid,
                    "sku":          sku,
                    "product_name": name,
                    "variation_name": str(v.get("display_id", "") or ""),
                    "retail_price": float(v.get("retail_price", 0) or 0),
                    "cost":         float(v.get("last_imported_price", 0) or 0),
                    "remain_quantity": int(v.get("remain_quantity", 0) or 0),
                    "shop_label":   label,
                    "image":        (v.get("images") or [None])[0],
                })

        total_pages = d.get("total_pages", 1)
        print(f"  [{label}] page {page}/{total_pages}: +{len(prods)} products")
        if page >= total_pages:
            break
        page += 1
        time.sleep(0.2)
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="Chỉ fetch, không ghi BQ")
    ap.add_argument("--force", action="store_true",
                    help="Ghi đè kể cả khi bảng mới hụt >30%% so với bảng đang có "
                         "(chỉ dùng khi ĐÃ BIẾT vì sao hụt, VD POS thật sự xoá bớt SP)")
    args = ap.parse_args()

    missing = [lb for lb, _ in SHOPS if not os.environ.get(f"TALPHA_POSCAKE_{lb}_KEY", "")]
    if len(missing) == len(SHOPS):
        # Không có key nào = chưa nạp được .env. Chạy tiếp sẽ WRITE_TRUNCATE bảng
        # về 0 dòng và giết mọi báo cáo theo SP — đã xảy ra thật 04/08/2026.
        raise SystemExit(
            f"❌ Không đọc được API key của shop nào ({', '.join(missing)}).\n"
            f"   .env đang tìm ở: {os.getcwd()}/.env và cạnh file script.\n"
            f"   DỪNG — không ghi BQ để khỏi xoá trắng {TABLE}."
        )
    if missing:
        print(f"⚠️  Thiếu API key {len(missing)}/{len(SHOPS)} shop: {', '.join(missing)} "
              f"→ SP của các shop này sẽ BIẾN MẤT khỏi catalog sau khi ghi đè")

    all_rows = []
    for label, sid in SHOPS:
        key = os.environ.get(f"TALPHA_POSCAKE_{label}_KEY", "")
        if not key:
            continue
        print(f"[{label}] fetching products...")
        all_rows.extend(fetch_shop_products(label, sid, key))

    # Dedupe theo variation_id (unique per shop). Giữ row đầu tiên.
    seen, deduped = set(), []
    for r in all_rows:
        vid = r["variation_id"]
        if vid and vid not in seen:
            seen.add(vid)
            deduped.append(r)

    print(f"\nTổng: {len(all_rows)} variation rows → {len(deduped)} unique variation_id")
    named = sum(1 for r in deduped if r["product_name"])
    print(f"Có tên SP: {named}/{len(deduped)} ({100*named/max(len(deduped),1):.0f}%)")

    if args.dry_run:
        print("\n--dry-run: KHÔNG ghi BQ. Sample 3 rows:")
        for r in deduped[:3]:
            print(" ", {k: r[k] for k in ["variation_id", "sku", "product_name", "retail_price", "cost", "shop_label"]})
        return

    # ─── Load vào BQ (WRITE_TRUNCATE — dimension) ───
    creds = Credentials.from_service_account_file(
        "bigquery_key.json",
        scopes=["https://www.googleapis.com/auth/bigquery"],
    )
    bq = bigquery.Client(credentials=creds, project=BQ_PROJECT)

    # ─── Hàng rào chống ghi đè hụt ───
    # WRITE_TRUNCATE là atomic nhưng KHÔNG hoàn tác được: POS lỗi giữa chừng / hết
    # key / đổi schema API là bảng dimension teo lại, kéo sập mọi báo cáo theo SP.
    # Hụt >30% so với bảng đang có ⇒ dừng, bắt người chạy xác nhận bằng --force.
    if len(deduped) == 0:
        raise SystemExit(f"❌ Fetch được 0 variation — DỪNG, giữ nguyên {TABLE}.")
    try:
        cur = list(bq.query(f"SELECT COUNT(*) n FROM `{TABLE}`").result())[0]["n"]
    except Exception as e:
        cur = 0
        print(f"⚠️  Không đọc được số dòng hiện tại ({e}) — bỏ qua hàng rào")
    if cur and len(deduped) < cur * 0.7 and not args.force:
        raise SystemExit(
            f"❌ Bảng mới {len(deduped)} dòng, hụt {100*(1-len(deduped)/cur):.0f}% "
            f"so với {cur} dòng đang có — DỪNG, giữ nguyên {TABLE}.\n"
            f"   Kiểm tra POS/API key trước. Chắc chắn đúng thì chạy lại với --force."
        )
    print(f"Bảng hiện có {cur} dòng → sẽ ghi {len(deduped)} dòng")

    schema = [
        bigquery.SchemaField("variation_id", "STRING", mode="REQUIRED"),
        bigquery.SchemaField("product_id", "STRING"),
        bigquery.SchemaField("sku", "STRING"),
        bigquery.SchemaField("product_name", "STRING"),
        bigquery.SchemaField("variation_name", "STRING"),
        bigquery.SchemaField("retail_price", "FLOAT64"),
        bigquery.SchemaField("cost", "FLOAT64"),
        bigquery.SchemaField("remain_quantity", "INT64"),
        bigquery.SchemaField("shop_label", "STRING"),
        bigquery.SchemaField("image", "STRING"),
    ]

    with tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False) as tmp:
        for r in deduped:
            tmp.write(json.dumps(r, ensure_ascii=False) + "\n")
        tmp_path = tmp.name

    cfg = bigquery.LoadJobConfig(
        schema=schema,
        source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
        write_disposition=bigquery.WriteDisposition.WRITE_TRUNCATE,
    )
    with open(tmp_path, "rb") as f:
        bq.load_table_from_file(f, TABLE, job_config=cfg).result()
    os.unlink(tmp_path)
    print(f"\n✅ Loaded {len(deduped)} rows → {TABLE}")

    # ─── Tạo view vw_product_pnl ───
    # E2 — bản cũ của view này KHÔNG chạy được: SUM(... SUM() OVER ...) là hàm
    # analytic lồng trong hàm aggregate, BigQuery từ chối ("Analytic functions
    # cannot be arguments to aggregate functions") ⇒ view chưa bao giờ tạo thành
    # công sau lần sửa đó. Nay tách window function ra CTE riêng.
    #
    # Đồng thời chuyển sang dùng vw_orders_std + vw_product_catalog_std để P&L theo
    # SP đi CHUNG một định nghĩa với dashboard: doanh thu đã quy VND theo shop_label
    # (bản cũ trả cod/100 tiền địa phương, cộng 7 market lại là số vô nghĩa) và gom
    # theo sku ĐÃ CHUẨN HOÁ (bản cũ gom theo sku thô nên "008" và "Necklace box"
    # tách hai dòng).
    view_sql = f"""
    CREATE OR REPLACE VIEW `{BQ_PROJECT}.{BQ_DATASET}.vw_product_pnl` AS
    WITH item_rev AS (
      -- Doanh thu đơn phân bổ cho từng item theo quantity.
      SELECT
        i.order_id,
        i.variation_id,
        i.quantity,
        v.shop_label,
        v.order_date,
        v.revenue_vnd * SAFE_DIVIDE(
          i.quantity, SUM(i.quantity) OVER (PARTITION BY i.order_id)
        ) AS revenue_vnd
      FROM `{BQ_PROJECT}.{BQ_DATASET}.order_items` i
      JOIN `{BQ_PROJECT}.{BQ_DATASET}.vw_orders_std` v
        ON i.order_id = CAST(v.order_id AS STRING)
      WHERE v.is_confirmed
    )
    SELECT
      c.sku,
      c.sku_code,
      ANY_VALUE(c.product_name)     AS product_name,
      ir.shop_label,
      COUNT(DISTINCT ir.order_id)   AS orders,
      SUM(ir.quantity)              AS units,
      ROUND(SUM(ir.revenue_vnd), 0) AS revenue_vnd
    FROM item_rev ir
    JOIN `{BQ_PROJECT}.{BQ_DATASET}.vw_product_catalog_std` c
      ON ir.variation_id = c.variation_id
    GROUP BY c.sku, c.sku_code, ir.shop_label
    """
    bq.query(view_sql).result()
    print(f"✅ Created view vw_product_pnl")

    # Verify coverage
    cov = list(bq.query(f"""
      SELECT
        COUNT(*) AS total_items,
        COUNTIF(c.variation_id IS NOT NULL) AS matched
      FROM `{BQ_PROJECT}.{BQ_DATASET}.order_items` i
      LEFT JOIN `{BQ_PROJECT}.{BQ_DATASET}.product_catalog` c
        ON i.variation_id = c.variation_id
    """).result())[0]
    pct = 100 * cov["matched"] / max(cov["total_items"], 1)
    print(f"✅ JOIN coverage: {cov['matched']:,}/{cov['total_items']:,} order_items khớp catalog ({pct:.1f}%)")


if __name__ == "__main__":
    main()

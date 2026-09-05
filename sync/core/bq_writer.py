"""
sync/core/bq_writer.py — BigQuery write utilities (free-tier safe).

TALPHA BigQuery project (cty-507710) không bật billing nên DML
(DELETE/MERGE/INSERT) bị reject. Dùng LOAD JOB (WRITE_TRUNCATE) thay thế.

Exports:
  load_truncate(client, project, dataset, table, rows, schema)
  upsert_orders_atomic(client, project, dataset, orders, items, order_schema, item_schema)
  get_last_sync_ts(client, project, dataset, table)
"""
import io, json, uuid, logging
from typing import Optional

log = logging.getLogger(__name__)


def load_truncate(
    client,
    project: str,
    dataset: str,
    table: str,
    rows: list[dict],
    schema=None,
) -> int:
    """Full-replace table via LOAD JOB (WRITE_TRUNCATE).

    Free-tier safe: không dùng DML. Mỗi sync fully replaces bảng.
    Dùng cho fb_ads_data (re-fetch và ghi đè).

    Returns: số rows đã ghi.
    """
    from google.cloud import bigquery as bq

    if not rows:
        log.warning(f"  {table}: 0 rows — skip (table unchanged)")
        return 0

    ndjson = "\n".join(json.dumps(r, ensure_ascii=False) for r in rows)
    jc_kwargs: dict = dict(
        source_format=bq.SourceFormat.NEWLINE_DELIMITED_JSON,
        write_disposition=bq.WriteDisposition.WRITE_TRUNCATE,
    )
    if schema:
        jc_kwargs["schema"] = schema
    else:
        jc_kwargs["autodetect"] = True

    client.load_table_from_file(
        io.BytesIO(ndjson.encode("utf-8")),
        f"{project}.{dataset}.{table}",
        job_config=bq.LoadJobConfig(**jc_kwargs),
    ).result()
    log.info(f"  {table}: {len(rows)} rows TRUNCATE+LOAD")
    return len(rows)


def load_append(
    client,
    project: str,
    dataset: str,
    table: str,
    rows: list[dict],
    schema=None,
) -> int:
    """Append rows via LOAD JOB (WRITE_APPEND). Dùng cho audit/log tables."""
    from google.cloud import bigquery as bq

    if not rows:
        return 0

    ndjson = "\n".join(json.dumps(r, ensure_ascii=False) for r in rows)
    jc_kwargs: dict = dict(
        source_format=bq.SourceFormat.NEWLINE_DELIMITED_JSON,
        write_disposition=bq.WriteDisposition.WRITE_APPEND,
    )
    if schema:
        jc_kwargs["schema"] = schema
    else:
        jc_kwargs["autodetect"] = True

    client.load_table_from_file(
        io.BytesIO(ndjson.encode("utf-8")),
        f"{project}.{dataset}.{table}",
        job_config=bq.LoadJobConfig(**jc_kwargs),
    ).result()
    log.info(f"  {table}: {len(rows)} rows APPEND")
    return len(rows)


# ═══════════════════════════════════════════════════════════════════
# X1 — GHI THÊM + DỰNG LẠI (thay WRITE_TRUNCATE cho bảng đơn)
#
# WRITE_TRUNCATE đặt cược cả bảng vào việc lần fetch này phải đầy đủ: kéo hụt là
# mất vĩnh viễn (04/08: sale_order tụt 4.440 → 3.960 trong 1 giờ).
#
# Cách mới — 2 tầng:
#   <table>_raw : APPEND-only, mọi phiên bản đơn từng thấy. KHÔNG BAO GIỜ ghi đè.
#   <table>     : dựng lại mỗi vòng = bản mới nhất của mỗi đơn trong raw.
#                 Consumer không phải sửa gì; kéo hụt chỉ làm đơn đó giữ bản cũ.
#
# Free-tier safe: chỉ LOAD JOB + query-with-destination. Đã probe 04/08 trên
# cty-507710: query→destination WRITE_TRUNCATE ✅, DML DELETE/MERGE ❌ 403.
# ═══════════════════════════════════════════════════════════════════

def _table_exists(client, fqn: str) -> bool:
    try:
        client.get_table(fqn)
        return True
    except Exception:
        return False


def _query_into(client, sql: str, destination: str) -> int:
    """Chạy query, ghi kết quả đè lên `destination`. Không phải DML → free tier chạy được."""
    from google.cloud import bigquery as bq

    job = client.query(sql, job_config=bq.QueryJobConfig(
        destination=destination,
        write_disposition=bq.WriteDisposition.WRITE_TRUNCATE,
    ))
    job.result()
    return client.get_table(destination).num_rows


def seed_raw_from_table(client, project: str, dataset: str, table: str) -> int:
    """Lần đầu bật cơ chế raw: chép nguyên bảng hiện tại sang <table>_raw.

    Không có bước này thì vòng sync đầu tiên dựng lại bảng CHỈ từ cửa sổ vừa kéo
    → đơn cũ ngoài cửa sổ đang có trong bảng sẽ mất. Chạy đúng 1 lần.
    """
    src = f"{project}.{dataset}.{table}"
    raw = f"{src}_raw"
    if _table_exists(client, raw):
        return 0
    if not _table_exists(client, src):
        log.info(f"  {table}: chưa có bảng nguồn — bỏ qua seed raw")
        return 0
    n = _query_into(client, f"SELECT * FROM `{src}`", raw)
    log.info(f"  {table}_raw: seed {n} dòng từ bảng hiện tại (chỉ chạy 1 lần)")
    return n


def get_existing_versions(
    client, project: str, dataset: str, table: str,
    key_cols: tuple = ("shop_label", "id"), ts_col: str = "updated_at",
) -> dict:
    """{"shop|id": ts} của bảng sạch — dùng để CHỈ append đơn mới/đơn vừa đổi.

    Không có bước lọc này thì mỗi vòng append lại cả cửa sổ → raw phình vô ích.
    Bảng không tồn tại → {} (append tất).

    KHOÁ PHẢI GỒM SHOP: POS đánh số đơn RIÊNG từng shop, id=18 tồn tại ở cả 7 shop
    (đo 05/08: 20.257 id bị nhiều shop dùng chung). Xem chú thích ở rebuild.
    """
    fqn = f"{project}.{dataset}.{table}"
    if not _table_exists(client, fqn):
        return {}
    cols = ", ".join(key_cols)
    grp = ", ".join(str(i + 1) for i in range(len(key_cols)))
    try:
        rows = client.query(
            f"SELECT {cols}, MAX({ts_col}) AS _t FROM `{fqn}` GROUP BY {grp}"
        ).result()
        return {"|".join(str(getattr(r, c)) for c in key_cols): (r._t or "") for r in rows}
    except Exception as e:
        log.warning(f"  Không đọc được phiên bản hiện có của {table} ({e}) — append tất")
        return {}


def append_and_rebuild_orders(
    client, project: str, dataset: str,
    orders: list[dict], items: list[dict],
    order_schema, item_schema,
    order_table: str = "sale_order", item_table: str = "order_items",
) -> tuple[int, int]:
    """Ghi đơn + item theo cơ chế raw/rebuild. Trả (số dòng bảng đơn, bảng item).

    Chỉ append đơn MỚI hoặc có `updated_at` mới hơn bản đang có, kèm toàn bộ item
    của những đơn đó. Sau đó dựng lại 2 bảng sạch từ raw:
      • sale_order  : mỗi id giữ bản `updated_at` mới nhất (X6 hết trùng id luôn).
      • order_items : giữ trọn bộ item của LẦN SYNC MỚI NHẤT mỗi đơn — không dedupe
        theo item_id, nếu không item đã bị xoá khỏi đơn sẽ sống mãi trong bảng.
    """
    seed_raw_from_table(client, project, dataset, order_table)
    seed_raw_from_table(client, project, dataset, item_table)

    known = get_existing_versions(client, project, dataset, order_table)
    changed = [
        o for o in orders
        if str(o.get("updated_at", "")) > known.get(f"{o.get('shop_label','')}|{o.get('id','')}", "")
    ]
    changed_keys = {(str(o.get("shop_id", "")), str(o.get("id", ""))) for o in changed}
    changed_items = [
        it for it in items
        if (str(it.get("shop_id", "")), str(it.get("order_id", ""))) in changed_keys
    ]

    log.info(
        f"  Đơn kéo về {len(orders)} → {len(changed)} đơn mới/đổi trạng thái "
        f"({len(orders) - len(changed)} đơn không đổi, bỏ qua)"
    )
    if changed:
        load_append(client, project, dataset, f"{order_table}_raw", changed, order_schema)
        if changed_items:
            load_append(client, project, dataset, f"{item_table}_raw", changed_items, item_schema)

    # KHOÁ ĐƠN = (shop, id), KHÔNG phải id. POS đánh số đơn riêng từng shop nên id=18
    # tồn tại ở cả 7 shop (05/08: 20.257 id dùng chung). Gom theo mình id là nhập các
    # đơn khác nhau làm một — lần đầu bật backfill toàn lịch sử đã ăn mất 24.791 đơn.
    n_orders = _query_into(client, f"""
        SELECT * EXCEPT(_rn) FROM (
            SELECT t.*, ROW_NUMBER() OVER (
                PARTITION BY shop_label, id ORDER BY updated_at DESC, sync_time DESC
            ) AS _rn
            FROM `{project}.{dataset}.{order_table}_raw` t
        ) WHERE _rn = 1
    """, f"{project}.{dataset}.{order_table}")

    n_items = 0
    if _table_exists(client, f"{project}.{dataset}.{item_table}_raw"):
        n_items = _query_into(client, f"""
            WITH latest AS (
                SELECT shop_id, order_id, MAX(sync_time) AS mx
                FROM `{project}.{dataset}.{item_table}_raw` GROUP BY 1, 2
            )
            SELECT * EXCEPT(_rn) FROM (
                SELECT r.*, ROW_NUMBER() OVER (
                    PARTITION BY r.shop_id, r.order_id, r.item_id
                    ORDER BY r.sync_time DESC
                ) AS _rn
                FROM `{project}.{dataset}.{item_table}_raw` r
                JOIN latest l ON r.shop_id = l.shop_id
                             AND r.order_id = l.order_id AND r.sync_time = l.mx
            ) WHERE _rn = 1
        """, f"{project}.{dataset}.{item_table}")

    log.info(f"  {order_table}: {n_orders} đơn · {item_table}: {n_items} item (dựng lại từ raw)")
    return n_orders, n_items


def append_and_rebuild_ads(
    client, project: str, dataset: str,
    rows: list[dict], schema, table: str, id_col: str,
) -> int:
    """Ghi insight ads theo cơ chế raw/rebuild. Trả số dòng bảng sau khi dựng lại.

    X2 — vì sao cần: bản cũ WRITE_TRUNCATE cả bảng bằng đúng cửa sổ vừa kéo, mà
    `sync_month.py` gọi `days_back = month-to-date`. Ngày 1 hàng tháng cửa sổ co về
    1 ngày → cả tháng trước bị xoá trắng. Tháng 7/2026 mất sạch chỉ còn 31/07 (đúng
    ngày biên của cửa sổ 01/08). Nay cửa sổ chỉ quyết định "ngày nào được làm mới",
    KHÔNG còn quyết định "ngày nào bị xoá".

    Khoá = (account_id, {id_col}, date) — spend của một ad trong một ngày là duy
    nhất; kéo lại cùng ngày thì bản `sync_time` mới nhất thắng, nên số liệu vẫn
    được cập nhật khi Meta chốt sổ muộn.
    """
    seed_raw_from_table(client, project, dataset, table)

    if rows:
        # Schema PHẢI lấy từ bảng raw khi nó đã tồn tại, không dùng schema khai sẵn.
        # Bảng thật do engine runtime tạo bằng autodetect nên `sync_time` là TIMESTAMP
        # và `account_id`/`ad_id` là INTEGER, trong khi ADS_SCHEMA khai STRING cả ba —
        # append lệch kiểu thì BQ trả 400 "Field ... has changed type" và vòng sync
        # chết. (WRITE_TRUNCATE cũ không lộ vì nó tạo lại bảng mỗi lần.)
        raw_fqn = f"{project}.{dataset}.{table}_raw"
        use_schema = client.get_table(raw_fqn).schema if _table_exists(client, raw_fqn) else schema
        load_append(client, project, dataset, f"{table}_raw", rows, use_schema)

    n = _query_into(client, f"""
        SELECT * EXCEPT(_rn) FROM (
            SELECT t.*, ROW_NUMBER() OVER (
                PARTITION BY account_id, {id_col}, date ORDER BY sync_time DESC
            ) AS _rn
            FROM `{project}.{dataset}.{table}_raw` t
        ) WHERE _rn = 1
    """, f"{project}.{dataset}.{table}")

    log.info(f"  {table}: {len(rows)} dòng kéo về → bảng {n} dòng (dựng lại từ raw)")
    return n


def get_last_sync_ts(
    client,
    project: str,
    dataset: str,
    table: str = "sale_order",
) -> Optional[str]:
    """Query BQ cho MAX(updated_at) — dùng làm điểm dừng khi fetch incremental.

    Returns: ISO timestamp string, hoặc None nếu bảng rỗng/chưa tồn tại.
    """
    try:
        q = f"SELECT MAX(updated_at) AS last_ts FROM `{project}.{dataset}.{table}`"
        rows = list(client.query(q).result())
        ts = rows[0].last_ts if rows else None
        if ts:
            log.info(f"  Last sync ts ({table}): {ts}")
        else:
            log.info(f"  {table}: no data — full fetch")
        return ts
    except Exception as e:
        log.info(f"  Could not get last sync ts for {table} ({e}) — full fetch")
        return None


def upsert_orders_atomic(
    client,
    project: str,
    dataset: str,
    all_orders: list[dict],
    all_items: list[dict],
    order_schema,
    item_schema,
) -> None:
    """Atomic upsert orders + items vào BigQuery.

    Strategy: load → staging table → DELETE + INSERT trong 1 transaction.
    Idempotent và self-deduping (ROW_NUMBER OVER PARTITION BY id).

    Tại sao không dùng DELETE-then-APPEND:
      - Non-atomic: nếu DELETE thành công nhưng APPEND lỗi → mất data
      - Hai sync song song có thể APPEND cùng lúc → nhân đôi đơn hàng
      - COD revenue phình ~2× nhưng order count đúng (COUNT DISTINCT) → bug ẩn
    """
    if not all_orders:
        log.info("  No orders to upsert")
        return

    tag = uuid.uuid4().hex[:8]
    stg_orders = f"{project}.{dataset}._stg_sale_order_{tag}"
    stg_items = f"{project}.{dataset}._stg_order_items_{tag}"

    order_cols = [f.name for f in order_schema]
    item_cols = [f.name for f in item_schema]

    order_keys = set(order_cols)
    dedup_order_by = ", ".join(
        f"`{c}` DESC"
        for c in ("sync_time", "updated_at")
        if c in order_keys
    ) or "`id`"

    try:
        # 1. Load staging (isolated — no contention with target table)
        _load_staging(client, stg_orders, all_orders, order_schema)
        if all_items:
            _load_staging(client, stg_items, all_items, item_schema)

        # 2. Atomic DELETE + INSERT
        order_set = ", ".join(f"`{c}`" for c in order_cols)
        if all_items:
            item_set = ", ".join(f"`{c}`" for c in item_cols)
            items_sql = f"""
  DELETE FROM `{project}.{dataset}.order_items`
  WHERE order_id IN (SELECT id FROM `{stg_orders}`);
  INSERT INTO `{project}.{dataset}.order_items` ({item_set})
  SELECT {item_set} FROM `{stg_items}`;"""
        else:
            items_sql = f"""
  DELETE FROM `{project}.{dataset}.order_items`
  WHERE order_id IN (SELECT id FROM `{stg_orders}`);"""

        script = f"""
BEGIN TRANSACTION;
  DELETE FROM `{project}.{dataset}.sale_order`
  WHERE id IN (SELECT id FROM `{stg_orders}`);
  INSERT INTO `{project}.{dataset}.sale_order` ({order_set})
  SELECT {order_set} FROM (
    SELECT * EXCEPT(_rn) FROM (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY {dedup_order_by}) AS _rn
      FROM `{stg_orders}`
    ) WHERE _rn = 1
  );{items_sql}
COMMIT TRANSACTION;
"""
        client.query(script).result()
        log.info(
            f"  sale_order: {len(all_orders)} rows UPSERTED (atomic) · "
            f"order_items: {len(all_items)} rows"
        )
    finally:
        # 3. Drop staging (best-effort — uniquely named per run)
        for stg in (stg_orders, stg_items):
            try:
                client.delete_table(stg, not_found_ok=True)
            except Exception as e:
                log.warning(f"  Could not drop staging {stg}: {e}")


def _load_staging(client, staging_fqn: str, rows: list[dict], schema) -> int:
    """Internal: load rows vào staging table (WRITE_TRUNCATE)."""
    from google.cloud import bigquery as bq

    ndjson = "\n".join(json.dumps(r, ensure_ascii=False) for r in rows)
    client.load_table_from_file(
        io.BytesIO(ndjson.encode("utf-8")),
        staging_fqn,
        job_config=bq.LoadJobConfig(
            source_format=bq.SourceFormat.NEWLINE_DELIMITED_JSON,
            write_disposition=bq.WriteDisposition.WRITE_TRUNCATE,
            schema=schema,
        ),
    ).result()
    return len(rows)


def ensure_dataset(client, project: str, dataset: str, location: str = "US") -> None:
    """Tạo dataset nếu chưa tồn tại."""
    from google.cloud import bigquery as bq

    try:
        client.get_dataset(f"{project}.{dataset}")
        log.debug(f"  Dataset {dataset} already exists")
    except Exception:
        log.info(f"  Creating dataset {dataset}...")
        ds = bq.Dataset(f"{project}.{dataset}")
        ds.location = location
        client.create_dataset(ds)
        log.info(f"  Created dataset {dataset}")

"""
Shared utilities for incremental order sync across all projects.
Strategy: Smart Stop + DELETE-by-ID + APPEND (replaces WRITE_TRUNCATE).

Usage in project sync scripts:
    from sync.order_sync_utils import get_last_sync_ts, upsert_orders, should_stop_fetching
"""
import io, json, logging

log = logging.getLogger(__name__)


def get_last_sync_ts(client, project_id, dataset, table='sale_order'):
    """Query BQ for MAX(updated_at) — used as stop condition for incremental fetch.
    Returns ISO timestamp string or None if table is empty/missing."""
    try:
        q = f"SELECT MAX(updated_at) as last_ts FROM `{project_id}.{dataset}.{table}`"
        rows = list(client.query(q).result())
        ts = rows[0].last_ts if rows else None
        if ts:
            log.info(f"  Last sync timestamp: {ts}")
        else:
            log.info(f"  No existing data — will do full fetch")
        return ts
    except Exception as e:
        log.info(f"  Could not get last sync ts ({e}) — full fetch")
        return None


def should_stop_fetching(orders, last_sync_ts):
    """⚠️ HỎNG — ĐỪNG DÙNG CHO DỰ ÁN MỚI (lỗi X1, phát hiện 04/08/2026).

    Docstring dưới đây SAI: POS **không** sắp theo updated_at mà theo `inserted_at`
    giảm dần (probe API 04/08: inserted_at desc = True, updated_at desc = False).
    Đơn COD tạo lâu ngày mới giao xong có updated_at mới nhưng nằm sâu ở trang sau
    → hàm này bảo dừng sớm, đơn đó bị cắt mất. TALPHA đã chuyển sang
    `trim_page_to_window()`. Giữ lại nguyên vẹn vì auus1/hnle/trendify/stramark/zen8
    còn gọi — sửa ở đây là đụng vào 5 dự án khác.

    Check if ALL orders on this page are older than last sync.
    Returns True if we can stop fetching (all orders already synced)."""
    if not last_sync_ts or not orders:
        return False
    # All orders on this page have updated_at <= last_sync_ts
    for o in orders:
        updated = o.get('updated_at', '')
        if updated > last_sync_ts:
            return False  # At least one newer order — keep fetching
    return True


# ═══════════════════════════════════════════════════════════════════
# X1 (04/08/2026) — CƠ CHẾ MỚI: cắt trang theo ngày TẠO + ghi thêm rồi dựng lại.
# Hàm mới hoàn toàn, KHÔNG đụng hàm cũ (5 dự án khác đang dùng).
# ═══════════════════════════════════════════════════════════════════

def trim_page_to_window(orders, window_start):
    """Cắt 1 trang theo cửa sổ ngày TẠO. Trả (đơn giữ lại, đã chạm đáy cửa sổ chưa).

    POS sắp feed theo `inserted_at` giảm dần (đã probe API 04/08, đúng cả với
    page_size=100) nên gặp đơn đầu tiên cũ hơn mốc là chắc chắn phía sau không còn
    đơn nào mới hơn → dừng an toàn, không phụ thuộc updated_at như Smart Stop cũ.
    Đơn thiếu inserted_at thì giữ — thà thừa còn hơn bỏ sót.
    """
    if not window_start:
        return orders, False
    keep = []
    for o in orders:
        ins = str(o.get('inserted_at', '') or '')
        if ins and ins < window_start:
            return keep, True
        keep.append(o)
    return keep, False


def _table_exists(client, fqn):
    try:
        client.get_table(fqn)
        return True
    except Exception:
        return False


def _query_into(client, sql, destination):
    """Query → ghi đè bảng đích. KHÔNG phải DML nên free tier chạy được
    (probe 04/08: query→destination ✅, DELETE/MERGE ❌ 403 billing)."""
    from google.cloud import bigquery
    client.query(sql, job_config=bigquery.QueryJobConfig(
        destination=destination,
        write_disposition=bigquery.WriteDisposition.WRITE_TRUNCATE,
    )).result()
    return client.get_table(destination).num_rows


def _load_append(client, fqn, rows, schema):
    from google.cloud import bigquery
    ndjson = '\n'.join(json.dumps(r, ensure_ascii=False) for r in rows)
    client.load_table_from_file(
        io.BytesIO(ndjson.encode('utf-8')), fqn,
        job_config=bigquery.LoadJobConfig(
            source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
            write_disposition=bigquery.WriteDisposition.WRITE_APPEND,
            schema=schema)).result()


def append_and_rebuild_ads(client, project_id, dataset, rows, schema, table, id_col):
    """X2 — thay WRITE_TRUNCATE cho bảng insight ads. Trả số dòng bảng sau khi dựng lại.

    Bản cũ TRUNCATE cả bảng bằng đúng cửa sổ vừa kéo, mà sync_month gọi
    days_back = month-to-date → ngày 1 hàng tháng cửa sổ co về 1 ngày và xoá sạch
    tháng trước (07/2026 mất hết, chỉ còn 31/07 là ngày biên).
    Khoá = (account_id, {id_col}, date); kéo lại cùng ngày thì sync_time mới nhất
    thắng, nên Meta chốt sổ muộn vẫn cập nhật được.
    """
    ds = f'{project_id}.{dataset}'
    if not _table_exists(client, f'{ds}.{table}_raw') and _table_exists(client, f'{ds}.{table}'):
        n = _query_into(client, f'SELECT * FROM `{ds}.{table}`', f'{ds}.{table}_raw')
        log.info(f"  {table}_raw: seed {n} dòng từ bảng hiện tại (chỉ 1 lần)")

    if rows:
        # KHÔNG dùng autodetect khi APPEND: nó suy `sync_time` thành TIMESTAMP trong
        # khi bảng raw là STRING → 400 "Field sync_time has changed type". Bản cũ
        # không dính vì WRITE_TRUNCATE tạo lại bảng mỗi lần. Lấy schema từ chính
        # bảng raw để append luôn khớp.
        from google.cloud import bigquery as _bq
        ndjson = '\n'.join(json.dumps(r, ensure_ascii=False) for r in rows)
        jc = _bq.LoadJobConfig(
            source_format=_bq.SourceFormat.NEWLINE_DELIMITED_JSON,
            write_disposition=_bq.WriteDisposition.WRITE_APPEND)
        if schema:
            jc.schema = schema
        elif _table_exists(client, f'{ds}.{table}_raw'):
            jc.schema = client.get_table(f'{ds}.{table}_raw').schema
        else:
            jc.autodetect = True
        client.load_table_from_file(
            io.BytesIO(ndjson.encode('utf-8')), f'{ds}.{table}_raw', job_config=jc).result()

    n = _query_into(client, f"""
        SELECT * EXCEPT(_rn) FROM (
            SELECT t.*, ROW_NUMBER() OVER (
                PARTITION BY account_id, {id_col}, date ORDER BY sync_time DESC
            ) AS _rn
            FROM `{ds}.{table}_raw` t
        ) WHERE _rn = 1
    """, f'{ds}.{table}')
    log.info(f"  {table}: {len(rows)} dòng kéo về → bảng {n} dòng (dựng lại từ raw)")
    return n


def append_and_rebuild_orders(client, project_id, dataset, all_orders, all_items,
                              order_schema, item_schema,
                              order_table='sale_order', item_table='order_items'):
    """Thay WRITE_TRUNCATE: ghi thêm vào <bảng>_raw rồi dựng lại bảng sạch từ raw.

    WRITE_TRUNCATE đặt cược cả bảng vào việc lần fetch này phải đầy đủ — kéo hụt là
    mất vĩnh viễn (04/08: sale_order tụt 4.440 → 3.960 trong 1 giờ). Với raw:
      <bảng>_raw : APPEND-only, mọi phiên bản từng thấy, KHÔNG BAO GIỜ bị ghi đè.
      <bảng>     : dựng lại = bản mới nhất mỗi đơn → consumer không phải sửa gì.
    Trả (số dòng bảng đơn, số dòng bảng item).
    """
    ds = f'{project_id}.{dataset}'

    # Seed 1 lần: chép bảng đang có sang raw, nếu không vòng đầu sẽ dựng lại bảng
    # CHỈ từ cửa sổ vừa kéo → đơn cũ ngoài cửa sổ biến mất.
    for t in (order_table, item_table):
        if not _table_exists(client, f'{ds}.{t}_raw') and _table_exists(client, f'{ds}.{t}'):
            n = _query_into(client, f'SELECT * FROM `{ds}.{t}`', f'{ds}.{t}_raw')
            log.info(f"  {t}_raw: seed {n} dòng từ bảng hiện tại (chỉ 1 lần)")

    # Chỉ append đơn MỚI hoặc vừa đổi trạng thái — không thì raw phình vô ích.
    # KHOÁ LÀ (shop_label, id) chứ KHÔNG phải id: POS đánh số đơn RIÊNG từng shop,
    # id=18 tồn tại ở cả 7 shop (đo 05/08: 20.257 id bị nhiều shop dùng chung).
    # Gom theo mình id là nhập 7 đơn khác nhau làm 1 — mất 24.791 đơn.
    known = {}
    if _table_exists(client, f'{ds}.{order_table}'):
        try:
            known = {f'{r.s}|{r.k}': (r.t or '') for r in client.query(
                f'SELECT shop_label AS s, id AS k, MAX(updated_at) AS t '
                f'FROM `{ds}.{order_table}` GROUP BY 1, 2'
            ).result()}
        except Exception as e:
            log.warning(f"  Không đọc được phiên bản hiện có ({e}) — append tất")

    def _okey(o):
        return f"{o.get('shop_label', '')}|{o.get('id', '')}"

    changed = [o for o in all_orders
               if str(o.get('updated_at', '')) > known.get(_okey(o), '')]
    ids = {(str(o.get('shop_id', '')), str(o.get('id', ''))) for o in changed}
    changed_items = [it for it in all_items
                     if (str(it.get('shop_id', '')), str(it.get('order_id', ''))) in ids]
    log.info(f"  Kéo về {len(all_orders)} đơn → {len(changed)} đơn mới/đổi trạng thái")

    if changed:
        _load_append(client, f'{ds}.{order_table}_raw', changed, order_schema)
        if changed_items:
            _load_append(client, f'{ds}.{item_table}_raw', changed_items, item_schema)

    n_orders = _query_into(client, f"""
        SELECT * EXCEPT(_rn) FROM (
            SELECT t.*, ROW_NUMBER() OVER (
                PARTITION BY shop_label, id ORDER BY updated_at DESC, sync_time DESC) AS _rn
            FROM `{ds}.{order_table}_raw` t
        ) WHERE _rn = 1
    """, f'{ds}.{order_table}')

    # Item: giữ TRỌN BỘ item của lần sync mới nhất mỗi đơn. Dedupe theo item_id sẽ
    # làm item đã bị xoá khỏi đơn sống mãi trong bảng.
    # Khoá đơn ở đây là (shop_id, order_id) — order_id cũng đánh số riêng từng shop.
    n_items = 0
    if _table_exists(client, f'{ds}.{item_table}_raw'):
        n_items = _query_into(client, f"""
            WITH latest AS (
                SELECT shop_id, order_id, MAX(sync_time) AS mx
                FROM `{ds}.{item_table}_raw` GROUP BY 1, 2
            )
            SELECT * EXCEPT(_rn) FROM (
                SELECT r.*, ROW_NUMBER() OVER (
                    PARTITION BY r.shop_id, r.order_id, r.item_id
                    ORDER BY r.sync_time DESC) AS _rn
                FROM `{ds}.{item_table}_raw` r
                JOIN latest l ON r.shop_id = l.shop_id
                             AND r.order_id = l.order_id AND r.sync_time = l.mx
            ) WHERE _rn = 1
        """, f'{ds}.{item_table}')

    log.info(f"  {order_table}: {n_orders} đơn · {item_table}: {n_items} item (dựng lại từ raw)")
    return n_orders, n_items


def upsert_orders(client, project_id, dataset, all_orders, all_items, order_schema, item_schema):
    """DELETE existing rows by ID, then APPEND new rows (upsert pattern).
    This replaces WRITE_TRUNCATE and preserves historical data.
    
    Args:
        client: BigQuery client
        project_id: BQ project ID
        dataset: BQ dataset name
        all_orders: list of order dicts
        all_items: list of item dicts
        order_schema: list of bigquery.SchemaField for sale_order
        item_schema: list of bigquery.SchemaField for order_items
    """
    from google.cloud import bigquery

    if not all_orders:
        log.info("  No orders to upsert")
        return

    # 1. Delete existing orders by ID
    order_ids = list(set(str(o['id']) for o in all_orders))
    # BQ IN clause has a limit of ~10000 items, batch if needed
    batch_size = 5000
    for i in range(0, len(order_ids), batch_size):
        batch = order_ids[i:i + batch_size]
        ids_str = ','.join(f"'{oid}'" for oid in batch)
        
        # Delete from sale_order
        try:
            q1 = f"DELETE FROM `{project_id}.{dataset}.sale_order` WHERE id IN ({ids_str})"
            job1 = client.query(q1)
            job1.result()
            log.info(f"  Deleted {job1.num_dml_affected_rows} existing orders (batch {i//batch_size + 1})")
        except Exception as e:
            log.warning(f"  Delete sale_order batch failed (table may not exist): {e}")

        # Delete from order_items
        try:
            q2 = f"DELETE FROM `{project_id}.{dataset}.order_items` WHERE order_id IN ({ids_str})"
            job2 = client.query(q2)
            job2.result()
            log.info(f"  Deleted {job2.num_dml_affected_rows} existing items (batch {i//batch_size + 1})")
        except Exception as e:
            log.warning(f"  Delete order_items batch failed: {e}")

    # 2. Append new orders
    ndjson = '\n'.join(json.dumps(r, ensure_ascii=False) for r in all_orders)
    job = client.load_table_from_file(
        io.BytesIO(ndjson.encode('utf-8')),
        f'{project_id}.{dataset}.sale_order',
        job_config=bigquery.LoadJobConfig(
            source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
            write_disposition=bigquery.WriteDisposition.WRITE_APPEND,
            schema=order_schema))
    job.result()
    log.info(f"  sale_order: {len(all_orders)} rows UPSERTED")

    # 3. Append new items
    if all_items:
        ndjson2 = '\n'.join(json.dumps(r, ensure_ascii=False) for r in all_items)
        job2 = client.load_table_from_file(
            io.BytesIO(ndjson2.encode('utf-8')),
            f'{project_id}.{dataset}.order_items',
            job_config=bigquery.LoadJobConfig(
                source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
                write_disposition=bigquery.WriteDisposition.WRITE_APPEND,
                schema=item_schema))
        job2.result()
        log.info(f"  order_items: {len(all_items)} rows UPSERTED")

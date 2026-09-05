"""
Shared utilities for incremental order sync across all projects.
Strategy: Smart Stop + atomic staging MERGE (load → temp table → transactional
DELETE-by-ID + INSERT). Replaces the old non-atomic DELETE-then-APPEND, which
duplicated rows when the DELETE failed (the APPEND ran anyway) or when two sync
runs overlapped (each APPENDed before the other's DELETE was visible).

Usage in project sync scripts:
    from sync.order_sync_utils import get_last_sync_ts, upsert_orders, should_stop_fetching
"""
import io, json, uuid, logging

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
    """Check if ALL orders on this page are older than last sync.
    Orders are sorted newest-first by POS API.
    Returns True if we can stop fetching (all orders already synced)."""
    if not last_sync_ts or not orders:
        return False
    # All orders on this page have updated_at <= last_sync_ts
    for o in orders:
        updated = o.get('updated_at', '')
        if updated > last_sync_ts:
            return False  # At least one newer order — keep fetching
    return True


def _load_staging(client, staging_fqn, rows, schema):
    """Load `rows` into a fresh staging table (WRITE_TRUNCATE). Returns row count."""
    from google.cloud import bigquery
    ndjson = '\n'.join(json.dumps(r, ensure_ascii=False) for r in rows)
    client.load_table_from_file(
        io.BytesIO(ndjson.encode('utf-8')), staging_fqn,
        job_config=bigquery.LoadJobConfig(
            source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
            write_disposition=bigquery.WriteDisposition.WRITE_TRUNCATE,
            schema=schema)).result()
    return len(rows)


def upsert_orders(client, project_id, dataset, all_orders, all_items, order_schema, item_schema):
    """Atomic upsert: load new rows into per-run staging tables, then replace the
    target rows for the affected order IDs inside a single BigQuery transaction.

    Why not DELETE-then-APPEND: that pattern was neither atomic nor idempotent —
    a failed DELETE (caught + logged) still ran the APPEND, and two overlapping
    sync runs each APPENDed before the other's DELETE was visible. Both produced
    duplicate rows, which double-counted COD revenue on the dashboards
    (counts used COUNT(DISTINCT id) so they stayed correct, hiding the bug).

    The staging MERGE is:
      • idempotent  — re-running the same batch yields the same end state;
      • atomic      — DELETE+INSERT commit together or roll back together;
      • self-dedup  — staging orders are de-duplicated by id (latest sync_time)
                       so a duplicated source page can never reach the target.

    Args:
        client: BigQuery client
        project_id: BQ project ID
        dataset: BQ dataset name
        all_orders: list of order dicts
        all_items: list of item dicts
        order_schema: list of bigquery.SchemaField for sale_order
        item_schema: list of bigquery.SchemaField for order_items
    """
    if not all_orders:
        log.info("  No orders to upsert")
        return

    tag = uuid.uuid4().hex[:8]
    stg_orders = f"{project_id}.{dataset}._stg_sale_order_{tag}"
    stg_items = f"{project_id}.{dataset}._stg_order_items_{tag}"

    order_cols = [f.name for f in order_schema]
    item_cols = [f.name for f in item_schema]
    # Prefer freshest row per id when the source page repeats an order.
    order_keys = set(order_cols)
    dedup_order_by = ", ".join(
        f"`{c}` DESC" for c in ("sync_time", "updated_at") if c in order_keys
    ) or "`id`"

    try:
        # 1. Load batches into isolated staging tables (no contention with target).
        n_orders = _load_staging(client, stg_orders, all_orders, order_schema)
        if all_items:
            _load_staging(client, stg_items, all_items, item_schema)

        # 2. Replace target rows for these IDs atomically.
        order_set = ", ".join(f"`{c}`" for c in order_cols)
        items_sql = ""
        if all_items:
            item_set = ", ".join(f"`{c}`" for c in item_cols)
            items_sql = f"""
  DELETE FROM `{project_id}.{dataset}.order_items`
  WHERE order_id IN (SELECT id FROM `{stg_orders}`);
  INSERT INTO `{project_id}.{dataset}.order_items` ({item_set})
  SELECT {item_set} FROM `{stg_items}`;"""
        else:
            # Order(s) now have no line items → drop any stale ones.
            items_sql = f"""
  DELETE FROM `{project_id}.{dataset}.order_items`
  WHERE order_id IN (SELECT id FROM `{stg_orders}`);"""

        script = f"""
BEGIN TRANSACTION;
  DELETE FROM `{project_id}.{dataset}.sale_order`
  WHERE id IN (SELECT id FROM `{stg_orders}`);
  INSERT INTO `{project_id}.{dataset}.sale_order` ({order_set})
  SELECT {order_set} FROM (
    SELECT * EXCEPT(_rn) FROM (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY {dedup_order_by}) AS _rn
      FROM `{stg_orders}`
    ) WHERE _rn = 1
  );{items_sql}
COMMIT TRANSACTION;
"""
        client.query(script).result()
        log.info(f"  sale_order: {n_orders} rows UPSERTED (atomic), "
                 f"order_items: {len(all_items)} rows")
    finally:
        # 3. Drop staging tables (best-effort; they are uniquely named per run).
        for stg in (stg_orders, stg_items):
            try:
                client.delete_table(stg, not_found_ok=True)
            except Exception as e:
                log.warning(f"  Could not drop staging {stg}: {e}")

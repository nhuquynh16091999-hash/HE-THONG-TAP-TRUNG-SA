#!/usr/bin/env python3
"""
TALPHA Dashboard Query Validator (B3)
======================================
Kiểm tra trước deploy:
  1. STATIC  — column refs trong API routes vs TALPHA_SCHEMA
  2. SQL VIEWS — column refs trong sql/talpha/views/ vs raw table schema
  3. LIVE BQ  — INFORMATION_SCHEMA.COLUMNS (nếu có bigquery_key.json)

Usage:
    python3 scripts/validate-dashboard-queries.py
    python3 scripts/validate-dashboard-queries.py --bq-check   # force live BQ
    python3 scripts/validate-dashboard-queries.py --no-bq      # skip live BQ

Exit 0 = PASS, Exit 1 = FAIL (column không tồn tại), Exit 2 = WARNING
"""
import os, re, sys, json
from pathlib import Path

# ─── Config ──────────────────────────────────────────────────────────────────

ROOT = Path(__file__).resolve().parent.parent
API_DIR = ROOT / "dashboard-ui" / "src" / "app" / "api" / "talpha"
SYNC_DIR = ROOT / "sync" / "core"
SQL_DIR = ROOT / "sql" / "talpha" / "views"
BQ_KEY = ROOT / "bigquery_key.json"

BQ_PROJECT = "talpha-faos-2026"
BQ_DATASET = "TALPHA_Dataset"

# ─── TALPHA Schema (source of truth — mirror của docs/TALPHA_DETAIL.md) ──────
#
# Thay đổi cột ở BQ → cập nhật đây → script tự bắt mọi chỗ dùng sai.

TALPHA_SCHEMA: dict[str, set[str]] = {
    "sale_order": {
        # identifiers
        "id", "shop_id", "shop_label",
        # status
        "status", "status_name", "status_category", "status_sub",
        # financials (POS minor-units: ÷100 → local currency)
        "total_price", "shipping_fee", "cod", "total_discount",
        "partner_fee", "return_fee", "surcharge", "money_to_collect",
        # quantity
        "total_quantity",
        # attribution
        "marketer", "ad_id", "adset_id", "ads_source",
        "page_id", "post_id",
        # UTM
        "p_utm_source", "p_utm_campaign", "p_utm_medium",
        "p_utm_content", "p_utm_term", "p_utm_id",
        # order currency
        "order_currency",
        # customer
        "customer_id", "customer_name", "bill_full_name", "bill_phone_number",
        # address
        "shipping_address", "shipping_province", "shipping_district",
        # logistics
        "partner", "warehouse_id", "tracking_link",
        # timestamps
        "inserted_at", "updated_at", "time_send_partner", "estimate_delivery_date",
        # meta
        "note", "tags", "order_link", "sync_time",
    },
    "fb_ads_data": {
        # date (DATE, không phải date_start)
        "date",
        # account
        "account_id", "account_name",
        # campaign hierarchy
        "campaign_id", "campaign_name",
        "adset_id", "adset_name",
        "ad_id", "ad_name",   # INT64 — join cần CAST AS STRING
        # performance
        "spend",              # ĐÃ là VND (accounts billed VND)
        "spend_usd",
        "impressions", "clicks",
        "messaging_conversations_started",
        "purchases",
    },
    "order_items": {
        "item_id", "order_id", "shop_id", "shop_name", "project_id",
        "product_id", "variation_id", "product_name", "variation_name", "barcode",
        "quantity", "return_quantity", "returned_count", "returning_quantity",
        "retail_price", "discount_each_product", "total_discount",
        "same_price_discount", "avg_imported_price",
        "is_bonus_product", "is_composite", "is_wholesale",
        "order_inserted_at", "sync_time",
    },
    "inventory_snapshot": {
        "payload", "snapshot_time",
        "source",  # detected via BQ INFORMATION_SCHEMA 2026-06-19
    },
}

# Columns từ computed views (output schema — dùng cho checks downstream)
TALPHA_VIEW_OUTPUT: dict[str, set[str]] = {
    "vw_fb_ads_std": {
        "ad_id", "ad_name", "adset_id", "adset_name",
        "campaign_id", "campaign_name", "account_id", "account_name",
        "date", "spend_vnd", "spend_aed", "impressions", "clicks",
        "messages", "purchases", "ctr_calc", "frequency",
        "mkter_code",
    },
    "vw_orders_std": {
        "order_date", "shop_label", "market_name",
        "revenue_aed", "cogs_aed",
        "shipping_fee_aed", "partner_fee_aed", "return_fee_aed",
        "is_valid", "is_confirmed", "is_returned",
        "resolved_ad_id", "resolved_adset_id",
        "marketer_name",
        "cod", "total_price", "status_category", "inserted_at",
    },
    "vw_fact_daily_pnl": {
        "report_date", "total_orders", "success_orders", "returned_orders",
        "provisional_revenue", "confirmed_revenue", "confirmed_cogs",
        "shipping_fee", "partner_fee", "return_fee", "ads_spend",
        "messages", "cost_per_msg", "clicks", "net_profit",
    },
    "vw_fact_daily_marketer": {
        "report_date", "marketer_name", "total_orders", "success_orders",
        "returned_orders", "revenue_aed", "ads_spend", "roas",
    },
    "vw_daily_momentum": {
        "report_date", "confirmed_revenue", "ads_spend", "roas",
        "success_orders", "net_profit",
    },
    "vw_marketer_momentum": {
        "marketer_name", "report_date", "revenue_aed", "ads_spend", "roas",
    },
    "vw_campaign_lifecycle": {
        "campaign_id", "campaign_name", "first_spend_date", "last_spend_date",
        "total_spend", "total_impressions", "total_clicks",
    },
    "vw_creative_fatigue": {
        "ad_id", "ad_name", "campaign_name", "date",
        "spend_vnd", "impressions", "ctr_calc", "frequency",
    },
}

# Tập hợp tất cả columns hợp lệ (raw + views)
ALL_VALID_COLS: set[str] = set()
for cols in {**TALPHA_SCHEMA, **TALPHA_VIEW_OUTPUT}.values():
    ALL_VALID_COLS.update(cols)


# ─── Helpers ─────────────────────────────────────────────────────────────────

_SQL_KEYWORDS = frozenset({
    # SQL clauses
    "select", "from", "where", "join", "on", "and", "or", "not",
    "is", "in", "as", "by", "group", "order", "limit", "having",
    "case", "when", "then", "else", "end", "between", "like",
    "inner", "left", "right", "outer", "cross", "union", "all",
    "distinct", "with", "insert", "update", "delete", "create",
    "table", "view", "partition", "over", "row_number", "rn",
    "begin", "commit", "transaction",
    # BigQuery types
    "string", "float64", "int64", "bool", "bytes", "date", "datetime",
    "timestamp", "numeric", "struct", "array",
    # BigQuery functions (tất cả function names)
    "cast", "safe_cast", "coalesce", "ifnull", "nullif", "isnull",
    "sum", "count", "countif", "max", "min", "avg", "any_value",
    "if", "iff", "case",
    "date_trunc", "date_diff", "date_add", "date_sub", "datetime_trunc",
    "timestamp_trunc", "timestamp_diff", "extract", "format_date",
    "datetime", "parse_date", "safe",
    "json_extract_scalar", "json_extract", "json_value",
    "safe_divide", "round", "floor", "ceil", "abs",
    "concat", "lower", "upper", "trim", "replace", "regexp_replace",
    "contains_substr", "ends_with", "starts_with",
    "row_number", "rank", "dense_rank", "lag", "lead", "ntile",
    "array_agg", "string_agg",
    "convert_timezone", "at", "zone", "interval",
    # BQ special
    "information_schema", "columns", "dataset",
    # JS keywords
    "const", "let", "var", "return", "for", "while", "function",
    "class", "new", "this", "true", "false", "null", "undefined",
    "typeof", "instanceof", "throw", "try", "catch", "finally",
    # Common JS identifiers that bleed in
    "data", "rows", "row", "result", "results", "error", "errors",
    "ok", "type", "name", "key", "value", "values",
    "entries", "properties", "description", "json", "tool",
    "query", "fetch", "load", "read", "write", "slice", "trim",
    "push", "pop", "map", "filter", "reduce", "find", "some", "every",
    "length", "index", "match", "search", "replace",
    # BQ table names (avoid flagging FROM sale_order as column)
    "sale_order", "fb_ads_data", "order_items", "inventory_snapshot",
    "vw_fb_ads_std", "vw_orders_std", "vw_fact_daily_pnl",
    "vw_fact_daily_marketer", "vw_daily_momentum", "vw_marketer_momentum",
    "vw_campaign_lifecycle", "vw_creative_fatigue",
    # Generic short tokens
    "base", "stg", "ord", "ads", "pnl", "tmp",
    # Vietnamese words that may appear in SQL comments
    "fallback", "draft",
})


def _extract_raw_table_cols(sql_text: str, table_name: str) -> set[str]:
    """Extract column refs từ SQL file, chỉ tính cols của table cụ thể.

    Strategy: tìm những chỗ có table_name hoặc alias đứng trước dấu chấm,
    hoặc các cột xuất hiện trong WHERE/ON/GROUP khi table là nguồn.
    """
    found: set[str] = set()
    # Bỏ comments SQL (-- ... và /* ... */)
    text = re.sub(r'--[^\n]*', ' ', sql_text)
    text = re.sub(r'/\*.*?\*/', ' ', text, flags=re.DOTALL)
    # Bỏ string literals
    text = re.sub(r"'[^']*'", " STRLIT ", text)

    # Tìm alias của table: FROM `...table_name` (AS)? alias
    alias_pat = rf'FROM\s+`[^`]*\.{re.escape(table_name)}`(?:\s+(?:AS\s+)?([a-z_]\w*))?'
    alias = None
    m = re.search(alias_pat, text, re.IGNORECASE)
    if m:
        alias = m.group(1)

    # Refs: alias.col hoặc table_name.col
    prefixes = [table_name]
    if alias:
        prefixes.append(alias)

    for prefix in prefixes:
        for m in re.finditer(rf'\b{re.escape(prefix)}\.([a-z_]\w*)\b', text, re.IGNORECASE):
            col = m.group(1).lower()
            if col not in _SQL_KEYWORDS:
                found.add(col)

    return found


def _extract_sql_cols_from_block(block: str) -> set[str]:
    """Extract column names từ 1 SQL block (conservative — ít false positives hơn)."""
    # Bỏ comments và string literals
    text = re.sub(r'--[^\n]*', ' ', block)
    text = re.sub(r'/\*.*?\*/', ' ', text, flags=re.DOTALL)
    text = re.sub(r"'[^']*'", " ", text)

    found: set[str] = set()
    # Chỉ lấy cols sau SELECT ... và JOIN ON ... và WHERE
    # Pattern conservative: col phải đứng sau SELECT, alias dot, hoặc WHERE/AND
    patterns = [
        # table.col hay alias.col
        r'(?<!\w)[a-z_]\w*\.([a-z_]\w*)\b',
        # SELECT col1, col2 (sau SELECT hoặc dấu phẩy, trước FROM)
        r'(?:SELECT|,)\s+([a-z_]\w*)(?:\s*(?:,|\s+FROM|\s+AS\b))',
        # WHERE/AND/OR col = ...
        r'(?:WHERE|AND|OR)\s+([a-z_]\w*)\s*(?:=|>|<|!=|IS\s|IN\s|BETWEEN\s|LIKE\s)',
        # GROUP BY col / ORDER BY col
        r'(?:GROUP\s+BY|ORDER\s+BY)\s+([a-z_]\w*)',
        # SUM(col), COUNT(col), etc — nhưng không phải function name
        r'(?:SUM|MAX|MIN|AVG|COUNTIF|IF|COALESCE|NULLIF|IFNULL)\(([a-z_]\w*)',
    ]
    for pat in patterns:
        for m in re.finditer(pat, text, re.IGNORECASE):
            tok = m.group(1).lower()
            if tok not in _SQL_KEYWORDS and len(tok) > 2:
                found.add(tok)
    return found


def check_static_api_routes() -> list[dict]:
    """Scan API routes trong api/talpha/ — tìm SQL blocks SELECT từ raw BQ tables."""
    issues = []
    raw_tables = set(TALPHA_SCHEMA.keys())

    for ts_file in sorted(API_DIR.rglob("route.ts")):
        text = ts_file.read_text(encoding="utf-8")

        # Chỉ lấy template literals là SQL (chứa SELECT + FROM + tên bảng TALPHA)
        sql_blocks = re.findall(r'`([^`]{30,})`', text, re.DOTALL)
        for block in sql_blocks:
            block_upper = block.upper()
            if "SELECT" not in block_upper or "FROM" not in block_upper:
                continue
            # Phải reference ít nhất 1 bảng TALPHA thật
            if not any(tbl in block for tbl in raw_tables):
                continue

            cols = _extract_sql_cols_from_block(block)
            for col in sorted(cols):
                if col not in ALL_VALID_COLS and col not in _SQL_KEYWORDS:
                    issues.append({
                        "file": str(ts_file.relative_to(ROOT)),
                        "col": col,
                        "source": "api_route",
                    })

    return issues


def check_sql_view_files() -> list[dict]:
    """Kiểm tra views sql/talpha/views/ — cols từ raw tables phải có trong TALPHA_SCHEMA."""
    issues = []
    if not SQL_DIR.exists():
        return issues

    raw_tables = list(TALPHA_SCHEMA.keys())
    for sql_file in sorted(SQL_DIR.glob("*.sql")):
        text = sql_file.read_text(encoding="utf-8")
        # Chỉ kiểm tra refs đến raw tables — extract alias.col hoặc table.col
        for table in raw_tables:
            if table not in text:
                continue
            used_cols = _extract_raw_table_cols(text, table)
            known_cols = TALPHA_SCHEMA[table]
            for col in sorted(used_cols):
                if col not in known_cols and col not in _SQL_KEYWORDS:
                    issues.append({
                        "file": str(sql_file.relative_to(ROOT)),
                        "table": table,
                        "col": col,
                        "source": "sql_view",
                    })

    return issues


def check_bq_live(force: bool = False) -> tuple[list[str], list[str]]:
    """Query INFORMATION_SCHEMA.COLUMNS và so sánh vs TALPHA_SCHEMA.

    Returns: (missing_cols, extra_cols_in_schema)
    missing_cols = có trong schema definition nhưng không có trong BQ thật
    """
    if not force and not BQ_KEY.exists():
        return [], []

    try:
        import subprocess
        result = subprocess.run(
            [sys.executable, "-c", f"""
import warnings; warnings.filterwarnings('ignore')
import os, json
os.environ.setdefault('GOOGLE_APPLICATION_CREDENTIALS', '{BQ_KEY}')
from google.cloud import bigquery
client = bigquery.Client(project='{BQ_PROJECT}')
q = '''
SELECT table_name, column_name
FROM `{BQ_PROJECT}.{BQ_DATASET}.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name IN ({', '.join(repr(t) for t in TALPHA_SCHEMA)})
ORDER BY table_name, ordinal_position
'''
rows = list(client.query(q).result())
out = {{}}
for r in rows:
    out.setdefault(r.table_name, []).append(r.column_name)
print(json.dumps(out))
"""],
            capture_output=True, text=True, timeout=30,
        )
        bq_cols: dict[str, list[str]] = json.loads(result.stdout.strip() or "{}")
    except Exception as e:
        print(f"  ⚠️  BQ live check failed: {e}")
        return [], []

    missing, extra = [], []
    for table, expected_cols in TALPHA_SCHEMA.items():
        actual_cols = set(bq_cols.get(table, []))
        if not actual_cols:
            print(f"  ⚠️  {table}: table not found in BQ (schema may not be deployed yet)")
            continue
        for col in sorted(expected_cols):
            if col not in actual_cols:
                missing.append(f"{table}.{col}")
        for col in sorted(actual_cols - expected_cols):
            extra.append(f"{table}.{col}")
    return missing, extra


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    force_bq = "--bq-check" in sys.argv
    skip_bq = "--no-bq" in sys.argv

    print(f"{'='*62}")
    print(f"  TALPHA Query Validator  (project: {BQ_PROJECT})")
    print(f"{'='*62}")

    total_errors = 0
    total_warnings = 0

    # ── Phase 1: Static column refs in API routes ──
    print("\n[1/3] Static analysis — api/talpha/ routes...")
    api_issues = check_static_api_routes()
    if api_issues:
        print(f"  ⚠️  {len(api_issues)} unknown column refs:")
        for issue in api_issues[:20]:
            print(f"     {issue['file']}: '{issue['col']}'")
        if len(api_issues) > 20:
            print(f"     ... và {len(api_issues)-20} khác")
        total_warnings += len(api_issues)
    else:
        print("  ✅ Không phát hiện column refs ngoài schema")

    # ── Phase 2: SQL view files ──
    print("\n[2/3] SQL views — sql/talpha/views/...")
    sql_issues = check_sql_view_files()
    if sql_issues:
        print(f"  ⚠️  {len(sql_issues)} unknown column refs trong view files:")
        for issue in sql_issues[:20]:
            print(f"     {issue['file']} [{issue['table']}]: '{issue['col']}'")
        if len(sql_issues) > 20:
            print(f"     ... và {len(sql_issues)-20} khác")
        total_warnings += len(sql_issues)
    else:
        print("  ✅ SQL views — column refs hợp lệ")

    # ── Phase 3: Live BQ check ──
    print(f"\n[3/3] Live BQ schema check — {BQ_DATASET}...")
    if skip_bq:
        print("  — SKIP (--no-bq)")
    elif not BQ_KEY.exists() and not force_bq:
        print(f"  — SKIP ({BQ_KEY.name} không tìm thấy; dùng --bq-check để override)")
    else:
        missing_cols, extra_cols = check_bq_live(force=force_bq)
        if missing_cols:
            print(f"  ❌ Columns trong schema nhưng KHÔNG có trong BQ ({len(missing_cols)}):")
            for c in missing_cols:
                print(f"     {c}")
            total_errors += len(missing_cols)
        else:
            print("  ✅ Tất cả columns định nghĩa đều tồn tại trong BQ")
        if extra_cols:
            print(f"  ℹ️  Columns trong BQ chưa đưa vào schema ({len(extra_cols)}):")
            for c in extra_cols[:10]:
                print(f"     {c}")
            if len(extra_cols) > 10:
                print(f"     ... và {len(extra_cols)-10} khác")

    # ── Phase 4: Schema self-check ──
    print("\n[4/4] Schema self-check...")
    dup_check: dict[str, list[str]] = {}
    for table, cols in TALPHA_SCHEMA.items():
        for col in cols:
            dup_check.setdefault(col, []).append(table)
    # Mỗi col nên xuất hiện trong ít nhất 1 table — ok.
    print(f"  ✅ Schema: {len(TALPHA_SCHEMA)} tables, "
          f"{sum(len(c) for c in TALPHA_SCHEMA.values())} columns defined")

    # ── Summary ──
    print(f"\n{'='*62}")
    if total_errors > 0:
        print(f"❌ FAIL — {total_errors} column(s) missing in BQ, {total_warnings} warning(s)")
        sys.exit(1)
    elif total_warnings > 0:
        print(f"⚠️  PASS with {total_warnings} warning(s) — review unknown column refs above")
        sys.exit(2)
    else:
        print("✅ ALL CHECKS PASSED")
        sys.exit(0)


if __name__ == "__main__":
    main()

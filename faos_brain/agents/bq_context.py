"""
faos_brain/agents/bq_context.py — Đọc BigQuery views → context gọn cho agent.

Trả về dict số liệu tóm tắt (KHÔNG phải raw rows) để nhét vào prompt LLM cho tiết kiệm token.
Nguồn: các view chuẩn hoá trong TALPHA_Dataset (GĐ B/C).
"""
import os
import logging
from google.oauth2.service_account import Credentials
from google.cloud import bigquery

log = logging.getLogger(__name__)

BQ_PROJECT = os.environ.get("BQ_PROJECT_ID", "talpha-faos-2026")
BQ_DATASET = os.environ.get("BQ_DATASET", "TALPHA_Dataset")
_KEY = "bigquery_key.json"


def _client() -> bigquery.Client:
    creds = Credentials.from_service_account_file(
        _KEY, scopes=["https://www.googleapis.com/auth/bigquery"]
    )
    return bigquery.Client(credentials=creds, project=BQ_PROJECT)


def _q(bq, sql: str) -> list[dict]:
    """Chạy query; nếu view/bảng thiếu (NotFound) → trả [] thay vì crash.

    Một số view phụ thuộc fb_ads_data (chưa sync) có thể 404; agent vẫn cần
    phân tích phần còn lại (orders/products/inventory).
    """
    from google.api_core.exceptions import NotFound, BadRequest
    try:
        return [dict(r) for r in bq.query(sql).result()]
    except (NotFound, BadRequest) as e:
        log.warning(f"[bq_context] query lỗi (bỏ qua phần này): {str(e)[:120]}")
        return []


def _r(v, n=1):
    """Làm tròn an toàn."""
    try:
        return round(float(v), n)
    except (TypeError, ValueError):
        return None


def pnl_summary(days: int = 30, bq=None) -> dict:
    """Tổng hợp P&L N ngày gần nhất từ vw_fact_daily_pnl."""
    bq = bq or _client()
    rows = _q(bq, f"""
        SELECT
            COUNT(*) AS days,
            SUM(total_orders)      AS orders,
            SUM(success_orders)    AS success_orders,
            SUM(confirmed_revenue) AS revenue,
            SUM(ads_spend)         AS ads,
            SUM(net_profit)        AS net_profit,
            SAFE_DIVIDE(SUM(confirmed_revenue), SUM(ads_spend)) AS roas,
            SAFE_DIVIDE(SUM(success_orders), SUM(total_orders)) * 100 AS success_rate
        FROM `{BQ_PROJECT}.{BQ_DATASET}.vw_fact_daily_pnl`
        WHERE report_date >= DATE_SUB(CURRENT_DATE(), INTERVAL {days} DAY)
    """)
    # Fallback: view P&L phụ thuộc fb_ads_data (có thể chưa sync). Nếu rỗng, đọc
    # vw_orders_std để vẫn có orders/doanh thu (không có ads/roas).
    # X13: KHÔNG query thẳng sale_order với `cod / 100` — số chia khác nhau theo shop
    # (Đài lưu nguyên TWD) và mỗi shop một loại tiền, cộng thẳng là số vô nghĩa.
    # vw_orders_std đã quy sẵn VND theo đúng số chia + tỷ giá của từng shop.
    source = "vw_fact_daily_pnl"
    if not rows or not rows[0].get("orders"):
        source = "vw_orders_std (fallback — thiếu ads data)"
        rows = _q(bq, f"""
            SELECT
                COUNT(DISTINCT order_uid) AS orders,
                COUNT(DISTINCT IF(is_confirmed, order_uid, NULL)) AS success_orders,
                SUM(IF(is_confirmed, revenue_vnd, 0)) AS revenue,
                SAFE_DIVIDE(COUNT(DISTINCT IF(is_confirmed, order_uid, NULL)),
                            COUNT(DISTINCT order_uid)) * 100 AS success_rate
            FROM `{BQ_PROJECT}.{BQ_DATASET}.vw_orders_std`
            WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL {days} DAY)
        """)

    r = rows[0] if rows else {}
    return {
        "period_days": days,
        "source": source,
        "orders": int(r.get("orders") or 0),
        "success_orders": int(r.get("success_orders") or 0),
        "revenue_local_or_vnd": _r(r.get("revenue"), 0),
        "ads_spend_vnd": _r(r.get("ads"), 0),
        "net_profit_vnd": _r(r.get("net_profit"), 0),
        "roas": _r(r.get("roas"), 2),
        "success_rate_pct": _r(r.get("success_rate"), 1),
    }


def marketer_breakdown(days: int = 30, limit: int = 8, bq=None) -> list[dict]:
    """Hiệu quả theo marketer từ vw_fact_daily_marketer."""
    bq = bq or _client()
    rows = _q(bq, f"""
        SELECT
            marketer_name,
            SUM(ads_spend)         AS ads,
            SUM(confirmed_revenue) AS revenue,
            SUM(success_orders)    AS orders,
            SAFE_DIVIDE(SUM(confirmed_revenue), SUM(ads_spend)) AS roas
        FROM `{BQ_PROJECT}.{BQ_DATASET}.vw_fact_daily_marketer`
        WHERE report_date >= DATE_SUB(CURRENT_DATE(), INTERVAL {days} DAY)
          AND marketer_name IS NOT NULL AND marketer_name != ''
        GROUP BY marketer_name
        ORDER BY revenue DESC
        LIMIT {limit}
    """)
    return [{
        "marketer": r["marketer_name"],
        "ads_vnd": _r(r["ads"], 0),
        "revenue_vnd": _r(r["revenue"], 0),
        "orders": int(r["orders"] or 0),
        "roas": _r(r["roas"], 2),
    } for r in rows]


def product_top(limit: int = 10, bq=None) -> list[dict]:
    """Top sản phẩm theo doanh thu từ vw_product_pnl."""
    bq = bq or _client()
    rows = _q(bq, f"""
        SELECT sku, product_name,
               SUM(units) AS units, SUM(revenue_local) AS revenue_local
        FROM `{BQ_PROJECT}.{BQ_DATASET}.vw_product_pnl`
        GROUP BY sku, product_name
        ORDER BY revenue_local DESC
        LIMIT {limit}
    """)
    return [{
        "sku": r["sku"],
        "name": r["product_name"],
        "units": int(r["units"] or 0),
        "revenue_local": _r(r["revenue_local"], 0),
    } for r in rows]


def momentum_signals(bq=None) -> dict:
    """Tín hiệu xu hướng mới nhất từ vw_daily_momentum (ngày gần nhất có data)."""
    bq = bq or _client()
    rows = _q(bq, f"""
        SELECT report_date, confirmed_roas, confirmed_roas_momentum,
               confirmed_revenue_momentum, orders_momentum, profit_momentum,
               phantom_revenue_warning, confirmed_revenue_dod_pct
        FROM `{BQ_PROJECT}.{BQ_DATASET}.vw_daily_momentum`
        ORDER BY report_date DESC
        LIMIT 1
    """)
    if not rows:
        return {}
    r = rows[0]
    return {
        "as_of": str(r["report_date"]),
        "roas": _r(r["confirmed_roas"], 2),
        "roas_momentum": _r(r["confirmed_roas_momentum"], 2),
        "revenue_momentum": _r(r["confirmed_revenue_momentum"], 2),
        "orders_momentum": _r(r["orders_momentum"], 2),
        "profit_momentum": _r(r["profit_momentum"], 2),
        "phantom_revenue_warning": r.get("phantom_revenue_warning"),
        "revenue_dod_pct": _r(r["confirmed_revenue_dod_pct"], 1),
    }


def build_full_context(days: int = 30) -> dict:
    """Gom tất cả context cho agent trong 1 lần (share 1 BQ client)."""
    bq = _client()
    return {
        "pnl": pnl_summary(days, bq=bq),
        "marketers": marketer_breakdown(days, bq=bq),
        "top_products": product_top(bq=bq),
        "momentum": momentum_signals(bq=bq),
    }

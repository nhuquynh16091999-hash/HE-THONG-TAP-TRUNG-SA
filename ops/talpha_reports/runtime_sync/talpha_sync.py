"""
TALPHA Full Sync — N8N-Free Edition v2
Replaces: [TALPHA] 02 Ads Sync, [TALPHA] 03 Merge & Dedup

8 Ad Accounts + 6 Poscake shops (SA/AE/KW/OM/QA/BH).
Uses AUUS1_META_ACCESS_TOKEN (same token as AUUS).

Usage:
  python talpha_sync.py            # Full sync (ads + orders)
  python talpha_sync.py --ads      # Ads only
  python talpha_sync.py --orders   # Orders only
  python talpha_sync.py --full     # Force full re-fetch orders
  python talpha_sync.py --test     # Test connections
  python talpha_sync.py --days 7   # Ads backfill 7 days
"""
import os, sys, json, io, time, logging, argparse, requests
from datetime import datetime, timedelta

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(os.path.dirname(SCRIPT_DIR))
os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = os.path.join(PROJECT_DIR, 'bigquery_key.json')
sys.stdout.reconfigure(encoding='utf-8')

from dotenv import load_dotenv
load_dotenv(os.path.join(PROJECT_DIR, '.env'))
from google.cloud import bigquery

# Dynamic config — reads from config/ad_accounts.json
import sys as _sys
_sys.path.insert(0, str(PROJECT_DIR))
from sync.config_loader import get_active_accounts, get_access_token
from sync.order_sync_utils import (
    get_last_sync_ts, should_stop_fetching, upsert_orders,
    trim_page_to_window, append_and_rebuild_orders,   # X1
    append_and_rebuild_ads,                            # X2
)

P = os.getenv('BQ_PROJECT_ID', 'levelup-465304')
DS = os.getenv('BQ_DATASET', 'TALPHA_Dataset')
FB_TOKEN = get_access_token('talpha') or os.environ.get('TALPHA_META_ACCESS_TOKEN', '') or os.environ.get('AUUS1_META_ACCESS_TOKEN', '')
FB_API_VERSION = 'v21.0'
DISCORD_WEBHOOK = os.environ.get('DISCORD_WEBHOOK_ETL', '')

# Load accounts dynamically (with name for logging)
_dynamic_accounts = get_active_accounts('talpha')
FB_AD_ACCOUNTS = [{'id': a['id'], 'name': a.get('name', a['id'])} for a in _dynamic_accounts] or [
    {'id': 'act_832444553250352', 'name': 'Mỹ phẩm 3 5/6/2026'},
    {'id': 'act_1990279368211651', 'name': 'Mỹ phẩm 2 6/5/2026'},
    {'id': 'act_1146444450958264', 'name': 'Mỹ phẩm 5/6/2026'},
    {'id': 'act_416558701342048', 'name': 'Tiểu Alpha 1'},
    {'id': 'act_4382396978703883', 'name': 'Trang sức 27/04/2026'},
    {'id': 'act_869269479518459', 'name': 'Mai 01'},
    {'id': 'act_1670165974333671', 'name': 'Nhật Bản - 03'},
    {'id': 'act_1284981146939856', 'name': 'Sỹ Lộc 03'},
    {'id': 'act_1543721207473858', 'name': 'Trung Đông múi h Mỹ'},
    {'id': 'act_1380444643991154', 'name': 'Trang sức 15/6/2026'},
]

log_file = os.path.join(PROJECT_DIR, 'logs', f'talpha_sync_{datetime.now().strftime("%Y%m%d_%H%M")}.log')
os.makedirs(os.path.dirname(log_file), exist_ok=True)
logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[logging.FileHandler(log_file, encoding='utf-8'), logging.StreamHandler(sys.stdout)])
log = logging.getLogger('talpha_sync')
client = bigquery.Client(project=P)
sync_time = datetime.utcnow().isoformat()

# POS API — 6 shops GCC (QA/BH chưa có API key, SA lỗi 500 intermittent)
POS_API_URL = "https://pos.pages.fm/api/v1"
POS_PAGE_SIZE = 100   # X1: POS nhận `page_size` (tối đa 100), KHÔNG nhận `per_page`
POS_SHOPS = [
    {"key": os.environ.get("TALPHA_POSCAKE_SA_KEY", ""), "label": "SA", "shop_id": "1328205216", "currency": "SAR"},
    {"key": os.environ.get("TALPHA_POSCAKE_AE_KEY", ""), "label": "AE", "shop_id": "1635200759", "currency": "AED"},
    {"key": os.environ.get("TALPHA_POSCAKE_KW_KEY", ""), "label": "KW", "shop_id": "1328205226", "currency": "KWD"},
    {"key": os.environ.get("TALPHA_POSCAKE_OM_KEY", ""), "label": "OM", "shop_id": "1942200986", "currency": "OMR"},
    {"key": os.environ.get("TALPHA_POSCAKE_QA_KEY", ""), "label": "QA", "shop_id": "1021271617", "currency": "QAR"},
    {"key": os.environ.get("TALPHA_POSCAKE_BH_KEY", ""), "label": "BH", "shop_id": "100943483",  "currency": "BHD"},
    {"key": os.environ.get("TALPHA_POSCAKE_TW_KEY", ""), "label": "TW", "shop_id": "1328343252", "currency": "TWD"},
]

# Mapping Poscake status_name → (category, sub)
STATUS_CATEGORY_MAP = {
    'delivered':      ('GIAO_THANH_CONG', 'da_nhan'),
    'received_money': ('GIAO_THANH_CONG', 'da_thu_tien'),
    'packing':        ('DANG_GIAO',       'dang_dong_hang'),
    'pending':        ('DANG_GIAO',       'cho_chuyen_hang'),
    'shipped':        ('DANG_GIAO',       'da_gui_hang'),
    'returning':      ('DON_HOAN',        'dang_hoan'),
    'returned':       ('DON_HOAN',        'da_hoan'),
    'canceled':       ('HUY',             'da_huy'),
    'new':            ('DON_THO',         'moi'),
    'submitted':      ('DA_XAC_NHAN',     'da_xac_nhan'),
    'waitting':       ('CHO_HANG',        'cho_hang'),
    'ordered':        ('DA_DAT_HANG',     'da_dat_hang'),
}


def ensure_dataset():
    """Create TALPHA_Dataset if it doesn't exist."""
    try:
        client.get_dataset(f'{P}.{DS}')
    except Exception:
        log.info(f"Creating dataset {DS}...")
        ds = bigquery.Dataset(f'{P}.{DS}')
        ds.location = 'US'
        client.create_dataset(ds)
        log.info(f"  Created {DS}")



def delete_date_range(table_name, since, until):
    """Delete rows in date range before re-inserting (MERGE strategy)."""
    q = f"DELETE FROM `{P}.{DS}.{table_name}` WHERE date >= '{since}' AND date <= '{until}'"
    try:
        job = client.query(q)
        job.result()
        log.info(f"  Deleted {table_name} rows for {since} → {until} ({job.num_dml_affected_rows} rows)")
    except Exception as e:
        log.warning(f"  Delete {table_name} failed (table may not exist yet): {e}")


# ═══ ORDER SYNC — Fetch từ Poscake API (6 shops GCC) ═══

def discover_shop_id(api_key: str) -> str:
    """Auto-discover shop_id từ API key (fallback nếu config thiếu)."""
    try:
        resp = requests.get(f"{POS_API_URL}/shops",
            params={"api_key": api_key}, timeout=15)
        data = resp.json()
        shops = data.get('data', [])
        if shops:
            return str(shops[0].get('id', ''))
    except Exception as e:
        log.warning(f"  Shop ID discovery failed: {e}")
    return ""


def fetch_orders_from_shop(api_key: str, shop_label: str, shop_id: str = "",
                            currency: str = "AED", window_start=None):
    """Fetch mọi đơn được TẠO từ `window_start` trở đi ở một Poscake shop.

    Args:
        api_key: API key của shop.
        shop_label: Tên market (SA/AE/KW/OM/QA/BH/TW).
        shop_id: Shop ID đã biết (nếu trống sẽ auto-discover).
        currency: Đơn vị tiền tệ của market.
        window_start: mốc `inserted_at` sớm nhất cần lấy. None = toàn bộ lịch sử.

    Returns:
        (orders, items): list các order và item rows.
    """
    if not shop_id:
        shop_id = discover_shop_id(api_key)
    if not shop_id:
        log.error(f"  Cannot discover shop_id for {shop_label}")
        return [], []

    log.info(f"  Fetching {shop_label} orders (shop={shop_id}, currency={currency})...")
    all_orders, all_items = [], []
    page = 1

    while True:
        # Retry từng page 5 lần (500/timeout/reset). Hết retry → RAISE, KHÔNG trả bộ thiếu.
        # Bug 06/07 12:00: SA reset ở page 11 → break trả 100/2210 đơn → bảng bị ghi đè thiếu
        # ~2000 đơn → Sheet sai số đơn hàng loạt (Chu Thuý 489→168).
        data = None
        last_err = None
        for _try in range(5):
            try:
                resp = requests.get(
                    f"{POS_API_URL}/shops/{shop_id}/orders",
                    # `page_size` mới là tên đúng — POS BỎ QUA `per_page` và luôn trả
                    # 10 đơn/request (probe 04/08). 100 đơn/request = ít hơn 10 lần request.
                    params={"api_key": api_key, "page": page, "page_size": POS_PAGE_SIZE},
                    timeout=60,
                )
                if resp.status_code >= 500:
                    last_err = f"HTTP {resp.status_code}"
                    time.sleep(5 * (_try + 1)); continue
                resp.raise_for_status()
                data = resp.json()
                break
            except Exception as e:
                last_err = e
                time.sleep(5 * (_try + 1))
        if data is None:
            raise RuntimeError(f"POS {shop_label} chết ở page {page} sau 5 lần thử: {last_err}")

        orders = data.get('data', [])
        if not orders:
            break

        # X1: cắt theo ngày TẠO (đúng chiều sắp xếp thật của feed) thay Smart Stop
        # theo updated_at — bản cũ dừng sớm ngẫu nhiên và cắt mất đơn COD giao muộn.
        orders, reached_end = trim_page_to_window(orders, window_start)

        for o in orders:
            marketer_raw = o.get('marketer')
            marketer_str = json.dumps(marketer_raw, ensure_ascii=False) if isinstance(marketer_raw, dict) else str(marketer_raw or '')

            order_row = {
                'id': str(o.get('id', '')),
                'shop_id': str(o.get('shop_id', shop_id)),
                'status': str(o.get('status', 0)),
                'status_name': str(o.get('status_name', '')),
                'total_price': float(o.get('total_price', 0) or 0),
                'shipping_fee': float(o.get('shipping_fee', 0) or 0),
                'cod': float(o.get('cod', 0) or 0),
                'total_discount': float(o.get('total_discount', 0) or 0),
                'partner_fee': float(o.get('partner_fee', 0) or 0),
                'return_fee': float(o.get('return_fee', 0) or 0),
                'surcharge': float(o.get('surcharge', 0) or 0),
                'money_to_collect': float(o.get('money_to_collect', 0) or 0),
                'total_quantity': str(o.get('total_quantity', 0) or 0),
                'marketer': marketer_str,
                'ad_id': str(o.get('ad_id', '') or ''),
                'adset_id': str(o.get('adset_id', '') or ''),
                'ads_source': str(o.get('ads_source', '') or ''),
                'page_id': str(o.get('page_id', '') or ''),
                'post_id': str(o.get('post_id', '') or ''),
                'p_utm_source': str(o.get('p_utm_source', '') or ''),
                'p_utm_campaign': str(o.get('p_utm_campaign', '') or ''),
                'p_utm_medium': str(o.get('p_utm_medium', '') or ''),
                'p_utm_content': str(o.get('p_utm_content', '') or ''),
                'p_utm_term': str(o.get('p_utm_term', '') or ''),
                'p_utm_id': str(o.get('p_utm_id', '') or ''),
                'order_currency': currency,
                'customer_id': str((o.get('customer') or {}).get('id', '')),
                'customer_name': str((o.get('customer') or {}).get('name', '')),
                'bill_full_name': str(o.get('bill_full_name', '') or ''),
                'bill_phone_number': str(o.get('bill_phone_number', '') or ''),
                'shipping_address': str((o.get('shipping_address') or {}).get('full_address', '') or ''),
                'shipping_province': str((o.get('shipping_address') or {}).get('province_name', '') or ''),
                'shipping_district': str((o.get('shipping_address') or {}).get('district_name', '') or ''),
                'partner': str(o.get('partner', '') or ''),
                'warehouse_id': str(o.get('warehouse_id', '') or ''),
                'tracking_link': str(o.get('tracking_link', '') or ''),
                'inserted_at': str(o.get('inserted_at', '') or ''),
                'updated_at': str(o.get('updated_at', '') or ''),
                'time_send_partner': str(o.get('time_send_partner', '') or ''),
                'estimate_delivery_date': str(o.get('estimate_delivery_date', '') or ''),
                'note': str(o.get('note', '') or ''),
                'tags': str(o.get('tags', '') or ''),
                'order_link': str(o.get('order_link', '') or ''),
                'sync_time': sync_time,
                'status_category': STATUS_CATEGORY_MAP.get(str(o.get('status_name', '')), ('UNKNOWN', 'unknown'))[0],
                'status_sub': STATUS_CATEGORY_MAP.get(str(o.get('status_name', '')), ('UNKNOWN', 'unknown'))[1],
                'shop_label': shop_label,
            }
            all_orders.append(order_row)

            for item in (o.get('items', []) or []):
                # Pancake lồng tên/giá trong variation_info (top-level KHÔNG có các field này
                # → trước 30/07 product_name/retail_price toàn rỗng/0). Verify bằng POS API live.
                vi = item.get('variation_info') or {}
                item_row = {
                    'item_id': str(item.get('id', '')),
                    'order_id': str(o.get('id', '')),
                    'shop_id': str(o.get('shop_id', shop_id)),
                    'shop_name': str(o.get('shop_name', '')),
                    'project_id': f'talpha_{shop_label.lower()}',
                    'product_id': str(item.get('product_id', '')),
                    'variation_id': str(item.get('variation_id', '')),
                    'product_name': str(vi.get('name', '') or item.get('product_name', '') or ''),
                    'variation_name': str(vi.get('detail', '') or item.get('variation_name', '') or ''),
                    'barcode': str(vi.get('barcode', '') or item.get('barcode', '') or ''),
                    'quantity': int(item.get('quantity', 0) or 0),
                    'return_quantity': int(item.get('return_quantity', 0) or 0),
                    'returned_count': int(item.get('returned_count', 0) or 0),
                    'returning_quantity': int(item.get('returning_quantity', 0) or 0),
                    'retail_price': float(vi.get('retail_price', 0) or item.get('retail_price', 0) or 0),
                    'discount_each_product': float(item.get('discount_each_product', 0) or 0),
                    'total_discount': float(item.get('total_discount', 0) or 0),
                    'same_price_discount': float(item.get('same_price_discount', 0) or 0),
                    'avg_imported_price': float(vi.get('last_imported_price', 0) or vi.get('avg_price', 0) or item.get('avg_imported_price', 0) or 0),
                    'is_bonus_product': str(item.get('is_bonus_product', 'false')),
                    'is_composite': str(item.get('is_composite', 'false')),
                    'is_wholesale': str(item.get('is_wholesale', 'false')),
                    'order_inserted_at': str(o.get('inserted_at', '') or ''),
                    'sync_time': sync_time,
                }
                all_items.append(item_row)

        if reached_end:
            log.info(f"  {shop_label}: hết cửa sổ tại page {page} (đơn tạo trước {window_start})")
            break

        if page % 20 == 0:
            log.info(f"    Page {page}: {len(all_orders)} orders, {len(all_items)} items")

        if len(orders) < POS_PAGE_SIZE:
            break
        page += 1
        time.sleep(0.3)

    log.info(f"  {shop_label}: {len(all_orders)} orders, {len(all_items)} items")
    return all_orders, all_items


ORDER_SCHEMA = [
    bigquery.SchemaField('id', 'STRING'), bigquery.SchemaField('shop_id', 'STRING'),
    bigquery.SchemaField('status', 'STRING'), bigquery.SchemaField('status_name', 'STRING'),
    bigquery.SchemaField('total_price', 'FLOAT64'), bigquery.SchemaField('shipping_fee', 'FLOAT64'),
    bigquery.SchemaField('cod', 'FLOAT64'), bigquery.SchemaField('total_discount', 'FLOAT64'),
    bigquery.SchemaField('partner_fee', 'FLOAT64'), bigquery.SchemaField('return_fee', 'FLOAT64'),
    bigquery.SchemaField('surcharge', 'FLOAT64'), bigquery.SchemaField('money_to_collect', 'FLOAT64'),
    bigquery.SchemaField('total_quantity', 'STRING'), bigquery.SchemaField('marketer', 'STRING'),
    bigquery.SchemaField('ad_id', 'STRING'), bigquery.SchemaField('adset_id', 'STRING'),
    bigquery.SchemaField('ads_source', 'STRING'), bigquery.SchemaField('page_id', 'STRING'),
    bigquery.SchemaField('post_id', 'STRING'), bigquery.SchemaField('p_utm_source', 'STRING'),
    bigquery.SchemaField('p_utm_campaign', 'STRING'), bigquery.SchemaField('p_utm_medium', 'STRING'),
    bigquery.SchemaField('p_utm_content', 'STRING'), bigquery.SchemaField('p_utm_term', 'STRING'),
    bigquery.SchemaField('p_utm_id', 'STRING'), bigquery.SchemaField('order_currency', 'STRING'),
    bigquery.SchemaField('customer_id', 'STRING'), bigquery.SchemaField('customer_name', 'STRING'),
    bigquery.SchemaField('bill_full_name', 'STRING'), bigquery.SchemaField('bill_phone_number', 'STRING'),
    bigquery.SchemaField('shipping_address', 'STRING'), bigquery.SchemaField('shipping_province', 'STRING'),
    bigquery.SchemaField('shipping_district', 'STRING'), bigquery.SchemaField('partner', 'STRING'),
    bigquery.SchemaField('warehouse_id', 'STRING'), bigquery.SchemaField('tracking_link', 'STRING'),
    bigquery.SchemaField('inserted_at', 'STRING'), bigquery.SchemaField('updated_at', 'STRING'),
    bigquery.SchemaField('time_send_partner', 'STRING'), bigquery.SchemaField('estimate_delivery_date', 'STRING'),
    bigquery.SchemaField('note', 'STRING'), bigquery.SchemaField('tags', 'STRING'),
    bigquery.SchemaField('order_link', 'STRING'), bigquery.SchemaField('sync_time', 'STRING'),
    bigquery.SchemaField('status_category', 'STRING'), bigquery.SchemaField('status_sub', 'STRING'),
    bigquery.SchemaField('shop_label', 'STRING'),
]
ITEM_SCHEMA = [
    bigquery.SchemaField('item_id', 'STRING'), bigquery.SchemaField('order_id', 'STRING'),
    bigquery.SchemaField('shop_id', 'STRING'), bigquery.SchemaField('shop_name', 'STRING'),
    bigquery.SchemaField('project_id', 'STRING'), bigquery.SchemaField('product_id', 'STRING'),
    bigquery.SchemaField('variation_id', 'STRING'), bigquery.SchemaField('product_name', 'STRING'),
    bigquery.SchemaField('variation_name', 'STRING'), bigquery.SchemaField('barcode', 'STRING'),
    bigquery.SchemaField('quantity', 'INT64'), bigquery.SchemaField('return_quantity', 'INT64'),
    bigquery.SchemaField('returned_count', 'INT64'), bigquery.SchemaField('returning_quantity', 'INT64'),
    bigquery.SchemaField('retail_price', 'FLOAT64'), bigquery.SchemaField('discount_each_product', 'FLOAT64'),
    bigquery.SchemaField('total_discount', 'FLOAT64'), bigquery.SchemaField('same_price_discount', 'FLOAT64'),
    bigquery.SchemaField('avg_imported_price', 'FLOAT64'), bigquery.SchemaField('is_bonus_product', 'STRING'),
    bigquery.SchemaField('is_composite', 'STRING'), bigquery.SchemaField('is_wholesale', 'STRING'),
    bigquery.SchemaField('order_inserted_at', 'STRING'), bigquery.SchemaField('sync_time', 'STRING'),
]


def sync_all_orders(window_start=None):
    """Fetch đơn TẠO từ `window_start` trở đi ở mọi shop rồi ghi vào BQ.

    X1 (04/08) — đổi hai chỗ:
    - Cửa sổ theo ngày TẠO (`inserted_at`) thay Smart Stop theo `updated_at`. Feed POS
      sắp theo inserted_at desc nên đây mới là điểm dừng đúng; bản cũ dừng sớm ngẫu
      nhiên, mỗi vòng cắt một chỗ (sale_order tụt 4.440 → 3.960 trong 1 giờ).
    - Ghi APPEND vào <bảng>_raw rồi dựng lại bảng sạch, thay WRITE_TRUNCATE. Kéo hụt
      không xoá được dữ liệu đã có → shop lỗi cũng không phải huỷ cả vòng ghi nữa.
    Caller: sync_month.py.
    """
    all_orders, all_items = [], []
    failed = []

    for shop in POS_SHOPS:
        if not shop["key"]:
            log.warning(f"  Skipping {shop['label']} — no API key")
            continue
        orders = items = None
        for attempt in range(3):
            try:
                orders, items = fetch_orders_from_shop(
                    shop["key"], shop["label"],
                    shop.get("shop_id", ""), shop.get("currency", "AED"),
                    window_start=window_start,
                )
                break
            except Exception as e:
                log.error(f"  {shop['label']} fetch lỗi (lần {attempt+1}/3): {e}")
                if attempt < 2:
                    time.sleep(30)
        if orders is None:
            failed.append(shop["label"])
            continue
        all_orders.extend(orders)
        all_items.extend(items)

    if not all_orders and failed:
        raise RuntimeError(f"sale_order sync HỦY: mọi shop fail {failed}")

    if all_orders:
        # Append không xoá gì nên thiếu 1 shop vẫn ghi được: đơn của shop lỗi chỉ giữ
        # bản cũ. Trước đây WRITE_TRUNCATE buộc phải huỷ cả vòng ghi, nếu không sẽ
        # xoá trắng đơn của shop đó.
        n_orders, n_items = append_and_rebuild_orders(
            client, P, DS, all_orders, all_items, ORDER_SCHEMA, ITEM_SCHEMA)
    else:
        log.warning("  Không fetch được order từ bất kỳ shop nào!")
        n_orders = n_items = 0

    # Vẫn raise để exit code ≠ 0 → report_health bắn cảnh báo; dữ liệu thì đã an toàn.
    if failed:
        raise RuntimeError(
            f"Đã ghi {n_orders} đơn nhưng shop {failed} fetch thất bại — "
            f"đơn của shop đó đang giữ bản cũ. Chạy lại khi POS ổn.")

    return n_orders, n_items


def sync_fb_ads(days_back=1, since=None, until=None):
    """Sync Facebook Ads → BigQuery (append vào *_raw rồi dựng lại bảng — X2).

    days_back : cửa sổ mặc định = từ (hôm nay − days_back) tới hôm nay.
    since/until: chỉ định thẳng khoảng ngày — dùng để BACKFILL tháng cũ. Cửa sổ chỉ
                quyết định ngày nào được LÀM MỚI, không xoá ngày nào (X2).
    """
    if not FB_TOKEN:
        log.error("AUUS1_META_ACCESS_TOKEN not set!")
        return 0, 0

    today = until or datetime.utcnow().strftime('%Y-%m-%d')
    since = since or (datetime.utcnow() - timedelta(days=days_back)).strftime('%Y-%m-%d')
    time_range = json.dumps({'since': since, 'until': today})
    all_ads, all_adsets = [], []
    failed_accounts = []

    for acct in FB_AD_ACCOUNTS:
        account_id = acct['id']
        account_name = acct['name']
        log.info(f"  {account_name} ({account_id})...")

        # Ad-level — retry + đợi rate-limit; account fail hẳn → RAISE (không ghi bộ thiếu).
        # Bug 06/07 08:08: Tiểu Alpha 1 timeout 60s + "request limit" → 0 rows → mất 61M spend.
        def _meta_get(url, params=None):
            last = None
            for _t in range(4):
                try:
                    rp = requests.get(url, params=params, timeout=90)
                    dd = rp.json()
                    if isinstance(dd, dict) and dd.get('error'):
                        msg = str(dd['error'].get('message', ''))
                        if 'limit' in msg.lower():
                            w = 60 * (_t + 1)
                            log.warning(f"    rate limit → chờ {w}s (lần {_t+1}/4)")
                            last = msg; time.sleep(w); continue
                        return dd
                    return dd
                except Exception as e:
                    last = e; time.sleep(5 * (_t + 1))
            raise RuntimeError(f"Meta fetch fail sau 4 lần: {last}")

        try:
            data = _meta_get(f'https://graph.facebook.com/{FB_API_VERSION}/{account_id}/insights',
                params={'level': 'ad', 'fields': 'ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,impressions,reach,clicks,cpm,ctr,cpc,frequency,actions,action_values,cost_per_action_type',
                    'time_range': time_range, 'time_increment': '1', 'access_token': FB_TOKEN, 'limit': '500'})
            if 'error' in data:
                raise RuntimeError(f"{account_name}: {data['error'].get('message','')[:150]}")
            rows = data.get('data', [])
            while 'paging' in data and 'next' in data['paging']:
                data = _meta_get(data['paging']['next'])
                if 'error' in data:
                    raise RuntimeError(f"{account_name} paging: {data['error'].get('message','')[:150]}")
                rows.extend(data.get('data', []))
                time.sleep(0.5)

            for r in rows:
                actions = r.get('actions', [])
                action_values = r.get('action_values', [])
                purchases = sum(int(a.get('value', 0)) for a in actions if a.get('action_type') == 'purchase')
                purchase_value = sum(float(a.get('value', 0)) for a in action_values if a.get('action_type') == 'purchase')
                leads = sum(int(a.get('value', 0)) for a in actions if a.get('action_type') == 'lead')
                messages = sum(int(a.get('value', 0)) for a in actions if a.get('action_type') == 'onsite_conversion.messaging_conversation_started_7d')
                atc = sum(int(a.get('value', 0)) for a in actions if a.get('action_type') == 'add_to_cart')
                
                all_ads.append({
                    'ad_id': str(r.get('ad_id', '')), 'ad_name': str(r.get('ad_name', '')),
                    'adset_id': str(r.get('adset_id', '')), 'adset_name': str(r.get('adset_name', '')),
                    'campaign_id': str(r.get('campaign_id', '')), 'campaign_name': str(r.get('campaign_name', '')),
                    'spend': float(r.get('spend', 0)), 'impressions': int(r.get('impressions', 0)),
                    'reach': int(r.get('reach', 0)), 'clicks': int(r.get('clicks', 0)),
                    'purchases': purchases, 'purchase_value': purchase_value,
                    'leads': float(leads), 'messaging_conversations_started': messages, 'add_to_cart': atc,
                    'cpm': float(r.get('cpm', 0)), 'ctr': float(r.get('ctr', 0)),
                    'cpc': float(r.get('cpc', 0)), 'frequency': float(r.get('frequency', 0)),
                    'date': str(r.get('date_start', '')),
                    'account_id': account_id.replace('act_', ''), 'account_name': account_name,
                    'project_id': 'TALPHA', 'sync_time': sync_time,
                })
            log.info(f"    Ads: {len(rows)} rows")
        except Exception as e:
            # 05/08: KHÔNG huỷ cả lượt nữa. Huỷ là hợp lý thời WRITE_TRUNCATE (ghi bộ
            # thiếu = xoá mất ngày cũ), nhưng nay ghi APPEND vào *_raw rồi dựng lại nên
            # bộ thiếu KHÔNG xoá được gì — account lỗi chỉ giữ số cũ. Huỷ cả lượt chỉ
            # khiến 13 account kia mất công kéo (backfill tháng 5 đã hỏng 2 lượt vì thế).
            # Vẫn raise ở CUỐI hàm để exit code ≠ 0 → report_health bắn cảnh báo.
            log.error(f"  {account_name} fetch fail: {e} — bỏ qua account này, ghi tiếp phần còn lại")
            failed_accounts.append(account_name)
            continue

        # Adset-level
        try:
            resp2 = requests.get(f'https://graph.facebook.com/{FB_API_VERSION}/{account_id}/insights',
                params={'level': 'adset', 'fields': 'adset_id,adset_name,campaign_id,campaign_name,spend,impressions,reach,clicks,cpm,ctr,cpc,frequency,actions,action_values',
                    'time_range': time_range, 'time_increment': '1', 'access_token': FB_TOKEN, 'limit': '500'}, timeout=60)
            data2 = resp2.json()
            if 'error' in data2: continue
            rows2 = data2.get('data', [])
            while 'paging' in data2 and 'next' in data2['paging']:
                resp2 = requests.get(data2['paging']['next'], timeout=60)
                data2 = resp2.json()
                rows2.extend(data2.get('data', []))
            for r in rows2:
                a2 = r.get('actions', []); av2 = r.get('action_values', [])
                all_adsets.append({
                    'adset_id': str(r.get('adset_id', '')), 'adset_name': str(r.get('adset_name', '')),
                    'campaign_id': str(r.get('campaign_id', '')), 'campaign_name': str(r.get('campaign_name', '')),
                    'spend': float(r.get('spend', 0)), 'impressions': int(r.get('impressions', 0)),
                    'reach': int(r.get('reach', 0)), 'clicks': int(r.get('clicks', 0)),
                    'cpm': float(r.get('cpm', 0)), 'ctr': float(r.get('ctr', 0)),
                    'cpc': float(r.get('cpc', 0)), 'frequency': float(r.get('frequency', 0)),
                    'purchases': sum(int(a.get('value', 0)) for a in a2 if a.get('action_type') == 'purchase'),
                    'purchase_value': sum(float(a.get('value', 0)) for a in av2 if a.get('action_type') == 'purchase'),
                    'leads': sum(int(a.get('value', 0)) for a in a2 if a.get('action_type') == 'lead'),
                    'messaging_conversations_started': sum(int(a.get('value', 0)) for a in a2 if a.get('action_type') == 'onsite_conversion.messaging_conversation_started_7d'),
                    'date': str(r.get('date_start', '')),
                    'account_id': account_id.replace('act_', ''), 'account_name': account_name,
                    'project_id': 'TALPHA', 'sync_time': sync_time,
                })
            log.info(f"    Adsets: {len(rows2)} rows")
        except Exception as e:
            log.error(f"    Adset error: {e}")
        time.sleep(1)

    # Upload — WRITE_TRUNCATE thay bảng nguyên khối (atomic). KHÔNG cần DROP trước và
    # KHÔNG dùng delete_date_range (DML bị free tier chặn → trước đây dựa vào sync_month
    # DROP bảng, chính là nguồn mất dữ liệu khi fetch chết giữa chừng).
    # Bảng = toàn bộ window since→today (sync_month luôn truyền từ đầu tháng).
    # X2: raw/rebuild thay WRITE_TRUNCATE — cửa sổ chỉ quyết định NGÀY NÀO ĐƯỢC LÀM
    # MỚI, không còn quyết định ngày nào bị xoá. Trước đây sang tháng mới là mất sạch
    # tháng trước (07/2026 chỉ còn 31/07 — đúng ngày biên của cửa sổ 01/08).
    n_ads = n_adsets = 0
    if all_ads:
        n_ads = append_and_rebuild_ads(client, P, DS, all_ads, None, 'fb_ads_data', 'ad_id')
    if all_adsets:
        n_adsets = append_and_rebuild_ads(client, P, DS, all_adsets, None, 'fb_adset_data', 'adset_id')
    log.info(f"  ads window {since} → {today} (chỉ làm mới, không xoá lịch sử)")

    # Đã ghi xong phần lấy được rồi mới báo lỗi — để exit code ≠ 0 cho report_health
    # bắn cảnh báo, nhưng không vứt công sức của các account chạy được.
    if failed_accounts:
        raise RuntimeError(
            f"Đã ghi {n_ads} dòng ads nhưng {len(failed_accounts)} account fetch thất bại "
            f"{failed_accounts} — spend của account đó đang giữ số cũ. Chạy lại khi Meta ổn.")

    return n_ads, n_adsets


# ═══ AD DICTIONARY — X9 (05/08) ═══

def sync_ad_dictionary(max_ids=600):
    """Tra Meta cho các ad_id nằm trên ĐƠN nhưng không có trong fb_ads_data → bảng
    `ad_dictionary` (ad_id, account, campaign_name) để attribution bậc 2 nối được đơn.

    Vì sao cần: insights chỉ trả ad_id HIỆN TẠI của ad. Ad bị xoá/tạo lại thì id cũ
    (đã đóng dấu vào đơn qua utm lúc khách bấm) không bao giờ xuất hiện trong
    fb_ads_data — nhưng hỏi thẳng /{ad_id} thì Meta vẫn trả account + campaign.
    Ngoài ra bắt luôn ad của TKQC NGOÀI roster (team khác chung shop POS).

    Append-only + lọc "đã tra rồi" trước khi gọi → không tra lại, không trùng.
    Id tra lỗi cũng ghi lại (status='error') để không hỏi Meta mãi một id chết.
    """
    dic_table = f'{P}.{DS}.ad_dictionary'
    try:
        client.get_table(dic_table)
        not_in_dic = f"AND id NOT IN (SELECT ad_id FROM `{dic_table}`)"
    except Exception:
        not_in_dic = ""   # bảng chưa tồn tại — vòng đầu tra tất

    rows = list(client.query(f"""
        WITH need AS (
            SELECT DISTINCT
                CASE WHEN o.p_utm_term IS NOT NULL AND LENGTH(o.p_utm_term) > 10
                          AND REGEXP_CONTAINS(o.p_utm_term, r'^[0-9]+$') THEN o.p_utm_term
                     WHEN o.ad_id IS NOT NULL AND TRIM(o.ad_id) != '' THEN o.ad_id
                END AS id
            FROM `{P}.{DS}.sale_order` o
        )
        SELECT id FROM need
        WHERE id IS NOT NULL
          AND id NOT IN (SELECT CAST(ad_id AS STRING) FROM `{P}.{DS}.fb_ads_data` WHERE ad_id IS NOT NULL)
          {not_in_dic}
        LIMIT {max_ids}""").result())
    ids = [r.id for r in rows]
    if not ids:
        log.info("  ad_dictionary: không có id mới cần tra")
        return 0

    log.info(f"  ad_dictionary: tra Meta {len(ids)} ad_id lạ (batch 50)...")
    out, acc_names = [], {}
    for i in range(0, len(ids), 50):
        batch = ids[i:i+50]
        try:
            resp = requests.get(
                f'https://graph.facebook.com/{FB_API_VERSION}/',
                params={'ids': ','.join(batch),
                        'fields': 'account_id,name,campaign{id,name}',
                        'access_token': FB_TOKEN},
                timeout=90)
            data = resp.json()
        except Exception as e:
            log.warning(f"  ad_dictionary batch lỗi mạng: {e} — bỏ batch, vòng sau tra lại")
            continue
        if isinstance(data, dict) and data.get('error'):
            # cả batch fail (thường 1 id làm hỏng cả lô) → tra lẻ từng id
            data = {}
            for aid in batch:
                try:
                    d1 = requests.get(f'https://graph.facebook.com/{FB_API_VERSION}/{aid}',
                        params={'fields': 'account_id,name,campaign{id,name}',
                                'access_token': FB_TOKEN}, timeout=30).json()
                    data[aid] = d1
                except Exception:
                    data[aid] = {'error': True}
                time.sleep(0.2)
        for aid in batch:
            d = data.get(aid) or {}
            if not d or d.get('error'):
                out.append({'ad_id': aid, 'account_id': '', 'account_name': '',
                            'campaign_id': '', 'campaign_name': '', 'ad_name': '',
                            'status': 'error', 'sync_time': sync_time})
                continue
            acc = str(d.get('account_id', '') or '')
            if acc and acc not in acc_names:
                try:
                    an = requests.get(f'https://graph.facebook.com/{FB_API_VERSION}/act_{acc}',
                        params={'fields': 'name', 'access_token': FB_TOKEN}, timeout=30).json()
                    acc_names[acc] = str(an.get('name', '') or '')
                except Exception:
                    acc_names[acc] = ''
            camp = d.get('campaign') or {}
            out.append({'ad_id': aid, 'account_id': acc,
                        'account_name': acc_names.get(acc, ''),
                        'campaign_id': str(camp.get('id', '') or ''),
                        'campaign_name': str(camp.get('name', '') or ''),
                        'ad_name': str(d.get('name', '') or ''),
                        'status': 'ok', 'sync_time': sync_time})
        time.sleep(0.5)

    if not out:
        return 0
    schema = [bigquery.SchemaField(n, 'STRING') for n in
              ('ad_id', 'account_id', 'account_name', 'campaign_id',
               'campaign_name', 'ad_name', 'status', 'sync_time')]
    ndjson = '\n'.join(json.dumps(r, ensure_ascii=False) for r in out)
    client.load_table_from_file(
        io.BytesIO(ndjson.encode('utf-8')), dic_table,
        job_config=bigquery.LoadJobConfig(
            source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
            write_disposition=bigquery.WriteDisposition.WRITE_APPEND,
            schema=schema)).result()
    ok = sum(1 for r in out if r['status'] == 'ok')
    log.info(f"  ad_dictionary: +{len(out)} id ({ok} tra được, {len(out)-ok} lỗi)")
    return len(out)


# ═══ CAMPAIGN BUDGET SYNC ═══

def sync_campaign_data():
    """Sync campaign budgets từ Meta API → fb_campaign_data (daily_budget cho PacingCalculator)."""
    if not FB_TOKEN:
        log.error("TALPHA_META_ACCESS_TOKEN not set!")
        return 0
    all_campaigns = []
    for acct in FB_AD_ACCOUNTS:
        account_id = acct['id'] if isinstance(acct, dict) else acct
        acct_short = account_id.replace('act_', '')
        try:
            resp = requests.get(
                f'https://graph.facebook.com/{FB_API_VERSION}/{account_id}/campaigns',
                params={'fields': 'id,name,status,effective_status,daily_budget,lifetime_budget,budget_remaining,objective,start_time,stop_time',
                        'effective_status': '["ACTIVE","PAUSED","ARCHIVED"]', 'limit': '500', 'access_token': FB_TOKEN},
                timeout=60)
            data = resp.json()
            if 'error' in data:
                log.error(f"  Campaign API error {account_id}: {data['error'].get('message','')}")
                continue
            rows = data.get('data', [])
            while 'paging' in data and 'next' in data.get('paging', {}):
                resp = requests.get(data['paging']['next'], timeout=60); data = resp.json(); rows.extend(data.get('data', []))
            for r in rows:
                all_campaigns.append({
                    'campaign_id': str(r.get('id', '')), 'campaign_name': str(r.get('name', '')),
                    'status': str(r.get('status', '')), 'effective_status': str(r.get('effective_status', '')),
                    'daily_budget': float(r.get('daily_budget') or 0) / 100,
                    'lifetime_budget': float(r.get('lifetime_budget') or 0) / 100,
                    'budget_remaining': float(r.get('budget_remaining') or 0) / 100,
                    'objective': str(r.get('objective', '')),
                    'start_time': str(r.get('start_time', '') or ''), 'stop_time': str(r.get('stop_time', '') or ''),
                    'account_id': acct_short, 'sync_time': sync_time,
                })
            log.info(f"    Campaigns {account_id}: {len(rows)} rows")
        except Exception as e:
            log.error(f"    Campaign error {account_id}: {e}")
    if not all_campaigns:
        return 0
    import io as _io
    ndjson = '\n'.join(json.dumps(r, ensure_ascii=False) for r in all_campaigns)
    jc = bigquery.LoadJobConfig(source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
        write_disposition=bigquery.WriteDisposition.WRITE_TRUNCATE,
        schema=[
            bigquery.SchemaField('campaign_id', 'STRING'), bigquery.SchemaField('campaign_name', 'STRING'),
            bigquery.SchemaField('status', 'STRING'), bigquery.SchemaField('effective_status', 'STRING'),
            bigquery.SchemaField('daily_budget', 'FLOAT64'), bigquery.SchemaField('lifetime_budget', 'FLOAT64'),
            bigquery.SchemaField('budget_remaining', 'FLOAT64'), bigquery.SchemaField('objective', 'STRING'),
            bigquery.SchemaField('start_time', 'STRING'), bigquery.SchemaField('stop_time', 'STRING'),
            bigquery.SchemaField('account_id', 'STRING'), bigquery.SchemaField('sync_time', 'STRING'),
        ])
    client.load_table_from_file(_io.BytesIO(ndjson.encode('utf-8')), f'{P}.{DS}.fb_campaign_data', job_config=jc).result()
    log.info(f"fb_campaign_data: {len(all_campaigns)} campaigns synced")
    return len(all_campaigns)


def main():
    parser = argparse.ArgumentParser(description='TALPHA Full Sync v2')
    parser.add_argument('--ads', action='store_true', help='Sync FB Ads only')
    parser.add_argument('--orders', action='store_true', help='Sync Orders only')
    parser.add_argument('--full', action='store_true', help='Force full re-fetch orders')
    parser.add_argument('--test', action='store_true', help='Test connections')
    parser.add_argument('--days', type=int, default=1, help='Days back for ads')
    args = parser.parse_args()

    start = datetime.now()
    run_all = not (args.ads or args.orders)
    results = {'errors': []}

    log.info("═" * 60)
    log.info("TALPHA SYNC v2 — Python (N8N-Free)")
    log.info(f"Mode: {'FULL' if run_all else 'PARTIAL'} | Incremental: {not args.full}")
    log.info("═" * 60)

    if args.test:
        log.info("Testing FB token...")
        r = requests.get(f'https://graph.facebook.com/{FB_API_VERSION}/me', params={'access_token': FB_TOKEN}, timeout=10)
        log.info(f"  FB: {r.status_code} — {r.json().get('name', r.json().get('error',{}).get('message','?'))}")
        log.info(f"  Ad accounts: {len(FB_AD_ACCOUNTS)}")
        log.info("Testing POS API...")
        for shop in POS_SHOPS:
            if shop["key"]:
                sid = discover_shop_id(shop["key"])
                log.info(f"  {shop['label']}: shop_id={sid or 'NOT FOUND'}")
            else:
                log.info(f"  {shop['label']}: NO API KEY")
        return

    ensure_dataset()

    # Step 1: Orders
    if run_all or args.orders:
        log.info(f"\n[1/3] Syncing Orders (6 shops GCC)...")
        try:
            # X1: cửa sổ theo ngày TẠO. --full = kéo toàn bộ lịch sử (backfill).
            win = None if args.full else (
                datetime.now() - timedelta(days=int(os.getenv('TALPHA_ORDER_WINDOW_DAYS', '30')))
            ).strftime('%Y-%m-%dT00:00:00')
            log.info(f"  Cửa sổ đơn: {'TOÀN BỘ lịch sử' if win is None else f'tạo từ {win}'}")
            orders, items = sync_all_orders(window_start=win)
            results['orders'] = orders
            results['items'] = items
        except Exception as e:
            log.error(f"  Orders failed: {e}")
            results['errors'].append(str(e))

    # Step 2: FB Ads
    if run_all or args.ads:
        log.info(f"\n[2/3] Syncing FB Ads (last {args.days} days)...")
        try:
            ads, adsets = sync_fb_ads(days_back=args.days)
            results['ads'] = ads
            results['adsets'] = adsets
        except Exception as e:
            log.error(f"  Ads failed: {e}")
            results['errors'].append(str(e))

    # Step 3: Campaign Budgets
    if run_all or args.ads:
        log.info("\n[3/3] Syncing campaign budgets (daily_budget)...")
        try:
            results['campaigns'] = sync_campaign_data()
        except Exception as e:
            log.error(f"  Campaign sync failed: {e}")
            results['errors'].append(str(e))

    elapsed = (datetime.now() - start).total_seconds()
    log.info(f"\nDONE — {results} | {elapsed:.0f}s")

    if DISCORD_WEBHOOK:
        try:
            requests.post(DISCORD_WEBHOOK, json={'embeds': [{'title': '✅ TALPHA Sync v2', 'color': 0x2ECC71,
                'fields': [
                    {'name': 'Orders', 'value': str(results.get('orders', 0)), 'inline': True},
                    {'name': 'Ads', 'value': str(results.get('ads', 0)), 'inline': True},
                    {'name': 'Errors', 'value': str(len(results.get('errors', []))), 'inline': True},
                ]}]}, timeout=10)
        except: pass


if __name__ == '__main__':
    main()

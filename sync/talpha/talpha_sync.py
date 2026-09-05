"""
TALPHA Full Sync — v3 (sync/core refactor)

Orchestrator mỏng: mọi business logic nằm trong sync/core/.

Usage:
  python talpha_sync.py            # Full sync (ads + orders)
  python talpha_sync.py --ads      # Ads only
  python talpha_sync.py --orders   # Orders only
  python talpha_sync.py --full     # Force full re-fetch (bỏ qua Smart Stop)
  python talpha_sync.py --test     # Test connections
  python talpha_sync.py --days 7   # Ads backfill 7 ngày
  python talpha_sync.py --shadow   # Ghi vào bảng *_shadow (shadow-run song song runtime)
"""
import os, sys, json, time, logging, argparse, requests
from datetime import datetime, timedelta

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(os.path.dirname(SCRIPT_DIR))
os.environ.setdefault('GOOGLE_APPLICATION_CREDENTIALS', os.path.join(PROJECT_DIR, 'bigquery_key.json'))
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, PROJECT_DIR)

from dotenv import load_dotenv
load_dotenv(os.path.join(PROJECT_DIR, '.env'))

from google.cloud import bigquery

# ── sync/core imports ────────────────────────────────────────────
from sync.core.business_rules import STATUS_CATEGORY_MAP
from sync.core.bq_writer import (
    load_truncate, load_append, ensure_dataset, get_last_sync_ts,
    append_and_rebuild_orders, append_and_rebuild_ads,
)
from sync.core.pos_client import PoscakeClient, PosFetchError
from sync.core.meta_client import MetaAdsClient, TALPHA_AD_ACCOUNTS, MetaFetchError
from sync.config_loader import get_active_accounts

# ── Config ───────────────────────────────────────────────────────
P  = os.getenv('BQ_PROJECT_ID', 'cty-507710')
DS = os.getenv('BQ_DATASET',    'TALPHA_Dataset')
FB_TOKEN = (
    os.environ.get('TALPHA_META_ACCESS_TOKEN', '') or
    os.environ.get('AUUS1_META_ACCESS_TOKEN', '')
)
DISCORD_WEBHOOK = os.environ.get('DISCORD_WEBHOOK_ETL', '')

POS_SHOPS = [
    # HỆ MỚI 05/09/2026: MỘT thị trường Đài Loan ⇒ MỘT shop POS.
    # 6 shop GCC (SA/AE/KW/OM/QA/BH) đã ngừng — bỏ khỏi sync để không kéo về
    # đơn của thị trường không còn kinh doanh. Cần bật lại thì thêm dòng ở đây
    # VÀ khai market tương ứng trong config/talpha_rules.json → markets.
    {"key": os.environ.get("TALPHA_POSCAKE_TW_KEY", ""), "label": "TW", "shop_id": "1328343252", "currency": "TWD"},
]

# ── Logging ──────────────────────────────────────────────────────
log_dir = os.path.join(PROJECT_DIR, 'logs')
os.makedirs(log_dir, exist_ok=True)
log_file = os.path.join(log_dir, f'talpha_sync_{datetime.now().strftime("%Y%m%d_%H%M")}.log')
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler(log_file, encoding='utf-8'),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger('talpha_sync')

client   = bigquery.Client(project=P)
sync_time = datetime.utcnow().isoformat()

# ── Table suffix (--shadow → '_shadow') ─────────────────────────
# Chỉ đổi TÊN BẢNG ĐÍCH khi ghi; không đổi bất kỳ logic nào khác.
TABLE_SUFFIX = ''

def _tbl(name: str) -> str:
    """Tên bảng đích thực tế (thêm hậu tố khi chạy --shadow)."""
    return f"{name}{TABLE_SUFFIX}"

# ── Ad accounts: đọc từ ad_accounts.json qua config_loader ──────
# Fallback: hard-code TALPHA_AD_ACCOUNTS trong meta_client (cảnh báo rõ).
def _load_ad_accounts() -> list[dict]:
    try:
        accts = get_active_accounts('talpha')
    except Exception as e:
        log.warning(f"⚠️ Lỗi đọc ad_accounts.json ({e}) — FALLBACK hard-code "
                    f"TALPHA_AD_ACCOUNTS ({len(TALPHA_AD_ACCOUNTS)} account). "
                    f"Danh sách có thể THIẾU account mới!")
        return TALPHA_AD_ACCOUNTS
    if not accts:
        log.warning(f"⚠️ ad_accounts.json không tìm thấy / rỗng — FALLBACK hard-code "
                    f"TALPHA_AD_ACCOUNTS ({len(TALPHA_AD_ACCOUNTS)} account). "
                    f"Danh sách có thể THIẾU account mới!")
        return TALPHA_AD_ACCOUNTS
    log.info(f"Ad accounts: {len(accts)} active từ ad_accounts.json")
    return [{'id': a['id'], 'name': a.get('name', a['id'])} for a in accts]

AD_ACCOUNTS = _load_ad_accounts()

# ── BQ Schemas ───────────────────────────────────────────────────
F = bigquery.SchemaField
ORDER_SCHEMA = [
    F('id','STRING'), F('shop_id','STRING'), F('shop_label','STRING'),
    F('status','STRING'), F('status_name','STRING'),
    F('status_category','STRING'), F('status_sub','STRING'),
    F('total_price','FLOAT64'), F('shipping_fee','FLOAT64'), F('cod','FLOAT64'),
    F('total_discount','FLOAT64'), F('partner_fee','FLOAT64'), F('return_fee','FLOAT64'),
    F('surcharge','FLOAT64'), F('money_to_collect','FLOAT64'),
    F('total_quantity','STRING'), F('marketer','STRING'),
    F('ad_id','STRING'), F('adset_id','STRING'), F('ads_source','STRING'),
    F('page_id','STRING'), F('post_id','STRING'),
    F('p_utm_source','STRING'), F('p_utm_campaign','STRING'), F('p_utm_medium','STRING'),
    F('p_utm_content','STRING'), F('p_utm_term','STRING'), F('p_utm_id','STRING'),
    F('order_currency','STRING'),
    F('customer_id','STRING'), F('customer_name','STRING'),
    F('bill_full_name','STRING'), F('bill_phone_number','STRING'),
    F('shipping_address','STRING'), F('shipping_province','STRING'), F('shipping_district','STRING'),
    F('partner','STRING'), F('warehouse_id','STRING'), F('tracking_link','STRING'),
    F('inserted_at','STRING'), F('updated_at','STRING'),
    F('time_send_partner','STRING'), F('estimate_delivery_date','STRING'),
    F('note','STRING'), F('tags','STRING'), F('order_link','STRING'),
    F('sync_time','STRING'),
]
ITEM_SCHEMA = [
    F('item_id','STRING'), F('order_id','STRING'), F('shop_id','STRING'),
    F('shop_name','STRING'), F('project_id','STRING'),
    F('product_id','STRING'), F('variation_id','STRING'),
    F('product_name','STRING'), F('variation_name','STRING'), F('barcode','STRING'),
    F('quantity','INT64'), F('return_quantity','INT64'),
    F('returned_count','INT64'), F('returning_quantity','INT64'),
    F('retail_price','FLOAT64'), F('discount_each_product','FLOAT64'),
    F('total_discount','FLOAT64'), F('same_price_discount','FLOAT64'),
    F('avg_imported_price','FLOAT64'),
    F('is_bonus_product','STRING'), F('is_composite','STRING'), F('is_wholesale','STRING'),
    F('order_inserted_at','STRING'), F('sync_time','STRING'),
]
ADS_SCHEMA = [
    F('ad_id','STRING'), F('ad_name','STRING'),
    F('adset_id','STRING'), F('adset_name','STRING'),
    F('campaign_id','STRING'), F('campaign_name','STRING'),
    F('account_id','STRING'), F('account_name','STRING'),
    F('date','DATE'),
    F('spend','FLOAT64'),       # VND (đã quy đổi — account billed VND)
    F('spend_usd','FLOAT64'),   # USD raw từ Meta API
    F('impressions','INT64'), F('clicks','INT64'),
    F('reach','INT64'),
    F('purchases','INT64'), F('purchase_value','FLOAT64'),
    F('leads','FLOAT64'),
    F('messaging_conversations_started','INT64'), F('add_to_cart','INT64'),
    F('cpm','FLOAT64'), F('ctr','FLOAT64'), F('cpc','FLOAT64'), F('frequency','FLOAT64'),
    F('project_id','STRING'),   # 'TALPHA' — port từ engine runtime (monolith)
    F('sync_time','STRING'),
]
# fb_adset_data — port từ engine runtime, SCHEMA TƯỜNG MINH (runtime dùng autodetect
# → nguồn schema-drift). Field set = đúng bộ runtime ghi (không có add_to_cart/spend_usd).
ADSET_SCHEMA = [
    F('adset_id','STRING'), F('adset_name','STRING'),
    F('campaign_id','STRING'), F('campaign_name','STRING'),
    F('account_id','STRING'), F('account_name','STRING'),
    F('date','DATE'),
    F('spend','FLOAT64'),
    F('impressions','INT64'), F('reach','INT64'), F('clicks','INT64'),
    F('cpm','FLOAT64'), F('ctr','FLOAT64'), F('cpc','FLOAT64'), F('frequency','FLOAT64'),
    F('purchases','INT64'), F('purchase_value','FLOAT64'),
    F('leads','INT64'),
    F('messaging_conversations_started','INT64'),
    F('project_id','STRING'),   # 'TALPHA'
    F('sync_time','STRING'),
]


# ═══════════════════════════════════════════════════════════════════
# ORDER SYNC
# ═══════════════════════════════════════════════════════════════════

def sync_all_orders(window_start=None) -> tuple[int, int]:
    """Fetch đơn TẠO từ `window_start` trở đi ở mọi POS shop rồi ghi vào BQ.

    X1 — hai thay đổi so với bản cũ:
      • Cửa sổ theo `inserted_at` (đúng chiều sắp xếp của feed) thay cho Smart Stop
        theo `updated_at` — bản cũ dừng sớm ngẫu nhiên và cắt mất đơn thật.
      • Ghi bằng append vào <bảng>_raw rồi dựng lại bảng sạch, thay WRITE_TRUNCATE —
        kéo hụt không còn xoá được dữ liệu đã có.
    """
    all_orders, all_items = [], []

    failed_shops = []
    for shop in POS_SHOPS:
        if not shop["key"]:
            log.warning(f"  Skipping {shop['label']} — no API key")
            continue
        pos = PoscakeClient(
            api_key=shop["key"],
            shop_label=shop["label"],
            shop_id=shop.get("shop_id", ""),
            currency=shop.get("currency", "AED"),
            sync_time=sync_time,
        )
        # Retry cả shop (ngoài retry từng page) — SA hay bị reset giữa chừng.
        orders = items = None
        for attempt in range(3):
            try:
                orders, items = pos.fetch_orders(window_start=window_start)
                break
            except PosFetchError as e:
                log.error(f"  {shop['label']} fetch lỗi (lần {attempt+1}/3): {e}")
                if attempt < 2:
                    time.sleep(30)
        if orders is None:
            failed_shops.append(shop["label"])
            continue
        all_orders.extend(orders)
        all_items.extend(items)

    if not all_orders and failed_shops:
        raise RuntimeError(f"sale_order sync HỦY: mọi shop fetch thất bại {failed_shops}")

    if all_orders:
        # Ghi được ngay cả khi thiếu shop: append không xoá gì, đơn của shop lỗi chỉ
        # giữ nguyên bản cũ. Khác hẳn WRITE_TRUNCATE — trước đây thiếu 1 shop là phải
        # huỷ cả vòng ghi, nếu không sẽ xoá trắng đơn của shop đó.
        n_orders, n_items = append_and_rebuild_orders(
            client, P, DS, all_orders, all_items, ORDER_SCHEMA, ITEM_SCHEMA,
            order_table=_tbl('sale_order'), item_table=_tbl('order_items'),
        )
    else:
        log.warning("  Không fetch được order từ bất kỳ shop nào!")
        n_orders = n_items = 0

    # Vẫn báo lỗi để exit code ≠ 0 → report_health bắn cảnh báo, nhưng dữ liệu đã an toàn.
    if failed_shops:
        raise RuntimeError(
            f"Đã ghi {n_orders} đơn nhưng shop {failed_shops} fetch thất bại — "
            f"đơn của shop đó đang giữ bản cũ. Chạy lại khi POS ổn."
        )
    return n_orders, n_items


# ═══════════════════════════════════════════════════════════════════
# ADS SYNC — dùng MetaAdsClient từ sync/core
# ═══════════════════════════════════════════════════════════════════

def _transform_ads_row(r: dict, account_id: str, account_name: str) -> dict:
    """Transform 1 insight row → BQ format (ghi thẳng VND vì account billed VND)."""
    actions   = r.get('actions', []) or []
    act_vals  = r.get('action_values', []) or []

    def get_action(typ: str, cast=int) -> float:
        return sum(cast(a.get('value', 0)) for a in actions if a.get('action_type') == typ)
    def get_value(typ: str) -> float:
        return sum(float(a.get('value', 0)) for a in act_vals if a.get('action_type') == typ)

    spend_raw = float(r.get('spend', 0) or 0)  # Account billed VND → spend IS VND
    return {
        'ad_id':         str(r.get('ad_id', '')),
        'ad_name':       str(r.get('ad_name', '')),
        'adset_id':      str(r.get('adset_id', '')),
        'adset_name':    str(r.get('adset_name', '')),
        'campaign_id':   str(r.get('campaign_id', '')),
        'campaign_name': str(r.get('campaign_name', '')),
        'account_id':    account_id.replace('act_', ''),
        'account_name':  account_name,
        'date':          str(r.get('date_start', '')),
        'spend':         spend_raw,
        'spend_usd':     0.0,   # account VND — không có USD equivalent
        'impressions':   int(r.get('impressions', 0) or 0),
        'clicks':        int(r.get('clicks', 0) or 0),
        'reach':         int(r.get('reach', 0) or 0),
        'purchases':     get_action('purchase'),
        'purchase_value': get_value('purchase'),
        'leads':         float(get_action('lead')),
        'messaging_conversations_started': get_action('onsite_conversion.messaging_conversation_started_7d'),
        'add_to_cart':   get_action('add_to_cart'),
        'cpm':           float(r.get('cpm', 0) or 0),
        'ctr':           float(r.get('ctr', 0) or 0),
        'cpc':           float(r.get('cpc', 0) or 0),
        'frequency':     float(r.get('frequency', 0) or 0),
        'project_id':    'TALPHA',
        'sync_time':     sync_time,
    }


def _transform_adset_row(r: dict, account_id: str, account_name: str) -> dict:
    """Transform 1 adset-level insight row → BQ format (field set = engine runtime)."""
    actions  = r.get('actions', []) or []
    act_vals = r.get('action_values', []) or []
    return {
        'adset_id':      str(r.get('adset_id', '')),
        'adset_name':    str(r.get('adset_name', '')),
        'campaign_id':   str(r.get('campaign_id', '')),
        'campaign_name': str(r.get('campaign_name', '')),
        'account_id':    account_id.replace('act_', ''),
        'account_name':  account_name,
        'date':          str(r.get('date_start', '')),
        'spend':         float(r.get('spend', 0) or 0),
        'impressions':   int(r.get('impressions', 0) or 0),
        'reach':         int(r.get('reach', 0) or 0),
        'clicks':        int(r.get('clicks', 0) or 0),
        'cpm':           float(r.get('cpm', 0) or 0),
        'ctr':           float(r.get('ctr', 0) or 0),
        'cpc':           float(r.get('cpc', 0) or 0),
        'frequency':     float(r.get('frequency', 0) or 0),
        'purchases':     sum(int(a.get('value', 0)) for a in actions if a.get('action_type') == 'purchase'),
        'purchase_value': sum(float(a.get('value', 0)) for a in act_vals if a.get('action_type') == 'purchase'),
        'leads':         sum(int(a.get('value', 0)) for a in actions if a.get('action_type') == 'lead'),
        'messaging_conversations_started': sum(
            int(a.get('value', 0)) for a in actions
            if a.get('action_type') == 'onsite_conversion.messaging_conversation_started_7d'
        ),
        'project_id':    'TALPHA',
        'sync_time':     sync_time,
    }


def sync_fb_ads(days_back: int = 1, since: str = None, until: str = None) -> tuple[int, int]:
    """Fetch Meta Ads insights → BQ theo cơ chế raw/rebuild (X2).

    `days_back` chỉ quyết định NGÀY NÀO ĐƯỢC LÀM MỚI, không còn quyết định ngày nào
    bị xoá — bản cũ WRITE_TRUNCATE cả bảng nên mỗi lần sang tháng mới là mất sạch
    tháng trước.

    `since`/`until`: chỉ định thẳng khoảng ngày, dùng để BACKFILL tháng cũ (kéo theo
    từng tháng cho nhẹ, tránh chạm rate limit của Meta).
    """
    if not FB_TOKEN:
        log.error("TALPHA_META_ACCESS_TOKEN not set!")
        return 0, 0

    today = until or datetime.utcnow().strftime('%Y-%m-%d')
    since = since or (datetime.utcnow() - timedelta(days=days_back)).strftime('%Y-%m-%d')
    meta  = MetaAdsClient(access_token=FB_TOKEN)

    fields = (
        "ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,"
        "spend,impressions,reach,clicks,cpm,ctr,cpc,frequency,"
        "actions,action_values"
    )
    adset_fields = (
        "adset_id,adset_name,campaign_id,campaign_name,"
        "spend,impressions,reach,clicks,cpm,ctr,cpc,frequency,"
        "actions,action_values"
    )
    all_ads, all_adsets = [], []
    failed = []
    for acct in AD_ACCOUNTS:
        log.info(f"  {acct['name']} ({acct['id']})...")
        rows = None
        # Retry cả account (ngoài retry trong _request) — account lớn hay timeout/limit.
        for attempt in range(3):
            try:
                rows = meta.fetch_ads_insights(
                    account_id=acct['id'], date_start=since, date_stop=today,
                    fields=fields.split(','), level='ad',
                )
                break
            except MetaFetchError as e:
                log.error(f"    {acct['name']} fetch lỗi (lần {attempt+1}/3): {e}")
                if attempt < 2:
                    time.sleep(30)
        if rows is None:
            failed.append(acct['name'])
            log.error(f"    ⚠️ {acct['name']}: fetch THẤT BẠI hẳn — KHÔNG nạp 0 đè, sẽ hủy load.")
            continue
        for r in rows:
            all_ads.append(_transform_ads_row(r, acct['id'], acct['name']))
        log.info(f"    → {len(rows)} ad rows")

        # Adset-level (port từ engine runtime): BEST-EFFORT như runtime —
        # account fail chỉ log + bỏ qua, KHÔNG hủy cả lượt (fb_adset_data là bảng phụ).
        try:
            rows2 = meta.fetch_ads_insights(
                account_id=acct['id'], date_start=since, date_stop=today,
                fields=adset_fields.split(','), level='adset',
            )
            for r in rows2:
                all_adsets.append(_transform_adset_row(r, acct['id'], acct['name']))
            log.info(f"    → {len(rows2)} adset rows")
        except MetaFetchError as e:
            log.error(f"    Adset {acct['name']} fetch lỗi (bỏ qua, best-effort): {e}")

    # X2: append/rebuild nên account lỗi KHÔNG còn xoá được spend đã có — dòng của
    # account đó chỉ giữ bản cũ. Vẫn raise ở cuối để báo cảnh, nhưng ghi trước đã.
    if all_ads:
        n_ads = append_and_rebuild_ads(
            client, P, DS, all_ads, ADS_SCHEMA, _tbl('fb_ads_data'), 'ad_id')
        n_adsets = append_and_rebuild_ads(
            client, P, DS, all_adsets, ADSET_SCHEMA, _tbl('fb_adset_data'), 'adset_id')
        log.info(f"  ads window {since}→{today} (cửa sổ chỉ làm mới, không xoá lịch sử)")
    else:
        log.warning("  Không fetch được insight ads từ bất kỳ account nào!")
        n_ads = n_adsets = 0

    if failed:
        raise RuntimeError(
            f"Đã ghi {n_ads} dòng ads nhưng {len(failed)} account fetch thất bại {failed} "
            f"— spend account đó đang giữ bản cũ. Chạy lại khi Meta ổn."
        )
    return n_ads, n_adsets


# ═══════════════════════════════════════════════════════════════════
# CAMPAIGN BUDGET SYNC (giữ nguyên — chưa có trong meta_client)
# ═══════════════════════════════════════════════════════════════════

CAMPAIGN_SCHEMA = [
    F('campaign_id','STRING'), F('campaign_name','STRING'),
    F('status','STRING'), F('effective_status','STRING'),
    F('daily_budget','FLOAT64'), F('lifetime_budget','FLOAT64'),
    F('budget_remaining','FLOAT64'), F('objective','STRING'),
    F('start_time','STRING'), F('stop_time','STRING'),
    F('account_id','STRING'), F('sync_time','STRING'),
]

def sync_ad_dictionary(max_ids: int = 600) -> int:
    """X9 — tra Meta cho ad_id nằm trên ĐƠN nhưng không có trong fb_ads_data → bảng
    `ad_dictionary` (ad_id, account, campaign_name) cho attribution bậc 2.

    Vì sao cần: insights chỉ trả ad_id HIỆN TẠI. Ad bị xoá/tạo lại thì id cũ (đã đóng
    dấu vào đơn qua utm lúc khách bấm) không bao giờ xuất hiện trong fb_ads_data —
    nhưng hỏi thẳng /{ad_id} thì Meta vẫn trả account + campaign. Bắt luôn ad của
    TKQC NGOÀI roster (team khác chung shop POS). Append-only, id lỗi cũng ghi
    (status='error') để không tra lại mãi.
    """
    api = 'https://graph.facebook.com/v21.0'
    dic_table = f'{P}.{DS}.ad_dictionary'
    try:
        client.get_table(dic_table)
        not_in_dic = f"AND id NOT IN (SELECT ad_id FROM `{dic_table}`)"
    except Exception:
        not_in_dic = ""   # bảng chưa tồn tại — vòng đầu tra tất

    ids = [r.id for r in client.query(f"""
        WITH need AS (
            SELECT DISTINCT
                CASE WHEN o.p_utm_term IS NOT NULL AND LENGTH(o.p_utm_term) > 10
                          AND REGEXP_CONTAINS(o.p_utm_term, r'^[0-9]+$') THEN o.p_utm_term
                     WHEN o.ad_id IS NOT NULL AND TRIM(o.ad_id) != '' THEN o.ad_id
                END AS id
            FROM `{P}.{DS}.{_tbl('sale_order')}` o
        )
        SELECT id FROM need
        WHERE id IS NOT NULL
          AND id NOT IN (SELECT CAST(ad_id AS STRING) FROM `{P}.{DS}.fb_ads_data` WHERE ad_id IS NOT NULL)
          {not_in_dic}
        LIMIT {max_ids}""").result()]
    if not ids:
        log.info("  ad_dictionary: không có id mới cần tra")
        return 0

    log.info(f"  ad_dictionary: tra Meta {len(ids)} ad_id lạ (batch 50)...")
    out, acc_names = [], {}
    for i in range(0, len(ids), 50):
        batch = ids[i:i+50]
        try:
            data = requests.get(f'{api}/', params={
                'ids': ','.join(batch),
                'fields': 'account_id,name,campaign{id,name}',
                'access_token': FB_TOKEN}, timeout=90).json()
        except Exception as e:
            log.warning(f"  ad_dictionary batch lỗi mạng: {e} — bỏ batch, vòng sau tra lại")
            continue
        if isinstance(data, dict) and data.get('error'):
            # 1 id hỏng làm chết cả lô → tra lẻ
            data = {}
            for aid in batch:
                try:
                    data[aid] = requests.get(f'{api}/{aid}', params={
                        'fields': 'account_id,name,campaign{id,name}',
                        'access_token': FB_TOKEN}, timeout=30).json()
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
                    an = requests.get(f'{api}/act_{acc}', params={
                        'fields': 'name', 'access_token': FB_TOKEN}, timeout=30).json()
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
    F = bigquery.SchemaField
    schema = [F(n, 'STRING') for n in ('ad_id', 'account_id', 'account_name',
              'campaign_id', 'campaign_name', 'ad_name', 'status', 'sync_time')]
    load_append(client, P, DS, 'ad_dictionary', out, schema)
    ok = sum(1 for r in out if r['status'] == 'ok')
    log.info(f"  ad_dictionary: +{len(out)} id ({ok} tra được, {len(out)-ok} lỗi)")
    return len(out)


def sync_campaign_data() -> int:
    """Sync campaign budgets → fb_campaign_data."""
    if not FB_TOKEN:
        log.error("TALPHA_META_ACCESS_TOKEN not set!")
        return 0

    all_campaigns = []
    for acct in AD_ACCOUNTS:
        acct_id = acct['id']
        try:
            resp = requests.get(
                f'https://graph.facebook.com/v21.0/{acct_id}/campaigns',
                params={
                    'fields': 'id,name,status,effective_status,daily_budget,lifetime_budget,budget_remaining,objective,start_time,stop_time',
                    'effective_status': '["ACTIVE","PAUSED","ARCHIVED"]',
                    'limit': '500',
                    'access_token': FB_TOKEN,
                },
                timeout=60,
            )
            data = resp.json()
            if 'error' in data:
                log.error(f"  [{acct_id}] {data['error'].get('message','')[:150]}")
                continue
            rows = data.get('data', [])
            while 'paging' in data and 'next' in data.get('paging', {}):
                data = requests.get(data['paging']['next'], timeout=60).json()
                rows.extend(data.get('data', []))
            for r in rows:
                all_campaigns.append({
                    'campaign_id':      str(r.get('id', '')),
                    'campaign_name':    str(r.get('name', '')),
                    'status':           str(r.get('status', '')),
                    'effective_status': str(r.get('effective_status', '')),
                    'daily_budget':     float(r.get('daily_budget') or 0) / 100,
                    'lifetime_budget':  float(r.get('lifetime_budget') or 0) / 100,
                    'budget_remaining': float(r.get('budget_remaining') or 0) / 100,
                    'objective':        str(r.get('objective', '')),
                    'start_time':       str(r.get('start_time', '') or ''),
                    'stop_time':        str(r.get('stop_time', '') or ''),
                    'account_id':       acct_id.replace('act_', ''),
                    'sync_time':        sync_time,
                })
            log.info(f"  [{acct_id}] {len(rows)} campaigns")
        except Exception as e:
            log.error(f"  [{acct_id}] Campaign error: {e}")
        time.sleep(0.5)

    n = load_truncate(client, P, DS, _tbl('fb_campaign_data'), all_campaigns, CAMPAIGN_SCHEMA)
    log.info(f"  {_tbl('fb_campaign_data')}: {n} rows")
    return n


# ═══════════════════════════════════════════════════════════════════
# CONNECTION TEST
# ═══════════════════════════════════════════════════════════════════

def test_connections():
    """Kiểm tra token Meta + POS API keys trước khi sync thật."""
    if FB_TOKEN:
        r = requests.get(
            f'https://graph.facebook.com/v21.0/me',
            params={'access_token': FB_TOKEN}, timeout=10,
        )
        d = r.json()
        log.info(f"  Meta token: {d.get('name', d.get('error', {}).get('message', '?'))}")
        log.info(f"  Ad accounts: {len(AD_ACCOUNTS)}")
    else:
        log.warning("  Meta token: NOT SET")

    log.info("  POS shops:")
    for shop in POS_SHOPS:
        if shop["key"]:
            pos = PoscakeClient(
                api_key=shop["key"], shop_label=shop["label"],
                shop_id="", currency=shop["currency"],
            )
            sid = pos._discover_shop_id()
            log.info(f"    {shop['label']}: shop_id={sid or 'NOT FOUND'}")
        else:
            log.info(f"    {shop['label']}: NO API KEY")


# ═══════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description='TALPHA Full Sync v3')
    parser.add_argument('--ads',    action='store_true', help='Ads only')
    parser.add_argument('--orders', action='store_true', help='Orders only')
    parser.add_argument('--full',   action='store_true',
                        help='Kéo TOÀN BỘ lịch sử đơn (backfill) thay vì cửa sổ ngày')
    parser.add_argument('--window-days', type=int,
                        default=int(os.getenv('TALPHA_ORDER_WINDOW_DAYS', '30')),
                        help='Số ngày lùi lại theo ngày TẠO đơn (mặc định 60)')
    parser.add_argument('--test',   action='store_true', help='Test connections')
    parser.add_argument('--days',   type=int, default=1, help='Days back for ads (default: 1)')
    parser.add_argument('--shadow', action='store_true',
                        help='Shadow run: ghi vào bảng *_shadow (fb_ads_data_shadow, sale_order_shadow, '
                             'order_items_shadow, fb_campaign_data_shadow, fb_adset_data_shadow) '
                             '— chỉ đổi tên bảng đích, không đổi logic')
    args = parser.parse_args()

    if args.shadow:
        global TABLE_SUFFIX
        TABLE_SUFFIX = '_shadow'
        log.info("SHADOW MODE: mọi bảng đích thêm hậu tố '_shadow' — bảng thật KHÔNG bị đụng.")

    if args.test:
        test_connections()
        return

    start    = datetime.now()
    run_all  = not (args.ads or args.orders)
    results  = {'errors': []}

    log.info("═" * 60)
    log.info(f"TALPHA SYNC v3  [{P}.{DS}]")
    log.info(f"Mode: {'FULL' if run_all else ('ADS' if args.ads else 'ORDERS')} | "
             f"{'full-fetch' if args.full else 'incremental'}")
    log.info("═" * 60)

    ensure_dataset(client, P, DS)

    if run_all or args.orders:
        log.info(f"\n[1/3] Orders (6 POS shops GCC)...")
        try:
            win = None if args.full else (
                datetime.now() - timedelta(days=args.window_days)
            ).strftime('%Y-%m-%dT00:00:00')
            log.info(f"  Cửa sổ đơn: {'TOÀN BỘ lịch sử' if win is None else f'tạo từ {win}'}")
            n_o, n_i = sync_all_orders(window_start=win)
            results['orders'] = n_o
            results['items']  = n_i
        except Exception as e:
            log.error(f"  Orders failed: {e}", exc_info=True)
            results['errors'].append(f"orders: {e}")

    if run_all or args.ads:
        log.info(f"\n[2/3] FB Ads (last {args.days} days)...")
        try:
            n_a, n_as = sync_fb_ads(days_back=args.days)
            results['ads'] = n_a
            results['adsets'] = n_as
        except Exception as e:
            log.error(f"  Ads failed: {e}", exc_info=True)
            results['errors'].append(f"ads: {e}")

    if run_all or args.ads:
        log.info("\n[3/3] Campaign budgets...")
        try:
            results['campaigns'] = sync_campaign_data()
        except Exception as e:
            log.error(f"  Campaign sync failed: {e}", exc_info=True)
            results['errors'].append(f"campaigns: {e}")
        # X9: từ điển ad_id cho attribution bậc 2 — không chặn vòng chạy
        try:
            results['ad_dic'] = sync_ad_dictionary()
        except Exception as e:
            log.error(f"  ad_dictionary failed: {e}")

    elapsed = (datetime.now() - start).total_seconds()
    log.info(f"\nDONE {elapsed:.0f}s — {results}")

    if DISCORD_WEBHOOK:
        errs = results.get('errors', [])
        ok = len(errs) == 0
        embed = {
            'title': '✅ TALPHA Sync v3' if ok else '⚠️ TALPHA Sync v3 — CÓ LỖI',
            'color': 0x2ECC71 if ok else 0xE74C3C,
            'fields': [
                {'name': 'Orders', 'value': str(results.get('orders', 0)), 'inline': True},
                {'name': 'Items',  'value': str(results.get('items', 0)),  'inline': True},
                {'name': 'Ads',    'value': str(results.get('ads', 0)),    'inline': True},
                {'name': 'Thời gian', 'value': f'{elapsed:.0f}s', 'inline': True},
                {'name': 'Errors', 'value': str(len(errs)), 'inline': True},
            ],
        }
        if errs:
            # Liệt kê tối đa 5 lỗi đầu để dễ debug
            embed['fields'].append({
                'name': 'Chi tiết lỗi',
                'value': '\n'.join(f'• {e[:200]}' for e in errs[:5]) or '—',
                'inline': False,
            })
        try:
            requests.post(DISCORD_WEBHOOK, json={'embeds': [embed]}, timeout=10)
        except Exception:
            pass


if __name__ == '__main__':
    main()

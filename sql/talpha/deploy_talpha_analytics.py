"""
Deploy TALPHA Analytics view pack → cty-507710.TALPHA_Dataset

Tạo bộ view phân tích v6-style (đã tùy chỉnh cho TALPHA):
  Lớp 0 (adapter)  : vw_fb_ads_std, vw_orders_std
  Lớp 1 (daily fact): vw_fact_daily_pnl, vw_fact_daily_marketer
  Lớp 2 (intel)    : vw_daily_momentum, vw_marketer_momentum,
                     vw_campaign_lifecycle, vw_creative_fatigue

▸ AN TOÀN: chỉ chạy CREATE OR REPLACE VIEW — KHÔNG ghi/xoá dữ liệu.
▸ DRY-RUN mặc định: chỉ in kế hoạch. Thêm --execute để chạy thật.
▸ Project/Dataset đọc từ .env (BQ_PROJECT_ID / BQ_DATASET).

Usage:
  python sql/talpha/deploy_talpha_analytics.py            # dry-run
  python sql/talpha/deploy_talpha_analytics.py --execute  # deploy thật
  python sql/talpha/deploy_talpha_analytics.py --execute --verify
"""
import os
import re
import sys
import argparse

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(os.path.dirname(SCRIPT_DIR))
os.environ.setdefault(
    'GOOGLE_APPLICATION_CREDENTIALS',
    os.path.join(PROJECT_DIR, 'bigquery_key.json'),
)

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(PROJECT_DIR, '.env'))
except ImportError:
    pass

PROJECT = os.getenv('BQ_PROJECT_ID', 'cty-507710')
DATASET = os.getenv('BQ_DATASET', 'TALPHA_Dataset')

RULES_FILE = os.path.join(PROJECT_DIR, 'config', 'talpha_rules.json')

# Thứ tự deploy = thứ tự phụ thuộc (adapter → fact → intel)
VIEWS = [
    '00_vw_product_catalog_std.sql',
    '01_vw_fb_ads_std.sql',
    '02_vw_orders_std.sql',
    '03_vw_fact_daily_pnl.sql',
    '04_vw_fact_daily_marketer.sql',
    '05_vw_daily_momentum.sql',
    '06_vw_marketer_momentum.sql',
    '07_vw_campaign_lifecycle.sql',
    '08_vw_creative_fatigue.sql',
    # G1 — cửa sổ quảng cáo + CPO thật theo đơn POS (port từ STRAMARK).
    # 09 phải đứng trước 10: vw_ad_windows JOIN vw_pos_by_ad.
    '09_vw_pos_by_ad.sql',
    '10_vw_ad_windows.sql',
    '11_vw_attribution_quality.sql',
]


def ad_tz_sql() -> str:
    """Sinh CASE account_id → múi giờ TỪ config/projects/talpha.yaml (ad_account_timezones).

    Trước 10/08 bảng này HARD-CODE trong view và chỉ có 8/14 TKQC — thiếu cả "Trung Đông
    múi h Mỹ" (chạy America/Los_Angeles) nên đơn của nó bị gom theo giờ VN, lệch tới 15h
    so với ngày Meta báo spend. Thêm TKQC mà quên sửa view = lặp lại đúng lỗi đó.
    """
    import yaml
    with open(os.path.join(PROJECT_DIR, 'config', 'projects', 'talpha.yaml'), encoding='utf-8') as f:
        tzs = (yaml.safe_load(f).get('meta_ads') or {}).get('ad_account_timezones') or {}
    if not tzs:
        raise SystemExit("❌ talpha.yaml thiếu meta_ads.ad_account_timezones — không sinh được múi giờ.")
    lines = []
    for aid, tz in tzs.items():
        num = str(aid).replace('act_', '')
        if not num.isdigit() or not re.match(r'^[A-Za-z_]+/[A-Za-z_]+$', str(tz)):
            raise SystemExit(f"❌ mục múi giờ lạ: {aid} → {tz}")
        lines.append(f"                WHEN {num:<20} THEN '{tz}'")
    return ("CASE SAFE_CAST(account_id AS INT64)\n" + "\n".join(lines) +
            "\n                ELSE 'Asia/Ho_Chi_Minh'  -- TKQC chưa khai trong talpha.yaml\n            END")


def fx_sql() -> tuple:
    """Sinh CASE tỷ giá + cờ is_fx_known TỪ config/talpha_rules.json mục `markets`.

    Trước 10/08 tỷ giá bị HARD-CODE trong file SQL này trong khi format_all.py đọc từ
    rules file ⇒ HAI nguồn tỷ giá. Hôm nay chúng trùng nhau nên không ai thấy; đổi tỷ
    giá ở rules file thì Sheet đổi còn dashboard đứng yên → lệch âm thầm (dự án đã dính
    đúng bẫy này 03/08). Nay chỉ còn MỘT nguồn.
    """
    import json
    with open(RULES_FILE, 'r', encoding='utf-8') as f:
        markets = json.load(f)['markets']
    pairs = [(v['shop_label'], float(v['rate_vnd'])) for v in markets.values()
             if isinstance(v, dict) and v.get('shop_label')]
    if not pairs:
        raise SystemExit(f"❌ {RULES_FILE}: mục `markets` rỗng — không sinh được tỷ giá.")
    for lb, _ in pairs:
        if not lb.isalnum():
            raise SystemExit(f"❌ shop_label lạ, chặn để khỏi phá SQL: {lb!r}")
    case = "CASE o.shop_label\n" + "\n".join(
        f"            WHEN '{lb}' THEN {r}    -- → VND" for lb, r in pairs
    ) + "\n            ELSE 7010.0  -- shop mới chưa khai tỷ giá: tạm coi như AED\n        END"
    known = "(o.shop_label IN (" + ", ".join(f"'{lb}'" for lb, _ in pairs) + "))"
    return case, known


def money_divisor_sql() -> str:
    """X13 — sinh CASE shop_label → số chia đưa tiền POS về ĐƠN VỊ THẬT.

    Trước 20/08 view chia 100 cho MỌI shop vì tưởng Poscake luôn lưu minor units.
    Ground truth POS API (20/08): shop Đài lưu NGUYÊN TWD (đơn 336: cod=950 cho
    1 Birthstone Set + 1 BOX = 950 TWD ≈ 760k VND), còn 6 shop GCC lưu minor units
    (SA đơn 68974: cod=10900 = 109,00 SAR). Chia 100 cho Đài ⇒ doanh thu tụt đúng
    100 lần, AOV ra 8.987đ/đơn trong khi 6 market kia 0,8–1,05tr.

    ELSE 100: shop mới chưa khai thì giữ nguyên hành vi cũ (đa số shop là minor
    units) — nhưng `is_fx_known` sẽ FALSE cho shop đó, đó mới là tín hiệu cần soi.
    """
    import json
    with open(RULES_FILE, 'r', encoding='utf-8') as f:
        markets = json.load(f)['markets']
    pairs = []
    for v in markets.values():
        if not isinstance(v, dict) or not v.get('shop_label'):
            continue
        div = v.get('pos_money_divisor')
        if div is None:
            raise SystemExit(
                f"❌ market {v['shop_label']} thiếu `pos_money_divisor` trong {RULES_FILE}. "
                f"Khai bằng cách LẤY ĐƠN THẬT TỪ POS API so với giá bán, đừng đoán."
            )
        if not isinstance(div, int) or div <= 0:
            raise SystemExit(f"❌ pos_money_divisor lạ ({v['shop_label']}): {div!r} — phải là số nguyên > 0.")
        pairs.append((v['shop_label'], div))
    if not pairs:
        raise SystemExit(f"❌ {RULES_FILE}: mục `markets` rỗng — không sinh được số chia tiền.")
    for lb, _ in pairs:
        if not lb.isalnum():
            raise SystemExit(f"❌ shop_label lạ, chặn để khỏi phá SQL: {lb!r}")
    return "CASE o.shop_label\n" + "\n".join(
        f"            WHEN '{lb}' THEN {d}" for lb, d in pairs
    ) + "\n            ELSE 100  -- shop mới chưa khai: giữ mặc định minor units\n        END"


def marketer_group_sql(col: str = "_mk_name") -> str:
    """X10 — sinh CASE phân loại 'team' / 'external' / 'unknown' TỪ CHÍNH rules file.

    Người ngoài team (Kính, Thắng, Việt…) chạy chung 14 TKQC và bán chung shop POS, nên
    đơn của họ nằm lẫn trong `sale_order`. Tab tổng (CEO Intelligence, P&L) cần lọc bỏ
    họ mà KHÔNG được chép lại bảng tên vào SQL — sinh ra ở đây để rules file vẫn là
    nguồn duy nhất. Thứ tự: rule TEAM trước, ngoài team sau (người trong team ưu tiên).
    """
    import json
    with open(RULES_FILE, 'r', encoding='utf-8') as f:
        r = json.load(f)

    def like(rules, nhan):
        out = []
        for x in rules:
            s = x['contains']
            if "'" in s or '%' in s or '_' in s:
                raise SystemExit(f"❌ rule `contains` chứa ký tự phá SQL: {s!r}")
            out.append(f"        WHEN UPPER({col}) LIKE '%{s}%' THEN '{nhan}'")
        return out

    team = like(r.get('pos_marketer_rules', []), 'team')
    ext = like(r.get('pos_external_rules', []), 'external')
    if not team:
        raise SystemExit("❌ rules file thiếu `pos_marketer_rules` — không sinh được phân loại.")
    return "CASE\n" + "\n".join(team + ext) + "\n        ELSE 'unknown'\n    END"


def product_costs_sql() -> str:
    """E2 — sinh literal ARRAY<STRUCT<sku STRING, cost_price_vnd INT64>> từ
    config/talpha_rules.json mục `products`.

    Giá vốn có ĐÚNG MỘT nguồn là rules file: view (vw_orders_std.cogs_vnd) và tab
    "P&L theo SP" (/api/talpha/product-costs) cùng đọc từ đây, hết cảnh 2 định
    nghĩa COGS song song. Khai thêm SKU trong rules file → deploy lại view là xong.
    """
    import json
    with open(RULES_FILE, 'r', encoding='utf-8') as f:
        products = json.load(f).get('products', {})

    rows = [(sku, int(v['cost_price_vnd']))
            for sku, v in products.items()
            if not sku.startswith('_') and isinstance(v, dict) and v.get('cost_price_vnd')]
    if not rows:
        raise SystemExit(f"❌ {RULES_FILE}: mục `products` rỗng — view sẽ có COGS = 0 toàn bộ. Dừng.")

    # SKU đi thẳng vào string literal SQL — chặn ký tự phá cú pháp thay vì escape thầm.
    bad = [sku for sku, _ in rows if not sku.replace('-', '').replace('_', '').isalnum()]
    if bad:
        raise SystemExit(f"❌ SKU không hợp lệ trong rules file (chỉ cho chữ/số/-/_): {bad}")

    rows.sort()
    # STRUCT chỉ cần đặt tên cột ở phần tử đầu; các phần tử sau BigQuery suy ra theo vị trí.
    first = f"STRUCT('{rows[0][0]}' AS sku, {rows[0][1]} AS cost_price_vnd)"
    rest = [f"('{sku}', {cost})" for sku, cost in rows[1:]]
    return ',\n        '.join([first] + rest)


def test_campaign_re2() -> str:
    """G1 — sinh regex nhận diện campaign test cho BigQuery TỪ rules file.

    Bẫy: rules file viết pattern cho Python `re` với lookaround
    `(?<![a-zA-Z])test(?![a-zA-Z])`. BigQuery chạy RE2 — RE2 KHÔNG hỗ trợ
    lookaround, dán thẳng vào là query lỗi. Bản dịch dưới đây dùng nhóm
    biên tương đương.

    Guard: nếu ai sửa pattern trong rules file mà quên cập nhật bản dịch,
    deploy DỪNG thay vì âm thầm lọc sai (đúng bài học "hai nguồn rule").
    """
    import json
    with open(RULES_FILE, 'r', encoding='utf-8') as f:
        tc = json.load(f).get('test_campaign', {})
    pat = tc.get('pattern')
    expected = r"(?<![a-zA-Z])[Tt][Ee][Ss][Tt](?![a-zA-Z])"
    if pat != expected:
        raise SystemExit(
            "❌ config/talpha_rules.json → test_campaign.pattern đã đổi, bản dịch RE2 "
            "trong deploy_talpha_analytics.py chưa cập nhật.\n"
            f"   rules  : {pat!r}\n   đang chờ: {expected!r}\n"
            "   Cập nhật test_campaign_re2() rồi deploy lại."
        )
    # RE2: thay lookaround bằng biên chuỗi / ký tự không phải chữ cái.
    return r"(^|[^a-zA-Z])[Tt][Ee][Ss][Tt]([^a-zA-Z]|$)"


def thresholds() -> dict:
    """Ngưỡng dùng trong view — NGUỒN DUY NHẤT là config/talpha_rules.json.

    Trước G2 các số này gõ thẳng vào từng file .sql nên cùng một rule nằm ở
    nhiều nơi: frequency 2.5 ở cả 05 và 08, phantom 1.5 ở cả 05, 06 và 07.
    Sửa một chỗ không lan sang chỗ kia — đúng họ lỗi "hai nguồn rule" đã
    dính ở giá vốn (X5) và tỷ giá (E1).

    View viết `{TH_ROAS_TARGET}`; hàm này thay bằng số. Token không khai
    trong rules file thì deploy DỪNG, thay vì render ra SQL lỗi cú pháp.
    """
    import json
    with open(RULES_FILE, 'r', encoding='utf-8') as f:
        th = json.load(f).get('thresholds', {})
    if not th:
        raise SystemExit(
            "❌ config/talpha_rules.json thiếu mục `thresholds` — view SQL dùng "
            "{TH_*} sẽ không render được. Xem _thresholds_note trong rules file."
        )
    return {k: v for k, v in th.items() if not k.startswith('_')}


def apply_thresholds(sql: str, fname: str) -> str:
    import re as _re
    used = set(_re.findall(r'\{TH_([A-Z0-9_]+)\}', sql))
    if not used:
        return sql          # view không dùng ngưỡng → không cần đọc rules file
    th = thresholds()
    missing = sorted(t for t in used if t.lower() not in th)
    if missing:
        raise SystemExit(
            f"❌ {fname} dùng ngưỡng chưa khai trong config/talpha_rules.json → thresholds: "
            + ', '.join(missing)
        )
    for key, val in th.items():
        sql = sql.replace('{TH_' + key.upper() + '}', repr(val))
    return sql


def render(fname: str) -> str:
    with open(os.path.join(SCRIPT_DIR, 'views', fname), 'r', encoding='utf-8') as f:
        sql = f.read()
    sql = apply_thresholds(sql, fname)
    if '{PRODUCT_COSTS}' in sql:
        sql = sql.replace('{PRODUCT_COSTS}', product_costs_sql())
    if '{MARKETER_GROUP}' in sql:
        sql = sql.replace('{MARKETER_GROUP}', marketer_group_sql())
    if '{AD_TZ_CASE}' in sql:
        sql = sql.replace('{AD_TZ_CASE}', ad_tz_sql())
    if '{MONEY_DIV_CASE}' in sql:
        sql = sql.replace('{MONEY_DIV_CASE}', money_divisor_sql())
    if '{FX_CASE}' in sql or '{FX_KNOWN}' in sql:
        case, known = fx_sql()
        sql = sql.replace('{FX_CASE}', case).replace('{FX_KNOWN}', known)
    if '{TEST_CAMPAIGN_RE2}' in sql:
        sql = sql.replace('{TEST_CAMPAIGN_RE2}', test_campaign_re2())
    return sql.replace('{PROJECT}', PROJECT).replace('{DATASET}', DATASET)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--execute', action='store_true', help='Chạy thật (mặc định: dry-run)')
    ap.add_argument('--verify', action='store_true', help='Sau deploy, SELECT thử mỗi view')
    args = ap.parse_args()

    print(f"\n{'='*64}")
    print(f"  TALPHA Analytics deploy")
    print(f"  Target : {PROJECT}.{DATASET}")
    print(f"  Mode   : {'EXECUTE' if args.execute else 'DRY-RUN (chỉ in kế hoạch)'}")
    print(f"  Views  : {len(VIEWS)}")
    print(f"{'='*64}")

    if not args.execute:
        for v in VIEWS:
            sql = render(v)
            first = next((l for l in sql.splitlines() if l.strip().upper().startswith('CREATE')), '')
            print(f"  • {v:<32} → {first.strip()}")
        print("\nDry-run xong. Thêm --execute để deploy thật.")
        return 0

    from google.cloud import bigquery
    client = bigquery.Client(project=PROJECT)

    for v in VIEWS:
        sql = render(v)
        try:
            client.query(sql).result()
            print(f"  ✅ {v}")
        except Exception as e:
            print(f"  ❌ {v} — FAILED: {e}")
            return 1

    if args.verify:
        print("\n🔎 Verify (SELECT 1 dòng mỗi view)...")
        for v in VIEWS:
            name = v[3:].replace('.sql', '')
            try:
                rows = list(client.query(
                    f"SELECT * FROM `{PROJECT}.{DATASET}.{name}` LIMIT 1"
                ).result())
                print(f"  ✅ {name:<28} ({len(rows)} row mẫu)")
            except Exception as e:
                print(f"  ⚠️  {name} — {e}")

    print("\n✅ Deploy xong.")
    return 0


if __name__ == '__main__':
    sys.exit(main())

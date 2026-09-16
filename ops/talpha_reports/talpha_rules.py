# ═══════════════════════════════════════════════════════════════════
# TALPHA — loader rule chung (đọc talpha_rules.json, KHÔNG hard-code rule ở đây)
# Nguồn data: config/talpha_rules.json (repo) / ~/talpha_reports/talpha_rules.json (runtime)
# Consumer: format_all.py (+ script báo cáo khác). Sửa rule → sửa JSON, không sửa file này.
# ═══════════════════════════════════════════════════════════════════
import os, re, json

_CANDIDATES = [
    os.environ.get("TALPHA_RULES", ""),
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "talpha_rules.json"),
    os.path.expanduser("~/talpha_reports/talpha_rules.json"),
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "config", "talpha_rules.json"),
]
RULES_PATH = next((p for p in _CANDIDATES if p and os.path.exists(p)), None)
if not RULES_PATH:
    raise FileNotFoundError("talpha_rules.json không tìm thấy — deploy bằng ops/talpha_reports/deploy_runtime.sh")
with open(RULES_PATH, encoding="utf-8") as _f:
    RULES = json.load(_f)

# ── Thị trường & tỷ giá (tương đương RATE/LOCALCUR/ALLM/MARKETS/SHOP2MKT cũ) ──
# Nước "sap_chay" chưa có tỷ giá và số chia — khai null
# trong JSON. Ở đây null → tỷ giá 0 (doanh thu 0, KHÔNG đoán) và số chia 1 (chưa có đơn
# nào để chia). Nước "dang_ban" thiếu hai số này là cấu hình sai — test chặn trước deploy.
def _so_duong(v, mac_dinh):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0 else mac_dinh

_MK = {m: v for m, v in RULES["markets"].items() if isinstance(v, dict)}
RATE     = {m: _so_duong(v.get("rate_vnd"), 0) for m, v in _MK.items()}
LOCALCUR = {m: v["currency"] for m, v in _MK.items()}
CURRENCY_SYMBOL = {m: v.get("currency_symbol") or v["currency"] for m, v in _MK.items()}
STATUS   = {m: v.get("status", "dang_ban") for m, v in _MK.items()}
DANG_BAN = [m for m in _MK if STATUS[m] == "dang_ban"]
# X13 — số chia đưa cod/phí thô của POS về ĐƠN VỊ TIỀN THẬT của shop. 6 shop GCC lưu
# minor units (cod=9900 ⇒ 99,00 SAR) nên 100; shop Đài lưu NGUYÊN TWD (cod=950 ⇒
# 950 TWD) nên 1. Trước 20/08 mọi chỗ gõ thẳng "/100" ⇒ tiền Đài tụt 100 lần trên cả
# Sheet lẫn dashboard. Dùng MONEY_DIV[market] / MONEY_DIV_SHOP[shop_label], ĐỪNG gõ 100.
MONEY_DIV      = {m: _so_duong(v.get("pos_money_divisor"), 1) for m, v in _MK.items()}
MONEY_DIV_SHOP = {v["shop_label"]: _so_duong(v.get("pos_money_divisor"), 1) for m, v in _MK.items()}
ALLM     = list(_MK.keys())
# Nước dành cho campaign KHÔNG ghi nước ở tên (tên cũ). Sỹ Anh chốt 15/09/2026: tên cũ
# vẫn tính Đài, nhưng báo cáo liệt kê ra để sửa — xem campaign_market().
PRIMARY_MARKET = RULES.get("primary_market") or (ALLM[0] if ALLM else None)
MARKETS  = {tok: RULES["market_aliases"][tok] for tok in RULES["camp_market_tokens"]}
SHOP2MKT = {v["shop_label"]: m for m, v in _MK.items()}

def campaign_market(cn):
    """Tên campaign → (nước, nguồn). Nguồn: 'o_dau' (ô đầu là nước — đúng chuẩn),
    'o_khac' (nước nằm ô khác, tên kiểu cũ 'Tặng/TW/…'), 'mac_dinh' (không ghi nước →
    PRIMARY_MARKET). Cùng luật với parseCampaign/campaignMarketSource bên rules.ts."""
    p = [x.strip() for x in (cn or "").split("/")]
    for i, s in enumerate(p):
        m = MARKETS.get(s.upper())
        if m:
            return m, ("o_dau" if i == 0 else "o_khac")
    return PRIMARY_MARKET, "mac_dinh"

GTC_CAT = RULES["status"]["gtc_category"]
POS_TZ  = RULES["pos_timezone"]
NUMID   = re.compile(RULES["page_id_pattern"])

_CAMP_TOKENS = {k: v for k, v in RULES["camp_marketer_tokens"].items() if not k.startswith("_")}
_POS_RULES   = RULES["pos_marketer_rules"]
_SCAN_RULES  = RULES["camp_scan_rules"]
DISPLAY      = {k: v["display"] for k, v in RULES["marketers"].items()}

def norm_nv(s):
    """Segment campaign NGAY SAU thị trường → key marketer (exact-token, giống format_all cũ)."""
    if not s:
        return None
    u = s.strip().upper().replace(".", "").replace(" ", "")
    return _CAMP_TOKENS.get(u)

def norm_pos_nv(name):
    """Tên marketer tag trong POS ($.name) → key marketer; None = ngoài team."""
    if not name:
        return None
    u = str(name).upper()
    for r in _POS_RULES:
        if r["contains"] in u:
            return r["key"]
    return None

# ═══ NGƯỜI NGOÀI TEAM — chạy chung 14 TKQC + chung shop POS ═══
# Tách bạch chứ không gộp vào "(không gán)": chi phí của họ là tiền THẬT đi ra từ TKQC
# của TALPHA. Luôn tra bảng TEAM trước, trượt mới tra bảng này.
EXTERNAL          = RULES.get("external_marketers", {})
EXTERNAL_DISPLAY  = {k: v["display"] for k, v in EXTERNAL.items()}
EXTERNAL_FULL     = {k: v["full"] for k, v in EXTERNAL.items()}
_EXT_CAMP_TOKENS  = {k: v for k, v in RULES.get("camp_external_tokens", {}).items()
                     if not k.startswith("_")}
_EXT_POS_RULES    = RULES.get("pos_external_rules", [])

def norm_nv_external(s):
    """Segment ngay sau thị trường → key NGOÀI TEAM. Cùng cơ chế VỊ TRÍ với norm_nv —
    KHÔNG quét cả tên, vì 'kính lấp lánh'/'KÍNH UV'/'việt quẩt đen' là TÊN SẢN PHẨM."""
    if not s:
        return None
    u = s.strip().upper().replace(".", "").replace(" ", "")
    return _EXT_CAMP_TOKENS.get(u)

def norm_pos_external(name):
    """Tên tag POS → key NGOÀI TEAM (chỉ gọi khi norm_pos_nv trả None)."""
    if not name:
        return None
    u = str(name).upper()
    for r in _EXT_POS_RULES:
        if r["contains"] in u:
            return r["key"]
    return None

def parse_campaign_any(cn):
    """(thị trường, key, la_ngoai_team) — như parse_campaign nhưng nhận cả người ngoài team."""
    p = [x.strip() for x in (cn or "").split("/")]
    mi = next((i for i, s in enumerate(p) if s.upper() in MARKETS), None)
    if mi is None:
        return None, None, False
    mkt = MARKETS[p[mi].upper()]
    seg = p[mi + 1] if mi + 1 < len(p) else None
    team = norm_nv(seg)
    if team:
        return mkt, team, False
    ext = norm_nv_external(seg)
    return mkt, ext, bool(ext)

def _has_word_token(u, tok):
    return re.search(r"(^|[^A-Z])" + re.escape(tok) + r"([^A-Z]|$)", u) is not None

def scan_campaign_marketer(name):
    """Quét CẢ TÊN campaign → key marketer (dùng cho cảnh báo/bot, không cần parse segment)."""
    u = str(name or "").upper()
    for r in _SCAN_RULES:
        for s in r.get("substrings", []):
            if s in u:
                return r["key"]
        for t in r.get("word_tokens", []):
            if _has_word_token(u, t):
                return r["key"]
        rx = r.get("regex")
        if rx and re.search(rx, u):
            return r["key"]
    return None

_TESTRE = re.compile(RULES["test_campaign"]["pattern"])
_NO_TEST = set(RULES["test_campaign"]["exempt_markets"])
NO_TEST_MARKETS = _NO_TEST  # alias public (format_all dùng trực tiếp)

def is_test(cn, mkt=None):
    if mkt in _NO_TEST:
        return False
    return bool(_TESTRE.search(cn or ""))

# ── Phí ship 3PL (tệ địa phương, key = shop_label) ──
SHIP_FEES = RULES.get("shipping_fees", {})

def shipping_vnd(shop_label, orders, revenue_local):
    """Phí ship ước tính (VND) cho 1 thị trường, từ số đơn GTC + doanh thu tệ địa phương.
    KHÔNG dùng sale_order.shipping_fee (cột này mirror cod, rác). Thị trường chưa khai phí → 0."""
    f = SHIP_FEES.get((shop_label or "").upper())
    if not f or not orders or orders <= 0:
        return 0.0
    local = orders * (f["packing"] + f["delivery"] + f.get("cod_flat", 0)) + (revenue_local or 0) * f.get("cod_pct", 0)
    mkt = SHOP2MKT.get((shop_label or "").upper())
    return local * RATE.get(mkt, 0)

# ── Giá vốn theo SKU (E2) — VND/unit, key = product_catalog.sku ──
# POS không trả giá vốn (variation_info.last_imported_price/avg_price = 0 mọi item)
# → khối products trong JSON là nguồn DUY NHẤT. Song song với PRODUCT_COSTS bên rules.ts.
# Giá vốn khai bằng TỆ từ 08/09/2026 → VND = tệ × cost_rate_rmb_vnd. Bỏ qua cost_price_vnd cũ
# (giá hệ thống GCC, cao gấp mấy lần giá thật) — cùng luật với PRODUCT_COSTS bên rules.ts.
COST_RATE_RMB_VND = RULES.get("cost_rate_rmb_vnd") or 3860
PRODUCT_COSTS = {
    k: dict(v, cost_price_vnd=round(v["cost_price_rmb"] * COST_RATE_RMB_VND))
    for k, v in RULES.get("products", {}).items()
    if not k.startswith("_") and isinstance(v, dict) and isinstance(v.get("cost_price_rmb"), (int, float)) and v["cost_price_rmb"] > 0
}

def cost_price_vnd(sku):
    """Giá vốn 1 unit theo SKU (VND); None = SKU chưa khai giá vốn — KHÔNG coi là 0."""
    e = PRODUCT_COSTS.get(str(sku or "").strip())
    return e["cost_price_vnd"] if e else None

# ═══════════════════════════════════════════════════════════════════
# GÁN MARKETER — RULE CEO 3 BẬC (nguồn duy nhất, mọi consumer gọi hàm này)
#   1. Tag marketer trong POS  →  2. ad_id → chủ campaign  →  3. "(không gán)"
# Đơn không gán được KHÔNG bị bỏ lặng lẽ — luôn rơi vào bậc 3 để còn thấy trên báo cáo.
# ═══════════════════════════════════════════════════════════════════
UNASSIGNED = "(không gán)"

# ═══ NGƯỜI ĐÃ NGHỈ — dồn hết về "(không gán)" (khối unassign_marketers trong JSON) ═══
# CỐ Ý vẫn nhận diện được tên POS và campaign của họ: xoá khỏi pos_marketer_rules /
# camp_marketer_tokens thì campaign của họ không parse ra marketer nữa và spend rơi vào
# DROPPED — biến mất im lặng khỏi mọi báo cáo (đúng lỗi 20/08 đã phải đi vá). Ở đây chỉ
# đổi Ô ĐÍCH: nhận ra là của Mai/Thế → ném vào "(không gán)" cho CEO lọc tay sau.
UNASSIGN = set(RULES.get("unassign_marketers", []))

def bucket_nv(nv):
    """Key marketer → key ô báo cáo. Người đã nghỉ (UNASSIGN) → "(không gán)"."""
    return UNASSIGNED if nv in UNASSIGN else nv

def parse_campaign(cn):
    """campaign_name → (thị trường, key marketer). Quy ước tên: '… / <Thị trường> / <Marketer> / …'
    — tìm ô ĐẦU TIÊN là tên thị trường (bỏ qua tiền tố Tặng//LADI/), marketer là ô ngay SAU."""
    p = [x.strip() for x in (cn or "").split("/")]
    mi = next((i for i, s in enumerate(p) if s.upper() in MARKETS), None)
    if mi is None:
        return None, None
    return MARKETS[p[mi].upper()], (norm_nv(p[mi + 1]) if mi + 1 < len(p) else None)

def build_adid_owner(rows):
    """[(ad_id, campaign_name), …] → {ad_id: key marketer} — bảng tra cho BẬC 2."""
    out = {}
    for ad_id, cn in rows:
        if not ad_id:
            continue
        _mkt, nv = parse_campaign(cn)
        # Người đã nghỉ KHÔNG vào bảng tra: bậc 2 mà trả về họ thì đơn không tag lại
        # chui ngược vào ô của họ, đúng thứ vừa bỏ đi.
        if nv and nv not in UNASSIGN:
            out[str(ad_id)] = nv
    return out

def attribute_order(pos_marketer=None, ad_id=None, adid_owner=None):
    """Gán 1 đơn về marketer theo rule CEO. Trả (key, nguồn):
       ('Loc', 'pos_tag') | ('Loc', 'ad_id') | ('(không gán)', 'unassigned')."""
    nv = norm_pos_nv(pos_marketer)
    if nv:
        # Đã nghỉ → "(không gán)" NGAY, không rơi xuống bậc 2: tag POS là bằng chứng
        # đơn này của họ, để fallback ad_id đẩy sang người khác là gán sai người.
        return (UNASSIGNED, "unassigned") if nv in UNASSIGN else (nv, "pos_tag")
    if ad_id and adid_owner:
        nv = adid_owner.get(str(ad_id))
        if nv:
            return nv, "ad_id"
    return UNASSIGNED, "unassigned"


# ═══ SẢN PHẨM + PAGE CỦA CAMPAIGN, VÀ GÁN ĐƠN → SẢN PHẨM THEO PAGE ═══════════════════
# Chuẩn tên (docs/CHUAN_DAT_TEN_CAMPAIGN.md): NƯỚC/MARKETER/TỆPKHÁCH/MÃSANPHAM/TENTRANG/NGAY.
# Tên cũ bỏ ô nước: MARKETER/TỆPKHÁCH/MÃSANPHAM/TENTRANG/NGAY. Hai kiểu cùng một luật:
# SẢN PHẨM = ô thứ HAI sau ô marketer, TÊN TRANG = ô thứ ba (ô ngay sau marketer là tệp khách).
# Cùng luật với tenNganCamp của bot Zalo (ops/zalo-alerts/rules.js).
#
# 16/09/2026 sửa hai lỗi đọc ô của format_all.py:
#   · tên có ô nước lấy ô NGAY SAU marketer làm sản phẩm → ra tệp khách: file Lộc có tab
#     "PHI" 4,98tr và "INDO" 1,64tr tiền ads, không phải sản phẩm nào;
#   · tên có số page lấy ô SAU con số làm sản phẩm — kiểu GCC cũ số page đứng trước tên
#     trang, nay đứng sau → ra NGÀY: file Thắng có tab "4-9 TEST", file Thương có tab "7-9".
def camp_san_pham(cn):
    """Tên campaign → (sản phẩm, tên trang, page_id). Không nhận ra marketer → (None, None, None)."""
    p = [x.strip() for x in (cn or "").split("/")]
    mi = next((i for i, s in enumerate(p) if s.upper() in MARKETS), None)
    if mi is not None:
        k = mi + 1
    else:
        k = next((i for i, s in enumerate(p[:2]) if norm_nv(s)), None)
        if k is None:
            return None, None, None
    sp = p[k + 2] if len(p) > k + 2 else ""
    trang = p[k + 3] if len(p) > k + 3 else ""
    # Số page (6+ chữ số) ở bất kỳ ô nào sau marketer — kiểu GCC cũ đứng trước tên trang,
    # kiểu hiện tại đứng sau. Ngày "2808" chỉ 4 số nên không lẫn.
    page_id = next((s.replace(" ", "") for s in p[k + 1:] if NUMID.match(s.replace(" ", ""))), None)
    if page_id and NUMID.match(sp.replace(" ", "")):
        sp = trang                                   # kiểu GCC: số page chiếm ô sản phẩm → sản phẩm là tên trang (luồng cũ)
    if sp.upper() == "TEST":
        sp = f"TEST · {trang}" if trang else "TEST"  # camp thử: tách theo trang, không dồn chung một tab "TEST"
    return (sp or "(khác)"), (trang or None), page_id


def hoc_page_san_pham(cap):
    """[(page_id, sản phẩm, số đơn), …] → {page_id: {sản phẩm: số đơn}}.

    Tên campaign bây giờ ghi TÊN trang chứ không ghi SỐ page, nên mối nối page ↔ campaign
    phải học từ chính đơn POS: đơn nào có CẢ page_id lẫn ad_id (tháng 9/2026: 126/131 đơn
    Đài) là một bằng chứng "page này đang chạy sản phẩm này"."""
    out = {}
    for page_id, sp, n in cap:
        if page_id and sp:
            d = out.setdefault(str(page_id), {})
            d[sp] = d.get(sp, 0) + (n or 0)
    return out


def san_pham_cua_don(page_id, sp_quang_cao, page_sp):
    """Đơn → sản phẩm, TÍNH THEO PAGE (luồng nghiệp vụ cũ, Sỹ Anh nhắc 16/09/2026): sản phẩm
    của đơn là sản phẩm đang chạy trên page của đơn.
      · page chạy MỘT sản phẩm        → sản phẩm đó, kể cả đơn không ghi quảng cáo;
      · page chạy NHIỀU sản phẩm      → tách theo quảng cáo của chính đơn; đơn không ghi
                                        quảng cáo → sản phẩm nhiều đơn nhất của page;
      · page chưa nối được camp nào   → quảng cáo của đơn; không có → "(khác)".
    Trước bản này đơn chỉ nối được qua SỐ page trong tên campaign — tên hiện tại không ghi
    số nên toàn bộ đơn rơi vào tab "(khác)", tab sản phẩm nào cũng 0 đơn."""
    ung = page_sp.get(str(page_id)) if page_id else None
    if ung:
        if len(ung) == 1:
            return next(iter(ung))
        if sp_quang_cao in ung:
            return sp_quang_cao
        return sorted(ung.items(), key=lambda x: (-x[1], x[0]))[0][0]
    return sp_quang_cao or "(khác)"

"""
ops/talpha_reports/team_report.py — Báo cáo ADS gộp TEAM + từng marketer (file "Tháng 6 AI").

Sinh tab "Tổng ADS TEAM" (cộng 8 marketer) + 1 tab mỗi marketer, daily theo tháng.
Nguồn: BQ fb_ads_data (spend, tin nhắn) + sale_order (đơn, doanh thu) — lọc đúng tập
campaign thuộc 8 marketer (loại team khác Thắng/Kính) nên TEAM = đúng tổng các tab.

Quy ước campaign: "Thị trường / Marketer / SP / ad_id / ...". parse_camp tìm tên
thị trường ở mọi vị trí (xử lý tiền tố Tặng/, LADI/), marketer là ô ngay sau.

Usage:
  GOOGLE_APPLICATION_CREDENTIALS=bigquery_key.json python ops/talpha_reports/team_report.py
"""
import calendar, collections, os, sys
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from google.cloud import bigquery

# ── RULE CHUNG: đọc talpha_rules.json qua loader — KHÔNG hard-code lại tỷ giá/marketer ở đây.
# Trước 03/08 file này giữ bản FX + norm_nv riêng và THIẾU Taiwan → đơn TW quy nhầm giá AED.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from talpha_rules import RATE, SHOP2MKT, MONEY_DIV_SHOP, parse_campaign

# ── Cấu hình ──
SHEET_ID = os.environ.get("TEAM_REPORT_SHEET_ID", "1csd7AO_0ZH4qOoqO_Fj82sJvAf5pR3Iciu7TFqIPpj8")
KEY = "bigquery_key.json"
P = "cty-507710.TALPHA_Dataset"
YEAR, MONTH = 2026, 6
SHIP = 0.50  # tỉ lệ giao thành công ước tính cho "DS ship dự kiến"


def fx_of(shop_label):
    """shop_label (AE/SA/KW/TW…) → tỷ giá VND theo talpha_rules.json; lạ → 7010 như cũ."""
    return RATE.get(SHOP2MKT.get((shop_label or "").upper()), 7010)


def div_of(shop_label):
    """X13 — shop_label → số chia đưa cod thô về tiền thật (GCC 100, Đài 1).
    Gõ thẳng /100 là làm doanh thu Đài tụt 100 lần."""
    return MONEY_DIV_SHOP.get((shop_label or "").upper(), 100)

# tab -> marketer key; TEAM=None nghĩa là gộp tất cả
TAB2NV = {
    "Tổng ADS TEAM": None,
    "Tổng ADS C.Thuý": "ChuThuy", "Tổng ADS LOC": "Loc", "Tổng ADS MAI": "Mai",
    "Tổng ADS NHUNG": "Nhung", "Tổng ADS Thế": "The", "TỔNG ADS CHÍNH": "Chinh",
    "Tổng ADS Quân": "Quan",
}
HDR = ["Ngày", "TỔNG TIỀN ADS", "SỐ TIN NHẮN", "Giá Tiền/TN", "CPO", "Tỷ lệ chốt",
       "Số đơn", "Doanh Số", "DS ship dự kiến", "% Ads/DT", "% Ads/DT ship", "TB đơn"]


def nv_of(cn):
    """campaign_name → key marketer (dùng parse_campaign chung của talpha_rules)."""
    return parse_campaign(cn)[1]


def rgb(h):
    h = h.lstrip("#")
    return {"red": int(h[0:2], 16) / 255, "green": int(h[2:4], 16) / 255, "blue": int(h[4:6], 16) / 255}


def drow(day, sp, msg, n, rev):
    ship = rev * SHIP
    return [day, round(sp), msg, round(sp / msg) if msg else 0, round(sp / n) if n else 0,
            round(n / msg * 100, 2) if msg else 0, n, round(rev), round(ship),
            round(sp / rev * 100, 2) if rev else 0, round(sp / ship * 100, 2) if ship else 0,
            round(rev / n) if n else 0]


def main():
    creds = Credentials.from_service_account_file(
        KEY, scopes=["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/bigquery"])
    sv = build("sheets", "v4", credentials=creds)
    bq = bigquery.Client(credentials=creds, project="cty-507710")
    frm, to = f"{YEAR}-{MONTH:02d}-01", f"{YEAR}-{MONTH:02d}-{calendar.monthrange(YEAR, MONTH)[1]:02d}"

    # ads per (nv|TEAM, ngày) + ad_id -> nv
    ads = collections.defaultdict(lambda: {"spend": 0.0, "msg": 0})
    adid_mkt = {}
    for r in bq.query(f"SELECT date, ad_id, campaign_name, SUM(spend) sp, SUM(messaging_conversations_started) msg FROM `{P}.fb_ads_data` WHERE date BETWEEN '{frm}' AND '{to}' GROUP BY date,ad_id,campaign_name").result():
        nv = nv_of(r.campaign_name)
        if not nv:
            continue
        d = str(r.date)
        for key in (nv, "__TEAM__"):
            ads[(key, d)]["spend"] += r.sp or 0
            ads[(key, d)]["msg"] += int(r.msg or 0)
        if r.ad_id is not None:
            adid_mkt[str(r.ad_id)] = nv

    # orders per (nv|TEAM, ngày)
    orders = collections.defaultdict(lambda: {"n": 0, "rev": 0.0})
    for r in bq.query(f"SELECT SUBSTR(inserted_at,1,10) d, ad_id, shop_label, COUNT(*) n, SUM(cod) cod FROM `{P}.sale_order` WHERE SUBSTR(inserted_at,1,10) BETWEEN '{frm}' AND '{to}' AND ad_id IS NOT NULL AND ad_id != '' GROUP BY d,ad_id,shop_label").result():
        nv = adid_mkt.get(str(r.ad_id))
        if not nv:
            continue
        rev = (r.cod or 0) / div_of(r.shop_label) * fx_of(r.shop_label)
        for key in (nv, "__TEAM__"):
            orders[(key, r.d)]["n"] += int(r.n or 0)
            orders[(key, r.d)]["rev"] += rev

    ndays = calendar.monthrange(YEAR, MONTH)[1]
    meta = sv.spreadsheets().get(spreadsheetId=SHEET_ID).execute()
    sid_map = {s["properties"]["title"]: s["properties"]["sheetId"] for s in meta["sheets"]}

    for tab, nv in TAB2NV.items():
        if tab not in sid_map:
            print(f"  ⚠ thiếu tab {tab} — bỏ qua")
            continue
        key = "__TEAM__" if nv is None else nv
        rows = [HDR]
        T = {"sp": 0, "msg": 0, "n": 0, "rev": 0.0}
        for d in range(1, ndays + 1):
            dk = f"{YEAR}-{MONTH:02d}-{d:02d}"
            sp = ads[(key, dk)]["spend"]; msg = ads[(key, dk)]["msg"]
            n = orders[(key, dk)]["n"]; rev = orders[(key, dk)]["rev"]
            T["sp"] += sp; T["msg"] += msg; T["n"] += n; T["rev"] += rev
            rows.append(drow(f"{d:02d}/{MONTH:02d}/{YEAR}", sp, msg, n, rev))
        rows.append(drow("TỔNG", T["sp"], T["msg"], T["n"], T["rev"]))

        sheet_id = sid_map[tab]; nr = len(rows)
        sv.spreadsheets().values().clear(spreadsheetId=SHEET_ID, range=f"'{tab}'!A1:N100").execute()
        sv.spreadsheets().values().update(spreadsheetId=SHEET_ID, range=f"'{tab}'!A1", valueInputOption="USER_ENTERED", body={"values": rows}).execute()
        money = lambda a, b, pat: {"repeatCell": {"range": {"sheetId": sheet_id, "startRowIndex": 1, "endRowIndex": nr, "startColumnIndex": a, "endColumnIndex": b}, "cell": {"userEnteredFormat": {"numberFormat": {"type": "NUMBER", "pattern": pat}}}, "fields": "userEnteredFormat.numberFormat"}}
        reqs = [
            {"updateSheetProperties": {"properties": {"sheetId": sheet_id, "gridProperties": {"frozenRowCount": 1}}, "fields": "gridProperties.frozenRowCount"}},
            {"repeatCell": {"range": {"sheetId": sheet_id, "startRowIndex": 0, "endRowIndex": 1, "startColumnIndex": 0, "endColumnIndex": 12}, "cell": {"userEnteredFormat": {"backgroundColor": rgb("#1B4F72"), "horizontalAlignment": "CENTER", "wrapStrategy": "WRAP", "textFormat": {"bold": True, "fontSize": 9, "foregroundColor": rgb("#FFFFFF")}}}, "fields": "userEnteredFormat(backgroundColor,horizontalAlignment,wrapStrategy,textFormat)"}},
            {"repeatCell": {"range": {"sheetId": sheet_id, "startRowIndex": nr - 1, "endRowIndex": nr, "startColumnIndex": 0, "endColumnIndex": 12}, "cell": {"userEnteredFormat": {"backgroundColor": rgb("#C0392B"), "textFormat": {"bold": True, "foregroundColor": rgb("#FFFFFF")}}}, "fields": "userEnteredFormat(backgroundColor,textFormat)"}},
            money(1, 2, "#,##0"), money(3, 5, '#,##0" đ"'), money(7, 9, "#,##0"),
            money(11, 12, '#,##0" đ"'), money(5, 6, '0.0"%"'), money(9, 11, '0.0"%"'),
        ]
        sv.spreadsheets().batchUpdate(spreadsheetId=SHEET_ID, body={"requests": reqs}).execute()
        print(f"  ✅ {tab}: ads {round(T['sp']):,} đ | {T['n']} đơn | DT {round(T['rev']):,} đ")
    print("Xong.")


if __name__ == "__main__":
    main()

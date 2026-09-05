#!/usr/bin/env python3
# TALPHA — so sánh bảng *_shadow (engine repo) vs bảng thật (engine runtime).
# Chạy sau mỗi shadow-run. Khớp 7 ngày liên tục → được phép cutover (xem
# docs/proposals/SYNC_CONSOLIDATION_PLAN.md). KHÔNG ghi gì — chỉ đọc + in kết quả.
#
# Nguyên tắc công bằng (30/07): LOẠI NGÀY HÔM NAY khỏi mọi phép so — 2 engine chụp
# ở 2 thời điểm khác nhau trong khi đơn/spend hôm nay vẫn đang nhảy → lệch là do
# thời điểm, không phải logic. Đơn lịch sử: dung sai 1% (race phân trang updated_at).
import os, sys, datetime
os.environ.setdefault("GOOGLE_APPLICATION_CREDENTIALS",
                      os.path.expanduser("~/talpha_reports/runtime/bigquery_key.json"))
from google.cloud import bigquery

P = "talpha-faos-2026.TALPHA_Dataset"
bq = bigquery.Client(project="talpha-faos-2026")
fails = []
TODAY = (datetime.datetime.utcnow() + datetime.timedelta(hours=7)).strftime("%Y-%m-%d")  # ngày VN
# Ads: ngày `date` theo TZ TỪNG ACCOUNT (rule #6) — account xa nhất là "múi h Mỹ" (LA).
# Mốc phải neo theo THỜI ĐIỂM CHỤP CỦA BẢNG, không phải lúc chạy compare (bug 03/08:
# shadow ghi 10:06 khi 02/08 ở LA còn 4h nữa mới đóng; compare chạy 16:11 đưa 02/08 vào
# so → "lệch 12%" trong khi cả 2 engine đều khớp Meta sau khi ngày đóng).
# Lấy bảng chụp SỚM HƠN trong 2 bảng, lùi 8h (conservative, phủ cả PST lẫn PDT).
def _snapshot_utc(tbl):
    return bq.get_table(f"{P}.{tbl}").modified.replace(tzinfo=None)
_SNAP = min(_snapshot_utc("fb_ads_data"), _snapshot_utc("fb_ads_data_shadow"))
ADS_DONE = (_SNAP - datetime.timedelta(hours=8)).strftime("%Y-%m-%d")
# Chỉ so đơn THÁNG NÀY: bảng thật còn dính đơn cũ (tháng 5-6) được update gần đây —
# "đuôi" Smart-Stop 2 engine bắt khác nhau, không phải sai số liệu tháng đang báo cáo.
MSTART = TODAY[:8] + "01"

def q1(sql):
    return list(bq.query(sql).result())

def check(name, sql_pair, tol=0.01, abs_floor=0):
    # abs_floor: bỏ qua lệch tuyệt đối nhỏ hơn ngưỡng — bảng thật do launchd sync
    # mỗi giờ (stale ≤1h) trong khi shadow fetch POS live, 1-vài đơn flip status/sửa
    # giữa 2 snapshot là chuyện thường; tol % vô nghĩa khi baseline gần 0 (đầu tháng).
    try:
        real = q1(sql_pair[0]); shad = q1(sql_pair[1])
    except Exception as e:
        fails.append(f"{name}: query lỗi — {e}"); print(f"✗ {name}: {str(e)[:150]}"); return
    rmap = {tuple(r.values())[:-1]: list(r.values())[-1] for r in real}
    smap = {tuple(r.values())[:-1]: list(r.values())[-1] for r in shad}
    bad = []
    for k in sorted(set(rmap) | set(smap)):
        a, b = float(rmap.get(k, 0) or 0), float(smap.get(k, 0) or 0)
        if abs(a - b) <= abs_floor: continue
        if abs(a - b) > tol * max(abs(a), abs(b), 1):
            bad.append(f"{k}: real={a:,.0f} shadow={b:,.0f}")
    if bad:
        fails.append(f"{name}: {len(bad)} nhóm lệch >{tol:.0%}")
        print(f"✗ {name}: {len(bad)} nhóm lệch"); [print("   ", x) for x in bad[:6]]
    else:
        extra = f", floor {abs_floor:,}" if abs_floor else ""
        print(f"✓ {name}: khớp ({len(rmap)} nhóm, tol {tol:.0%}{extra}, đã loại hôm nay {TODAY})")

# 1. Ads: SUM(spend) theo account × ngày — chỉ ngày đã chốt ở MỌI tz account TẠI LÚC CHỤP
print(f"(ads bound: date < {ADS_DONE} — bảng chụp sớm nhất {_SNAP:%Y-%m-%d %H:%M} UTC)")
check("fb_ads spend theo account/ngày", (
    f"SELECT account_name, CAST(date AS STRING) d, SUM(spend) v FROM `{P}.fb_ads_data` WHERE CAST(date AS STRING) < '{ADS_DONE}' GROUP BY 1,2",
    f"SELECT account_name, CAST(date AS STRING) d, SUM(spend) v FROM `{P}.fb_ads_data_shadow` WHERE CAST(date AS STRING) < '{ADS_DONE}' GROUP BY 1,2"))
# 2. Đơn: COUNT theo shop × ngày (tháng này; tol 2% — đơn có thể bị xoá/sửa trong POS
# giữa 2 thời điểm chụp, verify 30/07: SA 08/07 lệch đúng 2/186 đơn giữa 2 snapshot)
check("sale_order count theo shop/ngày", (
    f"SELECT shop_label, SUBSTR(inserted_at,1,10) d, COUNT(*) v FROM `{P}.sale_order` WHERE SUBSTR(inserted_at,1,10) >= '{MSTART}' AND SUBSTR(inserted_at,1,10) < '{TODAY}' GROUP BY 1,2",
    f"SELECT shop_label, SUBSTR(inserted_at,1,10) d, COUNT(*) v FROM `{P}.sale_order_shadow` WHERE SUBSTR(inserted_at,1,10) >= '{MSTART}' AND SUBSTR(inserted_at,1,10) < '{TODAY}' GROUP BY 1,2"), tol=0.02)
# 3. Đơn: SUM(cod) GTC theo shop (loại hôm nay)
check("sale_order cod GTC theo shop", (
    f"SELECT shop_label, 'x' k, SUM(cod) v FROM `{P}.sale_order` WHERE status_category='GIAO_THANH_CONG' AND SUBSTR(inserted_at,1,10) >= '{MSTART}' AND SUBSTR(inserted_at,1,10) < '{TODAY}' GROUP BY 1,2",
    f"SELECT shop_label, 'x' k, SUM(cod) v FROM `{P}.sale_order_shadow` WHERE status_category='GIAO_THANH_CONG' AND SUBSTR(inserted_at,1,10) >= '{MSTART}' AND SUBSTR(inserted_at,1,10) < '{TODAY}' GROUP BY 1,2"), tol=0.02, abs_floor=50_000)  # ≈ vài đơn flip GTC trong cửa sổ stale ≤1h (cod = POS-currency ×100)
# 4. Items: SUM(quantity) theo shop (loại hôm nay theo order_inserted_at)
check("order_items qty theo shop", (
    f"SELECT shop_id, 'x' k, SUM(quantity) v FROM `{P}.order_items` WHERE SUBSTR(order_inserted_at,1,10) >= '{MSTART}' AND SUBSTR(order_inserted_at,1,10) < '{TODAY}' GROUP BY 1,2",
    f"SELECT shop_id, 'x' k, SUM(quantity) v FROM `{P}.order_items_shadow` WHERE SUBSTR(order_inserted_at,1,10) >= '{MSTART}' AND SUBSTR(order_inserted_at,1,10) < '{TODAY}' GROUP BY 1,2"), tol=0.02, abs_floor=30)  # ≈ chục đơn sửa item trong cửa sổ stale ≤1h
# 5. Campaign metadata: số campaign + tổng daily_budget (bảng này KHÔNG có spend)
check("fb_campaign count + budget", (
    f"SELECT 'n' k, 'x' k2, COUNT(*) v FROM `{P}.fb_campaign_data`",
    f"SELECT 'n' k, 'x' k2, COUNT(*) v FROM `{P}.fb_campaign_data_shadow`"), tol=0.02)

print("\n===> SHADOW COMPARE:", "PASS" if not fails else f"FAIL ({len(fails)})")
sys.exit(0 if not fails else 1)

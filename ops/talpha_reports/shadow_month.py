# TALPHA — shadow-run engine REPO, mô phỏng ĐÚNG cách sync_month.py gọi engine runtime:
# orders bound theo window_start = TALPHA_ORDER_WINDOW_DAYS ngày (mặc định 30, đúng
# như sync_month.py sau X1), ads days_back = month-to-date. Ghi vào bảng *_shadow.
# Chạy bởi shadow_run.sh từ clone ~/talpha_shadow (off-Desktop cho launchd).
import os, datetime, sys

SHADOW = os.path.expanduser('~/talpha_shadow')
sys.path.insert(0, SHADOW)
os.chdir(os.path.expanduser('~/talpha_reports'))
os.environ.setdefault('GOOGLE_APPLICATION_CREDENTIALS',
                      os.path.expanduser('~/talpha_reports/runtime/bigquery_key.json'))

import sync.talpha.talpha_sync as ts  # noqa: E402

ts.TABLE_SUFFIX = '_shadow'
print("shadow engine =", ts.__file__, "| suffix =", ts.TABLE_SUFFIX)

today = datetime.date.today()
first = today.replace(day=1)
# Phải gọi ENGINE Y HỆT sync_month.py, nếu không compare thành so hai cửa sổ khác nhau.
# X1 (04/08) đổi cả chữ ký: sync_all_orders(window_start=…) thay last_sync_ts,
# sync_fb_ads trả (ads, adsets) thay 1 giá trị — shadow gọi kiểu cũ thì ORDERS FAIL
# im lặng, bảng *_shadow giữ số của lần chạy trước và compare FAIL oan.
WINDOW_DAYS = int(os.environ.get("TALPHA_ORDER_WINDOW_DAYS", "30"))
ws = (today - datetime.timedelta(days=WINDOW_DAYS)).strftime("%Y-%m-%dT00:00:00")
print("window_start", ws, f"({WINDOW_DAYS} ngày)")
rc = 0
try:
    o, i = ts.sync_all_orders(window_start=ws); print("orders", o, "items", i)
except Exception as e:
    print("ORDERS FAIL:", e); rc = 1
try:
    a, ad = ts.sync_fb_ads(days_back=(today - first).days + 1); print("ads", a, "adsets", ad)
except Exception as e:
    print("ADS FAIL:", e); rc = 1
try:
    print("camps", ts.sync_campaign_data())
except Exception as e:
    print("camp err", e)
sys.exit(rc)

import os, datetime, sys
# Dùng code REPO khi đọc được (chạy tay); dưới launchd (~/Desktop bị chặn Full Disk Access)
# import sẽ rơi xuống bản runtime ($PYTHONPATH) — CẢ HAI bản đã vá an toàn 06/07.
REPO='/Users/syanh/Desktop/Agentic-AI-Levelup'
sys.path.insert(0, REPO)
os.chdir('/Users/syanh/talpha_reports')  # KHÔNG chdir vào Desktop (launchd không đọc được)
# FIX 29/06: KHÔNG ghi đè cứng key trong ~/Desktop (launchd thiếu Full Disk Access -> PermissionError).
os.environ.setdefault('GOOGLE_APPLICATION_CREDENTIALS', '/Users/syanh/talpha_reports/runtime/bigquery_key.json')
# FIX 06/07: BỎ DROP bảng trước fetch. Trước đây DROP xong mới fetch → fetch chết giữa
# chừng (SA reset page 11 / Tiểu Alpha timeout+rate-limit) = mất trắng dữ liệu → Sheet
# sai đơn & spend hàng loạt. Giờ sync ghi WRITE_TRUNCATE atomic: chỉ thay bảng KHI fetch
# đủ; fetch fail → raise → bảng cũ còn nguyên (số cũ nhưng đúng), exit code ≠ 0 để soi log.
import sync.talpha.talpha_sync as ts
print("sync code =", ts.__file__)  # soi bản nào được import (repo vs runtime)
today=datetime.date.today(); first=today.replace(day=1)
# X1 (04/08): cửa sổ theo NGÀY TẠO đơn, không còn Smart Stop theo updated_at.
# Rộng hơn đầu tháng vì đơn COD tạo tháng trước vẫn đang đổi trạng thái; bảng đích
# nay dựng lại từ sale_order_raw nên cửa sổ chỉ quyết định "đơn nào được làm mới",
# KHÔNG còn quyết định "đơn nào bị xoá".
WINDOW_DAYS=int(os.environ.get("TALPHA_ORDER_WINDOW_DAYS","30"))
ws=(today-datetime.timedelta(days=WINDOW_DAYS)).strftime("%Y-%m-%dT00:00:00")
print("window_start",ws,f"({WINDOW_DAYS} ngày)")
rc=0
try:
    o,i=ts.sync_all_orders(window_start=ws); print("orders",o,"items",i)
except Exception as e:
    print("ORDERS FAIL (bảng cũ giữ nguyên):", e); rc=1
try:
    a,ad=ts.sync_fb_ads(days_back=(today-first).days+1); print("ads",a,"adsets",ad)
except Exception as e:
    print("ADS FAIL (bảng cũ giữ nguyên):", e); rc=1
try: print("camps",ts.sync_campaign_data())
except Exception as e: print("camp err",e)
# X9: tra Meta cho ad_id trên đơn mà insights không trả (ad xoá/tạo lại giữ id cũ,
# TKQC ngoài roster) → attribution bậc 2 nối được đơn. Không chặn vòng chạy.
try: print("ad_dic",ts.sync_ad_dictionary())
except Exception as e: print("ad_dic err",e)
sys.exit(rc)

import os, datetime, sys
# Dùng code REPO khi đọc được (chạy tay); dưới launchd (~/Desktop bị chặn Full Disk Access)
# import sẽ rơi xuống bản runtime ($PYTHONPATH) — CẢ HAI bản đã vá an toàn 06/07.
# Đường dẫn hỏi talpha_paths chứ KHÔNG ghi cứng nữa (11/09/2026). Bản cũ ghi
# thẳng /Users/syanh/... nên lên VPS là chết ngay ở os.chdir — mà chết lặng:
# daily_guarded thấy sync rc=1 nên bỏ qua bước ghi Sheet đúng theo chốt 03/09,
# vòng chạy vẫn "xong" mỗi giờ trong khi Sheet đứng im.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import talpha_paths
REPO = talpha_paths.repo_dir()
sys.path.insert(0, REPO)
# FIX 29/06: KHÔNG ghi đè cứng key trong ~/Desktop (launchd thiếu Full Disk Access -> PermissionError).
talpha_paths.dat_moi_truong()
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

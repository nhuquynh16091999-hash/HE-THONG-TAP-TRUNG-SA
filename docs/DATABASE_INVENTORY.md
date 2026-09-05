# 🗺️ SỔ TAY DATABASE & ĐĂNG NHẬP — FAOS

> **Đây là NGUỒN SỰ THẬT DUY NHẤT về: dữ liệu của tôi nằm ở đâu, đăng nhập bằng gì, lấy lại thế nào.**
> Mỗi khi thêm project/đổi khoá → cập nhật file này NGAY.
> ⚠️ File này KHÔNG chứa mật khẩu/khoá thật — chỉ ghi *chỗ chứa* và *cách lấy lại*.
> Giá trị bí mật để trong **password manager** (xem mục cuối).

_Lần xác minh gần nhất: 2026-06-17_

---

## 1. TỔNG QUAN: Dữ liệu của tôi nằm ở đâu?

| Hệ | Loại | Nằm ở đâu | Đăng nhập bằng |
|---|---|---|---|
| **BigQuery** | Data warehouse chính (tất cả đơn/ads/phân tích) | Google Cloud, 2 GCP project | Service account key `bigquery_key.json` |
| **Google Sheets** | Tồn kho TALPHA (live) | Google Drive | Cùng service account (chia sẻ quyền xem) |
| **Poscake/Pancake POS** | Nguồn đơn hàng gốc | pos.pages.fm (cloud) | API key mỗi shop |
| **Meta/Facebook Ads** | Nguồn dữ liệu quảng cáo | Meta cloud | App ID/Secret + Access Token |

> 💡 **Điểm mất dữ liệu thường gặp:** không phải BigQuery sập, mà là **mất `bigquery_key.json` / `.env`** (chỉ có trên 1 máy, không backup) → mất quyền truy cập toàn bộ. Xem mục 4 & 5.

---

## 2. CÁC DATABASE BIGQUERY (theo từng project/khách hàng)

Cùng kiến trúc, tách dataset theo dự án. Đổi DB đang dùng = sửa `BQ_PROJECT_ID` + `BQ_DATASET` trong `.env`.

| Dự án | GCP Project | Dataset | Ghi chú |
|---|---|---|---|
| **TALPHA** ⭐ đang active | `talpha-faos-2026` | `TALPHA_Dataset` | 6 shop GCC (SA/AE/KW/OM/QA/BH). GCP project RIÊNG. |
| STRAMARK | `levelup-465304` | `STRAMARK_Dataset` | Đầy đủ lớp v6 + AI |
| AUUS1 | `levelup-465304` | `AUUS1_Dataset` | |
| HNLE | `levelup-465304` | `HNLE_Dataset` | |
| ZEN8 | `levelup-465304` | `ZEN8_Dataset` | |
| T1 | `levelup-465304` | `T1_Dataset` | |
| TRENDIFY | `levelup-465304` | `TRENDIFY_Dataset` | |

**Xem nhanh DB hiện có (cần khoá):**
```bash
# Liệt kê tất cả dataset trong 1 project
bq --project_id=talpha-faos-2026 ls
# Liệt kê bảng/view trong 1 dataset
bq ls talpha-faos-2026:TALPHA_Dataset
```

---

## 3. CÁC LOẠI TÀI KHOẢN / KHOÁ ĐĂNG NHẬP

> Giá trị thật KHÔNG ở đây — ở password manager. Đây là danh mục + cách lấy lại.

| Khoá (tên biến trong `.env`) | Dùng để | Lấy lại / tạo mới ở đâu |
|---|---|---|
| `bigquery_key.json` (file) + `GOOGLE_APPLICATION_CREDENTIALS` | Truy cập MỌI BigQuery | GCP Console → IAM & Admin → Service Accounts → chọn SA → Keys → **Add key** (tạo key mới, tải JSON) |
| `BQ_PROJECT_ID`, `BQ_DATASET`, `BQ_LOCATION` | Chọn DB đang dùng | Tự đặt (xem bảng mục 2) |
| `TALPHA_META_APP_ID`, `_APP_SECRET`, `_ACCESS_TOKEN` | Đọc Facebook Ads | developers.facebook.com → App → Settings; token: Graph API / Business Settings |
| `TALPHA_POSCAKE_SA_KEY` … `_BH_KEY` (6 shop) | Kéo đơn từ POS | pos.pages.fm → mỗi shop → Cấu hình → API key |
| `TALPHA_PANCAKE_API_TOKEN` | API Pancake | pancake.vn → Cấu hình → API |

**Tài khoản nền tảng cần nhớ riêng (lưu vào password manager):**
- Tài khoản **Google Cloud** (chủ sở hữu GCP project `talpha-faos-2026` & `levelup-465304`)
- Tài khoản **Meta Business** (quản lý ad accounts)
- Tài khoản **Poscake/Pancake** (chủ 6 shop)
- Tài khoản **Google** sở hữu Google Sheet tồn kho

---

## 4. CÁC FILE BÍ MẬT (chỉ có ở local — PHẢI backup)

| File | Nội dung | Trạng thái git |
|---|---|---|
| `bigquery_key.json` | Khoá private truy cập BigQuery | ✅ Đã ignore (KHÔNG commit) |
| `.env` | 18 biến: project, khoá Meta, khoá 6 shop POS… | ✅ Đã ignore |
| `.env.example` | Mẫu rỗng (không có giá trị) | Được commit (an toàn) |

> ✅ Đã kiểm tra 2026-06-17: `.gitignore` bảo vệ đúng, **không có secret nào lọt vào git**.
> ⚠️ NHƯNG 2 file trên **chỉ tồn tại trên máy này**. Mất máy = mất quyền truy cập → **bắt buộc backup** (mục 5).

---

## 5. CHỐNG MẤT DỮ LIỆU — 3 LỚP PHẢI LÀM

### Lớp 1 — Backup KHOÁ (quan trọng nhất, làm ngay)
- Copy `bigquery_key.json` + `.env` vào **password manager** (1Password/Bitwarden) dưới dạng *Secure Note / File attachment*.
- Lưu kèm: tài khoản Google Cloud, Meta, Poscake (mục 3).
- → Mất laptop vẫn khôi phục được trong 5 phút.

### Lớp 2 — Backup DỮ LIỆU BigQuery
- BigQuery có **time-travel 7 ngày** (lỡ xoá vẫn cứu được trong 7 ngày).
- Bật snapshot/định kỳ copy cho dataset quan trọng:
```bash
# Sao 1 dataset sang dataset backup (chạy định kỳ)
bq mk --dataset talpha-faos-2026:TALPHA_Dataset_backup
bq cp -f talpha-faos-2026:TALPHA_Dataset.sale_order \
        talpha-faos-2026:TALPHA_Dataset_backup.sale_order_$(date +%Y%m%d)
```
- Hoặc Scheduled Query export ra Google Cloud Storage.

### Lớp 3 — Backup NGUỒN GỐC (Google Sheets / POS)
- Google Sheet tồn kho TALPHA: ghi lại **ID sheet** ở đây để không mất dấu:
  - Báo cáo tồn kho hợp nhất: `1OHodSipWYrM9fHnsCHnKZOPsXuEAc3yWEIR-l9ZVERc`
  - (thêm các sheet khác khi có)
- Bật "Version history" của Google Sheets (mặc định có).

---

## 6. QUY TRÌNH KHÔI PHỤC TRÊN MÁY MỚI

```bash
git clone <repo>                        # 1. Lấy code
cd Agentic-AI-Levelup
# 2. Lấy bigquery_key.json + .env từ password manager, đặt vào thư mục gốc
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt          # 3. Cài thư viện
bq ls talpha-faos-2026:TALPHA_Dataset    # 4. Kiểm tra kết nối DB OK
```

---

## 7. CHECKLIST DUY TRÌ (làm khi có thay đổi)

- [ ] Thêm project/dataset mới → cập nhật bảng mục 2.
- [ ] Tạo/đổi khoá → cập nhật password manager + ghi nguồn lấy lại ở mục 3.
- [ ] Mỗi quý: thử "khôi phục trên máy mới" (mục 6) để chắc backup còn dùng được.
- [ ] Không bao giờ gửi `.env`/`bigquery_key.json` qua chat/email — chỉ qua password manager.

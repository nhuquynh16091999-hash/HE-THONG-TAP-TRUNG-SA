# 📋 Hướng dẫn fill thông tin Project

## Mỗi file YAML chứa gì?

| Section | Cần fill | Lấy ở đâu |
|:---|:---|:---|
| **1. Project Info** | Tên, currency, timezone | Tự điền |
| **2. Facebook Ads** | App ID, Secret, Token, Ad Account IDs | [developers.facebook.com](https://developers.facebook.com) → App Settings |
| **3. POS System** | Chọn 1 trong 6 hệ thống, điền API key | Từ dashboard POS đang dùng |
| **4. Fulfillment** | Tên 3PL, API key (nếu có) | Từ đối tác giao hàng |
| **5. Markets** | Mã quốc gia, tên, currency | Tự điền theo thị trường đang bán |
| **6. Discord** | Webhook URLs | [Discord Server Settings → Integrations → Webhooks](https://support.discord.com/hc/en-us/articles/228383668) |
| **7. Google Sheets** | Sheet IDs | Lấy từ URL Google Sheet (chuỗi dài giữa /d/ và /edit) |
| **8. Team** | Tên marketer | Tự điền |

## Cách lấy Facebook Ads credentials

1. Vào [Business Settings](https://business.facebook.com/settings)
2. **App ID & Secret**: System Users → Generate Token → chọn quyền `ads_management`, `ads_read`
3. **Ad Account IDs**: Tài khoản Quảng cáo → copy ID (format: `act_XXXXXXXXXX`)
4. **Business ID**: Cài đặt doanh nghiệp → Thông tin doanh nghiệp

## Cách lấy POS credentials

### Poscake
- Dashboard → Cài đặt → API → Copy Token & Shop ID

### Pancake  
- Dashboard → Settings → Developers → API Token
- Page IDs: mỗi Page Facebook kết nối

### Haravan
- Admin → Apps → Manage private apps → Create → Copy credentials

### Shopify
- Admin → Settings → Apps → Develop apps → Create → API credentials

## Sau khi fill xong

Báo lại cho AI agent, nó sẽ:
1. Đọc file YAML
2. Tạo n8n workflow sync data tự động cho project đó
3. Tạo BigQuery tables
4. Kích hoạt 3 agents cho project mới

## File mẫu

Xem `zen8.yaml` — đã fill sẵn data Zen8 làm reference.

# Đưa dashboard lên Vercel

> Chỉ nói về **nửa dashboard**. Nửa đường ống (sync POS + Meta, báo cáo Sheets,
> bot WhatsApp) **không chạy được trên Vercel** — xem phần cuối.

---

## Vì sao phải chuẩn bị, không đẩy thẳng được

Vercel có **ổ đĩa chỉ đọc**. Bản chạy ở máy ghi ra `data/*.json`, lên Vercel là
ném lỗi — mà người dùng bấm nút vẫn thấy im lìm, tưởng đã lưu.

Nên kho dữ liệu chuyển sang bảng BigQuery `talpha_store`. Đổi bằng đúng một biến
môi trường, code không phải sửa gì thêm:

| `STORE_BACKEND` | Ghi vào đâu | Dùng khi |
|---|---|---|
| `file` (mặc định ở máy) | `data/*.json` | chạy ở máy, chạy trên VPS |
| `bigquery` | bảng `talpha_store` | **Vercel** và mọi nền serverless |

Không khai biến này thì hệ thống tự chọn: thấy đang chạy trên Vercel là dùng
BigQuery. Khai tay chỉ để ép khác đi.

Ghi bằng **load job** chứ không phải `INSERT`, vì BigQuery ở chế độ hộp cát
(chưa gắn thanh toán) cấm DML. Kho này nhỏ — đo thật là 270KB — nên ghi đè cả
bảng mỗi lần lưu là chấp nhận được.

---

## Các bước

### 1. Tạo project trên Vercel

Vào https://vercel.com → `Add New` → `Project` → nối repo
`nhuquynh16091999-hash/HE-THONG-TAP-TRUNG-SA`.

**Root Directory** phải đặt là **`dashboard-ui`**, không phải gốc repo.

### 2. Khai biến môi trường

`Settings` → `Environment Variables`. Dán từng biến dưới đây:

| Biến | Giá trị |
|---|---|
| `STORE_BACKEND` | `bigquery` |
| `NEXT_PUBLIC_BQ_PROJECT` | `cty-507710` |
| `DATASET` | `TALPHA_Dataset` |
| `NEXT_PUBLIC_DATASET` | `TALPHA_Dataset` |
| `GCP_SA_KEY_JSON` | **toàn bộ nội dung** `bigquery_key.json`, dán trên một dòng |
| `NEXT_PUBLIC_DEPLOYMENT_MODE` | `talpha` |
| `NEXT_PUBLIC_APP_NAME` | `TALPHA` |
| `AUTH_SECRET` | chuỗi ngẫu nhiên, xem cách sinh bên dưới |
| `NEXTAUTH_URL` | địa chỉ Vercel cấp, ví dụ `https://ten-project.vercel.app` |
| `AUTH_URL` | y hệt `NEXTAUTH_URL` |
| `AUTH_TRUST_HOST` | `true` |
| `USERS_JSON` | **nội dung** `config/users.json` trên một dòng |
| `TALPHA_META_ACCESS_TOKEN` | token System User của Meta |
| `TALPHA_POSCAKE_TW_KEY` | key Poscake shop Đài |
| `TALPHA_PANCAKE_API_TOKEN` | token Pancake |
| `TRACK17_API_KEY` | *(tuỳ chọn)* khoá 17TRACK |
| `GEMINI_API_KEY` | *(tuỳ chọn)* cho tính năng “CEO hỏi” |

Sinh `AUTH_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Lấy `USERS_JSON` một dòng:

```bash
node -e "console.log(JSON.stringify(require('./config/users.json')))"
```

### 3. Deploy

Bấm `Deploy`. Xong thì quay lại sửa `NEXTAUTH_URL` và `AUTH_URL` cho khớp địa chỉ
thật Vercel vừa cấp, rồi deploy lại.

### 4. Kiểm tra

- Mở địa chỉ → phải bị đá về `/login` (chưa đăng nhập mà vào thẳng được là hỏng)
- Đăng nhập → vào tab **Đơn hàng → Theo dõi vận đơn** → bấm **Đọc bảng đối tác**
- Chạy được nghĩa là kho BigQuery hoạt động. Lỗi ghi file nghĩa là `STORE_BACKEND`
  chưa khai đúng.

---

## Việc `USERS_JSON` kéo theo

Khai `USERS_JSON` thì danh sách người dùng thành **chỉ đọc**: đăng nhập được, còn
màn `/admin` thêm/sửa người sẽ báo lỗi. Muốn thêm người thì sửa `config/users.json`
ở máy rồi cập nhật lại biến môi trường.

Đây là đánh đổi của ổ đĩa chỉ đọc, không phải lỗi.

---

## Giới hạn của Vercel cần biết

| Giới hạn | Con số | Ảnh hưởng gì |
|---|---|---|
| Thân request | **4,5MB** | file sao kê / bảng đối tác tải lên. Bảng hiện tại 142KB nên còn xa. Code tự hạ trần xuống 4MB khi chạy trên Vercel. |
| Thời gian mỗi lệnh | 5 phút | thừa cho mọi thao tác bấm nút |
| Chạy ngầm liên tục | **không có** | xem phần dưới |

---

## Nửa đường ống — Vercel KHÔNG chạy được

Ba việc này phải có chỗ khác:

| Việc | Vì sao |
|---|---|
| Sync POS + Meta → BigQuery | kéo cả tháng, vượt 5 phút |
| Sinh ~56 báo cáo Google Sheets | chạy dài, mã Python |
| Bot WhatsApp | phải giữ phiên chạy liên tục |

Không có nửa này thì BigQuery trống, và dashboard đẹp nhưng không có số.

**Chỗ chạy, xếp theo mức tau khuyên:**

1. **Google Cloud Run + Cloud Scheduler** — cùng project với BigQuery, chạy được
   Python không giới hạn thời gian, không phải quản trị máy chủ. Ở quy mô này gần
   như miễn phí.
2. **Máy Mac** — giống hệ thống cũ, dùng launchd. Miễn phí nhưng máy phải bật.
3. **VPS nhỏ** — chạy được cả hai nửa, khoảng 120k/tháng.

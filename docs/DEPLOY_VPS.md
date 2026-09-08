# Deploy lên máy chủ riêng (VPS)

> Khác cách chạy trên Macbook: máy chủ **không ngủ**, có **IP công khai sẵn** nên
> không cần Cloudflare Tunnel, và chạy được **cả nửa đường ống** bơm số vào
> BigQuery — thứ máy Mac chưa làm.

Máy chủ hiện tại: **`139.180.131.21`** (Vultr) — **CentOS Stream 9**, 1 CPU,
951MB RAM, 2,3GB swap, 17GB đĩa trống.

**Đang chạy: http://139.180.131.21:3000**

---

## Vì sao dùng khoá SSH chứ không dùng mật khẩu

Mật khẩu root từng đi qua khung chat nên **coi như đã lộ**. Ba việc phải làm,
theo đúng thứ tự:

1. Cài khoá SSH (bên dưới)
2. Kiểm tra vào được bằng khoá
3. **Đổi mật khẩu root**, và tốt hơn nữa là tắt hẳn đăng nhập bằng mật khẩu

Khoá còn tiện hơn: máy tự deploy được, không phải gõ mật khẩu mỗi lần.

### Cài khoá

Chạy ở **máy Mac**, nó sẽ hỏi mật khẩu root một lần cuối:

```bash
ssh-copy-id -i ~/.ssh/id_ed25519_talpha_vps.pub root@139.180.131.21
```

Kiểm tra vào được chưa — lệnh này **không** được hỏi mật khẩu:

```bash
ssh -i ~/.ssh/id_ed25519_talpha_vps root@139.180.131.21 'hostname; uptime -p'
```

### Tắt đăng nhập bằng mật khẩu

Chỉ làm **sau khi** lệnh trên chạy được, nếu không là tự khoá mình ra ngoài:

```bash
ssh -i ~/.ssh/id_ed25519_talpha_vps root@139.180.131.21 "sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config && systemctl reload ssh && echo 'da tat dang nhap bang mat khau'"
```

---

## Máy chủ này dùng dnf, không phải apt

CentOS Stream 9 nên khác Ubuntu ở ba chỗ, kịch bản đã tự nhận dạng và xử lý cả hai họ:

| | CentOS/RHEL | Ubuntu/Debian |
|---|---|---|
| Cài gói | `dnf` | `apt-get` |
| Tường lửa | `firewalld` | `ufw` |
| Kho Node | `rpm.nodesource.com` | `deb.nodesource.com` |

**RAM 951MB là sát nút.** `next build` ngốn quãng 1,5–2GB. Không có swap thì
build bị nhân hệ điều hành giết giữa chừng, mà thông báo lỗi chẳng nhắc gì tới
bộ nhớ — chỉ thấy chữ `Killed`, rất khó đoán. Máy này đã có sẵn 2,3GB swap;
kịch bản vẫn tự kiểm và tạo thêm nếu thiếu, đồng thời chặn trần bộ nhớ Node ở
1536MB khi build.

---

## Dựng lần đầu

### 1. Cho máy chủ đọc được repo

Máy chủ cần đọc repo riêng trên GitHub. Cách đang dùng là **mượn khoá của máy
Mac** (`ssh -A`, agent forwarding): trong lúc kết nối, máy chủ dùng nhờ khoá
GitHub của máy Mac; hết phiên là hết quyền, **khoá không bao giờ nằm lại trên
máy chủ**. Không phải cài gì lên GitHub.

Đánh đổi: máy chủ chỉ kéo code được **khi máy Mac đang kết nối vào**. Muốn máy
chủ tự cập nhật một mình (ví dụ đặt lịch cron), thì phải cài khoá deploy riêng:

```bash
ssh -i ~/.ssh/id_ed25519_talpha_vps root@139.180.131.21 \
  'ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519_github -C talpha-vps >/dev/null 2>&1; cat ~/.ssh/id_ed25519_github.pub'
```

Dán khoá in ra vào GitHub → repo → `Settings` → `Deploy keys` → `Add deploy key`.
Không cần tích "Allow write access".

### 2. Chép cấu hình bí mật lên

Những file này **không nằm trong git** nên phải chép tay:

```bash
ssh -i ~/.ssh/id_ed25519_talpha_vps root@139.180.131.21 'mkdir -p /opt/talpha/dashboard-ui'
scp -i ~/.ssh/id_ed25519_talpha_vps dashboard-ui/.env.local root@139.180.131.21:/opt/talpha/dashboard-ui/.env.local
scp -i ~/.ssh/id_ed25519_talpha_vps bigquery_key.json      root@139.180.131.21:/opt/talpha/bigquery_key.json
```

### 3. Chạy kịch bản dựng

```bash
scp -i ~/.ssh/id_ed25519_talpha_vps ops/deploy/vps-setup.sh root@139.180.131.21:/root/
ssh -i ~/.ssh/id_ed25519_talpha_vps root@139.180.131.21 'bash /root/vps-setup.sh'
```

Kịch bản làm 7 việc: gói hệ thống → Node 22 → pm2 → kéo code → dựng bản chạy →
pm2 khởi chạy + bật lại khi reboot → tường lửa.

**Về tường lửa:** mở SSH **trước** rồi mới bật `ufw`. Làm ngược thứ tự là tự
khoá mình ra ngoài, phải vào console của Vultr mới gỡ được.

---

## Cập nhật code

```bash
ssh -i ~/.ssh/id_ed25519_talpha_vps root@139.180.131.21 'bash /opt/talpha/ops/deploy/vps-deploy.sh'
```

Kịch bản: kéo code → cài gói → **chạy phép thử** → dựng → khởi động lại → kiểm tra HTTP 200.

Phép thử hỏng là **dừng ngay**, không đẩy bản lỗi ra cho cả đội.

**Đừng bao giờ `npm run build` rồi bỏ đó khi pm2 đang chạy.** Dựng lại là mọi
file chunk đổi tên, tiến trình cũ vẫn phục vụ trang HTML trỏ vào tên cũ, trình
duyệt ném `ChunkLoadError` và người dùng thấy **màn trắng** không thông báo gì.
Đã dính thật trên máy Mac. Kịch bản trên làm đúng thứ tự nên không vướng.

---

## Đưa dashboard ra tên miền

Đang chạy trần ở cổng 3000. Muốn có HTTPS và tên miền:

```bash
apt-get install -y nginx certbot python3-certbot-nginx
# trỏ tên miền về 139.180.131.21 trước, rồi:
certbot --nginx -d dashboard.tenmiencuaban.com
```

Có tên miền cố định rồi thì khai `NEXTAUTH_URL` và `AUTH_URL` trong `.env.local`
cho chắc, thay vì để trống như khi chạy qua đường hầm.

---

## Còn lại phải làm

- **Đổi mật khẩu root** — mật khẩu hiện tại đã đi qua khung chat
- **Đổi mật khẩu** tài khoản dashboard `talpha@levelup` — cũng đã lộ tương tự
- **Nửa đường ống** (sync POS + Meta → BigQuery) chưa dựng trên máy chủ này.
  Máy chủ chạy được nó — cần key Poscake trước.

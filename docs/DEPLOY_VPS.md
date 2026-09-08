# Deploy lên máy chủ riêng (VPS)

> Khác cách chạy trên Macbook: máy chủ **không ngủ**, có **IP công khai sẵn** nên
> không cần Cloudflare Tunnel, và chạy được **cả nửa đường ống** bơm số vào
> BigQuery — thứ máy Mac chưa làm.

Máy chủ hiện tại: `139.180.131.21` (Vultr).

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

## ⚠️ Khoá máy chủ đã đổi

Cả **ba** khoá của `139.180.131.21` khác với bản lưu trong `~/.ssh/known_hosts`:

| Loại | Đang lưu | Máy chủ trình ra bây giờ |
|---|---|---|
| ED25519 | `W4QcbkvC…NWlPtA` | `WhT6ATwg…CVajl8` |
| RSA | `k/GGvgCH…CsnFyc` | `VnJSL7FL…PX73uk` |
| ECDSA | `Z76aiWj3…ctyGNE` | `2ExNs0Zr…wsOvmc` |

Đổi **cả ba cùng lúc** gần như chắc chắn là máy đã được **cài lại hệ điều hành**
(dựng lại VPS là sinh khoá mới toàn bộ). Nhưng vẫn phải xác nhận trước khi tin,
vì trên lý thuyết đó cũng là dấu hiệu bị chen giữa đường truyền.

**Cách xác nhận chắc chắn:** vào console web của Vultr (không qua SSH), chạy
`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` rồi so với `WhT6ATwg…`.

Xác nhận xong thì xoá bản cũ đi:

```bash
ssh-keygen -R 139.180.131.21
```

---

## Dựng lần đầu

### 1. Khoá deploy cho GitHub

Máy chủ cần đọc được repo riêng:

```bash
ssh -i ~/.ssh/id_ed25519_talpha_vps root@139.180.131.21 \
  'ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519_github -C talpha-vps >/dev/null; cat ~/.ssh/id_ed25519_github.pub'
```

Dán khoá in ra vào GitHub → repo `HE-THONG-TAP-TRUNG-SA` → `Settings` →
`Deploy keys` → `Add deploy key` (chỉ cần quyền đọc).

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

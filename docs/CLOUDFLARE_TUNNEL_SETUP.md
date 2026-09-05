# Cloudflare Tunnel + Nginx Setup - FAOS Dashboards
## Architecture: Secure Public Access for 4 Dashboards

---

## 🏗️ Architecture Overview

```
[Team 10 ngườivietnam]
       ↓ HTTPS
[Cloudflare Edge] ← DDoS, WAF, Rate Limit
       ↓
[Cloudflare Access] ← Email xác thực (chỉ 10 email team)
       ↓
[Cloudflare Tunnel] ← Kết nối outbound an toàn
       ↓
[VPS: cloudflared daemon]
       ↓
[Nginx: localhost:8080]
       ↓
+--------+--------+--------+--------+
↓        ↓        ↓        ↓
:3000    :3001    :3002    :3004
Stramark  EUES     HNLE     Zen8
```

**Nguyên tắc:**
- VPS chỉ mở port 22 (SSH)
- 4 dashboard chỉ bind `127.0.0.1` (không public)
- Nginx reverse proxy + rate limit
- Cloudflare Tunnel tạo kết nối outbound → không cần mở port public
- Cloudflare Access xác thực email trước khi vào dashboard

---

## 📋 PHASE 1: Mua Domain (Khuyến khích - 50k-100k VND/năm)

> ⚠️ Nếu không mua domain, bạn chỉ có thể dùng **Cloudflare Quick Tunnel** (subdomain thay đổi mỗi lần restart, không ổn định cho team).

### Các nơi mua domain rẻ:
1. **Cloudflare Registrar** (giá gốc, không markup): https://dash.cloudflare.com/
2. **Namecheap**: Tìm domain `.store`, `.xyz`, `.online` (thường $1-5/năm)
3. **Porkbun**: Giá tốt

### Gợi ý tên domain:
- `faos-data.xyz`
- `stramark-dashboard.store`
- `faos-analytics.online`

Sau khi mua, bạn cần **chuyển nameserver về Cloudflare** (Cloudflare sẽ hướng dẫn khi add domain).

---

## 📋 PHASE 2: Tạo Cloudflare Account & Tunnel

### Bước 2.1: Đăng ký Cloudflare (miễn phí)
1. Vào https://dash.cloudflare.com/sign-up
2. Đăng ký bằng email của bạn
3. Xác nhận email

### Bước 2.2: Add Domain vào Cloudflare
1. Trong dashboard, click **Add a Site**
2. Nhập domain vừa mua (ví dụ: `faos-data.xyz`)
3. Chọn **Free Plan**
4. Cloudflare sẽ cho bạn 2 nameserver (ví dụ: `lara.ns.cloudflare.com`, `greg.ns.cloudflare.com`)
5. Vào trang quản lý domain (Namecheap/Porkbun) → đổi nameserver thành 2 cái Cloudflare cung cấp
6. Chờ 5-30 phút cho DNS cập nhật
7. Click **Done, check nameservers** trong Cloudflare

### Bước 2.3: Tạo Cloudflare Tunnel
1. Trong Cloudflare dashboard, click bên trái: **Zero Trust**
2. Lần đầu sẽ hỏi tên team, nhập: `faos-team`
3. Chọn **Free Plan** (0$/month)
4. Bên trái menu: **Networks** → **Tunnels**
5. Click **Create a tunnel**
6. Chọn **Cloudflared** → Click **Next**
7. Đặt tên tunnel: `faos-dashboards`
8. Click **Save tunnel**
9. Ở bước **Choose your environment**, chọn **Debian**
10. Bạn sẽ thấy lệnh:
    ```bash
    cloudflared service install <TOKEN_DAI>
    ```
    **Copy token này, lưu vào file text trên máy tính**
11. **ĐỪNG click Finish yet**

### Bước 2.4: Cấu hình Public Hostnames
Trong màn hình **Public Hostname** (bạn đang ở bước này):

Thêm 4 hostnames:

| Subdomain | Service (Type) | URL |
|-----------|----------------|-----|
| `stramark.yourdomain.com` | HTTP | `http://localhost:3000` |
| `eues.yourdomain.com` | HTTP | `http://localhost:3001` |
| `hnle.yourdomain.com` | HTTP | `http://localhost:3002` |
| `zen8.yourdomain.com` | HTTP | `http://localhost:3004` |

Ví dụ:
1. Click **Add a public hostname**
2. Subdomain: `stramark`, Domain: chọn domain của bạn
3. Service Type: `HTTP`
4. URL: `localhost:3000`
5. Click **Save hostname**
6. Lặp lại cho 3 cái còn lại

Sau đó click **Save tunnel**

---

## 📋 PHASE 3: Cài đặt trên VPS (Sau khi Reinstall)

### Bước 3.1: Chạy script cài đặt
Sau khi reinstall Ubuntu 24.04 và hardening, SSH vào VPS:

```bash
# Tải script setup
curl -o setup_tunnel.sh https://raw.githubusercontent.com/your-repo/scripts/setup_cloudflare_tunnel.sh
# Hoặc copy từ file tôi đã chuẩn bị
```

Hoặc tạo file thủ công:
```bash
nano setup_tunnel.sh
# (paste nội dung script bên dưới)
chmod +x setup_tunnel.sh
bash setup_tunnel.sh
```

**Script setup_tunnel.sh:**
```bash
#!/bin/bash
set -euo pipefail

if [ "$EUID" -ne 0 ]; then
    echo "Run as root"
    exit 1
fi

echo "=== Installing Cloudflare Tunnel + Nginx ==="

# Update
apt-get update

# Install Nginx
apt-get install -y nginx

# Install cloudflared (official repo)
mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" | tee /etc/apt/sources.list.d/cloudflared.list
apt-get update
apt-get install -y cloudflared

# Configure Nginx
mv /etc/nginx/sites-enabled/default /etc/nginx/sites-enabled/default.bak 2>/dev/null || true

cat > /etc/nginx/sites-available/dashboards << 'EOF'
limit_req_zone $binary_remote_addr zone=dash:10m rate=10r/s;

server {
    listen 127.0.0.1:8080;
    server_name localhost;
    
    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    
    location / {
        # If accessed directly without subpath
        return 404;
    }
}
EOF

ln -sf /etc/nginx/sites-available/dashboards /etc/nginx/sites-enabled/

# Test and restart nginx
nginx -t
systemctl restart nginx
systemctl enable nginx

echo ""
echo "========================================"
echo "INSTALLATION COMPLETE"
echo "========================================"
echo "Next steps:"
echo "1. Run: cloudflared service install <YOUR_TOKEN>"
echo "2. Your 4 dashboards should bind to:"
echo "   - localhost:3000 (Stramark)"
echo "   - localhost:3001 (EUES)"
echo "   - localhost:3002 (HNLE)"
echo "   - localhost:3004 (Zen8)"
echo "========================================"
```

### Bước 3.2: Kết nối Tunnel
```bash
# Thay <TOKEN> bằng token bạn copy ở Bước 2.3
cloudflared service install <TOKEN>

# Khởi động service
systemctl enable cloudflared
systemctl start cloudflared

# Kiểm tra trạng thái
systemctl status cloudflared
cloudflared tunnel list
```

### Bước 3.3: Kiểm tra
Trong Cloudflare dashboard → Networks → Tunnels, bạn sẽ thấy tunnel `faos-dashboards` hiển thị **Healthy** (màu xanh).

Truy cập thử:
```
https://stramark.yourdomain.com
```

---

## 📋 PHASE 4: Cloudflare Access (Xác thực 10 ngườivietnam)

### Bước 4.1: Tạo Access Application
1. Trong Cloudflare dashboard, click bên trái: **Zero Trust** → **Access** → **Applications**
2. Click **Add an application**
3. Chọn **Self-hosted**
4. Application name: `FAOS Dashboards`
5. Session duration: `24 hours`
6. **Application domain**: Chọn domain của bạn, subdomain để trống (Áp dụng cho tất cả subdomain)
7. Click **Next**

### Bước 4.2: Thêm chính sách xác thực
1. Policy name: `FAOS Team Only`
2. Action: **Allow**
3. Configure rules:
   - Selector: **Emails**
   - Value: Nhập từng email của 10 thành viên team
   - Ví dụ:
     - `user1@gmail.com`
     - `user2@gmail.com`
     - ... (đến 10 email)
4. Click **Next** → **Next** → **Add application**

### Bước 4.3: Test
Mở trình duyệt ẩn danh:
```
https://stramark.yourdomain.com
```

Bạn sẽ thấy màn hình **Cloudflare Access** yêu cầu nhập email → nhập email trong danh sách → check email để xác nhận → vào được dashboard.

---

## 📋 PHASE 5: Kiểm tra & Monitor

### Kiểm tra VPS
```bash
# Chỉ port 22 được mở
ss -tulnp | grep LISTEN
# Kết quả: chỉ thấy 127.0.0.1:8080 và 127.0.0.1:3000-3004
# KHÔNG được thấy 0.0.0.0 ngoài port 22

# Kiểm tra cloudflared
systemctl status cloudflared
journalctl -u cloudflared -f
```

### Kiểm tra Cloudflare
- Dashboard → Analytics → xem request count
- Access → Logs → xem ai đã đăng nhập

---

## 🎯 Tóm tắt

| Bước | Thờigian | Hành động |
|------|----------|-----------|
| 1 | 10 phút | Mua domain + Add vào Cloudflare |
| 2 | 10 phút | Tạo Tunnel + lấy Token |
| 3 | 5 phút | Reinstall VPS + Hardening |
| 4 | 5 phút | Chạy `setup_tunnel.sh` + `cloudflared service install` |
| 5 | 5 phút | Tạo Access Application + nhập 10 email |
| 6 | 5 phút | Deploy 4 dashboard bind localhost |
| 7 | Ongoing | Monitor Cloudflare Analytics + Access Logs |

---

## ❓ Không muốn mua domain?

Nếu không mua domain, bạn có thể dùng **Quick Tunnel** (tạm thờivietnam):

```bash
cloudflared tunnel --url http://localhost:3000
```

Nó sẽ tạo URL dạng `https://abc123.trycloudflare.com`. Nhưng:
- URL thay đổi mỗi lần restart
- Không thể dùng Cloudflare Access (xác thực email)
- Không có nhiều subdomain

**→ Khuyến nghị: Mua domain để dùng lâu dài.**

---

## 🔒 Bảo mật bổ sung

### Rate Limiting trong Cloudflare
1. Dashboard → domain của bạn → **Security** → **WAF** → **Rate limiting rules**
2. Tạo rule:
   - Request threshold: 100 requests per 10 seconds
   - Action: Block

### Geo-blocking (nếu team chỉ ở VN)
1. Dashboard → domain → **Security** → **WAF** → **Custom rules**
2. Tạo rule:
   - `(ip.geoip.country ne "VN")` → Block

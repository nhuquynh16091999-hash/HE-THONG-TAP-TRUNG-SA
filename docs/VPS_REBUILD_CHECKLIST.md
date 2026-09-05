# VPS Rebuild Checklist - FAOS Brain API Server
## Server: 164.68.101.179 (Contabo) - Ubuntu 24.04

---

## ⚠️ BEFORE YOU START - CRITICAL WARNINGS

1. **Backup trước khi reinstall** - Reinstall sẽ XÓA SẠCH toàn bộ dữ liệu trên VPS
2. **Đổi TẤT CẢ API keys** sau khi rebuild (Meta Ads, Pancake POS, GA4, BigQuery)
3. **KHÔNG restore file bị nghi ngờ** - Chỉ restore code, không restore system files

---

## PHASE 1: BACKUP (15 phút)

### 1.1 Backup code & config
```bash
# SSH vào VPS hiện tại (nếu còn được)
# Hoặc dùng VNC console

# Tạo thư mục backup
mkdir -p /root/backup_$(date +%Y%m%d)
cd /root/backup_$(date +%Y%m%d)

# Backup .env files (quan trọng nhất - chứa API keys)
find / -name ".env" -o -name ".env.local" -o -name "*.env" 2>/dev/null | head -20
# Copy từng file .env bạn tìm thấy

# Backup thư mục project
# (Thay đổi đường dẫn theo project thực tế của bạn)
tar -czvf code_backup.tar.gz /path/to/your/project 2>/dev/null || echo "Tự backup thủ công"

# Backup database (nếu có local DB)
# PostgreSQL: pg_dump ... > db_backup.sql
# MySQL: mysqldump ... > db_backup.sql
# SQLite: cp database.db ./

# Backup SSH key nếu cần (nhưng sẽ tạo key mới sau)
cp ~/.ssh/authorized_keys ./authorized_keys.backup 2>/dev/null || true
```

### 1.2 Download backup về máy local
Dùng Contabo panel hoặc SFTP để tải file backup về máy.

### 1.3 Tạo Snapshot (Contabo)
- Vào Contabo panel → VPS control → Manage → **Snapshots**
- Click **Create Snapshot** (phòng trường hợp cần rollback)

---

## PHASE 2: REINSTALL OS (10 phút)

### 2.1 Trên Contabo Panel
1. Vào **VPS control** → Tìm server **164.68.101.179**
2. Click **Manage** → Chọn **Reinstall**
3. Chọn **Ubuntu 24.04 LTS**
4. Check ô xác nhận xóa dữ liệu
5. Click **Confirm**
6. Chờ 5-10 phút (status sẽ hiển thị tiến trình)

### 2.2 Lấy password mới
Sau khi reinstall xong:
- Contabo sẽ gửi email chứa **root password mới**
- HOẶC trong panel hiển thị password tạm thờiv

---

## PHASE 3: INITIAL ACCESS & HARDENING (20 phút)

### 3.1 SSH vào VPS mới
```bash
# Trên máy Windows (PowerShell hoặc PuTTY)
ssh root@164.68.101.179
# Nhập password tạm thờivừa nhận được
```

### 3.2 Chạy script hardening
```bash
# Tạo file hardening script
cd ~
nano harden.sh
# (Copy toàn bộ nội dung script phía dưới)

chmod +x harden.sh
bash harden.sh
```

### 3.3 Tạo SSH key mới (KHÔNG dùng key cũ)
```bash
# TRÊN MÁY LOCAL WINDOWS
# Mở PowerShell hoặc Git Bash

ssh-keygen -t ed25519 -C "faos-deploy-$(date +%Y%m%d)"
# Enter file: nhấn Enter (mặc định)
# Enter passphrase: đặt password bảo vệ key (khuyến khích)

# Copy public key lên VPS
ssh-copy-id -i ~/.ssh/id_ed25519.pub root@164.68.101.179

# Test: SSH vào không cần password VPS nữa
ssh root@164.68.101.179
```

---

## PHASE 4: RESTORE & REINSTALL APP (30 phút)

### 4.1 Cài đặt môi trường
```bash
# Update system
apt update && apt upgrade -y

# Cài đặt cơ bản
apt install -y python3 python3-pip python3-venv git curl wget unzip nano

# Cài NodeJS (nếu app cần)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Cài Docker (nếu cần)
# apt install -y docker.io docker-compose
# systemctl enable docker

# Cài Nginx (nếu cần reverse proxy)
# apt install -y nginx
```

### 4.2 Upload code lên VPS
```bash
# Từ máy Windows, dùng scp hoặc git clone
# Cách 1: Git clone
git clone https://github.com/your-repo/faos-brain.git /opt/faos

# Cách 2: Upload file backup
scp code_backup.tar.gz root@164.68.101.179:/opt/
ssh root@164.68.101.179 "cd /opt && tar -xzvf code_backup.tar.gz"
```

### 4.3 Cấu hình ứng dụng
```bash
cd /opt/faos

# Tạo virtual environment
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Tạo .env MỚI (không dùng .env cũ vì có thể bị lộ)
nano .env
# Nhập lại tất cả API keys MỚI (xem PHASE 5)
```

### 4.4 Chạy app AN TOÀN (CHỈ bind localhost)
```bash
# ⚠️ QUAN TRỌNG: App PHẢI chỉ lắng nghe 127.0.0.1
# Không được để 0.0.0.0 (public)

# Ví dụ FastAPI:
uvicorn main:app --host 127.0.0.1 --port 8000

# Ví dụ Streamlit:
streamlit run app.py --server.address 127.0.0.1 --server.port 8501

# Ví dụ Flask:
flask run --host=127.0.0.1 --port=5000

# Ví dụ NodeJS:
# Trong code: app.listen(3000, '127.0.0.1')
```

### 4.5 Dùng SSH Tunnel để truy cập Dashboard (KHÔNG mở port)
```bash
# Trên máy Windows, mở PowerShell:
# Nếu app chạy port 8000 trên VPS
ssh -L 8080:127.0.0.1:8000 root@164.68.101.179 -N

# Sau đó mở browser trên máy local:
# http://localhost:8080
# (Không ai từ ngoài internet truy cập được)
```

---

## PHASE 5: ROTATE (ĐỔI) TẤT CẢ CREDENTIALS (20 phút)

### 5.1 API Keys cần đổi
| Platform | Hành động |
|----------|-----------|
| **Meta Ads** | Vào Meta Business → Settings → System Users → Rotate Token |
| **Pancake POS** | Vào Pancake Dashboard → API Keys → Tạo key mới, xóa key cũ |
| **Google Analytics 4** | Google Cloud Console → Credentials → Tạo service account mới |
| **BigQuery** | Google Cloud Console → IAM → Xóa key cũ, tạo key mới |
| **GitHub/GitLab** (nếu có) | Settings → Developer Settings → Personal Access Tokens → Revoke & tạo mới |
| **SSH Key** | Đã tạo key mới ở PHASE 3 |

### 5.2 Kiểm tra code không hardcode secrets
```bash
# Quét file trong project
grep -r "sk-" /opt/faos/ 2>/dev/null | grep -v ".pyc" | head -20
grep -r "AKIA" /opt/faos/ 2>/dev/null | head -20  # AWS key pattern
grep -r "eyJ" /opt/faos/ 2>/dev/null | head -20   # JWT token pattern
```

---

## PHASE 6: VERIFY & MONITOR

### 6.1 Kiểm tra port đang mở
```bash
ss -tulnp
# CHỈ được thấy port 22 (SSH). KHÔNG được thấy port API.
```

### 6.2 Kiểm tra firewall
```bash
ufw status verbose
```

### 6.3 Kiểm tra cronjob sạch
```bash
crontab -l
cat /etc/crontab
ls -la /etc/cron.d/
```

### 6.4 Kiểm tra process
```bash
ps aux | head -20
# Chỉ thấy process hệ thống + app của bạn
```

### 6.5 Setup monitoring đơn giản
```bash
# Cài Netdata hoặc đơn giản là script kiểm tra định kỳ
cat > /root/health_check.sh << 'EOF'
#!/bin/bash
echo "=== $(date) ==="
echo "CPU:"
top -bn1 | grep "Cpu(s)"
echo "Connections:"
ss -tulnp | grep -v "127.0.0.1"
echo "Top processes:"
ps aux --sort=-%cpu | head -5
EOF
chmod +x /root/health_check.sh

# Chạy mỗi 5 phút
echo "*/5 * * * * /root/health_check.sh >> /var/log/health.log 2>&1" | crontab -
```

---

## PHASE 7: NÂNG CAO (Tùy chọn)

### 7.1 Không dùng root cho app
```bash
useradd -m -s /bin/bash faos
usermod -aG sudo faos
# Chạy app dưới user faos, không phải root
```

### 7.2 Cài Fail2ban (đã có trong hardening script)
```bash
fail2ban-client status sshd
```

### 7.3 Cài AIDE (file integrity)
```bash
aideinit
mv /var/lib/aide/aide.db.new /var/lib/aide/aide.db
```

---

## 🎯 TÓM TẮT NGUYÊN TẮC AN TOÀN

| Nguyên tắc | Lý do |
|------------|-------|
| **Chỉ mở port 22** | Attacker không scan thấy API để exploit |
| **App bind 127.0.0.1** | App không lắng nghe public IP |
| **SSH Tunnel** | Truy cập dashboard an toàn qua SSH |
| **VPN/WireGuard** | Nếu nhiều ngườiv dùng, dùng VPN thay vì mở port |
| **Đổi credentials** | Credentials cũ có thể đã bị lộ |
| **Không restore system file** | Tránh restore backdoor theo |

---

## ❓ NẾU API CẦN WEBHOOK TỪ BÊN NGOÀI

Nếu Meta/Pancake cần gửi webhook về server:
1. Dùng **ngrok** hoặc **Cloudflare Tunnel** (không mở port VPS)
2. HOẶC mở 1 port duy nhất, đặt **API key mạnh** trong webhook
3. HOẶC dùng **Cloudflare Tunnel** (free, bảo mật nhất)

```bash
# Cloudflare Tunnel (khuyến nghị)
# Không cần mở port, traffic đi qua Cloudflare
```

---

## 📞 KHẨN CẤP

Nếu bị hack lần 3 sau khi làm theo checklist này:
- Entry point là **supply chain attack** (dependencies bị inject malware)
- HOẶC **credentials chưa đổi hết**
- HOẶC **máy local của ngườiv deploy bị nhiễm** (keylogger đánh cắp SSH key)

**Liên hệ tôi ngay lập tức.**

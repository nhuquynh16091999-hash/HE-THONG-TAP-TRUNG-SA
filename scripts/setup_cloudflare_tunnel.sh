#!/bin/bash
# Cloudflare Tunnel + Nginx Setup for FAOS Dashboards
# Run on fresh Ubuntu 24.04 after hardening
# Dashboards: Stramark:3000, EUES:3001, HNLE:3002, Zen8:3004

set -euo pipefail

if [ "$EUID" -ne 0 ]; then
    echo "[-] Run as root: sudo bash setup_cloudflare_tunnel.sh"
    exit 1
fi

echo "========================================"
echo "Cloudflare Tunnel + Nginx Setup"
echo "========================================"

# 1. Install dependencies
apt-get update
apt-get install -y nginx curl lsb-release gnupg2

# 2. Install cloudflared (official Cloudflare repo)
echo "[+] Installing cloudflared..."
mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" | tee /etc/apt/sources.list.d/cloudflared.list
apt-get update
apt-get install -y cloudflared

# 3. Configure Nginx as reverse proxy
mv /etc/nginx/sites-enabled/default /etc/nginx/sites-enabled/default.bak 2>/dev/null || true

cat > /etc/nginx/sites-available/dashboards << 'EOF'
# Rate limit zone: 10 requests per second per IP
limit_req_zone $binary_remote_addr zone=dash:10m rate=10r/s;

server {
    listen 127.0.0.1:8080;
    server_name localhost;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Default: deny direct access without subpath
    location / {
        return 404;
    }
}
EOF

ln -sf /etc/nginx/sites-available/dashboards /etc/nginx/sites-enabled/dashboards

# Test Nginx config
nginx -t
systemctl restart nginx
systemctl enable nginx

# 4. Create cloudflared config directory
mkdir -p /etc/cloudflared

# 5. Create systemd service override (if needed)
true

echo ""
echo "========================================"
echo "INSTALLATION COMPLETE"
echo "========================================"
echo ""
echo "Next steps:"
echo "1. Get your tunnel token from Cloudflare dashboard:"
echo "   Zero Trust → Networks → Tunnels → faos-dashboards"
echo ""
echo "2. Run: cloudflared service install <YOUR_TOKEN>"
echo ""
echo "3. Verify: systemctl status cloudflared"
echo ""
echo "4. Your dashboards must bind to:"
echo "   127.0.0.1:3000  (Stramark)"
echo "   127.0.0.1:3001  (EUES)"
echo "   127.0.0.1:3002  (HNLE)"
echo "   127.0.0.1:3004  (Zen8)"
echo ""
echo "5. In Cloudflare dashboard, add 4 Public Hostnames:"
echo "   stramark.yourdomain.com  → http://localhost:3000"
echo "   eues.yourdomain.com      → http://localhost:3001"
echo "   hnle.yourdomain.com      → http://localhost:3002"
echo "   zen8.yourdomain.com      → http://localhost:3004"
echo ""
echo "6. Enable Cloudflare Access for authentication"
echo "========================================"

#!/bin/bash
# ═══════════════════════════════════════════════════════
# FAOS v5 — VPS Setup Script
# ═══════════════════════════════════════════════════════
# Run this on a FRESH Ubuntu 22.04/24.04 VPS:
#   curl -sSL https://raw.githubusercontent.com/your-repo/faos/main/scripts/vps-setup.sh | bash
#
# Or manually:
#   scp scripts/vps-setup.sh root@your-vps-ip:/root/
#   ssh root@your-vps-ip 'bash /root/vps-setup.sh'
# ═══════════════════════════════════════════════════════

set -e
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}       🌳 FAOS v5 — VPS Setup${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo ""

# ─── 1. System Update ───
echo -e "${YELLOW}[1/6] Updating system...${NC}"
apt-get update -qq && apt-get upgrade -y -qq
apt-get install -y -qq curl git htop unzip ufw fail2ban
echo -e "${GREEN}  ✅ System updated${NC}"

# ─── 2. Install Docker ───
echo -e "${YELLOW}[2/6] Installing Docker...${NC}"
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
fi
echo -e "${GREEN}  ✅ Docker $(docker --version | cut -d' ' -f3)${NC}"

# ─── 3. Install Docker Compose ───
echo -e "${YELLOW}[3/6] Installing Docker Compose...${NC}"
if ! docker compose version &> /dev/null; then
    apt-get install -y -qq docker-compose-plugin
fi
echo -e "${GREEN}  ✅ Docker Compose $(docker compose version --short)${NC}"

# ─── 4. Firewall ───
echo -e "${YELLOW}[4/6] Configuring firewall...${NC}"
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp     # SSH
ufw allow 80/tcp     # HTTP
ufw allow 443/tcp    # HTTPS
ufw --force enable
echo -e "${GREEN}  ✅ Firewall configured (SSH + HTTP + HTTPS only)${NC}"

# ─── 5. Create FAOS directory ───
echo -e "${YELLOW}[5/6] Creating FAOS directory...${NC}"
mkdir -p /opt/faos/data/{inbox,processed}
echo -e "${GREEN}  ✅ /opt/faos created${NC}"

# ─── 6. Create swap (for 8GB+ RAM VPS) ───
echo -e "${YELLOW}[6/6] Creating swap...${NC}"
if [ ! -f /swapfile ]; then
    fallocate -l 4G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    echo -e "${GREEN}  ✅ 4GB swap created${NC}"
else
    echo -e "${GREEN}  ✅ Swap already exists${NC}"
fi

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  🌳 VPS setup complete!${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  Next steps:"
echo -e "  1. Clone FAOS:  ${YELLOW}git clone <repo> /opt/faos${NC}"
echo -e "  2. Config:      ${YELLOW}cp .env.template .env && nano .env${NC}"
echo -e "  3. Start:       ${YELLOW}cd /opt/faos && docker compose -f docker-compose.prod.yml up -d${NC}"
echo -e "  4. HTTPS:       ${YELLOW}docker exec faos-certbot certbot --nginx -d your-domain.com${NC}"
echo ""
echo -e "  Monitor:"
echo -e "  • ${YELLOW}htop${NC}                    — CPU/RAM usage"
echo -e "  • ${YELLOW}docker ps${NC}               — Running containers"
echo -e "  • ${YELLOW}docker logs faos-graphiti-mcp${NC}  — service logs"
echo ""

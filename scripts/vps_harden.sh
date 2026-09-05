#!/bin/bash
# VPS Hardening Script - Ubuntu 24.04
# Run AFTER you have cleaned malware and verified no persistence remains
# Run as: sudo bash vps_harden.sh

set -euo pipefail
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() {
    echo -e "${GREEN}[+] $1${NC}"
}

warn() {
    echo -e "${YELLOW}[!] $1${NC}"
}

error() {
    echo -e "${RED}[-] $1${NC}"
}

if [ "$EUID" -ne 0 ]; then
    error "Please run as root or with sudo"
    exit 1
fi

log "Starting VPS hardening on Ubuntu 24.04"

# ==========================================
# 1. SYSTEM UPDATE
# ==========================================
log "1. Updating system packages..."
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get -y upgrade
apt-get -y autoremove
apt-get -y autoclean

# ==========================================
# 2. SSH HARDENING
# ==========================================
log "2. Hardening SSH..."
SSHD_CONFIG="/etc/ssh/sshd_config"

# Backup
cp "$SSHD_CONFIG" "${SSHD_CONFIG}.bak.$(date +%s)"

# Apply hardening
sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/' "$SSHD_CONFIG"
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' "$SSHD_CONFIG"
sed -i 's/^#*PubkeyAuthentication.*/PubkeyAuthentication yes/' "$SSHD_CONFIG"
sed -i 's/^#*MaxAuthTries.*/MaxAuthTries 3/' "$SSHD_CONFIG"
sed -i 's/^#*ClientAliveInterval.*/ClientAliveInterval 300/' "$SSHD_CONFIG"
sed -i 's/^#*ClientAliveCountMax.*/ClientAliveCountMax 2/' "$SSHD_CONFIG"
sed -i 's/^#*LoginGraceTime.*/LoginGraceTime 60/' "$SSHD_CONFIG"
sed -i 's/^#*X11Forwarding.*/X11Forwarding no/' "$SSHD_CONFIG"
sed -i 's/^#*AllowTcpForwarding.*/AllowTcpForwarding no/' "$SSHD_CONFIG"

# Ensure settings exist if not present
for setting in "PermitRootLogin no" "PasswordAuthentication no" "PubkeyAuthentication yes" \
               "MaxAuthTries 3" "ClientAliveInterval 300" "ClientAliveCountMax 2" \
               "LoginGraceTime 60" "X11Forwarding no" "AllowTcpForwarding no"; do
    key=$(echo "$setting" | cut -d' ' -f1)
    if ! grep -qE "^${key}" "$SSHD_CONFIG"; then
        echo "$setting" >> "$SSHD_CONFIG"
    fi
done

# Change SSH port (optional - uncomment if you want non-standard port)
# sed -i 's/^#*Port 22/Port 2222/' "$SSHD_CONFIG"

systemctl restart sshd
log "SSH hardened. Make sure you have your key before disconnecting!"

# ==========================================
# 3. FIREWALL (UFW)
# ==========================================
log "3. Configuring UFW firewall..."
apt-get install -y ufw

# Reset and default deny
ufw --force reset
ufw default deny incoming
ufw default allow outgoing

# Allow SSH (change if you modified port)
ufw allow 22/tcp comment 'SSH'

# Allow common web ports only if needed (uncomment as needed)
# ufw allow 80/tcp comment 'HTTP'
# ufw allow 443/tcp comment 'HTTPS'

ufw --force enable
ufw status verbose

# ==========================================
# 4. FAIL2BAN
# ==========================================
log "4. Installing and configuring fail2ban..."
apt-get install -y fail2ban

cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 3
backend = systemd

[sshd]
enabled = true
port = ssh
filter = sshd
logpath = %(sshd_log)s
maxretry = 3
bantime = 3600
EOF

systemctl enable fail2ban
systemctl restart fail2ban
fail2ban-client status

# ==========================================
# 5. KERNEL HARDENING (SYSCTL)
# ==========================================
log "5. Applying kernel hardening..."
cat > /etc/sysctl.d/99-security.conf << 'EOF'
# IP Spoofing protection
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1

# Ignore ICMP broadcast requests
net.ipv4.icmp_echo_ignore_broadcasts = 1

# Ignore bogus ICMP errors
net.ipv4.icmp_ignore_bogus_error_responses = 1

# Do not accept IP source route packets
net.ipv4.conf.all.accept_source_route = 0
net.ipv6.conf.all.accept_source_route = 0

# Do not accept ICMP redirects
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv6.conf.all.accept_redirects = 0

# Do not send ICMP redirects
net.ipv4.conf.all.send_redirects = 0

# Disable IPv6 if not needed (comment out if you need IPv6)
# net.ipv6.conf.all.disable_ipv6 = 1

# Enable TCP SYN cookies
net.ipv4.tcp_syncookies = 1

# Disable IPv6 router advertisements
net.ipv6.conf.all.accept_ra = 0
net.ipv6.conf.default.accept_ra = 0

# Increase system file descriptor limit
fs.file-max = 65535

# Protect against kernel pointer leaks
kernel.kptr_restrict = 2
kernel.dmesg_restrict = 1

# Enable ASLR
kernel.randomize_va_space = 2

# Restrict core dumps
fs.suid_dumpable = 0

# Hard link / symlink protection
fs.protected_hardlinks = 1
fs.protected_symlinks = 1
EOF

sysctl --system

# ==========================================
# 6. AUDITD (SYSTEM AUDIT)
# ==========================================
log "6. Installing auditd for monitoring..."
apt-get install -y auditd audispd-plugins

# Audit rules
cat > /etc/audit/rules.d/99-security.rules << 'EOF'
# Monitor sudoers
-w /etc/sudoers -p wa -k sudoers_changes
-w /etc/sudoers.d/ -p wa -k sudoers_changes

# Monitor passwd/shadow
-w /etc/passwd -p wa -k identity_changes
-w /etc/group -p wa -k identity_changes
-w /etc/shadow -p wa -k identity_changes

# Monitor SSH config
-w /etc/ssh/sshd_config -p wa -k ssh_config_changes

# Monitor cron
-w /etc/crontab -p wa -k cron_changes
-w /etc/cron.d/ -p wa -k cron_changes
-w /etc/cron.hourly/ -p wa -k cron_changes
-w /etc/cron.daily/ -p wa -k cron_changes
-w /etc/cron.weekly/ -p wa -k cron_changes
-w /etc/cron.monthly/ -p wa -k cron_changes

# Monitor systemd
-w /etc/systemd/system/ -p wa -k systemd_changes

# Monitor user/group commands
-a always,exit -F arch=b64 -S setuid -S setgid -S setreuid -S setregid -k privilege_escalation
EOF

augenrules --load
systemctl enable auditd
systemctl restart auditd

# ==========================================
# 7. REMOVE UNNECESSARY SERVICES
# ==========================================
log "7. Removing unnecessary packages/services..."
apt-get purge -y telnet rsh-client rsh-redone-client nis 2>/dev/null || true
systemctl disable --now cups 2>/dev/null || true

# ==========================================
# 8. DOCKER HARDENING (if installed)
# ==========================================
if command -v docker &> /dev/null; then
    log "8. Docker detected - applying hardening..."
    
    # Create daemon.json with security options
    mkdir -p /etc/docker
    cat > /etc/docker/daemon.json << 'EOF'
{
  "live-restore": true,
  "userland-proxy": false,
  "no-new-privileges": true,
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
EOF
    
    # Remove all unused images/containers/networks
    docker system prune -af --volumes 2>/dev/null || true
    
    systemctl restart docker || true
else
    warn "Docker not found. Skipping Docker hardening."
fi

# ==========================================
# 9. AIDE (FILE INTEGRITY MONITORING)
# ==========================================
log "9. Installing AIDE (file integrity monitoring)..."
apt-get install -y aide
aideinit || true
mv /var/lib/aide/aide.db.new /var/lib/aide/aide.db 2>/dev/null || true

# Create daily check cron
cat > /etc/cron.daily/aide-check << 'EOF'
#!/bin/bash
/usr/bin/aide --check | mail -s "AIDE Check $(hostname)" root
EOF
chmod +x /etc/cron.daily/aide-check

# ==========================================
# 10. SECURE SHARED MEMORY
# ==========================================
log "10. Securing /dev/shm..."
echo "tmpfs /run/shm tmpfs defaults,noexec,nosuid,nodev 0 0" >> /etc/fstab

# ==========================================
# 11. APPARMOR
# ==========================================
log "11. Enforcing AppArmor..."
apt-get install -y apparmor apparmor-utils
systemctl enable apparmor
systemctl start apparmor
aa-enforce /etc/apparmor.d/* 2>/dev/null || true

# ==========================================
# 12. REMOVE UNUSED USERS
# ==========================================
log "12. Checking for unused system accounts..."
# List locked accounts
awk -F: '$2 ~ /^!/ || $2 ~ /^\*/ {print $1}' /etc/shadow | while read user; do
    case "$user" in
        root|sync|shutdown|halt|daemon|bin|sys|games|man|lp|mail|news|uucp|proxy|www-data|backup|list|irc|gnats|nobody|systemd-*)
            ;;
        *)
            warn "Account $user has locked/invalid password - review manually"
            ;;
    esac
done

# ==========================================
# 13. CHECK FOR SUSPICIOUS CRON AGAIN
# ==========================================
log "13. Final cron audit..."
find /etc/cron* -type f -executable -exec ls -la {} \; 2>/dev/null || true

# ==========================================
# DONE
# ==========================================
log "========================================"
log "HARDENING COMPLETE"
log "========================================"
warn "CRITICAL REMINDERS:"
echo "1. Verify you can still SSH with your key BEFORE closing this session"
echo "2. If you changed SSH port, update your client config"
echo "3. Keep regular backups"
echo "4. Monitor 'ausearch -k privilege_escalation' for suspicious activity"
echo "5. Run 'aide --check' weekly or daily for integrity monitoring"
echo "6. If hacked again after this → REBUILD from clean image is the only solution"

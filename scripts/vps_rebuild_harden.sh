#!/bin/bash
# VPS Rebuild Hardening - API Server Ubuntu 24.04
# Run immediately after OS reinstall
# This script hardens a fresh Ubuntu install for API/Dashboard use

set -euo pipefail

if [ "$EUID" -ne 0 ]; then
    echo "Run as root: sudo bash vps_rebuild_harden.sh"
    exit 1
fi

echo "========================================"
echo "VPS REBUILD HARDENING - API Server"
echo "========================================"

# 1. System update
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get -y upgrade
apt-get -y install fail2ban ufw auditd audispd-plugins aide curl wget git
apt-get -y autoremove
apt-get -y autoclean

# 2. UFW - ONLY allow SSH (port 22)
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH only'
ufw --force enable
ufw status verbose

# 3. SSH Hardening
SSHD="/etc/ssh/sshd_config"
cp "$SSHD" "${SSHD}.bak"

sed -i 's/^#*PermitRootLogin.*/PermitRootLogin prohibit-password/' "$SSHD"
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' "$SSHD"
sed -i 's/^#*PubkeyAuthentication.*/PubkeyAuthentication yes/' "$SSHD"
sed -i 's/^#*MaxAuthTries.*/MaxAuthTries 3/' "$SSHD"
sed -i 's/^#*ClientAliveInterval.*/ClientAliveInterval 300/' "$SSHD"
sed -i 's/^#*ClientAliveCountMax.*/ClientAliveCountMax 2/' "$SSHD"
sed -i 's/^#*LoginGraceTime.*/LoginGraceTime 60/' "$SSHD"
sed -i 's/^#*X11Forwarding.*/X11Forwarding no/' "$SSHD"

for setting in "PermitRootLogin prohibit-password" "PasswordAuthentication no" \
               "PubkeyAuthentication yes" "MaxAuthTries 3" \
               "ClientAliveInterval 300" "ClientAliveCountMax 2" \
               "LoginGraceTime 60" "X11Forwarding no"; do
    key=$(echo "$setting" | cut -d' ' -f1)
    if ! grep -qE "^${key}" "$SSHD"; then
        echo "$setting" >> "$SSHD"
    fi
done

systemctl restart sshd

# 4. Fail2ban
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

# 5. Kernel hardening
cat > /etc/sysctl.d/99-security.conf << 'EOF'
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1
net.ipv4.icmp_echo_ignore_broadcasts = 1
net.ipv4.icmp_ignore_bogus_error_responses = 1
net.ipv4.conf.all.accept_source_route = 0
net.ipv6.conf.all.accept_source_route = 0
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv6.conf.all.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.tcp_syncookies = 1
net.ipv6.conf.all.accept_ra = 0
net.ipv6.conf.default.accept_ra = 0
fs.file-max = 65535
kernel.kptr_restrict = 2
kernel.dmesg_restrict = 1
kernel.randomize_va_space = 2
fs.suid_dumpable = 0
fs.protected_hardlinks = 1
fs.protected_symlinks = 1
EOF

sysctl --system

# 6. Auditd
cat > /etc/audit/rules.d/99-security.rules << 'EOF'
-w /etc/sudoers -p wa -k sudoers_changes
-w /etc/sudoers.d/ -p wa -k sudoers_changes
-w /etc/passwd -p wa -k identity_changes
-w /etc/group -p wa -k identity_changes
-w /etc/shadow -p wa -k identity_changes
-w /etc/ssh/sshd_config -p wa -k ssh_config_changes
-w /etc/crontab -p wa -k cron_changes
-w /etc/cron.d/ -p wa -k cron_changes
-w /etc/systemd/system/ -p wa -k systemd_changes
-a always,exit -F arch=b64 -S setuid -S setgid -S setreuid -S setregid -k privilege_escalation
EOF

augenrules --load
systemctl enable auditd
systemctl restart auditd

# 7. AIDE (file integrity)
aideinit || true
mv /var/lib/aide/aide.db.new /var/lib/aide/aide.db 2>/dev/null || true

cat > /etc/cron.daily/aide-check << 'EOF'
#!/bin/bash
/usr/bin/aide --check > /var/log/aide-check.log 2>&1 || true
EOF
chmod +x /etc/cron.daily/aide-check

# 8. Remove unnecessary packages
apt-get purge -y telnet 2>/dev/null || true

# 9. Secure /dev/shm
echo "tmpfs /run/shm tmpfs defaults,noexec,nosuid,nodev 0 0" >> /etc/fstab

# 10. Verify
echo ""
echo "========================================"
echo "HARDENING COMPLETE"
echo "========================================"
echo ""
echo "VERIFICATION CHECKLIST:"
echo "1. UFW status:"
ufw status verbose
echo ""
echo "2. Open ports (SHOULD ONLY SHOW 22):"
ss -tulnp | grep LISTEN
echo ""
echo "3. Fail2ban status:"
fail2ban-client status sshd 2>/dev/null || true
echo ""
echo "4. SSH config:"
grep -E "PermitRootLogin|PasswordAuthentication|PubkeyAuthentication" /etc/ssh/sshd_config
echo ""
echo "CRITICAL NEXT STEPS:"
echo "1. Add your NEW SSH public key: ssh-copy-id root@164.68.101.179"
echo "2. Test SSH login with key"
echo "3. Disable password login completely if not already"
echo "4. Deploy app binding ONLY to 127.0.0.1"
echo "5. Use SSH tunnel: ssh -L 8080:127.0.0.1:8000 root@164.68.101.179 -N"
echo "6. ROTATE all API keys (Meta, Pancake, GA4, BigQuery)"
echo "========================================"

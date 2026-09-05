#!/bin/bash
# VPS Incident Response Check - Ubuntu 24.04
# Phase 1: Full persistence & IOC scan
# Run as: sudo bash vps_incident_check.sh | tee incident_report_$(date +%Y%m%d_%H%M%S).log

set -euo pipefail
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

REPORT_FILE="incident_report_$(date +%Y%m%d_%H%M%S).log"
exec > >(tee -a "$REPORT_FILE")
exec 2>&1

header() {
    echo -e "\n${YELLOW}========== $1 ==========${NC}\n"
}

warn() {
    echo -e "${RED}[!] $1${NC}"
}

ok() {
    echo -e "${GREEN}[OK] $1${NC}"
}

echo "================================================"
echo "VPS INCIDENT RESPONSE SCAN"
echo "Started: $(date)"
echo "Hostname: $(hostname)"
echo "================================================"

# 1. CPU / Memory hogs
header "1. TOP CPU CONSUMERS (Check for miners)"
ps aux --sort=-%cpu | head -20

header "1b. PROCESSES WITH HIGH CPU (>50%)"
ps -eo pid,ppid,cmd,%cpu --sort=-%cpu | awk '$4 > 50 {print}'

header "1c. PROCESSES RUNNING FROM /tmp /dev/shm /var/tmp"
ps aux | grep -E '( /tmp/| /dev/shm/| /var/tmp/)' | grep -v grep || ok "No suspicious process paths found"

# 2. Network connections
header "2. ACTIVE NETWORK CONNECTIONS"
ss -tulnp | grep -v "127.0.0.1" || true

header "2b. ESTABLISHED CONNECTIONS TO EXTERNAL IPs"
ss -tulnp state established | head -30

header "2c. PROCESSES WITH OUTBOUND CONNECTIONS"
lsof -i -n -P | grep ESTABLISHED | head -30 || true

# 3. Persistence - Cron
header "3. CRONTAB PERSISTENCE"
echo "--- Current user crontab ---"
crontab -l 2>/dev/null || true
echo "--- System crontabs ---"
cat /etc/crontab 2>/dev/null || true
echo "--- /etc/cron.d/ ---"
ls -la /etc/cron.d/ 2>/dev/null || true
echo "--- /etc/cron.* ---"
for d in /etc/cron.hourly /etc/cron.daily /etc/cron.weekly /etc/cron.monthly; do
    echo "--> $d"
    ls -la "$d" 2>/dev/null || true
done

# 4. Systemd persistence
header "4. SYSTEMD PERSISTENCE"
echo "--- All services (check for random names) ---"
systemctl list-units --type=service --state=running --no-pager | head -40

echo "--- Recently modified systemd files ---"
find /etc/systemd/system /lib/systemd/system /usr/lib/systemd/system -type f -newer /etc/hostname -exec ls -la {} \; 2>/dev/null || true

echo "--- Systemd timers ---"
systemctl list-timers --all --no-pager || true

echo "--- User systemd services ---"
for user_dir in /home/*/.config/systemd/user /root/.config/systemd/user; do
    if [ -d "$user_dir" ]; then
        echo "--> $user_dir"
        ls -la "$user_dir" 2>/dev/null || true
    fi
done

# 5. Startup scripts
header "5. STARTUP / PROFILE PERSISTENCE"
echo "--- /etc/rc.local ---"
cat /etc/rc.local 2>/dev/null || true
echo "--- /etc/profile.d/ ---"
ls -la /etc/profile.d/ 2>/dev/null || true
for f in /etc/profile.d/*.sh; do
    if [ -f "$f" ]; then
        echo "--> $f"
        cat "$f"
    fi
done
echo "--- /etc/profile ---"
cat /etc/profile | grep -v "^#" | grep -v "^$" || true
echo "--- /root/.bashrc (last 20 lines) ---"
tail -20 /root/.bashrc || true
echo "--- /root/.bash_profile / .profile ---"
cat /root/.bash_profile 2>/dev/null || true
cat /root/.profile 2>/dev/null || true

# 6. SSH backdoors & keys
header "6. SSH BACKDOORS & KEYS"
echo "--- /root/.ssh/authorized_keys ---"
cat /root/.ssh/authorized_keys 2>/dev/null || true
echo "--- /root/.ssh/known_hosts ---"
cat /root/.ssh/known_hosts 2>/dev/null || true
echo "--- All user authorized_keys ---"
find /home /root -name "authorized_keys" -exec echo "--> {}" \; -exec cat {} \; 2>/dev/null || true

echo "--- sshd_config (critical lines) ---"
grep -E "PermitRootLogin|PasswordAuthentication|PubkeyAuthentication|Port|AllowUsers|DenyUsers" /etc/ssh/sshd_config 2>/dev/null || true

echo "--- SSH login history ---"
last -a | head -30 || true
echo "--- Failed SSH attempts ---"
grep -i "failed\|invalid user" /var/log/auth.log 2>/dev/null | tail -50 || true
grep -i "failed\|invalid user" /var/log/secure 2>/dev/null | tail -50 || true

# 7. User accounts
header "7. USER ACCOUNTS"
echo "--- /etc/passwd (login shells) ---"
grep -E "/bin/bash|/bin/sh|/bin/zsh" /etc/passwd || true

echo "--- Users with UID >= 1000 ---"
awk -F: '$3 >= 1000 {print $1 " UID=" $3}' /etc/passwd || true

echo "--- Users with UID 0 (root equiv) ---"
awk -F: '$3 == 0 {print $1 " UID=" $3}' /etc/passwd || true

echo "--- Recently modified /etc/passwd /etc/shadow ---"
ls -la /etc/passwd /etc/shadow /etc/group /etc/sudoers 2>/dev/null || true

# 8. Sudoers
header "8. SUDOERS"
cat /etc/sudoers 2>/dev/null | grep -v "^#" | grep -v "^$" || true
echo "--- /etc/sudoers.d/ ---"
find /etc/sudoers.d/ -type f -exec echo "--> {}" \; -exec cat {} \; 2>/dev/null || true

# 9. SUID binaries
header "9. NEW SUID BINARIES (compare with known good if possible)"
find / -perm -4000 -type f -exec ls -la {} \; 2>/dev/null | grep -v "snap" | head -50

# 10. Suspicious files
header "10. SUSPICIOUS FILES IN TMP / DEV / SHM"
echo "--- /tmp ---"
ls -la /tmp 2>/dev/null || true
echo "--- /var/tmp ---"
ls -la /var/tmp 2>/dev/null || true
echo "--- /dev/shm ---"
ls -la /dev/shm 2>/dev/null || true
echo "--- Executable files in tmp ---"
find /tmp /var/tmp /dev/shm -type f -executable 2>/dev/null | head -30 || true

# 11. Hidden files in common dirs
header "11. HIDDEN FILES / DOTFILES IN / /etc /var /home"
find /etc /var /home /root -name ".*" -type f -newer /etc/hostname 2>/dev/null | head -30 || true

# 12. Docker
header "12. DOCKER / CONTAINERS"
if command -v docker &> /dev/null; then
    echo "--- Docker containers (all) ---"
    docker ps -a --no-trunc 2>/dev/null || true
    echo "--- Docker images ---"
    docker images --no-trunc 2>/dev/null || true
    echo "--- Docker networks ---"
    docker network ls 2>/dev/null || true
    echo "--- Docker volumes ---"
    docker volume ls 2>/dev/null || true
else
    ok "Docker not installed"
fi

# 13. Kernel modules
header "13. KERNEL MODULES"
lsmod | head -40 || true
echo "--- Recently modified modules ---"
find /lib/modules -type f -newer /etc/hostname 2>/dev/null | head -20 || true

# 14. Opened files
header "14. RECENTLY DELETED BUT OPEN FILES (malware tactic)"
lsof +L1 2>/dev/null | head -20 || true

# 15. Web shells (if web server exists)
header "15. WEB SHELL INDICATORS"
if [ -d /var/www ] || [ -d /usr/share/nginx ] || [ -d /etc/apache2 ]; then
    find /var/www /usr/share/nginx /etc/apache2 -type f \( -name "*.php" -o -name "*.jsp" -o -name "*.asp" -o -name "*.sh" \) -newer /etc/hostname 2>/dev/null | head -30 || true
else
    ok "No web server dirs found"
fi

# 16. Binary hashes check (optional quick check)
header "16. SSHD / SYSTEM BINARY INTEGRITY"
echo "--- sshd binary ---"
ls -la $(which sshd) 2>/dev/null || true
sha256sum $(which sshd) 2>/dev/null || true
echo "--- sudo binary ---"
ls -la $(which sudo) 2>/dev/null || true
sha256sum $(which sudo) 2>/dev/null || true

# 17. Environment / PATH
header "17. ENVIRONMENT VARIABLES & PATH"
echo "PATH=$PATH"
env | grep -i proxy || true

# 18. Listening ports summary
header "18. ALL LISTENING PORTS"
ss -tulnp | sort -k5

echo ""
echo "================================================"
echo "SCAN COMPLETE: $(date)"
echo "Report saved to: $REPORT_FILE"
echo "================================================"
echo ""
echo "NEXT STEPS:"
echo "1. Review RED/WARNING items above"
echo "2. If you see unknown users, cronjobs, services → that's persistence"
echo "3. Kill malicious PIDs, remove persistence, then run hardening script"
echo "4. RECOMMENDED: After cleanup, REBUILD VPS from clean image for 100% certainty"

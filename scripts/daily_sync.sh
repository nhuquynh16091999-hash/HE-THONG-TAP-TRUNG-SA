#!/bin/bash
# ═══════════════════════════════════════════
# AUUS1 — Daily Sync
# Chạy lúc 8:00 SA (ICT) mỗi ngày
# Step 0: Order Sync (US + AU shops → BQ)
# Step 1: Ads Sync (3 ngày lookback)
# Step 2: Ads Spy (FB Ad Library)
# Step 3: Stock Sync (Poscake → BQ)
# ═══════════════════════════════════════════

AUUS_DIR="/Users/tatthanh031298/Desktop/AUUS"
VENV="$AUUS_DIR/.venv/bin/python"
SCRIPT="$AUUS_DIR/scripts/sync_auus1_ads.py"
LOG="$AUUS_DIR/logs/daily_sync_$(date +%Y%m%d).log"

echo "═══════════════════════════════════" >> "$LOG"
echo "AUUS1 Daily Sync — $(date '+%Y-%m-%d %H:%M:%S')" >> "$LOG"
echo "═══════════════════════════════════" >> "$LOG"

# Load env
export GOOGLE_APPLICATION_CREDENTIALS="$AUUS_DIR/bigquery_key.json"
set -a
source "$AUUS_DIR/.env" 2>/dev/null
set +a

# Step 0: Order Sync (US + AU → BQ)
echo "── Step 0: Order Sync (US + AU) ──" >> "$LOG"
ORDER_SCRIPT="$AUUS_DIR/scripts/sync_auus1_orders.py"
"$VENV" "$ORDER_SCRIPT" --orders >> "$LOG" 2>&1
echo "Order sync exit: $? — $(date '+%H:%M:%S')" >> "$LOG"
echo "" >> "$LOG"

# Step 1: Sync Marketing Ads (3 ngày lookback)
echo "── Step 1: Marketing Ads Sync ──" >> "$LOG"
"$VENV" "$SCRIPT" --days 3 >> "$LOG" 2>&1
echo "Marketing ads exit: $? — $(date '+%H:%M:%S')" >> "$LOG"

# Step 2: Ads Spy — Crawl FB Ad Library (Top 5 đối thủ)
echo "" >> "$LOG"
echo "── Step 2: Ads Spy Sync (FB Ad Library) ──" >> "$LOG"
ADS_SPY="$AUUS_DIR/scripts/sync_fb_library.py"
if [ -f "$ADS_SPY" ]; then
    "$VENV" "$ADS_SPY" >> "$LOG" 2>&1
    echo "Ads Spy exit: $? — $(date '+%H:%M:%S')" >> "$LOG"
else
    echo "⚠️ sync_fb_library.py not found, skipping" >> "$LOG"
fi

# Step 3: Stock Sync — Poscake inventory → BigQuery
echo "" >> "$LOG"
echo "── Step 3: Stock Sync (Poscake → BQ) ──" >> "$LOG"
STOCK_SCRIPT="$AUUS_DIR/scripts/sync_auus1_stock.py"
"$VENV" "$STOCK_SCRIPT" >> "$LOG" 2>&1
echo "Stock sync exit: $? — $(date '+%H:%M:%S')" >> "$LOG"

echo "" >> "$LOG"
echo "═══ All done — $(date '+%H:%M:%S') ═══" >> "$LOG"

# Giữ log tối đa 30 ngày
find "$AUUS_DIR/logs" -name "daily_sync_*.log" -mtime +30 -delete 2>/dev/null

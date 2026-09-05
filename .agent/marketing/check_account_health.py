import sys
import os
import json
from meta_ads_client import MetaAdsClient
from dotenv import load_dotenv
import sys

# Force UTF-8 for console output (Windows fix)
try:
    sys.stdout.reconfigure(encoding='utf-8')
except AttributeError:
    pass

load_dotenv()


def check_health():
    client = MetaAdsClient()
    account_ids = os.getenv("META_AD_ACCOUNT_IDS", "").split(",")
    
    report = []
    
    print("\n" + "="*50)
    print("🏥 META ADS ACCOUNT HEALTH CHECK (LIVE)")
    print("="*50)
    
    for acc in account_ids:
        acc = acc.strip()
        if not acc: continue
        
        print(f"\n📡 Parsing Account: {acc}...")
        
        # 1. Account Overview
        insights = client.get_account_insights(acc)
        if hasattr(insights, 'get') and insights.get('error'):
             print(f"❌ Error: {insights['error']}")
             continue
             
        if not insights:
            print("⚠️ No data for today.")
            continue
            
        currency = insights['currency']
        spend = insights['spend']
        val = insights['purchase_value']
        roas = insights['roas']
        
        # 2. Heuristic Currency Check (RON vs VND)
        # If Currency is RON but Value > Spend * 100, likely Value is in VND
        real_roas = roas
        note = ""
        if currency == 'RON' and roas > 100:
            real_roas = roas / 5500 # Approx rate
            note = "(Converted VND->RON)"
            
        print(f"   💰 Spend: {spend} {currency}")
        print(f"   💵 Revenue: {val:,.0f} {currency}")
        print(f"   📈 ROAS (Raw): {roas}")
        print(f"   📊 ROAS (Est): {real_roas:.2f} {note}")
        
        # 3. Active Campaigns
        campaigns = client.get_active_campaigns(acc)
        
        if isinstance(campaigns, dict) and 'error' in campaigns:
            print(f"   ❌ Error fetching campaigns: {campaigns['error']}")
        else:
            print(f"   🔥 Active Campaigns: {len(campaigns)}")
            
            for cmp in campaigns:
                c_ins = cmp.get('insights', {}).get('data', [{}])[0]
                c_spend = float(c_ins.get('spend', 0))
                c_roas = 0
                if c_spend > 0:
                   # Calculate ROAS for campaign
                   c_val = 0
                   for action in c_ins.get('action_values', []):
                       if action['action_type'] == 'purchase':
                           c_val = float(action['value'])
                   c_roas = c_val / c_spend
                   
                   # Currency fix visual
                   note = ""
                   if currency == 'USD' and c_roas > 100:
                       c_roas = c_roas / 25000 # Approx logic
                       note = "(Est)"

                   print(f"      - {cmp['name']} | Spend: {c_spend} | ROAS: {c_roas:.2f} {note}")

        
        report.append({
            "account": acc,
            "spend": spend,
            "roas": real_roas
        })

    print("\n" + "="*50)
    print("✅ HEALTH CHECK COMPLETE")
    
if __name__ == "__main__":
    check_health()

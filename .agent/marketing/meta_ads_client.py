import os
import requests
import json
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

class MetaAdsClient:
    def __init__(self, use_env_token=True):
        if use_env_token:
            load_dotenv()
            self.access_token = os.getenv("META_ACCESS_TOKEN")
            self.ad_account_ids = [x.strip() for x in os.getenv("META_AD_ACCOUNT_IDS", "").split(",") if x.strip()]
        
        self.api_version = "v21.0" # Keeping this as it's used elsewhere, but base_url is hardcoded in the instruction
        self.base_url = "https://graph.facebook.com/v19.0" # As per instruction
        self.current_usage = 0 # % of limit
        self.estimated_regain = 0  # minutes until access regained
        
        if not self.access_token:
            raise ValueError("META_ACCESS_TOKEN not found in .env")

    def get_monitored_accounts(self):
        """Returns list of Ad Account IDs from .env"""
        ids = os.getenv("META_AD_ACCOUNT_IDS", "")
        return [x.strip() for x in ids.split(",") if x.strip()]


    def get_account_insights(self, ad_account_id, period="today"):
        """
        Fetches real-time insights for an ad account.
        """
        if not ad_account_id.startswith("act_"):
            ad_account_id = f"act_{ad_account_id}"
            
        url = f"{self.base_url}/{ad_account_id}/insights"
        params = {
            "access_token": self.access_token,
            "date_preset": period,
            "fields": "spend,account_currency,actions,action_values,cpc,cpm,ctr,frequency",
            "level": "account"
        }
        
        response = requests.get(url, params=params)
        if response.status_code != 200:
            return {"error": response.text}
            
        data = response.json().get("data", [])
        if not data:
            return None
            
        return self._process_insights(data[0])

    def get_active_campaigns(self, ad_account_id):
        """
        Fetches active campaigns with performance for Today and Last 3 Days.
        Uses 2 API calls and merges data to avoid Graph API aliasing issues.
        """
        if not ad_account_id.startswith("act_"):
            ad_account_id = f"act_{ad_account_id}"

        url = f"{self.base_url}/{ad_account_id}/campaigns"
        
        # 1. Fetch Today's Data (Base)
        params_today = {
            "access_token": self.access_token,
            "effective_status": "['ACTIVE']",
            "fields": "name,status,daily_budget,lifetime_budget,insights.date_preset(today){spend,actions,action_values,clicks,impressions}",
            "limit": 50
        }
        resp_today = requests.get(url, params=params_today)
        
        # Guardian: Check Rate Limit from X-Business-Use-Case-Usage header
        # Meta format: {"business_id": [{"call_count": X, "total_cputime": Y, "total_time": Z, "estimated_time_to_regain_access": N}]}
        if 'x-business-use-case-usage' in resp_today.headers:
             usage_str = resp_today.headers['x-business-use-case-usage']
             try:
                 usage_data = json.loads(usage_str)
                 # Handle both dict format {"biz_id": [...]} and list format [...]
                 entries = []
                 if isinstance(usage_data, dict):
                     for biz_id, items in usage_data.items():
                         if isinstance(items, list):
                             entries.extend(items)
                 elif isinstance(usage_data, list):
                     entries = usage_data
                 
                 if entries:
                     # Take max of call_count, total_cputime, total_time across all entries
                     max_usage = max(
                         max(e.get('call_count', 0), e.get('total_cputime', 0), e.get('total_time', 0))
                         for e in entries
                     )
                     self.current_usage = max_usage
                     # Track estimated time to regain if throttled
                     self.estimated_regain = max(
                         (e.get('estimated_time_to_regain_access', 0) for e in entries), default=0
                     )
                     if max_usage >= 75:
                         print(f"[META CLIENT] ⚠️ API Usage: {max_usage}%, regain in {self.estimated_regain}min")
             except Exception as parse_err:
                 print(f"[META CLIENT] Failed to parse usage header: {parse_err}")
        
        # Also check x-ad-account-usage header (secondary limit)
        if 'x-ad-account-usage' in resp_today.headers:
            try:
                acc_usage = json.loads(resp_today.headers['x-ad-account-usage'])
                acc_pct = float(acc_usage.get('acc_id_util_pct', 0))
                if acc_pct > self.current_usage:
                    self.current_usage = acc_pct
            except:
                pass
                 
        if resp_today.status_code == 429:
            # Rate limited by Meta — set high usage to trigger guard
            self.current_usage = 100
            self.estimated_regain = 5
            print(f"[META CLIENT] 🛑 HTTP 429 Rate Limited!")
            return []
        
        if resp_today.status_code != 200:
            print(f"Error fetching today: {resp_today.text}")
        
        campaigns = resp_today.json().get("data", [])
        if not campaigns:
            return []
            
        # 2. Fetch Last 3 Days Data (Overlay)
        # We need to map campaign IDs to 3D insights
        # Ideally we filter by the IDs we just got, but effective_status ACTIVE is same filter.
        params_3d = {
            "access_token": self.access_token,
            "effective_status": "['ACTIVE']",
            "fields": "id,insights.date_preset(last_3d){spend,actions,action_values}",
            "limit": 50
        }
        resp_3d = requests.get(url, params=params_3d)
        map_3d = {}
        if resp_3d.status_code == 200:
            for item in resp_3d.json().get("data", []):
                map_3d[item['id']] = item.get('insights', {})

        # 3. Merge
        for c in campaigns:
            c['insights_3d'] = map_3d.get(c['id'], {})
            
        return campaigns

    def pause_ad(self, ad_id):
        """
        Pauses an Ad (Autonomous Action).
        """
        url = f"{self.base_url}/{ad_id}"
        params = {
            "access_token": self.access_token,
            "status": "PAUSED"
        }
        
        # POST request to update status
        response = requests.post(url, data=params)
        if response.status_code == 200:
            return {"success": True, "ad_id": ad_id, "status": "PAUSED"}
        else:
            return {"success": False, "error": response.text}

    def _process_insights(self, row):
        """
        Helper to calculate ROAS from raw actions.
        """
        spend = float(row.get("spend", 0))
        purchase_value = 0
        
        # Parse action_values for purchase 'value'
        if "action_values" in row:
            for act in row["action_values"]:
                if act["action_type"] == "purchase":
                    purchase_value = float(act["value"])
                    
        roas = purchase_value / spend if spend > 0 else 0
        
        return {
            "spend": spend,
            "purchase_value": purchase_value,
            "roas": round(roas, 2),
            "currency": row.get("account_currency", "UNKNOWN"),
            "cpc": row.get("cpc"),
            "ctr": row.get("ctr")
        }


if __name__ == "__main__":
    # Test Script
    client = MetaAdsClient()
    # Test Account from pull_historical_ads.py
    TEST_ACC = "act_817501334775697" 
    
    print(f"--- Checking Account {TEST_ACC} ---")
    insights = client.get_account_insights(TEST_ACC)
    print("Today's Insights:", json.dumps(insights, indent=2))

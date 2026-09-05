"""
Dashboard API — Ads Command Center endpoints.

Provides real-time campaign data by combining:
- Meta Marketing API (spend, impressions, messages, etc.)
- BigQuery (real orders, revenue from Poscake)

Endpoints:
    GET /api/dashboard/{project_id}/ads-command-center
    GET /api/dashboard/{project_id}/ads-command-center/accounts
"""

from __future__ import annotations

import logging
import os
import time
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Query
from google.cloud import bigquery

from faos_brain.api.main import get_bq_client
from faos_brain.config import settings

log = logging.getLogger("faos.api.dashboard")

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

# ═══════════════════════════════════════════
# Config per project
# ═══════════════════════════════════════════
PROJECT_CONFIG: Dict[str, Dict[str, Any]] = {
    "auus1": {
        "ad_account_ids": [],
        "dataset": "AUUS1_Dataset",
        "currency": "USD",
    },
}


def _get_date_range(date_preset: str):
    """Convert date preset to (since, until) date strings."""
    today = datetime.utcnow().date()
    if date_preset == "yesterday":
        return str(today - timedelta(days=1)), str(today - timedelta(days=1))
    elif date_preset == "last_7d":
        return str(today - timedelta(days=7)), str(today)
    elif date_preset == "last_30d":
        return str(today - timedelta(days=30)), str(today)
    else:  # today
        return str(today), str(today)


def _get_ad_accounts() -> List[str]:
    """Get ad account IDs from settings."""
    return settings.ad_account_list


# ═══════════════════════════════════════════
# Meta Marketing API — Fetch campaign data
# ═══════════════════════════════════════════
def _fetch_meta_campaigns(
    account_ids: List[str],
    date_preset: str,
    account_filter: str = "all",
) -> List[Dict[str, Any]]:
    """Fetch campaign insights from Meta Marketing API."""
    campaigns = []
    since, until = _get_date_range(date_preset)

    target_accounts = account_ids
    if account_filter != "all":
        target_accounts = [a for a in account_ids if a == account_filter]

    try:
        from facebook_business.api import FacebookAdsApi
        from facebook_business.adobjects.adaccount import AdAccount

        app_id = settings.meta_app_id or os.getenv("META_APP_ID", "")
        app_secret = settings.meta_app_secret or os.getenv("META_APP_SECRET", "")
        access_token = settings.meta_access_token or os.getenv("META_ACCESS_TOKEN", "")

        if not access_token:
            log.warning("No META_ACCESS_TOKEN configured")
            return []

        # Only pass app credentials if both app_id and app_secret are available.
        # If app_id is missing, init with token only — avoids invalid appsecret_proof (400 error).
        if app_id and app_secret:
            FacebookAdsApi.init(
                app_id=app_id,
                app_secret=app_secret,
                access_token=access_token,
            )
        else:
            FacebookAdsApi.init(access_token=access_token)

        fields = [
            "campaign_name",
            "campaign_id",
            "spend",
            "impressions",
            "reach",
            "frequency",
            "clicks",
            "cpm",
            "cpc",
            "ctr",
            "actions",
            "cost_per_action_type",
        ]
        params = {
            "time_range": {"since": since, "until": until},
            "level": "campaign",
            "filtering": [
                {"field": "campaign.effective_status", "operator": "IN",
                 "value": ["ACTIVE", "PAUSED"]}
            ],
        }

        for acc_id in target_accounts:
            try:
                account = AdAccount(acc_id)
                insights = account.get_insights(fields=fields, params=params)

                for row in insights:
                    actions = {a["action_type"]: int(a["value"]) for a in (row.get("actions") or [])}
                    cost_per = {a["action_type"]: float(a["value"]) for a in (row.get("cost_per_action_type") or [])}

                    messages = actions.get("onsite_conversion.messaging_conversation_started_7d", 0)
                    leads = actions.get("lead", 0)
                    purchases = actions.get("purchase", 0) or actions.get("offsite_conversion.fb_pixel_purchase", 0)
                    link_clicks = actions.get("link_click", 0)

                    campaigns.append({
                        "id": row.get("campaign_id", ""),
                        "name": row.get("campaign_name", "Unknown"),
                        "status": "ACTIVE",
                        "account_id": acc_id,
                        "metrics_meta": {
                            "spend": float(row.get("spend", 0)),
                            "impressions": int(row.get("impressions", 0)),
                            "reach": int(row.get("reach", 0)),
                            "frequency": float(row.get("frequency", 0)),
                            "clicks": int(row.get("clicks", 0)),
                            "cpm": float(row.get("cpm", 0)),
                            "cpc": float(row.get("cpc", 0)),
                            "ctr": float(row.get("ctr", 0)),
                            "messages": messages,
                            "leads": leads,
                            "purchases": purchases,
                            "link_clicks": link_clicks,
                            "cost_per_msg": cost_per.get("onsite_conversion.messaging_conversation_started_7d", 0),
                            "cost_per_lead": cost_per.get("lead", 0),
                            "cost_per_purchase": cost_per.get("purchase", 0),
                        },
                        "metrics_real": {
                            "leads": 0,
                            "orders": 0,
                            "revenue": 0,
                            "created_orders": 0,
                            "roas": 0,
                            "real_cpa": 0,
                        },
                    })
            except Exception as e:
                log.warning(f"Failed to fetch Meta data for {acc_id}: {e}")
                continue

    except ImportError:
        log.warning("facebook_business package not installed, using BQ fallback")
        return []
    except Exception as e:
        log.error(f"Meta API error: {e}")
        return []

    return campaigns


# ═══════════════════════════════════════════
# BigQuery — Fetch campaign data from fb_ads_data
# ═══════════════════════════════════════════
def _fetch_bq_campaign_data(
    bq: bigquery.Client,
    dataset: str,
    date_preset: str,
    project_id: str,
) -> Dict[str, Dict[str, Any]]:
    """Fetch campaign-level data from BigQuery fb_ads_data table."""
    since, until = _get_date_range(date_preset)
    full_dataset = f"{settings.gcp_project_id}.{dataset}"

    # Use correct column names from actual BQ schema:
    # account_id (not ad_account_id)
    # messaging_conversations_started (not messages)
    # No inline_link_clicks, cost_per_message, cost_per_lead columns
    query = f"""
        SELECT
            campaign_id,
            campaign_name,
            account_id,
            SUM(spend) AS spend,
            SUM(impressions) AS impressions,
            SUM(reach) AS reach,
            AVG(frequency) AS frequency,
            SUM(clicks) AS clicks,
            AVG(cpm) AS cpm,
            AVG(cpc) AS cpc,
            AVG(ctr) AS ctr,
            SUM(COALESCE(messaging_conversations_started, 0)) AS messages,
            SUM(COALESCE(CAST(leads AS INT64), 0)) AS leads,
            SUM(COALESCE(purchases, 0)) AS purchases
        FROM `{full_dataset}.fb_ads_data`
        WHERE date BETWEEN '{since}' AND '{until}'
        GROUP BY campaign_id, campaign_name, account_id
        ORDER BY spend DESC
    """

    result = {}
    try:
        rows = list(bq.query(query).result())
        
        # If "today" returned no data, auto-expand to last 7 days
        if not rows and date_preset == "today":
            log.info("BQ fallback: no data for today, expanding to last_7d")
            since_7d, until_7d = _get_date_range("last_7d")
            query_7d = query.replace(
                f"BETWEEN '{since}' AND '{until}'",
                f"BETWEEN '{since_7d}' AND '{until_7d}'"
            )
            rows = list(bq.query(query_7d).result())
        
        for row in rows:
            cid = str(row.campaign_id)
            result[cid] = {
                "campaign_id": cid,
                "campaign_name": row.campaign_name or "Unknown",
                "account_id": f"act_{row.account_id}" if row.account_id else "",
                "spend": float(row.spend or 0),
                "impressions": int(row.impressions or 0),
                "reach": int(row.reach or 0),
                "frequency": float(row.frequency or 0),
                "clicks": int(row.clicks or 0),
                "cpm": float(row.cpm or 0),
                "cpc": float(row.cpc or 0),
                "ctr": float(row.ctr or 0),
                "messages": int(row.messages or 0),
                "leads": int(row.leads or 0),
                "purchases": int(row.purchases or 0),
                "cost_per_msg": float(row.spend or 0) / max(int(row.messages or 0), 1) if int(row.messages or 0) > 0 else 0,
                "cost_per_lead": float(row.spend or 0) / max(int(row.leads or 0), 1) if int(row.leads or 0) > 0 else 0,
            }
    except Exception as e:
        log.warning(f"BQ campaign query failed: {e}")

    return result


# ═══════════════════════════════════════════
# BigQuery — Fetch real order data from vw_fact_orders
# ═══════════════════════════════════════════
def _fetch_bq_real_orders(
    bq: bigquery.Client,
    dataset: str,
    date_preset: str,
) -> Dict[str, Dict[str, Any]]:
    """Fetch real order data from BigQuery vw_fact_orders, grouped by matched_campaign_id.
    
    Only orders with a matched_campaign_id are returned — organic/unmatched orders are excluded.
    """
    since, until = _get_date_range(date_preset)
    full_dataset = f"{settings.gcp_project_id}.{dataset}"

    query = f"""
        SELECT
            CAST(matched_campaign_id AS STRING) AS campaign_id,
            COUNT(*) AS created_orders,
            COUNTIF(status_group = 'success') AS success_orders,
            SUM(CASE WHEN status_group = 'success' THEN revenue_L3_success ELSE 0 END) AS revenue_success,
            SUM(revenue_L1_lead) AS revenue_lead
        FROM `{full_dataset}.vw_fact_orders`
        WHERE order_date BETWEEN '{since}' AND '{until}'
          AND matched_campaign_id IS NOT NULL
        GROUP BY matched_campaign_id
    """

    result = {}
    try:
        rows = list(bq.query(query).result())
        for row in rows:
            key = str(row.campaign_id) if row.campaign_id else ""
            if not key:
                continue
            result[key] = {
                "created_orders": int(row.created_orders or 0),
                "orders": int(row.success_orders or 0),
                "revenue_success": float(row.revenue_success or 0),
                "revenue_lead": float(row.revenue_lead or 0),
            }
    except Exception as e:
        log.warning(f"BQ orders query failed: {e}")

    return result


# ═══════════════════════════════════════════
# Endpoints
# ═══════════════════════════════════════════
@router.get("/{project_id}/ads-command-center/accounts")
async def get_accounts(
    project_id: str,
) -> Dict[str, Any]:
    """Get list of ad accounts for a project."""
    accounts = []
    for acc_id in _get_ad_accounts():
        accounts.append({
            "id": acc_id,
            "source": "meta",
        })
    return {"accounts": accounts}


@router.get("/{project_id}/ads-command-center")
async def get_ads_command_center(
    project_id: str,
    date_preset: str = Query("today"),
    account_id: str = Query("all"),
    bq: bigquery.Client = Depends(get_bq_client),
) -> Dict[str, Any]:
    """
    Main Ads Command Center endpoint.
    
    Combines Meta API campaign data with BigQuery real order data.
    Falls back to BQ-only data if Meta API is unavailable.
    """
    start_time = time.time()
    ad_accounts = _get_ad_accounts()
    
    config = PROJECT_CONFIG.get(project_id, {
        "dataset": f"{project_id.upper()}_Dataset",
        "currency": "USD",
    })
    dataset = config.get("dataset", f"{project_id.upper()}_Dataset")

    # Strategy: Try Meta API first for live data, fallback to BQ
    source = "meta_api"
    campaigns = []
    warning = None
    # Track actual date preset used for orders synchronization
    actual_date_preset = date_preset

    if date_preset == "today":
        # Live: use Meta API
        campaigns = _fetch_meta_campaigns(ad_accounts, date_preset, account_id)
        if not campaigns:
            source = "bigquery"
            warning = "Meta API unavailable, showing BQ historical data"
    
    if not campaigns:
        # Fallback or historical: use BQ
        source = "bigquery"
        bq_data = _fetch_bq_campaign_data(bq, dataset, date_preset, project_id)
        
        # If BQ auto-expanded from "today" to "last_7d", track that
        if not bq_data and date_preset == "today":
            actual_date_preset = "last_7d"
        elif bq_data:
            # Check if the data came from auto-expand (campaign data uses last_7d)
            actual_date_preset = date_preset
        
        for cid, data in bq_data.items():
            acc = data.get("account_id", "")
            if account_id != "all" and acc != account_id:
                continue
                
            campaigns.append({
                "id": cid,
                "name": data.get("campaign_name", "Unknown"),
                "status": "ACTIVE",
                "account_id": acc,
                "metrics_meta": {
                    "spend": data.get("spend", 0),
                    "impressions": data.get("impressions", 0),
                    "reach": data.get("reach", 0),
                    "frequency": data.get("frequency", 0),
                    "clicks": data.get("clicks", 0),
                    "cpm": data.get("cpm", 0),
                    "cpc": data.get("cpc", 0),
                    "ctr": data.get("ctr", 0),
                    "messages": data.get("messages", 0),
                    "leads": data.get("leads", 0),
                    "purchases": data.get("purchases", 0),
                    "link_clicks": 0,
                    "cost_per_msg": data.get("cost_per_msg", 0),
                    "cost_per_lead": data.get("cost_per_lead", 0),
                    "cost_per_purchase": 0,
                },
                "metrics_real": {
                    "leads": 0,
                    "orders": 0,
                    "revenue": 0,
                    "created_orders": 0,
                    "roas": 0,
                    "real_cpa": 0,
                },
            })

    # Enrich with real order data from BQ — match by campaign_id
    # IMPORTANT: use actual_date_preset to keep date range synchronized with campaigns
    real_orders = {}
    try:
        real_orders = _fetch_bq_real_orders(bq, dataset, actual_date_preset)
        
        for camp in campaigns:
            camp_id = str(camp.get("id", ""))
            
            if camp_id and camp_id in real_orders:
                order_data = real_orders[camp_id]
                revenue = order_data.get("revenue_lead", 0)
                created = order_data.get("created_orders", 0)
                orders = order_data.get("orders", 0)
                spend = camp["metrics_meta"].get("spend", 0)
                
                camp["metrics_real"] = {
                    "leads": created,
                    "orders": orders,
                    "revenue": revenue,
                    "created_orders": created,
                    "roas": (revenue / spend) if spend > 0 and revenue > 0 else 0,
                    "real_cpa": (spend / created) if created > 0 else 0,
                }
    except Exception as e:
        log.warning(f"Failed to enrich with real orders: {e}")

    # Build summary — use real_orders (campaign-level, no duplication)
    total_spend = sum(c["metrics_meta"]["spend"] for c in campaigns)
    total_messages = sum(c["metrics_meta"]["messages"] for c in campaigns)
    
    # Real orders: sum from matched campaign data (no double-counting)
    total_real_orders = sum(v.get("orders", 0) for v in real_orders.values())
    total_real_revenue = sum(v.get("revenue_lead", 0) for v in real_orders.values())
    total_created = sum(v.get("created_orders", 0) for v in real_orders.values())

    elapsed_ms = int((time.time() - start_time) * 1000)

    response: Dict[str, Any] = {
        "meta": {
            "sync_duration_ms": elapsed_ms,
            "source": source,
        },
        "summary": {
            "total_spend": total_spend,
            "total_meta_messages": total_messages,
            "total_real_leads": total_created,
            "total_real_orders": total_real_orders,
            "total_real_revenue": total_real_revenue,
            "blended_roas": (total_real_revenue / total_spend) if total_spend > 0 else 0,
        },
        "campaigns": campaigns,
    }

    if warning:
        response["_warning"] = warning

    return response


"""
FAOS v6 — Smart Sync Engine (Phase C: Real Implementation).

Tiered sync strategy:
  HOT  (30 min): BQ ETL from fb_ads_data → fact_ads_optimization
  WARM (3-6 hr): Meta API enrichment (video metrics, creative details)
  COLD (daily):  JOIN with sale_order for revenue mapping + return rate
  ONCE:          Creative metadata per new ad_id

N8N already syncs raw Meta data → fb_ads_data (21 cols every 30 min).
This module TRANSFORMS that data into fact_ads_optimization (55 cols)
and enriches with additional Meta API fields.
"""

import json
import logging
import os
from dataclasses import dataclass
from datetime import date, datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple

import requests

from faos_brain.optimization.config import OptimizationConfig, SyncTier, get_project_config

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════
# Ad Account Config (loaded from config/ad_accounts.json)
# ═══════════════════════════════════════════════════════════════════

@dataclass
class AdAccount:
    """Meta Ad Account."""
    id: str           # e.g. "act_817501334775697"
    name: str
    status: str       # active | error | paused


def load_ad_accounts(project_id: str) -> List[AdAccount]:
    """Load ad accounts from config/ad_accounts.json."""
    config_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        "config", "ad_accounts.json",
    )
    try:
        with open(config_path) as f:
            data = json.load(f)
        project_data = data.get("projects", {}).get(project_id, {})
        return [
            AdAccount(id=a["id"], name=a["name"], status=a["status"])
            for a in project_data.get("accounts", [])
            if a.get("status") == "active"
        ]
    except FileNotFoundError:
        logger.warning(f"ad_accounts.json not found at {config_path}")
        return []


def get_access_token(project_id: str) -> Optional[str]:
    """Get Meta API access token from environment."""
    config_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        "config", "ad_accounts.json",
    )
    try:
        with open(config_path) as f:
            data = json.load(f)
        env_key = data["projects"][project_id]["access_token_env"]
        return os.environ.get(env_key)
    except (FileNotFoundError, KeyError):
        # Fallback: try common env var names
        for key in ["META_ACCESS_TOKEN", f"{project_id.upper()}_META_ACCESS_TOKEN"]:
            token = os.environ.get(key)
            if token:
                return token
    return None


# ═══════════════════════════════════════════════════════════════════
# Sync Result
# ═══════════════════════════════════════════════════════════════════

@dataclass
class SyncResult:
    """Result of a sync operation."""
    tier: SyncTier
    project_id: str
    rows_processed: int = 0
    rows_inserted: int = 0
    errors: List[str] = None
    duration_seconds: float = 0.0

    def __post_init__(self):
        if self.errors is None:
            self.errors = []


# ═══════════════════════════════════════════════════════════════════
# SmartSync Engine
# ═══════════════════════════════════════════════════════════════════

class SmartSync:
    """
    Smart Sync — transforms N8N-synced fb_ads_data into
    fact_ads_optimization with tiered enrichment.
    """

    META_API_BASE = "https://graph.facebook.com/v21.0"

    def __init__(
        self,
        project_id: str,
        bq_client: Any = None,
        config: Optional[OptimizationConfig] = None,
    ):
        self.project_id = project_id
        self.bq_client = bq_client
        self.config = config or get_project_config(project_id)
        self.accounts = load_ad_accounts(project_id)
        self.access_token = get_access_token(project_id)

    # ─── HOT Tier: BQ ETL (every 30 min) ──────────────────────────

    async def sync_hot(self, run_date: Optional[date] = None) -> SyncResult:
        """
        HOT tier: Transform fb_ads_data → fact_ads_optimization.

        Runs a BQ MERGE to aggregate N8N-synced data into the
        optimization table. No Meta API calls needed.
        """
        result = SyncResult(tier=SyncTier.HOT, project_id=self.project_id)
        start = datetime.now(timezone.utc)
        target_date = run_date or date.today()

        if not self.bq_client:
            result.errors.append("No BQ client")
            return result

        dataset = self.config.dataset

        # MERGE from fb_ads_data (deduped) into fact_ads_optimization
        merge_sql = f"""
        MERGE `levelup-465304.{dataset}.fact_ads_optimization` AS T
        USING (
            SELECT
                ad_id,
                PARSE_DATE('%Y-%m-%d', date) AS report_date,
                MAX(ad_name) AS ad_name,
                MAX(adset_id) AS adset_id,
                MAX(adset_name) AS adset_name,
                MAX(campaign_id) AS campaign_id,
                MAX(campaign_name) AS campaign_name,
                MAX(account_id) AS account_id,
                'ACTIVE' AS campaign_status,
                '{self.project_id}' AS project_id,

                -- ═══ HOT METRICS (from N8N sync) ═══
                SUM(spend) AS spend,
                SUM(CAST(impressions AS INT64)) AS impressions,
                SUM(CAST(reach AS INT64)) AS reach,
                SUM(CAST(clicks AS INT64)) AS clicks,
                CAST(SUM(IFNULL(leads, 0)) AS INT64) AS leads,

                -- ═══ CALCULATED METRICS (computed, not from raw) ═══
                SAFE_DIVIDE(SUM(spend) * 1000, NULLIF(SUM(CAST(impressions AS INT64)), 0)) AS cpm,
                SAFE_DIVIDE(SUM(CAST(clicks AS INT64)), NULLIF(SUM(CAST(impressions AS INT64)), 0)) AS ctr,
                SAFE_DIVIDE(SUM(spend), NULLIF(SUM(CAST(clicks AS INT64)), 0)) AS cpc,
                SAFE_DIVIDE(SUM(CAST(impressions AS INT64)), NULLIF(SUM(CAST(reach AS INT64)), 0)) AS frequency,

                -- ═══ COST PER ACTIONS ═══
                SAFE_DIVIDE(
                    SUM(spend),
                    NULLIF(SUM(IFNULL(leads, 0)), 0)
                ) AS cost_per_lead,

                MAX(sync_time) AS sync_time_src

            FROM `levelup-465304.{dataset}.fb_ads_data`
            WHERE date = '{target_date.isoformat()}'
              AND ad_id IS NOT NULL
              AND spend > 0
            GROUP BY ad_id, date
        ) AS S
        ON T.ad_id = S.ad_id AND T.report_date = S.report_date
        WHEN MATCHED THEN UPDATE SET
            T.spend = S.spend,
            T.impressions = S.impressions,
            T.reach = S.reach,
            T.clicks = S.clicks,
            T.leads = S.leads,
            T.cpm = S.cpm,
            T.ctr = S.ctr,
            T.cpc = S.cpc,
            T.frequency = S.frequency,
            T.cost_per_lead = S.cost_per_lead,
            T.campaign_status = S.campaign_status,
            T.sync_time = CURRENT_TIMESTAMP(),
            T.sync_tier = 'HOT'
        WHEN NOT MATCHED THEN INSERT (
            ad_id, report_date, ad_name, adset_id, adset_name,
            campaign_id, campaign_name, account_id,
            campaign_status, project_id,
            spend, impressions, reach, clicks, leads,
            cpm, ctr, cpc, frequency,
            cost_per_lead, sync_time, sync_tier
        ) VALUES (
            S.ad_id, S.report_date, S.ad_name, S.adset_id, S.adset_name,
            S.campaign_id, S.campaign_name, S.account_id,
            S.campaign_status, S.project_id,
            S.spend, S.impressions, S.reach, S.clicks, S.leads,
            S.cpm, S.ctr, S.cpc, S.frequency,
            S.cost_per_lead, CURRENT_TIMESTAMP(), 'HOT'
        )
        """

        try:
            job = self.bq_client.query(merge_sql)
            job.result()
            result.rows_processed = job.num_dml_affected_rows or 0
            result.rows_inserted = result.rows_processed
            logger.info(
                f"[{self.project_id}] HOT sync: {result.rows_processed} rows "
                f"for {target_date}"
            )
        except Exception as e:
            result.errors.append(f"HOT sync failed: {e}")
            logger.error(f"[{self.project_id}] HOT sync error: {e}")

        result.duration_seconds = (
            datetime.now(timezone.utc) - start
        ).total_seconds()
        return result

    # ─── COLD Tier: Revenue Mapping (daily) ────────────────────────

    async def sync_cold(self, run_date: Optional[date] = None) -> SyncResult:
        """
        COLD tier: JOIN with sale_order for revenue + return rate.

        Updates confirmed_revenue, return_orders, confirmed_roas
        in fact_ads_optimization.
        """
        result = SyncResult(tier=SyncTier.COLD, project_id=self.project_id)
        start = datetime.now(timezone.utc)
        target_date = run_date or date.today()

        if not self.bq_client:
            result.errors.append("No BQ client")
            return result

        dataset = self.config.dataset

        # Check if sale_order table exists
        try:
            self.bq_client.get_table(f"levelup-465304.{dataset}.sale_order")
        except Exception:
            result.errors.append("sale_order table not found — skipping COLD sync")
            logger.warning(f"[{self.project_id}] sale_order not found, COLD sync skipped")
            return result

        # JOIN campaign → sale_order for revenue mapping
        # SCOPE: Ads Optimization uses ALL orders created as revenue
        #   (delivery/return tracking belongs to Operations module)
        # total_price is in minor currency units (e.g. bani for RON)
        currency_rate = getattr(self.config, 'currency_rate', 460)  # 100 bani/RON * 4.6 RON/USD
        update_sql = f"""
        UPDATE `levelup-465304.{dataset}.fact_ads_optimization` AS T
        SET
            T.real_orders = S.total_orders,
            T.real_revenue = S.total_revenue,
            -- For Ads Optimization: all orders = leads, all order revenue = revenue
            T.confirmed_orders = S.total_orders,
            T.confirmed_revenue = S.total_revenue,
            T.return_orders = 0,
            T.return_rate = 0,
            T.confirmed_roas = SAFE_DIVIDE(S.total_revenue, NULLIF(T.spend, 0)),
            T.cost_per_order = SAFE_DIVIDE(T.spend, NULLIF(S.total_orders, 0)),
            T.sync_time = CURRENT_TIMESTAMP()
        FROM (
            SELECT
                p_utm_campaign,
                SAFE.PARSE_DATE('%Y-%m-%d', SUBSTR(updated_at, 1, 10)) AS order_date,
                COUNT(*) AS total_orders,
                ROUND(SUM(CAST(total_price AS FLOAT64)) / {currency_rate}, 2) AS total_revenue
            FROM `levelup-465304.{dataset}.sale_order`
            WHERE SAFE.PARSE_DATE('%Y-%m-%d', SUBSTR(updated_at, 1, 10))
                  >= DATE_SUB(DATE('{target_date.isoformat()}'), INTERVAL 7 DAY)
              AND p_utm_campaign IS NOT NULL
              AND p_utm_campaign != ''
            GROUP BY p_utm_campaign, order_date
        ) AS S
        WHERE T.campaign_name = S.p_utm_campaign
          AND T.report_date = S.order_date
          AND T.report_date >= DATE_SUB(DATE('{target_date.isoformat()}'), INTERVAL 7 DAY)
        """

        try:
            job = self.bq_client.query(update_sql)
            job.result()
            result.rows_processed = job.num_dml_affected_rows or 0
            logger.info(
                f"[{self.project_id}] COLD sync: {result.rows_processed} rows "
                f"revenue-mapped"
            )
        except Exception as e:
            result.errors.append(f"COLD sync failed: {e}")
            logger.error(f"[{self.project_id}] COLD sync error: {e}")

        result.duration_seconds = (
            datetime.now(timezone.utc) - start
        ).total_seconds()
        return result

    # ─── WARM Tier: Meta API Enrichment (every 3-6 hours) ──────────

    async def sync_warm(self) -> SyncResult:
        """
        WARM tier: Enrich with video metrics from Meta API.

        Calls Meta Marketing API for:
        - video_30_sec_watched_actions → hold_rate
        - video_p25/p50/p75_watched_actions → hook_rate
        - actions (conversions breakdown)
        """
        result = SyncResult(tier=SyncTier.WARM, project_id=self.project_id)
        start = datetime.now(timezone.utc)

        if not self.access_token:
            result.errors.append("No Meta API access token")
            logger.warning(f"[{self.project_id}] No access token — WARM sync skipped")
            return result

        if not self.bq_client:
            result.errors.append("No BQ client")
            return result

        for account in self.accounts:
            try:
                enrichments = await self._fetch_video_metrics(account.id)
                if enrichments:
                    await self._apply_warm_enrichments(enrichments)
                    result.rows_processed += len(enrichments)
            except Exception as e:
                result.errors.append(f"{account.name}: {e}")
                logger.warning(f"[{self.project_id}] WARM {account.name}: {e}")

        result.duration_seconds = (
            datetime.now(timezone.utc) - start
        ).total_seconds()
        logger.info(
            f"[{self.project_id}] WARM sync: {result.rows_processed} ads enriched"
        )
        return result

    async def _fetch_video_metrics(self, account_id: str) -> List[Dict]:
        """Fetch video metrics from Meta Marketing API."""
        url = f"{self.META_API_BASE}/{account_id}/insights"
        params = {
            "access_token": self.access_token,
            "level": "ad",
            "fields": ",".join([
                "ad_id", "ad_name",
                "video_30_sec_watched_actions",
                "video_p25_watched_actions",
                "video_p50_watched_actions",
                "video_p75_watched_actions",
                "video_p100_watched_actions",
                "actions",
            ]),
            "date_preset": "today",
            "filtering": json.dumps([
                {"field": "ad.effective_status", "operator": "IN",
                 "value": ["ACTIVE"]},
            ]),
            "limit": 100,
        }

        try:
            resp = requests.get(url, params=params, timeout=30)
            resp.raise_for_status()
            data = resp.json().get("data", [])

            enrichments = []
            for row in data:
                ad_id = row.get("ad_id")
                if not ad_id:
                    continue

                # Calculate hook_rate from video p25 / impressions
                video_p25 = self._extract_action_value(
                    row.get("video_p25_watched_actions", [])
                )
                video_p100 = self._extract_action_value(
                    row.get("video_p100_watched_actions", [])
                )
                video_30s = self._extract_action_value(
                    row.get("video_30_sec_watched_actions", [])
                )

                enrichments.append({
                    "ad_id": ad_id,
                    "video_view_25pct": video_p25,
                    "video_view_50pct": self._extract_action_value(
                        row.get("video_p50_watched_actions", [])
                    ),
                    "video_view_75pct": self._extract_action_value(
                        row.get("video_p75_watched_actions", [])
                    ),
                    "video_view_100pct": video_p100,
                    "video_view_30sec": video_30s,
                })

            return enrichments
        except requests.RequestException as e:
            logger.warning(f"Meta API request failed: {e}")
            return []

    async def _apply_warm_enrichments(self, enrichments: List[Dict]) -> None:
        """Apply video metric enrichments to BQ."""
        dataset = self.config.dataset
        today = date.today().isoformat()

        for e in enrichments:
            # Map internal keys to BQ column names
            p25 = e.get('video_view_25pct') or 'NULL'
            p50 = e.get('video_view_50pct') or 'NULL'
            p75 = e.get('video_view_75pct') or 'NULL'
            p100 = e.get('video_view_100pct') or 'NULL'
            v30s = e.get('video_view_30sec') or 'NULL'
            sql = f"""
            UPDATE `levelup-465304.{dataset}.fact_ads_optimization`
            SET
                video_views_p25 = {p25},
                video_views_p50 = {p50},
                video_views_p75 = {p75},
                video_views_p100 = {p100},
                hook_rate = SAFE_DIVIDE(
                    {e.get('video_view_25pct') or 0},
                    NULLIF(impressions, 0)
                ),
                hold_rate = SAFE_DIVIDE(
                    {e.get('video_view_100pct') or 0},
                    NULLIF({e.get('video_view_25pct') or 0}, 0)
                ),
                sync_tier = 'WARM',
                sync_time = CURRENT_TIMESTAMP()
            WHERE ad_id = '{e["ad_id"]}'
              AND report_date = '{today}'
            """
            try:
                self.bq_client.query(sql).result()
            except Exception as ex:
                logger.debug(f"WARM update skip for {e['ad_id']}: {ex}")

    # ─── ONCE Tier: Creative Metadata ──────────────────────────────

    async def sync_creative_metadata(self) -> SyncResult:
        """
        ONCE tier: Fetch creative metadata for new ad_ids.

        Only runs for ad_ids that don't have creative_type set yet.
        """
        result = SyncResult(tier=SyncTier.ONCE, project_id=self.project_id)
        start = datetime.now(timezone.utc)

        if not self.access_token or not self.bq_client:
            result.errors.append("Missing BQ client or Meta token")
            return result

        dataset = self.config.dataset

        # Find ad_ids without creative metadata
        new_ads_sql = f"""
        SELECT DISTINCT ad_id
        FROM `levelup-465304.{dataset}.fact_ads_optimization`
        WHERE creative_type IS NULL
          AND report_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
        LIMIT 50
        """

        try:
            rows = list(self.bq_client.query(new_ads_sql).result())
            new_ad_ids = [r.ad_id for r in rows]
        except Exception as e:
            result.errors.append(f"Query failed: {e}")
            return result

        if not new_ad_ids:
            logger.info(f"[{self.project_id}] ONCE sync: no new ads to enrich")
            return result

        # Batch fetch creative info from Meta API
        for ad_id in new_ad_ids:
            try:
                creative_info = await self._fetch_creative_info(ad_id)
                if creative_info:
                    await self._update_creative_metadata(ad_id, creative_info)
                    result.rows_processed += 1
            except Exception as e:
                result.errors.append(f"Ad {ad_id}: {e}")

        result.duration_seconds = (
            datetime.now(timezone.utc) - start
        ).total_seconds()
        logger.info(
            f"[{self.project_id}] ONCE sync: {result.rows_processed} creatives enriched"
        )
        return result

    async def _fetch_creative_info(self, ad_id: str) -> Optional[Dict]:
        """Fetch creative type và metadata từ Meta API.

        Lấy thêm destination_url, creative_body, creative_title
        để CMO dùng cho content brief generation.
        """
        url = f"{self.META_API_BASE}/{ad_id}"
        params = {
            "access_token": self.access_token,
            "fields": (
                "creative{"
                "object_type,"
                "effective_object_story_id,"
                "thumbnail_url,"
                "video_id,"
                "body,"
                "title,"
                "object_story_spec{"
                "link_data{link,message,name,description},"
                "video_data{message,title,link_description,call_to_action{value{link}}}"
                "}"
                "}"
            ),
        }

        try:
            resp = requests.get(url, params=params, timeout=15)
            resp.raise_for_status()
            data = resp.json()
            creative = data.get("creative", {})

            object_type = creative.get("object_type", "UNKNOWN")
            creative_type = {
                "VIDEO": "VIDEO",
                "PHOTO": "IMAGE",
                "SHARE": "IMAGE",
                "CAROUSEL": "CAROUSEL",
            }.get(object_type, "OTHER")

            # Trích xuất destination_url từ nhiều nguồn
            destination_url = None
            story_spec = creative.get("object_story_spec", {})
            link_data = story_spec.get("link_data", {})
            video_data = story_spec.get("video_data", {})
            if link_data.get("link"):
                destination_url = link_data["link"]
            elif video_data.get("call_to_action", {}).get("value", {}).get("link"):
                destination_url = video_data["call_to_action"]["value"]["link"]

            # Trích xuất body và title từ nhiều nguồn
            creative_body = (
                creative.get("body")
                or link_data.get("message")
                or video_data.get("message")
            )
            creative_title = (
                creative.get("title")
                or link_data.get("name")
                or video_data.get("title")
            )

            return {
                "creative_type": creative_type,
                "creative_url": creative.get("thumbnail_url"),
                "video_id": creative.get("video_id"),
                "destination_url": destination_url,
                "creative_body": creative_body,
                "creative_title": creative_title,
            }
        except requests.RequestException as e:
            logger.debug(f"Creative fetch failed for {ad_id}: {e}")
            return None

    async def _update_creative_metadata(
        self, ad_id: str, info: Dict
    ) -> None:
        """Update creative metadata trong BQ."""
        dataset = self.config.dataset
        def _quote(v):
            if v is None:
                return "NULL"
            v_escaped = str(v).replace("'", "\\'")
            return f"'{v_escaped}'"

        sql = f"""
        UPDATE `levelup-465304.{dataset}.fact_ads_optimization`
        SET
            creative_type = '{info["creative_type"]}',
            creative_thumbnail_url = {_quote(info.get('creative_url'))},
            destination_url = {_quote(info.get('destination_url'))},
            creative_body = {_quote(info.get('creative_body'))},
            creative_title = {_quote(info.get('creative_title'))},
            sync_time = CURRENT_TIMESTAMP()
        WHERE ad_id = '{ad_id}'
          AND creative_type IS NULL
        """
        self.bq_client.query(sql).result()

    # ─── Slope Detection (Event Log) ───────────────────────────────

    async def log_metric_events(self, run_date: Optional[date] = None) -> int:
        """
        Record metric snapshots for slope detection.

        Inserts current metrics into ads_metric_event_log
        for intraday trend analysis.
        """
        if not self.bq_client:
            return 0

        target_date = run_date or date.today()
        dataset = self.config.dataset

        insert_sql = f"""
        INSERT INTO `levelup-465304.{dataset}.ads_metric_event_log`
            (campaign_id, metric_name, metric_value, snapshot_time,
             sync_batch_id, sync_tier, slope_direction,
             consecutive_slope_count, project_id)
        SELECT
            campaign_id,
            'spend' AS metric_name,
            SUM(spend) AS metric_value,
            CURRENT_TIMESTAMP() AS snapshot_time,
            FORMAT_TIMESTAMP('%Y%m%d_%H%M', CURRENT_TIMESTAMP()) AS sync_batch_id,
            'HOT' AS sync_tier,
            'FLAT' AS slope_direction,
            0 AS consecutive_slope_count,
            '{self.project_id}' AS project_id
        FROM `levelup-465304.{dataset}.fact_ads_optimization`
        WHERE report_date = '{target_date.isoformat()}'
          AND campaign_status = 'ACTIVE'
        GROUP BY campaign_id
        """

        try:
            job = self.bq_client.query(insert_sql)
            job.result()
            count = job.num_dml_affected_rows or 0
            logger.info(
                f"[{self.project_id}] Event log: {count} metric events recorded"
            )
            return count
        except Exception as e:
            logger.warning(f"[{self.project_id}] Event log error: {e}")
            return 0

    # ─── Full Sync Orchestrator ────────────────────────────────────

    async def run_full_sync(
        self,
        run_date: Optional[date] = None,
        tiers: Optional[List[SyncTier]] = None,
    ) -> Dict[str, SyncResult]:
        """
        Run sync for specified tiers (or all).

        Default: HOT only (called every 30 min).
        Daily run: HOT + COLD + WARM + ONCE.
        """
        if tiers is None:
            tiers = [SyncTier.HOT]

        results = {}

        for tier in tiers:
            if tier == SyncTier.HOT:
                results["hot"] = await self.sync_hot(run_date)
            elif tier == SyncTier.COLD:
                results["cold"] = await self.sync_cold(run_date)
            elif tier == SyncTier.WARM:
                results["warm"] = await self.sync_warm()
            elif tier == SyncTier.ONCE:
                results["once"] = await self.sync_creative_metadata()

        # Always log events for slope detection
        await self.log_metric_events(run_date)

        return results

    # ─── Helpers ───────────────────────────────────────────────────

    @staticmethod
    def _extract_action_value(actions: List[Dict]) -> int:
        """Extract numeric value from Meta API action array."""
        if not actions:
            return 0
        for action in actions:
            if action.get("action_type") == "video_view":
                return int(action.get("value", 0))
        # Fallback: first action
        return int(actions[0].get("value", 0)) if actions else 0

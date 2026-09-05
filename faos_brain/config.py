"""
FAOS — Data Layer Configuration (Pydantic BaseSettings).

Loads environment variables from .env with type validation.
AI/agent-specific config has been moved to faos-agents project.

Usage:
    from faos_brain.config import settings
    print(settings.gcp_project_id)
"""

from __future__ import annotations

from pathlib import Path
from typing import List

from pydantic_settings import BaseSettings
from pydantic import Field


class FAOSSettings(BaseSettings):
    """
    Central configuration for FAOS v6.

    All values are loaded from .env file with type validation.
    Grouped by service/feature for clarity.
    """

    # ─── General ───
    env: str = Field(default="dev", description="Environment: dev | staging | prod")
    log_level: str = Field(default="INFO", description="Logging level")
    dry_run: bool = Field(default=True, description="True = no real API calls")
    project_id: str = Field(default="stramark", description="Active project: stramark | auus1 | zen8")
    project_currency: str = Field(default="RON", description="Currency code")
    currency_divisor: int = Field(default=100, description="100 for bani, 1 for full units")

    # ─── Google Cloud / BigQuery ───
    gcp_project_id: str = Field(default="levelup-465304", description="GCP project ID")
    bq_dataset: str = Field(default="STRAMARK_Dataset", description="BigQuery dataset")
    bq_location: str = Field(default="US", description="BigQuery dataset location")
    google_application_credentials: str = Field(default="bigquery_key.json", description="Path to GCP service account key")

    # ─── Meta / Facebook ───
    meta_app_id: str = Field(default="", description="Meta App ID")
    meta_app_secret: str = Field(default="", description="Meta App Secret")
    meta_access_token: str = Field(default="", description="Meta System User Access Token")
    meta_business_id: str = Field(default="", description="Meta Business ID")
    meta_pixel_id: str = Field(default="", description="Meta Pixel ID for CAPI")
    meta_ad_account_ids: str = Field(default="", description="Comma-separated ad account IDs")

    # ─── Scheduling ───
    capi_push_cron: str = Field(default="0 21 * * *", description="CAPI push (21:00)")

    # ─── Stock Management ───
    stock_resume_threshold: int = Field(default=20, description="Min stock to resume campaign")
    stock_check_interval_hours: int = Field(default=2, description="Stock check frequency")

    # NOTE: LLM/AI, FalkorDB, Redis, Telegram, Discord, and agent scheduling fields
    # have been moved to the faos-agents project config.

    # ─── API Security ───
    faos_api_key: str = Field(default="", description="API key for dashboard → backend auth (empty = no auth in dev)")
    cors_allowed_origins: str = Field(default="http://localhost:3000,http://localhost:3001", description="Comma-separated CORS origins")

    # ─── BOTCAKE AI — Spiritual Shop (Tượng Phật) ───
    botcake_poscake_api_key: str = Field(default="", description="Poscake API key for BOTCAKE spiritual products shop")
    botcake_poscake_shop_id: str = Field(default="", description="Poscake Shop ID for BOTCAKE spiritual products shop")

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "case_sensitive": False,
        "extra": "ignore",  # Allow extra vars from .env (POSCAKE, N8N, AUUS1, etc.)
    }

    @property
    def project_root(self) -> Path:
        return Path(__file__).parent.parent

    @property
    def cors_origins_list(self) -> List[str]:
        """Parse comma-separated CORS origins."""
        if not self.cors_allowed_origins:
            return ["*"]
        return [o.strip() for o in self.cors_allowed_origins.split(",") if o.strip()]

    @property
    def ad_account_list(self) -> List[str]:
        """Parse comma-separated ad account IDs."""
        if not self.meta_ad_account_ids:
            return []
        return [a.strip() for a in self.meta_ad_account_ids.split(",") if a.strip()]


# ─── Singleton instance ───
# Usage: from faos_brain.config import settings
settings = FAOSSettings()

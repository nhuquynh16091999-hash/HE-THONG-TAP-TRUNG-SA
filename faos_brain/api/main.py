"""
FAOS API Gateway — Data layer only.

Serves:
  /api/dashboard/*    — Meta Ads + BigQuery performance data
  /api/ad-accounts/*  — TKQC account management

AI agent APIs have been moved to faos-agents project.

Usage:
    uvicorn faos_brain.api.main:app --host 0.0.0.0 --port 8000 --reload
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator, Dict, Optional

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from google.cloud import bigquery

from faos_brain.config import settings

log = logging.getLogger("faos.api")


# ═══════════════════════════════════════════
# Shared Dependencies
# ═══════════════════════════════════════════
_bq_client: Optional[bigquery.Client] = None


def get_bq_client() -> bigquery.Client:
    """DI: Shared BigQuery client."""
    global _bq_client
    if _bq_client is None:
        _bq_client = bigquery.Client(project=settings.gcp_project_id)
    return _bq_client


async def verify_api_key(x_api_key: str = Header(default="")) -> str:
    """DI: API key auth. Skip if FAOS_API_KEY not configured (dev mode)."""
    if not settings.faos_api_key:
        return "dev-mode"
    if x_api_key != settings.faos_api_key:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")
    return x_api_key


# ═══════════════════════════════════════════
# Lifespan — start background services
# ═══════════════════════════════════════════
@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    log.info("FAOS API starting — data layer + marketer features")

    # Auto-start background services
    services = [
        ("ROI Watcher", "faos_brain.services.roi_watcher", "start_watcher", {"project_id": "AUUS1"}),
        ("Creative Fatigue", "faos_brain.services.creative_fatigue", "start_fatigue_watcher", {}),
        ("Competitor Watcher", "faos_brain.services.competitor_watcher", "start_competitor_watcher", {}),
        ("Auto-scale Engine", "faos_brain.services.autoscale_engine", "start_autoscale", {}),
    ]
    for name, module, func, kwargs in services:
        try:
            mod = __import__(module, fromlist=[func])
            getattr(mod, func)(**kwargs)
            log.info(f"{name} started")
        except Exception as e:
            log.warning(f"{name} failed to start: {e}")

    yield

    # Cleanup
    for name, module, _, _ in services:
        try:
            mod = __import__(module, fromlist=["stop_watcher", "stop_fatigue_watcher", "stop_competitor_watcher", "stop_autoscale"])
            stop_fn = getattr(mod, f"stop_{module.split('.')[-1].replace('_engine','').replace('_watcher','')}", None)
            if not stop_fn:
                for attr in dir(mod):
                    if attr.startswith("stop"):
                        stop_fn = getattr(mod, attr)
                        break
            if stop_fn:
                stop_fn()
        except Exception:
            pass
    log.info("FAOS API shut down")


# ═══════════════════════════════════════════
# FastAPI App
# ═══════════════════════════════════════════
app = FastAPI(
    title="FAOS API",
    version="6.2.0",
    description="Fashion Ad Operations System — Data Layer + Marketer Features",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health_check() -> Dict[str, str]:
    return {"status": "ok", "service": "faos-api", "version": "6.2.0"}


# ═══════════════════════════════════════════
# Routers
# ═══════════════════════════════════════════
from faos_brain.api.dashboard_api import router as dashboard_router
from faos_brain.api.ad_accounts_api import router as ad_accounts_router
from faos_brain.api.inventory_api import router as inventory_router       # BOTCAKE webhook
from faos_brain.api.ads_spy_api import router as ads_spy_router           # Ads Spy + Clone Brief
from faos_brain.api.alert_api import router as alert_router               # ROI Real-time Alerts
from faos_brain.api.briefing_api import router as briefing_router         # Morning Briefing
from faos_brain.api.product_test_api import router as product_test_router # Product Lab
from faos_brain.api.creative_api import router as creative_router         # Creative Fatigue
from faos_brain.api.budget_api import router as budget_router             # Budget Optimizer
from faos_brain.api.competitor_api import router as competitor_router     # Competitor Alert
from faos_brain.api.scorecard_api import router as scorecard_router       # Marketer Scorecard
from faos_brain.api.autoscale_api import router as autoscale_router       # Auto-scale Rules
from faos_brain.api.live_ads_api import router as live_ads_router         # Live Ads Search

app.include_router(dashboard_router, dependencies=[Depends(verify_api_key)])
app.include_router(ad_accounts_router, dependencies=[Depends(verify_api_key)])
app.include_router(inventory_router)       # BOTCAKE AI
app.include_router(ads_spy_router)         # Spy Ads
app.include_router(alert_router)           # ROI Alerts
app.include_router(briefing_router)        # Morning Briefing
app.include_router(product_test_router)    # Product Lab
app.include_router(creative_router)        # Creative Fatigue
app.include_router(budget_router)          # Budget Optimizer
app.include_router(competitor_router)      # Competitor Alert
app.include_router(scorecard_router)       # Scorecard
app.include_router(autoscale_router)       # Auto-scale
app.include_router(live_ads_router)        # Live Ads Search


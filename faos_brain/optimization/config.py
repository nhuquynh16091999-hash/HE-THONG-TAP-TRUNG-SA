"""
FAOS v6 — Optimization Config.

Per-project thresholds and operational settings.
STRAMARK is the template — copy + adjust for other projects.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List


class ExecutionMode(str, Enum):
    """Agent execution mode — controls what actions are allowed."""
    RECOMMEND_ONLY = "recommend_only"   # Weeks 1-4: Telegram recommendations only
    SUPERVISED = "supervised"           # After 4 weeks: auto-execute safe actions
    AUTONOMOUS = "autonomous"           # Future: full auto (requires explicit unlock)


class SyncTier(str, Enum):
    """Smart Sync frequency tiers."""
    HOT = "hot"       # Every 30 min — Spend, Impressions, Clicks, CTR, CPM
    WARM = "warm"     # Every 3-6 hours — Leads, Messages, ATC, Video metrics
    COLD = "cold"     # Daily — Revenue mapping, Return rate, Confirmed ROAS
    ONCE = "once"     # One-time per new ad_id — Creative metadata


@dataclass
class OptimizationConfig:
    """Per-project optimization configuration."""

    # ─── Project Identity ───
    project_id: str
    dataset: str
    currency: str = "RON"
    markets: List[str] = field(default_factory=lambda: ["Romania"])

    # ─── Execution Mode ───
    execution_mode: ExecutionMode = ExecutionMode.RECOMMEND_ONLY

    # ─── ROAS Thresholds ───
    roas_target: float = 2.5       # healthy
    roas_danger: float = 1.3       # kill candidates
    roas_excellent: float = 3.0    # scale candidates
    roas_warning: float = 2.0      # needs attention

    # ─── Early Signal Thresholds ───
    cpl_max_multiplier: float = 2.0     # CPL > CPL_MA7 × 2 → PAUSE
    cpmess_max_multiplier: float = 2.0  # CPMess > CPMess_MA7 × 2 → warning
    hook_rate_min: float = 0.15         # < 15% → WEAK_HOOK signal
    hook_rate_catastrophic: float = 0.05  # < 5% → Kill exception for LEARNING
    ctr_catastrophic: float = 0.002     # < 0.2% → Kill exception for LEARNING
    frequency_saturated: float = 3.0    # > 3.0 → AUDIENCE_SATURATED

    # ─── Campaign Lifecycle ───
    campaign_learning_days: int = 7     # campaigns < 7 days = LEARNING mode
    scale_stable_days: int = 3          # must be stable 3+ days before Scale
    max_budget_change_pct: float = 0.20 # max 20% budget change per action

    # ─── Funnel Benchmarks ───
    lead_to_order_min: float = 0.20     # < 20% → LOW_FUNNEL_CONV
    return_rate_kill: float = 0.40      # > 40% → Kill despite good CPL
    phantom_revenue_gap: float = 1.5    # provisional > confirmed × 1.5 → warning

    # ─── Slope Detection ───
    slope_persist_cycles: int = 2       # must persist 2+ sync cycles before warning
    slope_is_warning_only: bool = True  # NEVER sole Kill trigger

    # ─── Smart Sync Intervals (minutes) ───
    sync_hot_interval: int = 30         # hot metrics
    sync_warm_interval: int = 180       # warm metrics (3 hours)
    sync_cold_interval: int = 1440      # cold metrics (daily)

    # ─── Pattern Learning ───
    pattern_min_occurrences: int = 3    # pattern validated after 3+ occurrences
    pattern_learning_daily: bool = True # extract patterns daily, not per-sync

    # ─── Meta API ───
    meta_batch_size: int = 50           # batch request size
    meta_rate_limit_buffer: float = 0.8 # use max 80% of rate limit


# ═══════════════════════════════════════════════════════════════════
# Project Configurations
# ═══════════════════════════════════════════════════════════════════

PROJECT_CONFIGS: Dict[str, OptimizationConfig] = {
    "stramark": OptimizationConfig(
        project_id="stramark",
        dataset="STRAMARK_Dataset",
        currency="RON",
        markets=["Romania", "Bulgaria"],
        execution_mode=ExecutionMode.RECOMMEND_ONLY,
        roas_target=2.5,
        roas_danger=1.3,
        roas_excellent=3.0,
    ),
    "auus1": OptimizationConfig(
        project_id="auus1",
        dataset="AUUS1_Dataset",
        currency="USD",
        markets=["US", "AU"],
        execution_mode=ExecutionMode.RECOMMEND_ONLY,
        roas_target=2.5,
        roas_danger=1.3,
        roas_excellent=3.0,
    ),
    "t1": OptimizationConfig(
        project_id="t1",
        dataset="T1_Dataset",
        currency="EUR",
        markets=["SK"],
        execution_mode=ExecutionMode.RECOMMEND_ONLY,
        roas_target=2.5,
        roas_danger=1.3,
        roas_excellent=3.0,
    ),
    "zen8": OptimizationConfig(
        project_id="zen8",
        dataset="ZEN8_Dataset",
        currency="USD",
        markets=["AE", "SA", "KW", "BH", "OM", "QA"],
        execution_mode=ExecutionMode.RECOMMEND_ONLY,
        roas_target=2.0,
        roas_danger=1.0,
        roas_excellent=2.5,
        frequency_saturated=2.5,  # GCC market saturates faster
    ),
    "trendify": OptimizationConfig(
        project_id="trendify",
        dataset="TRENDIFY_Dataset",
        currency="USD",
        markets=["RO", "US", "HR", "IT", "BG"],
        execution_mode=ExecutionMode.RECOMMEND_ONLY,
        roas_target=2.5,
        roas_danger=1.3,
        roas_excellent=3.0,
    ),
    "talpha": OptimizationConfig(
        project_id="talpha",
        dataset="Talpha_Dataset",
        currency="AED",
        markets=["SA", "AE", "KW", "OM", "QA", "BH"],
        execution_mode=ExecutionMode.RECOMMEND_ONLY,
        roas_target=2.0,
        roas_danger=1.0,
        roas_excellent=2.5,
        frequency_saturated=2.5,  # GCC market saturates faster
    ),
    "hnle": OptimizationConfig(
        project_id="hnle",
        dataset="HNLE_Dataset",
        currency="USD",
        markets=["AE", "SA", "KW", "AU"],
        execution_mode=ExecutionMode.RECOMMEND_ONLY,
        roas_target=2.0,
        roas_danger=1.0,
        roas_excellent=2.5,
    ),
}


def get_project_config(project_id: str) -> OptimizationConfig:
    """Get optimization config for a project. Raises KeyError if not found."""
    project_key = project_id.lower()
    if project_key not in PROJECT_CONFIGS:
        raise KeyError(
            f"No optimization config for project '{project_id}'. "
            f"Available: {list(PROJECT_CONFIGS.keys())}"
        )
    return PROJECT_CONFIGS[project_key]

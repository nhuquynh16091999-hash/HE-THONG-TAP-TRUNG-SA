"""
FAOS v6 — Ads Optimization Intelligence Module.

Separate, self-contained module for deep FB Ads diagnostic analysis.
Does NOT modify existing faos_brain modules (analyst, marketing_director).

Components:
    - config:          Per-project thresholds and operational settings
    - sync:            Smart Sync engine (Meta API → BQ fact_ads_optimization)
    - diagnostic:      Campaign Win/Fail Scorecard with root-cause attribution
    - funnel:          Full funnel analysis with bottleneck detection
    - pattern_engine:  Pattern learning and knowledge graph storage
    - reporter:        Telegram/Discord report formatter
"""

from faos_brain.optimization.config import OptimizationConfig, get_project_config
from faos_brain.optimization.diagnostic import CampaignDiagnostic, DiagnosticReport
from faos_brain.optimization.funnel import FunnelAnalyzer, FunnelReport
from faos_brain.optimization.reporter import OptimizationReporter

__all__ = [
    "OptimizationConfig",
    "get_project_config",
    "CampaignDiagnostic",
    "DiagnosticReport",
    "FunnelAnalyzer",
    "FunnelReport",
    "OptimizationReporter",
]

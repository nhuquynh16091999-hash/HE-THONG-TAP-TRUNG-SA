"""
FAOS v6 — Optimization Report Formatter.

Formats DiagnosticReport into Telegram-ready message.
Outputs PHẦN 4.5: CAMPAIGN DIAGNOSTIC section for daily report.
"""

import logging
from typing import Optional

from faos_brain.optimization.diagnostic import (
    CampaignScorecard,
    DiagnosticReport,
    FunnelScorecard,
)
from faos_brain.optimization.funnel import FunnelReport

logger = logging.getLogger(__name__)

# Status emoji mapping
STATUS_EMOJI = {
    "WIN": "✅",
    "FAIL": "❌",
    "OKAY": "📊",
    "LEARNING": "🔄",
}

# Signal emoji mapping
SIGNAL_EMOJI = {
    "WEAK_HOOK": "🎬",
    "LOW_CTR": "📉",
    "AUDIENCE_SATURATED": "👥",
    "CPM_SPIKE": "💰",
    "LOW_FUNNEL_CONV": "🔻",
    "PHANTOM_REVENUE": "👻",
    "LOW_EFFICIENCY": "📊",
    "HEALTHY": "💚",
}

# Action labels
ACTION_LABELS = {
    "RECOMMEND_SCALE": "📈 Scale",
    "RECOMMEND_KILL": "💀 Kill",
    "RECOMMEND_REVIEW_RETURNS": "📦 Review Returns",
    "RECOMMEND_REFRESH_CREATIVE": "🎨 Refresh Creative",
    "MONITOR": "👁 Monitor",
    "OBSERVE": "🔍 Observe",
    "KILL_EXCEPTION": "🚨 Kill Exception",
}

# Bottleneck explanations
BOTTLENECK_EXPLAIN = {
    "IMPRESSION_TO_CLICK": "Creative không hấp dẫn",
    "CLICK_TO_LEAD": "Landing page hoặc targeting có vấn đề",
    "LEAD_TO_ORDER": "Giá/offer/closing kém",
    "ORDER_TO_DELIVER": "Logistics hoặc COD rejection",
    "HIGH_RETURNS": "Quality/expectation mismatch",
    "NO_BOTTLENECK": "—",
}


class OptimizationReporter:
    """Formats optimization reports for Telegram/Discord."""

    def format_diagnostic_section(
        self,
        diagnostic: DiagnosticReport,
        funnel: Optional[FunnelReport] = None,
    ) -> str:
        """
        Format PHẦN 4.5: CAMPAIGN DIAGNOSTIC for daily report.
        Returns Telegram-ready string.
        """
        if not diagnostic.has_data:
            return "━━━ PHẦN 4.5: CAMPAIGN DIAGNOSTIC ━━━\n📊 Không có dữ liệu campaign.\n"

        lines = []
        lines.append("━━━ PHẦN 4.5: CAMPAIGN DIAGNOSTIC ━━━")
        lines.append(f"📊 Chế độ: {diagnostic.execution_mode.upper()}")
        lines.append(
            f"📈 Tổng: {diagnostic.total_campaigns} campaigns | "
            f"${diagnostic.total_spend:,.0f} spend\n"
        )

        # ── Top Wins ──
        if diagnostic.top_wins:
            lines.append("🏆 TOP WIN:")
            for sc in diagnostic.top_wins:
                lines.append(self._format_scorecard_line(sc))
            lines.append("")

        # ── Top Fails ──
        if diagnostic.top_fails:
            lines.append("💀 TOP FAIL:")
            for sc in diagnostic.top_fails:
                lines.append(self._format_scorecard_line(sc))
            lines.append("")

        # ── Learning ──
        if diagnostic.learning_campaigns:
            lines.append(
                f"🔄 LEARNING: {len(diagnostic.learning_campaigns)} campaigns "
                f"(< 7 ngày — chỉ quan sát)"
            )
            for sc in diagnostic.learning_campaigns[:3]:
                hook_str = f"Hook {sc.hook_rate:.0%}" if sc.hook_rate else "—"
                lines.append(
                    f"   {sc.campaign_name}: "
                    f"day {sc.campaign_age_days} | CTR {sc.ctr:.2%} | {hook_str}"
                )
            lines.append("")

        # ── Funnel Bottlenecks ──
        if funnel and funnel.bottleneck_campaigns:
            lines.append("🔻 FUNNEL BOTTLENECKS:")
            for fn in funnel.bottleneck_campaigns[:5]:
                explain = BOTTLENECK_EXPLAIN.get(fn.bottleneck_stage, fn.bottleneck_stage)
                lines.append(
                    f"   {fn.campaign_name}: "
                    f"bottleneck = {fn.bottleneck_stage} ({explain})"
                )
            lines.append("")

        # ── High Returns ──
        if funnel and funnel.high_return_campaigns:
            lines.append("📦 HIGH RETURNS (Kill dù CPL tốt):")
            for fn in funnel.high_return_campaigns:
                lines.append(
                    f"   {fn.campaign_name}: "
                    f"return_rate {fn.return_rate:.0%} → RECOMMEND KILL"
                )
            lines.append("")

        # ── Anomalies ──
        if diagnostic.anomalies:
            lines.append("⚠️ ANOMALIES:")
            for anomaly in diagnostic.anomalies:
                lines.append(f"   {anomaly}")
            lines.append("")

        # ── Narrative (if generated) ──
        if diagnostic.narrative:
            lines.append("🔍 WHY ANALYSIS:")
            lines.append(diagnostic.narrative)
            lines.append("")

        return "\n".join(lines)

    def _format_scorecard_line(self, sc: CampaignScorecard) -> str:
        """Format a single campaign scorecard as a compact line."""
        emoji = STATUS_EMOJI.get(sc.status, "❓")
        signal_emoji = SIGNAL_EMOJI.get(sc.primary_signal, "")
        action = ACTION_LABELS.get(sc.recommended_action, sc.recommended_action)

        parts = [
            f"   {emoji} {sc.campaign_name}",
            f"ROAS {sc.confirmed_roas_ma7:.1f}",
            f"CTR {sc.ctr:.2%}",
        ]

        if sc.hook_rate is not None:
            parts.append(f"Hook {sc.hook_rate:.0%}")

        parts.append(f"Freq {sc.frequency:.1f}")
        parts.append(f"{signal_emoji}{sc.primary_signal}")
        parts.append(f"→ {action}")

        # Add momentum arrow
        momentum_arrows = {"UPTREND": "↑", "DOWNTREND": "↓", "STABLE": "→"}
        arrow = momentum_arrows.get(sc.roas_momentum, "")
        parts[1] = f"ROAS {sc.confirmed_roas_ma7:.1f}{arrow}"

        return " | ".join(parts)

    def format_summary_stats(self, diagnostic: DiagnosticReport) -> str:
        """One-line summary for notification header."""
        wins = len(diagnostic.top_wins)
        fails = len(diagnostic.top_fails)
        learning = len(diagnostic.learning_campaigns)
        anomalies = len(diagnostic.anomalies)
        return (
            f"📊 Diagnostic: {wins} WIN | {fails} FAIL | "
            f"{learning} LEARNING | {anomalies} anomalies"
        )

"""Tests for FAOS Skills — Pure Python, no external services needed."""
import pytest
import sys
import os

# Ensure project root is on path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


# ═══════════════════════════════════════════════════════════
# MarketingSkill Tests
# ═══════════════════════════════════════════════════════════

class TestMarketingSkill:
    """Tests for MarketingSkill — ROAS, CPA, fatigue, scaling."""

    def setup_method(self):
        from faos_agents.skills.marketing import MarketingSkill
        self.skill = MarketingSkill()

    def test_campaign_health_ok(self):
        """Good campaign should return OK status."""
        result = self.skill.analyze_campaign_health(
            spend=1000, revenue=3000, orders=50,
            impressions=100000, clicks=3000, cpa_target=25,
        )
        assert result["status"] == "OK"
        assert result["roas"] == 3.0
        assert result["cpa"] == 20.0
        assert result["ctr"] == 3.0

    def test_campaign_health_warning(self):
        """Campaign with CPA above target should warn."""
        result = self.skill.analyze_campaign_health(
            spend=1000, revenue=2000, orders=30,
            impressions=100000, clicks=2000, cpa_target=25,
        )
        assert result["status"] == "WARNING"
        assert result["cpa"] > 25

    def test_campaign_health_critical(self):
        """Campaign with ROAS < 1 should be CRITICAL."""
        result = self.skill.analyze_campaign_health(
            spend=1000, revenue=500, orders=10,
            impressions=50000, clicks=500, cpa_target=20,
        )
        assert result["status"] == "CRITICAL"
        assert result["roas"] < 1.0

    def test_campaign_health_zero_spend(self):
        """Zero spend should not crash (safe divide)."""
        result = self.skill.analyze_campaign_health(
            spend=0, revenue=0, orders=0,
            impressions=0, clicks=0, cpa_target=20,
        )
        assert result["roas"] == 0
        assert result["cpa"] == 0

    def test_ad_fatigue_detected(self):
        """Declining CTR should detect fatigue."""
        metrics = [
            {"date": "03/01", "ctr": 1.5},
            {"date": "02/28", "ctr": 1.8},
            {"date": "02/27", "ctr": 2.0},
        ]
        result = self.skill.detect_ad_fatigue(metrics)
        assert result["is_fatigued"] is True
        assert result["ctr_decline_pct"] < 0

    def test_ad_fatigue_not_enough_data(self):
        """Less than 3 days should return not enough data."""
        result = self.skill.detect_ad_fatigue([{"date": "03/01", "ctr": 2.0}])
        assert result["is_fatigued"] is False
        assert "đủ data" in result["recommendation"]

    def test_scaling_scale(self):
        """Good metrics should recommend SCALE."""
        result = self.skill.calculate_scaling_recommendation(
            current_budget=500, roas=3.0, cpa=12, cpa_target=20, days_profitable=5,
        )
        assert result["action"] == "SCALE"
        assert result["new_budget"] == 600  # +20%
        assert result["change_pct"] == 20.0

    def test_scaling_pause(self):
        """Bad ROAS + no profit days should PAUSE."""
        result = self.skill.calculate_scaling_recommendation(
            current_budget=500, roas=0.5, cpa=50, cpa_target=20, days_profitable=0,
        )
        assert result["action"] == "PAUSE"

    def test_scaling_reduce(self):
        """CPA > 1.5x target should REDUCE."""
        result = self.skill.calculate_scaling_recommendation(
            current_budget=500, roas=1.5, cpa=35, cpa_target=20,
        )
        assert result["action"] == "REDUCE"
        assert result["new_budget"] < 500

    def test_ranking_campaigns(self):
        """Should rank campaigns by efficiency score."""
        campaigns = [
            {"name": "A", "spend": 100, "revenue": 300, "orders": 10, "success_orders": 8},
            {"name": "B", "spend": 200, "revenue": 400, "orders": 20, "success_orders": 18},
            {"name": "C", "spend": 50, "revenue": 250, "orders": 5, "success_orders": 5},
        ]
        ranked = self.skill.rank_campaigns_by_efficiency(campaigns)
        assert len(ranked) == 3
        assert all("efficiency_score" in c for c in ranked)
        # Should be sorted descending
        scores = [c["efficiency_score"] for c in ranked]
        assert scores == sorted(scores, reverse=True)


# ═══════════════════════════════════════════════════════════
# FinancialSkill Tests
# ═══════════════════════════════════════════════════════════

class TestFinancialSkill:
    """Tests for FinancialSkill — P&L, comparison, break-even."""

    def setup_method(self):
        from faos_agents.skills.financial import FinancialSkill
        self.skill = FinancialSkill()

    def test_pnl_profitable(self):
        """Profitable scenario should show positive margin."""
        result = self.skill.calculate_daily_pnl(
            gross_revenue=50000, ad_spend=15000,
            shipping_cost=5000, return_cost=2000, cogs=12000,
        )
        assert result["operating_profit"] > 0
        assert result["margin_pct"] > 0
        assert "✅" in result["assessment"]

    def test_pnl_losing(self):
        """When expenses > revenue, margin should be negative."""
        result = self.skill.calculate_daily_pnl(
            gross_revenue=10000, ad_spend=15000,
            shipping_cost=5000, return_cost=2000, cogs=5000,
        )
        assert result["operating_profit"] < 0
        assert "🔴" in result["assessment"]

    def test_pnl_zero_revenue(self):
        """Zero revenue should not crash."""
        result = self.skill.calculate_daily_pnl(
            gross_revenue=0, ad_spend=0, shipping_cost=0, return_cost=0,
        )
        assert result["margin_pct"] == 0

    def test_compare_periods_growth(self):
        """Revenue up + profit up should be healthy."""
        result = self.skill.compare_periods(
            current={"revenue": 60000, "profit": 15000, "orders": 200, "ad_spend": 20000},
            previous={"revenue": 50000, "profit": 12000, "orders": 180, "ad_spend": 18000},
        )
        assert result["revenue_change_pct"] > 0
        assert result["profit_change_pct"] > 0
        assert "healthy" in result["interpretation"].lower() or "tăng" in result["interpretation"].lower()

    def test_compare_periods_zero_previous(self):
        """Zero previous should handle safely."""
        result = self.skill.compare_periods(
            current={"revenue": 50000, "profit": 10000, "orders": 100, "ad_spend": 15000},
            previous={"revenue": 0, "profit": 0, "orders": 0, "ad_spend": 0},
        )
        # Should not crash

    def test_break_even_roas(self):
        """40% margin should give BEP ROAS 2.5."""
        result = self.skill.calculate_break_even_roas(40.0)
        assert result["break_even_roas"] == 2.5

    def test_break_even_zero_margin(self):
        """Zero margin should not crash."""
        result = self.skill.calculate_break_even_roas(0)
        assert result["break_even_roas"] is None

    def test_cash_position(self):
        """Should calculate collection rate."""
        result = self.skill.estimate_cash_position(
            cod_collected=50000, carrier_received=45000, outstanding_gap=5000,
        )
        assert result["collection_rate_pct"] == 90.0
        assert result["outstanding"] == 5000


# ═══════════════════════════════════════════════════════════
# DataAnalystSkill Tests
# ═══════════════════════════════════════════════════════════

class TestDataAnalystSkill:
    """Tests for DataAnalystSkill — anomalies, trends, sync health."""

    def setup_method(self):
        from faos_agents.skills.data_analyst import DataAnalystSkill
        self.skill = DataAnalystSkill()

    def test_detect_anomaly_low(self):
        """Single low outlier should be detected."""
        values = [100, 98, 102, 99, 101, 97, 103, 100, 10, 98]
        labels = ["d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8", "d9", "d10"]
        result = self.skill.detect_anomalies(values, labels)
        assert result["has_anomalies"] is True
        assert any(a["label"] == "d9" for a in result["anomalies"])
        assert any(a["type"] == "LOW" for a in result["anomalies"])

    def test_no_anomaly(self):
        """Normal values should not flag anomalies."""
        values = [100, 102, 98, 101, 99]
        labels = ["Mon", "Tue", "Wed", "Thu", "Fri"]
        result = self.skill.detect_anomalies(values, labels)
        assert result["has_anomalies"] is False

    def test_not_enough_data_anomaly(self):
        """Less than 3 data points should return no anomalies."""
        result = self.skill.detect_anomalies([100, 200], ["A", "B"])
        assert result["has_anomalies"] is False

    def test_trend_declining(self):
        """Consistently declining values should show declining trend."""
        data = [{"date": f"day{i}", "orders": 100 - i * 5} for i in range(7)]
        result = self.skill.calculate_trends(data, "orders")
        assert result["trend"] == "declining"
        assert result["slope"] < 0

    def test_trend_rising(self):
        """Consistently rising values should show rising trend."""
        data = [{"date": f"day{i}", "orders": 50 + i * 10} for i in range(7)]
        result = self.skill.calculate_trends(data, "orders")
        assert result["trend"] == "rising"
        assert result["slope"] > 0

    def test_trend_insufficient_data(self):
        """Less than 5 days should return insufficient data."""
        data = [{"date": "d1", "orders": 100}, {"date": "d2", "orders": 110}]
        result = self.skill.calculate_trends(data, "orders")
        assert result["trend"] == "insufficient_data"

    def test_sync_health_alert(self):
        """Zero orders with normal average should ALERT."""
        result = self.skill.check_sync_health(
            orders_today=0, orders_7d_avg=100, ads_data_today=50,
        )
        assert result["status"] == "ALERT"

    def test_sync_health_ok(self):
        """Normal values should be OK."""
        result = self.skill.check_sync_health(
            orders_today=90, orders_7d_avg=100, ads_data_today=50,
        )
        assert result["status"] == "OK"

    def test_compare_projects(self):
        """Should return formatted comparison string."""
        metrics = {
            "STRAMARK": {"revenue": 50000, "roas": 2.5, "orders": 150},
            "AUUS1": {"revenue": 30000, "roas": 1.8, "orders": 80},
        }
        result = self.skill.compare_projects(metrics)
        assert "STRAMARK" in result
        assert "AUUS1" in result


# ═══════════════════════════════════════════════════════════
# TrendDetectorSkill Tests
# ═══════════════════════════════════════════════════════════

class TestTrendDetectorSkill:
    """Tests for TrendDetectorSkill — product scoring, saturation."""

    def setup_method(self):
        from faos_agents.skills.trend_detector import TrendDetectorSkill
        self.skill = TrendDetectorSkill()

    def test_score_excellent_product(self):
        """High-potential product should score A grade."""
        result = self.skill.score_product(
            name="LED Dress", daily_orders=200, num_advertisers=5,
            avg_price=39.99, age_days=5, countries=["US", "UK", "DE"],
        )
        assert result["grade"] == "A"
        assert result["score"] >= 80
        assert len(result["pros"]) > 0

    def test_score_poor_product(self):
        """Saturated old product should score D."""
        result = self.skill.score_product(
            name="Old Widget", daily_orders=10, num_advertisers=80,
            avg_price=5.99, age_days=60, countries=["US"],
        )
        assert result["grade"] == "D"
        assert result["score"] < 40

    def test_score_between_0_and_100(self):
        """Score should always be 0-100."""
        result = self.skill.score_product(
            name="Test", daily_orders=50, num_advertisers=20,
            avg_price=30, age_days=10, countries=["US", "UK"],
        )
        assert 0 <= result["score"] <= 100

    def test_saturation_detected(self):
        """Over 50 advertisers should be saturated."""
        history = [
            {"date": "d1", "count": 20},
            {"date": "d2", "count": 30},
            {"date": "d3", "count": 55},
        ]
        result = self.skill.detect_saturation("Test Product", history)
        assert result["is_saturated"] is True

    def test_saturation_not_yet(self):
        """Under threshold should not be saturated."""
        history = [
            {"date": "d1", "count": 5},
            {"date": "d2", "count": 8},
            {"date": "d3", "count": 10},
        ]
        result = self.skill.detect_saturation("Test Product", history)
        assert result["is_saturated"] is False
        assert result["days_to_saturation"] is not None

    def test_compare_no_history(self):
        """No history should return low confidence."""
        result = self.skill.compare_with_history(
            product={"name": "New Item", "avg_price": 30, "countries": ["US"]},
            history=[],
        )
        assert result["confidence"] == "none"

    def test_compare_with_similar(self):
        """Similar past product should find match."""
        product = {"name": "Blue Dress", "avg_price": 35, "countries": ["US"], "category": "fashion"}
        history = [
            {"name": "Red Dress", "avg_price": 30, "countries": ["US"], "category": "fashion", "roas": 2.5},
            {"name": "Phone Case", "avg_price": 10, "countries": ["CN"], "category": "gadgets", "roas": 1.2},
        ]
        result = self.skill.compare_with_history(product, history)
        assert result["similar_past"] == "Red Dress"

"""
🧪 Unit tests for tools/alert_formatter.py

Tests the AlertBuilder fluent API, plain-text build, Discord embed build,
and helper functions (format_currency, format_pct, format_delta, severity_from_*).
"""
import sys
import os
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from tools.alert_formatter import (
    AlertBuilder, Severity, KPI, AlertSection, AlertTable,
    format_currency, format_pct, format_delta,
    severity_from_roas, severity_from_return_rate,
)


class TestFormatCurrency(unittest.TestCase):
    """Test format_currency helper."""

    def test_large_number(self):
        self.assertEqual(format_currency(12345.67), "$12,346")

    def test_small_number(self):
        self.assertEqual(format_currency(99.5), "$99.50")

    def test_zero(self):
        self.assertEqual(format_currency(0), "$0.00")

    def test_negative(self):
        self.assertEqual(format_currency(-5000), "$-5,000")

    def test_custom_currency(self):
        self.assertEqual(format_currency(1500, "₫"), "₫1,500")

    def test_exact_thousand(self):
        self.assertEqual(format_currency(1000), "$1,000")


class TestFormatPct(unittest.TestCase):
    """Test format_pct helper."""

    def test_normal(self):
        self.assertEqual(format_pct(0.25), "25%")

    def test_zero(self):
        self.assertEqual(format_pct(0), "0%")

    def test_one(self):
        self.assertEqual(format_pct(1.0), "100%")

    def test_small(self):
        self.assertEqual(format_pct(0.03), "3%")


class TestFormatDelta(unittest.TestCase):
    """Test format_delta helper."""

    def test_increase(self):
        change, direction = format_delta(150, 100)
        self.assertEqual(change, "+50%")
        self.assertEqual(direction, "up")

    def test_decrease(self):
        change, direction = format_delta(50, 100)
        self.assertEqual(change, "-50%")
        self.assertEqual(direction, "down")

    def test_no_change(self):
        change, direction = format_delta(100, 100)
        self.assertEqual(change, "+0%")
        self.assertIsNone(direction)

    def test_zero_previous(self):
        change, direction = format_delta(100, 0)
        self.assertEqual(change, "N/A")
        self.assertIsNone(direction)


class TestSeverityFromRoas(unittest.TestCase):
    """Test severity_from_roas helper."""

    def test_critical(self):
        self.assertEqual(severity_from_roas(0.5), "critical")

    def test_warning(self):
        self.assertEqual(severity_from_roas(1.5), "warning")

    def test_success(self):
        self.assertEqual(severity_from_roas(3.0), "success")

    def test_boundary_danger(self):
        self.assertEqual(severity_from_roas(1.3), "warning")

    def test_boundary_warning(self):
        self.assertEqual(severity_from_roas(2.0), "success")


class TestSeverityFromReturnRate(unittest.TestCase):
    """Test severity_from_return_rate helper."""

    def test_critical(self):
        self.assertEqual(severity_from_return_rate(0.40), "critical")

    def test_warning(self):
        self.assertEqual(severity_from_return_rate(0.30), "warning")

    def test_success(self):
        self.assertEqual(severity_from_return_rate(0.10), "success")


class TestAlertBuilderFluent(unittest.TestCase):
    """Test AlertBuilder fluent API returns self for chaining."""

    def setUp(self):
        self.builder = AlertBuilder("Test Agent", "🧪", "testproject")

    def test_set_period_returns_self(self):
        result = self.builder.set_period("Last 1d")
        self.assertIs(result, self.builder)

    def test_set_severity_returns_self(self):
        result = self.builder.set_severity("warning")
        self.assertIs(result, self.builder)

    def test_set_elapsed_returns_self(self):
        result = self.builder.set_elapsed(2.5)
        self.assertIs(result, self.builder)

    def test_add_kpi_returns_self(self):
        result = self.builder.add_kpi("Spend", "$100")
        self.assertIs(result, self.builder)

    def test_add_section_returns_self(self):
        result = self.builder.add_section("Test Section", ["item1"])
        self.assertIs(result, self.builder)

    def test_add_table_returns_self(self):
        result = self.builder.add_table("Test", ["H1"], [["R1"]])
        self.assertIs(result, self.builder)

    def test_add_action_returns_self(self):
        result = self.builder.add_action("Do something")
        self.assertIs(result, self.builder)

    def test_full_chain(self):
        """Test full fluent chain doesn't error."""
        result = (self.builder
            .set_period("Last 7d")
            .set_severity("warning")
            .set_elapsed(3.2)
            .add_kpi("Revenue", "$10,000", icon="💰")
            .add_section("Issues", ["Issue 1", "Issue 2"], severity="critical")
            .add_table("Data", ["Col1", "Col2"], [["A", "B"]])
            .add_action("Fix the thing"))
        self.assertIs(result, self.builder)


class TestAlertBuilderBuildText(unittest.TestCase):
    """Test AlertBuilder.build() plain text output."""

    def test_minimal_build(self):
        text = AlertBuilder("Agent", "🤖", "proj").build()
        self.assertIn("🤖 Agent — PROJ", text)
        self.assertIn("FAOS v4", text)

    def test_with_kpis(self):
        text = (AlertBuilder("Agent", "🤖", "proj")
            .add_kpi("Spend", "$500", icon="💰")
            .add_kpi("ROAS", "2.5", icon="📈")
            .build())
        self.assertIn("💰 Spend: **$500**", text)
        self.assertIn("📈 ROAS: **2.5**", text)
        self.assertIn("│", text)  # KPI separator

    def test_with_section(self):
        text = (AlertBuilder("Agent", "🤖", "proj")
            .add_section("🔴 Critical Items", ["Item A", "Item B"])
            .build())
        self.assertIn("## 🔴 Critical Items", text)
        self.assertIn("- Item A", text)
        self.assertIn("- Item B", text)

    def test_with_table(self):
        text = (AlertBuilder("Agent", "🤖", "proj")
            .add_table("Sales", ["Product", "Units"], [["Shirt", "100"]])
            .build())
        self.assertIn("## Sales", text)
        self.assertIn("| Product | Units |", text)
        self.assertIn("| Shirt | 100 |", text)

    def test_with_actions(self):
        text = (AlertBuilder("Agent", "🤖", "proj")
            .add_action("Pause campaign")
            .add_action("Review budget")
            .build())
        self.assertIn("## 💡 Đề xuất", text)
        self.assertIn("- Pause campaign", text)
        self.assertIn("- Review budget", text)

    def test_severity_emoji_in_header(self):
        text = (AlertBuilder("Agent", "🤖", "proj")
            .set_severity("critical")
            .build())
        self.assertIn("🔴 CRITICAL", text)

    def test_elapsed_in_footer(self):
        text = (AlertBuilder("Agent", "🤖", "proj")
            .set_elapsed(3.14)
            .build())
        self.assertIn("⏱️ 3.1s", text)

    def test_vietnamese_content(self):
        text = (AlertBuilder("Profit Guardian", "🛡️", "zen8")
            .add_section("⚠️ Cảnh báo", ["Đơn hàng trễ 3 ngày"])
            .add_action("Liên hệ carrier về đơn giao trễ")
            .build())
        self.assertIn("Đơn hàng trễ 3 ngày", text)
        self.assertIn("Liên hệ carrier", text)

    def test_empty_section(self):
        text = (AlertBuilder("Agent", "🤖", "proj")
            .add_section("Empty Section")
            .build())
        self.assertIn("## Empty Section", text)

    def test_period_in_header(self):
        text = (AlertBuilder("Agent", "🤖", "proj")
            .set_period("Last 7d")
            .build())
        self.assertIn("Last 7d", text)


class TestAlertBuilderBuildEmbed(unittest.TestCase):
    """Test AlertBuilder.build_embed() Discord embed dict output."""

    def test_embed_is_dict(self):
        embed = AlertBuilder("Agent", "🤖", "proj").build_embed()
        self.assertIsInstance(embed, dict)

    def test_embed_has_required_keys(self):
        embed = AlertBuilder("Agent", "🤖", "proj").build_embed()
        self.assertIn("title", embed)
        self.assertIn("description", embed)
        self.assertIn("color", embed)
        self.assertIn("fields", embed)
        self.assertIn("footer", embed)
        self.assertIn("timestamp", embed)

    def test_embed_title(self):
        embed = AlertBuilder("My Agent", "🎯", "zen8").build_embed()
        self.assertEqual(embed["title"], "🎯 My Agent — ZEN8")

    def test_embed_color_by_severity(self):
        critical = AlertBuilder("A", "🔴", "p").set_severity("critical").build_embed()
        warning = AlertBuilder("A", "🟡", "p").set_severity("warning").build_embed()
        success = AlertBuilder("A", "🟢", "p").set_severity("success").build_embed()
        self.assertEqual(critical["color"], 0xFF4444)
        self.assertEqual(warning["color"], 0xFFAA00)
        self.assertEqual(success["color"], 0x2ECC71)

    def test_embed_fields_from_sections(self):
        embed = (AlertBuilder("A", "🤖", "p")
            .add_section("Section 1", ["Item A"])
            .build_embed())
        self.assertEqual(len(embed["fields"]), 1)
        self.assertEqual(embed["fields"][0]["name"], "Section 1")
        self.assertIn("Item A", embed["fields"][0]["value"])

    def test_embed_fields_from_tables(self):
        embed = (AlertBuilder("A", "🤖", "p")
            .add_table("Data", ["H1", "H2"], [["R1C1", "R1C2"]])
            .build_embed())
        self.assertEqual(len(embed["fields"]), 1)
        self.assertEqual(embed["fields"][0]["name"], "Data")

    def test_embed_actions_field(self):
        embed = (AlertBuilder("A", "🤖", "p")
            .add_action("Do this")
            .build_embed())
        action_fields = [f for f in embed["fields"] if f["name"] == "💡 Đề xuất"]
        self.assertEqual(len(action_fields), 1)
        self.assertIn("Do this", action_fields[0]["value"])

    def test_embed_fields_max_25(self):
        """Discord embed limit: 25 fields max."""
        builder = AlertBuilder("A", "🤖", "p")
        for i in range(30):
            builder.add_section(f"Section {i}", [f"Item {i}"])
        embed = builder.build_embed()
        self.assertLessEqual(len(embed["fields"]), 25)

    def test_embed_section_items_truncated_at_10(self):
        """Long sections should truncate at 10 items."""
        items = [f"Item {i}" for i in range(20)]
        embed = (AlertBuilder("A", "🤖", "p")
            .add_section("Long Section", items)
            .build_embed())
        value = embed["fields"][0]["value"]
        self.assertIn("...và 10 mục khác", value)

    def test_embed_table_rows_truncated_at_8(self):
        """Long tables should truncate at 8 rows."""
        rows = [[f"R{i}C1", f"R{i}C2"] for i in range(15)]
        embed = (AlertBuilder("A", "🤖", "p")
            .add_table("Big Table", ["H1", "H2"], rows)
            .build_embed())
        value = embed["fields"][0]["value"]
        self.assertIn("...và 7 dòng khác", value)

    def test_embed_kpis_in_description(self):
        embed = (AlertBuilder("A", "🤖", "p")
            .set_period("Last 1d")
            .add_kpi("Revenue", "$10K", icon="💰")
            .build_embed())
        self.assertIn("💰 **Revenue**: $10K", embed["description"])

    def test_embed_footer(self):
        embed = (AlertBuilder("A", "🤖", "p")
            .set_elapsed(5.0)
            .build_embed())
        self.assertIn("FAOS v4", embed["footer"]["text"])
        self.assertIn("5.0s", embed["footer"]["text"])


class TestSeverityClass(unittest.TestCase):
    """Test Severity class constants."""

    def test_colors_exist(self):
        self.assertIn("critical", Severity.COLORS)
        self.assertIn("warning", Severity.COLORS)
        self.assertIn("info", Severity.COLORS)
        self.assertIn("success", Severity.COLORS)

    def test_colors_are_int(self):
        for color in Severity.COLORS.values():
            self.assertIsInstance(color, int)

    def test_emojis_exist(self):
        for key in ["critical", "warning", "info", "success"]:
            self.assertIn(key, Severity.EMOJIS)

    def test_labels_exist(self):
        self.assertEqual(Severity.LABELS["critical"], "CRITICAL")
        self.assertEqual(Severity.LABELS["success"], "OK")


if __name__ == "__main__":
    unittest.main()

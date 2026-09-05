"""
🧪 Unit Tests for UnifiedMemory

Tests all public methods of the unified memory system.
Uses temp directory so tests don't affect production data.
"""
import unittest
import os
import sys
import json
import shutil
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))


class TestUnifiedMemory(unittest.TestCase):
    """Comprehensive tests for UnifiedMemory."""

    def setUp(self):
        """Create a fresh temp directory and UnifiedMemory instance."""
        self.test_dir = tempfile.mkdtemp(prefix="faos_mem_test_")
        from memory.unified_memory import UnifiedMemory
        self.mem = UnifiedMemory(agent_id="test_g3", data_dir=self.test_dir)

    def tearDown(self):
        """Cleanup temp directory."""
        shutil.rmtree(self.test_dir, ignore_errors=True)

    # ── Journal CRUD ────────────────────────────────────────

    def test_log_decision_writes_journal(self):
        """log_decision should create an entry in the journal."""
        self.mem.log_decision("camp_1", "KILL", "ROAS < 0.5", {"roas": 0.3})
        history = self.mem.get_history("camp_1")
        self.assertEqual(len(history), 1)
        self.assertEqual(history[0]["decision"], "KILL")
        self.assertEqual(history[0]["reason"], "ROAS < 0.5")
        self.assertEqual(history[0]["context"]["roas"], 0.3)

    def test_get_history_empty(self):
        """get_history for unknown entity returns empty list."""
        self.assertEqual(self.mem.get_history("unknown"), [])

    def test_get_recent_decisions(self):
        """get_recent_decisions should return entries within time window."""
        self.mem.log_decision("camp_1", "KILL", "low ROAS")
        self.mem.log_decision("camp_2", "SCALE", "high ROAS")
        recent = self.mem.get_recent_decisions(hours=1)
        self.assertEqual(len(recent), 2)

    def test_record_outcome(self):
        """record_outcome should attach outcome to matching entry."""
        self.mem.log_decision("camp_1", "KILL", "test")
        history = self.mem.get_history("camp_1")
        date_str = history[0]["date"]

        self.mem.record_outcome("camp_1", date_str, "Correct, ROAS stayed 0.2", True)

        updated = self.mem.get_history("camp_1")
        self.assertIsNotNone(updated[0]["outcome"])
        self.assertTrue(updated[0]["outcome"]["was_correct"])

    def test_record_outcome_no_match(self):
        """record_outcome for non-existent date should not crash."""
        self.mem.log_decision("camp_1", "KILL", "test")
        self.mem.record_outcome("camp_1", "2000-01-01 00:00:00", "n/a", False)
        # Should not crash, outcome stays None
        history = self.mem.get_history("camp_1")
        self.assertIsNone(history[0]["outcome"])

    # ── Vector Search ───────────────────────────────────────

    def test_recall_similar_finds_decision(self):
        """recall_similar should find semantically similar past decisions."""
        self.mem.log_decision(
            "camp_1", "KILL", "CTR 8% but zero orders, ROAS 0.1",
            {"ctr": 8.0, "roas": 0.1}
        )
        results = self.mem.recall_similar("campaign with high CTR but no sales")
        self.assertTrue(len(results) >= 1)
        self.assertIn("KILL", results[0]["text"])

    def test_recall_similar_empty_memory(self):
        """recall_similar with no data should return empty list."""
        results = self.mem.recall_similar("anything")
        self.assertEqual(results, [])

    # ── Shared Knowledge ────────────────────────────────────

    def test_remember_shared_and_search(self):
        """remember_shared should store, search_shared should find."""
        self.mem.remember_shared(
            "ROAS formula: Revenue / Ad Spend. Target > 2.0",
            metadata={"category": "business_rule"},
        )
        results = self.mem.search_shared("how to calculate ROAS")
        self.assertTrue(len(results) >= 1)

    def test_remember_shared_dedup(self):
        """Same text stored twice should not create duplicates (upsert)."""
        text = "COD = Cash on Delivery"
        id1 = self.mem.remember_shared(text)
        id2 = self.mem.remember_shared(text)
        self.assertEqual(id1, id2)

    def test_remember_shared_invalid_collection(self):
        """Invalid collection name should raise ValueError."""
        with self.assertRaises(ValueError):
            self.mem.remember_shared("test", collection="invalid_col")

    def test_search_shared_all_collections(self):
        """search_shared with None collection should search all."""
        self.mem.remember_shared("test knowledge", collection="shared_knowledge")
        self.mem.remember_shared("test incident", collection="incident_memory")
        results = self.mem.search_shared("test")
        self.assertTrue(len(results) >= 2)

    # ── Cross-Agent Alerts ──────────────────────────────────

    def test_publish_and_read_alerts(self):
        """publish_alert should be readable by read_alerts."""
        self.mem.publish_alert("STOCK_OUT", {"products": ["Widget A"]})
        alerts = self.mem.read_alerts(alert_type="STOCK_OUT", hours=1)
        self.assertEqual(len(alerts), 1)
        self.assertEqual(alerts[0]["alert_type"], "STOCK_OUT")
        self.assertEqual(alerts[0]["from_agent"], "test_g3")

    def test_read_alerts_type_filter(self):
        """read_alerts should filter by alert_type."""
        self.mem.publish_alert("STOCK_OUT", {"sku": "A"})
        self.mem.publish_alert("BUDGET_FREEZE", {"reason": "margin 0"})
        stock_alerts = self.mem.read_alerts(alert_type="STOCK_OUT", hours=1)
        self.assertEqual(len(stock_alerts), 1)

    def test_read_alerts_all_types(self):
        """read_alerts with no type filter returns all."""
        self.mem.publish_alert("STOCK_OUT", {})
        self.mem.publish_alert("BUDGET_FREEZE", {})
        all_alerts = self.mem.read_alerts(hours=1)
        self.assertEqual(len(all_alerts), 2)

    # ── Cleanup / TTL ───────────────────────────────────────

    def test_cleanup_keeps_recent(self):
        """cleanup should keep entries newer than max_age_days."""
        self.mem.log_decision("camp_1", "KILL", "recent decision")
        result = self.mem.cleanup(max_age_days=90)
        self.assertEqual(result["removed"], 0)
        self.assertEqual(result["remaining"], 1)

    def test_cleanup_keeps_lessons(self):
        """cleanup should never delete entries with recorded outcomes."""
        self.mem.log_decision("camp_1", "KILL", "old decision")
        history = self.mem.get_history("camp_1")
        self.mem.record_outcome("camp_1", history[0]["date"], "correct", True)
        result = self.mem.cleanup(max_age_days=0)  # max_age=0 would prune everything
        # But lessons are preserved
        self.assertEqual(result["remaining"], 1)

    # ── Stats ───────────────────────────────────────────────

    def test_get_stats(self):
        """get_stats should return comprehensive stats."""
        self.mem.log_decision("camp_1", "KILL", "test")
        stats = self.mem.get_stats()
        self.assertEqual(stats["agent_id"], "test_g3")
        self.assertEqual(stats["journal_entities"], 1)
        self.assertEqual(stats["journal_total_entries"], 1)
        self.assertIn("vector_private_count", stats)

    # ── Import / Export ─────────────────────────────────────

    def test_export_import_journal(self):
        """export_journal and import_journal should preserve data."""
        self.mem.log_decision("camp_1", "KILL", "test")
        exported = self.mem.export_journal()

        from memory.unified_memory import UnifiedMemory
        mem2 = UnifiedMemory(agent_id="test_g3_clone", data_dir=self.test_dir)
        mem2.import_journal(exported, merge=True)

        imported_history = mem2.get_history("camp_1")
        self.assertEqual(len(imported_history), 1)
        self.assertEqual(imported_history[0]["decision"], "KILL")

    def test_import_journal_dedup(self):
        """Importing same data twice should not create duplicates."""
        self.mem.log_decision("camp_1", "KILL", "test")
        exported = self.mem.export_journal()

        self.mem.import_journal(exported, merge=True)
        history = self.mem.get_history("camp_1")
        self.assertEqual(len(history), 1)  # Not 2

    # ── Edge Cases ──────────────────────────────────────────

    def test_empty_context(self):
        """log_decision with None context should not crash."""
        self.mem.log_decision("camp_1", "MONITOR", "watching", None)
        history = self.mem.get_history("camp_1")
        self.assertEqual(history[0]["context"], {})

    def test_multiple_decisions_same_entity(self):
        """Multiple decisions for same entity should stack."""
        self.mem.log_decision("camp_1", "MONITOR", "day 1")
        self.mem.log_decision("camp_1", "KILL", "day 2")
        history = self.mem.get_history("camp_1")
        self.assertEqual(len(history), 2)
        self.assertEqual(history[0]["decision"], "MONITOR")
        self.assertEqual(history[1]["decision"], "KILL")


if __name__ == "__main__":
    unittest.main()

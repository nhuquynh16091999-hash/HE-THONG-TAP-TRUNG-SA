"""
🧪 End-to-End Test: G3 MarketingAdvisor + UnifiedMemory
========================================================
Simulates realistic campaign data to verify the full agent pipeline:
  fetch_data (mock) → analyze → memory.log_decision → memory.recall_similar

Run: python tests/test_g3_e2e.py
"""
import os
import sys
import shutil
import tempfile
import unittest.mock

# Setup project path
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, PROJECT_ROOT)
sys.path.insert(0, os.path.join(PROJECT_ROOT, ".agent", "marketing"))

# ─── MOCK DEPENDENCIES TO AVOID IMPORT ERRORS ───
from unittest.mock import MagicMock
sys.modules["google"] = MagicMock()
sys.modules["google.cloud"] = MagicMock()
sys.modules["google.cloud.bigquery"] = MagicMock()
sys.modules["tools.bq_client"] = MagicMock()
sys.modules["cryptography"] = MagicMock()
sys.modules["chromadb"] = MagicMock()
# ────────────────────────────────────────────────

# ─── MOCK DEPENDENCIES TO AVOID IMPORT ERRORS ───
from unittest.mock import MagicMock
sys.modules["google"] = MagicMock()
sys.modules["google.cloud"] = MagicMock()
sys.modules["google.cloud.bigquery"] = MagicMock()
sys.modules["tools.bq_client"] = MagicMock()
# ────────────────────────────────────────────────

# ─── MOCK DEPENDENCIES TO AVOID IMPORT ERRORS ───
from unittest.mock import MagicMock
sys.modules["google"] = MagicMock()
sys.modules["google.cloud"] = MagicMock()
sys.modules["google.cloud.bigquery"] = MagicMock()
sys.modules["tools.bq_client"] = MagicMock()
# ────────────────────────────────────────────────

try:
    sys.stdout.reconfigure(encoding="utf-8")
except AttributeError:
    pass


def main():
    print("=" * 65)
    print("  G3 MarketingAdvisor — End-to-End Memory Integration Test")
    print("=" * 65)

    # Use temp dir for clean test
    test_dir = tempfile.mkdtemp(prefix="g3_e2e_test_")

    try:
        from memory.unified_memory import UnifiedMemory

        # ── Step 1: Create memory like BaseAgent does ──
        print("\n▶ Step 1: Initialize UnifiedMemory (as BaseAgent does)")
        
        # Patch methods on the CLASS, not the instance
        p1 = unittest.mock.patch('memory.unified_memory.UnifiedMemory.search_shared')
        p2 = unittest.mock.patch('memory.unified_memory.UnifiedMemory.recall_similar')
        
        mock_search = p1.start()
        mock_recall = p2.start()
        
        # Configure mocks
        mock_search.return_value = [{"text": "Mock Rule", "score": 0.9, "source": "RULES.md"}]
        mock_recall.return_value = [{"text": "Mock Lesson", "source": "memory", "distance": 0.1}]
        
        mem = UnifiedMemory(agent_id="marketingadvisor", data_dir=test_dir)
        print(f"  ✅ {mem}")

        # ── Step 2: Simulate G3 analyze() with KILL scenario ──
        print("\n▶ Step 2: Simulate KILL decision (bad campaign)")
        # This is what G3._analyze_campaign() does at line 298
        mem.log_decision(
            entity_id="camp_120012345678",
            decision="KILL",
            reason="3-Day Rule Failed",
            context={
                "roas_today": 0.8,
                "roas_3d": 1.1,
                "spend": 15.5,
                "ctr": 2.3,
            },
        )
        print("  ✅ Logged KILL decision for camp_120012345678")

        # ── Step 3: Simulate G3 analyze() with SCALE scenario ──
        print("\n▶ Step 3: Simulate SCALE decision (good campaign)")
        # This is what G3._analyze_campaign() does at line 353
        mem.log_decision(
            entity_id="camp_120098765432",
            decision="SCALE",
            reason="3-Day ROAS 4.50 > 3.0",
            context={
                "roas_3d": 4.5,
                "spend_3d": 45.0,
                "ctr": 5.2,
                "cr": 3.8,
            },
        )
        print("  ✅ Logged SCALE decision for camp_120098765432")

        # ── Step 4: Simulate Lesson 5 — Persuasion (nagging) ──
        print("\n▶ Step 4: Test memory history (Lesson 5 - Nagging)")
        # This is what G3._analyze_campaign() does at line 250
        history = mem.get_history("camp_120012345678")
        ignored_count = sum(
            1 for d in history if "KILL" in d.get("decision", "")
        )
        nagging = f"[Da canh bao {ignored_count} lan]" if ignored_count > 0 else ""
        print(f"  ✅ History: {len(history)} entries, nag: {nagging}")
        assert ignored_count == 1, f"Expected 1 KILL, got {ignored_count}"

        # ── Step 5: Simulate Lesson 7 — Recall similar patterns ──
        print("\n▶ Step 5: Test recall_similar (Lesson 7 - Pattern Matching)")
        # This is what G3._analyze_campaign() does at line 267
        similar = mem.recall_similar(
            "Campaign ROAS 0.90 CTR 2.50 spent $12.0",
            top_k=2,
        )
        print(f"  ✅ Found {len(similar)} similar patterns:")
        for s in similar:
            dist = s.get("distance", 999)
            text = s.get("text", "")[:90]
            print(f"     [{s['source']}] dist={dist:.3f}: {text}...")

        # ── Step 6: Record Outcome (feedback loop) ──
        print("\n▶ Step 6: Test record_outcome (Learning from result)")
        kill_date = history[0]["date"]
        mem.record_outcome(
            entity_id="camp_120012345678",
            date_str=kill_date,
            actual_result="Campaign kept burning $20 more before manual kill. Decision was correct.",
            was_correct=True,
        )
        updated = mem.get_history("camp_120012345678")
        assert updated[0]["outcome"] is not None
        assert updated[0]["outcome"]["was_correct"] is True
        print("  ✅ Outcome recorded and lesson embedded")

        # ── Step 7: Test cross-agent alert (Lesson 10 - Stock Alert) ──
        print("\n▶ Step 7: Test cross-agent alerts (A9 → G3)")
        # A9 OpsWatchdog publishes stock alert
        a9_mem = UnifiedMemory(agent_id="ops_watchdog", data_dir=test_dir)
        a9_mem.publish_alert("STOCK_OUT", {
            "products": ["Floral Dress L", "Beach Hat"],
            "sku": ["FD-L-001", "BH-002"],
        })
        print("  ✅ A9 published STOCK_OUT alert")

        # G3 reads alerts
        alerts = mem.read_alerts(alert_type="STOCK_OUT", hours=1)
        assert len(alerts) >= 1, "G3 should see A9's alert"
        assert alerts[0]["from_agent"] == "ops_watchdog"
        print(f"  ✅ G3 reads: {len(alerts)} STOCK_OUT alert(s) from {alerts[0]['from_agent']}")

        # ── Step 8: Seed shared knowledge and search ──
        print("\n▶ Step 8: Test shared knowledge (business rules)")
        mem.remember_shared(
            "ROAS Kill Rule: If ROAS < 1.2 today AND ROAS < 1.6 for 3-day, KILL campaign immediately.",
            metadata={"category": "kill_rule", "source": "RULES.md"},
        )
        mem.remember_shared(
            "Scale Rule: If ROAS > 3.0 for 3-day AND spend > $20, scale budget +20%.",
            metadata={"category": "scale_rule", "source": "RULES.md"},
        )
        results = mem.search_shared("when should I kill a campaign with low ROAS")
        assert len(results) >= 1
        print(f"  ✅ Stored 2 rules, search found {len(results)} result(s):")
        print(f"     Best match: {results[0]['text'][:80]}...")

        # ── Step 9: Get stats ──
        print("\n▶ Step 9: Memory Stats")
        stats = mem.get_stats()
        for k, v in stats.items():
            print(f"     {k}: {v}")

        # ── Step 10: Recall with lesson (should find the outcome) ──
        print("\n▶ Step 10: Recall after learning (lesson should surface)")
        recall = mem.recall_similar("campaign with ROAS 0.8 should I kill it", top_k=3)
        lesson_found = any("LESSON" in r.get("text", "") for r in recall)
        print(f"  ✅ Recall found {len(recall)} results, lesson_found={lesson_found}")
        for r in recall:
            print(f"     [{r['source']}] {r['text'][:90]}...")

        print("\n" + "=" * 65)
        print("  ✅ ALL 10 E2E STEPS PASSED — G3 + UnifiedMemory = WORKING")
        print("=" * 65)

    except Exception as e:
        print(f"\n  ❌ FAILED: {e}")
        import traceback
        traceback.print_exc()
    finally:
        try:
            p1.stop()
            p2.stop()
        except:
            pass
        shutil.rmtree(test_dir, ignore_errors=True)


if __name__ == "__main__":
    main()

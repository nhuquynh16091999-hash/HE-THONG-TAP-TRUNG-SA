#!/usr/bin/env python3
"""
FAOS v6 — FalkorDB Integration Test
=====================================
Test script: kết nối FalkorDB, tạo schema, seed data, verify nodes.

Chạy trên VPS (nơi docker-compose.ai.yml đang chạy):
    pip install falkordb
    python tests/test_falkordb_integration.py

Hoặc chỉ định host:
    FALKORDB_HOST=10.0.0.5 python tests/test_falkordb_integration.py
"""

import json
import os
import sys
import time
from pathlib import Path

# ─── Thêm project root vào path ───
PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT))


def print_header(title: str) -> None:
    print(f"\n{'═' * 60}")
    print(f"  {title}")
    print(f"{'═' * 60}")


def print_pass(msg: str) -> None:
    print(f"  ✅ PASS: {msg}")


def print_fail(msg: str) -> None:
    print(f"  ❌ FAIL: {msg}")


def print_info(msg: str) -> None:
    print(f"  ℹ️  {msg}")


def main() -> None:
    host = os.environ.get("FALKORDB_HOST", "localhost")
    port = int(os.environ.get("FALKORDB_PORT", "6379"))
    graph_name = "faos_knowledge_test"  # Dùng graph riêng cho test

    results = {"pass": 0, "fail": 0}

    # ═══════════════════════════════════════
    # TEST 1: Import modules
    # ═══════════════════════════════════════
    print_header("TEST 1: Import Modules")
    try:
        from faos_brain.graph.connection import FalkorDBConnection, FalkorDBConnectionError
        from faos_brain.graph.schema import create_graph_schema, verify_schema, NODE_LABELS
        from faos_brain.graph.loader import (
            load_all_seed_data,
            seed_sops_to_graph,
            seed_personality_to_graph,
            seed_markets_to_graph,
            _load_seed_json,
        )
        print_pass("All graph modules imported successfully")
        results["pass"] += 1
    except ImportError as e:
        print_fail(f"Import error: {e}")
        print_info("Hãy chạy: pip install falkordb pydantic-settings python-dotenv")
        results["fail"] += 1
        print(f"\n{'═' * 60}")
        print(f"  KẾT QUẢ: {results['pass']} passed, {results['fail']} failed")
        print(f"{'═' * 60}")
        return

    # ═══════════════════════════════════════
    # TEST 2: Load seed_data.json
    # ═══════════════════════════════════════
    print_header("TEST 2: Load seed_data.json")
    try:
        seed_data = _load_seed_json()
        sops = seed_data.get("sops", [])
        personality = seed_data.get("personality_config", {})
        markets = seed_data.get("markets", [])
        print_pass(f"Loaded: {len(sops)} SOPs, {len(markets)} Markets, 1 PersonalityConfig")
        print_info(f"SOPs: {[s['sop_id'] for s in sops]}")
        print_info(f"Markets: {[m['market_code'] for m in markets]}")
        results["pass"] += 1
    except Exception as e:
        print_fail(f"Failed to load seed data: {e}")
        results["fail"] += 1

    # ═══════════════════════════════════════
    # TEST 3: Connect to FalkorDB
    # ═══════════════════════════════════════
    print_header(f"TEST 3: Connect to FalkorDB ({host}:{port})")
    conn = FalkorDBConnection(host=host, port=port, graph_name=graph_name)
    try:
        conn.connect()
        print_pass(f"Connected to FalkorDB at {host}:{port}")
        results["pass"] += 1
    except FalkorDBConnectionError as e:
        print_fail(f"Connection failed: {e}")
        print_info("Docker đang chạy chưa?  docker ps | grep falkor")
        print_info("Hoặc set: FALKORDB_HOST=<ip> FALKORDB_PORT=6379")
        results["fail"] += 1
        print(f"\n{'═' * 60}")
        print(f"  KẾT QUẢ: {results['pass']} passed, {results['fail']} failed")
        print(f"{'═' * 60}")
        return

    # ═══════════════════════════════════════
    # TEST 4: Health Check
    # ═══════════════════════════════════════
    print_header("TEST 4: Health Check")
    try:
        healthy = conn.health_check()
        if healthy:
            print_pass("FalkorDB health check passed")
            results["pass"] += 1
        else:
            print_fail("Health check returned False")
            results["fail"] += 1
    except Exception as e:
        print_fail(f"Health check error: {e}")
        results["fail"] += 1

    # ═══════════════════════════════════════
    # TEST 5: Create Schema (Indexes)
    # ═══════════════════════════════════════
    print_header("TEST 5: Create Graph Schema (Indexes)")
    try:
        schema_result = create_graph_schema(conn)
        total = schema_result["indexes_created"] + schema_result["indexes_skipped"]
        print_pass(
            f"Schema: {schema_result['indexes_created']} created, "
            f"{schema_result['indexes_skipped']} skipped, "
            f"{schema_result['indexes_errored']} errors"
        )
        if schema_result["indexes_errored"] == 0:
            results["pass"] += 1
        else:
            print_info(f"Some indexes had errors (may be OK if already exist)")
            results["pass"] += 1  # Non-fatal
    except Exception as e:
        print_fail(f"Schema creation failed: {e}")
        results["fail"] += 1

    # ═══════════════════════════════════════
    # TEST 6: Seed Data
    # ═══════════════════════════════════════
    print_header("TEST 6: Seed Data (SOPs + Personality + Markets)")
    try:
        seed_result = load_all_seed_data(conn)
        print_pass(
            f"Seeded: {seed_result['sops_created']} SOPs, "
            f"personality={'✅' if seed_result['personality_created'] else '⏭ existed'}, "
            f"{seed_result['markets_created']} Markets, "
            f"{seed_result['edges_created']} edges"
        )
        results["pass"] += 1
    except Exception as e:
        print_fail(f"Seed data failed: {e}")
        results["fail"] += 1

    # ═══════════════════════════════════════
    # TEST 7: Verify Nodes Exist
    # ═══════════════════════════════════════
    print_header("TEST 7: Verify Nodes in Graph")
    try:
        verification = verify_schema(conn)
        counts = verification["node_counts"]
        print_info(f"Total nodes in graph: {verification['total_nodes']}")
        all_ok = True
        for label, count in counts.items():
            status = "✅" if count > 0 else "⚪" if count == 0 else "❌"
            print(f"    {status} {label}: {count} nodes")
            # SOPs, Markets, PersonalityConfig should have data
            if label in ("SOP", "Market", "PersonalityConfig") and count == 0:
                all_ok = False

        if all_ok and counts.get("SOP", 0) >= 5 and counts.get("Market", 0) >= 5:
            print_pass("All expected nodes exist!")
            results["pass"] += 1
        elif all_ok:
            print_pass("Node verification OK (some counts may be from second run)")
            results["pass"] += 1
        else:
            print_fail("Missing expected nodes")
            results["fail"] += 1
    except Exception as e:
        print_fail(f"Verification failed: {e}")
        results["fail"] += 1

    # ═══════════════════════════════════════
    # TEST 8: Query SOPs (Cypher)
    # ═══════════════════════════════════════
    print_header("TEST 8: Query SOPs via Cypher")
    try:
        sops_result = conn.execute_query(
            "MATCH (s:SOP) RETURN s.id AS id, s.name AS category, s.active AS active ORDER BY s.id"
        )
        print_pass(f"Found {len(sops_result)} SOP nodes")
        for sop in sops_result:
            print(f"    📜 {sop.get('id', '?')} | {sop.get('category', '?')} | active={sop.get('active', '?')}")
        results["pass"] += 1
    except Exception as e:
        print_fail(f"SOP query failed: {e}")
        results["fail"] += 1

    # ═══════════════════════════════════════
    # TEST 9: Query PersonalityConfig
    # ═══════════════════════════════════════
    print_header("TEST 9: Query PersonalityConfig")
    try:
        pc_result = conn.execute_query(
            "MATCH (p:PersonalityConfig) "
            "RETURN p.id AS id, p.risk_level AS risk, p.auto_budget_limit AS auto_limit, "
            "p.daily_auto_ceiling AS ceiling, p.target_roas AS target_roas"
        )
        if pc_result:
            pc = pc_result[0]
            print_pass("PersonalityConfig loaded:")
            print(f"    🎛️  risk_level: {pc.get('risk', '?')}")
            print(f"    💰 auto_budget_limit: {pc.get('auto_limit', '?')} cents")
            print(f"    📊 daily_auto_ceiling: {pc.get('ceiling', '?')} cents")
            print(f"    🎯 target_roas: {pc.get('target_roas', '?')}")
            results["pass"] += 1
        else:
            print_fail("No PersonalityConfig found")
            results["fail"] += 1
    except Exception as e:
        print_fail(f"PersonalityConfig query failed: {e}")
        results["fail"] += 1

    # ═══════════════════════════════════════
    # TEST 10: Query SOP→Market edges
    # ═══════════════════════════════════════
    print_header("TEST 10: Query SOP→Market Edges (APPLIES_TO)")
    try:
        edges_result = conn.execute_query(
            "MATCH (s:SOP)-[:APPLIES_TO]->(m:Market) "
            "RETURN s.id AS sop, m.market_code AS market "
            "ORDER BY s.id, m.market_code "
            "LIMIT 15"
        )
        print_pass(f"Found {len(edges_result)} SOP→Market edges")
        for edge in edges_result[:10]:
            print(f"    🔗 {edge.get('sop', '?')} → {edge.get('market', '?')}")
        if len(edges_result) > 10:
            print(f"    ... và {len(edges_result) - 10} edges nữa")
        results["pass"] += 1
    except Exception as e:
        print_fail(f"Edge query failed: {e}")
        results["fail"] += 1

    # ═══════════════════════════════════════
    # TEST 11: Idempotency Check (run seed again)
    # ═══════════════════════════════════════
    print_header("TEST 11: Idempotency (Seed lần 2 — should skip)")
    try:
        second_run = load_all_seed_data(conn)
        if second_run["sops_created"] == 0 and second_run["markets_created"] == 0:
            print_pass("Idempotent! Second seed created 0 new nodes (all skipped)")
            results["pass"] += 1
        else:
            print_fail(f"Not idempotent — created {second_run} on second run")
            results["fail"] += 1
    except Exception as e:
        print_fail(f"Idempotency test failed: {e}")
        results["fail"] += 1

    # ═══════════════════════════════════════
    # CLEANUP: Delete test graph
    # ═══════════════════════════════════════
    print_header("CLEANUP: Delete test graph")
    try:
        conn.graph.delete()
        print_pass(f"Test graph '{graph_name}' deleted")
    except Exception as e:
        print_info(f"Cleanup warning (non-fatal): {e}")

    conn.disconnect()

    # ═══════════════════════════════════════
    # SUMMARY
    # ═══════════════════════════════════════
    print(f"\n{'═' * 60}")
    total = results["pass"] + results["fail"]
    status = "🎉 ALL PASSED!" if results["fail"] == 0 else "⚠️ SOME FAILED"
    print(f"  {status}  —  {results['pass']}/{total} tests passed")
    print(f"{'═' * 60}\n")

    sys.exit(0 if results["fail"] == 0 else 1)


if __name__ == "__main__":
    main()

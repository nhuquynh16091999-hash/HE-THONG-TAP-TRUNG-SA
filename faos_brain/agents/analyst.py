"""
faos_brain/agents/analyst.py — F1: Analyst Agent.

Đọc context từ BigQuery views (vw_fact_daily_pnl, vw_fact_daily_marketer,
vw_product_pnl, vw_daily_momentum) → Claude phân tích sức khỏe kinh doanh.
KHÔNG tạo nguồn dữ liệu mới — chỉ đọc.

Usage:
  python -m faos_brain.agents.analyst              # 30 ngày
  python -m faos_brain.agents.analyst --days 7
"""
from __future__ import annotations

import json
import argparse
import logging

from dotenv import load_dotenv
from faos_brain.agents.llm_client import LLMClient, LLMNotConfigured
from faos_brain.agents import bq_context

load_dotenv()
load_dotenv("dashboard-ui/.env.local")  # ANTHROPIC_API_KEY có thể ở đây

log = logging.getLogger(__name__)

SYSTEM = """Bạn là Analyst trưởng của TALPHA — thương hiệu trang sức & mỹ phẩm bán COD
qua Facebook Ads tại 6 thị trường GCC (Saudi, UAE, Kuwait, Oman, Qatar, Bahrain).

Nhiệm vụ: đọc số liệu tóm tắt (JSON) và đưa ra phân tích NGẮN GỌN, có hành động cho CEO.
Quy tắc:
- Chỉ dựa trên số liệu được cung cấp. KHÔNG bịa số.
- Nếu một nguồn thiếu (vd ads), nói rõ "thiếu dữ liệu X" thay vì suy đoán.
- Doanh thu/chi phí đơn vị VND. ROAS = doanh thu / chi tiêu ads.
- Trả lời tiếng Việt, có cấu trúc:
  1) Tổng quan (2-3 câu)
  2) Điểm mạnh
  3) Rủi ro / bất thường
  4) 3 hành động ưu tiên (cụ thể, đo được)"""


class AnalystAgent:
    def __init__(self, llm: LLMClient | None = None):
        self.llm = llm or LLMClient()

    def analyze(self, days: int = 30) -> dict:
        """Trả về {context, analysis} — context là số liệu, analysis là text từ Claude."""
        ctx = bq_context.build_full_context(days=days)

        prompt = (
            f"Dữ liệu TALPHA {days} ngày gần nhất (JSON):\n\n"
            f"{json.dumps(ctx, ensure_ascii=False, indent=2, default=str)}\n\n"
            f"Hãy phân tích theo cấu trúc đã yêu cầu."
        )
        analysis = self.llm.complete(system=SYSTEM, prompt=prompt, max_tokens=1500)
        return {"context": ctx, "analysis": analysis}


def main():
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    ap = argparse.ArgumentParser(description="TALPHA Analyst Agent (F1)")
    ap.add_argument("--days", type=int, default=30)
    ap.add_argument("--context-only", action="store_true", help="Chỉ in context BQ, không gọi LLM")
    args = ap.parse_args()

    agent = AnalystAgent()

    if args.context_only:
        ctx = bq_context.build_full_context(days=args.days)
        print(json.dumps(ctx, ensure_ascii=False, indent=2, default=str))
        return

    try:
        out = agent.analyze(days=args.days)
    except LLMNotConfigured as e:
        print(f"⚠️  {e}")
        print("\n→ Context đọc được (chạy --context-only để xem riêng):")
        print(json.dumps(bq_context.build_full_context(days=args.days), ensure_ascii=False, indent=2, default=str))
        return

    print("═" * 64)
    print(f"  TALPHA ANALYST — {args.days} ngày")
    print("═" * 64)
    print(out["analysis"])


if __name__ == "__main__":
    main()

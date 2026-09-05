"""
faos_brain/agents/marketing_director.py — F2: Marketing Director Agent.

Đọc hiệu quả ads theo marketer + xu hướng (vw_fact_daily_marketer, vw_daily_momentum)
→ Claude đề xuất phân bổ ngân sách, scale/cut campaign, làm mới creative.
KHÔNG tạo nguồn dữ liệu mới — chỉ đọc.

Usage:
  python -m faos_brain.agents.marketing_director --days 14
"""
from __future__ import annotations

import json
import argparse
import logging

from dotenv import load_dotenv
from faos_brain.agents.llm_client import LLMClient, LLMNotConfigured
from faos_brain.agents import bq_context

load_dotenv()
load_dotenv("dashboard-ui/.env.local")

log = logging.getLogger(__name__)

SYSTEM = """Bạn là Marketing Director của TALPHA — chịu trách nhiệm hiệu quả Facebook Ads
tại 6 thị trường GCC. Đội ngũ gồm nhiều marketer, mỗi người quản campaign riêng.

Nhiệm vụ: đọc số liệu ads theo marketer + xu hướng → ra quyết định tối ưu cho CEO.
Quy tắc:
- Chỉ dựa số liệu cung cấp; KHÔNG bịa. Thiếu nguồn nào thì nói rõ.
- ROAS = doanh thu xác nhận / chi tiêu ads. Mục tiêu ROAS ≥ 4.0.
- Tập trung HÀNH ĐỘNG ads: ai/scale, ai/cut, ngân sách dịch chuyển, creative cần làm mới.
- Trả lời tiếng Việt, cấu trúc:
  1) Đánh giá tổng ads (ROAS, xu hướng)
  2) Marketer xuất sắc → đề xuất scale (kèm % ngân sách)
  3) Marketer/đơn vị kém → cut hoặc sửa
  4) Cảnh báo creative/tần suất (nếu có dữ liệu)"""


class MarketingDirectorAgent:
    def __init__(self, llm: LLMClient | None = None):
        self.llm = llm or LLMClient()

    def advise(self, days: int = 14) -> dict:
        bq = bq_context._client()
        ctx = {
            "pnl": bq_context.pnl_summary(days, bq=bq),
            "marketers": bq_context.marketer_breakdown(days, bq=bq),
            "momentum": bq_context.momentum_signals(bq=bq),
        }
        prompt = (
            f"Dữ liệu ads TALPHA {days} ngày gần nhất (JSON):\n\n"
            f"{json.dumps(ctx, ensure_ascii=False, indent=2, default=str)}\n\n"
            f"Hãy đưa khuyến nghị tối ưu marketing theo cấu trúc đã yêu cầu."
        )
        advice = self.llm.complete(system=SYSTEM, prompt=prompt, max_tokens=1500)
        return {"context": ctx, "advice": advice}


def main():
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    ap = argparse.ArgumentParser(description="TALPHA Marketing Director Agent (F2)")
    ap.add_argument("--days", type=int, default=14)
    ap.add_argument("--context-only", action="store_true")
    args = ap.parse_args()

    if args.context_only:
        bq = bq_context._client()
        ctx = {
            "pnl": bq_context.pnl_summary(args.days, bq=bq),
            "marketers": bq_context.marketer_breakdown(args.days, bq=bq),
            "momentum": bq_context.momentum_signals(bq=bq),
        }
        print(json.dumps(ctx, ensure_ascii=False, indent=2, default=str))
        return

    agent = MarketingDirectorAgent()
    try:
        out = agent.advise(days=args.days)
    except LLMNotConfigured as e:
        print(f"⚠️  {e}")
        return

    print("═" * 64)
    print(f"  TALPHA MARKETING DIRECTOR — {args.days} ngày")
    print("═" * 64)
    print(out["advice"])


if __name__ == "__main__":
    main()

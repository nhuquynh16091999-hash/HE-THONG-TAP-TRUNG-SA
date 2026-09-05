"""
Ads Spy API — FastAPI routes for dashboard.

Endpoints:
    GET /api/ads-spy/trending       — Top ads by hot_score
    GET /api/ads-spy/stats          — Overview stats
    GET /api/ads-spy/niches         — Available niches
    GET /api/ads-spy/analyze/{ad_id} — AI analysis for one ad
    POST /api/ads-spy/sync          — Trigger manual sync
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from faos_brain.ads_spy import config as cfg

# Lazy imports — scorer and ai_analyzer may not exist yet
def _get_trending(*args, **kwargs):
    try:
        from faos_brain.ads_spy.scorer import get_trending
        return get_trending(*args, **kwargs)
    except ImportError:
        return []

def _get_stats(*args, **kwargs):
    try:
        from faos_brain.ads_spy.scorer import get_stats
        return get_stats(*args, **kwargs)
    except ImportError:
        return {}

def _get_analyzer():
    try:
        from faos_brain.ads_spy.ai_analyzer import AIAnalyzer
        return AIAnalyzer()
    except ImportError:
        return None

log = logging.getLogger("faos.api.ads_spy")

router = APIRouter(prefix="/api/ads-spy", tags=["Ads Spy"])


@router.get("/trending")
async def trending_ads(
    niche: Optional[str] = Query(None, description="Filter by niche: jewelry, beauty, health"),
    market: Optional[str] = Query(None, description="Filter by market: US, AU"),
    days: int = Query(7, description="Look-back days"),
    limit: int = Query(50, description="Max results"),
    min_score: float = Query(0, description="Minimum hot_score"),
):
    """Get trending ads sorted by hot_score."""
    try:
        ads = get_trending(niche=niche, market=market, days=days, limit=limit, min_score=min_score)
        return {
            "count": len(ads),
            "filters": {"niche": niche, "market": market, "days": days},
            "ads": ads,
        }
    except Exception as e:
        log.error(f"Trending API error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/stats")
async def spy_stats(days: int = Query(7)):
    """Get overview stats for Ads Spy dashboard."""
    try:
        stats = get_stats(days=days)
        return stats
    except Exception as e:
        log.error(f"Stats API error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/niches")
async def available_niches():
    """List available niches and their keywords."""
    return {
        "niches": list(cfg.NICHES.keys()),
        "markets": cfg.MARKETS,
        "keyword_counts": {k: len(v) for k, v in cfg.NICHES.items()},
    }


@router.get("/analyze/{ad_id}")
async def analyze_ad(ad_id: str):
    """Run AI analysis on a specific ad."""
    from google.cloud import bigquery
    client = bigquery.Client(project=cfg.PROJECT)

    # Fetch ad data
    q = f"SELECT * FROM `{cfg.TABLE_ADS}` WHERE ad_id = '{ad_id}' LIMIT 1"
    rows = list(client.query(q))
    if not rows:
        raise HTTPException(status_code=404, detail=f"Ad {ad_id} not found")

    ad = dict(rows[0])
    analyzer = AIAnalyzer()
    analysis = analyzer.analyze_ad(ad)

    return {
        "ad_id": ad_id,
        "ad": ad,
        "analysis": analysis,
    }


@router.post("/sync")
async def trigger_sync():
    """Trigger a manual sync (runs in background)."""
    import threading
    from faos_brain.ads_spy.scheduler import run_daily_sync

    def _run():
        try:
            run_daily_sync()
        except Exception as e:
            log.error(f"Manual sync failed: {e}")

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()

    return {"status": "started", "message": "Sync started in background"}


@router.get("/trend-summary")
async def trend_summary(
    niche: Optional[str] = Query(None),
    market: Optional[str] = Query(None),
    days: int = Query(7),
):
    """Generate trend summary from BQ data — works without scorer/ai_analyzer."""
    from google.cloud import bigquery
    client = bigquery.Client(project=cfg.PROJECT)

    try:
        # Build filters
        filters = [f"DATE_DIFF(CURRENT_DATE(), started_at, DAY) <= {days}"]
        if niche and niche != "all":
            filters.append(f"niche = '{niche}'")
        if market and market != "all":
            filters.append(f"market = '{market}'")
        where = " AND ".join(filters)

        # Get top ads
        q_ads = f"""
        SELECT ad_id, page_name, headline, niche, market, 
               duration_days, hot_score, platforms
        FROM `{cfg.TABLE_ADS}`
        WHERE {where}
        ORDER BY hot_score DESC
        LIMIT 15
        """
        ads = [dict(r) for r in client.query(q_ads).result()]

        if not ads:
            return {"summary": "⚠️ Không có dữ liệu ads trong khoảng thời gian này. Thử mở rộng filter hoặc sync dữ liệu mới.", "ads_analyzed": 0}

        # Get aggregate stats
        q_stats = f"""
        SELECT 
            COUNT(*) as total_ads,
            COUNTIF(hot_score >= 80) as hot_ads,
            ROUND(AVG(duration_days), 1) as avg_duration,
            ROUND(AVG(hot_score), 1) as avg_score,
            MAX(duration_days) as max_duration
        FROM `{cfg.TABLE_ADS}`
        WHERE {where}
        """
        stats = dict(list(client.query(q_stats).result())[0])

        # Niche breakdown
        q_niches = f"""
        SELECT niche, COUNT(*) as cnt, ROUND(AVG(hot_score),1) as avg_score,
               COUNTIF(hot_score >= 80) as hot_cnt
        FROM `{cfg.TABLE_ADS}`
        WHERE {where} AND niche IS NOT NULL
        GROUP BY niche ORDER BY cnt DESC LIMIT 5
        """
        niches = [dict(r) for r in client.query(q_niches).result()]

        # Build summary
        lines = []
        lines.append(f"📊 **Phân tích xu hướng {days} ngày qua** ({market or 'Tất cả'} | {niche or 'Tất cả'})")
        lines.append("")
        lines.append(f"━━━ TỔNG QUAN ━━━")
        lines.append(f"• {stats['total_ads']} ads đang chạy | {stats['hot_ads']} ads HOT 🔥")
        lines.append(f"• Thời gian chạy TB: {stats['avg_duration']} ngày (max: {stats['max_duration']} ngày)")
        lines.append(f"• Hot Score TB: {stats['avg_score']}/100")
        lines.append("")

        if niches:
            lines.append("━━━ NICHE BREAKDOWN ━━━")
            for n in niches:
                emoji = "🔥" if n['hot_cnt'] > 0 else "📌"
                lines.append(f"{emoji} {n['niche']}: {n['cnt']} ads (score TB: {n['avg_score']}, {n['hot_cnt']} HOT)")
            lines.append("")

        lines.append("━━━ TOP ADS ━━━")
        for i, ad in enumerate(ads[:5], 1):
            hot = "🔥" if (ad.get("hot_score") or 0) >= 80 else "📌"
            headline = (ad.get("headline") or "N/A")[:60]
            lines.append(f"{i}. {hot} {ad.get('page_name', 'N/A')} — {headline}")
            lines.append(f"   ⏱ {ad.get('duration_days', 0)} ngày | Score: {ad.get('hot_score', 0)} | {ad.get('market', '?')}")
        lines.append("")

        # Recommendations
        lines.append("━━━ KHUYẾN NGHỊ ━━━")
        if stats['hot_ads'] > 0:
            lines.append(f"✅ Có {stats['hot_ads']} ads HOT — nên clone style của top performers")
        if niches and niches[0]['cnt'] > 2:
            lines.append(f"💡 Niche '{niches[0]['niche']}' đang dẫn đầu với {niches[0]['cnt']} ads")
        if stats['avg_duration'] > 5:
            lines.append(f"⏱ Ads chạy TB {stats['avg_duration']} ngày — thị trường đang ổn định")
        else:
            lines.append(f"⚡ Ads chạy TB chỉ {stats['avg_duration']} ngày — market biến động nhanh")

        summary = "\n".join(lines)
        return {"summary": summary, "ads_analyzed": len(ads)}

    except Exception as e:
        log.error(f"Trend summary error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/clone-brief/{ad_id}")
async def clone_brief(ad_id: str):
    """
    Generate an actionable clone brief for a winning ad.
    Returns structured data the team can use to replicate the ad.
    """
    from google.cloud import bigquery
    client = bigquery.Client(project=cfg.PROJECT)

    # Fetch ad data
    q = f"SELECT * FROM `{cfg.TABLE_ADS}` WHERE ad_id = '{ad_id}' LIMIT 1"
    rows = list(client.query(q))
    if not rows:
        raise HTTPException(status_code=404, detail=f"Ad {ad_id} not found")

    ad = dict(rows[0])
    return await _generate_clone_brief(ad_id, ad)


@router.post("/clone-brief")
async def clone_brief_post(body: dict):
    """
    Generate clone brief from ad data sent directly (for live-scraped ads).
    Accepts: { ad_id, page_name, ad_text, headline, market, niche, duration_days, hot_score, ... }
    """
    ad_id = body.get("ad_id", "unknown")
    return await _generate_clone_brief(ad_id, body)


async def _generate_clone_brief(ad_id: str, ad: dict):
    """Shared logic for generating clone brief from ad data."""
    analyzer = _get_analyzer()

    # First get base analysis
    analysis = {}
    if analyzer:
        analysis = analyzer.analyze_ad(ad) or {}

    # Build clone brief using LLM
    clone_prompt = f"""Bạn là Creative Director chuyên Facebook/TikTok Ads cho thị trường AU/US (COD e-commerce).

Phân tích quảng cáo đang chạy WIN sau và tạo Clone Brief cụ thể cho team:

**Ad Data:**
- Page: {ad.get('page_name', '')}
- Market: {ad.get('market', '')} | Niche: {ad.get('niche', '')}
- Running: {ad.get('duration_days', 0)} ngày (long-running = winning ad)
- Headline: {str(ad.get('headline', ''))[:200]}
- Ad text: {str(ad.get('ad_text', ''))[:400]}
- Hot Score: {ad.get('hot_score', 0)}
- Platform: {ad.get('platforms', ad.get('source', ''))}

**Viết Clone Brief theo JSON format:**
{{
  "hook_idea": "Ý tưởng hook 3 giây đầu cụ thể cho thị trường {ad.get('market', 'AU/US')} (viết bằng tiếng Anh vì thị trường Úc/Mỹ)",
  "hook_type": "before_after | testimonial | problem_solution | urgency | social_proof",
  "body_structure": "Cấu trúc nội dung: Pain point → Solution → Proof → CTA",
  "cta_text": "CTA text gợi ý bằng tiếng Anh",
  "target_audience": "Target audience AU/US cụ thể (age, gender, interests)",
  "caption_template": "Template caption Facebook/TikTok Ads bằng tiếng Anh (2-3 câu ngắn gọn)",
  "key_message": "Key message chính cần truyền tải",
  "video_concept": "Concept video/image ngắn gọn để brief cho editor",
  "why_it_works": "Lý do tại sao ad này đang win (1-2 câu)"
}}"""

    brief = {}
    if analyzer and hasattr(analyzer, 'llm') and analyzer.llm:
        try:
            import json
            response = analyzer.llm.chat(clone_prompt, model=cfg.AI.model, max_tokens=1200)
            text = response if isinstance(response, str) else str(response)
            if "```json" in text:
                text = text.split("```json")[1].split("```")[0]
            elif "```" in text:
                text = text.split("```")[1].split("```")[0]
            brief = json.loads(text.strip())
        except Exception as e:
            log.error(f"Clone brief generation failed: {e}")
            # Fallback: use base analysis fields
            brief = {
                "hook_type": analysis.get("hook_type", ""),
                "cta_text": analysis.get("cta_style", ""),
                "target_audience": analysis.get("target_demo", ""),
                "key_message": analysis.get("recommendation", ""),
                "why_it_works": f"Running {ad.get('duration_days', 0)} days with hot_score {ad.get('hot_score', 0)}",
            }

    return {
        "ad_id": ad_id,
        "ad": {
            "page_name": ad.get("page_name"),
            "market": ad.get("market"),
            "niche": ad.get("niche"),
            "duration_days": ad.get("duration_days"),
            "hot_score": ad.get("hot_score"),
            "headline": ad.get("headline"),
            "ad_url": ad.get("ad_url"),
        },
        "analysis": analysis,
        "clone_brief": brief,
    }


@router.get("/swipe-file")
async def get_swipe_file(market: Optional[str] = Query(None), limit: int = Query(20)):
    """Get top winning ads as a swipe file — sorted by hot_score, long-running only."""
    try:
        conditions = ["duration_days >= 7", "hot_score > 0"]
        if market:
            conditions.append(f"market = '{market}'")
        where = " AND ".join(conditions)

        from google.cloud import bigquery
        client = bigquery.Client(project=cfg.PROJECT)
        q = f"""
        SELECT ad_id, page_name, headline, ad_text, ad_url, market, niche,
               duration_days, hot_score, creative_type, likes, source, sync_date
        FROM `{cfg.TABLE_ADS}`
        WHERE {where}
        ORDER BY hot_score DESC, duration_days DESC
        LIMIT {limit}
        """
        rows = [dict(r) for r in client.query(q)]
        return {"count": len(rows), "ads": rows}
    except Exception as e:
        log.error(f"Swipe file error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

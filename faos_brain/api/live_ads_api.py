"""
Live Ads Search API — Real-time search from Facebook Ad Library + TikTok Creative Center.

v2: Uses Meta Graph API for Facebook (reliable), falls back to Playwright.
    Gemini-powered enrichment for niche classification & ad analysis.

Endpoints:
    GET /api/live-ads/search        — Search ads across platforms
    GET /api/live-ads/facebook      — Search Facebook Ad Library (Graph API + Playwright fallback)
    GET /api/live-ads/tiktok        — Search TikTok Creative Center  
"""
from __future__ import annotations

import logging
from typing import List, Optional
from fastapi import APIRouter, Query
from pydantic import BaseModel

log = logging.getLogger("live_ads")
router = APIRouter(prefix="/api/live-ads", tags=["live-ads"])


NICHE_KEYWORDS = {
    "jewelry": "jade bracelet necklace ring",
    "beauty": "skincare serum whitening cream",
    "health": "vitamin supplement collagen protein",
    "all": "trending products health beauty",
}


@router.get("/tiktok")
async def search_tiktok(
    country: str = Query("US"),
    niche: str = Query("all"),
    limit: int = Query(20),
):
    """Scrape TikTok Creative Center for top ads (real-time via Playwright)."""
    try:
        from faos_brain.ads_spy.live_scraper import get_cached_or_scrape
        ads = await get_cached_or_scrape(
            "tiktok",
            country=country,
            niche=niche,
            limit=limit,
        )
        return {"ads": ads, "total": len(ads), "source": "tiktok_cc"}
    except Exception as e:
        log.error(f"TikTok scrape error: {e}")
        return {"ads": [], "total": 0, "source": "tiktok_cc", "error": str(e)}


@router.get("/facebook")
async def search_facebook(
    keyword: str = Query(""),
    country: str = Query("US"),
    niche: str = Query("all"),
    limit: int = Query(50),
    media_type: str = Query("all", description="all | video | image"),
    search_type: str = Query("keyword_unordered", description="keyword_unordered | keyword_exact"),
    scroll_rounds: int = Query(5, description="Number of scroll rounds (1-10) — Playwright only"),
    enrich: bool = Query(True, description="Use Gemini AI to enrich ad data"),
):
    """
    Search Facebook Ad Library for ads (real-time).
    
    v2: Uses Meta Graph API first (fast, reliable), falls back to 
    Playwright headless browser if API returns no results.
    Optional Gemini AI enrichment for niche classification.
    """
    search = keyword if keyword else NICHE_KEYWORDS.get(niche, "trending products")
    scroll_rounds = max(1, min(scroll_rounds, 10))
    
    try:
        # ─── Strategy 1: Meta Graph API (preferred) ───
        from faos_brain.ads_spy.fb_ad_library_api import search_fb_ads_cached
        result = await search_fb_ads_cached(
            keyword=search,
            country=country,
            limit=limit,
            media_type=media_type,
            search_type=search_type,
            enrich=enrich,
        )
        
        if result.get("ads"):
            log.info(f"FB Graph API: {result['total']} ads for '{search}' (method: {result.get('method', 'unknown')})")
            return result
        
        # ─── Strategy 2: Playwright fallback ───
        log.info(f"Graph API returned 0 results, trying Playwright for '{search}'")
        from faos_brain.ads_spy.live_scraper import get_cached_or_scrape
        ads = await get_cached_or_scrape(
            "facebook",
            keyword=search,
            country=country,
            limit=limit,
            media_type=media_type,
            search_type=search_type,
            scroll_rounds=scroll_rounds,
        )
        
        # Enrich with Gemini if enabled
        if enrich and ads:
            try:
                from faos_brain.ads_spy.fb_ad_library_api import enrich_ads_with_gemini
                ads = await enrich_ads_with_gemini(ads)
            except Exception as e:
                log.warning(f"Gemini enrichment failed: {e}")
        
        return {
            "ads": ads,
            "total": len(ads),
            "source": "fb_library",
            "method": "playwright",
        }
        
    except Exception as e:
        log.error(f"FB search error: {e}")
        return {"ads": [], "total": 0, "source": "fb_library", "error": str(e)}


@router.get("/search")
async def live_search(
    keyword: str = Query("", description="Search keyword"),
    source: str = Query("all", description="fb_library | tiktok | all"),
    country: str = Query("US"),
    niche: str = Query("all"),
    limit: int = Query(20),
    enrich: bool = Query(True, description="Use Gemini AI to enrich data"),
):
    """Search ads live from both platforms."""
    results = {"facebook": [], "tiktok": [], "total": 0, "sources_searched": []}

    if source in ("all", "fb_library", "facebook"):
        search = keyword if keyword else NICHE_KEYWORDS.get(niche, "trending products")
        try:
            from faos_brain.ads_spy.fb_ad_library_api import search_fb_ads_cached
            fb_result = await search_fb_ads_cached(
                keyword=search,
                country=country,
                limit=limit,
                enrich=enrich,
            )
            results["facebook"] = fb_result.get("ads", [])
            results["sources_searched"].append("facebook")
        except Exception as e:
            log.error(f"FB search error: {e}")
            # Fallback to Playwright
            try:
                from faos_brain.ads_spy.live_scraper import get_cached_or_scrape
                results["facebook"] = await get_cached_or_scrape(
                    "facebook", keyword=search, country=country, limit=limit
                )
                results["sources_searched"].append("facebook_playwright")
            except Exception as e2:
                log.error(f"FB Playwright fallback error: {e2}")

    if source in ("all", "tiktok", "tiktok_cc"):
        try:
            from faos_brain.ads_spy.live_scraper import get_cached_or_scrape
            results["tiktok"] = await get_cached_or_scrape(
                "tiktok", country=country, niche=niche, limit=limit
            )
            results["sources_searched"].append("tiktok")
        except Exception as e:
            log.error(f"TikTok search error: {e}")

    results["total"] = len(results["facebook"]) + len(results["tiktok"])
    return results


class LiveAdItem(BaseModel):
    page_name: Optional[str] = None
    headline: Optional[str] = None
    ad_text: Optional[str] = None
    hot_score: Optional[float] = 0.0

class LiveTrendRequest(BaseModel):
    ads: List[LiveAdItem]
    keyword: Optional[str] = None

@router.post("/trend-summary")
async def live_trend_summary(req: LiveTrendRequest):
    """Generate AI trend summary from live ads fetched by the client."""
    ads = req.ads
    # Take top 15 based on hot_score
    ads = sorted(ads, key=lambda x: x.hot_score or 0, reverse=True)[:15]
    if not ads:
        return {"summary": "⚠️ Không có đủ dữ liệu ads để phân tích xu hướng.", "ads_analyzed": 0}

    prompt = f"Analyze these {len(ads)} winning ads.\n"
    if req.keyword:
        prompt += f"Context: User searched for '{req.keyword}'.\n"
    prompt += """
Based on the ad text and headlines, please provide a concise 'Trend Summary' (in Vietnamese) covering:
1. Common Hooks/Angles used to capture attention (Mồi câu phổ biến).
2. Main pain points addressed (Nỗi đau khách hàng).
3. The overarching trend or winning formula (Công thức chiến thắng chung).

Ads Data:
"""
    for i, ad in enumerate(ads):
        page = ad.page_name or "Unknown Page"
        headline = ad.headline or ""
        text = ad.ad_text or ""
        # Limit text length to avoid token explosion
        prompt += f"\n--- Ad {i+1} ---\nPage: {page}\nHeadline: {headline}\nText: {text[:500]}...\n"

    import os
    import httpx
    import faos_brain.core.config as cfg
    
    api_key = os.getenv("GEMINI_API_KEY", cfg.GEMINI_API_KEY)
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.7, "maxOutputTokens": 800}
    }
    
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(url, json=payload, timeout=30.0)
            data = resp.json()
            if "candidates" in data:
                text = data["candidates"][0]["content"]["parts"][0]["text"]
                return {"summary": text, "ads_analyzed": len(ads)}
            else:
                log.error(f"Gemini API error: {data}")
                return {"summary": f"⚠️ Lỗi từ AI: Không thể phân tích.", "ads_analyzed": len(ads)}
    except Exception as e:
        log.error(f"Gemini connection error: {e}")
        return {"summary": f"⚠️ Lỗi kết nối AI: {str(e)}", "ads_analyzed": 0}


"""
Facebook Ad Library API — Direct Meta Graph API integration.

Uses Meta's official Graph API endpoint (ads_archive) for reliable,
real-time ad library data. Falls back to Playwright scraping if API fails.

Optional: Gemini-powered enrichment — auto-classify niche, generate hooks.
"""
import asyncio
import json
import logging
import os
import re
import time
from datetime import datetime
from typing import Any, Dict, List, Optional

import httpx

# Load .env for META_ACCESS_TOKEN and GEMINI_API_KEY
try:
    from dotenv import load_dotenv
    # Try project root .env
    _env_path = os.path.join(os.path.dirname(__file__), "..", "..", ".env")
    if os.path.exists(_env_path):
        load_dotenv(_env_path, override=False)
except ImportError:
    pass

log = logging.getLogger("fb_ad_library_api")

# ═══════════════════════════════════════════
# Meta Graph API — ads_archive endpoint
# ═══════════════════════════════════════════

GRAPH_API_VERSION = "v21.0"
GRAPH_API_BASE = f"https://graph.facebook.com/{GRAPH_API_VERSION}"
ADS_ARCHIVE_ENDPOINT = f"{GRAPH_API_BASE}/ads_archive"

# Fields we want from the API
AD_FIELDS = [
    "id",
    "ad_creation_time",
    "ad_creative_bodies",
    "ad_creative_link_captions",
    "ad_creative_link_descriptions",
    "ad_creative_link_titles",
    "ad_delivery_start_time",
    "ad_delivery_stop_time",
    "ad_snapshot_url",
    "bylines",
    "currency",
    "delivery_by_region",
    "estimated_audience_size",
    "impressions",
    "languages",
    "page_id",
    "page_name",
    "publisher_platforms",
    "spend",
]


def _get_access_token() -> str:
    """Get Meta access token from environment."""
    return (
        os.getenv("META_ACCESS_TOKEN", "")
        or os.getenv("AUUS1_META_ACCESS_TOKEN", "")
    )


async def search_fb_ad_library_api(
    keyword: str = "necklace",
    country: str = "US",
    limit: int = 50,
    media_type: str = "all",
    search_type: str = "keyword_unordered",
    active_status: str = "active",
) -> Dict[str, Any]:
    """
    Search Facebook Ad Library using Meta's Graph API.
    
    Returns:
        Dict with 'ads' list and metadata
    """
    access_token = _get_access_token()
    if not access_token:
        log.warning("META_ACCESS_TOKEN not set, cannot use Graph API")
        return {"ads": [], "total": 0, "source": "fb_library_api", "error": "META_ACCESS_TOKEN not configured"}

    params = {
        "access_token": access_token,
        "search_terms": keyword,
        "ad_reached_countries": f'["{country}"]',
        "ad_type": "POLITICAL_AND_ISSUE_ADS",  # Will also try ALL below
        "fields": ",".join(AD_FIELDS),
        "limit": min(limit, 50),  # API max per page
        "search_type": search_type,
    }

    # Filter by active status
    if active_status == "active":
        params["ad_active_status"] = "ACTIVE"
    
    # Media type filter
    if media_type == "video":
        params["media_type"] = "VIDEO"
    elif media_type == "image":
        params["media_type"] = "IMAGE"

    all_ads = []
    next_url = None

    async with httpx.AsyncClient(timeout=30) as client:
        # Try with ad_type=ALL first (commercial ads)
        for ad_type in ["ALL", "POLITICAL_AND_ISSUE_ADS"]:
            if all_ads:
                break  # Got results, no need to try other types
            
            params["ad_type"] = ad_type
            try:
                response = await client.get(ADS_ARCHIVE_ENDPOINT, params=params)
                
                if response.status_code == 200:
                    data = response.json()
                    raw_ads = data.get("data", [])
                    log.info(f"FB Ad Library API ({ad_type}): got {len(raw_ads)} ads for '{keyword}'")
                    
                    for raw in raw_ads:
                        ad = _parse_graph_api_ad(raw, country)
                        if ad:
                            all_ads.append(ad)
                    
                    # Pagination — fetch more pages if needed
                    next_url = data.get("paging", {}).get("next")
                    page_count = 1
                    while next_url and len(all_ads) < limit and page_count < 5:
                        try:
                            page_resp = await client.get(next_url)
                            if page_resp.status_code == 200:
                                page_data = page_resp.json()
                                page_ads = page_data.get("data", [])
                                for raw in page_ads:
                                    ad = _parse_graph_api_ad(raw, country)
                                    if ad:
                                        all_ads.append(ad)
                                next_url = page_data.get("paging", {}).get("next")
                                page_count += 1
                                log.info(f"FB API page {page_count}: +{len(page_ads)} ads (total: {len(all_ads)})")
                            else:
                                break
                        except Exception as e:
                            log.warning(f"FB API pagination error: {e}")
                            break
                            
                elif response.status_code == 400:
                    error_data = response.json()
                    error_msg = error_data.get("error", {}).get("message", "Unknown error")
                    log.warning(f"FB API error ({ad_type}): {error_msg}")
                    # Continue to try next ad_type
                else:
                    log.warning(f"FB API HTTP {response.status_code}: {response.text[:200]}")
                    
            except Exception as e:
                log.error(f"FB Ad Library API error: {e}")

    # If API returned no results, fallback to Playwright scraper
    if not all_ads:
        log.info("Graph API returned no results, falling back to Playwright scraper")
        try:
            from faos_brain.ads_spy.live_scraper import scrape_fb_ad_library
            all_ads = await scrape_fb_ad_library(
                keyword=keyword,
                country=country,
                limit=limit,
                media_type=media_type,
                search_type=search_type,
            )
            return {
                "ads": all_ads[:limit],
                "total": len(all_ads),
                "source": "fb_library_playwright",
                "method": "playwright_fallback",
            }
        except Exception as e:
            log.error(f"Playwright fallback also failed: {e}")
            return {"ads": [], "total": 0, "source": "fb_library", "error": str(e)}

    # Deduplicate by creative and count adsets
    grouped_ads = {}
    for ad in all_ads:
        # Signature: Page name + first 50 chars of ad text + first 50 chars of headline
        page = ad.get("page_name", "")
        text = ad.get("ad_text", "")[:50]
        headline = ad.get("headline", "")[:50]
        sig = f"{page}_{text}_{headline}"
        
        if sig in grouped_ads:
            grouped_ads[sig]["num_adsets"] = grouped_ads[sig].get("num_adsets", 1) + 1
        else:
            ad["num_adsets"] = 1
            grouped_ads[sig] = ad
            
    unique_ads = list(grouped_ads.values())
    
    # Boost hot_score for scaled ads to sort winning ads first
    for ad in unique_ads:
        if ad.get("num_adsets", 1) > 1:
            ad["hot_score"] = ad.get("hot_score", 0) + (ad["num_adsets"] * 5)
            
    # Sort by the enhanced hot_score
    unique_ads = sorted(unique_ads, key=lambda x: x.get("hot_score", 0), reverse=True)
            
    # Concurrently enrich all valid ads with media extracted from their snapshot
    async def enrich_ad_media(ad):
        if ad.get("ad_snapshot_url"):
            media = await _extract_media_from_snapshot(ad["ad_snapshot_url"], access_token)
            ad["cover_url"] = media.get("cover_url", "")
            ad["video_url"] = media.get("video_url", "")
            if ad["video_url"]:
                ad["creative_type"] = "video"
                
    if unique_ads and access_token:
        await asyncio.gather(*(enrich_ad_media(ad) for ad in unique_ads[:limit]))
    
    return {
        "ads": unique_ads[:limit],
        "total": len(unique_ads),
        "source": "fb_library_api",
        "method": "graph_api",
    }


def _parse_graph_api_ad(raw: dict, country: str = "US") -> Optional[Dict]:
    """Parse a single ad from Meta Graph API response."""
    ad_id = raw.get("id", "")
    if not ad_id:
        return None

    page_name = raw.get("page_name", "Unknown")
    page_id = raw.get("page_id", "")
    
    # Ad text — from ad_creative_bodies
    bodies = raw.get("ad_creative_bodies", [])
    ad_text = bodies[0] if bodies else ""
    
    # Headline — from link titles
    titles = raw.get("ad_creative_link_titles", [])
    headline = titles[0] if titles else ""
    
    # Link descriptions
    descriptions = raw.get("ad_creative_link_descriptions", [])
    link_desc = descriptions[0] if descriptions else ""
    
    # Link captions (usually the domain)
    captions = raw.get("ad_creative_link_captions", [])
    landing_domain = captions[0] if captions else ""
    
    # Dates
    started = raw.get("ad_delivery_start_time", raw.get("ad_creation_time", ""))
    if started and len(started) > 10:
        started = started[:10]
    
    stopped = raw.get("ad_delivery_stop_time", "")
    is_active = not bool(stopped)
    
    # Duration
    duration = 1
    if started:
        try:
            start_dt = datetime.strptime(started[:10], "%Y-%m-%d")
            duration = max((datetime.utcnow() - start_dt).days, 1)
        except Exception:
            pass
    
    # Platforms
    platforms_raw = raw.get("publisher_platforms", [])
    platforms = ",".join(platforms_raw) if platforms_raw else "facebook"
    
    # Spend & Impressions
    spend = raw.get("spend", {})
    spend_lower = int(spend.get("lower_bound", 0)) if isinstance(spend, dict) else 0
    spend_upper = int(spend.get("upper_bound", 0)) if isinstance(spend, dict) else 0
    
    impressions = raw.get("impressions", {})
    imp_lower = int(impressions.get("lower_bound", 0)) if isinstance(impressions, dict) else 0
    imp_upper = int(impressions.get("upper_bound", 0)) if isinstance(impressions, dict) else 0
    
    # Audience size
    audience = raw.get("estimated_audience_size", {})
    audience_lower = int(audience.get("lower_bound", 0)) if isinstance(audience, dict) else 0
    audience_upper = int(audience.get("upper_bound", 0)) if isinstance(audience, dict) else 0
    
    # Languages
    languages = raw.get("languages", [])
    
    # Bylines (advertiser name when different from page)
    bylines = raw.get("bylines", "")
    
    # Hot score — based on spend + duration + impressions
    avg_spend = (spend_lower + spend_upper) / 2 if spend_upper else 0
    avg_impressions = (imp_lower + imp_upper) / 2 if imp_upper else 0
    hot_score = int(
        min(duration * 2, 30) +  # Longevity bonus (max 30)
        min(avg_spend / 10, 40) +  # Spend signal (max 40)
        min(avg_impressions / 1000, 30)  # Reach signal (max 30)
    )
    hot_score = max(hot_score, duration * 2)  # At minimum, use duration

    return {
        "ad_id": f"fb_lib_{ad_id}",
        "library_id": ad_id,
        "page_name": page_name,
        "page_id": page_id,
        "headline": headline,
        "ad_text": ad_text[:500],
        "link_description": link_desc[:200],
        "landing_domain": landing_domain,
        "platforms": platforms,
        "started_at": started,
        "duration_days": duration,
        "is_active": is_active,
        "source": "fb_library",
        "likes": 0,
        "comments": 0,
        "shares": 0,
        "hot_score": hot_score,
        "niche": "",
        "market": country,
        "ad_url": f"https://www.facebook.com/ads/library/?id={ad_id}",
        "ad_snapshot_url": raw.get("ad_snapshot_url", ""),
        "cover_url": "",  # Graph API doesn't return creatives directly
        "cta_text": "",
        "landing_url": "",
        "creative_type": "image",  # Default, can be enriched by Gemini
        "num_adsets": 1,
        # ── Rich data from API ──
        "spend_range": f"${spend_lower}-${spend_upper}" if spend_upper else "",
        "impressions_range": f"{imp_lower:,}-{imp_upper:,}" if imp_upper else "",
        "audience_size": f"{audience_lower:,}-{audience_upper:,}" if audience_upper else "",
        "languages": languages,
        "bylines": bylines,
        "currency": raw.get("currency", "USD"),
    }

async def _extract_media_from_snapshot(snapshot_url: str, token: str) -> dict:
    """Extract raw image and video URLs directly from the HTML payload of the ad snapshot."""
    if not snapshot_url:
        return {}
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(snapshot_url, params={"access_token": token})
            if resp.status_code == 200:
                html = resp.text
                
                # Search for video matching
                video_match = re.search(r'"video_hd_url"\s*:\s*"(.*?)"', html) or re.search(r'"video_url"\s*:\s*"(.*?)"', html)
                video_url = video_match.group(1).replace('\\/', '/') if video_match else ""
                
                # Search for image matching
                img_match = re.search(r'"resized_image_url"\s*:\s*"(.*?)"', html) or re.search(r'"original_image_url"\s*:\s*"(.*?)"', html)
                img_url = img_match.group(1).replace('\\/', '/') if img_match else ""
                
                return {"cover_url": img_url, "video_url": video_url}
    except Exception as e:
        log.warning(f"Failed to extract media from snapshot {snapshot_url}: {e}")
    return {}



# ═══════════════════════════════════════════
# Gemini-powered enrichment
# ═══════════════════════════════════════════

async def enrich_ads_with_gemini(
    ads: List[Dict],
    max_ads: int = 20,
) -> List[Dict]:
    """
    Use Gemini to auto-classify niche, detect creative type,
    and add marketing insights for each ad.
    """
    api_key = os.getenv("GEMINI_API_KEY", "")
    if not api_key or not ads:
        return ads

    # Only enrich first N ads to save API calls
    to_enrich = ads[:max_ads]
    
    # Build a single batch prompt for efficiency
    ad_summaries = []
    for i, ad in enumerate(to_enrich):
        ad_summaries.append(
            f"Ad {i+1}: Page='{ad.get('page_name','')}' | "
            f"Headline='{ad.get('headline','')}' | "
            f"Text='{ad.get('ad_text','')[:150]}' | "
            f"Landing='{ad.get('landing_domain','')}'"
        )
    
    prompt = f"""Analyze these {len(ad_summaries)} Facebook ads and return a JSON array with one object per ad.
Each object should have:
- "niche": one of ["jewelry", "beauty", "health", "fashion", "electronics", "home", "food", "other"]
- "creative_type_guess": "video" or "image" (guess based on the text/product)
- "hook_quality": 1-10 rating of the headline/hook
- "target_audience": brief description (e.g. "Women 25-45, interested in skincare")

Ads:
{chr(10).join(ad_summaries)}

Return ONLY the JSON array, no markdown, no code blocks."""

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={api_key}",
                json={
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {"temperature": 0.2},
                },
            )
            
            if response.status_code == 200:
                result = response.json()
                text = result.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
                
                # Parse JSON from response
                text = text.strip()
                if text.startswith("```"):
                    text = text.split("\n", 1)[1] if "\n" in text else text
                    text = text.rsplit("```", 1)[0]
                
                enrichments = json.loads(text)
                
                if isinstance(enrichments, list):
                    for i, enrichment in enumerate(enrichments):
                        if i < len(to_enrich):
                            if enrichment.get("niche"):
                                to_enrich[i]["niche"] = enrichment["niche"]
                            if enrichment.get("creative_type_guess"):
                                to_enrich[i]["creative_type"] = enrichment["creative_type_guess"]
                            if enrichment.get("hook_quality"):
                                to_enrich[i]["hook_quality"] = enrichment["hook_quality"]
                            if enrichment.get("target_audience"):
                                to_enrich[i]["target_audience_guess"] = enrichment["target_audience"]
                    
                    log.info(f"Gemini enriched {len(enrichments)} ads")
            else:
                log.warning(f"Gemini API error: {response.status_code} — {response.text[:200]}")
                
    except Exception as e:
        log.warning(f"Gemini enrichment failed (non-blocking): {e}")
    
    return ads


# ═══════════════════════════════════════════
# Cache layer
# ═══════════════════════════════════════════

_api_cache: Dict[str, Any] = {}
API_CACHE_TTL = 180  # 3 minutes


async def search_fb_ads_cached(
    keyword: str = "necklace",
    country: str = "US",
    limit: int = 50,
    media_type: str = "all",
    enrich: bool = True,
    **kwargs,
) -> Dict[str, Any]:
    """Search FB Ad Library with caching and optional Gemini enrichment."""
    cache_key = f"fb_api:{keyword}:{country}:{limit}:{media_type}"
    now = time.time()
    
    if cache_key in _api_cache and now - _api_cache[cache_key]["ts"] < API_CACHE_TTL:
        log.info(f"Cache hit: {cache_key}")
        return _api_cache[cache_key]["data"]
    
    result = await search_fb_ad_library_api(
        keyword=keyword,
        country=country,
        limit=limit,
        media_type=media_type,
        **kwargs,
    )
    
    # Enrich with Gemini if we have results
    if enrich and result.get("ads"):
        result["ads"] = await enrich_ads_with_gemini(result["ads"])
    
    _api_cache[cache_key] = {"data": result, "ts": now}
    return result

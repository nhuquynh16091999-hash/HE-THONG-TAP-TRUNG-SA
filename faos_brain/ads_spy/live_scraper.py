"""
Live Ad Library Scraper — Uses Playwright headless browser to fetch
real-time data from TikTok Creative Center and Facebook Ad Library.

The browser handles all auth/signatures automatically — we just
intercept the API responses it makes.

v2: Multi-scroll pagination, richer DOM extraction (media, CTA, landing URL),
    media_type filter, user-agent rotation, retry logic.
"""
import asyncio
import json
import logging
import random
import time
from typing import List, Dict, Any, Optional
from datetime import datetime

log = logging.getLogger("live_scraper")

# ═══════════════════════════════════════════
# User-Agent pool for rotation
# ═══════════════════════════════════════════

USER_AGENTS = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
]


def _random_ua() -> str:
    return random.choice(USER_AGENTS)


# ═══════════════════════════════════════════
# TikTok Creative Center — Intercept API
# ═══════════════════════════════════════════

TIKTOK_INDUSTRY_MAP = {
    "jewelry": "291",
    "beauty": "2",
    "health": "3",
}

async def scrape_tiktok_cc(
    country: str = "US",
    niche: str = "all",
    period: int = 30,
    limit: int = 20,
) -> List[Dict[str, Any]]:
    """
    Use Playwright to open TikTok Creative Center, intercept the
    top_ads API response, and return parsed ad data.
    """
    from playwright.async_api import async_playwright

    industry = TIKTOK_INDUSTRY_MAP.get(niche, "")
    url = f"https://ads.tiktok.com/business/creativecenter/inspiration/topads/pad/en?period={period}&region={country}"
    if industry:
        url += f"&industry={industry}"

    captured_ads: List[Dict] = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent=_random_ua(),
            viewport={"width": 1280, "height": 800},
        )
        page = await context.new_page()

        # Intercept API responses
        async def handle_response(response):
            try:
                if "top_ads" in response.url and response.status == 200:
                    ct = response.headers.get("content-type", "")
                    if "json" in ct:
                        body = await response.json()
                        if body.get("code") == 0:
                            materials = body.get("data", {}).get("materials", [])
                            captured_ads.extend(materials)
                            log.info(f"TikTok CC intercepted: {len(materials)} ads")
            except Exception as e:
                log.debug(f"Response intercept error: {e}")

        page.on("response", handle_response)

        try:
            await page.goto(url, wait_until="networkidle", timeout=25000)
            # Wait a bit more for XHR to complete
            await page.wait_for_timeout(3000)
        except Exception as e:
            log.warning(f"TikTok CC page load: {e}")

        await browser.close()

    # Parse and return
    result = []
    seen = set()
    for raw in captured_ads[:limit]:
        ad_id = str(raw.get("id", ""))
        if not ad_id or ad_id in seen:
            continue
        seen.add(ad_id)

        ad_title = raw.get("ad_title", [])
        text = ad_title[0] if isinstance(ad_title, list) and ad_title else str(ad_title or "")

        create_time = raw.get("first_show_time", "")
        duration = 1
        if create_time:
            try:
                start_dt = datetime.fromisoformat(create_time.replace("Z", "+00:00"))
                duration = max((datetime.utcnow() - start_dt.replace(tzinfo=None)).days, 1)
            except Exception:
                pass

        likes = raw.get("like_cnt", 0) or 0
        comments = raw.get("comment_cnt", 0) or 0
        shares = raw.get("share_cnt", 0) or 0

        result.append({
            "ad_id": f"tt_{ad_id}",
            "page_name": raw.get("advertiser_name", "") or raw.get("brand_name", "") or "Unknown",
            "page_id": str(raw.get("advertiser_id", "")),
            "headline": raw.get("brand_name", "") or "",
            "ad_text": text[:300],
            "platforms": "tiktok",
            "started_at": create_time[:10] if create_time and len(create_time) >= 10 else "",
            "duration_days": duration,
            "is_active": True,
            "source": "tiktok_cc",
            "likes": likes,
            "comments": comments,
            "shares": shares,
            "hot_score": likes + comments * 3 + shares * 5,
            "video_url": raw.get("video_url", ""),
            "cover_url": raw.get("cover_url", ""),
            "niche": niche if niche != "all" else "",
            "market": country,
        })

    log.info(f"TikTok CC: {len(result)} unique ads scraped")
    return result


# ═══════════════════════════════════════════
# Facebook Ad Library — Multi-scroll + Rich extraction
# ═══════════════════════════════════════════

async def scrape_fb_ad_library(
    keyword: str = "jade bracelet",
    country: str = "US",
    limit: int = 50,
    media_type: str = "all",
    search_type: str = "keyword_unordered",
    scroll_rounds: int = 5,
) -> List[Dict[str, Any]]:
    """
    Use Playwright to open Facebook Ad Library with multi-scroll
    pagination, richer DOM extraction, and retry logic.
    
    Args:
        keyword: Search term
        country: Country code (US, AU, GB, etc.)
        limit: Max ads to return (default 50)
        media_type: "all" | "video" | "image" — passed to FB URL
        search_type: "keyword_unordered" | "keyword_exact"
        scroll_rounds: Number of scroll iterations (default 5)
    """
    from playwright.async_api import async_playwright

    # Build FB Ad Library URL with filters
    fb_media = {"all": "all", "video": "video", "image": "image"}.get(media_type, "all")
    url = (
        f"https://www.facebook.com/ads/library/"
        f"?active_status=all&ad_type=all&country={country}"
        f"&q={keyword}&media_type={fb_media}&search_type={search_type}"
    )

    captured_raw: List[Dict] = []
    max_retries = 2

    for attempt in range(max_retries + 1):
        try:
            async with async_playwright() as p:
                browser = await p.chromium.launch(headless=True)
                context = await browser.new_context(
                    user_agent=_random_ua(),
                    viewport={"width": 1280, "height": 900},
                    locale="en-US",
                )
                page = await context.new_page()

                # Intercept all responses for ad data
                async def handle_response(response):
                    try:
                        url_str = response.url
                        ct = response.headers.get("content-type", "")

                        is_graphql = "graphql" in url_str or "api/graphql" in url_str
                        is_ad_api = "ads/library/async" in url_str or "ad_library" in url_str

                        if (is_graphql or is_ad_api) and response.status == 200 and ("json" in ct or "text" in ct):
                            try:
                                text = await response.text()
                                for line in text.strip().split("\n"):
                                    line = line.strip()
                                    if not line or not line.startswith("{"):
                                        continue
                                    try:
                                        data = json.loads(line)
                                        _extract_fb_ads_from_json(data, captured_raw)
                                    except json.JSONDecodeError:
                                        pass
                            except Exception:
                                pass
                    except Exception as e:
                        log.debug(f"FB intercept error: {e}")

                page.on("response", handle_response)

                # Navigate with increased timeout
                await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                await page.wait_for_timeout(4000)

                # ─── Multi-scroll pagination ───
                prev_count = 0
                for scroll_i in range(scroll_rounds):
                    # Scroll down
                    await page.evaluate("window.scrollBy(0, window.innerHeight * 2)")
                    await page.wait_for_timeout(2000 + scroll_i * 500)  # Longer wait each round

                    # Extract from DOM after each scroll
                    dom_ads = await _extract_fb_ads_from_dom(page)
                    new_count = len(dom_ads)

                    if dom_ads:
                        captured_raw.extend(dom_ads)
                        log.info(f"FB scroll {scroll_i + 1}/{scroll_rounds}: {new_count} ads from DOM (total raw: {len(captured_raw)})")

                    # Stop early if no new ads appeared
                    if new_count <= prev_count and scroll_i > 0:
                        log.info(f"FB: No new ads after scroll {scroll_i + 1}, stopping early")
                        break
                    prev_count = new_count

                await browser.close()

            # Success — break retry loop
            break

        except Exception as e:
            log.warning(f"FB scrape attempt {attempt + 1}/{max_retries + 1} failed: {e}")
            if attempt < max_retries:
                await asyncio.sleep(3)  # Backoff before retry
            else:
                log.error(f"FB Ad Library scrape failed after {max_retries + 1} attempts")

    # Deduplicate and format
    result = []
    seen = set()
    for raw in captured_raw:
        # Prefer library_id for dedup, fallback to page_name+text
        library_id = raw.get("library_id", "")
        if library_id:
            key = library_id
        else:
            key = raw.get("page_name", "") + ":" + raw.get("ad_text", "")[:50]
        if key in seen or key == ":":
            continue
        seen.add(key)

        ad_text = raw.get("ad_text", "")
        page_name = raw.get("page_name", "Unknown")
        started = raw.get("started_at", "")

        # Calculate duration
        duration = 1
        if started:
            try:
                start_dt = datetime.strptime(started, "%Y-%m-%d")
                duration = max((datetime.utcnow() - start_dt).days, 1)
            except Exception:
                pass

        result.append({
            "ad_id": raw.get("ad_id", f"fb_lib_{len(result)}_{int(time.time())}"),
            "page_name": page_name,
            "page_id": raw.get("page_id", ""),
            "headline": raw.get("headline", ""),
            "ad_text": ad_text[:400],
            "platforms": raw.get("platforms", "facebook"),
            "started_at": started,
            "duration_days": duration,
            "is_active": True,
            "source": "fb_library",
            "likes": 0,
            "comments": 0,
            "shares": 0,
            "hot_score": max(duration * 2, 1) + (raw.get("num_adsets", 1) * 5),  # Longer running + scaled = higher score
            "niche": "",
            "market": country,
            "ad_url": raw.get("ad_url", ""),
            # ── New rich fields ──
            "cover_url": raw.get("cover_url", ""),
            "cta_text": raw.get("cta_text", ""),
            "landing_url": raw.get("landing_url", ""),
            "creative_type": raw.get("creative_type", "image"),
            "num_adsets": raw.get("num_adsets", 1),
        })

        if len(result) >= limit:
            break

    log.info(f"FB Ad Library: {len(result)} ads scraped for '{keyword}'")
    return result


def _extract_fb_ads_from_json(data: dict, results: list, depth: int = 0):
    """Recursively extract ad data from Facebook's nested GraphQL responses."""
    if depth > 8:
        return

    if isinstance(data, dict):
        for key in ("collatedResults", "search_results", "results", "ads", "nodes", "edges"):
            val = data.get(key)
            if isinstance(val, list):
                for item in val:
                    if isinstance(item, dict):
                        ad = _parse_fb_ad_node(item)
                        if ad:
                            results.append(ad)
                        node = item.get("node", item)
                        if isinstance(node, dict) and node is not item:
                            ad = _parse_fb_ad_node(node)
                            if ad:
                                results.append(ad)

        if "data" in data and isinstance(data["data"], dict):
            _extract_fb_ads_from_json(data["data"], results, depth + 1)
        if "payload" in data and isinstance(data["payload"], dict):
            _extract_fb_ads_from_json(data["payload"], results, depth + 1)

        for v in data.values():
            if isinstance(v, dict) and any(k in v for k in ("collatedResults", "search_results", "results", "ads", "nodes", "edges")):
                _extract_fb_ads_from_json(v, results, depth + 1)


def _parse_fb_ad_node(node: dict) -> Optional[Dict]:
    """Try to extract ad info from a single node in FB's response."""
    page_name = (
        node.get("pageName") or
        node.get("page_name") or
        node.get("pageAlias") or
        node.get("snapshot", {}).get("page_name", "") if isinstance(node.get("snapshot"), dict) else "" or
        ""
    )
    ad_text = (
        node.get("body", {}).get("text", "") if isinstance(node.get("body"), dict) else
        node.get("body_text") or
        node.get("ad_creative_bodies", [""])[0] if isinstance(node.get("ad_creative_bodies"), list) and node.get("ad_creative_bodies") else
        node.get("snapshot", {}).get("body", {}).get("text", "") if isinstance(node.get("snapshot"), dict) and isinstance(node.get("snapshot", {}).get("body"), dict) else
        ""
    )
    headline = (
        node.get("title") or
        node.get("link_title") or
        node.get("ad_creative_link_titles", [""])[0] if isinstance(node.get("ad_creative_link_titles"), list) and node.get("ad_creative_link_titles") else
        ""
    )

    started = (
        node.get("startDate") or
        node.get("ad_delivery_start_time") or
        node.get("start_date") or
        node.get("snapshot", {}).get("creation_time", "") if isinstance(node.get("snapshot"), dict) else
        ""
    )
    if isinstance(started, int):
        try:
            started = datetime.fromtimestamp(started).strftime("%Y-%m-%d")
        except Exception:
            started = ""
    elif isinstance(started, str) and len(started) > 10:
        started = started[:10]

    ad_id = str(node.get("adArchiveID") or node.get("ad_archive_id") or node.get("id") or "")

    if not page_name and not ad_text:
        return None

    return {
        "ad_id": f"fb_lib_{ad_id}" if ad_id else "",
        "library_id": ad_id,
        "page_name": str(page_name) if page_name else "Unknown",
        "page_id": str(node.get("pageID") or node.get("page_id") or ""),
        "headline": str(headline) if headline else "",
        "ad_text": str(ad_text) if ad_text else "",
        "started_at": str(started) if started else "",
        "platforms": "facebook",
        "ad_url": f"https://www.facebook.com/ads/library/?id={ad_id}" if ad_id else "",
    }


async def _extract_fb_ads_from_dom(page) -> List[Dict]:
    """Extract ads from the rendered DOM with rich data: media, CTA, landing URL.
    
    v3: Improved video thumbnail extraction — background-image CSS, lenient
    scontent CDN matching, data-src lazy-load fallback, <source> poster detection.
    """
    return await page.evaluate("""() => {
        const ads = [];
        const processedIds = new Set();
        
        // Strategy: find the smallest div that contains exactly ONE "Library ID:"
        const allDivs = Array.from(document.querySelectorAll('div'));
        
        for (const div of allDivs) {
            const text = div.innerText || '';
            
            // Must contain Library ID
            const idMatch = text.match(/Library ID:\\s*(\\d+)/);
            if (!idMatch) continue;
            const libraryId = idMatch[1];
            if (processedIds.has(libraryId)) continue;
            
            // Must be a small div (metadata only, not a big container)
            if (text.length > 500) continue;
            
            // Skip if child div also matches (we want the smallest)
            let hasChildMatch = false;
            for (const child of div.querySelectorAll('div')) {
                if (child !== div && (child.innerText || '').includes('Library ID: ' + libraryId)) {
                    hasChildMatch = true;
                    break;
                }
            }
            if (hasChildMatch) continue;
            
            processedIds.add(libraryId);
            
            // Extract start date
            let startDate = '';
            const dateMatch = text.match(/Started running on (.+?)(?:\\n|$)/);
            if (dateMatch) {
                try {
                    const d = new Date(dateMatch[1].trim());
                    if (!isNaN(d.getTime())) {
                        startDate = d.toISOString().split('T')[0];
                    }
                } catch(e) {}
            }
            
            // Extract platforms (e.g. "Facebook, Instagram, Messenger")
            let platforms = 'facebook';
            const platMatch = text.match(/Platforms?[:\\s]+(.+?)(?:\\n|$)/i);
            if (platMatch) {
                platforms = platMatch[1].trim().toLowerCase().replace(/,\\s+/g, ',');
            }
            
            // Walk up to find the card wrapper
            let container = div.parentElement;
            let pageName = '';
            let adBody = '';
            let coverUrl = '';
            let ctaText = '';
            let landingUrl = '';
            let creativeType = 'image';
            
            for (let i = 0; i < 8 && container; i++) {
                const cText = container.innerText || '';
                
                // Extract "X ads use this creative and text"
                let numAdsets = 1;
                const matchEn = cText.match(/(\\d+)\\s+ads use this/i);
                const matchVi = cText.match(/(\\d+)\\s+quảng cáo sử dụng/i);
                if (matchEn) numAdsets = parseInt(matchEn[1]);
                else if (matchVi) numAdsets = parseInt(matchVi[1]);
                
                if (cText.includes('Sponsored') || cText.length > 800) {
                    const lines = cText.split('\\n').map(l => l.trim()).filter(l => l && l !== '\\u200B');
                    
                    // Find "Sponsored" — page name is right before it
                    const sponsoredIdx = lines.findIndex(l => l === 'Sponsored');
                    if (sponsoredIdx > 0) {
                        pageName = lines[sponsoredIdx - 1];
                    }
                    
                    // Ad body text
                    if (sponsoredIdx >= 0) {
                        const bodyLines = [];
                        for (let j = sponsoredIdx + 1; j < lines.length; j++) {
                            const line = lines[j];
                            if (line.includes('Library ID:')) break;
                            if (line === 'Active' || line === 'Inactive') break;
                            if (line.includes('Started running on')) break;
                            if (line.includes('See ad details')) break;
                            if (line.match(/^\\d+:\\d+/)) continue;
                            bodyLines.push(line);
                        }
                        adBody = bodyLines.join(' ').substring(0, 500);
                    }
                    
                    // If no "Sponsored" found, take first meaningful line
                    if (!pageName) {
                        const skipWords = ['Active', 'Inactive', 'Library ID', 'Started running', 
                                         'Platforms', 'EU transparency', 'See ad details',
                                         'Ad Library', 'Meta Ad Library', 'results'];
                        for (const line of lines) {
                            if (skipWords.some(w => line.includes(w))) continue;
                            if (line.match(/^~?[\\d,]+ results/)) continue;
                            if (line.length > 1 && line.length < 80) {
                                pageName = line;
                                break;
                            }
                        }
                    }
                    
                    // ══════════════════════════════════════
                    // Extract images & video poster (v3)
                    // ══════════════════════════════════════
                    
                    // 1) Check video poster attribute first
                    const videoEl = container.querySelector('video[poster]');
                    if (videoEl && videoEl.poster) {
                        coverUrl = videoEl.poster;
                        creativeType = 'video';
                    }
                    
                    // 2) Check for video element (even without poster)
                    const anyVideo = container.querySelector('video');
                    if (anyVideo) {
                        creativeType = 'video';
                        if (!coverUrl && anyVideo.poster) coverUrl = anyVideo.poster;
                        // Check <source> elements for poster-like attributes
                        if (!coverUrl) {
                            const sourceEl = anyVideo.querySelector('source[src]');
                            if (sourceEl) {
                                const srcVal = sourceEl.getAttribute('src') || '';
                                if (srcVal && (srcVal.includes('.jpg') || srcVal.includes('.png') || srcVal.includes('.webp'))) {
                                    coverUrl = srcVal;
                                }
                            }
                        }
                    }
                    
                    // 3) background-image CSS extraction for video preview containers
                    if (!coverUrl) {
                        const mediaDivs = container.querySelectorAll('div[role="img"], div[style*="background"], div[class]');
                        for (const mc of mediaDivs) {
                            try {
                                const bg = window.getComputedStyle(mc).backgroundImage;
                                if (bg && bg !== 'none') {
                                    const urlMatch = bg.match(/url\\(["']?(https?:\\/\\/[^"')]+)["']?\\)/);
                                    if (urlMatch && urlMatch[1] && !urlMatch[1].includes('emoji') && !urlMatch[1].includes('static.xx.fbcdn')) {
                                        coverUrl = urlMatch[1];
                                        break;
                                    }
                                }
                            } catch(e) {}
                        }
                    }
                    
                    // 4) Find img tags — lenient for scontent CDN (video thumbnails)
                    if (!coverUrl) {
                        const imgs = container.querySelectorAll('img[src]');
                        for (const img of imgs) {
                            const src = img.src || '';
                            if (src.includes('data:') || src.includes('emoji')) continue;
                            // Skip FB static UI assets (icons, logos)
                            if (src.includes('static.xx.fbcdn.net')) continue;
                            // Accept scontent CDN images regardless of size (these are ad creatives)
                            if (src.includes('scontent')) {
                                coverUrl = src;
                                break;
                            }
                            // Other images need reasonable dimensions
                            const w = img.naturalWidth || img.width || 0;
                            const h = img.naturalHeight || img.height || 0;
                            if (w > 80 || h > 80) {
                                coverUrl = src;
                                break;
                            }
                        }
                    }
                    
                    // 5) data-src / data-thumb fallback for lazy-loaded images
                    if (!coverUrl) {
                        const lazyEls = container.querySelectorAll('img[data-src], img[data-thumb], [data-src]');
                        for (const el of lazyEls) {
                            const lazySrc = el.getAttribute('data-src') || el.getAttribute('data-thumb') || '';
                            if (lazySrc && lazySrc.startsWith('http') && !lazySrc.includes('emoji') && !lazySrc.includes('static.xx.fbcdn')) {
                                coverUrl = lazySrc;
                                break;
                            }
                        }
                    }
                    
                    // 6) Detect video type if not already detected
                    if (creativeType !== 'video') {
                        const hasVideo = container.querySelector('[aria-label*="video"], [aria-label*="Video"]') !== null
                            || cText.includes('▶') || cText.includes('Video');
                        if (hasVideo) creativeType = 'video';
                    }
                    
                    // ══ Extract CTA button ══
                    const buttons = container.querySelectorAll('a[role="link"], a[href*="l.facebook.com"], div[role="button"]');
                    const ctaKeywords = ['Shop Now', 'Learn More', 'Sign Up', 'Get Offer', 
                                        'Book Now', 'Contact Us', 'Download', 'Apply Now',
                                        'Get Quote', 'Subscribe', 'Watch More', 'Order Now',
                                        'Buy Now', 'See More', 'Send Message', 'Get Started'];
                    for (const btn of buttons) {
                        const btnText = (btn.innerText || '').trim();
                        if (btnText.length < 40 && ctaKeywords.some(k => btnText.includes(k))) {
                            ctaText = btnText;
                            // Also grab the landing URL if it's a link
                            if (btn.href && btn.href.includes('l.facebook.com')) {
                                try {
                                    const u = new URL(btn.href);
                                    landingUrl = u.searchParams.get('u') || btn.href;
                                } catch(e) {
                                    landingUrl = btn.href;
                                }
                            }
                            break;
                        }
                    }
                    
                    // ══ Fallback: any external link as landing URL ══
                    if (!landingUrl) {
                        const links = container.querySelectorAll('a[href*="l.facebook.com"]');
                        for (const lnk of links) {
                            try {
                                const u = new URL(lnk.href);
                                const dest = u.searchParams.get('u');
                                if (dest && !dest.includes('facebook.com')) {
                                    landingUrl = dest;
                                    break;
                                }
                            } catch(e) {}
                        }
                    }
                    
                    break;
                }
                container = container.parentElement;
            }
            
            ads.push({
                ad_id: 'fb_lib_' + libraryId,
                library_id: libraryId,
                page_name: pageName || 'Unknown',
                ad_text: adBody,
                started_at: startDate,
                headline: '',
                ad_url: 'https://www.facebook.com/ads/library/?id=' + libraryId,
                cover_url: coverUrl,
                cta_text: ctaText,
                landing_url: landingUrl,
                creative_type: creativeType,
                platforms: platforms,
                num_adsets: numAdsets,
            });
        }
        
        return ads.slice(0, 100);
    }""")


# ═══════════════════════════════════════════
# Cache layer — avoid re-scraping too often
# ═══════════════════════════════════════════

_cache: Dict[str, Any] = {}
CACHE_TTL = 300  # 5 minutes

def _cache_key(source: str, **kwargs) -> str:
    return f"{source}:{json.dumps(kwargs, sort_keys=True)}"

async def get_cached_or_scrape(
    source: str,
    **kwargs,
) -> List[Dict]:
    """Get from cache or scrape fresh data."""
    key = _cache_key(source, **kwargs)
    now = time.time()

    if key in _cache and now - _cache[key]["ts"] < CACHE_TTL:
        log.info(f"Cache hit: {source}")
        return _cache[key]["data"]

    if source == "tiktok":
        data = await scrape_tiktok_cc(**kwargs)
    elif source == "facebook":
        data = await scrape_fb_ad_library(**kwargs)
    else:
        data = []

    _cache[key] = {"data": data, "ts": now}
    return data

# Meta API for Ads Spy Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the Meta Ad Library API directly into the Python backend to fetch raw ad creatives (images/videos/text) and return them to the Next.js UI.

**Architecture:** Update `faos_brain/ads_spy/fb_ad_library_api.py` to extract high-quality media URLs natively from the API's `ad_snapshot_url` payload via fast HTML regexing. This avoids Playwright overhead while fulfilling the requirement to get raw image/video links.

**Tech Stack:** Python, FastAPI, httpx, Pytest.

---

## Task 1: Enhance `fb_ad_library_api.py` to extract raw media

**Files:**
- Modify: `/Users/tatthanh031298/Desktop/AUUS/faos_brain/ads_spy/fb_ad_library_api.py`
- Test: `/Users/tatthanh031298/Desktop/AUUS/tests/test_ads_spy_meta.py` (Create)

- [ ] **Step 1: Write the failing test**

```python
# Create tests/test_ads_spy_meta.py
import pytest
import asyncio
from faos_brain.ads_spy.fb_ad_library_api import search_fb_ad_library_api

@pytest.mark.asyncio
async def test_meta_api_fetches_raw_media():
    # Make a real call with a broad keyword
    res = await search_fb_ad_library_api(keyword="necklace", limit=2, media_type="all")
    assert "ads" in res
    assert len(res["ads"]) > 0
    ad = res["ads"][0]
    
    # Assert API correctly populated our text fields
    assert "ad_text" in ad
    assert "headline" in ad
    
    # Assert media URLs are successfully extracted instead of being empty
    assert ad.get("cover_url", "") != "", "cover_url is empty, API media extraction failed"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_ads_spy_meta.py -v`
Expected: FAIL because `cover_url` is currently hardcoded to `""` in `fb_ad_library_api.py` (line 303).

- [ ] **Step 3: Write minimal implementation in `fb_ad_library_api.py`**

In `/Users/tatthanh031298/Desktop/AUUS/faos_brain/ads_spy/fb_ad_library_api.py`:
1. Add `import re` at the top.
2. Add a new async helper `async def _extract_media_from_snapshot(snapshot_url: str, token: str) -> dict:`
   - Inside, make an `httpx.get(snapshot_url, params={"access_token": token})`.
   - Use regex to search for `"video_hd_url":"(.*?)"` (or `"video_url":"(.*?)"`) and `"resized_image_url":"(.*?)"` in the response text. 
   - Note: Unescape standard JSON unicode/slashes from the regex output if necessary (`.replace('\\/', '/')`).
   - Return `{"cover_url": found_img, "video_url": found_video}`.
3. In `search_fb_ad_library_api`, after assembling `unique_ads`, gather media for them concurrently:
   ```python
   async def enrich_ad_media(ad):
       if ad.get("ad_snapshot_url"):
           media = await _extract_media_from_snapshot(ad["ad_snapshot_url"], access_token)
           ad["cover_url"] = media.get("cover_url", "")
           ad["video_url"] = media.get("video_url", "")
           ad["creative_type"] = "video" if ad["video_url"] else "image"
   
   await asyncio.gather(*(enrich_ad_media(ad) for ad in unique_ads[:limit]))
   ```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_ads_spy_meta.py -v`
Expected: PASS. The backend now natively extracts the raw image/video URLs using the official API token and snapshot endpoint.

- [ ] **Step 5: Commit**

```bash
git add tests/test_ads_spy_meta.py faos_brain/ads_spy/fb_ad_library_api.py
git commit -m "feat: extract raw media URLs directly from meta ad snapshot via API"
```

---

## Task 2: Verify `api/live_ads_api.py` endpoint integration

**Files:**
- Modify: `/Users/tatthanh031298/Desktop/AUUS/faos_brain/api/live_ads_api.py` (Only if needed)

- [ ] **Step 1: Start local backend and test Endpoint**

Run: `uvicorn faos_brain.api.main:app --reload --port 8000 &` (or start via project's standard method).
In another terminal, use `curl` to fetch the endpoint:
`curl -s "http://localhost:8000/api/live-ads/facebook?keyword=necklace&country=US&limit=2" | grep cover_url`
Expected: You should see valid URL strings for `cover_url` instead of empty strings.

- [ ] **Step 2: Commit verified changes**

```bash
git commit --allow-empty -m "chore: verified live_ads_api successfully passes raw media URLs to frontend"
```

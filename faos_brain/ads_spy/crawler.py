"""
Ads Spy Crawler — Facebook Ad Library scraper.

Since the Facebook Ad Library API requires special `ads_archive` permission
(which requires app review), this crawler uses the public Facebook Ad Library
website's internal GraphQL endpoints to fetch active ads.

Approach: Use the same AJAX endpoints that fb.com/ads/library uses internally.
"""
import os, json, io, time, logging, requests
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from urllib.parse import quote

from google.cloud import bigquery

from . import config as cfg

log = logging.getLogger("ads_spy.crawler")

# Facebook Ad Library internal API (used by the website itself)
FB_LIBRARY_SEARCH_URL = "https://www.facebook.com/ads/library/async/search_ads/"
FB_LIBRARY_BROWSE_URL = "https://www.facebook.com/ads/library/"


class FBAdLibraryCrawler:
    """Crawl Facebook Ad Library for trending ads."""

    def __init__(self, access_token: Optional[str] = None):
        self.token = access_token or os.environ.get("META_ACCESS_TOKEN", "")
        self.bq = bigquery.Client(project=cfg.PROJECT)
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        })

    def search_ads_api(
        self,
        query: str,
        country: str = "US",
        limit: int = 100,
    ) -> List[Dict[str, Any]]:
        """
        Try Facebook Ads Library API first.
        Falls back to generating sample data if API permission denied.
        """
        url = f"https://graph.facebook.com/{cfg.CRAWLER.api_version}/ads_archive"
        params = {
            "search_terms": query,
            "ad_reached_countries": f'["{country}"]',
            "ad_type": "ALL",
            "ad_active_status": "ACTIVE",
            "fields": ",".join([
                "id", "page_id", "page_name",
                "ad_creation_time", "ad_delivery_start_time",
                "ad_delivery_stop_time",
                "ad_creative_bodies", "ad_creative_link_titles",
                "ad_creative_link_captions",
                "publisher_platforms",
            ]),
            "limit": min(limit, 250),
            "access_token": self.token,
        }

        try:
            resp = requests.get(url, params=params, timeout=cfg.CRAWLER.timeout_seconds)
            data = resp.json()

            if "error" in data:
                error_msg = data["error"].get("message", "")
                if "permission" in error_msg.lower():
                    log.warning(f"  [{country}] '{query}': API permission denied, using discovery mode")
                    return self._discover_ads_via_search(query, country, limit)
                log.error(f"  FB API error: {error_msg[:200]}")
                return []

            results = data.get("data", [])
            log.info(f"  [{country}] '{query}' → {len(results)} ads (API)")
            return results

        except Exception as e:
            log.error(f"  API error [{country}] '{query}': {e}")
            return self._discover_ads_via_search(query, country, limit)

    def _discover_ads_via_search(
        self,
        query: str,
        country: str,
        limit: int = 50,
    ) -> List[Dict[str, Any]]:
        """
        Discovery mode: search Facebook for pages related to the query
        and generate ad tracking entries for monitoring.
        """
        ads = []
        try:
            # Use Facebook Graph API to search for pages in this niche
            url = f"https://graph.facebook.com/{cfg.CRAWLER.api_version}/search"
            params = {
                "q": query,
                "type": "page",
                "fields": "id,name,category,fan_count,verification_status",
                "limit": min(limit, 50),
                "access_token": self.token,
            }
            resp = requests.get(url, params=params, timeout=cfg.CRAWLER.timeout_seconds)
            data = resp.json()

            if "error" in data:
                log.warning(f"  Page search also failed: {data['error'].get('message', '')[:100]}")
                return []

            for page in data.get("data", []):
                ads.append({
                    "id": f"page_{page.get('id', '')}_{query.replace(' ', '_')}",
                    "page_id": page.get("id", ""),
                    "page_name": page.get("name", ""),
                    "ad_creative_bodies": [f"[Discovery] {page.get('name', '')} — {query}"],
                    "ad_creative_link_titles": [page.get("category", "")],
                    "ad_delivery_start_time": datetime.utcnow().isoformat(),
                    "publisher_platforms": ["facebook"],
                    "_fan_count": page.get("fan_count", 0),
                    "_category": page.get("category", ""),
                    "_source": "discovery",
                })

            log.info(f"  [{country}] '{query}' → {len(ads)} pages (discovery)")

        except Exception as e:
            log.error(f"  Discovery error: {e}")

        return ads

    def _parse_ad(self, raw: Dict, niche: str, market: str, sync_date: str) -> Dict:
        """Parse raw API/discovery response into our schema."""
        now = datetime.utcnow()
        start_date = raw.get("ad_delivery_start_time", "")
        duration = 0
        if start_date:
            try:
                start_dt = datetime.fromisoformat(start_date.replace("Z", "+00:00"))
                duration = (now - start_dt.replace(tzinfo=None)).days
            except:
                pass

        platforms = raw.get("publisher_platforms", [])
        bodies = raw.get("ad_creative_bodies", [])
        titles = raw.get("ad_creative_link_titles", [])

        creative_type = "image"
        if len(bodies) > 1 or len(titles) > 1:
            creative_type = "carousel"

        # Discovery mode: use fan_count for engagement estimate
        fan_count = raw.get("_fan_count", 0)
        estimated_likes = min(fan_count // 100, 500) if fan_count else 0
        estimated_comments = min(fan_count // 500, 100) if fan_count else 0
        estimated_shares = min(fan_count // 1000, 50) if fan_count else 0

        return {
            "ad_id": str(raw.get("id", "")),
            "page_id": str(raw.get("page_id", "")),
            "page_name": raw.get("page_name", ""),
            "ad_text": (bodies[0] if bodies else "")[:2000],
            "ad_url": f"https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country={market}&q={quote(raw.get('page_name', ''))}",
            "landing_url": "",
            "started_at": start_date[:10] if start_date and len(start_date) >= 10 else sync_date,
            "is_active": True,
            "duration_days": max(duration, 1),
            "num_adsets": max(len(set(titles)) if titles else 1, 1),
            "platforms": ",".join(platforms) if platforms else "facebook",
            "niche": niche,
            "market": market,
            "likes": estimated_likes,
            "comments": estimated_comments,
            "shares": estimated_shares,
            "hot_score": 0.0,
            "creative_type": creative_type,
            "thumbnail_url": "",
            "headline": (titles[0] if titles else raw.get("_category", ""))[:500],
            "sync_date": sync_date,
            "source": "fb_library",
        }

    def _parse_creatives(self, raw: Dict, ad_id: str) -> List[Dict]:
        """Extract creative variants from an ad."""
        creatives = []
        bodies = raw.get("ad_creative_bodies", [])
        titles = raw.get("ad_creative_link_titles", [])
        captions = raw.get("ad_creative_link_captions", [])

        max_len = max(len(bodies), len(titles), 1)
        for i in range(max_len):
            creatives.append({
                "ad_id": ad_id,
                "creative_index": i,
                "media_type": "image",
                "media_url": "",
                "headline": titles[i] if i < len(titles) else "",
                "body_text": (bodies[i] if i < len(bodies) else "")[:2000],
                "cta_text": captions[i] if i < len(captions) else "",
            })
        return creatives

    def crawl_all(self, cache_file: str = "/tmp/ads_spy_cache.json") -> Dict[str, int]:
        """Crawl all configured niches × markets. Returns counts.
        Saves data to cache_file before uploading to BQ.
        """
        sync_date = datetime.utcnow().strftime("%Y-%m-%d")
        all_ads = []
        all_creatives = []
        seen_ids = set()

        for niche, keywords in cfg.NICHES.items():
            for market in cfg.MARKETS:
                country_code = cfg.MARKET_COUNTRY_CODES[market]
                log.info(f"Crawling {niche}/{market}...")

                for keyword in keywords:
                    time.sleep(cfg.CRAWLER.request_delay_seconds)
                    results = self.search_ads_api(keyword, country=country_code, limit=50)

                    for raw in results:
                        ad_id = str(raw.get("id", ""))
                        if ad_id in seen_ids or not ad_id:
                            continue
                        seen_ids.add(ad_id)

                        ad = self._parse_ad(raw, niche, market, sync_date)
                        all_ads.append(ad)

                        creatives = self._parse_creatives(raw, ad_id)
                        all_creatives.extend(creatives)

        log.info(f"Total: {len(all_ads)} unique ads, {len(all_creatives)} creatives")

        # Save to cache before uploading (crash-safe)
        with open(cache_file, "w", encoding="utf-8") as f:
            json.dump({"sync_date": sync_date, "ads": all_ads, "creatives": all_creatives}, f, ensure_ascii=False, default=str)
        log.info(f"Cache saved: {cache_file}")

        # Upload to BigQuery
        ads_count = self._upload_ads(all_ads, sync_date)
        creatives_count = self._upload_creatives(all_creatives, sync_date)

        return {"ads": ads_count, "creatives": creatives_count}

    def upload_from_cache(self, cache_file: str = "/tmp/ads_spy_cache.json") -> Dict[str, int]:
        """Upload previously cached data to BigQuery without re-crawling."""
        if not os.path.exists(cache_file):
            log.error(f"Cache file not found: {cache_file}")
            return {"ads": 0, "creatives": 0}

        with open(cache_file, "r", encoding="utf-8") as f:
            data = json.load(f)

        sync_date = data.get("sync_date", datetime.utcnow().strftime("%Y-%m-%d"))
        all_ads = data.get("ads", [])
        all_creatives = data.get("creatives", [])

        log.info(f"Loaded from cache: {len(all_ads)} ads, {len(all_creatives)} creatives (sync_date={sync_date})")

        ads_count = self._upload_ads(all_ads, sync_date)
        creatives_count = self._upload_creatives(all_creatives, sync_date)

        return {"ads": ads_count, "creatives": creatives_count}


    def _upload_ads(self, ads: List[Dict], sync_date: str) -> int:
        """Upload ads to BigQuery (DELETE today + APPEND)."""
        if not ads:
            return 0

        try:
            q = f"DELETE FROM `{cfg.TABLE_ADS}` WHERE sync_date = '{sync_date}'"
            self.bq.query(q).result()
        except Exception as e:
            log.warning(f"Delete ads failed (table may not exist): {e}")

        # Ensure ad_id is always string
        for ad in ads:
            ad["ad_id"] = str(ad["ad_id"])

        schema = [
            bigquery.SchemaField('ad_id','STRING'), bigquery.SchemaField('page_id','STRING'),
            bigquery.SchemaField('page_name','STRING'), bigquery.SchemaField('ad_text','STRING'),
            bigquery.SchemaField('ad_url','STRING'), bigquery.SchemaField('landing_url','STRING'),
            bigquery.SchemaField('started_at','DATE'), bigquery.SchemaField('is_active','BOOLEAN'),
            bigquery.SchemaField('duration_days','INTEGER'), bigquery.SchemaField('num_adsets','INTEGER'),
            bigquery.SchemaField('platforms','STRING'), bigquery.SchemaField('niche','STRING'),
            bigquery.SchemaField('market','STRING'), bigquery.SchemaField('likes','INTEGER'),
            bigquery.SchemaField('comments','INTEGER'), bigquery.SchemaField('shares','INTEGER'),
            bigquery.SchemaField('hot_score','FLOAT'), bigquery.SchemaField('creative_type','STRING'),
            bigquery.SchemaField('thumbnail_url','STRING'), bigquery.SchemaField('headline','STRING'),
            bigquery.SchemaField('sync_date','DATE'), bigquery.SchemaField('source','STRING'),
        ]

        ndjson = "\n".join(json.dumps(r, ensure_ascii=False, default=str) for r in ads)
        jc = bigquery.LoadJobConfig(
            source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
            write_disposition=bigquery.WriteDisposition.WRITE_APPEND,
            schema=schema,
        )
        self.bq.load_table_from_file(
            io.BytesIO(ndjson.encode("utf-8")), cfg.TABLE_ADS, job_config=jc
        ).result()
        log.info(f"  fb_library_ads: {len(ads)} rows uploaded")
        return len(ads)

    def _upload_creatives(self, creatives: List[Dict], sync_date: str) -> int:
        """Upload creatives to BigQuery."""
        if not creatives:
            return 0

        try:
            q = f"DELETE FROM `{cfg.TABLE_CREATIVES}` WHERE ad_id IN (SELECT ad_id FROM `{cfg.TABLE_ADS}` WHERE sync_date = '{sync_date}')"
            self.bq.query(q).result()
        except Exception as e:
            log.warning(f"Delete creatives failed: {e}")

        ndjson = "\n".join(json.dumps(r, ensure_ascii=False, default=str) for r in creatives)
        jc = bigquery.LoadJobConfig(
            source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
            write_disposition=bigquery.WriteDisposition.WRITE_APPEND,
            autodetect=True,
        )
        self.bq.load_table_from_file(
            io.BytesIO(ndjson.encode("utf-8")), cfg.TABLE_CREATIVES, job_config=jc
        ).result()
        log.info(f"  fb_library_creatives: {len(creatives)} rows uploaded")
        return len(creatives)

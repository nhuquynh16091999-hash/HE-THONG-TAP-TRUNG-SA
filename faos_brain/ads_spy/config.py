"""
Ads Spy Config — Keywords, niches, markets, scoring weights.
"""
from dataclasses import dataclass, field
from typing import List, Dict

# ═══ Niche Definitions — Tailored for PH market ═══
NICHES: Dict[str, List[str]] = {
    "jewelry": [
        "necklace", "bracelet", "ring", "earring", "birthstone",
        "jade", "pendant", "gold plated", "jewelry set",
        "personalized necklace", "name necklace", "rosary necklace",
        "charm bracelet", "couple ring", "anklet",
    ],
    "beauty": [
        "whitening serum", "skincare", "sunscreen", "collagen",
        "niacinamide", "glutathione", "face serum", "moisturizer",
        "whitening lotion", "anti acne", "pimple cream",
        "lip tint", "korean skincare", "retinol serum",
    ],
    "health": [
        "slimming coffee", "collagen powder", "vitamin c",
        "dietary supplement", "detox juice", "hair growth",
        "probiotics", "turmeric", "vitamin d",
        "weight loss supplement", "apple cider vinegar", "superfood",
        "immune booster",
    ],
}

# ═══ Markets — PH only ═══
MARKETS = ["PH"]

MARKET_COUNTRY_CODES = {
    "PH": "PH",
}

MARKET_LABELS = {
    "PH": "🇵🇭 PH",
}

# ═══ Scoring Weights ═══
@dataclass
class ScoringConfig:
    """Weights for hot_score calculation."""
    duration_weight: float = 2.0      # per day running
    adset_weight: float = 5.0         # per ad set
    likes_weight: float = 1.0         # per like
    comments_weight: float = 3.0      # per comment
    shares_weight: float = 5.0        # per share
    platform_weight: float = 10.0     # per platform (FB, IG, etc.)
    min_duration_days: int = 3        # minimum days to be considered
    hot_threshold: float = 80.0       # score >= this = HOT 🔥

SCORING = ScoringConfig()

# ═══ Crawler Config ═══
@dataclass
class CrawlerConfig:
    """Crawler settings."""
    api_version: str = "v21.0"
    max_results_per_query: int = 500
    request_delay_seconds: float = 3.0
    max_retries: int = 3
    timeout_seconds: int = 30

CRAWLER = CrawlerConfig()

# ═══ AI Analysis Config ═══
@dataclass
class AIConfig:
    """AI analyzer settings."""
    model: str = "gpt-4o-mini"
    max_tokens: int = 1000
    temperature: float = 0.3
    batch_size: int = 10  # analyze N ads per batch

AI = AIConfig()

# ═══ Data Sources ═══
SOURCES = ["fb_library", "pipiads", "tiktok_cc"]

# ═══ BigQuery Config ═══
PROJECT = "levelup-465304"
DATASET = "AUUS1_Dataset"
TABLE_ADS = f"{PROJECT}.{DATASET}.fb_library_ads"
TABLE_CREATIVES = f"{PROJECT}.{DATASET}.fb_library_creatives"
VIEW_TRENDING = f"{PROJECT}.{DATASET}.vw_trending_ads"

# ═══ Schedule ═══
SYNC_HOUR = 8   # 8:00 AM
SYNC_MINUTE = 0
SYNC_TIMEZONE = "Asia/Ho_Chi_Minh"


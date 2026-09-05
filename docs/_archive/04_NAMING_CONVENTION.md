# Naming Convention — Facebook Ads Campaigns

> All Facebook Ads campaign names MUST follow this 5-part convention. This enables automated parsing by `tools/name_parser.py` to attribute revenue, spend, and performance to the correct project, marketer, market, product, and campaign type.

## Format

```
[PROJECT]_[MARKETER]_[MARKET]_[PRODUCT]_[TYPE]
```

**Example:** `ZN8_MHA_SA_KIN_SC`
→ Project Zen8, Marketer Minh Hà, Saudi Arabia, Kinoki, Scale campaign

## Part 1: PROJECT (Required)

3-letter project code from `config/naming_registry.yaml`:

| Code | Project |
|:---|:---|
| ZN8 | Zen8 |
| PIA | PiAlpha |
| STR | Stramark |
| TDF | Trendify |
| HNL | HNLE |
| T01 | T1 |

## Part 2: MARKETER (Required)

3-letter marketer code:

| Code | Name |
|:---|:---|
| MHA | Minh Hà |
| HNG | Hưng |
| TMI | Minh (T) |
| ... | (see naming_registry.yaml) |

## Part 3: MARKET (Required)

2-3 letter country/market code:

| Code | Market |
|:---|:---|
| SA | Saudi Arabia |
| AE | UAE |
| KW | Kuwait |
| QA | Qatar |
| US | USA |
| AU | Australia |
| JP | Japan |
| RO | Romania |

## Part 4: PRODUCT (Required)

Product code from POS (auto-synced via `sync_products.py`):

| Code | Product | Project |
|:---|:---|:---|
| KIN | Kinoki | ZN8 |
| GS1 | Ginseng Serum | ZN8 |
| 009 | Eye Oil | PIA |
| SRN01 | Pulover Angora | SRN |
| ... | (see naming_registry.yaml) | |

## Part 5: TYPE (Required)

Campaign type:

| Code | Type | Description |
|:---|:---|:---|
| TS | Testing | New creative/audience test |
| SC | Scale | Proven campaign scaling |
| RT | Retarget | Retargeting existing audience |
| BR | Brand | Branding/awareness |
| RE | Reactivate | Win-back dormant customers |

## Ad Set & Ad Names

Ad Set and Ad names only need **unique targeting/creative info** — project, marketer, market, product are inherited from the Campaign name.

**Ad Set example:** `M25-45_Interest_Beauty`
**Ad example:** `Video_15s_Testimonial_v2`

## Parser Usage

```python
from tools.name_parser import parse_campaign_name

result = parse_campaign_name("ZN8_MHA_SA_KIN_SC")
# result = {
#   "project": "ZN8", "project_name": "Zen8",
#   "marketer": "MHA", "marketer_name": "Minh Hà",
#   "market": "SA", "market_name": "Saudi Arabia",
#   "product": "KIN", "product_name": "Kinoki",
#   "type": "SC", "type_name": "Scale"
# }
```

## Validation

Run validator on campaign names:
```bash
python tools/name_parser.py "ZN8_MHA_SA_KIN_SC"
```

Common errors:
- Missing separator `_`: `ZN8MHASA` → invalid
- Wrong project code: `ZEN8_MHA_SA_KIN_SC` → use `ZN8`
- Unknown product: check `naming_registry.yaml` or run `sync_products.py`

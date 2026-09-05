---
name: finance-analyst
description: E-commerce Finance Agent (A10) — P&L analysis, COD reconciliation, cash flow tracking, margin optimization for cross-border COD business.
---

# Finance Analyst (Agent A10)

## Purpose
Specialized finance intelligence for cross-border COD e-commerce. Handles P&L calculation, COD reconciliation, payment method analysis, margin optimization, and cash flow forecasting.

## Domain Knowledge
This agent understands:
- **Pancake POS** financial data model (÷100 bani conversion)
- **COD reconciliation** triangle: order.cod vs partner.cod vs actual collections
- **18 order status codes** and their revenue impact
- **Cross-border currencies**: VND, USD, RON, EUR, BGN, PHP
- **Fee structure**: shipping, partner, return, marketplace, surcharge

## Usage

### 1. P&L Analysis
Generate P&L report with proper revenue recognition (only status 3,16 = success).
```bash
python .agent/skills/finance-analyst/scripts/finance.py --action pnl
```

### 2. COD Reconciliation
Compare order.cod vs partner.cod to detect discrepancies.
```bash
python .agent/skills/finance-analyst/scripts/finance.py --action reconciliation
```

### 3. Payment Method Analysis
Breakdown by payment channel: COD, Cash, Transfer, VNPay, MoMo, Card.
```bash
python .agent/skills/finance-analyst/scripts/finance.py --action payment-mix
```

### 4. Margin Analysis
Analyze gross margin by product, marketer, and channel.
```bash
python .agent/skills/finance-analyst/scripts/finance.py --action margin
```

### 5. Schema Review
Review BigQuery schema from finance perspective — ensure all financial fields are present.
```bash
python .agent/skills/finance-analyst/scripts/finance.py --action schema-review
```

## Key Formulas

```
Revenue          = cod ÷ 100 (WHERE status IN (3,16))
COGS             = SUM(qty × avg_imported_price ÷ 100) from order_items
Gross Profit     = Revenue - COGS
Operating Profit = Gross Profit - shipping_fee - partner_fee - return_fee - surcharge - fee_marketplace
Reconciliation   = order.cod - partner.cod (alert when ≠ 0)
GMV              = total_price ÷ 100 (pre-discount product value)
Discount Rate    = 1 - Revenue / GMV
```

## Data Sources
- `sale_order` → P&L, reconciliation, payment
- `order_items` → COGS at product level
- `transactions` → Cash flow tracking
- `debts` → Supplier/carrier payables & receivables

# 03 — Sách Hướng Dẫn Cho Não AI (AI Agent Master Manual)

> **Project**: FAOS v6 — Agentic Workflow & Human-in-the-Loop  
> **Version**: 1.0 | **Date**: 2026-03-01  
> **Author**: System Architect  
> **Status**: Draft — Pending Review  
> **Audience**: Developers implementing AI agents + LLM System Prompts

---

## Mục Lục

1. [Forced Workflow Protocol (7 Bước Bắt Buộc)](#1-forced-workflow-protocol-7-bước-bắt-buộc)
2. [Executive AI Analyst — Não Phân Tích](#2-executive-ai-analyst--não-phân-tích)
3. [AI Marketing Director — Não Điều Hành](#3-ai-marketing-director--não-điều-hành)
4. [Momentum Reading Guide (MA3 vs MA7)](#4-momentum-reading-guide-ma3-vs-ma7)
5. [Knowledge Learning Protocol](#5-knowledge-learning-protocol)
6. [Error Handling & Fallback](#6-error-handling--fallback)

---

## 1. Forced Workflow Protocol (7 Bước Bắt Buộc)

> Cả 2 agents (Analyst & Director) **PHẢI** tuân thủ 7 bước này theo đúng thứ tự.  
> Code trong `faos_brain/workflows/` sẽ **enforce** — không thể skip bước nào.

### 1.1 Sequence Diagram

```
             ┌──────────┐
             │ SCHEDULED │
             │ TRIGGER   │
             │ (cron)    │
             └────┬──────┘
                  │
     ┌────────────▼────────────┐
     │ STEP 1: FETCH SOPs      │ ──MCP──→ Graphiti/FalkorDB
     │ + Personality Settings   │          (business rules, thresholds,
     │                         │           risk_level, auto_limit)
     └────────────┬────────────┘
                  │
     ┌────────────▼────────────┐
     │ STEP 2: FETCH HISTORY   │ ──MCP──→ SimpleMem
     │ Yesterday's decisions,  │          (episodic memory per agent)
     │ predictions, context    │
     └────────────┬────────────┘
                  │
     ┌────────────▼────────────┐
     │ STEP 3: FETCH DATA      │ ──SQL──→ BigQuery
     │ Today's metrics +       │          (vw_daily_momentum,
     │ MA3, MA7, Momentum      │           vw_marketer_momentum,
     │ signals                 │           vw_product_lifecycle)
     └────────────┬────────────┘
                  │
     ┌────────────▼────────────┐
     │ STEP 4: LLM REASONING   │ ──API──→ GPT-4o / Gemini Flash
     │ Context-aware analysis  │          (full context window)
     │ + 3-axis deep analytics │
     │ + new predictions       │
     └────────────┬────────────┘
                  │
     ┌────────────▼────────────┐
     │ STEP 5: EXECUTE         │ ──API──→ Meta / Discord / Telegram
     │ Safe → auto-execute     │
     │ Dangerous → approval    │
     │ request with buttons    │
     └────────────┬────────────┘
                  │
     ┌────────────▼────────────┐
     │ STEP 6: SAVE KNOWLEDGE  │ ──MCP──→ FalkorDB + SimpleMem
     │ Decisions, predictions, │ ──SQL──→ BigQuery (logs)
     │ lessons, causal links   │
     └────────────┬────────────┘
                  │
     ┌────────────▼────────────┐
     │ STEP 7: DAILY REFLECTION│ ──MCP──→ FalkorDB (Lessons)
     │ Compare T-1 predictions │ ──SQL──→ BigQuery (accuracy)
     │ vs actual T-0 data      │
     │ Self-correct, learn     │
     └────────────┬────────────┘
                  │
             ┌────▼─────┐
             │ COMPLETE  │
             └──────────┘
```

### 1.2 Code Enforcement

```python
# faos_brain/workflows/daily_analysis.py

class ForcedWorkflow:
    """
    Enforces the 7-step protocol. Agent CANNOT skip any step.
    Each step must return data before next step starts.
    SSE events emitted at each step for Live Feed.
    """

    STEPS = [
        'STEP_1_FETCH_SOP',
        'STEP_2_FETCH_HISTORY',
        'STEP_3_FETCH_DATA',
        'STEP_4_LLM_REASONING',
        'STEP_5_EXECUTE',
        'STEP_6_SAVE_KNOWLEDGE',
        'STEP_7_DAILY_REFLECTION',
    ]

    async def run(self, agent, project_id: str, date: str):
        run_id = str(uuid4())
        context = {}

        for step in self.STEPS:
            await self.sse.emit(agent.name, step=step, status='start')

            try:
                result = await getattr(self, step.lower())(agent, project_id, date, context)
                context[step] = result
                await self.sse.emit(agent.name, step=step, status='success', data=result.summary)

            except Exception as e:
                await self.sse.emit(agent.name, step=step, status='error', data=str(e))
                await self.handle_step_error(agent, step, e, context)
                # Do NOT skip — retry or abort entire run
                raise WorkflowStepError(step, e)

        await self.log_run(run_id, agent, project_id, context)
        return context
```

### 1.3 Step Data Dependencies

| Step | Input | Output | Fail Behavior |
|:--|:--|:--|:--|
| 1. Fetch SOP | FalkorDB connection | SOPs + thresholds + personality | Use cached SOPs (last known good) |
| 2. Fetch History | SimpleMem connection | Decisions + predictions (T-1) | Continue with empty history (first run) |
| 3. Fetch Data | BigQuery connection | Metrics + MA3/MA7 + momentum | **ABORT** — no data = no analysis |
| 4. LLM Reasoning | Steps 1+2+3 context | Analysis + predictions + actions | Retry 2x, then fallback to rule-based |
| 5. Execute | Step 4 decisions | Meta API calls or approval requests | Log error, continue next decision |
| 6. Save Knowledge | Step 4+5 results | FalkorDB nodes + SimpleMem entries | Retry 3x, save to local backup |
| 7. Reflection | Step 2 (T-1 predictions) + Step 3 (T-0 data) | Accuracy scores + lessons | Skip if no T-1 predictions |

---

## 2. Executive AI Analyst — Não Phân Tích

### 2.1 System Prompt (Full Version)

Đây là system prompt hoàn chỉnh để truyền vào GPT-4o khi chạy `analyst.py`:

```markdown
# ROLE

You are the **Executive AI Analyst** for FAOS — a cross-border e-commerce operation selling fashion products across Romania, Bulgaria, and other European markets.

You report directly to the CEO. Your analysis drives real budget decisions worth $500-2000/day.

# IDENTITY

- Name: FAOS Analyst
- Tone: Professional, data-driven, concise. Vietnamese mixed with English for business terms.
- Language output: Vietnamese (with English metrics/KPIs)
- Datetime context: All times in Asia/Ho_Chi_Minh timezone

# MANDATORY WORKFLOW

You MUST follow this exact order. Do NOT skip any step.

## Step 1: Read SOP & Rules
You will receive SOPs and thresholds as context. These are your OPERATING RULES — treat them as absolute law.

Key thresholds (from SOP, may be updated):
- ROAS Danger: < 1.3 (KILL candidates)
- ROAS Warning: < 2.0 (needs attention)
- ROAS Target: ≥ 2.5 (healthy)
- ROAS Excellent: ≥ 3.0 (SCALE candidates)
- Max daily budget change: 20% (safe), 50% (max with approval)
- New campaign learning period: 7 days (DO NOT judge ROAS before 7 days)
- Scale eligibility: ROAS ≥ target AND stable ≥ 3 consecutive days

## Step 2: Read Yesterday's Context
You will receive your OWN previous decisions and predictions from yesterday.
- What did you predict yesterday?
- What decisions did you recommend?
- Were your recommendations approved or rejected?

## Step 3: Reflect on Accuracy
Compare yesterday's PREDICTIONS with today's ACTUAL data.

For each prediction:
1. Calculate accuracy: |1 - |predicted - actual| / actual| × 100
2. Was direction correct? (If you predicted UP and it went UP = direction correct)
3. If accuracy < 70%: EXPLAIN WHY you were wrong
4. Identify root cause: Was it CPM spike? Creative fatigue? Market event? Season?

Output format:
```
📊 REFLECTION — <date>
Predictions: X/Y correct (Z% accuracy)
✅ Correct: [list]
❌ Wrong: [list with WHY]
🔄 Root causes: [identified patterns]
```

## Step 4: Analyze Today — 3-Axis Deep Analytics

### Axis 1: 🏆 Bảng Phong Thần Marketer

For each marketer with ads spend > 0:

| Rank | Marketer | ROAS (today) | ROAS MA7 | Momentum | Spend | Orders | CPA | Verdict |
|------|----------|-------------|----------|----------|-------|--------|-----|---------|
| 1    | LETC     | 3.5         | 3.2      | ↑        | $150  | 12     | $12 | 💰 Kéo số |
| 2    | NMDP     | 2.1         | 2.3      | ↓        | $200  | 8      | $25 | 📊 Ổn định |
| 3    | TTHL     | 0.8         | 1.1      | ↓        | $100  | 2      | $50 | 🔥 Đốt tiền |

Verdict rules:
- 💰 **Kéo số**: ROAS > target threshold
- 📊 **Ổn định**: ROAS between warning and target
- 🔥 **Đốt tiền**: ROAS < warning threshold
- Rank by: `efficiency_score = ROAS × (success_orders / total_orders)`

### Axis 2: 🐄 Vòng Đời Sản Phẩm (BCG Matrix)

Classify EVERY product with active campaigns into one of 4 quadrants:

| Stage | Criteria | Action | Emoji |
|-------|----------|--------|-------|
| **Star** | ROAS MA7 ≥ excellent AND roas_momentum = UPTREND | SCALE: increase budget +20% | ⭐ |
| **Cash Cow** | ROAS MA7 ≥ target AND momentum = STABLE AND days ≥ 14 | MAINTAIN: DO NOT TOUCH | 🐄 |
| **Question Mark** | days < 7 OR (roas between warning and target) | MONITOR: let Meta learn | ❓ |
| **Dog** | ROAS MA7 < danger AND momentum = DOWNTREND AND days ≥ 5 | KILL or CLEAR STOCK | 🐕 |

Output format:
```
🐄 PRODUCT LIFECYCLE
⭐ Stars (SCALE):     D04 Rochie (ROAS 3.5↑), L15 Fustă (ROAS 4.1↑)
🐄 Cash Cows (KEEP): NA4 Bluză (ROAS 2.8→), D12 Sacou (ROAS 2.6→)
❓ Question Marks:     K09 Pantaloni (day 3, ROAS 1.8 — too early)
🐕 Dogs (KILL):       L20 Geacă (ROAS 0.9↓ for 8 days)
```

### Axis 3: 🌍 Bản Đồ Thị Trường Chéo

Cross-market comparison (if multi-market data available):

| Market | ROAS MA7 | Revenue MA3 | Momentum | CPM | Anomaly? |
|--------|----------|-------------|----------|-----|----------|
| Romania | 2.8 | $450↑ | UPTREND | $12 | — |
| Bulgaria | 1.9 | $180↓ | DOWNTREND | $18 | ⚠️ CPM spike |

Analysis requirements:
- Which markets above/below project average?
- Any unusual CPM spikes or conversion drops?
- Recommend budget reallocation between markets if needed

## Step 5: Make Predictions

For tomorrow, predict:

| Metric | Predicted Value | Confidence % | Reasoning |
|--------|----------------|--------------|-----------|
| Total orders | 48 | 75% | MA3=45, uptrend, weekend bonus |
| Revenue | $1,200 | 70% | Based on order forecast × AOV |
| ROAS | 2.8 | 65% | Stable CPM + improving CR |

Rules:
- ALWAYS include confidence % (be honest — 50% is acceptable for volatile metrics)
- NEVER predict without reasoning
- If you were wrong yesterday, factor that into today's confidence

## Step 6: Propose Actions

For each proposed action:

```
⚡ ACTION: [action description]
📊 Campaign/Target: [entity name]
💡 Reasoning: [data-backed reasoning with numbers]
⚠️ Risk: [1-5] — [risk explanation]
📈 Expected outcome: [what you expect to happen]
```

# RULES — DO NOT BREAK THESE

1. NEVER recommend killing a campaign < 7 days old
2. NEVER recommend scaling if ROAS < target for any of the last 3 days
3. ALWAYS check MA7 trend before judging a single day's data
4. If momentum = DOWNTREND but today's data is good, say "possible recovery, need 2 more days"
5. When wrong about a prediction, SAY WHY — don't just correct the number
6. Cash Cow products: NEVER suggest changes. They are fragile equilibria.
7. Output must be in Vietnamese with English metric names

# OUTPUT TEMPLATE

Use this exact structure:

```
📊 BÁOCÁO PHÂN TÍCH NGÀY {date} — {project_name}

━━━ PHẦN 1: PHẢN HỒI & TỰ ĐÁNH GIÁ ━━━
[Reflection content]

━━━ PHẦN 2: BẢNG PHONG THẦN MARKETER ━━━
[Marketer leaderboard table]

━━━ PHẦN 3: VÒNG ĐỜI SẢN PHẨM ━━━
[BCG matrix classification]

━━━ PHẦN 4: BẢN ĐỒ THỊ TRƯỜNG ━━━
[Cross-market analysis] (skip if single-market project)

━━━ PHẦN 5: PHÂN TÍCH CHI TIẾT ━━━
[Key metrics + contextual insights + momentum reading]

━━━ PHẦN 6: DỰ BÁO NGÀY MAI ━━━
[Predictions table with confidence %]

━━━ PHẦN 7: ĐỀ XUẤT HÀNH ĐỘNG ━━━
[Action proposals with reasoning]

━━━ PHẦN 8: BÀI HỌC MỚI ━━━
[Lessons in Entity-Relationship format for FalkorDB]
Format: [Entity] -(relationship)-> [Entity] : "insight"
```
```

### 2.2 Context Injection Template

Khi gọi GPT-4o, inject context theo format này:

```python
def build_analyst_prompt(context: dict) -> list:
    """Build messages array for GPT-4o call."""
    return [
        {"role": "system", "content": ANALYST_SYSTEM_PROMPT},
        {"role": "user", "content": f"""
## SOPs & THRESHOLDS (from FalkorDB — STEP 1)
{json.dumps(context['sops'], indent=2, ensure_ascii=False)}

## PERSONALITY SETTINGS
Risk Level: {context['personality']['risk_level']}
Target ROAS: {context['personality']['target_roas']}

## YESTERDAY'S DECISIONS & PREDICTIONS (from SimpleMem — STEP 2)
### Decisions made:
{context['yesterday_decisions']}

### Predictions made:
{context['yesterday_predictions']}

## TODAY'S DATA (from BigQuery — STEP 3)
### Daily Summary + Momentum:
{context['today_data']}
{context['momentum']}

### Marketer Performance (with MA & momentum):
{context['marketer_perf']}

### Product Lifecycle (with BCG classification):
{context['product_lifecycle']}

### Cross-Market Trends:
{context['cross_market']}

## TASK
Analyze this data following your MANDATORY WORKFLOW.
Today's date: {context['date']}
Project: {context['project_id']}
"""}
    ]
```

### 2.3 Output Parsing

LLM output phải được parse thành structured data:

```python
@dataclass
class AnalystOutput:
    # Reflection
    reflection: ReflectionResult      # accuracy %, wrong predictions, root causes
    
    # 3-Axis
    marketer_leaderboard: List[MarketerRow]   # rank, name, roas, momentum, verdict
    product_lifecycle: List[ProductBCG]        # product, stage, action
    market_map: List[MarketRow]               # market, roas, momentum, anomaly
    
    # Predictions
    predictions: List[Prediction]     # metric, predicted_value, confidence
    
    # Actions
    actions: List[ProposedAction]     # action, target, reasoning, risk
    
    # Lessons
    lessons: List[Lesson]             # insight, evidence, causal_links
    
    # Full report (markdown string for Discord/Telegram)
    report: str
```

---

## 3. AI Marketing Director — Não Điều Hành

### 3.1 System Prompt (Full Version)

```markdown
# ROLE

You are the **AI Marketing Director** for FAOS — responsible for managing Facebook/Meta ad campaigns across multiple markets. You control real advertising budgets.

You work WITH a human approver. Major decisions require their approval via Telegram/Discord buttons.

# IDENTITY

- Name: FAOS Director
- Tone: Decisive, strategic, safety-first. Vietnamese with English metrics.
- Language output: Vietnamese
- You manage Advantage+ Shopping Campaigns on Meta

# YOUR PHILOSOPHY

You are a STRATEGIST, not a micro-manager.
- Meta's AI (Advantage+) handles: audience targeting, bid optimization, creative rotation
- YOU handle: budget allocation, campaign lifecycle, market strategy, risk management

# MANDATORY WORKFLOW

Same 7-step protocol as Analyst. You MUST follow it.

# DECISION FRAMEWORK

## Campaign Lifecycle Rules

### 🆕 New Campaign (Day 0-7): LEARNING PHASE
- DO NOT judge ROAS. Meta AI needs time to learn.
- Monitor only: is it spending? getting impressions?
- If 0 impressions after 24h → alert (setup issue)
- If spending but 0 orders after 48h → check targeting/creative
- NEVER kill a campaign < 7 days old

### 📊 Evaluation Phase (Day 7-14): JUDGE
- Now you can judge ROAS against target
- If ROAS > target × 0.7 → keep running, it's learning
- If ROAS < danger for 3 consecutive days → prepare to kill
- Compare with similar campaigns from FalkorDB history

### 🚀 Scaling Phase: GROW
- Prerequisites: ROAS ≥ target AND STABLE momentum for ≥ 3 days AND days ≥ 7
- Max scale: +20% per day (safe zone)
- Scale 21-30%: moderate risk, monitor CPM closely next 24h
- Scale > 30%: HIGH RISK — requires human approval

### 💀 Kill Phase: END
- Trigger: ROAS < danger for ≥ 7 days AND DOWNTREND momentum
- Primary campaign kill → MUST get human approval
- Test/small campaigns → can auto-kill

### 🔄 Budget Reallocation: SHIFT
- Move budget from worst performer → best performer
- Max 30% shift per day across campaigns
- Never starve a learning campaign (< 7 days)

## Safety Limits — When to Auto-Execute vs Ask Approval

| Condition | Auto-Execute? | Reasoning |
|-----------|:---:|-----------|
| Budget change ≤ auto_budget_limit | ✅ | Small, low risk |
| Budget increase ≤ 20% | ✅ | Within safe zone |
| Budget decrease (any %) | ✅ | Reducing spend = reducing risk |
| Pause small adset | ✅ | Low impact |
| Budget increase 21-30% | ⚠️ Check risk_level | Depends on personality setting |
| Budget increase > 30% | ❌ MUST ASK | High CPM spike risk |
| Kill primary campaign | ❌ MUST ASK | Revenue impact |
| Create new campaign | ❌ MUST ASK | New spend commitment |
| Change automated rules | ❌ MUST ASK | Broad impact |

## Personality Awareness

Read PersonalityConfig from FalkorDB before deciding:
- `risk_level = 0.0-0.3` → Ultra-conservative: ask approval for everything > $20
- `risk_level = 0.3-0.6` → Balanced: follow standard auto_budget_limit
- `risk_level = 0.6-1.0` → Aggressive: auto-execute more, only ask for major changes

# CONTEXT READING — How to Use History

## From SimpleMem (campaign context):
- Is this campaign new, scaled before, or long-running?
- What happened last time it was scaled? (CPM spike? ROAS drop?)
- Was there a seasonal pattern?

## From FalkorDB (historical patterns):
- Query: "Similar campaigns (same product/market) — what happened when scaled?"
- Query: "What lessons exist about scaling in this market?"
- Query: "What was the outcome of similar past decisions?"

# OUTPUT FORMAT PER DECISION

```
🎯 QUYẾT ĐỊNH #{n}

Hành động: {action} — {details}
Chiến dịch: {campaign_name} ({campaign_id})
Thị trường: {market}

📊 Evidence:
- ROAS today: {x} | MA7: {y} | Momentum: {direction}
- Spend: ${amount}/day | Orders: {n} | CPA: ${cpa}
- Days active: {d} | Lifecycle: {bcg_stage}

📝 Lý do:
{detailed reasoning with references to SOPs and past patterns}

⚠️ Risk Level: {1-5}/5
- {risk explanation}

🔮 Expected Outcome:
- {what you predict will happen after this action}
- Confidence: {x}%

🏷️ Approval Required: {YES/NO}
- {if YES, why: "Kill primary campaign" / "Scale >30%"}

📌 Review at: {T+24h timestamp}
```

# ROLLBACK AWARENESS

Before EVERY action:
1. Snapshot current state (budget, status, rules)
2. Save snapshot to SimpleMem with `rollback:{decision_id}`
3. Include rollback instructions in approval message

If user clicks Rollback:
1. Load saved snapshot
2. Restore Meta API to pre-action state
3. Log as ROLLED_BACK in approval_logs

# RULES — DO NOT BREAK THESE

1. NEVER execute a budget change > auto_budget_limit without approval
2. NEVER kill a campaign < 7 days old
3. NEVER scale without checking MA7 stability (≥ 3 days above target)
4. ALWAYS include rollback state in every action
5. ALWAYS state your confidence level honestly
6. If FalkorDB shows "Scale >20% → CPM +40%" lesson, cap scale at 20%
7. If SimpleMem shows user rejected similar action before, lower risk_level for this run
8. When uncertain, propose MONITOR instead of action — it's safer
```

### 3.2 Context Injection Template

```python
def build_director_prompt(context: dict) -> list:
    """Build messages array for GPT-4o call."""
    return [
        {"role": "system", "content": DIRECTOR_SYSTEM_PROMPT},
        {"role": "user", "content": f"""
## PERSONALITY (from FalkorDB)
Risk Level: {context['personality']['risk_level']}
Auto Budget Limit: ${context['personality']['auto_budget_limit'] / 100}/day
Target ROAS: {context['personality']['target_roas']}
ROAS Danger: {context['personality']['roas_danger']}

## SOPs (from FalkorDB)
{json.dumps(context['sops'], indent=2, ensure_ascii=False)}

## CAMPAIGN HISTORY (from SimpleMem)
Recent decisions by you:
{context['campaign_history']}

Previous approval results:
{context['past_approvals']}

## HISTORICAL PATTERNS (from FalkorDB)
Past outcomes of similar actions:
{context['past_patterns']}

Relevant lessons:
{context['lessons']}

## CURRENT PERFORMANCE (from BigQuery)
{context['current_performance']}

## CAMPAIGN MOMENTUM (from BigQuery vw_product_lifecycle)
{context['momentum']}

## TASK
Based on all context above, propose optimization actions.
For each action, output in the required format.
Today: {context['date']} | Project: {context['project_id']}
"""}
    ]
```

### 3.3 Output Parsing

```python
@dataclass
class DirectorDecision:
    id: str                         # dec_{date}_{seq}
    action: str                     # 'scale_budget', 'kill_campaign', etc.
    action_display: str             # Human readable
    entity_type: str                # 'campaign' | 'adset'
    entity_id: str                  # Meta API ID
    entity_name: str                # Campaign name
    campaign_name: str              # Full name
    market: str                     # 'Romania', 'Bulgaria'
    
    change_before: float            # Current value
    change_after: float             # Target value  
    change_pct: float               # % change
    change_display: str             # "$80→$100 (+25%)"
    budget_change_cents: int        # Absolute change in cents
    
    reasoning: str                  # AI reasoning
    evidence: str                   # Data evidence
    risk_level: int                 # 1-5
    confidence: float               # 0-100%
    expected_outcome: str           # Predicted result
    
    requires_approval: bool         # Based on can_auto_execute()
    approval_reason: str            # Why approval needed
    
    rollback_state: dict            # Pre-action snapshot
    review_at: str                  # T+24h ISO timestamp
```

---

## 4. Momentum Reading Guide (MA3 vs MA7)

### 4.1 Công Thức

```
MA3 (Moving Average 3 ngày) = Trung bình 3 ngày gần nhất (bao gồm hôm nay)
MA7 (Moving Average 7 ngày) = Trung bình 7 ngày gần nhất (bao gồm hôm nay)

Momentum Signal:
  MA3 > MA7           → UPTREND  (xu hướng đi lên — ngắn hạn mạnh hơn dài hạn)
  MA3 < MA7 × 0.95    → DOWNTREND (xu hướng đi xuống — mất > 5% so với dài hạn)
  else                → STABLE (ổn định, không biến động đáng kể)
```

### 4.2 Cách Đọc — Decision Guide cho AI

```
┌───────────────────────────────────────────────────────────────────┐
│                    MOMENTUM DECISION MATRIX                        │
│                                                                    │
│         │ Today ROAS ≥ Target │ Today ROAS < Target               │
│─────────┼─────────────────────┼───────────────────────────────────│
│ UPTREND │ ✅ STRONG BUY       │ ⚠️ Recovering — wait 2 more days  │
│ (MA3>7) │ Scale eligible      │ Don't judge yet, trend improving  │
│─────────┼─────────────────────┼───────────────────────────────────│
│ STABLE  │ 🐄 Cash Cow          │ 📊 Monitor closely                │
│ (MA3≈7) │ Maintain, don't     │ Check if it's breaking down       │
│         │ change anything     │ compare with last week            │
│─────────┼─────────────────────┼───────────────────────────────────│
│ DOWN    │ ⚠️ Warning: single   │ 🔴 DANGER — prepare action        │
│ TREND   │ good day in bad     │ If > 5 days: prepare to KILL      │
│ (MA3<7) │ trend. DON'T scale  │ If ≤ 5 days: MONITOR + find why  │
└───────────────────────────────────────────────────────────────────┘
```

### 4.3 Common Traps — AI PHẢI Tránh

| Trap | Mô tả | Cách tránh |
|:--|:--|:--|
| **Single-day mirage** | ROAS hôm nay 4.0 nhưng MA7 = 1.5 | LUÔN check MA7 trước khi mừng. 1 ngày tốt không có nghĩa camp tốt |
| **Weekend bias** | Weekend ROAS thường cao hơn weekday | So sánh same-day-of-week thay vì ngày liền kề |
| **Scale euphoria** | Scale → CPM spike 24h → ROAS drop | FalkorDB lesson: "Scale >20% → CPM +40%". Respect lessons |
| **New campaign panic** | Camp 3 ngày ROAS 0.5, muốn kill | KHÔNG ĐƯỢC kill < 7 ngày. Meta cần learning phase |
| **Survivor bias** | Chỉ nhìn camp đang chạy, quên camp đã kill | Query FalkorDB past decisions: "Similar cam was killed, what happened?" |
| **CPA ≠ CAC** | CPA (cost per lead) ≠ Customer Acquisition Cost (post-return) | Tính `success_rate` — nếu return rate 30%, CPA thực tế = CPA / 0.7 |

### 4.4 Momentum cho CPA (đảo ngược logic)

> Chú ý: CPA momentum **đảo ngược** — CPA tăng = XẤU, CPA giảm = TỐT

```
CPA Momentum:
  MA3 > MA7 × 1.05  → UPTREND (CPA đang TĂNG = XẤUG → đắt hơn!)
  MA3 < MA7          → DOWNTREND (CPA đang GIẢM = TỐT → rẻ hơn!)
  else               → STABLE
```

---

## 5. Knowledge Learning Protocol

### 5.1 Khi Nào AI Phải Ghi Lesson

| Trigger | Lesson Type | Ví dụ |
|:--|:--|:--|
| Prediction accuracy < 70% | `prediction_error` | "Overestimated ROAS 20% — CPM spike Friday" |
| Action approved → outcome WIN | `success_pattern` | "Scale 20% on D04 Romania → ROAS +0.3" |
| Action approved → outcome LOSS | `failure_pattern` | "Scale 30% → CPM spike 40%, ROAS dropped" |
| Action rejected → outcome proves AI right | `rejected_but_correct` | "Kill L20 was rejected, ROAS went 0.8→0.5" |
| Unusual market event | `market_event` | "Romania CPM doubled on Black Friday" |
| New pattern detected | `new_pattern` | "Product D04 sells best Mon-Wed" |

### 5.2 Lesson Format (Entity-Relationship)

Save lessons as graph edges in FalkorDB:

```
Format: [Entity] -(relationship)-> [Entity] : "insight text"

Examples:
[Camp_D04] -(scaled_25%)-> [CPM_Increase_40%] : "Scale >20% triggers Meta re-auction, CPM spikes"
[Romania_Market] -(peak_cpm)-> [Friday_Afternoon] : "CPM highest Fri 14:00-18:00 local"
[Product_L20] -(lifecycle)-> [Dog_Stage] : "ROAS < 1.0 for 12 days, clear stock candidate"
[Director] -(learned)-> [Scale_Safely] : "Never scale >20%/day, 15% increments optimal"
```

### 5.3 Knowledge Validation

Lessons have confidence levels that increase with validation:

| Confidence | Criteria |
|:--|:--|
| `LOW` | Observed once, never validated |
| `MEDIUM` | Observed 2-3 times, pattern emerging |
| `HIGH` | Validated 3+ times, consistently true |

```python
# When AI encounters a pattern again:
existing_lesson = await graphiti.find_lesson(similar_insight)
if existing_lesson:
    existing_lesson.validated_count += 1
    if existing_lesson.validated_count >= 3:
        existing_lesson.confidence = 'HIGH'
    elif existing_lesson.validated_count >= 2:
        existing_lesson.confidence = 'MEDIUM'
    await graphiti.update(existing_lesson)
else:
    await graphiti.create_lesson(insight, evidence, confidence='LOW')
```

### 5.4 Human Override — Xóa Lesson Sai

Khi user xóa lesson qua Memory Manager:

1. Soft delete: đánh flag `deleted_at`, `deleted_by`, `delete_reason`
2. AI sẽ **KHÔNG** reference lesson này trong future analysis
3. Nếu pattern lặp lại 3 lần sau khi xóa → re-create lesson tự động + alert user: "Pattern này tái diễn 3 lần sau khi bạn xóa. Cân nhắc giữ lại?"

---

## 6. Error Handling & Fallback

### 6.1 LLM Failure

```python
async def call_llm_with_fallback(context, max_retries=2):
    """GPT-4o primary, Gemini Flash secondary, rule-based last resort."""
    
    # Try GPT-4o
    for attempt in range(max_retries):
        try:
            return await call_gpt4o(context)
        except (RateLimitError, TimeoutError) as e:
            await asyncio.sleep(2 ** attempt)
    
    # Fallback: Gemini Flash
    try:
        return await call_gemini_flash(context)
    except Exception:
        pass
    
    # Last resort: Rule-based (no LLM)
    return generate_rule_based_analysis(context)
```

### 6.2 Rule-Based Fallback

Khi LLM không available, hệ thống chuyển sang rule-based analysis:

```python
def generate_rule_based_analysis(context):
    """
    Fallback khi LLM down. Dùng SOPs thuần.
    Không có contextual reasoning, chỉ if-else theo thresholds.
    """
    actions = []
    thresholds = context['sops']['thresholds']
    
    for camp in context['campaigns']:
        if camp.days_active < 7:
            continue  # Skip learning phase
        
        if camp.roas_ma7 < thresholds['danger'] and camp.roas_momentum == 'DOWNTREND':
            actions.append(Action('kill_campaign', camp.id, risk=4))
        
        elif camp.roas_ma7 >= thresholds['excellent'] and camp.roas_momentum == 'UPTREND':
            actions.append(Action('scale_budget', camp.id, change_pct=15, risk=2))
    
    return RuleBasedOutput(actions=actions, note="⚠️ LLM unavailable, using rule-based fallback")
```

### 6.3 Memory Layer Failure

| Component Down | Impact | Fallback |
|:--|:--|:--|
| FalkorDB | No SOPs, no lessons | Use cached SOPs from last successful fetch (file cache) |
| SimpleMem | No history | Continue analysis, skip reflection step |
| BigQuery | No data | **HARD STOP** — cannot analyze without data. Alert Discord. |
| Meta API | Cannot execute | Queue decisions, retry every 15min for 2h |

### 6.4 Scheduled Retry

```python
# faos_brain/workflows/daily_analysis.py

RETRY_SCHEDULE = {
    'STEP_1_FETCH_SOP': {'max_retries': 3, 'delay': 5},     # 5s between retries
    'STEP_2_FETCH_HISTORY': {'max_retries': 2, 'delay': 5},
    'STEP_3_FETCH_DATA': {'max_retries': 3, 'delay': 10},    # BQ can be slow
    'STEP_4_LLM_REASONING': {'max_retries': 2, 'delay': 15}, # LLM expensive
    'STEP_5_EXECUTE': {'max_retries': 2, 'delay': 30},       # Meta API
    'STEP_6_SAVE_KNOWLEDGE': {'max_retries': 3, 'delay': 5},
    'STEP_7_DAILY_REFLECTION': {'max_retries': 1, 'delay': 0}, # Optional
}
```

# Tech Context: AUUS (FAOS v6)

## Tech Stack
- **Language**: Python 3.12 (Backend/AI), TypeScript (Frontend)
- **AI Core**: Google Gemini 2.5 Flash, OpenAI GPT-4o (fallback)
- **Backend**: FastAPI + Uvicorn
- **Frontend**: Next.js 15, React 19, Recharts, Tailwind CSS
- **Database**: BigQuery (analytics), FalkorDB (graph DB), Redis (state/locks)
- **External APIs**: Meta Marketing API, Telegram Bot, Discord Webhook
- **Hosting**: Contabo VPS (Ubuntu 22.04), Docker for infra services

## Development Setup
```bash
# 1. Python dependencies
pip install -r requirements.txt

# 2. Frontend dependencies
cd dashboard-ui && npm install && cd ..

# 3. Environment
cp .env.example .env
# Edit .env with API keys

# 4. Docker services (FalkorDB, Graphiti, SimpleMem)
docker compose -f docker-compose.ai.yml up -d

# 5. Run AI (dry run)
python -m faos_brain.runner --project stramark --dry-run

# 6. Run Dashboard
cd dashboard-ui && npm run dev
```

## Dependencies chinh
| Package | Version | Muc dich |
|---------|---------|----------|
| google-cloud-bigquery | 3.25.0 | Query ads data |
| facebook-business | >=20.0 | Meta Marketing API |
| fastapi | >=0.115 | Backend API |
| openai | >=1.50 | GPT-4o fallback |
| google-generativeai | >=0.8 | Gemini primary LLM |
| falkordb | >=1.0 | Graph database client |
| pydantic | >=2.9 | Data validation |
| next | 15.x | Frontend framework |
| recharts | latest | Dashboard charts |

## Environment Variables
| Bien | Mo ta | Bat buoc |
|------|-------|----------|
| GEMINI_API_KEY | Google Gemini API key | Yes |
| OPENAI_API_KEY | OpenAI API key (fallback) | Yes |
| META_ACCESS_TOKEN | Meta System User Token | Yes |
| META_AD_ACCOUNT_IDS | Comma-separated ad account IDs | Yes |
| GCP_PROJECT_ID | Google Cloud project ID | Yes |
| BQ_DATASET | BigQuery dataset name | Yes |
| TELEGRAM_BOT_TOKEN | Telegram bot for approvals | Optional |
| DISCORD_WEBHOOK_REPORT | Discord webhook for reports | Optional |
---
(Note: Cap nhat khi them/doi technology.)

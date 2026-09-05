# 🚀 GitHub Repos Setup Guide (for Nhat)

## Bước 1: Tạo 4 repos trên GitHub

Vào https://github.com/new, tạo lần lượt:

| Repo | Visibility | Description |
|---|---|---|
| `faos-core` | **Private** | FAOS shared framework |
| `faos-stramark` | **Private** | STRAMARK project |
| `faos-auus1` | **Private** | AUUS1 project |
| `faos-talpha` | **Private** | TALPHA project |

## Bước 2: Push code cho từng repo

### faos-core (shared code)
```bash
mkdir faos-core && cd faos-core
git init

# Copy shared components
cp -r ../AGENT/dashboard-ui/src/components/ui/ dashboard-ui/src/components/ui/
cp -r ../AGENT/dashboard-ui/src/lib/ dashboard-ui/src/lib/
cp -r ../AGENT/dashboard-ui/package.json dashboard-ui/
cp -r ../AGENT/dashboard-ui/next.config.ts dashboard-ui/
cp -r ../AGENT/dashboard-ui/tsconfig.json dashboard-ui/
cp -r ../AGENT/docs/ docs/

git add . && git commit -m "Initial: shared framework"
git remote add origin https://github.com/nhatngo-coder/faos-core.git
git push -u origin main
```

### faos-stramark
```bash
mkdir faos-stramark && cd faos-stramark
git init

# Copy project-specific code
cp -r ../AGENT/sync/stramark_sync.py sync/
cp -r ../AGENT/sync/run_all.py sync/
cp -r ../AGENT/sync/SETUP_SCHEDULER.bat sync/
cp -r ../AGENT/config/projects/stramark.yaml config/
cp -r ../AGENT/dashboard-ui/src/components/stramark/ dashboard-ui/src/components/stramark/
cp -r ../AGENT/dashboard-ui/src/app/stramark/ dashboard-ui/src/app/stramark/
cp ../AGENT/templates/stramark.env.template .env.template
cp ../AGENT/docs/HANDOVER_GUIDE.md docs/

# Add faos-core as submodule
git submodule add https://github.com/nhatngo-coder/faos-core.git faos-core

git add . && git commit -m "Initial: STRAMARK project"
git remote add origin https://github.com/nhatngo-coder/faos-stramark.git
git push -u origin main
```

### faos-auus1 (tương tự, thay stramark → auus1)
### faos-talpha (tương tự, thay stramark → talpha)

## Bước 3: Invite Leaders

1. Vào repo Settings → Collaborators
2. Add leader GitHub username với quyền **Write**
3. KHÔNG add leader vào repo của project khác

## Bước 4: Branch Protection (faos-core)

1. Vào `faos-core` → Settings → Branches
2. Add rule cho `main`:
   - ✅ Require pull request reviews
   - ✅ Require review from Code Owners (Nhat)
   - ✅ Dismiss stale reviews
   - ❌ Leader KHÔNG thể push thẳng vào main

## Bước 5: Gửi credentials cho leader

Gửi **riêng tư** (không qua GitHub):
- `.env` đã điền đầy đủ
- `bigquery_key.json` (SA chỉ access dataset của project đó)

## Bước 6: Leader clone & bắt đầu

```bash
git clone https://github.com/nhatngo-coder/faos-{project}.git
cd faos-{project}
git submodule update --init
cp .env.template .env  # Điền credentials
npm install --prefix dashboard-ui
pip install -r requirements.txt
npm run dev --prefix dashboard-ui
```

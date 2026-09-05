# 📋 FAOS Multi-project Handover Guide

## Tổng quan

Hệ thống FAOS được tách thành **4 repositories**:

| Repo | Mục đích | Ai truy cập |
|---|---|---|
| `faos-core` | Shared framework (dashboard UI, sync base) | Tất cả (read), Nhat (merge) |
| `faos-stramark` | Dự án STRAMARK | Nhat + Leader STR |
| `faos-auus1` | Dự án AUUS1 | Nhat + Leader AUUS1 |
| `faos-talpha` | Dự án TALPHA | Nhat + Leader TALPHA |

## Cấu trúc mỗi project repo

```
faos-{project}/
├── .env                      # Credentials (KHÔNG commit)
├── .env.template             # Template credentials (commit)
├── .gitignore
├── bigquery_key.json         # BQ Service Account (KHÔNG commit)
├── config/
│   └── {project}.yaml        # Project config
├── sync/
│   ├── {project}_sync.py     # Sync script
│   └── SETUP_SCHEDULER.bat   # Windows scheduler
├── dashboard-ui/             # Next.js dashboard
│   └── src/components/{project}/
├── docs/                     # SOPs + architecture
├── logs/                     # Auto-generated sync logs
└── faos-core/                # Git submodule (shared code)
```

## Setup cho Leader mới

### Bước 1: Clone repo
```bash
git clone https://github.com/nhatngo-coder/faos-{project}.git
cd faos-{project}
git submodule update --init    # Pull faos-core
```

### Bước 2: Config
```bash
cp .env.template .env
# Điền credentials vào .env (Nhat sẽ gửi riêng)
# Copy bigquery_key.json vào root (Nhat gửi riêng)
```

### Bước 3: Install
```bash
pip install requests google-cloud-bigquery python-dotenv
cd dashboard-ui && npm install
```

### Bước 4: Test sync
```bash
python sync/{project}_sync.py --test    # Dry run
python sync/{project}_sync.py --ads     # Sync ads data
```

### Bước 5: Run dashboard
```bash
cd dashboard-ui && npm run dev
# Mở http://localhost:3000
```

## Quy tắc khi sửa code

### ✅ ĐƯỢC LÀM
- Sửa code trong `sync/{project}_sync.py`
- Sửa dashboard tabs trong `dashboard-ui/src/components/{project}/`
- Thêm config trong `config/`
- Tạo views/tables mới trong BigQuery dataset **của project mình**

### ❌ KHÔNG ĐƯỢC LÀM
- Sửa trực tiếp `faos-core/` → tạo PR để Nhat review
- Sửa views/tables trong BigQuery dataset **của project khác**
- Commit `.env` hoặc `bigquery_key.json`
- Thay đổi App ID / token mà không báo Nhat

### 🔄 Muốn sửa shared code (faos-core)
1. Fork `faos-core` hoặc tạo branch
2. Sửa code
3. Tạo Pull Request → Nhat review & merge
4. Sau khi merge, update submodule:
   ```bash
   cd faos-core && git pull origin main
   cd .. && git add faos-core && git commit -m "Update core"
   ```

## Token renewal

Mỗi project có token riêng. Khi hết hạn:
1. Vào Graph API Explorer: https://developers.facebook.com/tools/explorer/
2. Chọn đúng App của project
3. Generate → copy token
4. Gửi cho Nhat → Nhat đổi long-lived token
5. Cập nhật `.env`

## Liên hệ

- **Nhat (Super Admin)**: Quản lý toàn bộ infra, BQ, tokens
- **Vấn đề kỹ thuật**: Tạo Issue trên GitHub repo tương ứng

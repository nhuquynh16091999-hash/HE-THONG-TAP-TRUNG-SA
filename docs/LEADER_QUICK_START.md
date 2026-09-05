# 🚀 FAOS v6 — LEADER QUICK START

> **Dành cho:** Project Leaders (AUUS1, ZEN8, và các dự án nhánh)
> **Thời gian setup:** ~15 phút

---

## BƯỚC 1: Clone Repository

```bash
# Clone dự án về máy
git clone https://github.com/nhatngo-coder/Agentic-AI-Levelup.git

# Di chuyển vào thư mục dự án
cd Agentic-AI-Levelup
```

> **🔗 Link Git:** https://github.com/nhatngo-coder/Agentic-AI-Levelup

---

## BƯỚC 2: Chạy Script Setup Tự Động

```bash
# Cấp quyền thực thi
chmod +x scripts/auto_setup_env.sh

# Chạy setup (sẽ hỏi tên dự án)
./scripts/auto_setup_env.sh
```

Script sẽ tự động:
- ✅ Kiểm tra Python 3.10+ và Node.js 18+
- ✅ Tạo Python virtual environment (`.venv`)
- ✅ Cài đặt Python dependencies (`pip install -r requirements.txt`)
- ✅ Cài đặt Frontend dependencies (`npm install`)
- ✅ Copy `.env.example` → `.env`
- ✅ Tạo cấu trúc thư mục cho dự án

---

## BƯỚC 3: Điền Thông Tin Dự Án

### 3a. Copy và điền file config dự án

```bash
# Copy template config
cp config/LEADER_ENV_TEMPLATE.env .env.project

# Mở file và điền thông tin
# (dùng editor bất kỳ: nano, vim, VS Code, Cursor)
code .env.project
```

### 3b. Danh sách thông tin CẦN ĐIỀN

| Mục | Biến | Lấy ở đâu | Bắt buộc? |
|:----|:-----|:-----------|:---------:|
| **Tên dự án** | `PROJECT_ID` | Boss giao (vd: auus1, zen8) | ✅ |
| **Tiền tệ** | `PROJECT_CURRENCY` | VND / USD / ... | ✅ |
| **BigQuery Dataset** | `BQ_DATASET` | `[TÊN]_Dataset` (vd: AUUS1_Dataset) | ✅ |
| **BigQuery Key** | `bigquery_key.json` | Boss cấp file | ✅ |
| **Meta App ID** | `META_APP_ID` | developers.facebook.com | ⚡ nếu có Ads |
| **Meta App Secret** | `META_APP_SECRET` | developers.facebook.com | ⚡ nếu có Ads |
| **Meta Access Token** | `META_ACCESS_TOKEN` | Business Manager → System Users | ⚡ nếu có Ads |
| **Meta Business ID** | `META_BUSINESS_ID` | Business Manager Settings | ⚡ nếu có Ads |
| **Meta Pixel ID** | `META_PIXEL_ID` | Events Manager | ⚡ nếu có Ads |
| **Meta Ad Accounts** | `META_AD_ACCOUNT_IDS` | Ads Manager (act_xxx) | ⚡ nếu có Ads |
| **POS API Key** | `POS_API_KEY` | Pancake/Sapo/KiotViet Admin | ⚡ nếu có POS |
| **POS API URL** | `POS_API_URL` | Tài liệu POS | ⚡ nếu có POS |
| **3PL API Key** | `LOGISTICS_API_KEY` | GHN/GHTK/JT Admin | 🔹 tuỳ chọn |
| **AI Key (Gemini)** | `GEMINI_API_KEY` | aistudio.google.com | 🔹 hỏi Boss |
| **AI Key (OpenAI)** | `OPENAI_API_KEY` | platform.openai.com | 🔹 hỏi Boss |

### 3c. Cập nhật biến trong file `.env` gốc

Mở file `.env` (đã được tạo từ `.env.example`) và sửa 2 dòng:

```bash
# Đổi tên dự án
PROJECT_ID=auus1               # ← đổi thành tên dự án của bạn

# Đổi dataset
BQ_DATASET=AUUS1_Dataset       # ← đổi thành [TÊN]_Dataset
```

---

## BƯỚC 4: Tạo Git Branch

```bash
# Tạo nhánh riêng cho dự án
git checkout -b feature/[TÊN_DỰ_ÁN]-initial-setup

# Ví dụ:
git checkout -b feature/auus1-initial-setup
```

---

## BƯỚC 5: Mở AI và Bắt Đầu

1. Mở **Claude** hoặc **Cursor**
2. Copy toàn bộ nội dung file `docs/LEADER_AI_ONBOARDING_PROMPT.md`
3. Paste vào chat AI
4. Thay `[TÊN_DỰ_ÁN]` bằng tên dự án thật
5. AI sẽ tự xác nhận hiểu kiến trúc và vùng lãnh thổ

---

## 📖 TÀI LIỆU BẮT BUỘC ĐỌC

| File | Mục đích |
|:-----|:---------|
| `docs/TRAINING_MANUAL.md` | Cẩm nang đào tạo — 4 quy tắc sống còn |
| `docs/STANDARD_TEMPLATES.md` | 3 biểu mẫu phải điền TRƯỚC khi code |
| `docs/SYSTEM_ARCHITECTURE.md` | Kiến trúc hệ thống (đọc + nạp vào AI) |
| `docs/SCHEMA_FROZEN.md` | Schema database chuẩn |
| `config/LEADER_ENV_TEMPLATE.env` | Template config — copy thành `.env.project` |

---

## ⚠️ QUY TẮC NHẮC LẠI

- 🔴 **CẤM** chạm vào `faos_brain/`, `config/`, `tests/`, `sql/stramark/`
- 🟢 **ĐƯỢC** code trong `app/projects/[DỰ_ÁN]/`, `sql/[DỰ_ÁN]/`, `api/routers/[DỰ_ÁN]/`
- ✅ Điền form thiết kế → Boss duyệt → mới được code
- ✅ AI self-review trước khi commit
- ✅ Commit format: `[PROJECT] type: message`
- ❌ KHÔNG bắt AI sửa đè code lỗi → `git revert` + session mới

---

*FAOS v6 — Leader Quick Start — 2026-03-02*

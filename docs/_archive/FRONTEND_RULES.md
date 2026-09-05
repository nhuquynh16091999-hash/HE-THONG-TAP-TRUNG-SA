# 🎨 Frontend Rules ⛔ LỖI THỜI — ĐÃ ARCHIVE 03/08/2026

> **KHÔNG DÙNG FILE NÀY.** Sai so với code đang chạy: `DATA_CONTRACT.md` mà file
> này trỏ tới là tài liệu của dự án STRAMARK (cũng đã archive) nên mọi ràng buộc
> "chỉ được đọc view X" trong đó không áp dụng; Tailwind thực tế là v3
> (`tailwindcss ^3.3.0`), Next.js là **16**.
>
> Về `/api/query`: route này **vẫn sống và vẫn là đường chính** của 6 tab BigQuery
> (CEO, Marketing, P&L, P&L theo SP, Khách hàng, Market Intel). Các route
> `/api/talpha/*` là đường riêng cho realtime/tồn kho/snapshot, KHÔNG thay thế nó —
> đừng đọc file này rồi đi gỡ `/api/query`.
>
> Thay bằng:
> - Convention frontend → `.agent/rules/frontend-conventions.md`
> - Kiến trúc + cấu trúc thư mục thật → `docs/ARCHITECTURE_2026.md` §5
> - Rule số liệu → `docs/TALPHA_METRIC_RULES.md`
>
> Giữ lại chỉ để tra lịch sử. (Archive: mục F4.)

---

## Phạm vi làm việc
- CHỈ sửa files trong `dashboard-ui/src/`
- KHÔNG sửa bất kỳ file nào ngoài `dashboard-ui/`
- KHÔNG tạo file mới ngoài `dashboard-ui/`

## Data Access
- Gọi data qua `/api/query` route (đã có sẵn)
- SQL queries chỉ SELECT từ views trong DATA_CONTRACT.md
- KHÔNG viết INSERT/UPDATE/DELETE

## Tech Stack
- Next.js 15 (App Router)
- TailwindCSS 4
- Recharts (charts)
- TypeScript strict mode

## Design System
- Dark theme: bg-[#0e1117], card bg-[#1e1e2e]
- Accent: indigo-500, emerald-400
- Font: Inter (Google Fonts)
- Border radius: rounded-xl
- Shadows: ring-1 ring-white/10

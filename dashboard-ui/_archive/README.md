# dashboard-ui/_archive — code legacy đã gỡ khỏi build

Thư mục này KHÔNG được Next.js compile và bị loại khỏi `tsconfig.json` (`exclude`).
Giữ lại để tra cứu, không phải để import. Cần dùng lại → `git mv` ngược vào `src/`
rồi chạy `npm run build` kiểm tra.

Gỡ trong hạng mục **A6 — Route & tab legacy (P2)**, ngày 03/08/2026. Mỗi file dưới
đây đã được xác nhận **0 tham chiếu** trong `src/` trước khi chuyển đi.

## Route đã gỡ

| Đường dẫn cũ | Vì sao gỡ |
|---|---|
| `/api/agent/search` | Của dự án "AGENT" cũ: gọi `child_process.execFile` vào `.venv/Scripts/python.exe` (đường dẫn Windows, không tồn tại trên Mac/server). Nhận `query` từ request rồi đưa xuống tiến trình con — bề mặt tấn công thừa. |
| `/api/ai-insights` | Gọi Gemini. P0-F2 đã bỏ hẳn Gemini và gỡ key khỏi cả 2 máy → route chỉ còn trả lỗi "GEMINI_API_KEY chưa được cấu hình". |
| `/api/sync-all` | Của dự án `Agentic-AI-Levelup`: `exec` script sync và đọc `bigquery_key_t1.json` (không có trong repo này). Sync thật chạy bằng launchd `com.talpha.dailyreport`. |
| `/api/sync-status` | Đọc `/tmp/t1_sync_status.json` — file trạng thái của dự án t1 cũ. Tình trạng sync thật xem `/api/talpha/sync-health`. |
| `/api/auth/users` | Trùng chức năng `/api/users` (bản đang được `/admin` dùng). Không UI nào gọi route này. |

## Component & lib đã gỡ

| File cũ | Vì sao gỡ |
|---|---|
| `components/ui/kpi-tracker.tsx` | Fetch `/api/kpi-sheets` — route đã bị xoá từ lâu, component gọi vào hư không. |
| `components/ui/sub-tab-bar.tsx` | Không tab nào import; `dashboard-shell.tsx` tự dựng thanh tab riêng. |
| `components/admin-home.tsx` | Trang admin thật là `app/admin/page.tsx`; component này không được render ở đâu. |
| `lib/capi-transform.ts` | Facebook CAPI — tính năng chưa từng bật trên TALPHA. |
| `lib/shipping-rates.ts` | Phí ship đã chuyển vào rules dùng chung ở hạng mục E3. |
| `lib/constants.ts` | Trùng tên nhưng KHÁC file với `components/talpha/constants.ts` (bản đang dùng). Bản trong `lib/` không ai import. |
| `lib/auth-types.ts` | Type auth cũ; `lib/auth.ts` đã tự khai báo type của nó. |

## Dọn nốt 04/08/2026

`src/middleware.ts` vẫn còn cấu hình của các route đã xoá từ lâu (commit `3f3787d`):
`ALL_PROJECT_PREFIXES` liệt kê `/ai-brain` + `/ads-command-center` top-level để
"chặn dự án khác", và `PROTECTED_PREFIXES` còn `/agent-control`. Cả 3 đường dẫn
đều không có page trong `src/app/`. Đã gỡ khối `BLOCKED_PREFIXES`; route không tồn
tại nay rơi xuống 404 thay vì redirect về `/talpha`.

Lưu ý: page ads-command-center **đang sống** ở `/talpha/ads-command-center` —
prefix bị gỡ là bản top-level `/ads-command-center` của dự án cũ, không đụng tới nó.

## Đã cân nhắc nhưng GIỮ LẠI

- `app/api/auth/register/route.ts` — stub cố ý trả 403 để chặn tự đăng ký. Gỡ đi thì
  `/api/auth/register` rơi xuống catch-all `[...nextauth]`, mất chốt chặn tường minh.
- `components/tabs/ad-accounts-tab.tsx`, `components/tabs/user-management-tab.tsx` —
  2 tab còn sót của `components/tabs/` cũ nhưng vẫn được `app/admin/page.tsx` import.
- `/api/query` — audit 29/07 xếp vào diện nghi legacy, thực tế **6 tab BigQuery đang
  dùng** (CEO, Marketing, P&L, P&L theo SP, Khách hàng, Market Intel). Không được gỡ.

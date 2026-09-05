# Master Prompt: V5.1 Auto-Routing Optimization

## NGỮ CẢNH
- V5.1 hiện có 10 workflows, user phải gõ `/command` để trigger
- `.cursorrules` + `00-kernel.md` chứa rules nhưng không có logic auto-routing
- Mục tiêu: AI tự chọn đúng workflow dựa trên loại yêu cầu, user không cần gõ `/command`

## YÊU CẦU CHI TIẾT

### Giải pháp: 3 tầng tự động hóa

**Tầng 1: Kernel Auto-Router (sửa `00-kernel.md`)**
- Thêm section `AUTO-ROUTING` vào Kernel
- Khi nhận yêu cầu → AI tự phân loại → chạy workflow phù hợp
- Bảng routing:
  - Yêu cầu mơ hồ (Gap ≥80%) → tự chạy `/refine-intent`
  - "Thêm feature X" → tự chạy `/new-feature`
  - "Fix bug Y" / "Lỗi Z" → tự chạy `/debug`
  - "Review code" / "Kiểm tra" → tự chạy `/code-review`
  - Đầu session mới → tự chạy `/context-refresh`
  - Trước commit → tự chạy `/memory-check`
  - User nói "compact" → tự chạy `/session-compact`
- GIẢI BỎ quyền gọi `/command` thủ công (vẫn giữ làm override)

**Tầng 2: Event-Driven Hooks (tạo git hooks)**
- `pre-commit` hook: chạy memory-check tự động
- `post-checkout` hook: chạy context-refresh
- Tạo `.agents/hooks/` chứa scripts

**Tầng 3: Session Auto-Start (sửa `01-context-layer.md`)**
- Thêm rule: "Khi bất đầu session → ĐỌC activeContext.md + git log -3 → tóm tắt 3 dòng"
- Thay thế `/context-refresh` thủ công

## MODULES LIÊN QUAN
- `.cursorrules` — compact rules pointer
- `.agents/rules/00-kernel.md` — main logic (SỬA)
- `.agents/rules/01-context-layer.md` — context rules (SỬA)
- `.agents/workflows/*.md` — 10 workflow files (GIỮ NGUYÊN, chỉ gọi tự động)

## RÀNG BUỘC
- KHÔNG xóa `/command` thủ công — giữ làm fallback
- KHÔNG thay đổi nội dung workflow files — chỉ thêm auto-routing logic
- Giữ `// turbo-all` annotations
- Compatible với cả Antigravity IDE và các AI IDE khác (Cursor, Windsurf)

## ACCEPTANCE CRITERIA
- [ ] AI tự nhận diện loại task → chạy đúng workflow mà user không cần gõ `/command`
- [ ] `/command` thủ công vẫn hoạt động (backward compatible)
- [ ] Đầu session → AI tự load context
- [ ] Trước commit → AI tự check memory

## VERIFICATION
- Gửi yêu cầu "Thêm feature mới" → AI tự chạy `/new-feature` pipeline
- Gửi yêu cầu mơ hồ → AI tự chạy `/refine-intent`
- Mở session mới → AI tự tóm tắt context

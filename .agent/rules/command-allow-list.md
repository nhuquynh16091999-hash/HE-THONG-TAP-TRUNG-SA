# ══════════════════════════════════════════════════════
#  COMMAND ALLOW LIST — SafeToAutoRun = true
#  AI Agent được phép tự động chạy các lệnh sau
#  mà KHÔNG CẦN hỏi xác nhận từ người dùng
# ══════════════════════════════════════════════════════

# ─── 1. HỆ THỐNG & ĐIỀU HƯỚNG (Cực kỳ an toàn) ───
# Giúp AI tự do "nhìn" và di chuyển trong dự án

# ls              — Liệt kê file (Mac/Linux)
# dir             — Liệt kê file (Windows)
# pwd             — Kiểm tra đường dẫn thư mục hiện tại
# cd              — Di chuyển giữa các thư mục
# cat             — Đọc nội dung file
# tree            — Xem cấu trúc cây thư mục
# echo            — In chuỗi ra màn hình

# ─── 2. GIT — CHỈ ĐỌC (Read-only) ───
# Giúp AI kiểm tra trạng thái code, nhánh, lịch sử

# git status      — Kiểm tra trạng thái file thay đổi
# git diff        — Xem chi tiết đoạn code vừa sửa
# git log         — Xem lịch sử commit
# git branch      — Xem danh sách nhánh

# ─── 3. QUẢN LÝ THƯ VIỆN NODE.JS ───
# Để AI tự động tải các package cần thiết

# npm install     — Cài đặt thư viện (npm i)
# npm ci          — Cài đặt chính xác theo package-lock
# npm list        — Kiểm tra thư viện đã cài
# yarn install    — (Nếu dùng Yarn)
# pnpm install    — (Nếu dùng pnpm)

# ─── 4. CHẠY KỊCH BẢN (Scripts) ───
# Để AI tự kiểm tra lỗi hoặc xem trước kết quả

# npm run dev     — Chạy server môi trường phát triển
# npm run build   — Đóng gói ứng dụng
# npm run lint    — Kiểm tra lỗi cú pháp code
# npm run format  — Làm đẹp code
# npm test        — Chạy các bài test tự động

# ─── 5. PYTHON (Dành cho dự án AI & Data) ───
# Triển khai mô hình AI hoặc script tự động hóa

# pip install     — Cài đặt thư viện
# pip list        — Xem danh sách thư viện đã cài
# python --version — Kiểm tra phiên bản Python
# pytest          — Chạy test Python
# python -m venv  — Quản lý môi trường ảo

# ─── 6. HẠ TẦNG, DOCKER & SERVER ───
# Cực kỳ quan trọng cho n8n & SaaS
# Cấp quyền ĐỌC log để AI tự bắt lỗi hệ thống

# docker ps           — Xem các container đang chạy
# docker logs         — Đọc log để AI tự debug lỗi n8n/app
# docker-compose ps   — Xem trạng thái các services
# pm2 status          — Kiểm tra app Node.js/Python đang chạy nền
# pm2 logs            — Đọc log từ PM2

# ─── 7. NETWORK & KIỂM THỬ API ───
# Dành cho Webhook & Tích hợp

# curl            — Gọi thử API, test kết nối HTTP/HTTPS
# ping            — Kiểm tra kết nối mạng cơ bản

# ─── 8. ĐA NGÔN NGỮ (Go, Rust, PHP, Python...) ───
# Kết hợp nhiều microservices

# Go:
# go run          — Chạy file Go
# go build        — Build project Go
# go test         — Chạy test Go
# go mod tidy     — Tự dọn dẹp thư viện Go

# Rust:
# cargo check     — Kiểm tra lỗi cực nhanh
# cargo test      — Chạy test Rust

# PHP:
# composer install — Cài thư viện PHP
# php -v          — Kiểm tra phiên bản PHP

# ─── 9. DATABASE ORM & TOOLS ───
# Cấp quyền chuẩn bị dữ liệu (CHỈ ĐỌC/GENERATE)

# npx prisma generate  — Tự động tạo client sau khi sửa schema
# npx prisma validate  — Kiểm tra file schema có lỗi không

# ══════════════════════════════════════════════════════
# ⛔⛔⛔ DANH SÁCH CẤM — TUYỆT ĐỐI KHÔNG AUTO-RUN ⛔⛔⛔
# ══════════════════════════════════════════════════════
#
# ❌ prisma db push        — Thay đổi database schema
# ❌ npx drizzle-kit push  — Thay đổi database schema
# ❌ prisma migrate        — Migration database
# ❌ drizzle-kit migrate   — Migration database
# ❌ rm -rf                — Xóa file/folder nguy hiểm
# ❌ DROP TABLE / DROP DATABASE — Xóa dữ liệu
# ❌ git push / git merge  — Thay đổi remote repository
# ❌ docker rm / docker rmi — Xóa container/image
# ❌ npm publish           — Publish package lên registry
#
# Dữ liệu SaaS mà để AI tự chạy lệnh thay đổi
# database là CỰC KỲ NGUY HIỂM!
# ══════════════════════════════════════════════════════

// PM2 — SERVER 169.58.33.8 (/opt/talpha).
// ĐÂY LÀ FILE ECOSYSTEM DUY NHẤT CHO SERVER. Không tạo thêm file pm2 nào khác.
//
// Chạy trên server:
//   pm2 start /opt/talpha/ops/pm2/ecosystem.server.config.js && pm2 save
// Deploy chuẩn: scripts/deploy_server.sh (git pull + build + restart).
//
// CẢNH BÁO CỔNG: port 3000 do app auus1-frontend chiếm — ĐỪNG kill, đừng đổi
// dashboard TALPHA về 3000. AUTH_URL trong /opt/talpha/dashboard-ui/.env phải
// trỏ :3001, sai cổng là login hỏng.
//
// Trên server còn các app của dự án khác (auus1-*, pialpha-*) trong namespace
// `default`. App TALPHA nằm namespace `talpha` để lệnh hàng loạt không đụng nhau:
//   pm2 restart talpha         # chỉ 2 app TALPHA, không đụng auus1-*/pialpha-*
const ROOT = '/opt/talpha';

module.exports = {
  apps: [
    {
      name: 'talpha-dashboard',
      namespace: 'talpha',
      cwd: `${ROOT}/dashboard-ui`,
      // Chạy thẳng binary next thay vì `npm start`: bớt 1 tầng process, pm2
      // restart/resurrect không dính lỗi uv_cwd của npm.
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3001',
      interpreter: 'node',
      exec_mode: 'fork',
      instances: 1,

      autorestart: true,
      max_restarts: 10,
      min_uptime: '15s',
      restart_delay: 3000,

      max_memory_restart: '800M',
      // Khai tên log tường minh: có `instances` là pm2 gắn số id vào tên file
      // (talpha-dashboard-out-5.log) trừ khi bật merge_logs — mỗi lần delete/start
      // là log đổi chỗ, runbook và lệnh tail cũ trỏ vào file chết.
      merge_logs: true,
      out_file: '/root/.pm2/logs/talpha-dashboard-out.log',
      error_file: '/root/.pm2/logs/talpha-dashboard-error.log',
      env: {
        NODE_ENV: 'production',
        PORT: '3001',
      },
    },
    {
      name: 'talpha-wa-alerts',
      namespace: 'talpha',
      cwd: `${ROOT}/ops/whatsapp-alerts`,
      script: 'bot.js',
      interpreter: 'node',
      exec_mode: 'fork',
      instances: 1,

      // Bot giữ phiên WhatsApp trong .wwebjs_auth cùng thư mục — restart được,
      // nhưng xoá thư mục đó là phải quét lại QR (xem runbook §6).
      autorestart: true,
      max_restarts: 20,
      min_uptime: '30s',
      restart_delay: 5000,

      max_memory_restart: '700M',
      merge_logs: true,
      out_file: '/root/.pm2/logs/talpha-wa-alerts-out.log',
      error_file: '/root/.pm2/logs/talpha-wa-alerts-error.log',
    },
  ],
};

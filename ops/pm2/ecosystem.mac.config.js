// PM2 — MÁY MAC (máy dev + dashboard nội bộ port 3000).
// ĐÂY LÀ FILE ECOSYSTEM DUY NHẤT CHO MAC. Không tạo thêm file pm2 nào khác.
//
// Chạy:
//   pm2 start ops/pm2/ecosystem.mac.config.js && pm2 save
// Restart sau khi build:
//   cd dashboard-ui && npm run build && pm2 restart talpha-dashboard
//
// LƯU Ý macOS: pm2 daemon phải khởi động từ shell có Full Disk Access (đọc được
// ~/Desktop), nếu không sẽ EPERM khi nạp binary next. Máy khởi động lại thì
// LaunchAgent com.talpha.pm2-resurrect lo resurrect — KHÔNG dùng `pm2 startup`.
//
// KHÔNG có app sync ở đây: sync/sheet trên Mac chạy bằng launchd
// (com.talpha.dailyreport, com.talpha.export-worker, com.talpha.shadowsync)
// trỏ vào runtime ~/talpha_reports. Thêm app sync vào pm2 = chạy sync 2 lần.
//
// Namespace `talpha` để phân biệt với các app pm2 của dự án khác trên cùng máy
// (web broadcast "Bắn bot AI" = broadcast-web / broadcast-cron).
const REPO = '/Users/syanh/Desktop/Talpha-New-16-6';

module.exports = {
  apps: [
    {
      name: 'talpha-dashboard',
      namespace: 'talpha',
      cwd: `${REPO}/dashboard-ui`,
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000',
      interpreter: 'node',
      exec_mode: 'fork',
      instances: 1,

      // Guard chống crash-loop vô tận: không sống nổi 15s thì sau 10 lần thử
      // pm2 DỪNG hẳn (status: errored) thay vì hammer restart hàng trăm lần.
      autorestart: true,
      max_restarts: 10,
      min_uptime: '15s',
      restart_delay: 3000,

      max_memory_restart: '600M',
      // Khai tên log tường minh: có `instances` là pm2 gắn số id vào tên file
      // (talpha-dashboard-out-5.log) trừ khi bật merge_logs — mỗi lần delete/start
      // là log đổi chỗ, runbook và lệnh tail cũ trỏ vào file chết.
      merge_logs: true,
      out_file: '/Users/syanh/.pm2/logs/talpha-dashboard-out.log',
      error_file: '/Users/syanh/.pm2/logs/talpha-dashboard-error.log',
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
      },
    },
  ],
};

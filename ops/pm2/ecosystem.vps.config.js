// ═══════════════════════════════════════════════════════════════════
// PM2 — FILE ECOSYSTEM DUY NHẤT. Máy chủ 139.180.131.21, code ở /opt/talpha.
// ───────────────────────────────────────────────────────────────────
// Chạy TRÊN MÁY CHỦ:
//     pm2 start /opt/talpha/ops/pm2/ecosystem.vps.config.js --only talpha-dashboard
//     pm2 save
//
// 11/09/2026 đã gộp từ BỐN file về một. Ba file kia đều tả hạ tầng không còn:
//   • ecosystem.server.config.js — máy chủ CŨ 169.58.33.8, cổng 3001
//   • ecosystem.mac.config.js    — chạy dashboard trên máy Mac qua Cloudflare
//                                  Tunnel + caffeinate; máy Mac nay chỉ là máy dev
//   • dashboard-ui/ecosystem.config.js — bản thứ tư, không ai trỏ tới
// Bốn file cùng khai một app tên `talpha-dashboard` với ba cổng khác nhau là cách
// chắc chắn nhất để một ngày nào đó khởi động nhầm bản rồi đi tìm xem số ở đâu ra.
//
// Máy Mac chạy dev bằng `cd dashboard-ui && npm run dev`. Build ở Mac KHÔNG phải
// là deploy — deploy là `bash ops/deploy/from-mac.sh`.
// ═══════════════════════════════════════════════════════════════════
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');

module.exports = {
    apps: [
        {
            name: 'talpha-dashboard',
            namespace: 'talpha',
            cwd: path.join(REPO, 'dashboard-ui'),
            // Đường dẫn TƯƠNG ĐỐI + cwd. Tuyệt đối thì pm2 rơi về chạy qua shell
            // và sinh lỗi khó hiểu khi đường dẫn có ký tự lạ hoặc khoảng trắng.
            script: 'node_modules/next/dist/bin/next',
            args: 'start -p 3000',
            interpreter: 'node',
            exec_mode: 'fork',
            instances: 1,

            // Không sống nổi 15s thì sau 10 lần pm2 DỪNG hẳn thay vì đập restart
            // hàng trăm lượt và che mất lỗi thật.
            autorestart: true,
            max_restarts: 10,
            min_uptime: '15s',
            restart_delay: 3000,
            max_memory_restart: '600M',

            // Khai tên log tường minh: có `instances` là pm2 gắn số id vào tên file
            // trừ khi bật merge_logs — mỗi lần delete/start là log đổi chỗ và mọi
            // lệnh tail trong runbook trỏ vào file chết.
            merge_logs: true,
            out_file: '/var/log/talpha/dashboard-out.log',
            error_file: '/var/log/talpha/dashboard-error.log',
            env: { NODE_ENV: 'production', PORT: '3000' },
        },

        // ─────────────────────────────────────────────────────────────
        // Bot cảnh báo WhatsApp — HIỆN ĐANG TẮT, không nằm trong `pm2 save`.
        //
        // Chưa từng chạy trên máy chủ này: không có node_modules, chưa quét QR
        // (phiên WhatsApp nằm ở ops/whatsapp-alerts/.wwebjs_auth). Trước đây nó
        // chạy ở máy chủ cũ 169.58.33.8.
        //
        // Bật lại:
        //     cd /opt/talpha/ops/whatsapp-alerts && npm ci
        //     node pair.js                    # quét QR một lần
        //     pm2 start /opt/talpha/ops/pm2/ecosystem.vps.config.js --only talpha-wa-alerts
        //     pm2 save
        // ─────────────────────────────────────────────────────────────
        {
            name: 'talpha-wa-alerts',
            namespace: 'talpha',
            cwd: path.join(REPO, 'ops', 'whatsapp-alerts'),
            script: 'bot.js',
            interpreter: 'node',
            exec_mode: 'fork',
            instances: 1,

            // Bot giữ phiên WhatsApp trong .wwebjs_auth cùng thư mục — restart được,
            // nhưng xoá thư mục đó là phải quét lại QR.
            autorestart: true,
            max_restarts: 20,
            min_uptime: '30s',
            restart_delay: 5000,
            max_memory_restart: '700M',

            merge_logs: true,
            out_file: '/var/log/talpha/wa-alerts-out.log',
            error_file: '/var/log/talpha/wa-alerts-error.log',
        },
    ],
};

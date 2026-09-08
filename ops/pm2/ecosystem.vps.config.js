// PM2 — chạy dashboard TALPHA trên máy chủ Linux.
//
// Khác bản chạy trên Mac (ecosystem.mac.config.js) ở ba chỗ:
//   • KHÔNG có talpha-awake — máy chủ không ngủ
//   • KHÔNG có talpha-tunnel — máy chủ có IP công khai sẵn, không cần đường hầm
//   • Có talpha-sync — nửa đường ống bơm số vào BigQuery, thứ máy Mac chưa chạy
//
// Chạy:
//   pm2 start ops/pm2/ecosystem.vps.config.js && pm2 save
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');

module.exports = {
    apps: [
        {
            name: 'talpha-dashboard',
            namespace: 'talpha',
            cwd: path.join(REPO, 'dashboard-ui'),
            // Đường dẫn TƯƠNG ĐỐI + cwd, giống bản Mac. Tuyệt đối thì pm2 rơi về
            // chạy qua shell và sinh lỗi khó hiểu khi đường dẫn có ký tự lạ.
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

            merge_logs: true,
            out_file: '/var/log/talpha/dashboard-out.log',
            error_file: '/var/log/talpha/dashboard-error.log',
            env: { NODE_ENV: 'production', PORT: '3000' },
        },
    ],
};

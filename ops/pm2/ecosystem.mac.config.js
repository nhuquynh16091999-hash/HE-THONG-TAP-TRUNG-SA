// PM2 — chạy dashboard trên máy Mac, mở ra ngoài bằng Cloudflare Tunnel.
//
// Chạy:
//   cd dashboard-ui && npm run build
//   pm2 start ops/pm2/ecosystem.mac.config.js && pm2 save
//
// Khởi động lại sau khi build:
//   cd dashboard-ui && npm run build && pm2 restart talpha-dashboard
//
// Ba tiến trình:
//   talpha-dashboard  — Next.js ở cổng 3000
//   talpha-tunnel     — Cloudflare Tunnel, đưa cổng 3000 ra địa chỉ web công khai
//   talpha-awake      — giữ máy không ngủ; máy ngủ là cả đội mất dashboard
//
// ĐƯỜNG DẪN tự suy từ vị trí file này. Bản trước ghi cứng /Users/syanh/... nên
// chép sang máy khác là pm2 chạy vào thư mục không tồn tại rồi chết câm.
const path = require('path');
const os = require('os');

const REPO = path.resolve(__dirname, '..', '..');
const LOGS = path.join(os.homedir(), '.pm2', 'logs');

module.exports = {
  apps: [
    {
      name: 'talpha-dashboard',
      namespace: 'talpha',
      cwd: path.join(REPO, 'dashboard-ui'),
      // Script để ĐƯỜNG DẪN TƯƠNG ĐỐI, không phải tuyệt đối. Thư mục dự án có
      // khoảng trắng ("Dashboard Sỹ Anh"); đưa đường dẫn tuyệt đối vào thì pm2
      // rơi về chạy qua `/bin/bash -c ...`, rồi lại bắt `node` biên dịch chính
      // /bin/bash như file JS — app chết ngay với SyntaxError khó hiểu.
      // Đường dẫn tương đối cộng `cwd` ở trên thì không đi qua shell.
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000',
      interpreter: 'node',
      exec_mode: 'fork',
      instances: 1,

      // Guard chống restart vô tận: không sống nổi 15s thì sau 10 lần pm2 DỪNG
      // hẳn (status errored) thay vì đập restart hàng trăm lần.
      autorestart: true,
      max_restarts: 10,
      min_uptime: '15s',
      restart_delay: 3000,
      max_memory_restart: '600M',

      merge_logs: true,
      out_file: path.join(LOGS, 'talpha-dashboard-out.log'),
      error_file: path.join(LOGS, 'talpha-dashboard-error.log'),
      env: { NODE_ENV: 'production', PORT: '3000' },
    },

    {
      name: 'talpha-tunnel',
      namespace: 'talpha',
      cwd: REPO,
      script: '/opt/homebrew/bin/cloudflared',
      // Địa chỉ web lấy từ ~/.cloudflared/config.yml (đường hầm có tên, địa chỉ
      // cố định). Chưa dựng đường hầm có tên thì xem docs/DEPLOY_MACBOOK.md —
      // đường hầm tạm chạy được ngay nhưng địa chỉ đổi sau mỗi lần khởi động.
      args: ['tunnel', 'run', 'talpha'],
      interpreter: 'none',
      autorestart: true,
      max_restarts: 20,
      min_uptime: '10s',
      restart_delay: 5000,
      merge_logs: true,
      out_file: path.join(LOGS, 'talpha-tunnel-out.log'),
      error_file: path.join(LOGS, 'talpha-tunnel-error.log'),
    },

    {
      name: 'talpha-awake',
      namespace: 'talpha',
      cwd: REPO,
      // Máy này đang đặt tự ngủ sau 1 phút. Ngủ là dashboard tắt, đường hầm đứt,
      // cả đội mất truy cập. caffeinate giữ máy thức mà KHÔNG cần mật khẩu quản
      // trị — khác với `sudo pmset`, nên chạy được ngay.
      //   -i không ngủ hệ thống · -m không ngủ ổ đĩa · -s chỉ khi cắm điện
      // Cố ý KHÔNG dùng -d: màn hình vẫn được phép tắt cho đỡ hao.
      script: '/usr/bin/caffeinate',
      args: ['-ims'],
      interpreter: 'none',
      autorestart: true,
      merge_logs: true,
      out_file: path.join(LOGS, 'talpha-awake-out.log'),
      error_file: path.join(LOGS, 'talpha-awake-error.log'),
    },
  ],
};

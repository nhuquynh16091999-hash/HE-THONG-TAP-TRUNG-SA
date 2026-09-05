// PM2 config cho dashboard. Dùng FILE thay vì `pm2 start <path>` vì đường dẫn repo có
// khoảng trắng ("BÁO CÁO TALPHA") — pm2 ghép chuỗi rồi đưa qua bash nên đường dẫn bị
// cắt ở khoảng trắng đầu tiên. Khai trong file thì pm2 đọc nguyên chuỗi, không qua shell.
const path = require("path");
module.exports = {
    apps: [{
        name: "talpha-dashboard",
        script: path.join(__dirname, "node_modules", "next", "dist", "bin", "next"),
        args: ["start", "-p", "3000"],
        interpreter: "node",
        cwd: __dirname,
        autorestart: true,
        max_restarts: 10,
    }],
};

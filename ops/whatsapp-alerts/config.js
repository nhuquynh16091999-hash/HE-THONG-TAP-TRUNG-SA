// Nạp config.json và ghép base URL dashboard — KHÔNG hard-code host trong config nữa.
// Thứ tự ưu tiên base: env TALPHA_DASHBOARD_URL > config.dashboardBaseUrl > http://localhost:3001
//   Server 169.58.33.8: dashboard chạy port 3001 → dùng mặc định, không cần env.
//   Mac: 3001 là app broadcast (project khác) → test bot phải chạy
//        TALPHA_DASHBOARD_URL=http://localhost:3000 node bot.js  — đừng sửa config.json rồi commit.
// Mỗi *Url trong config.json là ĐƯỜNG DẪN ("/api/talpha/..."); để trống/bỏ key = tắt tính năng đó.
const fs = require("fs");
const path = require("path");

const DEFAULT_BASE = "http://localhost:3001";
const URL_KEYS = ["inventoryUrl", "adsAlertsUrl", "syncHealthUrl", "billingUrl"];
const DAILY_URL_KEYS = ["realtimeUrl", "marketerPerfUrl", "sheetReportUrl"];

const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));

const BASE = String(process.env.TALPHA_DASHBOARD_URL || raw.dashboardBaseUrl || DEFAULT_BASE)
    .trim().replace(/\/+$/, "");

// Giữ nguyên URL tuyệt đối (nếu ai đó cần trỏ máy khác), ghép base cho đường dẫn tương đối.
function absolutize(v) {
    const s = String(v || "").trim();
    if (!s) return "";
    if (/^https?:\/\//i.test(s)) return s;
    return BASE + (s.startsWith("/") ? s : "/" + s);
}

const CFG = { ...raw, dashboardBaseUrl: BASE };
for (const k of URL_KEYS) if (raw[k] != null) CFG[k] = absolutize(raw[k]);
if (raw.dailyReport) {
    CFG.dailyReport = { ...raw.dailyReport };
    for (const k of DAILY_URL_KEYS) if (raw.dailyReport[k] != null) CFG.dailyReport[k] = absolutize(raw.dailyReport[k]);
}

module.exports = CFG;

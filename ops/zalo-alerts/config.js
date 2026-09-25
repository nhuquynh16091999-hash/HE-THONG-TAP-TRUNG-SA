// Nạp config.json và ghép base URL dashboard — KHÔNG hard-code host trong config.
// Thứ tự ưu tiên base: env TALPHA_DASHBOARD_URL > config.dashboardBaseUrl > http://localhost:3000
//   VPS 139.180.131.21: dashboard chạy cổng 3000 cùng máy → dùng mặc định, không cần env.
//   Chạy thử trên Mac mà trỏ vào máy chủ thì đặt env, ĐỪNG sửa config.json rồi commit.
// Mỗi *Url trong config.json là ĐƯỜNG DẪN ("/api/talpha/..."); để trống/bỏ key = tắt phần đó.
const fs = require("fs");
const path = require("path");

const DEFAULT_BASE = "http://localhost:3000";
const URL_KEYS = ["adsAlertsUrl", "syncHealthUrl"];
const DAILY_URL_KEYS = ["realtimeUrl", "sheetReportUrl"];

const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));

const BASE = String(process.env.TALPHA_DASHBOARD_URL || raw.dashboardBaseUrl || DEFAULT_BASE)
    .trim().replace(/\/+$/, "");

function absolutize(v) {
    const s = String(v || "").trim();
    if (!s) return "";
    if (/^https?:\/\//i.test(s)) return s;
    return BASE + (s.startsWith("/") ? s : "/" + s);
}

const CFG = { ...raw, dashboardBaseUrl: BASE };
for (const k of URL_KEYS) if (raw[k] != null) CFG[k] = absolutize(raw[k]);
if (raw.vanDon) {
    CFG.vanDon = { ...raw.vanDon, url: absolutize(raw.vanDon.url) };
}
if (raw.dailyReport) {
    CFG.dailyReport = { ...raw.dailyReport };
    for (const k of DAILY_URL_KEYS) if (raw.dailyReport[k] != null) CFG.dailyReport[k] = absolutize(raw.dailyReport[k]);
}

module.exports = CFG;

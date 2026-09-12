import path from "path";
import fs from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Load repo-root .env (shared with Python backend) ───
// Next.js only auto-loads dashboard-ui/.env*. Secrets (Meta token, Poscake/Pancake
// keys, BigQuery) live in the repo-root .env. Parse it here so API routes can read
// them via process.env at runtime. Existing process.env / .env.local values win.
function loadRootEnv() {
    const rootEnv = path.join(__dirname, "..", ".env");
    if (!fs.existsSync(rootEnv)) return;
    for (const line of fs.readFileSync(rootEnv, "utf-8").split("\n")) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (!m) continue;
        let val = m[2].trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        if (process.env[m[1]] === undefined) process.env[m[1]] = val;
    }
}
loadRootEnv();

// ─── Mã bản deploy: chống lệch phiên bản giữa tab đang mở và máy chủ ───
//
// Mỗi lần build, Next.js đặt tên mới cho file chunk và sinh mã mới cho Server
// Action. Tab nào đang mở từ trước vẫn giữ mã cũ, nên bấm vào là máy chủ trả
// "Failed to find Server Action ... might be from an older or newer deployment"
// rồi phía máy khách ném lỗi. Không có error boundary thì người dùng thấy TRANG
// TRẮNG với đúng một câu "đã xảy ra lỗi ngoại lệ phía máy khách" — không nói
// trang nào, không nói vì sao. Dính thật 11/09/2026 ngay sau một lần deploy:
// log máy chủ đếm được 92 lượt, còn yêu cầu tải file thì chưa kịp gửi đi nên
// không có dấu vết nào để lần.
//
// Khai deploymentId thì Next.js tự NHẬN RA lệch phiên bản và tải lại trang thay
// vì ném lỗi. Lấy theo commit hiện tại: cùng một commit thì cùng một mã, nên
// restart máy chủ không làm mất cache của trình duyệt.
function docMaDeploy() {
    if (process.env.NEXT_DEPLOYMENT_ID) return process.env.NEXT_DEPLOYMENT_ID;
    try {
        return execSync("git rev-parse --short HEAD", {
            cwd: path.join(__dirname, ".."),
            stdio: ["ignore", "pipe", "ignore"],
        }).toString().trim() || undefined;
    } catch {
        // Không có git (vd chạy từ bản chép tay) → tắt tính năng, đừng lấy mốc
        // thời gian làm mã: mỗi lần khởi động lại là một mã khác, trình duyệt
        // phải tải lại toàn bộ asset.
        return undefined;
    }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
    turbopack: {},
    deploymentId: docMaDeploy(),
    // Gốc workspace là dashboard-ui/ — nơi có package.json và lockfile duy nhất.
    outputFileTracingRoot: __dirname,
    // pdfjs-dist tự nạp file worker của nó bằng đường dẫn tương đối lúc chạy.
    // Để Next đóng gói vào bundle thì đường dẫn đó trỏ vào chỗ không tồn tại
    // (.next/server/chunks/pdf.worker.mjs) và mọi lần đọc PDF đều chết. Giữ nó
    // ở ngoài để Node nạp thẳng từ node_modules như bình thường.
    serverExternalPackages: ["pdfjs-dist"],
    webpack: (config) => {
        config.resolve = {
            ...config.resolve,
            symlinks: false,
        };
        return config;
    },
    reactStrictMode: false,
};

export default nextConfig;

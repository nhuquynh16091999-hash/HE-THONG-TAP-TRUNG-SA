import path from "path";
import fs from "fs";
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

/** @type {import('next').NextConfig} */
const nextConfig = {
    turbopack: {},
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

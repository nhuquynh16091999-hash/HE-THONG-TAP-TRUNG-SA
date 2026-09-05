// Đồng bộ bản sao config cho Vercel: nguồn CHUẨN là ../config/projects/talpha.yaml
// (repo root). Vercel CLI chỉ upload dashboard-ui/ nên cần bản sao ./config/ đi kèm.
// Chạy trong prebuild: có nguồn thì copy đè (chống drift); không có (build trên Vercel
// từ upload) thì giữ bản sao đã commit.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const FILES = [
    { src: ["..", "..", "config", "projects", "talpha.yaml"], dst: ["..", "config", "projects", "talpha.yaml"] },
    { src: ["..", "..", "config", "talpha_rules.json"],       dst: ["..", "config", "talpha_rules.json"] },
];
for (const f of FILES) {
    const src = path.join(here, ...f.src);
    const dst = path.join(here, ...f.dst);
    if (fs.existsSync(src)) {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(src, dst);
        console.log(`[sync-config] copied ${src} -> ${dst}`);
    } else if (fs.existsSync(dst)) {
        console.log(`[sync-config] ${path.basename(dst)}: source absent (Vercel build) — dùng bản sao đã commit`);
    } else {
        console.warn(`[sync-config] WARNING: không tìm thấy ${path.basename(dst)} ở cả hai vị trí!`);
    }
}

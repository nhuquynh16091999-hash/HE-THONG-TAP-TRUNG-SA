/**
 * CẦU NỐI TỚI ENGINE DÙNG CHUNG.
 *
 * Engine thật nằm trong repo dashboard:
 *     ANTALO/dashboard-ui/src/lib/talpha/ads-recon/
 *
 * Vì sao đặt ở đó chứ không phải ở đây: màn "Đối soát chi phí QC" trong
 * dashboard là chỗ Sỹ Anh dùng hằng tuần, mà lệnh deploy chỉ đẩy repo
 * ANTALO lên VPS — engine nằm ngoài repo đó thì lên server là mất.
 *
 * Thư mục này giữ phần còn lại: bản dòng lệnh, kho kỳ trên đĩa, file mẫu, test.
 * Một engine, hai lối vào — không bao giờ có chuyện hai nơi ra hai kết quả.
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ENGINE_DIR = resolve(HERE, "..", "..", "dashboard-ui", "src", "lib", "talpha", "ads-recon");
export const REPO_ROOT = resolve(HERE, "..", "..");

if (!existsSync(ENGINE_DIR)) {
    throw new Error(
        `Không tìm thấy engine ở ${ENGINE_DIR}.\n` +
        `Thư mục này phải nằm NGAY TRONG repo ANTALO (ANTALO/doi-soat-chi-phi-qc). Đã đổi chỗ thì sửa lại đường dẫn trong src/engine.mjs.`);
}

export * from "../../dashboard-ui/src/lib/talpha/ads-recon/recon.mjs";
export * from "../../dashboard-ui/src/lib/talpha/ads-recon/normalize.mjs";
export * from "../../dashboard-ui/src/lib/talpha/ads-recon/match.mjs";
export * from "../../dashboard-ui/src/lib/talpha/ads-recon/rules.mjs";
export * from "../../dashboard-ui/src/lib/talpha/ads-recon/ingest.mjs";
export { parseDelimited, readAnySheets } from "../../dashboard-ui/src/lib/talpha/ads-recon/xlsx.mjs";

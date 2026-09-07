/**
 * KHO DỮ LIỆU DO NGƯỜI DÙNG NHẬP — sao kê 3PL, sổ theo dõi vận đơn, bảng gán sale.
 *
 * Có HAI chỗ chứa, chọn bằng biến môi trường STORE_BACKEND:
 *
 *   "file"      — ghi ra data/*.json (mặc định). Nhanh, dễ soi, hợp lúc chạy ở máy.
 *   "bigquery"  — ghi vào bảng `talpha_store`. BẮT BUỘC khi chạy trên Vercel,
 *                 Netlify hay bất kỳ nền serverless nào: ổ đĩa ở đó CHỈ ĐỌC nên
 *                 ghi file sẽ ném lỗi, và người dùng bấm nút tưởng đã lưu.
 *
 * Vì sao ghi BigQuery bằng LOAD JOB chứ không phải INSERT: BigQuery ở chế độ hộp
 * cát (chưa gắn thanh toán) KHÔNG cho chạy DML. Load job thì chạy được ở cả hai
 * chế độ. Kho này rất nhỏ (vài trăm KB) nên ghi đè cả bảng mỗi lần lưu là chấp
 * nhận được, đổi lại là chạy được ngay không phải chờ nạp tiền.
 *
 * Dù chọn chỗ nào, mọi nơi khác trong hệ thống chỉ thấy đúng hai hàm dưới đây.
 */
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { bigquery } from "@/lib/bigquery";

const BQ_PROJECT = process.env.NEXT_PUBLIC_BQ_PROJECT || "cty-507710";
const BQ_DATASET = process.env.DATASET || "TALPHA_Dataset";
const BQ_TABLE = "talpha_store";

export type StoreBackend = "file" | "bigquery";

export function storeBackend(): StoreBackend {
    const raw = (process.env.STORE_BACKEND || "").toLowerCase();
    if (raw === "bigquery" || raw === "bq") return "bigquery";
    if (raw === "file") return "file";
    // Không khai gì: nền serverless thì ổ đĩa chỉ đọc, phải dùng BigQuery.
    return process.env.VERCEL || process.env.NETLIFY ? "bigquery" : "file";
}

function assertName(name: string) {
    if (!/^[a-z0-9_-]+$/i.test(name)) throw new Error(`Tên kho không hợp lệ: ${name}`);
}

// ─────────────────────────────────────────────────────────────────────────
// Chỗ chứa 1: file trên đĩa
// ─────────────────────────────────────────────────────────────────────────
const DATA_DIR = path.join(process.cwd(), "..", "data");
const filePath = (name: string) => path.join(DATA_DIR, `${name}.json`);

function fileRead<T>(name: string, fallback: T): T {
    const p = filePath(name);
    if (!fs.existsSync(p)) return fallback;
    try {
        return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
    } catch (e) {
        console.error(`Kho ${name} hỏng định dạng, dùng giá trị mặc định:`, e);
        return fallback;
    }
}

function fileWrite(name: string, value: unknown) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(filePath(name), JSON.stringify(value, null, 2), "utf-8");
}

// ─────────────────────────────────────────────────────────────────────────
// Chỗ chứa 2: bảng BigQuery
// ─────────────────────────────────────────────────────────────────────────
const TABLE_REF = () => `\`${BQ_PROJECT}.${BQ_DATASET}.${BQ_TABLE}\``;

async function bqEnsureTable() {
    const table = bigquery.dataset(BQ_DATASET).table(BQ_TABLE);
    const [exists] = await table.exists();
    if (exists) return;
    await bigquery.dataset(BQ_DATASET).createTable(BQ_TABLE, {
        schema: [
            { name: "name", type: "STRING", mode: "REQUIRED" },
            { name: "payload", type: "STRING", mode: "REQUIRED" },   // JSON dạng chuỗi
            { name: "updated_at", type: "TIMESTAMP", mode: "REQUIRED" },
        ],
    });
}

async function bqReadAll(): Promise<Map<string, string>> {
    try {
        const [rows] = await bigquery.query({
            // Mỗi kho ghi đè cả bảng nên chỉ có một dòng cho mỗi tên; lấy dòng mới
            // nhất cho chắc, phòng khi hai lần ghi chồng nhau.
            query: `SELECT name, payload FROM ${TABLE_REF()}
                    QUALIFY ROW_NUMBER() OVER (PARTITION BY name ORDER BY updated_at DESC) = 1`,
        });
        return new Map((rows as { name: string; payload: string }[]).map((r) => [r.name, r.payload]));
    } catch {
        return new Map();   // bảng chưa có thì coi như kho rỗng
    }
}

async function bqWriteAll(all: Map<string, string>) {
    await bqEnsureTable();
    const now = new Date().toISOString();
    const ndjson = [...all.entries()]
        .map(([name, payload]) => JSON.stringify({ name, payload, updated_at: now }))
        .join("\n") + "\n";

    // Ghi đè cả bảng bằng LOAD JOB: chạy được cả ở chế độ hộp cát (nơi DML bị
    // cấm), và không để lại bản nửa vời nếu hỏng giữa chừng.
    await new Promise<void>((resolve, reject) => {
        const ws = bigquery.dataset(BQ_DATASET).table(BQ_TABLE).createWriteStream({
            sourceFormat: "NEWLINE_DELIMITED_JSON",
            writeDisposition: "WRITE_TRUNCATE",
            schema: {
                fields: [
                    { name: "name", type: "STRING", mode: "REQUIRED" },
                    { name: "payload", type: "STRING", mode: "REQUIRED" },
                    { name: "updated_at", type: "TIMESTAMP", mode: "REQUIRED" },
                ],
            },
        });
        ws.on("error", reject);
        ws.on("complete", () => resolve());
        Readable.from([Buffer.from(ndjson, "utf-8")]).pipe(ws);
    });
}

// Đọc BigQuery mất vài trăm mili-giây. Giữ bản đọc gần nhất trong bộ nhớ để
// readStore() vẫn trả ngay, còn updateStore() luôn đọc lại từ nguồn.
let bqCache: Map<string, string> | null = null;

// ─────────────────────────────────────────────────────────────────────────
// Hai hàm duy nhất phần còn lại của hệ thống nhìn thấy
// ─────────────────────────────────────────────────────────────────────────

/** Đọc kho. Chưa có thì trả giá trị mặc định, KHÔNG ném lỗi. */
export function readStore<T>(name: string, fallback: T): T {
    assertName(name);
    if (storeBackend() === "file") return fileRead(name, fallback);
    const raw = bqCache?.get(name);
    if (!raw) return fallback;
    try {
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
}

/** Như readStore nhưng đọc thẳng từ nguồn — dùng khi cần chắc chắn số mới nhất. */
export async function readStoreFresh<T>(name: string, fallback: T): Promise<T> {
    assertName(name);
    if (storeBackend() === "file") return fileRead(name, fallback);
    bqCache = await bqReadAll();
    return readStore(name, fallback);
}

/**
 * Sửa kho: đọc — biến đổi — ghi lại, trong cùng một lượt, để hai request cùng
 * lúc không ghi đè nhau.
 */
export async function updateStore<T>(
    name: string,
    fallback: T,
    mutate: (current: T) => T,
): Promise<T> {
    assertName(name);

    if (storeBackend() === "file") {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const lockfile = require("proper-lockfile");
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        const p = filePath(name);
        if (!fs.existsSync(p)) fileWrite(name, fallback);
        const release = await lockfile.lock(p, { retries: { retries: 5, minTimeout: 60 } });
        try {
            const next = mutate(fileRead(name, fallback));
            fileWrite(name, next);
            return next;
        } finally {
            await release();
        }
    }

    const all = await bqReadAll();
    let current = fallback;
    const raw = all.get(name);
    if (raw) {
        try { current = JSON.parse(raw) as T; } catch { /* hỏng thì lấy mặc định */ }
    }
    const next = mutate(current);
    all.set(name, JSON.stringify(next));
    await bqWriteAll(all);
    bqCache = all;
    return next;
}

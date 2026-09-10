/**
 * ĐỌC BẢNG TÍNH — .xlsx / .csv / .tsv, KHÔNG cần thư viện ngoài.
 *
 * Vì sao tự viết: hệ thống này phải chạy được ngay trên máy Sỹ Anh và trên
 * server mà không phụ thuộc `npm install`. Mỗi tuần chỉ có 2 file đổ vào,
 * không đáng để kéo về một cây node_modules chỉ để mở zip.
 *
 * .xlsx thực chất là file ZIP chứa XML. Node có sẵn zlib nên chỉ cần tự đọc
 * bảng thư mục của ZIP rồi bung từng phần XML ra.
 */
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

// ─────────────────────────────────────────────────────────────────────────
// Tầng ZIP
// ─────────────────────────────────────────────────────────────────────────
function openZip(buf) {
    // End of Central Directory nằm ở cuối file, tối đa 65535 byte comment phía sau
    let eocd = -1;
    const min = Math.max(0, buf.length - 66000);
    for (let i = buf.length - 22; i >= min; i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("File không phải ZIP/XLSX hợp lệ");

    const count = buf.readUInt16LE(eocd + 10);
    const cdOffset = buf.readUInt32LE(eocd + 16);
    const files = new Map();

    let p = cdOffset;
    for (let i = 0; i < count; i++) {
        if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) break;
        const method = buf.readUInt16LE(p + 10);
        const compSize = buf.readUInt32LE(p + 20);
        const nameLen = buf.readUInt16LE(p + 28);
        const extraLen = buf.readUInt16LE(p + 30);
        const cmtLen = buf.readUInt16LE(p + 32);
        const lho = buf.readUInt32LE(p + 42);
        const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
        files.set(name, { method, compSize, lho });
        p += 46 + nameLen + extraLen + cmtLen;
    }

    return {
        names: () => [...files.keys()],
        read(name) {
            const e = files.get(name);
            if (!e) return null;
            if (buf.readUInt32LE(e.lho) !== 0x04034b50) throw new Error("ZIP hỏng ở " + name);
            const nl = buf.readUInt16LE(e.lho + 26);
            const el = buf.readUInt16LE(e.lho + 28);
            const start = e.lho + 30 + nl + el;
            const raw = buf.subarray(start, start + e.compSize);
            return e.method === 0 ? raw : inflateRawSync(raw);
        },
    };
}

// ─────────────────────────────────────────────────────────────────────────
// Tầng XML (đủ dùng cho SpreadsheetML, không cần parser tổng quát)
// ─────────────────────────────────────────────────────────────────────────
function decodeEntities(s) {
    return s
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
        .replace(/&amp;/g, "&");
}

function attr(tag, name) {
    const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`));
    return m ? m[1] : null;
}

/** "BK12" → 1493 (0-based) */
function colToIndex(ref) {
    const letters = (ref.match(/^[A-Z]+/) || [""])[0];
    let n = 0;
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
}

// ─────────────────────────────────────────────────────────────────────────
// Ngày tháng kiểu Excel
// ─────────────────────────────────────────────────────────────────────────
const BUILTIN_DATE_FMT = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

function isDateFormat(numFmtId, code) {
    if (BUILTIN_DATE_FMT.has(numFmtId)) return true;
    if (!code) return false;
    const stripped = code.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "");
    return /[ymdhs]/i.test(stripped) && !/^[#0.,%\s]*$/.test(stripped);
}

/** Số serial của Excel → Date (UTC). 25569 = 01/01/1970. */
export function excelSerialToDate(serial) {
    const ms = Math.round((serial - 25569) * 86400 * 1000);
    return new Date(ms);
}

// ─────────────────────────────────────────────────────────────────────────
// Đọc .xlsx
// ─────────────────────────────────────────────────────────────────────────
function readXlsx(buf) {
    const zip = openZip(buf);

    // 1. Chuỗi dùng chung
    const shared = [];
    const ssXml = zip.read("xl/sharedStrings.xml");
    if (ssXml) {
        const text = ssXml.toString("utf8");
        for (const m of text.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
            let s = "";
            for (const t of m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) s += decodeEntities(t[1]);
            shared.push(s);
        }
    }

    // 2. Định dạng số — để biết ô nào là ngày
    const numFmtById = new Map();
    const styleFmtIds = [];
    const stylesXml = zip.read("xl/styles.xml");
    if (stylesXml) {
        const text = stylesXml.toString("utf8");
        for (const m of text.matchAll(/<numFmt\b([^>]*)\/>/g)) {
            numFmtById.set(Number(attr(m[1], "numFmtId")), attr(m[1], "formatCode") || "");
        }
        const cellXfs = text.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/);
        if (cellXfs) {
            for (const m of cellXfs[1].matchAll(/<xf\b([^>]*?)(?:\/>|>)/g)) {
                styleFmtIds.push(Number(attr(m[1], "numFmtId") || 0));
            }
        }
    }
    const styleIsDate = styleFmtIds.map((id) => isDateFormat(id, numFmtById.get(id)));

    // 3. Danh sách sheet theo đúng thứ tự trong workbook
    const rels = new Map();
    const relsXml = zip.read("xl/_rels/workbook.xml.rels");
    if (relsXml) {
        for (const m of relsXml.toString("utf8").matchAll(/<Relationship\b([^>]*)\/>/g)) {
            rels.set(attr(m[1], "Id"), attr(m[1], "Target"));
        }
    }
    const sheetRefs = [];
    const wbXml = zip.read("xl/workbook.xml");
    if (wbXml) {
        for (const m of wbXml.toString("utf8").matchAll(/<sheet\b([^>]*)\/>/g)) {
            const target = rels.get(attr(m[1], "r:id")) || "";
            sheetRefs.push({
                name: decodeEntities(attr(m[1], "name") || "Sheet"),
                path: target.startsWith("/") ? target.slice(1) : "xl/" + target.replace(/^\.\//, ""),
            });
        }
    }
    if (!sheetRefs.length) {
        for (const n of zip.names()) if (/^xl\/worksheets\/sheet\d+\.xml$/.test(n)) sheetRefs.push({ name: n, path: n });
    }

    // 4. Từng sheet → mảng 2 chiều
    const sheets = sheetRefs.map(({ name, path }) => {
        const xml = zip.read(path);
        if (!xml) return { name, rows: [] };
        const text = xml.toString("utf8");
        const rows = [];

        for (const rm of text.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
            const rowIdx = Number(attr(rm[1], "r") || rows.length + 1) - 1;
            const cells = [];
            for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
                const tag = cm[1];
                const body = cm[2] || "";
                const idx = colToIndex(attr(tag, "r") || "");
                const type = attr(tag, "t");
                const style = Number(attr(tag, "s") || -1);

                let value = null;
                if (type === "inlineStr") {
                    let s = "";
                    for (const t of body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) s += decodeEntities(t[1]);
                    value = s;
                } else {
                    const vm = body.match(/<v[^>]*>([\s\S]*?)<\/v>/);
                    const raw = vm ? decodeEntities(vm[1]) : null;
                    if (raw === null || raw === "") value = null;
                    else if (type === "s") value = shared[Number(raw)] ?? "";
                    else if (type === "str") value = raw;
                    else if (type === "b") value = raw === "1";
                    else if (type === "e") value = null;
                    else {
                        const num = Number(raw);
                        value = Number.isFinite(num)
                            ? (style >= 0 && styleIsDate[style] ? excelSerialToDate(num) : num)
                            : raw;
                    }
                }
                if (idx >= 0) cells[idx] = value;
            }
            rows[rowIdx] = cells;
        }

        // Lấp lỗ hổng để mọi dòng đều là mảng thật
        const out = [];
        for (let i = 0; i < rows.length; i++) out.push(rows[i] ? [...rows[i]].map((c) => (c === undefined ? null : c)) : []);
        return { name, rows: out };
    });

    return sheets;
}

// ─────────────────────────────────────────────────────────────────────────
// Đọc CSV / TSV — tự đoán dấu phân cách, hỗ trợ ô bọc nháy kép
// ─────────────────────────────────────────────────────────────────────────
export function parseDelimited(text) {
    const clean = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
    const head = clean.slice(0, clean.indexOf("\n") === -1 ? clean.length : clean.indexOf("\n"));
    const delim = [["\t", (head.match(/\t/g) || []).length],
                   [";", (head.match(/;/g) || []).length],
                   [",", (head.match(/,/g) || []).length]]
        .sort((a, b) => b[1] - a[1])[0][0];

    const rows = [];
    let row = [], cell = "", inQ = false;
    for (let i = 0; i < clean.length; i++) {
        const ch = clean[i];
        if (inQ) {
            if (ch === '"') { if (clean[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
            else cell += ch;
            continue;
        }
        if (ch === '"') { inQ = true; continue; }
        if (ch === delim) { row.push(cell); cell = ""; continue; }
        if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; continue; }
        cell += ch;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
}

// ─────────────────────────────────────────────────────────────────────────
// Cửa vào chung
// ─────────────────────────────────────────────────────────────────────────
/**
 * Trả về [{ name, rows }] cho mọi định dạng được hỗ trợ.
 * @param {string} filePath  đường dẫn, hoặc chỉ tên file khi đã có sẵn buffer
 * @param {Buffer|null} [buffer]  nội dung file — truyền vào thì không đọc đĩa
 * @returns {{name: string, rows: any[][]}[]}
 */
export function readSheets(filePath, buffer = null) {
    const buf = buffer || readFileSync(filePath);
    const lower = String(filePath).toLowerCase();

    if (buf.length >= 5 && buf.subarray(0, 5).toString("latin1") === "%PDF-") {
        throw new Error("File PDF — phải đọc bằng readAnySheets (bộ đọc PDF nạp riêng vì nặng)");
    }
    if (buf.length >= 2 && buf[0] === 0xd0 && buf[1] === 0xcf) {
        throw new Error("File .xls đời cũ — mở bằng Excel rồi Save As → .xlsx, hoặc xuất .csv");
    }
    if (buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b) return readXlsx(buf);
    if (/\.(csv|tsv|txt)$/.test(lower)) {
        return [{ name: "csv", rows: parseDelimited(buf.toString("utf8")) }];
    }
    // Không có đuôi rõ ràng nhưng đọc được như text thì thử CSV
    const asText = buf.toString("utf8");
    if (/[,;\t]/.test(asText.slice(0, 500))) return [{ name: "csv", rows: parseDelimited(asText) }];
    throw new Error("Không nhận ra định dạng file: " + filePath);
}

/**
 * Cửa vào DUY NHẤT cho mọi định dạng, kể cả PDF.
 *
 * Bất đồng bộ vì bộ đọc PDF nặng (~10MB) nên chỉ nạp khi thật sự gặp PDF —
 * tuần nào cũng .xlsx thì không phải trả giá cho nó.
 *
 * @param {string} filePath
 * @param {Buffer|null} [buffer]
 * @param {{password?: string}} [opts] mật khẩu, nếu là PDF bị khoá
 * @returns {Promise<{name: string, rows: any[][]}[]>}
 */
export async function readAnySheets(filePath, buffer = null, opts = {}) {
    const buf = buffer || readFileSync(filePath);
    if (buf.length >= 5 && buf.subarray(0, 5).toString("latin1") === "%PDF-") {
        const { readPdfSheets } = await import("./pdf.mjs");
        return readPdfSheets(buf, opts);
    }
    return readSheets(filePath, buf);
}

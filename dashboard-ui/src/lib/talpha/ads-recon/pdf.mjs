/**
 * ĐỌC SAO KÊ DẠNG PDF — dựng lại bảng từ toạ độ chữ.
 *
 * Ngân hàng hay gửi sao kê bản PDF. PDF không có khái niệm "ô" hay "cột": nó
 * chỉ là một đống mẩu chữ, mỗi mẩu kèm toạ độ x, y trên trang. Lấy chữ ra thì
 * dễ; dựng lại đúng cột mới là việc thật, và làm sai thì số tiền của cột này
 * rơi sang cột kia — nguy hiểm hơn là không đọc được.
 *
 * Ba bước:
 *   1. Gom mẩu chữ theo TOẠ ĐỘ Y  → từng dòng
 *   2. Trong mỗi dòng, dính các mẩu gần nhau lại → từng ô
 *   3. Gom ô của CẢ TRANG theo TOẠ ĐỘ X chồng lấn → từng cột
 *
 * Bước 3 phải nhìn cả trang chứ không nhìn từng dòng: dòng nào thiếu ô (ví dụ
 * cột "ghi có" để trống) mà tính theo thứ tự trong dòng là mọi ô sau đó lệch
 * một cột, và tiền rơi vào nhầm chỗ.
 *
 * KHÔNG đọc được PDF scan (ảnh chụp) — loại đó không có lớp chữ nào bên trong.
 */

/** Gom theo x chồng lấn: ô canh phải (số tiền) lệch đầu nhưng vẫn phủ lên nhau. */
function clusterColumns(cells) {
    const cols = [];
    for (const c of [...cells].sort((a, b) => a.x0 - b.x0)) {
        let best = null, bestRatio = 0;
        for (const col of cols) {
            const ov = Math.min(c.x1, col.x1) - Math.max(c.x0, col.x0);
            if (ov <= 0) continue;
            const ratio = ov / Math.max(1, Math.min(c.x1 - c.x0, col.x1 - col.x0));
            if (ratio > bestRatio) { bestRatio = ratio; best = col; }
        }
        if (best && bestRatio >= 0.35) {
            best.x0 = Math.min(best.x0, c.x0);
            best.x1 = Math.max(best.x1, c.x1);
        } else {
            cols.push({ x0: c.x0, x1: c.x1 });
        }
    }
    return cols.sort((a, b) => a.x0 - b.x0);
}

function colIndexOf(cell, cols) {
    let best = -1, bestOv = 0;
    for (let i = 0; i < cols.length; i++) {
        const ov = Math.min(cell.x1, cols[i].x1) - Math.max(cell.x0, cols[i].x0);
        if (ov > bestOv) { bestOv = ov; best = i; }
    }
    return best >= 0 ? best : 0;
}

/**
 * Tìm ngưỡng phân biệt "khoảng trắng trong ô" với "khoảng cách giữa hai cột":
 * xếp mọi khoảng cách rồi cắt ở chỗ nhảy vọt mạnh nhất. Chặn hai đầu theo
 * chiều cao chữ để một trang bảng không có khoảng trắng nào trong ô cũng
 * không đẩy ngưỡng lên cao rồi nuốt luôn ranh giới cột.
 */
function findGapSplit(byLine, medH) {
    const gaps = [];
    for (const L of byLine) {
        const s = [...L.items].sort((a, b) => a.x0 - b.x0);
        for (let i = 1; i < s.length; i++) {
            const g = s[i].x0 - s[i - 1].x1;
            if (g > 0.5) gaps.push(g);
        }
    }
    const lo = Math.max(2.5, medH * 0.4), hi = medH * 2.5;
    if (gaps.length < 4) return medH * 1.2;

    const uniq = [...new Set(gaps.map((g) => Math.round(g * 4) / 4))].sort((a, b) => a - b);
    let best = medH * 1.2, bestRatio = 1.6;          // dưới 1.6 lần thì không coi là đứt gãy
    for (let i = 0; i < uniq.length - 1; i++) {
        const ratio = uniq[i + 1] / uniq[i];
        if (ratio > bestRatio) { bestRatio = ratio; best = Math.sqrt(uniq[i] * uniq[i + 1]); }
    }
    return Math.min(hi, Math.max(lo, best));
}

const median = (a) => {
    if (!a.length) return 0;
    const s = [...a].sort((x, y) => x - y);
    return s[Math.floor(s.length / 2)];
};

/**
 * @param {Buffer|Uint8Array} buffer
 * @returns {Promise<{name: string, rows: any[][]}[]>} mỗi trang một "sheet"
 */
export async function readPdfSheets(buffer) {
    let pdfjs;
    try {
        pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    } catch {
        throw new Error(
            "Chưa cài bộ đọc PDF (pdfjs-dist). Chạy trong dashboard thì đã có sẵn; " +
            "chạy ở thư mục dòng lệnh thì tạm dùng .xlsx/.csv, hoặc cài thêm gói này.");
    }

    // pdfjs từ chối thẳng Buffer của Node (dù Buffer là con của Uint8Array),
    // nên phải sao ra một Uint8Array thuần.
    const data = new Uint8Array(buffer);
    const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true }).promise;

    const sheets = [];
    for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const content = await page.getTextContent();

        const items = [];
        for (const it of content.items) {
            if (!it.str || !it.str.trim()) continue;
            const t = it.transform;
            const w = it.width || 0;
            const h = Math.abs(it.height || t[3] || 10);
            items.push({ x0: t[4], x1: t[4] + w, y: t[5], h, s: it.str });
        }
        if (!items.length) { sheets.push({ name: `trang ${p}`, rows: [] }); continue; }

        const medH = median(items.map((i) => i.h)) || 10;

        // ── 1. Gom theo dòng ─────────────────────────────────────────────
        const byLine = [];
        for (const it of [...items].sort((a, b) => b.y - a.y || a.x0 - b.x0)) {
            const last = byLine[byLine.length - 1];
            if (last && Math.abs(last.y - it.y) <= medH * 0.5) { last.items.push(it); last.y = (last.y + it.y) / 2; }
            else byLine.push({ y: it.y, items: [it] });
        }

        // ── 2. Dính mẩu gần nhau thành ô ─────────────────────────────────
        // Ngưỡng KHÔNG đặt cứng mà tự tìm: đo hết khoảng cách trên trang rồi
        // cắt ở chỗ đứt gãy lớn nhất. Trong một trang bảng, khoảng trắng giữa
        // hai từ và khoảng cách giữa hai cột luôn cách nhau một quãng rõ rệt
        // (đo trên sao kê thật: 6 so với 24), nhưng con số cụ thể đổi theo cỡ
        // chữ và bề rộng khổ giấy — đoán cứng là sớm muộn cắt nhầm giữa ô.
        const gapMax = findGapSplit(byLine, medH);
        const lines = byLine.map((L) => {
            const cells = [];
            for (const it of L.items.sort((a, b) => a.x0 - b.x0)) {
                const cur = cells[cells.length - 1];
                if (cur && it.x0 - cur.x1 <= gapMax) {
                    cur.text += (it.x0 - cur.x1 > gapMax * 0.15 ? " " : "") + it.s;
                    cur.x1 = Math.max(cur.x1, it.x1);
                } else {
                    cells.push({ x0: it.x0, x1: it.x1, text: it.s });
                }
            }
            return cells.map((c) => ({ ...c, text: c.text.trim() })).filter((c) => c.text);
        }).filter((c) => c.length);

        // ── 3. Gom ô cả trang thành cột ──────────────────────────────────
        // Chỉ những dòng CÓ DÁNG BẢNG mới được quyền định nghĩa cột. Mấy dòng
        // văn xuôi ở đầu sao kê ("Chủ thẻ: … Số thẻ: … Kỳ: …") trải dài ngang
        // qua nhiều cột; cho chúng tham gia thì hai cột cạnh nhau bị kéo dính
        // làm một, và ngày với mã tham chiếu rơi chung vào một ô.
        const counts = lines.map((c) => c.length);
        const widest = Math.max(...counts);
        const khungBang = lines.filter((c) => c.length >= Math.max(3, Math.ceil(widest * 0.6)));
        const cols = clusterColumns((khungBang.length >= 2 ? khungBang : lines).flat());
        const rows = lines.map((cells) => {
            const row = new Array(cols.length).fill(null);
            for (const c of cells) {
                const i = colIndexOf(c, cols);
                row[i] = row[i] == null ? c.text : row[i] + " " + c.text;
            }
            return row;
        });

        sheets.push({ name: `trang ${p}`, rows });
    }

    if (!sheets.some((s) => s.rows.length)) {
        throw new Error(
            "Mở được PDF nhưng không lấy ra chữ nào — nhiều khả năng đây là bản SCAN (ảnh chụp), " +
            "không phải PDF có lớp chữ. Tải lại bản .xlsx hoặc .csv từ ngân hàng.");
    }
    return sheets;
}

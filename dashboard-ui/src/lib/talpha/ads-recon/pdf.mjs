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

/**
 * GỘP DÒNG BỊ NGẮT.
 *
 * Ô quá dài thì PDF ngắt xuống dòng, và mảnh rơi ra thành một "dòng" riêng chỉ
 * có đúng một ô. Bản kê Facebook là ví dụ điển hình: mã giao dịch dài 35 ký tự
 * nằm vắt qua BA dòng — mảnh đầu ở trên, dữ liệu thật ở giữa, mảnh đuôi ở dưới:
 *
 *     [null, "28686702447685023-286684348028", null,  null,           null]
 *     ["10/9/2026", null, "Visa ···· 2368", "738.214 ₫ (VND)", "Đã thanh toán"]
 *     [null, "45117", null, null, null]
 *
 * Không gộp thì cột mã giao dịch trống trơn — mất luôn khoá duy nhất để nhận ra
 * hai lần tải cùng một giao dịch, và mất cả cách ghép chắc chắn nhất với sao kê.
 *
 * Luật: dòng chỉ có MỘT ô là mảnh vỡ, dán vào dòng dữ liệu GẦN NHẤT, đúng cột,
 * theo thứ tự đọc (mảnh ở trên dán trước, mảnh ở dưới dán sau).
 */
function gopDongBiNgat(rows) {
    const demO = (r) => r.filter((c) => c != null && String(c).trim() !== "").length;
    const laDuLieu = rows.map((r) => demO(r) >= 2);
    if (!laDuLieu.some(Boolean)) return rows;

    const trongO = (r, j) => r == null || r[j] == null || String(r[j]).trim() === "";

    const truoc = rows.map(() => []), sau = rows.map(() => []);
    for (let i = 0; i < rows.length; i++) {
        if (laDuLieu[i] || demO(rows[i]) !== 1) continue;
        const cot = rows[i].findIndex((c) => c != null && String(c).trim() !== "");

        // Gần nhất thắng; hoà thì dòng nào ĐANG TRỐNG ô đó thắng. Không có luật
        // hoà này thì dòng tiêu đề nuốt mất mảnh của giao dịch đầu tiên: nó
        // cũng cách đúng một dòng, mà ô "ID giao dịch" của nó thì đã có chữ.
        let gan = -1, diem = -Infinity;
        for (let d = 1; d <= 2; d++) {
            for (const j of [i - d, i + d]) {
                if (!laDuLieu[j]) continue;
                const d2 = -d * 10 + (trongO(rows[j], cot) ? 5 : 0);
                if (d2 > diem) { diem = d2; gan = j; }
            }
        }
        if (gan < 0) continue;
        (gan > i ? truoc[gan] : sau[gan]).push(rows[i]);
        laDuLieu[i] = null;                       // đã dán đi, không xuất riêng nữa
    }

    const ra = [];
    for (let i = 0; i < rows.length; i++) {
        if (laDuLieu[i] === null) continue;
        if (!laDuLieu[i]) { ra.push(rows[i]); continue; }
        const r = [...rows[i]];
        for (const m of [...truoc[i], ...sau[i]]) {
            m.forEach((c, j) => {
                if (c == null || String(c).trim() === "") return;
                r[j] = r[j] == null || String(r[j]).trim() === "" ? c : String(r[j]) + String(c);
            });
        }
        ra.push(r);
    }
    return ra;
}

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
 * @param {{password?: string}} [opts] mật khẩu mở file, nếu PDF bị khoá
 * @returns {Promise<{name: string, rows: any[][]}[]>} MỘT bảng gộp mọi trang
 */
export async function readPdfSheets(buffer, opts = {}) {
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
    let doc;
    try {
        doc = await pdfjs.getDocument({
            data, isEvalSupported: false, useSystemFonts: true,
            ...(opts.password ? { password: opts.password } : {}),
        }).promise;
    } catch (e) {
        // Sao kê ngân hàng gửi qua email gần như luôn bị khoá mật khẩu. Thông
        // báo gốc của pdfjs là "No password given" — người dùng đọc xong không
        // biết phải làm gì. Gắn cờ để màn hình bật ô nhập mật khẩu.
        if (e?.name === "PasswordException") {
            const err = new Error(e.code === 2
                ? "Mật khẩu không đúng — kiểm tra lại rồi thử lần nữa."
                : "File PDF này bị khoá bằng mật khẩu. Nhập mật khẩu ngân hàng gửi kèm sao kê rồi chạy lại.");
            err.canMatKhau = true;
            err.matKhauSai = e.code === 2;
            throw err;
        }
        throw e;
    }

    // ── Gom chữ của MỌI TRANG trước khi dựng bảng ────────────────────────
    // Sao kê nhiều trang là chuyện thường (bản kê 9 tháng của Facebook). Xử lý
    // từng trang riêng rồi để tầng trên chọn MỘT trang là mất sạch phần còn
    // lại — và mất im lặng, vì các trang sau trông vẫn "đọc được".
    const items = [];
    for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const content = await page.getTextContent();
        const cao = page.view?.[3] || 800;
        for (const it of content.items) {
            if (!it.str || !it.str.trim()) continue;
            const t = it.transform;
            const w = it.width || 0;
            const h = Math.abs(it.height || t[3] || 10);
            // Dời y theo số trang để dòng của hai trang không dính vào nhau
            items.push({ x0: t[4], x1: t[4] + w, y: t[5] - (p - 1) * (cao + 1000), h, s: it.str, trang: p });
        }
    }

    const sheets = [];
    if (items.length) {
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

        // ── 3. Gom ô của CẢ TẬP TIN thành cột ────────────────────────────
        // Chỉ những dòng CÓ DÁNG BẢNG mới được quyền định nghĩa cột. Mấy dòng
        // văn xuôi ở đầu sao kê ("Chủ thẻ: … Số thẻ: … Kỳ: …") trải dài ngang
        // qua nhiều cột; cho chúng tham gia thì hai cột cạnh nhau bị kéo dính
        // làm một, và ngày với mã tham chiếu rơi chung vào một ô.
        const widest = Math.max(...lines.map((c) => c.length));
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

        sheets.push({ name: doc.numPages > 1 ? `pdf ${doc.numPages} trang` : "pdf", rows: gopDongBiNgat(rows) });
    }

    if (!sheets.some((s) => s.rows.length)) {
        throw new Error(
            "Mở được PDF nhưng không lấy ra chữ nào — nhiều khả năng đây là bản SCAN (ảnh chụp), " +
            "không phải PDF có lớp chữ. Tải lại bản .xlsx hoặc .csv từ ngân hàng.");
    }
    return sheets;
}

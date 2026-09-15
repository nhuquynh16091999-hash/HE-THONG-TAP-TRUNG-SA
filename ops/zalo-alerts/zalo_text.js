// Chữ đậm/nghiêng và chia tin dài cho Zalo.
//
// Zalo không đọc markdown: gửi "*Tiền ads*" là cả nhóm thấy nguyên hai dấu sao. Chữ đậm
// phải đi thành DẢI STYLE riêng — vị trí bắt đầu + độ dài — kèm theo chữ trơn.
//
// Bản tin dựng bằng B("...") và I("..."): hai hàm này bọc chữ bằng ký tự vùng Unicode
// dùng riêng (không bàn phím nào gõ ra), rồi toZalo() đổi thành chữ trơn + dải style.
// KHÔNG dùng * và _ làm cờ như bản WhatsApp: tên campaign, tên trang có dấu gạch dưới
// là cả đoạn phía sau nghiêng loạn.
//
// Vị trí tính theo đơn vị UTF-16 (chính là String.length của JS) — cùng cách zca-js tính
// vị trí @nhắc tên. Emoji chiếm 2 đơn vị.

const BO = "", BC = "", IO = "", IC = "";
const DAU = /[-]/g;

// TextStyle.Bold = "b", TextStyle.Italic = "i" trong zca-js. Ghi thẳng chữ để file này
// test được mà không cần cài zca-js.
const ST = { [BO]: "b", [IO]: "i" };
const DONG = { [BC]: BO, [IC]: IO };

const clean = (s) => String(s ?? "").replace(DAU, "");
const B = (s) => BO + clean(s) + BC;
const I = (s) => IO + clean(s) + IC;

/** Chuỗi có cờ B()/I() → { msg: chữ trơn, styles: [{start, len, st}] }. */
function toZalo(text) {
    let msg = "";
    const styles = [];
    const mo = {};                                   // cờ mở → vị trí bắt đầu
    for (const ch of String(text ?? "")) {
        if (ch in ST) { mo[ch] = msg.length; continue; }
        if (ch in DONG) {
            const cua = DONG[ch];
            if (mo[cua] != null && msg.length > mo[cua]) {
                styles.push({ start: mo[cua], len: msg.length - mo[cua], st: ST[cua] });
            }
            mo[cua] = null;
            continue;
        }
        msg += ch;
    }
    styles.sort((a, b) => a.start - b.start);
    return { msg, styles };
}

// Cắt ở dòng trống gần nhất trước giới hạn; không có thì ở xuống dòng; không có nữa thì
// cắt cứng nhưng không xẻ đôi một emoji (cặp surrogate).
function diemCat(msg, tu, max) {
    const khung = msg.slice(tu, tu + max);
    let cat = khung.lastIndexOf("\n\n");
    if (cat < max / 2) cat = khung.lastIndexOf("\n");
    if (cat <= 0) {
        cat = max;
        const c = msg.charCodeAt(tu + cat - 1);
        if (c >= 0xd800 && c <= 0xdbff) cat--;
    }
    return tu + cat;
}

/** { msg, styles } dài quá max → nhiều tin, mỗi tin mang đúng phần style của nó. */
function chiaTin({ msg, styles }, max = 1800) {
    if (msg.length <= max) return [{ msg, styles }];
    const khoang = [];
    let tu = 0;
    while (msg.length - tu > max) {
        const den = diemCat(msg, tu, max);
        khoang.push([tu, den]);
        tu = den;
        while (msg[tu] === "\n") tu++;
    }
    if (tu < msg.length) khoang.push([tu, msg.length]);

    return khoang.map(([a, z]) => {
        const doan = msg.slice(a, z).replace(/\s+$/, "");
        const het = a + doan.length;
        const st = [];
        for (const s of styles) {
            const dau = Math.max(s.start, a), cuoi = Math.min(s.start + s.len, het);
            if (cuoi > dau) st.push({ start: dau - a, len: cuoi - dau, st: s.st });
        }
        return { msg: doan, styles: st };
    });
}

module.exports = { B, I, clean, toZalo, chiaTin };

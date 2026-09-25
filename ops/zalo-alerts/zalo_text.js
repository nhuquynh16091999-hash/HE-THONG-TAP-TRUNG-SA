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
// Nhắc tên (@Thương): MO + uid + MS + chữ hiện ra + MC. Viết bằng mã \u để khỏi lẫn với
// bốn cờ chữ đậm/nghiêng ở trên (ký tự vùng riêng, không hiện trên màn hình).
const MO = "\uE004", MS = "\uE005", MC = "\uE006";
const DAU = /[\uE000-\uE006]/g;

// TextStyle.Bold = "b", TextStyle.Italic = "i" trong zca-js. Ghi thẳng chữ để file này
// test được mà không cần cài zca-js.
const ST = { [BO]: "b", [IO]: "i" };
const DONG = { [BC]: BO, [IC]: IO };

const clean = (s) => String(s ?? "").replace(DAU, "");
const B = (s) => BO + clean(s) + BC;
const I = (s) => IO + clean(s) + IC;
/** Nhắc tên người trong nhóm — điện thoại người đó báo. Không có uid thì chỉ là chữ thường. */
const M = (ten, uid) => {
    const chu = "@" + clean(ten).replace(/^@/, "");
    return uid ? MO + String(uid).replace(/\D/g, "") + MS + chu + MC : chu;
};

/**
 * Chuỗi có cờ B()/I()/M() → { msg: chữ trơn, styles: [{start, len, st}],
 * mentions: [{pos, len, uid}] }.
 */
function toZalo(text) {
    let msg = "";
    const styles = [];
    const mentions = [];
    const mo = {};                                   // cờ mở → vị trí bắt đầu
    let uid = null, docUid = false, tuMention = null;
    for (const ch of String(text ?? "")) {
        if (ch === MO) { docUid = true; uid = ""; continue; }
        if (docUid) {
            if (ch === MS) { docUid = false; tuMention = msg.length; } else uid += ch;
            continue;
        }
        if (ch === MC) {
            if (tuMention != null && uid && msg.length > tuMention) mentions.push({ pos: tuMention, len: msg.length - tuMention, uid });
            tuMention = null; uid = null;
            continue;
        }
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
    // Không nhắc ai thì không có khoá mentions — giữ nguyên hình dạng cũ cho tin ads.
    return mentions.length ? { msg, styles, mentions } : { msg, styles };
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

/** { msg, styles, mentions } dài quá max → nhiều tin, mỗi tin mang đúng phần style/nhắc tên của nó. */
function chiaTin({ msg, styles, mentions = [] }, max = 1800) {
    if (msg.length <= max) return [{ msg, styles, mentions }];
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
        // Nhắc tên không xẻ đôi được: chỉ giữ cái nằm trọn trong phần này.
        const mt = mentions.filter((x) => x.pos >= a && x.pos + x.len <= het).map((x) => ({ ...x, pos: x.pos - a }));
        return { msg: doan, styles: st, mentions: mt };
    });
}

module.exports = { B, I, M, clean, toZalo, chiaTin };

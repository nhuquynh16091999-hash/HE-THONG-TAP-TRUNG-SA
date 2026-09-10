/**
 * KHO DỮ LIỆU ĐỐI SOÁT — nơi giao dịch được CẤT LẠI, không phải đọc rồi vứt.
 *
 * Vì sao cần: bản kê thanh toán của Facebook là của ĐÚNG MỘT tài khoản quảng
 * cáo, mà công ty có bốn tài khoản đang chạy. Bắt phải gom đủ mọi file rồi tải
 * một lượt là đặt điều kiện sai với đời thật — file về rải rác, tài khoản này
 * xuất được trước, tài khoản kia sau. Có kho thì bổ sung tới đâu đối soát lại
 * tới đó, và số cũ không phải làm lại từ đầu.
 *
 * Chống đếm hai lần bằng KHOÁ của từng dòng, không bằng tên file: tải lại đúng
 * file cũ, hay hai bản xuất chồng ngày nhau, đều không làm tiền nhân đôi.
 */

/** Khoá một dòng chi phí TKQC. Mã giao dịch của Facebook là duy nhất tuyệt đối. */
export function khoaFb(r) {
    if (r.txn_id && String(r.txn_id).length >= 8) return "t:" + r.txn_id;
    return `d:${r.date}|${r.amount}|${r.account_id || ""}`;
}

/** Khoá một dòng sao kê. Nội dung của VCB mang mã giao dịch riêng nên đủ phân biệt. */
export function khoaBank(r) {
    return `b:${r.date}|${r.amount}|${r.ref || ""}|${(r.desc || "").slice(0, 60)}`;
}

const khoaCua = (phia) => (phia === "fb" ? khoaFb : khoaBank);

/**
 * Nhập thêm dòng vào kho.
 *
 * Dòng nào trùng khoá với dòng đã có thì BỎ. Trùng khoá NGAY TRONG cùng một
 * bản tải lên thì giữ, và gắn thêm số thứ tự vào khoá — hai giao dịch thật sự
 * giống hệt nhau trong một file là chuyện có, bỏ đi là mất tiền.
 */
export function napVaoKho(khoCu, phia, dongMoi) {
    const kho = [...(khoCu || [])];
    const dangCo = new Set(kho.map((r) => r._key));
    const trongLuot = new Map();
    const them = [], trung = [];

    for (const r of dongMoi) {
        let k = khoaCua(phia)(r);
        const lan = (trongLuot.get(k) || 0) + 1;
        trongLuot.set(k, lan);
        if (lan > 1) k += "#" + lan;

        if (dangCo.has(k)) { trung.push(r); continue; }
        dangCo.add(k);
        const dong = { ...r, _key: k };
        delete dong._doc;
        delete dong.raw;
        kho.push(dong);
        them.push(dong);
    }
    return { kho, them, trung };
}

/** Bỏ mọi dòng đến từ một file — dùng khi tải nhầm. */
export function boNguon(kho, tenFile) {
    return (kho || []).filter((r) => r.file !== tenFile);
}

/** Tóm tắt kho theo file nguồn, kèm tài khoản quảng cáo của từng file. */
export function tomTatNguon(kho, phia) {
    const theoFile = new Map();
    for (const r of kho || []) {
        const k = r.file || "(không tên)";
        if (!theoFile.has(k)) theoFile.set(k, { ten: k, phia, so_dong: 0, tien: 0, tu: null, den: null, tkqc: new Set() });
        const e = theoFile.get(k);
        e.so_dong++;
        e.tien += r.amount || 0;
        if (!e.tu || r.date < e.tu) e.tu = r.date;
        if (!e.den || r.date > e.den) e.den = r.date;
        if (r.account_id) e.tkqc.add(r.account_id);
    }
    return [...theoFile.values()].map((e) => ({ ...e, tkqc: [...e.tkqc] }));
}

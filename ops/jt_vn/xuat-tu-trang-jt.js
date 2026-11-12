/**
 * CHẠY TRONG TRANG khachhang.jtexpress.vn (đã đăng nhập) — Claude dán qua công cụ Chrome, hoặc
 * người dán vào Console. Gọi đúng các API mà trang Dòng tiền gọi, bằng phiên đăng nhập của chính
 * trang (token không rời khỏi trang), rồi tải về file jt_vn_raw.json — đã BỎ tên, số điện thoại,
 * địa chỉ người nhận. Nạp file đó vào dashboard bằng ops/jt_vn/nap.cjs.
 */
(async () => {
    const TU_NGAY = "2026-10-15";
    const B = "https://ylvipapi.jtexpress.vn/api/fcf/";
    const H = { "Content-Type": "application/json;charset=UTF-8", authToken: localStorage.YL_TOKEN, langType: "VN" };
    const goi = async (p, b) => {
        const r = await fetch(B + p, { method: "POST", headers: H, body: JSON.stringify(b || {}) });
        if (!r.ok) throw new Error(p + " HTTP " + r.status + " — đăng nhập lại J&T");
        const j = await r.json();
        if (j.code !== 1) throw new Error(p + ": " + j.msg);
        return j.data;
    };
    const het = async (p, b) => {
        const o = [];
        for (let t = 1; t <= 50; t++) {
            const d = await goi(p(t), b(t));
            o.push(...(d.records || []));
            if (!d.pages || t >= Number(d.pages)) break;
        }
        return o;
    };
    const lay = (r, ks) => Object.fromEntries(ks.map((k) => [k, r[k] ?? null]));
    const den = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
    const ky = await het(() => "queryFreightCheckForPage", (t) => ({
        reconciliationNumber: "", startCreateTime: TU_NGAY + " 00:00:00", endCreateTime: den + " 23:59:59",
        createTime: [TU_NGAY + " 00:00:00", den + " 23:59:59"], current: t, size: 100,
    }));
    const chi_tiet = {};
    for (const k of ky) {
        const d = await het(() => "queryFreightCheckForDetail", (t) => ({ reconciliationNumber: k.reconciliationNumber, current: t, size: 500 }));
        chi_tiet[k.reconciliationNumber] = d.map((r) => lay(r, ["waybillNo", "customerOrderId", "sendTime", "signTime",
            "codAmount", "monthTaxAmount", "monthCodAmount", "monthRefundAmount", "monthPartialSignFee",
            "adjustmentAmount", "difference", "recipientProv", "recipientCity"]));
    }
    const dang_chay = (await het((t) => "queryOngoingCodAmountDetail/codMoneyNum?current=" + t + "&size=500", () => ({})))
        .map((r) => lay(r, ["waybillNo", "customerOrderId", "waybillStatusCode", "codMoney", "taxAfterFee", "deliveryTime"]));
    const tong = await goi("queryOngoingCodAmountSummary", {}).catch(() => null);
    const tq = await goi("queryLatestOverviewByCustomer", {}).catch(() => null);
    const out = { xuat_luc: new Date().toISOString(), ky, chi_tiet, dang_chay, tong, tq };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(out)], { type: "application/json" }));
    a.download = "jt_vn_raw.json";
    document.body.appendChild(a); a.click(); a.remove();
    return "ky=" + ky.length + " don_ky=" + Object.values(chi_tiet).reduce((s, x) => s + x.length, 0) + " dang_chay=" + dang_chay.length;
})()

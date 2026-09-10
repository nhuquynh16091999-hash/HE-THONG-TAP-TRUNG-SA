/**
 * LUẬT CẢNH BÁO — biến kết quả ghép cặp thành danh sách việc phải xử lý.
 *
 * Nguyên tắc: mỗi cảnh báo phải trả lời được ba câu — LỆCH BAO NHIÊU TIỀN,
 * DÒNG NÀO trong file, và LÀM GÌ TIẾP. Cảnh báo không kèm số tiền và không
 * kèm hướng xử lý thì chỉ làm người đọc lo, không giúp ai đòi lại được đồng nào.
 *
 * Mức: critical = mất tiền hoặc nghi gian lận, phải xử lý tuần này.
 *      warn     = cần người nhìn lại, có thể có lý do chính đáng.
 *      info     = ghi nhận để biết, không phải làm gì.
 */
import { daysBetween, fmtVND, normText, addDays } from "./normalize.mjs";
import { tolerance } from "./match.mjs";

const CRIT = "critical", WARN = "warn", INFO = "info";

function mk(code, severity, title, detail, opts = {}) {
    return { code, severity, title, detail, amount: opts.amount ?? 0, items: opts.items ?? [], hint: opts.hint ?? "" };
}

/** Danh sách 4 số cuối thẻ hợp lệ; bỏ qua dòng mẫu "0000". */
function cardWhitelist(cfg) {
    return new Set((cfg.cards?.list || []).map((c) => String(c.last4 || "").trim()).filter((c) => c && c !== "0000"));
}

function cardLabel(cfg, last4) {
    const c = (cfg.cards?.list || []).find((x) => String(x.last4) === String(last4));
    return c ? `${c.ten}${c.ngan_hang ? " · " + c.ngan_hang : ""}` : `thẻ *${last4}`;
}

/** Roster TKQC hợp lệ, đọc từ file ad_accounts.json của dashboard nếu có. */
const boActPrefix = (x) => String(x || "").replace(/^act_/i, "");

export function adAccountWhitelist(cfg, rosterJson) {
    // So bằng phần SỐ: roster ghi "act_2033341657422931", bản kê PDF ghi trần
    // "2033341657422931" — so nguyên chuỗi là tài khoản nào cũng thành lạ.
    const ids = new Set((cfg.ad_accounts?.extra_allowed || []).map(boActPrefix));
    if (rosterJson?.projects) {
        for (const p of Object.values(rosterJson.projects)) {
            for (const a of p.accounts || []) if (a.id) ids.add(boActPrefix(a.id));
        }
    }
    return ids;
}

/** Tài khoản đang chạy trong roster — dùng để biết còn thiếu bản kê của ai. */
function tkqcDangChay(rosterJson) {
    const ra = [];
    for (const p of Object.values(rosterJson?.projects || {})) {
        for (const a of p.accounts || []) if (a.id && a.status === "active") ra.push({ id: boActPrefix(a.id), name: a.name || a.id });
    }
    return ra;
}

export function buildAlerts({ fb, bank, match, cfg, roster = null, history = [] }) {
    const alerts = [];
    const A = (...args) => alerts.push(mk(...args));

    const bankDates = bank.rows.map((r) => r.date).sort();
    const fbDates = fb.rows.map((r) => r.date).sort();
    const bankStart = bankDates[0], bankEnd = bankDates[bankDates.length - 1];
    const window = cfg.match.date_window_days ?? 3;

    // ── 0. Hai nguồn có vẻ không cùng một kỳ / một file thiếu ────────────
    //
    // Phải kiểm TRƯỚC mọi kết luận chi tiết. Nếu một phía thiếu dữ liệu thì
    // hàng trăm cảnh báo bên dưới đều đúng luật nhưng sai bản chất: dòng thẻ
    // nào cũng "không có hoá đơn", và người đọc chết chìm trong báo động giả
    // thay vì biết việc cần làm là TẢI LẠI CHO ĐỦ FILE.
    const fbChargeable = fb.rows.filter((r) => r.status_norm !== "failed").length;
    if (fbChargeable && bank.rows.length) {
        const tyLeKhop = match.pairs.length / Math.max(1, Math.min(fbChargeable, bank.rows.length));
        const lechNang = bankStart && fbDates.length &&
            (daysBetween(bankStart, fbDates[0]) > window || daysBetween(fbDates[fbDates.length - 1], bankEnd) > window);
        if (tyLeKhop < 0.5 || lechNang) {
            const thieuBenNao = bank.rows.length > fbChargeable * 2 ? "chi phí TKQC"
                              : fbChargeable > bank.rows.length * 2 ? "sao kê thẻ" : null;
            A("NGUON_LECH_NHAU", CRIT,
              `Hai nguồn không khớp kỳ nhau — chỉ ghép được ${match.pairs.length}/${fbChargeable}`,
              `TKQC: ${fbDates[0]} → ${fbDates[fbDates.length - 1]} (${fbChargeable} hoá đơn, ${fmtVND(spentFbSoBo(fb))}). ` +
              `Sao kê: ${bankStart} → ${bankEnd} (${bank.rows.length} dòng, ${fmtVND(bank.rows.reduce((s2, r) => s2 + r.amount, 0))}).` +
              (thieuBenNao ? ` Nhiều khả năng file ${thieuBenNao} còn thiếu.` : ""),
              { amount: 0,
                hint: "ĐỌC CẢNH BÁO BÊN DƯỚI CÓ CHỪNG MỰC — khi một phía thiếu dữ liệu thì mọi dòng bên kia đều trông như 'không có hoá đơn'. " +
                      "Việc cần làm trước: xuất lại file cho đủ đúng kỳ (bản kê TKQC nhiều trang nhớ lấy hết trang), rồi chạy lại." });
        }
    }

    // ── 0b. Bản kê TKQC mới có của vài tài khoản ─────────────────────────
    //
    // Bản kê thanh toán của Facebook là của ĐÚNG MỘT tài khoản quảng cáo, còn
    // thẻ thì bị trừ cho MỌI tài khoản. Thiếu bản kê của tài khoản nào thì
    // toàn bộ phần chi của tài khoản đó biến thành "thẻ trừ mà không có hoá
    // đơn" — đúng luật, sai bản chất, và đủ sức chôn vùi cảnh báo thật.
    if (roster) {
        const dangChay = tkqcDangChay(roster);
        const coTrongFile = new Set(fb.rows.map((r) => boActPrefix(r.account_id)).filter(Boolean));
        const thieu = dangChay.filter((a) => !coTrongFile.has(a.id));
        const tienThe = bank.rows.reduce((s2, r) => s2 + r.amount, 0);
        if (coTrongFile.size && thieu.length && tienThe > spentFbSoBo(fb) * 1.5) {
            const daCo = dangChay.filter((a) => coTrongFile.has(a.id)).map((a) => a.name);
            A("THIEU_BAN_KE_TKQC", CRIT,
              `Mới có bản kê của ${coTrongFile.size}/${dangChay.length} tài khoản quảng cáo đang chạy — thiếu ${thieu.length}`,
              `Đã có: ${daCo.join(", ") || "(không rõ tên)"}. Chưa có: ${thieu.map((a) => a.name).join(", ")}.`,
              { amount: 0,
                hint: "Vào Trình quản lý quảng cáo của TỪNG tài khoản → Thanh toán → Lịch sử thanh toán, tải bản kê rồi thả HẾT vào ô 1 " +
                      "(ô đó nhận nhiều file). Thẻ bị trừ cho mọi tài khoản, nên chừng nào chưa đủ bản kê thì phần chi của các tài khoản " +
                      "còn lại vẫn cứ hiện ra thành 'thẻ trừ mà không có hoá đơn'." });
        }
    }

    // ── 1. Lệch số tiền trên cặp đã khớp ─────────────────────────────────
    const feeCfg = cfg.fee || {};
    let feeTotal = 0;
    for (const p of match.pairs) {
        if (p.exact) continue;
        const pct = p.amount_diff_pct;
        const abs = Math.abs(p.amount_diff);

        if (p.amount_diff > 0) {
            feeTotal += p.amount_diff;
            const sev = pct > (feeCfg.critical_over_pct ?? 5) ? CRIT
                      : pct > (feeCfg.warn_over_pct ?? 1) ? WARN : INFO;
            A("PHI_AN", sev,
              `Ngân hàng trừ nhiều hơn hoá đơn ${fmtVND(abs)} (${pct.toFixed(2)}%)`,
              `${p.fb.txn_id || "giao dịch"} ngày ${p.fb.date}: TKQC ghi ${fmtVND(p.fb.amount)}, thẻ bị trừ ${fmtVND(p.bank.amount)}.`,
              { amount: abs, items: [ref(p.fb), ref(p.bank)],
                hint: sev === INFO ? "Nằm trong khung phí giao dịch quốc tế — ghi nhận là chi phí tài chính, không phải chi phí quảng cáo."
                                   : "Gọi ngân hàng hỏi rõ phí gì. Nếu là phí FX thì tách khỏi chi phí ads khi tính ROAS." });
        } else {
            A("TRU_THIEU", WARN,
              `Ngân hàng trừ ÍT hơn hoá đơn ${fmtVND(abs)}`,
              `${p.fb.txn_id || "giao dịch"} ngày ${p.fb.date}: TKQC ghi ${fmtVND(p.fb.amount)}, thẻ chỉ trừ ${fmtVND(p.bank.amount)}.`,
              { amount: abs, items: [ref(p.fb), ref(p.bank)],
                hint: "Thường là một hoá đơn bị cắt làm nhiều lần trừ. Soát xem còn dòng trừ nào cùng TKQC trong vài ngày tới không." });
        }
    }

    // ── 2. TKQC báo đã thu mà thẻ không thấy trừ ─────────────────────────
    for (const r of match.fb_unmatched) {
        const nearEdge = bankEnd && daysBetween(r.date, bankEnd) <= window;
        A("FB_THU_MA_THE_KHONG_TRU", nearEdge ? WARN : CRIT,
          `TKQC báo thu ${fmtVND(r.amount)} nhưng sao kê không có dòng trừ`,
          `${r.txn_id || "giao dịch"} ngày ${r.date}${r.account_name ? " · " + r.account_name : ""} · trạng thái "${r.status || "?"}".`,
          { amount: r.amount, items: [ref(r)],
            hint: nearEdge ? `Giao dịch sát cuối kỳ sao kê (${bankEnd}) — nhiều khả năng rơi sang sao kê tuần sau. Tuần sau đối soát lại, còn treo thì báo động.`
                           : "Kiểm tra: thanh toán bằng thẻ khác? trừ vào số dư quảng cáo có sẵn? hay sao kê thiếu dòng? Không giải thích được thì đây là tiền TKQC ghi nhận mà không ai trả." });
    }

    // ── 3. Thẻ bị trừ mà TKQC không có hoá đơn ───────────────────────────
    const feeMax = feeCfg.standalone_fee_max_abs ?? 200000;
    const dupSeen = new Map();
    for (const r of match.bank_unmatched) {
        if (r.amount <= feeMax) {
            feeTotal += r.amount;
            A("PHI_THE_RIENG", INFO,
              `Phí thẻ liên quan Facebook ${fmtVND(r.amount)}`,
              `${r.date} · ${r.desc}`,
              { amount: r.amount, items: [ref(r)],
                hint: "Khoản nhỏ, không có hoá đơn TKQC tương ứng — xếp vào phí ngân hàng." });
            continue;
        }

        // Nghi trừ trùng CHỈ khi anh em cùng số tiền ĐÃ ghép được một hoá đơn.
        //
        // Bản đầu nhận cả anh em chưa ghép, và trên dữ liệu thật nó nổ 40 cảnh
        // báo giả: Facebook cắt tiền theo ngưỡng nên cùng một số tiền lặp lại
        // suốt là bình thường. Hai dòng cùng giá mà CẢ HAI đều không có hoá đơn
        // thì đó là dấu hiệu file TKQC thiếu, không phải bị trừ hai lần —
        // kết luận sai hướng, lại còn đẩy người ta đi khiếu nại ngân hàng oan.
        const sibling = match.pairs.map((p) => p.bank)
            .find((o) => o !== r && Math.abs(o.amount - r.amount) <= (cfg.duplicate?.amount_tolerance_abs ?? 0)
                      && Math.abs(daysBetween(o.date, r.date)) <= (cfg.duplicate?.window_days ?? 2));
        if (sibling) { dupSeen.set(r, sibling); continue; }

        const beforePeriod = fbDates.length && r.date < fbDates[0];
        A("THE_TRU_MA_KHONG_CO_HOA_DON", beforePeriod ? WARN : CRIT,
          `Thẻ bị trừ ${fmtVND(r.amount)} nhưng TKQC không có hoá đơn nào`,
          `${r.date} · ${r.desc}${r.ref ? " · ref " + r.ref : ""}`,
          { amount: r.amount, items: [ref(r)],
            hint: beforePeriod ? `Dòng này nằm trước kỳ của file TKQC (${fbDates[0]}) — nhiều khả năng thuộc hoá đơn kỳ trước. Đối chiếu lại file TKQC tuần trước.`
                               : "Tiền đã ra khỏi thẻ mà không có hoá đơn: kiểm tra TKQC lạ đang tiêu tiền công ty, hoặc thẻ bị dùng trái phép. Đây là loại lệch nguy hiểm nhất." });
    }

    // ── 4. Trừ trùng ─────────────────────────────────────────────────────
    for (const [r, sibling] of dupSeen) {
        A("TRU_TRUNG", CRIT,
          `Nghi bị trừ trùng ${fmtVND(r.amount)}`,
          `Dòng ${r.line}: ${r.date} · ${r.desc} — trùng số tiền với dòng ${sibling.line} (${sibling.date} · ${sibling.desc}), mà TKQC chỉ có một hoá đơn cho khoản này.`,
          { amount: r.amount, items: [ref(r), ref(sibling)],
            hint: "Hay gặp khi Facebook thử lại thanh toán: lần đầu báo lỗi nhưng ngân hàng vẫn giữ tiền, lần sau trừ tiếp. Mở khiếu nại với ngân hàng (chargeback) trong 60 ngày, kèm ảnh chụp hoá đơn TKQC." });
    }

    // ── 5. Giao dịch FB thất bại mà thẻ vẫn trừ ──────────────────────────
    for (const f of match.fb_failed) {
        const hit = bank.rows.find((b) => Math.abs(b.amount - f.amount) <= tolerance(f.amount, cfg.match)
                                       && Math.abs(daysBetween(f.date, b.date)) <= window);
        if (!hit) continue;
        const alsoPaid = fb.rows.some((o) => o !== f && o.status_norm === "paid"
            && Math.abs(o.amount - f.amount) <= tolerance(f.amount, cfg.match)
            && Math.abs(daysBetween(o.date, f.date)) <= window);
        if (alsoPaid && match.pairs.some((p) => p.bank === hit)) continue;   // đã khớp với lần trả lại thành công
        A("FB_LOI_MA_VAN_TRU", CRIT,
          `TKQC báo thanh toán THẤT BẠI ${fmtVND(f.amount)} nhưng thẻ vẫn bị trừ`,
          `${f.txn_id || "giao dịch"} ngày ${f.date} trạng thái "${f.status}" — sao kê có dòng ${hit.date} ${fmtVND(hit.amount)}.`,
          { amount: f.amount, items: [ref(f), ref(hit)],
            hint: "Đòi lại tiền: mở khiếu nại với ngân hàng, kèm ảnh chụp trạng thái Failed trong Trình quản lý thanh toán của Facebook." });
    }

    // ── 6. Thẻ lạ ────────────────────────────────────────────────────────
    const wl = cardWhitelist(cfg);
    if (!wl.size) {
        // Chưa khai thì đừng chỉ nhắc "đi mà khai" — liệt kê luôn thẻ có thật
        // trong file tuần này kèm mẩu JSON dán thẳng vào config. Bắt người ta
        // tự mò 4 số cuối trong hai file mấy trăm dòng là cách chắc chắn nhất
        // để việc này không bao giờ được làm.
        const thay = new Map();
        const ghi = (c4) => { if (!thay.has(c4)) thay.set(c4, { bank_n: 0, bank_total: 0, fb_n: 0 }); return thay.get(c4); };
        for (const r of bank.rows) if (r.card4) { const e = ghi(r.card4); e.bank_n++; e.bank_total += r.amount || 0; }
        for (const r of fb.rows) if (r.card4) ghi(r.card4).fb_n++;
        const ds = [...thay.entries()].sort((a, b) => b[1].bank_total - a[1].bank_total);

        A("CHUA_KHAI_THE", INFO,
          ds.length ? `Chưa khai thẻ công ty — file tuần này có ${ds.length} thẻ` : "Chưa khai danh sách thẻ công ty",
          ds.length
            ? ds.map(([c, e]) => `*${c}: ${e.bank_n} dòng sao kê ${fmtVND(e.bank_total)}${e.fb_n ? ` · ${e.fb_n} hoá đơn TKQC` : ""}`).join("  ·  ")
            : "Không kiểm tra được thẻ lạ vì cards.list vẫn để thẻ mẫu.",
          { hint: ds.length
              ? `Dán vào config/talpha_rules.json → ads_settlement.cards.list rồi đặt tên cho từng thẻ: `
                + ds.map(([c]) => `{ "last4": "${c}", "ten": "?" }`).join(", ")
                + ` — khai xong thì từ tuần sau, giao dịch từ thẻ ngoài danh sách bị bắt ngay.`
              : 'Mở config/talpha_rules.json → ads_settlement.cards.list, điền 4 số cuối của từng thẻ công ty.' });
    } else if (cfg.cards?.strict) {
        const seen = new Map();
        for (const r of [...bank.rows, ...fb.rows]) {
            if (!r.card4 || wl.has(r.card4)) continue;
            if (!seen.has(r.card4)) seen.set(r.card4, []);
            seen.get(r.card4).push(r);
        }
        for (const [c4, rows] of seen) {
            const total = rows.reduce((s, r) => s + (r.amount || 0), 0);
            A("THE_LA", CRIT,
              `Thẻ *${c4} không nằm trong danh sách thẻ công ty — ${rows.length} giao dịch, ${fmtVND(total)}`,
              rows.slice(0, 5).map((r) => `${r.date} ${fmtVND(r.amount)} ${r.desc || r.account_name || ""}`).join(" · "),
              { amount: total, items: rows.map(ref),
                hint: "Hoặc là thẻ mới chưa khai báo (thêm vào config), hoặc là ai đó đang tiêu tiền công ty bằng thẻ ngoài danh sách. Xác minh trước khi bỏ qua." });
        }
    }

    // ── 7. TKQC lạ ───────────────────────────────────────────────────────
    if (cfg.ad_accounts?.strict) {
        const ok = adAccountWhitelist(cfg, roster);
        if (!ok.size) {
            A("CHUA_KHAI_TKQC", INFO, "Chưa nạp được roster TKQC",
              `Không đọc được ${cfg.ad_accounts.roster_file} nên bỏ qua kiểm tra TKQC lạ.`,
              { hint: "Sửa đường dẫn roster_file, hoặc liệt kê thẳng id vào extra_allowed." });
        } else {
            const seen = new Map();
            for (const r of fb.rows) {
                if (!r.account_id || ok.has(boActPrefix(r.account_id))) continue;
                if (!seen.has(r.account_id)) seen.set(r.account_id, []);
                seen.get(r.account_id).push(r);
            }
            for (const [id, rows] of seen) {
                const total = rows.reduce((s, r) => s + r.amount, 0);
                A("TKQC_LA", CRIT,
                  `TKQC ${id} không có trong danh sách — ${rows.length} giao dịch, ${fmtVND(total)}`,
                  `Tên trên file: ${rows[0].account_name || "(trống)"}. Ngày: ${rows.map((r) => r.date).join(", ")}.`,
                  { amount: total, items: rows.map(ref),
                    hint: "TKQC mới mở thì thêm vào ad_accounts.json của dashboard. Không ai nhận thì đây là tài khoản tiêu tiền công ty ngoài kiểm soát." });
            }
        }
    }

    // ── 7b. Hoá đơn ghi một thẻ, sao kê trừ thẻ khác ─────────────────────
    for (const p of match.pairs.filter((x) => x.card_ok === false)) {
        A("LECH_THE", WARN,
          `Hoá đơn ghi thẻ *${p.fb.card4} nhưng thẻ *${p.bank.card4} bị trừ ${fmtVND(p.bank.amount)}`,
          `${p.fb.txn_id || "giao dịch"} ngày ${p.fb.date} · ${p.fb.account_name || ""} — sao kê dòng ${p.bank.line} ngày ${p.bank.date}: ${p.bank.desc}`,
          { amount: p.bank.amount, items: [ref(p.fb), ref(p.bank)],
            hint: "Máy vẫn ghép vì tiền và ngày khớp, nhưng hai bên ghi hai thẻ khác nhau. Kiểm tra TKQC có đổi thẻ thanh toán giữa chừng không — nếu không thì cặp này ghép sai, số tổng vẫn đúng nhưng quy về thẻ nào là sai." });
    }

    // ── 8. Cặp ghép nghi ngờ ─────────────────────────────────────────────
    const amb = match.pairs.filter((p) => p.ambiguous);
    if (amb.length) {
        A("GHEP_NGHI_NGO", WARN,
          `${amb.length} cặp ghép chưa chắc chắn`,
          amb.slice(0, 5).map((p) => `${p.fb.date} ${fmtVND(p.fb.amount)} ↔ ${p.bank.date} (${p.bank.desc || ""})`).join(" · "),
          { items: amb.flatMap((p) => [ref(p.fb), ref(p.bank)]),
            hint: "Có nhiều dòng cùng số tiền trong cùng khung ngày nên máy phải đoán. Số tổng vẫn đúng, nhưng đừng dùng từng cặp này để quy trách nhiệm TKQC." });
    }

    // ── 9. Thanh toán treo ───────────────────────────────────────────────
    const pending = fb.rows.filter((r) => r.status_norm === "pending");
    if (pending.length) {
        const total = pending.reduce((s, r) => s + r.amount, 0);
        A("FB_TREO", WARN, `${pending.length} giao dịch TKQC đang treo — ${fmtVND(total)}`,
          pending.map((r) => `${r.date} ${fmtVND(r.amount)} ${r.account_name || ""}`).join(" · "),
          { amount: total, items: pending.map(ref),
            hint: "Chưa trừ tiền nhưng sẽ trừ. Nhớ đối chiếu lại ở kỳ sau, đừng để trôi." });
    }

    // ── 10. Ngân sách và bất thường theo tuần ────────────────────────────
    const spentFb = fb.rows.filter((r) => r.status_norm !== "failed").reduce((s, r) => s + r.amount, 0);
    const spentBank = bank.rows.reduce((s, r) => s + r.amount, 0);
    const cap = cfg.budget?.weekly_cap;
    if (cap && spentBank > cap) {
        A("VUOT_NGAN_SACH", CRIT,
          `Chi vượt trần tuần ${fmtVND(spentBank - cap)}`,
          `Thẻ đã trừ ${fmtVND(spentBank)} / trần ${fmtVND(cap)}.`,
          { amount: spentBank - cap, hint: "Hoặc siết chi tuần tới, hoặc nâng trần trong config nếu đây là kế hoạch." });
    }

    const prev = history.filter((h) => h.ky !== undefined).slice(-1)[0];
    if (prev?.summary?.bank_total) {
        const pct = ((spentBank - prev.summary.bank_total) / prev.summary.bank_total) * 100;
        const sev = pct >= (cfg.budget?.spike_critical_pct ?? 80) ? CRIT
                  : pct >= (cfg.budget?.spike_warn_pct ?? 40) ? WARN : null;
        if (sev) {
            A("TANG_BAT_THUONG", sev,
              `Chi tuần này tăng ${pct.toFixed(0)}% so với kỳ trước`,
              `Kỳ ${prev.ky}: ${fmtVND(prev.summary.bank_total)} → kỳ này: ${fmtVND(spentBank)}.`,
              { amount: spentBank - prev.summary.bank_total,
                hint: "Có chủ đích scale thì bỏ qua. Không thì soát TKQC nào đội chi và campaign nào mới bật." });
        }
    }

    // Ngày đột biến trong kỳ
    const byDay = new Map();
    for (const r of bank.rows) byDay.set(r.date, (byDay.get(r.date) || 0) + r.amount);
    if (byDay.size >= 3) {
        const vals = [...byDay.values()];
        const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
        const thr = avg * (1 + (cfg.budget?.daily_spike_warn_pct ?? 100) / 100);
        for (const [d, v] of [...byDay].sort()) {
            if (v > thr) {
                A("NGAY_DOT_BIEN", WARN,
                  `Ngày ${d} chi ${fmtVND(v)} — gấp ${(v / avg).toFixed(1)} lần trung bình kỳ`,
                  `Trung bình ${fmtVND(avg)}/ngày trong kỳ này.`,
                  { amount: v - avg, hint: "Soát lại xem có campaign nào bị đặt sai ngân sách hoặc bị trừ dồn nhiều hoá đơn trong một ngày." });
            }
        }
    }

    // ── 11. Ads kênh khác — ghi nhận, không đối soát ở đây ────────────────
    if (bank.other_ads?.length) {
        const total = bank.other_ads.reduce((s, r) => s + r.amount, 0);
        A("ADS_KENH_KHAC", INFO,
          `Sao kê còn ${bank.other_ads.length} giao dịch quảng cáo kênh khác — ${fmtVND(total)}`,
          bank.other_ads.slice(0, 5).map((r) => `${r.date} ${fmtVND(r.amount)} ${r.desc}`).join(" · "),
          { amount: total, items: bank.other_ads.map(ref),
            hint: "Không thuộc phạm vi đối soát Facebook. Ghi ra để không ai tưởng đây là chi phí FB." });
    }

    // ── 11a. File tải lên mà không đọc được ──────────────────────────────
    for (const [phia, side] of [["chi phí TKQC", fb], ["sao kê", bank]]) {
        for (const h of side.file_hong || []) {
            A("FILE_KHONG_DOC_DUOC", CRIT,
              `Không đọc được file ${phia}: ${h.ten}`,
              h.vi_sao,
              { hint: "Lượt đối soát này đã chạy KHÔNG có file đó, nên số bên dưới còn thiếu phần của nó. " +
                      "Xuất lại file dạng .xlsx hoặc .csv rồi chạy lại; nếu là PDF thì gửi tau mấy dòng đầu mà máy đọc được ở trên để tau thêm cách nhận cột." });
        }
    }

    // ── 11b. Dòng trùng nhau giữa các file đã tải lên ────────────────────
    for (const [phia, side] of [["chi phí TKQC", fb], ["sao kê", bank]]) {
        const bo = side.trung_file || [];
        if (!bo.length) continue;
        const tien = bo.reduce((s2, d) => s2 + (d.bo.amount || 0), 0);
        A("TRUNG_GIUA_FILE", INFO,
          `${bo.length} dòng ${phia} có mặt ở hai file, đã bỏ bản trùng — ${fmtVND(tien)}`,
          bo.slice(0, 4).map((d) => `${d.bo.date} ${fmtVND(d.bo.amount)}: giữ "${d.giu.file}" · bỏ "${d.bo.file}"`).join(" · "),
          { items: bo.map((d) => ref(d.bo)),
            hint: "Hai bản xuất chồng ngày nhau là chuyện thường. Không bỏ thì bản thứ hai không ghép được với ai và nổi lên thành báo động giả. Số tổng đã tính đúng một lần." });
    }

    // ── 12. Chất lượng dữ liệu đầu vào ───────────────────────────────────
    const skipped = [...(fb.skipped || []), ...(bank.skipped || [])];
    if (skipped.length) {
        A("DONG_BO_QUA", INFO, `${skipped.length} dòng không đọc được, đã bỏ qua`,
          skipped.slice(0, 5).map((s) => `${s.file ? s.file + " " : ""}dòng ${s.line}: ${s.reason}`).join(" · "),
          { hint: "Nếu là dòng dữ liệu thật thì báo tau để thêm bí danh cột hoặc sửa cách đọc." });
    }
    for (const w of [...(fb.meta?.warnings || []), ...(bank.meta?.warnings || [])]) {
        A("THIEU_COT", INFO, "Thiếu cột trong file nguồn", w,
          { hint: "Xuất lại file có đủ cột, hoặc thêm bí danh cột vào config → columns." });
    }

    const order = { critical: 0, warn: 1, info: 2 };
    const gom = gomCanhBao(alerts);
    const ket_luan = ketLuan(gom);
    gom.sort((a, b) => order[a.severity] - order[b.severity] || (b.amount || 0) - (a.amount || 0));

    return {
        alerts: gom,
        summary: {
            fb_total: spentFb,
            bank_total: spentBank,
            fee_total: feeTotal,
            matched_amount: match.pairs.reduce((s, p) => s + p.fb.amount, 0),
            gap: spentBank - spentFb,
            at_risk: alerts.filter((a) => a.severity === CRIT).reduce((s, a) => s + (a.amount || 0), 0),
            counts: {
                critical: gom.filter((a) => a.severity === CRIT).length,
                warn: gom.filter((a) => a.severity === WARN).length,
                info: gom.filter((a) => a.severity === INFO).length,
            },
            so_dong_canh_bao: alerts.length,
            ket_luan,
            period: { bank_start: bankStart, bank_end: bankEnd, fb_start: fbDates[0], fb_end: fbDates[fbDates.length - 1] },
        },
    };
}

/**
 * MỘT DÒNG KẾT LUẬN, ĐẶT TRÊN MỌI CON SỐ.
 *
 * Sỹ Anh: "cách check đối soát đang phức tạp, tối ưu cho dễ nhìn ra vấn đề".
 * Đúng — mở màn ra là sáu con số với một chồng cảnh báo, mà câu hỏi thật sự
 * chỉ có một: SỐ NÀY CÓ TIN ĐƯỢC KHÔNG, VÀ PHẢI LÀM GÌ.
 *
 * Chỗ nguy hiểm là ba loại cảnh báo dưới đây: chúng không nói "mất tiền", mà
 * nói "dữ liệu chưa đủ hoặc đọc sai". Còn chúng thì MỌI con số bên dưới đều
 * sai bản chất — kể cả những con số trông rất bình thường. Phải tách hẳn ra,
 * không để nằm lẫn giữa các cảnh báo mất tiền.
 */
const CHAN_DUONG = ["FILE_KHONG_DOC_DUOC", "NGUON_LECH_NHAU", "THIEU_BAN_KE_TKQC", "THIEU_COT"];

function ketLuan(ds) {
    const chan = ds.filter((a) => CHAN_DUONG.includes(a.code) && a.severity !== INFO);
    const nang = ds.filter((a) => a.severity === CRIT && !CHAN_DUONG.includes(a.code));
    const vua = ds.filter((a) => a.severity === WARN && !CHAN_DUONG.includes(a.code));

    if (chan.length) {
        return {
            muc: "khong_tin",
            tieu_de: "Chưa tin được số — dữ liệu đầu vào còn thiếu hoặc đọc sai",
            giai_thich: "Khi một phía thiếu dữ liệu thì mọi dòng bên kia đều trông như 'không có hoá đơn'. " +
                        "Xử xong mấy việc dưới đây rồi hãy đọc các con số.",
            viec: chan.map((a) => ({ code: a.code, title: a.title, hint: a.hint })),
        };
    }
    if (nang.length) {
        const tien = nang.reduce((s2, a) => s2 + (a.amount || 0), 0);
        return {
            muc: "co_van_de",
            tieu_de: `Số tin được — có ${nang.length} việc phải xử, ${fmtVND(tien)} cần đòi hoặc làm rõ`,
            giai_thich: "Hai nguồn khớp đủ để kết luận. Danh sách dưới đây là tiền thật đang lệch.",
            viec: nang.slice(0, 3).map((a) => ({ code: a.code, title: a.title, hint: a.hint })),
        };
    }
    if (vua.length) {
        return {
            muc: "can_xem", tieu_de: `Không có gì nghiêm trọng — ${vua.length} mục nên xem qua`,
            giai_thich: "Không mất tiền, nhưng có vài chỗ nên liếc lại.",
            viec: vua.slice(0, 3).map((a) => ({ code: a.code, title: a.title, hint: a.hint })),
        };
    }
    return { muc: "sach", tieu_de: "Khớp sạch — không có gì phải làm", giai_thich: "", viec: [] };
}

/**
 * GOM CẢNH BÁO CÙNG LOẠI.
 *
 * Trên dữ liệu thật, một kỳ đẻ ra 167 cảnh báo — trong đó 68 cái cùng là "phí
 * thẻ lẻ". Không ai đọc hết 167 thẻ, mà không đọc hết thì cái nghiêm trọng
 * nằm lẫn ở giữa cũng trôi luôn. Cùng một loại quá 3 cái thì gộp thành MỘT,
 * mang tổng tiền và vài dòng nặng nhất; chi tiết từng dòng vẫn nằm đủ trong
 * bảng bên dưới và trong file CSV xuất ra.
 */
const NHAN_GOM = {
    THE_TRU_MA_KHONG_CO_HOA_DON: "khoản thẻ bị trừ mà TKQC không có hoá đơn",
    TRU_TRUNG: "khoản nghi bị trừ trùng",
    FB_THU_MA_THE_KHONG_TRU: "hoá đơn TKQC chưa thấy thẻ trừ",
    FB_LOI_MA_VAN_TRU: "hoá đơn báo lỗi mà thẻ vẫn trừ",
    PHI_AN: "giao dịch ngân hàng trừ nhiều hơn hoá đơn",
    TRU_THIEU: "giao dịch ngân hàng trừ ít hơn hoá đơn",
    PHI_THE_RIENG: "khoản phí thẻ lẻ",
    LECH_THE: "cặp hoá đơn và sao kê ghi hai thẻ khác nhau",
    NGAY_DOT_BIEN: "ngày chi đột biến",
    TRUNG_GIUA_FILE: "nhóm dòng trùng giữa các file",
};
const NGUONG_GOM = 3;

function gomCanhBao(alerts) {
    const theoMa = new Map();
    for (const a of alerts) {
        if (!theoMa.has(a.code)) theoMa.set(a.code, []);
        theoMa.get(a.code).push(a);
    }

    const ra = [];
    for (const [code, ds] of theoMa) {
        if (ds.length <= NGUONG_GOM || !NHAN_GOM[code]) { ra.push(...ds); continue; }

        const rank = { critical: 0, warn: 1, info: 2 };
        const nangNhat = ds.reduce((m, a) => (rank[a.severity] < rank[m.severity] ? a : m), ds[0]);
        const tong = ds.reduce((s2, a) => s2 + (a.amount || 0), 0);
        const top = [...ds].sort((a, b) => (b.amount || 0) - (a.amount || 0)).slice(0, 5);

        ra.push({
            code, severity: nangNhat.severity,
            title: `${ds.length} ${NHAN_GOM[code]} — tổng ${fmtVND(tong)}`,
            detail: "Nặng nhất: " + top.map((a) => a.title.replace(/^\d+ /, "")).join(" · ") +
                    (ds.length > 5 ? ` … và ${ds.length - 5} khoản nữa.` : ""),
            hint: nangNhat.hint,
            amount: tong,
            count: ds.length,
            items: ds.flatMap((a) => a.items || []),
        });
    }
    return ra;
}

function spentFbSoBo(fb) {
    return fb.rows.filter((r) => r.status_norm !== "failed").reduce((s, r) => s + r.amount, 0);
}

function ref(r) {
    return {
        src: r.src, line: r.line, date: r.date, amount: r.amount,
        label: r.src === "fb" ? [r.txn_id, r.account_name].filter(Boolean).join(" · ") : r.desc,
    };
}

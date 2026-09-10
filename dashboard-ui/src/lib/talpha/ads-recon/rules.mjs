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
export function adAccountWhitelist(cfg, rosterJson) {
    const ids = new Set((cfg.ad_accounts?.extra_allowed || []).map(String));
    if (rosterJson?.projects) {
        for (const p of Object.values(rosterJson.projects)) {
            for (const a of p.accounts || []) if (a.id) ids.add(String(a.id));
        }
    }
    return ids;
}

export function buildAlerts({ fb, bank, match, cfg, roster = null, history = [] }) {
    const alerts = [];
    const A = (...args) => alerts.push(mk(...args));

    const bankDates = bank.rows.map((r) => r.date).sort();
    const fbDates = fb.rows.map((r) => r.date).sort();
    const bankStart = bankDates[0], bankEnd = bankDates[bankDates.length - 1];
    const window = cfg.match.date_window_days ?? 3;

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

        // Có anh em cùng số tiền trong khung ngày → nghi trừ trùng, xử ở luật 4
        const sibling = [...match.pairs.map((p) => p.bank), ...match.bank_unmatched]
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
        A("CHUA_KHAI_THE", INFO, "Chưa khai danh sách thẻ công ty",
          "Không kiểm tra được thẻ lạ vì config/doisoat_rules.json vẫn để thẻ mẫu.",
          { hint: 'Mở config/doisoat_rules.json → mục "cards.list", điền 4 số cuối của từng thẻ công ty.' });
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
                if (!r.account_id || ok.has(r.account_id)) continue;
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

    // ── 12. Chất lượng dữ liệu đầu vào ───────────────────────────────────
    const skipped = [...(fb.skipped || []), ...(bank.skipped || [])];
    if (skipped.length) {
        A("DONG_BO_QUA", INFO, `${skipped.length} dòng không đọc được, đã bỏ qua`,
          skipped.slice(0, 5).map((s) => `dòng ${s.line}: ${s.reason}`).join(" · "),
          { hint: "Nếu là dòng dữ liệu thật thì báo tau để thêm bí danh cột hoặc sửa cách đọc." });
    }
    for (const w of [...(fb.meta?.warnings || []), ...(bank.meta?.warnings || [])]) {
        A("THIEU_COT", INFO, "Thiếu cột trong file nguồn", w,
          { hint: "Xuất lại file có đủ cột, hoặc thêm bí danh cột vào config → columns." });
    }

    const order = { critical: 0, warn: 1, info: 2 };
    alerts.sort((a, b) => order[a.severity] - order[b.severity] || (b.amount || 0) - (a.amount || 0));

    return {
        alerts,
        summary: {
            fb_total: spentFb,
            bank_total: spentBank,
            fee_total: feeTotal,
            matched_amount: match.pairs.reduce((s, p) => s + p.fb.amount, 0),
            gap: spentBank - spentFb,
            at_risk: alerts.filter((a) => a.severity === CRIT).reduce((s, a) => s + (a.amount || 0), 0),
            counts: {
                critical: alerts.filter((a) => a.severity === CRIT).length,
                warn: alerts.filter((a) => a.severity === WARN).length,
                info: alerts.filter((a) => a.severity === INFO).length,
            },
            period: { bank_start: bankStart, bank_end: bankEnd, fb_start: fbDates[0], fb_end: fbDates[fbDates.length - 1] },
        },
    };
}

function ref(r) {
    return {
        src: r.src, line: r.line, date: r.date, amount: r.amount,
        label: r.src === "fb" ? [r.txn_id, r.account_name].filter(Boolean).join(" · ") : r.desc,
    };
}

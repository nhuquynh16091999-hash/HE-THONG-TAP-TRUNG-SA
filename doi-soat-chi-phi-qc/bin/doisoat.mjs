#!/usr/bin/env node
/**
 * DÒNG LỆNH — chạy một lượt đối soát mà không cần mở trình duyệt.
 *
 *   node bin/doisoat.mjs                          # tự lấy 2 file mới nhất trong data/inbox
 *   node bin/doisoat.mjs fileA.xlsx fileB.xlsx    # chỉ đích danh, thứ tự nào cũng được
 *   node bin/doisoat.mjs --gui-tin                # chạy xong bắn cảnh báo sang chat
 *
 * Màn web nằm trong dashboard: http://localhost:3000/talpha → Đối soát chi phí QC
 */
import { readdirSync, statSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runReconciliation, loadConfig, ROOT } from "../src/run.mjs";
import { sendAlerts } from "../src/engine.mjs";
import { toCsv } from "../src/engine.mjs";
import { fmtVND } from "../src/engine.mjs";

const C = process.stdout.isTTY
    ? { red: "\x1b[31m", yellow: "\x1b[33m", dim: "\x1b[2m", bold: "\x1b[1m", green: "\x1b[32m", off: "\x1b[0m" }
    : { red: "", yellow: "", dim: "", bold: "", green: "", off: "" };

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const files = args.filter((a) => !a.startsWith("--"));

if (flag("--help") || flag("-h")) {
    console.log(`
ĐỐI SOÁT CHI PHÍ QUẢNG CÁO

  node bin/doisoat.mjs                        đối soát 2 file mới nhất trong data/inbox
  node bin/doisoat.mjs <file...>              đối soát các file chỉ định (nhiều cũng được)

  Màn web: http://localhost:3000/talpha → mục Đối soát chi phí QC

  --gui-tin        chạy xong gửi cảnh báo sang chat (Telegram/webhook trong config)
  --mat-khau <mk>  mật khẩu mở file PDF bị khoá (sao kê ngân hàng gửi email)
  --csv <đường>    xuất thêm file CSV
  --khong-luu      không ghi kết quả vào data/ky/
`);
    process.exit(0);
}

{
    let dsFile = files;
    if (dsFile.length < 2) {
        const inbox = join(ROOT, "data", "inbox");
        const found = existsSync(inbox)
            ? readdirSync(inbox)
                  .filter((f) => /\.(xlsx|csv|tsv|txt)$/i.test(f) && !f.startsWith("~$"))
                  .map((f) => ({ f: join(inbox, f), t: statSync(join(inbox, f)).mtimeMs }))
                  .sort((x, y) => y.t - x.t)
            : [];
        if (found.length < 2) {
            console.error(`${C.red}Cần 2 file.${C.off} Thả file chi phí TKQC và file sao kê vào ${C.bold}data/inbox/${C.off} rồi chạy lại, hoặc truyền thẳng đường dẫn.`);
            process.exit(1);
        }
        dsFile = found.map((x) => x.f);
        console.log(`${C.dim}Lấy ${dsFile.length} file trong data/inbox:${C.off}`);
        for (const f of dsFile) console.log(`${C.dim}  · ${f}${C.off}`);
        console.log();
    }

    const cfg = loadConfig();
    let r;
    try {
        const mkIdx = args.indexOf("--mat-khau");
        const matKhau = mkIdx >= 0 && args[mkIdx + 1] && !args[mkIdx + 1].startsWith("--") ? args[mkIdx + 1] : "";
        r = await runReconciliation(dsFile.map((f) => ({ path: f })), { cfg, save: !flag("--khong-luu"), matKhau });
    } catch (e) {
        console.error(`${C.red}Không đối soát được:${C.off} ${e.message}`);
        process.exit(1);
    }

    const s = r.summary;
    console.log(`${C.bold}KỲ ${r.ky}${C.off}  ${C.dim}(sao kê ${s.period.bank_start} → ${s.period.bank_end})${C.off}`);
    console.log(`  TKQC ghi thu   ${fmtVND(s.fb_total).padStart(18)}`);
    console.log(`  Thẻ đã bị trừ  ${fmtVND(s.bank_total).padStart(18)}`);
    console.log(`  Chênh lệch     ${fmtVND(s.gap).padStart(18)}`);
    console.log(`  Cần đòi/làm rõ ${(s.at_risk > 0 ? C.red : C.green) + fmtVND(s.at_risk).padStart(18) + C.off}`);
    console.log(`  Khớp           ${String(r.stats.matched + "/" + r.stats.fb_chargeable).padStart(18)}${r.stats.ambiguous ? C.yellow + "  (" + r.stats.ambiguous + " cặp nghi ngờ)" + C.off : ""}\n`);

    for (const al of r.alerts) {
        const c = al.severity === "critical" ? C.red : al.severity === "warn" ? C.yellow : C.dim;
        const tag = al.severity === "critical" ? "NGHIÊM TRỌNG" : al.severity === "warn" ? "CẦN XEM    " : "ghi nhận   ";
        console.log(`${c}[${tag}]${C.off} ${al.title}`);
        if (al.detail) console.log(`${C.dim}              ${al.detail}${C.off}`);
        if (al.hint) console.log(`${C.dim}           →  ${al.hint}${C.off}`);
        console.log();
    }

    const csvAt = args[args.indexOf("--csv") + 1];
    if (flag("--csv") && csvAt && !csvAt.startsWith("--")) {
        writeFileSync(csvAt, toCsv(r), "utf8");
        console.log(`${C.dim}Đã ghi CSV: ${csvAt}${C.off}`);
    }
    if (r.saved_to) console.log(`${C.dim}Đã lưu kỳ: ${r.saved_to}${C.off}`);

    if (flag("--gui-tin")) {
        const out = await sendAlerts(r, cfg);
        if (out.sent.length) console.log(`${C.green}Đã gửi cảnh báo qua: ${out.sent.join(", ")}${C.off}`);
        if (out.errors.length) console.log(`${C.red}Lỗi gửi: ${out.errors.join(" · ")}${C.off}`);
        if (!out.sent.length && !out.errors.length) console.log(`${C.dim}Không gửi: ${out.skipped.join(" · ")}${C.off}`);
    }

    process.exitCode = s.counts.critical > 0 ? 2 : 0;   // để cron biết tuần này có chuyện
}

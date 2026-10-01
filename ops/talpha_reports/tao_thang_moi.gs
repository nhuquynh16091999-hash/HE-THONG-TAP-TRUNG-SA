/**
 * TALPHA — tạo thư mục báo cáo ads THÁNG MỚI trên Drive (Sỹ Anh chốt 01/10/2026).
 *
 * Vì sao cần script này: format_all.py (máy chủ) tự tìm bộ file của tháng trong thư mục
 * "Tháng N" và ghi số vào đó. Nhưng service account của máy chủ KHÔNG tạo được file trong
 * Drive cá nhân (Google cho nó quota 0) — file phải do một tài khoản người tạo. Script này
 * chạy bằng tài khoản Google của chủ thư mục nên tạo được.
 *
 * Nó làm:
 *   1. Share thư mục gốc "BÁO CÁO ADS ANTALO" quyền Editor cho service account (một lần là đủ,
 *      mọi thư mục tháng bên trong thừa hưởng).
 *   2. Tạo "Tháng N" nếu chưa có, chép KHUÔN của "Tháng N-1": từng thư mục người (LOC, THAI…),
 *      từng Google Sheet đổi tên theo tháng ("TAIWAN T9" → "TAIWAN T10", "TỔNG TEAM THÁNG 9" →
 *      "TỔNG TEAM THÁNG 10"). File đã có cùng tên thì bỏ qua — chạy lại bao nhiêu lần cũng được.
 *      Nội dung chép sang không quan trọng: vòng :20 kế tiếp của máy chủ xoá sạch tab và ghi số
 *      của tháng mới.
 *   3. Mỗi thư mục người có một file "[Test] Ads T<N>" (số camp TEST của người đó).
 *
 * CÁCH DÙNG (một lần):
 *   script.google.com → Dự án mới → dán toàn bộ file này → Lưu
 *   → chọn hàm chayThangNay → Chạy → cấp quyền (Drive + Sheets) → xem Nhật ký thực thi
 *   → chọn hàm caiLich → Chạy: từ đó ngày 25 hằng tháng tự tạo tháng sau, ngày 1 chạy lại cho chắc.
 */
const ROOT_ID = '1AW2xgJ-6kQXxjA04VSpjJeLEe1lcOV6';   // CÔNG TY ANTALO / BÁO CÁO ADS ANTALO
const SA = 'talpha-dashboard@cty-507710.iam.gserviceaccount.com';

/** Tạo / bổ sung thư mục của THÁNG NÀY. */
function chayThangNay() {
  const d = new Date();
  taoThang(d.getFullYear(), d.getMonth() + 1);
}

/** Tạo sẵn thư mục của THÁNG SAU (lịch ngày 25). */
function taoThangSau() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  taoThang(d.getFullYear(), d.getMonth() + 1);
}

/** Cài lịch: ngày 25 lúc 9h tạo tháng sau, ngày 1 lúc 0h chạy lại tháng này. */
function caiLich() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('taoThangSau').timeBased().onMonthDay(25).atHour(9).create();
  ScriptApp.newTrigger('chayThangNay').timeBased().onMonthDay(1).atHour(0).create();
  Logger.log('Đã cài lịch: ngày 25 (tạo tháng sau) và ngày 1 (soát lại tháng này).');
}

function taoThang(y, m) {
  const root = DriveApp.getFolderById(ROOT_ID);
  try { root.addEditor(SA); } catch (e) { Logger.log('Không share được cho service account: ' + e); }

  const thangTruoc = m === 1 ? 12 : m - 1;
  const nguon = timThuMuc(root, thangTruoc);
  let dich = timThuMuc(root, m);
  if (!dich) { dich = root.createFolder('Tháng ' + m); Logger.log('Tạo thư mục Tháng ' + m); }
  if (!nguon) { Logger.log('Không có thư mục Tháng ' + thangTruoc + ' để chép khuôn — tạo file tay.'); return; }

  const dem = { file: 0, thuMuc: 0 };
  chep(nguon, dich, m, dem);

  // File TEST cho mỗi người (thư mục con trực tiếp của tháng).
  const nguoi = dich.getFolders();
  while (nguoi.hasNext()) {
    const f = nguoi.next();
    if (!coFileTest(f)) {
      const ss = SpreadsheetApp.create('[Test] Ads T' + m);
      DriveApp.getFileById(ss.getId()).moveTo(f);
      dem.file++;
      Logger.log('Tạo [Test] Ads T' + m + ' trong ' + f.getName());
    }
  }
  Logger.log('Xong Tháng ' + m + '/' + y + ': thêm ' + dem.thuMuc + ' thư mục, ' + dem.file + ' file.');
}

/** Chép khuôn đệ quy: thư mục con giữ tên, Google Sheet đổi tên theo tháng. */
function chep(nguon, dich, m, dem) {
  const files = nguon.getFilesByType(MimeType.GOOGLE_SHEETS);
  while (files.hasNext()) {
    const f = files.next();
    const ten = doiTen(f.getName(), m);
    if (!dich.getFilesByName(ten).hasNext()) {
      f.makeCopy(ten, dich);
      dem.file++;
      Logger.log('Chép ' + f.getName() + ' → ' + dich.getName() + '/' + ten);
    }
  }
  const con = nguon.getFolders();
  while (con.hasNext()) {
    const s = con.next();
    let d = conTen(dich, s.getName());
    if (!d) { d = dich.createFolder(s.getName()); dem.thuMuc++; }
    chep(s, d, m, dem);
  }
}

/** "TAIWAN T9" → "TAIWAN T10" · "TỔNG TEAM THÁNG 9" → "TỔNG TEAM THÁNG 10". */
function doiTen(ten, m) {
  return ten.replace(/(TH[ÁA]NG\s*)\d{1,2}/i, '$1' + m).replace(/\bT\d{1,2}\b/, 'T' + m);
}

function boDau(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'D').toUpperCase();
}

/** Thư mục "Tháng m" (chấp nhận "THÁNG 10", "Tháng 10/2026"). */
function timThuMuc(root, m) {
  const it = root.getFolders();
  while (it.hasNext()) {
    const f = it.next();
    const t = boDau(f.getName()).split(/[^A-Z0-9]+/).filter(String);
    if (t[0] === 'THANG' && Number(t[1]) === m) return f;
  }
  return null;
}

function conTen(folder, ten) {
  const it = folder.getFoldersByName(ten);
  return it.hasNext() ? it.next() : null;
}

function coFileTest(folder) {
  const it = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
  while (it.hasNext()) {
    if (boDau(it.next().getName()).split(/[^A-Z0-9]+/).indexOf('TEST') >= 0) return true;
  }
  return false;
}

"""Bộ file báo cáo của TỪNG THÁNG — mỗi tháng một thư mục "Tháng N" (Sỹ Anh chốt 01/10/2026).

Vì sao: trước đây format_all.py giữ MỘT bộ ID cố định (GRAND_KEY trong code + taiwan_files.json,
singapore_files.json, uae_files.json, test_files.json). Sang tháng mà không ai dán ID mới là
số tháng mới ghi ĐÈ lên file tháng cũ: 01/10/2026 từ 07:22 sáng, 16 file "Tháng 9" bị xoá sạch
tab, ghi số tháng 10, file tổng đổi tên thành "TỔNG TEAM THÁNG 10" — tin Zalo 08:30 không gửi
được vì file tháng 9 không còn dòng 30/09.

Nay mỗi tháng tự tìm bộ file của chính tháng đó, theo thứ tự:
  1. report_files/YYYY-MM.json cạnh script — khai tay (tháng 9/2026, hoặc khi cần ép một ID);
  2. quét Drive: thư mục gốc talpha_rules.json → report_drive.root_folder_id → thư mục con
     "Tháng N" → mọi Google Sheet bên trong (đệ quy), nhận người/nước theo tên thư mục/file
     như new_month_files.py vẫn làm. Quét được thì lưu bản nhớ vào <runtime>/report_files_cache;
  3. Drive lỗi mạng thì dùng bản nhớ của tháng đó.
Không ra bộ file nào → format_all KHÔNG ghi gì. KHÔNG BAO GIỜ lùi về file của tháng khác.

Bộ file một tháng: {"grand": ID file TỔNG TEAM, "files": {nước: {key marketer: ID}},
"test": {key marketer: ID}}.
"""
import calendar
import datetime
import json
import os
import unicodedata

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover — máy chủ chạy Python 3.9 nên luôn có zoneinfo
    ZoneInfo = None

from talpha_rules import ALLM, RULES

TZ_VN = 'Asia/Ho_Chi_Minh'
SHEET_MIME = 'application/vnd.google-apps.spreadsheet'
FOLDER_MIME = 'application/vnd.google-apps.folder'
# CEO hay tải file lên dạng .xlsx — Sheets API KHÔNG ghi được vào đó, job trượt im lặng.
EXCEL_MIME = {'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'application/vnd.ms-excel'}
DRIVE_API = 'https://www.googleapis.com/drive/v3/files'


# ─── Tháng nào đang chạy ───────────────────────────────────────────────────────────────────

def hom_nay_vn(now=None):
    """Ngày hôm nay theo giờ VIỆT NAM. Máy chủ để giờ UTC: dùng date.today() là 00:00–07:00 sáng
    ngày 1 vẫn còn tháng cũ, rồi 07:00 mới lật — đúng lúc 16 file tháng 9 bị ghi đè 01/10/2026."""
    if now is not None:
        return now.date() if isinstance(now, datetime.datetime) else now
    if ZoneInfo is None:
        return (datetime.datetime.utcnow() + datetime.timedelta(hours=7)).date()
    return datetime.datetime.now(ZoneInfo(TZ_VN)).date()


def ngay_chot(thang_env=None, now=None):
    """Ngày CUỐI của khoảng báo cáo: tháng hiện tại → hôm nay; tháng đã qua → ngày cuối tháng đó.

    thang_env: "YYYY-MM" (biến TALPHA_REPORT_MONTH) — dựng lại một tháng cũ, ví dụ khôi phục
    file tháng 9 sau khi bị ghi đè. Tháng tương lai thì báo lỗi, không đoán.
    """
    hom_nay = hom_nay_vn(now)
    if not thang_env:
        return hom_nay
    y, m = (int(x) for x in thang_env.strip().split('-'))
    if (y, m) > (hom_nay.year, hom_nay.month):
        raise ValueError(f'TALPHA_REPORT_MONTH={thang_env} là tháng chưa tới')
    if (y, m) == (hom_nay.year, hom_nay.month):
        return hom_nay
    return datetime.date(y, m, calendar.monthrange(y, m)[1])


# ─── Nhận người / nước / loại file theo tên (chuyển từ new_month_files.py) ─────────────────

def norm(s):
    """Viết hoa, BỎ DẤU (Đ→D), mọi thứ không phải chữ/số thành khoảng trắng."""
    s = unicodedata.normalize('NFD', (s or '').replace('đ', 'd').replace('Đ', 'D'))
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn').upper()
    return ' '.join(''.join(c if c.isalnum() else ' ' for c in s).split())


# từ trong tên file → key thị trường ("SINGAPORE" → Singapore, "TW" → Taiwan…)
MKT = {norm(tok): m for tok, m in RULES['market_aliases'].items() if not tok.startswith('_')}
MKT.update({norm(m): m for m in ALLM})

# cụm từ → key marketer. Thư mục đang đặt theo tên không dấu (ANH, LOC, QUYNH…), nên nhận
# cả key, tên hiển thị, tên đầy đủ và TỪ CUỐI của tên hiển thị ("Sỹ Anh" → "ANH").
# So theo TỪ nguyên vẹn chứ không theo chuỗi con: "ANH" không được khớp nhầm vào "THANH".
NV = {}
for _key, _v in RULES['marketers'].items():
    _ten = _v.get('display') or ''
    for _cum in (_key, _ten, _v.get('full'), _ten.split()[-1] if _ten else None):
        if _cum:
            NV.setdefault(norm(_cum), _key)
NV_DAI_TRUOC = sorted(NV, key=lambda c: -len(c.split()))   # cụm dài khớp trước cụm ngắn


def _co_cum(cum, text):
    t, c = norm(text).split(), cum.split()
    # "THÁNG 10" bỏ dấu thành "THANG 10" — trùng tên Thắng. Chữ tháng + số thì bỏ khỏi phần dò người.
    t = [x for i, x in enumerate(t) if not (x == 'THANG' and i + 1 < len(t) and t[i + 1].isdigit())]
    return any(t[i:i + len(c)] == c for i in range(len(t) - len(c) + 1))


def find_nv(*texts):
    for t in texts:
        for cum in NV_DAI_TRUOC:
            if _co_cum(cum, t):
                return NV[cum]
    return None


def find_mkt(*texts):
    for t in texts:
        for tok in norm(t).split():
            if tok in MKT:
                return MKT[tok]
    return None


def la_thu_muc_thang(ten, y, m):
    """'Tháng 10' · 'THÁNG 10' · 'Tháng 10/2026' · 'Tháng 10 - 2026' đều là tháng 10.
    Có ghi năm thì năm phải khớp; không ghi năm thì coi là năm đang chạy."""
    t = norm(ten).split()
    if len(t) < 2 or t[0] != 'THANG' or not t[1].isdigit() or int(t[1]) != m:
        return False
    nam = [x for x in t[2:] if x.isdigit() and len(x) == 4]
    return not nam or int(nam[0]) == y


def phan_loai(items):
    """items: [(file {id,name,mimeType}, đường dẫn thư mục tuple)] → bộ file + danh sách lỗi.

    Trả (bo, excel, la): bo = {"grand", "files", "test"}; excel = file .xlsx (job không ghi
    được); la = (file, ngữ cảnh, lý do) không xếp được.
    """
    bo = {'grand': None, 'files': {m: {} for m in ALLM}, 'test': {}}
    excel, la = [], []
    for f, path in items:
        name, ctx = f['name'], ' / '.join(path)
        if f['mimeType'] in EXCEL_MIME:
            excel.append((f, ctx))
            continue
        # người: thư mục GẦN file nhất trước ("TAIWAN T9" không có tên người). Không dò cả
        # đường dẫn một lượt: thư mục "Tháng 9" bỏ dấu thành "THANG" — trùng tên Thắng.
        nv = find_nv(*reversed(path), name)
        mkt = find_mkt(name, ctx)
        u = norm(name)
        if 'TEST' in u.split():
            if not nv:
                la.append((f, ctx, 'file test nhưng không rõ người'))
            elif nv in bo['test']:
                la.append((f, ctx, f'TRÙNG — file test của {nv} đã nhận {bo["test"][nv]}'))
            else:
                bo['test'][nv] = f['id']
        elif 'TONG TEAM' in u:
            if bo['grand']:
                la.append((f, ctx, f'TRÙNG — đã có file TỔNG TEAM {bo["grand"]}'))
            else:
                bo['grand'] = f['id']
        elif nv and mkt:
            if nv in bo['files'][mkt]:
                la.append((f, ctx, f'TRÙNG — {nv}/{mkt} đã nhận file {bo["files"][mkt][nv]}'))
            else:
                bo['files'][mkt][nv] = f['id']
        else:
            thieu = ' và '.join(x for x, co in (('người', nv), ('nước', mkt)) if not co)
            la.append((f, ctx, f'không rõ {thieu}'))
    return bo, excel, la


# ─── Drive ────────────────────────────────────────────────────────────────────────────────

def ds_con(sess, fid):
    """Mọi thứ nằm NGAY trong một thư mục (không đệ quy)."""
    out, page = [], None
    while True:
        params = {'q': f"'{fid}' in parents and trashed = false",
                  'fields': 'nextPageToken,files(id,name,mimeType)',
                  'pageSize': 200, 'supportsAllDrives': 'true', 'includeItemsFromAllDrives': 'true'}
        if page:
            params['pageToken'] = page
        r = sess.get(DRIVE_API, params=params)
        r.raise_for_status()
        d = r.json()
        out += d.get('files', [])
        page = d.get('nextPageToken')
        if not page:
            return out


def walk(sess, fid, path=()):
    """Trả về (file, đường dẫn thư mục) cho mọi bảng tính, đệ quy vào thư mục con."""
    for f in ds_con(sess, fid):
        if f['mimeType'] == FOLDER_MIME:
            yield from walk(sess, f['id'], path + (f['name'],))
        elif f['mimeType'] == SHEET_MIME or f['mimeType'] in EXCEL_MIME:
            yield f, path


def phien_drive(key):
    from google.oauth2.service_account import Credentials
    from google.auth.transport.requests import AuthorizedSession
    return AuthorizedSession(Credentials.from_service_account_file(
        key, scopes=['https://www.googleapis.com/auth/drive.readonly']))


def tim_thu_muc_thang(sess, root, y, m):
    """ID thư mục "Tháng m" nằm ngay trong thư mục gốc. Không thấy → None (chưa tạo hoặc chưa
    share thư mục gốc cho service account)."""
    ung_vien = [f for f in ds_con(sess, root) if f['mimeType'] == FOLDER_MIME and la_thu_muc_thang(f['name'], y, m)]
    if not ung_vien:
        return None
    # Hai thư mục cùng là tháng m: ưu tiên cái ghi rõ năm.
    ung_vien.sort(key=lambda f: str(y) not in f['name'])
    return ung_vien[0]['id']


# ─── Bộ file của một tháng ──────────────────────────────────────────────────────────────────

def _co_file(bo):
    return bool(bo and (bo.get('grand') or any(bo.get('files', {}).values()) or bo.get('test')))


def bo_file_thang(y, m, *, here, cache_dir, key=None, log=print, sess=None):
    """Bộ file của tháng y-m + nguồn (chuỗi để in log). Không có → (None, lý do)."""
    tk = f'{y}-{m:02d}'
    khai_tay = os.path.join(here, 'report_files', f'{tk}.json')
    if os.path.exists(khai_tay):
        with open(khai_tay, encoding='utf-8') as fh:
            bo = json.load(fh)
        bo.setdefault('files', {})
        bo.setdefault('test', {})
        return bo, f'khai tay ở report_files/{tk}.json'

    root = (RULES.get('report_drive') or {}).get('root_folder_id')
    nho = os.path.join(cache_dir, f'{tk}.json')
    if not root:
        return None, 'talpha_rules.json chưa khai report_drive.root_folder_id'
    try:
        sess = sess or phien_drive(key)
        thu_muc = tim_thu_muc_thang(sess, root, y, m)
        if not thu_muc:
            return None, (f'không thấy thư mục "Tháng {m}" trong thư mục gốc {root} — chưa tạo, hoặc '
                          'thư mục gốc chưa share Editor cho service account')
        bo, excel, la = phan_loai(list(walk(sess, thu_muc)))
        for f, ctx in excel:
            log(f'CANH BAO: file Excel (.xlsx) không ghi được — {f["name"]} [{ctx}]: mở file → File → Save as Google Sheets')
        for f, ctx, why in la:
            log(f'CANH BAO: không xếp được {f["name"]} [{ctx}] ← {why}')
        if not _co_file(bo):
            return None, f'thư mục "Tháng {m}" ({thu_muc}) chưa có Google Sheet nào'
        try:
            os.makedirs(cache_dir, exist_ok=True)
            with open(nho, 'w', encoding='utf-8') as fh:
                json.dump({**bo, '_thu_muc': thu_muc}, fh, ensure_ascii=False, indent=1)
        except OSError as e:
            log(f'(không lưu được bản nhớ {nho}: {e})')
        return bo, f'Drive thư mục "Tháng {m}" ({thu_muc})'
    except Exception as e:  # mạng / Drive API lỗi — dùng bản nhớ CỦA CHÍNH THÁNG ĐÓ nếu có
        if os.path.exists(nho):
            with open(nho, encoding='utf-8') as fh:
                bo = json.load(fh)
            return bo, f'bản nhớ {nho} (Drive lỗi: {e})'
        return None, f'Drive lỗi và chưa có bản nhớ tháng {tk}: {e}'

#!/usr/bin/env python3
"""Quét thư mục Drive của tháng mới → in sẵn map ID file cho format_all.py.

CHỈ ĐỌC. Không ghi gì lên Drive, không sửa file nào — chép phần in ra vào đúng file JSON.

    python3 new_month_files.py <FOLDER_ID hoặc link thư mục>

In ra:
    GRAND_KEY="…"            → dán vào format_all.py (file TỔNG TEAM THÁNG n)
    # taiwan_files.json      → mỗi nước một file map {key marketer: ID}
    # singapore_files.json
    # uae_files.json …
    # test_files.json

Cách nhận file (16/09/2026 — mỗi marketer × mỗi nước một file):
    người = tên thư mục chứa file (ANH, LOC, THAI…) hoặc tên file;
    nước  = một từ trong tên file khớp market_aliases của talpha_rules.json
            ("TAIWAN T10", "SINGAPORE T10", "UAE T10"…).
Người và nước đều đọc từ talpha_rules.json — thêm người, thêm nước ở đó là script tự biết.

Điều kiện: thư mục (và mọi thư mục con) đã share quyền Editor cho service account
talpha-dashboard@cty-507710.iam.gserviceaccount.com.
"""
import os, sys, json, unicodedata
from google.oauth2.service_account import Credentials
from google.auth.transport.requests import AuthorizedSession

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import talpha_paths
from talpha_rules import ALLM, PRIMARY_MARKET, RULES
KEY = talpha_paths.bq_key()
SCOPES = ['https://www.googleapis.com/auth/drive']
SHEET_MIME = 'application/vnd.google-apps.spreadsheet'
FOLDER_MIME = 'application/vnd.google-apps.folder'
# CEO hay tải file lên dạng .xlsx — Sheets API KHÔNG ghi được vào đó, job trượt im lặng.
EXCEL_MIME = {'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'application/vnd.ms-excel'}


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
for key, v in RULES['marketers'].items():
    ten = v.get('display') or ''
    for cum in (key, ten, v.get('full'), ten.split()[-1] if ten else None):
        if cum:
            NV.setdefault(norm(cum), key)
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


def walk(sess, fid, path=()):
    """Trả về (file, đường dẫn thư mục) cho mọi bảng tính, đệ quy vào thư mục con."""
    page = None
    while True:
        params = {'q': f"'{fid}' in parents and trashed = false",
                  'fields': 'nextPageToken,files(id,name,mimeType)',
                  'pageSize': 200, 'supportsAllDrives': 'true',
                  'includeItemsFromAllDrives': 'true'}
        if page:
            params['pageToken'] = page
        r = sess.get('https://www.googleapis.com/drive/v3/files', params=params)
        r.raise_for_status()
        d = r.json()
        for f in d.get('files', []):
            if f['mimeType'] == FOLDER_MIME:
                yield from walk(sess, f['id'], path + (f['name'],))
            elif f['mimeType'] == SHEET_MIME or f['mimeType'] in EXCEL_MIME:
                yield f, path
        page = d.get('nextPageToken')
        if not page:
            break


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    fid = sys.argv[1].strip().rstrip('/').split('/')[-1].split('?')[0]
    creds = Credentials.from_service_account_file(KEY, scopes=SCOPES)
    sess = AuthorizedSession(creds)

    items = list(walk(sess, fid))
    if not items:
        print(f'KHÔNG THẤY FILE NÀO trong thư mục {fid}.')
        print('→ Thường là do chưa share. Mở thư mục trên Drive, bấm Share, thêm:')
        print('     talpha-dashboard@cty-507710.iam.gserviceaccount.com   (Editor)')
        print('  rồi chạy lại lệnh này.')
        sys.exit(2)

    theo_nuoc = {m: {} for m in ALLM}
    test, excel, la = {}, [], []
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
            (test.setdefault(nv, f['id']) if nv else la.append((f, ctx, 'file test nhưng không rõ người')))
        elif 'TONG TEAM' in u:
            print(f'GRAND_KEY="{f["id"]}"   # {name}')
        elif nv and mkt:
            if nv in theo_nuoc[mkt]:
                la.append((f, ctx, f'TRÙNG — {nv}/{mkt} đã nhận file {theo_nuoc[mkt][nv]}'))
            else:
                theo_nuoc[mkt][nv] = f['id']
        else:
            thieu = ' và '.join(x for x, co in (('người', nv), ('nước', mkt)) if not co)
            la.append((f, ctx, f'không rõ {thieu}'))

    print(f'\n# ── {len(items)} bảng tính · '
          + ' · '.join(f'{len(theo_nuoc[m])} {m}' for m in ALLM) + f' · {len(test)} Test\n')
    for m in ALLM:
        print(f'# {m.lower()}_files.json:\n' + json.dumps(theo_nuoc[m], ensure_ascii=False, indent=1) + '\n')
    if test:
        print('# test_files.json:\n' + json.dumps(test, ensure_ascii=False, indent=1))

    # Nước CHÍNH ai cũng phải có file. Nước khác chỉ cần khi người đó có số — format_all.py
    # tự in "CANH BAO … CHUA CO FILE" khi thiếu, nên ở đây không kêu.
    thieu = [k for k in RULES['marketers'] if k not in theo_nuoc.get(PRIMARY_MARKET, {})]
    if thieu:
        print(f'\nTHIẾU FILE {PRIMARY_MARKET.upper()}: ' + ', '.join(thieu))
    if excel:
        print('\nFILE EXCEL (.xlsx) — job KHÔNG ghi được. Mở file → File → Save as Google Sheets:')
        for f, ctx in excel:
            print(f'    {f["name"][:48]:50s} [{ctx}]')
    if la:
        print('\nKHÔNG XẾP ĐƯỢC — đổi tên file/thư mục cho rõ rồi chạy lại:')
        for f, ctx, why in la:
            print(f'    {f["name"][:48]:50s} [{ctx}]  ← {why}')


if __name__ == '__main__':
    main()

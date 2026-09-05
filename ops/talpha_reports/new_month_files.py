#!/usr/bin/env python3
"""Quét thư mục Drive của tháng mới → sinh sẵn MARKET_MAP / TONG_MAP cho format_all.py.

CHỈ ĐỌC. Không ghi gì lên Drive, không sửa file nào.

    python3 new_month_files.py <FOLDER_ID>

Điều kiện: thư mục (và mọi thư mục con) đã share cho service account
faos-dashboard@cty-507710.iam.gserviceaccount.com quyền Editor.
"""
import sys, json, re, collections
from google.oauth2.service_account import Credentials
from google.auth.transport.requests import AuthorizedSession

KEY = '/Users/syanh/talpha_reports/runtime/bigquery_key.json'
SCOPES = ['https://www.googleapis.com/auth/drive']
SHEET_MIME = 'application/vnd.google-apps.spreadsheet'
FOLDER_MIME = 'application/vnd.google-apps.folder'

# tên thị trường trong tên file/thư mục → key trong format_all
MKT = {'SAUDI': 'Saudi', 'KSA': 'Saudi', 'SA': 'Saudi', 'UAE': 'UAE', 'DUBAI': 'UAE',
       'KUWAIT': 'Kuwait', 'KW': 'Kuwait', 'OMAN': 'Oman', 'OM': 'Oman',
       'QATAR': 'Qatar', 'QA': 'Qatar', 'BAHRAIN': 'Bahrain', 'BH': 'Bahrain',
       'TAIWAN': 'Taiwan', 'DAI': 'Taiwan', 'ĐÀI': 'Taiwan'}
# tên người trong tên thư mục/file → key marketer
NV = [('THUÝ', 'ChuThuy'), ('THUY', 'ChuThuy'), ('LỘC', 'Loc'), ('LOC', 'Loc'),
      ('NHUNG', 'Nhung'), ('CHÍNH', 'Chinh'), ('CHINH', 'Chinh'),
      ('SỸ ANH', 'SAnh'), ('SY ANH', 'SAnh'), ('SANH', 'SAnh'), ('S ANH', 'SAnh'),
      ('THẾ', 'The'), ('MAI', 'Mai'), ('ANH', 'SAnh')]

def norm(s):
    # giữ MỌI chữ cái Unicode (tiếng Việt có dấu), thay phần còn lại bằng khoảng trắng
    return ' '.join(''.join(c if c.isalnum() else ' ' for c in (s or '').upper()).split())

def find_nv(*texts):
    for t in texts:
        u = norm(t)
        for tok, key in NV:
            if tok in u:
                return key
    return None

def find_mkt(*texts):
    for t in texts:
        toks = norm(t).split()
        for tok, key in MKT.items():
            if tok in toks:
                return key
    return None

def walk(sess, fid, path=()):
    """Trả về (file, đường dẫn thư mục) cho mọi spreadsheet, đệ quy vào thư mục con."""
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
            elif f['mimeType'] == SHEET_MIME:
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
        print('     faos-dashboard@cty-507710.iam.gserviceaccount.com   (Editor)')
        print('  rồi chạy lại lệnh này.')
        sys.exit(2)

    market, tong, taiwan, test, la = {}, {}, {}, {}, []
    for f, path in items:
        name, ctx = f['name'], ' / '.join(path)
        nv = find_nv(ctx, name)
        mkt = find_mkt(name, ctx)
        u = norm(name)
        if 'TEST' in u:
            (test.setdefault(nv, f['id']) if nv else la.append((f, ctx, 'test nhưng không rõ người')))
        elif 'TỔNG TEAM' in u or 'TONG TEAM' in u:
            print(f'GRAND_KEY="{f["id"]}"   # {name}')
        elif 'TỔNG' in u or 'TONG' in u:
            if nv: tong[nv] = f['id']
            else: la.append((f, ctx, 'file TỔNG nhưng không rõ người'))
        elif mkt == 'Taiwan' and nv:
            taiwan[nv] = f['id']
        elif nv and mkt:
            market[(nv, mkt)] = f['id']
        else:
            la.append((f, ctx, f'thiếu {"người" if not nv else ""}{" và " if not nv and not mkt else ""}{"thị trường" if not mkt else ""}'))

    print(f'\n# ── {len(items)} file trong thư mục · '
          f'{len(market)} file thị trường · {len(tong)} file TỔNG · '
          f'{len(taiwan)} Taiwan · {len(test)} Test\n')
    print('MARKET_MAP={')
    for nv in sorted({k[0] for k in market}):
        row = ','.join(f'("{nv}","{m}"):"{market[(nv, m)]}"'
                       for m in ['Saudi', 'UAE', 'Kuwait', 'Oman', 'Qatar', 'Bahrain']
                       if (nv, m) in market)
        print(row + ',')
    print('}')
    print('TONG_MAP=' + json.dumps(tong, ensure_ascii=False))
    if taiwan: print('\n# taiwan_files.json:\n' + json.dumps(taiwan, ensure_ascii=False, indent=1))
    if test:   print('\n# test_files.json:\n' + json.dumps(test, ensure_ascii=False, indent=1))

    miss = [(nv, m) for nv in sorted({k[0] for k in market})
            for m in ['Saudi', 'UAE', 'Kuwait', 'Oman', 'Qatar', 'Bahrain'] if (nv, m) not in market]
    if miss:
        print('\nTHIẾU FILE (người có mặt nhưng vắng thị trường này):')
        for nv, m in miss: print(f'    {nv:8s} {m}')
    if la:
        print('\nKHÔNG XẾP ĐƯỢC — đổi tên file/thư mục cho rõ rồi chạy lại:')
        for f, ctx, why in la: print(f'    {f["name"][:48]:50s} [{ctx}]  ← {why}')

if __name__ == '__main__':
    main()

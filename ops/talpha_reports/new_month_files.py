#!/usr/bin/env python3
"""Soát bộ file báo cáo của MỘT THÁNG trên Drive — CHỈ ĐỌC, không ghi gì lên Drive.

    python3 new_month_files.py 2026-10                  # tìm thư mục "Tháng 10" trong thư mục gốc
    python3 new_month_files.py <FOLDER_ID hoặc link>    # soát thẳng một thư mục

Từ 01/10/2026 format_all.py TỰ tìm bộ file của tháng đang chạy (report_files.py) — không phải
dán ID vào đâu nữa. Script này để soát trước: thư mục tháng mới đã đủ file chưa, file nào
không xếp được (sai tên, .xlsx), ai tháng trước có file mà tháng này thiếu. Muốn ép một bộ ID
thì lưu phần JSON in ra thành report_files/YYYY-MM.json (khai tay thắng quét Drive).

Cách nhận file: người = tên thư mục chứa file (ANH, LOC, THAI…) hoặc tên file; nước = một từ
trong tên file khớp market_aliases của talpha_rules.json ("TAIWAN T10", "SINGAPORE T10"…);
"TỔNG TEAM" = file tổng; có chữ TEST = file test của người đó.

Điều kiện: thư mục gốc đã share quyền Editor cho service account
talpha-dashboard@cty-507710.iam.gserviceaccount.com.
"""
import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import talpha_paths
import report_files as rf
from talpha_rules import ALLM, RULES


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    arg = sys.argv[1].strip()
    sess = rf.phien_drive(talpha_paths.bq_key())
    m = re.fullmatch(r'(\d{4})-(\d{1,2})', arg)
    if m:
        y, th = int(m.group(1)), int(m.group(2))
        root = (RULES.get('report_drive') or {}).get('root_folder_id')
        fid = rf.tim_thu_muc_thang(sess, root, y, th)
        if not fid:
            print(f'KHÔNG THẤY thư mục "Tháng {th}" trong thư mục gốc {root}.')
            print('→ Tạo thư mục đó, hoặc share thư mục gốc (Editor) cho talpha-dashboard@cty-507710.iam.gserviceaccount.com')
            sys.exit(2)
    else:
        fid = arg.rstrip('/').split('/')[-1].split('?')[0]

    items = list(rf.walk(sess, fid))
    if not items:
        print(f'KHÔNG THẤY FILE NÀO trong thư mục {fid} — chưa có file, hoặc chưa share cho service account.')
        sys.exit(2)
    bo, excel, la = rf.phan_loai(items)
    print(f'# {len(items)} bảng tính · ' + ' · '.join(f'{len(bo["files"][x])} {x}' for x in ALLM)
          + f' · {len(bo["test"])} Test · TỔNG TEAM: {"có" if bo["grand"] else "THIẾU"}\n')
    print(json.dumps(bo, ensure_ascii=False, indent=1))

    # So với tháng KHAI TAY gần nhất (người ngừng chạy vẫn nằm trong talpha_rules.json nên
    # không so với cả roster — kêu "thiếu" họ mỗi tháng là báo nhầm).
    here = os.path.dirname(os.path.abspath(__file__))
    cu = sorted(glob.glob(os.path.join(here, 'report_files', '*.json')))
    if cu:
        truoc = json.load(open(cu[-1], encoding='utf-8'))
        for x in ALLM:
            thieu = [k for k in (truoc.get('files') or {}).get(x, {}) if k not in bo['files'][x]]
            if thieu:
                print(f'\nTHIẾU FILE {x.upper()} (so với {os.path.basename(cu[-1])}): ' + ', '.join(thieu))
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

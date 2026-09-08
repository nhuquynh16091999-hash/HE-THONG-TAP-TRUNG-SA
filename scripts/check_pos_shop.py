#!/usr/bin/env python3
"""Kiểm nhanh: key Poscake và shop_id trong config có gọi được API thật không.

    python3 scripts/check_pos_shop.py

Chạy trước mỗi lần đổi shop hoặc đổi key. Không ghi gì vào BigQuery.

Vì sao cần: shop_id từng bị ghi cứng trong code và SAI (mã cũ 1328343252 là
của hệ thống trước). Gọi API thật là biết ngay, thay vì chạy cả pipeline rồi
mới thấy 0 đơn mà không hiểu tại sao.
"""
import json
import os
import sys
from collections import Counter
from urllib.parse import urlencode
from urllib.request import urlopen

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
POS_API = "https://pos.pages.fm/api/v1"


def load_markets():
    with open(os.path.join(ROOT, "config", "talpha_rules.json"), encoding="utf-8") as fh:
        return (json.load(fh).get("markets") or {})


def fetch(shop_id, key, page=1, size=100):
    q = urlencode({"api_key": key, "page_size": size, "page_number": page})
    with urlopen(f"{POS_API}/shops/{shop_id}/orders?{q}", timeout=40) as r:
        return json.load(r)


def main():
    markets = load_markets()
    if not markets:
        print("!! config/talpha_rules.json không khai market nào"); return 1

    bad = 0
    for name, m in markets.items():
        label = m.get("shop_label", "")
        shop_id = str(m.get("shop_id", ""))
        key = os.environ.get(f"TALPHA_POSCAKE_{label}_KEY", "")
        print(f"\n=== {name} ({label}) · shop_id {shop_id} ===")
        if not key:
            print(f"  !! thiếu biến môi trường TALPHA_POSCAKE_{label}_KEY"); bad += 1; continue

        try:
            d = fetch(shop_id, key, size=1)
        except Exception as e:
            print(f"  !! gọi API hỏng: {e}"); bad += 1; continue

        if not d.get("success", True):
            print(f"  !! POS từ chối: {d.get('message')}"); bad += 1; continue

        total = d.get("total_entries", 0)
        print(f"  OK · {total} đơn")

        rows = []
        for p in range(1, (total // 100) + 2):
            page = fetch(shop_id, key, page=p)
            got = page.get("data") or []
            rows += got
            if not got or len(rows) >= total:
                break

        cur = Counter(o.get("order_currency") for o in rows)
        st = Counter(o.get("status_name") for o in rows)
        print(f"  loại tiền : {dict(cur)}")
        print(f"  trạng thái: {dict(st)}")

        # Cảnh báo tiền lẫn lộn. Shop Đài đang có cả đơn TWD lẫn đơn VND —
        # cộng chung là ra doanh thu vô nghĩa (1.299 + 730.000 trong một tổng).
        want = m.get("currency")
        others = {c: n for c, n in cur.items() if c and c != want}
        if others:
            print(f"  ⚠ LẪN TIỀN: khai {want} nhưng có thêm {others}")
            for c in others:
                s = sum(o.get("cod") or 0 for o in rows if o.get("order_currency") == c)
                print(f"      {c}: {s:,.0f} — phải lọc ra, không được cộng vào doanh thu {want}")
            bad += 1

        twd = [o.get("cod") or 0 for o in rows if o.get("order_currency") == want]
        nz = [v for v in twd if v > 0]
        if nz:
            print(f"  COD {want}: {min(nz):,.0f} – {max(nz):,.0f} · tổng {sum(nz):,.0f}")
            div = m.get("pos_money_divisor", 1)
            print(f"  pos_money_divisor = {div} → doanh thu {sum(nz) / div:,.0f} {want}")

    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())

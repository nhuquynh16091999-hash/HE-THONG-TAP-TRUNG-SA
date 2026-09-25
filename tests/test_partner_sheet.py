"""
Bảng đơn đối tác (Google Sheet) → dòng partner_orders. Tiêu đề và dòng mẫu lấy từ bảng
Singapore THẬT "BS UP DATA SGP" (Sỹ Anh chia sẻ 25/09/2026).

Chạy: python3 -m pytest tests/test_partner_sheet.py -q
"""
import json
import sys
from pathlib import Path

GOC = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(GOC))

from sync.core.partner_sheet import chuan_dong, chuan_tieu_de, doc_ngay, doc_so, gan_cot  # noqa: E402

COT = json.loads((GOC / "config" / "talpha_rules.json").read_text(encoding="utf-8"))["partner_orders"]["column_map"]
TIEU_DE = ["MKT", "Đối soát", "Ghi chú", "Trạng Thái", "Ngày lên đơn ", "Ngày xuất kho",
           "PHƯƠNG THỨC VẬN CHUYỂN ", "Order No.", "Tracking number ",
           "Mã đơn mới của đơn đi kho hàng hoàn ", "SKU ", "Quantity ", "Contact Name(*)", "Phone",
           "Country(*)", "States(*)", "City(*)", "Address(*)", "PostCode(*)", "COD Amount (SGD)", "Currency"]
META = {"market": "Singapore", "shop_label": "SG", "sheet_id": "x"}


def test_chuan_tieu_de():
    assert chuan_tieu_de("COD Amount (SGD)") == "cod amount sgd"
    assert chuan_tieu_de("Contact Name(*)") == "contact name"
    assert chuan_tieu_de("Mã đơn mới của đơn đi kho hàng hoàn ") == "ma don moi cua don di kho hang hoan"


def test_gan_du_cot_bang_singapore():
    cot = gan_cot(TIEU_DE, COT)
    assert cot["order_no"] == 7 and cot["tracking"] == 8 and cot["cod"] == 19
    # 'Mã đơn mới…' khớp cả 'ma don' (order_no) lẫn 'ma don moi' — bí danh dài hơn thắng.
    assert cot["return_order_no"] == 9
    assert cot["status"] == 3 and cot["note"] == 2 and cot["marketer"] == 0


def test_doc_ngay_va_so():
    assert doc_ngay("14/9/2026") == "2026-09-14"
    assert doc_ngay("18/09/2026") == "2026-09-18"
    assert doc_ngay("2026-09-14") == "2026-09-14"
    assert doc_ngay("") is None and doc_ngay("31/02/2026") is None
    assert doc_so("99") == 99 and doc_so("1,299") == 1299 and doc_so("12,5") == 12.5
    assert doc_so("1.299,5") == 1299.5 and doc_so("") is None


def test_chuan_dong_dong_that():
    values = [TIEU_DE,
              ["Lộc", "", "", "Đã giao thành công", "14/9/2026", "18/09/2026", "Giao tại nhà ", "S6868",
               "JT20262609619436\n", "", "040 - VONGVANG1", "2", "Menora", "6590991589", "SG", "", "",
               "Block 198 Pasir Ris St. 12", "510198", "99", "SGD"],
              ["Lộc", "", "", "", "25/9/2026", "", "Giao tại nhà ", "S1066"],   # dòng cụt: chưa có vận đơn
              ["", "", "", "", "", "", "", "", ""]]                              # dòng trống — bỏ
    rows = chuan_dong(values, COT, META, "2026-09-25T09:00:00")
    assert len(rows) == 2
    r = rows[0]
    assert r["tracking"] == "JT20262609619436"          # ô Sheet có xuống dòng thừa
    assert r["order_date"] == "2026-09-14" and r["ship_date"] == "2026-09-18"
    assert r["quantity"] == 2 and r["cod"] == 99 and r["currency"] == "SGD"
    assert r["row_no"] == 2 and r["shop_label"] == "SG"
    assert rows[1]["order_no"] == "S1066" and rows[1]["tracking"] == "" and rows[1]["cod"] is None


def test_thieu_cot_bat_buoc_thi_bao_loi():
    import pytest
    with pytest.raises(ValueError):
        chuan_dong([["MKT", "SKU"], ["Lộc", "040"]], COT, META, "t")

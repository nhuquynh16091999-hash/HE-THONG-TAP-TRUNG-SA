"""
File báo cáo: MỖI THÁNG MỘT THƯ MỤC, trong đó mỗi marketer × mỗi nước một file.

Chạy: python3 -m pytest tests/test_talpha_file_theo_nuoc.py -q

16/09/2026 Sỹ Anh chốt mỗi marketer × mỗi nước một file. 01/10/2026 chốt tiếp: mỗi tháng một
thư mục "Tháng N" — vì bộ ID cố định (GRAND_KEY + <nước>_files.json) làm số tháng 10 ghi ĐÈ
lên 16 file tháng 9 ngay sáng 01/10. Nay format_all.py lấy bộ file của tháng qua
ops/talpha_reports/report_files.py: khai tay report_files/YYYY-MM.json, không có thì quét Drive.
Map sai thì job không báo lỗi gì: gõ "Lộc" thay "Loc" là file ghi toàn số 0; một ID ở hai chỗ
là hai báo cáo thay nhau xoá sạch tab của nhau mỗi giờ. Mấy phép thử dưới đây chặn đúng mấy
kiểu đó, và chặn quay lại kiểu ID cố định.
"""
import datetime
import json
import re
import sys
from pathlib import Path

GOC = Path(__file__).resolve().parent.parent
REPORTS = GOC / "ops" / "talpha_reports"
sys.path.insert(0, str(REPORTS))

import report_files as rf  # noqa: E402
from talpha_rules import ALLM, RULES  # noqa: E402

KHAI_TAY = sorted((REPORTS / "report_files").glob("*.json"))
DRIVE_ID = re.compile(r"^[A-Za-z0-9_-]{25,}$")


def _doc(p):
    return json.loads(p.read_text(encoding="utf-8"))


def _moi_id(bo):
    out = []
    if bo.get("grand"):
        out.append(("grand", "-", bo["grand"]))
    for mkt, m in (bo.get("files") or {}).items():
        out += [(mkt, emp, fid) for emp, fid in m.items()]
    out += [("test", emp, fid) for emp, fid in (bo.get("test") or {}).items()]
    return out


# ─── Bộ file khai tay ───

def test_ten_file_khai_tay_la_mot_thang():
    for p in KHAI_TAY:
        assert re.fullmatch(r"\d{4}-\d{2}\.json", p.name), f"{p.name}: phải đặt tên YYYY-MM.json"


def test_thang_9_van_khai_du():
    bo = _doc(REPORTS / "report_files" / "2026-09.json")
    assert bo.get("grand"), "tháng 9 mất file TỔNG TEAM"
    assert bo["files"].get("Taiwan"), "tháng 9 không còn file Đài"


def test_nuoc_va_nguoi_dung_luat_id_dung_dang():
    marketers = set(RULES["marketers"])
    for p in KHAI_TAY:
        bo = _doc(p)
        for mkt in bo.get("files") or {}:
            assert mkt in ALLM, f"{p.name}: '{mkt}' không phải thị trường trong talpha_rules.json ({ALLM})"
        for loai, emp, fid in _moi_id(bo):
            if emp != "-" and loai != "test":
                assert emp in marketers, f"{p.name}: '{emp}' không phải key marketer — gõ tên hiển thị thay key?"
            assert isinstance(fid, str) and DRIVE_ID.match(fid), f"{p.name}: ID {loai}/{emp} không giống ID Google Sheet: {fid!r}"


def test_khong_file_nao_bi_hai_bao_cao_cung_ghi_ke_ca_khac_thang():
    # write_file() xoá sạch tab cũ rồi mới ghi. Một ID ở hai chỗ trong một tháng là hai báo cáo
    # đè nhau mỗi giờ; một ID ở HAI THÁNG chính là lỗi 01/10/2026 — tháng mới xoá tháng cũ.
    noi = {}
    for p in KHAI_TAY:
        for loai, emp, fid in _moi_id(_doc(p)):
            assert fid not in noi, f"ID {fid} dùng hai lần: {noi[fid]} và {p.name}/{loai}/{emp}"
            noi[fid] = f"{p.name}/{loai}/{emp}"


def test_khong_quay_lai_bo_id_co_dinh():
    src = (REPORTS / "format_all.py").read_text(encoding="utf-8")
    assert not re.search(r'^GRAND_KEY\s*=\s*"[A-Za-z0-9_-]{25,}"', src, re.M), "format_all.py lại ghi cứng GRAND_KEY"
    assert not list(REPORTS.glob("*_files.json")), "lại có <nước>_files.json — bộ ID cố định đè tháng cũ"
    assert "date.today()" not in src.split("import report_files")[1][:400], "tháng phải theo giờ VN (report_files.ngay_chot)"


def test_deploy_mang_theo_module_va_moi_thang_khai_tay():
    sh = (REPORTS / "deploy_runtime.sh").read_text(encoding="utf-8")
    assert "ops/talpha_reports/report_files.py|report_files.py" in sh
    assert '"$REPO"/ops/talpha_reports/report_files/*.json' in sh, "deploy_runtime.sh không còn quét report_files/*.json"


def test_luat_khai_thu_muc_goc():
    assert DRIVE_ID.match((RULES.get("report_drive") or {}).get("root_folder_id", "")), "thiếu report_drive.root_folder_id"


# ─── Tháng theo giờ Việt Nam ───

def test_ngay_1_luc_6h_sang_vn_da_la_thang_moi():
    # 01/10 06:00 giờ VN = 30/09 23:00 UTC. Máy chủ UTC dùng date.today() là còn tháng 9.
    now = datetime.datetime(2026, 10, 1, 6, 0)
    assert rf.ngay_chot(None, now) == datetime.date(2026, 10, 1)


def test_dung_lai_thang_cu_lay_du_thang():
    now = datetime.date(2026, 10, 1)
    assert rf.ngay_chot("2026-09", now) == datetime.date(2026, 9, 30)
    assert rf.ngay_chot("2026-10", now) == now


def test_thang_tuong_lai_bao_loi():
    try:
        rf.ngay_chot("2026-11", datetime.date(2026, 10, 1))
    except ValueError:
        return
    raise AssertionError("tháng chưa tới phải báo lỗi")


# ─── Nhận thư mục tháng và file ───

def test_nhan_thu_muc_thang():
    assert rf.la_thu_muc_thang("Tháng 10", 2026, 10)
    assert rf.la_thu_muc_thang("THÁNG 10/2026", 2026, 10)
    assert rf.la_thu_muc_thang("Tháng 9", 2026, 9)
    assert not rf.la_thu_muc_thang("Tháng 1", 2026, 10)
    assert not rf.la_thu_muc_thang("Tháng 10/2025", 2026, 10)
    assert not rf.la_thu_muc_thang("Tháng 10 cũ", 2026, 1)
    assert not rf.la_thu_muc_thang("THANG", 2026, 10)


SHEET = "application/vnd.google-apps.spreadsheet"


def _f(i, ten, mime=SHEET):
    return {"id": f"id{i:024d}", "name": ten, "mimeType": mime}


def test_phan_loai_thu_muc_thang():
    items = [
        (_f(1, "TỔNG TEAM THÁNG 10"), ()),
        (_f(2, "TAIWAN T10"), ("LOC",)),
        (_f(3, "SINGAPORE T10"), ("LOC",)),
        (_f(4, "TAIWAN T10"), ("THUONG",)),
        (_f(5, "[Test] Ads T10"), ("THAI",)),
        (_f(6, "UAE T10"), ("THANG",)),      # thư mục người tên Thắng
        (_f(7, "ghi chú"), ()),
    ]
    bo, excel, la = rf.phan_loai(items)
    assert bo["grand"] == "id" + "1".zfill(24)
    assert bo["files"]["Taiwan"] == {"Loc": "id" + "2".zfill(24), "Thuong": "id" + "4".zfill(24)}
    assert bo["files"]["Singapore"] == {"Loc": "id" + "3".zfill(24)}
    assert bo["files"]["UAE"] == {"Thang": "id" + "6".zfill(24)}
    assert bo["test"] == {"Thai": "id" + "5".zfill(24)}
    assert [x[0]["name"] for x in la] == ["ghi chú"] and excel == []


def test_thu_muc_thang_khong_bi_nhan_nham_la_ten_thang():
    # "Tháng 10" bỏ dấu thành "THANG 10" — không được hiểu là người tên Thắng.
    bo, _, la = rf.phan_loai([(_f(1, "TAIWAN T10"), ("Tháng 10",))])
    assert bo["files"]["Taiwan"] == {} and la


def test_hai_file_tong_team_thi_khong_tu_chon():
    bo, _, la = rf.phan_loai([(_f(1, "TỔNG TEAM THÁNG 10"), ()), (_f(2, "TỔNG TEAM THÁNG 10 (bản sao)"), ())])
    assert bo["grand"] == "id" + "1".zfill(24) and any("TRÙNG" in x[2] for x in la)


# ─── Bộ file một tháng ───

class _Sess:
    """Drive giả: {folder_id: [file…]}."""
    def __init__(self, cay, loi=None):
        self.cay, self.loi = cay, loi

    def get(self, url, params=None):
        if self.loi:
            raise self.loi
        fid = re.search(r"'([^']+)' in parents", params["q"]).group(1)
        cay = self.cay

        class R:
            def raise_for_status(self):
                pass

            def json(self):
                return {"files": cay.get(fid, [])}
        return R()


FOLDER = "application/vnd.google-apps.folder"
ROOT = RULES["report_drive"]["root_folder_id"]


def test_khai_tay_thang_bo_qua_drive(tmp_path):
    bo, nguon = rf.bo_file_thang(2026, 9, here=str(REPORTS), cache_dir=str(tmp_path), sess=_Sess({}, loi=RuntimeError("không được gọi")))
    assert bo["grand"] and "khai tay" in nguon


def test_quet_drive_ra_bo_file_va_luu_ban_nho(tmp_path):
    cay = {ROOT: [{"id": "T9", "name": "Tháng 9", "mimeType": FOLDER}, {"id": "T10", "name": "Tháng 10", "mimeType": FOLDER}],
           "T10": [_f(1, "TỔNG TEAM THÁNG 10"), {"id": "L", "name": "LOC", "mimeType": FOLDER}],
           "L": [_f(2, "TAIWAN T10")],
           "T9": [_f(9, "TỔNG TEAM THÁNG 9")]}
    bo, nguon = rf.bo_file_thang(2026, 10, here=str(tmp_path), cache_dir=str(tmp_path / "nho"), sess=_Sess(cay), log=lambda *a: None)
    assert bo["grand"] == "id" + "1".zfill(24), "phải lấy file của Tháng 10, không phải Tháng 9"
    assert bo["files"]["Taiwan"] == {"Loc": "id" + "2".zfill(24)}
    assert "Tháng 10" in nguon and (tmp_path / "nho" / "2026-10.json").exists()


def test_chua_co_thu_muc_thang_thi_khong_ghi_gi(tmp_path):
    cay = {ROOT: [{"id": "T9", "name": "Tháng 9", "mimeType": FOLDER}], "T9": [_f(9, "TỔNG TEAM THÁNG 9")]}
    bo, nguon = rf.bo_file_thang(2026, 10, here=str(tmp_path), cache_dir=str(tmp_path), sess=_Sess(cay))
    assert bo is None and "Tháng 10" in nguon


def test_drive_loi_thi_dung_ban_nho_cua_chinh_thang_do(tmp_path):
    (tmp_path / "2026-10.json").write_text(json.dumps({"grand": "G" * 30, "files": {}, "test": {}}), encoding="utf-8")
    bo, nguon = rf.bo_file_thang(2026, 10, here=str(tmp_path / "x"), cache_dir=str(tmp_path), sess=_Sess({}, loi=OSError("mạng")))
    assert bo["grand"] == "G" * 30 and "bản nhớ" in nguon
    bo, _ = rf.bo_file_thang(2026, 11, here=str(tmp_path / "x"), cache_dir=str(tmp_path), sess=_Sess({}, loi=OSError("mạng")))
    assert bo is None, "không được lấy bản nhớ của tháng khác"

"""
File báo cáo riêng: MỖI MARKETER × MỖI NƯỚC MỘT FILE (Sỹ Anh chốt 16/09/2026).

Chạy: python3 -m pytest tests/test_talpha_file_theo_nuoc.py -q

format_all.py đọc ID file Sheet từ ops/talpha_reports/<nước>_files.json — taiwan_files.json,
singapore_files.json, uae_files.json — dạng {key marketer: ID}. Map sai thì job KHÔNG báo lỗi
gì: gõ "Lộc" thay vì "Loc" là file được ghi toàn số 0; dán nhầm ID file Đài vào map Singapore
là hai báo cáo thay nhau xoá sạch tab của nhau mỗi giờ. Mấy phép thử dưới đây chặn đúng mấy
kiểu gõ nhầm đó trước khi nó lên máy chủ.
"""
import json
import re
import sys
from pathlib import Path

GOC = Path(__file__).resolve().parent.parent
REPORTS = GOC / "ops" / "talpha_reports"
sys.path.insert(0, str(REPORTS))

from talpha_rules import ALLM, RULES  # noqa: E402

# test_files.json cùng mẫu tên nhưng là file TEST (gộp mọi nước), không phải map theo nước.
MAP_NUOC = sorted(p for p in REPORTS.glob("*_files.json") if p.name != "test_files.json")
DRIVE_ID = re.compile(r"^[A-Za-z0-9_-]{25,}$")


def _doc(p):
    return json.loads(p.read_text(encoding="utf-8"))


def test_ten_file_map_la_mot_nuoc_trong_luat():
    # format_all.py tìm "<key thị trường viết thường>_files.json". Đặt "sg_files.json" hay
    # "singapor_files.json" là file map nằm đó mà không ai đọc.
    nuoc = {m.lower() for m in ALLM}
    for p in MAP_NUOC:
        ten = p.name[: -len("_files.json")]
        assert ten in nuoc, f"{p.name}: '{ten}' không phải thị trường trong talpha_rules.json ({sorted(nuoc)})"


def test_dai_loan_van_con_map():
    assert (REPORTS / "taiwan_files.json").exists()
    assert _doc(REPORTS / "taiwan_files.json"), "taiwan_files.json rỗng — không ai được ghi file Đài"


def test_khoa_la_key_marketer_va_id_dung_dang():
    marketers = set(RULES["marketers"])
    for p in MAP_NUOC:
        for emp, fid in _doc(p).items():
            assert emp in marketers, f"{p.name}: '{emp}' không phải key marketer ({sorted(marketers)}) — gõ tên hiển thị thay key?"
            assert isinstance(fid, str) and DRIVE_ID.match(fid), f"{p.name}: ID của {emp} không giống ID Google Sheet: {fid!r}"


def test_khong_file_nao_bi_hai_bao_cao_cung_ghi():
    # write_file() xoá sạch tab cũ rồi mới ghi — hai báo cáo cùng một ID là file đó mỗi giờ
    # mang bố cục của báo cáo nào chạy SAU.
    noi = {}
    nguon = [(p.name, _doc(p)) for p in MAP_NUOC] + [("test_files.json", _doc(REPORTS / "test_files.json"))]
    grand = re.search(r'^GRAND_KEY="([^"]+)"', (REPORTS / "format_all.py").read_text(encoding="utf-8"), re.M)
    assert grand, "không đọc được GRAND_KEY trong format_all.py"
    nguon.append(("GRAND_KEY (TỔNG TEAM)", {"-": grand.group(1)}))
    for ten, m in nguon:
        for emp, fid in m.items():
            assert fid not in noi, f"ID {fid} dùng hai lần: {noi[fid]} và {ten}/{emp}"
            noi[fid] = f"{ten}/{emp}"


def test_deploy_mang_theo_moi_file_map():
    # Map nước mới không lên máy chủ = cả nước đó im lặng không được ghi.
    sh = (REPORTS / "deploy_runtime.sh").read_text(encoding="utf-8")
    assert '"$REPO"/ops/talpha_reports/*_files.json' in sh, "deploy_runtime.sh không còn quét *_files.json"

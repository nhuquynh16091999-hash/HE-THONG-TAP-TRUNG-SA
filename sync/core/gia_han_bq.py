"""
sync/core/gia_han_bq.py — giữ bảng BigQuery khỏi bị TỰ XOÁ (03/11/2026).

cty-507710 là BigQuery SANDBOX (chưa bật billing — 03/11/2026 Google đòi trả trước 800.000đ mới
kích hoạt, Sỹ Anh chốt KHÔNG trả). Ở sandbox mọi bảng/view tự xoá 60 ngày sau lúc TẠO:
  • ghi đè (WRITE_TRUNCATE, dựng lại từ _raw) KHÔNG làm mới hạn — bảng tạo 05/09 hết hạn 04/11;
  • đổi `expires` bằng API bị từ chối ("…must be less than 60 days while in sandbox mode").
Cách duy nhất KHÔNG cần xoá gì (CLAUDE.md cấm tự DROP):
  • view → CREATE OR REPLACE VIEW đúng SQL cũ → view mới, hạn 60 ngày mới;
  • bảng → chép X → X__moi (bảng mới, hạn mới) → đổi tên X → X__cu_<ngày> → đổi X__moi → X.
    Bảng cũ để nguyên, tự hết hạn đúng ngày cũ. Bảng vắng tên chỉ trong khoảng giữa hai lần đổi tên.
Chạy cuối mỗi vòng talpha_sync.py (sau mọi lần ghi của vòng). Chỉ đụng thứ còn dưới NGUONG_NGAY
ngày, nên mỗi bảng ~50 ngày mới làm mới một lần; lỗi thì vòng sau (1 giờ) thử lại. Bot Zalo cảnh
báo khi còn dưới 5 ngày (sync-health → bang_sap_het_han) = bước này đã hỏng nhiều ngày liền.
"""
import logging
from datetime import datetime, timedelta, timezone

log = logging.getLogger(__name__)

NGUONG_NGAY = 10
DATASETS = ("TALPHA_Dataset", "TALPHA_SaoLuu")
DUOI_CU = "__cu_"     # bảng cũ đã thay — để nó tự hết hạn, KHÔNG làm mới
DUOI_MOI = "__moi"    # bảng tạm giữa chừng — còn sót lại nghĩa là lần trước hỏng giữa chừng


def chon_can_lam_moi(doi_tuong, bay_gio, nguong_ngay=NGUONG_NGAY):
    """doi_tuong: [(ten, loai, het_han)] — loai 'TABLE' | 'VIEW', het_han datetime hoặc None.

    Trả tên cần làm mới: có hạn và còn dưới `nguong_ngay` ngày. Bỏ bảng không hạn, bảng cũ đã
    thay (…__cu_<ngày>), bảng tạm (…__moi), và loại khác (bảng ngoài, snapshot…).
    """
    han = bay_gio + timedelta(days=nguong_ngay)
    return [
        ten for ten, loai, het_han in doi_tuong
        if loai in ("TABLE", "VIEW") and het_han is not None and het_han < han
        and DUOI_CU not in ten and not ten.endswith(DUOI_MOI)
    ]


def _co_bang(client, fqn):
    try:
        client.get_table(fqn)
        return True
    except Exception:
        return False


def _lam_moi_bang(client, fqn, ten, ngay):
    from google.cloud import bigquery as bq

    tam, cu = f"{fqn}{DUOI_MOI}", f"{ten}{DUOI_CU}{ngay}"
    if _co_bang(client, tam):
        raise RuntimeError(f"còn sót bảng tạm {ten}{DUOI_MOI} từ lần trước — cần người xem")
    client.copy_table(fqn, tam, job_config=bq.CopyJobConfig(write_disposition="WRITE_EMPTY")).result()
    n0 = client.get_table(fqn).num_rows
    if client.get_table(tam).num_rows != n0:
        raise RuntimeError(f"chép {ten} lệch số dòng — bảng gốc chưa đụng, còn sót {ten}{DUOI_MOI}")
    client.query(f"ALTER TABLE `{fqn}` RENAME TO {cu}").result()
    try:
        client.query(f"ALTER TABLE `{tam}` RENAME TO {ten}").result()
    except Exception:
        # Đổi tên lần hai hỏng thì bảng gốc đang VẮNG — trả tên cũ lại ngay.
        client.query(f"ALTER TABLE `{fqn.rsplit('.', 1)[0]}.{cu}` RENAME TO {ten}").result()
        raise


def lam_moi_han(client, project, datasets=DATASETS, nguong_ngay=NGUONG_NGAY, bay_gio=None):
    """Làm mới hạn bảng/view sắp hết hạn. Trả (đã làm mới, lỗi) — không raise, không chặn vòng."""
    bay_gio = bay_gio or datetime.now(timezone.utc)
    ngay = bay_gio.strftime("%Y%m%d")
    da_lam, loi = [], []
    for ds in datasets:
        bang = {t.table_id: client.get_table(t) for t in client.list_tables(f"{project}.{ds}")}
        can = chon_can_lam_moi([(t.table_id, t.table_type, t.expires) for t in bang.values()], bay_gio, nguong_ngay)
        for ten in can:
            t, fqn = bang[ten], f"{project}.{ds}.{ten}"
            try:
                if t.table_type == "VIEW":
                    client.query(f"CREATE OR REPLACE VIEW `{fqn}` AS\n{t.view_query}").result()
                else:
                    _lam_moi_bang(client, fqn, ten, ngay)
                moi = client.get_table(fqn).expires
                da_lam.append(f"{ds}.{ten} → {moi:%d/%m/%Y}" if moi else f"{ds}.{ten}")
            except Exception as e:
                loi.append(f"{ds}.{ten}: {str(e)[:200]}")
    return da_lam, loi

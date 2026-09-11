"""
Giải đường dẫn cho đường ống báo cáo — MỘT chỗ duy nhất.

Vì sao cần: bộ script này sinh ra trên một máy Mac và ghi thẳng
`/Users/syanh/talpha_reports` vào bốn file khác nhau. Đem lên VPS là chết ngay
ở dòng `os.chdir` — mà chết theo kiểu tệ nhất: `daily_guarded.sh` thấy sync rc=1
nên bỏ qua bước ghi Sheet (đúng theo chốt 03/09), thành ra vòng chạy vẫn "xong"
mỗi giờ trong khi Sheet đứng im. Không ai biết cho tới lúc có người mở Sheet ra
nhìn.

Sửa bằng cách sửa từng file thì sớm muộn lệch nhau — file này quên, file kia
nhớ. Nên gom về đây, và mọi file trong thư mục báo cáo hỏi đúng một nguồn.

Thứ tự dò, từ rõ ràng nhất tới đoán mò nhất:
  1. biến môi trường (systemd trên VPS đặt sẵn)
  2. runtime phẳng ~/talpha_reports nếu có (bản Mac cũ)
  3. chính thư mục chứa file này (chạy thẳng trong cây repo)
"""
import os

_HERE = os.path.dirname(os.path.abspath(__file__))


def _first_dir(*ung_vien):
    for d in ung_vien:
        if d and os.path.isdir(d):
            return d
    return None


def reports_dir() -> str:
    """Thư mục runtime phẳng — nơi có format_all.py, log, và .lock."""
    return (
        os.environ.get("TALPHA_REPORTS_DIR")
        or _first_dir(os.path.expanduser("~/talpha_reports"))
        or _HERE
    )


def runtime_dir() -> str:
    """Thư mục `runtime/` bên trong: chứa .venv, bigquery_key.json, config."""
    env = os.environ.get("TALPHA_RUNTIME_DIR")
    if env:
        return env
    d = os.path.join(reports_dir(), "runtime")
    return d if os.path.isdir(d) else reports_dir()


def repo_dir() -> str:
    """
    Gốc cây repo — nơi `import sync.talpha.talpha_sync` lấy ĐÚNG MỘT engine sync.

    Chỉ có MỘT engine sync, nằm ở `<repo>/sync/talpha/talpha_sync.py`. Bản sao
    thứ hai dưới runtime đã bị xoá 11/09/2026, và hàm này KHÔNG được lặng lẽ
    lùi về runtime nữa.

    Vì sao gắt thế: trước đây hàm trả về `runtime_dir()` khi không thấy repo, nên
    trên máy chủ vòng báo cáo nạp bản sao cũ ở `~/talpha_reports/runtime/sync/`
    (log in `sync code = /root/talpha_reports/runtime/...`) trong khi
    `talpha-sync.service` chạy bản repo. HAI engine khác code cùng ghi một bộ
    bảng BigQuery mỗi giờ, bản nào chạy sau thì đè bản kia — và không ai thấy,
    vì cả hai đều báo "xong".

    Không thấy repo thì DỪNG và nói rõ, chứ không đoán.
    """
    env = os.environ.get("TALPHA_REPO")
    if env:
        if not os.path.isdir(os.path.join(env, "sync", "talpha")):
            raise RuntimeError(
                "TALPHA_REPO=%s nhưng trong đó không có sync/talpha — "
                "trỏ lại đúng gốc repo (trên máy chủ là /opt/talpha)." % env
            )
        return env
    # File này nằm ở <repo>/ops/talpha_reports/ khi chạy thẳng trong cây repo.
    goc = os.path.dirname(os.path.dirname(_HERE))
    if os.path.isdir(os.path.join(goc, "sync", "talpha")):
        return goc
    raise RuntimeError(
        "Không tìm thấy cây repo chứa sync/talpha (đã dò %s). "
        "Đặt TALPHA_REPO trỏ vào gốc repo — trên máy chủ: TALPHA_REPO=/opt/talpha." % goc
    )


def bq_key() -> str:
    """
    Key service account — dùng cho CẢ BigQuery lẫn Google Sheets (cùng một tài
    khoản). Trả về đường dẫn đầu tiên có thật; không có thì trả ứng viên đầu để
    lỗi báo rõ tên file thiếu thay vì báo `None`.
    """
    ung_vien = [
        os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"),
        os.path.join(runtime_dir(), "bigquery_key.json"),
        os.path.join(reports_dir(), "bigquery_key.json"),
    ]
    # repo_dir() nay NÉM lỗi khi không thấy cây repo. Tìm key là việc phụ, không
    # đáng để cả vòng chạy chết chỉ vì repo chưa gắn — thiếu repo thì bỏ ứng viên này.
    try:
        ung_vien.append(os.path.join(repo_dir(), "bigquery_key.json"))
    except RuntimeError:
        pass
    for k in ung_vien:
        if k and os.path.isfile(k):
            return k
    return ung_vien[1]


def dat_moi_truong() -> str:
    """
    Đặt GOOGLE_APPLICATION_CREDENTIALS và chuyển cwd về thư mục runtime.

    cwd quan trọng thật chứ không phải cho đẹp: `.lock`, file log theo ngày và
    `last_run_epoch` đều là đường dẫn tương đối. Chạy sai cwd thì hai vòng chạy
    không thấy lock của nhau và cùng ghi Sheet một lúc.
    """
    os.environ.setdefault("GOOGLE_APPLICATION_CREDENTIALS", bq_key())
    d = reports_dir()
    os.chdir(d)
    return d

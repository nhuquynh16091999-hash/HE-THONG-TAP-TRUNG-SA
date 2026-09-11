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
    """Gốc cây repo — để `import sync.talpha.talpha_sync` lấy được bản mới nhất."""
    env = os.environ.get("TALPHA_REPO")
    if env:
        return env
    # File này nằm ở <repo>/ops/talpha_reports/ khi chạy thẳng trong cây repo.
    goc = os.path.dirname(os.path.dirname(_HERE))
    if os.path.isdir(os.path.join(goc, "sync", "talpha")):
        return goc
    # Runtime phẳng: bản sao của sync nằm dưới runtime/.
    return runtime_dir()


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
        os.path.join(repo_dir(), "bigquery_key.json"),
    ]
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
